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
var _landSkip = {};             // in-session {photoId -> 1} of reads that produced nothing this session (don't churn)

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

/* ============================== SURVEY LIFECYCLE ============================== */
/* Open the landscaping site survey — called from wizSetSvc("landscape"). Requires WZ (the wizard already has the
   customer). Reuses WZ.surveyId if it still points at a live draft; else creates a fresh survey record from WZ.cust. */
window.openLandscapeSurvey = function () {
  if (typeof WZ === "undefined" || !WZ) { if (typeof startWizard === "function") startWizard(); }
  if (typeof WZ === "undefined" || !WZ) return;
  let sv = landCurrent();
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
  set("🤖 Cap is identifying the plants…");
  let res = await landReadPhotoPost(photoId);
  if (!(res && res.suggested) && !(res && res.error === "offline") && !(res && res.status === 400 && /not set up/i.test(res.error || ""))) {
    const esc2 = await landReadPhotoPost(photoId, { escalate: true });   // escalate to Opus on a miss (same as receipts)
    if (esc2 && esc2.suggested) res = esc2; else if (esc2 && (esc2.error === "offline" || (esc2.status === 400 && /not set up/i.test(esc2.error || "")))) res = esc2;
  }
  set("");
  if (res && res.suggested) { const added = landStampSuggestion(photoId, res.suggested); if (!added) _landSkip[photoId] = 1; if (typeof render === "function") render(); return added > 0; }
  if (res && res.status === 400 && /not set up/i.test(res.error || "")) { alert("Cap needs this organization's Anthropic API key. Set it in Admin → Assistant, then read again."); return false; }
  if (res && res.error === "offline") { return false; }
  _landSkip[photoId] = 1;   // unreadable this session — don't churn
  if (typeof render === "function") render();
  return false;
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
  const set = (t) => { const el = document.getElementById("land_status"); if (el) el.textContent = t || ""; };
  let done = 0, added = 0;
  while (true) {
    pending = landUnreadPhotos(landCurrent());
    if (!pending.length || done >= 60) break;
    const pid = pending[0];
    set("🤖 Cap is reading photo " + (done + 1) + " of " + (done + pending.length) + "…");
    if (await landSurveyReadPhoto(pid)) added++;
    done++;
    if (landUnreadPhotos(landCurrent()).length) await new Promise(r => setTimeout(r, 600));   // throttle between reads
  }
  set("");
  _landReadBusy = false;
  if (typeof render === "function") render();
  if (!opts.auto) alert("🤖 Cap read " + done + " photo" + (done === 1 ? "" : "s") + " · found " + added + " plant" + (added === 1 ? "" : "s") + ". Review each below, then assemble the approved ones into a quote.");
};

/* ============================== PHOTO UPLOAD ============================== */
window.landSurveyUpload = function (input) {
  const file = input && input.files && input.files[0]; if (!file) return;
  if (_landUpBusy) return;
  const sv = landCurrent(); if (!sv) { alert("Start a survey first."); return; }
  if (typeof jsUpload !== "function") { alert("Photo upload needs the server."); return; }
  _landUpBusy = true;
  if (typeof uploadStatus === "function") uploadStatus("uploading", 0);
  jsUpload(file, function (pct) { if (typeof uploadStatus === "function") uploadStatus("uploading", pct); }).then(function (photoId) {
    const live = landCurrent(); if (!live) { _landUpBusy = false; return; }
    if (!Array.isArray(live.photoIds)) live.photoIds = [];
    live.photoIds.push(photoId); if (typeof touch === "function") touch(live);
    if (typeof save === "function") save();
    _landUpBusy = false;
    if (typeof render === "function") render();
    // auto-read (owner/admin + key) once the survey record has reached the server (guard passes). Crew / no-key → the
    // photo just sits until an owner reads it (or they add items by hand via the item modal).
    let canRead = false;
    try { canRead = (typeof rcptFinFull === "function" && rcptFinFull()) && (typeof ORG_AI_ST !== "undefined" && ORG_AI_ST && ORG_AI_ST.enabled && ORG_AI_ST.hasKey); } catch (e) { canRead = false; }
    const after = (typeof uploadTrackSync === "function") ? uploadTrackSync() : Promise.resolve();
    Promise.resolve(after).then(function () { if (canRead && landCurrent()) landSurveyReadPhoto(photoId); });
  }).catch(function (e) {
    _landUpBusy = false;
    if (typeof uploadStatus === "function") uploadStatus("error", null, (e && e.message) || e);
    alert("Photo upload failed: " + ((e && e.message) || e));
  });
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
  h += `<div class="row" style="align-items:baseline;gap:8px"><div class="grow"><b style="font-size:15px">${esc(it.plant || "unknown")}</b>${it.count > 1 ? ` <span class="sub">×${it.count}</span>` : ""} ${landConfBadge(it.confidence)}</div><div class="sub">${esc(it.category || "")}</div></div>`;
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

window.wizLandscapeUI = function () {
  const sv = landCurrent();
  let h = `<div class="row" style="margin:0 2px 10px"><div class="grow"><div class="sub">🌿 Landscaping site survey</div><div class="nm" style="font-size:18px">Walk the property → photos → a quote</div></div><button class="btn ghost sm" onclick="exitWizard()">Cancel</button></div>`;
  if (!sv) { return h + `<div class="empty">Couldn't start the survey. Go back and pick the customer first.</div>`; }
  if (WZ.cust && WZ.cust.name) h += `<div class="card" style="padding:10px"><div class="nm" style="font-size:15px">${esc(WZ.cust.name)}</div>${WZ.cust.address ? `<div class="sub">${esc(WZ.cust.address)}</div>` : ""}<button class="btn ghost sm" style="margin-top:6px" onclick="WZ.step='cust';render()">↩ Change customer / property</button></div>`;

  // capture card
  h += `<div class="card" style="border-left:5px solid #1a7f37">`;
  h += `<div style="font-weight:800;margin-bottom:4px">📷 Photograph each plant / area</div>`;
  h += `<div class="sub" style="margin-bottom:8px;white-space:normal">Snap each shrub, tree, bed, or lawn area. Cap identifies the plant and drafts how &amp; when to handle it (coastal-NC correct). You review each one before it becomes a quote line.</div>`;
  h += `<input type="file" id="land_file" accept="image/*" style="display:none" onchange="landSurveyUpload(this)">`;
  h += `<button class="btn acc" style="width:100%" onclick="document.getElementById('land_file').click()">📷 Add a photo</button>`;
  const photos = (sv.photoIds || []);
  if (photos.length) {
    h += `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">` + photos.map(pid => `<img src="${esc(typeof jsUploadUrl === "function" ? jsUploadUrl(pid) : "")}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--line)">`).join("") + `</div>`;
    const unread = landUnreadPhotos(sv).length;
    const canRun = (typeof rcptFinFull === "function") ? rcptFinFull() : false;
    if (unread && canRun) h += `<button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="landSurveyReadAll()">🤖 Read ${unread} un-read photo${unread === 1 ? "" : "s"}</button>`;
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

  // assemble footer
  const approvedN = items.filter(it => it && it.status === "approved").length;
  h += `<div class="wizfoot"><div class="wf-amt"><span class="wf-lab">Approved</span><b>${approvedN}</b></div><button class="btn ghost sm" onclick="WZ.step='pick';render()">← Services</button><button class="btn acc grow" ${approvedN ? "" : "disabled"} onclick="landSurveyAssemble()">Assemble ${approvedN} → quote →</button></div>`;
  return h;
};

/* node export (tests) — browser ignores this */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { landItemFromSuggested: landItemFromSuggested, landAssembleItems: landAssembleItems, landLaborPrice: landLaborPrice };
}
