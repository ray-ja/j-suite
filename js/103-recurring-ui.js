/* ---------- RECURRING SERVICE — Phase 2: management UI + plan lifecycle + create paths ----------
   Builds ON TOP of js/102's pure engine (recurMaterialize / recurFirstOccurrence / recurAdvance /
   recurMonthlyEquiv / recurMakeOccurrence). This module owns the 🔁 Recurring tab (Sales nav), the plan
   editor modal (frequency-adaptive day control, mirroring openBudgetBill in js/79), and the lifecycle
   handlers (pause / resume-from-today / end / skip-next / delete). Create entry points: the dedicated
   "＋ New recurring plan", a "🔁 Set up recurring" on the customer page (js/06), and the wizard's recurring
   toggle (js/23).

   PHASE 2 = jobs-only: a materialized occurrence is a plain d.jobs record (autoQuote stays OFF — Phase 3 adds
   the quote-per-occurrence + MRR). Creating/managing plans + generating jobs writes ordinary records → finance
   is byte-identical. Owner/admin gated (canSee("recurring")); every mutator re-checks. Never throws / never
   blanks. Dual surface: window.* for the app + a small module.exports (recurPlanFromFields + the lifecycle
   fns) so the Phase-2 node test can drive the create + lifecycle paths without a DOM. */

/* ---------- UI state (survives re-render; the modal is rebuilt fresh each open) ---------- */
var RECUR_CREW = null;            // Set<userId> selected in the open editor
var RECUR_SHOW_INACTIVE = false;  // paused/ended section expanded?

var RECUR_FREQS = [
  { k: "weekly", label: "Weekly" }, { k: "biweekly", label: "Every 2 weeks" }, { k: "monthly", label: "Monthly" },
  { k: "quarterly", label: "Quarterly" }, { k: "seasonal", label: "Seasonal" }, { k: "custom", label: "Custom" }
];
var RECUR_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ---------- accessors / small helpers ---------- */
function recurPlans() { try { return (D().recurringPlans || []).filter(function (p) { return p && !p.deleted; }); } catch (e) { return []; } }
function recurPlanById(id) { try { return (D().recurringPlans || []).find(function (p) { return p && p.id === id; }) || null; } catch (e) { return null; } }
function recurCanManage() { return (typeof canSee === "function") ? canSee("recurring") : true; }
function recurFreqMeta(k) { return RECUR_FREQS.find(function (f) { return f.k === k; }) || RECUR_FREQS[0]; }
function recurCustName(id) { try { var c = (D().customers || []).find(function (x) { return x && x.id === id; }); return c ? (c.name || c.company || "Customer") : ""; } catch (e) { return ""; } }
/* a one-line human cadence, e.g. "Weekly · Tue" / "Monthly · day 15" / "Seasonal 06-01→08-31" */
function recurFreqLine(p) {
  try {
    var f = p.frequency || "weekly";
    if (f === "weekly" || f === "biweekly") return recurFreqMeta(f).label + " · " + RECUR_DOW[(+p.weekday || 0) % 7];
    if (f === "monthly") return (p.monthlyMode === "nthWeekday")
      ? "Monthly · " + ["1st", "2nd", "3rd", "4th", "5th"][Math.min(4, Math.max(0, (+p.nthWeek || 1) - 1))] + " " + RECUR_DOW[(+p.weekday || 0) % 7]
      : "Monthly · day " + Math.min(28, Math.max(1, +p.dayOfMonth || 1));
    if (f === "quarterly") return "Quarterly · day " + Math.min(28, Math.max(1, +p.dayOfMonth || 1));
    if (f === "seasonal") return "Seasonal " + (p.seasonStart || "01-01") + "→" + (p.seasonEnd || "12-31");
    if (f === "custom") return p.intervalDays ? ("Every " + (+p.intervalDays) + " days") : ("Every " + Math.max(1, +p.interval || 1) + " week" + (Math.max(1, +p.interval || 1) === 1 ? "" : "s"));
    return recurFreqMeta(f).label;
  } catch (e) { return "Recurring"; }
}

/* ================= the RECURRING tab view ================= */
function rRecurring() {
  // hard-gate: crew / no-session must never reach the management surface (hidden = unreachable)
  if (typeof canSee === "function" && !canSee("recurring")) { TAB = "today"; if (typeof rToday === "function") return rToday(); }
  var plans = recurPlans();
  var active = plans.filter(function (p) { return p.status === "active"; });
  var paused = plans.filter(function (p) { return p.status === "paused"; });
  var ended = plans.filter(function (p) { return p.status === "ended"; });
  var mrr = 0;
  try { active.forEach(function (p) { mrr += (typeof recurMonthlyEquiv === "function") ? recurMonthlyEquiv(p) : 0; }); } catch (e) { mrr = 0; }

  var h = '<div class="secthd"><h2>🔁 Recurring</h2><span class="ct">' + active.length + ' active</span></div>';
  h += '<p class="muted" style="margin:0 2px 8px;font-size:13px">Standing service contracts that auto-schedule visits on a cadence — house-watch, recurring wash, seasonal landscaping. '
    + (mrr > 0 ? 'Recurring value <b>~' + money(mrr) + '/mo</b>. ' : '') + 'Each visit lands as a job on the schedule.</p>';
  h += '<button class="btn acc" style="width:100%;margin-bottom:12px" onclick="recurPlanOpen()">＋ New recurring plan</button>';

  // ---- ACTIVE plans ----
  h += '<div class="sub" style="font-weight:600;margin:8px 4px 4px">Active plans</div>';
  if (!active.length) h += '<div class="muted" style="margin:0 4px 8px">No active plans yet — tap “New recurring plan” to set one up.</div>';
  else h += '<div class="card" style="padding:6px 10px">' + active.map(recurPlanRow).join("") + '</div>';

  // ---- UPCOMING VISITS (generated jobs) ----
  var upcoming = [];
  try {
    upcoming = (D().jobs || []).filter(function (j) { return j && j.planId && !j.done && !j.deleted; })
      .sort(function (a, b) { return String(a.date || "").localeCompare(String(b.date || "")); }).slice(0, 10);
  } catch (e) { upcoming = []; }
  h += '<div class="sub" style="font-weight:600;margin:14px 4px 4px">Upcoming visits</div>';
  if (!upcoming.length) h += '<div class="muted" style="margin:0 4px 8px">No upcoming visits scheduled yet.</div>';
  else h += '<div class="card" style="padding:6px 10px">' + upcoming.map(function (j) {
    var cn = recurCustName(j.customerId);
    return '<div class="li" style="cursor:pointer" onclick="if(typeof openJobPage===\'function\')openJobPage(\'' + esc(j.id) + '\')">'
      + '<div class="grow"><div class="nm" style="font-size:15px">' + esc(j.title || "Recurring visit") + (cn ? ' <span class="sub" style="font-weight:400">· ' + esc(cn) + '</span>' : '') + '</div>'
      + '<div class="sub">' + esc(fmtDate(j.date)) + (j.time ? ' · ' + esc(j.time) : '') + '</div></div><div class="sub">›</div></div>';
  }).join("") + '</div>';

  // ---- PAUSED / ENDED (collapsed) ----
  var inactive = paused.concat(ended);
  if (inactive.length) {
    h += '<div class="sub" style="font-weight:600;margin:14px 4px 4px;cursor:pointer" onclick="recurToggleInactive()">'
      + (RECUR_SHOW_INACTIVE ? "▾" : "▸") + ' Paused / ended (' + inactive.length + ')</div>';
    if (RECUR_SHOW_INACTIVE) h += '<div class="card" style="padding:6px 10px">' + inactive.map(recurPlanRow).join("") + '</div>';
  }
  view.innerHTML = h;
}
window.recurToggleInactive = function () { RECUR_SHOW_INACTIVE = !RECUR_SHOW_INACTIVE; render(); };

/* one plan card: customer · title · frequency · $price/visit (−disc%) · next visit · status → tap to edit */
function recurPlanRow(p) {
  var cn = recurCustName(p.customerId);
  var disc = +p.discountPct || 0;
  var net = Math.round((+p.price || 0) * (1 - disc / 100));
  var statusTag = p.status === "paused" ? ' <span class="sub" style="font-weight:400">· ⏸ paused</span>'
    : p.status === "ended" ? ' <span class="sub" style="font-weight:400">· ⏹ ended</span>' : '';
  var next = (p.status === "active" && p.nextDue) ? ('next ' + fmtDate(p.nextDue)) : (p.status === "active" ? 'not scheduled' : '');
  return '<div class="li" style="cursor:pointer' + (p.status !== "active" ? ';opacity:.65' : '') + '" onclick="recurPlanOpen(\'' + esc(p.id) + '\')">'
    + '<div class="grow"><div class="nm" style="font-size:15px">' + esc(p.title || "Recurring service") + (cn ? ' <span class="sub" style="font-weight:400">· ' + esc(cn) + '</span>' : '') + statusTag + '</div>'
    + '<div class="sub">' + esc(recurFreqLine(p)) + ' · ' + money(net) + '/visit' + (disc ? ' (−' + disc + '%)' : '') + (next ? ' · ' + esc(next) : '') + '</div></div>'
    + '<div style="font-weight:800">' + money(net) + '</div></div>';
}

/* ================= the PLAN EDITOR (modal) ================= */
/* recurPlanOpen(id) edits; recurPlanOpen(null, prefill) creates from a customer/quote (prefill = {customerId,
   propertyId,title,price,discountPct,serviceId}). Mirrors openBudgetBill's frequency-adaptive day control. */
window.recurPlanOpen = function (id, prefill) {
  if (!recurCanManage()) { if (typeof alert === "function") alert("Recurring plans are owner/admin only."); return; }
  prefill = prefill || {};
  var isNew = !id;
  var p = isNew
    ? { id: "", customerId: prefill.customerId || "", propertyId: prefill.propertyId || "", serviceId: prefill.serviceId || "",
        title: prefill.title || "", price: (prefill.price != null ? prefill.price : ""), discountPct: (prefill.discountPct != null ? prefill.discountPct : 20),
        frequency: "weekly", weekday: (prefill.startDate ? new Date(prefill.startDate + "T00:00:00").getDay() : new Date().getDay()), dayOfMonth: 1, monthlyMode: "date", nthWeek: 1, interval: 1,
        seasonStart: "06-01", seasonEnd: "08-31", time: (prefill.time || ""), estDays: (prefill.estDays != null ? prefill.estDays : 1), crew: (Array.isArray(prefill.crew) ? prefill.crew.slice() : []), address: (prefill.address || ""), startDate: (prefill.startDate || today()), endMode: "endless", status: "active", notes: "" }
    : recurPlanById(id);
  if (!p) { closeModal(); return; }
  RECUR_CREW = new Set(Array.isArray(p.crew) ? p.crew : []);

  var custs = (typeof actC === "function") ? actC() : [];
  var custOpts = '<option value="">— pick a customer —</option>' + custs.map(function (c) {
    return '<option value="' + esc(c.id) + '"' + (p.customerId === c.id ? " selected" : "") + '>' + esc(c.name || c.company || "Customer") + '</option>';
  }).join("");
  var svcList = (typeof CATALOG !== "undefined" && CATALOG[S.biz]) ? CATALOG[S.biz] : [];
  var svcOpts = '<option value="">— optional: pick a service (prefills title + price) —</option>' + svcList.map(function (s) {
    return '<option value="' + esc(s.id) + '"' + (p.serviceId === s.id ? " selected" : "") + '>' + esc(s.name) + ' · ' + money(s.price) + '</option>';
  }).join("");
  var freqOpts = RECUR_FREQS.map(function (f) { return '<option value="' + f.k + '"' + ((p.frequency || "weekly") === f.k ? " selected" : "") + '>' + f.label + '</option>'; }).join("");

  modal(isNew ? "New recurring plan" : "Recurring plan", ''
    + '<label style="margin-top:0">Customer</label><select id="rp_cust" onchange="recurCustChange()">' + custOpts + '</select>'
    + '<label>Property</label><div id="rp_propwrap"></div>'
    + '<label>Service (optional)</label><select id="rp_svc" onchange="recurSvcPick()">' + svcOpts + '</select>'
    + '<label>Title</label><input id="rp_title" value="' + esc(p.title || "") + '" placeholder="e.g. House-watch — weekly">'
    + '<div class="row" style="gap:8px"><div class="grow"><label>Price / visit</label><input id="rp_price" type="number" inputmode="decimal" step="0.01" value="' + esc(p.price != null && p.price !== "" ? p.price : "") + '" placeholder="0.00"></div>'
    + '<div class="grow"><label>Recurring discount %</label><input id="rp_disc" type="number" inputmode="numeric" min="0" max="100" step="1" value="' + esc(p.discountPct != null ? p.discountPct : 20) + '"></div></div>'
    + '<label>Frequency</label><select id="rp_freq" onchange="recurFreqChange(this.value)">' + freqOpts + '</select>'
    + '<div id="rp_daywrap"></div>'
    + '<label>Crew</label><div id="rp_crew" class="card" style="padding:4px 8px;max-height:200px;overflow:auto"></div>'
    + '<div class="row" style="gap:8px"><div class="grow"><label>Time</label><input id="rp_time" type="time" value="' + esc(p.time || "") + '"></div>'
    + '<div class="grow"><label>Days on site</label><input id="rp_estdays" type="number" inputmode="numeric" min="1" step="1" value="' + esc(Math.max(1, +p.estDays || 1)) + '"></div></div>'
    + '<label>Start date</label><input id="rp_start" type="date" value="' + esc(p.startDate || today()) + '">'
    + '<label>Ends</label><select id="rp_endmode" onchange="recurEndModeChange(this.value)">'
    + '<option value="endless"' + ((p.endMode || "endless") === "endless" ? " selected" : "") + '>Never (ongoing)</option>'
    + '<option value="date"' + (p.endMode === "date" ? " selected" : "") + '>On a date</option>'
    + '<option value="count"' + (p.endMode === "count" ? " selected" : "") + '>After N visits</option></select>'
    + '<div id="rp_endwrap"></div>'
    + '<label>Notes</label><textarea id="rp_notes" placeholder="Access notes, gate code, what to check…">' + esc(p.notes || "") + '</textarea>'
    + '<label class="toggle" style="margin-top:10px"><input type="checkbox" id="rp_autoquote"' + ((p.autoQuote !== false) ? " checked" : "") + '> 🧾 Auto-create a billable quote for each visit (recurring price)</label>'
    + '<button class="btn acc" style="margin-top:12px" onclick="recurSavePlan(\'' + esc(p.id || "") + '\',' + isNew + ')">' + (isNew ? "Create plan" : "Save plan") + '</button>'
    + (isNew ? "" : recurLifecycleButtons(p))
  );
  recurRenderProps(p.propertyId);
  recurRenderDay(p.frequency || "weekly", p);
  recurRenderCrew();
  recurRenderEnd(p.endMode || "endless", p);
};

/* lifecycle action buttons on an existing plan */
function recurLifecycleButtons(p) {
  var h = '<div class="row" style="gap:8px;margin-top:10px">';
  if (p.status === "active") {
    h += '<button class="btn ghost sm grow" onclick="recurSkipNext(\'' + esc(p.id) + '\')">⏭ Skip next</button>';
    h += '<button class="btn ghost sm grow" onclick="recurPause(\'' + esc(p.id) + '\')">⏸ Pause</button>';
  } else if (p.status === "paused") {
    h += '<button class="btn ghost sm grow" onclick="recurResume(\'' + esc(p.id) + '\')">▶ Resume</button>';
  }
  if (p.status !== "ended") h += '<button class="btn ghost sm grow" onclick="recurEnd(\'' + esc(p.id) + '\')">⏹ End</button>';
  h += '</div>';
  h += '<button class="btn danger" style="margin-top:10px" onclick="recurDeletePlan(\'' + esc(p.id) + '\')">Delete plan</button>';
  h += '<p class="muted" style="margin-top:6px;font-size:12px">Deleting keeps any jobs already generated. Ending stops new visits.</p>';
  return h;
}

/* property picker — scoped to the chosen customer when one is set, else all properties */
function recurRenderProps(selPropId) {
  var wrap = document.getElementById("rp_propwrap"); if (!wrap) return;
  var cid = (document.getElementById("rp_cust") || {}).value || "";
  var props = (cid && typeof propsForCust === "function") ? propsForCust(cid) : ((typeof actProps === "function") ? actProps() : []);
  var opts = '<option value="">— none —</option>' + props.map(function (pr) {
    return '<option value="' + esc(pr.id) + '"' + (selPropId === pr.id ? " selected" : "") + '>' + esc(pr.label || pr.address || "Property") + '</option>';
  }).join("");
  wrap.innerHTML = '<select id="rp_prop">' + opts + '</select>';
}
window.recurCustChange = function () { recurRenderProps(""); };
window.recurSvcPick = function () {
  var sid = (document.getElementById("rp_svc") || {}).value || "";
  var svcList = (typeof CATALOG !== "undefined" && CATALOG[S.biz]) ? CATALOG[S.biz] : [];
  var s = svcList.find(function (x) { return x.id === sid; }); if (!s) return;
  var t = document.getElementById("rp_title"); if (t && !t.value) t.value = s.name;
  var pr = document.getElementById("rp_price"); if (pr && (!pr.value || +pr.value === 0)) pr.value = s.price;
};

/* frequency-adaptive DAY control — mirrors budgetBillRenderDue (js/79) */
function recurRenderDay(freq, p) {
  var wrap = document.getElementById("rp_daywrap"); if (!wrap) return;
  p = p || {};
  var wdSel = function (v) { return RECUR_DOW.map(function (d, i) { return '<option value="' + i + '"' + ((+v || 0) === i ? " selected" : "") + '>' + d + '</option>'; }).join(""); };
  if (freq === "weekly" || freq === "biweekly") {
    wrap.innerHTML = '<label>Day of week</label><select id="rp_weekday">' + wdSel(p.weekday) + '</select>';
  } else if (freq === "monthly") {
    var mode = p.monthlyMode || "date";
    wrap.innerHTML = '<label>Monthly on</label><select id="rp_monthmode" onchange="recurMonthModeChange(this.value)">'
      + '<option value="date"' + (mode === "date" ? " selected" : "") + '>A day of the month</option>'
      + '<option value="nthWeekday"' + (mode === "nthWeekday" ? " selected" : "") + '>An nth weekday</option></select>'
      + '<div id="rp_monthwrap"></div>';
    recurRenderMonth(mode, p);
  } else if (freq === "quarterly") {
    wrap.innerHTML = '<label>Anchor day of month (1–28)</label><input id="rp_dom" type="number" inputmode="numeric" min="1" max="28" step="1" value="' + (Math.min(28, Math.max(1, +p.dayOfMonth || 1))) + '">';
  } else if (freq === "seasonal") {
    wrap.innerHTML = '<div class="row" style="gap:8px"><div class="grow"><label>Season start (MM-DD)</label><input id="rp_seasonstart" placeholder="06-01" value="' + esc(p.seasonStart || "06-01") + '"></div>'
      + '<div class="grow"><label>Season end (MM-DD)</label><input id="rp_seasonend" placeholder="08-31" value="' + esc(p.seasonEnd || "08-31") + '"></div></div>'
      + '<label>Visit cadence (weeks)</label><input id="rp_interval" type="number" inputmode="numeric" min="1" step="1" value="' + (Math.max(1, +p.interval || 1)) + '"><div class="sub" style="margin-top:2px">e.g. 1 = weekly within the season</div>';
  } else { // custom
    wrap.innerHTML = '<div class="row" style="gap:8px"><div class="grow"><label>Every</label><input id="rp_interval" type="number" inputmode="numeric" min="1" step="1" value="' + (p.intervalDays ? +p.intervalDays : Math.max(1, +p.interval || 1)) + '"></div>'
      + '<div class="grow"><label>Unit</label><select id="rp_intervalunit"><option value="weeks"' + (p.intervalDays ? "" : " selected") + '>weeks</option><option value="days"' + (p.intervalDays ? " selected" : "") + '>days</option></select></div></div>';
  }
}
window.recurFreqChange = function (freq) { recurRenderDay(freq, recurReadDayState()); };
window.recurMonthModeChange = function (mode) { recurRenderMonth(mode, recurReadDayState()); };
function recurRenderMonth(mode, p) {
  var wrap = document.getElementById("rp_monthwrap"); if (!wrap) return;
  p = p || {};
  if (mode === "nthWeekday") {
    var nthOpts = [1, 2, 3, 4, 5].map(function (n) { return '<option value="' + n + '"' + ((+p.nthWeek || 1) === n ? " selected" : "") + '>' + ["1st", "2nd", "3rd", "4th", "5th"][n - 1] + '</option>'; }).join("");
    var wdOpts = RECUR_DOW.map(function (d, i) { return '<option value="' + i + '"' + ((+p.weekday || 0) === i ? " selected" : "") + '>' + d + '</option>'; }).join("");
    wrap.innerHTML = '<div class="row" style="gap:8px"><div class="grow"><label>Week</label><select id="rp_nthweek">' + nthOpts + '</select></div>'
      + '<div class="grow"><label>Weekday</label><select id="rp_weekday">' + wdOpts + '</select></div></div>';
  } else {
    wrap.innerHTML = '<label>Day of month (1–28)</label><input id="rp_dom" type="number" inputmode="numeric" min="1" max="28" step="1" value="' + (Math.min(28, Math.max(1, +p.dayOfMonth || 1))) + '">';
  }
}
/* read the CURRENT day-control DOM back into a partial plan so a frequency switch keeps what the user typed */
function recurReadDayState() {
  var g = function (id) { var e = document.getElementById(id); return e ? e.value : undefined; };
  return {
    weekday: g("rp_weekday"), dayOfMonth: g("rp_dom"), monthlyMode: g("rp_monthmode"), nthWeek: g("rp_nthweek"),
    seasonStart: g("rp_seasonstart"), seasonEnd: g("rp_seasonend"), interval: g("rp_interval")
  };
}

/* crew multiselect (mirrors renderJobCrew's shape, own state so it never collides with the job modal) */
function recurRenderCrew() {
  var box = document.getElementById("rp_crew"); if (!box) return;
  var mem = (typeof schedMembers === "function") ? schedMembers() : [];
  if (!mem.length) { box.innerHTML = '<div class="muted">No team accounts to assign — add them in Admin.</div>'; return; }
  box.innerHTML = mem.map(function (u) {
    var on = RECUR_CREW && RECUR_CREW.has(u.id);
    return '<label class="li" style="cursor:pointer"><input type="checkbox" style="width:20px;height:20px;flex:0 0 auto" ' + (on ? "checked" : "") + ' onchange="recurToggleCrew(\'' + esc(u.id) + '\')">'
      + '<div class="grow"><div class="nm" style="font-size:15px">' + esc(u.username) + '</div></div></label>';
  }).join("");
}
window.recurToggleCrew = function (id) { if (!RECUR_CREW) RECUR_CREW = new Set(); if (RECUR_CREW.has(id)) RECUR_CREW.delete(id); else RECUR_CREW.add(id); recurRenderCrew(); };

/* end-mode control (date / count) */
window.recurEndModeChange = function (mode) { recurRenderEnd(mode, { endDate: (document.getElementById("rp_enddate") || {}).value, count: (document.getElementById("rp_count") || {}).value }); };
function recurRenderEnd(mode, p) {
  var wrap = document.getElementById("rp_endwrap"); if (!wrap) return;
  p = p || {};
  if (mode === "date") wrap.innerHTML = '<label>End date</label><input id="rp_enddate" type="date" value="' + esc(p.endDate || "") + '">';
  else if (mode === "count") wrap.innerHTML = '<label>Number of visits</label><input id="rp_count" type="number" inputmode="numeric" min="1" step="1" value="' + esc(p.count || 1) + '">';
  else wrap.innerHTML = "";
}

/* ---------- PURE builder (no DOM) — shared by recurSavePlan + the node test ---------- */
function recurPlanFromFields(f, base) {
  f = f || {}; base = base || {};
  var p = {};
  for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) p[k] = base[k];
  p.id = base.id || ("rp_" + ((typeof uid === "function") ? uid() : String((typeof now === "function" ? now() : Date.now()))));
  p.customerId = f.customerId || "";
  p.propertyId = f.propertyId || "";
  p.serviceId = f.serviceId || "";
  p.title = f.title || "";
  p.price = +f.price || 0;
  p.discountPct = (f.discountPct == null || f.discountPct === "") ? 20 : (+f.discountPct || 0);
  p.frequency = f.frequency || "weekly";
  p.weekday = ((+f.weekday || 0) % 7 + 7) % 7;
  p.dayOfMonth = Math.min(28, Math.max(1, +f.dayOfMonth || 1));
  p.monthlyMode = f.monthlyMode || "date";
  p.nthWeek = Math.min(5, Math.max(1, +f.nthWeek || 1));
  p.seasonStart = f.seasonStart || "";
  p.seasonEnd = f.seasonEnd || "";
  p.time = f.time || "";
  p.crew = Array.isArray(f.crew) ? f.crew.slice() : [];
  p.estDays = Math.max(1, Math.round(+f.estDays || 1));
  p.startDate = f.startDate || ((typeof today === "function") ? today() : "");
  p.endMode = f.endMode || "endless";
  p.endDate = (f.endMode === "date") ? (f.endDate || "") : (base.endDate || "");
  p.count = (f.endMode === "count") ? Math.max(1, +f.count || 1) : (base.count || 0);
  // custom / seasonal cadence: unit=days → intervalDays; unit=weeks → interval (in weeks)
  if (f.frequency === "custom" && f.intervalUnit === "days") { p.intervalDays = Math.max(1, +f.interval || 1); p.interval = 1; }
  else { p.interval = Math.max(1, +f.interval || 1); p.intervalDays = undefined; }
  p.status = base.status || "active";
  // Phase 3: auto-create a billable quote per visit — DEFAULT ON for new plans. The form passes an explicit
  // boolean (the toggle), so it wins; when absent, preserve an existing plan's value, else default ON. Existing
  // Phase-2 plans keep their stored autoQuote:false unless the owner edits + enables the toggle (forward-only).
  p.autoQuote = (f.autoQuote == null) ? (base.autoQuote != null ? !!base.autoQuote : true) : !!f.autoQuote;
  p.notes = f.notes || "";
  p.generatedJobIds = Array.isArray(base.generatedJobIds) ? base.generatedJobIds : [];
  p.generatedCount = base.generatedCount || 0;
  p.nextDue = base.nextDue || "";
  p.lastGeneratedDate = base.lastGeneratedDate || null;
  p.deleted = false;
  return p;
}
/* a plan has a resolvable frequency day (used for validation) */
function recurHasValidDay(p) {
  var f = p.frequency;
  if (f === "seasonal") return !!(p.seasonStart && /^\d{2}-\d{2}$/.test(p.seasonStart) && p.seasonEnd && /^\d{2}-\d{2}$/.test(p.seasonEnd));
  return true;   // weekly/biweekly/monthly/quarterly/custom always resolve (values clamped in the builder)
}

/* force a materialize pass NOW (bypass the once/day guard) so a freshly-created/resumed plan generates its
   first visits immediately (the engine re-stamps recurLastRun to today afterward) */
function recurForceMaterialize() {
  try { if (typeof S !== "undefined" && S) S.recurLastRun = null; if (typeof recurMaterialize === "function") return recurMaterialize(); } catch (e) {}
  return false;
}

window.recurSavePlan = function (id, isNew) {
  if (!recurCanManage()) { if (typeof alert === "function") alert("Recurring plans are owner/admin only."); return; }
  var d = D(); if (!Array.isArray(d.recurringPlans)) d.recurringPlans = [];
  var base = isNew ? {} : (recurPlanById(id) || {});
  var freq = (document.getElementById("rp_freq") || {}).value || "weekly";
  var f = {
    customerId: (document.getElementById("rp_cust") || {}).value || "",
    propertyId: (document.getElementById("rp_prop") || {}).value || "",
    serviceId: (document.getElementById("rp_svc") || {}).value || "",
    title: val("rp_title"), price: val("rp_price"), discountPct: val("rp_disc"),
    frequency: freq,
    weekday: (document.getElementById("rp_weekday") || {}).value,
    dayOfMonth: (document.getElementById("rp_dom") || {}).value,
    monthlyMode: (document.getElementById("rp_monthmode") || {}).value,
    nthWeek: (document.getElementById("rp_nthweek") || {}).value,
    seasonStart: val("rp_seasonstart"), seasonEnd: val("rp_seasonend"),
    interval: (document.getElementById("rp_interval") || {}).value,
    intervalUnit: (document.getElementById("rp_intervalunit") || {}).value,
    time: (document.getElementById("rp_time") || {}).value || "",
    estDays: val("rp_estdays"), startDate: (document.getElementById("rp_start") || {}).value || today(),
    crew: RECUR_CREW ? Array.from(RECUR_CREW) : [],
    endMode: (document.getElementById("rp_endmode") || {}).value || "endless",
    endDate: (document.getElementById("rp_enddate") || {}).value || "",
    count: (document.getElementById("rp_count") || {}).value || "",
    autoQuote: document.getElementById("rp_autoquote") ? !!document.getElementById("rp_autoquote").checked : undefined,
    notes: val("rp_notes")
  };
  var p = recurPlanFromFields(f, base);
  // validate: (customer OR title) + price + a resolvable frequency day
  if (!p.customerId && !p.title) { alert("Pick a customer or give the plan a title."); return; }
  if (!(+p.price > 0)) { alert("Enter a price per visit greater than zero."); return; }
  if (!recurHasValidDay(p)) { alert("Enter a valid season start/end (MM-DD)."); return; }
  // nextDue = the first natural occurrence on/after max(startDate, today)
  p.nextDue = (typeof recurFirstOccurrence === "function") ? recurFirstOccurrence(p, today()) : (p.startDate || today());
  touch(p);
  if (isNew) d.recurringPlans.push(p);
  else { var i = d.recurringPlans.findIndex(function (x) { return x && x.id === p.id; }); if (i >= 0) d.recurringPlans[i] = p; else d.recurringPlans.push(p); }
  if (typeof logChange === "function") logChange(isNew ? "create" : "update", "recurringPlan", p.id, (isNew ? "New recurring plan · " : "Updated recurring plan · ") + (p.title || recurCustName(p.customerId) || "plan"));
  save();
  recurForceMaterialize();   // generate the first visits inside the horizon right away
  closeModal(); TAB = "recurring"; render();
};

/* ================= LIFECYCLE ================= */
function recurLifecycle(id, mutate, opts) {
  opts = opts || {};
  if (!recurCanManage()) { if (typeof alert === "function") alert("Recurring plans are owner/admin only."); return false; }
  var p = recurPlanById(id); if (!p) return false;
  if (opts.confirm && typeof confirm === "function" && !confirm(opts.confirm)) return false;
  mutate(p);
  touch(p); save();
  if (opts.materialize) recurForceMaterialize();
  if (opts.closeModal && typeof closeModal === "function") closeModal();
  if (typeof render === "function") render();
  return true;
}
window.recurPause = function (id) { return recurLifecycle(id, function (p) { p.status = "paused"; }, { closeModal: true }); };
window.recurResume = function (id) {
  return recurLifecycle(id, function (p) {
    p.status = "active";
    p.nextDue = (typeof recurFirstOccurrence === "function") ? recurFirstOccurrence(p, today()) : (p.startDate || today());   // resume FROM TODAY — never backfill
  }, { materialize: true, closeModal: true });
};
window.recurEnd = function (id) { return recurLifecycle(id, function (p) { p.status = "ended"; }, { confirm: "End this recurring plan? No new visits will be generated (existing jobs stay).", closeModal: true }); };
window.recurSkipNext = function (id) {
  return recurLifecycle(id, function (p) {
    var cur = p.nextDue || ((typeof recurFirstOccurrence === "function") ? recurFirstOccurrence(p, today()) : today());
    var nx = (typeof recurAdvance === "function") ? recurAdvance(p, cur) : cur;
    if (typeof recurInSeason === "function" && p.frequency === "seasonal" && !recurInSeason(p, nx) && typeof recurNextSeasonStart === "function") nx = recurNextSeasonStart(p, nx);
    p.nextDue = nx;   // advance one step, generate NOTHING
  }, {});
};
window.recurDeletePlan = function (id) { return recurLifecycle(id, function (p) { p.deleted = true; }, { confirm: "Delete this recurring plan? Jobs already generated are kept.", closeModal: true }); };

/* ================= create-from-quote (wizard hook, js/23) ================= */
window.recurPlanFromQuote = function () {
  try {
    if (typeof WZ === "undefined" || !WZ) return;
    var it = (WZ.items && WZ.items[0]) || {};
    recurPlanOpen(null, {
      customerId: (WZ.cust && WZ.cust.id) || "", propertyId: (WZ.cust && WZ.cust.propertyId) || "",
      title: it.name || "", price: +it.price || 0, discountPct: 20, serviceId: it.serviceId || ""
    });
  } catch (e) {}
};

/* ================= exports (app / browser only — this UI module is not node-requireable; the Phase-2 test
   runs in the verify-app browser context where window exists) ================= */
if (typeof window !== "undefined") {
  window.rRecurring = rRecurring;
  window.recurPlanFromFields = recurPlanFromFields;
  window.recurHasValidDay = recurHasValidDay;
  window.recurForceMaterialize = recurForceMaterialize;
  window.recurPlanById = recurPlanById;
  window.recurPlans = recurPlans;
}
