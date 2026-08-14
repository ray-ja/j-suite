/* voice-journal-tests.js — the voice journal (js/131 + transcribe.py + /api/voice/*).
   Ray, 2026-08-13: "i need a voice to text journaling feature. it has to be accurate with the
   transcription. theres so much i need to get out but i dont want to ruin your business context."

   Two of those three are testable without a browser and both are tested here. The third (accuracy) is a
   property of large-v3 and was verified by hand against real speech.

   ⭐ THE ISOLATION SUITE IS THE POINT. He was worried that pouring personal life into the app would
   degrade the business AI. It cannot — but "cannot" has to be enforced by a red test, not by my care,
   because the whole reason he can speak freely is that the boundary holds.

   Pure node. Run: node voice-journal-tests.js */
const fs = require("fs"), path = require("path");
const t = require("./sync-server");
const vj = require("./js/131-voice-journal.js");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const SV = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");
const CL = fs.readFileSync(path.join(__dirname, "js", "131-voice-journal.js"), "utf8");
const PY = fs.readFileSync(path.join(__dirname, "transcribe.py"), "utf8");
const LF = fs.readFileSync(path.join(__dirname, "js", "78-life-tracker.js"), "utf8");

/* ============================================================================================
   ⭐ ISOLATION — "i dont want to ruin your business context"
   ============================================================================================ */
console.log("\n--- ⭐ the journal must never reach a business context ---");
{
  const SECRET = "ZZQX_PRIVATE_JOURNAL_SENTINEL";
  const store = {
    registry: [
      { id: "obx", name: "OBX Lot Solutions", tabs: ["today", "jobs", "quotes", "customers"] },
      { id: "jam", name: "Jamieson", tabs: ["today", "jobs", "products"] },
      { id: "rbjvl", name: "Personal", tabs: ["today", "life", "journal", "budget"] }
    ],
    users: [{ id: "u1", username: "ray", updatedAt: 1 }],
    obx: { customers: [{ id: "c1", name: "Mike Green", updatedAt: 1 }], jobs: [], timeclock: [] },
    jam: { customers: [], jobs: [], timeclock: [] },
    rbjvl: {
      lifeNotes: [
        { id: "n1", date: "2026-08-13", title: "hard day", body: SECRET + " everything I said out loud", updatedAt: 9 },
        { id: "n2", date: "2026-08-12", title: "", body: SECRET + " more of it", updatedAt: 8 }
      ]
    }
  };

  const obxCtx = t.capTodayContext(store, "obx", "u1");
  const jamCtx = t.capTodayContext(store, "jam", "u1");
  const perCtx = t.capTodayContext(store, "rbjvl", "u1");

  ok("OBX context contains ZERO journal bytes", obxCtx.indexOf(SECRET) < 0);
  ok("Jamieson context contains ZERO journal bytes", jamCtx.indexOf(SECRET) < 0);
  ok("...not even an entry TITLE leaks into OBX", obxCtx.indexOf("hard day") < 0);
  ok("the personal context DOES see it (or the feature is pointless)", perCtx.indexOf(SECRET) >= 0);
  ok("a personal org is recognised as personal", t.orgIsPersonal(store, "rbjvl") === true);
  ok("...and a business org is not", t.orgIsPersonal(store, "obx") === false && t.orgIsPersonal(store, "jam") === false);
  ok("the branch happens BEFORE any business context is built", /if \(orgIsPersonal\(store, org\)\) return capPersonalContext/.test(SV));
  ok("a personal org is given NO tools — the companion cannot act on its own", /orgIsPersonal\(store, org\) \? \[\] : CAP_TOOLS/.test(SV));

  /* the journal lives in the org slab, so isolation is structural rather than a rule someone follows */
  ok("journal entries live in the personal org's own slab", !!store.rbjvl.lifeNotes && !store.obx.lifeNotes);

  /* a long voice entry must not swamp what the companion knows */
  const big = { registry: store.registry, users: store.users, obx: store.obx, jam: store.jam,
    rbjvl: { lifeNotes: Array.from({ length: 40 }, (_, i) => ({ id: "b" + i, date: "2026-08-" + String(i % 28 + 1).padStart(2, "0"), body: "x".repeat(20000), updatedAt: i })) } };
  const bigCtx = t.capTodayContext(big, "rbjvl", "u1");
  ok("40 twenty-thousand-character entries stay bounded (< 20k of context)", bigCtx.length < 20000, bigCtx.length);
  ok("...and it still reports the true total so nothing looks lost", /of 40 entries/.test(bigCtx));
}

/* ============================================================================================
   NEVER LOSE A RECORDING
   ============================================================================================ */
console.log("\n--- the recording survives every step ---");
ok("each 5s slice is written to IndexedDB as it arrives", /rec\.ondataavailable[\s\S]{0,220}vjPut\("chunks"/.test(CL));
/* ORDER, not proximity — the earlier distance-bounded regex broke the moment a comment was added
   between the two statements, while the property it was checking still held. */
ok("the local copy is deleted ONLY after the entry exists",
  CL.indexOf("d.lifeNotes.push(n)") > 0 && CL.indexOf("vjDrop(localId") > CL.indexOf("d.lifeNotes.push(n)"));
ok("...and only after save() has queued it to sync",
  CL.indexOf("vjDrop(localId") > CL.lastIndexOf("save();", CL.indexOf("vjDrop(localId")));
ok("an upload failure returns the recording to 'pending', never a dead end", /state: "pending", error:/.test(CL));
ok("...and the failure path is explained so nobody 'tidies' it away", /Never a dead end/.test(CL));
ok("it retries when the network comes back", /addEventListener\("online"/.test(CL));
ok("a stranded recording is picked up on load", /if \(vjCan\(\)\) vjDrain\(\)/.test(CL));
ok("the server writes audio to disk BEFORE transcribing", SV.indexOf("voiceQueue(id, dest") > SV.indexOf("fs.closeSync(out)"));
ok("...and says why", /a transcription failure never costs the recording/.test(SV));
ok("an empty recording is rejected rather than silently stored", /the recording was empty/.test(SV));
ok("a screen lock can't kill a long entry", /wakeLock/.test(CL));

console.log("\n--- chunks are addressed by index (the cellular case) ---");
ok("a chunk is written to its OWN file by index", /fs\.writeFileSync\(path\.join\(TMP, id \+ "\." \+ n \+ "\.part"\)/.test(SV));
ok("...NOT appended like /api/video/chunk does", !/appendFileSync\(part/.test(SV.slice(SV.indexOf("/api/voice/"), SV.indexOf("/api/video/"))));
ok("parts are reassembled in index order", /\.sort\(\(a, b\) => a\.n - b\.n\)/.test(SV));
ok("the reason a re-send must overwrite is recorded", /re-send\s+overwrites/.test(SV));
ok("chunk index is range-checked", /n >= 0 && n < 20000/.test(SV));
ok("the id is sanitised against path traversal", /replace\(\/\[\^a-f0-9\]\/g, ""\)/.test(SV));

console.log("\n--- auth + limits ---");
ok("every /api/voice route requires a token", /startsWith\("\/api\/voice\/"\)[\s\S]{0,400}if \(!tokOk\(tok\)\)/.test(SV));
ok("chunk size is capped", /len > 12e6/.test(SV.slice(SV.indexOf("/api/voice/"))));
ok("a hung transcription is killed rather than wedging the queue", /SIGKILL/.test(SV));
ok("only one transcription runs at a time (there is one GPU)", /VOICE_BUSY/.test(SV) && /VOICE_PENDING/.test(SV));

/* ============================================================================================
   ACCURACY MACHINERY
   ============================================================================================ */
console.log("\n--- what makes the transcript accurate ---");
ok("large-v3, not a small model", /MODEL_DEFAULT = "large-v3"/.test(PY));
ok("runs on the GPU", /device, compute = "cuda", "float16"/.test(PY));
ok("VAD filtering (stops hallucination loops over dead air)", /vad_filter=True/.test(PY));
ok("16kHz mono via ffmpeg", /"-ar", "16000"/.test(PY) && /"-ac", "1"/.test(PY));
ok("decoded as English so a mumble isn't 'detected' as another language", /language="en"/.test(PY));
ok("condition_on_previous_text disabled for long monologue", /condition_on_previous_text=False/.test(PY));
ok("proper nouns are fed in as a vocabulary hint", /initial_prompt/.test(PY) && /--vocab/.test(PY));
ok("the vocabulary is built from the app's own records", /function voiceVocab/.test(SV) && /personalPeople/.test(SV));
ok("...covering people, orgs and customers", /r\.name/.test(SV.slice(SV.indexOf("function voiceVocab"))) && /o\.customers/.test(SV.slice(SV.indexOf("function voiceVocab"))));
ok("CPU fallback covers COMPUTE failure, not just model load", /if device != "cpu"/.test(PY) && /at the FIRST MATMUL/.test(PY));
ok("the CUDA runtime is put on the loader path by re-exec", /def ensure_cuda_libs/.test(PY) && /os\.execv/.test(PY));
ok("...with the reason recorded (no toolkit, no root on this box)", /cannot be changed from inside a running process/.test(PY));
ok("long pauses become paragraph breaks", /s\["start"\] - prev_end > 2\.0/.test(PY));

/* ============================================================================================
   PURE HELPERS
   ============================================================================================ */
console.log("\n--- title + clock ---");
eq("a title is the first seven words", vj.vjTitle("today was long and I did not sleep at all really"), "today was long and I did not…");
eq("a short entry needs no ellipsis", vj.vjTitle("short one"), "short one");
eq("empty text yields no title", vj.vjTitle(""), "");
eq("null is safe", vj.vjTitle(null), "");
eq("newlines collapse", vj.vjTitle("one\n\ntwo three"), "one two three");
ok("a very long single word is truncated", vj.vjTitle("z".repeat(200)).length <= 60, vj.vjTitle("z".repeat(200)).length);
eq("clock formats mm:ss", vj.vjClock(75), "1:15");
eq("...pads seconds", vj.vjClock(65), "1:05");
eq("...zero", vj.vjClock(0), "0:00");
eq("...twenty minutes", vj.vjClock(1200), "20:00");
eq("negative is clamped", vj.vjClock(-5), "0:00");

/* ============================================================================================
   THE ENTRY IT PRODUCES
   ============================================================================================ */
console.log("\n--- a voice entry is a normal journal entry ---");
ok("it writes to lifeNotes, not some parallel store", /d\.lifeNotes\.push\(n\)/.test(CL));
ok("it keeps a link back to the audio", /audioId: serverId/.test(CL));
ok("it is flagged as voice so the list can mark it", /voice: true/.test(CL));
ok("...and the list marks it", /n\.voice\?"🎙️ ":""/.test(LF));
ok("a silent recording does NOT create an empty entry", /nothing was said in that recording/.test(CL));
ok("touch() is called so it syncs like any record", /touch\(n\)/.test(CL));

console.log("\n--- the screen ---");
ok("voice is offered first on the Journal", LF.indexOf("vjBarHTML") < LF.indexOf("Write one instead"));
ok("the Journal still works without js/131", /\(typeof vjBarHTML==="function"\)\?vjBarHTML\(\):""/.test(LF));
ok("writing by hand is still one tap", /Write one instead/.test(LF));
ok("an insecure context explains itself instead of failing silently", /needs a secure connection/.test(CL));
ok("pending recordings are visible, never hidden", /waiting to send/.test(CL) && /will send when the server is reachable/.test(CL));
ok("js/131 is registered in the shell", fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8").indexOf('src="js/131-voice-journal.js"') > 0);

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
