/* ---------- CREW JOB PAGE ----------
   The one screen a crew member opens for the job they're on. Flow: where & when (directions + call) →
   load checklist (load the truck first) → time clock (your own vehicle + odometer; shows who's on the
   job) → photos (inline, visible to all) → expenses (amount + receipt as proof) → notes → change orders.
   Reached by tapping a job (openJobPage); renders inside the Schedule tab via window.JOB_OPEN. */
window.JOB_OPEN = window.JOB_OPEN || null;
window.JOB_RETURN_TAB = window.JOB_RETURN_TAB || null;   // where the user was when they opened a job (e.g. "receipts") so Back returns there, not always Schedule
window.JOB_TITLE_EDIT = window.JOB_TITLE_EDIT || null;   // job id whose title is currently in inline-rename mode (else null)
window.openJobPage = function (id) { window.JOB_RETURN_TAB = (typeof TAB !== "undefined" && TAB && TAB !== "schedule") ? TAB : null; window.JOB_OPEN = id; window.JOB_TITLE_EDIT = null; TAB = "schedule"; if (typeof render === "function") render(); };
window.jobPageBack = function () { window.JOB_OPEN = null; window.JOB_TITLE_EDIT = null; if (window.JOB_RETURN_TAB) { TAB = window.JOB_RETURN_TAB; window.JOB_RETURN_TAB = null; } if (typeof render === "function") render(); };
window.jobResetOpen = function () { window.JOB_OPEN = null; window.JOB_RETURN_TAB = null; window.JOB_TITLE_EDIT = null; };

function jobAddr(j) {
  const _p = (j.propertyId && typeof actProps === "function") ? actProps().find(p => p.id === j.propertyId) : null;
  const _c = (typeof actC === "function") ? actC().find(c => c.id === j.customerId) : null;
  return (_p && _p.address) || j.address || (_c && _c.address) || (_c && typeof propsForCust === "function" && (propsForCust(_c.id)[0] || {}).address) || "";
}
/* ===== Google Maps link builders — labels at the call site must always say WHERE the link goes (never bare
   "Google Maps" — that's how a one-way job-site link and a round-trip-from-base link both got tapped by
   mistake looking for the materials supplier: neither was labeled, neither WAS the supplier). No API key
   needed: the standard /maps/dir/?api=1 deep link opens turn-by-turn from wherever the phone already is. */
function gmapsDirUrl(destination, waypoints) {
  let u = "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination || "");
  if (waypoints && waypoints.length) u += "&waypoints=" + waypoints.map(w => encodeURIComponent(w)).join("|");
  return u;
}
/* ADMIN-PLANNED route for a job — ordered [{id,label,address,lat,lng}] set on the job editor (js/09), e.g.
   "Stoneworks — pick up base" before the job site itself. Distinct from js/38's crew-added ad hoc timeclock
   stops[] (logged as-driven, after the fact) — this is the route planned in ADVANCE by the owner/admin. */
function jobPlannedStops(j) { return (Array.isArray(j && j.plannedStops) ? j.plannedStops : []).filter(s => s && s.address); }
/* SHARED ordered route between Start and End — the combined [planned stops + job site] list, in route order,
   that EVERY surface consumes (route card, crew directions, mileage recalc jobRouteTaggedSeq, js/91 overlay)
   so they can't drift. Each token is {kind:"stop",stop:<plannedStops entry>,raw:<its index in j.plannedStops>}
   or {kind:"site",address:<jobAddr>,ll:<jobLatLng>}. The site is spliced in at combined index `sp`:
     sp = (typeof j.sitePos==="number" && j.sitePos>=0) ? min(j.sitePos, ps.length) : ps.length
   i.e. the site sits immediately BEFORE plannedStops[sp]; sp===ps.length (sitePos null/absent) = site LAST =
   today's fixed behavior (byte-identical, NO migration). Clamp-on-read self-heals any stale sitePos left by a
   modal stop-edit. Length is always ps.length+1 (the site is always present, even with no stops). */
function jobRouteOrdered(j) {
  const ps = Array.isArray(j && j.plannedStops) ? j.plannedStops : [];
  const sp = (j && typeof j.sitePos === "number" && j.sitePos >= 0) ? Math.min(j.sitePos, ps.length) : ps.length;
  const tokens = ps.map((s, i) => ({ kind: "stop", stop: s, raw: i }));
  tokens.splice(sp, 0, { kind: "site", address: (typeof jobAddr === "function") ? jobAddr(j) : ((j && j.address) || ""), ll: (typeof jobLatLng === "function") ? jobLatLng(j) : null });
  return tokens;
}
/* Who may EDIT a job's location + planned route from the job page: owner OR an admin-tier role (manage-members
   is this app's admin proxy — same gate the Admin panel uses). Crew see the location + route READ-ONLY. */
function jobCanEditPlan() { return (typeof isOwner === "function" && isOwner()) || (typeof canDo === "function" && canDo("manage-members")); }
/* Resolve a route ENDPOINT (j.routeStart / j.routeEnd) to [lat,lng]. An endpoint is {address,lat,lng} or null.
   null/absent = "use the business home base" (legacy + default behavior — base at both ends). A custom endpoint
   with coords wins; a custom endpoint still awaiting geocode (address set, lat null) is UNRESOLVED → returns null
   so the estimate waits (reappears once OSM answers) rather than silently snapping back to base. */
function jobRouteEndpointPt(ep, hb) {
  if (ep && ep.lat != null && ep.lng != null) return [ep.lat, ep.lng];   // custom endpoint, geocoded
  if (ep && ep.address) return null;                                     // custom endpoint set, still geocoding
  return (hb && hb.lat != null) ? [hb.lat, hb.lng] : null;               // null/unset → home base (default)
}
/* one-way road miles a saved PLACE declares from home base (manualMiles), used to override the haversine on a
   base-adjacent leg. Only a positive number counts; anything else (unset/0/NaN/non-place) → null = "no override". */
function placeManualMi(placeId) {
  if (!placeId || typeof D !== "function") return null;
  const d = D(); const places = (d && Array.isArray(d.places)) ? d.places : [];
  const p = places.find(x => x && x.id === placeId && !x.deleted);
  return (p && typeof p.manualMiles === "number" && isFinite(p.manualMiles) && p.manualMiles > 0) ? p.manualMiles : null;
}
/* a route endpoint (j.routeStart / j.routeEnd) → a TAGGED point {pt:[lat,lng], base:bool, manMi:(number|null)}:
   base=true only when it resolves to the home base (null/unset endpoint); a custom endpoint carrying a placeId
   picks up that place's manualMiles override. null = unresolvable (still geocoding / no base). */
function jobRouteEndpointTagged(ep, hb) {
  if (ep && ep.lat != null && ep.lng != null) return { pt: [ep.lat, ep.lng], base: false, manMi: placeManualMi(ep.placeId) };
  if (ep && ep.address) return null;                                                       // custom endpoint set, still geocoding
  return (hb && hb.lat != null) ? { pt: [hb.lat, hb.lng], base: true, manMi: null } : null;   // null/unset → home base
}
/* the address a route endpoint currently resolves to for DISPLAY — the custom address if set, else "" (= base). */
function jobRouteEndpointLabel(ep) { return (ep && ep.address) ? String(ep.address) : ""; }
/* "destination-based backup mileage estimate" — REAL ROAD MILES along the ORDERED route (START → each geocoded
   planned stop, in order → job site → END) via OSRM (js/62 roadRouteMiles), NOT the old haversine ×1.3 guess
   (Ray: "never use the 1.3x guess; if the map route tools isn't working just go by the manual entry"). START/END
   default to the home base (j.routeStart / j.routeEnd null = base) but are EDITABLE per job. Stored on
   j.estRouteMiles as an INFORMATIONAL cross-check only — it NEVER touches the odometer/GPS/timeclock miles-of-
   record (the billed number). Sourcing, in order:
     1) OSRM road miles (road is truth) — the whole ordered path in one query, or, when a saved-place manualMiles
        override sits on a base↔place leg, that leg keeps its manual override + the OTHER legs come from OSRM;
     2) when OSRM can't answer this session, the owner's j.manualRouteMiles (round-trip) if set;
     3) else leave the existing value UNTOUCHED (never clobber a good estimate with null, never a ×1.3 guess) —
        or null when the map has FAILED and there was no prior value (so the UI can prompt for manual miles).
   Idempotent, self-persisting: an OSRM leg that isn't cached yet is fetched once, then recomputed + saved on land
   (change-guarded so it never render-loops). null when nothing's geocoded / routable yet. */
function jobRouteTaggedSeq(j) {
  if (!j || typeof homeBase !== "function") return null;
  const hb = homeBase();
  const startPt = jobRouteEndpointTagged(j.routeStart, hb);   // tagged {pt,base,manMi} — custom start (fallback: home base)
  const endPt = jobRouteEndpointTagged(j.routeEnd, hb);       // tagged {pt,base,manMi} — custom end   (fallback: home base)
  // walk the ONE ordered list (stops + job site in j.sitePos order) — ONLY the waypoint ORDER differs from the
  // old "stops then site appended"; every leg-costing rule below is unchanged. With sitePos null the site still
  // lands after every coord'd stop → byte-identical to the old append (proven by mileage-fingerprint-test).
  const mid = [];   // ordered intermediate waypoints that actually have coords, each tagged {pt,base,manMi}
  (typeof jobRouteOrdered === "function" ? jobRouteOrdered(j) : []).forEach(t => {
    if (t.kind === "stop") { const s = t.stop; if (s && s.address && s.lat != null && s.lng != null) mid.push({ pt: [s.lat, s.lng], base: false, manMi: placeManualMi(s.placeId) }); }
    else if (t.kind === "site") { const ll = t.ll; if (ll && ll.lat != null) mid.push({ pt: [ll.lat, ll.lng], base: false, manMi: null }); }   // job site: no manualMiles (places-only)
  });
  if (!startPt || !endPt || !mid.length) return null;
  return [startPt].concat(mid, [endPt]);   // start → stops/site (in sitePos order) → end
}
/* Split the ordered seq into (a) base↔place legs carrying a saved-place manualMiles override (already road miles)
   and (b) the remaining road legs, pulling their miles from the OSRM cache WITHOUT firing a fetch. Returns
   {manualSum, roadTotal, resolved, anyNone, needsFetch:[waypoint-lists], hasManualLeg}. resolved = every road
   leg is a cached number. needsFetch = only NEVER-TRIED legs (cached "none" = a terminal fail, not re-fetched). */
function jobRouteMilesCompute(seq) {
  const manual = [], roadLegs = [];
  for (let i = 1; i < seq.length; i++) {
    const A = seq[i - 1], B = seq[i];
    if (A.base && B.manMi != null) manual.push(B.manMi);          // base → saved place: use its manual one-way miles
    else if (B.base && A.manMi != null) manual.push(A.manMi);     // saved place → base: same
    else roadLegs.push([A.pt, B.pt]);                            // everything else: real road miles (OSRM)
  }
  const cachedGet = (typeof roadRouteCached === "function") ? roadRouteCached : function () { return undefined; };
  let roadTotal = 0, resolved = true, anyNone = false; const needsFetch = [];
  const take = (v, wp) => { if (typeof v === "number") { roadTotal += v; } else { resolved = false; if (v === "none") anyNone = true; else needsFetch.push(wp); } };
  if (roadLegs.length) {
    if (!manual.length) { const pts = seq.map(s => s.pt); take(cachedGet(pts), pts); }   // no manual override → one OSRM query over the whole ordered path (== sum of its legs)
    else roadLegs.forEach(leg => take(cachedGet(leg), leg));                              // mixed → per-leg (so the manual legs can be added in)
  }
  return { manualSum: manual.reduce((s, m) => s + m, 0), roadTotal: roadTotal, resolved: resolved, anyNone: anyNone, needsFetch: needsFetch, hasManualLeg: manual.length > 0 };
}
/* Sum of the manualMiles carried by any COORD-LESS planned stop — a saved place picked from the on-focus pick-list
   BEFORE its geocode resolved (lat==null) still carries a one-way manualMiles override but has no coords, so
   jobRouteTaggedSeq can't route it as a waypoint. We add its manualMiles as a FLAT contribution to the estimate so
   the transfer-station leg isn't silently dropped ("keep it simple + documented"). Prefer the live place override
   (placeManualMi) so an edit to the place flows through; fall back to the snapshot on the stop. Returns 0 when there
   are none → EVERY existing coord'd route is byte-identical (mileage fingerprint). Coord'd stops are UNAFFECTED —
   they route normally through the seq and never enter this sum. */
function jobRouteExtraManual(j) {
  try {
    return (typeof jobRouteOrdered === "function" ? jobRouteOrdered(j) : []).reduce(function (sum, t) {
      if (t.kind !== "stop") return sum;
      const s = t.stop;
      if (!s || s.lat != null) return sum;                                   // coord'd stop → routed via seq, not here
      const live = (s.placeId && typeof placeManualMi === "function") ? placeManualMi(s.placeId) : null;
      const v = (live != null) ? live : ((typeof s.manualMiles === "number" && isFinite(s.manualMiles) && s.manualMiles > 0) ? s.manualMiles : 0);
      return sum + (v > 0 ? v : 0);
    }, 0);
  } catch (e) { return 0; }
}
function jobRecalcRouteMiles(j) {
  if (!j) return;
  // MANUAL OVERRIDE: if the owner set whole-route manual miles, that's authoritative — use it and skip the map
  // entirely (they set it because the auto tools were wrong; it's an override, not an offline fallback).
  if (+j.manualRouteMiles > 0) { j.estRouteMiles = Math.round(+j.manualRouteMiles * 10) / 10; return; }
  const extraManual = (typeof jobRouteExtraManual === "function") ? jobRouteExtraManual(j) : 0;   // lat-less place-stops' manualMiles (0 for every existing coord'd route → fingerprint-safe)
  const seq = jobRouteTaggedSeq(j);
  if (!seq) {
    if (j.manualRouteMiles > 0) j.estRouteMiles = Math.round(j.manualRouteMiles * 10) / 10;   // owner's manual round-trip is authoritative — don't stack
    else if (extraManual > 0) j.estRouteMiles = Math.round(extraManual * 10) / 10;            // only a lat-less manualMiles stop to go on → surface it
    else if (!(j.estRouteMiles > 0)) j.estRouteMiles = null;                                  // nothing routable + no prior value
    return;
  }
  const c = jobRouteMilesCompute(seq);
  if (c.resolved) { j.estRouteMiles = Math.round((c.manualSum + c.roadTotal + extraManual) * 10) / 10; return; }   // full ROAD-based value + any lat-less place-stop miles (road wins over manual)
  // some road legs aren't cached yet → fetch each NEVER-TRIED leg once, then recompute + persist on land (change-guarded).
  c.needsFetch.forEach(function (wp) {
    if (typeof roadRouteMiles === "function") roadRouteMiles(wp, function () {
      const before = j.estRouteMiles; jobRecalcRouteMiles(j);
      if (j.estRouteMiles !== before) { if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render(); }
    });
  });
  // meanwhile: manual round-trip if the owner set one; else leave the existing estimate untouched (NEVER ×1.3, NEVER
  // clobber a good value with null) — only fall to null when the map FAILED (anyNone) and there was no prior value.
  if (j.manualRouteMiles > 0) j.estRouteMiles = Math.round(j.manualRouteMiles * 10) / 10;
  else if (c.anyNone && !(j.estRouteMiles > 0)) j.estRouteMiles = (extraManual > 0) ? Math.round(extraManual * 10) / 10 : null;
}
/* Which source the CURRENT estimate is drawn from, for the display label — "roads" (OSRM resolved), "manual"
   (owner's j.manualRouteMiles round-trip fallback), "none" (map tried + failed, no manual → prompt for manual),
   or "pending" (still resolving / nothing geocoded yet). Pure read — never fires a fetch. */
function jobRouteMilesSource(j) {
  if (j && +j.manualRouteMiles > 0) return "manual";   // manual override wins over the map (checked first)
  const seq = jobRouteTaggedSeq(j);
  if (!seq) return (j && j.estRouteMiles > 0 ? "manual" : "pending");
  const c = jobRouteMilesCompute(seq);
  if (c.resolved) return "roads";
  return c.anyNone ? "none" : "pending";
}

function rJobPage(j) {
  const cust = (typeof custName === "function") ? custName(j.customerId) : "";
  const _cust = (typeof actC === "function") ? actC().find(c => c.id === j.customerId) : null;
  const phone = (_cust && _cust.phone) ? _cust.phone : "";
  const addr = jobAddr(j);
  const _ll = (typeof jobLatLng === "function") ? jobLatLng(j) : null, _drive = (_ll && typeof driveBadge === "function") ? driveBadge(_ll.lat, _ll.lng) : "";
  const crewNames = (j.crew || []).map(id => (typeof userName === "function" ? userName(id) : "") || "").filter(Boolean).join(", ");
  const me = (typeof tcWho === "function") ? tcWho() : null;
  const tc = (typeof actTC === "function") ? actTC() : [];
  const openThis = me ? tc.find(e => e.userId === me.userId && e.jobId === j.id && !e.clockOut) : null;
  const openOther = me ? tc.find(e => e.userId === me.userId && e.jobId !== j.id && !e.clockOut) : null;
  const onJob = tc.filter(e => e.jobId === j.id && !e.clockOut);
  const exps = (j.expenses || []).filter(x => x && !x.deleted);
  const expTotal = exps.reduce((s, e) => s + (+e.amount || 0), 0);
  const tel = ph => String(ph || "").replace(/[^0-9+]/g, "");
  // up-to-3 labeled numbers for the customer (falls back to the single number). Each renders as a full-width
  // Call button showing the actual number + its note, tap = tel:. Shared by the planned-route + compact branches.
  const _phones = (typeof custPhones === "function" && _cust) ? custPhones(_cust) : (phone ? [{ num: phone, label: "" }] : []);
  const _phoneBtns = _phones.length ? `<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">` + _phones.map(p => `<a class="btn ghost" href="tel:${tel(p.num)}" style="text-align:center">📞 ${esc((typeof fmtPhone === "function") ? fmtPhone(p.num) : p.num)}${p.label ? ` · ${esc(p.label)}` : ""}</a>`).join("") + `</div>` : "";
  const upUrl = id => (typeof jsUploadUrl === "function") ? jsUploadUrl(id) : "";
  const hhmm = ms => { try { return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };

  // Title — tap-to-rename (owner/admin). Reveals an inline free-text input writing j.title (NOT the service
  // dropdown); job_title is registered in the js/09 focus-preservation _ids so typing survives the frequent
  // re-renders. Crew see the plain title.
  let h = `<div class="secthd">`;
  if (jobCanEditPlan() && window.JOB_TITLE_EDIT === j.id) {
    h += `<input id="job_title" value="${esc(j.title || "")}" placeholder="Job title" style="flex:1;font-size:18px;font-weight:800;margin:0" onkeydown="if(event.key==='Enter')jobPageRename('${j.id}')"><button class="btn acc sm" style="margin-left:8px" onclick="jobPageRename('${j.id}')">Save</button>`;
  } else {
    h += `<h2 style="margin:0${jobCanEditPlan() ? ";cursor:pointer" : ""}"${jobCanEditPlan() ? ` title="Tap to rename" onclick="window.JOB_TITLE_EDIT='${j.id}';if(typeof render==='function')render()"` : ""}>${esc(j.title || "Job")}${jobCanEditPlan() ? ' <span class="sub" style="font-weight:400;font-size:13px">✏️</span>' : ""}</h2>`;
  }
  h += `<button class="btn ghost sm" style="margin-left:auto" onclick="jobPageBack()">← Back</button></div>`;
  h += editedByLine(j);

  // 1) Where & when — directions + call
  h += `<div class="card"><div class="nm" style="font-size:18px">${esc(cust || "—")}</div>`;
  h += addr ? `<div class="sub" style="white-space:normal;margin-top:3px">${esc(addr)}</div>` : `<div class="muted" style="margin-top:3px">No address on file.</div>`;
  if (_drive) h += `<div class="sub" style="margin-top:3px;font-weight:600;color:var(--brand-text)">${_drive}</div>`;
  // EDIT LOCATION (owner/admin) — set a real location on a job with none (e.g. an airport pickup with no
  // customer address): pick a saved property (its map pin) OR type a free-text address saved to j.address,
  // which jobAddr() already reads as a fallback. Crew see the location read-only.
  if (jobCanEditPlan()) h += `<button class="btn ghost sm" style="margin-top:6px" onclick="jobEditLoc('${j.id}')">✏️ Edit location</button>`;
  h += `<div class="sub" style="margin-top:8px;white-space:normal">📅 ${j.date ? fmtDate(j.date) : "—"}${j.time ? " · " + esc(j.time) : ""}${crewNames ? " · 👥 " + esc(crewNames) : ""}</div>`;
  if (j.done) h += `<div class="sub" style="margin-top:6px;color:var(--accent);font-weight:800">✓ Completed</div>`;
  // DERIVED lifecycle badge — where this job sits in the pipeline (lead→quote→job→expense collecting→invoice→paid).
  // Reads through the linked quote; the expense-collecting badge shows live "N/M crew closed" + who we're waiting on.
  if (typeof workStage === "function" && typeof actQ === "function") {
    const _wq = (j.quoteId ? actQ().find(x => x && x.id === j.quoteId) : null) || actQ().find(x => x && x.jobId === j.id);
    if (_wq) {
      const _st = workStage(_wq), _m = (typeof workStageMeta !== "undefined" && workStageMeta[_st]) || { label: _st, color: "var(--muted)" };
      const _lbl = (typeof workStageLabel === "function") ? workStageLabel(_wq) : _m.label;
      const _wait = (_st === "expense" && typeof workStageWaiting === "function") ? workStageWaiting(_wq) : [];
      h += `<div style="margin-top:8px"><span class="badge" style="background:${_m.color};color:#fff">${esc(_lbl)}</span>${_wait.length ? `<span class="sub" style="margin-left:6px">waiting on ${esc(_wait.join(", "))}</span>` : ""}</div>`;
    }
  }
  const _stops = jobPlannedStops(j);
  if (_stops.length) {
    // ADMIN-PLANNED ROUTE: each stop gets its OWN correctly-labeled link (e.g. "Stoneworks — pick up base"),
    // the job site sits inline WHEREVER j.sitePos places it (not force-appended), and ≥2 total stops also get
    // ONE combined multi-stop link (waypoints chained in the SAME order) for one-tap turn-by-turn. Built from
    // the shared jobRouteOrdered(j) so this list can't drift from the estimate / overlay.
    h += `<div class="sub" style="margin-top:10px;font-weight:700">🧭 Planned route <span class="sub" style="font-weight:400">· ${_stops.length} stop${_stops.length > 1 ? "s" : ""}${addr ? " + job site" : ""}</span></div>`;
    const _allDest = [];
    (typeof jobRouteOrdered === "function" ? jobRouteOrdered(j) : []).forEach(t => {
      if (t.kind === "site") { if (!addr) return; _allDest.push(addr); h += `<div class="li" style="padding:6px 0"><div class="grow"><div class="nm" style="font-size:14px">${_allDest.length}. 🏁 Job site</div><div class="sub" style="white-space:normal">${esc(addr)}</div></div><a class="btn ghost sm" href="${gmapsDirUrl(addr)}" target="_blank" rel="noopener">🧭 Directions</a></div>`; }
      else { const s = t.stop; if (!(s && s.address)) return; _allDest.push(s.address); h += `<div class="li" style="padding:6px 0"><div class="grow"><div class="nm" style="font-size:14px">${_allDest.length}. ${esc(s.label || "Stop")}</div><div class="sub" style="white-space:normal">${esc(s.address)}</div></div><a class="btn ghost sm" href="${gmapsDirUrl(s.address)}" target="_blank" rel="noopener">🧭 Directions</a></div>`; }
    });
    if (_allDest.length >= 2) {
      const _dest = _allDest[_allDest.length - 1], _wps = _allDest.slice(0, -1);
      h += `<a class="btn acc" style="width:100%;margin-top:8px;text-align:center" href="${gmapsDirUrl(_dest, _wps)}" target="_blank" rel="noopener">🗺 Full route — ${_allDest.length} stops</a>`;
    }
    h += _phoneBtns;   // up to 3 labeled Call buttons (number + note), tap = tel:
  } else if (addr || _phones.length) {
    // Compact contact area: the job-site button now SHOWS the address (tap still opens directions), truncated to
    // one line; each Call button SHOWS the actual number + its note (tap still dials).
    if (addr) h += `<div class="row" style="gap:8px;margin-top:10px"><a class="btn ghost grow" href="${gmapsDirUrl(addr)}" target="_blank" rel="noopener" title="${esc(addr)}" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📍 ${esc(addr)} ›</a></div>`;
    h += _phoneBtns;
  }
  // ESTIMATE (informational cross-check) — offline round-trip miles across the ordered stops. NEVER the billed
  // number: the odometer/GPS timeclock miles stay the record. If the job has confirmed odometer miles, show them
  // side by side so the estimate reads as a sanity check (Ray: within ~15–20%).
  const _routeSrc = (typeof jobRouteMilesSource === "function") ? jobRouteMilesSource(j) : "";
  if (j.estRouteMiles > 0) {
    const _n = _stops.length;
    const _confMiles = tc.filter(e => e && !e.deleted && e.jobId === j.id && e.clockOut && e.milesConfirmed).reduce((s, e) => s + (+e.miles || 0), 0);
    // subtle endpoint note — only when a custom start/end is set; default (base at both ends) reads as before.
    const _rs = jobRouteEndpointLabel(j.routeStart), _re = jobRouteEndpointLabel(j.routeEnd);
    const _ends = (_rs || _re) ? ` <span class="muted">· ${_rs ? "from " + esc(_rs) : "from base"} → ${_re ? "to " + esc(_re) : "to base"}</span>` : "";
    const _srcTag = _routeSrc === "roads" ? ` <span class="muted">(via roads)</span>` : _routeSrc === "manual" ? ` <span class="muted">(manual)</span>` : "";
    h += `<div class="sub" style="margin-top:10px;white-space:normal">🧭 Est. route: ~<b>${j.estRouteMiles} mi</b> <b>round trip</b>${_srcTag}${_n ? ` across ${_n} stop${_n > 1 ? "s" : ""}${addr ? " + job site" : ""}` : ""}${_ends} <span class="muted">· full loop base→stops→site→base, a cross-check — not the billed miles</span></div>`;
    if (_confMiles > 0) { const _pct = Math.round(_confMiles / j.estRouteMiles * 100); h += `<div class="sub" style="margin-top:2px;white-space:normal">🚗 Odometer of record: <b>${Math.round(_confMiles * 10) / 10} mi</b> <span class="muted">(${_pct}% of the estimate — odometer wins)</span></div>`; }
  } else if (_routeSrc === "none") {
    // the map tried and couldn't route (offline / unroutable address) + no manual miles set — never a 1.3× guess.
    h += `<div class="sub muted" style="margin-top:10px;white-space:normal">🧭 The map couldn't route this${jobCanEditPlan() ? " — add manual route miles below to get an estimate" : "; ask an owner to add manual route miles"}.</div>`;
  }
  // 🗺 View route (owner/admin) — deep-link to the read-only GPS route-review page for THIS job (js/91).
  if ((typeof jobCanEditPlan === "function") && jobCanEditPlan() && typeof openRouteReview === "function") {
    h += `<button class="btn ghost sm" style="margin-top:10px" onclick="openRouteReview('${j.id}')">🗺 View route</button>`;
  }
  h += `</div>`;

  // 1z) Route / stops editor (owner/admin) — surfaced ON the job page (not just the editor modal). Writes the
  // SAME j.plannedStops[] the modal editor writes, via job-page handlers that persist immediately + recompute
  // the mileage estimate. Crew see the labeled links above but not this editor.
  h += jobPageRouteCard(j);

  // 1a) Work days — fast, low-friction multi-day editing from the field, without opening the full job editor.
  // Compact chip list of the job's work days (jobWorkDays), today's chip marked, start-day un-removable;
  // "+ Add today" is a one-tap no-modal add; "+ Add another day" opens a small mini-calendar-only picker.
  h += jobPageWorkDaysCard(j);

  // 1a2) Crew — availability-aware editor (owner/admin) writing j.crew directly (like the on-page route editor,
  // not the modal). Crew see read-only chips. Mirrors js/09 renderJobCrew's availability badges + conflict flags.
  h += jobPageCrewCard(j);

  // 1b) Part of a bigger job? — file this under a parent (e.g. a dump run under a tree job); its costs roll up.
  // sharedJobIds[] generalizes the old scalar parentJobId (0/1/N jobs); this single-select stays the UNCHANGED
  // common-case UI (1 parent) and writes sharedJobIds=[oneId] under the hood — the multi-job case is the new
  // "🔀 Split across other jobs" picker below, on the OTHER job's page (the one the stop-job is created from).
  const _subs = (typeof subJobsOf === "function") ? subJobsOf(j.id) : [];
  const _opts = (typeof actJ === "function" ? actJ() : []).filter(x => x && x.id !== j.id && !Array.isArray(x.sharedJobIds));
  h += `<div class="card"><label style="margin-top:0">↳ Part of a bigger job?</label><select onchange="jobSetParent('${j.id}',this.value)"><option value="">— standalone job —</option>` + _opts.map(x => `<option value="${x.id}" ${(Array.isArray(j.sharedJobIds) && j.sharedJobIds.length === 1 && j.sharedJobIds[0] === x.id) ? "selected" : ""}>${esc(x.title || "Job")}${x.customerId && typeof custName === "function" ? " · " + esc(custName(x.customerId)) : ""}${x.date ? " · " + fmtDate(x.date) : ""}</option>`).join("") + `</select>`;
  if (Array.isArray(j.sharedJobIds) && j.sharedJobIds.length === 1) h += `<div class="sub" style="margin-top:6px;white-space:normal">Its mileage, dump fees &amp; time roll up into that job's cost.</div>`;
  else if (Array.isArray(j.sharedJobIds) && j.sharedJobIds.length > 1) {
    const _names = j.sharedJobIds.map(id => { const oj = (typeof actJ === "function" ? actJ() : []).find(x => x.id === id); return oj ? (oj.title || "Job") : null; }).filter(Boolean);
    h += `<div class="sub" style="margin-top:6px;white-space:normal">Split evenly across ${j.sharedJobIds.length} jobs: ${_names.map(esc).join(", ")}.</div>`;
  } else if (Array.isArray(j.sharedJobIds) && j.sharedJobIds.length === 0) {
    h += `<div class="sub" style="margin-top:6px;white-space:normal">Marked as general business overhead — not charged to any job.</div>`;
  }
  if (_subs.length) h += `<div class="sub" style="margin-top:8px;font-weight:700">Stops rolled into this job:</div>` + _subs.map(sj => {
    const n = Math.max(1, (sj.sharedJobIds || []).length);
    const _total = (typeof plExpenses === "function" ? plExpenses(sj).filter(x => x && !x.deleted).reduce((s, e) => s + (+e.amount || 0), 0) : 0) + (typeof plMaterials === "function" ? plMaterials(sj).filter(x => x && !x.deleted).reduce((s, e) => s + (+e.amount || 0), 0) : 0);
    const _share = _total / n;
    const _assignee = (sj.crew && sj.crew[0] && typeof userName === "function") ? (userName(sj.crew[0]) || "") : "";
    const _others = (sj.sharedJobIds || []).filter(id => id !== j.id).map(id => { const oj = (typeof actJ === "function" ? actJ() : []).find(x => x.id === id); return oj ? (oj.title || "Job") : null; }).filter(Boolean);
    return `<div class="li" onclick="openJobPage('${sj.id}')" style="cursor:pointer"><div class="grow"><div class="nm" style="font-size:14px;white-space:normal">${(typeof stopEmoji === "function" ? stopEmoji(sj.stopKind) : "🔀")} ${esc(sj.title || "Job")}${_assignee ? " · " + esc(_assignee) : ""}${sj.date ? " · " + fmtDate(sj.date) : ""}</div><div class="sub" style="white-space:normal">${money(_total)} total${n > 1 ? ` · split ${n} ways${_others.length ? " with " + _others.map(esc).join(", ") : ""} · this job's share ${money(_share)}` : ""}</div></div><span class="sub">open →</span></div>`;
  }).join("");
  h += `</div>`;

  // 2) Load checklist — load the truck before you drive. Prominent progress count (N/M loaded) + a
  // needs-cleaning badge on any flagged item (ties Part A + B: "grab the chainsaw — it needs cleaning first").
  const _eq = (j.equipment || []).filter(e => e && e.itemId);
  const _loadedN = _eq.filter(e => e.loaded).length;
  const _allLoaded = _eq.length && _loadedN === _eq.length;
  const _prog = _eq.length ? ` <span class="badge" style="background:${_allLoaded ? "var(--accent)" : "var(--soft)"};color:${_allLoaded ? "#fff" : "var(--muted)"};margin-left:2px">${_loadedN}/${_eq.length} loaded</span>` : "";
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">🧰 Load checklist${_prog} <span class="sub" style="font-weight:400">· check off as you load</span></div>`;
  h += _eq.length ? _eq.map(e => { const it = (typeof eqItemById === "function") ? eqItemById(e.itemId) : null; const nm = it ? (it.name || e.itemId) : e.itemId; const dirty = (it && it.needsCleaning) ? ` <span class="badge" style="background:#b8860b;color:#fff">🧽 needs cleaning</span>` : ""; return `<label class="li" style="cursor:pointer"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal;${e.loaded ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(nm)}${dirty}</div></div><div class="row" style="gap:10px;align-items:center"><span class="sub">×${e.qty || 1}</span><input type="checkbox" style="width:22px;height:22px" ${e.loaded ? "checked" : ""} onchange="jobToggleLoaded('${j.id}','${esc(e.itemId)}')"></div></label>`; }).join("") : `<div class="muted">No equipment assigned to this job.</div>`;
  h += `</div>`;

  // 3) Time clock — each person clocks in with their own vehicle + odometer
  h += `<div class="card" style="border-left:5px solid var(--accent)"><div style="font-weight:800;margin-bottom:8px">⏱️ Time clock</div>`;
  const _estEach = (typeof jobEstHrsEach === "function") ? jobEstHrsEach(j) : 0, _estCrew = (typeof jobEstCrew === "function") ? jobEstCrew(j) : 1, _estCH = (typeof jobEstCrewHrs === "function") ? jobEstCrewHrs(j) : 0, _actCH = (typeof jobClockedHrs === "function") ? jobClockedHrs(j) : 0;
  if (_estCH > 0 || _actCH > 0) {
    let _cmp = "";
    if (_estCH > 0 && _actCH > 0) { const _p = Math.round(_actCH / _estCH * 100); _cmp = ` · logged <b>${_actCH}</b> (${_p}% of est${j.done ? (_actCH > _estCH ? ` · ${(_actCH - _estCH).toFixed(1)}h over` : ` · ${(_estCH - _actCH).toFixed(1)}h under`) : ""})`; }
    else if (_actCH > 0) _cmp = ` · logged <b>${_actCH}</b> crew-hrs so far`;
    h += `<div class="sub" style="margin-bottom:8px;white-space:normal">📐 Estimated <b>${_estCH || "—"} crew-hrs</b>${_estEach ? ` (~${_estEach} hr each · ${_estCrew} ${_estCrew === 1 ? "person" : "people"})` : ""}${_cmp}. <span style="color:var(--muted)">Breaks don't count — clock out for lunch, back in after.</span></div>`;
  }
  // Effective field pay $/hr — now derived from CLOCKED time (jobHourly reads the timeclock, not typed-in hours).
  // No clocked time yet → prompt to clock in rather than show a stale number.
  const _hh = (typeof jobHourly === "function") ? jobHourly(j) : null;
  if (_hh && _hh.perHr != null) h += `<div class="sub" style="margin-bottom:8px;white-space:normal">💵 Effective field pay: <b style="${_hh.perHr < 35 ? "color:var(--danger)" : _hh.perHr >= 45 ? "color:var(--accent)" : ""}">${money(_hh.perHr)}/hr each</b> · ${_hh.crew}p × ${_hh.personHrs.toFixed(1)} crew-hrs clocked · cost ${money(_hh.cost)} · profit ${money(_hh.profit)}</div>`;
  else if (_hh && _hh.price > 0) h += `<div class="sub" style="margin-bottom:8px;white-space:normal">💵 <span style="color:var(--muted)">Clock in to see the real $/hr — pay is derived from clocked time now.</span></div>`;
  if (onJob.length) h += `<div class="sub" style="margin-bottom:8px">On this job now: ${onJob.map(e => `<b>${esc((typeof userName === "function" ? userName(e.userId) : "") || "crew")}</b>${e.vehicle ? " · " + esc(e.vehicle) : ""}`).join(" · ")}</div>`;
  if (openThis) h += `<div class="sub">You're clocked in since <b>${hhmm(openThis.clockIn)}</b>${openThis.vehicle ? " · " + esc(openThis.vehicle) : ""}</div>${_estEach ? `<div class="sub" style="margin-top:2px;color:var(--brand-text);font-weight:600">⏱ Likely finish ~${hhmm(openThis.clockIn + _estEach * 3600000)} (your ~${_estEach} hr share, excl. breaks)</div>` : ""}<button class="btn danger" style="margin-top:8px;width:100%;padding:13px" onclick="tcClockOut('${openThis.id}')">Clock out</button>`;
  else if (openOther) { const oj = (typeof actJ === "function") ? actJ().find(x => x.id === openOther.jobId) : null; h += `<div class="note">You're clocked into <b>${esc(oj ? (oj.title || "another job") : "another job")}</b> — clock out of it first.</div><button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="tcClockOut('${openOther.id}')">Clock out of that job</button>`; }
  // SHARED clock-in flow (js/38 tcClockInFormHTML) PRE-SCOPED to this job — the grouped vehicle dropdown +
  // separate trailer dropdown + rider-role + start-odometer + route estimate. Replaces the OLD free-text vehicle
  // input that resolved empty and blocked the driver clock-in. riderRole + vehicle-owner reimbursement preserved.
  else h += (typeof tcClockInFormHTML === "function" ? tcClockInFormHTML(j.id) : "") + `<div class="sub" style="margin-top:8px;white-space:normal">🚗 <b>Clock in when you leave for the job</b> (not when you arrive) — keeps the time estimate honest.</div>`;
  h += `</div>`;

  // 4) Job photos — documentation gallery, inline so anyone who opens the job sees them
  const atts = (j.attachments || []).filter(a => a && !a.deleted);
  h += `<div class="card"><div style="font-weight:800;margin-bottom:8px">🖼 Job photos <span class="sub" style="font-weight:400">· documentation</span></div>`;
  if (atts.length) h += `<div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:8px">` + atts.map(a => `<a href="${upUrl(a.id)}" target="_blank" rel="noopener"><img src="${upUrl(a.id)}" style="width:100px;height:100px;object-fit:cover;border-radius:8px;border:1px solid var(--line)" loading="lazy"></a>`).join("") + `</div>`;
  else h += `<div class="muted" style="margin-bottom:8px">No photos yet.</div>`;
  h += `<input type="file" id="job_photo" accept="image/*" style="display:none" onchange="jobAddPhoto('${j.id}',this)"><button class="btn acc" style="width:100%" onclick="document.getElementById('job_photo').click()">📷 Add photo</button></div>`;

  // 5) Expenses & receipts — amount + what for (required), receipt photo optional + collapsed, optional fault attribution
  const _members = (typeof schedMembers === "function") ? schedMembers() : [];
  const _bd = (typeof jobCostBreakdown === "function") ? jobCostBreakdown(j) : { mileage: 0, jobExp: 0, materials: 0, tool: 0 };
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">💵 Expenses &amp; receipts${expTotal ? ` · <span style="color:var(--accent)">${money(expTotal)}</span>` : ""}</div>`;
  // WHERE this job's cost splits (mileage · job expense · pass-through materials — a reusable tool is business overhead, not here)
  h += `<div class="sub" style="white-space:normal;margin-bottom:8px">Job cost: mileage <b>${money(_bd.mileage)}</b> · job <b>${money(_bd.jobExp)}</b> · materials <b>${money(_bd.materials)}</b>${_bd.tool > 0 ? ` <span class="muted">· 🔧 tools ${money(_bd.tool)} (business overhead, not this job)</span>` : ""}</div>`;
  // virtual MILEAGE line — derived, read-only (not a receipt): estimate now, confirmed odometer once clocked
  h += `<div class="li"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal">🛣 Mileage <span class="sub" style="font-weight:400">· ${money(_bd.mileage)}</span></div><div class="sub" style="white-space:normal">estimate vs confirmed odometer — auto from the route/time clock at $${(typeof FIN !== "undefined" ? FIN.MILEAGE_RATE : 0.725)}/mi, not a receipt</div></div></div>`;
  h += exps.length ? exps.map(e => { const _fm = e.faultMemberId ? ((typeof userName === "function" ? userName(e.faultMemberId) : "") || "someone") : ""; return `<div class="li"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal">${money(e.amount)}${e.vendor ? " <b>" + esc(e.vendor) + "</b>" : ""} <span class="sub" style="font-weight:400">${esc(e.desc || "")}</span></div><div class="sub">${e.by ? esc(e.by) + " · " : ""}${e.ts && typeof relTime === "function" ? relTime(e.ts) : ""}${_fm ? ` · <span style="color:var(--danger);font-weight:700">⚠ ${esc(_fm)}'s mistake — docks their payout</span>` : ""}</div></div><div class="row" style="gap:8px;align-items:center">${e.receiptId ? `<a class="btn ghost sm" href="${upUrl(e.receiptId)}" target="_blank" rel="noopener">📎 receipt</a>` : `<span class="sub" style="color:var(--muted)">no receipt</span>`}<button class="btn ghost sm" onclick="jobDelExpense('${j.id}','${e.id}')">✕</button></div></div>`; }).join("") : `<div class="muted">No expenses logged. Enter the amount + what it was for; a receipt photo is optional.</div>`;
  const _faults = {}; exps.forEach(e => { if (e.faultMemberId) _faults[e.faultMemberId] = (_faults[e.faultMemberId] || 0) + (+e.amount || 0); });
  const _fkeys = Object.keys(_faults);
  if (_fkeys.length) h += `<div class="note" style="margin-top:8px;border-left:3px solid var(--danger);white-space:normal">⚠ <b>Fault docks on this job:</b> ${_fkeys.map(id => `${esc((typeof userName === "function" ? userName(id) : "") || "?")} <b>${money(_faults[id])}</b>`).join(" · ")} — comes out of their payout, not the crew's.</div>`;
  h += `<div class="row" style="gap:8px;margin-top:10px"><input id="exp_amt" type="number" inputmode="decimal" placeholder="$" style="flex:0 0 80px"><input id="exp_vendor" placeholder="Vendor / store" style="flex:2"></div>`;
  h += `<input id="exp_desc" placeholder="What for — dump fee, materials… (required)" style="margin-top:6px">`;
  h += `<label style="margin-top:8px">Whose mistake caused this? <span class="sub">(optional — docks <i>their</i> payout, not the whole crew's)</span></label><select id="exp_fault"><option value="">— nobody's fault / shared job cost —</option>${_members.map(u => `<option value="${esc(u.id)}">${esc(u.username)}</option>`).join("")}</select>`;
  // REUSABLE-TOOL escape hatch — a chainsaw/pressure washer bought here is CAPITAL/overhead, not this job's cost.
  // Checked → jobAddExpense writes it to the org business `expenses[]` (category tools/equipment), NOT job.expenses,
  // so it never dents this job's profit. (New tools; existing tool receipts are auto-reclassified by the migration.)
  h += `<label class="li" style="cursor:pointer;margin-top:8px"><input type="checkbox" id="exp_tool" style="width:20px;height:20px;flex:0 0 auto"><div class="grow"><div class="nm" style="font-size:14px;white-space:normal">🔧 Reusable tool (business expense, not this job)</div><div class="sub" style="white-space:normal">A chainsaw, pressure washer, etc. — capital/overhead. Logged to the business, kept off this job's cost.</div></div></label>`;
  h += `<input type="file" id="exp_receipt" accept="image/*" style="display:none" onchange="var l=document.getElementById('exp_receipt_lbl');if(l)l.textContent='✓ Receipt ready'"><div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost grow" onclick="document.getElementById('exp_receipt').click()"><span id="exp_receipt_lbl">📎 Receipt (optional)</span></button><button class="btn acc grow" id="exp_add_btn" onclick="jobAddExpense('${j.id}')">+ Add expense</button></div><button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="jobOpenSplitPicker('${j.id}','expense')">🔀 Split across other jobs / mark as generic</button></div>`;

  // 5a) Pass-through materials — billed to the customer at cost (reimbursed), tracked SEPARATELY from real expenses + their own receipt pile
  const mats = (j.materials || []).filter(x => x && !x.deleted);
  const matTotal = mats.reduce((s, e) => s + (+e.amount || 0), 0);
  h += `<div class="card" style="border-left:5px solid #b8860b"><div style="font-weight:800;margin-bottom:4px">🧱 Pass-through materials${matTotal ? ` · <span style="color:#b8860b">${money(matTotal)}</span>` : ""}</div>`;
  h += `<div class="sub" style="margin-bottom:6px;white-space:normal">Materials billed to the customer at cost (pavers, rock, sand, edging…). Reimbursed — not your expense; kept off the real-expense pile but counted as job cost so margin stays honest.</div>`;
  h += mats.length ? mats.map(e => `<div class="li"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal">${money(e.amount)}${e.vendor ? " <b>" + esc(e.vendor) + "</b>" : ""} <span class="sub" style="font-weight:400">${esc(e.desc || "")}</span></div><div class="sub">${e.by ? esc(e.by) + " · " : ""}${e.ts && typeof relTime === "function" ? relTime(e.ts) : ""}</div></div><div class="row" style="gap:8px;align-items:center">${e.receiptId ? `<a class="btn ghost sm" href="${upUrl(e.receiptId)}" target="_blank" rel="noopener">📎 receipt</a>` : `<span class="sub" style="color:var(--muted)">no receipt</span>`}<button class="btn ghost sm" onclick="jobDelMaterial('${j.id}','${e.id}')">✕</button></div></div>`).join("") : `<div class="muted">No materials logged. Enter the amount + what it was; the receipt photo is optional.</div>`;
  h += `<div class="row" style="gap:8px;margin-top:10px"><input id="mat_amt" type="number" inputmode="decimal" placeholder="$" style="flex:0 0 80px"><input id="mat_vendor" placeholder="Vendor / store" style="flex:2"></div>`;
  h += `<input id="mat_desc" placeholder="What — pavers, base rock, edging… (required)" style="margin-top:6px">`;
  h += `<input type="file" id="mat_receipt" accept="image/*" style="display:none" onchange="var l=document.getElementById('mat_receipt_lbl');if(l)l.textContent='✓ Receipt ready'"><div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost grow" onclick="document.getElementById('mat_receipt').click()"><span id="mat_receipt_lbl">📎 Receipt (optional)</span></button><button class="btn acc grow" id="mat_add_btn" onclick="jobAddMaterial('${j.id}')">+ Add material</button></div><button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="jobOpenSplitPicker('${j.id}','material')">🔀 Split across other jobs / mark as generic</button></div>`;

  // 6) Notes
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">📝 Notes <span class="sub" style="font-weight:400">· Cap learns from these</span></div>
    <textarea id="job_notes" style="min-height:64px" placeholder="What happened, access notes, gotchas…">${esc(j.notes || "")}</textarea>
    <button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="jobSaveNotes('${j.id}')">Save notes</button></div>`;

  // 6b) Ask Cap about THIS job — context-aware (Cap pulls the job's customer/address/notes/equipment)
  const me2 = (typeof curUser === "function") ? curUser() : null;
  const capTid = "thr_job_" + j.id;   // ONE shared thread per job — the whole crew + Cap share it
  const _legacyPrefix = capTid + "_";  // tolerate un-migrated per-user threads (thr_job_<id>_<uid>) so no message is lost
  const capMsgs = (D().messages || []).filter(m => m && !m.kind && !m.deleted && (m.threadId === capTid || (m.threadId || "").indexOf(_legacyPrefix) === 0)).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">💬 Ask Cap <span class="sub" style="font-weight:400">· attach a photo</span></div>`;
  h += capMsgs.length
    ? capMsgs.slice(-6).map(m => { const isCap = m.senderId === "__ceo__" || m.senderId === "__cap__"; const _ma = (m.attachments || []).filter(a => a && a.id && !a.deleted); return `<div class="li" style="${isCap ? "background:var(--soft)" : ""}"><div class="grow"><div class="sub" style="font-weight:700">${isCap ? "🤖 Cap" : esc(m.senderLabel || "You")} <span style="font-weight:400">· ${typeof relTime === "function" ? relTime(m.ts) : ""}</span></div><div style="white-space:pre-wrap">${esc(m.body)}</div>${_ma.map(a => `<a href="${upUrl(a.id)}" target="_blank" rel="noopener"><img src="${upUrl(a.id)}" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid var(--line);margin-top:6px" loading="lazy"></a>`).join("")}</div></div>`; }).join("")
    : `<div class="muted">Ask Cap anything about this job — he knows the customer, address, notes &amp; equipment. e.g. "Are we providing the pavers, or is it client-provided?"</div>`;
  h += `<textarea id="jobcap_q" style="min-height:48px;margin-top:8px" placeholder="Ask Cap… (e.g. send a photo of the spot and ask what base it needs)"></textarea><input type="file" id="jobcap_photo" accept="image/*" style="display:none" onchange="var l=document.getElementById('jobcap_photo_lbl');if(l)l.textContent='✓ Photo ready'"><div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost grow" onclick="document.getElementById('jobcap_photo').click()"><span id="jobcap_photo_lbl">📷 Attach photo</span></button><button class="btn acc grow" onclick="jobAskCap('${j.id}')">💬 Ask Cap</button></div></div>`;

  // 6c) 💵 Invoice & payment — the one place to bill + take payment on an accepted job. REUSES the exact finance
  //     mutators (invMark js/46, recordPayment js/50, snapshotQuoteVersion js/90 like wizSetFinal, syncQuoteIncome)
  //     so the money side can't drift from the wizard. Touches ONLY finalPrice/invoiced/payments/paymentLink —
  //     never items/q.total (those stay in the wizard for versioning). Crew see read-only amounts; edit controls
  //     are gated to owner/admin (jobCanEditPlan). Resolves the linked quote the same way the workStage badge does.
  h += `<div class="card" style="border-left:5px solid var(--brand)"><div style="font-weight:800;margin-bottom:6px">💵 Invoice &amp; payment</div>`;
  const _mq = (typeof actQ === "function") ? (j.quoteId ? actQ().find(x => x && x.id === j.quoteId) : actQ().find(x => x && x.jobId === j.id)) : null;
  if (_mq) {
    const _tot = (typeof quoteEffectiveTotal === "function") ? quoteEffectiveTotal(_mq) : (+(_mq.finalPrice || _mq.total) || 0);
    const _paid = (typeof quotePaidAmt === "function") ? quotePaidAmt(_mq) : 0;
    const _bal = (typeof quoteBalAmt === "function") ? quoteBalAmt(_mq) : Math.max(0, _tot - _paid);
    const _canEdit = jobCanEditPlan();
    h += `<div class="sub" style="white-space:normal">Invoice <b>${money(_tot)}</b>${_paid > 0 ? ` · ${money(_paid)} paid · <b>${money(_bal)} owed</b>` : ""}${_mq.finalPrice ? ` <span class="muted">(quote was ${money(_mq.total || 0)})</span>` : ""}</div>`;
    if (_mq.invoiced) h += `<div class="sub" style="margin-top:4px;color:var(--accent);font-weight:700">✓ Invoiced${_mq.invoiceNo ? ` #${esc(_mq.invoiceNo)}` : ""}${_mq.invoicedDate ? " · " + fmtDate(_mq.invoicedDate) : ""}</div>`;
    if (_mq.paid) h += `<div class="sub" style="margin-top:4px;color:var(--accent);font-weight:800">✓ Paid in full${_mq.paidDate ? " · " + fmtDate(_mq.paidDate) : ""}</div>`;
    if (_mq.paymentLink) h += `<div style="margin-top:8px"><a class="btn acc sm" href="${esc(_mq.paymentLink)}" target="_blank" rel="noopener">💳 Pay now</a></div>`;
    if (_canEdit) {
      h += `<div class="row" style="gap:8px;margin-top:10px">`;
      if (!_mq.invoiced) h += `<button class="btn acc grow" onclick="invMark('${_mq.id}')">🧾 Mark invoiced</button>`;
      h += `<button class="btn ${_mq.paid ? "ghost" : "acc"} grow" onclick="recordPayment('${_mq.id}')">💵 ${_mq.paid ? "Payments" : "Record payment"}</button>`;
      h += `</div>`;
      // Final price charged — mirrors wizSetFinal (finalPrice + version snapshot). NEVER touches items/q.total.
      h += `<label style="margin-top:10px">Final price charged <span class="sub">(if different from the ${money(_mq.total || 0)} quote)</span></label>`;
      h += `<div class="row" style="gap:8px"><input id="job_final" type="number" inputmode="decimal" placeholder="${_mq.total || 0}" value="${_mq.finalPrice || ""}" style="flex:1"><button class="btn ghost sm" onclick="jobPageSaveFinal('${j.id}')">Save</button></div>`;
      h += `<input id="job_adjnote" placeholder="Reason (e.g. added a step, gave a discount)" value="${esc(_mq.adjNote || "")}" style="margin-top:6px">`;
      // Stripe / pay-now link — display-only field (no finance code reads paymentLink).
      h += `<label style="margin-top:10px">Payment link <span class="sub">(Stripe / pay-now URL — shown to the customer)</span></label>`;
      h += `<div class="row" style="gap:8px"><input id="job_paylink" placeholder="https://…" value="${esc(_mq.paymentLink || "")}" style="flex:1"><button class="btn ghost sm" onclick="jobPageSetPayLink('${j.id}')">Save</button></div>`;
      h += `<div class="sub" style="margin-top:8px;white-space:normal">Item &amp; line-price change orders stay in the full quote (📜 version history) — this card only sets the final charge, invoice &amp; payment.</div>`;
    }
  } else {
    h += `<div class="muted">No quote is linked to this job yet.</div>`;
  }
  h += `</div>`;

  // 7) Change order — a change order is an EDIT to the SAME quote, saved as a version (not a second record).
  //    Editing the full quote updates the customer's price IN PLACE (one invoice per job — no new invoice #);
  //    once the quote is committed (accepted/invoiced/paid) each change is logged to q.versions[] for review.
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">🧾 Change order</div>`;
  if (j.quoteId) {
    const _cq = (typeof actQ === "function") ? actQ().find(x => x && x.id === j.quoteId) : null;
    h += `<div class="sub" style="margin-bottom:8px;white-space:normal">Something changed on-site? Edit the full quote — size · materials · price. The customer's price updates in place; if the quote's already accepted or invoiced, each change is saved to its version history (no new invoice number).</div>`;
    h += `<button class="btn acc" style="width:100%;text-align:left" onclick="openQuote('${j.quoteId}')">🧾 Make a change order — edit the full quote</button>`;
    const _vn = (_cq && Array.isArray(_cq.versions)) ? _cq.versions.length : 0;
    const _canReview = (typeof isOwner === "function" && isOwner()) || (typeof canDo === "function" && canDo("manage-members"));
    if (_vn && _canReview) h += `<button class="btn ghost sm" style="width:100%;margin-top:8px;text-align:left" onclick="quoteVersionHistory('${j.quoteId}')">📜 Version history (${_vn})</button>`;
    // Manual "send updated quote" — reuses the existing print/share path; it never auto-emails the customer.
    h += `<button class="btn ghost sm" style="width:100%;margin-top:8px;text-align:left" onclick="jobSendUpdatedQuote('${j.quoteId}')">📤 Send updated quote</button>`;
  } else {
    h += `<div class="muted">No quote is linked to this job yet.</div>`;
  }
  h += `</div>`;

  // 8) Done + actions
  h += `<button class="btn ${j.done ? "ghost" : "acc"}" style="width:100%;margin-top:4px" onclick="toggleJob('${j.id}')">${j.done ? "↩ Reopen job" : "✓ Mark job done"}</button>`;
  if (typeof jobTemplates === "function") h += `<button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="jobSaveAsTemplate('${j.id}')">⭐ Save as a common job (reuse this)</button>`;
  // (Google-review BUTTON removed per Ray — the job-done auto-prompt (js/51 reviewPrompt, fired from js/09 toggleJob)
  //  still asks at the right moment; reviewAsk() itself stays (used to SET the review link from js/18 + js/51).)
  if (jobCanEditPlan()) h += `<button class="btn acc sm" style="width:100%;margin:8px 0 6px" onclick="openJob('${j.id}')">✏️ Edit job — title · crew · date · notes</button>`;
  if (typeof isOwner === "function" && isOwner()) h += `<button class="btn ghost sm" style="width:100%;margin:0 0 14px;color:var(--danger)" onclick="delJob('${j.id}')">🗑 Delete job (to Archive, 60-day undo)</button>`;
  return h;
}

/* ON-JOB-PAGE crew editor (owner/admin) — availability-aware, writing j.crew DIRECTLY (like jobPageRouteCard
   writes j.plannedStops, vs the modal's JOBCREW staging). Mirrors js/09 renderJobCrew: per active member a
   checkbox + availability badge on the job's date, with the off/timeoff conflict warning preserved verbatim.
   Crew (non-owner/admin) see read-only chips (crewChips). Toggling is jobPageToggleCrew → touch/save/render. */
function jobPageCrewCard(j) {
  const ds = j.date || ((typeof today === "function") ? today() : "");
  const n = (j.crew || []).length;
  let h = `<div class="card"><div style="font-weight:800;margin-bottom:6px">👥 Crew${n ? ` · <span class="sub" style="font-weight:400">${n}</span>` : ""}</div>`;
  if (!jobCanEditPlan()) {
    h += (typeof crewChips === "function") ? crewChips(j) : (((j.crew || []).map(id => esc((typeof userName === "function" ? userName(id) : "") || "")).filter(Boolean).join(", ")) || `<span class="muted">Unassigned</span>`);
    return h + `</div>`;
  }
  const mem = (typeof schedMembers === "function") ? schedMembers() : [];
  if (!mem.length) { h += `<div class="muted">No team accounts to assign — add them in Admin.</div>`; return h + `</div>`; }
  h += mem.map(u => {
    const on = (j.crew || []).indexOf(u.id) >= 0;
    const a = (typeof availOn === "function") ? availOn(u, ds) : { status: "unset", label: "" };
    const conflict = on && (a.status === "off" || a.status === "timeoff");
    return `<label class="li" style="cursor:pointer"><input type="checkbox" style="width:20px;height:20px;flex:0 0 auto" ${on ? "checked" : ""} onchange="jobPageToggleCrew('${j.id}','${u.id}')">
      <div class="grow"><div class="nm" style="font-size:15px">${esc(u.username)}</div><div class="sub">${esc(a.label || "")}${conflict ? ` <span style="color:var(--danger)">⚠ not available</span>` : ""}</div></div>
      ${(typeof availBadge === "function") ? availBadge(u, ds) : ""}</label>`;
  }).join("");
  const free = mem.filter(u => (typeof isFree === "function") ? isFree(u, ds) : true).map(u => u.username);
  h += `<div class="sub" style="margin-top:6px;white-space:normal">${free.length ? `Free on ${fmtDate(ds)}: <b>${free.map(esc).join(", ")}</b>` : `No one is marked available on ${fmtDate(ds)}.`}</div>`;
  return h + `</div>`;
}

/* ON-JOB-PAGE ordered-stops editor (owner/admin). Same data + shape as the js/09 editor-modal stop editor
   (j.plannedStops[] = ordered {id,label,address,lat,lng}) so the two can't drift; the job-page handlers just
   persist immediately (no modal "save" step) and recompute the mileage estimate. Renders from the RAW array so
   the ▲▼✕ indices line up 1:1 with j.plannedStops. */
function jobPageRouteCard(j) {
  if (!jobCanEditPlan()) return "";
  const ps = Array.isArray(j.plannedStops) ? j.plannedStops : [];
  const hb = (typeof homeBase === "function") ? homeBase() : null;
  const baseAddr = (hb && hb.address) ? hb.address : "";
  // Start/End inputs pre-fill with the business home base (default), but are editable per job → j.routeStart /
  // j.routeEnd. When custom, we show the custom address + a "↺ base" reset (clears back to null = use base).
  const startCustom = !!(j.routeStart && j.routeStart.address);
  const endCustom = !!(j.routeEnd && j.routeEnd.address);
  const startVal = startCustom ? j.routeStart.address : baseAddr;
  const endVal = endCustom ? j.routeEnd.address : baseAddr;
  const siteAddr = (typeof jobAddr === "function") ? jobAddr(j) : (j.address || "");
  const endpointRow = (emoji, title, id, value, custom, setFn, resetFn) => `<div style="padding:6px 0">
    <div class="row" style="align-items:center;gap:6px"><div class="nm grow" style="font-size:14px">${emoji} ${title}${custom ? "" : ` <span class="sub" style="font-weight:400">· home base</span>`}</div>${custom ? `<button class="btn ghost sm" style="flex:0 0 auto" onclick="${resetFn}('${j.id}')" title="Reset to home base">↺ base</button>` : ""}</div>
    <div class="acwrap" style="margin-top:4px"><input id="${id}" value="${esc(value)}" placeholder="${baseAddr ? "Address (home base by default)" : "Set the home base in Settings"}" autocomplete="off" onfocus="addrSuggest('${id}','${id}_ac')" oninput="addrSuggest('${id}','${id}_ac')" onchange="${setFn}('${j.id}', this.value)"><div class="acbox" id="${id}_ac"></div></div></div>`;
  let h = `<div class="card"><div style="font-weight:800;margin-bottom:4px">🧭 Route / stops <span class="sub" style="font-weight:400">· ordered — feeds a mileage estimate</span></div>`;
  h += `<div class="sub" style="margin-bottom:8px;white-space:normal">The ordered path the estimate follows, <b>Start → … → End</b>. Use ▲▼ to reorder — the 🏁 <b>job site</b> can sit anywhere in between (e.g. Start → job site → transfer station → End). Start &amp; End default to your home base but you can change either. The crew get labeled directions + one "Full route" link; you get an offline mileage cross-check to the odometer.</div>`;
  // 🏁 START (first point) — editable, pre-filled with home base
  h += endpointRow("🏁", "Start", "jrs_start", startVal, startCustom, "jobPageSetStart", "jobPageResetStart");
  // the COMBINED ordered route (planned stops + the movable job site) from the shared jobRouteOrdered(j).
  // Every row gets ▲▼ (jobPageRouteMove on the COMBINED index); ▲ is disabled on the first row, ▼ on the last.
  // Stop rows keep the ✕ delete (mapped to the stop's RAW plannedStops index, t.raw); the 🏁 job-site row is
  // NON-deletable (no ✕) — it's the job itself, you only move it. "+ Add stop" pushes to the end, then reorder.
  const combo = (typeof jobRouteOrdered === "function") ? jobRouteOrdered(j) : [];
  h += combo.map((t, ci) => {
    const upDis = ci === 0 ? "disabled" : "", dnDis = ci === combo.length - 1 ? "disabled" : "";
    const moveBtns = `<button class="btn ghost sm" ${upDis} onclick="jobPageRouteMove('${j.id}',${ci},-1)" title="Move up">▲</button><button class="btn ghost sm" ${dnDis} onclick="jobPageRouteMove('${j.id}',${ci},1)" title="Move down">▼</button>`;
    if (t.kind === "site") {
      return `<div class="li" style="align-items:center;padding:6px 0"><div class="grow"><div class="nm" style="font-size:14px">${ci + 1}. 🏁 Job site <span class="sub" style="font-weight:400">· the job</span></div>${siteAddr ? `<div class="sub" style="white-space:normal">${esc(siteAddr)}</div>` : `<div class="sub muted">Set the job location above (✏️ Edit location).</div>`}</div><div class="row" style="gap:4px;flex:0 0 auto">${moveBtns}</div></div>`;
    }
    const s = t.stop;
    return `<div class="li" style="align-items:center;padding:6px 0"><div class="grow"><div class="nm" style="font-size:14px;white-space:normal">${ci + 1}. ${esc(s.label || s.address || "Stop")}</div>${s.label && s.address ? `<div class="sub" style="white-space:normal">${esc(s.address)}</div>` : ""}</div><div class="row" style="gap:4px;flex:0 0 auto">${moveBtns}<button class="btn ghost sm" onclick="jobPageStopDel('${j.id}',${t.raw})" title="Remove">✕</button></div></div>`;
  }).join("");
  // BOTH fields search the saved index; picking either fills the other. The Label searches names only (data-savedonly,
  // data-nameinto) and routes the picked address+ref to jps_addr (data-pairaddr); the Address searches saved+OSM and
  // fills the empty Label with the place name (data-pairlabel). jobPageStopAdd reads the ref/coords off jps_addr.
  h += `<div class="row" style="gap:8px;margin-top:8px"><div class="acwrap" style="flex:1 1 140px"><input id="jps_label" placeholder="Name — search places, or type" data-savedonly="1" data-name-into="1" data-pair-addr="jps_addr" onfocus="addrSuggest('jps_label','jps_label_ac')" oninput="addrSuggest('jps_label','jps_label_ac')" autocomplete="off" style="width:100%"><div class="acbox" id="jps_label_ac"></div></div><div class="acwrap" style="flex:1 1 140px"><input id="jps_addr" placeholder="Address — search or type" data-pair-label="jps_label" onfocus="addrSuggest('jps_addr','jps_addr_ac')" oninput="addrSuggest('jps_addr','jps_addr_ac')" autocomplete="off" style="width:100%"><div class="acbox" id="jps_addr_ac"></div></div></div>`;
  h += `<button class="btn acc sm" style="margin-top:6px;width:100%" onclick="jobPageStopAdd('${j.id}')">+ Add stop</button>`;
  // 🏁 END (last point) — editable, pre-filled with home base
  h += endpointRow("🏁", "End", "jrs_end", endVal, endCustom, "jobPageSetEnd", "jobPageResetEnd");
  const _src = (typeof jobRouteMilesSource === "function") ? jobRouteMilesSource(j) : "";
  if (j.estRouteMiles > 0) {
    const _rs = jobRouteEndpointLabel(j.routeStart), _re = jobRouteEndpointLabel(j.routeEnd);
    const _ends = (_rs || _re) ? `${_rs ? esc(_rs) : "base"} → route → ${_re ? esc(_re) : "base"}` : "base → route → base";
    const _how = _src === "roads" ? "via roads" : _src === "manual" ? "manual" : "";
    h += `<div class="sub" style="margin-top:8px;white-space:normal">🧭 Est. route: ~<b>${j.estRouteMiles} mi</b>${_how ? ` <span class="muted">(${_how})</span>` : ""} <span class="muted">(${_ends} — informational, the odometer stays the billed number)</span></div>`;
  } else if (_src === "none") {
    h += `<div class="sub muted" style="margin-top:8px;white-space:normal">🧭 The map couldn't route this — enter manual route miles below.</div>`;
  } else if (ps.length || startCustom || endCustom) h += `<div class="sub muted" style="margin-top:8px;white-space:normal">Computing the road route… the mileage estimate appears once the map answers (needs a home base set in Settings).</div>`;
  // 🚗 MANUAL route miles (round-trip) — the fallback for when the map can't route (offline / a bad-geocode address).
  // OSRM road miles win when available; this manual value takes over when they aren't. Owner/admin only.
  h += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)"><label style="margin-top:0">🚗 Route miles <span class="sub" style="font-weight:400">(manual, if the map can't route — round-trip)</span></label><div class="row" style="gap:8px"><input id="jrm_miles" type="number" inputmode="decimal" value="${(j.manualRouteMiles > 0) ? j.manualRouteMiles : ""}" placeholder="round-trip miles" style="flex:1" onchange="jobSetManualRouteMiles('${j.id}', this.value)"><button class="btn ghost sm" onclick="jobSetManualRouteMiles('${j.id}', document.getElementById('jrm_miles').value)">Save</button></div><div class="sub muted" style="margin-top:4px;white-space:normal">${(j.manualRouteMiles > 0) ? "✓ Using your manual miles — this overrides the map + the odometer estimate." : "Enter the round-trip miles to override the map/odometer estimate for this job."}</div></div>`;
  return h + `</div>`;
}
/* EDIT LOCATION modal (owner/admin) — pick a saved property OR type a free-text address → j.address (jobAddr's
   fallback). Lets a customer-less job (airport pickup) get a real location. */
window.jobEditLoc = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const props = (typeof actProps === "function") ? actProps() : [];
  modal("📍 Job location", `
    <p class="muted" style="margin-bottom:8px">Set where this job is. Pick a saved property (uses its address + map pin), or type any address — handy for a job with no customer address (an airport pickup, a dump site).</p>
    <label style="margin-top:0">Property <span class="sub">(optional — uses its saved location)</span></label>
    <select id="jloc_prop"><option value="">— none —</option>${props.map(p => `<option value="${esc(p.id)}" ${j.propertyId === p.id ? "selected" : ""}>${esc(p.label || p.address || "Property")}${p.lat == null ? " (no location)" : ""}</option>`).join("")}</select>
    <label>Or type an address</label>
    <div class="acwrap"><input id="jloc_addr" value="${esc(j.address || "")}" placeholder="street, town, ST zip — or e.g. 'Norfolk Airport (ORF)'" onfocus="addrSuggest('jloc_addr','jloc_addr_ac')" oninput="addrSuggest('jloc_addr','jloc_addr_ac')" autocomplete="off"><div class="acbox" id="jloc_addr_ac"></div></div>
    <div class="sub" style="margin-top:6px;white-space:normal">A property's address wins if both are set. Leave the property on "none" to use the typed address.</div>
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="jobSaveLoc('${j.id}')">Save location</button>`);
};
window.jobSaveLoc = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  j.propertyId = val("jloc_prop") || "";
  j.address = (val("jloc_addr") || "").trim();
  // saved-location pre-read (js/69 pattern): if the address was PICKED from a saved PROPERTY and no property was
  // explicitly chosen, adopt it so the job site reuses that property's saved coords — no re-geocode. Job sites stay
  // places-only for manualMiles: we never stamp a placeId onto the job, so the site leg always stays haversine.
  const _li = (typeof document !== "undefined") ? document.getElementById("jloc_addr") : null;
  if (_li && _li.dataset) {
    if (!j.propertyId && _li.dataset.pickPropId) j.propertyId = _li.dataset.pickPropId;
    delete _li.dataset.pickLat; delete _li.dataset.pickLng; delete _li.dataset.pickPlaceId; delete _li.dataset.pickPropId; delete _li.dataset.pickManualMiles;
  }
  if (typeof jobRecalcRouteMiles === "function") jobRecalcRouteMiles(j);   // job-site coords may have changed
  if (typeof touch === "function") touch(j); if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  if (typeof render === "function") render();
};
/* ordered-stop handlers for the job page — write j.plannedStops directly (SAME field as the modal), persist
   immediately, recompute the estimate. Geocode is best-effort via the SHARED js/09 jobStopGeocode (with a
   persist-on-resolve callback so coords + estimate save once OSM answers). */
window.jobPageStopAdd = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const label = (val("jps_label") || "").trim(), address = (val("jps_addr") || "").trim();
  if (!address) { alert("Enter the stop's address."); return; }
  if (!Array.isArray(j.plannedStops)) j.plannedStops = [];
  const s = { id: (typeof uid === "function" ? uid() : String(Math.random())), label: label || address, address: address, lat: null, lng: null };
  // saved-location pre-read (js/69 pattern): a PICKED suggestion carries its exact coords + optional placeId — reuse
  // them + SKIP the OSM geocode (re-geocoding the typed text is what landed Lowe's 400mi off). placeId lets the
  // estimate apply the place's manualMiles override on a base-adjacent leg (js/61 jobRecalcRouteMiles, Phase 3).
  const _si = (typeof document !== "undefined") ? document.getElementById("jps_addr") : null;
  let _picked = false;
  if (_si && _si.dataset) {
    const ds = _si.dataset;
    if (ds.pickLat) { s.lat = +ds.pickLat; s.lng = +ds.pickLng; _picked = true; }   // picked WITH coords → reuse them + skip OSM
    if (ds.pickPlaceId) s.placeId = ds.pickPlaceId;                                  // place ref (coord'd OR not) → placeManualMi override on base-adjacent legs
    // a LAT-LESS place picked from the on-focus pick-list carries its manualMiles but no coords: keep the manualMiles
    // on the stop + DON'T geocode the (bad-geocoding) address, so it still contributes to the estimate via
    // jobRouteExtraManual instead of being dropped as a coord-less waypoint (js/61 jobRouteTaggedSeq).
    if (!_picked && ds.pickManualMiles) { const _mm = parseFloat(ds.pickManualMiles); if (_mm > 0) { s.manualMiles = _mm; _picked = true; } }
    delete ds.pickLat; delete ds.pickLng; delete ds.pickPlaceId; delete ds.pickPropId; delete ds.pickManualMiles;
  }
  j.plannedStops.push(s);
  if (!_picked && typeof jobStopGeocode === "function") jobStopGeocode(s, function () { if (typeof jobRecalcRouteMiles === "function") jobRecalcRouteMiles(j); if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render(); });
  if (typeof jobRecalcRouteMiles === "function") jobRecalcRouteMiles(j);
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
window.jobPageStopMove = function (jobId, i, dir) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const a = Array.isArray(j.plannedStops) ? j.plannedStops : []; const k = i + dir; if (k < 0 || k >= a.length) return;
  const t = a[i]; a[i] = a[k]; a[k] = t;
  if (typeof jobRecalcRouteMiles === "function") jobRecalcRouteMiles(j);
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
window.jobPageStopDel = function (jobId, i) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const a = Array.isArray(j.plannedStops) ? j.plannedStops : []; if (i < 0 || i >= a.length) return;   // i is the stop's RAW plannedStops index (t.raw)
  a.splice(i, 1);
  // keep the movable job site anchored: a stop deleted BEFORE the site shifts the site one slot left; then clamp
  // — if the site now sits at (or past) the end, store null (sticky-last = today's default). jobRouteOrdered
  // also clamp-reads, so a stale value can't over/under-shoot; this just keeps the stored value tidy.
  if (typeof j.sitePos === "number" && j.sitePos >= 0) {
    if (i < j.sitePos) j.sitePos--;
    if (j.sitePos >= a.length) j.sitePos = null;
  }
  if (typeof jobRecalcRouteMiles === "function") jobRecalcRouteMiles(j);
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
/* REORDER the COMBINED route (planned stops + the movable job site) by one slot — the ▲▼ handler on the job-page
   route card. comboIndex indexes jobRouteOrdered(j); dir is -1 (up) / +1 (down). We swap the two adjacent tokens,
   then write back: plannedStops = the stop tokens in their new order, and j.sitePos = the site's new combined
   index — EXCEPT when the site lands at the very end (=== newStops.length) we store null (sticky-last, so the
   default byte-identical path is used). Same persist tail as jobPageStopMove. */
window.jobPageRouteMove = function (jobId, comboIndex, dir) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const tokens = (typeof jobRouteOrdered === "function") ? jobRouteOrdered(j) : [];
  const j2 = comboIndex + dir;
  if (comboIndex < 0 || comboIndex >= tokens.length || j2 < 0 || j2 >= tokens.length) return;
  const t = tokens[comboIndex]; tokens[comboIndex] = tokens[j2]; tokens[j2] = t;   // swap adjacent
  const newStops = tokens.filter(x => x.kind === "stop").map(x => x.stop);
  const siteAt = tokens.findIndex(x => x.kind === "site");
  j.plannedStops = newStops;
  j.sitePos = (siteAt === newStops.length) ? null : siteAt;   // sticky-last: site at the very end → null
  if (typeof jobRecalcRouteMiles === "function") jobRecalcRouteMiles(j);
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
/* ROUTE START / END endpoints (owner/admin) — additive j.routeStart / j.routeEnd = {address,lat,lng} or null.
   null = "use the business home base" (the default + legacy behavior). The editor pre-fills each with the base
   address; if the user leaves it as the base (or clears it) we store null (stay on base), otherwise we store the
   custom address and best-effort geocode it via the SHARED js/09 jobStopGeocode (persist-on-resolve callback →
   coords + estimate save once OSM answers). Recompute the estimate on every edit. */
function jobPageSetEndpoint(jobId, key, v) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const addr = (v || "").trim();
  const hb = (typeof homeBase === "function") ? homeBase() : null;
  const baseAddr = (hb && hb.address) ? hb.address.trim() : "";
  if (!addr || (baseAddr && addr.toLowerCase() === baseAddr.toLowerCase())) {
    j[key] = null;   // empty or same-as-base → default to the business home base
  } else {
    const ep = { address: addr, lat: null, lng: null };
    // saved-location pre-read (js/69 pattern): a PICKED suggestion carries exact coords + optional placeId → reuse
    // them + SKIP geocoding. A place's placeId lets the estimate apply its manualMiles override on the base↔place leg.
    const _ei = (typeof document !== "undefined") ? document.getElementById(key === "routeStart" ? "jrs_start" : "jrs_end") : null;
    if (_ei && _ei.dataset && _ei.dataset.pickLat) {
      ep.lat = +_ei.dataset.pickLat; ep.lng = +_ei.dataset.pickLng;
      if (_ei.dataset.pickPlaceId) ep.placeId = _ei.dataset.pickPlaceId;
      delete _ei.dataset.pickLat; delete _ei.dataset.pickLng; delete _ei.dataset.pickPlaceId; delete _ei.dataset.pickPropId; delete _ei.dataset.pickManualMiles;
      j[key] = ep;   // coords already resolved → no OSM call
    } else {
      j[key] = ep;
      if (typeof jobStopGeocode === "function") jobStopGeocode(j[key], function () { if (typeof jobRecalcRouteMiles === "function") jobRecalcRouteMiles(j); if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render(); });
    }
  }
  if (typeof jobRecalcRouteMiles === "function") jobRecalcRouteMiles(j);
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
}
window.jobPageSetStart = function (jobId, v) { jobPageSetEndpoint(jobId, "routeStart", v); };
window.jobPageSetEnd = function (jobId, v) { jobPageSetEndpoint(jobId, "routeEnd", v); };
window.jobPageResetStart = function (jobId) { jobPageSetEndpoint(jobId, "routeStart", ""); };
window.jobPageResetEnd = function (jobId) { jobPageSetEndpoint(jobId, "routeEnd", ""); };
/* MANUAL route miles (round-trip) fallback for the estimate when the map can't route (owner/admin). Additive
   j.manualRouteMiles: a positive number, else null. OSRM road miles win when available (jobRecalcRouteMiles);
   this is the fallback. Recompute so the estimate + label update immediately; feeds js/52 jobMilesCostEst. */
window.jobSetManualRouteMiles = function (jobId, v) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const n = parseFloat(v);
  j.manualRouteMiles = (n > 0) ? n : null;
  if (typeof jobRecalcRouteMiles === "function") jobRecalcRouteMiles(j);
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};

window.jobSetParent = function (jobId, parentId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  j.parentJobId = parentId || "";   // kept for back-compat/audit trail — unread by new code
  j.sharedJobIds = parentId ? [parentId] : null;   // the model going forward: membership match, not equality
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
window.jobToggleLoaded = function (jobId, itemId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const e = (j.equipment || []).find(x => x.itemId === itemId); if (!e) return;
  e.loaded = !e.loaded; if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
/* Submit-in-flight guards for "+ Add expense" / "+ Add material": a slow save over a weak jobsite
   connection used to look like a no-op, so a tap-happy user would fire the handler a dozen times —
   each one independently reading the SAME amount/vendor/desc/receipt-file off the DOM and creating its
   OWN duplicate record (the June 2026 dupe-material incident: ~20 taps → 20 records, no photo on any of
   them because 20 concurrent uploads of the same file mostly failed under contention). The guard below
   makes every repeat tap while a save is in flight a silent no-op (button also disables + shows
   "Adding…" → "✓ Added" so a slow save is visibly NOT stuck), so at most one record — carrying the one
   photo actually selected — gets created per tap. */
let _jobExpAddBusy = false, _jobExpAddWatchdog = null;
window.jobAddExpense = function (jobId) {
  if (_jobExpAddBusy) return;   // ignore rapid re-taps while a save is already in flight
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const amt = parseFloat(val("exp_amt")); if (!(amt > 0)) { alert("Enter the expense amount."); return; }
  const desc = (val("exp_desc") || "").trim(); if (!desc) { alert("Enter what the expense was for."); return; }
  const vendor = (val("exp_vendor") || "").trim();
  const fault = val("exp_fault") || "";
  const toolBox = document.getElementById("exp_tool");
  const isTool = !!(toolBox && toolBox.checked);   // "reusable tool" → business overhead, NOT this job's cost
  const input = document.getElementById("exp_receipt");
  const file = input && input.files && input.files[0];   // captured NOW, before the lock's async gate — nothing else can read/clear this input until we're done
  const btn = document.getElementById("exp_add_btn");
  _jobExpAddBusy = true; if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
  clearTimeout(_jobExpAddWatchdog); _jobExpAddWatchdog = setTimeout(function () { _jobExpAddBusy = false; }, 20000); // safety: never permanently soft-lock the button if a save hangs
  const finish = function (receiptId) {
    clearTimeout(_jobExpAddWatchdog);
    const by = ((typeof curUser === "function" && curUser()) ? curUser().username : "");
    if (isTool) {
      // reusable tool → the org BUSINESS expenses[] (category tools/equipment), a per-record synced collection —
      // NOT job.expenses, so it never enters this job's cost. Shape matches Finance→Expenses (js/40 saveExpense) +
      // the Receipts business branch (js/87), so it shows up in both.
      const d = D(); if (!Array.isArray(d.expenses)) d.expenses = [];
      const rec = { id: uid(), amount: amt, vendor: vendor, desc: desc, note: desc, category: "tools/equipment", date: (typeof today === "function" ? today() : ""), receiptId: receiptId || null, memberId: "", paidBy: null, by: by, ts: now(), deleted: false, updatedAt: now() };
      d.expenses.push(rec);
      if (typeof touch === "function") touch(rec);
      if (typeof logChange === "function") logChange("create", "expense", rec.id, "Reusable tool → business expense " + money(amt) + (vendor ? " · " + vendor : "") + (desc ? " · " + desc : ""));
      if (typeof save === "function") save();
      if (btn) btn.textContent = "✓ Added (business)";
      setTimeout(function () { _jobExpAddBusy = false; if (typeof render === "function") render(); }, 450);
      return;
    }
    if (!Array.isArray(j.expenses)) j.expenses = [];
    j.expenses.push({ id: uid(), amount: amt, vendor: vendor, desc: desc, category: "job", receiptId: receiptId || null, faultMemberId: fault || null, by: by, ts: now() });
    if (typeof touch === "function") touch(j); if (typeof save === "function") save();
    if (btn) btn.textContent = "✓ Added";
    setTimeout(function () { _jobExpAddBusy = false; if (typeof render === "function") render(); }, 450);
  };
  if (file && typeof jsUpload === "function") jsUpload(file).then(finish).catch(function (e) { alert("Receipt upload failed: " + (e.message || e)); finish(null); });
  else finish(null);
};
window.jobDelExpense = function (jobId, expId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j || !Array.isArray(j.expenses)) return;
  const e = j.expenses.find(x => x && x.id === expId); if (!e) return;
  e.deleted = true; if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
let _jobMatAddBusy = false, _jobMatAddWatchdog = null;
window.jobAddMaterial = function (jobId) {
  if (_jobMatAddBusy) return;   // ignore rapid re-taps while a save is already in flight — this is the June 2026 dupe-material bug
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const amt = parseFloat(val("mat_amt")); if (!(amt > 0)) { alert("Enter the material amount."); return; }
  const desc = (val("mat_desc") || "").trim(); if (!desc) { alert("Enter what the material was."); return; }
  const vendor = (val("mat_vendor") || "").trim();
  const input = document.getElementById("mat_receipt");
  const file = input && input.files && input.files[0];   // captured NOW, before the lock's async gate — nothing else can read/clear this input until we're done
  const btn = document.getElementById("mat_add_btn");
  _jobMatAddBusy = true; if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
  clearTimeout(_jobMatAddWatchdog); _jobMatAddWatchdog = setTimeout(function () { _jobMatAddBusy = false; }, 20000); // safety: never permanently soft-lock the button if a save hangs
  const finish = function (receiptId) {
    clearTimeout(_jobMatAddWatchdog);
    if (!Array.isArray(j.materials)) j.materials = [];
    j.materials.push({ id: uid(), amount: amt, vendor: vendor, desc: desc, receiptId: receiptId || null, by: ((typeof curUser === "function" && curUser()) ? curUser().username : ""), ts: now() });
    if (typeof touch === "function") touch(j); if (typeof save === "function") save();
    if (btn) btn.textContent = "✓ Added";
    setTimeout(function () { _jobMatAddBusy = false; if (typeof render === "function") render(); }, 450);
  };
  if (file && typeof jsUpload === "function") jsUpload(file).then(finish).catch(function (e) { alert("Receipt upload failed: " + (e.message || e)); finish(null); });
  else finish(null);
};
window.jobDelMaterial = function (jobId, mId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j || !Array.isArray(j.materials)) return;
  const e = j.materials.find(x => x && x.id === mId); if (!e) return;
  e.deleted = true; if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};

/* CHANGE ORDERS are now quote VERSIONS (see js/23 wizPersist + js/90-quote-versions.js) — the old
   job.changeOrders[] add-a-line handlers (jobAddChangeOrder/jobDelChangeOrder) were removed. Legacy
   changeOrders are folded into the linked quote's versions[] as history-only entries by the js/02 load()
   migration (never added to the total — they were display-only, read by no finance code). */
/* "📤 Send updated quote" — the MANUAL affordance (Ray's call: no auto-send). Reuses the shared print/share
   helper (js/08 printQuote) by feeding it the stored quote via the same QITEMS/CURQ globals the wizard uses. */
window.jobSendUpdatedQuote = function (quoteId) {
  const q = (typeof actQ === "function") ? actQ().find(x => x && x.id === quoteId) : null;
  if (!q) { alert("No quote is linked to this job."); return; }
  if (typeof QITEMS !== "undefined") QITEMS = (q.items || []).map(it => ({ serviceId: it.serviceId || "", name: it.name || "", unit: it.unit || "quote", price: +it.price || 0, qty: it.qty || 1, cost: +it.cost || 0 }));
  if (typeof CURQ !== "undefined") CURQ = { cust: q.cust || ((q.customerId && typeof custName === "function") ? custName(q.customerId) : ""), address: q.address || "", invoiced: !!q.invoiced, paymentLink: q.paymentLink || "", subtotal: q.subtotal || 0, discount: q.discount || 0, total: (q.finalPrice || q.total || 0) };
  if (typeof printQuote === "function") printQuote();
  else alert("Open the quote to print or share it.");
};
window.jobSaveNotes = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  j.notes = val("job_notes") || "";
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
/* Inline rename (owner/admin) — writes j.title (free text, NOT the service dropdown). Clears the edit flag. */
window.jobPageRename = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const t = (val("job_title") || "").trim();
  if (!t) { alert("Give the job a name."); return; }
  j.title = t;
  window.JOB_TITLE_EDIT = null;
  if (typeof touch === "function") touch(j);
  if (typeof logChange === "function") logChange("update", "job", j.id, "Renamed → " + t);
  if (typeof save === "function") save(); if (typeof render === "function") render();
};
/* Toggle a member on/off j.crew directly (owner/admin) — mirrors js/09 toggleJobCrew but persists to the record
   rather than the modal's JOBCREW staging set. */
window.jobPageToggleCrew = function (jobId, userId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  if (!Array.isArray(j.crew)) j.crew = [];
  const i = j.crew.indexOf(userId);
  if (i >= 0) j.crew.splice(i, 1); else j.crew.push(userId);
  if (typeof touch === "function") touch(j);
  if (typeof logChange === "function") logChange("update", "job", j.id, "Crew → " + j.crew.length + " · " + (j.title || "job"));
  if (typeof save === "function") save(); if (typeof render === "function") render();
};
/* FINAL PRICE CHARGED (owner/admin) — MIRRORS js/23 wizSetFinal exactly: capture prevTotal (quoteEffectiveTotal)
   + prevItems BEFORE the edit, set q.finalPrice (Math.max(0)) + q.adjNote, touch, then snapshotQuoteVersion so a
   committed quote logs a "final-price" version identical to the wizard's. Re-syncs cash-basis income only when the
   quote is already paid. NEVER touches q.items or q.total — item/line change orders stay in the wizard. */
window.jobPageSaveFinal = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const q = (typeof actQ === "function") ? (j.quoteId ? actQ().find(x => x && x.id === j.quoteId) : actQ().find(x => x && x.jobId === j.id)) : null;
  if (!q) { alert("No quote is linked to this job."); return; }
  const prevTotal = (typeof quoteEffectiveTotal === "function") ? quoteEffectiveTotal(q) : (+(q.finalPrice || q.total) || 0);
  const prevItems = JSON.parse(JSON.stringify(q.items || []));
  const v = val("job_final");
  q.finalPrice = (v === "" || v == null) ? 0 : Math.max(0, parseFloat(v) || 0);
  q.adjNote = val("job_adjnote") || "";
  if (typeof touch === "function") touch(q);
  if (typeof snapshotQuoteVersion === "function") snapshotQuoteVersion(q, q.adjNote, "final-price", prevTotal, prevItems);
  if (q.paid && typeof syncQuoteIncome === "function") syncQuoteIncome(q);
  if (typeof logChange === "function") logChange("update", "quote", q.id, "Final price " + money(q.finalPrice || q.total) + (q.cust ? " · " + q.cust : ""));
  if (typeof save === "function") save(); if (typeof render === "function") render();
};
/* Stripe / pay-now link (owner/admin) — display-only (no finance code reads q.paymentLink). */
window.jobPageSetPayLink = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const q = (typeof actQ === "function") ? (j.quoteId ? actQ().find(x => x && x.id === j.quoteId) : actQ().find(x => x && x.jobId === j.id)) : null;
  if (!q) { alert("No quote is linked to this job."); return; }
  const e = (typeof document !== "undefined") ? document.getElementById("job_paylink") : null;
  q.paymentLink = e ? e.value.trim() : "";
  if (typeof touch === "function") touch(q); if (typeof save === "function") save(); if (typeof render === "function") render();
};
window.jobAddPhoto = function (jobId, input) {
  const file = input && input.files && input.files[0]; if (!file) return;
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (typeof jsUpload !== "function") { alert("Photo upload needs a connection."); return; }
  jsUpload(file).then(function (id) {
    if (!Array.isArray(j.attachments)) j.attachments = [];
    j.attachments.push({ id: id, name: file.name || "photo", ts: now() });
    if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
  }).catch(function (e) { alert("Upload failed: " + (e.message || e)); });
};
/* Ask Cap a question scoped to this job — posts to the ONE shared per-job Cap thread (thr_job_<jobId>):
   the whole crew on the job + Cap share it, so everyone sees the same conversation. members carries the
   job crew (drives server push / Cap-reply fan-out); js/47 threadVisible also widens to the live job crew.
   toStrategy marks it a Cap channel; the server tags the projection with jobId so Cap pulls the job's
   customer/address/notes/equipment as context. His reply syncs back here. */
window.jobAskCap = function (jobId) {
  const q = (val("jobcap_q") || "").trim();
  const pinput = document.getElementById("jobcap_photo"); const pfile = pinput && pinput.files && pinput.files[0];
  if (!q && !pfile) return;
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const me = (typeof curUser === "function") ? curUser() : null; if (!me) { alert("Sign in first."); return; }
  const tid = "thr_job_" + jobId;
  const coll = D().messages || (D().messages = []);
  let thr = coll.find(m => m && m.kind === "thread" && m.threadId === tid && !m.deleted);
  const _cust = (j.customerId && typeof custName === "function") ? custName(j.customerId) : "";
  const _jtTitle = "📋 Job: " + (j.title || "Job") + ((_cust && _cust !== "—") ? " · " + _cust : "");   // clear job-scoped title on the Messages page (threadTitle renders this live too)
  const _crew = (Array.isArray(j.crew) ? j.crew.filter(Boolean) : []).slice(); if (_crew.indexOf(me.id) < 0) _crew.push(me.id);   // job crew + me share this thread
  if (!thr) { thr = { id: tid, kind: "thread", threadId: tid, title: _jtTitle, type: "dm", toStrategy: true, jobId: jobId, members: _crew, createdBy: me.id, deleted: false, updatedAt: now() }; coll.push(thr); }
  else { if (!thr.jobId) thr.jobId = jobId; _crew.forEach(id => { if ((thr.members || (thr.members = [])).indexOf(id) < 0) thr.members.push(id); }); thr.updatedAt = now(); }
  const post = function (atts) {
    coll.push({ id: "msg_" + uid(), threadId: tid, senderId: me.id, senderLabel: me.username || "—", body: q || "(photo)", ts: now(), attachments: (atts && atts.length) ? atts : undefined, deleted: false, updatedAt: now() });
    if (typeof save === "function") save(); if (typeof render === "function") render();
  };
  if (pfile && typeof jsUpload === "function") jsUpload(pfile).then(function (id) { post([{ id: id }]); }).catch(function (e) { alert("Photo upload failed: " + (e.message || e)); post([]); });
  else post([]);
};
/* (Item 7) The "⏱ Time & travel" manual inputs (jt_crew/jt_onsite/jt_drivemin/jt_drivemiles) + jobSaveTravel /
   jobEstimateDrive were removed: job time now comes from the TIMECLOCK punches (jobHourly derives crew-hrs from
   jobClockedHrs). Legacy crewN/onSiteHrs/driveMin/driveMiles stay on old records but are no longer read here
   (jobMilesCost keeps its driveMiles fallback for old jobs). */
window.jobSaveAsTemplate = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j || typeof jobTemplates !== "function") return;
  const addr = (typeof jobAddr === "function") ? jobAddr(j) : (j.address || "");
  const tdoc = jobTemplates();
  const item = { id: uid(), label: String(j.title || "Common job").slice(0, 30), title: j.title || "Job", address: addr, crewN: (+j.crewN || (j.crew || []).length || 1), onSiteHrs: +j.onSiteHrs || 0, driveMin: +j.driveMin || 0, driveMiles: +j.driveMiles || 0, deleted: false };
  tdoc.list.push(item); tdoc.updatedAt = now(); if (typeof touch === "function") touch(tdoc); save();
  alert('Saved "' + item.label + '" as a common job — tap "+ Add" on Today to reuse it in one tap.');
};

/* ===== "🔀 Split across other jobs / mark as generic" — multi-job (0/1/N) attribution for a dump run /
   material pickup, next to +Add expense / +Add material. Picks which job(s) a stop's cost belongs to —
   any active job, not just ones the current user is crewed on — plus an assignee (defaults to you, editable
   → becomes the stop-job's crew). THE IDENTICAL-BEHAVIOR GUARANTEE: if exactly ONE job is checked and it IS
   the job whose page you opened this from, this writes straight into THAT job's expenses[]/materials[] —
   byte-identical to the plain +Add flow, zero new records. Any other case (0, ≥2, or a different single job)
   creates-or-reuses a stop-job (job.sharedJobIds=selection, job.stopKind) and logs into ITS array instead;
   its cost then rolls up (or, if 0 jobs, surfaces as overhead) via js/52's subJobsOf/overheadStops. */
let SPLIT_JOB = null, SPLIT_KIND = null, SPLIT_SEL = new Set();
window.jobOpenSplitPicker = function (jobId, kind) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  SPLIT_JOB = jobId; SPLIT_KIND = kind; SPLIT_SEL = new Set([jobId]);   // default: just this job — matches today's behavior until the crew changes the selection
  const me = (typeof curUser === "function") ? curUser() : null;
  const members = (typeof schedMembers === "function") ? schedMembers() : [];
  modal("🔀 Split across other jobs / mark as generic", `
    <p class="muted" style="margin-bottom:8px">For a dump run, a shared materials pickup, or any cost that isn't just this job — pick every job it applies to (or none, for a general business cost). The amount splits evenly across whatever's checked.</p>
    <label style="margin-top:0">Category</label>
    <select id="split_cat"><option value="dump">🚛 Dump run</option><option value="pickup">📦 Materials pickup</option><option value="other" selected>🔀 Other</option></select>
    <label>Which job(s)? <span class="sub">(search ALL active jobs — leave none checked for a generic/overhead cost)</span></label>
    <input id="split_search" placeholder="Search jobs by title or customer…" autocomplete="off" oninput="splitRenderJobs()">
    <div id="split_joblist" style="max-height:240px;overflow:auto;margin-top:4px"></div>
    <label>Assignee <span class="sub">(who did the run — defaults to you; becomes the stop's crew)</span></label>
    <select id="split_assignee">${members.map(u => `<option value="${esc(u.id)}" ${me && me.id === u.id ? "selected" : ""}>${esc(u.username)}</option>`).join("")}</select>
    <div class="row" style="gap:8px;margin-top:8px"><input id="split_amt" type="number" inputmode="decimal" placeholder="$" style="flex:0 0 80px"><input id="split_vendor" placeholder="Vendor / store" style="flex:2"></div>
    <input id="split_desc" placeholder="What for… (required)" style="margin-top:6px">
    <input type="file" id="split_receipt" accept="image/*" style="display:none" onchange="var l=document.getElementById('split_receipt_lbl');if(l)l.textContent='✓ Receipt ready'">
    <div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost grow" onclick="document.getElementById('split_receipt').click()"><span id="split_receipt_lbl">📎 Receipt (optional)</span></button><button class="btn acc grow" id="split_add_btn" onclick="jobSplitSubmit('${kind}')">+ Add ${kind === "material" ? "material" : "expense"}</button></div>`);
  splitRenderJobs();
};
/* the searchable multi-select list — excludes stop-jobs themselves (only ordinary jobs are valid attribution targets) */
function splitRenderJobs() {
  const box = document.getElementById("split_joblist"); if (!box) return;
  const q = (val("split_search") || "").trim().toLowerCase();
  const jobs = (typeof actJ === "function" ? actJ() : []).filter(x => x && !Array.isArray(x.sharedJobIds));
  const list = jobs.filter(x => {
    if (!q) return true;
    const cust = (x.customerId && typeof custName === "function") ? custName(x.customerId) : "";
    return (x.title || "").toLowerCase().indexOf(q) >= 0 || cust.toLowerCase().indexOf(q) >= 0;
  }).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  box.innerHTML = list.length ? list.map(x => {
    const cust = (x.customerId && typeof custName === "function") ? custName(x.customerId) : "";
    const on = SPLIT_SEL.has(x.id);
    return `<label class="li" style="cursor:pointer"><input type="checkbox" style="width:20px;height:20px;flex:0 0 auto" ${on ? "checked" : ""} onchange="splitToggleJob('${x.id}')"><div class="grow"><div class="nm" style="font-size:14px;white-space:normal">${esc(x.title || "Job")}</div><div class="sub">${cust ? esc(cust) + " · " : ""}${x.date ? fmtDate(x.date) : ""}</div></div></label>`;
  }).join("") : `<div class="muted">No jobs match.</div>`;
}
window.splitToggleJob = function (id) { if (SPLIT_SEL.has(id)) SPLIT_SEL.delete(id); else SPLIT_SEL.add(id); splitRenderJobs(); };
/* create-or-reuse a stop-job for a given job-selection + category, logged today. Reuse key: same day + same
   category + the exact same set of linked jobs — so several costs logged on one visit (e.g. dump fee + gas)
   land on ONE stop-job instead of one each. sharedJobIds carries the split; parentJobId mirrors it ONLY when
   there's a single linked job (audit trail — unread by new code). */
function jobFindOrCreateStop(selectedIds, stopKind, assigneeId) {
  const ids = (selectedIds || []).slice().sort(), d = today();
  const existing = (typeof actJ === "function" ? actJ() : []).find(x => x && Array.isArray(x.sharedJobIds) && x.date === d && (x.stopKind || "other") === stopKind && x.sharedJobIds.slice().sort().join(",") === ids.join(","));
  if (existing) return existing;
  const titles = { dump: "Dump run", pickup: "Materials pickup", other: "Stop" };
  const sj = { id: uid(), title: titles[stopKind] || "Stop", date: d, done: false, sharedJobIds: (selectedIds || []).slice(), stopKind: stopKind, parentJobId: selectedIds.length === 1 ? selectedIds[0] : "", crew: assigneeId ? [assigneeId] : [], expenses: [], materials: [] };
  D().jobs.push(sj); if (typeof touch === "function") touch(sj);
  return sj;
}
let _splitAddBusy = false, _splitAddWatchdog = null;
window.jobSplitSubmit = function (kind) {
  if (_splitAddBusy) return;   // same anti-dupe guard as jobAddExpense/jobAddMaterial (June 2026 dupe incident)
  const jobId = SPLIT_JOB; if (!jobId) return;
  const amt = parseFloat(val("split_amt")); if (!(amt > 0)) { alert("Enter the amount."); return; }
  const desc = (val("split_desc") || "").trim(); if (!desc) { alert("Enter what it was for."); return; }
  const vendor = (val("split_vendor") || "").trim();
  const cat = val("split_cat") || "other";
  const assignee = val("split_assignee") || "";
  const selected = Array.from(SPLIT_SEL);
  const input = document.getElementById("split_receipt");
  const file = input && input.files && input.files[0];
  const btn = document.getElementById("split_add_btn");
  _splitAddBusy = true; if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
  clearTimeout(_splitAddWatchdog); _splitAddWatchdog = setTimeout(function () { _splitAddBusy = false; }, 20000);
  const finish = function (receiptId) {
    clearTimeout(_splitAddWatchdog);
    const by = ((typeof curUser === "function" && curUser()) ? curUser().username : "");
    const entry = { id: uid(), amount: amt, vendor: vendor, desc: desc, receiptId: receiptId || null, by: by, ts: now() };
    if (kind === "expense") entry.faultMemberId = null;
    let target;
    if (selected.length === 1 && selected[0] === jobId) target = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null;   // the common case: identical to today's plain +Add — no new record
    else target = jobFindOrCreateStop(selected, cat, assignee);
    if (target) {
      const arrKey = kind === "material" ? "materials" : "expenses";
      if (!Array.isArray(target[arrKey])) target[arrKey] = [];
      target[arrKey].push(entry);
      if (typeof touch === "function") touch(target);
    }
    if (typeof save === "function") save();
    if (btn) btn.textContent = "✓ Added";
    setTimeout(function () { _splitAddBusy = false; if (typeof closeModal === "function") closeModal(); if (typeof render === "function") render(); }, 450);
  };
  if (file && typeof jsUpload === "function") jsUpload(file).then(finish).catch(function (e) { alert("Receipt upload failed: " + (e.message || e)); finish(null); });
  else finish(null);
};

/* ===== FAST WORK-DAYS EDITING (crew job page) — add/remove the days a multi-day job is worked WITHOUT opening
   the full job editor + scrolling. Writes straight to j.workDays (touch + save), so it stays in sync with the
   full editor (js/09), which reads/writes the same field on its own Save. "+ Add today" is one tap, no modal;
   "+ Add another day" opens a SMALL modal that contains ONLY the mini tap-on/off month grid (the SAME grid +
   chip HTML the full editor draws — via the shared wdpkGridHtml/wdpkChipsHtml helpers in js/09 — so the two
   can't visually drift). The start day (j.date) is always a work day and can't be removed here. */
function jobPageWorkDays(j) { return (typeof jobWorkDays === "function") ? jobWorkDays(j) : ((Array.isArray(j && j.workDays) ? j.workDays : (j && j.date ? [j.date] : [])).slice().sort()); }
/* (Item 4B) the crew job page's work-days card is a DAY-GROUPED PUNCH EDITOR: each work day lists the timeclock
   punches on this job that day (crew · in–out · hrs · vehicle), each editable (tcEditPunch) + soft-deletable
   (tcDelPunch), with a "＋ Add punch" (manual, time-only) per day. The displayed days = planned work days ∪
   days-with-punches ∪ the start day; clocking in GROWS this set (js/38 tcClockIn), never shrinks it. A day that
   has punches can't be chip-removed ("remove the punches first"); an empty planned day can; the start day never.
   "+ Add work day" still adds a PLANNED (punch-less) day via the calendar picker. */
function jobPageWorkDaysCard(j) {
  const t = (typeof today === "function") ? today() : "";
  const start = j.date || ((jobPageWorkDays(j))[0] || "");
  const _day = ms => (typeof tcLocalDay === "function") ? tcLocalDay(ms) : String(new Date(ms).toISOString().slice(0, 10));
  const punches = (D().timeclock || []).filter(e => e && !e.deleted && e.jobId === j.id && e.clockIn != null);
  const byDay = {}; punches.forEach(e => { (byDay[_day(e.clockIn)] = byDay[_day(e.clockIn)] || []).push(e); });
  const daySet = new Set(jobPageWorkDays(j)); Object.keys(byDay).forEach(d => daySet.add(d)); if (start) daySet.add(start);
  const days = [...daySet].sort();
  const uname = id => (typeof userName === "function" ? userName(id) : "") || "";
  const hhmm = ms => { try { return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };
  const hasToday = days.indexOf(t) >= 0;
  let h = `<div class="card"><div style="font-weight:800;margin-bottom:6px">📅 Work days &amp; time${days.length > 1 ? ` · <span class="sub" style="font-weight:400">${days.length} days</span>` : ""}</div>`;
  h += `<div class="sub" style="margin-bottom:4px;white-space:normal">Each day shows the crew's punches (clock in → out). Clocking in adds the day automatically. Edit or remove a punch, or add one by hand (time only — no mileage).</div>`;
  days.forEach(ds => {
    const es = (byDay[ds] || []).slice().sort((a, b) => a.clockIn - b.clockIn);
    const isStart = ds === start, isToday = ds === t;
    const dayHrs = es.reduce((s, e) => s + (e.clockOut ? Math.max(0, e.clockOut - e.clockIn) / 3600000 : 0), 0);
    const canRemove = !isStart && es.length === 0;   // a day WITH punches (or the start day) can't be chip-removed
    h += `<div style="border-top:1px solid var(--line);padding-top:8px;margin-top:6px">
      <div class="row" style="align-items:center"><div class="grow"><b style="font-size:14px">${isToday ? "📍 " : ""}${esc((typeof fmtDate === "function") ? fmtDate(ds) : ds)}</b>${isStart ? ` <span class="sub">· start</span>` : ""}${dayHrs > 0 ? ` <span class="sub">· ${Math.round(dayHrs * 10) / 10}h</span>` : ""}</div>${canRemove ? `<button class="btn ghost sm" onclick="jobPageRemoveDay('${j.id}','${ds}')" title="Remove this empty day">✕ day</button>` : ""}</div>`;
    if (es.length) h += es.map(e => {
      const hrs = e.clockOut ? Math.round(Math.max(0, e.clockOut - e.clockIn) / 3600000 * 10) / 10 : null;
      const veh = (e.riderRole === "driver" && e.vehicle) ? " · 🚚 " + esc(e.vehicle) : (e.riderRole === "passenger" ? " · 🧍" : "");
      const conf = (e.milesConfirmed && e.miles) ? " · " + e.miles + " mi" : "";
      return `<div class="li"><div class="grow" style="cursor:pointer" onclick="tcEditPunch('${e.id}')"><div class="nm" style="font-size:14px">${esc(uname(e.userId) || e.userName || "Crew")}${e.manual ? ` <span class="badge" style="background:var(--soft);color:var(--muted)">manual</span>` : ""}</div><div class="sub" style="white-space:normal">${hhmm(e.clockIn)}–${e.clockOut ? hhmm(e.clockOut) : "open"}${hrs != null ? " · " + hrs + "h" : ""}${veh}${conf}</div></div><button class="btn ghost sm" onclick="tcDelPunch('${e.id}')" title="Remove this punch">✕</button></div>`;
    }).join("");
    else h += `<div class="sub muted" style="padding:2px 0">No punches logged this day.</div>`;
    h += `<button class="btn ghost sm" style="margin-top:6px;width:100%" onclick="tcAddPunch('${j.id}','${ds}')">＋ Add punch</button>`;
    h += `</div>`;
  });
  h += `<div class="row" style="gap:8px;margin-top:10px">`;
  h += hasToday ? `<button class="btn ghost grow" disabled style="opacity:.7">✓ Today's a work day</button>` : `<button class="btn acc grow" onclick="jobPageAddToday('${j.id}')">+ Add today</button>`;
  h += `<button class="btn ghost grow" onclick="jobPageAddDay('${j.id}')">+ Add work day</button>`;
  h += `</div></div>`;
  return h;
}
/* commit helper: dedupe + keep the start day + sort, write to j.workDays, then touch/save */
function jobPageCommitDays(j, days) {
  const wd = new Set((days || []).filter(Boolean));
  if (j.date) wd.add(j.date);   // start day is always a work day
  j.workDays = [...wd].sort();
  if (typeof touch === "function") touch(j);
  if (typeof logChange === "function") logChange("update", "job", j.id, "Work days → " + j.workDays.length + " day" + (j.workDays.length === 1 ? "" : "s") + " · " + (j.title || "job"));
  if (typeof save === "function") save();
}
/* "+ Add today" — one tap, no modal. Guarded no-op if today is already a work day. */
window.jobPageAddToday = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const t = (typeof today === "function") ? today() : "";
  const days = jobPageWorkDays(j);
  if (days.indexOf(t) >= 0) return;   // already a work day — stray re-tap is a no-op
  jobPageCommitDays(j, days.concat([t]));
  if (typeof render === "function") render();
};
/* remove a day — never the start day, and never a day that has time punches (remove the punches first). Removing a
   PUNCH (tcDelPunch) deletes only that entry; the day stays. Only an empty planned day is chip-removable. */
window.jobPageRemoveDay = function (jobId, ds) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (ds === (j.date || "")) return;   // can't remove the start day
  const _day = ms => (typeof tcLocalDay === "function") ? tcLocalDay(ms) : String(new Date(ms).toISOString().slice(0, 10));
  const hasPunch = (D().timeclock || []).some(e => e && !e.deleted && e.jobId === jobId && e.clockIn != null && _day(e.clockIn) === ds);
  if (hasPunch) { alert("That day has time punches — remove the punches first."); return; }
  jobPageCommitDays(j, jobPageWorkDays(j).filter(d => d !== ds));
  if (typeof render === "function") render();
  if (JP_WD_JOB === jobId && document.getElementById("jpwd_box")) jobPageWdRender();   // keep an open picker in step
};
/* ---- "+ Add another day" — a SMALL modal with ONLY the mini tap-on/off month grid (no full-editor fields).
   Each day-tap commits instantly (availability-calendar feel). Reuses the SAME shared grid/chip HTML the full
   editor uses (js/09 wdpkGridHtml/wdpkChipsHtml) so they can't drift. ‹ › step the shown month. */
let JP_WD_JOB = null, JP_WD_ANCHOR = null;
window.jobPageAddDay = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  JP_WD_JOB = jobId;
  const days = jobPageWorkDays(j);
  JP_WD_ANCHOR = (j.date || days[0] || ((typeof today === "function") ? today() : ""));
  modal("📅 Add work days", `<div id="jpwd_box"></div><button class="btn acc" style="margin-top:12px;width:100%" onclick="closeModal()">Done</button>`);
  jobPageWdRender();
};
function jobPageWdRender() {
  const box = document.getElementById("jpwd_box"); if (!box) return;
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === JP_WD_JOB) : null; if (!j) return;
  const days = jobPageWorkDays(j);
  const start = j.date || (days[0] || "");
  const sel = new Set(days);
  const anc = new Date((JP_WD_ANCHOR || start || ((typeof today === "function") ? today() : "")) + "T00:00:00");
  const y = anc.getFullYear(), m = anc.getMonth();
  const title = new Date(y, m, 1).toLocaleString(undefined, { month: "long" }) + " " + y;
  const cells = (typeof wdpkGridHtml === "function") ? wdpkGridHtml(sel, start, y, m, "jobPageWdToggle") : "";
  const chips = (typeof wdpkChipsHtml === "function") ? wdpkChipsHtml(days, start, "jobPageWdToggle") : "";
  box.innerHTML = `<div class="wdpk">
    <div class="wdpk-head"><button type="button" class="calnav" onclick="jobPageWdMonth(-1)">‹</button><div class="wdpk-title">${esc(title)}</div><button type="button" class="calnav" onclick="jobPageWdMonth(1)">›</button></div>
    <div class="wdpk-grid">${cells}</div>
    <div class="wdpk-chips">${chips}</div>
    <div class="sub" style="margin-top:4px">${days.length > 1 ? `Worked across <b>${days.length} days</b> — shows on each on the schedule.` : "Single day. Tap a day above to add it."}</div></div>`;
}
/* tap a day → toggle it in j.workDays instantly (start day is a no-op), re-render the grid + the page behind */
window.jobPageWdToggle = function (ds) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === JP_WD_JOB) : null; if (!j) return;
  if (ds === (j.date || "")) return;   // can't toggle the start day off
  const days = jobPageWorkDays(j);
  jobPageCommitDays(j, days.indexOf(ds) >= 0 ? days.filter(d => d !== ds) : days.concat([ds]));
  jobPageWdRender();
};
window.jobPageWdMonth = function (n) {
  const a = new Date((JP_WD_ANCHOR || ((typeof today === "function") ? today() : "")) + "T00:00:00");
  a.setDate(1); a.setMonth(a.getMonth() + n);
  JP_WD_ANCHOR = a.getFullYear() + "-" + String(a.getMonth() + 1).padStart(2, "0") + "-01";
  jobPageWdRender();
};
