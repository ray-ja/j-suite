/* ---------- ORDER HISTORY → WHAT THE CHARGE ACTUALLY WAS (js/162) ---------------------------------------
   Ray, 2026-08-27: "I can import my Amazon order history too to help reconcile. we need to automate as much
   as possible I don't have time to be an accountant too."

   ⚠️ THE PROBLEM IS REAL AND MEASURED. His pull has 27 rows that say nothing but "Amazon", totalling
   $1,543.73 — including one for $358.19. A bank feed knows the merchant and the amount and nothing else, so
   "Amazon" is 27 identical-looking rows that could be a drill bit or a birthday present, and no amount of
   categorising by payee will ever separate them. The order history is the only place the answer exists.

   ⭐ SO THIS ATTACHES DETAIL, IT DOES NOT CREATE TRANSACTIONS. The bank already told us the money moved;
   importing orders as spending would double-count every single one. An order row matches a bank row and
   lends it a description. Nothing is added to the ledger, no amount changes, no category is set.

   ⛔ AND IT WRITES `detail`, NEVER `note`. The note is what the payee key is derived from, which is what the
   learning table and the payee grouping are built on — rewriting it would scatter 27 Amazon rows into 27
   one-row groups and orphan every rule keyed to "amazon". Detail is a separate field, shown alongside.

   ⚠️ COLUMN-AGNOSTIC ON PURPOSE. Amazon has changed its export layout repeatedly — "Item Total" became
   "Total Owed", "Title" became "Product Name" — and this should not break the next time they do it, nor be
   useless for a Home Depot or Costco export. Columns are found by what they LOOK like, with Amazon's known
   names as hints rather than requirements. */

var OI_DAYS = 5;          // Amazon charges on despatch, which trails the order date — five days is realistic

function oiNorm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function oiMoney(v) {
  var n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? Math.abs(n) : 0;
}
/* accepts 2026-08-13, 08/13/2026, 13 Aug 2026 — and returns "" rather than a wrong guess */
function oiDate(v) {
  var s = String(v == null ? "" : v).trim();
  if (!s) return "";
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/.exec(s);
  if (m) return m[3] + "-" + ("0" + m[1]).slice(-2) + "-" + ("0" + m[2]).slice(-2);
  var d = Date.parse(s);
  if (!isNaN(d)) return new Date(d).toISOString().slice(0, 10);
  return "";
}

/* ⭐ FIND THE COLUMNS BY WHAT THEY ARE, not by what this year's export happens to call them. */
var OI_COLS = {
  date:   [/^(order|purchase|transaction|ship(ment)?)\s*date$/, /date/],
  desc:   [/^(product\s*name|title|item(\s*name)?|description)$/, /product|title|item|descript/],
  amount: [/^(total\s*owed|item\s*total|order\s*total|amount|total)$/, /total|amount|price/],
  order:  [/^(order\s*(id|number|#))$/, /order.*(id|no|num)/]
};
function oiFindCols(headerRow) {
  var H = (headerRow || []).map(oiNorm);
  var out = { date: -1, desc: -1, amount: -1, order: -1 };
  Object.keys(OI_COLS).forEach(function (k) {
    var pats = OI_COLS[k];
    for (var p = 0; p < pats.length && out[k] < 0; p++) {
      for (var i = 0; i < H.length; i++) {
        if (out[k] >= 0) break;
        /* ⛔ a column already claimed by another field can't be reused — "Order Date" must not also
           become the description just because "date" appears in a loose pattern */
        var taken = Object.keys(out).some(function (o) { return o !== k && out[o] === i; });
        if (!taken && pats[p].test(H[i].replace(/\s+/g, " "))) out[k] = i;
      }
    }
  });
  return out;
}

/* rows -> [{date, desc, amount, order}] — header row detected and dropped */
function oiParse(text) {
  var rows = (typeof budgetParseCSV === "function") ? budgetParseCSV(text) : [];
  if (rows.length < 2) return { rows: [], cols: null, skipped: 0 };
  var cols = oiFindCols(rows[0]);
  if (cols.date < 0 || cols.amount < 0) return { rows: [], cols: cols, skipped: rows.length - 1 };
  var out = [], skipped = 0;
  rows.slice(1).forEach(function (r) {
    var d = oiDate(r[cols.date]), a = oiMoney(r[cols.amount]);
    if (!d || !a) { skipped++; return; }
    out.push({ date: d, amount: a,
      desc: cols.desc >= 0 ? String(r[cols.desc] || "").trim() : "",
      order: cols.order >= 0 ? String(r[cols.order] || "").trim() : "" });
  });
  return { rows: out, cols: cols, skipped: skipped };
}

/* ⭐ ONE ORDER CLAIMS ONE CHARGE. Amazon splits an order across shipments, so the same amount can appear
   twice legitimately; a claimed set keeps it one-to-one exactly as the receipt tie does. */
function oiMatch(orders, vendorHint) {
  var tx = [];
  try {
    tx = (typeof ledgerTx === "function" ? ledgerTx() : []).filter(function (t) {
      if ((t.dir || "out") !== "out" || t.isTransfer || t.isCardPayment) return false;
      if (t.detail) return false;                                   // already knows what it was
      if (!vendorHint) return true;
      return (typeof ledgerSamePayee === "function") ? ledgerSamePayee(t.note, vendorHint) : true;
    });
  } catch (e) {}
  var claimed = {}, pairs = [], unmatched = [];
  orders.forEach(function (o) {
    var cents = Math.round(o.amount * 100);
    var hit = tx.find(function (t) {
      if (claimed[t.id]) return false;
      if (Math.round(Math.abs(+t.amount || 0) * 100) !== cents) return false;
      var dd = Math.abs(Date.parse(t.date + "T00:00:00Z") - Date.parse(o.date + "T00:00:00Z")) / 86400000;
      return isFinite(dd) && dd <= OI_DAYS;
    });
    if (hit) { claimed[hit.id] = true; pairs.push({ order: o, tx: hit }); }
    else unmatched.push(o);
  });
  return { pairs: pairs, unmatched: unmatched };
}

/* ⛔ APPLY WRITES ONE FIELD. detail + the order number, and nothing else, ever. */
function oiApply(pairs) {
  var n = 0;
  (pairs || []).forEach(function (p) {
    if (!p || !p.tx) return;
    var d = String(p.order.desc || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (!d && !p.order.order) return;
    p.tx.detail = d;
    if (p.order.order) p.tx.orderRef = String(p.order.order).slice(0, 40);
    if (typeof touch === "function") touch(p.tx);
    n++;
  });
  if (n && typeof save === "function") save();
  return n;
}

if (typeof window !== "undefined") {
  window.oiParse = oiParse; window.oiMatch = oiMatch; window.oiApply = oiApply;
  window.oiFindCols = oiFindCols; window.oiDate = oiDate; window.oiMoney = oiMoney;

  window.oiPickFile = function () { var el = document.getElementById("oi_file"); if (el) el.click(); };

  window.oiHandleFile = function (file) {
    if (!file) return;
    var vendor = /amazon/i.test(file.name || "") ? "Amazon" : "";
    var rd = new FileReader();
    rd.onload = function () {
      var parsed = oiParse(String(rd.result || ""));
      if (!parsed.rows.length) {
        alert("I couldn't find a date and an amount column in that file.\n\n"
          + "An order history export should have something like Order Date and Total Owed. "
          + "If the columns are named oddly, tell me what they're called and I'll teach it.");
        return;
      }
      if (!vendor) {
        vendor = prompt("Which merchant is this order history from?\n\n"
          + "(Used to match against bank rows from that merchant — leave blank to match on amount and date alone.)", "Amazon");
        if (vendor === null) return;
      }
      var m = oiMatch(parsed.rows, vendor.trim());
      if (!m.pairs.length) {
        alert(parsed.rows.length + " orders read, but none line up with a bank transaction.\n\n"
          + "Either those charges aren't in yet, or they were paid from an account that isn't connected.");
        return;
      }
      var sample = m.pairs.slice(0, 3).map(function (p) {
        return "  " + p.tx.date + "  $" + p.tx.amount + "  →  " + String(p.order.desc || "").slice(0, 44);
      }).join("\n");
      if (!confirm("Matched " + m.pairs.length + " of " + parsed.rows.length + " orders to a bank transaction:\n\n"
        + sample + (m.pairs.length > 3 ? "\n  …" : "")
        + "\n\nThis only adds the description. No transactions are created, no amounts or categories change.")) return;
      var n = oiApply(m.pairs);
      if (typeof toast === "function") {
        toast(n + " transaction" + (n === 1 ? "" : "s") + " now say what " + (n === 1 ? "it was" : "they were")
          + (m.unmatched.length ? " · " + m.unmatched.length + " orders had no matching charge" : ""));
      }
      if (typeof render === "function") render();
    };
    rd.onerror = function () { alert("Couldn't read that file."); };
    rd.readAsText(file);
  };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { oiParse: oiParse, oiMatch: oiMatch, oiApply: oiApply, oiFindCols: oiFindCols, oiDate: oiDate, oiMoney: oiMoney, OI_DAYS: OI_DAYS };
}
