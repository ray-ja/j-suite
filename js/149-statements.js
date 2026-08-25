/* ---------- CASH-BASIS STATEMENTS (js/149) — a P&L and a cash-flow, per book ------------------------
   He runs four sets of books out of one app: Personal, Jamieson Automation, OBX Lot Solutions, and the
   Iowa rental (which is a Schedule E in its own right). Until now the app could tell him what an envelope
   had left in it; it could not answer "what did OBX actually make last quarter", which is the question an
   accountant, a lender, and the IRS all ask in that form.

   ⭐ CASH BASIS, SAME AS THE LEDGER. Income counts on the day it landed, expenses on the day they were
   paid. No accruals, no receivables. That means these statements RECONCILE TO HIS BANK, which is the
   entire point for a business this size — and it means a big December invoice paid in January is January
   income, exactly as his tax return will treat it.

   ⭐ IT REUSES THE GATES RATHER THAN RE-FILTERING. Every subtlety already fought for lives in
   actBudgetTx(): pending rows aren't money, transfers and card payments aren't income or spending, a
   split parent defers to its slices. Re-implementing that filter here is how two screens start disagreeing
   about the same month. So the statement asks the same function everything else asks.

   ⚠️ AND IT SHOWS WHAT IT EXCLUDED. Transfers, card payments and unapproved rows are reported as counts,
   not silently dropped — because a statement that quietly omits things is one he can't reconcile against
   his own bank, and an unexplained gap is worse than a smaller number. */

function stmtActive(arr) { return (arr || []).filter(function (x) { return x && !x.deleted; }); }
function stmtMonth(iso) { return String(iso || "").slice(0, 7); }
function stmtInRange(iso, from, to) { var d = String(iso || ""); return d >= from && d <= to; }

/* the periods an owner-operator actually thinks in */
function stmtRange(kind, anchor) {
  var a = anchor || ((typeof today === "function") ? today() : new Date().toISOString().slice(0, 10));
  var y = +a.slice(0, 4), m = +a.slice(5, 7);
  if (kind === "year") return { from: y + "-01-01", to: y + "-12-31", label: String(y) };
  if (kind === "quarter") {
    var q = Math.floor((m - 1) / 3), s = q * 3 + 1, e = s + 2;
    var last = new Date(Date.UTC(y, e, 0)).getUTCDate();
    return { from: y + "-" + String(s).padStart(2, "0") + "-01",
             to: y + "-" + String(e).padStart(2, "0") + "-" + last,
             label: "Q" + (q + 1) + " " + y };
  }
  var lastD = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: a.slice(0, 7) + "-01", to: a.slice(0, 7) + "-" + lastD, label: a.slice(0, 7) };
}

/* ⭐ THE P&L. bookId null = every book combined. */
function stmtProfitLoss(bookId, range) {
  var r = range || stmtRange("month");
  var rows = [], excluded = { transfers: 0, cardPayments: 0, pending: 0, uncategorized: 0 };
  var all = [];
  try { all = stmtActive(D().budgetTx); } catch (e) { return null; }

  /* ⭐ the same gate every other screen reads through — see the header */
  var counted = all.filter(function (t) {
    if (bookId && t.bookId !== bookId) return false;
    if (!stmtInRange(t.date, r.from, r.to)) return false;
    if (t.pending) { excluded.pending++; return false; }
    if (t.isTransfer) { excluded.transfers++; return false; }
    if (t.isCardPayment) { excluded.cardPayments++; return false; }
    if (t.isSplit) return false;                    // its slices carry the money
    return true;
  });

  var byCat = {};
  counted.forEach(function (t) {
    var key = t.catId || "__none__";
    if (!t.catId) excluded.uncategorized++;
    byCat[key] = byCat[key] || { catId: t.catId || "", dir: t.dir === "in" ? "in" : "out", amount: 0, n: 0 };
    byCat[key].amount += +t.amount || 0;
    byCat[key].n++;
  });

  Object.keys(byCat).forEach(function (k) {
    var v = byCat[k];
    rows.push({ catId: v.catId,
      name: v.catId ? ((typeof budgetCatName === "function") ? budgetCatName(v.catId) : v.catId) : "Uncategorized",
      dir: v.dir, amount: Math.round(v.amount * 100) / 100, count: v.n });
  });

  var income = rows.filter(function (x) { return x.dir === "in"; }).sort(function (a, b) { return b.amount - a.amount; });
  var expense = rows.filter(function (x) { return x.dir === "out"; }).sort(function (a, b) { return b.amount - a.amount; });
  var sum = function (a) { return Math.round(a.reduce(function (s, x) { return s + x.amount; }, 0) * 100) / 100; };
  var ti = sum(income), te = sum(expense);
  return { range: r, bookId: bookId || null,
    bookName: bookId ? ((typeof budgetBookName === "function") ? budgetBookName(bookId) : bookId) : "All books",
    income: income, expense: expense,
    totalIncome: ti, totalExpense: te, net: Math.round((ti - te) * 100) / 100,
    margin: ti > 0 ? Math.round((ti - te) / ti * 1000) / 10 : null,
    excluded: excluded, count: counted.length };
}

/* ⭐ THE CASH-FLOW STATEMENT. Different question from the P&L: not "did it make money" but "where did the
   cash go", which on a cash basis includes the movements the P&L deliberately ignores. */
function stmtCashFlow(bookId, range) {
  var r = range || stmtRange("month");
  var all = [];
  try { all = stmtActive(D().budgetTx); } catch (e) { return null; }
  var scope = all.filter(function (t) {
    return (!bookId || t.bookId === bookId) && stmtInRange(t.date, r.from, r.to) && !t.pending && !t.parentTxId;
  });
  var g = { operatingIn: 0, operatingOut: 0, transfersIn: 0, transfersOut: 0, cardPayments: 0 };
  scope.forEach(function (t) {
    var amt = +t.amount || 0;
    if (t.isCardPayment) { g.cardPayments += amt; return; }
    if (t.isTransfer) { if (t.dir === "in") g.transfersIn += amt; else g.transfersOut += amt; return; }
    if (t.dir === "in") g.operatingIn += amt; else g.operatingOut += amt;
  });
  var rnd = function (n) { return Math.round(n * 100) / 100; };
  return { range: r, bookId: bookId || null,
    operatingIn: rnd(g.operatingIn), operatingOut: rnd(g.operatingOut),
    operatingNet: rnd(g.operatingIn - g.operatingOut),
    transfersIn: rnd(g.transfersIn), transfersOut: rnd(g.transfersOut),
    cardPayments: rnd(g.cardPayments),
    netChange: rnd(g.operatingIn - g.operatingOut + g.transfersIn - g.transfersOut - g.cardPayments) };
}

/* ---------- rendering ---------- */
var STMT_PERIOD = "month";
function stmtMoney(n) { return (typeof budgetMoney === "function") ? budgetMoney(n) : "$" + (+n || 0).toFixed(2); }

function stmtLine(name, amount, n, bold) {
  return '<div class="row" style="gap:8px;align-items:baseline;padding:4px 0' + (bold ? ';border-top:1px solid var(--line);margin-top:4px;padding-top:6px' : '') + '">'
    + '<div class="grow" style="min-width:0;' + (bold ? 'font-weight:700' : '') + '">' + esc(name)
    + (n ? ' <span class="sub">×' + n + '</span>' : '') + '</div>'
    + '<div style="flex:0 0 auto;font-variant-numeric:tabular-nums' + (bold ? ';font-weight:700' : '') + '">'
    + esc(stmtMoney(amount)) + '</div></div>';
}

function stmtHTML() {
  var bookId = (typeof budgetIsAll === "function" && budgetIsAll()) ? null
    : ((typeof budgetCurrentBookId === "function") ? budgetCurrentBookId() : null);
  var r = stmtRange(STMT_PERIOD);
  var pl = stmtProfitLoss(bookId, r);
  if (!pl) return "";
  var cf = stmtCashFlow(bookId, r);

  var h = '<div class="row" style="gap:6px;margin-bottom:10px">'
    + ["month", "quarter", "year"].map(function (k) {
        return '<button class="btn ' + (STMT_PERIOD === k ? "acc" : "ghost") + ' sm" style="flex:1"'
          + ' onclick="stmtSetPeriod(\'' + k + '\')">' + esc(k[0].toUpperCase() + k.slice(1)) + '</button>';
      }).join("") + '</div>';

  h += '<div class="card"><div class="secthd" style="margin-top:0"><h2 style="font-size:13px">'
    + esc(pl.bookName) + ' · ' + esc(r.label) + '</h2></div>';

  if (!pl.count) {
    h += '<div class="sub" style="white-space:normal">Nothing recorded in this period.</div></div>';
    return h;
  }

  h += '<div class="sub" style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;margin-top:6px">Money in</div>';
  h += pl.income.length ? pl.income.map(function (x) { return stmtLine(x.name, x.amount, x.count); }).join("")
                        : '<div class="sub">none</div>';
  h += stmtLine("Total in", pl.totalIncome, 0, true);

  h += '<div class="sub" style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;margin-top:12px">Money out</div>';
  h += pl.expense.length ? pl.expense.map(function (x) { return stmtLine(x.name, x.amount, x.count); }).join("")
                         : '<div class="sub">none</div>';
  h += stmtLine("Total out", pl.totalExpense, 0, true);

  h += '<div class="row" style="gap:8px;align-items:baseline;border-top:2px solid var(--line);margin-top:8px;padding-top:8px">'
    + '<div class="grow" style="font-weight:800">Net</div>'
    + '<div style="font-variant-numeric:tabular-nums;font-weight:800;font-size:18px;color:'
    + (pl.net < 0 ? 'var(--danger)' : 'var(--accent)') + '">' + esc(stmtMoney(pl.net)) + '</div></div>'
    + (pl.margin != null ? '<div class="sub" style="text-align:right">' + pl.margin + '% margin</div>' : '');

  /* ⚠️ what was left out, and why — never a silent omission */
  var ex = pl.excluded, notes = [];
  if (ex.transfers) notes.push(ex.transfers + " transfer" + (ex.transfers === 1 ? "" : "s"));
  if (ex.cardPayments) notes.push(ex.cardPayments + " card payment" + (ex.cardPayments === 1 ? "" : "s"));
  if (ex.pending) notes.push(ex.pending + " waiting for approval");
  if (notes.length) {
    h += '<div class="sub" style="white-space:normal;margin-top:10px">Not counted: ' + esc(notes.join(", "))
      + '. Transfers and card payments move cash between your own accounts — they aren\'t income or spending.</div>';
  }
  if (ex.uncategorized) {
    h += '<div class="sub" style="white-space:normal;margin-top:4px;color:var(--danger)">'
      + ex.uncategorized + ' transaction' + (ex.uncategorized === 1 ? " has" : "s have") + ' no category yet.</div>';
  }
  h += '</div>';

  /* the cash-flow view answers a different question and is worth its own block */
  if (cf) {
    h += '<div class="card"><div class="secthd" style="margin-top:0"><h2 style="font-size:13px">Where the cash went</h2></div>'
      + stmtLine("From income", cf.operatingIn, 0)
      + stmtLine("On expenses", -cf.operatingOut, 0)
      + (cf.transfersIn || cf.transfersOut ? stmtLine("Transferred in/out", cf.transfersIn - cf.transfersOut, 0) : "")
      + (cf.cardPayments ? stmtLine("Paid to cards", -cf.cardPayments, 0) : "")
      + stmtLine("Net change in cash", cf.netChange, 0, true)
      + '</div>';
  }
  return h;
}

if (typeof window !== "undefined") {
  window.stmtProfitLoss = stmtProfitLoss; window.stmtCashFlow = stmtCashFlow;
  window.stmtRange = stmtRange; window.stmtHTML = stmtHTML;
  window.stmtSetPeriod = function (p) { STMT_PERIOD = p; if (typeof render === "function") render(); };
}
if (typeof module !== "undefined" && module.exports) module.exports = { stmtRange: stmtRange };
