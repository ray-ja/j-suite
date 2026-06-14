/* ---------- AVAILABILITY CALENDAR (self-service "My shifts") ----------
   Mobile-first month calendar for marking your own availability per day (Phase 2 of the scheduler):
     • TAP a day            → quick-set that one day (Full / Part of day / Off / back to default)
     • PRESS & HOLD a day   → start multi-select; tap more days; then bulk-set the selection
     • "available all day today" one-tap shortcut
   Writes u.avail.overrides[YYYY-MM-DD] (Phase 1 model, js/33) and rides the account-record LWW sync.
   Permission mirrors openAvailability: you may edit YOUR OWN availability in any view (incl. crew
   preview); an owner may pick any member to edit. Reuses the calendar grid styling from js/09. */

let AVCAL_Y = null, AVCAL_M = null, AVCAL_TARGET = null, AVCAL_SEL = null, AVCAL_MULTI = false, AVCAL_SUPPRESS = false, _avLongTimer = null;

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

function avQuickEdit(ds){
  const u = avTargetUser(); if (!u){ alert("Sign in to set your availability."); return; }
  const ov = u.avail && u.avail.overrides && u.avail.overrides[ds];
  const curS = (typeof ov === "string") ? ov : (ov && ov.s) || "";
  const who = (typeof curUser === "function" && curUser() && curUser().id === u.id) ? "your" : (esc(u.username) + "’s");
  modal("Availability — " + fmtDate(ds), `
    <p class="muted" style="margin-bottom:10px">Set ${who} availability for <b>${fmtDate(ds)}</b>.</p>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button class="btn ${curS === "full" ? "acc" : "ghost"} grow" onclick="avQuickSet('${ds}','full')">🟢 Full day</button>
      <button class="btn grow" style="${curS === "partial" ? "background:#e0a800;color:#1a1a1a" : "background:var(--soft);color:var(--ink)"}" onclick="avQuickSet('${ds}','partial')">🟡 Part of day</button>
      <button class="btn ${curS === "off" ? "danger" : "ghost"} grow" onclick="avQuickSet('${ds}','off')">🔴 Off</button>
    </div>
    <button class="btn ghost sm" style="margin-top:12px;width:100%" onclick="avQuickSet('${ds}','default')">↩ Use my normal schedule (clear this day)</button>`);
}
window.avQuickSet = function(ds, val){ const u = avTargetUser(); avSetDay(u, ds, val); if (typeof closeModal === "function") closeModal(); avCommit(); };

function avCalGrid(u){
  const first = new Date(AVCAL_Y, AVCAL_M, 1), startDow = first.getDay(), dim = new Date(AVCAL_Y, AVCAL_M + 1, 0).getDate();
  const mname = first.toLocaleString(undefined, { month: "long" }), t = (typeof today === "function") ? today() : "";
  const dows = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  let cells = dows.map(d => `<div class="caldow">${d}</div>`).join("");
  for (let i = 0; i < startDow; i++) cells += `<div class="calcell out"></div>`;
  for (let day = 1; day <= dim; day++){
    const ds = AVCAL_Y + "-" + String(AVCAL_M + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
    const a = (typeof availOn === "function") ? availOn(u, ds) : { status: "unset" };
    const bg = a.status === "on" ? "background:rgba(26,127,55,.16)" : a.status === "partial" ? "background:rgba(224,168,0,.24)" : (a.status === "off" || a.status === "timeoff") ? "background:rgba(192,57,43,.14)" : "";
    const dot = a.status === "on" ? "#1a7f37" : a.status === "partial" ? "#e0a800" : (a.status === "off" || a.status === "timeoff") ? "#c0392b" : "transparent";
    const sel = !!(AVCAL_SEL && AVCAL_SEL.has(ds));
    const selSty = sel ? ";outline:3px solid var(--brand);outline-offset:-3px;border-radius:8px" : "";
    cells += `<div class="calcell${ds === t ? " today" : ""}" style="${bg}${selSty}" onclick="avDayTap('${ds}')" ontouchstart="avLongStart('${ds}')" ontouchend="avLongEnd()" ontouchmove="avLongCancel()">
      <div class="dnum">${day}</div><div style="margin:4px auto 0;width:10px;height:10px;border-radius:50%;background:${dot}${dot === "transparent" ? ";border:1px solid var(--line)" : ""}"></div></div>`;
  }
  const head = `<div class="calhead"><button class="calnav" onclick="avMonthShift(-1)">‹</button><div class="mtitle">${mname} ${AVCAL_Y}</div><button class="calnav" onclick="avMonthShift(1)">›</button><button class="btn ghost sm" style="margin-left:auto" onclick="avMonthToday()">Today</button></div>`;
  let bar;
  if (AVCAL_MULTI){
    const n = AVCAL_SEL ? AVCAL_SEL.size : 0;
    bar = `<div class="wizfoot"><div class="wf-amt"><span class="wf-lab">Selected</span><b>${n}</b></div>
      <button class="btn acc grow" onclick="avApplyBulk('full')">🟢 Full</button>
      <button class="btn grow" style="background:#e0a800;color:#1a1a1a" onclick="avApplyBulk('partial')">🟡 Part</button>
      <button class="btn danger grow" onclick="avApplyBulk('off')">🔴 Off</button>
      <button class="btn ghost sm" onclick="avApplyBulk('default')" title="Clear to normal schedule">↩</button>
      <button class="btn ghost sm" onclick="avCancelMulti()">✕</button></div>`;
  } else {
    bar = `<div class="row" style="gap:8px;margin-top:10px"><button class="btn ghost grow" onclick="avEnterMulti()">☑ Select multiple days</button><button class="btn acc grow" onclick="avTodayFull()">🟢 Available all day today</button></div>`;
  }
  return head + `<div class="calgrid">${cells}</div>` + bar;
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
  h += `<div class="card" style="padding:10px 12px"><div class="sub" style="white-space:normal">Tap a day to set it · <b>press &amp; hold</b> to select several, then bulk-set. &nbsp; <span style="color:#1a7f37;font-weight:800">●</span> all day · <span style="color:#e0a800;font-weight:800">●</span> part of day · <span style="color:#c0392b;font-weight:800">●</span> off · ○ normal</div></div>`;
  h += avCalGrid(u);
  return h;
}
