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
function jobVehReimb(vr) { return (vr && vr.estMiles > 0) ? Math.round(vr.estMiles * JOB_VEH_RATE * 100) / 100 : 0; }

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

/* ---------- the job-page card ---------- */
function jobPageVehiclesCard(j) {
  const assigned = Array.isArray(j.vehicleIds) ? j.vehicleIds : [];
  const canEdit = (typeof jobCanEditPlan === "function") && jobCanEditPlan();
  const m = (typeof money === "function") ? money : (n => "$" + (+n || 0).toFixed(0));
  let h = `<div class="card"><div style="font-weight:800;margin-bottom:6px">🚚 Vehicles & routes${assigned.length ? ` · <span class="sub" style="font-weight:400">${assigned.length}</span>` : ""}</div>`;
  // assigned vehicles — each with its own route + owner + estimate
  if (!assigned.length) h += `<div class="muted" style="margin-bottom:6px">No vehicles on this job yet.${canEdit ? " Assign the ones driving to it below." : ""}</div>`;
  assigned.forEach(vehId => {
    const v = jobVehById(vehId); const nm = v ? v.name : vehId;
    const vr = jobVehRouteRead(j, vehId);
    const owner = v && v.ownerId ? jobVehOwnerName(v) : "";
    const reimb = jobVehReimb(vr);
    const est = (vr.estMiles > 0) ? `~<b>${vr.estMiles} mi</b> round trip` : (vr.milesSource === "none" ? `<span class="muted">map couldn't route it</span>` : `<span class="muted">estimating…</span>`);
    const who = owner ? `reimburses <b>${esc(owner)}</b>${reimb ? ` ~${m(reimb)}` : ""}` : `<span class="muted">company truck — reimburses whoever drives it${reimb ? ` (~${m(reimb)})` : ""}</span>`;
    h += `<div class="card" style="background:var(--soft);padding:8px 10px;margin-bottom:8px"><div class="row" style="align-items:baseline"><div class="grow nm" style="font-size:15px">🚚 ${esc(nm)}${v && v.plate ? ` <span class="sub" style="font-weight:400">${esc(v.plate)}</span>` : ""}</div>${canEdit ? `<button class="btn ghost sm" onclick="jobToggleVehicle('${j.id}','${esc(vehId)}')" title="Remove from job">✕</button>` : ""}</div>`;
    h += `<div class="sub" style="white-space:normal;margin-top:2px">${est} · ${who}</div>`;
    // the vehicle's route: home base → job site → [its extra stops] → home base
    const siteAddr = (typeof jobAddr === "function") ? jobAddr(j) : (j.address || "");
    let steps = [`🏁 Home base`, siteAddr ? `📍 Job site` : `📍 Job site (set location)`];
    (vr.stops || []).forEach((s, i) => steps.push(`${esc(s.label || s.address || "Stop")}${canEdit ? ` <a onclick="jobVehStopDel('${j.id}','${esc(vehId)}',${i})" style="cursor:pointer;color:var(--danger)" title="Remove stop">✕</a>` : ""}`));
    steps.push(`🏁 Home base`);
    h += `<div class="sub" style="white-space:normal;margin-top:4px">${steps.join(" → ")}</div>`;
    // a Google Maps link for the whole loop (read the round-trip miles) — reuse js/61 gmapsRouteUrl
    if (typeof gmapsRouteUrl === "function") {
      const hb = (typeof homeBase === "function") ? homeBase() : null; const baseAddr = (hb && hb.address) ? hb.address : "";
      const loop = [baseAddr, siteAddr].concat((vr.stops || []).map(s => s.address)).concat([baseAddr]);
      const url = gmapsRouteUrl(loop);
      if (url) h += `<a class="btn ghost sm" style="margin-top:6px;display:flex;align-items:center;justify-content:center;gap:6px" href="${url}" target="_blank" rel="noopener">🗺 Open this vehicle's route in Google Maps</a>`;
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
  return h + `</div>`;
}
window.jobPageVehiclesCard = jobPageVehiclesCard;
