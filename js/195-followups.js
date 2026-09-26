/* ---------- FOLLOW-UPS ON TODAY (js/195) ----------
   Phase 6 (Ray, 2026-09-26): the leads to chase were a tab away (Leads → list → date). NN/g: the hub should
   surface the day's tasks so the common path is zero clicks. This card lists leads whose follow-up date has
   arrived (c.next, set by the guided call) and leads with no date at all, oldest first, tap → the customer.
   Post-render, business orgs only, fails open, like the equipment and payment-plan cards. */
if (typeof window !== "undefined") {
  var fuE = function (s) { return (typeof esc === "function") ? esc(String(s == null ? "" : s)) : String(s == null ? "" : s); };
  window.followupsHTML = function () {
    var t = (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10);
    var leads = (D().customers || []).filter(function (c) { return c && !c.deleted && c.status === "Lead"; });
    var due = leads.filter(function (c) { return !c.next || c.next <= t; }).sort(function (a, b) { return String(a.next || "0").localeCompare(String(b.next || "0")); });
    if (!due.length) return "";
    var h = '<div class="secthd"><h2>📞 Follow-ups</h2><span class="ct">' + due.length + '</span></div><div class="card" data-fu="1">';
    h += due.slice(0, 5).map(function (c) { var late = c.next && c.next < t; var last = (c.notes || []).slice(-1)[0]; return '<div class="li" style="padding:7px 0;align-items:center;cursor:pointer" onclick="openCustomer(\'' + fuE(c.id) + '\')"><div class="grow"><div class="nm" style="font-size:14px">' + fuE(c.name || c.company || "Lead") + (c.phone ? ' <span class="sub">· ' + fuE(c.phone) + '</span>' : '') + (late ? ' <span class="badge" style="background:#f6dede;color:#7a1f1f">overdue</span>' : !c.next ? ' <span class="badge" style="background:var(--soft);color:var(--muted)">no date</span>' : '') + '</div><div class="sub" style="white-space:normal">' + fuE(last ? String(last.text || "").replace(/\s+/g, " ").slice(0, 90) : "") + '</div></div>' + (c.phone ? '<a class="btn ghost sm" href="sms:' + fuE(String(c.phone).replace(/[^0-9+]/g, "")) + '" onclick="event.stopPropagation()">Text</a>' : '') + '<span style="color:var(--muted);margin-left:6px">›</span></div>'; }).join("");
    if (due.length > 5) h += '<div class="sub" style="margin-top:4px"><a href="#" onclick="event.preventDefault();navSub(\'leads\')" style="color:var(--brand-text);font-weight:600">All ' + due.length + ' leads</a></div>';
    return h + '</div>';
  };
  function fuToday() {
    try {
      if (typeof TAB === "undefined" || TAB !== "today") return; if (typeof orgIsPersonalOrg === "function" && orgIsPersonalOrg()) return;
      if (typeof navCanSee === "function" && !navCanSee("leads")) return;
      var view = document.getElementById("view"); if (!view || view.querySelector("[data-fu]")) return; var html = window.followupsHTML(); if (!html) return;
      var w = document.createElement("div"); w.innerHTML = html; var nodes = Array.prototype.slice.call(w.childNodes);
      var after = view.querySelector("[data-pp]") || view.querySelector("[data-svc]") || null;
      if (!after) { Array.prototype.slice.call(view.querySelectorAll(".secthd")).forEach(function (hd) { if (/Approvals/i.test(hd.textContent || "")) after = hd.nextElementSibling || hd; }); }
      var parent = after ? after.parentNode : view, ref = after ? after.nextSibling : view.firstChild; nodes.forEach(function (n) { parent.insertBefore(n, ref); });
    } catch (e) {}
  }
  if (typeof secSplit === "function") { var _ss6 = secSplit; secSplit = function (tab) { var r = _ss6.apply(this, arguments); fuToday(); return r; }; window.secSplit = secSplit; }
}
