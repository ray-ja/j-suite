#!/usr/bin/env python3
"""
transcribe.py — one audio file in, accurate text out. Local, free, on the GPU.

Ray, 2026-08-13, asking for voice journaling in the personal app:
    "it has to be accurate with the transcription. theres so much i need to get out"

That "accurate" is the whole requirement, so this does NOT use the browser's speech API
(webkitSpeechRecognition): it cuts out on silence, is weak on long-form, is crippled on iOS, and it
ships your audio to Google. This box has an RTX 4090 sitting idle, so we run the best open model
there is, locally — the audio never leaves the house and it costs nothing per minute, forever.

faster-whisper is already installed here (~/studio/ingest.py uses it for the video pipeline), but on
CPU with small.en. For a journal we want the ceiling, not the sweet spot: large-v3 on CUDA.

FIVE THINGS THAT MAKE IT ACCURATE, in rough order of how much they matter:

  1. large-v3 on the GPU. VRAM is free here (24GB, model wants ~3).
  2. --vocab: Whisper takes an `initial_prompt` that biases decoding toward words you tell it to
     expect. Ray's entries are full of proper nouns it would otherwise mangle — Brooke, Vera, Leona,
     Twiddy, Corolla, Milepost. The server builds this list from the app's own people/org records, so
     it stays current without anyone maintaining it. Highest-leverage fix in the file.
  3. VAD filtering. Whisper's signature failure is looping a phrase over dead air — a real risk when
     someone is talking, thinking, and trailing off mid-sentence. The VAD cuts silence before the
     model ever sees it.
  4. 16kHz mono. What the model actually wants; ffmpeg is already on the box.
  5. Everything decoded as English. Stops a mumbled passage being "detected" as another language and
     returned as garbage.

Output is one JSON object on stdout so the Node server can consume it without parsing prose. Any
failure exits non-zero with {"error": ...} — the caller keeps the audio either way, so a failure here
is never data loss.

    python3 transcribe.py AUDIO [--vocab "Brooke, Vera, Twiddy"] [--model large-v3]
"""
import sys, os, json, subprocess, tempfile, glob

MODEL_DEFAULT = "large-v3"


def ensure_cuda_libs():
    """Put the pip-installed CUDA runtime on the loader path.

    This box has the NVIDIA *driver* but no CUDA *toolkit*, and installing one needs root and ~3GB of
    apt. The pip wheels (nvidia-cublas-cu12, nvidia-cudnn-cu12) ship the same shared objects into
    site-packages, which is all ctranslate2 actually needs — but it dlopens them by bare name, so they
    have to be on LD_LIBRARY_PATH *before* the process starts. Hence the re-exec: the linker path is
    read at startup and cannot be changed from inside a running process.

    Without this you get "Library libcublas.so.12 is not found" only once real work begins — the model
    loads fine on the GPU and then the first matmul fails.
    """
    if os.environ.get("VJ_CUDA_PATH_SET"):
        return
    roots = []
    for base in (os.path.expanduser("~/.local/lib"), sys.prefix + "/lib", "/usr/local/lib"):
        roots += glob.glob(os.path.join(base, "python3*", "site-packages", "nvidia", "*", "lib"))
    roots = [r for r in roots if os.path.isdir(r)]
    if not roots:
        return
    cur = os.environ.get("LD_LIBRARY_PATH", "")
    parts = [p for p in cur.split(":") if p]
    added = [r for r in roots if r not in parts]
    if not added:
        return
    os.environ["LD_LIBRARY_PATH"] = ":".join(parts + added)
    os.environ["VJ_CUDA_PATH_SET"] = "1"
    try:
        os.execv(sys.executable, [sys.executable] + sys.argv)
    except OSError:
        pass        # carry on; the CPU path still works


def die(msg):
    print(json.dumps({"error": str(msg)[:500]}))
    sys.exit(1)


def to_wav(src):
    """16kHz mono PCM. Whisper resamples internally anyway, but doing it here means a phone's
    webm/opus is decoded once by ffmpeg (which is good at it) rather than by the model's loader."""
    fd, wav = tempfile.mkstemp(suffix=".wav", prefix="vj-")
    os.close(fd)
    r = subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", wav],
        capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(wav) or os.path.getsize(wav) < 1024:
        try: os.unlink(wav)
        except OSError: pass
        die("could not decode the audio: " + (r.stderr or "")[-300:])
    return wav


def main():
    args = sys.argv[1:]
    if not args:
        die("usage: transcribe.py AUDIO [--vocab ...] [--model ...]")
    src = args[0]
    if not os.path.exists(src):
        die("no such file: " + src)

    ensure_cuda_libs()

    vocab, model_name = "", MODEL_DEFAULT
    for i, a in enumerate(args):
        if a == "--vocab" and i + 1 < len(args):
            vocab = args[i + 1]
        elif a == "--model" and i + 1 < len(args):
            model_name = args[i + 1]

    wav = to_wav(src)
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        die("faster-whisper is not installed on this box")

    # Fall back to CPU rather than failing outright — a slow transcript beats no transcript.
    device, compute = "cuda", "float16"
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() < 1:
            device, compute = "cpu", "int8"
    except Exception:
        device, compute = "cpu", "int8"

    # The prompt is a hint, not a constraint: it biases spelling of names without forcing them to appear.
    initial_prompt = None
    if vocab.strip():
        initial_prompt = ("This is a personal spoken journal entry. Names and places that may come up: "
                          + vocab.strip()[:800] + ".")

    def run(dev, comp):
        """Load and decode on one device. Segments are a generator, so the GPU work happens inside the
        loop — which is why this whole thing, not just the load, sits behind the CPU fallback."""
        model = WhisperModel(model_name, device=dev, compute_type=comp)
        segments, info = model.transcribe(
            wav,
            language="en",
            beam_size=5,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 700},
            initial_prompt=initial_prompt,
            condition_on_previous_text=False,   # long rambling monologue: stops one bad patch cascading
        )
        sg, pr = [], []
        for s in segments:
            t = (s.text or "").strip()
            if not t:
                continue
            pr.append(t)
            sg.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": t})
        return sg, pr, info

    try:
        try:
            segs, parts, info = run(device, compute)
        except Exception as e:
            # A slow transcript beats no transcript. Covers a missing CUDA runtime, VRAM pressure, or a
            # driver/library mismatch — all of which surface at the FIRST MATMUL, not at load.
            if device != "cpu":
                sys.stderr.write("gpu path failed (%s); falling back to cpu\n" % str(e)[:200])
                device, compute = "cpu", "int8"
                segs, parts, info = run(device, compute)
            else:
                raise
    except Exception as e:
        die("transcription failed: " + str(e))
    finally:
        try: os.unlink(wav)
        except OSError: pass

    text = " ".join(parts).strip()
    # Paragraph breaks on the long gaps — a wall of unbroken text is unreadable on a phone.
    if segs:
        out, prev_end = [], None
        for s in segs:
            if prev_end is not None and s["start"] - prev_end > 2.0:
                out.append("\n\n")
            elif out:
                out.append(" ")
            out.append(s["text"])
            prev_end = s["end"]
        text = "".join(out).strip()

    print(json.dumps({
        "text": text,
        "segments": segs,
        "duration": round(getattr(info, "duration", 0.0), 2),
        "model": model_name,
        "device": device,
        "words": len(text.split()),
    }))


if __name__ == "__main__":
    main()
