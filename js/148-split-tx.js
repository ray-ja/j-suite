/* ---------- SPLIT TRANSACTIONS (js/148) — one payment, several categories ----------------------------
   The Lowe's run that is half materials for a job and half a new drill bit for the truck. One swipe at the
   bank, two different things in the budget. QuickBooks and YNAB both consider this table stakes, and
   without it every mixed receipt gets filed wholly wrong on purpose.

   ⭐ SPLITS ARE CHILD RECORDS, NOT AN ARRAY ON THE PARENT. CLAUDE.md is blunt about this and it is right:
   sync is per-record last-write-wins, so a nested array is clobbered wholesale by whichever device saved
   last. The same lesson already cost this app once — job.materials/expenses had to become their own
   collections for exactly this reason. So each slice is a real budgetTx row with its own id and its own
   updatedAt, linked by `parentTxId`. Two phones can edit two slices of the same receipt and both survive.

   ⚠️ AND HERE IS THE PART THAT IS EASY TO GET WRONG IN BOTH DIRECTIONS AT ONCE. The money moved exactly
   once. So:

       income & spending  →  count the SLICES, ignore the parent   (the parent has no category)
       account balance    →  count the PARENT, ignore the slices   (the cash left once)

   Filter only one of those and the same dollar is either counted twice or vanishes. It is the identical
   subtlety as transfers, in mirror image, and the two gates live in different files — actBudgetTx() in
   js/79 and acctTx() in js/145 — so a change to one is not obviously a change to the other. */

function splActive(arr) { return (arr || []).filter(function (x) { return x && !x.deleted; }); }
function splTx() { try { return splActive(D().budgetTx); } catch (e) { return []; } }

function splChildren(parentId) {
  return splTx().filter(function (t) { return t.parentTxId === parentId; })
    .sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
}
function splIsParent(t) { return !!(t && t.isSplit); }
function splIsChild(t) { return !!(t && t.parentTxId); }
function splTotal(parentId) {
  return Math.round(splChildren(parentId).reduce(function (s, c) { return s + (+c.amount || 0); }, 0) * 100) / 100;
}
/* what is left to account for — the number he is trying to drive to zero */
function splRemaining(parent) {
  return Math.round(((+parent.amount || 0) - splTotal(parent.id)) * 100) / 100;
}

/* ⭐ SPLIT A TRANSACTION. `rows` = [{amount, catId, note}]. The parent keeps the full amount and loses its
   category; each row becomes a child. Returns null and changes nothing if the rows don't add up — a split
   that doesn't reconcile to the payment is a bookkeeping error, not a rounding preference. */
function splApply(txId, rows) {
  var d = D();
  var parent = splTx().find(function (t) { return t.id === txId; });
  if (!parent || splIsChild(parent)) return null;
  /* ⚠️ a null row threw here. Money code that throws leaves a half-written split behind and a modal that
     never closes — every row is coerced, none is trusted. */
  var clean = (Array.isArray(rows) ? rows : []).filter(Boolean).map(function (r) {
    if (typeof r !== "object") return { amount: 0, catId: "", note: "" };
    return { amount: Math.round(Math.abs(+r.amount || 0) * 100) / 100,
             catId: (typeof budgetCat === "function" && budgetCat(r.catId)) ? r.catId : "",
             note: String(r.note || "").slice(0, 120) };
  }).filter(function (r) { return r.amount > 0.005; });
  if (clean.length < 2) return null;                       // one slice is not a split
  var sum = Math.round(clean.reduce(function (s, r) { return s + r.amount; }, 0) * 100) / 100;
  if (Math.abs(sum - (+parent.amount || 0)) > 0.005) return null;   // ⛔ must reconcile to the payment

  /* replace any previous slices rather than accumulating them */
  splChildren(parent.id).forEach(function (c) { c.deleted = true; if (typeof touch === "function") touch(c); });

  clean.forEach(function (r) {
    var child = {
      id: "bgt-tx-" + (typeof uid === "function" ? uid() : String(Date.now()) + Math.random().toString(36).slice(2, 6)),
      parentTxId: parent.id,
      bookId: parent.bookId, accountId: parent.accountId, date: parent.date, dir: parent.dir,
      amount: r.amount, catId: r.catId,
      note: r.note || parent.note, pending: false, deleted: false
    };
    if (typeof touch === "function") touch(child);
    d.budgetTx.push(child);
  });

  parent.isSplit = true;
  parent.catId = "";                                       // ⛔ the parent must never also carry a category
  if (typeof touch === "function") touch(parent);
  if (typeof save === "function") save();
  return { parent: parent.id, slices: clean.length, total: sum };
}

/* put it back to a single line */
function splUnsplit(txId, catId) {
  var parent = splTx().find(function (t) { return t.id === txId; });
  if (!parent || !parent.isSplit) return null;
  splChildren(parent.id).forEach(function (c) { c.deleted = true; if (typeof touch === "function") touch(c); });
  parent.isSplit = false;
  parent.catId = (typeof budgetCat === "function" && budgetCat(catId)) ? catId : "";
  if (typeof touch === "function") touch(parent);
  if (typeof save === "function") save();
  return parent;
}

if (typeof window !== "undefined") {
  window.splChildren = splChildren; window.splIsParent = splIsParent; window.splIsChild = splIsChild;
  window.splTotal = splTotal; window.splRemaining = splRemaining;
  window.splApply = splApply; window.splUnsplit = splUnsplit;

  /* ---- the editor ---- */
  window.SPL_ROWS = null;
  window.openSplit = function (txId) {
    var t = splTx().find(function (x) { return x.id === txId; });
    if (!t) return;
    var kids = splChildren(txId);
    window.SPL_ROWS = kids.length
      ? kids.map(function (c) { return { amount: +c.amount || 0, catId: c.catId || "", note: c.note || "" }; })
      : [{ amount: +t.amount || 0, catId: "", note: "" }, { amount: 0, catId: "", note: "" }];
    window.SPL_TX = txId;
    splRender();
  };
  window.splAddRow = function () { (window.SPL_ROWS = window.SPL_ROWS || []).push({ amount: 0, catId: "", note: "" }); splSync(); splRender(); };
  window.splDelRow = function (i) { splSync(); window.SPL_ROWS.splice(i, 1); splRender(); };
  window.splSync = function () {
    (window.SPL_ROWS || []).forEach(function (r, i) {
      var a = document.getElementById("spl_amt_" + i), c = document.getElementById("spl_cat_" + i);
      if (a) r.amount = parseFloat(a.value) || 0;
      if (c) r.catId = c.value;
    });
  };
  window.splRecalc = function () { splSync(); splRender(); };

  window.splRender = function () {
    var t = splTx().find(function (x) { return x.id === window.SPL_TX; });
    if (!t) return;
    var rows = window.SPL_ROWS || [];
    var sum = Math.round(rows.reduce(function (s, r) { return s + (+r.amount || 0); }, 0) * 100) / 100;
    var left = Math.round(((+t.amount || 0) - sum) * 100) / 100;
    var money = function (n) { return (typeof budgetMoney === "function") ? budgetMoney(n) : "$" + n; };
    var cats = [];
    try {
      cats = (D().budgetCats || []).filter(function (c) {
        return c && !c.deleted && c.bookId === t.bookId && !c.paymentEnvelope && !c.taxEnvelope
          && (c.kind || "out") === (t.dir === "in" ? "in" : "out");
      }).sort(function (a, b) { return (a.order || 0) - (b.order || 0) || String(a.name || "").localeCompare(b.name || ""); });
    } catch (e) {}

    var body = '<p class="muted" style="margin:0 0 8px;font-size:13px">'
      + esc(t.note || "") + ' · ' + esc(money(t.amount)) + '</p>'
      + rows.map(function (r, i) {
          return '<div class="row" style="gap:6px;align-items:flex-end;margin-bottom:6px">'
            + '<div style="flex:0 0 96px"><label style="margin:0">Amount</label>'
            + '<input id="spl_amt_' + i + '" type="number" inputmode="decimal" step="0.01" value="' + (r.amount || "") + '" onchange="splRecalc()"></div>'
            + '<div class="grow" style="min-width:0"><label style="margin:0">Category</label><select id="spl_cat_' + i + '" onchange="splSync()">'
            + '<option value="">— pick —</option>'
            + cats.map(function (c) { return '<option value="' + c.id + '"' + (r.catId === c.id ? " selected" : "") + '>' + esc(c.name) + '</option>'; }).join("")
            + '</select></div>'
            + (rows.length > 2 ? '<button class="btn ghost sm" style="flex:0 0 auto;width:auto" onclick="splDelRow(' + i + ')">✕</button>' : '')
            + '</div>';
        }).join("")
      + '<button class="btn ghost sm" style="width:100%;margin-top:2px" onclick="splAddRow()">＋ Another line</button>'
      /* ⭐ the number he drives to zero — a split that doesn't add up is a bookkeeping error */
      + '<div class="row" style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px">'
      +   '<div class="grow sub">' + (Math.abs(left) < 0.005 ? 'Adds up' : (left > 0 ? 'Still to assign' : 'Over by')) + '</div>'
      +   '<div class="nm" style="font-variant-numeric:tabular-nums;color:'
      +     (Math.abs(left) < 0.005 ? 'var(--accent)' : 'var(--danger)') + '">'
      +     esc(money(Math.abs(left))) + '</div></div>'
      + '<button class="btn acc" style="margin-top:10px;width:100%"' + (Math.abs(left) < 0.005 ? '' : ' disabled')
      + ' onclick="splSave()">Save split</button>'
      + (t.isSplit ? '<button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="splRemove()">Undo the split</button>' : '');

    var sheet = document.querySelector(".sheet");
    if (sheet && window._splOpen) { var b = sheet.querySelector("[data-splbody]"); if (b) { b.innerHTML = body; return; } }
    window._splOpen = true;
    modal("Split this transaction", '<div data-splbody>' + body + '</div>');
  };

  window.splSave = function () {
    splSync();
    var res = splApply(window.SPL_TX, window.SPL_ROWS || []);
    if (!res) { alert("The lines have to add up to the payment."); return; }
    window._splOpen = false;
    if (typeof closeModal === "function") closeModal();
    if (typeof render === "function") render();
  };
  window.splRemove = function () {
    splUnsplit(window.SPL_TX, "");
    window._splOpen = false;
    if (typeof closeModal === "function") closeModal();
    if (typeof render === "function") render();
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { splIsParent: splIsParent };
