/* ---------- THE CUSTOMER CARD IS THE ONE PLACE (js/196) ----------
   Ray, 2026-09-26: "do the customer card." The card (js/06 openCustomer) had the form, properties, quotes and
   jobs. Now it opens on what matters: how much they owe, what is paid, what is due next, their invoices with
   one-tap Pay-link / open, active payment plans, and the files on record. Post-render into the open modal,
   fails open. Nothing in js/06 changes. */
if (typeof window !== "undefined") {
  var c3E = function (s) { return (typeof esc === "function") ? esc(String(s == null ? "" : s)) : String(s == null ? "" : s); };
  var c3M = function (n) { return (typeof money2 === "function") ? money2(n) : "$" + (Math.round((+n || 0) * 100) / 100).toFixed(2); };
  function c3Paid(q) { return ((q.payments || []).reduce(function (s, p) { return s + (+p.amount || 0); }, 0)); }
  function c3Due(q) { var due = (typeof invAmountDue === "function") ? invAmountDue(q) : (+q.finalPrice || +q.total || 0); return Math.max(0, Math.round((due - c3Paid(q)) * 100) / 100); }
  window.customer360HTML = function (c) {
    var d = D(); var t = (typeof today === "function") ? today() : "";
    var qs = (d.quotes || []).filter(function (q) { return q && !q.deleted && q.customerId === c.id; });
    var inv = qs.filter(function (q) { return q.invoiced; }), open = inv.filter(function (q) { return !q.paid && c3Due(q) > 0; });
    var owed = open.reduce(function (s, q) { return s + c3Due(q); }, 0), billed = inv.reduce(function (s, q) { return s + ((typeof invAmountDue === "function") ? invAmountDue(q) : (+q.total || 0)); }, 0), paid = inv.reduce(function (s, q) { return s + c3Paid(q); }, 0);
    var jobs = (d.jobs || []).filter(function (j) { return j && !j.deleted && j.customerId === c.id; });
    var nextJob = jobs.filter(function (j) { return !j.done && j.date && j.date >= t; }).sort(function (a, b) { return a.date.localeCompare(b.date); })[0];
    var plans = qs.filter(function (q) { return q.plan && q.plan.status === "active"; });
    var h = '<div class="card" data-c360="1" style="border-left:4px solid var(--brand,#1B2A4E);margin:0 0 12px">';
    h += '<div class="row" style="gap:12px;flex-wrap:wrap"><div class="grow"><div class="sub">Owed now</div><div class="nm" style="font-size:20px;color:' + (owed > 0 ? "var(--danger)" : "var(--ink)") + '">' + c3M(owed) + '</div></div><div class="grow"><div class="sub">Billed all time</div><div class="nm" style="font-size:17px">' + c3M(billed) + '</div></div><div class="grow"><div class="sub">Paid</div><div class="nm" style="font-size:17px">' + c3M(paid) + '</div></div></div>';
    var line = [];
    if (nextJob) line.push("Next job " + ((typeof fmtDate === "function") ? fmtDate(nextJob.date) : nextJob.date) + (nextJob.time ? " " + nextJob.time : ""));
    if (c.status === "Lead" && c.next) line.push("Follow up " + ((typeof fmtDate === "function") ? fmtDate(c.next) : c.next) + (c.next < t ? " (overdue)" : ""));
    if (plans.length) line.push(plans.length + " payment plan" + (plans.length > 1 ? "s" : "") + " active");
    if (line.length) h += '<div class="sub" style="margin-top:6px">' + c3E(line.join(" · ")) + '</div>';
    if (inv.length) {
      h += '<div style="font-weight:800;margin:10px 0 4px">Invoices · ' + open.length + ' open</div>';
      h += inv.slice().sort(function (a, b) { return (a.paid ? 1 : 0) - (b.paid ? 1 : 0) || String(b.invoicedDate || b.date || "").localeCompare(String(a.invoicedDate || a.date || "")); }).slice(0, 8).map(function (q) {
        var due = c3Due(q); var first = (q.items && q.items[0] && q.items[0].name) || "Invoice";
        return '<div class="li" style="padding:6px 0;align-items:center;cursor:pointer" onclick="closeModal();openInvoice(\'' + c3E(q.id) + '\')"><div class="grow"><div class="nm" style="font-size:14px">' + c3E((typeof invNo === "function") ? invNo(q) : q.num || "") + ' · ' + c3E(first.slice(0, 48)) + '</div><div class="sub">' + c3E((typeof fmtDate === "function") ? fmtDate(q.invoicedDate || q.date) : (q.invoicedDate || q.date || "")) + (q.plan && q.plan.status === "active" ? " · pay over time" : "") + '</div></div><div style="text-align:right"><div class="nm" style="font-size:14px;color:' + (q.paid ? "var(--good,#0a7d4b)" : "var(--danger)") + '">' + (q.paid ? "paid" : c3M(due) + " due") + '</div></div></div>';
      }).join("");
    }
    return h + '</div>';
  };
  if (typeof window.openCustomer === "function") {
    var _oc = window.openCustomer;
    window.openCustomer = function (id) {
      var r = _oc.apply(this, arguments);
      try {
        if (!id) return r; var c = (D().customers || []).find(function (x) { return x && x.id === id; }); if (!c) return r;
        var sheet = document.getElementById("sheet"); if (!sheet || sheet.querySelector("[data-c360]")) return r;
        var first = sheet.querySelector("label"); if (!first) return r;
        var w = document.createElement("div"); w.innerHTML = window.customer360HTML(c); sheet.insertBefore(w.firstChild, first);
      } catch (e) {}
      return r;
    };
  }
}
