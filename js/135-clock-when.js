/* ---------- "WHEN?" — editable clock-in/out times with evidence-backed suggestions (js/135) -----------
   Ray, 2026-08-19: "when I hit clock in, it should pull up, like, a clock where I can input the time…
   default to the current time. But if I need to edit it, I should be able to edit it. And then same when I
   clock out… I should be able to edit the date as well, and it should show a recommended date and time based
   on activity. I'm probably not working overnight, right? So if I accidentally stayed clocked in overnight,
   that would be an obvious one."

   ⚠️ WHAT THE APP ACTUALLY KNOWS, because the honest answer shapes what this can offer:

   GPS pings are recorded every ~2 minutes ONLY WHILE A SHIFT IS OPEN (js/38 tcPingStart). Nothing tracks
   location before you clock in. So "GPS says you arrived on site at 9:04" is NOT something this can compute
   — the app wasn't watching. Offering it would mean inventing a number, and a made-up arrival time on a
   timesheet is worse than no suggestion at all.

   That makes the two directions genuinely asymmetric:
     CLOCK IN  — weak evidence. The job's SCHEDULED time is the only real signal, plus a tidy round-down.
     CLOCK OUT — strong evidence. A whole shift of pings, timestamped shift notes, and the existing
                 home-arrival detector all bear on when you actually stopped.

   Every suggestion carries WHY it is being offered, in plain words, so a number never appears on a timesheet
   without its reason attached.

   Pure functions (cwSuggestIn / cwSuggestOut / cwOvernight) take their inputs as arguments and touch no
   globals, so they are tested by being CALLED — see clock-when-tests.js. That is deliberate: a source-regex
   test is what let the `opts`/`args` clock-in crash reach the field on 2026-08-19. */

if (typeof window === "undefined") { var window = {}; }   // node test shim

var CW_ROUND_MIN = 15;                 // offer a tidy round-down to this many minutes
var CW_LONG_SHIFT_MS = 14 * 3600000;   // longer than this and something is wrong
var CW_MIN_GAP_MS = 60000;             // don't offer a suggestion within a minute of "now" — it isn't a choice

/* ---------- time helpers (local, so this module stands alone in tests) ---------- */
function cwPad(n) { return String(n).padStart(2, "0"); }
function cwLocalValue(ms) {                       // ms -> "YYYY-MM-DDTHH:MM" for <input type=datetime-local>
  const d = new Date(+ms || 0);
  return d.getFullYear() + "-" + cwPad(d.getMonth() + 1) + "-" + cwPad(d.getDate())
    + "T" + cwPad(d.getHours()) + ":" + cwPad(d.getMinutes());
}
function cwParse(v) { const ms = new Date(String(v || "")).getTime(); return (ms > 0) ? ms : 0; }
function cwClock(ms) {
  try { return new Date(+ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; }
}
function cwSameDay(a, b) {
  const x = new Date(+a), y = new Date(+b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}
/* "9:30" (a job's scheduled time) applied to the same calendar day as `dayMs` */
function cwTimeOnDay(hhmm, dayMs) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "")); if (!m) return 0;
  const d = new Date(+dayMs || 0);
  d.setHours(+m[1], +m[2], 0, 0);
  const ms = d.getTime();
  return (ms > 0) ? ms : 0;
}

/* ---------- OVERNIGHT / RUNAWAY SHIFT ----------
   The case Ray named: clocked in yesterday, never clocked out, and now the app would happily bill 19 hours.
   Two independent signals, because either alone has honest exceptions (a long storm-cleanup day is real; a
   late finish that crosses midnight is real). Both together is what makes it obviously wrong. */
function cwOvernight(clockIn, nowMs) {
  const dur = Math.max(0, (+nowMs || 0) - (+clockIn || 0));
  const long = dur >= CW_LONG_SHIFT_MS;
  const crossed = !cwSameDay(clockIn, nowMs);
  if (!long && !crossed) return null;
  return {
    long: long, crossedMidnight: crossed, hours: Math.round(dur / 360000) / 10,
    why: long && crossed ? "This shift started on a different day and has been running " + (Math.round(dur / 360000) / 10) + " hours."
       : long ? "This shift has been running " + (Math.round(dur / 360000) / 10) + " hours."
       : "This shift started yesterday."
  };
}

/* ---------- CLOCK-IN SUGGESTIONS ----------
   opts: { job:{time,date}, nowMs, lastShiftEnd }
   Deliberately thin. There is no arrival data, so this offers the schedule and a tidy round-down, and says
   which is which. Never returns anything in the future, and never before the previous shift ended. */
function cwSuggestIn(opts) {
  opts = opts || {};
  const now = +opts.nowMs || 0;
  const out = [];
  const floor = +opts.lastShiftEnd || 0;   // can't have started before you finished the last one
  const push = (ts, label, why) => {
    if (!(ts > 0) || ts > now || (now - ts) < CW_MIN_GAP_MS) return;
    if (floor && ts < floor) return;
    if (out.some(s => Math.abs(s.ts - ts) < 60000)) return;   // dedupe near-identical offers
    out.push({ ts: ts, label: label, why: why });
  };

  const job = opts.job;
  if (job && job.time) {
    const sched = cwTimeOnDay(job.time, now);
    push(sched, "Scheduled start · " + cwClock(sched), "This job was scheduled to start then.");
  }
  /* tidy round-down: 10:07 -> 10:00. Not evidence, just convenience, and labelled as such. */
  const d = new Date(now);
  const rem = d.getMinutes() % CW_ROUND_MIN;
  if (rem || d.getSeconds() > 0) {
    d.setMinutes(d.getMinutes() - rem, 0, 0);
    push(d.getTime(), "Round down · " + cwClock(d.getTime()), "Tidier than the exact minute — not based on any data.");
  }
  return out;
}

/* ---------- CLOCK-OUT SUGGESTIONS ----------
   entry: the open timeclock record. opts: { nowMs, home, homeArrival, notes:[{ts}] }
   Ranked strongest-evidence-first. Each says plainly where the number came from. */
function cwSuggestOut(entry, opts) {
  entry = entry || {}; opts = opts || {};
  const now = +opts.nowMs || 0;
  const start = +entry.clockIn || 0;
  const out = [];
  const push = (ts, label, why, rank) => {
    if (!(ts > 0) || ts <= start || ts > now || (now - ts) < CW_MIN_GAP_MS) return;
    if (out.some(s => Math.abs(s.ts - ts) < 60000)) return;
    out.push({ ts: ts, label: label, why: why, rank: rank });
  };

  /* 1. got home — the strongest forgot-to-clock-out signal, computed by js/38 tcHomeArrival */
  if (opts.homeArrival) {
    push(+opts.homeArrival, "Got home · " + cwClock(opts.homeArrival),
      "Your phone was back home by then — this is usually the real end of the day.", 1);
  }

  /* 2. last timestamped shift note — you were provably still working when you wrote it */
  const notes = (opts.notes || []).map(n => +(n && n.ts) || 0).filter(t => t > 0).sort((a, b) => b - a);
  if (notes.length) {
    push(notes[0], "Last note · " + cwClock(notes[0]),
      "The last thing you logged on this shift — you were definitely still working.", 2);
  }

  /* 3. last GPS ping. Pings stop when the app is closed, so a stale last ping is a good proxy for
        "put the phone away and went home". */
  const pings = (entry.pings || []).map(p => +(p && p.ts) || 0).filter(t => t > 0).sort((a, b) => b - a);
  if (pings.length) {
    push(pings[0], "Last GPS fix · " + cwClock(pings[0]),
      "The last time your phone reported a location on this shift.", 3);
  }
  out.sort((a, b) => a.rank - b.rank);
  return out;
}

/* ---------- THE CONTROL ----------
   One datetime-local (covers Ray's "edit the date as well" on clock-out) plus suggestion chips. Defaults to
   now; chips only appear when there is something real to offer. */
function cwWhenHTML(id, ms, suggestions, opts) {
  opts = opts || {};
  const chips = (suggestions || []).map((s, i) =>
    '<button type="button" class="btn ghost sm" style="flex:0 0 auto" onclick="cwSet(\'' + id + '\',' + s.ts + ')" title="' + (typeof esc === "function" ? esc(s.why) : s.why) + '">'
    + (typeof esc === "function" ? esc(s.label) : s.label) + '</button>').join("");
  return '<label style="margin-top:10px">' + (opts.label || "Time") + '</label>'
    + '<input id="' + id + '" type="datetime-local" value="' + cwLocalValue(ms) + '">'
    + (chips ? '<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">' + chips + '</div>' : '')
    + (suggestions && suggestions.length
        ? '<div class="sub" id="' + id + '_why" style="white-space:normal;margin-top:5px">' + (typeof esc === "function" ? esc(suggestions[0].why) : suggestions[0].why) + '</div>'
        : '')
    + (opts.hint ? '<div class="sub" style="white-space:normal;margin-top:4px">' + (typeof esc === "function" ? esc(opts.hint) : opts.hint) + '</div>' : '');
}

if (typeof window !== "undefined") {
  window.cwSet = function (id, ts) {
    const el = document.getElementById(id); if (!el) return;
    el.value = cwLocalValue(ts);
    /* mark it edited so the live "now" ticker stops overwriting the choice */
    el.setAttribute("data-touched", "1");
  };
  window.cwRead = function (id, fallbackMs) {
    const el = document.getElementById(id);
    const ms = el ? cwParse(el.value) : 0;
    return ms || (+fallbackMs || 0);
  };
  window.cwSuggestIn = cwSuggestIn;
  window.cwSuggestOut = cwSuggestOut;
  window.cwOvernight = cwOvernight;
  window.cwWhenHTML = cwWhenHTML;
  window.cwLocalValue = cwLocalValue;
  window.cwClock = cwClock;

  /* keep an untouched clock-in field showing the real current time — otherwise a form opened at 9:00 and
     submitted at 9:20 would silently log 9:00. Stops the moment the field is edited or a chip is used. */
  window.cwTick = function (id) {
    const el = document.getElementById(id);
    if (!el || el.getAttribute("data-touched")) return;
    if (document.activeElement === el) { el.setAttribute("data-touched", "1"); return; }
    el.value = cwLocalValue(Date.now());
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { cwSuggestIn: cwSuggestIn, cwSuggestOut: cwSuggestOut, cwOvernight: cwOvernight,
                     cwLocalValue: cwLocalValue, cwParse: cwParse, cwTimeOnDay: cwTimeOnDay, cwClock: cwClock,
                     CW_LONG_SHIFT_MS: CW_LONG_SHIFT_MS };
}
