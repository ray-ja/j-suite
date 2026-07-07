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
const TC_TOL = 0.25;          // GPS-vs-odometer verification tolerance (25%, ASYMMETRIC — see tcVerify)
const TC_HOME_RADIUS_MI = 0.14;      // ~225m — "you're home" radius around a user's homeLocation (task: 150-250m)
const TC_HOME_SUGGEST_MIN_MS = 600000;   // only SUGGEST a home clock-out if the phone got home >=10 min ago (the forgot-to-clock-out case)
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
/* persistent header indicator: are you clocked in, on which job, for how long, in which vehicle —
   so a forgotten clock-out (or a missing vehicle) is impossible to miss. Ticks via a 30s interval. */
function renderClockPill() {
  const el = document.getElementById("clockpill"); if (!el) return;
  const open = (typeof tcMyOpen === "function") ? tcMyOpen() : null;
  if (!open) {
    el.style.cssText = "display:inline-flex;align-items:center;gap:5px;border:none;border-radius:999px;padding:5px 11px;font-size:12px;font-weight:700;cursor:pointer;background:var(--soft);color:var(--muted)";
    el.title = "You're clocked out — tap to clock in"; el.innerHTML = "⏱️ Clocked out"; return;
  }
  const j = (typeof actJ === "function") ? actJ().find(x => x && x.id === open.jobId) : null;
  const dur = (typeof tcFmtDur === "function") ? tcFmtDur(Date.now() - (open.clockIn || Date.now())) : "";
  const needOdo = (typeof tcNeedsOdo === "function") ? tcNeedsOdo(open) : false;   // vehicle chosen but no odometer yet → warn
  el.style.cssText = "display:inline-flex;align-items:center;gap:5px;max-width:50vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:none;border-radius:999px;padding:5px 11px;font-size:12px;font-weight:800;cursor:pointer;" + (needOdo ? "background:var(--danger);color:#fff" : "background:var(--accent);color:var(--accent-ink)");
  el.title = "Clocked in — tap to open the job";
  const _pillVeh = (open.riderRole === "driver" && open.vehicle) ? (" · 🚚 " + esc(open.vehicle) + (needOdo ? " · ⚠ odo" : "")) : (open.riderRole === "passenger" ? " · 🧍" : " · 🚶");
  el.innerHTML = "⏱️ " + esc(j ? (j.title || "Job") : "On the clock") + " · " + dur + _pillVeh;
}
window.clockPillTap = function () {
  const open = (typeof tcMyOpen === "function") ? tcMyOpen() : null;
  if (!open) { TAB = "today"; if (typeof render === "function") render(); return; }   // clocked out → Today (clock in from a job)
  if (open.jobId && typeof openJobPage === "function") openJobPage(open.jobId);
  else { TAB = "schedule"; if (typeof render === "function") render(); }
};
try { setInterval(function () { if (typeof renderClockPill === "function") renderClockPill(); if (typeof renderOdoBanner === "function") renderOdoBanner(); }, 30000); } catch (e) {}
function tcJob(id) { return (D().jobs || []).find(j => j.id === id) || null; }
/* ===== estimated vs ACTUAL job time (the learning loop). Estimate = the quote's hours-each × crew (incl.
   drive + setup). Actual = the SUM of every clocked segment on the job across the whole crew — breaks
   fall out automatically (a lunch clock-out is just a gap between two completed entries), so it's the
   real time-on-site. Apples to apples as long as the crew clocks the whole job. ===== */
function jobEstHrsEach(j) { var h = +(j && j.estHours) || 0; if (!h && j) { var q = (D().quotes || []).find(x => x && !x.deleted && x.jobId === j.id); if (q) h = +q.hours || 0; } return h; }
function jobEstCrew(j) { var c = +(j && j.estCrew) || 0; if (!c && j) { var q = (D().quotes || []).find(x => x && !x.deleted && x.jobId === j.id); if (q) c = +q.crewN || 0; } return Math.max(1, c || 1); }
function jobEstCrewHrs(j) { return Math.round(jobEstHrsEach(j) * jobEstCrew(j) * 10) / 10; }
function jobClockedHrs(j) { if (!j) return 0; return Math.round((D().timeclock || []).filter(e => e && !e.deleted && e.jobId === j.id && e.clockOut).reduce((s, e) => s + Math.max(0, e.clockOut - e.clockIn), 0) / 3600000 * 10) / 10; }
function tcJobTitle(id) { const j = tcJob(id); return j ? (j.title || "Job") : "—"; }

/* ----- geometry + math ----- */
function tcHaversine(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return 0;
  const R = 3958.8, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));   // miles
}
/* A GPS fix worse than this many METERS of accuracy is a cell-tower / wifi / IP fallback, NOT real GPS — the
   phone couldn't get satellites and reported an approximate location that can be tens of MILES off (we saw
   acc:50000 = a 50 km "fix" pointing at Charlotte, ~285 mi from the job, drawing a phantom leg). Reject those
   from the path + GPS-mileage so a garbage point can never draw a line or inflate the estimate. acc==null =
   older points with no accuracy recorded → kept (can't judge). */
const TC_GPS_MAX_ACC = 200;
function tcGoodPt(p) { return !!(p && p.lat != null && p.lng != null && isFinite(p.lat) && isFinite(p.lng) && !(p.lat === 0 && p.lng === 0) && (p.acc == null || p.acc <= TC_GPS_MAX_ACC)); }
/* ordered travelled path: clock-in stamp → foreground pings (by time) → clock-out stamp — GARBAGE (low-accuracy)
   fixes filtered out so they can't draw a phantom straight line to the middle of nowhere. */
function tcPath(e) {
  const pts = [];
  if (tcGoodPt(e.inLoc)) pts.push(e.inLoc);
  (e.pings || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0)).forEach(p => { if (tcGoodPt(p)) pts.push(p); });
  if (tcGoodPt(e.outLoc)) pts.push(e.outLoc);
  return pts;
}
function tcComputeMiles(e) { const p = tcPath(e); let m = 0; for (let i = 1; i < p.length; i++) m += tcHaversine(p[i - 1], p[i]); return m; }
function tcHours(e) { const end = e.clockOut || now(); return Math.max(0, (end - e.clockIn) / 3600000); }
/* ===== SUGGESTED CLOCK-OUT (home-GPS) — a best-effort "when did your phone get back home" for the forgot-to-
   clock-out case. REUSES the location history the shift already captured for mileage (inLoc + foreground
   pings[] + GPS-stamped stops); it adds NO new capture and NEVER changes how hours/miles are computed — it only
   surfaces a suggested clockOut timestamp the user may choose. FOREGROUND-ONLY LIMITATION: pings are captured
   only while the app is on-screen (OS suspends a backgrounded PWA), so if the phone was locked/backgrounded for
   the whole drive home there is simply no home-matching sample → no suggestion (graceful; never blocks). ===== */
function tcUserHome(userId) {
  const u = (typeof S !== "undefined" && Array.isArray(S.users)) ? S.users.find(x => x && x.id === userId && !x.kind && !x.deleted) : null;
  return (u && u.homeLocation && u.homeLocation.lat != null && u.homeLocation.lng != null) ? u.homeLocation : null;
}
/* the earliest timestamp the shift's location history shows the phone back within TC_HOME_RADIUS_MI of `home`
   AFTER it had left (a non-home sample seen first) — "when you got home". Returns null if home was never left in
   the captured samples (backgrounded drive, or home==job site) or `home` is unset. Crew clock in AT home when
   they leave for the job, so we must ignore those leading at-home samples and only count a RETURN. */
function tcHomeArrival(e, home) {
  if (!e || !home || home.lat == null) return null;
  const samples = [];
  if (e.inLoc && e.inLoc.lat != null && e.inLoc.ts != null) samples.push({ lat: e.inLoc.lat, lng: e.inLoc.lng, ts: e.inLoc.ts });
  (e.pings || []).forEach(p => { if (p && p.lat != null && p.ts != null) samples.push({ lat: p.lat, lng: p.lng, ts: p.ts }); });
  (e.stops || []).forEach(s => { if (s && s.loc && s.loc.lat != null) samples.push({ lat: s.loc.lat, lng: s.loc.lng, ts: (s.ts != null ? s.ts : s.loc.ts) }); });
  if (e.outLoc && e.outLoc.lat != null && e.outLoc.ts != null) samples.push({ lat: e.outLoc.lat, lng: e.outLoc.lng, ts: e.outLoc.ts });
  samples.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  let leftHome = false;
  for (const s of samples) {
    const near = tcHaversine(s, home) <= TC_HOME_RADIUS_MI;
    if (!near) { leftHome = true; continue; }
    if (near && leftHome) return s.ts;   // first time back home after leaving = likely real clock-out
  }
  return null;
}
function tcFmtDur(ms) { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h + "h " + String(m).padStart(2, "0") + "m"; }
/* local calendar day ("YYYY-MM-DD") of a timestamp — used to attribute a punch to a work day + a punch's hh:mm */
function tcLocalDay(ms) { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function tcHHMM(ms) { try { return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
/* a ms timestamp → a datetime-local input value ("YYYY-MM-DDTHH:mm") in LOCAL time (round-trips via new Date(v)) */
function tcDatetimeLocal(ms) { const d = new Date(ms), p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes()); }
function tcRound(n) { return Math.round((n || 0) * 10) / 10; }
/* confirmed miles if set, else the rounded GPS estimate */
function tcMiles(e) { return (e.miles != null) ? e.miles : tcRound(e.computedMiles); }
function tcMileageCost(e) { return tcMiles(e) * (e.rate || TC_RATE); }
/* odometer-delta miles (null if either reading is missing) — odometer is ALWAYS the number of record */
function tcOdoMiles(e) { return (e && e.odoStart != null && e.odoEnd != null) ? Math.max(0, e.odoEnd - e.odoStart) : null; }
/* GPS-vs-odometer VERIFICATION (25% ASYMMETRIC). The odometer stays the number of record; GPS only FLAGS a
   discrepancy (or substitutes when the odometer is absent). The asymmetry tolerates a normal GPS UNDERCOUNT
   (a backgrounded PWA misses route) but flags an odometer that's implausibly HIGH vs GPS, OR an odometer that
   reads LOWER than the GPS path (you can't drive fewer real miles than the GPS already traced).
   Returns { flag:bool, kind, odo, gps, deltaPct } or null when there's nothing to compare. */
function tcVerify(e) {
  const odo = tcOdoMiles(e); if (odo == null) return null;       // no odometer → nothing to verify against
  const gps = tcRound(e.computedMiles); if (!(gps > 0.3)) return null;   // negligible GPS path → can't verify
  const hi = gps * (1 + TC_TOL);                                  // odometer implausibly higher than GPS allows
  if (odo > hi) return { flag: true, kind: "odo-high", odo: odo, gps: gps, deltaPct: Math.round((odo - gps) / gps * 100) };
  if (odo < gps * (1 - 0.02)) return { flag: true, kind: "odo-low", odo: odo, gps: gps, deltaPct: Math.round((gps - odo) / gps * 100) };  // odometer below the GPS-traced distance (impossible) — tiny epsilon for rounding
  return { flag: false, kind: "ok", odo: odo, gps: gps, deltaPct: Math.round(Math.abs(odo - gps) / gps * 100) };
}
/* source badge — where the entry's miles came from (provenance) */
function tcSourceBadge(e) {
  const s = e && e.milesSource;
  if (s === "odometer") return `<span class="badge" style="background:var(--accent);color:var(--accent-ink)">odometer</span>`;
  if (s === "manual") return `<span class="badge" style="background:var(--brand,#1B2A4E);color:#fff">manual</span>`;
  if (s === "gps") return `<span class="badge" style="background:var(--soft);color:var(--muted)">GPS est</span>`;
  return "";
}

/* ----- geolocation (permission-gated; resolves null on deny/unavailable so time-tracking still works) ----- */
/* BUG 2 (cross-device clock in/out): clock-in and clock-out are the SAME synced timeclock record and can
   legitimately happen on different devices (crew clocks in on their phone, the owner closes it out later from
   a desktop). Every location fix we capture gets tagged with a rough device-class hint so we can prefer a
   PHONE's GPS fix (accurate) over a desktop's (usually coarse IP-geolocation, or no permission at all) when
   reconciling which fix to trust for a given moment — see tcBestLoc / tcFinalizeOutLoc below. */
function tcDeviceClass() {
  try {
    if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer:coarse)").matches) return "mobile";
    if (navigator.maxTouchPoints > 0) return "mobile";
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "")) return "mobile";
  } catch (e) {}
  return "desktop";
}
function tcGetPos() {
  return new Promise(function (resolve) {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      function (p) { resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, ts: now(), dev: tcDeviceClass() }); },
      function () { resolve(null); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}
/* pick the best location fix for a moment out of whatever candidates exist: prefer a MOBILE-tagged fix over
   a desktop one (a phone's on-board GPS beats a desktop's coarse/absent location); among same-class
   candidates prefer the most recent; if nothing usable was captured at all, return null (an honest estimate
   gap) rather than guessing — callers must not crash on that. */
function tcBestLoc() {
  const cands = Array.prototype.slice.call(arguments).filter(Boolean);
  if (!cands.length) return null;
  const mobile = cands.filter(c => c.dev === "mobile").sort((a, b) => (b.ts || 0) - (a.ts || 0));
  if (mobile.length) return mobile[0];
  return cands.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];   // whichever device recorded it
}
/* the effective CLOCK-OUT location for an entry: the freshly-captured fix (from whichever device pressed
   clock out) vs. the most recent foreground ping already on the entry (which may have come from the OTHER,
   original device, e.g. the phone that clocked in and pinged right up until it was locked/backgrounded) —
   mobile wins per tcBestLoc. Falls back to any prior e.outLoc, then null (no crash, just an estimate gap). */
function tcFinalizeOutLoc(e, freshLoc) {
  const lastPing = (e && e.pings && e.pings.length) ? e.pings[e.pings.length - 1] : null;
  return tcBestLoc(freshLoc, lastPing, e && e.outLoc);
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
/* BUG FIX (June 30 duplicate-clock-in incident): rapid-tapping "Clock in" created N identical OPEN shifts a
   few dozen ms apart. Root cause: the ONLY guard was `tcOpenShift(who.userId)` — a check-then-act race. That
   check reads tcoll() SYNCHRONOUSLY, but the new entry isn't pushed until AFTER `await tcGetPos()` resolves.
   On a real phone, getCurrentPosition() can take anywhere from tens of ms to its full 12s timeout, so every
   tap that lands before the FIRST call's GPS fix resolves sees "no open shift yet" and independently creates
   its own entry — there was zero re-entrancy protection during that async gap. Same class of bug (and same
   fix) as the dupe-expense/material incident in js/61-job-page.js: a module-level busy flag set SYNCHRONOUSLY
   before the first await, a 20s watchdog so a hung GPS fix can never permanently soft-lock the button, and
   the button disables/relabels so a slow save is visibly in-flight, not stuck. */
let _tcInBusy = false, _tcInWatchdog = null;
/* PROGRAMMATIC CLOCK-IN CORE (shared by the DOM handler AND Cap-Today's confirm-cards). Builds the entry record
   from an args object instead of reading the DOM — {jobId, role?, veh?|vehicle?, trailerId?, rodeWith?, odoStart?,
   loc?}. Owns the SAME submit-lock (_tcInBusy + 20s watchdog), the SAME work-day union, save + tcPingStart. Returns
   {ok:true, entry} or {ok:false, error} (never alerts, never render()s — the caller decides). `veh` may be a
   resolved {vehicleId,vehicleOwnerId,vehicle,invVehicleId} object; else `vehicle` is an encoded picker value we
   resolve via tcResolveVehicle. `loc` (if provided, incl. null) skips the GPS await. The DOM wrapper below passes
   exactly what it read from the form, so the record is BYTE-IDENTICAL to the pre-refactor path. */
window.tcClockInWith = async function (args) {
  args = args || {};
  if (_tcInBusy) return { ok: false, error: "busy" };   // a clock-in save is already in flight
  const jobId = args.jobId;
  if (!jobId) return { ok: false, error: "no-job" };
  const who = tcWho();
  if (tcOpenShift(who.userId)) return { ok: false, error: "already-open" };
  // RIDER ROLE — only the DRIVER logs a vehicle's miles. A passenger / no-vehicle shift carries NO vehicle, so the
  // truck is never double-counted. Default to driver if the caller predates the picker (defensive).
  let role = args.role || "driver";
  let veh = { vehicleId: null, vehicleOwnerId: null, vehicle: "" };
  let trailerId = null, rodeWith = null, odoStart = null;
  if (role === "driver") {
    veh = (args.veh && typeof args.veh === "object") ? args.veh : tcResolveVehicle(args.vehicle != null ? args.vehicle : "", who.userId);
    // never silently save a driver shift with NO vehicle attached (June 30 prod incident) — block + report.
    if (!veh.vehicleId && !veh.vehicleOwnerId && !veh.vehicle) return { ok: false, error: "no-vehicle" };
    trailerId = args.trailerId || null;   // optional towed trailer (no odometer)
    // Odometer NEVER blocks clock-in (you may not be in the truck yet). Only take it if a value was passed.
    const o = parseFloat(args.odoStart); if (o >= 0) odoStart = o;
  } else if (role === "passenger") {
    rodeWith = args.rodeWith || null;   // who drove (record-only); this person logs NO miles
  }   // role === "none": no vehicle, no mileage
  _tcInBusy = true;
  clearTimeout(_tcInWatchdog); _tcInWatchdog = setTimeout(function () { _tcInBusy = false; }, 20000); // safety: never permanently soft-lock if GPS hangs
  const loc = (args.loc !== undefined) ? args.loc : await tcGetPos();
  const e = {
    id: uid(), jobId: jobId, userId: who.userId, userName: who.name,
    clockIn: now(), clockOut: null,
    inLoc: loc, outLoc: null, pings: [], stops: [],
    computedMiles: 0, miles: null, milesConfirmed: false, milesSource: null,
    odoStart: odoStart, odoEnd: null,
    riderRole: role, trailerId: trailerId, rodeWith: rodeWith,
    vehicleId: veh.vehicleId, vehicle: veh.vehicle, vehicleOwnerId: veh.vehicleOwnerId, invVehicleId: veh.invVehicleId || null, rate: TC_RATE, updatedAt: now()
  };
  tcoll().push(e);
  if (typeof logChange === "function") logChange("create", "timeclock", e.id, "Clocked in — " + tcJobTitle(jobId) + " · " + who.name + (loc ? "" : " (no GPS)"));
  // (Item 4A) clocking in AUTO-ADDS this clock-in's local day to the job's work days (Set-union, additive — it
  // GROWS j.workDays, never shrinks it). Reuses jobPageCommitDays (js/61) so the day-list + full editor stay in
  // sync. Idempotent: a no-op when the day is already a work day.
  try {
    const _jb = tcJob(jobId), _day = tcLocalDay(e.clockIn);
    if (_jb) {
      const _cur = (typeof jobWorkDays === "function") ? jobWorkDays(_jb) : ((Array.isArray(_jb.workDays) ? _jb.workDays : (_jb.date ? [_jb.date] : [])));
      if (_cur.indexOf(_day) < 0) {
        if (typeof jobPageCommitDays === "function") jobPageCommitDays(_jb, _cur.concat([_day]));
        else { const wd = new Set(_cur); wd.add(_day); if (_jb.date) wd.add(_jb.date); _jb.workDays = [...wd].sort(); if (typeof touch === "function") touch(_jb); }
      }
    }
  } catch (ex) {}
  clearTimeout(_tcInWatchdog); _tcInBusy = false;
  save(); tcPingStart();
  return { ok: true, entry: e };
};
window.tcClockIn = async function () {
  if (_tcInBusy) return;   // ignore rapid re-taps while a clock-in save is already in flight
  const jobId = val("tc_job");
  if (!jobId) { alert("Pick the job you're working on."); return; }
  const who = tcWho();
  if (tcOpenShift(who.userId)) { alert("You already have an open shift — clock out first."); render(); return; }
  // RIDER ROLE — only the DRIVER logs a vehicle's miles (default driver if the form predates the picker).
  let role = val("tc_role") || "driver";
  let veh = { vehicleId: null, vehicleOwnerId: null, vehicle: "" };
  let trailerId = null, rodeWith = null, odoStart = null;
  if (role === "driver") {
    veh = tcResolveVehicle(val("tc_vehicle"), who.userId);   // {vehicleId, vehicleOwnerId, vehicle}
    /* BUG FIX (vehicleId not attaching, June 30 prod incident): never silently save riderRole:"driver" with an
       empty vehicle — block + say so (the shared core also refuses, but we alert here where we can name why). */
    if (!veh.vehicleId && !veh.vehicleOwnerId && !veh.vehicle) {
      alert(tcHasVehicleOptions() ? "Pick a vehicle before clocking in as the driver (or switch to Passenger / No vehicle)." : "No vehicles are set up for this crew yet — ask the owner to add one in Admin, or pick Passenger / No vehicle instead.");
      return;
    }
    trailerId = val("tc_trailer") || null;   // optional towed trailer (no odometer)
    const o = parseFloat(val("tc_odo_start")); if (o >= 0) odoStart = o;   // odometer never blocks clock-in
  } else if (role === "passenger") {
    rodeWith = val("tc_rodewith") || null;   // who drove (record-only); this person logs NO miles
  }   // role === "none": no vehicle, no mileage
  const btn = document.getElementById("tc_inbtn");
  if (btn) { btn.disabled = true; btn.textContent = "Clocking in…"; }
  // delegate to the shared core — it owns the submit-lock, record build, work-day union, save + ping (byte-identical)
  await tcClockInWith({ jobId: jobId, role: role, veh: veh, trailerId: trailerId, rodeWith: rodeWith, odoStart: odoStart });
  render();
};
/* clock-out (and — when contJobId is given — the "close the old segment" half of Change Job, see below) share
   this SAME modal: a driver shift asks for the ending odometer (or "use GPS estimate"), a no-vehicle shift is
   a single confirm tap. contJobId just re-targets the buttons to the change-job finish handlers instead of the
   plain clock-out ones, so there is exactly ONE odometer/GPS-estimate UI in this file, not two. */
window.tcClockOut = function (id, contJobId) {
  const e = tcoll().find(x => x.id === id); if (!e || e.clockOut) return;
  // refresh the GPS estimate so the "Use GPS estimate" tap + verification reflect the latest path
  e.computedMiles = tcComputeMiles(e);
  const gpsEst = tcRound(e.computedMiles);
  const finishFn = contJobId ? `tcFinishChangeJob('${id}','${contJobId}')` : `tcFinishClockOut('${id}')`;
  const gpsFn = contJobId ? `tcChangeJobGps('${id}','${contJobId}')` : `tcClockOutGps('${id}')`;
  const title = contJobId ? "Change job" : "Clock out";
  const doneLabel = contJobId ? "🔁 Switch job" : "⏱ Clock out now";
  const odoLabel = contJobId ? "🔁 Switch job" : "📍 Clock out now";
  // SUGGESTED CLOCK-OUT (real clock-out only, never Change Job): if the shift's own GPS history shows the phone
  // got back home a meaningful while ago, offer that time as the likely real clock-out (forgot-to-clock-out).
  // Additive only — it doesn't alter the odometer/GPS buttons below; it just adds a "use that time" shortcut.
  let suggestHtml = "";
  if (!contJobId) {
    const home = tcUserHome(e.userId);
    const arr = home ? tcHomeArrival(e, home) : null;
    if (arr != null && arr > e.clockIn && (now() - arr) >= TC_HOME_SUGGEST_MIN_MS) {
      const t = (function () { try { return new Date(arr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (x) { return ""; } })();
      suggestHtml = `<div class="card" style="border-left:5px solid var(--accent);background:var(--soft);margin-bottom:12px">
        <div class="nm" style="font-size:16px">🏠 Recommended clock-out: ${t}</div>
        <div class="sub" style="white-space:normal;margin-top:2px">This is when your phone got back home${home.label ? " (" + esc(home.label) + ")" : ""} — looks like you forgot to clock out. Use it so your hours are accurate.</div>
        <button class="btn acc" style="margin-top:10px;width:100%" onclick="tcHomeClockOut('${id}',${arr})">🏠 Clock out at ${t} — when you got home</button>
        <div class="sub" style="text-align:center;margin-top:6px">— or —</div>
      </div>`;
    }
  }
  if (!tcEntryHasVehicle(e)) {   // No-vehicle shift → no odometer, no mileage; just close it out
    modal(title, suggestHtml + `
      <p class="muted" style="margin-bottom:8px">No vehicle on this shift — ${contJobId ? "switching jobs" : "clocking out"} logs your time only (no mileage).</p>
      <button class="btn ${suggestHtml ? "ghost" : "acc"}" style="margin-top:8px;width:100%" onclick="${finishFn}">${doneLabel}</button>`);
    return;
  }
  modal(title + " — odometer", suggestHtml + `
    <p class="muted" style="margin-bottom:8px">Ending odometer reading on <b>${esc(e.vehicle || "the vehicle")}</b>. The odometer is the number of record.</p>
    <label>End odometer</label>
    <input id="tc_odo_end" type="number" inputmode="decimal" value="${e.odoEnd != null ? e.odoEnd : ""}" placeholder="${e.odoStart != null ? "more than " + e.odoStart : "miles showing now"}" oninput="tcOdoCheck('${e.id}')">
    <div class="sub" style="margin-top:6px">${e.odoStart != null ? "Start was " + e.odoStart + "." : "No start reading — the GPS estimate is " + gpsEst + " mi."} </div>
    ${tcClockOutEstLine(e)}
    <button class="btn acc" style="margin-top:14px;width:100%" onclick="${finishFn}">${odoLabel}</button>
    <button class="btn ghost" style="margin-top:8px;width:100%" onclick="${gpsFn}">🛰 No odometer — use GPS estimate (${gpsEst} mi)</button>`);
};
/* Item 8 — the INFORMATIONAL route-estimate line inside the clock-out odometer modal. Shows the job's offline
   route estimate and, once an end reading is typed, a live odometer-delta vs estimate soft-flag (>20% off). This
   NEVER overrides the odometer of record (tcFinalizeSegment) — it's a sanity check the crew sees while entering. */
function tcClockOutEstLine(e) {
  const j = tcJob(e.jobId), est = (j && j.estRouteMiles > 0) ? j.estRouteMiles : null;
  if (est == null) return "";
  return `<div class="sub" id="tc_odo_est" style="margin-top:6px;white-space:normal;color:var(--brand-text)">🧭 Route estimate ~<b>${est} mi</b> <span class="muted">· informational — the odometer you enter is the billed number</span></div>`;
}
window.tcOdoCheck = function (id) {
  const box = document.getElementById("tc_odo_est"); if (!box) return;
  const e = tcoll().find(x => x.id === id); if (!e) return;
  const j = tcJob(e.jobId), est = (j && j.estRouteMiles > 0) ? j.estRouteMiles : null; if (est == null) return;
  const end = parseFloat(val("tc_odo_end"));
  if (!(end >= 0) || e.odoStart == null) { box.innerHTML = `🧭 Route estimate ~<b>${est} mi</b> <span class="muted">· informational — the odometer you enter is the billed number</span>`; return; }
  const delta = Math.max(0, end - e.odoStart), off = Math.round(Math.abs(delta - est) / est * 100), flag = off > 20;
  box.innerHTML = `🧭 Route estimate ~<b>${est} mi</b> · odometer <b>${Math.round(delta * 10) / 10} mi</b> ${flag ? `<span style="color:var(--danger);font-weight:700">· ⚠ ${off}% off the estimate — double-check the reading (the odometer still wins)</span>` : `<span class="muted">· within ${off}% (looks right)</span>`}`;
};
/* home-GPS shortcut: clock out AT the detected home-arrival timestamp (the "use recommended time" button).
   Miles/odometer/verify are computed EXACTLY as a normal clock-out — this only changes WHICH clockOut ts is
   used (so hours = homeArrival − clockIn) and tags provenance clockOutSource:"home-gps". If the user typed an
   ending odometer we honor it; otherwise it falls to the GPS estimate (owner still confirms), never blocking. */
window.tcHomeClockOut = function (id, atTs) {
  const e = tcoll().find(x => x.id === id); if (!e || e.clockOut) return;
  if (typeof closeModal === "function") closeModal();
  let odoEnd = null;
  if (tcEntryHasVehicle(e)) {
    const o = parseFloat(val("tc_odo_end"));
    if (o >= 0 && !(e.odoStart != null && o < e.odoStart)) odoEnd = o;   // use it only if a valid reading was typed; else GPS estimate
  }
  tcFinalizeSegment(e, odoEnd, atTs);
  e.clockOutSource = "home-gps";
  touch(e); tcPingStop();
  if (typeof logChange === "function") logChange("update", "timeclock", e.id, "Clocked out (home GPS) — " + tcFmtDur(e.clockOut - e.clockIn) + " · " + tcMiles(e) + " mi · " + tcJobTitle(e.jobId));
  save(); render();
  // best-effort out-location, non-blocking (mirrors tcFinishClockOut) — never affects the chosen clock-out time
  try { tcGetPos().then(function (loc) { const chosen = tcFinalizeOutLoc(e, loc); if (chosen && chosen !== e.outLoc) { e.outLoc = chosen; e.computedMiles = tcComputeMiles(e); if (e.milesSource === "gps" && !e.milesConfirmed) e.miles = tcRound(e.computedMiles); touch(e); save(); } }).catch(function () {}); } catch (ex) {}
};
/* the actual odometer/GPS mileage math for closing a segment — shared by a normal clock-out AND by Change
   Job's "close the old segment" step, computed exactly once. Mutates e; does NOT touch/save/render/log —
   callers differ in what happens next (stay clocked out vs. immediately open a new segment on another job). */
function tcFinalizeSegment(e, odoEnd, atTs) {
  const hasVeh = tcEntryHasVehicle(e);
  // clock out IMMEDIATELY — never block on GPS (it hangs at the dump / when location is off). The odometer is the truth.
  // atTs (optional): the chosen clock-out timestamp — used ONLY by the home-GPS suggestion so hours reflect when
  // the phone actually got home. When absent (every existing caller), it's now(), byte-identical to before.
  e.clockOut = (atTs != null && atTs >= e.clockIn) ? atTs : now(); e.odoEnd = odoEnd;
  e.computedMiles = tcComputeMiles(e);
  if (hasVeh && e.odoStart != null && odoEnd != null) {   // full odometer pair → odometer is the number of record, auto-confirmed
    e.miles = Math.max(0, odoEnd - e.odoStart); e.milesSource = "odometer"; e.milesConfirmed = true;
    const v = tcVerify(e); e.milesFlag = (v && v.flag) ? v.kind : null;   // GPS only FLAGS; never overrides the odometer
  } else if (hasVeh && odoEnd != null && e.odoStart == null) {   // only an end reading, no start → can't compute a delta; fall back to GPS
    if (e.miles == null) { e.miles = tcRound(e.computedMiles); e.milesSource = "gps"; }
  } else if (!hasVeh) {   // no vehicle → no mileage
    e.miles = 0; e.milesSource = null; e.milesConfirmed = true;
  } else if (e.miles == null) {   // vehicle but no odometer entered at all → GPS estimate
    e.miles = tcRound(e.computedMiles); e.milesSource = "gps";
  }
}
/* one-tap: clock out using the GPS estimate as the miles (odometer left blank). milesSource = "gps". */
window.tcClockOutGps = function (id) {
  const e = tcoll().find(x => x.id === id); if (!e || e.clockOut) return;
  if (typeof closeModal === "function") closeModal();
  e.clockOut = now(); e.odoEnd = null;
  e.computedMiles = tcComputeMiles(e);
  e.miles = tcRound(e.computedMiles); e.milesSource = "gps"; e.milesConfirmed = false;   // GPS estimate → owner still confirms
  touch(e); tcPingStop();
  if (typeof logChange === "function") logChange("update", "timeclock", e.id, "Clocked out (GPS) — " + tcFmtDur(e.clockOut - e.clockIn) + " · " + tcMiles(e) + " mi est · " + tcJobTitle(e.jobId));
  save(); render();
  // cross-device: prefer a mobile-tagged fix (this capture, or the last foreground ping — which may be
  // from the OTHER device that actually clocked in) over a desktop one; never overwrite a better fix already set.
  try { tcGetPos().then(function (loc) { const chosen = tcFinalizeOutLoc(e, loc); if (chosen && chosen !== e.outLoc) { e.outLoc = chosen; e.computedMiles = tcComputeMiles(e); if (e.milesSource === "gps" && !e.milesConfirmed) e.miles = tcRound(e.computedMiles); touch(e); save(); } }).catch(function () {}); } catch (ex) {}
};
/* PROGRAMMATIC CLOCK-OUT CORE (shared by the DOM handler AND Cap-Today's confirm-cards). Closes an open entry:
   tcFinalizeSegment(e, odoEnd) + touch + tcPingStop + logChange + save + the best-effort out-location capture.
   Enforces the SAME odoEnd≥odoStart rule as the DOM path — returns {ok:false, error:"odo-low"} (a real error the
   caller surfaces) rather than silently rejecting; {ok:false, error:"odo-required"} if a driving shift has no
   ending odometer. `opts.odoEnd` may be null (a no-vehicle close, or the GPS-estimate path handled elsewhere).
   Never render()s — the caller decides. Byte-identical result to the pre-refactor tcFinishClockOut. */
function tcClockOutWith(entryId, opts) {
  opts = opts || {};
  const e = tcoll().find(x => x.id === entryId); if (!e || e.clockOut) return { ok: false, error: "not-open" };
  const hasVeh = tcEntryHasVehicle(e);
  let odoEnd = null;
  if (hasVeh) {
    const raw = opts.odoEnd;
    if (raw == null || raw === "") return { ok: false, error: "odo-required" };
    odoEnd = parseFloat(raw);
    if (!(odoEnd >= 0)) return { ok: false, error: "odo-required" };
    if (e.odoStart != null && odoEnd < e.odoStart) return { ok: false, error: "odo-low", odoStart: e.odoStart };
  }
  tcFinalizeSegment(e, odoEnd);
  touch(e); tcPingStop();
  if (typeof logChange === "function") logChange("update", "timeclock", e.id, "Clocked out — " + tcFmtDur(e.clockOut - e.clockIn) + " · " + tcMiles(e) + " mi · " + tcJobTitle(e.jobId) + (e.milesFlag ? " ⚠ GPS-mismatch" : ""));
  save();
  // best-effort out-location, fully non-blocking — fills it in if/when GPS resolves; never affects the clock-out.
  try { tcGetPos().then(function (loc) { const chosen = tcFinalizeOutLoc(e, loc); if (chosen && chosen !== e.outLoc) { e.outLoc = chosen; e.computedMiles = tcComputeMiles(e); touch(e); save(); } }).catch(function () {}); } catch (ex) {}
  return { ok: true, entry: e };
}
if (typeof window !== "undefined") window.tcClockOutWith = tcClockOutWith;
window.tcFinishClockOut = function (id) {
  const e = tcoll().find(x => x.id === id); if (!e || e.clockOut) return;
  const hasVeh = tcEntryHasVehicle(e);
  let odoEnd = null;
  if (hasVeh) {
    odoEnd = parseFloat(val("tc_odo_end"));
    if (!(odoEnd >= 0)) { alert("Enter the ending odometer reading, or tap “use GPS estimate”."); return; }
    if (e.odoStart != null && odoEnd < e.odoStart) { alert("End reading can't be less than the start (" + e.odoStart + ")."); return; }
  }
  if (typeof closeModal === "function") closeModal();
  // delegate the close (finalize + log + save + out-location) to the shared core — byte-identical record
  tcClockOutWith(id, { odoEnd: hasVeh ? odoEnd : null });
  render();
};

/* ===== FEATURE: "Change job" — the active shift is really ONE continuous work session (same truck, same
   trip) that just needs re-attributing to a different job partway through. Change Job CLOSES the current
   segment exactly like a normal clock-out (same modal, same odometer/GPS math — tcClockOut/tcFinalizeSegment
   above, not duplicated) and then immediately OPENS a new segment on the picked job, carrying over the
   vehicle/trailer/rider-role (no need to re-pick — it's the same drive) and using the OLD segment's
   end-odometer as the NEW segment's start-odometer so mileage stays gap-free. If the old segment closed on a
   GPS estimate (no odometer) or had no vehicle at all, the new segment just starts the same way — no odometer
   required, per the rest of this file's "odometer never blocks" rule. ===== */
window.tcChangeJob = function (id) {
  const e = tcoll().find(x => x.id === id); if (!e || e.clockOut) return;
  const who = tcWho();
  // same job-picker construction as the clock-in form above (today's jobs first, then by date; "your jobs" first)
  const _td = (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10);
  const _onToday = j => (typeof jobOnDay === "function") ? jobOnDay(j, _td) : (j.date === _td);
  const jobs = (typeof actJ === "function" ? actJ() : []).filter(j => !j.done && j.id !== e.jobId).sort((a, b) => {
    const at = _onToday(a) ? 1 : 0, bt = _onToday(b) ? 1 : 0; if (at !== bt) return bt - at;
    return (b.date || "") < (a.date || "") ? -1 : 1;
  });
  if (!jobs.length) { alert("No other open jobs to switch to."); return; }
  const mine = jobs.filter(j => (j.crew || []).indexOf(who.userId) >= 0);
  const opt = j => { const wd = (typeof jobWorkDays === "function") ? jobWorkDays(j) : (j.date ? [j.date] : []); const multi = wd.length > 1 ? ` · ${wd.length}-day${_onToday(j) ? ", today" : ""}` : ""; return `<option value="${j.id}">${esc(j.title || "Job")}${j.date ? " · " + fmtDate(j.date) : ""}${multi}${j.customerId ? " · " + esc(custName(j.customerId)) : ""}</option>`; };
  modal("Change job", `
    <p class="muted" style="margin-bottom:8px">Ends your time on <b>${esc(tcJobTitle(e.jobId))}</b> right now and starts a new segment on the job you pick — same vehicle, trailer, and role carry over, no re-entry.</p>
    <label>Switch to</label>
    <select id="tc_changejob_sel">${mine.length ? `<optgroup label="Your jobs">${mine.map(opt).join("")}</optgroup><optgroup label="All open jobs">${jobs.filter(j => mine.indexOf(j) < 0).map(opt).join("")}</optgroup>` : jobs.map(opt).join("")}</select>
    <button class="btn acc" style="margin-top:14px;width:100%" onclick="tcChangeJobPicked('${id}')">Continue</button>`);
};
window.tcChangeJobPicked = function (id) {
  const newJobId = val("tc_changejob_sel"); if (!newJobId) { alert("Pick a job to switch to."); return; }
  // reuse the EXACT clock-out modal (odometer entry or the no-vehicle message) — its buttons now finish into
  // tcFinishChangeJob/tcChangeJobGps (below) instead of the plain clock-out handlers, because contJobId is set.
  tcClockOut(id, newJobId);
};
window.tcFinishChangeJob = function (id, newJobId) {
  const e = tcoll().find(x => x.id === id); if (!e || e.clockOut) return;
  const hasVeh = tcEntryHasVehicle(e);
  let odoEnd = null;
  if (hasVeh) {
    odoEnd = parseFloat(val("tc_odo_end"));
    if (!(odoEnd >= 0)) { alert("Enter the ending odometer reading, or tap “use GPS estimate”."); return; }
    if (e.odoStart != null && odoEnd < e.odoStart) { alert("End reading can't be less than the start (" + e.odoStart + ")."); return; }
  }
  if (typeof closeModal === "function") closeModal();
  tcFinalizeSegment(e, odoEnd);
  touch(e); tcPingStop();
  if (typeof logChange === "function") logChange("update", "timeclock", e.id, "Changed job — closed " + tcFmtDur(e.clockOut - e.clockIn) + " · " + tcMiles(e) + " mi · " + tcJobTitle(e.jobId));
  tcOpenNewSegmentFrom(e, newJobId);
  try { tcGetPos().then(function (loc) { const chosen = tcFinalizeOutLoc(e, loc); if (chosen && chosen !== e.outLoc) { e.outLoc = chosen; e.computedMiles = tcComputeMiles(e); touch(e); save(); } }).catch(function () {}); } catch (ex) {}
};
window.tcChangeJobGps = function (id, newJobId) {
  const e = tcoll().find(x => x.id === id); if (!e || e.clockOut) return;
  if (typeof closeModal === "function") closeModal();
  e.clockOut = now(); e.odoEnd = null;
  e.computedMiles = tcComputeMiles(e);
  e.miles = tcRound(e.computedMiles); e.milesSource = "gps"; e.milesConfirmed = false;
  touch(e); tcPingStop();
  if (typeof logChange === "function") logChange("update", "timeclock", e.id, "Changed job (GPS) — closed " + tcFmtDur(e.clockOut - e.clockIn) + " · " + tcMiles(e) + " mi est · " + tcJobTitle(e.jobId));
  tcOpenNewSegmentFrom(e, newJobId);
  try { tcGetPos().then(function (loc) { const chosen = tcFinalizeOutLoc(e, loc); if (chosen && chosen !== e.outLoc) { e.outLoc = chosen; e.computedMiles = tcComputeMiles(e); if (e.milesSource === "gps" && !e.milesConfirmed) e.miles = tcRound(e.computedMiles); touch(e); save(); } }).catch(function () {}); } catch (ex) {}
};
/* open the new segment: carries vehicle/trailer/rider-role continuity from the just-closed old segment, and
   anchors the new start-odometer to the old end-odometer (a real reading only — a GPS-estimate close or a
   no-vehicle shift simply has no odometer to carry, and the new segment starts the same honest way). */
function tcOpenNewSegmentFrom(oldEntry, newJobId) {
  const n = {
    id: uid(), jobId: newJobId, userId: oldEntry.userId, userName: oldEntry.userName,
    clockIn: now(), clockOut: null,
    inLoc: oldEntry.outLoc || null, outLoc: null, pings: [], stops: [],
    computedMiles: 0, miles: null, milesConfirmed: false, milesSource: null,
    odoStart: (oldEntry.milesSource === "odometer" && oldEntry.odoEnd != null) ? oldEntry.odoEnd : null, odoEnd: null,
    riderRole: oldEntry.riderRole, trailerId: oldEntry.trailerId || null, rodeWith: oldEntry.rodeWith || null,
    vehicleId: oldEntry.vehicleId || null, vehicle: oldEntry.vehicle || "", vehicleOwnerId: oldEntry.vehicleOwnerId || null, invVehicleId: oldEntry.invVehicleId || null,
    rate: oldEntry.rate || TC_RATE, changedFromEntryId: oldEntry.id, updatedAt: now()
  };
  tcoll().push(n);
  if (typeof logChange === "function") logChange("create", "timeclock", n.id, "Changed job — now on " + tcJobTitle(newJobId) + " · " + (oldEntry.userName || "Crew"));
  save(); tcPingStart(); render();
  // best-effort fresh location for the new segment, non-blocking (mirrors the clock-in / clock-out pattern)
  try { tcGetPos().then(function (loc) { if (loc && !n.inLoc) { n.inLoc = loc; touch(n); save(); } }).catch(function () {}); } catch (ex) {}
}

/* ===== vehicle ownership — the mileage reimburses whoever OWNS the vehicle, not the driver.
   Each person's vehicle is "<name>'s vehicle" (one personal vehicle each until there's a company truck). ===== */
function tcVehMembers() { return (typeof schedMembers === "function") ? schedMembers() : []; }
function tcVehOwnerName(id) { const u = tcVehMembers().find(x => x.id === id); return u ? u.username : "Crew"; }
/* display name of whoever a passenger rode with (record-only) */
function tcRodeWithName(id) { const u = tcVehMembers().find(x => x.id === id); return u ? u.username : "a teammate"; }
/* trailer display string from a trailerId, or "" */
function tcTrailerLabel(id) { const v = id ? tcTruckById(id) : null; return v ? tcTruckLabel(v) : ""; }
/* one-line role/vehicle/trailer summary for a shift card (driver shows the truck + optional trailer; passenger
   shows who they rode with + zero miles; none shows on-site). */
function tcShiftVehLine(e) {
  if (!e) return "";
  const trailer = tcTrailerLabel(e.trailerId);
  // white-space:normal — this line (vehicle + odometer reading) can run long; the global .sub is
  // single-line-ellipsis (right for tight list rows) but wrongly clipped it here on a narrow phone.
  if (e.riderRole === "passenger") return `<div class="sub" style="white-space:normal">🧍 Passenger${e.rodeWith ? " · rode with " + esc(tcRodeWithName(e.rodeWith)) : ""} · no mileage</div>`;
  if (e.riderRole === "none" || (!e.vehicle && e.riderRole !== "driver")) return `<div class="sub" style="white-space:normal">🚶 No vehicle · no mileage</div>`;
  // driver
  return `<div class="sub" style="white-space:normal">🚗 Driver · 🚚 ${esc(e.vehicle || "Vehicle")}${e.odoStart != null ? " · odo start " + e.odoStart : ""}${trailer ? " · 🚛 " + esc(trailer) : ""}</div>`;
}

/* ===== managed per-org truck list (registry[org].vehicles — owner/admin-managed in Admin) =====
   A unified vehicle picker offers, in order: 🚶 No vehicle · the org's managed trucks (active) · each member's
   personal vehicle ("<name>'s vehicle"). The chosen option encodes WHICH bucket via the option value:
     ""              → No vehicle (no odometer)
     "truck:<id>"    → a managed company truck (registry vehicle)
     "owner:<uid>"   → a member's personal vehicle (legacy model: reimburses that owner)
   On clock-in we resolve this to e.vehicleId (truck id or null) + e.vehicleOwnerId + e.vehicle (display string). */
function tcOrgVehicles() { const r = (S.registry || []).find(x => x && x.id === S.biz); return (r && Array.isArray(r.vehicles)) ? r.vehicles.filter(v => v && !v.deleted) : []; }
/* a registry entry is a TRAILER when kind==="trailer"; everything else (incl. legacy entries with no kind) is a
   driveable VEHICLE that carries an odometer + reimbursement owner. */
function tcIsTrailer(v) { return !!(v && v.kind === "trailer"); }
function tcActiveTrucks() { return tcOrgVehicles().filter(v => v.active !== false && !tcIsTrailer(v)); }   // driveable trucks only (kind=vehicle)
function tcActiveTrailers() { return tcOrgVehicles().filter(v => v.active !== false && tcIsTrailer(v)); }   // attached trailers (kind=trailer, no odometer)
function tcTruckById(id) { return tcOrgVehicles().find(v => v && v.id === id) || null; }
function tcTrailerById(id) { return tcActiveTrailers().find(v => v && v.id === id) || null; }
function tcTruckLabel(v) { return v ? ((v.name || "Truck") + (v.plate ? " · " + v.plate : "")) : "Truck"; }
/* ===== INVENTORY vehicles (vehicle unification) — the clock-in picker now ALSO draws pickable vehicles from
   the crew-writable `inventory` collection (js/31), so anyone can add a vehicle (personal or shared) and it
   flows straight into clock-in. A row counts ONLY when it's a real, pickable vehicle: cat "vehicle" + clockIn
   flag + active + not deleted — the aspirational INV_SEED rows (inv-pickup-truck…) lack clockIn and never
   pollute the picker. Encoded as "inv:<itemId>". personal (item.ownerId set) → reimburses the OWNER; a shared
   company-inventory vehicle (no ownerId) → reimburses the driver, exactly like a registry truck. ===== */
function tcInvVehicles() { return (typeof actInv === "function" ? actInv() : []).filter(i => i && i.cat === "vehicle" && i.clockIn && i.active !== false && !i.deleted); }
function tcInvVehById(id) { return (typeof actInv === "function" ? actInv() : []).find(i => i && i.id === id && i.cat === "vehicle") || null; }
function tcInvVehLabel(i) { return i ? ((i.name || "Vehicle") + (i.plate ? " · " + i.plate : "")) : "Vehicle"; }
/* this member's own personal inventory clock-in vehicle (first, if any) — used to prefer it as a default and
   to replace the legacy synthesized "<name>'s vehicle" option once the member has a real inventory vehicle */
function tcMemberInvVeh(uid) { return tcInvVehicles().find(i => i.ownerId === uid) || null; }
/* the union of everything pickable at clock-in: registry active trucks + inventory clock-in vehicles. Excludes
   aspirational inventory rows (no clockIn flag). Used by callers/tests to reason about "what can be driven". */
function tcClockableVehicles() { return tcActiveTrucks().concat(tcInvVehicles()); }
/* the ordered driver-pickable option list (excludes the head "No vehicle") shared by every picker:
     Company trucks   → registry active trucks (truck:<id>) + shared inventory vehicles with no owner (inv:<id>)
     Personal vehicles→ each active member's inventory personal vehicle (inv:<id>), else a legacy synthesized
                        fallback (owner:<uid>) so the picker is never empty (zero clock-in regression).
   PHASE 2: once a member has a real inventory personal vehicle the synthesized option is dropped for them;
   tcResolveVehicle still honors historical owner:<uid> entries. */
function tcVehicleOptionList() {
  const opts = [];
  tcActiveTrucks().forEach(v => opts.push({ group: "Company trucks", value: "truck:" + v.id, label: "🚚 " + tcTruckLabel(v) }));
  const inv = tcInvVehicles();
  inv.filter(i => !i.ownerId).forEach(i => opts.push({ group: "Company trucks", value: "inv:" + i.id, label: "🚚 " + tcInvVehLabel(i) }));
  const members = tcVehMembers(), memberIds = {}; members.forEach(u => { memberIds[u.id] = 1; });
  const ownersShown = {};
  inv.filter(i => i.ownerId && memberIds[i.ownerId]).forEach(i => { ownersShown[i.ownerId] = 1; opts.push({ group: "Personal vehicles", value: "inv:" + i.id, label: "🚗 " + tcInvVehLabel(i) }); });
  members.forEach(u => { if (!ownersShown[u.id]) opts.push({ group: "Personal vehicles", value: "owner:" + u.id, label: "🚗 " + u.username + "'s vehicle" }); });
  return opts;
}
/* the value (per the encoding above) that should be SELECTED by default for this driver: their account
   defaultVehicleId if set + still active, else their last-used vehicle (truck or personal), else No vehicle. */
function tcDefaultVehVal(driverId) {
  if (_tcPreselectInvVeh && tcInvVehById(_tcPreselectInvVeh)) return "inv:" + _tcPreselectInvVeh;   // just-added-from-clock-in vehicle → select it on this render
  const me = (typeof curUser === "function") ? curUser() : null;
  if (me && me.id === driverId && me.defaultVehicleId) {
    if (me.defaultVehicleId === "__none__") return "";
    const t = tcTruckById(me.defaultVehicleId); if (t && t.active !== false) return "truck:" + t.id;
  }
  const last = (tcoll() || []).filter(e => e.userId === driverId && !e.deleted).sort((a, b) => (b.clockIn || 0) - (a.clockIn || 0))[0];
  if (last) {
    if (last.vehicleId && tcTruckById(last.vehicleId) && (tcTruckById(last.vehicleId).active !== false)) return "truck:" + last.vehicleId;
    if (last.invVehicleId && tcInvVehById(last.invVehicleId)) return "inv:" + last.invVehicleId;   // prefer the last shift's inventory vehicle
    if (last.vehicleId === null && last.vehicleOwnerId) { const iv = tcMemberInvVeh(last.vehicleOwnerId); return iv ? "inv:" + iv.id : "owner:" + last.vehicleOwnerId; }   // map a legacy personal-vehicle default onto that owner's inventory vehicle when one now exists
    if (!last.vehicle && last.vehicleId == null) return "";   // last shift had no vehicle
    if (last.vehicleOwnerId) { const iv = tcMemberInvVeh(last.vehicleOwnerId); return iv ? "inv:" + iv.id : "owner:" + last.vehicleOwnerId; }
  }
  return "";   // default to No vehicle (one tap away to pick a truck)
}
/* the unified picker <select> options (head "No vehicle" + the shared option list). selVal = pre-select. */
function tcVehicleOptions(selVal, driverId) {
  let h = `<option value="" ${selVal === "" ? "selected" : ""}>🚶 No vehicle</option>`;
  let cur = null;
  tcVehicleOptionList().forEach(o => {
    if (o.group !== cur) { if (cur !== null) h += "</optgroup>"; h += `<optgroup label="${esc(o.group)}">`; cur = o.group; }
    h += `<option value="${esc(o.value)}" ${selVal === o.value ? "selected" : ""}>${esc(o.label)}</option>`;
  });
  if (cur !== null) h += "</optgroup>";
  return h;
}
/* resolve an encoded picker value → {vehicleId, vehicleOwnerId, vehicle, invVehicleId} written onto the entry.
   The mileage math NEVER keys off invVehicleId — it stays keyed on vehicleOwnerId (finMileage) + the odometer,
   so a personal inventory vehicle reimburses its OWNER and a shared/company one reimburses the driver, byte
   identical to before. invVehicleId is a purely additive provenance link back to the inventory record. */
function tcResolveVehicle(encVal, driverId) {
  if (!encVal) return { vehicleId: null, vehicleOwnerId: null, vehicle: "", invVehicleId: null };           // No vehicle
  if (encVal.indexOf("truck:") === 0) { const v = tcTruckById(encVal.slice(6)); return { vehicleId: v ? v.id : null, vehicleOwnerId: null, vehicle: v ? tcTruckLabel(v) : "Truck", invVehicleId: null }; }
  if (encVal.indexOf("inv:") === 0) { const i = tcInvVehById(encVal.slice(4)); if (i) return { vehicleId: null, vehicleOwnerId: i.ownerId || null, vehicle: i.name || tcInvVehLabel(i), invVehicleId: i.id }; return { vehicleId: null, vehicleOwnerId: null, vehicle: "", invVehicleId: null }; }
  if (encVal.indexOf("owner:") === 0) { const oid = encVal.slice(6); return { vehicleId: null, vehicleOwnerId: oid, vehicle: tcVehOwnerName(oid) + "'s vehicle", invVehicleId: null }; }
  return { vehicleId: null, vehicleOwnerId: null, vehicle: "", invVehicleId: null };
}
/* does the entry / picked value involve a vehicle (→ odometer is relevant)? Mileage only matters on the DRIVER
   path: a passenger / no-vehicle shift carries no vehicleId/owner, so this stays false → no odometer, no miles. */
function tcEntryHasVehicle(e) { return !!(e && e.riderRole === "driver" && (e.vehicleId || e.vehicleOwnerId || e.vehicle)); }

/* ===== RIDER ROLE (clock-in redesign) — at clock-in the person picks their ROLE for the trip so a shared
   truck's mileage is logged exactly ONCE (by the driver):
     🚗 driver    → pick a VEHICLE (odometer/GPS-verify) + an OPTIONAL trailer; this person logs the truck's miles
     🧍 passenger → rode with someone → NO vehicle mileage (so the truck isn't double-counted); optionally name the driver
     🚶 none      → on-site only / didn't travel by truck → no vehicle, no mileage
   The role drives which detail fields show. Default = their last shift's role (else driver if they have a default
   vehicle, else none). ===== */
function tcDefaultRole(driverId) {
  if (_tcPreselectInvVeh && tcInvVehById(_tcPreselectInvVeh)) return "driver";   // just added a vehicle from clock-in → land on the driver role with it selected
  const last = (tcoll() || []).filter(e => e.userId === driverId && !e.deleted).sort((a, b) => (b.clockIn || 0) - (a.clockIn || 0))[0];
  if (last && (last.riderRole === "driver" || last.riderRole === "passenger" || last.riderRole === "none")) return last.riderRole;
  return tcDefaultVehVal(driverId) ? "driver" : "none";   // never driven before → default to whatever their vehicle default implies
}
/* the 3-way role chooser (segmented buttons → a hidden <select> #tc_role that the rest of the form reads) */
function tcRolePicker(sel) {
  const opt = (val, ico, lab) => `<button type="button" class="btn ${sel === val ? "acc" : "ghost"} sm" id="tc_roleb_${val}" onclick="tcRoleChanged('${val}')" style="flex:1;min-width:96px">${ico} ${lab}</button>`;
  return `<input type="hidden" id="tc_role" value="${esc(sel)}">
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px">
      ${opt("driver", "🚗", "Driver")}${opt("passenger", "🧍", "Passenger")}${opt("none", "🚶", "No vehicle")}
    </div>`;
}
/* INFORMATIONAL route-estimate box (Item 8) — once a job is known, show its offline route estimate inside the
   driver's vehicle box. This is NEVER the billed number: the odometer/GPS timeclock miles stay the record; this
   is a cross-check so a driver sees roughly how far the run is. Always renders the #tc_est_box wrapper so
   tcJobPicked() can swap it in place when the job <select> changes. */
function tcJobEstBox(jobId) {
  const j = jobId ? tcJob(jobId) : null;
  if (!j || !(j.estRouteMiles > 0)) return `<div id="tc_est_box"></div>`;
  return `<div id="tc_est_box"><div class="sub" style="margin-top:6px;white-space:normal;color:var(--brand-text)">🧭 Est. route ~<b>${j.estRouteMiles} mi</b> <span class="muted">· informational — the odometer is the billed number</span></div></div>`;
}
/* job <select> changed on the clock-in form → refresh the route-estimate box for the newly-picked job (no full
   re-render, so the role/vehicle/odometer the user already set survive). */
window.tcJobPicked = function () {
  const box = document.getElementById("tc_est_box"); if (!box) return;
  box.outerHTML = tcJobEstBox((typeof val === "function") ? val("tc_job") : "");
};
/* the role-specific detail block (re-rendered into #tc_role_detail when the role changes). jobId (optional) drives
   the informational route-estimate box in the driver branch. */
function tcRoleDetail(role, defVehVal, driverId, jobId) {
  let h = `<div id="tc_role_detail">`;
  if (role === "driver") {
    const trailers = tcActiveTrailers(), defTrailer = tcDefaultTrailerVal(driverId);
    const vehOpts = tcDriverVehicleOptions(defVehVal, driverId);
    if (!vehOpts) {
      // BUG FIX (vehicleId not attaching): the org genuinely has no company trucks AND no crew members to
      // offer as a personal vehicle — an empty <select> used to render silently, its .value read as "", and
      // clock-in saved riderRole:"driver" with NO vehicle at all. Say so instead of pretending a vehicle was
      // picked; tcClockIn() also blocks this combination server-side-of-the-form as a second guard.
      h += `<div class="card" style="border-left:4px solid var(--danger);background:var(--soft);margin-top:10px"><div class="sub" style="white-space:normal">⚠ No vehicles are set up for this crew yet — <a href="#" onclick="tcAddMyVehicle(true);return false" style="color:var(--brand-text);font-weight:700">＋ Add your vehicle</a> (or ask the owner to add a company truck in Admin), or pick 🧍 Passenger / 🚶 No vehicle instead.</div></div>`;
    } else {
      // the odometer field is ALWAYS shown for the driver role: tcDriverVehicleOptions never leaves the
      // <select> blank (it force-selects the first option when there's no default), so a vehicle is always
      // chosen the instant this block renders — hiding the field on an unset default (the old `_hasVeh`
      // check) meant a first-time driver's odometer input was invisible even though a vehicle WAS selected.
      h += `<label style="margin-top:10px">Vehicle you're driving${(typeof curUser === "function" && curUser()) ? ` <span class="sub">· <a href="#" onclick="tcSetDefaultVehicle();return false" style="color:var(--brand-text);font-weight:700">set default</a></span>` : ""}</label>
        <select id="tc_vehicle">${vehOpts}</select>
        <div class="sub" style="margin-top:4px;white-space:normal">Driving your own? <a href="#" onclick="tcAddMyVehicle(true);return false" style="color:var(--brand-text);font-weight:700">＋ Add your vehicle</a></div>
        <div id="tc_odo_wrap">
          <label>Odometer — start <span class="sub">(optional — you can add it later)</span></label>
          <input id="tc_odo_start" type="number" inputmode="decimal" placeholder="miles showing now">
        </div>
        ${tcJobEstBox(jobId)}`;
    }
    if (trailers.length) h += `<label style="margin-top:10px">🚛 Trailer <span class="sub">· optional · towed in addition (no odometer)</span></label>
      <select id="tc_trailer">${tcTrailerOptions(defTrailer)}</select>`;
  } else if (role === "passenger") {
    h += `<label style="margin-top:10px">Who drove? <span class="sub">· optional, for the record — they log the truck's miles, you don't</span></label>
      <select id="tc_rodewith">${tcDriverWhoOptions(null, driverId)}</select>
      <div class="sub" style="margin-top:6px;white-space:normal">🧍 You rode with someone — your shift logs <b>your time only, zero miles</b>, so the truck isn't counted twice.</div>`;
  } else {
    h += `<div class="sub" style="margin-top:8px;white-space:normal">🚶 On-site only / no truck travel — your shift logs <b>your time, no mileage</b>.</div>`;
  }
  return h + `</div>`;
}
/* is there ANYTHING a driver could pick — a company truck or a crew member's personal vehicle? Used to tell
   "nothing is selected because nothing exists" apart from "nothing is selected but something should be". */
function tcHasVehicleOptions() { return tcVehicleOptionList().length > 0; }
/* the DRIVER vehicle dropdown — kind=vehicle trucks + personal vehicles (NO trailers, NO "No vehicle" since the
   role IS the driver). Reuses the same encoding as tcVehicleOptions but without the "No vehicle" head option.
   BUG FIX (vehicleId not attaching): this used to build the <option> list as one big HTML string and detect
   "did anything get selected" by string-searching the result for the literal substring "selected" — fragile
   (a truck name/plate or username containing that word would false-positive) and, worse, its "select the
   first option when nothing matched" fallback had NOTHING to select when there are truly zero options (no
   trucks, no crew members), silently returning a <select> with no <option>s at all — .value then reads ""
   and the driver's vehicle vanishes. Now built from a real options array with an explicit selected INDEX
   (never string-sniffed), and callers (tcRoleDetail / tcClockIn) get told plainly via "" when the org has
   nothing to offer, instead of the code pretending a vehicle was picked. */
function tcDriverVehicleOptions(selVal, driverId) {
  const opts = tcVehicleOptionList();   // registry trucks + inventory clock-in vehicles + per-member personal (inv or synthesized fallback)
  if (!opts.length) return "";   // nothing at all to offer — caller must handle this, not render a dead <select>
  let idx = opts.findIndex(o => o.value === selVal);
  if (idx < 0) idx = 0;   // no match (or no default set) — the driver role ALWAYS has SOME vehicle chosen
  let h = "", curGroup = null;
  opts.forEach((o, i) => {
    if (o.group !== curGroup) { if (curGroup !== null) h += "</optgroup>"; h += `<optgroup label="${o.group}">`; curGroup = o.group; }
    h += `<option value="${esc(o.value)}" ${i === idx ? "selected" : ""}>${esc(o.label)}</option>`;
  });
  return h + "</optgroup>";
}
/* trailer dropdown (kind=trailer only; "None" head option since a trailer is optional) */
function tcTrailerOptions(selVal) {
  let h = `<option value="" ${selVal === "" ? "selected" : ""}>— No trailer —</option>`;
  return h + tcActiveTrailers().map(v => `<option value="${esc(v.id)}" ${selVal === v.id ? "selected" : ""}>🚛 ${esc(tcTruckLabel(v))}</option>`).join("");
}
/* "who drove" dropdown for a passenger — crew members (record-only). Excludes the passenger themself. */
function tcDriverWhoOptions(selVal, exceptId) {
  let h = `<option value="" ${!selVal ? "selected" : ""}>— Not sure / skip —</option>`;
  return h + tcVehMembers().filter(u => u.id !== exceptId).map(u => `<option value="${esc(u.id)}" ${selVal === u.id ? "selected" : ""}>🚗 ${esc(u.username)}</option>`).join("");
}
/* this driver's default trailer encoded value (account.defaultTrailerId if still active) */
function tcDefaultTrailerVal(driverId) {
  const me = (typeof curUser === "function") ? curUser() : null;
  if (me && me.id === driverId && me.defaultTrailerId && tcTrailerById(me.defaultTrailerId)) return me.defaultTrailerId;
  return "";
}
/* role-button tap → swap the detail block + the segmented highlight (no full re-render, so a typed odometer/job survives) */
window.tcRoleChanged = function (role) {
  const hid = document.getElementById("tc_role"); if (hid) hid.value = role;
  const who = tcWho();
  ["driver", "passenger", "none"].forEach(r => { const b = document.getElementById("tc_roleb_" + r); if (b) { b.classList.toggle("acc", r === role); b.classList.toggle("ghost", r !== role); } });
  const wrap = document.getElementById("tc_role_detail");
  if (wrap) wrap.outerHTML = tcRoleDetail(role, role === "driver" ? tcDefaultVehVal(who.userId) : "", who.userId, (typeof val === "function") ? val("tc_job") : "");
};

/* ===== per-user DEFAULT vehicle (account.defaultVehicleId) — set from the clock tab ===== */
window.tcSetDefaultVehicle = function () {
  const me = (typeof curUser === "function") ? curUser() : null; if (!me) { alert("Sign in to set a default vehicle."); return; }
  const cur = me.defaultVehicleId || "", curT = me.defaultTrailerId || "";
  const trucks = tcActiveTrucks(), trailers = tcActiveTrailers();
  modal("Your default vehicle", `
    <p class="muted" style="margin-bottom:8px">Pre-selected every time you clock in as the driver. You can still change it per shift.</p>
    <select id="tc_defveh">
      <option value="__none__" ${cur === "__none__" ? "selected" : ""}>🚶 No vehicle</option>
      ${trucks.map(v => `<option value="${esc(v.id)}" ${cur === v.id ? "selected" : ""}>🚚 ${esc(tcTruckLabel(v))}</option>`).join("")}
    </select>
    ${trailers.length ? `<label style="margin-top:10px">Default trailer <span class="sub">· optional</span></label>
    <select id="tc_deftrl">
      <option value="" ${!curT ? "selected" : ""}>— No trailer —</option>
      ${trailers.map(v => `<option value="${esc(v.id)}" ${curT === v.id ? "selected" : ""}>🚛 ${esc(tcTruckLabel(v))}</option>`).join("")}
    </select>` : ""}
    <p class="muted" style="margin-top:8px;font-size:12px">Personal vehicles default to your last-used; only company trucks (and “No vehicle”) can be pinned as your default.</p>
    <button class="btn acc" style="margin-top:14px;width:100%" onclick="tcSaveDefaultVehicle()">Save default</button>`);
};
window.tcSaveDefaultVehicle = function () {
  const me = (typeof curUser === "function") ? curUser() : null; if (!me) return;
  const v = val("tc_defveh");
  me.defaultVehicleId = v || null;
  if (document.getElementById("tc_deftrl")) me.defaultTrailerId = val("tc_deftrl") || null;
  touch(me); save();
  if (typeof scheduleAutoPush === "function") scheduleAutoPush();
  if (typeof closeModal === "function") closeModal(); render();
};

/* ===== "＋ Add my vehicle (for clock-in)" — the crew-writable path (vehicle unification). ANY member creates
   their OWN pickable, personal vehicle as a normal INVENTORY write: the `inventory` collection has no server
   write-authz (unlike registry.vehicles, which is owner-only), so Chase can add his car and pick it in one
   flow. Reachable from the Inventory screen AND inline at clock-in when a driver has no vehicle. The vehicle is
   personal (ownerId = the member) so mileage reimburses THEM — same semantics as the old synthesized personal
   vehicle, now a first-class, editable record. `afterClockIn` pre-selects it on the clock-in form so they can
   clock in immediately. ===== */
let _tcPreselectInvVeh = null;   // set when adding from clock-in → the next clock-in render selects this inv vehicle
window.tcAddMyVehicle = function (afterClockIn) {
  const me = (typeof curUser === "function") ? curUser() : null;
  const who = tcWho();
  const defName = ((me ? me.username : who.name) || "My") + "'s vehicle";
  modal("Add your vehicle", `
    <p class="muted" style="margin-bottom:8px">Adds your personal vehicle to Inventory so you can pick it when you clock in as the driver. Mileage is reimbursed to <b>you</b>.</p>
    <label>Vehicle</label>
    <input id="tc_mv_name" value="${esc(defName)}" placeholder="e.g. Chase's Silverado">
    <label style="margin-top:10px">Plate <span class="sub">· optional</span></label>
    <input id="tc_mv_plate" placeholder="e.g. ABC-1234">
    <button class="btn acc" style="margin-top:14px;width:100%" onclick="tcSaveMyVehicle(${afterClockIn ? "true" : "false"})">Save vehicle</button>`);
  setTimeout(function () { const el = document.getElementById("tc_mv_name"); if (el) { el.focus(); el.select(); } }, 30);
};
window.tcSaveMyVehicle = function (afterClockIn) {
  const me = (typeof curUser === "function") ? curUser() : null;
  const who = tcWho();
  const ownerId = me ? me.id : who.userId;
  const name = (val("tc_mv_name") || "").trim(); if (!name) { alert("Give your vehicle a name."); return; }
  const plate = (val("tc_mv_plate") || "").trim();
  if (typeof submitGuard === "function" && !submitGuard("tcSaveMyVehicle:" + ownerId + ":" + name)) return;   // rapid-tap dupe guard
  const d = D(); if (!d.inventory) d.inventory = [];
  const item = { id: "inv-veh-" + uid(), name: name, cat: "vehicle", personal: true, ownerId: ownerId, clockIn: true, active: true, have: true, qty: "", plate: plate, tags: [], section: "Vehicle & transport", updatedAt: now() };
  d.inventory.push(item);
  if (typeof logChange === "function") logChange("create", "inventory", item.id, "Added personal vehicle — " + name);
  save();
  if (typeof scheduleAutoPush === "function") scheduleAutoPush();
  if (typeof closeModal === "function") closeModal();
  _tcPreselectInvVeh = afterClockIn ? item.id : null;
  render();
  if (afterClockIn) {
    // switch to the driver role + select the just-added vehicle so they can clock in on it right away
    setTimeout(function () {
      try {
        if (typeof tcRoleChanged === "function") tcRoleChanged("driver");
        const sel = document.getElementById("tc_vehicle"); if (sel) sel.value = "inv:" + item.id;
      } catch (e) {}
      _tcPreselectInvVeh = null;
    }, 30);
  }
};

/* ===== multi-stop material pickups (stops[] on the entry) — runs hit several places (quarry, Lowe's,
   Home Depot, Ace). Each stop is GPS-stamped at the moment it's added (tcGetPos) so the path + audit are
   real; quick-pick chips come from the org's saved `places`. Stops are descriptive (they feed the route +
   audit trail); the odometer delta remains the number of record. ===== */
function tcStops(e) { return Array.isArray(e && e.stops) ? e.stops.filter(s => s && !s.deleted) : []; }
window.tcAddStop = async function (id, presetName) {
  const e = tcoll().find(x => x.id === id); if (!e) return;
  let name = presetName;
  if (!name) { name = prompt("Stop / pickup location (e.g. Barnes quarry, Lowe's, Home Depot):"); if (name == null) return; name = name.trim(); }
  if (!name) return;
  if (!Array.isArray(e.stops)) e.stops = [];
  const loc = await tcGetPos();   // GPS-stamp the stop as it's added
  e.stops.push({ id: uid(), name: name, loc: loc, ts: now() });
  touch(e);
  if (typeof logChange === "function") logChange("update", "timeclock", e.id, "Added stop “" + name + "” — " + tcJobTitle(e.jobId));
  save(); render();
};
window.tcDelStop = function (id, stopId) {
  const e = tcoll().find(x => x.id === id); if (!e || !Array.isArray(e.stops)) return;
  const s = e.stops.find(x => x && x.id === stopId); if (!s) return;
  s.deleted = true; touch(e);
  if (typeof logChange === "function") logChange("update", "timeclock", e.id, "Removed a stop — " + tcJobTitle(e.jobId));
  save(); render();
};
/* quick-pick chips from saved places (Map pins) — distinct names, capped so the row stays mobile-friendly */
function tcStopQuickPicks(id) {
  const places = (D().places || []).filter(p => p && !p.deleted && p.name);
  const seen = {}, picks = [];
  places.forEach(p => { const n = p.name.trim(); if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; picks.push(n); } });
  if (!picks.length) return "";
  return `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">` +
    picks.slice(0, 8).map(n => `<button class="btn ghost sm" style="padding:4px 10px" onclick="tcAddStop('${id}',${JSON.stringify(n).replace(/"/g, "&quot;")})">📍 ${esc(n)}</button>`).join("") + `</div>`;
}
/* the stops block on the active-shift card (add + list + delete) */
function tcStopsBlock(id) {
  const e = tcoll().find(x => x.id === id); if (!e) return "";
  const stops = tcStops(e);
  let h = `<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px">
    <div class="row" style="align-items:center"><div class="grow"><b style="font-size:14px">🛒 Stops / pickups</b> <span class="sub">${stops.length || ""}</span></div>
      <button class="btn ghost sm" onclick="tcAddStop('${id}')">+ Add stop</button></div>`;
  if (stops.length) h += stops.map(s => `<div class="li" style="padding:6px 0"><div class="grow"><div class="nm" style="font-size:13px">📍 ${esc(s.name)}</div><div class="sub">${(function(){try{return new Date(s.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}catch(x){return ""}})()}${s.loc ? " · GPS-stamped" : " · no GPS"}</div></div><button class="btn ghost sm" style="padding:2px 8px" onclick="tcDelStop('${id}','${s.id}')">✕</button></div>`).join("");
  else h += `<div class="sub" style="margin-top:4px;white-space:normal">No stops yet. Add the quarry, Lowe's, Home Depot, Ace…</div>`;
  h += tcStopQuickPicks(id);
  return h + `</div>`;
}

/* ===== HEADER ODOMETER REMINDER (js/85 reads this) — is the current user clocked in with a vehicle but
   no starting odometer recorded yet? GPS-ACCRUED LATE-ENTRY ANCHORING: when they finally enter the reading,
   we anchor it to the GPS miles ALREADY accrued so the late entry stays auditable (the reading-as-entered +
   the miles already driven before it was logged). ===== */
function tcNeedsOdo(e) { return !!(e && !e.clockOut && tcEntryHasVehicle(e) && e.odoStart == null); }
window.tcReminderEntry = function () { const e = tcMyOpen(); return tcNeedsOdo(e) ? e : null; };
/* BUG FIX (odometer silently not saving): this used to be window.prompt()/alert(). Native JS dialogs are
   unreliable in an INSTALLED (standalone/home-screen) PWA — this app is explicitly installable (manifest +
   service worker, see js/34) — where prompt()/alert() can silently no-op or never surface the typed value
   back to the page. The old code then did `if (reading == null) return;` with ZERO feedback: the crew member
   types the reading, taps OK, and it vanishes with no error and no save. Using the app's own modal (already
   used for every other timeclock dialog: clock-out, entry edit, default vehicle) reads the value from a real
   DOM input we control, which works identically in the browser, the installed PWA, and headless tests. */
window.tcEnterStartOdo = function () {
  const e = tcMyOpen(); if (!tcNeedsOdo(e)) { render(); return; }
  const accrued = tcRound(tcComputeMiles(e));
  modal("Starting odometer", `
    <p class="muted" style="margin-bottom:8px">Odometer on <b>${esc(e.vehicle || "your vehicle")}</b> — enter the miles showing NOW.${accrued > 0.3 ? " You've already driven ~" + accrued + " mi since clocking in — that's anchored so this late entry stays accurate." : ""}</p>
    <label>Odometer reading</label>
    <input id="tc_late_odo" type="number" inputmode="decimal" placeholder="miles showing now">
    <div id="tc_late_odo_err" class="sub" style="white-space:normal;color:var(--danger);display:none;margin-top:6px"></div>
    <button class="btn acc" style="margin-top:14px" onclick="tcSaveLateOdo('${e.id}')">Save odometer</button>`);
  setTimeout(function () { const el = document.getElementById("tc_late_odo"); if (el) el.focus(); }, 30);
};
/* PROGRAMMATIC LATE-START-ODOMETER CORE (shared by the DOM handler AND Cap-Today). Anchors a starting odometer
   typed mid-shift: recompute accrued GPS miles FRESH, back-date odoStart so the odometer-delta still captures the
   whole shift, stamp the audit fields, touch + logChange + save. Returns {ok:false, error:"nan"} on a bad number,
   {ok:false, error:"not-found"} on a missing entry, else {ok:true, entry}. Never render()s. Byte-identical result
   to the pre-refactor tcSaveLateOdo. */
function tcSetStartOdo(entryId, miles) {
  const e = tcoll().find(x => x.id === entryId); if (!e) return { ok: false, error: "not-found" };
  const o = parseFloat(miles);
  if (!(o >= 0)) return { ok: false, error: "nan" };
  // recompute accrued FRESH at save time (not the value shown when the modal opened) — a ping could have
  // landed while the modal was open, and the anchor needs to reflect miles driven up to THIS moment.
  const accrued = tcRound(tcComputeMiles(e));
  // ANCHOR the late entry: the reading is "now", but `accrued` miles were already driven since clock-in. We
  // back-date the START so odometer-delta still captures the whole shift's driving. Audit fields keep the raw.
  e.odoStart = Math.max(0, o - accrued);
  e.odoStartEnteredAt = now(); e.odoStartReading = o; e.odoStartAccruedAtEntry = accrued;   // auditable provenance
  touch(e);
  if (typeof logChange === "function") logChange("update", "timeclock", e.id, "Entered start odometer " + o + (accrued > 0.3 ? " (anchored −" + accrued + " mi already driven)" : "") + " — " + tcJobTitle(e.jobId));
  save();
  return { ok: true, entry: e };
}
if (typeof window !== "undefined") window.tcSetStartOdo = tcSetStartOdo;
window.tcSaveLateOdo = function (id) {
  const o = parseFloat(val("tc_late_odo"));
  const r = tcSetStartOdo(id, o);
  if (!r.ok) {
    if (r.error === "nan") {
      const errEl = document.getElementById("tc_late_odo_err");
      if (errEl) { errEl.textContent = "Enter a number for the odometer."; errEl.style.display = ""; }
    }
    return;
  }
  if (typeof closeModal === "function") closeModal(); render();
};

/* ===== owner: edit / confirm an entry's mileage + vehicle ===== */
window.tcOpenEntry = function (id) {
  if (typeof isOwner === "function" && !isOwner()) { alert("Only the owner can adjust logged time + mileage."); return; }
  const e = tcoll().find(x => x.id === id); if (!e) return;
  const v = tcVerify(e), odoM = tcOdoMiles(e), stops = tcStops(e);
  const curVal = e.vehicleId ? ("truck:" + e.vehicleId) : (e.invVehicleId && tcInvVehById(e.invVehicleId) ? ("inv:" + e.invVehicleId) : (e.vehicleOwnerId ? ("owner:" + e.vehicleOwnerId) : ""));
  let flagHtml = "";
  if (e.milesFlag === "odo-high" || (v && v.kind === "odo-high")) flagHtml = `<div class="card" style="border-left:4px solid var(--danger);background:var(--soft)"><div class="sub" style="white-space:normal">⚠ Odometer (${odoM} mi) reads <b>${(v||{}).deltaPct||""}% higher</b> than the GPS path (${(v||{}).gps||tcRound(e.computedMiles)} mi). Odometer is still the number of record — verify it's right.</div></div>`;
  else if (e.milesFlag === "odo-low" || (v && v.kind === "odo-low")) flagHtml = `<div class="card" style="border-left:4px solid var(--danger);background:var(--soft)"><div class="sub" style="white-space:normal">⚠ Odometer (${odoM} mi) is <b>lower than the GPS-traced distance</b> (${(v||{}).gps||tcRound(e.computedMiles)} mi) — that's not possible. Check the readings.</div></div>`;
  else if (v && !v.flag && odoM != null) flagHtml = `<div class="sub" style="margin-bottom:8px;color:var(--ok,#1a9a5a)">✓ Odometer ${odoM} mi matches the GPS path (${v.gps} mi) within tolerance.</div>`;
  modal("Time entry — " + esc(tcJobTitle(e.jobId)), `
    <div class="card" style="padding:10px"><div class="nm" style="font-size:15px">${esc(e.userName || "Crew")} ${tcSourceBadge(e)}</div>
      <div class="sub">${fmtDate(new Date(e.clockIn).toISOString().slice(0,10))} · ${tcFmtDur((e.clockOut || now()) - e.clockIn)} worked${e.clockOut ? "" : " · still open"}</div>
      ${odoM != null ? `<div class="sub">Odometer: <b>${e.odoStart}</b> → <b>${e.odoEnd}</b> = <b>${odoM} mi</b>${e.odoStartEnteredAt ? " (late-entered, GPS-anchored)" : ""}</div>` : ""}
      <div class="sub">GPS estimate: <b>${tcRound(e.computedMiles)} mi</b> from ${e.inLoc ? "in" : "no in"}${e.outLoc ? " + out" : ""}${(e.pings||[]).length ? " + " + e.pings.length + " ping(s)" : ""}${stops.length ? " · " + stops.length + " stop(s)" : ""}</div></div>
    ${flagHtml}
    ${stops.length ? `<div class="sub" style="margin:4px 0 8px"><b>Stops:</b> ${stops.map(s => esc(s.name)).join(" · ")}</div>` : ""}
    <label>Miles (owner-confirmed)</label>
    <input id="tc_e_miles" type="number" step="0.1" value="${tcMiles(e)}">
    <div class="sub" style="margin-top:4px">Mileage cost @ $${TC_RATE}/mi updates on save. Editing miles by hand marks the source as <b>manual</b>. Odometer is the number of record; GPS is only a cross-check.</div>
    <label style="margin-top:10px">Vehicle</label>
    <select id="tc_e_veh">${tcVehicleOptions(curVal, e.userId)}</select>
    <label class="li" style="cursor:pointer;margin-top:10px"><input type="checkbox" id="tc_e_conf" style="width:20px;height:20px;flex:0 0 auto" ${e.milesConfirmed ? "checked" : ""}><div class="grow"><div class="nm" style="font-size:15px">Confirm mileage</div><div class="sub">Marks it owner-verified (no longer an estimate)</div></div></label>
    <button class="btn acc" style="margin-top:14px" onclick="tcSaveEntry('${e.id}')">Save</button>
    <button class="btn danger" style="margin-top:10px" onclick="tcDelEntry('${e.id}')">Delete entry</button>`);
};
window.tcSaveEntry = function (id) {
  const e = tcoll().find(x => x.id === id); if (!e) return;
  const prevMiles = tcMiles(e);
  const m = parseFloat(val("tc_e_miles")); e.miles = isNaN(m) ? tcRound(e.computedMiles) : Math.max(0, m);
  if (!isNaN(m) && Math.abs(m - prevMiles) > 0.05) e.milesSource = "manual";   // a hand-edit of the miles → provenance = manual
  const veh = tcResolveVehicle(val("tc_e_veh"), e.userId);
  e.vehicleId = veh.vehicleId; e.vehicleOwnerId = veh.vehicleOwnerId; e.vehicle = veh.vehicle; e.invVehicleId = veh.invVehicleId || null;
  // keep riderRole in lock-step with the assigned vehicle: a vehicle ⇒ driver (logs miles); cleared ⇒ none
  e.riderRole = (veh.vehicleId || veh.vehicleOwnerId || veh.vehicle) ? "driver" : "none";
  e.milesConfirmed = !!(document.getElementById("tc_e_conf") || {}).checked;
  touch(e);
  if (typeof logChange === "function") logChange("update", "timeclock", e.id, (e.milesConfirmed ? "Confirmed" : "Adjusted") + " mileage — " + tcMiles(e) + " mi · " + tcJobTitle(e.jobId));
  save(); closeModal(); render();
};
window.tcDelEntry = function (id) {
  const e = tcoll().find(x => x.id === id); if (!e) return;
  if (!tcCanEditEntry(e)) { alert(e.milesConfirmed ? "This entry's mileage is confirmed — only the owner can delete it." : "You can only remove your own punches."); return; }
  if (!confirm("Delete this time entry?")) return;
  e.deleted = true; touch(e);
  if (typeof logChange === "function") logChange("delete", "timeclock", e.id, "Deleted time entry — " + tcJobTitle(e.jobId));
  save(); closeModal(); render();
};

/* ===== PUNCH EDITOR (Item 4B) — the job page's Work-days card is now a day-grouped list of the timeclock PUNCHES
   on this job (js/61 jobPageWorkDaysCard). Each punch is editable + soft-deletable, and each day can gain a manual
   time-only punch. PERMISSIONS (tcCanEditEntry): the owner can edit/delete anything; a crew member can edit/delete
   only their OWN punch, and never one whose MILEAGE IS CONFIRMED (that's the billed number — owner-only). ===== */
function tcCanEditEntry(e) {
  if (!e) return false;
  if ((typeof isOwner === "function") && isOwner()) return true;
  const who = tcWho();
  if (e.userId !== who.userId) return false;   // only your own punch
  if (e.milesConfirmed) return false;           // confirmed mileage is owner-only to touch
  return true;
}
/* edit a punch's clock-in / clock-out TIMES (owner: any; crew: their own, unconfirmed). Owners get a jump to the
   full mileage/vehicle editor (tcOpenEntry). Never invents or changes mileage — times only. */
window.tcEditPunch = function (id) {
  const e = tcoll().find(x => x.id === id); if (!e) return;
  const owner = (typeof isOwner === "function") && isOwner();
  if (!tcCanEditEntry(e)) { alert(e.milesConfirmed ? "This entry's mileage is confirmed — only the owner can change it." : "You can only edit your own punches."); return; }
  const nm = (typeof userName === "function" ? userName(e.userId) : "") || e.userName || "Crew";
  // owner/admin (manage-members tier) may add ANOTHER person who was on site for the same times — a passenger
  // entry (their TIME for pay, no duplicate mileage). Crew editing their own punch don't get this.
  const canAddPerson = owner || ((typeof canManageMembers === "function") && canManageMembers());
  modal("Edit punch — " + esc(tcJobTitle(e.jobId)), `
    <p class="muted" style="margin-bottom:8px">${esc(nm)} · adjust the clock-in / clock-out times.</p>
    <label>Clock in</label>
    <input id="tc_p_in" type="datetime-local" value="${tcDatetimeLocal(e.clockIn)}">
    <label style="margin-top:8px">Clock out${e.clockOut == null ? ` <span class="sub">· still open — leave blank to keep it open</span>` : ""}</label>
    <input id="tc_p_out" type="datetime-local" value="${e.clockOut != null ? tcDatetimeLocal(e.clockOut) : ""}">
    ${owner ? `<button class="btn ghost sm" style="margin-top:10px;width:100%" onclick="closeModal();tcOpenEntry('${e.id}')">⚙ Mileage &amp; vehicle →</button>` : ""}
    ${canAddPerson ? `<button class="btn ghost sm" style="margin-top:${owner ? "8" : "10"}px;width:100%" onclick="tcAddToPunchPrompt('${e.id}')">➕ Add someone who was here (same times)</button>` : ""}
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="tcSavePunch('${e.id}')">Save</button>
    <button class="btn danger" style="margin-top:8px;width:100%" onclick="tcDelPunch('${e.id}')">Delete punch</button>`);
};
window.tcSavePunch = function (id) {
  const e = tcoll().find(x => x.id === id); if (!e) return;
  if (!tcCanEditEntry(e)) { alert("Not allowed."); return; }
  const inV = val("tc_p_in"); if (!inV) { alert("Enter a clock-in time."); return; }
  const inMs = new Date(inV).getTime(); if (!(inMs > 0)) { alert("Invalid clock-in time."); return; }
  const outV = val("tc_p_out"); let outMs = null;
  if (outV) { outMs = new Date(outV).getTime(); if (!(outMs > inMs)) { alert("Clock-out must be after clock-in."); return; } }
  e.clockIn = inMs; e.clockOut = outMs; touch(e);
  if (typeof logChange === "function") logChange("update", "timeclock", e.id, "Edited punch times — " + tcJobTitle(e.jobId));
  // grow the job's work days to include the (possibly moved) clock-in day — union only, never shrink
  try {
    const _jb = tcJob(e.jobId), _day = tcLocalDay(e.clockIn);
    if (_jb) { const _cur = (typeof jobWorkDays === "function") ? jobWorkDays(_jb) : ((Array.isArray(_jb.workDays) ? _jb.workDays : (_jb.date ? [_jb.date] : []))); if (_cur.indexOf(_day) < 0 && typeof jobPageCommitDays === "function") jobPageCommitDays(_jb, _cur.concat([_day])); }
  } catch (ex) {}
  save(); if (typeof closeModal === "function") closeModal(); render();
};
window.tcDelPunch = function (id) {
  const e = tcoll().find(x => x.id === id); if (!e) return;
  if (!tcCanEditEntry(e)) { alert(e.milesConfirmed ? "This entry's mileage is confirmed — only the owner can remove it." : "You can only remove your own punches."); return; }
  if (!confirm("Remove this punch? The work day stays — only this time entry is deleted.")) return;
  e.deleted = true; touch(e);
  if (typeof logChange === "function") logChange("delete", "timeclock", e.id, "Removed punch — " + tcJobTitle(e.jobId));
  save(); if (typeof closeModal === "function") closeModal(); render();
};
/* Does `userId` already have a (non-deleted) punch on the SAME job whose interval overlaps the source punch's?
   Open punches (clockOut null) collapse to a point at clockIn. Used to skip a duplicate when adding a passenger. */
function tcHasOverlap(userId, src) {
  if (!src) return false;
  const sIn = +src.clockIn, sOut = (src.clockOut != null) ? +src.clockOut : sIn;
  return actTC().some(function (e) {
    if (e.id === src.id || e.userId !== userId || e.jobId !== src.jobId) return false;
    const eIn = +e.clockIn, eOut = (e.clockOut != null) ? +e.clockOut : eIn;
    return sIn <= eOut && eIn <= sOut;   // interval overlap (inclusive)
  });
}
/* "➕ Add someone who was here" — owner/admin picks a crew member who rode along, to log the SAME hours on a punch
   without a duplicate mileage/vehicle. Opens a picker of the job's crew ∪ active members, minus the source's own
   user and anyone who ALREADY has a punch overlapping this one on this job/day. PWA-safe DOM modal (no native prompt). */
window.tcAddToPunchPrompt = function (sourceId) {
  const src = tcoll().find(x => x.id === sourceId); if (!src) return;
  const owner = (typeof isOwner === "function") && isOwner();
  const canAdd = owner || ((typeof canManageMembers === "function") && canManageMembers());
  if (!canAdd) { alert("Owner/admin only — adding time for another person."); return; }
  const j = tcJob(src.jobId);
  const members = (typeof schedMembers === "function") ? schedMembers() : [];
  const crewIds = (j && Array.isArray(j.crew)) ? j.crew : [];
  const seen = {}, cand = [];
  const pushC = id => { if (!id || seen[id] || id === src.userId) return; seen[id] = 1; cand.push(id); };
  crewIds.forEach(pushC); members.forEach(u => pushC(u.id));
  const elig = cand.filter(id => !tcHasOverlap(id, src));   // EXCLUDE anyone already overlapping on this job/day
  const nameOf = id => (typeof userName === "function" ? userName(id) : "") || "Crew";
  if (!elig.length) { alert("No one to add — everyone on this job already has an overlapping punch (or there's no other crew)."); return; }
  modal("Add someone to this punch", `
    <p class="muted" style="margin-bottom:8px">Log the SAME hours for someone who rode along on <b>${esc(tcJobTitle(src.jobId))}</b> — same clock-in/out, no separate mileage (they rode with the driver, so their time counts for pay, not a duplicate trip).</p>
    <label>Who was here</label>
    <select id="tc_addp_user">${elig.map(id => `<option value="${esc(id)}">${esc(nameOf(id))}</option>`).join("")}</select>
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="tcAddPersonToPunch('${src.id}', document.getElementById('tc_addp_user').value)">➕ Add — same hours, no mileage</button>`);
};
/* tcAddPersonToPunch(sourceId, userId): clone the source punch's TIME onto a NEW entry for userId — same
   clockIn/clockOut/jobId, manual:true, by:<me>, addedFrom:sourceId — but as a PASSENGER: NO vehicle, NO
   odometer/miles, milesConfirmed:false (their entry logs TIME for pay, never a duplicate trip). Adds them to the
   job's crew if missing + grows the work days. Owner/admin gated; idempotent-ish (skips a duplicate overlap); never throws. */
window.tcAddPersonToPunch = function (sourceId, userId) {
  try {
    const owner = (typeof isOwner === "function") && isOwner();
    const canAdd = owner || ((typeof canManageMembers === "function") && canManageMembers());
    if (!canAdd) { alert("Owner/admin only — adding time for another person."); return; }
    const src = tcoll().find(x => x.id === sourceId); if (!src) { alert("That punch is gone."); return; }
    if (!userId) { alert("Pick a person to add."); return; }
    if (userId === src.userId) { alert("That person already owns this punch."); return; }
    const uname = (typeof userName === "function" ? userName(userId) : "") || "Crew";
    if (tcHasOverlap(userId, src)) { alert(uname + " already has an overlapping punch on this job — skipped."); return; }
    const me = tcWho();
    const e = {
      id: uid(), jobId: src.jobId, userId: userId, userName: uname,
      clockIn: src.clockIn, clockOut: (src.clockOut != null ? src.clockOut : null),
      inLoc: null, outLoc: null, pings: [], stops: [],
      computedMiles: 0, miles: 0, milesConfirmed: false, milesSource: null,
      odoStart: null, odoEnd: null,
      riderRole: "none", trailerId: null, rodeWith: null,
      vehicleId: null, vehicle: "", vehicleOwnerId: null, invVehicleId: null,
      rate: TC_RATE, manual: true, by: me.userId, addedFrom: sourceId, updatedAt: now()
    };
    tcoll().push(e);
    const j = tcJob(src.jobId);
    if (j) {
      if (!Array.isArray(j.crew)) j.crew = [];
      if (j.crew.indexOf(userId) < 0) { j.crew.push(userId); if (typeof touch === "function") touch(j); }
      try {
        const _day = tcLocalDay(e.clockIn);
        const _cur = (typeof jobWorkDays === "function") ? jobWorkDays(j) : ((Array.isArray(j.workDays) ? j.workDays : (j.date ? [j.date] : [])));
        if (_cur.indexOf(_day) < 0 && typeof jobPageCommitDays === "function") jobPageCommitDays(j, _cur.concat([_day]));
      } catch (ex) {}
    }
    if (typeof touch === "function") touch(e);
    if (typeof logChange === "function") logChange("create", "timeclock", e.id, "Added " + uname + " to a punch (same times, no mileage) — " + tcJobTitle(src.jobId));
    if (typeof save === "function") save();
    if (typeof closeModal === "function") closeModal();
    if (typeof render === "function") render();
    alert("Added " + uname + " to this punch — same hours, no separate mileage.");
  } catch (ex) { try { alert("Couldn't add that person."); } catch (e2) {} }
};
/* "＋ Add punch" — a MANUAL, time-only entry for a given job + day. No vehicle, no mileage (riderRole:none,
   miles:0, milesConfirmed so it never nags as an unconfirmed estimate) — it never invents mileage. Owner may pick
   any crew member; a crew member may only add their own punch. */
window.tcAddPunch = function (jobId, day) {
  const j = tcJob(jobId); if (!j) return;
  const owner = (typeof isOwner === "function") && isOwner();
  const me = (typeof curUser === "function") ? curUser() : null, who = tcWho();
  const members = (typeof schedMembers === "function") ? schedMembers() : [];
  const dflt = day || ((typeof today === "function") ? today() : tcLocalDay(now()));
  const memberSel = owner
    ? `<label>Crew member</label><select id="tc_ap_user">${members.map(u => `<option value="${esc(u.id)}" ${me && me.id === u.id ? "selected" : ""}>${esc(u.username)}</option>`).join("")}</select>`
    : `<input type="hidden" id="tc_ap_user" value="${esc(who.userId)}">`;
  modal("Add a punch — " + esc(tcJobTitle(jobId)), `
    <p class="muted" style="margin-bottom:8px">Log time by hand for <b>${esc((typeof fmtDate === "function") ? fmtDate(dflt) : dflt)}</b>. Time only — no vehicle, no mileage (mileage comes from a real clock-in).</p>
    ${memberSel}
    <input type="hidden" id="tc_ap_day" value="${esc(dflt)}">
    <div class="row" style="gap:8px;margin-top:8px"><div class="grow"><label style="margin-top:0">Clock in</label><input id="tc_ap_in" type="time" value="08:00"></div><div class="grow"><label style="margin-top:0">Clock out</label><input id="tc_ap_out" type="time" value="12:00"></div></div>
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="tcSaveManualPunch('${jobId}')">Add punch</button>`);
};
window.tcSaveManualPunch = function (jobId) {
  const j = tcJob(jobId); if (!j) return;
  const owner = (typeof isOwner === "function") && isOwner(), who = tcWho();
  let userId = val("tc_ap_user") || who.userId;
  if (!owner && userId !== who.userId) userId = who.userId;   // a non-owner can only add their own punch
  const day = val("tc_ap_day") || ((typeof today === "function") ? today() : tcLocalDay(now()));
  const inT = val("tc_ap_in"), outT = val("tc_ap_out");
  if (!inT || !outT) { alert("Enter both a clock-in and a clock-out time."); return; }
  const inMs = new Date(day + "T" + inT).getTime(), outMs = new Date(day + "T" + outT).getTime();
  if (!(inMs > 0) || !(outMs > inMs)) { alert("Clock-out must be after clock-in."); return; }
  const uname = (typeof userName === "function" ? userName(userId) : "") || who.name || "Crew";
  const e = {
    id: uid(), jobId: jobId, userId: userId, userName: uname,
    clockIn: inMs, clockOut: outMs,
    inLoc: null, outLoc: null, pings: [], stops: [],
    computedMiles: 0, miles: 0, milesConfirmed: true, milesSource: null,
    odoStart: null, odoEnd: null,
    riderRole: "none", trailerId: null, rodeWith: null,
    vehicleId: null, vehicle: "", vehicleOwnerId: null, invVehicleId: null,
    rate: TC_RATE, manual: true, updatedAt: now()
  };
  tcoll().push(e);
  if (typeof logChange === "function") logChange("create", "timeclock", e.id, "Added manual punch — " + tcJobTitle(jobId) + " · " + uname);
  try {
    const _cur = (typeof jobWorkDays === "function") ? jobWorkDays(j) : ((Array.isArray(j.workDays) ? j.workDays : (j.date ? [j.date] : [])));
    if (_cur.indexOf(day) < 0 && typeof jobPageCommitDays === "function") jobPageCommitDays(j, _cur.concat([day]));
  } catch (ex) {}
  save(); if (typeof closeModal === "function") closeModal(); render();
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
/* ===== SHARED clock-in form (Items 5/6) — factored out of tcClockHTML so every entry point (the Time tab, the
   job page, and the Today screen) uses the SAME grouped vehicle dropdown + separate trailer dropdown + rider-role
   + start-odometer + route-estimate flow and the SAME tcClockIn(). Only ONE clock-in form is ever on-screen at a
   time (the Time tab OR a job page OR Today — never two at once), so the shared #tc_job / #tc_role / #tc_vehicle /
   #tc_odo_start ids don't collide.
     preJobId set  → the job is already known (a hidden #tc_job, no picker; used from the job page + a Today
                     add-a-job flow) — this REPLACES the old broken free-text vehicle input on the job page.
     preJobId null → render a pick-a-job <select> (today's work days first, your jobs first).
   Returns "" when there's genuinely nothing to clock into (no open jobs) so the caller can show its own message. */
function tcClockInFormHTML(preJobId) {
  const who = tcWho();
  const _defVal = tcDefaultVehVal(who.userId);
  const _role = tcDefaultRole(who.userId);   // driver / passenger / none — only the driver logs the truck's miles
  let jobControl = "", jobId = preJobId || "";
  if (preJobId) {
    jobControl = `<input type="hidden" id="tc_job" value="${esc(preJobId)}">`;
  } else {
    // MULTI-DAY: a job is clock-in-able on ANY of its work days. Surface jobs worked TODAY first, then by date.
    const _td = (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10);
    const _onToday = j => (typeof jobOnDay === "function") ? jobOnDay(j, _td) : (j.date === _td);
    const jobs = (typeof actJ === "function" ? actJ() : []).filter(j => !j.done).sort((a, b) => {
      const at = _onToday(a) ? 1 : 0, bt = _onToday(b) ? 1 : 0; if (at !== bt) return bt - at;   // today's work days first
      return (b.date || "") < (a.date || "") ? -1 : 1;
    });
    if (!jobs.length) return "";
    const mine = jobs.filter(j => (j.crew || []).indexOf(who.userId) >= 0);
    jobId = (mine[0] || jobs[0]).id;   // the option the <select> starts on → the route estimate matches it
    const opt = j => { const wd = (typeof jobWorkDays === "function") ? jobWorkDays(j) : (j.date ? [j.date] : []); const multi = wd.length > 1 ? ` · ${wd.length}-day${_onToday(j) ? ", today" : ""}` : ""; return `<option value="${j.id}">${esc(j.title || "Job")}${j.date ? " · " + fmtDate(j.date) : ""}${multi}${j.customerId ? " · " + esc(custName(j.customerId)) : ""}</option>`; };
    jobControl = `<label>Job</label>
      <select id="tc_job" onchange="tcJobPicked()">${mine.length ? `<optgroup label="Your jobs">${mine.map(opt).join("")}</optgroup><optgroup label="All open jobs">${jobs.filter(j => mine.indexOf(j) < 0).map(opt).join("")}</optgroup>` : jobs.map(opt).join("")}</select>`;
  }
  return `${jobControl}
    <label style="margin-top:10px">How are you getting there? <span class="sub">· only the driver logs the truck's miles</span></label>
    ${tcRolePicker(_role)}
    ${tcRoleDetail(_role, _defVal, who.userId, jobId)}
    <button class="btn acc" id="tc_inbtn" style="margin-top:14px;width:100%" onclick="tcClockIn()">📍 Clock in</button>`;
}

function tcClockHTML() {
  const who = tcWho(), open = tcOpenShift(who.userId);
  let h = "";
  if (open) {
    const j = tcJob(open.jobId);
    h += `<div class="card" style="border-left:5px solid var(--accent)">
      <div class="sub" style="white-space:normal">⏱ On the clock — ${esc(who.name)}</div>
      <div class="nm" style="font-size:18px;margin:4px 0 2px;white-space:normal">${esc(open.jobId ? tcJobTitle(open.jobId) : "Job")}</div>
      ${j && j.customerId ? `<div class="sub" style="white-space:normal;margin-bottom:2px">${esc(custName(j.customerId))}</div>` : ""}
      ${(j && jobEstHrsEach(j)) ? `<div class="sub" style="white-space:normal;color:var(--brand-text);font-weight:600">⏱ Est ~${jobEstHrsEach(j)} hr (your share) · likely finish ~${(function(){try{return new Date(open.clockIn+jobEstHrsEach(j)*3600000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}catch(e){return""}})()} · breaks don't count</div>` : ""}
      <div class="tc-metrics">
        <div><div style="font-size:24px;font-weight:800" id="tc_elapsed">${tcFmtDur(now() - open.clockIn)}</div><div class="sub">elapsed</div></div>
        <div><div style="font-size:24px;font-weight:800" id="tc_miles">${tcRound(open.computedMiles)} mi est</div><div class="sub" id="tc_pings">${(open.pings || []).length} ping${(open.pings || []).length === 1 ? "" : "s"}</div></div>
      </div>
      ${tcShiftVehLine(open)}
      ${tcNeedsOdo(open) ? `<div class="card" style="border-left:4px solid var(--danger);background:var(--soft);margin-top:8px"><div class="sub" style="white-space:normal">⏱ No starting odometer yet. <a href="#" onclick="tcEnterStartOdo();return false" style="color:var(--brand-text);font-weight:700">Enter it now</a> — already-driven miles are anchored so a late entry stays accurate.</div></div>` : ""}
      ${tcStopsBlock(open.id)}
      <div class="sub" style="margin-top:6px;white-space:normal">📍 GPS pings only while this app is open and on-screen — a phone-locked or backgrounded route isn't tracked. The odometer is the number of record; GPS only cross-checks it.</div>
      <div class="row" style="margin-top:12px;gap:8px">
        <button class="btn danger grow" id="tc_outbtn" onclick="tcClockOut('${open.id}')">Clock out</button>
        <button class="btn ghost grow" id="tc_changejobbtn" onclick="tcChangeJob('${open.id}')">🔁 Change job</button>
      </div>
    </div>`;
  } else {
    const form = tcClockInFormHTML(null);
    if (!form) {
      h += `<div class="card"><div class="muted">No open jobs to clock in against. <a href="#" onclick="TAB='schedule';render();return false" style="color:var(--brand-text);font-weight:700">Schedule a job</a> first.</div></div>`;
    } else {
      h += `<div class="card" style="border-top:4px solid var(--accent)">
        <div class="nm" style="font-size:16px">Clock in — ${esc(who.name)}</div>
        ${form}
        <div class="sub" style="margin-top:8px;white-space:normal">🚗 <b>Clock in when you leave for the job</b> (not when you arrive) — that keeps the time estimate honest. Only the <b>driver</b> logs the truck's miles so a shared truck is never counted twice; passengers still log their time. Odometer never blocks clocking in. Time tracks even if you decline GPS.</div>
      </div>`;
    }
  }
  // my recent shifts
  const recent = actTC().filter(e => e.userId === who.userId && e.clockOut).sort((a, b) => b.clockIn - a.clockIn).slice(0, 10);
  if (recent.length) {
    h += `<div class="secthd"><h2>Your recent shifts</h2><span class="ct">${recent.length}</span></div><div class="card">` +
      recent.map(e => `<div class="li"><div class="grow"><div class="nm" style="font-size:14px">${esc(tcJobTitle(e.jobId))}</div>
        <div class="sub">${fmtDate(new Date(e.clockIn).toISOString().slice(0,10))} · ${tcFmtDur(e.clockOut - e.clockIn)} · ${tcMiles(e)} mi${e.milesConfirmed ? "" : " est"}${e.riderRole === "passenger" ? " · 🧍 passenger" : (e.vehicle ? " · 🚚 " + esc(e.vehicle) + (e.trailerId ? " + 🚛" : "") : "")}${e.milesFlag ? " · ⚠" : ""}</div></div>${tcSourceBadge(e)}</div>`).join("") + `</div>`;
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
    <div class="grow"><div style="font-size:22px;font-weight:800;color:var(--brand-text)">${totHrs.toFixed(1)}h</div><div class="sub">logged hours</div></div>
    <div class="grow" style="border-left:1px solid var(--line)"><div style="font-size:22px;font-weight:800;color:var(--brand-text)">${tcRound(totMi)} mi</div><div class="sub">miles (est)</div></div>
    <div class="grow" style="border-left:1px solid var(--line)"><div style="font-size:22px;font-weight:800;color:var(--brand-text)">${money(totMi * TC_RATE)}</div><div class="sub">mileage @ $${TC_RATE}</div></div>
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
      es.sort((a, b) => b.clockIn - a.clockIn).map(e => `<div class="li" style="cursor:pointer" onclick="tcOpenEntry('${e.id}')"><div class="grow"><div class="nm" style="font-size:14px">${esc(e.userName || "Crew")} ${tcSourceBadge(e)}${e.milesFlag ? ` <span class="badge" style="background:var(--danger);color:#fff">⚠ GPS mismatch</span>` : ""}</div>
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
