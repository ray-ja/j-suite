# 13 — Voice Journal (design)

Ray, 2026-08-13:
> "in the personal app i need a voice to text journaling feature. it has to be accurate with the
> transcription. theres so much i need to get out but i dont want to ruin your business context."
> "and it need to take the informatino i give it and act on it. mark things on the calendar, do
> stuff in the app, etc. even remind me of things at certain days and times"

Three requirements, and they pull against each other in one specific place. This design keeps them
apart on purpose.

1. **Accurate** transcription of long, rambling, spoken-aloud entries.
2. **Isolated** — personal talk must never touch business AI context.
3. **Actionable** — calendar events, to-dos, and timed reminders out of what he said.

---

## 0. The tension to name up front

The personal companion was *deliberately built not to act*. `sync-server.js:3220` passes an empty
tool array for a personal org (`orgIsPersonal(store, org) ? [] : CAP_TOOLS`), and
`PERSONAL_COMPANION_SYSTEM` says, verbatim:

> "WHEN HE VENTS, LET HIM. Do not fix it, do not reframe it, do not find the silver lining, and **do
> not turn it into an action item**."

That was the right call and it should survive. "There's so much I need to get out" and "act on what
I tell you" are two different modes of talking, and the failure mode is obvious: he unloads about a
hard day and the app hands him a task list. That would poison the one place he has to just talk.

**Resolution: two passes, never one.**

- **Pass 1 — the entry.** Audio → text → saved. Always. No interpretation, no reply, no judgement.
- **Pass 2 — the offer.** A *separate* extraction reads the text for concrete commitments only, and
  **proposes**. Nothing is written to the calendar, to-dos, or reminders without a tap.

He never picks a mode before speaking. He talks; the entry saves; *if* something concrete was in
there, a quiet strip appears under it — "3 things to add?" — which he can ignore forever with no
nagging and no badge. Pure venting produces an empty extraction and shows nothing at all.

---

## 1. Accuracy — local Whisper on the 4090

**Verified on the box (2026-08-13):** RTX 4090 / 24 GB VRAM · i9-13900KF / 32 threads · 23 GB RAM ·
1.4 TB free · ffmpeg 4.4.2 already installed.

That hardware settles it. **`whisper.cpp` + CUDA + `large-v3`, running locally.**

| Option | Accuracy | Cost | Privacy | Verdict |
|---|---|---|---|---|
| Web Speech API (`webkitSpeechRecognition`) | Poor on long-form; cuts on silence; weak on iOS | Free | Sends audio to Google/Apple | ❌ fails the accuracy bar |
| OpenAI Whisper API | Very good | ~$0.006/min | Audio leaves the house | ❌ not needed |
| **whisper.cpp large-v3, local CUDA** | **Best available** | **$0 forever** | **Never leaves the box** | ✅ |

A 20-minute ramble transcribes in well under a minute on this GPU. One C++ binary and one model
file — no Python, no venv, no pip, which suits a codebase with no build step.

### The five things that actually make it accurate

1. **`large-v3`**, not a small model. VRAM is free here; use it.
2. **16 kHz mono via ffmpeg** before transcription — already installed, and it's what the model wants.
3. ⭐ **Seed the vocabulary with his own proper nouns.** Whisper takes an `initial_prompt`. Feed it
   the names it would otherwise mangle — Brooke, Jamie, Vera, Leona, Paula, Chase, Mike Green,
   Twiddy, Corolla, Manteo, Jamieson, Milepost, DYAD, OBX. Built from the existing
   `personalPeople` doc and the org registry, so it stays current on its own. This is the single
   highest-leverage accuracy fix and it's specific to him.
4. **Trim long silences.** Whisper's known failure is hallucinating repeated phrases over dead air —
   a real risk when someone is talking, thinking, and trailing off. ffmpeg `silenceremove` first.
5. **Keep the audio.** He can replay any entry and re-transcribe it. Text is never the only copy.

---

## 2. Never lose the recording

This is the requirement nobody states and everybody regrets. If he talks for fifteen minutes about
something that was hard to say and the upload dies, that is the worst possible outcome — worse than
the feature not existing.

**Chain, in order. Every step durable before the next begins:**

1. `MediaRecorder` with a timeslice (~5 s chunks).
2. Each chunk → **IndexedDB immediately**, as it arrives. Not localStorage — that caps out around
   5–10 MB and handles blobs badly.
3. Stop → the entry exists locally, marked `pending`, and is visible in the Journal right away with
   a "not transcribed yet" state. **He can see it before the network is involved at all.**
4. Upload — **reuse the existing chunked video path** (`/api/video/init|chunk|done`,
   `sync-server.js:3806`). It was built for exactly this: raw binary, straight to disk, nothing
   buffered whole at either end, and **chunks idempotent by index so a phone that drops signal
   re-sends the same chunk instead of duplicating**. That is the difference between working on
   cellular and not.
5. Server writes the audio file to disk **before** transcribing. Transcription failure never costs
   the recording.
6. Transcribe → text returns → entry updates.
7. **Local audio is deleted only after the entry has confirmed-synced to the server.**

Offline is a normal state, not an error: the recording sits in a local queue and drains when
Tailscale is reachable. Nothing is ever the only copy in one place.

---

## 3. Isolation — already structural, and provable

His worry: *"i dont want to ruin your business context."* Good instinct, and the multi-org work
already handled it. Verified in the code, not assumed:

- `capTodayContext` **branches before it builds anything**: `sync-server.js:1278` —
  `if (orgIsPersonal(store, org)) return capPersonalContext(store, org, acctId, ny, t);`
  The business context builder is never entered for a personal org.
- Journal entries are `lifeNotes` **inside the rbjvl org slab**. Per-org isolation means the OBX and
  Jamieson contexts cannot reach them — not "are told not to," *cannot*.
- The personal org gets `PERSONAL_COMPANION_SYSTEM` and, today, **zero tools**.
- `capPersonalContext` is the only place journal bodies are ever assembled, for the owning account
  only, and the endpoint already gates on `orgsForUser`.

**Journal volume must stay bounded.** `capPersonalContext` currently inlines the 8 most recent
entries at 400 chars each. Voice entries will be far longer than typed ones — twenty minutes of talk
is thousands of words. Left alone, a few voice entries would crowd out everything else the companion
knows and make it *worse*. Fix: keep full text in the record, feed the companion a bounded window
(recent entries clipped, older ones as one-line summaries generated at save time).

**A ship-blocking test**, in the same spirit as the migration-proof rule: load a fixture with a
personal org holding journal entries, build the business context for OBX and Jamieson, and assert
**zero** journal bytes appear in either. So the isolation is enforced by a red test, not by care.

*(And to be direct about the other reading of that sentence: I don't read the journal either. It
isn't in this repo, it isn't in anything I load, and I have no reason to open it.)*

---

## 4. Actions — proposed, never silent

Pass 2 runs only after the entry is saved, and only looks for **concrete commitments**: a date, a
task, a person to contact, a thing to remember at a time. Not feelings, not opinions, not anything
about how he's doing.

Output is a short list, each row one tap to accept and one to dismiss:

| Found | Becomes |
|---|---|
| "Vera's checkup is the 3rd at 2" | `personalEvents` entry (js/126 calendar) |
| "I need to call the insurance guy" | personal to-do |
| "remind me Tuesday morning to send the invoice" | **timed reminder** (new) |

**Rules that keep this from becoming the thing he didn't ask for:**
- Nothing writes without a tap. Ever.
- No badge, no counter, no nagging. Ignored proposals expire silently.
- Pure venting → nothing extracted → **no strip shown at all.** The absence is the feature.
- Extraction is a separate call with its own narrow prompt — it never sees the companion's system
  prompt and never generates a reply. It cannot say anything to him.

### Timed reminders — the one genuinely new mechanism

Web push exists (`pushNotify`, `vapidJwt`, ~line 2463) but is **event-driven only** — it fires on a
message, and there is no scheduler. Timed reminders need something that wakes up.

That already exists too: Sentinel's cron pings his private DM at 8am/noon/4pm. A reminder sweep
rides the same mechanism — a `reminders` collection (own collection, stable ids, per-record LWW like
everything else), swept on a cron, fired via the existing push path.

⚠️ **Deploy the server before seeding `reminders`** — `mergeState` rebuilds each org slab from
`COLLECTIONS`, so a running old binary silently drops a collection it doesn't know about.

---

## 5. Build order

**Phase 1 — voice → journal.** Recording, durable local queue, chunked upload, whisper.cpp, entry
saved. ⭐ **Needs no API key and no cloud at all** — it is entirely local. This is the half he
asked for first and it can ship on its own.

**Phase 2 — the isolation test.** Red-test the boundary, and bound the context window before voice
entries have a chance to swamp it.

**Phase 3 — extraction → calendar and to-dos.** Proposals only. ⚠️ Needs an Anthropic key on the
rbjvl org — currently templated, so this is blocked on that.

**Phase 4 — timed reminders.** New collection + cron sweep + existing push.

---

## Open questions for Ray

1. **Hold-to-talk or tap-to-start / tap-to-stop?** For long entries tap/tap is right — holding a
   button for twenty minutes is absurd. Recommend tap/tap with a visible timer.
2. **Should the companion reply to a voice entry, or stay silent unless asked?** Recommend silent
   by default with a "talk about this" button. An entry that gets answered every time stops being a
   journal.
3. **Keep the audio forever, or drop it after transcription is confirmed good?** Recommend keep —
   disk is free (1.4 TB) and his own voice from a hard week is worth more than the text.
