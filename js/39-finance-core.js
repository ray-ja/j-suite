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

/* per-job split with the Sales redirect resolved. Admin is returned raw — its monthly cap is a
   period-level constraint, so it is applied in finRollup (overflow → that job's field pool). */
function finJobSplit(income) {
  var s = finSplitAmount(finCents(income.amount));
  var crew = (income.crew || []).filter(Boolean);
  var salesOK = !!(income.originator && !income.houseAccount && finWithinSalesWindow(income.bookedAt, income.date));
  var fieldBeforeAdmin = s.field, salesToOriginator = 0;
  if (salesOK) salesToOriginator = s.sales; else fieldBeforeAdmin += s.sales;   // house/out-of-window → Field Work
  return {
    amount: s.amount, tax: s.tax, business: s.business, labor: s.labor,
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
  var totals = { amount: 0, tax: 0, business: 0, labor: 0, field: 0, sales: 0, admin: 0, adminOverflow: 0, unallocatedField: 0 };
  function M(id) { return member[id] || (member[id] = { field: 0, sales: 0, admin: 0 }); }
  list.forEach(function (inc) {
    var js = finJobSplit(inc);
    totals.amount += js.amount; totals.tax += js.tax; totals.business += js.business; totals.labor += js.labor;
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
    var fs = finSplitEqual(fieldPool, js.crew);
    Object.keys(fs.perMember).forEach(function (id) { M(id).field += fs.perMember[id]; });
    totals.field += fieldPool - fs.unallocated; totals.unallocatedField += fs.unallocated;
    perJob.push({ id: inc.id, jobId: inc.jobId, date: inc.date, amount: js.amount, split: js, adminToMember: adminToMember, adminOverflow: overflow, fieldPool: fieldPool, field: fs.perMember, unallocated: fs.unallocated });
  });
  return { totals: totals, member: member, perJob: perJob };
}

function finDayOf(ms) { var d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
/* mileage reimbursements from time-clock entries → cents per member (vehicle owner = entry.userId).
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
    per[e.userId] = (per[e.userId] || 0) + cents; total += cents; miles += mi;
  });
  return { perMember: per, total: total, miles: Math.round(miles * 10) / 10 };
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

/* per-member payout — field + sales + admin is the distribution; mileage is reported alongside
   (an expense reimbursement from the Business Fund, not a distribution). */
function finPayouts(rollup, mileage) {
  mileage = mileage || { perMember: {} };
  var ids = {}, rows = {};
  Object.keys((rollup && rollup.member) || {}).forEach(function (id) { ids[id] = 1; });
  Object.keys(mileage.perMember || {}).forEach(function (id) { ids[id] = 1; });
  Object.keys(ids).forEach(function (id) {
    var m = (rollup.member && rollup.member[id]) || { field: 0, sales: 0, admin: 0 }, mil = mileage.perMember[id] || 0;
    var dist = (m.field || 0) + (m.sales || 0) + (m.admin || 0);
    rows[id] = { field: m.field || 0, sales: m.sales || 0, admin: m.admin || 0, distribution: dist, mileage: mil, total: dist + mil };
  });
  return rows;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FIN: FIN, finCents: finCents, finDollars: finDollars, finSplitAmount: finSplitAmount,
    finWithinSalesWindow: finWithinSalesWindow, finSplitEqual: finSplitEqual, finJobSplit: finJobSplit,
    finRollup: finRollup, finMileage: finMileage, finAccounts: finAccounts, finPayouts: finPayouts, finDayOf: finDayOf
  };
}
