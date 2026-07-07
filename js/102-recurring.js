/* ---------- RECURRING SERVICE — Phase 1: the PURE generation engine (NO UI) ----------
   j-Suite's recurring-contract engine. A `recurringPlans` record (synced collection, see js/02 blank()/load()
   + sync-server COLLECTIONS) is a standing agreement to do a job on a cadence (weekly house-watch, bi-weekly
   soft-wash, seasonal landscaping, …). This module rolls each active plan forward and MATERIALIZES the JOB
   instances that fall inside a rolling 28-day horizon.

   PHASE 1 = data-layer + engine ONLY. autoQuote is OFF: an occurrence creates a normal d.jobs record and nothing
   else (no quote, no invoice, no money) → finance stays byte-identical. There is NO create UI yet, so the live
   `recurringPlans` array is EMPTY and recurMaterialize() is a proven no-op on real data. Phases 2 (UI/lifecycle)
   and 3 (quote-per-occurrence + MRR) build on top of the pure functions exported here.

   plan shape (Phase 2 will author these): {
     id:"rp_…", customerId, propertyId, address, title, serviceId, price, discountPct(20),
     frequency:"weekly"|"biweekly"|"monthly"|"quarterly"|"seasonal"|"custom",
     interval, weekday(0-6), dayOfMonth(1-31), monthlyMode:"date"|"nthWeekday", nthWeek(1-5),
     seasonStart"MM-DD", seasonEnd"MM-DD", visits, intervalDays, time, crew[], estDays,
     startDate"YYYY-MM-DD", endMode:"endless"|"date"|"count", endDate, count,
     status:"active"|"paused"|"ended", nextDue, lastGeneratedDate, generatedCount, generatedJobIds[], autoQuote, notes }

   generated job carries: job.planId (back-link) + job.occurrenceDate. DETERMINISTIC ids
   (jobId = "recjob_"+plan.id+"_"+occDate) → two devices generating the same occurrence converge to ONE record
   under per-record LWW, and a deleted/tombstoned occurrence is never regenerated (its id still exists).

   Every function is PURE-ish, offline, and NEVER throws (each is try/caught) — a recurring bug must never blank
   the app or corrupt data. Dual export: window.* for the app, module.exports for node tests. */

/* ================= date helpers — local + month-overflow / DOM-clamp safe (parallel to js/79's, but robust) === */
function recurAddDays(ds, n) {
  var d = new Date(ds + "T12:00:00"); d.setDate(d.getDate() + (n || 0));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
/* a valid YYYY-MM-DD for (year, month0, day) with month overflow normalized and day clamped to the month length */
function recurOnDay(year, month0, day) {
  var base = new Date(year, month0, 1);                 // JS normalizes month overflow (month0=12 → Jan next year)
  var y = base.getFullYear(), mo = base.getMonth();
  var dim = new Date(y, mo + 1, 0).getDate();
  var dd = Math.min(Math.max(1, day || 1), dim);
  return y + "-" + String(mo + 1).padStart(2, "0") + "-" + String(dd).padStart(2, "0");
}
/* the nth (1-5) `weekday` (0=Sun..6=Sat) of a month; if that nth doesn't exist, clamp to the LAST occurrence */
function recurNthWeekday(year, month0, weekday, nth) {
  var base = new Date(year, month0, 1); var y = base.getFullYear(), mo = base.getMonth();
  var first = new Date(y, mo, 1).getDay();
  weekday = (((+weekday || 0) % 7) + 7) % 7;
  var offset = (weekday - first + 7) % 7;               // 0-based day-of-month of the first `weekday`
  var day = 1 + offset + (Math.max(1, +nth || 1) - 1) * 7;
  var dim = new Date(y, mo + 1, 0).getDate();
  if (day > dim) day -= 7;                              // nth week overflows the month → last occurrence
  return y + "-" + String(mo + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

/* ================= season helpers ================= */
/* is `date` (YYYY-MM-DD) inside the plan's [seasonStart, seasonEnd] MM-DD window? (non-seasonal = always true) */
function recurInSeason(plan, date) {
  try {
    if (!plan || plan.frequency !== "seasonal") return true;
    var md = String(date).slice(5);                     // "MM-DD"
    var s = plan.seasonStart || "01-01", e = plan.seasonEnd || "12-31";
    if (s <= e) return md >= s && md <= e;
    return md >= s || md <= e;                           // year-wrapping season (e.g. 11-01 .. 02-28)
  } catch (e) { return true; }
}
/* the season-start date on/after fromDate (this year, else next) */
function recurNextSeasonStart(plan, fromDate) {
  try {
    var s = (plan && plan.seasonStart) || "01-01";
    var y = +String(fromDate).slice(0, 4);
    var cand = y + "-" + s;
    return (cand >= fromDate) ? cand : (y + 1) + "-" + s;
  } catch (e) { return fromDate; }
}

/* ================= frequency math ================= */
/* next monthly occurrence strictly after `cursor` */
function recurMonthlyNext(plan, cursor) {
  var r = new Date(cursor + "T12:00:00");
  if (plan.monthlyMode === "nthWeekday") return recurNthWeekday(r.getFullYear(), r.getMonth() + 1, +plan.weekday || 0, +plan.nthWeek || 1);
  var day = Math.min(28, Math.max(1, +plan.dayOfMonth || 1));   // clamp 1-28 so every month has the day
  return recurOnDay(r.getFullYear(), r.getMonth() + 1, day);
}
/* advance N months from cursor keeping the plan's anchor day-of-month (clamped 1-28) */
function recurMonthsNext(plan, cursor, n) {
  var r = new Date(cursor + "T12:00:00");
  var anchor = +plan.dayOfMonth || (plan.startDate ? +String(plan.startDate).slice(8, 10) : r.getDate()) || 1;
  anchor = Math.min(28, Math.max(1, anchor));
  return recurOnDay(r.getFullYear(), r.getMonth() + n, anchor);
}
/* the next occurrence STRICTLY AFTER `cursor`, per the plan's frequency. Pure, never throws. */
function recurAdvance(plan, cursor) {
  try {
    var f = (plan && plan.frequency) || "weekly";
    if (f === "weekly") return recurAddDays(cursor, 7);
    if (f === "biweekly") return recurAddDays(cursor, 14);
    if (f === "monthly") return recurMonthlyNext(plan, cursor);
    if (f === "quarterly") return recurMonthsNext(plan, cursor, 3);
    if (f === "seasonal") {
      var nx = recurAddDays(cursor, 7 * (+plan.interval || 1));   // sub-cadence within a season (default weekly)
      if (!recurInSeason(plan, nx)) nx = recurNextSeasonStart(plan, nx);   // ran past season end → jump to next season
      return nx;
    }
    if (f === "custom") return recurAddDays(cursor, plan.intervalDays ? (+plan.intervalDays) : 7 * (+plan.interval || 1));
    return recurAddDays(cursor, 7);
  } catch (e) { return recurAddDays(cursor, 7); }
}
/* the schedule's first natural occurrence on/after `start` (anchored on startDate for regular cadences) */
function recurSeed(plan, start) {
  try {
    var f = (plan && plan.frequency) || "weekly";
    var r = new Date(start + "T12:00:00");
    if (f === "monthly") {
      if (plan.monthlyMode === "nthWeekday") {
        var c = recurNthWeekday(r.getFullYear(), r.getMonth(), +plan.weekday || 0, +plan.nthWeek || 1);
        return c >= start ? c : recurNthWeekday(r.getFullYear(), r.getMonth() + 1, +plan.weekday || 0, +plan.nthWeek || 1);
      }
      var day = Math.min(28, Math.max(1, +plan.dayOfMonth || 1));
      var c2 = recurOnDay(r.getFullYear(), r.getMonth(), day);
      return c2 >= start ? c2 : recurOnDay(r.getFullYear(), r.getMonth() + 1, day);
    }
    if (f === "quarterly") {
      var ad = Math.min(28, Math.max(1, +plan.dayOfMonth || r.getDate()));
      var c3 = recurOnDay(r.getFullYear(), r.getMonth(), ad);
      return c3 >= start ? c3 : recurMonthsNext(plan, c3, 3);
    }
    if (f === "seasonal") return recurInSeason(plan, start) ? start : recurNextSeasonStart(plan, start);
    return start;                                        // weekly / biweekly / custom anchor directly on startDate
  } catch (e) { return start; }
}
/* the first occurrence on/after fromDate, walking the schedule from startDate (keeps biweekly/monthly parity) */
function recurFirstOccurrence(plan, fromDate) {
  try {
    var start = (plan && plan.startDate) || fromDate;
    var from = (fromDate > start) ? fromDate : start;   // YYYY-MM-DD lexical compare == chronological
    var cursor = recurSeed(plan, start);
    var guard = 0;
    while (cursor < from && guard++ < 4000) {
      var nx = recurAdvance(plan, cursor);
      if (!nx || nx <= cursor) break;
      cursor = nx;
    }
    if (plan && plan.frequency === "seasonal" && !recurInSeason(plan, cursor)) cursor = recurNextSeasonStart(plan, cursor);
    return cursor;
  } catch (e) { return (plan && plan.startDate) || fromDate; }
}
/* has the plan reached its end (by date, by count, or endless)? count = total occurrences generated so far. */
function recurEndReached(plan, date, count) {
  try {
    if (!plan) return false;
    if (plan.endMode === "date") return !!plan.endDate && date > plan.endDate;
    if (plan.endMode === "count") return (count || 0) >= (+plan.count || 0);
    return false;                                        // endless
  } catch (e) { return false; }
}

/* ================= MRR helper (Phase 3 reuse — exported now, unused by UI this phase) ================= */
/* the plan's contribution to ONE month's recurring revenue: price × per-month frequency × (1 − discount) */
function recurMonthlyEquiv(plan) {
  try {
    if (!plan) return 0;
    var f = plan.frequency || "weekly", per;
    if (f === "weekly") per = 52 / 12;                   // ≈ 4.333
    else if (f === "biweekly") per = 26 / 12;            // ≈ 2.167
    else if (f === "monthly") per = 1;
    else if (f === "quarterly") per = 1 / 3;             // ≈ 0.333
    else if (f === "seasonal") per = (+plan.visits || 0) / 12;   // total visits/season ÷ 12
    else if (f === "custom") { var days = plan.intervalDays ? (+plan.intervalDays) : 7 * (+plan.interval || 1); per = days > 0 ? 30 / days : 0; }
    else per = 1;
    var price = +plan.price || 0;
    var disc = 1 - ((+plan.discountPct || 0) / 100);
    return Math.round(price * per * disc * 100) / 100;
  } catch (e) { return 0; }
}

/* ================= materializer ================= */
/* Build ONE job for (plan, occDate) with a DETERMINISTIC id. Idempotent: if the job id already exists (incl. a
   tombstoned/deleted one) OR the id is already in plan.generatedJobIds → return false (no dupe, deleted stays
   deleted). Returns true iff a new job was pushed. Phase 1: JOB ONLY (autoQuote is a Phase-3 addition). */
function recurMakeOccurrence(plan, occDate) {
  try {
    var d = (typeof D === "function") ? D() : null;
    if (!d || !Array.isArray(d.jobs)) return false;
    var jobId = "recjob_" + plan.id + "_" + occDate;
    if (d.jobs.find(function (j) { return j && j.id === jobId; })) return false;        // exists (incl. tombstone) → dedupe
    if ((plan.generatedJobIds || []).indexOf(jobId) >= 0) return false;                 // already logged on the plan → dedupe
    var job = {
      id: jobId, done: false,
      customerId: plan.customerId || "", propertyId: plan.propertyId || "",
      address: plan.address || "",
      title: plan.title || "Recurring service",
      crew: Array.isArray(plan.crew) ? plan.crew.slice() : [],
      date: occDate, time: plan.time || "",
      occurrenceDate: occDate, planId: plan.id,
      updatedAt: (typeof now === "function") ? now() : Date.now()
    };
    // multi-day span from estDays (default single day) — mirrors the job.workDays convention (js/09)
    var days = Math.max(1, Math.round(+plan.estDays || 1));
    var wd = [occDate]; for (var i = 1; i < days; i++) wd.push(recurAddDays(occDate, i)); job.workDays = wd;
    if (typeof jobEnsurePO === "function") jobEnsurePO(job);
    if (typeof touch === "function") touch(job);
    d.jobs.push(job);
    plan.generatedJobIds = (plan.generatedJobIds || []).concat([jobId]);
    return true;
  } catch (e) { return false; }
}

/* The rolling generator. Runs after a sync pull (js/26), guarded once/day (S.recurLastRun). For every ACTIVE,
   non-deleted plan in the active org, roll a cursor from nextDue (or the first occurrence) up to today+28d,
   materializing each in-season occurrence (idempotent), advancing by frequency, and rolling nextDue forward.
   NEVER throws. Saves once at the end iff anything changed. NO-OP when recurringPlans is empty (Phase 1).
   Returns true iff any record changed (so the caller can re-render). */
function recurMaterialize() {
  var changed = false;
  try {
    if (typeof D !== "function" || typeof S === "undefined" || !S) return false;
    var t = (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10);
    if (S.recurLastRun === t) return false;             // already ran today → skip
    var d = D();
    if (!d || !Array.isArray(d.recurringPlans) || !d.recurringPlans.length) { S.recurLastRun = t; return false; }  // no-op on empty
    var horizon = recurAddDays(t, 28);
    d.recurringPlans.forEach(function (plan) {
      if (!plan || plan.deleted || plan.status !== "active") return;
      try {
        var planChanged = false;
        var seedFrom = (plan.startDate && plan.startDate > t) ? plan.startDate : t;
        var cursor = plan.nextDue || recurFirstOccurrence(plan, seedFrom);
        var lastMade = plan.lastGeneratedDate || null;
        var g = 0;
        while (cursor <= horizon && g++ < 24) {
          if (recurEndReached(plan, cursor, (plan.generatedJobIds || []).length)) { plan.status = "ended"; planChanged = true; break; }
          if (recurInSeason(plan, cursor)) { if (recurMakeOccurrence(plan, cursor)) { lastMade = cursor; planChanged = true; } }
          var nx = recurAdvance(plan, cursor);
          if (!nx || nx <= cursor) break;               // safety: never loop on a non-advancing cursor
          cursor = nx;
        }
        if (plan.nextDue !== cursor) { plan.nextDue = cursor; planChanged = true; }
        if (lastMade && plan.lastGeneratedDate !== lastMade) { plan.lastGeneratedDate = lastMade; planChanged = true; }
        var gc = (plan.generatedJobIds || []).length;
        if (plan.generatedCount !== gc) { plan.generatedCount = gc; planChanged = true; }
        if (planChanged) { if (typeof touch === "function") touch(plan); changed = true; }
      } catch (e) { /* one bad plan never blocks the others or blanks the app */ }
    });
    S.recurLastRun = t;
    if (changed && typeof save === "function") save();
  } catch (e) { /* advisory — never throw/blank */ }
  return changed;
}

/* ================= exports (app + node tests) ================= */
if (typeof window !== "undefined") {
  window.recurAddDays = recurAddDays; window.recurOnDay = recurOnDay; window.recurNthWeekday = recurNthWeekday;
  window.recurInSeason = recurInSeason; window.recurNextSeasonStart = recurNextSeasonStart;
  window.recurAdvance = recurAdvance; window.recurSeed = recurSeed; window.recurFirstOccurrence = recurFirstOccurrence;
  window.recurEndReached = recurEndReached; window.recurMonthlyEquiv = recurMonthlyEquiv;
  window.recurMakeOccurrence = recurMakeOccurrence; window.recurMaterialize = recurMaterialize;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    recurAddDays: recurAddDays, recurOnDay: recurOnDay, recurNthWeekday: recurNthWeekday,
    recurInSeason: recurInSeason, recurNextSeasonStart: recurNextSeasonStart,
    recurAdvance: recurAdvance, recurSeed: recurSeed, recurFirstOccurrence: recurFirstOccurrence,
    recurEndReached: recurEndReached, recurMonthlyEquiv: recurMonthlyEquiv,
    recurMakeOccurrence: recurMakeOccurrence, recurMaterialize: recurMaterialize
  };
}
