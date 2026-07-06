/* ---------- ROUTE REVIEW (js/91) — review the ACTUAL GPS route driven, by JOB and by VEHICLE ----------
   READ-ONLY. This module writes NOTHING: it only READS D().timeclock / D().jobs / homeBase() / the vehicle
   registry+inventory and reuses the timeclock helpers (js/38) + planned-route helpers (js/61,62,52) to draw a
   map of where a job's (or a vehicle's) drives actually went, overlay the ADMIN-PLANNED stops, and show an
   estimated-vs-actual mileage readout. No save/touch/mutation anywhere here.

   HONESTY: the phone can't track a locked/backgrounded PWA, so the recorded path is only clock-in + sparse
   FOREGROUND check-ins + stops + clock-out — a sparse, straight-line-between-samples APPROXIMATION. We draw the
   actual path DASHED (never solid) and keep a persistent caption saying so; the odometer stays the number of
   record. The planned route is drawn thin + SOLID for contrast.

   Map init/teardown MIRRORS js/19 (Leaflet, Esri World_Imagery tiles): guard when L is missing, a fresh
   container node each render, RVMAP.remove() before re-init, invalidateSize() after. Distinct ids/globals
   (rvmap / RVMAP / RV_LAYERS) so it never collides with the lot-estimator map. */

let ROUTES_JOB = null;          // selected job id (job mode)
let ROUTES_MODE = "job";        // "job" | "vehicle"
let ROUTES_VEH = null;          // selected vehicle key (vehicle mode)
let RVMAP = null, RV_LAYERS = null;   // Leaflet map + the single overlay layer group (all drawn features)
let RV_HIDDEN = {};             // driveId -> true when that drive's polyline/markers are toggled OFF

const RV_PLAN_COLOR = "#2F6FE0";                                  // planned route (solid, blue)
const RV_COLORS = ["#E67E22", "#8E44AD", "#16A085", "#C0392B", "#2C3E50", "#D35400", "#7D3C98", "#117A65", "#B03A2E", "#6C3483"];  // per-drive / per-job actual paths (avoid the planned blue)
function rvColor(i) { return RV_COLORS[((i % RV_COLORS.length) + RV_COLORS.length) % RV_COLORS.length]; }
function rvRound(n) { return Math.round((+n || 0) * 10) / 10; }

/* deep-link from the job page — jump straight to this job's route review; store the return tab so a Back
   button can send the user back where they came from (mirrors openJobPage's JOB_RETURN_TAB pattern). */
window.openRouteReview = function (jobId) {
  window.RV_RETURN_JOB = jobId || null;
  ROUTES_JOB = jobId || null; ROUTES_MODE = "job"; RV_HIDDEN = {};
  TAB = "routes";
  if (typeof render === "function") render();
};

/* ----- data gathering (all READS) ----- */
function rvTC() { return (typeof D === "function" && D().timeclock) ? D().timeclock : []; }
function rvJobById(id) { const d = (typeof D === "function") ? D() : null; return (d && Array.isArray(d.jobs)) ? d.jobs.find(x => x && x.id === id) : null; }
/* a "drive" = a driver shift OR any entry that captured a real path (>=2 points). Not deleted. */
function rvIsDrive(e) { return e && !e.deleted && (e.riderRole === "driver" || (typeof tcPath === "function" && tcPath(e).length >= 2)); }
function rvJobDrives(jobId) { return rvTC().filter(e => rvIsDrive(e) && e.jobId === jobId).sort((a, b) => (a.clockIn || 0) - (b.clockIn || 0)); }
/* a stable vehicle key for an entry: registry truck id, else inventory vehicle id, else owner id, else name. */
function rvVehKey(e) { return e.vehicleId || e.invVehicleId || e.vehicleOwnerId || (e.vehicle ? "name:" + e.vehicle : null); }
function rvVehDrives(key) { return rvTC().filter(e => rvIsDrive(e) && rvVehKey(e) === key).sort((a, b) => (b.clockIn || 0) - (a.clockIn || 0)); }
/* distinct jobs that have at least one drive (for the job picker) */
function rvJobsWithDrives() {
  const ids = []; const seen = {};
  rvTC().forEach(e => { if (rvIsDrive(e) && e.jobId && !seen[e.jobId]) { seen[e.jobId] = 1; ids.push(e.jobId); } });
  return ids.map(rvJobById).filter(Boolean).sort((a, b) => (b.date || "") < (a.date || "") ? -1 : 1);
}
/* distinct vehicles that have at least one drive (for the vehicle picker) */
function rvVehiclesWithDrives() {
  const out = [], seen = {};
  rvTC().forEach(e => { if (!rvIsDrive(e)) return; const k = rvVehKey(e); if (!k || seen[k]) return; seen[k] = 1; out.push({ key: k, label: e.vehicle || "Vehicle" }); });
  return out;
}
function rvDateLabel(ms) { try { return (typeof tcLocalDay === "function") ? tcLocalDay(ms) : new Date(ms).toISOString().slice(0, 10); } catch (e) { return ""; } }
function rvSafeEsc(s) { return (typeof esc === "function") ? esc(s == null ? "" : String(s)) : String(s == null ? "" : s); }

/* ===== the page ===== */
function rRoutes() {
  // PHASE 1 gate: owner/admin only (finCanView = the finance-adjacent owner/admin gate). Crew self-view is Phase 3.
  const canView = (typeof finCanView === "function") ? finCanView() : (typeof isOwner === "function" && isOwner());
  if (!canView) {
    view.innerHTML = `<div class="secthd"><h2>🗺️ Routes</h2></div>
      <div class="card"><div class="nm">Owner / admin only</div>
      <div class="sub" style="white-space:normal;margin-top:4px">Route review (the GPS path driven per job &amp; per vehicle) is visible to owners and admins for now.</div></div>`;
    return;
  }
  const modeBtn = (m, label) => `<button class="subbtn ${ROUTES_MODE === m ? "on" : ""}" onclick="rvSetMode('${m}')">${label}</button>`;
  let h = `<div class="secthd"><h2>🗺️ Routes · GPS review</h2></div>
    <div class="maptop">${modeBtn("job", "🧾 By job")}${modeBtn("vehicle", "🚚 By vehicle")}</div>`;
  h += (ROUTES_MODE === "vehicle") ? rvVehicleView() : rvJobView();
  view.innerHTML = h;
  setTimeout(rvInitMap, 40);
}

/* the persistent honesty caption (foreground-only limitation) */
function rvCaption() {
  return `<div class="sub" style="white-space:normal;margin-top:8px;color:var(--muted)">Approximate path — recorded from clock-in, foreground check-ins (~2 min), stops, and clock-out. Phones can't track while locked, so gaps are straight-line estimates, not the exact roads. The odometer is the number of record.</div>`;
}
function rvMapBlock() {
  return `<div id="rvmap" style="width:100%;height:55vh;min-height:300px;border-radius:12px;overflow:hidden;margin-top:10px"></div>${rvCaption()}`;
}

/* ---------- JOB MODE ---------- */
function rvJobView() {
  const jobs = rvJobsWithDrives();
  // keep the current selection valid; else default to the most recent job with drives
  if (ROUTES_JOB && !rvJobById(ROUTES_JOB)) ROUTES_JOB = null;
  if (!ROUTES_JOB && jobs.length) ROUTES_JOB = jobs[0].id;
  const cur = ROUTES_JOB ? rvJobById(ROUTES_JOB) : null;
  // job picker (include the current job even if it has no drives, e.g. arrived via deep-link)
  const picklist = jobs.slice();
  if (cur && !picklist.some(j => j.id === cur.id)) picklist.unshift(cur);
  const jobOpt = j => `<option value="${j.id}" ${ROUTES_JOB === j.id ? "selected" : ""}>${rvSafeEsc(j.title || "Job")}${j.date && typeof fmtDate === "function" ? " · " + fmtDate(j.date) : ""}${j.customerId && typeof custName === "function" ? " · " + rvSafeEsc(custName(j.customerId)) : ""}</option>`;
  let h = `<div class="maptop"><select style="flex:1;min-width:160px" onchange="rvPickJob(this.value)"><option value="">— pick a job —</option>${picklist.map(jobOpt).join("")}</select>`;
  if (window.RV_RETURN_JOB) h += `<button class="btn ghost sm" onclick="rvBackToJob()">← Back to job</button>`;
  h += `</div>`;
  if (!cur) {
    h += `<div class="card"><div class="nm">No route to show yet</div><div class="sub" style="white-space:normal;margin-top:4px">${jobs.length ? "Pick a job above." : "No drives have been clocked on any job yet — mileage shows up here once the crew clocks in with a vehicle."}</div></div>`;
    return h;
  }
  h += rvMapBlock();
  h += rvJobReadout(cur);
  h += rvJobDriveList(cur);
  return h;
}

/* est-vs-actual readout for a job (CSS bars + a compact table; NO charting lib). */
function rvJobReadout(job) {
  const drives = rvJobDrives(job.id);
  const est = (+job.estRouteMiles > 0) ? +job.estRouteMiles : 0;
  const days = (typeof jobWorkDays === "function") ? Math.max(1, jobWorkDays(job).length) : 1;
  const planTotal = rvRound(est * days);   // one round trip per work day
  let odoTotal = 0, gpsTotal = 0, flagged = 0;
  drives.forEach(e => {
    const odo = (typeof tcOdoMiles === "function") ? tcOdoMiles(e) : null;
    odoTotal += (odo != null) ? odo : (e.milesConfirmed ? (+e.miles || 0) : 0);
    gpsTotal += (typeof tcComputeMiles === "function") ? tcComputeMiles(e) : (+e.computedMiles || 0);
    const v = (typeof tcVerify === "function") ? tcVerify(e) : null; if (v && v.flag) flagged++;
  });
  odoTotal = rvRound(odoTotal); gpsTotal = rvRound(gpsTotal);
  const max = Math.max(planTotal, odoTotal, gpsTotal, 0.1);
  const dollarBilled = (typeof jobMileageCost === "function") ? jobMileageCost(job) : 0;
  const dollarEst = (typeof jobMilesCostEst === "function") ? jobMilesCostEst(job) : 0;
  const dol = n => (typeof money === "function") ? money(n) : ("$" + (Math.round((+n || 0) * 100) / 100).toFixed(2));

  let h = `<div class="card" style="margin-top:12px"><div class="nm">📊 Estimated vs actual</div>`;
  h += rvBar("🚗 Odometer (billed)", odoTotal, max, "var(--accent)", true);
  h += rvBar("🧭 Planned est." + (days > 1 ? " · " + days + " days" : ""), planTotal, max, "var(--muted)", false);
  h += rvBar("🛰 GPS path est.", gpsTotal, max, "var(--muted)", false);
  h += rvVarianceLine(odoTotal, gpsTotal, flagged);
  h += `<div class="sub" style="white-space:normal;margin-top:10px">💵 Mileage cost: <b>${dol(dollarBilled > 0 ? dollarBilled : dollarEst)}</b> <span class="muted">${dollarBilled > 0 ? "· from the confirmed odometer" : "· estimate (no confirmed odometer yet)"}</span></div>`;
  h += `<div class="sub muted" style="white-space:normal;margin-top:2px">Odometer is the billed number; the estimate and GPS path are informational only.</div>`;
  h += `</div>`;
  return h;
}
/* one CSS bar row */
function rvBar(label, val, max, color, bold) {
  const pct = (max > 0) ? Math.max(2, Math.round(val / max * 100)) : 0;
  return `<div style="margin:8px 0 4px">
    <div style="display:flex;justify-content:space-between;font-size:13px;${bold ? "font-weight:800" : "color:var(--muted)"}"><span>${label}</span><span>${rvRound(val)} mi</span></div>
    <div style="background:var(--soft);border-radius:6px;height:${bold ? 14 : 10}px;overflow:hidden;margin-top:3px"><div style="width:${pct}%;height:100%;background:${color};border-radius:6px"></div></div>
  </div>`;
}
/* variance % + tolerance flag (reuses the timeclock 25% asymmetric idea + its flag colors) */
function rvVarianceLine(odo, gps, flagged) {
  if (!(gps > 0.3) || !(odo > 0)) return `<div class="sub muted" style="margin-top:6px;white-space:normal">Not enough data to compare odometer vs GPS yet.</div>`;
  const tol = (typeof TC_TOL === "number") ? TC_TOL : 0.25;
  const pct = Math.round((odo - gps) / gps * 100);
  const hi = odo > gps * (1 + tol), lo = odo < gps * (1 - 0.02);
  let color = "var(--accent)", txt;
  if (hi) { color = "var(--danger)"; txt = `⚠ odometer ${pct}% above the GPS path — double-check the readings`; }
  else if (lo) { color = "var(--danger)"; txt = `⚠ odometer ${Math.abs(pct)}% below the GPS path (impossible) — check the odometer`; }
  else { txt = `within tolerance · odometer ${pct >= 0 ? "+" : ""}${pct}% vs GPS`; }
  const fl = flagged ? ` · ${flagged} flagged drive${flagged > 1 ? "s" : ""}` : "";
  return `<div class="sub" style="margin-top:6px;white-space:normal;color:${color};font-weight:600">${txt}${fl}</div>`;
}

/* the toggleable drive list under the map (one row per driver-entry) */
function rvJobDriveList(job) {
  const drives = rvJobDrives(job.id);
  if (!drives.length) return `<div class="card" style="margin-top:12px"><div class="sub" style="white-space:normal">📍 No drives clocked for this job yet — the map shows the planned stops + job site.</div></div>`;
  let h = `<div class="card" style="margin-top:12px"><div class="nm">🚗 Drives <span class="sub" style="font-weight:400">· tap a row to show/hide it</span></div>`;
  drives.forEach((e, i) => {
    const col = rvColor(i);
    const path = (typeof tcPath === "function") ? tcPath(e) : [];
    const noGps = path.filter(p => p && p.lat != null).length < 2;
    const miles = (typeof tcMiles === "function") ? tcMiles(e) : (+e.miles || 0);
    const badge = (typeof tcSourceBadge === "function") ? tcSourceBadge(e) : "";
    const off = RV_HIDDEN[e.id];
    h += `<div class="li" id="rvdrive_${e.id}" style="padding:8px 0;cursor:pointer;opacity:${off ? "0.4" : "1"}" onclick="rvToggleDrive('${e.id}')">
      <span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${col};margin-right:8px;flex:0 0 auto"></span>
      <div class="grow"><div class="nm" style="font-size:14px">📅 ${rvDateLabel(e.clockIn)} · 👤 ${rvSafeEsc(e.userName || "Crew")}</div>
      <div class="sub" style="white-space:normal">🚚 ${rvSafeEsc(e.vehicle || "Vehicle")} · ${noGps ? "📍 No GPS path recorded" : rvRound(miles) + " mi"} ${badge}</div></div></div>`;
  });
  h += `</div>`;
  return h;
}

/* ---------- VEHICLE MODE ---------- */
function rvVehicleView() {
  const vehicles = rvVehiclesWithDrives();
  if (ROUTES_VEH && !vehicles.some(v => v.key === ROUTES_VEH)) ROUTES_VEH = null;
  if (!ROUTES_VEH && vehicles.length) ROUTES_VEH = vehicles[0].key;
  const vehOpt = v => `<option value="${rvSafeEsc(v.key)}" ${ROUTES_VEH === v.key ? "selected" : ""}>${rvSafeEsc(v.label)}</option>`;
  let h = `<div class="maptop"><select style="flex:1;min-width:160px" onchange="rvPickVeh(this.value)"><option value="">— pick a vehicle —</option>${vehicles.map(vehOpt).join("")}</select></div>`;
  if (!ROUTES_VEH) {
    h += `<div class="card"><div class="nm">No vehicle drives yet</div><div class="sub" style="white-space:normal;margin-top:4px">${vehicles.length ? "Pick a vehicle above." : "No drives have been clocked with a vehicle yet."}</div></div>`;
    return h;
  }
  h += rvMapBlock();
  h += rvVehicleReadout(ROUTES_VEH);
  h += rvVehicleDriveList(ROUTES_VEH);
  return h;
}
function rvVehicleReadout(key) {
  const drives = rvVehDrives(key).slice(0, 60);
  let odoTotal = 0, gpsTotal = 0, milesDollar = 0, flagged = 0;
  const jobSeen = {}, estSeen = {};
  drives.forEach(e => {
    const odo = (typeof tcOdoMiles === "function") ? tcOdoMiles(e) : null;
    odoTotal += (odo != null) ? odo : (e.milesConfirmed ? (+e.miles || 0) : 0);
    gpsTotal += (typeof tcComputeMiles === "function") ? tcComputeMiles(e) : (+e.computedMiles || 0);
    if (e.milesConfirmed) milesDollar += (typeof tcMileageCost === "function") ? tcMileageCost(e) : (+e.miles || 0) * 0.725;
    const v = (typeof tcVerify === "function") ? tcVerify(e) : null; if (v && v.flag) flagged++;
    if (e.jobId) jobSeen[e.jobId] = 1;
  });
  // Σ est per DISTINCT job (planned round-trip × its work days)
  let estTotal = 0;
  Object.keys(jobSeen).forEach(jid => { if (estSeen[jid]) return; estSeen[jid] = 1; const j = rvJobById(jid); if (j && +j.estRouteMiles > 0) { const days = (typeof jobWorkDays === "function") ? Math.max(1, jobWorkDays(j).length) : 1; estTotal += +j.estRouteMiles * days; } });
  odoTotal = rvRound(odoTotal); gpsTotal = rvRound(gpsTotal); estTotal = rvRound(estTotal);
  const nJobs = Object.keys(jobSeen).length;
  const max = Math.max(odoTotal, gpsTotal, estTotal, 0.1);
  const dol = n => (typeof money === "function") ? money(n) : ("$" + (Math.round((+n || 0) * 100) / 100).toFixed(2));
  const label = (drives[0] && drives[0].vehicle) || "Vehicle";
  let h = `<div class="card" style="margin-top:12px"><div class="nm">📊 ${rvSafeEsc(label)} — totals</div>`;
  h += `<div class="sub" style="white-space:normal;margin-top:2px">${drives.length} drive${drives.length === 1 ? "" : "s"} · ${nJobs} job${nJobs === 1 ? "" : "s"}${flagged ? " · " + flagged + " flagged" : ""}</div>`;
  h += rvBar("🚗 Odometer (billed)", odoTotal, max, "var(--accent)", true);
  h += rvBar("🧭 Planned est.", estTotal, max, "var(--muted)", false);
  h += rvBar("🛰 GPS path est.", gpsTotal, max, "var(--muted)", false);
  h += rvVarianceLine(odoTotal, gpsTotal, flagged);
  h += `<div class="sub" style="white-space:normal;margin-top:10px">💵 Mileage cost (confirmed): <b>${dol(milesDollar)}</b></div>`;
  h += `<div class="sub muted" style="white-space:normal;margin-top:2px">Odometer is the billed number; the estimate and GPS path are informational only.</div>`;
  h += `</div>`;
  return h;
}
function rvVehicleDriveList(key) {
  const drives = rvVehDrives(key).slice(0, 60);
  if (!drives.length) return "";
  // color per distinct job so the legend maps color -> job
  const jobColor = {}; let ci = 0;
  drives.forEach(e => { const jid = e.jobId || "_none"; if (jobColor[jid] == null) jobColor[jid] = rvColor(ci++); });
  let h = `<div class="card" style="margin-top:12px"><div class="nm">🚗 Recent drives <span class="sub" style="font-weight:400">· tap a row to show/hide it</span></div>`;
  drives.forEach(e => {
    const col = jobColor[e.jobId || "_none"];
    const path = (typeof tcPath === "function") ? tcPath(e) : [];
    const noGps = path.filter(p => p && p.lat != null).length < 2;
    const miles = (typeof tcMiles === "function") ? tcMiles(e) : (+e.miles || 0);
    const badge = (typeof tcSourceBadge === "function") ? tcSourceBadge(e) : "";
    const title = (typeof tcJobTitle === "function") ? tcJobTitle(e.jobId) : (e.jobId || "Job");
    const off = RV_HIDDEN[e.id];
    h += `<div class="li" id="rvdrive_${e.id}" style="padding:8px 0;cursor:pointer;opacity:${off ? "0.4" : "1"}" onclick="rvToggleDrive('${e.id}')">
      <span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${col};margin-right:8px;flex:0 0 auto"></span>
      <div class="grow"><div class="nm" style="font-size:14px">📅 ${rvDateLabel(e.clockIn)} · 🧾 ${rvSafeEsc(title)}</div>
      <div class="sub" style="white-space:normal">👤 ${rvSafeEsc(e.userName || "Crew")} · ${noGps ? "📍 No GPS path" : rvRound(miles) + " mi"} ${badge}</div></div></div>`;
  });
  h += `</div>`;
  return h;
}

/* ===== the map ===== */
function rvInitMap() {
  const el = document.getElementById("rvmap"); if (!el) return;
  if (typeof L === "undefined") { el.innerHTML = '<div class="muted" style="padding:24px">Map library didn\'t load — you need an internet connection for the map.</div>'; return; }
  try { if (RVMAP) { RVMAP.remove(); RVMAP = null; } } catch (e) {}
  RVMAP = L.map("rvmap").setView([36.07, -75.70], 10);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20, attribution: "Imagery © Esri" }).addTo(RVMAP);
  RV_LAYERS = L.layerGroup().addTo(RVMAP);
  const bounds = [];
  try { rvDrawInto(bounds); } catch (e) { try { if (console && console.error) console.error("route draw failed", e); } catch (_) {} }
  if (bounds.length) { try { RVMAP.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 }); } catch (e) {} }
  setTimeout(function () { try { if (RVMAP) RVMAP.invalidateSize(); } catch (e) {} }, 60);
}
/* redraw the overlay in place (used by the drive toggles — keeps the current pan/zoom, no refit) */
function rvRedraw() { if (!RVMAP || !RV_LAYERS) return; try { rvDrawInto([]); } catch (e) {} }
function rvDrawInto(bounds) {
  if (!RV_LAYERS) return; RV_LAYERS.clearLayers();
  if (ROUTES_MODE === "vehicle") rvDrawVehicle(bounds); else rvDrawJob(bounds);
}
/* small helpers */
function rvValidLL(p) { return p && p.lat != null && p.lng != null && isFinite(p.lat) && isFinite(p.lng); }
function rvDot(latlng, color, title) { const m = L.circleMarker(latlng, { radius: 6, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 }); if (title) m.bindTooltip(title); return m; }
function rvBadgeMarker(latlng, color, text, title) {
  const m = L.marker(latlng, { icon: L.divIcon({ className: "", iconSize: [22, 22], html: '<div style="background:' + color + ';color:#fff;border:2px solid #fff;border-radius:50%;width:22px;height:22px;font-size:11px;font-weight:700;text-align:center;line-height:20px;box-shadow:0 1px 3px rgba(0,0,0,.4)">' + text + '</div>' }) });
  if (title) m.bindTooltip(title); return m;
}

function rvDrawJob(bounds) {
  const job = ROUTES_JOB ? rvJobById(ROUTES_JOB) : null; if (!job) return;
  // --- planned overlay (thin SOLID blue): start -> planned stops -> site -> end ---
  const hb = (typeof homeBase === "function") ? homeBase() : null;
  const planLine = [];
  const startPt = (typeof jobRouteEndpointPt === "function") ? jobRouteEndpointPt(job.routeStart, hb) : null;
  const endPt = (typeof jobRouteEndpointPt === "function") ? jobRouteEndpointPt(job.routeEnd, hb) : null;
  if (startPt) { planLine.push(startPt); rvBadgeMarker(startPt, RV_PLAN_COLOR, "S", "Planned start").addTo(RV_LAYERS); bounds.push(startPt); }
  const planned = (typeof jobPlannedStops === "function") ? jobPlannedStops(job) : [];
  planned.forEach((s, i) => { if (s.lat != null && s.lng != null) { const pt = [s.lat, s.lng]; planLine.push(pt); rvBadgeMarker(pt, RV_PLAN_COLOR, String(i + 1), "Planned: " + (s.label || s.address || "stop")).addTo(RV_LAYERS); bounds.push(pt); } });
  const site = (typeof jobLatLng === "function") ? jobLatLng(job) : null;   // job site (via linked property); may be unresolved → gracefully omit
  if (rvValidLL(site)) { const pt = [site.lat, site.lng]; planLine.push(pt); rvBadgeMarker(pt, "#1B2A4E", "🏁", "Job site").addTo(RV_LAYERS); bounds.push(pt); }
  if (endPt) { planLine.push(endPt); if (!startPt || endPt[0] !== startPt[0] || endPt[1] !== startPt[1]) rvBadgeMarker(endPt, RV_PLAN_COLOR, "E", "Planned end").addTo(RV_LAYERS); bounds.push(endPt); }
  if (planLine.length >= 2) L.polyline(planLine, { color: RV_PLAN_COLOR, weight: 2, opacity: 0.65 }).addTo(RV_LAYERS);
  // --- actual drives (DASHED, per-drive color) ---
  rvJobDrives(job.id).forEach((e, i) => { if (RV_HIDDEN[e.id]) return; rvDrawDrive(e, rvColor(i), bounds); });
}
function rvDrawVehicle(bounds) {
  const drives = rvVehDrives(ROUTES_VEH).slice(0, 60);
  const jobColor = {}; let ci = 0;
  drives.forEach(e => { const jid = e.jobId || "_none"; if (jobColor[jid] == null) jobColor[jid] = rvColor(ci++); });
  drives.forEach(e => { if (RV_HIDDEN[e.id]) return; rvDrawDrive(e, jobColor[e.jobId || "_none"], bounds); });
}
/* draw ONE drive: dashed actual polyline + green start + red end + orange numbered stops */
function rvDrawDrive(e, color, bounds) {
  const path = (typeof tcPath === "function") ? tcPath(e) : [];
  const pts = path.filter(rvValidLL).map(p => [p.lat, p.lng]);
  if (pts.length >= 2) { L.polyline(pts, { color: color, weight: 4, opacity: 0.85, dashArray: "8,9" }).addTo(RV_LAYERS); pts.forEach(p => bounds.push(p)); }
  if (rvValidLL(e.inLoc)) { const pt = [e.inLoc.lat, e.inLoc.lng]; rvDot(pt, "#2E7D32", "Clock-in").addTo(RV_LAYERS); bounds.push(pt); }
  if (rvValidLL(e.outLoc)) { const pt = [e.outLoc.lat, e.outLoc.lng]; rvDot(pt, "#C62828", "Clock-out").addTo(RV_LAYERS); bounds.push(pt); }
  const stops = (typeof tcStops === "function") ? tcStops(e) : [];
  stops.forEach((s, i) => { if (s.loc && rvValidLL(s.loc)) { const pt = [s.loc.lat, s.loc.lng]; rvBadgeMarker(pt, "#EF6C00", String(i + 1), (s.name || "Stop")).addTo(RV_LAYERS); bounds.push(pt); } });
}

/* ===== handlers (all READ-ONLY: they only change local view state + redraw) ===== */
window.rvSetMode = function (m) { ROUTES_MODE = (m === "vehicle") ? "vehicle" : "job"; RV_HIDDEN = {}; if (typeof render === "function") render(); };
window.rvPickJob = function (v) { ROUTES_JOB = v || null; RV_HIDDEN = {}; if (typeof render === "function") render(); };
window.rvPickVeh = function (v) { ROUTES_VEH = v || null; RV_HIDDEN = {}; if (typeof render === "function") render(); };
window.rvToggleDrive = function (id) {
  RV_HIDDEN[id] = !RV_HIDDEN[id];
  const row = document.getElementById("rvdrive_" + id); if (row) row.style.opacity = RV_HIDDEN[id] ? "0.4" : "1";
  rvRedraw();
};
window.rvBackToJob = function () { const jid = window.RV_RETURN_JOB; window.RV_RETURN_JOB = null; if (jid && typeof openJobPage === "function") openJobPage(jid); else if (typeof render === "function") render(); };
