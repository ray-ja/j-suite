/* ---------- TIME CLOCK + GPS MILEAGE ----------
   Crew clock in/out against a Job. We capture GPS at clock-in and clock-out (browser
   Geolocation, permission-gated) plus optional pings while the app is in the FOREGROUND, then
   compute the travelled distance and attribute the hours + miles to that job and user. Mileage
   rolls up at $0.725/mi and is tagged with whose vehicle was used.

   HONEST LIMITATION (encoded in the UI): a PWA can't track a continuous background route — the OS
   suspends a backgrounded web app (especially iOS), so there is no GPS while the phone is locked
   or the app is hidden. We therefore record only the start/end stamps + whatever foreground pings
   we got, and we label the computed mileage an OWNER-CONFIRMED ESTIMATE. The owner can edit and
   confirm the miles before they count.

   Storage: a new per-business `timeclock` collection of entry records, each carrying updatedAt so
   it rides the existing per-record last-write-wins sync (server COLLECTIONS + mergeColl). Entries
   are single-owner (a crew member's own shift; mileage adjusted by the owner) so — like todos and
   availability — they are intentionally NOT soft-locked: per-record LWW already prevents loss. */

const TC_RATE = 0.725;        // $/mile — owner-confirmable mileage reimbursement / cost rate
const TC_PING_MS = 120000;    // foreground ping cadence (~2 min) — enough to shape the path, easy on battery
let TCSUB = "clock";          // "clock" (crew) | "report" (owner: hours + miles per job/user)
let _tcPing = null, _tcClock = null;

/* ----- data accessors ----- */
function tcoll() { const d = D(); if (!d.timeclock) d.timeclock = []; return d.timeclock; }
function actTC() { return tcoll().filter(e => !e.deleted); }
function tcWho() {
  const u = (typeof curUser === "function") ? curUser() : null;
  if (u) return { userId: u.id, name: u.username };
  // signed-out / offline crew device: stable per-device identity so a shift still attributes + syncs
  let dev = localStorage.getItem("jra_device");
  if (!dev) { dev = "dev_" + uid(); try { localStorage.setItem("jra_device", dev); } catch (e) {} }
  return { userId: dev, name: "A teammate" };
}
function tcOpenShift(userId) { return actTC().find(e => e.userId === userId && !e.clockOut); }
function tcMyOpen() { return tcOpenShift(tcWho().userId); }
function tcJob(id) { return (D().jobs || []).find(j => j.id === id) || null; }
function tcJobTitle(id) { const j = tcJob(id); return j ? (j.title || "Job") : "—"; }

/* ----- geometry + math ----- */
function tcHaversine(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return 0;
  const R = 3958.8, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));   // miles
}
/* ordered travelled path: clock-in stamp → foreground pings (by time) → clock-out stamp */
function tcPath(e) {
  const pts = [];
  if (e.inLoc) pts.push(e.inLoc);
  (e.pings || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0)).forEach(p => pts.push(p));
  if (e.outLoc) pts.push(e.outLoc);
  return pts;
}
function tcComputeMiles(e) { const p = tcPath(e); let m = 0; for (let i = 1; i < p.length; i++) m += tcHaversine(p[i - 1], p[i]); return m; }
function tcHours(e) { const end = e.clockOut || now(); return Math.max(0, (end - e.clockIn) / 3600000); }
function tcFmtDur(ms) { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h + "h " + String(m).padStart(2, "0") + "m"; }
function tcRound(n) { return Math.round((n || 0) * 10) / 10; }
/* confirmed miles if set, else the rounded GPS estimate */
function tcMiles(e) { return (e.miles != null) ? e.miles : tcRound(e.computedMiles); }
function tcMileageCost(e) { return tcMiles(e) * (e.rate || TC_RATE); }

/* ----- geolocation (permission-gated; resolves null on deny/unavailable so time-tracking still works) ----- */
function tcGetPos() {
  return new Promise(function (resolve) {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      function (p) { resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, ts: now() }); },
      function () { resolve(null); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

/* ----- foreground ping loop (only runs while the tab is visible AND a shift is open) ----- */
function tcPingStart() { tcPingStop(); _tcPing = setInterval(tcPingTick, TC_PING_MS); }
function tcPingStop() { if (_tcPing) { clearInterval(_tcPing); _tcPing = null; } }
async function tcPingTick() {
  if (document.hidden) return;                     // foreground only — OS suspends background PWAs
  const e = tcMyOpen(); if (!e) { tcPingStop(); return; }
  const loc = await tcGetPos(); if (!loc) return;
  e.pings = e.pings || []; e.pings.push(loc);
  e.computedMiles = tcComputeMiles(e); touch(e); save();
  const me = document.getElementById("tc_miles"); if (me) me.textContent = tcRound(e.computedMiles) + " mi est";
  const pe = document.getElementById("tc_pings"); if (pe) pe.textContent = (e.pings.length) + " ping" + (e.pings.length === 1 ? "" : "s");
}

/* ===== clock in / out ===== */
window.tcClockIn = async function () {
  const jobId = val("tc_job");
  if (!jobId) { alert("Pick the job you're working on."); return; }
  const who = tcWho();
  if (tcOpenShift(who.userId)) { alert("You already have an open shift — clock out first."); render(); return; }
  const vehicle = val("tc_vehicle");
  const btn = document.getElementById("tc_inbtn"); if (btn) { btn.disabled = true; btn.textContent = "Getting location…"; }
  const loc = await tcGetPos();
  const e = {
    id: uid(), jobId: jobId, userId: who.userId, userName: who.name,
    clockIn: now(), clockOut: null,
    inLoc: loc, outLoc: null, pings: [],
    computedMiles: 0, miles: null, milesConfirmed: false,
    vehicle: vehicle || "", rate: TC_RATE, updatedAt: now()
  };
  tcoll().push(e);
  if (typeof logChange === "function") logChange("create", "timeclock", e.id, "Clocked in — " + tcJobTitle(jobId) + " · " + who.name + (loc ? "" : " (no GPS)"));
  save(); tcPingStart(); render();
};
window.tcClockOut = async function (id) {
  const e = tcoll().find(x => x.id === id); if (!e || e.clockOut) return;
  const btn = document.getElementById("tc_outbtn"); if (btn) { btn.disabled = true; btn.textContent = "Getting location…"; }
  const loc = await tcGetPos();
  e.outLoc = loc; e.clockOut = now();
  e.computedMiles = tcComputeMiles(e);
  if (e.miles == null) e.miles = tcRound(e.computedMiles);   // seed the editable value from the estimate
  touch(e); tcPingStop();
  if (typeof logChange === "function") logChange("update", "timeclock", e.id, "Clocked out — " + tcFmtDur(e.clockOut - e.clockIn) + " · " + tcMiles(e) + " mi (est) · " + tcJobTitle(e.jobId));
  save(); render();
};

/* ===== owner: edit / confirm an entry's mileage + vehicle ===== */
window.tcOpenEntry = function (id) {
  if (typeof isOwner === "function" && !isOwner()) { alert("Only the owner can adjust logged time + mileage."); return; }
  const e = tcoll().find(x => x.id === id); if (!e) return;
  const veh = (typeof schedMembers === "function") ? schedMembers().map(u => u.username) : [];
  modal("Time entry — " + esc(tcJobTitle(e.jobId)), `
    <div class="card" style="padding:10px"><div class="nm" style="font-size:15px">${esc(e.userName || "Crew")}</div>
      <div class="sub">${fmtDate(new Date(e.clockIn).toISOString().slice(0,10))} · ${tcFmtDur((e.clockOut || now()) - e.clockIn)} worked${e.clockOut ? "" : " · still open"}</div>
      <div class="sub">GPS estimate: <b>${tcRound(e.computedMiles)} mi</b> from ${e.inLoc ? "in" : "no in"}${e.outLoc ? " + out" : ""}${(e.pings||[]).length ? " + " + e.pings.length + " ping(s)" : ""}</div></div>
    <label>Miles (owner-confirmed)</label>
    <input id="tc_e_miles" type="number" step="0.1" value="${tcMiles(e)}">
    <div class="sub" style="margin-top:4px">Mileage cost @ $${TC_RATE}/mi updates on save. GPS distance is an estimate — confirm the real driven miles.</div>
    <label style="margin-top:10px">Whose vehicle</label>
    <input id="tc_e_veh" list="tc_e_vehlist" value="${esc(e.vehicle || "")}" placeholder="e.g. Ray's truck">
    <datalist id="tc_e_vehlist">${veh.map(n => `<option value="${esc(n)}'s vehicle">`).join("")}</datalist>
    <label class="li" style="cursor:pointer;margin-top:10px"><input type="checkbox" id="tc_e_conf" style="width:20px;height:20px;flex:0 0 auto" ${e.milesConfirmed ? "checked" : ""}><div class="grow"><div class="nm" style="font-size:15px">Confirm mileage</div><div class="sub">Marks it owner-verified (no longer an estimate)</div></div></label>
    <button class="btn acc" style="margin-top:14px" onclick="tcSaveEntry('${e.id}')">Save</button>
    <button class="btn danger" style="margin-top:10px" onclick="tcDelEntry('${e.id}')">Delete entry</button>`);
};
window.tcSaveEntry = function (id) {
  const e = tcoll().find(x => x.id === id); if (!e) return;
  const m = parseFloat(val("tc_e_miles")); e.miles = isNaN(m) ? tcRound(e.computedMiles) : Math.max(0, m);
  e.vehicle = val("tc_e_veh"); e.milesConfirmed = !!(document.getElementById("tc_e_conf") || {}).checked;
  touch(e);
  if (typeof logChange === "function") logChange("update", "timeclock", e.id, (e.milesConfirmed ? "Confirmed" : "Adjusted") + " mileage — " + tcMiles(e) + " mi · " + tcJobTitle(e.jobId));
  save(); closeModal(); render();
};
window.tcDelEntry = function (id) {
  const e = tcoll().find(x => x.id === id); if (!e) return;
  if (!confirm("Delete this time entry?")) return;
  e.deleted = true; touch(e);
  if (typeof logChange === "function") logChange("delete", "timeclock", e.id, "Deleted time entry — " + tcJobTitle(e.jobId));
  save(); closeModal(); render();
};

/* ===== views ===== */
window.tcSub = function (s) { TCSUB = s; render(); };
function rTime() {
  if (_tcClock) { clearInterval(_tcClock); _tcClock = null; }
  const owner = (typeof isOwner === "function") && isOwner();
  let sub = `<div class="subnav"><button class="subbtn ${TCSUB !== "report" ? "on" : ""}" onclick="tcSub('clock')">⏱ Clock</button>${owner ? `<button class="subbtn ${TCSUB === "report" ? "on" : ""}" onclick="tcSub('report')">📊 Hours &amp; miles</button>` : ""}</div>`;
  if (owner && TCSUB === "report") { view.innerHTML = sub + tcReportHTML(); return; }
  view.innerHTML = sub + tcClockHTML();
  // live elapsed ticker while a shift is open
  const open = tcMyOpen();
  if (open) {
    if (!_tcPing) tcPingStart();
    _tcClock = setInterval(function () {
      const el = document.getElementById("tc_elapsed"); if (!el) { clearInterval(_tcClock); _tcClock = null; return; }
      el.textContent = tcFmtDur(now() - open.clockIn);
    }, 1000);
  }
}
function tcClockHTML() {
  const who = tcWho(), open = tcOpenShift(who.userId);
  let h = "";
  if (open) {
    const j = tcJob(open.jobId);
    h += `<div class="card" style="border-left:5px solid var(--accent)">
      <div class="sub">⏱ On the clock — ${esc(who.name)}</div>
      <div class="nm" style="font-size:18px;margin:2px 0">${esc(open.jobId ? tcJobTitle(open.jobId) : "Job")}${j && j.customerId ? ` <span class="sub">· ${esc(custName(j.customerId))}</span>` : ""}</div>
      <div style="display:flex;gap:14px;margin:8px 0;flex-wrap:wrap">
        <div><div style="font-size:24px;font-weight:800" id="tc_elapsed">${tcFmtDur(now() - open.clockIn)}</div><div class="sub">elapsed</div></div>
        <div><div style="font-size:24px;font-weight:800" id="tc_miles">${tcRound(open.computedMiles)} mi est</div><div class="sub" id="tc_pings">${(open.pings || []).length} ping${(open.pings || []).length === 1 ? "" : "s"}</div></div>
      </div>
      ${open.vehicle ? `<div class="sub">🚚 ${esc(open.vehicle)}</div>` : ""}
      <div class="sub" style="margin-top:6px;white-space:normal">📍 GPS pings only while this app is open and on-screen — a phone-locked or backgrounded route isn't tracked. Mileage is an estimate the owner confirms.</div>
      <button class="btn danger" id="tc_outbtn" style="margin-top:12px" onclick="tcClockOut('${open.id}')">Clock out</button>
    </div>`;
  } else {
    const jobs = (typeof actJ === "function" ? actJ() : []).filter(j => !j.done).sort((a, b) => (b.date || "") < (a.date || "") ? -1 : 1);
    const mine = jobs.filter(j => (j.crew || []).indexOf(who.userId) >= 0);
    const opt = j => `<option value="${j.id}">${esc(j.title || "Job")}${j.date ? " · " + fmtDate(j.date) : ""}${j.customerId ? " · " + esc(custName(j.customerId)) : ""}</option>`;
    const veh = (typeof schedMembers === "function") ? schedMembers().map(u => u.username) : [];
    if (!jobs.length) {
      h += `<div class="card"><div class="muted">No open jobs to clock in against. <a href="#" onclick="TAB='schedule';render();return false" style="color:var(--brand);font-weight:700">Schedule a job</a> first.</div></div>`;
    } else {
      h += `<div class="card" style="border-top:4px solid var(--accent)">
        <div class="nm" style="font-size:16px">Clock in — ${esc(who.name)}</div>
        <label>Job</label>
        <select id="tc_job">${mine.length ? `<optgroup label="Your jobs">${mine.map(opt).join("")}</optgroup><optgroup label="All open jobs">${jobs.filter(j => mine.indexOf(j) < 0).map(opt).join("")}</optgroup>` : jobs.map(opt).join("")}</select>
        <label>Whose vehicle (optional)</label>
        <input id="tc_vehicle" list="tc_vehlist" value="${esc(veh.length && veh.indexOf(who.name) >= 0 ? who.name + "'s vehicle" : "")}" placeholder="e.g. Ray's truck">
        <datalist id="tc_vehlist">${veh.map(n => `<option value="${esc(n)}'s vehicle">`).join("")}</datalist>
        <button class="btn acc" id="tc_inbtn" style="margin-top:14px" onclick="tcClockIn()">📍 Clock in</button>
        <div class="sub" style="margin-top:8px;white-space:normal">Asks for location permission to stamp where you started. Time tracks even if you decline GPS.</div>
      </div>`;
    }
  }
  // my recent shifts
  const recent = actTC().filter(e => e.userId === who.userId && e.clockOut).sort((a, b) => b.clockIn - a.clockIn).slice(0, 10);
  if (recent.length) {
    h += `<div class="secthd"><h2>Your recent shifts</h2><span class="ct">${recent.length}</span></div><div class="card">` +
      recent.map(e => `<div class="li"><div class="grow"><div class="nm" style="font-size:14px">${esc(tcJobTitle(e.jobId))}</div>
        <div class="sub">${fmtDate(new Date(e.clockIn).toISOString().slice(0,10))} · ${tcFmtDur(e.clockOut - e.clockIn)} · ${tcMiles(e)} mi${e.milesConfirmed ? "" : " est"}${e.vehicle ? " · 🚚 " + esc(e.vehicle) : ""}</div></div></div>`).join("") + `</div>`;
  }
  return h;
}

/* owner rollup — hours + miles + mileage $ per job and per user */
function tcReportHTML() {
  const all = actTC().filter(e => e.clockOut);   // completed shifts only in the rollup
  const open = actTC().filter(e => !e.clockOut);
  if (!all.length && !open.length) return `<div class="card"><div class="muted">No time logged yet. Crew clock in/out from the ⏱ Clock tab; hours and GPS mileage land here per job and per person.</div></div>`;
  const totHrs = all.reduce((s, e) => s + tcHours(e), 0), totMi = all.reduce((s, e) => s + tcMiles(e), 0);
  const unconf = all.filter(e => !e.milesConfirmed).length;
  let h = `<div class="card" style="display:flex;gap:6px;text-align:center">
    <div class="grow"><div style="font-size:22px;font-weight:800;color:var(--brand)">${totHrs.toFixed(1)}h</div><div class="sub">logged hours</div></div>
    <div class="grow" style="border-left:1px solid var(--line)"><div style="font-size:22px;font-weight:800;color:var(--brand)">${tcRound(totMi)} mi</div><div class="sub">miles (est)</div></div>
    <div class="grow" style="border-left:1px solid var(--line)"><div style="font-size:22px;font-weight:800;color:var(--brand)">${money(totMi * TC_RATE)}</div><div class="sub">mileage @ $${TC_RATE}</div></div>
  </div>`;
  if (unconf) h += `<div class="card" style="border-left:4px solid #E1A100;background:var(--soft)"><div class="sub" style="white-space:normal">⚠ ${unconf} entr${unconf === 1 ? "y has" : "ies have"} estimated (GPS) mileage not yet confirmed. Tap an entry to verify the real driven miles before payroll.</div></div>`;
  if (open.length) h += `<div class="secthd"><h2>On the clock now</h2><span class="ct">${open.length}</span></div><div class="card">` +
    open.map(e => `<div class="li"><div class="grow"><div class="nm" style="font-size:14px">${esc(e.userName || "Crew")} · ${esc(tcJobTitle(e.jobId))}</div><div class="sub">since ${new Date(e.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${tcRound(e.computedMiles)} mi est</div></div></div>`).join("") + `</div>`;

  // group by job
  const byJob = {}; all.forEach(e => { (byJob[e.jobId] = byJob[e.jobId] || []).push(e); });
  h += `<div class="secthd"><h2>By job</h2></div>`;
  Object.keys(byJob).forEach(jid => {
    const es = byJob[jid], jh = es.reduce((s, e) => s + tcHours(e), 0), jm = es.reduce((s, e) => s + tcMiles(e), 0);
    const j = tcJob(jid);
    h += `<div class="card"><div class="row" style="align-items:center"><div class="grow"><div class="nm">${esc(tcJobTitle(jid))}</div><div class="sub">${jh.toFixed(1)}h · ${tcRound(jm)} mi · ${money(jm * TC_RATE)}${j && j.customerId ? " · " + esc(custName(j.customerId)) : ""}</div></div></div>` +
      es.sort((a, b) => b.clockIn - a.clockIn).map(e => `<div class="li" style="cursor:pointer" onclick="tcOpenEntry('${e.id}')"><div class="grow"><div class="nm" style="font-size:14px">${esc(e.userName || "Crew")}</div>
        <div class="sub">${fmtDate(new Date(e.clockIn).toISOString().slice(0,10))} · ${tcFmtDur(e.clockOut - e.clockIn)} · ${tcMiles(e)} mi ${e.milesConfirmed ? `<span class="badge" style="background:var(--accent);color:var(--accent-ink)">confirmed</span>` : `<span class="badge" style="background:var(--soft);color:var(--muted)">est</span>`}${e.vehicle ? " · 🚚 " + esc(e.vehicle) : ""}</div></div><span class="sub">${money(tcMileageCost(e))}</span></div>`).join("") + `</div>`;
  });

  // group by user
  const byUser = {}; all.forEach(e => { (byUser[e.userId] = byUser[e.userId] || []).push(e); });
  h += `<div class="secthd"><h2>By person</h2></div><div class="card">`;
  Object.keys(byUser).forEach(uid2 => {
    const es = byUser[uid2], uh = es.reduce((s, e) => s + tcHours(e), 0), um = es.reduce((s, e) => s + tcMiles(e), 0);
    h += `<div class="li"><div class="grow"><div class="nm" style="font-size:15px">${esc(es[0].userName || "Crew")}</div><div class="sub">${es.length} shift${es.length === 1 ? "" : "s"} · ${uh.toFixed(1)}h · ${tcRound(um)} mi</div></div><span class="sub">${money(um * TC_RATE)}</span></div>`;
  });
  h += `</div>`;
  return h;
}

/* foreground/background transitions — start pings when visible with an open shift, stop when hidden */
document.addEventListener("visibilitychange", function () {
  try {
    if (document.hidden) { tcPingStop(); }
    else if (typeof S !== "undefined" && S && typeof tcMyOpen === "function" && tcMyOpen()) { tcPingStart(); }
  } catch (e) {}
});
