/* ---------- LANDSCAPING SITE SURVEY (Phase 1) ----------
   Walk a property taking photos → each photo goes to Cap/Claude vision (server /api/org-ai/read-survey with
   LAND_VISION_SYSTEM + the coastal-NC plant playbook) → per-plant identification + how/when to handle it + a
   drafted labor line, all confidence-flagged → the user reviews each detected plant/task (approve / edit / reject,
   low-confidence flagged) → approved items ASSEMBLE into a one-time landscaping quote via the existing wizard
   (WZ.items → wizFinish). Recurring-flagged tasks are just TAGGED (item.recurring) so Phase 2 can spin them into a
   recurringPlans seasonal plan — Phase 1 does NOT create any plan.

   Data: the synced `siteSurveys` collection (js/02 blank/load + server COLLECTIONS). One survey record:
     {id:"srv_"+uid, customerId, propertyId, address, title, photoIds:[], items:[...], status, createdBy, ts,
      quoteId, deleted:false, updatedAt}
   Each survey item (a detected plant/task):
     {id, photoId, plant, latin, category, confidence, count, approxSize, condition, service, howTo, caution,
      bestSeason, timingWarnNow, laborMin, materials, recurring, price, matCost, status:"review|approved|rejected",
      suggested}
   touch() on every write (updatedAt = the LWW key); stable prefixed ids.

   Mirrors: js/88-cap-receipts (the sequential vision drain, escalate-to-Opus on a miss) + js/100-job-receipt
   (the per-row review UI) + js/101-french-drain-estimator (build WZ.items → wizFinish). No new money path — a
   survey holds no money; it just assembles into a normal quote (finance byte-identical). */

var _landUpBusy = false;        // one photo upload at a time (dupe-submit guard)
var _landReadBusy = false;      // one vision drain at a time
var _landReadDone = 0, _landReadTotal = 0;   // drive a persistent progress bar (survives the per-photo re-renders)
var _landSkip = {};             // in-session {photoId -> 1} of reads that produced nothing this session (don't churn)
var _landBriefBusy = false;     // one crew-brief generation at a time (it's one slow call)
var _landAfterBusy = {};        // {photoId -> 1} of "show the after" image generations in flight (slow Gemini call, per-photo spinner)

/* the loaded crew rate the other estimators price labor at (TAKE_HOME / FIELD_SPLIT ≈ $93.75/hr) so a labor line's
   value covers the payout split. */
function landLoaded() { return (typeof QE !== "undefined" && QE.TAKE_HOME && QE.FIELD_SPLIT) ? (QE.TAKE_HOME / QE.FIELD_SPLIT) : 93.75; }
/* rough draft labor price from crew-minutes, rounded to $5 (the owner adjusts on the quote). */
function landLaborPrice(laborMin) { return Math.round((Math.max(0, +laborMin || 0) / 60) * landLoaded() / 5) * 5; }

/* the active siteSurveys collection (D() = the current org slab) */
function landColl() { const d = D(); if (!Array.isArray(d.siteSurveys)) d.siteSurveys = []; return d.siteSurveys; }
/* the survey WZ is currently building */
function landCurrent() { if (typeof WZ === "undefined" || !WZ || !WZ.surveyId) return null; return landColl().find(s => s && s.id === WZ.surveyId && !s.deleted) || null; }

/* ============================== PURE OPS (no DOM — unit-tested) ============================== */
/* a clamped survey item from one parsed vision `it` (the server already clamps; this is the client belt-and-braces
   so a hand-seeded / older payload is still safe). */
function landItemFromSuggested(photoId, it) {
  it = it || {};
  const laborMin = Math.max(0, +it.laborMin || 0);
  return {
    id: (typeof uid === "function" ? uid() : String(Math.random())),
    photoId: photoId || null,
    plant: String(it.plant || "unknown").slice(0, 80),
    latin: String(it.latin || "").slice(0, 80),
    category: String(it.category || "other").slice(0, 20),
    confidence: (["high", "medium", "low"].indexOf(it.confidence) >= 0) ? it.confidence : "low",
    count: Math.max(1, Math.round(+it.count || 1)),
    approxSize: String(it.approxSize || "").slice(0, 60),
    condition: String(it.condition || "").slice(0, 60),
    service: String(it.service || "none").slice(0, 20),
    howTo: String(it.howTo || "").slice(0, 300),
    caution: String(it.caution || "").slice(0, 300),
    bestSeason: String(it.bestSeason || "").slice(0, 80),
    timingWarnNow: it.timingWarnNow === true,
    laborMin: laborMin,
    materials: String(it.materials || "").slice(0, 120),
    recurring: it.recurring === true,
    location: String(it.location || "").slice(0, 80),   // WHERE in the photo (a photo usually has several plants)
    spot: (it.spot && isFinite(+it.spot.x) && isFinite(+it.spot.y)) ? { x: Math.min(1, Math.max(0, +it.spot.x)), y: Math.min(1, Math.max(0, +it.spot.y)) } : null,
    price: landLaborPrice(laborMin),
    matCost: 0,
    status: "review",
    suggested: it
  };
}
/* build the WZ line items for the APPROVED survey items. Each approved task → a LABOR line (price = its labor value,
   cost 0 — labor is not a per-job cost); a materials $ (matCost > 0) → a PASS-THROUGH line (price = cost = matCost,
   net $0 to profit, same invariant as the other estimators). Pure: returns the array, no side effects. */
function landAssembleItems(items) {
  const out = [];
  (Array.isArray(items) ? items : []).forEach(function (it) {
    if (!it || it.status !== "approved") return;
    const cnt = Math.max(1, +it.count || 1);
    const name = (String(it.plant || "plant") + " — " + String(it.service || "care")).slice(0, 80);
    const notes = [];
    if (it.howTo) notes.push(it.howTo);
    if (it.caution) notes.push("⚠ " + it.caution);
    if (it.bestSeason) notes.push("Best season: " + it.bestSeason + (it.timingWarnNow ? " — doing it now can harm the plant" : ""));
    const breakdown = [
      (cnt > 1 ? cnt + "× · " : "") + (it.approxSize ? it.approxSize + " · " : "") + (it.condition ? it.condition + " · " : "") + "~" + (Math.max(0, +it.laborMin || 0)) + " crew-min"
    ];
    out.push({ serviceId: "", name: name, unit: "job", price: Math.max(0, +it.price || 0), qty: 1, cost: 0, notes: notes, breakdown: breakdown, bandKey: "landscape" });
    const mat = Math.max(0, +it.matCost || 0);
    if (mat > 0) out.push({ serviceId: "", name: (String(it.plant || "plant") + " — materials" + (it.materials ? " (" + it.materials + ")" : "")).slice(0, 80), unit: "job", price: mat, qty: 1, cost: mat, bandKey: "landscape" });
  });
  return out;
}

/* ====================== RECURRING MAINTENANCE PLAN (Phase 2) ======================
   Spin the survey's APPROVED + recurring-flagged tasks into ONE bundled recurringPlans record on js/102's engine.
   MVP: a single plan per survey/property with a single frequency (no per-cadence splitting). The record is built
   via js/103's PURE builder recurPlanFromFields() so it is byte-identical in shape to a hand-created plan (same id
   scheme, defaults, nextDue computation, autoQuote default). Independent of the Phase-1 one-time quote — a survey
   can produce BOTH. recurMaterialize() (js/102) auto-generates the visit jobs/quotes on its normal schedule. */

/* the approved, recurring-flagged tasks on a survey */
function landRecurItems(sv) { return ((sv && sv.items) || []).filter(function (it) { return it && it.status === "approved" && it.recurring === true; }); }

/* a human label for the plan title: customer name → property label/address → survey address/title */
function landPropLabel(sv) {
  try {
    var d = D();
    var c = (d.customers || []).find(function (x) { return x && sv && x.id === sv.customerId; });
    if (c && (c.name || c.company)) return c.name || c.company;
    var p = (d.properties || []).find(function (x) { return x && sv && x.id === sv.propertyId; });
    if (p && (p.label || p.address)) return p.label || p.address;
    return (sv && (sv.address || sv.title)) || "property";
  } catch (e) { return "property"; }
}

/* the maintenance-plan picker state (survives re-render; the survey view is rebuilt fresh each render()) */
var _landRecur = null;
function landRecurState() {
  if (!_landRecur) {
    var t = (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10);
    _landRecur = { freq: "monthly", start: (typeof recurAddDays === "function") ? recurAddDays(t, 7) : t, seasonStart: "06-01", seasonEnd: "08-31" };
  }
  return _landRecur;
}
window.landRecurFreq = function (v) { landRecurState().freq = v || "monthly"; if (typeof render === "function") render(); };
window.landRecurStart = function (v) { landRecurState().start = v || ""; };
window.landRecurSeasonStart = function (v) { landRecurState().seasonStart = v || ""; };
window.landRecurSeasonEnd = function (v) { landRecurState().seasonEnd = v || ""; };

/* the field object for js/103's recurPlanFromFields — used for BOTH the live readout and the create (so the
   previewed MRR/per-visit number is exactly what gets saved). price = Σ approved recurring tasks' labor value
   (GROSS; the engine applies discountPct at display/quote time). autoQuote omitted → builder defaults it ON. */
function landRecurFields(sv) {
  var st = landRecurState();
  var recItems = landRecurItems(sv);
  var price = 0; recItems.forEach(function (it) { price += Math.max(0, +it.price || 0); });
  var start = st.start || ((typeof today === "function") ? today() : "");
  var wd = 0, dom = 1;
  try { wd = new Date(start + "T00:00:00").getDay(); } catch (e) {}
  try { dom = +String(start).slice(8, 10) || 1; } catch (e) {}
  var notes = "Bundled recurring tasks:\n" + recItems.map(function (it) { return "• " + (it.plant || "plant") + " · " + (it.service || "care"); }).join("\n");
  return {
    customerId: (sv && sv.customerId) || "", propertyId: (sv && sv.propertyId) || "", serviceId: "",
    title: "Landscaping maintenance — " + landPropLabel(sv),
    price: Math.round(price * 100) / 100, discountPct: 20,
    frequency: st.freq || "monthly", weekday: wd, dayOfMonth: dom,
    seasonStart: st.seasonStart || "06-01", seasonEnd: st.seasonEnd || "08-31", interval: 1,
    time: "", estDays: 1, startDate: start, crew: [], endMode: "endless", notes: notes
    // autoQuote intentionally omitted → recurPlanFromFields defaults it ON (matches js/103's form default)
  };
}

/* build ONE bundled recurringPlans record from the survey's recurring tasks and remember it on the survey.
   Mirrors recurSavePlan's save tail EXACTLY (recurPlanFromFields → recurFirstOccurrence nextDue → touch → push →
   logChange → save → recurForceMaterialize). Owner/admin gated. Never disturbs the Phase-1 quote. */
window.landCreateMaintenancePlan = function () {
  if (typeof canSee === "function" && !canSee("recurring")) { if (typeof alert === "function") alert("Recurring plans are owner/admin only."); return; }
  var sv = landCurrent(); if (!sv) return;
  if (sv.recurringPlanId) { if (typeof alert === "function") alert("This survey already has a maintenance plan — manage it on the 🔁 Recurring tab."); return; }
  var recItems = landRecurItems(sv);
  if (!recItems.length) { if (typeof alert === "function") alert("Approve at least one recurring seasonal task first (tap ✓ on the ones with a 🔁 tag)."); return; }
  if (typeof recurPlanFromFields !== "function") { if (typeof alert === "function") alert("The recurring engine isn't loaded."); return; }
  var d = D(); if (!Array.isArray(d.recurringPlans)) d.recurringPlans = [];
  var f = landRecurFields(sv);
  if (!(+f.price > 0)) { if (typeof alert === "function") alert("The recurring tasks have no labor value — set a price on at least one first."); return; }
  var p = recurPlanFromFields(f, {});                              // REUSE js/103's pure builder → byte-identical record
  p.nextDue = (typeof recurFirstOccurrence === "function") ? recurFirstOccurrence(p, today()) : (p.startDate || today());
  if (typeof touch === "function") touch(p);
  d.recurringPlans.push(p);
  if (typeof logChange === "function") logChange("create", "recurringPlan", p.id, "Recurring maintenance plan · " + (p.title || landPropLabel(sv)));
  sv.recurringPlanId = p.id;
  if (typeof touch === "function") touch(sv);
  if (typeof save === "function") save();
  if (typeof recurForceMaterialize === "function") recurForceMaterialize();   // generate the first visits inside the horizon now
  else if (typeof recurMaterialize === "function") recurMaterialize();
  if (typeof render === "function") render();
  var net = Math.round((+p.price || 0) * (1 - (+p.discountPct || 0) / 100));
  if (typeof alert === "function") alert("✅ Recurring maintenance plan created — " + ((typeof money === "function") ? money(net) : ("$" + net)) + "/visit. Cap will auto-schedule each visit. See the 🔁 Recurring tab.");
};

/* ============================== SURVEY LIFECYCLE ============================== */
/* Open the landscaping site survey — called from wizSetSvc("landscape"). Requires WZ (the wizard already has the
   customer). Reuses WZ.surveyId if it still points at a live draft; else creates a fresh survey record from WZ.cust. */
window.openLandscapeSurvey = function () {
  if (typeof WZ === "undefined" || !WZ) { if (typeof startWizard === "function") startWizard(); }
  if (typeof WZ === "undefined" || !WZ) return;
  let sv = landCurrent();
  if (!sv) {
    // RESUME an in-progress (draft) survey for this customer instead of stranding it — the wizard's WZ.surveyId link
    // is lost on a reload / a different quote, which orphaned photos with no way back. Match by customerId, else
    // propertyId, else address; newest draft first. (A survey that already became a quote is left alone.)
    const cc = WZ.cust || {};
    const draft = landColl().filter(s => s && !s.deleted && s.status !== "quoted"
        && ((cc.id && s.customerId === cc.id) || (!cc.id && cc.propertyId && s.propertyId === cc.propertyId) || (!cc.id && !cc.propertyId && cc.address && s.address === cc.address)))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
    if (draft) { sv = draft; WZ.surveyId = sv.id; if (typeof save === "function") save(); }
  }
  if (!sv) {
    const c = WZ.cust || {};
    const me = (typeof curUser === "function" && curUser()) ? curUser().id : "";
    sv = { id: "srv_" + (typeof uid === "function" ? uid() : String(Date.now())), customerId: c.id || null, propertyId: c.propertyId || null, address: c.address || "", title: (c.name ? c.name + " — site survey" : "Site survey"), photoIds: [], items: [], status: "draft", quoteId: null, createdBy: me, ts: (typeof now === "function" ? now() : Date.now()), deleted: false };
    landColl().push(sv); if (typeof touch === "function") touch(sv);
    WZ.surveyId = sv.id;
    if (typeof save === "function") save();
  }
  WZ.svc = "landscape"; WZ.disc = 0; WZ.discPct = null; WZ.step = "calc";
  if (typeof render === "function") render();
};
window.openLandscapeEst = window.openLandscapeSurvey;

/* ============================== VISION (mirror capRcptRead / capRcptRun) ============================== */
/* which of the survey's photos have NO detected item yet (and weren't skipped this session) — the drain targets */
function landUnreadPhotos(sv) {
  sv = sv || landCurrent(); if (!sv) return [];
  const have = {}; (sv.items || []).forEach(it => { if (it && it.photoId) have[it.photoId] = 1; });
  return (sv.photoIds || []).filter(pid => pid && !have[pid] && !_landSkip[pid]);
}

/* POST one photo to the survey-vision endpoint. Returns {suggested} | {skip,reason} | {error}. opts.escalate:true →
   the server reads with the smartest model (Opus). Only the boolean is sent; the server maps it to a model. */
async function landReadPhotoPost(photoId, opts) {
  opts = opts || {};
  const base = (typeof orgAiBase === "function") ? orgAiBase() : "";
  if (!base) return { error: "offline" };
  try {
    const body = { org: S.biz, photoId: photoId };
    if (typeof WZ !== "undefined" && WZ && WZ.surveyId) body.surveyId = WZ.surveyId;
    if (opts.escalate === true) body.escalate = true;
    const r = await fetch(base + "/api/org-ai/read-survey", {
      method: "POST",
      headers: (typeof orgAiHeaders === "function") ? orgAiHeaders() : { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) return { error: (j && j.error) || ("HTTP " + r.status), status: r.status };
    return j || { error: "empty response" };
  } catch (e) { return { error: (e && e.message) || "request failed" }; }
}

/* append the parsed items from a suggestion onto the live survey (dedupe: never re-append for a photo that already
   has items). touch()+save(). Returns how many items were added. */
function landStampSuggestion(photoId, suggested) {
  const sv = landCurrent(); if (!sv) return 0;
  if (!Array.isArray(sv.items)) sv.items = [];
  if (sv.items.some(it => it && it.photoId === photoId)) return 0;   // already read
  const its = (suggested && Array.isArray(suggested.items)) ? suggested.items : [];
  let n = 0;
  its.forEach(function (raw) { sv.items.push(landItemFromSuggested(photoId, raw)); n++; });
  if (suggested && suggested.scene) sv._lastScene = String(suggested.scene).slice(0, 200);
  if (typeof touch === "function") touch(sv);
  if (typeof save === "function") save();
  return n;
}

/* read ONE photo (auto escalate-on-miss, mirror capRcptRun's per-receipt logic) and stamp its items onto the survey.
   Returns true iff it added ≥1 item. Never throws. */
async function landSurveyReadPhoto(photoId) {
  const set = (t) => { const el = document.getElementById("land_status"); if (el) el.textContent = t || ""; };
  set("🤖 Cap is identifying the plants (Opus)…");
  let res = await landReadPhotoPost(photoId, { escalate: true });   // Opus from the START — plant ID from a photo is the hard case, worth the smartest model every time
  set("");
  if (res && res.suggested) { const added = landStampSuggestion(photoId, res.suggested); if (!added) _landSkip[photoId] = 1; if (typeof render === "function") render(); return { added: added > 0, error: null }; }
  if (res && res.status === 400 && /not set up/i.test(res.error || "")) { alert("Cap needs this organization's Anthropic API key. Set it in Admin → Assistant, then read again."); return { added: false, error: "nokey", fatal: true }; }
  if (res && res.error === "offline") { return { added: false, error: "offline" }; }
  _landSkip[photoId] = 1;   // unreadable this session — don't churn
  if (typeof render === "function") render();
  return { added: false, error: (res && res.error) || "unreadable" };   // surface WHY (was silently swallowed — a 502 from an oversize image looked like "nothing happened")
}

/* DRAIN every still-unread photo, strictly ONE AT A TIME (mirror capRcptRun). Owner/admin + key gated. */
window.landSurveyReadAll = async function (opts) {
  opts = opts || {};
  const canRun = (typeof rcptFinFull === "function") ? rcptFinFull() : false;
  if (!canRun) { if (!opts.auto) alert("Only an owner or admin can run Cap."); return; }
  if (_landReadBusy) return;
  const sv = landCurrent(); if (!sv) return;
  // make sure the survey record (with its photoIds) has reached the server, so the read passes the ownership guard
  if (typeof uploadTrackSync === "function") { try { await uploadTrackSync(); } catch (e) {} }
  let pending = landUnreadPhotos(sv);
  if (!pending.length) { if (!opts.auto) alert("No un-read photos left for Cap."); return; }
  _landReadBusy = true;
  _landReadTotal = pending.length;   // fixed batch size → drives the progress bar
  _landReadDone = 0;
  if (typeof render === "function") render();   // paint the progress bar immediately, before the first (slow) call
  const set = (t) => { const el = document.getElementById("land_status"); if (el) el.textContent = t || ""; };
  let done = 0, added = 0, errN = 0, lastErr = "";
  while (true) {
    pending = landUnreadPhotos(landCurrent());
    if (!pending.length || done >= 60) break;
    const pid = pending[0];
    _landReadDone = done;
    set("🤖 Reading with Opus — photo " + (done + 1) + " of " + _landReadTotal + "…");
    const r = await landSurveyReadPhoto(pid);
    if (r && r.fatal) break;                                       // no API key — stop the whole drain
    if (r && r.added) added++;
    if (r && r.error && r.error !== "offline") { errN++; lastErr = r.error; }
    done++;
    _landReadDone = done;
    if (typeof render === "function") render();                    // advance the bar + show the newly-detected plants as they land
    if (landUnreadPhotos(landCurrent()).length) await new Promise(rs => setTimeout(rs, 600));   // throttle between reads
  }
  set("");
  _landReadBusy = false;
  _landReadTotal = 0; _landReadDone = 0;
  if (typeof render === "function") render();
  if (!opts.auto) {
    if (added === 0 && errN > 0) {
      const why = /too large|5\s?MB|request failed|502|413|payload/i.test(lastErr) ? "the photos may be too large, or the AI request failed" : ("Cap hit an error — " + lastErr);
      alert("🤖 Cap couldn't read " + errN + " photo" + (errN === 1 ? "" : "s") + " — " + why + ".\n\nLarge photos are now shrunk automatically on upload; if these were added earlier, re-add them and try again.");
    } else {
      alert("🤖 Cap read " + done + " photo" + (done === 1 ? "" : "s") + " · found " + added + " plant" + (added === 1 ? "" : "s") + ". Review each below, then assemble the approved ones into a quote.");
    }
  }
};

/* ============================== SHOW THE AFTER (Feature 1) ============================== */
/* Generate a "here's how it'll look after a professional trim" image from ONE survey photo via Gemini (server
   /api/org-ai/show-after → the org's own Gemini image key). Owner/admin gated. Slow (~5-15s) → a per-photo busy
   flag drives a spinner. On success the server saved a NEW blob and returns its id; we stamp it on the survey as
   sv.afterPhotos[srcPhotoId] = returnedId (a NEW field on the existing record — no schema/collection change) and
   touch()+save()+render(). Billing/quota errors from Gemini are surfaced verbatim. Never auto-runs — tap only. */
window.landShowAfter = async function (photoId) {
  const canRun = (typeof rcptFinFull === "function") ? rcptFinFull() : false;
  if (!canRun) { if (typeof alert === "function") alert("Only an owner or admin can generate the 'after' image."); return; }
  const sv = landCurrent(); if (!sv || !photoId) return;
  if (_landAfterBusy[photoId]) return;
  const base = (typeof orgAiBase === "function") ? orgAiBase() : "";
  if (!base) { if (typeof alert === "function") alert("The 'after' image needs the server (you appear to be offline)."); return; }
  // make sure the survey (with its photoIds) has reached the server, so the request passes the ownership guard
  if (typeof uploadTrackSync === "function") { try { await uploadTrackSync(); } catch (e) {} }
  _landAfterBusy[photoId] = 1;
  if (typeof render === "function") render();   // paint the spinner before the slow call
  let resObj;
  try {
    const r = await fetch(base + "/api/org-ai/show-after", {
      method: "POST",
      headers: (typeof orgAiHeaders === "function") ? orgAiHeaders() : { "Content-Type": "application/json" },
      body: JSON.stringify({ org: S.biz, photoId: photoId })
    });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) resObj = { error: (j && j.error) || ("HTTP " + r.status) };
    else resObj = j || { error: "empty response" };
  } catch (e) { resObj = { error: (e && e.message) || "request failed" }; }
  delete _landAfterBusy[photoId];
  const live = landCurrent();
  if (resObj && resObj.id && live) {
    live.afterPhotos = live.afterPhotos || {};
    live.afterPhotos[photoId] = resObj.id;
    if (typeof touch === "function") touch(live);
    if (typeof save === "function") save();
    if (typeof render === "function") render();
  } else {
    if (typeof render === "function") render();
    if (typeof alert === "function") alert("✨ Couldn't generate the 'after' — " + ((resObj && resObj.error) || "try again") + ".");
  }
};

/* ============================== PHOTO UPLOAD ============================== */
/* MULTI-PHOTO upload: the input is `multiple`, so the owner can select a whole batch (or multi-select from the
   camera roll on mobile) at once. Upload each file SEQUENTIALLY (one at a time keeps memory + the server calm),
   pushing each returned blob id onto the survey + touch()+save()+render() as it lands so they appear progressively.
   RESILIENT: a single failed file is counted and skipped — it never aborts the rest. After the batch, one Cap
   drain (landSurveyReadAll) reads all the newly-unread photos, gated on owner/admin + an org key exactly as before. */
window.landSurveyUpload = async function (input) {
  const files = (input && input.files) ? Array.prototype.slice.call(input.files) : [];
  if (!files.length) return;
  if (_landUpBusy) return;
  if (!landCurrent()) { alert("Start a survey first."); return; }
  if (typeof jsUpload !== "function") { alert("Photo upload needs the server."); return; }
  _landUpBusy = true;
  const total = files.length;
  let done = 0, failed = 0, added = 0;
  for (let i = 0; i < files.length; i++) {
    if (typeof uploadStatus === "function") uploadStatus("uploading", 0);
    try {
      const photoId = await jsUpload(files[i], function (pct) { if (typeof uploadStatus === "function") uploadStatus("uploading", pct); });
      const live = landCurrent(); if (!live) break;                 // survey went away mid-batch → stop
      if (!Array.isArray(live.photoIds)) live.photoIds = [];
      live.photoIds.push(photoId); if (typeof touch === "function") touch(live);
      if (typeof save === "function") save();
      added++;
      if (typeof render === "function") render();                   // show each photo as it lands
    } catch (e) {
      failed++;                                                      // one bad file never aborts the rest
      if (typeof uploadStatus === "function") uploadStatus("error", null, (e && e.message) || e);
    }
    done++;
  }
  if (input) { try { input.value = ""; } catch (e) {} }              // allow re-picking the same files
  _landUpBusy = false;
  if (typeof render === "function") render();
  if (failed) alert(failed + " of " + total + " photo" + (total === 1 ? "" : "s") + " failed to upload — the other " + added + " were added.");
  // auto-read (owner/admin + key) all the newly-unread photos in ONE drain, once the survey has reached the server.
  // Crew / no-key → the photos just sit until an owner reads them (or items are added by hand).
  let canRead = false;
  try { canRead = (typeof rcptFinFull === "function" && rcptFinFull()) && (typeof ORG_AI_ST !== "undefined" && ORG_AI_ST && ORG_AI_ST.enabled && ORG_AI_ST.hasKey); } catch (e) { canRead = false; }
  if (canRead && added && landCurrent() && typeof landSurveyReadAll === "function") { try { landSurveyReadAll({ auto: true }); } catch (e) {} }
};

/* ============================== ITEM ACTIONS ============================== */
function landFindItem(id) { const sv = landCurrent(); if (!sv) return null; return (sv.items || []).find(it => it && it.id === id) || null; }
window.landItemApprove = function (id) { const it = landFindItem(id); if (!it) return; it.status = (it.status === "approved") ? "review" : "approved"; const sv = landCurrent(); if (sv && typeof touch === "function") touch(sv); if (typeof save === "function") save(); if (typeof render === "function") render(); };
window.landItemReject = function (id) { const it = landFindItem(id); if (!it) return; it.status = (it.status === "rejected") ? "review" : "rejected"; const sv = landCurrent(); if (sv && typeof touch === "function") touch(sv); if (typeof save === "function") save(); if (typeof render === "function") render(); };
window.landItemPrice = function (id, v) { const it = landFindItem(id); if (!it) return; it.price = Math.max(0, parseFloat(v) || 0); const sv = landCurrent(); if (sv && typeof touch === "function") touch(sv); if (typeof save === "function") save(); };
window.landItemMat = function (id, v) { const it = landFindItem(id); if (!it) return; it.matCost = Math.max(0, parseFloat(v) || 0); const sv = landCurrent(); if (sv && typeof touch === "function") touch(sv); if (typeof save === "function") save(); };

/* full-edit modal — fix the plant / service / count / labor minutes / notes, then Save (recomputes the draft price
   from labor minutes unless the owner already set a custom price). */
window.landItemEdit = function (id) {
  const it = landFindItem(id); if (!it || typeof modal !== "function") return;
  const svcs = ["prune", "thin", "shape", "hedge-trim", "remove", "stump-grind", "mulch", "weed", "edge", "plant", "treat", "none"];
  modal("Edit detected plant / task", `
    <label>Plant / feature</label><input id="land_e_plant" value="${esc(it.plant || "")}" placeholder="e.g. Crape myrtle">
    <label>Service</label><select id="land_e_svc">${svcs.map(s => `<option value="${s}" ${it.service === s ? "selected" : ""}>${s}</option>`).join("")}</select>
    <div class="row" style="gap:8px">
      <div class="grow"><label>How many</label><input id="land_e_count" type="number" inputmode="numeric" value="${esc(it.count || 1)}"></div>
      <div class="grow"><label>Crew-minutes</label><input id="land_e_labor" type="number" inputmode="numeric" value="${esc(it.laborMin || 0)}"></div>
    </div>
    <label>Materials (if we supply — pass-through)</label><input id="land_e_mats" value="${esc(it.materials || "")}" placeholder="e.g. 3 bags mulch">
    <label>How to handle it</label><textarea id="land_e_howto" style="min-height:56px">${esc(it.howTo || "")}</textarea>
    <label>Caution / timing</label><textarea id="land_e_caution" style="min-height:48px">${esc(it.caution || "")}</textarea>
    <div class="toggle" style="margin-top:8px"><input type="checkbox" id="land_e_rec" ${it.recurring ? "checked" : ""}><label style="margin:0">Recurring seasonal task <span class="sub">(tagged for a future recurring plan)</span></label></div>
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="landItemSaveEdit('${it.id}')">Save</button>`);
};
window.landItemSaveEdit = function (id) {
  const it = landFindItem(id); if (!it) return;
  const prevLabor = +it.laborMin || 0;
  it.plant = val("land_e_plant") || "unknown";
  const svcEl = document.getElementById("land_e_svc"); if (svcEl) it.service = svcEl.value;
  it.count = Math.max(1, parseInt(val("land_e_count"), 10) || 1);
  const newLabor = Math.max(0, parseInt(val("land_e_labor"), 10) || 0);
  it.materials = val("land_e_mats") || "";
  it.howTo = val("land_e_howto") || "";
  it.caution = val("land_e_caution") || "";
  const recEl = document.getElementById("land_e_rec"); it.recurring = !!(recEl && recEl.checked);
  // recompute the DRAFT price from labor minutes only if the owner hadn't set a custom price (price still == the old auto)
  if (newLabor !== prevLabor && (+it.price || 0) === landLaborPrice(prevLabor)) it.price = landLaborPrice(newLabor);
  it.laborMin = newLabor;
  const sv = landCurrent(); if (sv && typeof touch === "function") touch(sv);
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  if (typeof render === "function") render();
};
/* add a plant/task BY HAND (crew / no-key path, or an item Cap missed) */
window.landAddManual = function () {
  const sv = landCurrent(); if (!sv) return;
  if (!Array.isArray(sv.items)) sv.items = [];
  const it = landItemFromSuggested(null, { plant: "", service: "none", confidence: "high", laborMin: 30 });
  it.status = "review";
  sv.items.push(it); if (typeof touch === "function") touch(sv); if (typeof save === "function") save();
  window.landItemEdit(it.id);
};

/* ============================== ASSEMBLE → QUOTE ============================== */
window.landSurveyAssemble = function () {
  const sv = landCurrent(); if (!sv || typeof WZ === "undefined" || !WZ) return;
  const items = landAssembleItems(sv.items);
  if (!items.length) { alert("Approve at least one plant/task first (tap ✓ on the ones you want in the quote)."); return; }
  WZ.items = items;
  sv.status = "quoted"; if (typeof touch === "function") touch(sv);
  if (typeof save === "function") save();
  if (typeof wizFinish === "function") wizFinish();
  // back-link the survey ↔ the quote just created (Phase 2 reopens the survey to spin recurring tasks into a plan)
  if (WZ.id) { const q = (D().quotes || []).find(x => x && x.id === WZ.id); if (q) { q.survey = sv.id; if (typeof touch === "function") touch(q); } sv.quoteId = WZ.id; if (typeof touch === "function") touch(sv); if (typeof save === "function") save(); }
};

/* ============================== UI ============================== */
function landConfBadge(c) {
  const map = { high: ["✓ high", "var(--accent)"], medium: ["~ medium", "#b8860b"], low: ["⚠ low — check", "var(--danger)"] };
  const m = map[c] || map.low;
  return `<span style="font-size:11px;font-weight:700;color:${m[1]}">${m[0]}</span>`;
}
function landItemRowHTML(it) {
  const rejected = it.status === "rejected", approved = it.status === "approved";
  const border = approved ? "var(--accent)" : rejected ? "var(--danger)" : (it.confidence === "low" ? "var(--danger)" : "var(--line)");
  let h = `<div class="card" style="padding:10px;margin-top:8px;border-left:4px solid ${border}${rejected ? ";opacity:.5" : ""}">`;
  const _pu = (it.photoId && typeof jsUploadUrl === "function") ? jsUploadUrl(it.photoId) : "";
  const _sx = (it.spot && isFinite(+it.spot.x)) ? +it.spot.x : "null", _sy = (it.spot && isFinite(+it.spot.y)) ? +it.spot.y : "null";
  const _view = _pu ? `landViewPhoto('${esc(it.photoId)}',${_sx},${_sy})` : "";
  const _thumb = _pu ? `<img src="${esc(_pu)}" onclick="${_view}" title="Tap to see this plant in the photo" style="width:54px;height:54px;object-fit:cover;border-radius:8px;border:1px solid var(--line);cursor:pointer;flex:0 0 auto">` : "";
  const _loc = it.location ? `📍 ${esc(it.location)}` : "";
  const _viewLink = _pu ? `<a onclick="${_view}" style="color:var(--accent);cursor:pointer;text-decoration:underline">${_loc ? "view photo" : "🔍 view source photo"}</a>` : "";
  const _locLine = (_loc || _viewLink) ? `<div class="sub" style="white-space:normal;margin-top:1px">${_loc}${_loc && _viewLink ? " · " : ""}${_viewLink}</div>` : "";
  h += `<div class="row" style="align-items:center;gap:8px">${_thumb}<div class="grow"><b style="font-size:15px">${esc(it.plant || "unknown")}</b>${it.count > 1 ? ` <span class="sub">×${it.count}</span>` : ""} ${landConfBadge(it.confidence)}${_locLine}</div><div class="sub">${esc(it.category || "")}</div></div>`;
  const sub = [it.service && it.service !== "none" ? "🔧 " + it.service : "", it.approxSize, it.condition].filter(Boolean).join(" · ");
  if (sub) h += `<div class="sub" style="white-space:normal;margin-top:2px">${esc(sub)}</div>`;
  if (it.howTo) h += `<div class="sub" style="white-space:normal;margin-top:3px">${esc(it.howTo)}</div>`;
  if (it.caution) h += `<div class="sub" style="white-space:normal;margin-top:3px;color:#b8860b">⚠ ${esc(it.caution)}</div>`;
  if (it.bestSeason) h += `<div class="sub" style="white-space:normal;margin-top:3px">🗓 ${esc(it.bestSeason)}${it.timingWarnNow ? ` <span style="color:var(--danger)">— doing it now can harm the plant</span>` : ""}</div>`;
  if (it.recurring) h += `<div class="sub" style="margin-top:3px;color:#1a7f37">🔁 recurring seasonal task (tagged for a future plan)</div>`;
  h += `<div class="row" style="gap:6px;align-items:center;margin-top:8px">
    <div class="sub">Labor $</div><input type="number" inputmode="decimal" value="${esc(it.price || 0)}" style="flex:0 0 76px" onchange="landItemPrice('${it.id}',this.value)">
    <div class="sub">Materials $</div><input type="number" inputmode="decimal" value="${esc(it.matCost || 0)}" style="flex:0 0 70px" onchange="landItemMat('${it.id}',this.value)"></div>`;
  h += `<div class="row" style="gap:6px;margin-top:8px">
    <button class="btn ${approved ? "acc" : "ghost"} sm grow" onclick="landItemApprove('${it.id}')">${approved ? "✓ Approved" : "Approve"}</button>
    <button class="btn ghost sm" onclick="landItemEdit('${it.id}')">✎ Edit</button>
    <button class="btn ghost sm" style="color:var(--danger)" onclick="landItemReject('${it.id}')">${rejected ? "Undo" : "✕ Reject"}</button></div>`;
  h += `</div>`;
  return h;
}
/* show an item's SOURCE photo full-size, with Cap's best-guess marker circled if it gave a spot. Since a photo
   usually holds several plants, this is how the owner verifies WHICH plant an item refers to. */
window.landViewPhoto = function (photoId, sx, sy) {
  const url = (photoId && typeof jsUploadUrl === "function") ? jsUploadUrl(photoId) : "";
  if (!url) { alert("Photo not available."); return; }
  const hasSpot = (typeof sx === "number" && typeof sy === "number" && sx >= 0 && sx <= 1 && sy >= 0 && sy <= 1);
  const marker = hasSpot ? `<div style="position:absolute;left:${(sx * 100).toFixed(1)}%;top:${(sy * 100).toFixed(1)}%;width:64px;height:64px;transform:translate(-50%,-50%);border:3px solid #ffd400;border-radius:50%;box-shadow:0 0 0 2px rgba(0,0,0,.55),inset 0 0 0 2px rgba(0,0,0,.4);pointer-events:none"></div>` : "";
  const html = `<div style="position:relative;width:100%;max-width:520px;margin:0 auto"><img src="${esc(url)}" style="width:100%;height:auto;border-radius:10px;display:block;background:#000">${marker}</div>`
    + `<div class="sub" style="text-align:center;margin-top:8px;white-space:normal">${hasSpot ? "🟡 Cap's best guess at which plant — it's an estimate, so verify against the photo." : "Source photo for this item."} <a href="${esc(url)}" target="_blank" rel="noopener" style="color:var(--accent)">open full size ↗</a></div>`;
  if (typeof modal === "function") modal("Source photo", html);
  else window.open(url, "_blank");
};

/* ============================== CREW BRIEF (Phase 1) ============================== */
/* the APPROVED items on a survey (the brief's source rows) */
function landApprovedItems(sv) { return ((sv && sv.items) || []).filter(function (it) { return it && it.status === "approved"; }); }

/* ---- Plant-ID glossary (Feature 2): dedupe the approved items by plant name (case-insensitive) into a "learn the
   plants" list. Prefer a copy that carries a source photo so the crew always gets a picture when one exists. Pure. */
function landPlantGlossary(sv) {
  const approved = landApprovedItems(sv);
  const by = {}, order = [];
  approved.forEach(function (it) {
    const key = String(it.plant || "").trim().toLowerCase();
    if (!key) return;
    if (!by[key]) { by[key] = it; order.push(key); }
    else if (!by[key].photoId && it.photoId) by[key] = it;   // upgrade to a copy that has a source photo
  });
  return order.map(function (k) { return by[k]; });
}
/* known coastal-NC toxic / handle-with-care plants (the crew must be warned even if Cap's caution field was terse) */
var LAND_TOXIC_PLANTS = /oleander|poison\s*(ivy|oak|sumac)|nandina|sago\s*palm|foxglove|castor\s*bean|azalea|rhododendron|daffodil|lantana|\byew\b|hemlock|nightshade|pokeweed|angel'?s?\s*trumpet|brugmansia|datura|manchineel|sea\s*oats/i;
/* returns a short toxic/handling warning string for an item (to render in a warning color), or "" if none applies.
   Fires when the caution text mentions toxic/poison/gloves/protected (etc.) OR the plant is a known-toxic species. */
function landToxicFlag(it) {
  if (!it) return "";
  const caution = String(it.caution || "");
  const cautionHit = /toxic|poison|glove|protected|irritant|\bsap\b|thorn|allerg/i.test(caution);
  const plantHit = LAND_TOXIC_PLANTS.test(String(it.plant || "") + " " + String(it.latin || ""));
  if (!cautionHit && !plantHit) return "";
  if (cautionHit && caution.trim()) return caution.trim().slice(0, 180);
  return "Known toxic / skin-irritant plant — wear gloves and keep clippings away from skin, pets and burn piles.";
}
/* match a brief task's `ref` (the plant name we sent) back to the approved item it came from → its source photoId.
   First an exact plant match, then a case-insensitive one; null if none (a task with no photo just renders text). */
function landBriefItemFor(sv, ref) {
  const items = landApprovedItems(sv);
  const r = String(ref || "").trim().toLowerCase();
  if (!r) return null;
  return items.find(function (it) { return String(it.plant || "").trim().toLowerCase() === r; })
      || items.find(function (it) { const p = String(it.plant || "").trim().toLowerCase(); return p && (p.indexOf(r) >= 0 || r.indexOf(p) >= 0); })
      || null;
}

/* Generate the crew brief from the survey's APPROVED tasks. Owner/admin gated (rcptFinFull). Posts the tasks + job
   info to /api/org-ai/crew-brief, stamps the returned brief onto sv.crewBrief, touch()+save()+render(). One slow
   call → a busy flag drives a spinner in the UI. Errors are surfaced (never fails silently). */
window.landGenerateBrief = async function () {
  const canRun = (typeof rcptFinFull === "function") ? rcptFinFull() : false;
  if (!canRun) { if (typeof alert === "function") alert("Only an owner or admin can generate the crew brief."); return; }
  const sv = landCurrent(); if (!sv) return;
  const approved = landApprovedItems(sv);
  if (!approved.length) { if (typeof alert === "function") alert("Approve some tasks first."); return; }
  if (_landBriefBusy) return;
  const base = (typeof orgAiBase === "function") ? orgAiBase() : "";
  if (!base) { if (typeof alert === "function") alert("Generating the crew brief needs the server (you appear to be offline)."); return; }
  const d = D();
  const cust = (d.customers || []).find(function (c) { return c && c.id === sv.customerId; });
  const prop = (d.properties || []).find(function (pp) { return pp && pp.id === sv.propertyId; });
  const job = {
    title: sv.title || "Landscaping job",
    address: sv.address || (prop && (prop.address || prop.label)) || "",
    customer: (cust && (cust.name || cust.company)) || ""
  };
  const tasks = approved.map(function (it) {
    return { plant: it.plant, service: it.service, howTo: it.howTo, caution: it.caution, bestSeason: it.bestSeason, timingWarnNow: it.timingWarnNow === true, location: it.location, approxSize: it.approxSize, condition: it.condition, count: it.count };
  });
  _landBriefBusy = true;
  if (typeof render === "function") render();   // paint the busy state before the slow call
  const set = function (t) { const el = document.getElementById("land_status"); if (el) el.textContent = t || ""; };
  set("🤖 Cap is writing the crew brief…");
  let resObj;
  try {
    const r = await fetch(base + "/api/org-ai/crew-brief", {
      method: "POST",
      headers: (typeof orgAiHeaders === "function") ? orgAiHeaders() : { "Content-Type": "application/json" },
      body: JSON.stringify({ org: S.biz, tasks: tasks, job: job })
    });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) resObj = { error: (j && j.error) || ("HTTP " + r.status) };
    else resObj = j || { error: "empty response" };
  } catch (e) { resObj = { error: (e && e.message) || "request failed" }; }
  _landBriefBusy = false;
  set("");
  if (resObj && resObj.brief) {
    const me = (typeof curUser === "function" && curUser()) ? curUser().id : "";
    const b = resObj.brief;
    sv.crewBrief = { intro: b.intro || "", tools: b.tools || [], order: b.order || [], safety: b.safety || [], tasks: b.tasks || [], closing: b.closing || "", ts: (typeof now === "function" ? now() : Date.now()), by: me };
    if (typeof touch === "function") touch(sv);
    if (typeof save === "function") save();
    if (typeof render === "function") render();
  } else {
    if (typeof render === "function") render();
    if (typeof alert === "function") alert("🤖 Cap couldn't write the brief — " + ((resObj && resObj.error) || "try again") + ".");
  }
};

/* a plain-text rendering of the whole brief (for Copy-as-text and as the print body source) */
function landBriefText(sv) {
  const b = (sv && sv.crewBrief) || {};
  const L = [];
  const title = (sv && sv.title) || "Landscaping job";
  L.push("CREW BRIEF — " + title);
  if (sv && sv.address) L.push(sv.address);
  L.push("");
  if (b.intro) { L.push(b.intro); L.push(""); }
  // PLANTS ON THIS JOB — the ID glossary (names + latin + toxic flags), so the crew has the names on paper too.
  const plants = landPlantGlossary(sv);
  if (plants.length) {
    L.push("PLANTS ON THIS JOB (learn these):");
    plants.forEach(function (it) {
      let line = "  - " + (it.plant || "unknown");
      if (it.latin) line += " (" + it.latin + ")";
      if (it.category) line += " [" + it.category + "]";
      L.push(line);
      const spot = [it.howTo, it.condition].filter(Boolean).join(" · ");
      if (spot) L.push("      " + spot);
      const tox = landToxicFlag(it);
      if (tox) L.push("      !! TOXIC / HANDLE WITH CARE: " + tox);
    });
    L.push("");
  }
  if (b.tools && b.tools.length) { L.push("TOOLS & MATERIALS TO BRING:"); b.tools.forEach(function (x) { L.push("  - " + x); }); L.push(""); }
  if (b.order && b.order.length) { L.push("ORDER OF OPERATIONS:"); b.order.forEach(function (x, i) { L.push("  " + (i + 1) + ". " + x); }); L.push(""); }
  if (b.safety && b.safety.length) { L.push("SAFETY:"); b.safety.forEach(function (x) { L.push("  ! " + x); }); L.push(""); }
  (b.tasks || []).forEach(function (tk) {
    L.push("* " + (tk.ref || "Task") + (tk.where ? "  (" + tk.where + ")" : ""));
    (tk.do || []).forEach(function (x) { L.push("    DO:   " + x); });
    (tk.dont || []).forEach(function (x) { L.push("    DON'T: " + x); });
    if (tk.note) L.push("    NOTE: " + tk.note);
    L.push("");
  });
  if (b.closing) L.push(b.closing);
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/* Copy the whole brief as plain text so the owner can paste it to no-login helpers (SMS / chat). Clipboard API
   with a legacy execCommand fallback for non-secure contexts. */
window.landCopyBrief = async function () {
  const sv = landCurrent(); if (!sv || !sv.crewBrief) return;
  const text = landBriefText(sv);
  let done = false;
  try { if (navigator && navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); done = true; } } catch (e) {}
  if (!done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      done = document.execCommand("copy"); document.body.removeChild(ta);
    } catch (e) { done = false; }
  }
  if (typeof alert === "function") alert(done ? "Copied — paste it to the crew." : "Couldn't copy automatically. Long-press to select the brief text and copy it manually.");
};

/* Print the brief in a clean standalone window (invPrint / materials-report pattern) so the owner can print or
   Save-as-PDF and hand it over. Falls back to window.print() if a pop-up is blocked. */
function landBriefPrintHTML(sv) {
  const b = (sv && sv.crewBrief) || {};
  const biz = (function () { try { return (typeof BIZ === "object" && BIZ && (BIZ[S.biz] || BIZ.obx)) || { name: "OBX Lot Solutions", phone: "" }; } catch (e) { return { name: "OBX Lot Solutions", phone: "" }; } })();
  const E = (typeof esc === "function") ? esc : function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  const title = (sv && sv.title) || "Landscaping job";
  const ul = function (items, cls) { return "<ul" + (cls ? ' class="' + cls + '"' : "") + ">" + (items || []).map(function (x) { return "<li>" + E(x) + "</li>"; }).join("") + "</ul>"; };
  const tasksHtml = (b.tasks || []).map(function (tk) {
    const item = landBriefItemFor(sv, tk.ref);
    const url = (item && item.photoId && typeof jsUploadUrl === "function") ? jsUploadUrl(item.photoId) : "";
    const thumb = url ? '<img src="' + E(url) + '" alt="" onerror="this.style.display=\'none\'">' : "";
    let inner = '<div class="tk-head"><b>' + E(tk.ref || "Task") + "</b>" + (tk.where ? ' <span class="muted">' + E(tk.where) + "</span>" : "") + "</div>";
    if (tk.do && tk.do.length) inner += '<div class="lbl do">DO</div>' + ul(tk.do);
    if (tk.dont && tk.dont.length) inner += '<div class="lbl dont">DON\'T</div>' + ul(tk.dont);
    if (tk.note) inner += '<div class="note">' + E(tk.note) + "</div>";
    return '<div class="task">' + thumb + "<div>" + inner + "</div></div>";
  }).join("");
  // 🌿 Plants on this job — the ID glossary (names + latin + toxic flags) so the crew has the names on paper too.
  const plants = landPlantGlossary(sv);
  const glossaryHtml = plants.map(function (it) {
    const url = (it.photoId && typeof jsUploadUrl === "function") ? jsUploadUrl(it.photoId) : "";
    const thumb = url ? '<img src="' + E(url) + '" alt="" onerror="this.style.display=\'none\'">' : "";
    const spot = [it.howTo, it.condition, it.approxSize].filter(Boolean).join(" · ");
    const tox = landToxicFlag(it);
    let inner = '<div class="tk-head"><b>' + E(it.plant || "unknown") + "</b>" + (it.latin ? ' <span class="latin">' + E(it.latin) + "</span>" : "") + (it.category ? ' <span class="muted">' + E(it.category) + "</span>" : "") + "</div>";
    if (spot) inner += '<div class="gloss">' + E(spot) + "</div>";
    if (tox) inner += '<div class="tox">⚠️ ' + E(tox) + "</div>";
    return '<div class="task">' + thumb + "<div>" + inner + "</div></div>";
  }).join("");
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>Crew Brief — " + E(title) + "</title><style>" +
    "*{box-sizing:border-box}" +
    "body{font:14px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;margin:0 auto;padding:24px;max-width:720px}" +
    ".head{border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}.head h1{font-size:19px;margin:0 0 2px}.muted{color:#666;font-size:13px}" +
    ".intro{margin:0 0 16px}" +
    "h2{font-size:13px;text-transform:uppercase;color:#666;margin:20px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}" +
    "ul{margin:4px 0;padding-left:20px}li{margin:2px 0}" +
    ".safety li{color:#8a1f00}" +
    ".task{display:flex;gap:12px;align-items:flex-start;border:1px solid #ddd;border-radius:8px;padding:10px;margin:10px 0;page-break-inside:avoid}" +
    ".task img{width:88px;height:88px;object-fit:cover;border-radius:6px;flex:0 0 auto;border:1px solid #ccc}" +
    ".tk-head{font-size:15px;margin-bottom:4px}" +
    ".lbl{font-size:11px;font-weight:800;text-transform:uppercase;margin-top:6px}.lbl.do{color:#1a7f37}.lbl.dont{color:#b00020}" +
    ".note{font-size:13px;color:#555;margin-top:6px;font-style:italic}" +
    ".latin{font-style:italic;color:#555;font-size:13px}.gloss{font-size:13px;color:#444;margin-top:3px}.tox{color:#b00020;font-weight:700;font-size:13px;margin-top:5px}" +
    ".closing{margin-top:18px;border-top:1px solid #ddd;padding-top:12px;font-weight:600}" +
    ".foot{margin-top:22px;color:#666;font-size:12px}" +
    "button{margin-top:20px;padding:11px 18px;font-size:15px;border:0;border-radius:8px;background:#111;color:#fff;cursor:pointer}" +
    "@page{margin:14mm}@media print{button{display:none}body{padding:0}}" +
    "</style></head><body>" +
    '<div class="head"><h1>Crew Brief — ' + E(title) + "</h1>" + (sv && sv.address ? '<div class="muted">' + E(sv.address) + "</div>" : "") + "</div>" +
    (b.intro ? '<p class="intro">' + E(b.intro) + "</p>" : "") +
    (glossaryHtml ? "<h2>🌿 Plants on this job — learn these</h2>" + glossaryHtml : "") +
    (b.tools && b.tools.length ? "<h2>🧰 Tools &amp; materials to bring</h2>" + ul(b.tools) : "") +
    (b.order && b.order.length ? "<h2>📋 Order of operations</h2><ol>" + b.order.map(function (x) { return "<li>" + E(x) + "</li>"; }).join("") + "</ol>" : "") +
    (b.safety && b.safety.length ? "<h2>⚠️ Safety</h2>" + ul(b.safety, "safety") : "") +
    (b.tasks && b.tasks.length ? "<h2>Per-plant work</h2>" + tasksHtml : "") +
    (b.closing ? '<div class="closing">' + E(b.closing) + "</div>" : "") +
    '<div class="foot">' + E(biz.name || "") + (biz.phone ? " · " + E(biz.phone) : "") + " — text the owner with any questions.</div>" +
    '<button onclick="window.print()">🖨 Print / Save as PDF</button>' +
    "</body></html>";
}
window.landPrintBrief = function () {
  const sv = landCurrent(); if (!sv || !sv.crewBrief) return;
  const html = landBriefPrintHTML(sv);
  const w = window.open("", "_blank");
  if (!w) { if (typeof window.print === "function") window.print(); return; }
  w.document.open(); w.document.write(html); w.document.close();
  try { w.onload = function () { try { w.focus(); w.print(); } catch (e) {} }; } catch (e) {}
};

/* ---------- CREW GUIDE (print / share) — a self-contained field guide built STRAIGHT from the survey's plant data.
   No AI call and no approval step needed (works even when the AI brief fails or nothing's approved yet): it curates
   the detected plants (dedupes, drops weed/turf/unknown noise), shows the "now" photo (+ the generated "after" if
   there is one), and each plant's DO / DON'T / WHEN + toxic flags. Opens in its OWN window, so it can never touch
   the app's state/sync — safe. This is the reliable path when Cap's brief is unavailable. ---------- */
function landGuidePlants(sv) {
  const items = ((sv && sv.items) || []).filter(function (it) { return it && it.status !== "rejected" && it.plant; });
  const skip = /^unknown|weed|turf|lawn|mulch bed|gravel|ground.?cover|background|mixed/i;
  const by = {};
  items.forEach(function (it) {
    const nm = String(it.plant || "").trim(); if (!nm || skip.test(nm)) return;
    const key = nm.toLowerCase().replace(/\s*\/.*/, "").replace(/[^a-z ]/g, "").trim(); if (!key) return;
    const score = (it.confidence === "high" ? 3 : it.confidence === "medium" ? 2 : 1) + (it.photoId ? 2 : 0) + (String(it.howTo || "").length > 20 ? 1 : 0);
    if (!by[key] || score > by[key]._score) by[key] = Object.assign({}, it, { _score: score });
  });
  return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b._score - a._score; }).slice(0, 16);
}
function landCrewGuideHTML(sv) {
  const E = (typeof esc === "function") ? esc : function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  const biz = (function () { try { return (typeof BIZ === "object" && BIZ && (BIZ[S.biz] || BIZ.obx)) || { name: "OBX Lot Solutions", phone: "" }; } catch (e) { return { name: "OBX Lot Solutions", phone: "" }; } })();
  const url = function (id) { return (id && typeof jsUploadUrl === "function") ? jsUploadUrl(id) : ""; };
  const plants = landGuidePlants(sv);
  const afters = (sv && sv.afterPhotos) || {};
  const TOOLS = ["Loppers", "Hand pruners", "Pole saw / pole pruner", "Hedge shears", "Pruning saw", "Thick gloves", "Eye protection", "Tarps", "Rake + blower", "Contractor bags", "Wheelbarrow"];
  const tox = plants.filter(function (p) { return landToxicFlag(p); });
  const safety = [];
  tox.forEach(function (p) { safety.push("<b>" + E(p.plant) + " is toxic</b> — gloves on, bag the clippings, never burn or chip it near people/pets."); });
  safety.push("Eye protection around spiny plants (yucca, sago, palms).");
  safety.push("Big tree cuts / removals: clear it with the owner + local (Dare County) tree rules first — when unsure, deadwood only.");
  const cards = plants.map(function (p) {
    const bu = url(p.photoId), au = url(afters[p.photoId]);
    const imgs = (bu ? ('<div class="ib"><span class="l b">Now</span><img src="' + E(bu) + '" onerror="this.parentNode.style.display=\'none\'"></div>') : "") + (au ? ('<div class="ib"><span class="l a">Target look</span><img src="' + E(au) + '"></div>') : "");
    const toxb = landToxicFlag(p) ? ' <span class="tx">⚠ TOXIC</span>' : "";
    const where = p.location ? ' <span class="wh">📍 ' + E(p.location) + '</span>' : "";
    let s = '<div class="pc">' + (imgs ? '<div class="imgs">' + imgs + '</div>' : "");
    s += '<div class="nm">' + E(p.plant || "unknown") + toxb + where + '</div>';
    if (p.latin) s += '<div class="lat">' + E(p.latin) + '</div>';
    if (p.howTo) s += '<div class="ln do"><b>DO — ' + E(p.service || "tend") + ':</b> ' + E(p.howTo) + '</div>';
    if (p.caution) s += '<div class="ln dt"><b>DON\'T:</b> ' + E(p.caution) + '</div>';
    if (p.bestSeason) s += '<div class="ln wn"><b>WHEN:</b> ' + E(p.bestSeason) + '</div>';
    return s + '</div>';
  }).join("");
  const phoneHref = biz.phone ? biz.phone.replace(/[^0-9+]/g, "") : "";
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Crew Guide — ' + E((sv && sv.title) || "Landscaping") + '</title><style>' +
    '*{box-sizing:border-box}body{font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#15201a;margin:0 auto;padding:20px 16px 50px;max-width:760px;background:#fff}' +
    '.hd{background:#1f5a23;color:#fff;margin:-20px -16px 16px;padding:20px 18px;border-radius:0 0 16px 16px}.hd h1{margin:0;font-size:22px}.hd .m{opacity:.9;font-size:13px;margin-top:5px}' +
    '.call{display:inline-block;margin-top:10px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.4);color:#fff;padding:6px 12px;border-radius:18px;font-weight:700;font-size:13px;text-decoration:none}' +
    '.safe{background:#fbecea;border:1px solid #c0392b;border-radius:12px;padding:12px 14px;margin-bottom:14px}.safe h2{color:#c0392b;margin:0 0 6px;font-size:16px}.safe ul{margin:0;padding-left:18px}.safe li{margin:4px 0;font-size:14px}.safe b{color:#c0392b}' +
    'h2.s{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#5d6457;margin:22px 2px 10px;border-bottom:2px solid #e4e2d7;padding-bottom:6px}' +
    '.tools{display:flex;flex-wrap:wrap;gap:7px}.tool{border:1px solid #d9d7cd;border-radius:16px;padding:5px 11px;font-size:13px;font-weight:600}' +
    '.pc{border:1px solid #e4e2d7;border-radius:12px;padding:12px;margin:10px 0;page-break-inside:avoid}' +
    '.imgs{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px}.ib{position:relative;border-radius:9px;overflow:hidden;border:1px solid #ddd}.ib img{display:block;width:100%;height:100%;object-fit:cover;aspect-ratio:4/3}.ib .l{position:absolute;left:7px;top:7px;font-size:10px;font-weight:800;text-transform:uppercase;padding:2px 7px;border-radius:5px;color:#fff}.l.b{background:rgba(20,25,20,.7)}.l.a{background:#2f7d33}' +
    '.nm{font-size:18px;font-weight:800}.tx{background:#c0392b;color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:12px;vertical-align:middle}.wh{font-size:12px;color:#a9760a;font-weight:600}.lat{font-style:italic;color:#5d6457;font-size:13px}' +
    '.ln{margin-top:7px;font-size:14px;line-height:1.45}.ln.do b{color:#2f7d33}.ln.dt b{color:#c0392b}.ln.wn b{color:#a9760a}' +
    '.ft{margin-top:26px;color:#5d6457;font-size:12px;border-top:1px solid #e4e2d7;padding-top:12px}' +
    'button{margin-top:18px;padding:11px 18px;font-size:15px;border:0;border-radius:9px;background:#1f5a23;color:#fff;cursor:pointer}' +
    '@page{margin:12mm}@media print{button,.call{display:none}body{padding:0}.hd{-webkit-print-color-adjust:exact;print-color-adjust:exact}}' +
    '</style></head><body>' +
    '<div class="hd"><h1>Crew Guide — ' + E((sv && sv.title) || "Landscaping") + '</h1>' + (sv && sv.address ? '<div class="m">' + E(sv.address) + '</div>' : "") + '<div class="m">Owner not on site — text with any questions before you cut.</div>' + (phoneHref ? '<a class="call" href="sms:' + E(phoneHref) + '">💬 Text ' + E(biz.phone) + '</a>' : "") + '</div>' +
    '<div class="safe"><h2>⚠️ Safety first</h2><ul>' + safety.map(function (x) { return "<li>" + x + "</li>"; }).join("") + '</ul></div>' +
    '<h2 class="s">🧰 Tools to bring</h2><div class="tools">' + TOOLS.map(function (t) { return '<span class="tool">' + E(t) + '</span>'; }).join("") + '</div>' +
    '<h2 class="s">🌿 The plants — what to do with each</h2>' + (cards || '<p>No plants identified yet.</p>') +
    '<div class="ft">' + E(biz.name || "") + (biz.phone ? " · " + E(biz.phone) : "") + ' — plant IDs are AI-assisted; if a plant looks different than labeled, check with the owner before cutting.</div>' +
    '<button onclick="window.print()">🖨 Print / Save as PDF</button>' +
    '</body></html>';
}
window.landOpenCrewGuide = function () {
  const sv = landCurrent(); if (!sv) { alert("Open a survey first."); return; }
  if (!landGuidePlants(sv).length) { alert("No plants identified yet — read the photos first."); return; }
  const w = window.open("", "_blank");
  if (!w) { alert("Allow pop-ups to open the guide (or use the AI brief's Print)."); return; }
  w.document.open(); w.document.write(landCrewGuideHTML(sv)); w.document.close();
};

/* JOB-PAGE entry: the crew live on Today → the job, not in the quote wizard. Find the landscaping survey for a job
   (match by customer, else property) that actually has identified plants, and open its crew guide. Lets the job page
   show ONE "Crew Guide" button that opens the same self-contained print/share guide. */
function landSurveyForJob(j) {
  if (!j || typeof D !== "function") return null;
  const svs = ((D().siteSurveys) || []).filter(function (s) {
    return s && !s.deleted && landGuidePlants(s).length &&
      ((j.customerId && s.customerId === j.customerId) || (j.propertyId && s.propertyId === j.propertyId));
  });
  svs.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  return svs[0] || null;
}
window.landJobHasGuide = function (j) { return !!landSurveyForJob(j); };
window.landOpenGuideForJob = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(function (x) { return x && x.id === jobId; }) : null;
  const sv = landSurveyForJob(j);
  if (!sv) { alert("No landscaping guide for this job's customer yet."); return; }
  const w = window.open("", "_blank");
  if (!w) { alert("Allow pop-ups to open the guide."); return; }
  w.document.open(); w.document.write(landCrewGuideHTML(sv)); w.document.close();
};

/* the "🌿 Plants on this job" ID glossary — client-side (no AI call) from the approved items, so the crew LEARNS the
   names. Each unique plant: source-photo thumb (tap → landViewPhoto), name (bold) + latin (italic), category, a
   "what it is / how to spot it" line, and a prominent ⚠️ toxic/handling flag when landToxicFlag fires. */
function landGlossaryHTML(sv) {
  const plants = landPlantGlossary(sv);
  if (!plants.length) return "";
  let h = `<div class="card" style="background:var(--soft);padding:10px;margin-top:4px">`;
  h += `<div style="font-weight:800;margin-bottom:2px">🌿 Plants on this job</div>`;
  h += `<div class="sub" style="white-space:normal;margin-bottom:4px">Learn these before you start — the names, how to spot them, and anything to handle with care.</div>`;
  plants.forEach(function (it) {
    const pu = (it.photoId && typeof jsUploadUrl === "function") ? jsUploadUrl(it.photoId) : "";
    const sx = (it.spot && isFinite(+it.spot.x)) ? +it.spot.x : "null", sy = (it.spot && isFinite(+it.spot.y)) ? +it.spot.y : "null";
    const thumb = pu
      ? `<img src="${esc(pu)}" onclick="landViewPhoto('${esc(it.photoId)}',${sx},${sy})" title="Tap to see it in the photo" style="width:52px;height:52px;object-fit:cover;border-radius:8px;border:1px solid var(--line);cursor:pointer;flex:0 0 auto">`
      : `<div style="width:52px;height:52px;border-radius:8px;border:1px dashed var(--line);flex:0 0 auto"></div>`;
    const spot = [it.howTo, it.condition, it.approxSize].filter(Boolean).join(" · ");
    const tox = landToxicFlag(it);
    h += `<div class="row" style="gap:8px;align-items:flex-start;margin-top:7px">${thumb}<div class="grow">`;
    h += `<div style="white-space:normal"><b style="font-size:15px">${esc(it.plant || "unknown")}</b>${it.latin ? ` <span class="sub" style="font-style:italic">${esc(it.latin)}</span>` : ""}${it.category ? ` <span class="sub">· ${esc(it.category)}</span>` : ""}</div>`;
    if (spot) h += `<div class="sub" style="white-space:normal;margin-top:1px">${esc(spot)}</div>`;
    if (tox) h += `<div style="white-space:normal;margin-top:3px;color:var(--danger);font-weight:700;font-size:12px">⚠️ ${esc(tox)}</div>`;
    h += `</div></div>`;
  });
  h += `</div>`;
  return h;
}
/* the "🎯 Target look" strip — any AI-generated "after" images on this survey, so the crew can trim against them. */
function landTargetLookHTML(sv) {
  const ap = (sv && sv.afterPhotos) || {};
  const ids = Object.keys(ap).filter(function (k) { return ap[k]; });
  if (!ids.length) return "";
  let h = `<div class="card" style="background:var(--soft);padding:10px;margin-top:8px">`;
  h += `<div style="font-weight:800;margin-bottom:2px">🎯 Target look (after trimming)</div>`;
  h += `<div class="sub" style="white-space:normal;margin-bottom:6px">Trim toward these — roughly how each area should look when you're done.</div>`;
  h += `<div class="row" style="gap:8px;flex-wrap:wrap">`;
  ids.forEach(function (srcId) {
    const aId = ap[srcId];
    const aUrl = (typeof jsUploadUrl === "function") ? jsUploadUrl(aId) : "";
    h += `<img src="${esc(aUrl)}" onclick="landViewPhoto('${esc(aId)}')" title="Tap to view the target look" style="width:88px;height:88px;object-fit:cover;border-radius:8px;border:2px solid var(--accent);cursor:pointer">`;
  });
  h += `</div></div>`;
  return h;
}

/* render the crew-brief section: the busy spinner, the Generate/Regenerate buttons, and (when present) the printable
   brief card — intro, tools, order, safety, then each task with its SOURCE PHOTO thumbnail, DO / DON'T, and note. */
function landBriefSectionHTML(sv, approvedN) {
  const b = sv.crewBrief;
  let h = `<div class="card" style="border-left:5px solid #6b4bd6;margin-top:12px">`;
  h += `<div class="row" style="align-items:baseline"><div class="grow" style="font-weight:800">🧾 Cap crew brief</div>`;
  if (b && !_landBriefBusy) h += `<div class="row" style="gap:6px"><button class="btn ghost sm" onclick="landPrintBrief()">🖨 Print</button><button class="btn ghost sm" onclick="landCopyBrief()">📋 Copy as text</button></div>`;
  h += `</div>`;
  h += `<div class="sub" style="white-space:normal;margin:4px 0 8px">A crew-ready work order — what to do per plant, what NOT to do, tools, order of operations, and safety — to print or text to the crew when you're not on site.</div>`;
  if (landGuidePlants(sv).length) h += `<button class="btn acc" style="width:100%;margin-bottom:8px" onclick="landOpenCrewGuide()">📋 Open crew guide — print / share (works now)</button>`;
  if (_landBriefBusy) {
    h += `<div class="card" style="background:var(--soft);padding:14px;text-align:center"><b>🤖 Cap is writing the crew brief…</b><div class="sub" style="margin-top:4px">One slow call — a few seconds.</div></div>`;
    h += `</div>`; return h;
  }
  if (!b) {
    h += `<button class="btn acc" style="width:100%" ${approvedN ? "" : "disabled"} onclick="landGenerateBrief()">🧾 Generate crew brief</button>`;
    h += `</div>`; return h;
  }
  // stored brief → the printable card. Plants FIRST (learn the names), THEN the steps.
  h += landGlossaryHTML(sv);
  h += landTargetLookHTML(sv);
  if (b.intro) h += `<div style="white-space:normal;margin:8px 0 8px">${esc(b.intro)}</div>`;
  const list = (arr, style) => `<ul style="margin:4px 0 0;padding-left:20px${style ? ";" + style : ""}">` + (arr || []).map(x => `<li style="margin:2px 0;white-space:normal">${esc(x)}</li>`).join("") + `</ul>`;
  if (b.tools && b.tools.length) h += `<div style="margin-top:10px"><div style="font-weight:700">🧰 Tools &amp; materials to bring</div>${list(b.tools)}</div>`;
  if (b.order && b.order.length) h += `<div style="margin-top:10px"><div style="font-weight:700">📋 Order of operations</div><ol style="margin:4px 0 0;padding-left:20px">` + b.order.map(x => `<li style="margin:2px 0;white-space:normal">${esc(x)}</li>`).join("") + `</ol></div>`;
  if (b.safety && b.safety.length) h += `<div style="margin-top:10px"><div style="font-weight:700;color:var(--danger)">⚠️ Safety</div>${list(b.safety, "color:var(--danger)")}</div>`;
  (b.tasks || []).forEach(function (tk) {
    const item = landBriefItemFor(sv, tk.ref);
    const pu = (item && item.photoId && typeof jsUploadUrl === "function") ? jsUploadUrl(item.photoId) : "";
    const sx = (item && item.spot && isFinite(+item.spot.x)) ? +item.spot.x : "null", sy = (item && item.spot && isFinite(+item.spot.y)) ? +item.spot.y : "null";
    const thumb = pu ? `<img src="${esc(pu)}" onclick="landViewPhoto('${esc(item.photoId)}',${sx},${sy})" title="Tap to see this plant in the photo" style="width:54px;height:54px;object-fit:cover;border-radius:8px;border:1px solid var(--line);cursor:pointer;flex:0 0 auto">` : "";
    h += `<div class="card" style="padding:10px;margin-top:8px">`;
    h += `<div class="row" style="gap:8px;align-items:flex-start">${thumb}<div class="grow"><b style="font-size:15px">${esc(tk.ref || "Task")}</b>${tk.where ? `<div class="sub" style="white-space:normal">📍 ${esc(tk.where)}</div>` : ""}</div></div>`;
    if (tk.do && tk.do.length) h += `<div style="margin-top:6px"><span style="font-size:11px;font-weight:800;color:#1a7f37">DO</span>${list(tk.do)}</div>`;
    if (tk.dont && tk.dont.length) h += `<div style="margin-top:6px"><span style="font-size:11px;font-weight:800;color:var(--danger)">DON'T</span>${list(tk.dont, "color:var(--danger)")}</div>`;
    if (tk.note) h += `<div class="sub" style="white-space:normal;margin-top:6px;font-style:italic">💡 ${esc(tk.note)}</div>`;
    h += `</div>`;
  });
  if (b.closing) h += `<div style="margin-top:10px;font-weight:600;white-space:normal">${esc(b.closing)}</div>`;
  h += `<button class="btn ghost sm" style="width:100%;margin-top:10px" onclick="landGenerateBrief()">↻ Regenerate</button>`;
  h += `</div>`;
  return h;
}

/* one photo tile in the capture card: the BEFORE thumb (tap → view), an owner/admin "✨ Show after" button, and —
   once generated — the AFTER thumb next to it with an "after" label (both tappable; the after has no spot marker).
   While that photo is generating, its slot shows a spinner. */
function landPhotoTileHTML(sv, pid, canAfter) {
  const url = (typeof jsUploadUrl === "function") ? jsUploadUrl(pid) : "";
  const afterId = (sv.afterPhotos && sv.afterPhotos[pid]) || "";
  const afterUrl = (afterId && typeof jsUploadUrl === "function") ? jsUploadUrl(afterId) : "";
  const busy = !!_landAfterBusy[pid];
  let t = `<div style="display:flex;flex-direction:column;gap:4px;align-items:center">`;
  t += `<div class="row" style="gap:5px;align-items:flex-start">`;
  t += `<div style="display:flex;flex-direction:column;align-items:center;gap:1px">`
    + `<img src="${esc(url)}" onclick="landViewPhoto('${esc(pid)}')" title="Tap to view" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--line);cursor:pointer">`
    + `<span class="sub" style="font-size:10px">before</span></div>`;
  if (busy) {
    t += `<div style="width:64px;height:64px;border-radius:8px;border:1px dashed var(--accent);display:flex;align-items:center;justify-content:center;text-align:center;font-size:10px;color:var(--accent);padding:2px;line-height:1.2">✨ generating the after…</div>`;
  } else if (afterUrl) {
    t += `<div style="display:flex;flex-direction:column;align-items:center;gap:1px">`
      + `<img src="${esc(afterUrl)}" onclick="landViewPhoto('${esc(afterId)}')" title="Tap to view the after" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:2px solid var(--accent);cursor:pointer">`
      + `<span class="sub" style="font-size:10px;color:var(--accent)">✨ after</span></div>`;
  }
  t += `</div>`;
  if (canAfter && !busy) {
    t += `<button class="btn ghost" style="font-size:11px;padding:3px 8px" onclick="landShowAfter('${esc(pid)}')">✨ ${afterUrl ? "Redo after" : "Show after"}</button>`;
  }
  t += `</div>`;
  return t;
}

window.wizLandscapeUI = function () {
  const sv = landCurrent();
  let h = `<div class="row" style="margin:0 2px 10px"><div class="grow"><div class="sub">🌿 Landscaping site survey</div><div class="nm" style="font-size:18px">Walk the property → photos → a quote</div></div><button class="btn ghost sm" onclick="exitWizard()">Cancel</button></div>`;
  if (!sv) { return h + `<div class="empty">Couldn't start the survey. Go back and pick the customer first.</div>`; }
  if (WZ.cust && WZ.cust.name) h += `<div class="card" style="padding:10px"><div class="nm" style="font-size:15px">${esc(WZ.cust.name)}</div>${WZ.cust.address ? `<div class="sub">${esc(WZ.cust.address)}</div>` : ""}<button class="btn ghost sm" style="margin-top:6px" onclick="WZ.step='cust';render()">↩ Change customer / property</button></div>`;

  // capture card
  h += `<div class="card" style="border-left:5px solid #1a7f37">`;
  h += `<div style="font-weight:800;margin-bottom:4px">📷 Photograph each plant / area</div>`;
  h += `<div class="sub" style="margin-bottom:8px;white-space:normal">Snap each shrub, tree, bed, or lawn area. Cap identifies the plant and drafts how &amp; when to handle it (coastal-NC correct). You review each one before it becomes a quote line.</div>`;
  h += `<input type="file" id="land_file" accept="image/*" multiple style="display:none" onchange="landSurveyUpload(this)">`;
  h += `<button class="btn acc" style="width:100%" onclick="document.getElementById('land_file').click()">📷 Add photos</button>`;
  const photos = (sv.photoIds || []);
  if (photos.length) {
    const canAfter = (typeof rcptFinFull === "function") ? rcptFinFull() : false;
    h += `<div class="row" style="gap:12px;flex-wrap:wrap;margin-top:8px;align-items:flex-start">` + photos.map(pid => landPhotoTileHTML(sv, pid, canAfter)).join("") + `</div>`;
    if (canAfter) h += `<div class="sub" style="white-space:normal;margin-top:5px;font-size:11px">✨ "Show after" previews a clean professional trim with Gemini — each 'after' costs a few cents on your Gemini key.</div>`;
    const unread = landUnreadPhotos(sv).length;
    const canRun = (typeof rcptFinFull === "function") ? rcptFinFull() : false;
    if (_landReadBusy) {
      const tot = _landReadTotal || (unread + _landReadDone) || 1;
      const dn = Math.min(_landReadDone, tot);
      const pct = Math.max(3, Math.round(dn / tot * 100));
      h += `<div class="card" style="margin-top:8px;background:var(--soft);padding:12px">`
        + `<div class="row" style="align-items:baseline;margin-bottom:7px"><div class="grow" style="font-weight:700">🤖 Cap is reading with Opus…</div><div class="sub" style="font-variant-numeric:tabular-nums">${dn} / ${tot}</div></div>`
        + `<div style="height:8px;border-radius:6px;background:var(--line);overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--accent);transition:width .35s ease"></div></div>`
        + `<div class="sub" style="margin-top:6px;text-align:center;white-space:normal">Reading photo ${Math.min(dn + 1, tot)} of ${tot} — a few seconds each. Plants appear below as they're found; you can start reviewing.</div>`
        + `</div>`;
    } else if (unread && canRun) {
      h += `<button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="landSurveyReadAll()">🤖 Read ${unread} un-read photo${unread === 1 ? "" : "s"} with Opus</button>`;
    }
  }
  h += `<div id="land_status" class="sub" style="text-align:center;color:#1a7f37;min-height:16px;margin-top:6px"></div>`;
  h += `<button class="btn ghost sm" style="width:100%;margin-top:4px" onclick="landAddManual()">✚ Add a plant / task by hand</button>`;
  h += `</div>`;

  // detected items
  const items = (sv.items || []);
  if (!items.length) {
    h += `<div class="empty">No plants detected yet. Add a photo above — Cap reads it into reviewable line items.</div>`;
  } else {
    const approvedItems = items.filter(it => it && it.status === "approved");
    let approvedTotal = 0; landAssembleItems(items).forEach(li => approvedTotal += (li.price || 0) * (li.qty || 1));
    const lowN = items.filter(it => it && it.status !== "rejected" && it.confidence === "low").length;
    h += `<div class="card" style="background:var(--soft)"><div class="row" style="align-items:baseline"><div class="grow"><b>${items.length} detected</b> · ${approvedItems.length} approved${lowN ? ` · <span style="color:var(--danger)">${lowN} low-confidence to check</span>` : ""}</div><div class="nm" style="font-size:18px">${money(approvedTotal)}</div></div></div>`;
    items.forEach(it => { h += landItemRowHTML(it); });
  }

  // crew brief — a crew-ready work order the owner prints/shares to hand to a crew he won't be on-site with.
  // Owner/admin only; appears once there's ≥1 approved task (Generate) or a stored brief (view + Regenerate).
  const approvedForBrief = items.filter(it => it && it.status === "approved");
  const canBrief = (typeof rcptFinFull === "function") ? rcptFinFull() : false;
  if (canBrief && (sv.crewBrief || approvedForBrief.length)) {
    h += landBriefSectionHTML(sv, approvedForBrief.length);
  }

  // recurring maintenance plan — appears when ≥1 APPROVED task is recurring-flagged (owner/admin only)
  const recItems = items.filter(it => it && it.status === "approved" && it.recurring === true);
  const canRecur = (typeof canSee !== "function") || canSee("recurring");
  if (recItems.length && canRecur) {
    const st = landRecurState();
    const pv = (typeof recurPlanFromFields === "function") ? recurPlanFromFields(landRecurFields(sv), {}) : null;
    const net = pv ? Math.round((+pv.price || 0) * (1 - (+pv.discountPct || 0) / 100)) : 0;
    const mrr = (pv && typeof recurMonthlyEquiv === "function") ? recurMonthlyEquiv(pv) : 0;
    h += `<div class="card" style="border-left:5px solid #1a7f37;margin-top:12px">`;
    h += `<div style="font-weight:800;margin-bottom:2px">🔁 Recurring maintenance plan</div>`;
    h += `<div class="sub" style="white-space:normal;margin-bottom:8px">Bundle the ${recItems.length} recurring seasonal task${recItems.length === 1 ? "" : "s"} into a standing maintenance plan — Cap auto-schedules each visit. You still keep the one-time quote above.</div>`;
    h += recItems.map(it => `<div class="sub" style="margin:1px 0">• ${esc(it.plant || "plant")} · ${esc(it.service || "care")}</div>`).join("");
    if (sv.recurringPlanId) {
      h += `<div class="card" style="background:var(--soft);margin-top:8px"><b>✅ Plan created.</b> <span class="sub">Manage it on the 🔁 Recurring tab.</span></div>`;
    } else {
      const fopts = [["biweekly", "Every 2 weeks"], ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["seasonal", "Seasonal"]]
        .map(o => `<option value="${o[0]}" ${st.freq === o[0] ? "selected" : ""}>${o[1]}</option>`).join("");
      h += `<label style="margin-top:8px">Frequency</label><select onchange="landRecurFreq(this.value)">${fopts}</select>`;
      if (st.freq === "seasonal") {
        h += `<div class="row" style="gap:8px"><div class="grow"><label>Season start (MM-DD)</label><input value="${esc(st.seasonStart)}" placeholder="06-01" onchange="landRecurSeasonStart(this.value)"></div>`;
        h += `<div class="grow"><label>Season end (MM-DD)</label><input value="${esc(st.seasonEnd)}" placeholder="08-31" onchange="landRecurSeasonEnd(this.value)"></div></div>`;
      }
      h += `<label>Start date</label><input type="date" value="${esc(st.start)}" onchange="landRecurStart(this.value)">`;
      h += `<div class="card" style="background:var(--soft);margin-top:8px"><div class="row" style="align-items:baseline"><div class="grow"><b>${money(net)}/visit</b> <span class="sub">(−20% recurring)</span></div>${mrr > 0 ? `<div class="nm" style="font-size:16px">~${money(mrr)}/mo</div>` : ""}</div></div>`;
      h += `<button class="btn acc" style="width:100%;margin-top:10px" onclick="landCreateMaintenancePlan()">Create maintenance plan</button>`;
    }
    h += `</div>`;
  }

  // assemble footer
  const approvedN = items.filter(it => it && it.status === "approved").length;
  h += `<div class="wizfoot"><div class="wf-amt"><span class="wf-lab">Approved</span><b>${approvedN}</b></div><button class="btn ghost sm" onclick="WZ.step='pick';render()">← Services</button><button class="btn acc grow" ${approvedN ? "" : "disabled"} onclick="landSurveyAssemble()">Assemble ${approvedN} → quote →</button></div>`;
  return h;
};

/* node export (tests) — browser ignores this */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { landItemFromSuggested: landItemFromSuggested, landAssembleItems: landAssembleItems, landLaborPrice: landLaborPrice };
}
