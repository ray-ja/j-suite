/* ---------- EQUIPMENT SERVICE (js/191) — the machine tells you when it is due ----------
   Ray, 2026-09-23, skid steer just arrived: "make sure all the service stuff is automated."

   A piece of inventory can carry `i.svc`:
     { hours: <hour meter now>, hoursAt: <ts>, start: <ts the machine went into service>,
       plan: [{ key, label, first?: hours, every: hours, days?: days, note? }],
       log:  [{ key, at: ts, hours, note }] }
   Everything is computed from that: for each plan item, the next due point is the last time it was done
   (hours + every, date + days) or, before it has ever been done, `first` (break-in) else `every`. Due by
   EITHER hours or calendar, whichever comes first, the way every engine manual says it.

   WHERE IT SHOWS: a 🛠 card on the business Today (post-render, fails open like js/187) with each machine's
   hours, what is due or coming up, one tap to update the hour meter and one to log a service. A modal shows
   the full plan and history. The plan lives on the record, so it syncs and can be edited by hand.
   Pure helpers (status math) are node-testable: equipment-service-tests.js. */
var SVC_SOON_HOURS = 5, SVC_SOON_DAYS = 14, DAY = 86400000;
function svcLast(log, key) { var best = null; (log || []).forEach(function (l) { if (l && l.key === key && (!best || (+l.at || 0) > (+best.at || 0))) best = l; }); return best; }
/* status rows for one machine. Pure. */
function svcStatus(svc, nowTs) {
  svc = svc || {}; nowTs = nowTs || Date.now();
  var hours = +svc.hours || 0, start = +svc.start || +svc.hoursAt || nowTs;
  return (svc.plan || []).filter(Boolean).map(function (p) {
    var last = svcLast(svc.log, p.key);
    var dueH = last ? (+last.hours || 0) + (+p.every || 0) : (p.first != null ? +p.first : +p.every || 0);
    var dueT = p.days ? ((last ? +last.at : start) + (+p.days) * DAY) : null;
    var remH = dueH - hours, remD = dueT ? Math.ceil((dueT - nowTs) / DAY) : null;
    var state = (remH <= 0 || (remD != null && remD <= 0)) ? "overdue" : (remH <= SVC_SOON_HOURS || (remD != null && remD <= SVC_SOON_DAYS)) ? "soon" : "ok";
    return { key: p.key, label: p.label, note: p.note || "", every: +p.every || 0, days: +p.days || 0, dueHours: dueH, dueAt: dueT, remainHours: remH, remainDays: remD, state: state, last: last, sort: Math.min(remH, remD == null ? Infinity : remD / 5) };
  }).sort(function (a, b) { return a.sort - b.sort; });
}
function svcRank(state) { return state === "overdue" ? 0 : state === "soon" ? 1 : 2; }
/* the skid steer's plan, from the RATO R740 service manual + the 380-class machine manual (Research note) */
var SVC_PLAN_SKID = [
  { key: "levels", label: "Engine oil + hydraulic level, grease 6 points, hoses", every: 10, note: "Level ground, 15 min after shutdown. Hydraulic between marks 1 and 2, cold." },
  { key: "oil", label: "Engine oil change", first: 10, every: 50, days: 182, note: "1.6 L 10W-30 API SJ+ (1.8 L on a dry engine). Warm 10 min, sit 40 min, drain bolt 24 Nm, fill to the upper mark." },
  { key: "air_clean", label: "Air filter clean", every: 20, days: 91, note: "Foam in soapy water and dry; paper tapped or air under 30 psi. Every 10 h in dust." },
  { key: "air_replace", label: "Air filter replace (foam + paper)", every: 50, days: 182 },
  { key: "plugs", label: "Spark plugs clean and gap", every: 50, days: 182, note: "F5RTC x2, gap 0.70 to 0.80 mm, 22 Nm. Spark arrester clean at the same time." },
  { key: "fifty", label: "Battery, drive belt, oil cooler clean, engine oil filter check", every: 50 },
  { key: "hyd_oil", label: "Hydraulic oil change", first: 50, every: 500, note: "First change at 50 h (break-in), then 500 h. AW46 / ISO 46 unless MACHPRO says otherwise. Drain port 2, fill port 1 to between the marks." },
  { key: "hyd_filter", label: "Hydraulic filter + return filter", first: 50, every: 250 },
  { key: "valves", label: "Valve clearance check (cold)", every: 100, days: 365, note: "Intake 0.10 mm, exhaust 0.15 mm." },
  { key: "carbon", label: "Carbon deposits, head and piston", every: 125 },
  { key: "oil_filter", label: "Engine oil filter change", every: 200 },
  { key: "fuel_lines", label: "Fuel lines inspect", every: 99999, days: 730 }
];
if (typeof window !== "undefined") {
  var svcE = function (s) { return (typeof esc === "function") ? esc(String(s == null ? "" : s)) : String(s == null ? "" : s); };
  function svcItems() { try { return (D().inventory || []).filter(function (i) { return i && !i.deleted && i.svc && Array.isArray(i.svc.plan) && i.svc.plan.length; }); } catch (e) { return []; } }
  function svcFind(id) { return (D().inventory || []).find(function (i) { return i && i.id === id; }); }
  function svcSave(i) { if (typeof touch === "function") touch(i); else i.updatedAt = Date.now(); if (typeof save === "function") save(); if (typeof render === "function") render(); }
  function svcAgo(ts) { if (!ts) return "never"; var d = Math.round((Date.now() - ts) / DAY); return d <= 0 ? "today" : d === 1 ? "yesterday" : d + " days ago"; }
  function svcRowHTML(r, id, full) {
    var col = r.state === "overdue" ? "var(--danger)" : r.state === "soon" ? "#b8860b" : "var(--muted)";
    var when = (r.remainHours === Infinity || r.every >= 99999) ? "" : (r.remainHours <= 0 ? Math.abs(r.remainHours) + " h overdue" : "in " + r.remainHours + " h");
    if (r.remainDays != null) when += (when ? " or " : "") + (r.remainDays <= 0 ? Math.abs(r.remainDays) + " days overdue" : "in " + r.remainDays + " days");
    return '<div class="li" style="padding:7px 0;align-items:flex-start"><div class="grow"><div class="nm" style="font-size:14px;color:' + col + '">' + (r.state === "overdue" ? "⚠️ " : r.state === "soon" ? "⏳ " : "") + svcE(r.label) + '</div><div class="sub" style="white-space:normal">' + svcE(when) + (r.last ? ' · last at ' + svcE(r.last.hours) + ' h, ' + svcE(svcAgo(r.last.at)) : ' · not yet done') + (full && r.note ? '<br>' + svcE(r.note) : '') + '</div></div><button class="btn ' + (r.state === "ok" ? "ghost" : "acc") + ' sm" style="flex:0 0 auto" onclick="svcLog(\'' + svcE(id) + '\',\'' + svcE(r.key) + '\')">Done ✓</button></div>';
  }
  window.svcCardHTML = function () {
    var items = svcItems(); if (!items.length) return "";
    var h = '<div class="secthd"><h2>🛠 Equipment service</h2></div><div class="card" data-svc="1">';
    items.forEach(function (i, n) {
      var s = i.svc, rows = svcStatus(s), show = rows.filter(function (r) { return r.state !== "ok"; }).slice(0, 4);
      var stale = !s.hoursAt || (Date.now() - s.hoursAt) > 7 * DAY;
      h += (n ? '<div style="border-top:1px solid var(--line);margin:10px 0"></div>' : '') + '<div class="row" style="align-items:center;gap:8px"><div class="grow"><div class="nm">' + svcE(i.name) + '</div><div class="sub">' + (+s.hours || 0) + ' h on the meter' + (s.hoursAt ? ' · updated ' + svcE(svcAgo(s.hoursAt)) : ' · <b>set the hour meter</b>') + '</div></div><button class="btn ' + (stale ? "acc" : "ghost") + ' sm" onclick="svcHours(\'' + svcE(i.id) + '\')">Hours…</button><button class="btn ghost sm" onclick="svcOpen(\'' + svcE(i.id) + '\')">All</button></div>';
      if (show.length) h += show.map(function (r) { return svcRowHTML(r, i.id, false); }).join("");
      else { var next = rows[0]; h += '<div class="sub" style="margin-top:4px">Nothing due. Next: ' + svcE(next ? next.label : "") + (next && next.remainHours < 99999 ? ' in ' + next.remainHours + ' h' : '') + '.</div>'; }
    });
    return h + '</div>';
  };
  window.svcHours = function (id) {
    var i = svcFind(id); if (!i || !i.svc) return;
    var v = prompt("Hour meter reading for " + (i.name || "this machine") + ":", String(i.svc.hours || 0)); if (v == null) return;
    var n = parseFloat(String(v).replace(/[^0-9.]/g, "")); if (isNaN(n)) return;
    if (n < (+i.svc.hours || 0) && !confirm("That is lower than the last reading (" + i.svc.hours + " h). Save anyway?")) return;
    i.svc.hours = Math.round(n * 10) / 10; i.svc.hoursAt = Date.now(); if (!i.svc.start) i.svc.start = Date.now();
    svcSave(i);
  };
  window.svcLog = function (id, key) {
    var i = svcFind(id); if (!i || !i.svc) return; var p = (i.svc.plan || []).find(function (x) { return x && x.key === key; }); if (!p) return;
    var v = prompt("Log \"" + p.label + "\" at how many hours?", String(i.svc.hours || 0)); if (v == null) return;
    var n = parseFloat(String(v).replace(/[^0-9.]/g, "")); if (isNaN(n)) return;
    var note = prompt("Note (optional): oil brand, parts, anything odd", "") || "";
    i.svc.log = i.svc.log || []; i.svc.log.push({ key: key, at: Date.now(), hours: Math.round(n * 10) / 10, note: String(note).slice(0, 200), by: (typeof curUser === "function" && curUser() ? curUser().id : "") });
    if (n > (+i.svc.hours || 0)) { i.svc.hours = Math.round(n * 10) / 10; i.svc.hoursAt = Date.now(); }
    svcSave(i); if (typeof toast === "function") toast("Logged: " + p.label);
    if (document.getElementById("svc_modal")) svcOpen(id);
  };
  window.svcOpen = function (id) {
    var i = svcFind(id); if (!i || !i.svc || typeof modal !== "function") return;
    var rows = svcStatus(i.svc);
    var h = '<div id="svc_modal"><div class="row" style="align-items:center;gap:8px;margin-bottom:8px"><div class="grow sub">' + (+i.svc.hours || 0) + ' h on the meter · updated ' + svcE(svcAgo(i.svc.hoursAt)) + '</div><button class="btn ghost sm" onclick="svcHours(\'' + svcE(i.id) + '\')">Update hours</button></div>';
    h += rows.map(function (r) { return svcRowHTML(r, i.id, true); }).join("");
    var log = (i.svc.log || []).slice().sort(function (a, b) { return (+b.at || 0) - (+a.at || 0); });
    if (log.length) h += '<div style="font-weight:800;margin:14px 0 4px">History</div>' + log.slice(0, 30).map(function (l) { var p = (i.svc.plan || []).find(function (x) { return x && x.key === l.key; }); return '<div class="sub" style="white-space:normal;padding:3px 0">' + svcE(new Date(l.at).toLocaleDateString()) + ' · ' + svcE(l.hours) + ' h · ' + svcE(p ? p.label : l.key) + (l.note ? ' · ' + svcE(l.note) : '') + '</div>'; }).join("");
    h += '<div class="sub" style="margin-top:12px;white-space:normal">Intervals come from the RATO R740 and 380-class manuals (Data → Research → "Skid steer manuals"). Due by hours or calendar, whichever comes first.</div></div>';
    modal("🛠 " + (i.name || "Service"), h);
  };
  /* Today: the card goes in after Approvals (or at the top), business orgs only, fails open */
  function svcToday() {
    try {
      if (typeof TAB === "undefined" || TAB !== "today") return;
      if (typeof orgIsPersonalOrg === "function" && orgIsPersonalOrg()) return;
      var view = document.getElementById("view"); if (!view || view.querySelector("[data-svc]")) return;
      var html = window.svcCardHTML(); if (!html) return;
      var wrap = document.createElement("div"); wrap.innerHTML = html; var nodes = Array.prototype.slice.call(wrap.childNodes);
      var heads = Array.prototype.slice.call(view.querySelectorAll(".secthd")); var after = null;
      heads.forEach(function (hd) { if (/Approvals/i.test(hd.textContent || "")) { after = hd.nextElementSibling || hd; } });
      /* Today may be wrapped into layout columns (js/164/167), so insert beside the Approvals card's own
         parent, not the view */
      var parent = after ? after.parentNode : view, ref = after ? after.nextSibling : view.firstChild;
      nodes.forEach(function (n) { parent.insertBefore(n, ref); });
    } catch (e) {}
  }
  if (typeof secSplit === "function") { var _ss3 = secSplit; secSplit = function (tab) { var r = _ss3.apply(this, arguments); svcToday(); return r; }; window.secSplit = secSplit; }
  window.svcStatus = svcStatus; window.SVC_PLAN_SKID = SVC_PLAN_SKID;
}
if (typeof module !== "undefined" && module.exports) { module.exports = { svcStatus: svcStatus, svcLast: svcLast, SVC_PLAN_SKID: SVC_PLAN_SKID }; }
