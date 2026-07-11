/* ---------- FINANCE CORE — the operating-agreement money engine (pure, no DOM, unit-tested) ----------
   Exact integer-CENT arithmetic; node-requireable so finance-tests.js can prove the math.

   Operating agreement (CLAUDE.md):
     revenue → 25% Tax Reserve · 15% Business Fund · 60% Labor Pool
     Labor Pool → 80% Field Work — split EQUALLY among the members who worked the job (crew/timeclock)
                  15% Sales Credit — the originating member; valid only within a 3-month window from
                                     booking; a HOUSE ACCOUNT or out-of-window job redirects it to Field Work
                  5%  Admin — the Admin Member; capped at $500/MONTH; overflow redirects to Field Work
     Mileage (timeclock @ $0.725/mi) is reimbursed to the vehicle owner FROM the Business Fund as an
     EXPENSE — never part of the per-job distribution.

   Rounding discipline: every split assigns the rounding remainder to one bucket so each level sums
   back EXACTLY to its input (no lost or invented cents). All amounts flow through as integer cents. */

var FIN = {
  TAX: 0.25, BUSINESS: 0.15, LABOR: 0.60,      // shares of revenue
  FIELD: 0.80, SALES: 0.15, ADMIN: 0.05,       // shares of the labor pool
  ADMIN_CAP_CENTS: 50000,                       // $500 / month to the Admin Member
  MILEAGE_RATE: 0.725,                          // $/mile (IRS)
  SALES_WINDOW_MONTHS: 3
};
function finCents(d) { return Math.round((Number(d) || 0) * 100); }
function finDollars(c) { return (c || 0) / 100; }

/* exact split of an amount (cents); tax+business+labor === amount and field+sales+admin === labor */
function finSplitAmount(amountCents) {
  amountCents = Math.max(0, Math.round(amountCents || 0));
  var tax = Math.round(amountCents * FIN.TAX);
  var business = Math.round(amountCents * FIN.BUSINESS);
  var labor = amountCents - tax - business;             // remainder → exact
  var field = Math.round(labor * FIN.FIELD);
  var sales = Math.round(labor * FIN.SALES);
  var admin = labor - field - sales;                    // remainder → exact
  return { amount: amountCents, tax: tax, business: business, labor: labor, field: field, sales: sales, admin: admin };
}

function finParseDate(d) { if (d == null) return null; if (typeof d === "number") return new Date(d); var s = String(d); return new Date(s.length <= 10 ? s + "T00:00:00" : s); }
/* job date within 3 calendar months of the booking date */
function finWithinSalesWindow(bookedAt, jobDate) {
  var b = finParseDate(bookedAt), j = finParseDate(jobDate);
  if (!b || isNaN(b.getTime()) || !j || isNaN(j.getTime())) return false;
  var lim = new Date(b.getTime()); lim.setMonth(lim.getMonth() + FIN.SALES_WINDOW_MONTHS);
  return j.getTime() <= lim.getTime();
}

/* split `cents` equally among ids; cent remainders go to the lowest-sorted ids (deterministic) */
function finSplitEqual(cents, ids) {
  cents = Math.max(0, Math.round(cents || 0));
  var out = {}, n = (ids || []).length;
  if (n === 0) return { perMember: {}, unallocated: cents };
  var sorted = ids.slice().sort();
  var base = Math.floor(cents / n), rem = cents - base * n;
  sorted.forEach(function (id, i) { out[id] = base + (i < rem ? 1 : 0); });
  return { perMember: out, unallocated: 0 };
}

/* split `cents` among ids WEIGHTED by each id's clocked hours (`weights` = {id: hours}); the largest
   cent remainders go to the highest-weight ids (deterministic, ties broken by lowest id). The field pool
   per job is unchanged (it sums to `cents` exactly) — only the SPLIT AMONG THE CREW differs from equal:
   whoever clocked more hours on the job earns proportionally more of that job's field share. If no id has
   any clocked weight (e.g. nobody clocked in), this falls back to an EQUAL split — so the per-person total
   still reconciles to the pooled "owed to members" number under every data shape. */
function finSplitWeighted(cents, ids, weights) {
  cents = Math.max(0, Math.round(cents || 0));
  ids = (ids || []).filter(Boolean);
  if (ids.length === 0) return { perMember: {}, unallocated: cents };
  var total = 0; ids.forEach(function (id) { total += Math.max(0, (weights && weights[id]) || 0); });
  if (!(total > 0)) return finSplitEqual(cents, ids);          // no clocked hours → equal (existing behavior)
  var out = {}, assigned = 0, frac = [];
  ids.forEach(function (id) {
    var exact = cents * (Math.max(0, weights[id] || 0) / total);
    var base = Math.floor(exact);
    out[id] = base; assigned += base; frac.push({ id: id, f: exact - base });
  });
  var rem = cents - assigned;                                   // distribute leftover cents by largest fractional part
  frac.sort(function (a, b) { return (b.f - a.f) || (a.id < b.id ? -1 : 1); });
  for (var i = 0; i < rem; i++) out[frac[i % frac.length].id] += 1;
  return { perMember: out, unallocated: 0 };
}

/* is any crew member carrying an EXPLICIT non-default (≠100) share weight? Only then do we leave the equal
   split — so a job with no weights (or every member at the 100 default) stays byte-identical to finSplitEqual. */
function finWeightsActive(ids, weights) {
  if (!weights) return false;
  return (ids || []).some(function (id) { var v = weights[id]; return v != null && v !== "" && (+v || 0) !== 100; });
}
/* THE field-pool split used everywhere: equal by default (byte-identical to before), or share-weighted when a
   partial helper's weight is dialed off 100 (e.g. a helper who only worked part of the job → 60). Missing/blank
   weights default to 100. Sums to `cents` exactly either way, so the per-job pool never gains or loses a cent. */
function finFieldSplit(cents, ids, weights) {
  if (!finWeightsActive(ids, weights)) return finSplitEqual(cents, ids);
  var w = {}; (ids || []).forEach(function (id) { var v = weights[id]; w[id] = (v == null || v === "") ? 100 : Math.max(0, +v || 0); });
  return finSplitWeighted(cents, ids, w);
}

/* ---------- PER-PERSON EARNINGS (one source of truth; reconciles to the pooled "owed to members") ----------
   Re-derives the SAME per-job field pool the rollup computes (fieldBeforeAdmin + admin overflow), but splits
   each job's field pool by who actually CLOCKED the job, weighted by their hours (finSplitWeighted). Sales
   credit + admin come straight from finRollup (originator / admin member — identical to the pooled engine).
   Mileage is the per-owner reimbursement (finMileage). Payouts already paid (disbursements carrying a
   memberId) are subtracted. RECONCILIATION GUARANTEE: the sum of every person's field+sales+admin plus the
   unallocated field equals rollup.totals.field+sales+admin — so per-person never invents or loses a cent vs
   the pooled engine; only the per-crew SPLIT of each job's field pool changes (hours-weighted vs equal). */
function finHoursByJob(entries, opts) {
  opts = opts || {}; var by = {};
  (entries || []).forEach(function (e) {
    if (!e || e.deleted || !e.clockOut || !e.jobId || !e.userId) return;
    var day = (typeof e.clockIn === "number") ? finDayOf(e.clockIn) : String(e.clockIn || "").slice(0, 10);
    if ((opts.from && day < opts.from) || (opts.to && day > opts.to)) return;
    var ci = (typeof e.clockIn === "number") ? e.clockIn : Date.parse(e.clockIn);
    var co = (typeof e.clockOut === "number") ? e.clockOut : Date.parse(e.clockOut);
    var hrs = Math.max(0, (co - ci) / 3600000);
    if (!(hrs > 0)) return;
    (by[e.jobId] = by[e.jobId] || {});
    by[e.jobId][e.userId] = (by[e.jobId][e.userId] || 0) + hrs;
  });
  return by;
}
function finPerPerson(rollup, mileage, hoursByJob, payouts) {
  rollup = rollup || { member: {}, perJob: [], totals: {} };
  mileage = mileage || { perMember: {} }; hoursByJob = hoursByJob || {}; payouts = payouts || {};
  var member = {}, unallocatedField = 0;
  function M(id) { return member[id] || (member[id] = { field: 0, sales: 0, admin: 0, earned: 0, mileage: 0, paid: 0, owed: 0 }); }
  // 1) sales + admin come straight from the pooled engine (same originator / admin-member math)
  Object.keys(rollup.member || {}).forEach(function (id) {
    var m = rollup.member[id]; if (m.sales) M(id).sales += m.sales; if (m.admin) M(id).admin += m.admin;
  });
  // 2) field — re-split each job's field POOL (identical total) among whoever was on the job, using the SAME
  // share weights the rollup used: equal by default (a faster crew member shouldn't earn less for finishing
  // quicker), or dialed down for a partial helper (e.g. 60) — never hours-weighted.
  (rollup.perJob || []).forEach(function (pj) {
    var crew = Object.keys(pj.field || {});                                   // the crew the rollup distributed to (income.crew)
    if (pj.unallocated) unallocatedField += pj.unallocated;                   // job had no crew → stays unassigned (matches pool)
    if (!crew.length) return;
    var es = finFieldSplit(pj.fieldPool, crew, pj.weights);                   // same share-weighting the rollup used (equal by default)
    Object.keys(es.perMember).forEach(function (id) { M(id).field += es.perMember[id]; });
    unallocatedField += es.unallocated || 0;
  });
  // 3) mileage reimbursement (per vehicle owner) + payouts already paid → owed
  Object.keys(mileage.perMember || {}).forEach(function (id) { M(id).mileage += mileage.perMember[id] || 0; });
  Object.keys(payouts).forEach(function (id) { M(id).paid += payouts[id] || 0; });
  var totals = { field: 0, sales: 0, admin: 0, earned: 0, mileage: 0, paid: 0, owed: 0 };
  Object.keys(member).forEach(function (id) {
    var m = member[id];
    m.earned = m.field + m.sales + m.admin;
    m.owed = m.earned + m.mileage - m.paid;                                   // what to still pay this person
    totals.field += m.field; totals.sales += m.sales; totals.admin += m.admin;
    totals.earned += m.earned; totals.mileage += m.mileage; totals.paid += m.paid; totals.owed += m.owed;
  });
  return { member: member, totals: totals, unallocatedField: unallocatedField };
}

/* per-job split with the Sales redirect resolved. Admin is returned raw — its monthly cap is a
   period-level constraint, so it is applied in finRollup (overflow → that job's field pool). */
function finJobSplit(income) {
  var gross = finCents(income.amount);
  // PASS-THROUGH MATERIALS are billed to the customer at cost and go 100% back to whoever paid (business account, or
  // the person reimbursed) — NOT revenue to split. Net the pass-through cost off the top so only the LABOR VALUE runs
  // through 25/15/60. Guarded: the helper lives in the P&L layer (js/52); absent (isolated core tests) → 0, so the
  // split stays byte-identical until a PAID job actually carries pass-through. income._noPT forces the gross split.
  var pt = (income && !income._noPT && typeof finPassThroughForIncome === "function") ? Math.max(0, finPassThroughForIncome(income) || 0) : 0;
  if (pt > gross) pt = gross;   // never a negative base
  var s = finSplitAmount(gross - pt);
  var crew = (income.crew || []).filter(Boolean);
  var salesOK = !!(income.originator && !income.houseAccount && finWithinSalesWindow(income.bookedAt, income.date));
  var fieldBeforeAdmin = s.field, salesToOriginator = 0;
  if (salesOK) salesToOriginator = s.sales; else fieldBeforeAdmin += s.sales;   // house/out-of-window → Field Work
  return {
    amount: s.amount, gross: gross, passThrough: pt, tax: s.tax, business: s.business, labor: s.labor,
    field: s.field, sales: s.sales, admin: s.admin,
    crew: crew, salesOK: salesOK, originator: income.originator || "",
    salesToOriginator: salesToOriginator, fieldBeforeAdmin: fieldBeforeAdmin, rawAdmin: s.admin
  };
}

/* roll up income records over a period, applying the monthly Admin cap (overflow → field pool).
   opts: { adminMemberId, from, to } — from/to inclusive 'YYYY-MM-DD' compared on income.date. */
function finRollup(incomes, opts) {
  opts = opts || {};
  var list = (incomes || []).filter(function (x) {
    return x && !x.deleted && (!opts.from || x.date >= opts.from) && (!opts.to || x.date <= opts.to);
  }).slice().sort(function (a, b) { return (a.date + "|" + a.id) < (b.date + "|" + b.id) ? -1 : 1; });
  var member = {}, adminByMonth = {}, perJob = [];
  var totals = { amount: 0, gross: 0, passThrough: 0, tax: 0, business: 0, labor: 0, field: 0, sales: 0, admin: 0, adminOverflow: 0, unallocatedField: 0 };
  function M(id) { return member[id] || (member[id] = { field: 0, sales: 0, admin: 0 }); }
  list.forEach(function (inc) {
    var js = finJobSplit(inc);
    // totals.amount = the SPLIT base (net of pass-through) so tax+business+labor still reconciles to it exactly.
    // totals.gross = what customers actually paid; totals.passThrough = material money routed back to payers (not split).
    totals.amount += js.amount; totals.gross += js.gross; totals.passThrough += js.passThrough;
    totals.tax += js.tax; totals.business += js.business; totals.labor += js.labor;
    if (js.salesToOriginator > 0) { M(js.originator).sales += js.salesToOriginator; totals.sales += js.salesToOriginator; }
    var mo = String(inc.date || "").slice(0, 7), paid = adminByMonth[mo] || 0, adminToMember = 0, overflow = js.rawAdmin;
    if (opts.adminMemberId && js.rawAdmin > 0) {
      var room = Math.max(0, FIN.ADMIN_CAP_CENTS - paid);
      adminToMember = Math.min(room, js.rawAdmin);
      overflow = js.rawAdmin - adminToMember;
      adminByMonth[mo] = paid + adminToMember;
      if (adminToMember > 0) { M(opts.adminMemberId).admin += adminToMember; totals.admin += adminToMember; }
    }
    totals.adminOverflow += overflow;
    var fieldPool = js.fieldBeforeAdmin + overflow;
    var fs = finFieldSplit(fieldPool, js.crew, inc.weights);
    Object.keys(fs.perMember).forEach(function (id) { M(id).field += fs.perMember[id]; });
    totals.field += fieldPool - fs.unallocated; totals.unallocatedField += fs.unallocated;
    perJob.push({ id: inc.id, jobId: inc.jobId, date: inc.date, amount: js.amount, gross: js.gross, passThrough: js.passThrough, split: js, adminToMember: adminToMember, adminOverflow: overflow, fieldPool: fieldPool, field: fs.perMember, unallocated: fs.unallocated, weights: inc.weights || null });
  });
  return { totals: totals, member: member, perJob: perJob };
}

function finDayOf(ms) { var d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
/* mileage reimbursements from time-clock entries → cents per member, paid to the VEHICLE OWNER
   (entry.vehicleOwnerId; falls back to entry.userId for pre-change entries with no owner recorded).
   opts: { from, to, confirmedOnly, rate } — period filtered on the clock-in day. */
function finMileage(entries, opts) {
  opts = opts || {}; var per = {}, total = 0, miles = 0;
  (entries || []).forEach(function (e) {
    if (!e || e.deleted || !e.clockOut) return;
    if (opts.confirmedOnly && !e.milesConfirmed) return;
    var day = (typeof e.clockIn === "number") ? finDayOf(e.clockIn) : String(e.clockIn || "").slice(0, 10);
    if ((opts.from && day < opts.from) || (opts.to && day > opts.to)) return;
    var mi = (e.miles != null) ? e.miles : Math.round((e.computedMiles || 0) * 10) / 10;
    var cents = Math.round(mi * (e.rate || opts.rate || FIN.MILEAGE_RATE) * 100);
    var owner = e.vehicleOwnerId || e.userId;   // mileage reimburses the VEHICLE OWNER, not the driver
    per[owner] = (per[owner] || 0) + cents; total += cents; miles += mi;
  });
  // NET OUT business-card fuel bought for each owner's vehicle — it's an advance against their mileage ($0.725/mi
  // already covers fuel). Floor at 0 per owner; excess (fuel > mileage in scope) is dropped (owner never owes back).
  // Guarded: the offset helper lives in the receipts layer (js/72); in isolated core tests it's absent → no offset,
  // so raw mileage stays byte-identical. Pass opts.fuelOffset===false to force raw. `applied` is returned for display.
  var applied = {};
  if (opts.fuelOffset !== false && typeof rcptFuelOffsetByOwner === "function") {
    var off = rcptFuelOffsetByOwner({ from: opts.from, to: opts.to }) || {};
    Object.keys(off).forEach(function (owner) {
      var cur = per[owner] || 0; if (cur <= 0) return;
      var d = Math.min(cur, off[owner] || 0); if (d <= 0) return;
      per[owner] = cur - d; total -= d; applied[owner] = (applied[owner] || 0) + d;
    });
  }
  return { perMember: per, total: total, miles: Math.round(miles * 10) / 10, fuelOffset: applied };
}

/* account-funding view — how much to move to each account this period */
function finAccounts(totals, mileageTotal, expensesTotal) {
  mileageTotal = mileageTotal || 0; expensesTotal = expensesTotal || 0;
  return {
    taxReserve: totals.tax,
    businessFundInflow: totals.business,
    mileageOut: mileageTotal,
    expensesOut: expensesTotal,
    businessFundNet: totals.business - mileageTotal - expensesTotal
  };
}

/* fault-attributed job expenses → cents docked from THAT member's payout (fairness among owners: a
   mistake that cost the job is borne by who made it, not split across the crew). opts: { from, to } filter on the expense day. */
function finFaultDeductions(jobs, opts) {
  opts = opts || {}; var per = {};
  (jobs || []).forEach(function (j) { if (!j || j.deleted) return;
    (j.expenses || []).forEach(function (e) { if (!e || e.deleted || !e.faultMemberId) return;
      var day = (typeof e.ts === "number") ? finDayOf(e.ts) : String(e.ts || "").slice(0, 10);
      if ((opts.from && day < opts.from) || (opts.to && day > opts.to)) return;
      per[e.faultMemberId] = (per[e.faultMemberId] || 0) + Math.round((+e.amount || 0) * 100);
    });
  });
  return { perMember: per };
}
/* per-member payout — field + sales + admin is the distribution; mileage is a reimbursement (not a
   distribution); a fault deduction is subtracted (the member eats their own mistake). */
function finPayouts(rollup, mileage, fault) {
  mileage = mileage || { perMember: {} }; fault = fault || { perMember: {} };
  var ids = {}, rows = {};
  Object.keys((rollup && rollup.member) || {}).forEach(function (id) { ids[id] = 1; });
  Object.keys(mileage.perMember || {}).forEach(function (id) { ids[id] = 1; });
  Object.keys(fault.perMember || {}).forEach(function (id) { ids[id] = 1; });
  Object.keys(ids).forEach(function (id) {
    var m = (rollup.member && rollup.member[id]) || { field: 0, sales: 0, admin: 0 }, mil = mileage.perMember[id] || 0, flt = fault.perMember[id] || 0;
    var dist = (m.field || 0) + (m.sales || 0) + (m.admin || 0);
    rows[id] = { field: m.field || 0, sales: m.sales || 0, admin: m.admin || 0, distribution: dist, mileage: mil, fault: flt, total: dist + mil - flt };
  });
  return rows;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FIN: FIN, finCents: finCents, finDollars: finDollars, finSplitAmount: finSplitAmount,
    finWithinSalesWindow: finWithinSalesWindow, finSplitEqual: finSplitEqual, finSplitWeighted: finSplitWeighted, finFieldSplit: finFieldSplit, finWeightsActive: finWeightsActive, finJobSplit: finJobSplit,
    finRollup: finRollup, finMileage: finMileage, finAccounts: finAccounts, finPayouts: finPayouts, finDayOf: finDayOf,
    finHoursByJob: finHoursByJob, finPerPerson: finPerPerson
  };
}
