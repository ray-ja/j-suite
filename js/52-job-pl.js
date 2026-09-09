/* ---------- PER-JOB P&L (Cap #3) — Finance › 💹 P&L (owner/admin) ----------
   Revenue (linked quote total) − hard costs (job.expenses[], NO labor line) = gross profit + margin%.
   Reuses the js/39 operating-agreement split engine for crew take-home; flags any job under the 35%
   margin floor; weekly window, WORST-MARGIN-FIRST so Ray acts on the bleakers. Read-only over
   existing data — no new collection. */

let PL_WEEK = null;   // null = current week; otherwise a Monday "YYYY-MM-DD"
let PL_OH_OPEN = false;   // expand/collapse the "general business overhead" stop list on the P&L header
window.plOhToggle = function () { PL_OH_OPEN = !PL_OH_OPEN; render(); };
function plCanView() { return (typeof finCanView === "function") ? finCanView() : true; }
function plMoney(n) { n = Math.round((+n || 0) * 100) / 100; return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function plPct(x) { return Math.round((x || 0) * 100) + "%"; }
function plFloor() { return (typeof MARGIN_FLOOR !== "undefined") ? MARGIN_FLOOR : 0.35; }
function plYmd(dt) { return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0"); }
function plAddDays(ds, n) { const dt = new Date(ds + "T00:00:00"); dt.setDate(dt.getDate() + n); return plYmd(dt); }
function plWeekStart(ds) { const dt = new Date(ds + "T00:00:00"); const off = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - off); return plYmd(dt); }  // Monday
function plWeek() { return PL_WEEK || plWeekStart(today()); }
window.plWeekShift = function (n) { PL_WEEK = plAddDays(plWeek(), n * 7); render(); };

function plQuoteFor(j) {
  const d = D();
  if (j.quoteId) { const q = (d.quotes || []).find(x => x.id === j.quoteId && !x.deleted); if (q) return q; }
  return (d.quotes || []).find(q => q && !q.deleted && q.jobId === j.id) || null;
}
/* JOB LINE-ITEM COLLECTIONS — job.materials[] / job.expenses[] were promoted OUT of the job record into the
   id-keyed jobMaterials / jobExpenses collections, so two devices editing the SAME job's money lines merge
   element-wise (per-element LWW) instead of clobbering via whole-record LWW. plExpenses/plMaterials are the ONLY
   read choke point: they return a job's live rows as the UNION of the collection and any RESIDUAL nested array
   (a not-yet-migrated record, or one an old cached client re-pushed), deduped by id (newer updatedAt wins), so
   reads stay correct all through the transition. Callers still filter !deleted. NEVER mutate the returned array —
   it's a fresh copy; every write goes through jobLIAdd / jobLIFind (+ touch). */
function _jobLIColl(which) { return (typeof D === "function" && Array.isArray(D()[which])) ? D()[which] : []; }
function _jobLI(j, coll, nestedKey) {
  if (!j || j.id == null) return [];
  var out = new Map();
  _jobLIColl(coll).forEach(function (r) { if (r && r.jobId === j.id && r.id != null) out.set(r.id, r); });
  (Array.isArray(j[nestedKey]) ? j[nestedKey] : []).forEach(function (r) {
    if (!r) return; var id = r.id;
    if (id == null) { out.set("_n" + out.size, r); return; }                       // id-less legacy row → keep verbatim
    if (!out.has(id) || (+r.updatedAt || 0) > (+(out.get(id).updatedAt) || 0)) out.set(id, r);
  });
  return Array.from(out.values());
}
function plExpenses(j) { return _jobLI(j, "jobExpenses", "expenses"); }
function plMaterials(j) { return _jobLI(j, "jobMaterials", "materials"); }   // pass-through materials (billed at cost) — a cost in the P&L since the quote price includes them
/* the existing "jobmat"/"jobexp" store labels (js/72, js/87) → the collection key */
function jobLICollKey(store) { return store === "jobmat" ? "jobMaterials" : "jobExpenses"; }
/* ADD a line item to a job's collection. Stamps id/jobId/updatedAt/deleted. Caller still save()s. Returns the row. */
function jobLIAdd(store, jobId, rec) {
  var key = jobLICollKey(store), d = (typeof D === "function") ? D() : null; if (!d) return rec;
  if (!Array.isArray(d[key])) d[key] = [];
  var r = rec || {};                                   // stamp IN PLACE (preserve caller's object identity, like the review/biz pushes)
  if (r.id == null) r.id = (typeof uid === "function" ? uid() : (key + "_" + d[key].length));
  r.jobId = jobId; if (r.deleted == null) r.deleted = false;
  if (typeof touch === "function") touch(r); else r.updatedAt = (typeof now === "function" ? now() : 1);
  d[key].push(r); return r;
}
/* FIND a job's line item by id across the collection AND any residual nested array (for edit/tombstone). */
function jobLIFind(job, store, id) {
  if (!job) return null;
  var key = jobLICollKey(store);
  var r = _jobLIColl(key).find(function (x) { return x && x.jobId === job.id && x.id === id; });
  if (r) return r;
  var nested = store === "jobmat" ? job.materials : job.expenses;
  return Array.isArray(nested) ? (nested.find(function (x) { return x && x.id === id; }) || null) : null;
}
if (typeof window !== "undefined") { window.plExpenses = plExpenses; window.plMaterials = plMaterials; window.jobLIAdd = jobLIAdd; window.jobLIFind = jobLIFind; window.jobLICollKey = jobLICollKey; }
/* confirmed mileage cost attributed to this job (timeclock miles × IRS rate) */
/* ⭐ MANUAL MILES WIN. Ray, 2026-09-01: "I want to make the mileage 163 miles — I don't see an easy way."
   There wasn't one: this only summed CONFIRMED odometer clock entries, and the timeclock "doesn't really
   work yet" (his words, same day), so the line read $0 forever. j.manualMiles is the owner's total actual
   job miles (all trips), typed on the Money tab; when set it IS the mileage cost. ⚠️ Per-person mileage
   REIMBURSEMENT (jobMileageByPerson, js/72) stays clock-based — the override prices the job, it doesn't
   guess whose truck earned what. */
function jobMileageCost(j) { const rate = (typeof FIN !== "undefined" ? FIN.MILEAGE_RATE : 0.725);
  if (+j.manualMiles > 0) return Math.round(+j.manualMiles * rate * 100) / 100;
  return (D().timeclock || []).filter(e => e && !e.deleted && e.jobId === j.id && e.clockOut && e.milesConfirmed).reduce((s, e) => s + (+e.miles || 0) * rate, 0); }
/* sub-jobs / STOPS (e.g. a dump run filed under a bigger job, or split across several) — their costs + hours
   roll up into every job they're linked to, EVENLY SPLIT across however many. Membership match (not equality)
   so a stop can be linked to 0/1/N jobs: job.sharedJobIds[] generalizes the old scalar job.parentJobId. */
function subJobsOf(jobId) { return jobId ? (typeof actJ === "function" ? actJ() : []).filter(x => x && Array.isArray(x.sharedJobIds) && x.sharedJobIds.indexOf(jobId) >= 0) : []; }
/* how many ways a stop-job's cost splits — never divide by zero (0-linked stops don't roll up into anything anyway) */
function stopSplitN(sj) { return Math.max(1, (sj && Array.isArray(sj.sharedJobIds)) ? sj.sharedJobIds.length : 1); }
function stopEmoji(kind) { return kind === "dump" ? "🚛" : kind === "pickup" ? "📦" : "🔀"; }
/* ⭐⭐ THE ONE MILEAGE CASCADE ────────────────────────────────────────────────────────────────────────────
   Ray, 2026-09-09: "mileage should just cascade based on available info. odometer is 1st truth, then
   calculated mileage based on home to job to soundside recycling to home."

   ⚠️ WHY THIS EXISTS. There were THREE mileage functions with THREE different orders, and the money path
   used the narrowest one — jobMileageCost, which stops at the odometer and returns 0. So a job nobody
   clocked miles on carried NO vehicle cost at all: it wasn't netted off the split base, the crew divided
   the truck money, and the Business Fund bought the fuel back. The route was never missing — js/61
   jobRecalcRouteMiles already drives OSRM over `home base → planned stops (the transfer station is one of
   them) → job site → home base` and parks real road miles on j.estRouteMiles. Nothing read it for costing.

   ⛔ ODOMETER OUTRANKS THE MAP, per Ray. That REVERSES the old jobMilesCostEst order, which put
   manualRouteMiles above the odometer. The reasoning behind the old order still holds — the owner types a
   manual route BECAUSE the automatic tools were wrong — because a broken or unclocked odometer reads 0 and
   falls straight through to it. A REAL odometer reading now wins, which is what he asked for.

   Returns {miles, cost, source} — the source so the UI can say where a number came from instead of
   presenting a guess and a measurement as the same thing. */
function jobMilesBilled(j) {
  const rate = (typeof FIN !== "undefined" ? FIN.MILEAGE_RATE : 0.725);
  const out = (miles, source) => ({ miles: miles, cost: Math.round(miles * rate * 100) / 100, source: source });
  if (!j) return out(0, "none");
  /* a multi-day job drives the route once PER work day; an odometer already counts every trip it made */
  const wd = (typeof jobWorkDays === "function") ? Math.max(1, jobWorkDays(j).length) : 1;
  const q = (typeof plQuoteFor === "function") ? plQuoteFor(j) : null;
  const days = Math.max(wd, (q && +q.estDays > 0) ? +q.estDays : 1);

  // 1) ODOMETER — the owner's stated actual total for the job, typed on the Money tab
  if (+j.manualMiles > 0) return out(+j.manualMiles, "odometer");
  // 2) ODOMETER — confirmed time-clock readings, summed across every day
  const tc = jobMileageCost(j); if (tc > 0) return out(tc / rate, "odometer");
  // 3) CALCULATED — the owner's own round-trip figure, when the map couldn't answer
  if (+j.manualRouteMiles > 0) return out((+j.manualRouteMiles) * days, "manual route");
  // 4) CALCULATED — real OSRM road miles: base → stops (incl. the transfer station) → site → base
  if (+j.estRouteMiles > 0) return out((+j.estRouteMiles) * days, "route");
  // 5) LEGACY — driveMiles, kept so old jobs don't silently lose their mileage
  if (+j.driveMiles > 0) return out(+j.driveMiles, "legacy");
  return out(0, "none");
}
/* one job's mileage cost — the full cascade (was: odometer, else the legacy driveMiles estimate) */
function jobMilesCost(j) { return jobMilesBilled(j).cost; }
/* mileage for a job's TOTAL-COST DISPLAY. Same cascade, so what the Jobs table shows, what the P&L costs,
   and what the payout split nets off the top are all provably the same number. */
function jobMilesCostEst(j) { return jobMilesBilled(j).cost; }
/* ── 3-WAY EXPENSE CATEGORIZATION ─────────────────────────────────────────────────────────────
   A job.expenses[] item tagged as a reusable TOOL/equipment is BUSINESS overhead (capital), NOT this
   job's cost — it must not dent the job's profit. expenseIsTool() is the tunable predicate (a small set,
   currently just the "tools/equipment" receipt category). Records NEVER move between collections — the
   tool stays in job.expenses[] and is only EXCLUDED from the cost at display time (fingerprint-safe;
   the raw Σ job.expenses the fingerprints recompute is category-agnostic, so it stays byte-identical). */
function expenseIsTool(e) { return !!(e && e.category === "tools/equipment"); }
// STANDARD-MILEAGE method (Ray's choice): the $0.725/mi rate already covers fuel, so a fuel receipt is NEVER a
// separate job cost — the job carries full mileage (jobMileageCost) as its whole vehicle cost. Excluding fuel here
// removes the fuel-AND-mileage double-count in per-job profit/cost. (Fuel stays a real record + cash outflow.)
function expenseIsFuel(e) { return !!(e && (e.category === "fuel" || e.category === "fuel/mileage")); }
/* HOLD-OUT (js/96 depositHeld): an unsettled rental deposit + its linked refunds are HELD OUT of job cost (Ray's
   model — the true NET only, never an inflated cost) exactly like a tool is, until the owner SETTLES it at net.
   Guarded so js/52 still works when js/96 isn't loaded (node unit context) → nothing held → today's behavior. */
function plDepHeld(e) { return typeof depositHeld === "function" && depositHeld(e); }
/* the four display buckets for a job's costs (Phase 0 — pure, no P&L change): mileage (jobMilesCostEst,
   estimate-or-confirmed), jobExp (Σ non-tool job.expenses), materials (Σ pass-through), tool (Σ tool-category
   job.expenses — overhead, shown separately, never in the job's own cost). Non-deleted only. */
function jobCostBreakdown(j) {
  if (!j) return { mileage: 0, jobExp: 0, materials: 0, tool: 0 };
  const live = plExpenses(j).filter(x => x && !x.deleted && !plDepHeld(x));   // held deposits contribute $0 to every bucket
  const jobExp = live.filter(e => !expenseIsTool(e) && !expenseIsFuel(e)).reduce((s, e) => s + (+e.amount || 0), 0);
  const tool = live.filter(expenseIsTool).reduce((s, e) => s + (+e.amount || 0), 0);
  const materials = plMaterials(j).filter(x => x && !x.deleted && !plDepHeld(x)).reduce((s, e) => s + (+e.amount || 0), 0);
  const mileage = (typeof jobMilesCostEst === "function") ? jobMilesCostEst(j) : 0;
  return { mileage: mileage, jobExp: jobExp, materials: materials, tool: tool };
}
/* PASS-THROUGH MATERIALS billed on the job this income entry is for (cents). These are billed to the customer at
   cost and go 100% back to whoever paid (business account, or the person reimbursed) — they are NOT revenue to
   split. finJobSplit nets this off the top so only the labor VALUE runs through 25/15/60. Mirrors jobProfit's
   matCost (job.materials + each linked stop-job's share, held deposits excluded). 0 when there's no live job. */
function finPassThroughForJob(jobId) {
  if (!jobId || typeof D !== "function") return 0;
  var j = (D().jobs || []).find(function (x) { return x && x.id === jobId && !x.deleted; });
  if (!j) return 0;
  var held = (typeof plDepHeld === "function") ? plDepHeld : function () { return false; };
  var matOf = function (job) {
    var arr = (typeof plMaterials === "function") ? plMaterials(job) : ((job && job.materials) || []);
    return arr.filter(function (x) { return x && !x.deleted && !held(x); }).reduce(function (s, e) { return s + (+e.amount || 0); }, 0);
  };
  var mat = matOf(j);
  if (typeof subJobsOf === "function") subJobsOf(j.id).forEach(function (sj) { var n = (typeof stopSplitN === "function") ? stopSplitN(sj) : 1; mat += matOf(sj) / (n || 1); });
  return Math.round(mat * 100);
}
// Sums across ALL backing jobs — one for a normal quote-paid income (income.jobId), or several for a Square invoice
// that reconciles multiple quotes (income.jobIds). Cents.
function finPassThroughForIncome(income) {
  if (!income) return 0;
  var ids = (Array.isArray(income.jobIds) && income.jobIds.length) ? income.jobIds : (income.jobId ? [income.jobId] : []);
  return ids.reduce(function (s, id) { return s + finPassThroughForJob(id); }, 0);
}
window.finPassThroughForJob = finPassThroughForJob;
window.finPassThroughForIncome = finPassThroughForIncome;

/* ⭐⭐ HARD COSTS OFF THE TOP (split model V2, live from FIN.HARDCOST_FROM) ─────────────────────────────
   Ray, 2026-09-09: "ideally, the business card always pays for the hard cost… the reimbursement thing was a
   Band Aid because the business had no money."

   Exactly right, and it names the bug. If the business card buys the dump ticket, that money has to leave
   the job BEFORE anyone splits it — otherwise the card is paid out of a pot the crew already took 60% of.
   V1 netted pass-through materials only, so disposal, mileage and rental were split as if they were profit.

   ⛔ NOT A PERCENTAGE CHANGE. 25/15/60 and 80/15/5 are untouched. Only the BASE they apply to changes.
   ⛔ Reimbursement still works — it just routes a hard cost to a PERSON instead of to the card. Same money,
      same point in the waterfall. */
function finHardCostsForJob(jobId) {
  if (!jobId || typeof D !== "function") return 0;
  var j = (D().jobs || []).find(function (x) { return x && x.id === jobId && !x.deleted; });
  if (!j) return 0;
  return Math.round(((typeof jobHardCost === "function") ? jobHardCost(j).total : 0) * 100);
}
function finHardCostsForIncome(income) {
  if (!income) return 0;
  var ids = (Array.isArray(income.jobIds) && income.jobIds.length) ? income.jobIds : (income.jobId ? [income.jobId] : []);
  return ids.reduce(function (s, id) { return s + finHardCostsForJob(id); }, 0);
}

/* ⭐ JUNK'S SALES CREDIT BELONGS TO THE BUSINESS. Ray: "sales credit shouldnt exist on junk jobs as its just
   ad spending" — and he kept it everywhere else, because on demo and hardscape it exists to make selling pay.

   ⚠️ This only ever fires when there is NO valid originator. With one, salesOK wins and a real person is paid
   exactly as before. What it replaces is the old silent fallback that rolled an unclaimed sales share into
   the FIELD pool — so on junk the crew was collecting the money that should have funded the ads that found
   the job. Scoped to bandKey "junk" per Ray ("lets focus on junk only right now"); dropping the bandKey test
   would generalise it to "nobody sold it, so the business did." */
function finSalesToBusiness(income) {
  if (!income || typeof D === "function" === false) return false;
  var ids = (Array.isArray(income.jobIds) && income.jobIds.length) ? income.jobIds : (income.jobId ? [income.jobId] : []);
  if (!ids.length) return false;
  var jobs = (D().jobs || []);
  return ids.some(function (id) {
    var j = jobs.find(function (x) { return x && x.id === id && !x.deleted; });
    var q = (j && typeof plQuoteFor === "function") ? plQuoteFor(j) : null;
    return !!(q && (q.items || []).some(function (it) { return it && it.bandKey === "junk"; }));
  });
}
window.jobHardCost = jobHardCost;
window.jobMilesBilled = jobMilesBilled;
window.finHardCostsForJob = finHardCostsForJob;
window.finHardCostsForIncome = finHardCostsForIncome;
window.finSalesToBusiness = finSalesToBusiness;
/* canonical per-job profitability — price (charged) − hard costs (expenses + mileage); NO labor line.
   TOOL/equipment job.expenses are EXCLUDED from the cost (they're capital/overhead, re-attributed to the
   business, not this job) — display-only; the record stays put in job.expenses[]. */
/* ⭐⭐ ONE definition of a job's hard costs, extracted 2026-09-09 so the P&L and the PAYOUT SPLIT cannot
   drift apart. They already had: jobProfit netted expenses + materials + mileage, while finJobSplit netted
   MATERIALS ONLY — so the crew was paid 60% of the dump ticket and the Business Fund then bought it back,
   which is why the fund ended a $650 job holding $1.72. Both now read this. Returns dollars. */
function jobHardCost(j) {
  if (!j) return { exp: 0, mat: 0, mil: 0, total: 0 };
  const expOf = job => plExpenses(job).filter(x => x && !x.deleted && !expenseIsTool(x) && !expenseIsFuel(x) && !plDepHeld(x)).reduce((s, e) => s + (+e.amount || 0), 0);
  const matOf = job => plMaterials(job).filter(x => x && !x.deleted && !plDepHeld(x)).reduce((s, e) => s + (+e.amount || 0), 0);
  /* ⭐ the CASCADE, not the bare odometer. jobMileageCost alone returns 0 on any job nobody clocked miles
     on — so the truck cost silently vanished from the split base and the crew divided the fuel money. */
  const mb = jobMilesBilled(j);
  let expCost = expOf(j), matCost = matOf(j), milCost = mb.cost;
  // a stop-job linked to N jobs contributes 1/N of its cost to each — a 1-element split (today's sub-jobs) is a no-op divide
  subJobsOf(j.id).forEach(sj => { const n = stopSplitN(sj); expCost += expOf(sj) / n; matCost += matOf(sj) / n; milCost += jobMilesBilled(sj).cost / n; });
  return { exp: expCost, mat: matCost, mil: milCost, milesSource: mb.source, total: expCost + matCost + milCost };
}
function jobProfit(j) {
  const q = plQuoteFor(j);
  const price = q ? (+(q.finalPrice || q.total) || 0) : 0;
  const hc = jobHardCost(j);
  const expCost = hc.exp, matCost = hc.mat, milCost = hc.mil;
  const cost = hc.total, profit = price - cost;
  const margin = price > 0 ? profit / price : (cost > 0 ? -1 : 0);
  const type = (q && typeof quoteType === "function" && quoteType(q)) || (j.title || "Other");
  const cust = (q && q.cust) || (j.customerId && typeof custName === "function" ? custName(j.customerId) : "") || "—";
  return { j: j, q: q, price: price, expCost: expCost, matCost: matCost, milCost: milCost, cost: cost, profit: profit, margin: margin, type: type, cust: cust };
}
/* effective field-work pay $/hr each — the number that says if a job was worth it.
   person-hours now come from the TIMECLOCK: jobClockedHrs(j) already sums every clocked segment across the whole
   crew (= real crew-hours), plus each linked stop-job's clocked hours split by how many jobs it's shared across.
   crew = the DISTINCT people who actually punched on the job (fallback: the assigned crew size). The legacy manual
   j.crewN/onSiteHrs/driveMin/driveMiles fields are no longer read; mileage cost still prefers confirmed time-clock
   miles (jobMilesCost, which keeps its legacy driveMiles fallback for old jobs). perHr is null when nobody has
   clocked in yet, so callers prompt "clock in to see the real $/hr" instead of showing a stale number. */
function jobHourly(j) {
  const p = jobProfit(j), subs = subJobsOf(j.id);
  let milCost = jobMilesCost(j); subs.forEach(sj => { milCost += jobMilesCost(sj) / stopSplitN(sj); });
  const cost = p.expCost + milCost, profit = p.price - cost, fieldPool = p.price * 0.48;
  // crew-hours straight from the clock (jobClockedHrs, js/38) + each stop-job's clocked hours, evenly split
  let personHrs = (typeof jobClockedHrs === "function") ? jobClockedHrs(j) : 0;
  subs.forEach(sj => { personHrs += ((typeof jobClockedHrs === "function") ? jobClockedHrs(sj) : 0) / stopSplitN(sj); });
  // crew = distinct users who actually punched on this job, else the assigned crew size, else 1
  const punchers = {};
  (D().timeclock || []).forEach(e => { if (e && !e.deleted && e.jobId === j.id && e.userId) punchers[e.userId] = 1; });
  const crew = Object.keys(punchers).length || (j.crew || []).length || 1;
  const onsite = crew > 0 ? personHrs / crew : personHrs, driveH = 0;   // per-person hours (drive folds into clocked time)
  return { price: p.price, cost: cost, milCost: milCost, expCost: p.expCost, profit: profit, fieldPool: fieldPool, crew: crew, onsite: onsite, driveH: driveH, personHrs: personHrs, perHr: personHrs > 0 ? fieldPool / personHrs : null, margin: p.price > 0 ? profit / p.price : 0 };
}
function plJobRow(j) {
  const p = jobProfit(j);
  const split = (typeof finSplitAmount === "function") ? finSplitAmount(finCents(p.price)) : null;
  return { j: j, q: p.q, revenue: p.price, hard: p.cost, gross: p.profit, margin: p.margin, field: split ? finDollars(split.field) : 0, under: p.price > 0 && p.margin < plFloor() };
}
function plRows() {
  const ws = plWeek(), we = plAddDays(ws, 6);
  // exclude ANY stop-job (sharedJobIds is an array — [] generic/overhead or [id,...] linked) from its own fake row;
  // its cost already rolled up into every job it's linked to (or, if [], surfaces separately as overhead below)
  return (typeof actJ === "function" ? actJ() : []).filter(j => j.date && !Array.isArray(j.sharedJobIds) && j.date >= ws && j.date <= we)
    .map(plJobRow).filter(r => r.revenue > 0 || r.hard > 0)
    .sort((a, b) => a.margin - b.margin);   // worst margin first
}
/* GENERIC/OVERHEAD stops — sharedJobIds=[] (linked to no job): a dump run or pickup nobody attributed to a
   specific job. Same weekly window as plRows(). Charged to no job's P&L; surfaced instead as a business-wide
   overhead line so it never shows up as its own fake -100%-margin "job". */
function overheadStops() {
  const ws = plWeek(), we = plAddDays(ws, 6);
  return (typeof actJ === "function" ? actJ() : []).filter(j => j.date && Array.isArray(j.sharedJobIds) && j.sharedJobIds.length === 0 && j.date >= ws && j.date <= we);
}
function overheadStopCost(j) {
  const exp = plExpenses(j).filter(x => x && !x.deleted).reduce((s, e) => s + (+e.amount || 0), 0);
  const mat = plMaterials(j).filter(x => x && !x.deleted).reduce((s, e) => s + (+e.amount || 0), 0);
  return exp + mat + jobMileageCost(j);
}

function rJobPL() {
  if (!plCanView()) return `<div class="card"><div class="nm">Owner / Admin only</div></div>`;
  const ws = plWeek(), we = plAddDays(ws, 6), rows = plRows();
  const tR = rows.reduce((s, r) => s + r.revenue, 0), tH = rows.reduce((s, r) => s + r.hard, 0), tG = tR - tH;
  const avg = tR > 0 ? tG / tR : 0, tField = rows.reduce((s, r) => s + r.field, 0);
  let h = `<div class="card"><div class="row" style="align-items:center">
      <button class="btn ghost sm" onclick="plWeekShift(-1)">‹</button>
      <div class="grow" style="text-align:center"><b>Week of ${esc(fmtDate(ws))}</b><div class="sub">${esc(fmtDate(ws))} – ${esc(fmtDate(we))} · ${rows.length} job(s)</div></div>
      <button class="btn ghost sm" onclick="plWeekShift(1)">›</button></div>
    <div class="row" style="gap:14px;flex-wrap:wrap;margin-top:10px">
      <div class="grow"><div class="sub">Revenue</div><div class="nm" style="font-size:20px">${plMoney(tR)}</div></div>
      <div class="grow"><div class="sub">Hard costs</div><div class="nm" style="font-size:20px">${plMoney(tH)}</div></div>
      <div class="grow"><div class="sub">Gross profit</div><div class="nm" style="font-size:20px;${tG < 0 ? "color:var(--danger)" : ""}">${plMoney(tG)}</div></div>
      <div class="grow"><div class="sub">Avg margin</div><div class="nm" style="font-size:20px;${avg < plFloor() ? "color:var(--danger)" : ""}">${tR > 0 ? plPct(avg) : "—"}</div></div>
    </div>
    <div class="sub" style="margin-top:6px;white-space:normal">Crew take-home (field pool via the OA split): ${plMoney(tField)} — no labor cost line; owners are paid from the revenue split, not wages.</div></div>`;
  // GENERAL BUSINESS OVERHEAD — dump runs / pickups logged with no job attached (sharedJobIds=[]); expandable
  const stops = overheadStops(), stopsTotal = stops.reduce((s, x) => s + overheadStopCost(x), 0);
  if (stops.length) {
    h += `<div class="card"><div class="row" style="align-items:center;cursor:pointer" onclick="plOhToggle()"><div class="grow"><b>General business overhead this week: ${plMoney(stopsTotal)}</b><span class="sub"> · ${stops.length} stop${stops.length === 1 ? "" : "s"}</span></div><span class="sub">${PL_OH_OPEN ? "▲" : "▼"}</span></div>`;
    if (PL_OH_OPEN) h += stops.map(sj => {
      const assignee = (sj.crew && sj.crew[0] && typeof userName === "function") ? (userName(sj.crew[0]) || "") : "";
      return `<div class="li" onclick="if(typeof closeModal==='function')closeModal();openJobPage('${sj.id}')" style="cursor:pointer"><div class="grow"><div class="nm" style="font-size:14px">${stopEmoji(sj.stopKind)} ${esc(sj.title || "Stop")}${assignee ? " · " + esc(assignee) : ""}</div><div class="sub">${fmtDate(sj.date)}</div></div><b>${plMoney(overheadStopCost(sj))}</b></div>`;
    }).join("");
    h += `</div>`;
  }
  if (!rows.length) return h + `<div class="empty"><div class="big">💹</div>No jobs with revenue or costs this week.<br>Log expenses on a job to see its margin here.</div>`;
  h += `<div class="secthd"><h2>Worst margin first</h2><span class="ct">${rows.filter(r => r.under).length} under ${Math.round(plFloor() * 100)}%</span></div><div class="card">` + rows.map(r => {
    const j = r.j, who = (r.q && r.q.cust) || (j.customerId && typeof custName === "function" ? custName(j.customerId) : "") || "";
    return `<div class="li" style="align-items:flex-start" onclick="if(typeof closeModal==='function')closeModal();openJob('${j.id}')"><div class="grow">
      <div class="nm" style="${r.under ? "color:var(--danger)" : ""}">${r.under ? "🔴 " : ""}${esc(j.title || "Job")}${r.margin < 0 ? " · LOSS" : ""}</div>
      <div class="sub" style="white-space:normal">${who ? esc(who) + " · " : ""}${esc(fmtDate(j.date))} · Price ${plMoney(r.revenue)} · Cost ${plMoney(r.hard)} · Profit ${plMoney(r.gross)}</div></div>
      <div style="text-align:right;flex:0 0 auto"><b style="${r.under ? "color:var(--danger)" : ""}">${r.revenue > 0 ? plPct(r.margin) : "—"}</b></div></div>`;
  }).join("") + `</div>`;
  return h;
}
