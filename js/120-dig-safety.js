/* ---------- DIG SAFETY + MACHINE RENTAL (js/120) ---------------------------------------------
   Ray's two rules, set 2026-07-27 after the Mike Green stepping-stone path paid $14.23/hr:

     1. Any DIGGING job prices in a machine rental (mini skid steer / mini excavator).
        Hand-digging that path measured ~29 person-hours per CUBIC YARD — 2.5 of the 5 days went
        into one yard of sand. Hand-digging is never the plan again, so the rental is a hard cost
        that belongs in the quote instead of being absorbed by the crew's hours.

     2. Any DIGGING job flags an NC811 locate call before work starts, so we don't bust a pipe.

   NC UNDERGROUND DAMAGE PREVENTION ACT (NCGS Ch. 87, Art. 8A) — verified against nc811.org 2026-07-27:
     · notice = no less than 3 FULL WORKING DAYS before the work start date (weekends/holidays
       do NOT count, and the day you call doesn't count)
     · the ticket is then good for 28 CALENDAR DAYS from the work start date
     · to keep digging past that, re-notify 3 full working days before it expires — by day 25
     · locates are FREE

   Fields ride EXISTING records — no new collection, so this syncs like any other field:
     quote: q.digRentKind · q.digRentDays · q.digRentRate      (the machine that got priced in)
     job:   j.d811Ticket · j.d811CalledDate · j.d811StartDate   (the locate ticket)

   ADVISORY, never blocking. Ray asked for a flag, not a gate — this warns loudly and does NOT
   stop a clock-in (unlike the deposit gate in js/118). Every helper is typeof-guarded so the
   module is safe to load under node and during partial loads. */

/* ---- which work counts as digging ---- */
var DIG_BANDS = ["paver", "frenchdrain", "steppath", "demo"];

function digIsDigItem(it) {
  if (!it) return false;
  if (it._pickup) return false;                       // a materials run isn't digging
  var b = it.bandKey || "";
  if (!b && typeof guessBandKey === "function") b = guessBandKey(it.name || "") || "";
  return DIG_BANDS.indexOf(b) >= 0;
}
function digIsDigQuote(q) {
  return !!(q && Array.isArray(q.items) && q.items.some(digIsDigItem));
}
function digIsDigJob(job) {
  if (!job) return false;
  if (job.d811Ticket || job.d811CalledDate) return true;        // already treated as one
  var q = (typeof depQuoteFor === "function") ? depQuoteFor(job) : null;
  return digIsDigQuote(q);
}

/* ---- the machine. Day rates are DEFAULTS and editable per quote — check the actual rental desk. ---- */
var DIG_MACHINES = [
  { key: "miniskid", label: "Mini skid steer", day: 350, note: "fits a 36\" gate — the narrow-access machine" },
  { key: "miniex",   label: "Mini excavator",  day: 375, note: "best for trenching depth" },
  { key: "skid",     label: "Skid steer",      day: 425, note: "full size — needs real access" }
];
function digMachine(kind) {
  for (var i = 0; i < DIG_MACHINES.length; i++) if (DIG_MACHINES[i].key === kind) return DIG_MACHINES[i];
  return DIG_MACHINES[0];
}
function digRentDays(q) { var n = Math.round(+((q && q.digRentDays)) || 0); return n > 0 ? n : 0; }
function digRentRate(q) {
  if (q && +q.digRentRate > 0) return +q.digRentRate;
  return digMachine(q && q.digRentKind).day;
}
/* the hard cost this quote carries for the machine. 0 days = nothing priced in. */
function digRentCost(q) { return Math.round(digRentDays(q) * digRentRate(q)); }
/* a digging quote with no machine priced in is the exact mistake that cost 30 person-hours */
function digRentMissing(q) { return digIsDigQuote(q) && digRentDays(q) <= 0; }

/* ---- NC811 date math (UTC-based so it never drifts a day on a timezone boundary) ---- */
var DIG_DAY_MS = 86400000;
function digDayMs(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
}
function digDayStr(ms) {
  var d = new Date(ms);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}
function digIsWorkDay(ms) { var w = new Date(ms).getUTCDay(); return w !== 0 && w !== 6; }

/* Earliest date you may dig: the day AFTER 3 full working days have passed. The call day itself
   does not count, and weekends are skipped. NOTE: state holidays also don't count and we can't
   know them here — the UI says so, so add a day around a holiday. */
function dig811ClearDate(calledDate) {
  var ms = digDayMs(calledDate); if (isNaN(ms)) return "";
  var counted = 0;
  while (counted < 3) { ms += DIG_DAY_MS; if (digIsWorkDay(ms)) counted++; }
  return digDayStr(ms + DIG_DAY_MS);
}
/* the ticket is good 28 calendar days from the WORK START date; re-notify by day 25 */
function dig811GoodThru(startDate) { var ms = digDayMs(startDate); return isNaN(ms) ? "" : digDayStr(ms + 28 * DIG_DAY_MS); }
function dig811RenewBy(startDate) { var ms = digDayMs(startDate); return isNaN(ms) ? "" : digDayStr(ms + 25 * DIG_DAY_MS); }

/* ---- status of a job's locate ticket ----
   none    → digging job, nobody has called 811
   waiting → called, still inside the 3-working-day wait
   clear   → cleared to dig, ticket live
   renew   → still live but at/past day 25 — re-notify now
   expired → past 28 calendar days from the start date
   n/a     → not a digging job */
function dig811Status(job, todayStr) {
  var now = todayStr || (typeof today === "function" ? today() : digDayStr(Date.now()));
  if (!digIsDigJob(job)) return { state: "n/a" };
  var called = (job && job.d811CalledDate) || "";
  if (!called) return { state: "none" };
  var clear = dig811ClearDate(called);
  var start = (job && job.d811StartDate) || (job && Array.isArray(job.workDays) && job.workDays[0]) || clear;
  var goodThru = dig811GoodThru(start), renewBy = dig811RenewBy(start);
  var nowMs = digDayMs(now);
  var out = { called: called, clear: clear, start: start, goodThru: goodThru, renewBy: renewBy,
              ticket: (job && job.d811Ticket) || "" };
  if (nowMs < digDayMs(clear)) { out.state = "waiting"; return out; }
  if (nowMs > digDayMs(goodThru)) { out.state = "expired"; return out; }
  out.state = (nowMs >= digDayMs(renewBy)) ? "renew" : "clear";
  return out;
}

/* ---- UI: the flag on the job page ---- */
function dig811CardHTML(job) {
  var st = dig811Status(job);
  if (st.state === "n/a") return "";
  var esc2 = (typeof esc === "function") ? esc : function (s) { return String(s == null ? "" : s); };
  var head, body, col;
  if (st.state === "none") {
    col = "#b91c1c";
    head = "⛔ Call NC811 before digging";
    body = "This is a digging job and no locate has been called. NC law needs <b>3 full working days'</b> notice "
         + "before you break ground — weekends and state holidays don't count. It's <b>free</b>: dial <b>811</b> or file at "
         + "<b>nc811.org</b>. Then log the ticket here.";
  } else if (st.state === "waiting") {
    col = "#b45309";
    head = "⏳ NC811 called — waiting on locates";
    body = "Called <b>" + esc2(st.called) + "</b>" + (st.ticket ? " · ticket <b>" + esc2(st.ticket) + "</b>" : "")
         + ".<br>Earliest you may dig: <b>" + esc2(st.clear) + "</b>. Add a day if a state holiday falls in the window.";
  } else if (st.state === "renew") {
    col = "#b45309";
    head = "⚠️ NC811 ticket expiring";
    body = "Good through <b>" + esc2(st.goodThru) + "</b>. Re-notify now (3 full working days) if you'll still be digging.";
  } else if (st.state === "expired") {
    col = "#b91c1c";
    head = "⛔ NC811 ticket expired";
    body = "It expired <b>" + esc2(st.goodThru) + "</b> (28 calendar days from " + esc2(st.start) + "). Do not dig — re-notify first.";
  } else {
    col = "#15803d";
    head = "✅ Clear to dig";
    body = "Ticket <b>" + esc2(st.ticket || "—") + "</b> · good through <b>" + esc2(st.goodThru) + "</b>. Re-notify by <b>" + esc2(st.renewBy) + "</b> if the job runs long.";
  }
  var btn = (st.state === "none")
    ? '<button class="btn" style="margin-top:8px" onclick="dig811Log(\'' + (job && job.id) + '\')">Log the 811 ticket</button>'
    : '<button class="btn secondary" style="margin-top:8px" onclick="dig811Log(\'' + (job && job.id) + '\')">Edit ticket</button>';
  return '<div class="card" style="border-left:4px solid ' + col + '">'
       + '<div style="font-weight:800;color:' + col + '">' + head + '</div>'
       + '<div class="sub" style="white-space:normal;margin-top:4px;line-height:1.55">' + body + '</div>'
       + btn + '</div>';
}

/* log / edit the locate ticket on a job */
if (typeof window !== "undefined") window.dig811Log = function (jobId) {
  if (typeof D !== "function") return;
  var job = (D().jobs || []).find(function (j) { return j && j.id === jobId; }); if (!job) return;
  var called = prompt("Date you called NC811 (YYYY-MM-DD):", job.d811CalledDate || (typeof today === "function" ? today() : ""));
  if (called === null) return;
  called = String(called).trim();
  if (called && !/^\d{4}-\d{2}-\d{2}$/.test(called)) { alert("Use the format YYYY-MM-DD."); return; }
  var tk = prompt("NC811 ticket number (optional):", job.d811Ticket || "");
  if (tk === null) return;
  job.d811CalledDate = called || "";
  job.d811Ticket = String(tk || "").trim();
  if (called && !job.d811StartDate) {
    var wd = Array.isArray(job.workDays) && job.workDays[0] ? job.workDays[0] : "";
    var clear = dig811ClearDate(called);
    job.d811StartDate = (wd && digDayMs(wd) >= digDayMs(clear)) ? wd : clear;
  }
  if (typeof touch === "function") touch(job);
  if (typeof save === "function") save();
  if (called) {
    var st = dig811Status(job);
    alert(st.state === "waiting"
      ? "Logged. Earliest you may dig: " + st.clear + "\n\nTicket good through " + st.goodThru + "."
      : "Logged. " + (st.state === "clear" ? "Clear to dig — good through " + st.goodThru + "." : "Status: " + st.state));
  }
  if (typeof render === "function") render();
};

/* ---- UI: the flag in the quote wizard, where the rental gets priced ---- */
function digWizQuoteLike() {
  if (typeof WZ === "undefined" || !WZ || !Array.isArray(WZ.items)) return null;
  return { items: WZ.items, digRentKind: WZ.digRentKind, digRentDays: WZ.digRentDays, digRentRate: WZ.digRentRate };
}
/* the extra hard cost the wizard adds for the machine — mirrors wizExtraDaysCost() in js/23 */
function digRentCostWZ() { var q = digWizQuoteLike(); return q ? digRentCost(q) : 0; }

function digWizControlHTML() {
  var q = digWizQuoteLike(); if (!q || !digIsDigQuote(q)) return "";
  var m = digMachine(q.digRentKind), days = digRentDays(q), rate = digRentRate(q), cost = digRentCost(q);
  var mny = (typeof money === "function") ? money : function (n) { return "$" + Math.round(+n || 0); };
  var opts = DIG_MACHINES.map(function (x) {
    return '<option value="' + x.key + '"' + (x.key === m.key ? " selected" : "") + '>' + x.label + '</option>';
  }).join("");
  var warn = days <= 0
    ? '<div class="note" style="margin-top:6px;white-space:normal">🔴 <b>Digging job with no machine priced in.</b> '
      + 'Hand-digging measured <b>~29 person-hours per cubic yard</b> on the Mike Green path — 2.5 days for one yard of sand. '
      + 'Set the rental days, or this comes out of the crew\'s pay.</div>'
    : '<div class="sub" style="margin-top:6px">Machine rental <b>' + mny(cost) + '</b> — a hard cost, in the quote, not absorbed by the crew.</div>';
  return '<div class="card"><div style="font-weight:800">⛏ Digging job — machine rental</div>'
    + '<div class="row" style="gap:8px;margin-top:6px">'
    + '<div class="grow"><label style="margin-top:0">Machine</label><select onchange="digWizKind(this.value)">' + opts + '</select></div>'
    + '<div class="grow"><label style="margin-top:0">Rental days</label><input type="number" inputmode="numeric" min="0" step="1" value="' + (days || "") + '" placeholder="0" oninput="digWizDays(this.value)"></div>'
    + '<div class="grow"><label style="margin-top:0">$ / day</label><input type="number" inputmode="decimal" min="0" value="' + rate + '" oninput="digWizRate(this.value)"></div>'
    + '</div><div class="sub" style="font-size:11px">' + m.note + ' · day rate is a default — check the rental desk.</div>'
    + warn
    + '<div class="sub" style="margin-top:8px;white-space:normal;line-height:1.5">⛔ <b>NC811:</b> digging needs <b>3 full working days\'</b> notice (free — dial 811 or nc811.org). '
    + 'Ticket is good 28 calendar days from the start. Log it on the job once it\'s booked.</div></div>';
}

if (typeof window !== "undefined") {
  window.digWizKind = function (v) { if (typeof WZ === "undefined" || !WZ) return; WZ.digRentKind = v; WZ.digRentRate = digMachine(v).day; if (typeof render === "function") render(); };
  window.digWizDays = function (v) { if (typeof WZ === "undefined" || !WZ) return; WZ.digRentDays = Math.max(0, parseInt(v, 10) || 0); if (typeof wizReviewTotals === "function") wizReviewTotals(); };
  window.digWizRate = function (v) { if (typeof WZ === "undefined" || !WZ) return; WZ.digRentRate = Math.max(0, parseFloat(v) || 0); if (typeof wizReviewTotals === "function") wizReviewTotals(); };
  window.DIG_BANDS = DIG_BANDS; window.DIG_MACHINES = DIG_MACHINES;
  window.digIsDigQuote = digIsDigQuote; window.digIsDigJob = digIsDigJob;
  window.digRentCost = digRentCost; window.digRentCostWZ = digRentCostWZ; window.digRentMissing = digRentMissing;
  window.dig811Status = dig811Status; window.dig811ClearDate = dig811ClearDate;
  window.dig811GoodThru = dig811GoodThru; window.dig811RenewBy = dig811RenewBy;
  window.dig811CardHTML = dig811CardHTML; window.digWizControlHTML = digWizControlHTML;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { DIG_BANDS: DIG_BANDS, DIG_MACHINES: DIG_MACHINES, digIsDigItem: digIsDigItem, digIsDigQuote: digIsDigQuote,
    digMachine: digMachine, digRentDays: digRentDays, digRentRate: digRentRate, digRentCost: digRentCost, digRentMissing: digRentMissing,
    dig811ClearDate: dig811ClearDate, dig811GoodThru: dig811GoodThru, dig811RenewBy: dig811RenewBy, dig811Status: dig811Status,
    digDayStr: digDayStr, digIsWorkDay: digIsWorkDay };
}
