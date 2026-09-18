/* ---------- AUTO MILEAGE (js/181) — route miles from addresses, no odometer ----------
   Ray, 2026-09-18: "we just need to start automatically applying mileage. I'm not gonna do the odometer thing.
   Mileage just needs to be calculated based off of addresses."

   When a job is marked done, this routes base → job site → base on real roads (OSRM via js/62 roadRouteMiles,
   never a ×1.3 guess) and writes ONE mileage-only timeclock entry `tc_route_<jobId>` (miles confirmed,
   milesSource "route", zero hours) paid to the vehicle owner at the IRS rate through the existing split
   engine (js/39 reads vehicleOwnerId). Idempotent: recalculating updates the same entry. It steps aside when
   the job already has confirmed miles from an odometer / manual / standard entry, so nothing double-pays.
   Junk is stashed at the warehouse (= base), so the dump run is NOT here; batched dump runs stay their own trip. */
const AM_RATE = (typeof TC_RATE !== "undefined") ? TC_RATE : 0.725;

/* ===================== pure (node-testable) ===================== */
function amEntryId(jobId) { return "tc_route_" + jobId; }
function amRound(n) { return Math.round((+n || 0) * 10) / 10; }
/* does the job already carry confirmed miles from some other source? then the auto entry stays out of the way */
function amHasOtherMiles(entries, jobId) {
  return (entries || []).some(e => e && !e.deleted && e.jobId === jobId && e.milesSource !== "route" && e.milesConfirmed && (+e.miles || 0) > 0);
}
/* who drove: the first crew member on the job, else the fallback (the signed-in owner) */
function amDriver(j, fallbackId) { const c = (j && Array.isArray(j.crew) && j.crew.length) ? j.crew[0] : null; return c || fallbackId || null; }
/* which truck: the driver's own vehicle from the org truck list, else the first active vehicle */
function amVehicle(vehicles, driverId) {
  const vs = (vehicles || []).filter(v => v && v.active !== false && (v.kind || "vehicle") === "vehicle");
  return vs.find(v => v.ownerId === driverId) || vs[0] || null;
}
/* build (or refresh) the mileage-only entry; `existing` keeps its id/clock stamps */
function amBuildEntry(existing, j, roundTripMiles, driverId, driverName, veh, addr, ts) {
  const e = existing || { id: amEntryId(j.id), jobId: j.id, pings: [], stops: [], computedMiles: null, odoStart: null, odoEnd: null, riderRole: "driver", trailerId: null, rodeWith: null, invVehicleId: null, deleted: false };
  const t = (j && j.date) ? new Date(j.date + "T12:00:00").getTime() : ts;
  const mi = amRound(roundTripMiles);
  e.userId = driverId; e.userName = driverName || "Crew";
  if (e.clockIn == null) e.clockIn = t;
  if (e.clockOut == null) e.clockOut = t;
  e.miles = mi; e.milesConfirmed = true; e.milesSource = "route";
  e.note = "Route mileage (auto from addresses): base → " + (addr || "job site") + " → base, " + mi + " mi. No hours (mileage only).";
  e.vehicleId = veh ? veh.id : null; e.vehicle = veh ? (veh.name + (veh.plate ? " · " + veh.plate : "")) : "";
  e.vehicleOwnerId = (veh && veh.ownerId) || driverId;
  e.rate = AM_RATE; e.deleted = false; e.updatedAt = ts;
  return e;
}

/* ===================== UI / wiring ===================== */
if (typeof window !== "undefined") {
  window.amEntryFor = function (j) { const d = D(); return ((d && d.timeclock) || []).find(e => e && !e.deleted && e.id === amEntryId(j.id)) || null; };
  /* called from toggleJob when a job is marked done (and from the Recalculate button with {force:true}) */
  window.autoMileageOnDone = function (j, opts) {
    opts = opts || {};
    if (!j) return { skipped: "no-job" };
    const d = D(); if (!Array.isArray(d.timeclock)) d.timeclock = [];
    if (!opts.force && amHasOtherMiles(d.timeclock, j.id)) return { skipped: "has-miles" };
    const ll = (typeof jobLatLng === "function") ? jobLatLng(j) : null;
    const hb = (typeof homeBase === "function") ? homeBase() : null;
    if (!ll || !hb || hb.lat == null) { if (typeof toast === "function") toast("Mileage not added: no map location on this job's property"); return { skipped: "no-location" }; }
    roadRouteMiles([[hb.lat, hb.lng], [ll.lat, ll.lng]], function (mi) {
      if (mi == null) { if (typeof toast === "function") toast("Mileage not added: couldn't route the drive. Tap Recalculate on the job when online."); return; }
      const me = (typeof curUser === "function" && curUser()) ? curUser().id : null;
      const driver = amDriver(j, me);
      const veh = amVehicle((typeof orgVehicles === "function") ? orgVehicles() : [], driver);
      const ex = window.amEntryFor(j);
      const e = amBuildEntry(ex, j, mi * 2, driver, (typeof userName === "function" ? userName(driver) : "") || "Crew", veh, (typeof jobAddr === "function") ? jobAddr(j) : "", now());
      if (!ex) d.timeclock.push(e);
      save();
      if (typeof toast === "function") toast("Mileage added: " + e.miles + " mi round trip → " + (e.userName || "driver"));
      if (typeof render === "function") render();
    });
    return { started: true };
  };
  window.amRecalc = function (jobId) { const j = D().jobs.find(x => x && x.id === jobId); if (j) window.autoMileageOnDone(j, { force: true }); };
  /* the card on the job page (Costs section): what's booked, or the estimate before the job is done */
  window.jobAutoMileageHTML = function (j) {
    const e = window.amEntryFor(j);
    const other = amHasOtherMiles((D().timeclock || []), j.id);
    let body;
    if (e) body = `<b>${e.miles} mi</b> round trip · ${esc(e.userName || "")}${e.vehicle ? " · " + esc(e.vehicle) : ""} · ${money(Math.round(e.miles * e.rate * 100) / 100)} at $${e.rate}/mi`;
    else if (other) body = `Mileage already logged on this job's time entry, so the auto entry stays out.`;
    else {
      const ll = (typeof jobLatLng === "function") ? jobLatLng(j) : null;
      const dr = (ll && typeof driveFromBase === "function") ? driveFromBase(ll.lat, ll.lng) : null;
      body = ll ? (dr ? `Estimate <b>${dr.roundMiles} mi</b> round trip from base. Booked automatically when the job is marked done.` : `Routing from base… booked automatically when the job is marked done.`) : `<span style="color:var(--danger)">No map location on the property, so mileage can't be figured. Add the address to the property.</span>`;
    }
    return `<div class="li" style="margin-top:6px"><div class="grow"><div class="nm" style="font-size:14px">🚗 Mileage (from addresses)</div><div class="sub" style="white-space:normal">${body}</div></div><button class="btn ghost sm" style="flex:0 0 auto" onclick="amRecalc('${j.id}')">${e ? "Recalculate" : "Book now"}</button></div>`;
  };
}
if (typeof module !== "undefined" && module.exports) { module.exports = { amEntryId, amHasOtherMiles, amDriver, amVehicle, amBuildEntry, amRound }; }
