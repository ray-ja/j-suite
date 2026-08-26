/* ============================================================================================================
   STALL TESTS — "cap is reading 1 of 1, its been there a long time i think its bugged" (Ray, 2026-08-26)

   ⚠️ WHAT THIS SUITE IS ACTUALLY ABOUT. The visible bug was a frozen progress banner. The real bug was that a
   network call with no deadline can leave a promise permanently unsettled, and an unsettled promise is not an
   error: nothing throws, nothing logs, nothing retries. Downstream of that await, js/88 held a `_capRcptBusy`
   flag that only came down on the happy path — so one dead socket turned Cap's receipt reading OFF for the
   whole session, and the only evidence anywhere was a progress bar that stopped counting.

   THE RULE THESE TESTS ENFORCE: every wait has a deadline, and every flag comes down in a finally.

   ⛔ These are behavioural where they can be — the abort actually fires, the finally actually runs, the double
   callback is actually attempted. Grep assertions are only used where the thing under test is the ABSENCE of a
   pattern (no bare timeout-less request tail survives), which behaviour cannot demonstrate.
   ============================================================================================================ */
const fs = require("fs");
const assert = require("assert");
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}
const R = f => fs.readFileSync(f, "utf8");
/* strip comments so a test can never pass by matching the prose that describes the bug — this suite has
   burned me before (five times) and the fix is mechanical, not a promise to be careful */
const CODE = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SRV = R("sync-server.js"), SRVC = CODE(SRV);
const CAP = R("js/88-cap-receipts.js"), CAPC = CODE(CAP);
const OAI = R("js/75-org-ai.js"), OAIC = CODE(OAI);
const UPS = R("js/104-upload-status.js"), UPSC = CODE(UPS);

console.log("\n--- ⛔ no outbound AI call may be written without a deadline ---");
{
  /* THE ORIGINAL TAIL. All 8 senders ended with exactly this, and Node's default socket timeout is none. */
  const bareTail = /r\.on\("error", e => cb\(e\)\);\s*r\.write\(payload\);\s*r\.end\(\);/g;
  ok("⭐ not one timeout-less request tail survives", (SRVC.match(bareTail) || []).length === 0,
    (SRVC.match(bareTail) || []).length);

  const senders = SRVC.match(/https\.request\(\s*"https:\/\/api\.anthropic\.com/g) || [];
  ok("...and all 7 Anthropic senders are still there (nothing was deleted to make the above pass)", senders.length === 7, senders.length);
  ok("...plus the Gemini one", /https\.request\(\s*(?:url|"https:\/\/generativelanguage)/.test(SRVC));
  ok("⭐ all 8 now route through aiSend", (SRVC.match(/aiSend\(r, payload, cb\)/g) || []).length === 8,
    (SRVC.match(/aiSend\(r, payload, cb\)/g) || []).length);
  /* 8 senders + 1 inside aiSend itself — belt AND braces, because a helper whose safety depends on every
     future caller remembering something is a helper that will eventually be called wrong. */
  ok("⭐ all 8 senders guard cb against a double fire, and so does aiSend",
    (SRVC.match(/cb = aiOnce\(cb\);/g) || []).length === 9 &&
    /function aiSend\([\s\S]{0,300}?cb = aiOnce\(cb\);/.test(SRVC),
    (SRVC.match(/cb = aiOnce\(cb\);/g) || []).length);
  ok("⚠️ the reason is recorded next to the fix", /A HANG IS WORSE THAN AN ERROR/.test(SRV));
}

console.log("\n--- ⭐ aiOnce: the deadline and the response can both land ---");
{
  const { aiOnce } = require("./sync-server.js");
  /* WHY THIS MATTERS AND ISN'T THEORETICAL: destroy() emits "error" while a response may already be mid-flight.
     Both paths call cb. Both cb's write the HTTP response. The second write is ERR_STREAM_WRITE_AFTER_END —
     the fix would have turned a hang into a crash. */
  let calls = [];
  const g = aiOnce(function () { calls.push(Array.prototype.slice.call(arguments)); });
  g(null, "first"); g(new Error("timed out")); g(null, "third");
  ok("⭐ three calls, one delivery", calls.length === 1, calls.length);
  ok("...and it is the FIRST one, not the last", calls[0][1] === "first", calls[0]);

  /* the assistant callback carries three args — a guard that forgets to forward them silently drops tool actions */
  let got = null;
  aiOnce(function (e, t, a) { got = [e, t, a]; })(null, "text", [{ tool: "addBill" }]);
  ok("⭐ every argument is forwarded, not just the first two", got && got[2] && got[2][0].tool === "addBill", got);

  /* a throwing consumer must not take the request down with it */
  let survived = true;
  try { aiOnce(function () { throw new Error("consumer blew up"); })(null, "x"); } catch (e) { survived = false; }
  ok("⛔ a throwing callback can't escape into the request handler", survived);
}

console.log("\n--- ⏱ aiSend actually arms the socket timeout ---");
{
  const { aiSend, AI_HTTP_TIMEOUT_MS } = require("./sync-server.js");
  ok("the ceiling is a safety net, not a latency budget", AI_HTTP_TIMEOUT_MS >= 60000, AI_HTTP_TIMEOUT_MS);

  /* a fake ClientRequest: records what aiSend does to it, and lets us fire the timeout by hand */
  function fakeReq() {
    return {
      handlers: {}, wrote: null, ended: false, timeoutMs: null, timeoutFn: null, destroyedWith: null,
      on(ev, fn) { this.handlers[ev] = fn; return this; },
      setTimeout(ms, fn) { this.timeoutMs = ms; this.timeoutFn = fn; return this; },
      destroy(err) { this.destroyedWith = err; if (this.handlers.error) this.handlers.error(err); },
      write(p) { this.wrote = p; }, end() { this.ended = true; }
    };
  }
  let r = fakeReq(), errs = [];
  aiSend(r, "PAYLOAD", e => errs.push(e));
  ok("⭐ a timeout is armed BEFORE the payload goes out", r.timeoutMs === AI_HTTP_TIMEOUT_MS, r.timeoutMs);
  ok("...and the payload still gets written and ended", r.wrote === "PAYLOAD" && r.ended);

  r.timeoutFn();                                    // ← the socket goes silent
  ok("⭐ the deadline destroys the request", !!r.destroyedWith);
  ok("⭐ and the caller is TOLD, rather than waiting forever", errs.length === 1, errs.length);
  ok("...with a message that says what happened", /timed out/i.test(errs[0].message), errs[0] && errs[0].message);

  /* the whole point: a stall must terminate the call, not merely be noticed */
  let r2 = fakeReq(), n = 0;
  aiSend(r2, "P", () => n++, 5000);
  ok("an explicit ceiling is honoured", r2.timeoutMs === 5000, r2.timeoutMs);
  r2.timeoutFn(); r2.handlers.error(new Error("late socket error"));
  ok("⛔ a late socket error after the deadline does NOT re-fire the callback", n === 1, n);
}

console.log("\n--- ⏱ orgAiFetch: the client gives up too ---");
{
  /* THE CLIENT HALF OF THE SAME HOLE. Even with the server fixed, a fetch whose connection died mid-flight
     never settles — the server isn't involved any more. */
  const ctx = { setTimeout, clearTimeout, console };
  ctx.window = ctx; ctx.S = { sync: {}, biz: "obx" };
  ctx.AbortController = function () {
    const self = this; this.signal = { aborted: false, _fns: [] };
    this.abort = function () { self.signal.aborted = true; self.signal._fns.forEach(f => f()); };
  };
  let lastOpts = null, resolveIt = null;
  ctx.fetch = function (url, opts) {
    lastOpts = opts;
    return new Promise(function (res, rej) {
      resolveIt = res;
      if (opts && opts.signal) opts.signal._fns.push(function () { const e = new Error("aborted"); e.name = "AbortError"; rej(e); });
    });
  };
  require("vm").createContext(ctx);
  require("vm").runInContext(OAI.slice(OAI.indexOf("function orgAiFetch"), OAI.indexOf("if (typeof window !== \"undefined\") window.orgAiFetch")), ctx);

  ok("⭐ orgAiFetch's deadline is LONGER than the server's, so the server answers first",
    /150000/.test(OAIC) && 150000 > require("./sync-server.js").AI_HTTP_TIMEOUT_MS);
  ok("...and that ordering is explained, not accidental", /DELIBERATELY LONGER/.test(OAI));

  return (async function () {
    /* a request that never comes back — exactly the shape of the bug */
    const p = ctx.orgAiFetch("http://x/api/org-ai/read-receipt", { method: "POST" }, 30);
    ok("the caller's options survive (method isn't dropped when we add the signal)", lastOpts.method === "POST");
    ok("⭐ a signal is attached", !!lastOpts.signal);
    let err = null;
    try { await p; } catch (e) { err = e; }
    ok("⭐ THE HANG BECOMES A REJECTION — the await finishes", !!err);
    ok("...and it says it timed out, not 'you're offline'", /timed out/.test(err.message), err && err.message);

    /* and a normal fast response is untouched */
    const p2 = ctx.orgAiFetch("http://x/y", {}, 5000);
    resolveIt({ ok: true, status: 200 });
    const r2 = await p2;
    ok("⛔ a healthy response is passed straight through", r2.ok === true && r2.status === 200);

    console.log("\n--- ⭐ the busy flag comes down no matter what ---");
    {
      /* THE FLAG THAT DISABLED CAP. capRcptSweep's first guard is `if (_capRcptBusy) return`, so a flag left up
         is a permanent, silent off switch on receipt reading. */
      ok("⭐ capRcptRun's body is inside a try/finally", /_capRcptBusy = true;[\s\S]{0,900}?\btry \{/.test(CAPC));
      /* the declaration `let _capRcptBusy = false` is not a reset — count only the assignments */
      const resets = (CAPC.match(/(?<!let )_capRcptBusy = false/g) || []).length;
      ok("⭐ the ONLY places the flag comes down are the two finallys",
        resets === 2 && (CAPC.match(/\} finally \{[\s\S]{0,400}?_capRcptBusy = false/g) || []).length === 2, resets);
      ok("...for the bulk reread too", /capRcptReread[\s\S]*?\} finally \{ _capRcptBusy = false/.test(CAPC));
      ok("⚠️ and why is written down where the next person will unwind it", /DO NOT UNWIND IT/.test(CAP));

      /* BEHAVIOURAL: run the real drain against a read that rejects, and prove the flag resets */
      const c2 = { console, setTimeout, clearTimeout, Promise };
      c2.window = c2; require("vm").createContext(c2);
      let banners = [];
      Object.assign(c2, {
        S: { biz: "obx" }, D: () => ({ jobs: [] }),
        /* a SECOND receipt appears for the second drain — the first is in the session skip-list after its
           read died, and a drain with nothing pending correctly returns before it touches the banner. */
        rcptReview: () => [{ id: "r1", receiptId: "a.jpg", store: "review" },
                           { id: "r2", receiptId: "b.jpg", store: "review" }],
        rcptSuggestionOneTapOk: () => false, rcptFileSuggestion: () => ({ ok: false }),
        rcptFinFull: () => true, rcptFindRecord: () => null, rcptJobs: () => [],
        save: () => {}, touch: () => {}, render: () => {}, safeRender: () => {},
        orgAiBase: () => "http://x", orgAiHeaders: () => ({}),
        whenSynced: () => Promise.resolve("synced"),
        uploadStatus: (st, a, n) => banners.push(st),
        document: { getElementById: () => null },
        RCPT_CATS: [], CAP_RCPT_THROTTLE_MS: 0,
        fetch: () => Promise.reject(new Error("connection died"))
      });
      require("vm").runInContext(CAP, c2);

      return c2.capRcptRun({ auto: true }).then(function () {
        ok("⭐ a read that dies mid-flight still ends the drain", banners.length > 0, banners);
        ok("⭐⭐ THE BANNER DOES NOT STAY COUNTING — this is what he actually saw",
          banners[banners.length - 1] !== "reading", banners);

        /* ⭐ AND THE FLAG IS DOWN — proven by the only thing that matters: a second drain is not refused.
           Before the finally, this second call returned instantly at `if (_capRcptBusy) return`, and Cap read
           nothing for the rest of the session. A fresh receipt, because the two that already failed are in
           the session skip-list and a drain with nothing pending correctly does nothing. */
        banners = [];
        c2.rcptReview = () => [{ id: "r3", receiptId: "c.jpg", store: "review" }];
        return c2.capRcptRun({ auto: true });
      }).then(function () {
        ok("⭐⭐ Cap is NOT disabled — the second drain actually ran", banners.length > 0, banners);
        ok("...and it ended cleanly too",
          banners[banners.length - 1] === "hide" || banners[banners.length - 1] === "error", banners);

        console.log("\n--- ⏱ the banner watchdog (backstop for the next one) ---");
        ok("⭐ only the two states with no self-expiry are watched",
          /state !== "uploading" && state !== "reading"/.test(UPSC));
        ok("⭐ every call re-arms it, so a live drain never trips it", /armWatch\(state\);/.test(UPSC));
        ok("⛔ hide() cancels it (no toast after the work is done)", /function hide\(\)[\s\S]{0,160}_watchT/.test(UPSC));
        ok("⚠️ the window is wider than the longest legitimate silence (150s client deadline)",
          /WATCHDOG_MS = (\d+)/.test(UPSC) && Number(/WATCHDOG_MS = (\d+)/.exec(UPSC)[1]) > 150000,
          /WATCHDOG_MS = (\d+)/.exec(UPSC) && /WATCHDOG_MS = (\d+)/.exec(UPSC)[1]);
        ok("⛔ it says something true rather than hiding silently", /stalled/.test(UPS) && /nothing was lost/.test(UPS));

        console.log("\n--- ⭐ the slow second read re-asserts progress ---");
        ok("the escalate retry updates the banner before it starts", /uploadStatus\("reading", \{ done: done \+ 1, total: totalNow \}, "trying harder"\)/.test(CAPC));
        ok("...so a two-read receipt never looks abandoned", /indistinguishable from the hang/.test(CAP));

        console.log("\n--- ⛔ the receipt read uses the deadline helper ---");
        ok("⭐ capRcptRead goes through orgAiFetch", /typeof orgAiFetch === "function"\) \? orgAiFetch : fetch/.test(CAPC));
        ok("...and still works on a build without it", /: fetch;/.test(CAPC));

        console.log("\n--- ⭐ the SECOND bug: a statement that was too long to read, forever ---");
        {
          /* ⚠️ THIS IS WHY THE RECEIPT HAD SAT SINCE 2026-08-11. The read succeeded — a 3-page Square Checking
             statement, 24 transactions — but it overran the 1500-token cap, so the JSON never closed, the parse
             returned null, and it was filed as "unparseable" and skipped. Skipping is sticky, and the escalate
             retry made it WORSE: the smartest model writes more, so it truncated at the same wall. The cap was
             sized before the transactions[] fan-out existed, and was quietly defeating it. */
          const T = require("./sync-server.js");
          ok("⭐ the receipt budget fits a month of card activity, not just a store receipt",
            T.RCPT_VISION_MAX_TOKENS >= 6000, T.RCPT_VISION_MAX_TOKENS);
          ok("⛔ the old 1500 cap is gone from the read-receipt endpoint",
            !/}, 1500\);/.test(SRVC) && /RCPT_VISION_MAX_TOKENS\);/.test(SRVC));
          ok("⭐ truncation is detected at the source (stop_reason), not guessed from the text",
            (SRVC.match(/truncated: jj\.stop_reason === "max_tokens"/g) || []).length === 2,
            (SRVC.match(/truncated: jj\.stop_reason === "max_tokens"/g) || []).length);
          ok("⭐ and reported as ITS OWN reason — 'too long' is not 'unreadable'",
            /\(meta && meta\.truncated\) \? "too-long" : "unparseable"/.test(SRVC));
          ok("⚠️ the client counts it apart, so he isn't told to re-photograph a legible PDF",
            /res\.reason === "too-long"/.test(CAPC) && /tooLong\+\+/.test(CAPC));
          ok("...and the single-receipt reread says what to actually do about it",
            /split the file into fewer pages/.test(CAP));
          ok("⚠️ why a bigger ceiling is free is written down (billed as generated, not reserved)",
            /billed as GENERATED/.test(SRV));
        }

        console.log("\n=========  " + pass + " passed, " + fail + " failed  =========");
        if (fail) process.exit(1);
      });
    }
  })();
}
