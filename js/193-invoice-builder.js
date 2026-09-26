/* ---------- INVOICE BUILDER (js/193) — every invoice its own terms ----------
   Ray, 2026-09-26: "our pay over time tool should be something we can choose to offer on an invoice. We
   actually need an invoice builder that lets us customize invoices for each job / customer."

   What a customer sees on /i/<token> was one fixed layout: lines, total, Due on receipt, a pay button, 3% cash
   note. Now each invoice carries its own presentation in q.inv:
     { intro, terms, dueKind ("receipt"|"net"|"date"), netDays, dueDate, cashPct, card (bool),
       offerPlan { on, n, unit, every, depositPct, firstDays, note }, footer }
   plus the existing q.itemized and the line items themselves (editable here, totals recomputed).
   The hosted page renders all of it (sync-server renderInvoicePage), including a "Pay over time" offer the
   CUSTOMER can choose: one tap builds the plan from the offered terms, sends the first bill, and tells the
   owner (POST /i/<token>/plan). The in-app invoice modal reads the same fields.
   Pure helpers are shared with the server via require and tested in invoice-builder-tests.js. */
var INV_DEFAULT = { intro: "", terms: "", dueKind: "receipt", netDays: 15, dueDate: "", cashPct: 3, card: true, offerPlan: { on: false, n: 4, unit: "month", every: 30, depositPct: 0, firstDays: 7, note: "" }, footer: "" };
function invBuilderOf(q) { var o = Object.assign({}, INV_DEFAULT, (q && q.inv) || {}); o.offerPlan = Object.assign({}, INV_DEFAULT.offerPlan, ((q && q.inv) || {}).offerPlan || {}); return o; }
function invAddDaysISO(iso, days) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); if (!m) return iso; var d = new Date(+m[1], +m[2] - 1, +m[3]); d.setDate(d.getDate() + (+days || 0)); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function invFmtUS(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? (m[2] + "/" + m[3] + "/" + m[1].slice(2)) : String(iso || ""); }
/* the due line on the invoice. Pure. */
function invDueLabel(inv, invoicedDate, today) {
  inv = inv || {}; var kind = inv.dueKind || "receipt";
  if (kind === "net") { var n = Math.max(0, +inv.netDays || 0); var by = invoicedDate ? invAddDaysISO(invoicedDate, n) : ""; var late = by && today && today > by; return "Due in " + n + " days" + (by ? " (by " + invFmtUS(by) + ")" : "") + (late ? " · past due" : ""); }
  if (kind === "date" && inv.dueDate) { var l2 = today && today > inv.dueDate; return "Due by " + invFmtUS(inv.dueDate) + (l2 ? " · past due" : ""); }
  return "Due on receipt";
}
/* the ISO date an invoice is due, or "" for on receipt. Pure. */
function invDueISO(inv, invoicedDate) { inv = inv || {}; if (inv.dueKind === "net") return invoicedDate ? invAddDaysISO(invoicedDate, Math.max(0, +inv.netDays || 0)) : ""; if (inv.dueKind === "date") return inv.dueDate || ""; return ""; }
/* cash price for a due amount at the invoice's cash discount. Pure. */
function invCashPrice(dueDollars, cashPct) { var p = Math.max(0, Math.min(50, +cashPct)); if (!(p > 0)) return { price: dueDollars, save: 0, pct: 0 }; var price = Math.round(dueDollars * (1 - p / 100) * 100) / 100; return { price: price, save: Math.round((dueDollars - price) * 100) / 100, pct: p }; }
/* recompute an invoice's money from its items (discount kept as-is). Pure; returns the patch. */
function invRecalc(items, discount) {
  var sub = 0, cost = 0; (items || []).forEach(function (i) { if (!i) return; var qty = +i.qty || 1; sub += (+i.price || 0) * qty; cost += (+i.cost || 0) * qty; });
  sub = Math.round(sub * 100) / 100; var disc = Math.round((+discount || 0) * 100) / 100;
  return { subtotal: sub, cost: Math.round(cost * 100) / 100, discount: disc, total: Math.round((sub - disc) * 100) / 100 };
}
/* the offer, turned into a real plan when the customer picks it. Pure. */
function invOfferToPlan(offer, dueCents, todayISO, schedule) {
  offer = Object.assign({}, INV_DEFAULT.offerPlan, offer || {});
  var dep = Math.round(dueCents * Math.max(0, Math.min(90, +offer.depositPct || 0)) / 100);
  var start = dep > 0 ? todayISO : invAddDaysISO(todayISO, Math.max(0, +offer.firstDays || 0));
  var n = Math.max(2, Math.min(60, +offer.n || 4));
  var inst = schedule(dueCents, { n: n, unit: offer.unit || "month", every: +offer.every || 30, start: start, depositCents: dep });
  return { createdAt: Date.now(), chosenBy: "customer", n: inst.length, unit: offer.unit || "month", every: +offer.every || 30, start: start, totalCents: dueCents, depositCents: dep, autoSend: true, status: "active", installments: inst };
}
function invOfferLabel(offer) { offer = Object.assign({}, INV_DEFAULT.offerPlan, offer || {}); var u = { week: "weekly", "2week": "every 2 weeks", month: "monthly", days: "every " + (+offer.every || 30) + " days" }[offer.unit || "month"]; return offer.n + " payments, " + u + (offer.depositPct > 0 ? ", " + offer.depositPct + "% down today" : offer.firstDays > 0 ? ", first one in " + offer.firstDays + " days" : ", first one today"); }

if (typeof window !== "undefined") {
  var ibE = function (s) { return (typeof esc === "function") ? esc(String(s == null ? "" : s)) : String(s == null ? "" : s); };
  var ibCan = function () { return (typeof finCanView === "function") ? finCanView() : true; };
  function ibQ(id) { return (D().quotes || []).find(function (x) { return x && x.id === id; }); }
  var IB_ITEMS = [];   // the rows being edited in the open builder (saved on Save, discarded on close)
  window.ibOpen = function (quoteId) {
    var q = ibQ(quoteId); if (!q || typeof modal !== "function") return; var v = invBuilderOf(q); var op = v.offerPlan;
    IB_ITEMS = (q.items || []).map(function (i) { return { serviceId: i.serviceId || "", name: i.name || "", qty: +i.qty || 1, price: +i.price || 0, cost: +i.cost || 0, notes: i.notes || [], bandKey: i.bandKey, passThrough: !!i.passThrough }; });
    var units = { week: "Weekly", "2week": "Every 2 weeks", month: "Monthly", days: "Every N days" };
    modal("✏️ Customize invoice", ''
      + '<div class="sub" style="white-space:normal;margin-bottom:8px">Everything here is what ' + ibE(q.cust || "the customer") + ' sees on this invoice and nothing else.</div>'
      + '<div style="font-weight:800;margin:6px 0 4px">Line items</div><div id="ib_items"></div><button class="btn ghost sm" style="margin-top:6px" onclick="ibAddItem()">+ Add a line</button>'
      + '<div id="ib_totals" class="sub" style="margin-top:6px"></div>'
      + '<label>Message at the top (optional)</label><textarea id="ib_intro" placeholder="Thanks for having us out. Here is the bill for the garage clearout.">' + ibE(v.intro) + '</textarea>'
      + '<div class="row" style="gap:8px"><div class="grow"><label>Due</label><select id="ib_dueKind" onchange="ibDueKind()"><option value="receipt"' + (v.dueKind === "receipt" ? " selected" : "") + '>On receipt</option><option value="net"' + (v.dueKind === "net" ? " selected" : "") + '>In N days</option><option value="date"' + (v.dueKind === "date" ? " selected" : "") + '>By a date</option></select></div>'
      + '<div class="grow" id="ib_net_wrap"><label>Days</label><input id="ib_netDays" type="number" min="0" value="' + (+v.netDays || 15) + '"></div><div class="grow" id="ib_date_wrap"><label>Date</label><input id="ib_dueDate" type="date" value="' + ibE(v.dueDate) + '"></div></div>'
      + '<div style="font-weight:800;margin:12px 0 4px">Ways to pay</div>'
      + '<label style="display:flex;align-items:center;gap:8px;margin:4px 0"><input type="checkbox" id="ib_card" ' + (v.card !== false ? "checked" : "") + ' style="width:auto"> Card online (Stripe link)</label>'
      + '<div class="row" style="gap:8px;align-items:flex-end"><div class="grow"><label>Cash / check discount (%)</label><input id="ib_cashPct" type="number" min="0" max="50" step="0.5" value="' + (+v.cashPct) + '"></div><div class="grow sub" style="white-space:normal;padding-bottom:10px">0 hides the cash note.</div></div>'
      + '<label style="display:flex;align-items:center;gap:8px;margin:8px 0 4px"><input type="checkbox" id="ib_offer" ' + (op.on ? "checked" : "") + ' style="width:auto" onchange="ibOfferToggle()"> Offer pay over time (they pick it on the invoice)</label>'
      + '<div id="ib_offer_wrap" style="' + (op.on ? "" : "display:none;") + 'background:var(--soft);border-radius:10px;padding:8px 10px">'
      + '<div class="row" style="gap:8px"><div class="grow"><label>Payments</label><input id="ib_op_n" type="number" min="2" max="60" value="' + (+op.n || 4) + '"></div><div class="grow"><label>How often</label><select id="ib_op_unit" onchange="ibOfferPreview()">' + Object.keys(units).map(function (k) { return '<option value="' + k + '"' + (k === op.unit ? " selected" : "") + '>' + units[k] + '</option>'; }).join("") + '</select></div></div>'
      + '<div class="row" style="gap:8px"><div class="grow" id="ib_op_every_wrap" style="display:' + (op.unit === "days" ? "" : "none") + '"><label>Every N days</label><input id="ib_op_every" type="number" min="1" value="' + (+op.every || 30) + '"></div><div class="grow"><label>Down payment today (%)</label><input id="ib_op_dep" type="number" min="0" max="90" value="' + (+op.depositPct || 0) + '"></div><div class="grow"><label>First payment in (days)</label><input id="ib_op_first" type="number" min="0" value="' + (+op.firstDays || 0) + '"></div></div>'
      + '<label>Note next to the offer (optional)</label><input id="ib_op_note" value="' + ibE(op.note) + '" placeholder="No interest, no fees. Cancel any time by paying the balance."></div>'
      + '<label>Terms / notes at the bottom (optional)</label><textarea id="ib_terms" placeholder="Disposal billed at scale weight. Balance due when the work is finished.">' + ibE(v.terms) + '</textarea>'
      + '<label>Footer line (optional)</label><input id="ib_footer" value="' + ibE(v.footer) + '" placeholder="Thank you for your business!">'
      + '<label style="display:flex;align-items:center;gap:8px;margin:10px 0 0"><input type="checkbox" id="ib_itemized" ' + (q.itemized ? "checked" : "") + ' style="width:auto"> Show each line item to the customer (off = one total)</label>'
      + '<div class="row" style="gap:8px;margin-top:12px"><button class="btn acc grow" onclick="ibSave(\'' + q.id + '\')">Save invoice</button><button class="btn ghost" onclick="closeModal();openInvoice(\'' + q.id + '\')">Cancel</button></div>');
    ibRenderItems(); ibDueKind();
  };
  function ibRenderItems() {
    var el = document.getElementById("ib_items"); if (!el) return;
    el.innerHTML = IB_ITEMS.map(function (i, k) { return '<div class="row" style="gap:6px;margin-bottom:6px;align-items:center"><input class="grow" style="min-width:0" placeholder="What" value="' + ibE(i.name) + '" oninput="IB_ITEMS[' + k + '].name=this.value"><input type="number" inputmode="decimal" style="width:56px" value="' + i.qty + '" oninput="IB_ITEMS[' + k + '].qty=+this.value||1;ibTotals()" title="Qty"><input type="number" inputmode="decimal" style="width:92px" value="' + i.price + '" oninput="IB_ITEMS[' + k + '].price=+this.value||0;ibTotals()" title="Price"><button class="btn ghost sm" onclick="ibDelItem(' + k + ')" title="Remove">✕</button></div>'; }).join("") || '<div class="sub">No lines yet.</div>';
    ibTotals();
  }
  window.ibTotals = function () { var el = document.getElementById("ib_totals"); if (!el) return; var r = invRecalc(IB_ITEMS, 0); el.textContent = "Subtotal " + ((typeof money2 === "function") ? money2(r.subtotal) : r.subtotal); };
  window.ibAddItem = function () { IB_ITEMS.push({ serviceId: "", name: "", qty: 1, price: 0, cost: 0, notes: [] }); ibRenderItems(); var inputs = document.querySelectorAll("#ib_items input"); if (inputs.length) inputs[inputs.length - 3].focus(); };
  window.ibDelItem = function (k) { IB_ITEMS.splice(k, 1); ibRenderItems(); };
  window.ibDueKind = function () { var k = document.getElementById("ib_dueKind").value; document.getElementById("ib_net_wrap").style.display = k === "net" ? "" : "none"; document.getElementById("ib_date_wrap").style.display = k === "date" ? "" : "none"; };
  window.ibOfferToggle = function () { document.getElementById("ib_offer_wrap").style.display = document.getElementById("ib_offer").checked ? "" : "none"; };
  window.ibOfferPreview = function () { var w = document.getElementById("ib_op_every_wrap"); if (w) w.style.display = document.getElementById("ib_op_unit").value === "days" ? "" : "none"; };
  window.ibSave = function (quoteId) {
    var q = ibQ(quoteId); if (!q) return;
    var items = IB_ITEMS.filter(function (i) { return i && (String(i.name).trim() || +i.price); }).map(function (i) { return Object.assign({ unit: "job" }, i, { name: String(i.name).trim() || "Item", qty: +i.qty || 1, price: Math.round((+i.price || 0) * 100) / 100 }); });
    if (!items.length) { alert("Keep at least one line."); return; }
    if (q.paid && !confirm("This invoice is already paid. Change the lines anyway?")) return;
    q.items = items; Object.assign(q, invRecalc(items, q.discount));
    q.inv = { intro: String(document.getElementById("ib_intro").value || "").slice(0, 600), terms: String(document.getElementById("ib_terms").value || "").slice(0, 1200), dueKind: document.getElementById("ib_dueKind").value, netDays: Math.max(0, +document.getElementById("ib_netDays").value || 0), dueDate: document.getElementById("ib_dueDate").value || "", cashPct: Math.max(0, Math.min(50, +document.getElementById("ib_cashPct").value || 0)), card: !!document.getElementById("ib_card").checked,
      offerPlan: { on: !!document.getElementById("ib_offer").checked, n: Math.max(2, +document.getElementById("ib_op_n").value || 4), unit: document.getElementById("ib_op_unit").value, every: Math.max(1, +document.getElementById("ib_op_every").value || 30), depositPct: Math.max(0, Math.min(90, +document.getElementById("ib_op_dep").value || 0)), firstDays: Math.max(0, +document.getElementById("ib_op_first").value || 0), note: String(document.getElementById("ib_op_note").value || "").slice(0, 200) },
      footer: String(document.getElementById("ib_footer").value || "").slice(0, 200) };
    q.itemized = !!document.getElementById("ib_itemized").checked;
    if (typeof touch === "function") touch(q); else q.updatedAt = Date.now(); if (typeof save === "function") save();
    if (typeof toast === "function") toast("Invoice updated"); if (typeof closeModal === "function") closeModal(); if (typeof openInvoice === "function") openInvoice(quoteId);
  };
  /* the button in the invoice modal + a one-line summary of what this invoice offers */
  window.ibInjectInvoice = function (quoteId) {
    try {
      var q = ibQ(quoteId); var doc = document.getElementById("inv_doc"); if (!q || !doc || document.getElementById("ib_btn") || !ibCan()) return;
      var v = invBuilderOf(q); var bits = [invDueLabel(v, q.invoicedDate || q.date, (typeof today === "function") ? today() : "")];
      if (v.card === false) bits.push("no card link"); if (+v.cashPct > 0) bits.push(v.cashPct + "% cash"); else bits.push("no cash discount");
      if (v.offerPlan && v.offerPlan.on) bits.push("offers pay over time: " + invOfferLabel(v.offerPlan)); if (q.plan && q.plan.chosenBy === "customer") bits.push("customer chose pay over time");
      var w = document.createElement("div"); w.innerHTML = '<div class="row" style="gap:8px;margin-top:8px;align-items:center"><div class="grow sub" style="white-space:normal">' + ibE(bits.join(" · ")) + '</div><button class="btn ghost sm" id="ib_btn" onclick="ibOpen(\'' + q.id + '\')">✏️ Customize</button></div>';
      doc.parentNode.insertBefore(w.firstChild, doc.nextSibling);
    } catch (e) {}
  };
  if (typeof window.openInvoice === "function") { var _oi2 = window.openInvoice; window.openInvoice = function (id) { var r = _oi2.apply(this, arguments); ibInjectInvoice(id); return r; }; }
  /* the in-app cash note honours the invoice's own percentage (js/46's is a fixed 3%) */
  if (typeof invCashNote === "function") { invCashNote = function (q) { var v = invBuilderOf(q); if (!(+v.cashPct > 0)) return ""; var due = (typeof invAmountDue === "function") ? invAmountDue(q) : (+q.total || 0); var c = invCashPrice(due, v.cashPct); return "💵 Paying cash or check? Save " + c.pct + "% — " + ((typeof money2 === "function") ? money2(c.price) : c.price) + " (you save " + ((typeof money2 === "function") ? money2(c.save) : c.save) + ")"; }; window.invCashNote = invCashNote; }
  window.invBuilderOf = invBuilderOf; window.invDueLabel = invDueLabel; window.invRecalc = invRecalc; window.invOfferLabel = invOfferLabel;
}
if (typeof module !== "undefined" && module.exports) { module.exports = { INV_DEFAULT: INV_DEFAULT, invBuilderOf: invBuilderOf, invDueLabel: invDueLabel, invDueISO: invDueISO, invCashPrice: invCashPrice, invRecalc: invRecalc, invOfferToPlan: invOfferToPlan, invOfferLabel: invOfferLabel, invAddDaysISO: invAddDaysISO }; }
