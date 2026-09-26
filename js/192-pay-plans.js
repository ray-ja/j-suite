/* ---------- PAY OVER TIME, IN HOUSE (js/192) ----------
   Ray, 2026-09-26: "build our own internal pay over time tool where we can split the payments into adjustable
   periods and just send them the bill every so often, rather than Affirm or Klarna, so we don't pay fees.
   Make it work for all the organizations, configurable, and set up the invoices to be sent and recorded
   automatically."

   HOW IT WORKS
   - A plan lives ON the invoice record: q.plan = { n, unit, every, start, totalCents, depositCents, autoSend,
     status, installments:[{ n, due, cents, paidCents, paidAt, ref, method, link, linkId, sentAt, reminded[] }] }.
     No new collection, no migration: it syncs with the quote (per-record LWW) like everything else.
   - The server (sync-server.js, "PAY PLANS") sweeps every half hour: an installment that comes due within the
     org's lead time gets its own Stripe link (that org's account), an email to the customer, and a message to
     the owner; overdue ones get reminders on the configured days. A paid link comes back through the Stripe
     webhook and marks THAT installment paid; the last one marks the invoice paid. Cash / Venmo installments are
     marked by hand here. Card processing still costs Stripe's 2.9%; there is no financing fee.
   - The hosted invoice (/i/<token>) shows the schedule with a pay button per installment.
   - Config per org: docs "payPlanConfig" (Settings → Pay over time): max installments, default period, days
     before due to send, reminder days, auto-send, minimum total.
   Pure helpers (schedule, status, what-to-send) are shared with the server via require and tested in
   pay-plans-tests.js. */
var PP_UNITS = { week: "Weekly", "2week": "Every 2 weeks", month: "Monthly", days: "Every N days" };
var PP_CFG_DEFAULT = { maxN: 12, defaultN: 4, defaultUnit: "month", daysBefore: 3, remindAfterDays: [3, 7, 14], autoSend: true, minTotal: 200 };
function ppPad(n) { return String(n).padStart(2, "0"); }
function ppISO(d) { return d.getFullYear() + "-" + ppPad(d.getMonth() + 1) + "-" + ppPad(d.getDate()); }
function ppParse(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(NaN); }
function ppAddDays(iso, days) { var d = ppParse(iso); if (isNaN(d)) return iso; d.setDate(d.getDate() + (+days || 0)); return ppISO(d); }
function ppAddMonths(iso, months) { var d = ppParse(iso); if (isNaN(d)) return iso; var day = d.getDate(); var t = new Date(d.getFullYear(), d.getMonth() + (+months || 0), 1); var last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); t.setDate(Math.min(day, last)); return ppISO(t); }
function ppDaysBetween(a, b) { var x = ppParse(a), y = ppParse(b); if (isNaN(x) || isNaN(y)) return 0; return Math.round((y - x) / 86400000); }
/* the schedule: totalCents split into n installments from `start`; an optional deposit is installment 1 due on
   `start` and the rest are split evenly after it. Cents never drift: the last installment takes the remainder. */
function ppSchedule(totalCents, o) {
  o = o || {}; totalCents = Math.max(0, Math.round(+totalCents || 0));
  var n = Math.max(1, Math.min(60, Math.round(+o.n || 1))), unit = o.unit || "month", every = Math.max(1, Math.round(+o.every || 30));
  var start = o.start || ppISO(new Date()), dep = Math.max(0, Math.min(totalCents, Math.round(+o.depositCents || 0)));
  var out = [], rest = totalCents - dep, k = dep > 0 ? n - 1 : n; if (k < 1) { k = 1; }
  var next = function (iso, i) { return unit === "week" ? ppAddDays(iso, 7 * i) : unit === "2week" ? ppAddDays(iso, 14 * i) : unit === "days" ? ppAddDays(iso, every * i) : ppAddMonths(iso, i); };
  var idx = 1;
  if (dep > 0) { out.push({ n: idx++, due: start, cents: dep, deposit: true }); }
  var base = Math.floor(rest / k), acc = 0;
  for (var i = 0; i < k; i++) { var c = (i === k - 1) ? rest - acc : base; acc += c; out.push({ n: idx++, due: next(start, dep > 0 ? i + 1 : i), cents: c }); }
  return out.map(function (r) { return Object.assign({ paidCents: 0, paidAt: null, ref: "", method: "", link: "", linkId: "", sentAt: null, reminded: [] }, r); });
}
/* where a plan stands today */
function ppStatus(plan, today) {
  var rows = ((plan && plan.installments) || []).map(function (r) {
    var paid = (+r.paidCents || 0) >= (+r.cents || 0) - 0; var late = !paid && ppDaysBetween(r.due, today) > 0; var dueNow = !paid && !late && ppDaysBetween(today, r.due) <= 0;
    return Object.assign({}, r, { state: paid ? "paid" : late ? "overdue" : dueNow ? "due" : "upcoming", daysLate: late ? ppDaysBetween(r.due, today) : 0 });
  });
  var paidCents = rows.reduce(function (s, r) { return s + Math.min(+r.paidCents || 0, +r.cents || 0); }, 0);
  var total = rows.reduce(function (s, r) { return s + (+r.cents || 0); }, 0);
  var next = rows.find(function (r) { return r.state !== "paid"; }) || null;
  return { rows: rows, paidCents: paidCents, totalCents: total, remainingCents: total - paidCents, next: next, overdue: rows.filter(function (r) { return r.state === "overdue"; }).length, done: rows.length > 0 && !next };
}
/* what the sweep should do today for one plan: first-time sends and reminders. Pure. */
function ppDueToSend(plan, today, cfg) {
  cfg = Object.assign({}, PP_CFG_DEFAULT, cfg || {});
  var out = { send: [], remind: [] };
  if (!plan || plan.status === "cancelled" || plan.autoSend === false) return out;
  ppStatus(plan, today).rows.forEach(function (r) {
    if (r.state === "paid") return;
    if (!r.sentAt && ppDaysBetween(today, r.due) <= (+cfg.daysBefore || 0)) out.send.push(r.n);
    if (r.state === "overdue" && r.sentAt) (cfg.remindAfterDays || []).forEach(function (d) { if (r.daysLate >= +d && (r.reminded || []).indexOf(+d) < 0) out.remind.push({ n: r.n, day: +d }); });
  });
  out.remind = out.remind.filter(function (x, i, a) { return a.findIndex(function (y) { return y.n === x.n; }) === i; });   // one reminder per installment per sweep
  return out;
}
function ppMoney(c) { return "$" + (Math.round(+c || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function ppCfgParse(text) { try { var o = JSON.parse(text || "{}"); return Object.assign({}, PP_CFG_DEFAULT, o || {}); } catch (e) { return Object.assign({}, PP_CFG_DEFAULT); } }
function ppUnitLabel(plan) { return plan.unit === "days" ? "every " + plan.every + " days" : (PP_UNITS[plan.unit] || plan.unit).toLowerCase(); }

if (typeof window !== "undefined") {
  var ppE = function (s) { return (typeof esc === "function") ? esc(String(s == null ? "" : s)) : String(s == null ? "" : s); };
  var ppCan = function () { return (typeof finCanView === "function") ? finCanView() : true; };
  function ppCfg() { try { var d = (D().docs || []).find(function (x) { return x && !x.deleted && x.id === "payPlanConfig"; }); return ppCfgParse(d && d.text); } catch (e) { return Object.assign({}, PP_CFG_DEFAULT); } }
  function ppCfgSave(cfg) { var docs = D().docs = D().docs || []; var d = docs.find(function (x) { return x && x.id === "payPlanConfig"; }); var text = JSON.stringify(cfg); if (d) { d.text = text; d.deleted = false; d.updatedAt = Date.now(); } else docs.push({ id: "payPlanConfig", text: text, updatedAt: Date.now() }); if (typeof save === "function") save(); }
  function ppQ(id) { return (D().quotes || []).find(function (x) { return x && x.id === id; }); }
  function ppSaveQ(q) { if (typeof touch === "function") touch(q); else q.updatedAt = Date.now(); if (typeof save === "function") save(); }
  function ppDueCents(q) { return Math.round(((typeof invAmountDue === "function") ? invAmountDue(q) : (+q.finalPrice || +q.total || 0)) * 100); }
  function ppBadge(state) { var m = { paid: ["✓ paid", "#0a7d4b", "#eef7f1"], overdue: ["overdue", "#b23b3b", "#f6dede"], due: ["due", "#6d4a0c", "#f6ecd0"], upcoming: ["upcoming", "var(--muted)", "var(--soft)"] }[state] || ["", "", ""]; return '<span class="badge" style="background:' + m[2] + ';color:' + m[1] + '">' + m[0] + '</span>'; }
  /* ---- the schedule card inside the invoice modal ---- */
  function ppCardHTML(q) {
    var plan = q.plan, st = ppStatus(plan, (typeof today === "function") ? today() : ppISO(new Date()));
    var h = '<div class="card" id="pp_card" style="margin-top:10px;border-left:4px solid var(--brand,#1B2A4E)"><div class="row" style="align-items:center;gap:8px"><div class="grow"><div class="nm">⏳ Pay over time · ' + st.rows.length + ' payments ' + ppE(ppUnitLabel(plan)) + '</div><div class="sub">' + ppMoney(st.paidCents) + ' paid · ' + ppMoney(st.remainingCents) + ' to go' + (plan.autoSend === false ? ' · auto-send OFF' : ' · sent automatically') + (plan.status === "cancelled" ? ' · CANCELLED' : '') + '</div></div></div>';
    h += st.rows.map(function (r) {
      var act = "";
      if (r.state !== "paid" && plan.status !== "cancelled" && ppCan()) act = '<button class="btn ghost sm" onclick="ppSendNow(\'' + q.id + '\',' + r.n + ')">' + (r.sentAt ? "Resend" : "Send now") + '</button><button class="btn acc sm" onclick="ppMarkPaid(\'' + q.id + '\',' + r.n + ')">Paid ✓</button>';
      return '<div class="li" style="padding:7px 0;align-items:flex-start;flex-wrap:wrap"><div class="grow" style="min-width:160px"><div class="nm" style="font-size:14px">' + r.n + ' · ' + ppMoney(r.cents) + ' ' + ppBadge(r.state) + '</div><div class="sub" style="white-space:normal">due ' + ppE((typeof fmtDate === "function") ? fmtDate(r.due) : r.due) + (r.paidAt ? ' · paid ' + ppE(new Date(r.paidAt).toLocaleDateString()) + (r.method ? ' by ' + ppE(r.method) : '') : r.sentAt ? ' · sent ' + ppE(new Date(r.sentAt).toLocaleDateString()) : ' · not sent yet') + (r.link ? ' · <a href="' + ppE(r.link) + '" target="_blank" rel="noopener">link</a>' : '') + '</div></div><div style="display:flex;gap:6px;flex:0 0 auto">' + act + '</div></div>';
    }).join("");
    if (ppCan() && plan.status !== "cancelled") h += '<div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost sm grow" onclick="ppToggleAuto(\'' + q.id + '\')">' + (plan.autoSend === false ? "Turn auto-send on" : "Pause auto-send") + '</button><button class="btn ghost sm grow" onclick="ppCancel(\'' + q.id + '\')">Cancel plan</button></div>';
    return h + '</div>';
  }
  function ppOfferHTML(q) {
    if (!ppCan() || q.paid) return "";
    var cfg = ppCfg(); var due = ppDueCents(q);
    if (due < Math.round((+cfg.minTotal || 0) * 100)) return "";
    return '<button class="btn ghost" id="pp_offer" style="display:block;width:100%;margin-top:8px" onclick="ppOpenBuilder(\'' + q.id + '\')">⏳ Set up pay over time (no fees)</button>';
  }
  window.ppInjectInvoice = function (quoteId) {
    try {
      var q = ppQ(quoteId); var doc = document.getElementById("inv_doc"); if (!q || !doc || document.getElementById("pp_card") || document.getElementById("pp_offer")) return;
      var html = (q.plan && q.plan.installments && q.plan.installments.length) ? ppCardHTML(q) : ppOfferHTML(q);
      if (!html) return; var w = document.createElement("div"); w.innerHTML = html; while (w.firstChild) doc.parentNode.insertBefore(w.firstChild, doc.nextSibling);
    } catch (e) {}
  };
  if (typeof window.openInvoice === "function") { var _oi = window.openInvoice; window.openInvoice = function (id) { var r = _oi.apply(this, arguments); ppInjectInvoice(id); return r; }; }
  /* ---- builder ---- */
  window.ppOpenBuilder = function (quoteId) {
    var q = ppQ(quoteId); if (!q || typeof modal !== "function") return; var cfg = ppCfg(); var due = ppDueCents(q);
    var opts = []; for (var i = 2; i <= (+cfg.maxN || 12); i++) opts.push('<option value="' + i + '"' + (i === (+cfg.defaultN || 4) ? " selected" : "") + '>' + i + ' payments</option>');
    var units = Object.keys(PP_UNITS).map(function (k) { return '<option value="' + k + '"' + (k === cfg.defaultUnit ? " selected" : "") + '>' + PP_UNITS[k] + '</option>'; }).join("");
    modal("⏳ Pay over time · " + ppMoney(due), '<div class="sub" style="white-space:normal;margin-bottom:8px">Split ' + ppMoney(due) + ' into payments on your own terms. Each one gets its own pay link and is emailed on its own; no financing company, no fee beyond card processing.</div>'
      + '<div class="row" style="gap:8px"><div class="grow"><label>How many</label><select id="pp_n" onchange="ppPreview(\'' + q.id + '\')">' + opts.join("") + '</select></div><div class="grow"><label>How often</label><select id="pp_unit" onchange="ppPreview(\'' + q.id + '\')">' + units + '</select></div></div>'
      + '<div class="row" style="gap:8px"><div class="grow" id="pp_every_wrap" style="display:' + (cfg.defaultUnit === "days" ? "" : "none") + '"><label>Every N days</label><input id="pp_every" type="number" value="30" min="1" oninput="ppPreview(\'' + q.id + '\')"></div><div class="grow"><label>First payment due</label><input id="pp_start" type="date" value="' + ppAddDays((typeof today === "function") ? today() : ppISO(new Date()), 7) + '" onchange="ppPreview(\'' + q.id + '\')"></div></div>'
      + '<div class="row" style="gap:8px"><div class="grow"><label>Deposit up front (optional)</label><input id="pp_dep" type="number" inputmode="decimal" placeholder="0" oninput="ppPreview(\'' + q.id + '\')"></div><div class="grow" style="display:flex;align-items:flex-end"><label style="display:flex;align-items:center;gap:8px;margin:0 0 10px"><input type="checkbox" id="pp_auto" ' + (cfg.autoSend === false ? "" : "checked") + ' style="width:auto"> Send each bill automatically</label></div></div>'
      + '<div id="pp_prev" style="margin-top:10px"></div>'
      + '<button class="btn acc" style="width:100%;margin-top:12px" onclick="ppCreate(\'' + q.id + '\')">Create the plan</button>');
    ppPreview(q.id);
  };
  function ppReadForm(q) {
    var n = +document.getElementById("pp_n").value, unit = document.getElementById("pp_unit").value, every = +document.getElementById("pp_every").value || 30, start = document.getElementById("pp_start").value, dep = Math.round((parseFloat(document.getElementById("pp_dep").value) || 0) * 100);
    var wrap = document.getElementById("pp_every_wrap"); if (wrap) wrap.style.display = unit === "days" ? "" : "none";
    return { n: n, unit: unit, every: every, start: start, depositCents: dep, autoSend: !!document.getElementById("pp_auto").checked, totalCents: ppDueCents(q) };
  }
  window.ppPreview = function (quoteId) {
    var q = ppQ(quoteId); if (!q) return; var f = ppReadForm(q); var rows = ppSchedule(f.totalCents, f);
    var el = document.getElementById("pp_prev"); if (!el) return;
    el.innerHTML = '<div class="sub" style="font-weight:700;margin-bottom:4px">Schedule</div>' + rows.map(function (r) { return '<div class="line"><span>' + r.n + (r.deposit ? ' · deposit' : '') + ' · due ' + ppE((typeof fmtDate === "function") ? fmtDate(r.due) : r.due) + '</span><b>' + ppMoney(r.cents) + '</b></div>'; }).join("");
  };
  window.ppCreate = function (quoteId) {
    var q = ppQ(quoteId); if (!q) return; var f = ppReadForm(q);
    if (!f.start) { alert("Pick the first due date."); return; }
    var rows = ppSchedule(f.totalCents, f);
    q.plan = { createdAt: Date.now(), n: rows.length, unit: f.unit, every: f.every, start: f.start, totalCents: f.totalCents, depositCents: f.depositCents, autoSend: f.autoSend, status: "active", installments: rows };
    if (!q.invoiced) { q.invoiced = true; q.invoicedDate = (typeof today === "function") ? today() : ppISO(new Date()); if (!q.invoiceNo && typeof invNo === "function") q.invoiceNo = invNo(q); }
    ppSaveQ(q); if (typeof closeModal === "function") closeModal(); if (typeof toast === "function") toast("Plan created: " + rows.length + " payments");
    if (typeof openInvoice === "function") openInvoice(quoteId); else if (typeof render === "function") render();
  };
  /* ---- actions ---- */
  window.ppMarkPaid = function (quoteId, n) {
    var q = ppQ(quoteId); if (!q || !q.plan) return; var r = q.plan.installments.find(function (x) { return x.n === n; }); if (!r) return;
    var method = prompt("How was payment " + n + " (" + ppMoney(r.cents) + ") made? cash / venmo / card / check", "cash"); if (method == null) return;
    r.paidCents = r.cents; r.paidAt = Date.now(); r.method = String(method || "cash").toLowerCase().slice(0, 12); r.ref = "manual";
    q.payments = q.payments || []; q.payments.push({ id: "pay_pp_" + n + "_" + Date.now().toString(36), amount: r.cents / 100, date: (typeof today === "function") ? today() : ppISO(new Date()), method: r.method, ref: "installment " + n, via: "manual", createdAt: Date.now() });
    var st = ppStatus(q.plan, (typeof today === "function") ? today() : ppISO(new Date()));
    if (st.done) { q.plan.status = "done"; q.paid = true; q.paidDate = (typeof today === "function") ? today() : ppISO(new Date()); }
    ppSaveQ(q); if (typeof toast === "function") toast("Payment " + n + " recorded"); if (typeof openInvoice === "function") openInvoice(quoteId);
  };
  window.ppToggleAuto = function (quoteId) { var q = ppQ(quoteId); if (!q || !q.plan) return; q.plan.autoSend = q.plan.autoSend === false; ppSaveQ(q); if (typeof openInvoice === "function") openInvoice(quoteId); };
  window.ppCancel = function (quoteId) { var q = ppQ(quoteId); if (!q || !q.plan) return; if (!confirm("Cancel this payment plan? Payments already made stay recorded; the rest of the balance is due on the invoice as usual.")) return; q.plan.status = "cancelled"; ppSaveQ(q); if (typeof openInvoice === "function") openInvoice(quoteId); };
  window.ppSendNow = async function (quoteId, n) {
    var base = (S.sync && S.sync.url) || "", tok = (S.sync && S.sync.token) || ""; if (!base) { alert("Sync is not set up on this device."); return; }
    try {
      var r = await fetch(base.replace(/\/+$/, "") + "/api/payplan/send", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ org: S.biz, quoteId: quoteId, n: n }) });
      var d = await r.json().catch(function () { return null; });
      if (!r.ok || !d || !d.ok) { alert("Couldn't send: " + ((d && d.error) || ("HTTP " + r.status))); return; }
      if (typeof toast === "function") toast(d.emailed ? "Sent to " + d.emailed : "Link ready (no customer email): copy it from the row");
      if (typeof syncNow === "function") { try { await syncNow(); } catch (e) {} }
      if (typeof openInvoice === "function") openInvoice(quoteId);
    } catch (e) { alert("Couldn't send: " + (e && e.message || "offline")); }
  };
  /* ---- Today card: what is due or late across this org's plans ---- */
  window.ppTodayHTML = function () {
    var t = (typeof today === "function") ? today() : ppISO(new Date());
    var rows = [];
    (D().quotes || []).forEach(function (q) { if (!q || q.deleted || !q.plan || q.plan.status !== "active") return; var st = ppStatus(q.plan, t); if (!st.next) return; var cust = (D().customers || []).find(function (c) { return c && c.id === q.customerId; }); rows.push({ q: q, st: st, name: (cust && cust.name) || q.cust || "" }); });
    if (!rows.length) return "";
    rows.sort(function (a, b) { return (b.st.overdue - a.st.overdue) || a.st.next.due.localeCompare(b.st.next.due); });
    var h = '<div class="secthd"><h2>⏳ Payment plans</h2><span class="ct">' + rows.length + '</span></div><div class="card" data-pp="1">';
    h += rows.slice(0, 6).map(function (x) { var r = x.st.next; return '<div class="li" style="padding:7px 0;align-items:center;cursor:pointer" onclick="openInvoice(\'' + x.q.id + '\')"><div class="grow"><div class="nm" style="font-size:14px">' + ppE(x.name) + ' · ' + ppMoney(r.cents) + ' ' + ppBadge(r.state) + '</div><div class="sub">payment ' + r.n + ' of ' + x.st.rows.length + ' · due ' + ppE((typeof fmtDate === "function") ? fmtDate(r.due) : r.due) + ' · ' + ppMoney(x.st.remainingCents) + ' left' + (r.sentAt ? '' : ' · not sent yet') + '</div></div><span style="color:var(--muted)">›</span></div>'; }).join("");
    return h + '</div>';
  };
  function ppToday() {
    try {
      if (typeof TAB === "undefined" || TAB !== "today") return; if (typeof orgIsPersonalOrg === "function" && orgIsPersonalOrg()) return;
      var view = document.getElementById("view"); if (!view || view.querySelector("[data-pp]")) return; var html = window.ppTodayHTML(); if (!html) return;
      var w = document.createElement("div"); w.innerHTML = html; var nodes = Array.prototype.slice.call(w.childNodes);
      var anchor = view.querySelector("[data-svc]") || null; var after = anchor; if (!after) { Array.prototype.slice.call(view.querySelectorAll(".secthd")).forEach(function (hd) { if (/Approvals/i.test(hd.textContent || "")) after = hd.nextElementSibling || hd; }); }
      var parent = after ? after.parentNode : view, ref = after ? after.nextSibling : view.firstChild; nodes.forEach(function (n) { parent.insertBefore(n, ref); });
    } catch (e) {}
  }
  /* ---- Settings section ---- */
  function ppSettingsHTML() {
    var c = ppCfg();
    return '<h2>Pay over time</h2><div class="card"><div class="sub" style="white-space:normal;margin-bottom:6px">Defaults for this organization\'s in-house payment plans. Each installment is billed on its own Stripe link and emailed automatically; no financing company.</div>'
      + '<div class="row" style="gap:8px"><div class="grow"><label>Max payments</label><input id="ppc_maxN" type="number" min="2" max="60" value="' + (+c.maxN || 12) + '"></div><div class="grow"><label>Default payments</label><input id="ppc_defaultN" type="number" min="2" value="' + (+c.defaultN || 4) + '"></div><div class="grow"><label>Default period</label><select id="ppc_unit">' + Object.keys(PP_UNITS).map(function (k) { return '<option value="' + k + '"' + (k === c.defaultUnit ? " selected" : "") + '>' + PP_UNITS[k] + '</option>'; }).join("") + '</select></div></div>'
      + '<div class="row" style="gap:8px"><div class="grow"><label>Send the bill this many days before it is due</label><input id="ppc_before" type="number" min="0" value="' + (+c.daysBefore || 0) + '"></div><div class="grow"><label>Remind when late by (days, comma separated)</label><input id="ppc_remind" value="' + ppE((c.remindAfterDays || []).join(", ")) + '"></div></div>'
      + '<div class="row" style="gap:8px"><div class="grow"><label>Smallest invoice to offer a plan on ($)</label><input id="ppc_min" type="number" min="0" value="' + (+c.minTotal || 0) + '"></div><div class="grow" style="display:flex;align-items:flex-end"><label style="display:flex;align-items:center;gap:8px;margin:0 0 10px"><input type="checkbox" id="ppc_auto" ' + (c.autoSend === false ? "" : "checked") + ' style="width:auto"> Auto-send by default</label></div></div>'
      + '<button class="btn acc" style="margin-top:8px" onclick="ppCfgSaveFromForm()">Save</button></div>';
  }
  window.ppCfgSaveFromForm = function () {
    var cfg = { maxN: Math.max(2, +document.getElementById("ppc_maxN").value || 12), defaultN: Math.max(2, +document.getElementById("ppc_defaultN").value || 4), defaultUnit: document.getElementById("ppc_unit").value, daysBefore: Math.max(0, +document.getElementById("ppc_before").value || 0), remindAfterDays: String(document.getElementById("ppc_remind").value || "").split(/[,\s]+/).map(Number).filter(function (n) { return n > 0; }), minTotal: Math.max(0, +document.getElementById("ppc_min").value || 0), autoSend: !!document.getElementById("ppc_auto").checked };
    ppCfgSave(cfg); if (typeof toast === "function") toast("Pay-over-time settings saved");
  };
  if (typeof rData === "function") { var _rData = rData; rData = function () { var r = _rData.apply(this, arguments); try { if (ppCan()) { var v = document.getElementById("view"); var w = document.createElement("div"); w.innerHTML = ppSettingsHTML(); while (w.firstChild) v.appendChild(w.firstChild); } } catch (e) {} return r; }; window.rData = rData; }
  if (typeof secSplit === "function") { var _ss4 = secSplit; secSplit = function (tab) { var r = _ss4.apply(this, arguments); ppToday(); return r; }; window.secSplit = secSplit; }
  window.ppSchedule = ppSchedule; window.ppStatus = ppStatus; window.ppCfg = ppCfg;
}
if (typeof module !== "undefined" && module.exports) { module.exports = { ppSchedule: ppSchedule, ppStatus: ppStatus, ppDueToSend: ppDueToSend, ppAddDays: ppAddDays, ppAddMonths: ppAddMonths, ppDaysBetween: ppDaysBetween, ppMoney: ppMoney, ppCfgParse: ppCfgParse, ppUnitLabel: ppUnitLabel, PP_CFG_DEFAULT: PP_CFG_DEFAULT, PP_UNITS: PP_UNITS }; }
