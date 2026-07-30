/* ---------- CREW JOB PAGE ----------
   The one screen a crew member opens for the job they're on. Flow: where & when (directions + call) →
   load checklist (load the truck first) → time clock (your own vehicle + odometer; shows who's on the
   job) → photos (inline, visible to all) → expenses (amount + receipt as proof) → notes → change orders.
   Reached by tapping a job (openJobPage); renders inside the Schedule tab via window.JOB_OPEN. */
window.JOB_OPEN = window.JOB_OPEN || null;
window.JOB_RETURN_TAB = window.JOB_RETURN_TAB || null;   // where the user was when they opened a job (e.g. "receipts") so Back returns there, not always Schedule. Now backed by the shared nav-return helper (NAV_ORIGIN["schedule"]); kept as a mirror for back-compat.
window.JOB_TITLE_EDIT = window.JOB_TITLE_EDIT || null;   // job id whose title is currently in inline-rename mode (else null)
// The job page takes over the Schedule tab; record where we came from via the shared nav-return helper (host = the "schedule" tab it takes over) so Back / delete / close all return to origin, not always Schedule.
window.openJobPage = function (id) { window.JOB_RETURN_TAB = (typeof navRecordOrigin === "function") ? navRecordOrigin("schedule") : ((typeof TAB !== "undefined" && TAB && TAB !== "schedule") ? TAB : null); if (window.JOB_OPEN !== id) window.JOB_TAB = "overview"; window.JOB_OPEN = id; window.JOB_TITLE_EDIT = null; TAB = "schedule"; if (typeof render === "function") render(); };
window.jobPageBack = function () { window.JOB_OPEN = null; window.JOB_TITLE_EDIT = null; window.JOB_RETURN_TAB = null; if (typeof navReturn === "function") { navReturn("schedule"); } else { if (typeof render === "function") render(); } };
window.jobResetOpen = function () { window.JOB_OPEN = null; window.JOB_RETURN_TAB = null; if (typeof navClearOrigin === "function") navClearOrigin("schedule"); window.JOB_TITLE_EDIT = null; };

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
/* WHOLE-ROUTE link — the path form Google Maps itself emits: /maps/dir/A/B/C/…  Lists every ordered stop in the
   URL path (home base → job site → transfer → base), so opening it shows the FULL loop with the round-trip miles
   Google computes — no API key, no current-GPS assumption. This is the manual-read fallback when the offline map
   estimate couldn't resolve: tap it, read the round-trip mileage off Google's route. Needs ≥2 real addresses. */
function gmapsRouteUrl(stops) {
  const pts = (stops || []).map(s => (s || "").trim()).filter(Boolean);
  if (pts.length < 2) return "";
  return "https://www.google.com/maps/dir/" + pts.map(p => encodeURIComponent(p)).join("/");
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

/* ===== JOB-PAGE LAYOUT — owner-reorderable section order, saved ORG-WIDE (a docs sentinel "jobLayout", synced
   like financeConfig). Everyone in the org sees the same order. Unknown/new section keys never vanish: the saved
   order is validated against the canonical key list and any missing keys are appended in their default order. ===== */
const JOB_LAYOUT_KEYS_DEFAULT = ["data", "partof", "change", "askcap", "crew", "vehicles", "clock", "load", "costs", "matreport", "photos", "notes", "invoice", "closeout", "workdays", "done"];
/* WORKFLOW TABS — the job page was one endless scroll of 16 look-alike cards. Group them into 4 tabs by what you're
   doing (arriving → working → money → wrapping up) so you tap instead of scroll-hunting. Each key belongs to one tab. */
const JOB_TABS = [
  { key: "overview", label: "📋 Overview", secs: ["data", "change", "crew", "vehicles", "partof"] },
  { key: "work", label: "🔨 On the job", secs: ["askcap", "clock", "load", "notes", "photos"] },
  { key: "money", label: "💰 Money", secs: ["costs", "matreport", "invoice"] },
  { key: "wrap", label: "✓ Close out", secs: ["closeout", "workdays", "done"] }
];
window.JOB_TAB = window.JOB_TAB || "overview";
window.jobSetTab = function (t) { if (JOB_TABS.some(x => x.key === t)) { window.JOB_TAB = t; if (typeof render === "function") render(); } };
function jobLayoutDoc() { try { return (D().docs || []).find(x => x && x.id === "jobLayout") || null; } catch (e) { return null; } }
function jobLayoutOrder() {
  const doc = jobLayoutDoc();
  const saved = (doc && Array.isArray(doc.order)) ? doc.order.filter(k => JOB_LAYOUT_KEYS_DEFAULT.indexOf(k) >= 0) : [];
  const rest = JOB_LAYOUT_KEYS_DEFAULT.filter(k => saved.indexOf(k) < 0);   // new sections → appended in default order
  return saved.concat(rest);
}
/* reorder a [{key,...}] section list by the saved org order; never drops a section */
function jobLayoutApply(sections) {
  const order = jobLayoutOrder(), byKey = {}; sections.forEach(s => { byKey[s.key] = s; });
  const out = order.map(k => byKey[k]).filter(Boolean);
  sections.forEach(s => { if (out.indexOf(s) < 0) out.push(s); });
  return out;
}
function jobLayoutEnsureDoc() { const d = D(); d.docs = d.docs || []; let c = d.docs.find(x => x && x.id === "jobLayout"); if (!c) { c = { id: "jobLayout", order: jobLayoutOrder(), updatedAt: (typeof now === "function" ? now() : Date.now()) }; d.docs.push(c); } if (!Array.isArray(c.order)) c.order = jobLayoutOrder(); return c; }
window.jobLayoutToggleEdit = function () { window.JOB_LAYOUT_EDIT = !window.JOB_LAYOUT_EDIT; if (typeof render === "function") render(); };
window.jobLayoutMove = function (key, dir) {
  if (!jobCanEditPlan()) return;
  const order = jobLayoutOrder().slice(), i = order.indexOf(key); if (i < 0) return;
  const ni = i + dir; if (ni < 0 || ni >= order.length) return;
  order.splice(i, 1); order.splice(ni, 0, key);
  const c = jobLayoutEnsureDoc(); c.order = order; if (typeof touch === "function") touch(c);
  if (typeof save === "function") save();
  if (S.sync && S.sync.url && S.sync.token && S.sync.auto && typeof syncNow === "function") syncNow();
  if (typeof render === "function") render();
};
window.jobLayoutReset = function () {
  if (!jobCanEditPlan()) return;
  if (typeof confirm === "function" && !confirm("Reset the job-page layout to the default order for everyone in the org?")) return;
  const c = jobLayoutEnsureDoc(); c.order = JOB_LAYOUT_KEYS_DEFAULT.slice(); if (typeof touch === "function") touch(c);
  if (typeof save === "function") save();
  if (S.sync && S.sync.url && S.sync.token && S.sync.auto && typeof syncNow === "function") syncNow();
  if (typeof render === "function") render();
};

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
  const exps = ((typeof plExpenses === "function") ? plExpenses(j) : (j.expenses || [])).filter(x => x && !x.deleted);
  const expTotal = exps.reduce((s, e) => s + ((typeof depositHeld === "function" && depositHeld(e)) ? 0 : (+e.amount || 0)), 0);   // signed Σ, minus HELD rental deposits (js/96 HOLD-OUT)
  const tel = ph => String(ph || "").replace(/[^0-9+]/g, "");
  // up-to-3 labeled numbers for the customer (falls back to the single number). PRIMARY (first number) is hoisted to
  // the TOP of the contact header as a big tap-to-call link; any SECONDARY numbers render right below as smaller
  // ghost Call buttons (number + note). tap = tel:.
  const _phones = (typeof custPhones === "function" && _cust) ? custPhones(_cust) : (phone ? [{ num: phone, label: "" }] : []);
  const _primary = _phones[0] || null, _secondary = _phones.slice(1);
  const _primaryCall = _primary ? `<div style="margin-top:8px"><a href="tel:${tel(_primary.num)}" style="font-size:18px;font-weight:800;color:var(--brand-text);text-decoration:none">📞 ${esc((typeof fmtPhone === "function") ? fmtPhone(_primary.num) : _primary.num)}</a>${_primary.label ? ` <span class="sub" style="font-weight:400">· ${esc(_primary.label)}</span>` : ""}</div>` : "";
  const _secondaryCalls = _secondary.length ? `<div style="margin-top:6px;display:flex;flex-direction:column;gap:6px">` + _secondary.map(p => `<a class="btn ghost sm" href="tel:${tel(p.num)}" style="text-align:center">📞 ${esc((typeof fmtPhone === "function") ? fmtPhone(p.num) : p.num)}${p.label ? ` · ${esc(p.label)}` : ""}</a>`).join("") + `</div>` : "";
  const upUrl = id => (typeof jsUploadUrl === "function") ? jsUploadUrl(id) : "";
  const hhmm = ms => { try { return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };

  // Title — tap-to-rename (owner/admin). Reveals an inline free-text input writing j.title (NOT the service
  // dropdown); job_title is registered in the js/09 focus-preservation _ids so typing survives the frequent
  // re-renders. Crew see the plain title.
  let h = `<div class="jobpg"><div class="secthd">`;   // .jobpg = job-page-scoped denser card rhythm (app.css)
  if (jobCanEditPlan() && window.JOB_TITLE_EDIT === j.id) {
    h += `<input id="job_title" value="${esc(j.title || "")}" placeholder="Job title" style="flex:1;font-size:18px;font-weight:800;margin:0" onkeydown="if(event.key==='Enter')jobPageRename('${j.id}')"><button class="btn acc sm" style="margin-left:8px" onclick="jobPageRename('${j.id}')">Save</button>`;
  } else {
    h += `<h2 style="margin:0${jobCanEditPlan() ? ";cursor:pointer" : ""}"${jobCanEditPlan() ? ` title="Tap to rename" onclick="window.JOB_TITLE_EDIT='${j.id}';if(typeof render==='function')render()"` : ""}>${esc(j.title || "Job")}${jobCanEditPlan() ? ' <span class="sub" style="font-weight:400;font-size:13px">✏️</span>' : ""}</h2>`;
  }
  h += `<button class="btn ghost sm" style="margin-left:auto" onclick="jobPageBack()">← Back</button></div>`;
  h += editedByLine(j);
  // CREW GUIDE — surface the guide that matches THIS job's TYPE (not just "any guide this customer has"). A job
  // resolves to its own quote; the quote's bandKey (steppath vs landscape) / q.sp / q.survey tells us which build
  // this actually is, so a path job shows the path guide and a landscaping job shows the plant guide — never both.
  // The playbookLib compendium (js/114) is untouched; only this per-job DISPLAY selection is gated by job type.
  const _jq = (typeof actQ === "function") ? (j.quoteId ? actQ().find(x => x && x.id === j.quoteId) : actQ().find(x => x && x.jobId === j.id)) : null;
  const _isPathJob = !!(_jq && (_jq.sp || (_jq.items || []).some(i => i && i.bandKey === "steppath")));
  const _isLandJob = !!(_jq && (_jq.survey || (_jq.items || []).some(i => i && i.bandKey === "landscape")));
  // If the job's own quote is neither type (a generic/older job with no type marker), fall back to showing whatever
  // guide the customer has — so nothing that used to appear silently disappears; only the AMBIGUOUS both-types case
  // (customer has a survey AND a path quote) is now disambiguated by the job's own quote.
  const _typed = _isPathJob || _isLandJob;
  // PLANT crew guide — a landscaping job (or an untyped job that only has a plant guide)
  if ((_isLandJob || !_typed) && typeof landJobHasGuide === "function" && landJobHasGuide(j)) h += `<button class="btn acc" style="width:100%;margin:8px 0 0" onclick="landOpenGuideForJob('${j.id}')">📋 Crew Guide — plants, photos &amp; how-to</button>`;
  // PATH BUILD GUIDE — a path job (prefer this job's OWN quote); or an untyped job whose customer has a path quote.
  if ((_isPathJob || !_typed) && typeof D === "function" && j.customerId) {
    const _pq = (_isPathJob && _jq) ? _jq : (D().quotes || []).filter(function (x) { return x && !x.deleted && x.customerId === j.customerId && x.sp && (x.items || []).some(function (i) { return i && i.bandKey === "steppath"; }); }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })[0];
    if (_pq) {
      h += `<button class="btn acc" style="width:100%;margin:8px 0 0" onclick="openPathGuide('${_pq.id}')">🪨 Path Build Guide — specs &amp; steps</button>`;
      const _busy = (typeof pathPrevBusy === "function" && pathPrevBusy());
      h += `<button class="btn ghost" style="width:100%;margin:8px 0 0" ${_busy ? "disabled" : ""} onclick="pathPreviewStart('${_pq.id}')">${_busy ? "🎨 Rendering the path on your photo…" : "📸 Preview the finished path on this spot"}</button>`;
      const _prevs = (_pq.pathPreviews || []).slice(-4).reverse();
      if (_prevs.length && typeof jsUploadUrl === "function") h += `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">` + _prevs.map(pv => `<img src="${esc(jsUploadUrl(pv.render))}" onclick="window.open('${esc(jsUploadUrl(pv.render))}','_blank')" style="width:74px;height:74px;object-fit:cover;border-radius:8px;border:1px solid var(--line);cursor:pointer" title="Path preview — tap to view">`).join("") + `</div>`;
    }
  }
  h += `<div style="height:8px"></div>`;

  // 1) Where & when — CONTACT header (name · address · tap-to-call) then where you're going  [reorderable: key "data"]
  let _secData = `<div class="card"><div class="nm" style="font-size:18px">${esc(cust || "—")}</div>`;
  _secData += addr ? `<div class="sub" style="white-space:normal;margin-top:3px"><a href="${gmapsDirUrl(addr)}" target="_blank" rel="noopener" style="color:var(--brand-text);text-decoration:none">📍 ${esc(addr)} <span class="sub" style="font-weight:400">· directions ›</span></a></div>` : `<div class="muted" style="margin-top:3px">No address on file.</div>`;
  _secData += _primaryCall;      // PRIMARY phone — big tap-to-call, hoisted to the top (was at the bottom)
  _secData += _secondaryCalls;   // any secondary numbers — smaller ghost Call buttons
  if (_drive) _secData += `<div class="sub" style="margin-top:8px;font-weight:600;color:var(--brand-text)">${_drive}</div>`;   // driveBadge ETA — kept for everyone, crew included
  // EDIT LOCATION (owner/admin) — set a real location on a job with none (e.g. an airport pickup with no
  // customer address): pick a saved property (its map pin) OR type a free-text address saved to j.address,
  // which jobAddr() already reads as a fallback. Crew see the location read-only.
  if (jobCanEditPlan()) _secData += `<button class="btn ghost sm" style="margin-top:6px" onclick="jobEditLoc('${j.id}')">✏️ Edit location</button>`;
  // WHO / WHEN — inline editable for owner/admin (customer · date · time), replacing the old read-only line so a
  // job no longer needs the separate openJob modal to change these. Each control commits on `change` to a small
  // job-page handler (jobSetCustomer/jobSetDate/jobSetTime → write + touch + save + render), matching the inline
  // title/crew/route editors. Crew keep the compact read-only line. Crew ASSIGNMENT itself is edited in
  // jobPageCrewCard below — here we only SHOW the 👥 crew summary.
  if (jobCanEditPlan()) {
    const _cs = (typeof actC === "function") ? actC() : [];
    _secData += `<div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">`;
    _secData += `<div><label class="sub" style="margin:0 0 2px;display:block;font-weight:700">Customer</label><select id="jcust_${j.id}" onchange="jobSetCustomer('${j.id}',this.value)" style="width:100%"><option value="">— none —</option>${_cs.map(c => `<option value="${c.id}"${c.id === j.customerId ? " selected" : ""}>${esc(c.name || c.company || "Customer")}</option>`).join("")}</select></div>`;
    _secData += `<div class="row" style="gap:8px"><div class="grow"><label class="sub" style="margin:0 0 2px;display:block;font-weight:700">Date</label><input id="jdate_${j.id}" type="date" value="${esc(j.date || "")}" onchange="jobSetDate('${j.id}',this.value)" style="width:100%"></div><div class="grow"><label class="sub" style="margin:0 0 2px;display:block;font-weight:700">Time</label><input id="jtime_${j.id}" type="time" value="${esc(j.time || "")}" onchange="jobSetTime('${j.id}',this.value)" style="width:100%"></div></div>`;
    // 🔁 RECURRING — right in the date area (Ray). If the job already belongs to a recurring plan, link to it;
    // otherwise "make this recurring" opens the recurring-plan editor (js/103) pre-filled from THIS job.
    if (typeof recurCanManage === "function" && recurCanManage()) {
      const _plan = (j.planId && typeof recurPlanById === "function") ? recurPlanById(j.planId) : null;
      if (_plan) _secData += `<button class="btn ghost sm" style="width:100%" onclick="recurPlanOpen('${esc(j.planId)}')">🔁 Recurring${typeof recurFreqLine === "function" ? " · " + esc(recurFreqLine(_plan)) : ""} — open plan ›</button>`;
      else _secData += `<button class="btn ghost sm" style="width:100%" onclick="jobMakeRecurring('${j.id}')">🔁 Make this a recurring job…</button>`;
    }
    if (crewNames) _secData += `<div class="sub" style="white-space:normal">👥 ${esc(crewNames)}</div>`;
    _secData += `</div>`;
  } else {
    _secData += `<div class="sub" style="margin-top:8px;white-space:normal">📅 ${j.date ? fmtDate(j.date) : "—"}${j.time ? " · " + esc(j.time) : ""}${crewNames ? " · 👥 " + esc(crewNames) : ""}</div>`;
  }
  // PER-JOB PO CODE (js/95) — tap-to-copy chip Ray types into a vendor's register PO field; the CSV import then
  // EXACT-matches the receipt back to this job. Skip pure stop/sub jobs (they ride their parent's paperwork).
  if (typeof jobPO === "function" && jobPO(j) && !j.stopKind && !Array.isArray(j.sharedJobIds)) {
    _secData += `<div style="margin-top:8px"><button class="btn ghost sm" onclick="jobCopyPO('${j.id}')" title="Type this into the store's PO field so the receipt auto-files to this job">🧾 PO ${jobPO(j)} · tap to copy</button></div>`;
  }
  if (j.done) _secData += `<div class="sub" style="margin-top:6px;color:var(--accent);font-weight:800">✓ Completed</div>`;
  // DERIVED lifecycle badge — where this job sits in the pipeline (lead→quote→job→expense collecting→invoice→paid).
  // Reads through the linked quote; the expense-collecting badge shows live "N/M crew closed" + who we're waiting on.
  if (typeof workStage === "function" && typeof actQ === "function") {
    const _wq = (j.quoteId ? actQ().find(x => x && x.id === j.quoteId) : null) || actQ().find(x => x && x.jobId === j.id);
    if (_wq) {
      const _st = workStage(_wq), _m = (typeof workStageMeta !== "undefined" && workStageMeta[_st]) || { label: _st, color: "var(--muted)" };
      const _lbl = (typeof workStageLabel === "function") ? workStageLabel(_wq) : _m.label;
      const _wait = (_st === "expense" && typeof workStageWaiting === "function") ? workStageWaiting(_wq) : [];
      _secData += `<div style="margin-top:8px"><span class="badge" style="background:${_m.color};color:#fff">${esc(_lbl)}</span>${_wait.length ? `<span class="sub" style="margin-left:6px">waiting on ${esc(_wait.join(", "))}</span>` : ""}</div>`;
      // Payment-decoupled FOLLOW-UP: even once a job is invoiced/PAID, if the expenses aren't signed-off collected
      // AND crew are still open, surface a muted reminder so the slow crew member's missing receipts aren't
      // forgotten. Visible to everyone (crew see it too so they know to submit); the owner sign-off card is below.
      if ((_st === "invoice" || _st === "paid") && !j.expensesCollected && typeof workStageWaiting === "function") {
        const _openNames = workStageWaiting(_wq);
        if (_openNames.length) _secData += `<div class="sub" style="margin-top:6px;white-space:normal;color:var(--muted)">⚠ Expenses not yet collected — ${_openNames.length} crew still open: <b>${esc(_openNames.join(", "))}</b></div>`;
      }
    }
  }
  // WHERE YOU'RE GOING — ONE clean per-stop navigate list, ALWAYS driven by the shared jobRouteOrdered(j) (it
  // always includes the job site, even with 0 planned stops). Each row = its label · address · a "🧭 Directions ›"
  // deep-link that opens turn-by-turn from the phone's current GPS (gmapsDirUrl, no API key). A single-site job
  // shows exactly one 🏁 Job site row — no special-casing, and no combined "Full route" button (it clipped + read
  // as an unlabeled link). Shown to everyone (crew included); the mileage math lives in the admin route card below.
  let _navRows = "", _navN = 0;
  (typeof jobRouteOrdered === "function" ? jobRouteOrdered(j) : []).forEach(t => {
    let _lbl, _stopAddr;
    if (t.kind === "site") { _stopAddr = addr; if (!_stopAddr) return; _lbl = "🏁 Job site"; }
    else { const s = t.stop; if (!(s && s.address)) return; _stopAddr = s.address; _lbl = esc(s.label || "Stop"); }
    _navN++;
    _navRows += `<div class="li" style="padding:6px 0"><div class="grow"><div class="nm" style="font-size:14px">${_navN}. ${_lbl}</div><div class="sub" style="white-space:normal">${esc(_stopAddr)}</div></div><a class="btn ghost sm" href="${gmapsDirUrl(_stopAddr)}" target="_blank" rel="noopener" style="flex:0 0 auto">🧭 Directions ›</a></div>`;
  });
  if (_navRows) _secData += `<div class="sub" style="margin-top:12px;font-weight:700">🧭 Where you're going <span class="sub" style="font-weight:400">· tap to navigate</span></div>` + _navRows;
  _secData += `</div>`;

  // ===== SECTIONS captured as variables, then assembled in the ORG-CONFIGURED order (owner-reorderable):
  // Route/stops editor (owner/admin), Work days, and Crew are helper cards. =====
  const _secRoute = jobPageRouteCard(j);          // home→site→transfer→home + mileage estimate
  const _secWorkdays = jobPageWorkDaysCard(j);    // multi-day editor — admin, goes to the very bottom
  const _secCrew = jobPageCrewCard(j);            // who you're working with — hoisted near the top
  const _secVehicles = (typeof jobPageVehiclesCard === "function") ? jobPageVehiclesCard(j) : "";   // 🚚 assign vehicles + per-vehicle route + owner reimbursement (js/110)

  // 1b) Part of a bigger job? — file this under a parent (e.g. a dump run under a tree job); its costs roll up.
  // sharedJobIds[] generalizes the old scalar parentJobId (0/1/N jobs); this single-select stays the UNCHANGED
  // common-case UI (1 parent) and writes sharedJobIds=[oneId] under the hood — the multi-job case is the new
  // "🔀 Split across other jobs" picker below, on the OTHER job's page (the one the stop-job is created from).
  const _subs = (typeof subJobsOf === "function") ? subJobsOf(j.id) : [];
  const _curParent = (Array.isArray(j.sharedJobIds) && j.sharedJobIds.length === 1) ? j.sharedJobIds[0] : null;   // keep an existing link visible even if that parent is now finished
  const _opts = (typeof actJ === "function" ? actJ() : []).filter(x => x && x.id !== j.id && !Array.isArray(x.sharedJobIds) && ((typeof jobIsOpenNow === "function" ? jobIsOpenNow(x) : !x.done) || x.id === _curParent));
  let _secPartOf = `<div class="card"><label style="margin-top:0">↳ Part of a bigger job?</label><select onchange="jobSetParent('${j.id}',this.value)"><option value="">— standalone job —</option>` + _opts.map(x => `<option value="${x.id}" ${(Array.isArray(j.sharedJobIds) && j.sharedJobIds.length === 1 && j.sharedJobIds[0] === x.id) ? "selected" : ""}>${esc(x.title || "Job")}${x.customerId && typeof custName === "function" ? " · " + esc(custName(x.customerId)) : ""}${x.date ? " · " + fmtDate(x.date) : ""}</option>`).join("") + `</select>`;
  if (Array.isArray(j.sharedJobIds) && j.sharedJobIds.length === 1) _secPartOf += `<div class="sub" style="margin-top:6px;white-space:normal">Its mileage, dump fees &amp; time roll up into that job's cost.</div>`;
  else if (Array.isArray(j.sharedJobIds) && j.sharedJobIds.length > 1) {
    const _names = j.sharedJobIds.map(id => { const oj = (typeof actJ === "function" ? actJ() : []).find(x => x.id === id); return oj ? (oj.title || "Job") : null; }).filter(Boolean);
    _secPartOf += `<div class="sub" style="margin-top:6px;white-space:normal">Split evenly across ${j.sharedJobIds.length} jobs: ${_names.map(esc).join(", ")}.</div>`;
  } else if (Array.isArray(j.sharedJobIds) && j.sharedJobIds.length === 0) {
    _secPartOf += `<div class="sub" style="margin-top:6px;white-space:normal">Marked as general business overhead — not charged to any job.</div>`;
  }
  if (_subs.length) _secPartOf += `<div class="sub" style="margin-top:8px;font-weight:700">Stops rolled into this job:</div>` + _subs.map(sj => {
    const n = Math.max(1, (sj.sharedJobIds || []).length);
    const _total = (typeof plExpenses === "function" ? plExpenses(sj).filter(x => x && !x.deleted).reduce((s, e) => s + (+e.amount || 0), 0) : 0) + (typeof plMaterials === "function" ? plMaterials(sj).filter(x => x && !x.deleted).reduce((s, e) => s + (+e.amount || 0), 0) : 0);
    const _share = _total / n;
    const _assignee = (sj.crew && sj.crew[0] && typeof userName === "function") ? (userName(sj.crew[0]) || "") : "";
    const _others = (sj.sharedJobIds || []).filter(id => id !== j.id).map(id => { const oj = (typeof actJ === "function" ? actJ() : []).find(x => x.id === id); return oj ? (oj.title || "Job") : null; }).filter(Boolean);
    return `<div class="li" onclick="openJobPage('${sj.id}')" style="cursor:pointer"><div class="grow"><div class="nm" style="font-size:14px;white-space:normal">${(typeof stopEmoji === "function" ? stopEmoji(sj.stopKind) : "🔀")} ${esc(sj.title || "Job")}${_assignee ? " · " + esc(_assignee) : ""}${sj.date ? " · " + fmtDate(sj.date) : ""}</div><div class="sub" style="white-space:normal">${money(_total)} total${n > 1 ? ` · split ${n} ways${_others.length ? " with " + _others.map(esc).join(", ") : ""} · this job's share ${money(_share)}` : ""}</div></div><span class="sub">open →</span></div>`;
  }).join("");
  _secPartOf += `</div>`;

  // Load checklist — load the truck before you drive. Progress count (N/M) + a needs-cleaning badge on flagged items.
  const _eq = (j.equipment || []).filter(e => e && e.itemId);
  const _loadedN = _eq.filter(e => e.loaded).length;
  const _allLoaded = _eq.length && _loadedN === _eq.length;
  const _prog = _eq.length ? ` <span class="badge" style="background:${_allLoaded ? "var(--accent)" : "var(--soft)"};color:${_allLoaded ? "#fff" : "var(--muted)"};margin-left:2px">${_loadedN}/${_eq.length} loaded</span>` : "";
  let _secLoad = `<div class="card"><div style="font-weight:800;margin-bottom:6px">🧰 Load checklist${_prog} <span class="sub" style="font-weight:400">· check off as you load</span></div>`;
  _secLoad += _eq.length ? _eq.map(e => { const it = (typeof eqItemById === "function") ? eqItemById(e.itemId) : null; const nm = it ? (it.name || e.itemId) : e.itemId; const dirty = (it && it.needsCleaning) ? ` <span class="badge" style="background:#b8860b;color:#fff">🧽 needs cleaning</span>` : ""; return `<label class="li" style="cursor:pointer"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal;${e.loaded ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(nm)}${dirty}</div></div><div class="row" style="gap:10px;align-items:center"><span class="sub">×${e.qty || 1}</span><input type="checkbox" style="width:22px;height:22px" ${e.loaded ? "checked" : ""} onchange="jobToggleLoaded('${j.id}','${esc(e.itemId)}')"></div></label>`; }).join("") : `<div class="muted">No equipment assigned to this job.</div>`;
  _secLoad += `</div>`;

  // Time clock — each person clocks in with their own vehicle + odometer
  let _secClock = (typeof dig811CardHTML === "function" ? dig811CardHTML(j) : "") + (typeof depJobCardHTML === "function" ? depJobCardHTML(j) : "") + `<div class="card" style="border-left:5px solid var(--accent)"><div style="font-weight:800;margin-bottom:8px">⏱️ Time clock</div>`;
  const _estEach = (typeof jobEstHrsEach === "function") ? jobEstHrsEach(j) : 0, _estCrew = (typeof jobEstCrew === "function") ? jobEstCrew(j) : 1, _estCH = (typeof jobEstCrewHrs === "function") ? jobEstCrewHrs(j) : 0, _actCH = (typeof jobClockedHrs === "function") ? jobClockedHrs(j) : 0;
  if (_estCH > 0 || _actCH > 0) {
    let _cmp = "";
    if (_estCH > 0 && _actCH > 0) { const _p = Math.round(_actCH / _estCH * 100); _cmp = ` · logged <b>${_actCH}</b> (${_p}% of est${j.done ? (_actCH > _estCH ? ` · ${(_actCH - _estCH).toFixed(1)}h over` : ` · ${(_estCH - _actCH).toFixed(1)}h under`) : ""})`; }
    else if (_actCH > 0) _cmp = ` · logged <b>${_actCH}</b> crew-hrs so far`;
    _secClock += `<div class="sub" style="margin-bottom:8px;white-space:normal">📐 Estimated <b>${_estCH || "—"} crew-hrs</b>${_estEach ? ` (~${_estEach} hr each · ${_estCrew} ${_estCrew === 1 ? "person" : "people"})` : ""}${_cmp}. <span style="color:var(--muted)">Breaks don't count — clock out for lunch, back in after.</span></div>`;
  }
  const _hh = (typeof jobHourly === "function") ? jobHourly(j) : null;
  if (_hh && _hh.perHr != null) _secClock += `<div class="sub" style="margin-bottom:8px;white-space:normal">💵 Effective field pay: <b style="${_hh.perHr < 35 ? "color:var(--danger)" : _hh.perHr >= 45 ? "color:var(--accent)" : ""}">${money(_hh.perHr)}/hr each</b> · ${_hh.crew}p × ${_hh.personHrs.toFixed(1)} crew-hrs clocked · cost ${money(_hh.cost)} · profit ${money(_hh.profit)}</div>`;
  else if (_hh && _hh.price > 0) _secClock += `<div class="sub" style="margin-bottom:8px;white-space:normal">💵 <span style="color:var(--muted)">Clock in to see the real $/hr — pay is derived from clocked time now.</span></div>`;
  if (onJob.length) _secClock += `<div class="sub" style="margin-bottom:8px">On this job now: ${onJob.map(e => `<b>${esc((typeof userName === "function" ? userName(e.userId) : "") || "crew")}</b>${e.vehicle ? " · " + esc(e.vehicle) : ""}`).join(" · ")}</div>`;
  if (openThis) _secClock += `<div class="sub">You're clocked in since <b>${hhmm(openThis.clockIn)}</b>${openThis.vehicle ? " · " + esc(openThis.vehicle) : ""}</div>${_estEach ? `<div class="sub" style="margin-top:2px;color:var(--brand-text);font-weight:600">⏱ Likely finish ~${hhmm(openThis.clockIn + _estEach * 3600000)} (your ~${_estEach} hr share, excl. breaks)</div>` : ""}<button class="btn danger" style="margin-top:8px;width:100%;padding:13px" onclick="tcClockOut('${openThis.id}')">Clock out</button>`;
  else if (openOther) { const oj = (typeof actJ === "function") ? actJ().find(x => x.id === openOther.jobId) : null; _secClock += `<div class="note">You're clocked into <b>${esc(oj ? (oj.title || "another job") : "another job")}</b> — clock out of it first.</div><button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="tcClockOut('${openOther.id}')">Clock out of that job</button>`; }
  else _secClock += (typeof tcClockInFormHTML === "function" ? tcClockInFormHTML(j.id) : "") + `<div class="sub" style="margin-top:8px;white-space:normal">🚗 <b>Clock in when you leave for the job</b> (not when you arrive) — keeps the time estimate honest.</div>`;
  if ((typeof isOwner === "function" && isOwner()) || (typeof canManageMembers === "function" && canManageMembers()))
    _secClock += `<button class="btn ghost sm" style="margin-top:10px;width:100%" onclick="tcLogDriveForm('${j.id}')">🚗 Log a drive <span class="sub" style="font-weight:400">· retroactive mileage, no clock-in</span></button>`;
  _secClock += `</div>`;

  // Job photos — documentation gallery
  const atts = (j.attachments || []).filter(a => a && !a.deleted);
  let _secPhotos = `<div class="card"><div style="font-weight:800;margin-bottom:8px">🖼 Job photos <span class="sub" style="font-weight:400">· documentation</span></div>`;
  if (atts.length) _secPhotos += `<div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:8px">` + atts.map(a => `<a href="${upUrl(a.id)}" target="_blank" rel="noopener"><img src="${upUrl(a.id)}" style="width:100px;height:100px;object-fit:cover;border-radius:8px;border:1px solid var(--line)" loading="lazy"></a>`).join("") + `</div>`;
  else _secPhotos += `<div class="muted" style="margin-bottom:8px">No photos yet.</div>`;
  _secPhotos += `<input type="file" id="job_photo" accept="image/*" style="display:none" onchange="jobAddPhoto('${j.id}',this)"><button class="btn acc" style="width:100%" onclick="document.getElementById('job_photo').click()">📷 Add photo</button></div>`;

  // Job costs & receipts — the UNIFIED receipt card + the filed list. After the drive (you buy en route/on-site).
  let _secCosts = jobFiledCostsHTML(j);
  _secCosts += (typeof jobRcptCardHTML === "function") ? jobRcptCardHTML(j) : "";

  // Notes
  let _secNotes = `<div class="card"><div style="font-weight:800;margin-bottom:6px">📝 Notes <span class="sub" style="font-weight:400">· Cap learns from these</span></div>
    <textarea id="job_notes" style="min-height:64px" placeholder="What happened, access notes, gotchas…">${esc(j.notes || "")}</textarea>
    <button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="jobSaveNotes('${j.id}')">Save notes</button></div>`;

  // Ask Cap about THIS job — context-aware
  const me2 = (typeof curUser === "function") ? curUser() : null;
  const capTid = "thr_job_" + j.id;   // ONE shared thread per job — the whole crew + Cap share it
  const _legacyPrefix = capTid + "_";  // tolerate un-migrated per-user threads (thr_job_<id>_<uid>) so no message is lost
  const capMsgs = (D().messages || []).filter(m => m && !m.kind && !m.deleted && (m.threadId === capTid || (m.threadId || "").indexOf(_legacyPrefix) === 0)).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  let _secAskCap = `<div class="card"><div style="font-weight:800;margin-bottom:6px">💬 Ask Cap <span class="sub" style="font-weight:400">· attach a photo</span></div>`;
  _secAskCap += capMsgs.length
    ? capMsgs.slice(-6).map(m => { const isCap = m.senderId === "__ceo__" || m.senderId === "__cap__"; const _ma = (m.attachments || []).filter(a => a && a.id && !a.deleted); return `<div class="li" style="${isCap ? "background:var(--soft)" : ""}"><div class="grow"><div class="sub" style="font-weight:700">${isCap ? "🤖 Cap" : esc(m.senderLabel || "You")} <span style="font-weight:400">· ${typeof relTime === "function" ? relTime(m.ts) : ""}</span></div><div style="white-space:pre-wrap">${esc(m.body)}</div>${_ma.map(a => `<a href="${upUrl(a.id)}" target="_blank" rel="noopener"><img src="${upUrl(a.id)}" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid var(--line);margin-top:6px" loading="lazy"></a>`).join("")}</div></div>`; }).join("")
    : `<div class="muted">Ask Cap anything about this job — he knows the customer, address, notes &amp; equipment. e.g. "Are we providing the pavers, or is it client-provided?"</div>`;
  _secAskCap += `<textarea id="jobcap_q" style="min-height:48px;margin-top:8px" placeholder="Ask Cap… (e.g. send a photo of the spot and ask what base it needs)"></textarea><input type="file" id="jobcap_photo" accept="image/*" style="display:none" onchange="var l=document.getElementById('jobcap_photo_lbl');if(l)l.textContent='✓ Photo ready'"><div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost grow" onclick="document.getElementById('jobcap_photo').click()"><span id="jobcap_photo_lbl">📷 Attach photo</span></button><button class="btn acc grow" onclick="jobAskCap('${j.id}')">💬 Ask Cap</button></div></div>`;

  // 💵 Invoice & payment
  let _secInvoice = `<div class="card" style="border-left:5px solid var(--brand)"><div style="font-weight:800;margin-bottom:6px">💵 Invoice &amp; payment</div>`;
  const _mq = (typeof actQ === "function") ? (j.quoteId ? actQ().find(x => x && x.id === j.quoteId) : actQ().find(x => x && x.jobId === j.id)) : null;
  if (_mq) {
    const _tot = (typeof quoteEffectiveTotal === "function") ? quoteEffectiveTotal(_mq) : (+(_mq.finalPrice || _mq.total) || 0);
    const _paid = (typeof quotePaidAmt === "function") ? quotePaidAmt(_mq) : 0;
    const _bal = (typeof quoteBalAmt === "function") ? quoteBalAmt(_mq) : Math.max(0, _tot - _paid);
    const _canEdit = jobCanEditPlan();
    _secInvoice += `<div class="sub" style="white-space:normal">Invoice <b>${money(_tot)}</b>${_paid > 0 ? ` · ${money(_paid)} paid · <b>${money(_bal)} owed</b>` : ""}${_mq.finalPrice ? ` <span class="muted">(quote was ${money(_mq.total || 0)})</span>` : ""}</div>`;
    if (_mq.invoiced) _secInvoice += `<div class="sub" style="margin-top:4px;color:var(--accent);font-weight:700">✓ Invoiced${_mq.invoiceNo ? ` #${esc(_mq.invoiceNo)}` : ""}${_mq.invoicedDate ? " · " + fmtDate(_mq.invoicedDate) : ""}</div>`;
    if (_mq.paid) _secInvoice += `<div class="sub" style="margin-top:4px;color:var(--accent);font-weight:800">✓ Paid in full${_mq.paidDate ? " · " + fmtDate(_mq.paidDate) : ""}</div>`;
    if (_mq.paymentLink) _secInvoice += `<div style="margin-top:8px"><a class="btn acc sm" href="${esc(_mq.paymentLink)}" target="_blank" rel="noopener">💳 Pay now</a></div>`;
    if (_canEdit) {
      _secInvoice += `<div class="row" style="gap:8px;margin-top:10px">`;
      if (!_mq.invoiced) _secInvoice += `<button class="btn acc grow" onclick="invMark('${_mq.id}')">🧾 Mark invoiced</button>`;
      _secInvoice += `<button class="btn ${_mq.paid ? "ghost" : "acc"} grow" onclick="recordPayment('${_mq.id}')">💵 ${_mq.paid ? "Payments" : "Record payment"}</button>`;
      _secInvoice += `</div>`;
      _secInvoice += `<label style="margin-top:10px">Final price charged <span class="sub">(if different from the ${money(_mq.total || 0)} quote)</span></label>`;
      _secInvoice += `<div class="row" style="gap:8px"><input id="job_final" type="number" inputmode="decimal" placeholder="${_mq.total || 0}" value="${_mq.finalPrice || ""}" style="flex:1"><button class="btn ghost sm" onclick="jobPageSaveFinal('${j.id}')">Save</button></div>`;
      _secInvoice += `<input id="job_adjnote" placeholder="Reason (e.g. added a step, gave a discount)" value="${esc(_mq.adjNote || "")}" style="margin-top:6px">`;
      _secInvoice += `<label style="margin-top:10px">Card-payment link <span class="sub">(Stripe — shown to the customer)</span></label>`;
      _secInvoice += `<button class="btn acc sm" id="inv_genlink_${_mq.id}" style="width:100%" onclick="invGenPayLink('${_mq.id}')">${_mq.paymentLink ? "↻ Regenerate card-payment link" : "⚡ Generate card-payment link"}</button>`;
      _secInvoice += `<div class="row" style="gap:8px;margin-top:6px"><input id="job_paylink" placeholder="…or paste a link manually" value="${esc(_mq.paymentLink || "")}" style="flex:1"><button class="btn ghost sm" onclick="jobPageSetPayLink('${j.id}')">Save</button></div>`;
      _secInvoice += `<div class="sub" style="margin-top:8px;white-space:normal">Item &amp; line-price change orders stay in the full quote (📜 version history) — this card only sets the final charge, invoice &amp; payment.</div>`;
    }
  } else {
    _secInvoice += `<div class="muted">No quote is linked to this job yet.</div>`;
    // Retroactive / custom-price jobs (the job already happened, no wizard needed): a one-tap "create a quote"
    // that spins up a blank quote linked to THIS job + customer and opens it, so you can just type the price.
    if (jobCanEditPlan()) _secInvoice += `<button class="btn acc" style="width:100%;margin-top:10px" onclick="jobCreateQuote('${j.id}')">🧾 Create a quote for this job</button><div class="sub muted" style="margin-top:6px;white-space:normal">Makes a blank quote linked to this job — add a line or just set the price it was charged at.</div>`;
  }
  _secInvoice += `</div>`;

  // 📄 Customer materials report — owner/admin, only when the job has pass-through items
  let _secMatReport = "";
  if ((typeof finCanView !== "function" || finCanView()) && typeof jobHasPassThrough === "function" && jobHasPassThrough(j)) {
    _secMatReport += `<div class="card"><div style="font-weight:800;margin-bottom:6px">📄 Customer materials report</div>`;
    _secMatReport += `<div class="sub" style="white-space:normal;margin-bottom:8px">A professional, printable document of every pass-through material charge on this job — with the receipts attached — to hand the customer.</div>`;
    _secMatReport += `<button class="btn acc" style="width:100%" onclick="jobMaterialsReport('${j.id}')">📄 Materials report (for customer)</button></div>`;
  }

  // Close-out sign-offs (owner/admin) — reviewed + all-expenses-collected, decoupled from payment
  let _secCloseout = "";
  if (jobCanEditPlan()) {
    const _revd = (typeof plReviewed === "function" && _mq) ? plReviewed(_mq) : !!j.reviewed;
    const _coll = !!j.expensesCollected;
    const _openC = (typeof jobReceiptsOpenCrew === "function") ? jobReceiptsOpenCrew(j).map(id => (typeof userName === "function" ? userName(id) : "") || "").filter(Boolean) : [];
    _secCloseout += `<div class="card" style="border-left:5px solid var(--brand)"><div style="font-weight:800;margin-bottom:4px">✅ Close-out sign-offs <span class="sub" style="font-weight:400">· independent of payment</span></div>`;
    _secCloseout += `<div class="sub" style="margin-bottom:6px;white-space:normal">Two separate checks so a slow crew member can't hold up payment: mark the job <b>reviewed</b> and confirm <b>all expenses are collected</b>. A paid job with expenses still open stays flagged for follow-up.</div>`;
    _secCloseout += `<label class="li" style="cursor:pointer"><input type="checkbox" style="width:22px;height:22px;flex:0 0 auto" ${_revd ? "checked" : ""} onchange="jobToggleReviewed('${j.id}')"><div class="grow"><div class="nm" style="font-size:15px">⭐ Reviewed</div><div class="sub" style="white-space:normal">${_revd ? "Signed off — the after-action is done." : "The after-action review — what went well / do differently."}</div></div>${_revd && _mq ? `<button class="btn ghost sm" style="flex:0 0 auto" onclick="plReview('${_mq.id}')">Edit</button>` : (_mq ? `<button class="btn ghost sm" style="flex:0 0 auto" onclick="plReview('${_mq.id}')">Write ›</button>` : "")}</label>`;
    _secCloseout += `<label class="li" style="cursor:pointer"><input type="checkbox" style="width:22px;height:22px;flex:0 0 auto" ${_coll ? "checked" : ""} onchange="jobToggleExpensesCollected('${j.id}')"><div class="grow"><div class="nm" style="font-size:15px">🧾 All expenses collected</div><div class="sub" style="white-space:normal">${_coll ? `Signed off${j.expensesCollectedBy ? " by " + esc(j.expensesCollectedBy) : ""}${j.expensesCollectedAt && typeof relTime === "function" ? " · " + relTime(j.expensesCollectedAt) : ""} — every crew member's receipts are in.` : "Confirm every crew member submitted their expenses for this job."}</div></div></label>`;
    if (!_coll && _openC.length) _secCloseout += `<div class="note" style="margin-top:8px;white-space:normal;border-left:3px solid #d9822b">⚠ ${_openC.length} crew still to close out: <b>${esc(_openC.join(", "))}</b>. You can sign off anyway once you've confirmed their expenses are in — payment isn't blocked either way.</div>`;
    _secCloseout += `</div>`;
  }

  // Change order — an EDIT to the same quote, saved as a version. (Data-ish → hoisted up near the top.)
  let _secChange = `<div class="card"><div style="font-weight:800;margin-bottom:6px">🧾 Change order</div>`;
  if (j.quoteId) {
    const _cq = (typeof actQ === "function") ? actQ().find(x => x && x.id === j.quoteId) : null;
    _secChange += `<div class="sub" style="margin-bottom:8px;white-space:normal">Something changed on-site? Edit the full quote — size · materials · price. The customer's price updates in place; if the quote's already accepted or invoiced, each change is saved to its version history (no new invoice number).</div>`;
    _secChange += `<button class="btn acc" style="width:100%;text-align:left" onclick="openQuote('${j.quoteId}')">🧾 Make a change order — edit the full quote</button>`;
    const _vn = (_cq && Array.isArray(_cq.versions)) ? _cq.versions.length : 0;
    const _canReview = (typeof isOwner === "function" && isOwner()) || (typeof canDo === "function" && canDo("manage-members"));
    if (_vn && _canReview) _secChange += `<button class="btn ghost sm" style="width:100%;margin-top:8px;text-align:left" onclick="quoteVersionHistory('${j.quoteId}')">📜 Version history (${_vn})</button>`;
    _secChange += `<button class="btn ghost sm" style="width:100%;margin-top:8px;text-align:left" onclick="jobSendUpdatedQuote('${j.quoteId}')">📤 Send updated quote</button>`;
  } else {
    _secChange += `<div class="muted">No quote is linked to this job yet.</div>`;
  }
  _secChange += `</div>`;

  // Done + actions (Google-review + Edit-job buttons removed earlier; "Save as a common job" dropped per Ray)
  let _secDone = `<button class="btn ${j.done ? "ghost" : "acc"}" style="width:100%;margin-top:4px" onclick="toggleJob('${j.id}')">${j.done ? "↩ Reopen job" : "✓ Mark job done"}</button>`;
  // (Google-review BUTTON removed per Ray — the job-done auto-prompt (js/51 reviewPrompt, fired from js/09 toggleJob)
  //  still asks at the right moment; reviewAsk() itself stays (used to SET the review link from js/18 + js/51).)
  // ("✏️ Edit job" button removed — customer/date/time are now inline in the "where & when" card above, and
  //  title/crew/notes/location/route/work-days/equipment were already inline. The openJob modal remains the
  //  CREATE form only, reached from Schedule / customer / property "Add job".)
  if (typeof isOwner === "function" && isOwner()) _secDone += `<button class="btn ghost sm" style="width:100%;margin:8px 0 14px;color:var(--danger)" onclick="delJob('${j.id}')">🗑 Delete job (to Archive, 60-day undo)</button>`;

  // ===== ASSEMBLE in the ORG-CONFIGURED order (owner-reorderable, org-wide). Each section has a stable key +
  // short label; jobLayoutOrder() returns the saved order (default = the workday order below). In "Edit layout"
  // mode (owner) every section gets a ▲▼ move bar that writes the org-wide order. h already has the fixed header.
  const _sections = [
    { key: "data", label: "📋 Details", html: _secData },
    { key: "partof", label: "↳ Part of a bigger job", html: _secPartOf },
    { key: "change", label: "🧾 Change order", html: _secChange },
    { key: "askcap", label: "💬 Ask Cap", html: _secAskCap },
    { key: "crew", label: "👥 Crew", html: _secCrew },
    { key: "vehicles", label: "🚚 Vehicles & routes", html: _secVehicles },
    { key: "clock", label: "⏱️ Time clock", html: _secClock },
    { key: "load", label: "🧰 Load checklist", html: _secLoad },
    { key: "costs", label: "💵 Job costs & receipts", html: _secCosts },
    { key: "matreport", label: "📄 Materials report", html: _secMatReport },
    { key: "photos", label: "🖼 Job photos", html: _secPhotos },
    { key: "notes", label: "📝 Notes", html: _secNotes },
    { key: "invoice", label: "💵 Invoice & payment", html: _secInvoice },
    { key: "closeout", label: "✅ Close-out sign-offs", html: _secCloseout },
    { key: "workdays", label: "🗓 Work days", html: _secWorkdays },
    { key: "done", label: "✓ Job actions", html: _secDone }
  ];
  const _ordered = (typeof jobLayoutApply === "function") ? jobLayoutApply(_sections) : _sections;
  const _editing = !!window.JOB_LAYOUT_EDIT && jobCanEditPlan();
  if (jobCanEditPlan()) h += `<div class="row" style="justify-content:flex-end;margin:2px 2px 6px"><button class="btn ${_editing ? "acc" : "ghost"} sm" onclick="jobLayoutToggleEdit()">${_editing ? "✓ Done reordering" : "⇅ Edit layout"}</button>${_editing ? `<button class="btn ghost sm" style="margin-left:6px" onclick="jobLayoutReset()">↺ Reset</button>` : ""}</div>`;
  if (_editing) h += `<div class="sub muted" style="white-space:normal;margin:0 2px 8px">Reordering the sections for <b>everyone</b> — use ▲▼ to move a section. Empty sections (that don't apply to this job) are hidden but keep their place.</div>`;
  // WORKFLOW TABS — one group at a time instead of 16 stacked cards (reorder mode still shows all, for moving them).
  const _atab = JOB_TABS.some(t => t.key === window.JOB_TAB) ? window.JOB_TAB : "overview";
  const _tabDef = JOB_TABS.find(t => t.key === _atab) || JOB_TABS[0];
  if (!_editing) {
    h += `<div class="row" style="gap:5px;overflow-x:auto;-webkit-overflow-scrolling:touch;margin:2px 0 12px;padding-bottom:2px">` + JOB_TABS.map(t => {
      const _has = _ordered.some(s => t.secs.indexOf(s.key) >= 0 && s.html);
      return `<button class="btn ${t.key === _atab ? "acc" : "ghost"} sm" style="flex:0 0 auto;white-space:nowrap${_has ? "" : ";opacity:.5"}" onclick="jobSetTab('${t.key}')">${t.label}</button>`;
    }).join("") + `</div>`;
  }
  const _visible = _editing ? _ordered : _ordered.filter(s => _tabDef.secs.indexOf(s.key) >= 0);
  _visible.forEach((s, i) => {
    if (_editing) {
      const up = i === 0 ? "disabled" : "", dn = i === _visible.length - 1 ? "disabled" : "";
      h += `<div class="card" style="padding:6px 10px;background:var(--soft);margin-bottom:6px"><div class="row" style="align-items:center;gap:6px"><div class="grow nm" style="font-size:14px">${s.label}${s.html ? "" : ` <span class="sub" style="font-weight:400">· not on this job</span>`}</div><button class="btn ghost sm" ${up} onclick="jobLayoutMove('${s.key}',-1)" title="Move up">▲</button><button class="btn ghost sm" ${dn} onclick="jobLayoutMove('${s.key}',1)" title="Move down">▼</button></div></div>`;
    } else {
      h += s.html || "";
    }
  });
  if (!_editing && !_visible.some(s => s.html)) h += `<div class="card"><div class="muted">Nothing on the ${esc(_tabDef.label.replace(/^\S+\s/, ""))} tab for this job yet.</div></div>`;
  // Bottom back button — so after scrolling down to check the job you can go back without scrolling all the way up.
  h += `<button class="btn ghost" style="width:100%;margin:14px 0 24px" onclick="jobPageBack()">← Back</button>`;
  h += `</div>`;   // /.jobpg
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
  // Shared badge styles for the ordered-route SEQUENCE: a numbered navy circle for stops, a green 🏁 flag for the
  // Start/End bookends. The box-shadow ring is the CARD colour so each badge visually "cuts" the vertical connector
  // rail behind it → the rail reads as one line linking the points in order (a stops-in-sequence look).
  const badgeBase = "flex:0 0 30px;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;line-height:1;z-index:1;position:relative;box-shadow:0 0 0 3px var(--card)";
  const numBadge = n => `<div style="${badgeBase};background:var(--brand);color:#fff">${n}</div>`;
  const flagBadge = () => `<div style="${badgeBase};background:var(--accent);color:#fff">🏁</div>`;
  // Start/End bookends — a 🏁 flag point that is STILL editable (the address input sits under the label). They are
  // points 0 and last of the SAME sequence, styled like the numbered stops so the whole thing reads as one path.
  const endpointRow = (title, id, value, custom, setFn, resetFn) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;position:relative">${flagBadge()}
    <div class="grow" style="min-width:0">
      <div class="row" style="align-items:center;gap:6px"><div class="nm grow" style="font-size:16px;font-weight:700">${title}${custom ? "" : ` <span class="sub" style="font-weight:400">· home base</span>`}</div>${custom ? `<button class="btn ghost sm" style="flex:0 0 auto;opacity:.7" onclick="${resetFn}('${j.id}')" title="Reset to home base">↺ base</button>` : ""}</div>
      <div class="acwrap" style="margin-top:4px"><input id="${id}" value="${esc(value)}" placeholder="${baseAddr ? "Address (home base by default)" : "Set the home base in Settings"}" autocomplete="off" onfocus="addrSuggest('${id}','${id}_ac')" oninput="addrSuggest('${id}','${id}_ac')" onchange="${setFn}('${j.id}', this.value)"><div class="acbox" id="${id}_ac"></div></div>
    </div></div>`;
  let h = `<div class="card"><div style="font-weight:800;margin-bottom:4px">🧭 Route &amp; mileage <span class="sub" style="font-weight:400">· ordered — feeds the mileage estimate</span></div>`;
  h += `<div class="sub" style="margin-bottom:6px;white-space:normal">The ordered path the estimate follows, <b>Start → … → End</b>. Use ▲▼ to reorder — the 🏁 <b>job site</b> can sit anywhere in between (e.g. Start → job site → transfer station → End). Start &amp; End default to your home base but you can change either. The crew get per-stop labeled directions up top; here you get the offline mileage cross-check to the odometer. Owner/admin only.</div>`;
  // ===== THE ORDERED ROUTE — the visual centrepiece. ONE relative container draws a vertical connector rail behind
  // the badge column (left:15px = badge centre) so 🏁 Start → numbered stops/site → 🏁 End read as a single path. =====
  h += `<div style="position:relative;margin:2px 0 4px"><div aria-hidden="true" style="position:absolute;left:15px;top:22px;bottom:22px;width:2px;background:var(--line);z-index:0"></div>`;
  // 🏁 START (first point) — editable bookend, pre-filled with home base
  h += endpointRow("Start", "jrs_start", startVal, startCustom, "jobPageSetStart", "jobPageResetStart");
  // the COMBINED ordered route (planned stops + the movable job site) from the shared jobRouteOrdered(j).
  // Every row gets ▲▼ (jobPageRouteMove on the COMBINED index); ▲ is disabled on the first row, ▼ on the last.
  // Stop rows keep the ✕ delete (mapped to the stop's RAW plannedStops index, t.raw); the 🏁 job-site row is
  // NON-deletable (no ✕) — it's the job itself, you only move it. "+ Add stop" pushes to the end, then reorder.
  const combo = (typeof jobRouteOrdered === "function") ? jobRouteOrdered(j) : [];
  h += combo.map((t, ci) => {
    const upDis = ci === 0 ? "disabled" : "", dnDis = ci === combo.length - 1 ? "disabled" : "";
    // DEMOTED edit controls — small, subdued (opacity .6), right-aligned; ▲ off on the first row, ▼ off on the last.
    const moveBtns = `<button class="btn ghost sm" ${upDis} onclick="jobPageRouteMove('${j.id}',${ci},-1)" title="Move up">▲</button><button class="btn ghost sm" ${dnDis} onclick="jobPageRouteMove('${j.id}',${ci},1)" title="Move down">▼</button>`;
    if (t.kind === "site") {
      return `<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;position:relative;z-index:1">${numBadge(ci + 1)}<div class="grow" style="min-width:0"><div class="nm" style="font-size:16px;font-weight:700;white-space:normal">🏁 Job site <span class="sub" style="font-weight:400">· the job</span></div>${siteAddr ? `<div class="sub" style="white-space:normal">${esc(siteAddr)}</div>` : `<div class="sub muted">Set the job location above (✏️ Edit location).</div>`}</div><div class="row" style="gap:2px;flex:0 0 auto;opacity:.6">${moveBtns}</div></div>`;
    }
    const s = t.stop;
    return `<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;position:relative;z-index:1">${numBadge(ci + 1)}<div class="grow" style="min-width:0"><div class="nm" style="font-size:16px;font-weight:700;white-space:normal">${esc(s.label || s.address || "Stop")}</div>${s.label && s.address ? `<div class="sub" style="white-space:normal">${esc(s.address)}</div>` : ""}</div><div class="row" style="gap:2px;flex:0 0 auto;opacity:.6">${moveBtns}<button class="btn ghost sm" onclick="jobPageStopDel('${j.id}',${t.raw})" title="Remove">✕</button></div></div>`;
  }).join("");
  // 🏁 END (last point) — editable bookend, pre-filled with home base
  h += endpointRow("End", "jrs_end", endVal, endCustom, "jobPageSetEnd", "jobPageResetEnd");
  h += `</div>`;   // close the ordered-route sequence container (rail)
  // ===== SECONDARY: add a stop — DEMOTED below the route under a subtle divider, lighter than the sequence so it
  // doesn't overpower the stops. BOTH fields search the saved index; picking either fills the other. The Label
  // searches names only (data-savedonly, data-name-into) and routes the picked address+ref to jps_addr
  // (data-pair-addr); the Address searches saved+OSM and fills the empty Label (data-pair-label). Attrs UNCHANGED. =====
  h += `<div style="margin-top:6px;padding-top:10px;border-top:1px dashed var(--line)"><div class="sub muted" style="margin-bottom:4px">Add a stop to the route</div>`;
  h += `<div class="row" style="gap:8px"><div class="acwrap" style="flex:1 1 140px"><input id="jps_label" placeholder="Name — search places, or type" data-savedonly="1" data-name-into="1" data-pair-addr="jps_addr" onfocus="addrSuggest('jps_label','jps_label_ac')" oninput="addrSuggest('jps_label','jps_label_ac')" autocomplete="off" style="width:100%"><div class="acbox" id="jps_label_ac"></div></div><div class="acwrap" style="flex:1 1 140px"><input id="jps_addr" placeholder="Address — search or type" data-pair-label="jps_label" onfocus="addrSuggest('jps_addr','jps_addr_ac')" oninput="addrSuggest('jps_addr','jps_addr_ac')" autocomplete="off" style="width:100%"><div class="acbox" id="jps_addr_ac"></div></div></div>`;
  h += `<button class="btn ghost sm" style="margin-top:6px;width:100%" onclick="jobPageStopAdd('${j.id}')">+ Add stop</button></div>`;
  // ESTIMATE (informational cross-check) — the offline round-trip miles across the ordered route. NEVER the billed
  // number: the odometer/GPS timeclock miles stay the record. Moved here (was in the crew "Where & when" card) so
  // crew get NO mileage math — it now lives in this single owner/admin card. Confirmed odometer shown side by side.
  const _src = (typeof jobRouteMilesSource === "function") ? jobRouteMilesSource(j) : "";
  if (j.estRouteMiles > 0) {
    const _nstops = (typeof jobPlannedStops === "function") ? jobPlannedStops(j).length : ps.length;
    const _confMiles = ((typeof actTC === "function") ? actTC() : []).filter(e => e && !e.deleted && e.jobId === j.id && e.clockOut && e.milesConfirmed).reduce((s, e) => s + (+e.miles || 0), 0);
    const _rs = jobRouteEndpointLabel(j.routeStart), _re = jobRouteEndpointLabel(j.routeEnd);
    const _ends = (_rs || _re) ? ` <span class="muted">· ${_rs ? "from " + esc(_rs) : "from base"} → ${_re ? "to " + esc(_re) : "to base"}</span>` : "";
    const _srcTag = _src === "roads" ? ` <span class="muted">(via roads)</span>` : _src === "manual" ? ` <span class="muted">(manual)</span>` : "";
    h += `<div class="sub" style="margin-top:8px;white-space:normal">🧭 Est. route: ~<b>${j.estRouteMiles} mi</b> <b>round trip</b>${_srcTag}${_nstops ? ` across ${_nstops} stop${_nstops > 1 ? "s" : ""}${siteAddr ? " + job site" : ""}` : ""}${_ends} <span class="muted">· full loop base→stops→site→base, a cross-check — not the billed miles</span></div>`;
    if (_confMiles > 0) { const _pct = Math.round(_confMiles / j.estRouteMiles * 100); h += `<div class="sub" style="margin-top:2px;white-space:normal">🚗 Odometer of record: <b>${Math.round(_confMiles * 10) / 10} mi</b> <span class="muted">(${_pct}% of the estimate — odometer wins)</span></div>`; }
  } else if (_src === "none") {
    h += `<div class="sub muted" style="margin-top:8px;white-space:normal">🧭 The map couldn't route this — add manual route miles below to get an estimate.</div>`;
  } else if (ps.length || startCustom || endCustom) h += `<div class="sub muted" style="margin-top:8px;white-space:normal">Computing the road route… the mileage estimate appears once the map answers (needs a home base set in Settings).</div>`;
  // 🗺 OPEN THE WHOLE ROUTE IN GOOGLE MAPS — the ordered loop (Start → stops/site → End) packed into one /maps/dir/
  // path URL, so you can read the round-trip miles straight off Google. Especially the manual fallback when the
  // offline estimate couldn't route. Ordered exactly like the sequence above; drops any empty/missing address.
  const _routeAddrs = [startVal].concat(combo.map(t => t.kind === "site" ? siteAddr : (t.stop && t.stop.address))).concat([endVal]);
  const _gmapsRoute = (typeof gmapsRouteUrl === "function") ? gmapsRouteUrl(_routeAddrs) : "";
  // NB: an <a class="btn"> defaults to display:inline, so .btn's min-height/padding overflow its line box and
  // overlap the estimate line above — force flex block layout (like a real <button>) so it sits on its own row.
  if (_gmapsRoute) h += `<a class="btn ghost sm" style="width:100%;margin-top:8px;display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap" href="${_gmapsRoute}" target="_blank" rel="noopener">🗺 Open the full route in Google Maps <span class="sub" style="font-weight:400">· read the round-trip miles</span></a>`;
  // 🚗 OVERRIDE the mileage (round-trip) — the map estimate above is used AUTOMATICALLY; this box is ONLY to
  // override it when the map routed wrong (or couldn't route). When there's a map estimate and no override it's
  // tucked into a collapsed "override" toggle so it isn't mistaken for a required field. Owner/admin only.
  const _hasEst = j.estRouteMiles > 0, _manOn = j.manualRouteMiles > 0;
  const _manBox = `<label style="margin-top:0">🚗 ${_hasEst ? "Override the mileage" : "Route miles"} <span class="sub" style="font-weight:400">· round-trip</span></label><div class="row" style="gap:8px"><input id="jrm_miles" type="number" inputmode="decimal" value="${_manOn ? j.manualRouteMiles : ""}" placeholder="${_hasEst ? j.estRouteMiles + " mi — the map estimate" : "round-trip miles"}" style="flex:1" onchange="jobSetManualRouteMiles('${j.id}', this.value)"><button class="btn ghost sm" onclick="jobSetManualRouteMiles('${j.id}', document.getElementById('jrm_miles').value)">Save</button></div><div class="sub muted" style="margin-top:4px;white-space:normal">${_manOn ? `✓ Overriding with <b>${j.manualRouteMiles} mi</b> — clear the box + Save to go back to the map estimate.` : (_hasEst ? "The map estimate above is used automatically — you don't need to type anything. Only enter a number if the map routed it wrong." : "The map couldn't route this — enter the round-trip miles so the mileage cost is right.")}</div>`;
  if (_hasEst && !_manOn) h += `<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--muted);font-size:13px">🚗 Map estimate wrong? Override the mileage ›</summary><div style="margin-top:6px">${_manBox}</div></details>`;
  else h += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">${_manBox}</div>`;
  // 🗺 View route (owner/admin) — deep-link to the read-only GPS route-review page for THIS job (js/91). Lives here
  // in the admin route card (was in the crew "Where & when" card); it was already jobCanEditPlan-gated.
  if (typeof openRouteReview === "function") h += `<button class="btn ghost sm" style="width:100%;margin-top:10px" onclick="openRouteReview('${j.id}')">🗺 View route (GPS)</button>`;
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
/* ===== INLINE WHO/WHEN EDITORS (owner/admin) — customer · date · time, written straight to the record (like the
   inline title/crew/route editors, NOT the openJob modal). Each: guard jobCanEditPlan, resolve the job, set the
   one field, touch + logChange + save + render. Idempotent, never throws. These are display/field edits only — no
   money math — so the finance fingerprints stay byte-identical (customer/date/time were already writable via the
   modal). The openJob modal stays the CREATE form. */
window.jobSetCustomer = function (jobId, custId) {
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  j.customerId = custId || "";
  if (typeof touch === "function") touch(j);
  if (typeof logChange === "function") logChange("update", "job", j.id, "Set customer" + (custId && typeof custName === "function" ? " → " + custName(custId) : " → none"));
  if (typeof save === "function") save(); if (typeof render === "function") render();
};
/* 🔁 turn THIS job into a recurring plan — opens the recurring-plan editor (js/103 recurPlanOpen) pre-filled
   from the job's customer / property / service / price / crew / time, starting on the job's date. Owner/admin. */
window.jobMakeRecurring = function (jobId) {
  const j = (typeof actJ === "function" ? actJ() : (D().jobs || [])).find(x => x && x.id === jobId); if (!j) return;
  if (typeof recurPlanOpen !== "function") { if (typeof alert === "function") alert("Recurring plans aren't available here."); return; }
  const q = j.quoteId ? ((typeof actQ === "function" ? actQ() : []).find(x => x && x.id === j.quoteId)) : null;
  recurPlanOpen(null, {
    customerId: j.customerId || "", propertyId: j.propertyId || "",
    address: (typeof jobAddr === "function" ? jobAddr(j) : (j.address || "")),
    title: j.title || "", serviceId: j.serviceId || "",
    price: q ? (q.finalPrice || q.total || "") : "",
    time: j.time || "", estDays: (q && +q.estDays > 0) ? +q.estDays : 1,
    crew: Array.isArray(j.crew) ? j.crew.slice() : [],
    startDate: j.date || (typeof today === "function" ? today() : "")
  });
};
window.jobSetDate = function (jobId, ds) {
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const old = j.date || "";
  j.date = ds || "";
  // Keep the multi-day work set coherent: the (new) start day is always a work day, and an empty OLD start day
  // (no time punches) is dropped so it doesn't linger — mirrors the modal's jobStartDateChanged intent. Reuses the
  // on-page jobPageCommitDays helper (dedupe + keep start + sort + touch + save) so the two can't drift.
  if (typeof jobPageCommitDays === "function") {
    let wd = (typeof jobPageWorkDays === "function") ? jobPageWorkDays(j) : ((Array.isArray(j.workDays) ? j.workDays.slice() : (old ? [old] : [])));
    if (old && old !== j.date) {
      const _day = ms => (typeof tcLocalDay === "function") ? tcLocalDay(ms) : String(new Date(ms).toISOString().slice(0, 10));
      const oldHasPunch = ((typeof D === "function" ? (D().timeclock || []) : [])).some(e => e && !e.deleted && e.jobId === jobId && e.clockIn != null && _day(e.clockIn) === old);
      if (!oldHasPunch) wd = wd.filter(d => d !== old);
    }
    jobPageCommitDays(j, wd);   // touches + saves (and re-adds j.date)
  } else {
    if (typeof touch === "function") touch(j); if (typeof save === "function") save();
  }
  if (typeof logChange === "function") logChange("update", "job", j.id, "Set date " + (j.date || "—"));
  if (typeof render === "function") render();
};
window.jobSetTime = function (jobId, t) {
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  j.time = t || "";
  if (typeof touch === "function") touch(j);
  if (typeof logChange === "function") logChange("update", "job", j.id, "Set time " + (j.time || "—"));
  if (typeof save === "function") save(); if (typeof render === "function") render();
};
/* CLOSE-OUT SIGN-OFFS (owner/admin) — two independent toggles, DECOUPLED from payment (js/60 workStage). */
/* (a) Reviewed — reuses the existing j.reviewed / q.reviewed pair that plReviewed(q) reads (js/67), so the
   lightweight toggle here and the full plReview modal stay in sync. Sets/clears BOTH so plReviewed flips too. */
window.jobToggleReviewed = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const v = !j.reviewed;
  j.reviewed = v;
  const q = (typeof actQ === "function") ? (j.quoteId ? actQ().find(x => x && x.id === j.quoteId) : actQ().find(x => x && x.jobId === j.id)) : null;
  if (q) { q.reviewed = v; if (typeof touch === "function") touch(q); }   // keep plReviewed(q)=q.reviewed||j.reviewed consistent
  if (typeof touch === "function") touch(j);
  if (typeof logChange === "function") logChange("update", "job", j.id, "Reviewed " + (v ? "✓" : "cleared"));
  if (typeof save === "function") save(); if (typeof render === "function") render();
};
/* (b) All expenses collected — the additive j.expensesCollected flag (+ At/By stamp). Absent = false = today's
   behavior. Billing/finance never read it; workStage (js/60) uses it only to satisfy the expense→invoice gate
   past a slow crew member. Never gates or is gated by paid/invoiced. */
window.jobToggleExpensesCollected = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  const v = !j.expensesCollected;
  j.expensesCollected = v;
  if (v) { j.expensesCollectedAt = (typeof now === "function") ? now() : Date.now(); j.expensesCollectedBy = ((typeof curUser === "function" && curUser()) ? curUser().username : "") || ""; }
  else { j.expensesCollectedAt = null; j.expensesCollectedBy = ""; }
  if (typeof touch === "function") touch(j);
  if (typeof logChange === "function") logChange("update", "job", j.id, "All expenses collected " + (v ? "✓" : "cleared"));
  if (typeof save === "function") save(); if (typeof render === "function") render();
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
/* RENTAL DEPOSIT (js/96) sub-line under a job expense: while HELD it contributes $0 to this job; once the owner
   settles it, it shows the net (deposit − refund). A refund record shows its ↩ credit note. Empty for ordinary rows. */
function jobDepositLine(e) {
  if (!e) return "";
  if (e.isDeposit) {
    if (typeof depositHeld === "function" && depositHeld(e)) return `<div class="sub" style="white-space:normal;color:#b8860b;font-weight:600">🏗 Rental deposit ${money(e.amount)} — HELD (awaiting refund), ${money(0)} to this job</div>`;
    const net = (typeof depositNetCost === "function") ? depositNetCost(e) : (+e.amount || 0);
    const refund = net - (+e.amount || 0);   // negative (or 0)
    return `<div class="sub" style="white-space:normal;color:var(--accent);font-weight:600">🏗 deposit ${money(e.amount)}${refund ? " − refund " + money(-refund) : ""} = ${money(net)} net</div>`;
  }
  if (e.kind === "refund" || e.refundOfId) return `<div class="sub" style="white-space:normal;color:var(--accent)">↩ refund / credit${e.refundOfId ? " — offsets a rental deposit" : ""}</div>`;
  return "";
}
/* ===== FILED COSTS LIST (the unified receipt card's companion) — the job's already-filed job.expenses (🚚) +
   job.materials (🧱), GROUPED by receipt (splitGroup||receiptId||id) so a split receipt reads as one header +
   its tagged sub-lines; plus the derived cost-split summary, the virtual 🛣 mileage line, and the fault-dock
   summary. Per-line delete stays (jobDelExpense/jobDelMaterial). 🔧 tools live on the org expenses[] (business
   overhead, off every job) so they don't appear here. The ADD flow is now js/100's unified receipt card. */
function jobFiledLineHTML(j, it, indented) {
  const upUrl = id => (typeof jsUploadUrl === "function") ? jsUploadUrl(id) : "";
  const e = it.e, tag = it.tag, delFn = (it.store === "jobmat") ? "jobDelMaterial" : "jobDelExpense";
  const _fm = e.faultMemberId ? ((typeof userName === "function" ? userName(e.faultMemberId) : "") || "someone") : "";
  return `<div class="li"${indented ? ` style="padding-left:16px"` : ""}><div class="grow"><div class="nm" style="font-size:15px;white-space:normal">${tag} ${money(e.amount)}${(e.vendor && !indented) ? " <b>" + esc(e.vendor) + "</b>" : ""} <span class="sub" style="font-weight:400">${esc(e.desc || "")}</span></div><div class="sub">${e.by ? esc(e.by) + " · " : ""}${e.ts && typeof relTime === "function" ? relTime(e.ts) : ""}${_fm ? ` · <span style="color:var(--danger);font-weight:700">⚠ ${esc(_fm)}'s mistake — docks their payout</span>` : ""}</div>${(typeof jobDepositLine === "function") ? jobDepositLine(e) : ""}</div><div class="row" style="gap:8px;align-items:center">${(e.receiptId && !indented) ? `<a class="btn ghost sm" href="${upUrl(e.receiptId)}" target="_blank" rel="noopener">📎 receipt</a>` : ""}<button class="btn ghost sm" onclick="${delFn}('${j.id}','${e.id}')">✕</button></div></div>`;
}
function jobFiledCostsHTML(j) {
  const upUrl = id => (typeof jsUploadUrl === "function") ? jsUploadUrl(id) : "";
  const exps = ((typeof plExpenses === "function") ? plExpenses(j) : (j.expenses || [])).filter(x => x && !x.deleted);
  const mats = ((typeof plMaterials === "function") ? plMaterials(j) : (j.materials || [])).filter(x => x && !x.deleted);
  const expTotal = exps.reduce((s, e) => s + ((typeof depositHeld === "function" && depositHeld(e)) ? 0 : (+e.amount || 0)), 0);
  const matTotal = mats.reduce((s, e) => s + (+e.amount || 0), 0);
  const _bd = (typeof jobCostBreakdown === "function") ? jobCostBreakdown(j) : { mileage: 0, jobExp: 0, materials: 0, tool: 0 };
  let h = `<div class="card"><div style="font-weight:800;margin-bottom:6px">💵 Job costs &amp; receipts${(expTotal + matTotal) ? ` · <span style="color:var(--accent)">${money(expTotal + matTotal)}</span>` : ""}</div>`;
  h += `<div class="sub" style="white-space:normal;margin-bottom:8px">Job cost: mileage <b>${money(_bd.mileage)}</b> · job <b>${money(_bd.jobExp)}</b> · materials <b>${money(_bd.materials)}</b>${_bd.tool > 0 ? ` <span class="muted">· 🔧 tools ${money(_bd.tool)} (business overhead, not this job)</span>` : ""}</div>`;
  // virtual MILEAGE line — derived, read-only (not a receipt)
  h += `<div class="li"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal">🛣 Mileage <span class="sub" style="font-weight:400">· ${money(_bd.mileage)}</span></div><div class="sub" style="white-space:normal">estimate vs confirmed odometer — auto from the route/time clock at $${(typeof FIN !== "undefined" ? FIN.MILEAGE_RATE : 0.725)}/mi, not a receipt</div></div></div>`;
  const items = mats.map(e => ({ e, tag: "🧱", store: "jobmat" })).concat(exps.map(e => ({ e, tag: "🚚", store: "jobexp" })));
  if (!items.length) { h += `<div class="muted">No receipts filed yet. Snap a receipt below — Cap turns it into tagged line items.</div>`; }
  else {
    const groups = {}, order = [];
    items.forEach(it => { const key = it.e.splitGroup || it.e.receiptId || it.e.id; if (!groups[key]) { groups[key] = []; order.push(key); } groups[key].push(it); });
    order.forEach(key => {
      const g = groups[key], multi = g.length > 1;
      if (multi) {
        const gtot = g.reduce((s, it) => s + (+it.e.amount || 0), 0);
        let vendor = "", rcpt = ""; g.forEach(it => { if (!vendor && it.e.vendor) vendor = it.e.vendor; if (!rcpt && it.e.receiptId) rcpt = it.e.receiptId; });
        h += `<div class="li" style="background:var(--soft)"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal">🧾 ${money(gtot)}${vendor ? " <b>" + esc(vendor) + "</b>" : ""} <span class="sub" style="font-weight:400">· ${g.length} lines</span></div></div>${rcpt ? `<a class="btn ghost sm" href="${upUrl(rcpt)}" target="_blank" rel="noopener">📎 receipt</a>` : ""}</div>`;
      }
      g.forEach(it => { h += jobFiledLineHTML(j, it, multi); });
    });
    const _faults = {}; exps.forEach(e => { if (e.faultMemberId) _faults[e.faultMemberId] = (_faults[e.faultMemberId] || 0) + (+e.amount || 0); });
    const _fkeys = Object.keys(_faults);
    if (_fkeys.length) h += `<div class="note" style="margin-top:8px;border-left:3px solid var(--danger);white-space:normal">⚠ <b>Fault docks on this job:</b> ${_fkeys.map(id => `${esc((typeof userName === "function" ? userName(id) : "") || "?")} <b>${money(_faults[id])}</b>`).join(" · ")} — comes out of their payout, not the crew's.</div>`;
  }
  h += `</div>`;
  return h;
}
window.jobDelExpense = function (jobId, expId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const e = (typeof jobLIFind === "function") ? jobLIFind(j, "jobexp", expId) : null; if (!e) return;
  e.deleted = true; if (typeof touch === "function") touch(e); if (typeof save === "function") save(); if (typeof render === "function") render();   // tombstone the collection element (touch the ELEMENT so the delete syncs element-wise)
};
/* jobAddExpense / jobAddMaterial were RETIRED (Phase 3) — the two separate add-forms are replaced by the
   unified receipt card (js/100 jobRcptCardHTML → rcptApplySplit). jobDelExpense/jobDelMaterial stay: the filed
   list (jobFiledCostsHTML) still deletes per line. Their old dupe-guard coverage moved to js/100's busy flags. */
window.jobDelMaterial = function (jobId, mId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const e = (typeof jobLIFind === "function") ? jobLIFind(j, "jobmat", mId) : null; if (!e) return;
  e.deleted = true; if (typeof touch === "function") touch(e); if (typeof save === "function") save(); if (typeof render === "function") render();   // tombstone the collection element
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
  if (i >= 0) j.crew.splice(i, 1);
  else { j.crew.push(userId); if (typeof jobAutoAssignVehicle === "function") jobAutoAssignVehicle(j, userId); }   // adding crew → auto-assign their personal vehicle (js/110)
  if (typeof touch === "function") touch(j);
  if (typeof logChange === "function") logChange("update", "job", j.id, "Crew → " + j.crew.length + " · " + (j.title || "job"));
  if (typeof save === "function") save(); if (typeof render === "function") render();
};
/* FINAL PRICE CHARGED (owner/admin) — MIRRORS js/23 wizSetFinal exactly: capture prevTotal (quoteEffectiveTotal)
   + prevItems BEFORE the edit, set q.finalPrice (Math.max(0)) + q.adjNote, touch, then snapshotQuoteVersion so a
   committed quote logs a "final-price" version identical to the wizard's. Re-syncs cash-basis income only when the
   quote is already paid. NEVER touches q.items or q.total — item/line change orders stay in the wizard. */
/* CREATE-A-QUOTE for a job that has none (retroactive / custom-price work — the job already happened, you just
   need to record what it was charged). Spins up a blank quote linked BOTH ways (q.jobId ↔ job.quoteId, same as
   the recurring engine) with the job's customer/property/address/date, marks it accepted (the work is done), and
   opens the wizard so you can add a line or set a custom price. Dedupes to any quote already pointing at the job. */
window.jobCreateQuote = function (jobId) {
  const d = D();
  const j = (typeof actJ === "function" ? actJ() : (d.jobs || [])).find(x => x && x.id === jobId); if (!j) return;
  if (!jobCanEditPlan()) { alert("Owner/admin only."); return; }
  let q = (d.quotes || []).find(x => x && !x.deleted && (x.id === j.quoteId || x.jobId === j.id));
  if (!q) {
    q = {
      id: (typeof uid === "function") ? uid() : "q_" + (typeof now === "function" ? now() : Date.now()),
      customerId: j.customerId || "",
      cust: (typeof custName === "function") ? (custName(j.customerId) || "") : "",
      propertyId: j.propertyId || "",
      address: (typeof jobAddr === "function") ? (jobAddr(j) || "") : (j.address || ""),
      date: j.date || "",
      title: j.title || "",
      items: [], subtotal: 0, discount: 0, total: 0,
      jobId: j.id, num: (typeof nextQuoteNum === "function") ? nextQuoteNum() : 0,
      accepted: true, acceptedDate: j.date || "",   // the job already ran — it's not an open pipeline quote
      invoiced: false, paid: false,
      updatedAt: (typeof now === "function") ? now() : Date.now()
    };
    if (typeof touch === "function") touch(q);
    (d.quotes = d.quotes || []).push(q);
    j.quoteId = q.id;
    if (typeof touch === "function") touch(j);
    if (typeof logChange === "function") logChange("create", "quote", q.id, "Quote for " + (j.title || "job") + (q.cust ? " · " + q.cust : ""));
    if (typeof save === "function") save();
    if (S.sync && S.sync.url && S.sync.token && S.sync.auto && typeof syncNow === "function") syncNow();
  }
  if (typeof openQuote === "function") openQuote(q.id); else if (typeof render === "function") render();
};
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
  if (typeof uploadStatus === "function") uploadStatus("uploading", 0);
  jsUpload(file, function (pct) { if (typeof uploadStatus === "function") uploadStatus("uploading", pct); }).then(function (id) {
    if (!Array.isArray(j.attachments)) j.attachments = [];
    j.attachments.push({ id: id, name: file.name || "photo", ts: now() });
    if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
    // "✓ safe to close" only once the job RECORD (with the new attachment id) actually syncs to the server.
    if (typeof uploadTrackSync === "function") uploadTrackSync();
  }).catch(function (e) { if (typeof uploadStatus === "function") uploadStatus("error", null, (e && e.message) || e); alert("Upload failed: " + (e.message || e)); });
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
    <select id="split_cat"><option value="dump">🚛 Dump run</option><option value="other" selected>🔀 Other</option></select>
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
  const jobs = (typeof actJ === "function" ? actJ() : []).filter(x => x && !Array.isArray(x.sharedJobIds) && (typeof jobIsOpenNow === "function" ? jobIsOpenNow(x) : !x.done));
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
  D().jobs.push(sj); if (typeof jobEnsurePO === "function") jobEnsurePO(sj); if (typeof touch === "function") touch(sj);
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
