/* ---------- AVAILABILITY CALENDAR (self-service "My shifts") ----------
   Mobile-first month calendar for marking your own availability per day (Phase 2 of the scheduler):
     • TAP a day            → quick-set that one day (Full / Part of day / Off / back to default)
     • PRESS & HOLD a day   → start multi-select; tap more days; then bulk-set the selection
     • "available all day today" one-tap shortcut
   Writes u.avail.overrides[YYYY-MM-DD] (Phase 1 model, js/33) and rides the account-record LWW sync.
   Permission mirrors openAvailability: you may edit YOUR OWN availability in any view (incl. crew
   preview); an owner may pick any member to edit. Reuses the calendar grid styling from js/09. */

let AVCAL_Y = null, AVCAL_M = null, AVCAL_TARGET = null, AVCAL_SEL = null, AVCAL_MULTI = false, AVCAL_SUPPRESS = false, _avLongTimer = null, AVCAL_ANCHOR = null;

/* the member being edited: an owner may pick anyone; everyone else edits themselves */
function avTargetUser(){
  const me = (typeof curUser === "function") ? curUser() : null;
  if (typeof isOwner === "function" && isOwner() && AVCAL_TARGET){
    const u = (typeof schedMembers === "function" ? schedMembers() : []).find(x => x.id === AVCAL_TARGET);
    if (u) return u;
  }
  return me;
}
function avSetDay(u, ds, val){
  if (!u) return;
  if (!u.avail) u.avail = { overrides: {} };
  if (!u.avail.overrides) u.avail.overrides = {};
  if (!val || val === "default") delete u.avail.overrides[ds];
  else u.avail.overrides[ds] = val;
  if (typeof touch === "function") touch(u);
}
function avCommit(){ if (typeof save === "function") save(); if (typeof render === "function") render(); }
function avClearTimer(){ if (_avLongTimer){ clearTimeout(_avLongTimer); _avLongTimer = null; } }

window.avPickTarget  = function(id){ AVCAL_TARGET = id; if (typeof render === "function") render(); };
window.avMonthShift  = function(n){ AVCAL_M += n; if (AVCAL_M < 0){ AVCAL_M = 11; AVCAL_Y--; } if (AVCAL_M > 11){ AVCAL_M = 0; AVCAL_Y++; } if (typeof render === "function") render(); };
window.avMonthToday  = function(){ const d = new Date(); AVCAL_Y = d.getFullYear(); AVCAL_M = d.getMonth(); if (typeof render === "function") render(); };
window.avEnterMulti  = function(ds){ AVCAL_MULTI = true; if (!AVCAL_SEL) AVCAL_SEL = new Set(); if (ds) AVCAL_SEL.add(ds); if (typeof render === "function") render(); };
window.avCancelMulti = function(){ AVCAL_MULTI = false; if (AVCAL_SEL) AVCAL_SEL.clear(); if (typeof render === "function") render(); };
window.avToggleSel   = function(ds){ if (!AVCAL_SEL) AVCAL_SEL = new Set(); if (AVCAL_SEL.has(ds)) AVCAL_SEL.delete(ds); else AVCAL_SEL.add(ds); if (typeof render === "function") render(); };
window.avApplyBulk   = function(val){ const u = avTargetUser(); if (!u || !AVCAL_SEL) return; AVCAL_SEL.forEach(ds => avSetDay(u, ds, val)); AVCAL_SEL.clear(); AVCAL_MULTI = false; avCommit(); };
window.avTodayFull   = function(){ const u = avTargetUser(); if (!u){ alert("Sign in to set your availability."); return; } avSetDay(u, today(), "full"); avCommit(); };

/* tap vs long-press: a long-press fires the timer (enters/extends multi-select) and suppresses the
   trailing click so a hold never also counts as a tap */
window.avLongStart  = function(ds){ avClearTimer(); _avLongTimer = setTimeout(function(){ AVCAL_SUPPRESS = true; if (!AVCAL_MULTI) window.avEnterMulti(ds); else window.avToggleSel(ds); }, 420); };
window.avLongEnd    = function(){ avClearTimer(); };
window.avLongCancel = function(){ avClearTimer(); };
window.avDayTap = function(ds){
  if (AVCAL_SUPPRESS){ AVCAL_SUPPRESS = false; return; }   // this "click" was the end of a long-press
  if (AVCAL_MULTI){ window.avToggleSel(ds); return; }
  avQuickEdit(ds);
};
/* all YYYY-MM-DD dates between a and b inclusive (string compare orders YYYY-MM-DD correctly) */
function avDateRange(a, b){ if (a > b){ const t = a; a = b; b = t; } const out = [], d = new Date(a + "T00:00:00"), end = new Date(b + "T00:00:00"); while (d <= end){ out.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")); d.setDate(d.getDate() + 1); } return out; }
/* desktop bulk-select: Ctrl/⌘-click toggles a day into the group; Shift-click selects the range from the anchor */
window.avDayClick = function(e, ds){
  if (e && (e.ctrlKey || e.metaKey)){
    if (e.preventDefault) e.preventDefault();
    if (!AVCAL_MULTI){ AVCAL_MULTI = true; if (!AVCAL_SEL) AVCAL_SEL = new Set(); }
    if (AVCAL_SEL.has(ds)) AVCAL_SEL.delete(ds); else AVCAL_SEL.add(ds);
    AVCAL_ANCHOR = ds; if (typeof render === "function") render(); return;
  }
  if (e && e.shiftKey){
    if (e.preventDefault) e.preventDefault();
    if (!AVCAL_MULTI){ AVCAL_MULTI = true; if (!AVCAL_SEL) AVCAL_SEL = new Set(); }
    avDateRange(AVCAL_ANCHOR || ds, ds).forEach(d => AVCAL_SEL.add(d));
    AVCAL_ANCHOR = ds; if (typeof render === "function") render(); return;
  }
  AVCAL_ANCHOR = ds; avDayTap(ds);
};
/* click a weekday header → select that whole column (all those weekdays) in the visible month */
window.avSelectDow = function(dow, y, m){
  if (y == null) y = AVCAL_Y; if (m == null) m = AVCAL_M;
  if (!AVCAL_MULTI){ AVCAL_MULTI = true; if (!AVCAL_SEL) AVCAL_SEL = new Set(); }
  const dim = new Date(y, m + 1, 0).getDate(), days = [];
  for (let day = 1; day <= dim; day++){ if (new Date(y, m, day).getDay() === dow){ days.push(y + "-" + String(m + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0")); } }
  const allSel = days.length && days.every(d => AVCAL_SEL.has(d));
  days.forEach(d => allSel ? AVCAL_SEL.delete(d) : AVCAL_SEL.add(d));   // toggle: deselect the column if it's already fully selected
  AVCAL_ANCHOR = null; if (typeof render === "function") render();
};

/* last partial hours this member saved → the default for the next part-of-day edit (single or bulk) */
function avLastPart(u){ const lp = (u && u.avail && u.avail.lastPartial) || {}; return { start: lp.start || "08:00", end: lp.end || "12:00" }; }
function avQuickEdit(ds){
  const u = avTargetUser(); if (!u){ alert("Sign in to set your availability."); return; }
  const ov = u.avail && u.avail.overrides && u.avail.overrides[ds];
  const curS = (typeof ov === "string") ? ov : (ov && ov.s) || "";
  const ovObj = (ov && typeof ov === "object") ? ov : {};
  const lp = avLastPart(u); const curStart = ovObj.start || lp.start, curEnd = ovObj.end || lp.end;
  const who = (typeof curUser === "function" && curUser() && curUser().id === u.id) ? "your" : (esc(u.username) + "’s");
  modal("Availability — " + fmtDate(ds), `
    <p class="muted" style="margin-bottom:10px">Set ${who} availability for <b>${fmtDate(ds)}</b>.</p>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button class="btn ${curS === "full" ? "acc" : "ghost"} grow" onclick="avQuickSet('${ds}','full')">🟢 Full day</button>
      <button class="btn ${curS === "off" ? "danger" : "ghost"} grow" onclick="avQuickSet('${ds}','off')">🔴 Off</button>
      <button class="btn grow" style="${curS === "oncall" ? "background:#2f6fed;color:#fff" : ""}" onclick="avQuickSet('${ds}','oncall')">🔵 On call</button>
    </div>
    <div class="card" style="margin-top:10px;border-color:#e0a800">
      <div style="font-weight:700;margin-bottom:4px">🟡 Part of day${curS === "partial" ? " · current" : ""}</div>
      <div class="row" style="gap:8px">
        <div class="grow"><label style="margin-top:0">From</label><input type="time" id="av_start" value="${curStart}"></div>
        <div class="grow"><label style="margin-top:0">To</label><input type="time" id="av_end" value="${curEnd}"></div>
      </div>
      <button class="btn" style="margin-top:10px;width:100%;background:#e0a800;color:#1a1a1a" onclick="avSetPartial('${ds}')">Save part of day</button>
    </div>
    <button class="btn ghost sm" style="margin-top:12px;width:100%" onclick="avQuickSet('${ds}','default')">↩ Use my normal schedule (clear this day)</button>`);
}
window.avSetPartial = function(ds){
  const u = avTargetUser(); if (!u) return;
  const s = val("av_start") || "08:00", e = val("av_end") || "12:00";
  avSetDay(u, ds, { s: "partial", start: s, end: e });
  if (!u.avail) u.avail = {}; u.avail.lastPartial = { start: s, end: e }; if (typeof touch === "function") touch(u);
  if (typeof closeModal === "function") closeModal(); avCommit();
};
/* bulk "Part of day": prompt once for the hours, then apply them to every selected day (was silently defaulting) */
window.avBulkPartial = function(){
  const u = avTargetUser(); if (!u){ alert("Sign in to set availability."); return; }
  const n = AVCAL_SEL ? AVCAL_SEL.size : 0; if (!n) return;
  const lp = avLastPart(u);
  modal("Part of day — " + n + " day" + (n === 1 ? "" : "s"), `
    <p class="muted" style="margin-bottom:10px">Set the same hours for all <b>${n}</b> selected day${n === 1 ? "" : "s"}.</p>
    <div class="row" style="gap:8px">
      <div class="grow"><label style="margin-top:0">From</label><input type="time" id="av_start" value="${lp.start}"></div>
      <div class="grow"><label style="margin-top:0">To</label><input type="time" id="av_end" value="${lp.end}"></div>
    </div>
    <button class="btn" style="margin-top:12px;width:100%;background:#e0a800;color:#1a1a1a" onclick="avApplyBulkPartial()">Apply to ${n} day${n === 1 ? "" : "s"}</button>`);
};
window.avApplyBulkPartial = function(){
  const u = avTargetUser(); if (!u || !AVCAL_SEL) return;
  const s = val("av_start") || "08:00", e = val("av_end") || "12:00";
  AVCAL_SEL.forEach(ds => avSetDay(u, ds, { s: "partial", start: s, end: e }));
  if (!u.avail) u.avail = {}; u.avail.lastPartial = { start: s, end: e }; if (typeof touch === "function") touch(u);
  AVCAL_SEL.clear(); AVCAL_MULTI = false;
  if (typeof closeModal === "function") closeModal(); avCommit();
};
window.avQuickSet = function(ds, val){ const u = avTargetUser(); avSetDay(u, ds, val); if (typeof closeModal === "function") closeModal(); avCommit(); };

/* how many days in the next 28 are explicitly posted — the 2-week minimum is 14 (you can post further) */
function avCoverage(u){
  const t = (typeof today === "function") ? today() : "";
  const base = new Date(t + "T00:00:00"); if (isNaN(base.getTime())) return 0;
  let posted = 0;
  for (let i = 0; i < 28; i++){
    const d = new Date(base); d.setDate(d.getDate() + i);
    const ds = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const st = (typeof availOn === "function") ? availOn(u, ds).status : "unknown";
    if (st === "on" || st === "partial" || st === "oncall" || st === "off" || st === "timeoff") posted++;
  }
  return posted;
}
/* one month's grid (header + cells). showNav puts the ‹ › / Today controls on it; the second month is title-only. */
function avMonthGrid(u, y, m, showNav){
  const first = new Date(y, m, 1), startDow = first.getDay(), dim = new Date(y, m + 1, 0).getDate();
  const mname = first.toLocaleString(undefined, { month: "long" }), t = (typeof today === "function") ? today() : "";
  const dows = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  let cells = dows.map((d, i) => `<div class="caldow" style="cursor:pointer" title="Select all ${d} this month" onclick="avSelectDow(${i},${y},${m})">${d}</div>`).join("");
  for (let i = 0; i < startDow; i++) cells += `<div class="calcell out"></div>`;
  for (let day = 1; day <= dim; day++){
    const ds = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
    const a = (typeof availOn === "function") ? availOn(u, ds) : { status: "unset" };
    const bg = a.status === "on" ? "background:rgba(26,127,55,.16)" : a.status === "partial" ? "background:rgba(224,168,0,.24)" : a.status === "oncall" ? "background:rgba(47,111,237,.20)" : (a.status === "off" || a.status === "timeoff") ? "background:rgba(192,57,43,.14)" : a.status === "unknown" ? "background:rgba(130,140,155,.15)" : "";
    const dot = a.status === "on" ? "#1a7f37" : a.status === "partial" ? "#e0a800" : a.status === "oncall" ? "#2f6fed" : (a.status === "off" || a.status === "timeoff") ? "#c0392b" : a.status === "unknown" ? "#97a0ad" : "transparent";
    const sel = !!(AVCAL_SEL && AVCAL_SEL.has(ds));
    const selSty = sel ? ";outline:3px solid #4da6ff;outline-offset:-3px;border-radius:8px;box-shadow:inset 0 0 0 999px rgba(77,166,255,.32)" : "";
    cells += `<div class="calcell${ds === t ? " today" : ""}" style="${bg}${selSty}" onclick="avDayClick(event,'${ds}')" ontouchstart="avLongStart('${ds}')" ontouchend="avLongEnd()" ontouchmove="avLongCancel()">
      <div class="dnum">${day}</div><div style="margin:4px auto 0;width:10px;height:10px;border-radius:50%;background:${dot}${dot === "transparent" ? ";border:1px solid var(--line)" : ""}"></div></div>`;
  }
  const nav = showNav
    ? `<button class="calnav" onclick="avMonthShift(-1)">‹</button><div class="mtitle">${mname} ${y}</div><button class="calnav" onclick="avMonthShift(1)">›</button><button class="btn ghost sm" style="margin-left:auto" onclick="avMonthToday()">Today</button>`
    : `<div class="mtitle">${mname} ${y}</div>`;
  return `<div class="calhead">${nav}</div><div class="calgrid">${cells}</div>`;
}
/* the shared action / multi-select bar (one set of controls for both months) */
function avCalBar(){
  if (AVCAL_MULTI){
    const n = AVCAL_SEL ? AVCAL_SEL.size : 0;
    return `<div class="wizfoot"><div class="wf-amt"><span class="wf-lab">Selected</span><b>${n}</b></div>
      <button class="btn acc grow" onclick="avApplyBulk('full')">🟢 Full</button>
      <button class="btn grow" style="background:#e0a800;color:#1a1a1a" onclick="avBulkPartial()">🟡 Part</button>
      <button class="btn danger grow" onclick="avApplyBulk('off')">🔴 Off</button>
      <button class="btn grow" style="background:#2f6fed;color:#fff" onclick="avApplyBulk('oncall')">🔵 On call</button>
      <button class="btn ghost sm" onclick="avApplyBulk('default')" title="Clear to normal schedule">↩</button>
      <button class="btn ghost sm" onclick="avCancelMulti()">✕</button></div>`;
  }
  return `<div class="row" style="gap:8px;margin-top:10px"><button class="btn ghost grow" onclick="avEnterMulti()">☑ Select multiple days</button><button class="btn acc grow" onclick="avTodayFull()">🟢 Available all day today</button></div>`;
}

/* click anywhere outside the calendar grid / bulk bar clears a pending multi-selection */
if (typeof document !== "undefined" && !window.__avClickAway){
  window.__avClickAway = true;
  document.addEventListener("click", function(e){
    if (!AVCAL_MULTI) return;
    const tgt = e.target;
    if (tgt && tgt.closest && (tgt.closest(".calgrid") || tgt.closest(".calhead") || tgt.closest(".wizfoot") || tgt.closest("#overlay"))) return;
    AVCAL_MULTI = false; if (AVCAL_SEL) AVCAL_SEL.clear(); AVCAL_ANCHOR = null;
    if (typeof render === "function") render();
  }, true);
}

function renderMyAvailCalendar(){
  const u = avTargetUser();
  if (!u) return `<div class="card"><div class="muted">Sign in to set your availability.</div></div>`;
  const owner = (typeof isOwner === "function" && isOwner());
  let h = "";
  if (owner){
    const mem = (typeof schedMembers === "function") ? schedMembers() : [];
    const meId = (typeof curUser === "function" && curUser()) ? curUser().id : null;
    h += `<div class="card" style="padding:10px"><label>Editing availability for</label>
      <select onchange="avPickTarget(this.value)" style="font-size:14px">${mem.map(m => `<option value="${esc(m.id)}" ${m.id === u.id ? "selected" : ""}>${esc(m.username)}${m.id === meId ? " (you)" : ""}</option>`).join("")}</select></div>`;
  }
  if (AVCAL_Y == null){ const d = new Date(); AVCAL_Y = d.getFullYear(); AVCAL_M = d.getMonth(); }
  const cov = avCoverage(u), ok = cov >= 14, accent = ok ? "#1a7f37" : "#e0a800";
  h += `<div class="card" style="padding:12px;border-left:4px solid ${accent}">
    <div class="row" style="align-items:baseline"><div class="grow"><b style="font-size:18px">${cov} / 14</b> <span class="sub">days posted · 2-week minimum</span></div>
      <div style="font-weight:800;color:${accent}">${ok ? "✓ covered" : (14 - cov) + " to go"}</div></div>
    <div style="height:8px;border-radius:5px;background:var(--line);margin-top:8px;overflow:hidden"><div style="height:100%;width:${Math.min(100, Math.round(cov / 14 * 100))}%;background:${accent}"></div></div>
    <div class="sub" style="margin-top:6px">${ok ? (cov > 14 ? "Nice — you're posted " + cov + " days out." : "You're 2 weeks out. Go further anytime.") : "Keep at least 14 days posted ahead — you can go to 3+ weeks."}</div></div>`;
  h += `<div class="card" style="padding:10px 12px"><div class="sub" style="white-space:normal">Tap a day to set it · <b>press &amp; hold</b> (or <b>Ctrl/⌘-click</b>) to multi-select, <b>Shift-click</b> for a range, then bulk-set. &nbsp; <span style="color:#1a7f37;font-weight:800">●</span> all day · <span style="color:#e0a800;font-weight:800">●</span> part of day · <span style="color:#c0392b;font-weight:800">●</span> off · <span style="color:#2f6fed;font-weight:800">●</span> on call · ○ normal</div></div>`;
  let ny = AVCAL_Y, nm = AVCAL_M + 1; if (nm > 11){ nm = 0; ny++; }
  h += avMonthGrid(u, AVCAL_Y, AVCAL_M, true);
  h += `<div style="height:14px"></div>` + avMonthGrid(u, ny, nm, false);
  h += avCalBar();
  return h;
}
