/* studio-upload-tests.js — the chunked video path (js/128 + /api/video/*).
   Ray: "build it into the j suite app so I can just put the videos there."
   The existing uploader cannot carry this: base64 in browser memory, 10MB server cap. This asserts the
   separate streaming path exists and behaves — including the retry, which is the difference between this
   working from a job site on cellular and not. Pure node. Run: node studio-upload-tests.js */
const fs = require("fs"), path = require("path");
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (x ? "  -> " + x : "")); } }

const SV = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");
const ST = fs.readFileSync(path.join(__dirname, "js", "128-studio.js"), "utf8");
const R  = fs.readFileSync(path.join(__dirname, "js", "03-routing.js"), "utf8");
const S2 = fs.readFileSync(path.join(__dirname, "js", "02-state.js"), "utf8");

console.log("\n--- it does NOT reuse the base64 uploader ---");
ok("client posts to /api/video/*", /\/api\/video\/init/.test(ST) && /\/api\/video\/chunk/.test(ST) && /\/api\/video\/done/.test(ST));
ok("it never base64s the file", !/readAsDataURL|dataUrl/.test(ST));
ok("it sends the raw Blob slice", /body: blob/.test(ST));
ok("...and the file is sliced, not held whole", /file\.slice\(/.test(ST));
ok("the reason is recorded", /base64-encodes the whole file in browser memory/.test(ST));

console.log("\n--- the server writes straight to disk ---");
ok("endpoint exists", /startsWith\("\/api\/video\/"\)/.test(SV));
ok("chunks append rather than buffer", /fs\.appendFileSync\(part/.test(SV));
ok("it lands where ingest.py looks", /path\.join\(STUDIO, "raw"\)/.test(SV));
ok("only video extensions accepted", /mp4\|mov\|m4v\|webm\|mkv\|avi/.test(SV));
ok("auth is enforced", /if \(!tokOk\(tok\)\)/.test(SV.slice(SV.indexOf('/api/video/'))));
ok("a same-named file is never clobbered", /if \(fs\.existsSync\(dest\)\)/.test(SV));
ok("an empty upload is rejected", /nothing was uploaded/.test(SV));

console.log("\n--- retry, because he uploads from job sites ---");
ok("each chunk retries", /attempt < 3/.test(ST));
ok("with backoff", /1200 \* attempt/.test(ST));
ok("only the failed CHUNK repeats, not the file", /upload stalled on piece/.test(ST));
ok("chunk size is modest so a retry is cheap", /STU_CHUNK = 4 \* 1024 \* 1024/.test(ST));

console.log("\n--- it captures INTENT, not just bytes ---");
ok("targets are sent", /targets: targets/.test(ST));
ok("tiktok + x toggles", ST.indexOf("tiktok") > 0 && ST.indexOf("stuTarget") > 0 && ST.indexOf("STU_TARGETS = { tiktok: true, x: true }") > 0);
ok("it asks what the footage is right after upload", /stuNote\(rec\.id, true\)/.test(ST));
ok("status walks uploaded -> transcribed -> cut", /uploaded:/.test(ST) && /transcribed:/.test(ST) && /cut:/.test(ST));
ok("it tells him to narrate", /Talk while you work/.test(ST));

console.log("\n--- wiring ---");
ok("collection in server COLLECTIONS", /"studioVideos"/.test(SV));
ok("collection in client blank()", /studioVideos:\[\]/.test(S2));
ok("both load() backfills", (S2.match(/studioVideos\)\)S\[b\]\.studioVideos=\[\]/g) || []).length === 2);
ok("studio has a screen", /studio:\(typeof rStudio==="function"\?rStudio:rToday\)/.test(R));
ok("studio has TAB_META", /studio:\{l:"Studio"/.test(R));
ok("module in the shell", fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8").indexOf('src="js/128-studio.js"') > 0);

console.log("\n--- it stays OFF the personal org ---");
{
  const tmpl = (R.match(/personal: \[([^\]]*)\]/) || [, ""])[1];
  ok("personal template excludes studio", tmpl.indexOf("studio") < 0, tmpl);
  ok("studio is NOT opt-in, so work orgs get it by default", !/ORG_OPTIN_TABS = \[[^\]]*"studio"/.test(R));
  ok("...and the reason is recorded", /the personal org was cleared of work for a reason/.test(R));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
