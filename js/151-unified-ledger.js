/* ---------- THE UNIFIED LEDGER (js/151) — one place that knows all his money ------------------------
   Ray, 2026-08-25, asked which way to resolve the two-ledger split: "single source."

   ⚠️ READ THIS BEFORE CHANGING ANYTHING HERE, because the obvious version of "single source" is the one
   that loses his books.

   The app has money in two different shapes. Personal/budget cash lives in `budgetTx` (263 rows, all
   RBJVL). Business cash lives per-org in `income`, `expenses` and per-job `jobExpenses`. And the business
   side is NOT one flat list — four collections overlap and cross-reference each other by receiptId:

       income        the money in                                     → COUNT
       expenses      general business spending (skip `unpaid` — A/P)   → COUNT
       jobExpenses   per-job costs                                     → COUNT
       receipts      an INBOX that ROUTES into the three above         → ⛔ NEVER COUNT
       jobMaterials  pass-through, billed on to the customer           → ⛔ NEVER COUNT as his cost

   Adding all five would multiply-count nearly every dollar he has spent. So this file does not invent a
   new total: it uses the SAME rule js/64 already uses for cash out — paid `expenses` + `finJobExpenseOut`
   — because two functions that both claim to know what a business spent will eventually disagree, and
   only one of them will get fixed.

   ⭐ AND IT MOVES NOTHING. "Single source" is delivered here as a single READ across everything, not as a
   migration of a hundred live money records into another collection. js/40, js/64, js/109, the payout
   waterfall and the GL all read those collections today; relocating the data would break every one of
   them in a single commit, and CLAUDE.md is blunt that the data layer is the one unrecoverable failure.
   So: one view now, and the WRITES migrate afterwards, once matching (a bank row linking to an expense he
   already logged) exists to stop the two sides duplicating each other. */

var UNI_SOURCES = ["budget", "income", "expense", "jobExpense"];

/* ⚠️ every business helper reads D(), which is S[S.biz]. To total another org we borrow its context and
   put it back — synchronously, in a finally, so a throw can't leave him looking at the wrong company. */
function uniInOrg(orgId, fn) {
  if (typeof S === "undefined" || !S[orgId]) return null;
  var prev = S.biz;
  try { S.biz = orgId; return fn(); }
  catch (e) { return null; }
  finally { S.biz = prev; }
}
function uniOrgs() {
  try {
    return (S.registry || []).filter(function (o) { return o && o.id && S[o.id] && typeof S[o.id] === "object" && !Array.isArray(S[o.id]); });
  } catch (e) { return []; }
}
function uniActive(a) { return (a || []).filter(function (x) { return x && !x.deleted; }); }
function uniIn(iso, from, to) { var d = String(iso || ""); return (!from || d >= from) && (!to || d <= to); }

/* one org's cash movements, in the ledger's row shape */
function uniOrgRows(orgId, from, to) {
  return uniInOrg(orgId, function () {
    var d = D(), out = [];

    /* --- the personal/budget ledger ---
       ⚠️ THIS WAS GUARDED ON `typeof actBudgetTx === "function"` AND THAT WAS A SILENT-ZERO BUG. The
       branch doesn't call actBudgetTx — it applies the same rule inline — so the guard only meant that if
       that function happened not to be loaded, every personal dollar vanished from the unified totals with
       no error anywhere. A missing helper should break loudly or not matter; it must never quietly change
       what his money adds up to.

       ⭐ The filter is inline ON PURPOSE, and it is actBudgetTx's rule MINUS budgetInBook(): the unified
       view spans every book by definition, so book-scoping here would hide most of it. Same exclusions
       though — pending isn't money, transfers and card payments aren't income or spending, and a split
       parent defers to its slices. If those rules change in js/79, they change here too. */
    var bt = (D().budgetTx || []).filter(function (t) {
      /* ⚠️ and a MATCHED row (js/152) is skipped here too — the business record it points at is already
         in this same list, from the expenses/jobExpenses branches below. */
      return t && !t.deleted && !t.pending && !t.isTransfer && !t.isCardPayment && !t.isSplit
        && !(t.matchedTo && t.matchedTo.id);
    });
    bt.forEach(function (t) {
      if (!uniIn(t.date, from, to)) return;
      out.push({ orgId: orgId, source: "budget", id: t.id, date: t.date,
        dir: t.dir === "in" ? "in" : "out", amount: +t.amount || 0,
        category: (typeof budgetCatName === "function" && t.catId) ? budgetCatName(t.catId) : "",
        bookId: t.bookId || "", note: t.note || "" });
    });

    /* --- business income --- */
    uniActive(d.income).forEach(function (i) {
      if (!uniIn(i.date, from, to)) return;
      out.push({ orgId: orgId, source: "income", id: i.id, date: i.date, dir: "in",
        amount: +i.amount || 0, category: "Job income", bookId: "", note: i.invoice || "" });
    });

    /* --- business expenses. ⛔ `unpaid` is a BILL, not cash out — it's A/P until paid (js/64). --- */
    uniActive(d.expenses).forEach(function (e) {
      if (e.unpaid) return;
      if (!uniIn(e.date, from, to)) return;
      out.push({ orgId: orgId, source: "expense", id: e.id, date: e.date, dir: "out",
        amount: +e.amount || 0, category: e.category || "", bookId: "",
        note: e.desc || e.vendor || e.note || "" });
    });

    /* --- per-job expenses, via the same accessor js/64 totals with --- */
    uniActive(d.jobs).forEach(function (j) {
      var list = (typeof plExpenses === "function") ? plExpenses(j) : (j.expenses || []);
      uniActive(list).forEach(function (e) {
        if (e.unpaid) return;
        if (typeof depositHeld === "function" && depositHeld(e)) return;   // a held deposit isn't spent
        var dt = e.date || j.date || "";
        if (!uniIn(dt, from, to)) return;
        out.push({ orgId: orgId, source: "jobExpense", id: e.id, date: dt, dir: "out",
          amount: +e.amount || 0, category: e.category || "job", bookId: "",
          note: e.desc || e.vendor || "", jobId: j.id });
      });
    });

    return out;
  }) || [];
}

/* ⭐ EVERY ENTITY, ONE LIST. */
function uniRows(from, to, orgIds) {
  var orgs = uniOrgs().filter(function (o) { return !orgIds || orgIds.indexOf(o.id) >= 0; });
  var rows = [];
  orgs.forEach(function (o) {
    uniOrgRows(o.id, from, to).forEach(function (r) { r.orgName = o.name || o.id; rows.push(r); });
  });
  return rows.sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); });
}

/* a P&L per entity plus the combined line — the "how are all four doing" answer */
function uniByOrg(from, to) {
  var rows = uniRows(from, to);
  var by = {};
  rows.forEach(function (r) {
    var k = r.orgId;
    by[k] = by[k] || { orgId: k, orgName: r.orgName, in: 0, out: 0, n: 0 };
    if (r.dir === "in") by[k].in += r.amount; else by[k].out += r.amount;
    by[k].n++;
  });
  var list = Object.keys(by).map(function (k) {
    var v = by[k];
    v.in = Math.round(v.in * 100) / 100; v.out = Math.round(v.out * 100) / 100;
    v.net = Math.round((v.in - v.out) * 100) / 100;
    v.margin = v.in > 0 ? Math.round((v.in - v.out) / v.in * 1000) / 10 : null;
    return v;
  }).sort(function (a, b) { return b.in - a.in; });
  var t = list.reduce(function (s, v) { return { in: s.in + v.in, out: s.out + v.out, n: s.n + v.n }; }, { in: 0, out: 0, n: 0 });
  return { orgs: list, total: { in: Math.round(t.in * 100) / 100, out: Math.round(t.out * 100) / 100,
    net: Math.round((t.in - t.out) * 100) / 100, n: t.n } };
}

/* ---------- the card ---------- */
function uniMoney(n) { return (typeof budgetMoney === "function") ? budgetMoney(n) : "$" + (+n || 0).toFixed(2); }

function uniAllEntitiesHTML(range) {
  var r = range || ((typeof stmtRange === "function") ? stmtRange("month") : null);
  if (!r) return "";
  var g = uniByOrg(r.from, r.to);
  if (!g.total.n) return "";

  var h = '<div class="secthd"><h2 style="font-size:13px">Every business · ' + esc(r.label) + '</h2></div>'
    + '<div class="card">';
  g.orgs.forEach(function (o) {
    h += '<div class="row" style="gap:8px;align-items:baseline;padding:6px 0;border-top:1px solid var(--line)">'
      + '<div class="grow" style="min-width:0"><div class="nm" style="font-size:15px">' + esc(o.orgName) + '</div>'
      + '<div class="sub">' + esc(uniMoney(o.in)) + ' in · ' + esc(uniMoney(o.out)) + ' out'
      + (o.margin != null ? ' · ' + o.margin + '% margin' : '') + '</div></div>'
      + '<div class="nm" style="flex:0 0 auto;font-variant-numeric:tabular-nums;color:'
      + (o.net < 0 ? 'var(--danger)' : 'var(--accent)') + '">' + esc(uniMoney(o.net)) + '</div></div>';
  });
  h += '<div class="row" style="gap:8px;align-items:baseline;border-top:2px solid var(--line);margin-top:6px;padding-top:8px">'
    + '<div class="grow" style="font-weight:800">Together</div>'
    + '<div style="font-variant-numeric:tabular-nums;font-weight:800;font-size:18px;color:'
    + (g.total.net < 0 ? 'var(--danger)' : 'var(--accent)') + '">' + esc(uniMoney(g.total.net)) + '</div></div>';

  /* ⚠️ say what this is built from, because the two halves count differently and he should know */
  h += '<div class="sub" style="white-space:normal;margin-top:8px">Business figures come from your jobs, '
    + 'income and expenses; personal from your budget. Receipts and pass-through materials aren\'t counted '
    + 'twice — a receipt is filed as one of the others, and materials are billed on to the customer.</div>';
  return h + '</div>';
}

if (typeof window !== "undefined") {
  window.uniRows = uniRows; window.uniOrgRows = uniOrgRows; window.uniByOrg = uniByOrg;
  window.uniOrgs = uniOrgs; window.uniInOrg = uniInOrg; window.uniAllEntitiesHTML = uniAllEntitiesHTML;
  window.UNI_SOURCES = UNI_SOURCES;
}
if (typeof module !== "undefined" && module.exports) module.exports = { UNI_SOURCES: UNI_SOURCES };
