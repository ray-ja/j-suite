/* ---------- JOB VEHICLES & PER-VEHICLE ROUTES (owner/admin) ----------
   Assign vehicles to a job like you assign crew (job.vehicleIds), and give EACH assigned vehicle its OWN planned
   route (job.vehicleRoutes[vehId]) — because not everyone drives all the way (usually only one hauler continues to
   the transfer station; the rest just home → job site → home). Each vehicle shows its estimated round-trip miles +
   who it REIMBURSES: a personal vehicle pays its OWNER, a company truck pays whoever clocks in driving it.

   PLANNING LAYER ONLY — this never touches pay. What actually reimburses is the clock-in odometer per punch
   (js/39 finMileage reads timeclock entries, keyed to vehicleOwnerId). So job.vehicleIds / job.vehicleRoutes are
   ADDITIVE fields that ride inside the job record (LWW on job.updatedAt) and are read by NOTHING in the finance
   fingerprint. The per-vehicle mileage estimate REUSES the exact same road-route machinery as the single job
   route (jobRouteTaggedSeq / jobRouteMilesCompute in js/61) via a lightweight "shim" job, so it can't drift. */

const JOB_VEH_RATE = (typeof TC_RATE !== "undefined") ? TC_RATE : ((typeof FIN !== "undefined" && FIN && FIN.MILEAGE_RATE) || 0.725);

/* every assignable vehicle: personal/shared inventory vehicles (owner-tagged) + active company trucks (no owner →
   the driver is reimbursed). {id, name, ownerId|null, kind:"personal"|"truck", plate}. Current org only. */
function jobVehList() {
  const out = [];
  ((typeof tcInvVehicles === "function") ? tcInvVehicles() : []).forEach(v => { if (v && v.id) out.push({ id: v.id, name: v.name || "Vehicle", ownerId: v.ownerId || null, kind: "personal", plate: v.plate || "" }); });
  ((typeof orgVehicles === "function") ? orgVehicles() : []).forEach(v => { if (v && v.id && !v.deleted && v.active !== false && v.kind !== "trailer") out.push({ id: v.id, name: v.name || "Truck", ownerId: null, kind: "truck", plate: v.plate || "" }); });
  return out;
}
function jobVehById(id) { return jobVehList().find(v => v.id === id) || null; }
function jobVehOwnerName(v) { return (v && v.ownerId && typeof userName === "function") ? (userName(v.ownerId) || "") : ""; }

/* the per-vehicle route object stored on job.vehicleRoutes[vehId]. Shape MIRRORS the single job route so the same
   machinery computes it. Default (site-only) = home → job site → home (sitePos 0 → site first, extra stops after). */
function jobVehRouteDefault() { return { stops: [], sitePos: 0, routeStart: null, routeEnd: null, estMiles: null, milesSource: "pending" }; }
function jobVehRouteRead(j, vehId) { return (j && j.vehicleRoutes && j.vehicleRoutes[vehId]) ? j.vehicleRoutes[vehId] : jobVehRouteDefault(); }
function jobVehRouteEnsure(j, vehId) {
  if (!j.vehicleRoutes || typeof j.vehicleRoutes !== "object") j.vehicleRoutes = {};
  if (!j.vehicleRoutes[vehId]) j.vehicleRoutes[vehId] = jobVehRouteDefault();
  const vr = j.vehicleRoutes[vehId]; if (!Array.isArray(vr.stops)) vr.stops = [];
  return vr;
}
/* a SHIM job the js/61 route functions can consume: the vehicle's stops as plannedStops + the SAME job site
   (carry address/propertyId/customerId so jobAddr/jobLatLng resolve the identical site). */
function jobVehShim(j, vr) {
  return { plannedStops: Array.isArray(vr.stops) ? vr.stops : [], sitePos: (typeof vr.sitePos === "number") ? vr.sitePos : 0, routeStart: vr.routeStart || null, routeEnd: vr.routeEnd || null, address: j.address, propertyId: j.propertyId, customerId: j.customerId, lat: j.lat, lng: j.lng };
}
/* estimate the vehicle's round-trip miles — REUSES js/61 jobRouteTaggedSeq / jobRouteMilesCompute exactly (road
   miles via the OSRM cache; fetch-on-miss re-runs + persists on land, change-guarded). Writes vr.estMiles/milesSource. */
function jobVehRecalc(j, vehId) {
  if (!j || typeof jobRouteTaggedSeq !== "function" || typeof jobRouteMilesCompute !== "function") return;
  const vr = jobVehRouteEnsure(j, vehId);
  // V3 MANUAL OVERRIDE (mirrors jobRecalcRouteMiles): the owner's round-trip miles are authoritative — skip the map.
  if (+vr.manualMiles > 0) { vr.estMiles = Math.round(+vr.manualMiles * 10) / 10; vr.milesSource = "manual"; return; }
  const extra = (typeof jobRouteExtraManual === "function") ? jobRouteExtraManual(jobVehShim(j, vr)) : 0;
  const seq = jobRouteTaggedSeq(jobVehShim(j, vr));
  if (!seq) { if (!(vr.estMiles > 0)) vr.estMiles = extra > 0 ? Math.round(extra * 10) / 10 : null; vr.milesSource = vr.estMiles > 0 ? "manual" : "pending"; return; }
  const c = jobRouteMilesCompute(seq);
  if (c.resolved) { vr.estMiles = Math.round((c.manualSum + c.roadTotal + extra) * 10) / 10; vr.milesSource = "roads"; return; }
  vr.milesSource = c.anyNone ? "none" : "pending";
  c.needsFetch.forEach(function (wp) {
    if (typeof roadRouteMiles === "function") roadRouteMiles(wp, function () {
      const before = vr.estMiles; jobVehRecalc(j, vehId);
      if (vr.estMiles !== before) { if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render(); }
    });
  });
  if (c.anyNone && !(vr.estMiles > 0)) vr.estMiles = extra > 0 ? Math.round(extra * 10) / 10 : null;
}
/* how many DAYS this vehicle is on the job (Ray's counter — one vehicle may work more days than another). Default =
   the job's work-day count (jobPageWorkDays), else 1. Owner can override per vehicle (vr.days). */
function jobVehDays(j, vr) {
  if (vr && +vr.days > 0) return Math.round(+vr.days);
  const wd = (typeof jobPageWorkDays === "function") ? jobPageWorkDays(j) : null;
  return (wd && wd.length) ? wd.length : 1;
}
/* TOTAL estimated miles for a vehicle = its daily round-trip loop × the days it's on the job. */
function jobVehTotalMiles(j, vr) { return (vr && vr.estMiles > 0) ? Math.round(vr.estMiles * jobVehDays(j, vr) * 10) / 10 : 0; }
function jobVehReimb(j, vr) { const t = jobVehTotalMiles(j, vr); return t > 0 ? Math.round(t * JOB_VEH_RATE * 100) / 100 : 0; }
/* confirmed odometer miles already logged on THIS vehicle for the job (the billed number that offsets the estimate). */
function jobVehConfMiles(j, vehId) {
  return ((typeof actTC === "function") ? actTC() : []).filter(e => e && !e.deleted && e.jobId === j.id && (e.invVehicleId === vehId || e.vehicleId === vehId) && e.clockOut && e.milesConfirmed).reduce((s, e) => s + (+e.miles || 0), 0);
}

/* ---------- handlers (owner/admin) ---------- */
window.jobToggleVehicle = function (jobId, vehId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  if (!Array.isArray(j.vehicleIds)) j.vehicleIds = [];
  const i = j.vehicleIds.indexOf(vehId);
  if (i >= 0) { j.vehicleIds.splice(i, 1); if (j.vehicleRoutes) delete j.vehicleRoutes[vehId]; }
  else { j.vehicleIds.push(vehId); jobVehRouteEnsure(j, vehId); jobVehRecalc(j, vehId); }
  if (typeof logChange === "function") { const v = jobVehById(vehId); logChange("update", "job", j.id, (i >= 0 ? "Removed vehicle " : "Added vehicle ") + ((v && v.name) || vehId)); }
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
window.jobVehStopAdd = function (jobId, vehId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const label = (val("jvs_label_" + vehId) || "").trim(), address = (val("jvs_addr_" + vehId) || "").trim();
  if (!address) { alert("Enter the stop's address."); return; }
  const vr = jobVehRouteEnsure(j, vehId);
  const s = { id: (typeof uid === "function" ? uid() : String(Math.random())), label: label || address, address: address, lat: null, lng: null };
  const _si = (typeof document !== "undefined") ? document.getElementById("jvs_addr_" + vehId) : null;
  let _picked = false;
  if (_si && _si.dataset) { const ds = _si.dataset; if (ds.pickLat) { s.lat = +ds.pickLat; s.lng = +ds.pickLng; _picked = true; } if (ds.pickPlaceId) s.placeId = ds.pickPlaceId; if (!_picked && ds.pickManualMiles) s.manualMiles = +ds.pickManualMiles; }
  vr.stops.push(s);
  if (_picked) jobVehRecalc(j, vehId);
  else if (typeof jobStopGeocode === "function") jobStopGeocode(s, function () { jobVehRecalc(j, vehId); if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render(); });
  else jobVehRecalc(j, vehId);
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
window.jobVehStopDel = function (jobId, vehId, idx) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const vr = jobVehRouteEnsure(j, vehId);
  if (idx >= 0 && idx < vr.stops.length) vr.stops.splice(idx, 1);
  jobVehRecalc(j, vehId);
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
/* V2 — reorder a vehicle's route (mirror jobPageRouteMove): swap adjacent items in the combined [stops + site]
   sequence, then rebuild vr.stops + vr.sitePos (site at the very end → sitePos null = sticky-last). */
window.jobVehRouteMove = function (jobId, vehId, comboIndex, dir) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const vr = jobVehRouteEnsure(j, vehId);
  const tokens = (typeof jobRouteOrdered === "function") ? jobRouteOrdered(jobVehShim(j, vr)) : [];
  const k = comboIndex + dir;
  if (comboIndex < 0 || comboIndex >= tokens.length || k < 0 || k >= tokens.length) return;
  const t = tokens[comboIndex]; tokens[comboIndex] = tokens[k]; tokens[k] = t;
  const newStops = tokens.filter(x => x.kind === "stop").map(x => x.stop);
  const siteAt = tokens.findIndex(x => x.kind === "site");
  vr.stops = newStops; vr.sitePos = (siteAt === newStops.length) ? null : siteAt;
  jobVehRecalc(j, vehId);
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
/* V2 — editable custom START/END per vehicle (mirror jobPageSetEndpoint): vr.routeStart / vr.routeEnd = {address,
   lat,lng}|null. null/same-as-base = home base (default). A picked suggestion reuses coords; else best-effort geocode. */
function jobVehSetEndpoint(jobId, vehId, key, v) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const vr = jobVehRouteEnsure(j, vehId);
  const addr = (v || "").trim();
  const hb = (typeof homeBase === "function") ? homeBase() : null; const baseAddr = (hb && hb.address) ? hb.address.trim() : "";
  if (!addr || (baseAddr && addr.toLowerCase() === baseAddr.toLowerCase())) { vr[key] = null; }
  else {
    const ep = { address: addr, lat: null, lng: null };
    const _ei = (typeof document !== "undefined") ? document.getElementById((key === "routeStart" ? "jvrs_start_" : "jvrs_end_") + vehId) : null;
    if (_ei && _ei.dataset && _ei.dataset.pickLat) {
      ep.lat = +_ei.dataset.pickLat; ep.lng = +_ei.dataset.pickLng; if (_ei.dataset.pickPlaceId) ep.placeId = _ei.dataset.pickPlaceId;
      delete _ei.dataset.pickLat; delete _ei.dataset.pickLng; delete _ei.dataset.pickPlaceId; delete _ei.dataset.pickManualMiles; vr[key] = ep;
    } else { vr[key] = ep; if (typeof jobStopGeocode === "function") jobStopGeocode(vr[key], function () { jobVehRecalc(j, vehId); if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render(); }); }
  }
  jobVehRecalc(j, vehId);
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
}
window.jobVehSetStart = function (jobId, vehId, v) { jobVehSetEndpoint(jobId, vehId, "routeStart", v); };
window.jobVehSetEnd = function (jobId, vehId, v) { jobVehSetEndpoint(jobId, vehId, "routeEnd", v); };
window.jobVehResetStart = function (jobId, vehId) { jobVehSetEndpoint(jobId, vehId, "routeStart", ""); };
window.jobVehResetEnd = function (jobId, vehId) { jobVehSetEndpoint(jobId, vehId, "routeEnd", ""); };
/* V2 — the mileage estimate for a clock-out ENTRY's driver: prefer THAT driver's assigned-vehicle route estimate
   (job.vehicleRoutes[vehId].estMiles) over the whole-job estimate. Used by the clock-out odometer cross-check
   (js/38). Read-only, never throws. Falls back to j.estRouteMiles when the driver has no per-vehicle route. */
function jobEntryVehMiles(job, entry) {
  try {
    if (!job || !entry) return (job && job.estRouteMiles > 0) ? job.estRouteMiles : null;
    const vid = entry.invVehicleId || entry.vehicleId;
    const vr = (vid && job.vehicleRoutes) ? job.vehicleRoutes[vid] : null;
    if (vr && vr.estMiles > 0) return vr.estMiles;
    return (job.estRouteMiles > 0) ? job.estRouteMiles : null;
  } catch (e) { return (job && job.estRouteMiles > 0) ? job.estRouteMiles : null; }
}
window.jobEntryVehMiles = jobEntryVehMiles;
/* V2 — auto-assign a crew member's PERSONAL vehicle when they're added to a job (called from jobPageToggleCrew).
   Only for a personal inventory vehicle they own that isn't already on the job; never removes/overrides. */
function jobAutoAssignVehicle(j, userId) {
  try {
    if (!j || !userId) return false;
    const mine = jobVehList().find(v => v.kind === "personal" && v.ownerId === userId);
    if (!mine) return false;
    if (!Array.isArray(j.vehicleIds)) j.vehicleIds = [];
    if (j.vehicleIds.indexOf(mine.id) >= 0) return false;
    j.vehicleIds.push(mine.id); jobVehRouteEnsure(j, mine.id); jobVehRecalc(j, mine.id);
    return true;
  } catch (e) { return false; }
}
window.jobAutoAssignVehicle = jobAutoAssignVehicle;
/* V3 — per-vehicle MANUAL round-trip miles override (mirrors jobSetManualRouteMiles): vr.manualMiles > 0 wins over
   the map. Empty/0 clears back to the map estimate. */
window.jobVehSetManualMiles = function (jobId, vehId, v) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const vr = jobVehRouteEnsure(j, vehId);
  const n = parseFloat(v);
  if (isFinite(n) && n > 0) vr.manualMiles = Math.round(n * 10) / 10; else delete vr.manualMiles;
  jobVehRecalc(j, vehId);
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
/* V4 — DAYS this vehicle works the job (Ray's counter). vr.days > 0 overrides the work-day default. */
window.jobVehSetDays = function (jobId, vehId, v) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const vr = jobVehRouteEnsure(j, vehId);
  const n = parseInt(v, 10);
  if (isFinite(n) && n > 0) vr.days = n; else delete vr.days;
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
/* V4 — PAY THE ESTIMATE (owner-confirmed): turn this vehicle's route estimate into an actual mileage reimbursement
   when the odometer's missing. Reuses the proven "Log a drive" flow (js/38) — creates a confirmed mileage entry
   paid to the vehicle owner — prefilled with the UNLOGGED portion (total estimate − odometer already on record). */
window.jobVehPayEstimate = function (jobId, vehId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const vr = jobVehRouteRead(j, vehId); const tot = jobVehTotalMiles(j, vr);
  if (!(tot > 0)) { alert("No route estimate for this vehicle yet — set its route/miles first."); return; }
  const gap = Math.round(Math.max(0, tot - jobVehConfMiles(j, vehId)) * 10) / 10;
  const v = jobVehById(vehId);
  const vehVal = v ? (v.kind === "personal" ? "inv:" + vehId : "truck:" + vehId) : "";
  const driverId = (v && v.ownerId) || ((Array.isArray(j.crew) && j.crew[0]) || "");
  if (typeof tcLogDriveForm === "function") tcLogDriveForm(jobId, { miles: gap > 0 ? gap : tot, vehVal: vehVal, driverId: driverId });
  else alert("Mileage logging isn't available here.");
};
/* V3 — the route estimate for a vehicle PICKED on the clock-in form (before an entry exists). encVal is the
   tc_vehicle select value ("inv:<id>" | "truck:<id>" | "owner:<uid>"); map to a job.vehicleRoutes key. null when
   the picked vehicle has no per-vehicle route on this job (caller falls back to the whole-job estimate). */
function jobVehEstForPick(job, encVal) {
  try {
    if (!job || !encVal || !job.vehicleRoutes) return null;
    let vid = null;
    if (encVal.indexOf("inv:") === 0) vid = encVal.slice(4);
    else if (encVal.indexOf("truck:") === 0) vid = encVal.slice(6);
    const vr = vid ? job.vehicleRoutes[vid] : null;
    return (vr && vr.estMiles > 0) ? vr.estMiles : null;
  } catch (e) { return null; }
}
window.jobVehEstForPick = jobVehEstForPick;
/* V3 — job-total mileage roll-up across all assigned vehicles: {miles, reimb, perOwner:{ownerId|"_driver":cents...}}.
   Read-only; reimb per vehicle at JOB_VEH_RATE, grouped by the vehicle owner (company trucks → the "_driver" bucket). */
function jobVehTotals(j) {
  const out = { miles: 0, reimb: 0, perOwner: {} };
  (Array.isArray(j.vehicleIds) ? j.vehicleIds : []).forEach(vehId => {
    const vr = jobVehRouteRead(j, vehId); const tot = jobVehTotalMiles(j, vr); if (!(tot > 0)) return;
    const v = jobVehById(vehId); const owner = (v && v.ownerId) ? v.ownerId : "_driver";
    const r = Math.round(tot * JOB_VEH_RATE * 100) / 100;
    out.miles += tot; out.reimb += r; out.perOwner[owner] = (out.perOwner[owner] || 0) + r;
  });
  out.miles = Math.round(out.miles * 10) / 10; out.reimb = Math.round(out.reimb * 100) / 100;
  return out;
}
window.jobVehTotals = jobVehTotals;

/* ---------- the job-page card ---------- */
function jobPageVehiclesCard(j) {
  const assigned = Array.isArray(j.vehicleIds) ? j.vehicleIds : [];
  const canEdit = (typeof jobCanEditPlan === "function") && jobCanEditPlan();
  const m = (typeof money === "function") ? money : (n => "$" + (+n || 0).toFixed(0));
  let h = `<div class="card"><div style="font-weight:800;margin-bottom:6px">🚚 Vehicles & routes${assigned.length ? ` · <span class="sub" style="font-weight:400">${assigned.length}</span>` : ""}</div>`;
  // V3 — job-total mileage + reimbursement roll-up across all assigned vehicles (per owner)
  if (assigned.length) {
    const T = jobVehTotals(j);
    if (T.miles > 0) {
      const per = Object.keys(T.perOwner).map(oid => { const nm = oid === "_driver" ? "the driver" : ((typeof userName === "function" ? userName(oid) : "") || "?"); return esc(nm) + " " + m(T.perOwner[oid]); }).join(" · ");
      h += `<div class="card" style="background:var(--soft);padding:6px 10px;margin-bottom:8px"><div class="row" style="justify-content:space-between"><span class="sub">Planned mileage (all vehicles)</span><b>~${T.miles} mi · ${m(T.reimb)}</b></div>${per ? `<div class="sub" style="white-space:normal;margin-top:2px">${per}</div>` : ""}<div class="sub muted" style="white-space:normal;margin-top:2px">Estimate to reimburse — the odometer at clock-out is the billed number.</div></div>`;
    }
  }
  // assigned vehicles — each with its own route + owner + estimate
  if (!assigned.length) h += `<div class="muted" style="margin-bottom:6px">No vehicles on this job yet.${canEdit ? " Assign the ones driving to it below." : ""}</div>`;
  assigned.forEach(vehId => {
    const v = jobVehById(vehId); const nm = v ? v.name : vehId;
    const vr = jobVehRouteRead(j, vehId);
    const owner = v && v.ownerId ? jobVehOwnerName(v) : "";
    const days = jobVehDays(j, vr), totMi = jobVehTotalMiles(j, vr), reimb = jobVehReimb(j, vr);
    const est = (vr.estMiles > 0)
      ? (days > 1 ? `${days} days × ~<b>${vr.estMiles} mi</b> = <b>${totMi} mi</b>` : `~<b>${vr.estMiles} mi</b> round trip`)
      : (vr.milesSource === "none" ? `<span class="muted">map couldn't route it</span>` : `<span class="muted">estimating…</span>`);
    const who = owner ? `reimburses <b>${esc(owner)}</b>${reimb ? ` ~${m(reimb)}` : ""}` : `<span class="muted">company truck — reimburses whoever drives it${reimb ? ` (~${m(reimb)})` : ""}</span>`;
    h += `<div class="card" style="background:var(--soft);padding:8px 10px;margin-bottom:8px"><div class="row" style="align-items:baseline"><div class="grow nm" style="font-size:15px">🚚 ${esc(nm)}${v && v.plate ? ` <span class="sub" style="font-weight:400">${esc(v.plate)}</span>` : ""}</div>${canEdit ? `<button class="btn ghost sm" onclick="jobToggleVehicle('${j.id}','${esc(vehId)}')" title="Remove from job">✕</button>` : ""}</div>`;
    h += `<div class="sub" style="white-space:normal;margin-top:2px">${est} · ${who}</div>`;
    // ODOMETER OF RECORD (the billed number) — confirmed clock-out miles logged on THIS vehicle for this job.
    const _conf = jobVehConfMiles(j, vehId);
    if (_conf > 0) h += `<div class="sub" style="white-space:normal;margin-top:1px">🚗 Odometer of record: <b>${Math.round(_conf * 10) / 10} mi</b>${totMi > 0 ? ` <span class="muted">(${Math.round(_conf / totMi * 100)}% of the ${totMi} mi estimate — odometer wins)</span>` : ""}</div>`;
    // DAYS counter (owner) + PAY-THE-ESTIMATE (owner-confirmed) — turn the unlogged estimate into an actual reimbursement.
    if (canEdit) {
      const gap = Math.round(Math.max(0, totMi - _conf) * 10) / 10;
      h += `<div class="row" style="gap:6px;align-items:center;margin-top:4px"><span class="sub">🗓 Days on job</span><input type="number" inputmode="numeric" min="1" value="${days}" style="width:56px" onchange="jobVehSetDays('${j.id}','${esc(vehId)}',this.value)">${vr.days ? "" : ` <span class="sub muted">· default from work-days</span>`}</div>`;
      if (gap > 0.05) h += `<button class="btn ghost sm" style="width:100%;margin-top:4px;border-color:#e0a800;color:#e0a800" onclick="jobVehPayEstimate('${j.id}','${esc(vehId)}')" title="Reimburse the estimated miles the odometer hasn't covered">🚗 Pay estimated mileage · ${gap} mi not logged (~${m(Math.round(gap * JOB_VEH_RATE * 100) / 100)}) ›</button>`;
    }
    // the vehicle's ORDERED route: Start → [stops/site, reorderable ▲▼] → End. Start/End default to home base but
    // are editable (a crew member who drives from home). Reuses jobRouteOrdered on the shim so ordering matches.
    const siteAddr = (typeof jobAddr === "function") ? jobAddr(j) : (j.address || "");
    const hb = (typeof homeBase === "function") ? homeBase() : null; const baseAddr = (hb && hb.address) ? hb.address : "";
    const startCustom = !!(vr.routeStart && vr.routeStart.address), endCustom = !!(vr.routeEnd && vr.routeEnd.address);
    const startVal = startCustom ? vr.routeStart.address : baseAddr, endVal = endCustom ? vr.routeEnd.address : baseAddr;
    const combo = (typeof jobRouteOrdered === "function") ? jobRouteOrdered(jobVehShim(j, vr)) : [];
    const ep = (side, id, value, custom, resetFn) => `<div class="sub" style="margin-top:4px"><span class="muted">${side}</span>${custom ? ` <a onclick="${resetFn}('${j.id}','${esc(vehId)}')" style="cursor:pointer;color:var(--brand-text)">↺ base</a>` : ` <span class="sub">· home base</span>`}</div><div class="acwrap"><input id="${id}_${esc(vehId)}" value="${esc(value)}" placeholder="${baseAddr ? "Address (home base by default)" : "Set the home base in Settings"}" autocomplete="off" onfocus="addrSuggest('${id}_${esc(vehId)}','${id}_${esc(vehId)}_ac')" oninput="addrSuggest('${id}_${esc(vehId)}','${id}_${esc(vehId)}_ac')" onchange="${side === "Start" ? "jobVehSetStart" : "jobVehSetEnd"}('${j.id}','${esc(vehId)}',this.value)" style="width:100%"><div class="acbox" id="${id}_${esc(vehId)}_ac"></div></div>`;
    // name + ADDRESS for each ordered item (Ray: the site row must SHOW the address so he can verify it's the right site)
    const rowNameAddr = (t) => {
      if (t.kind === "site") return { nm: "🏁 Job site", ad: siteAddr ? esc(siteAddr) : `<span class="muted">no location set — ✏️ Edit location above</span>` };
      const s = t.stop; return { nm: esc(s.label || s.address || "Stop"), ad: (s.label && s.address) ? esc(s.address) : (s.address ? esc(s.address) : "") };
    };
    if (canEdit) {
      h += ep("Start", "jvrs_start", startVal, startCustom, "jobVehResetStart");
      h += combo.map((t, ci) => {
        const up = ci === 0 ? "disabled" : "", dn = ci === combo.length - 1 ? "disabled" : "";
        const na = rowNameAddr(t);
        const del = t.kind === "stop" ? `<button class="btn ghost sm" onclick="jobVehStopDel('${j.id}','${esc(vehId)}',${t.raw})" title="Remove">✕</button>` : "";
        return `<div class="row" style="align-items:flex-start;gap:3px;padding:4px 0"><div class="grow" style="min-width:0"><div class="nm" style="font-size:14px;white-space:normal">${ci + 1}. ${na.nm}</div>${na.ad ? `<div class="sub" style="white-space:normal">${na.ad}</div>` : ""}</div><button class="btn ghost sm" ${up} onclick="jobVehRouteMove('${j.id}','${esc(vehId)}',${ci},-1)" title="Up">▲</button><button class="btn ghost sm" ${dn} onclick="jobVehRouteMove('${j.id}','${esc(vehId)}',${ci},1)" title="Down">▼</button>${del}</div>`;
      }).join("");
      h += ep("End", "jvrs_end", endVal, endCustom, "jobVehResetEnd");
    } else {
      // crew read-only: 🏁 Start · then each stop/site with its address · 🏁 End
      let ro = `<div class="sub" style="white-space:normal;margin-top:4px">🏁 ${startCustom ? esc(startVal) : "Home base"}</div>`;
      combo.forEach(t => { const na = rowNameAddr(t); ro += `<div class="sub" style="white-space:normal">↳ ${na.nm}${na.ad ? ` — ${na.ad}` : ""}</div>`; });
      ro += `<div class="sub" style="white-space:normal">🏁 ${endCustom ? esc(endVal) : "Home base"}</div>`;
      h += ro;
    }
    // a Google Maps link for the whole loop (read the round-trip miles) — Start → site/stops (in order) → End
    if (typeof gmapsRouteUrl === "function") {
      const loop = [startVal].concat(combo.map(t => t.kind === "site" ? siteAddr : (t.stop && t.stop.address))).concat([endVal]);
      const url = gmapsRouteUrl(loop);
      if (url) h += `<a class="btn ghost sm" style="margin-top:6px;display:flex;align-items:center;justify-content:center;gap:6px" href="${url}" target="_blank" rel="noopener">🗺 Open this vehicle's route in Google Maps</a>`;
    }
    // V3 — per-vehicle MANUAL round-trip miles override (map wrong / couldn't route). Collapsed when a map estimate
    // exists (so it's clearly optional); open when there's no estimate to fall back on.
    if (canEdit) {
      const _hasEst = vr.estMiles > 0, _manOn = +vr.manualMiles > 0;
      const box = `<label style="margin-top:6px">🚗 ${_hasEst && !_manOn ? "Override the mileage" : "Round-trip miles"} <span class="sub" style="font-weight:400">· this vehicle</span></label><div class="row" style="gap:8px"><input id="jvm_${esc(vehId)}" type="number" inputmode="decimal" value="${_manOn ? vr.manualMiles : ""}" placeholder="${_hasEst ? vr.estMiles + " mi — map estimate" : "round-trip miles"}" style="flex:1" onchange="jobVehSetManualMiles('${j.id}','${esc(vehId)}',this.value)"><button class="btn ghost sm" onclick="jobVehSetManualMiles('${j.id}','${esc(vehId)}',document.getElementById('jvm_${esc(vehId)}').value)">Save</button></div><div class="sub muted" style="margin-top:2px;white-space:normal">${_manOn ? `✓ Using <b>${vr.manualMiles} mi</b> — clear + Save to go back to the map estimate.` : (_hasEst ? "Map estimate is used automatically — only type here if it routed wrong." : "The map couldn't route this — enter the round-trip miles.")}</div>`;
      if (_hasEst && !_manOn) h += `<details style="margin-top:4px"><summary style="cursor:pointer;color:var(--muted);font-size:12px">🚗 Map estimate wrong? Override ›</summary><div style="margin-top:4px">${box}</div></details>`;
      else h += `<div style="margin-top:6px">${box}</div>`;
    }
    // add a stop to THIS vehicle (e.g. the transfer station on the hauler)
    if (canEdit) {
      h += `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--line)"><div class="row" style="gap:6px"><div class="acwrap" style="flex:1 1 120px"><input id="jvs_label_${esc(vehId)}" placeholder="Name (e.g. Transfer station)" data-savedonly="1" data-name-into="1" data-pair-addr="jvs_addr_${esc(vehId)}" onfocus="addrSuggest('jvs_label_${esc(vehId)}','jvs_label_${esc(vehId)}_ac')" oninput="addrSuggest('jvs_label_${esc(vehId)}','jvs_label_${esc(vehId)}_ac')" autocomplete="off" style="width:100%"><div class="acbox" id="jvs_label_${esc(vehId)}_ac"></div></div><div class="acwrap" style="flex:1 1 120px"><input id="jvs_addr_${esc(vehId)}" placeholder="Address" data-pair-label="jvs_label_${esc(vehId)}" onfocus="addrSuggest('jvs_addr_${esc(vehId)}','jvs_addr_${esc(vehId)}_ac')" oninput="addrSuggest('jvs_addr_${esc(vehId)}','jvs_addr_${esc(vehId)}_ac')" autocomplete="off" style="width:100%"><div class="acbox" id="jvs_addr_${esc(vehId)}_ac"></div></div></div><button class="btn ghost sm" style="margin-top:6px;width:100%" onclick="jobVehStopAdd('${j.id}','${esc(vehId)}')">+ Add a stop for this vehicle</button></div>`;
    }
    h += `</div>`;
  });
  // assign vehicles (owner/admin) — checkboxes, like the crew card
  if (canEdit) {
    const list = jobVehList();
    if (list.length) {
      h += `<div class="sub muted" style="margin:2px 0 4px">Assign vehicles</div>`;
      h += list.map(v => {
        const on = assigned.indexOf(v.id) >= 0;
        const own = v.ownerId ? ((typeof userName === "function" ? userName(v.ownerId) : "") || "") : "company truck";
        return `<label class="li" style="cursor:pointer"><input type="checkbox" style="width:20px;height:20px;flex:0 0 auto" ${on ? "checked" : ""} onchange="jobToggleVehicle('${j.id}','${esc(v.id)}')"><div class="grow"><div class="nm" style="font-size:15px">🚚 ${esc(v.name)}</div><div class="sub">${esc(own)}${v.plate ? " · " + esc(v.plate) : ""}</div></div></label>`;
      }).join("");
    } else {
      h += `<div class="muted">No vehicles yet — add them in Inventory (personal vehicles) or Admin (company trucks).</div>`;
    }
  }
  // 🗺 View the ACTUAL driven route (GPS) for this job — the tool from the old Route & mileage card (js/91).
  if (canEdit && assigned.length && typeof openRouteReview === "function") h += `<button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="openRouteReview('${j.id}')">🗺 View the actual driven route (GPS)</button>`;
  return h + `</div>`;
}
window.jobPageVehiclesCard = jobPageVehiclesCard;
