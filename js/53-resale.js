/* ---------- RESALE TRACKER + GUIDED RESELL PROCESS (Cap #5) ----------
   junk-pulled items: pulled → to-list → posted → sold, now walked step-by-step through the
   resell PLAYBOOK (photograph → clean → stage → write listing → post → track). First-class
   resale[] collection (each item has its own lifecycle + updatedAt; links back to the job that
   pulled it). Two layers of UX:
     1. A general "How to resell" playbook (collapsible guide) at the top of the Resale tab.
     2. A per-item CHECKLIST on each item (steps[] progress, rides the record's LWW) with staging
        guidance that BRANCHES by item type (furniture / tools / appliances / decor / other).
   New intra-record fields (additive, no new collection — ride resale[] LWW): `type`, `steps{}`.
   Mobile-first; crew + owner. Feeds the ops-sweep an "unposted resale aging" flag (via view=ops). */

const RESALE_STATES = [["pulled", "🪑 Pulled"], ["to-list", "📝 To list"], ["posted", "📣 Posted"], ["sold", "✅ Sold"]];
const RESALE_PLATFORMS = ["", "Facebook Marketplace", "OfferUp", "Craigslist", "Nextdoor", "eBay", "Other"];
const RESALE_TOLIST_STALE = 7, RESALE_POSTED_STALE = 21;   // days before "aging" (mirror tools/ops-sweep.js)

/* OBX-area default platforms to LIST on (Ray: confirm / extend — these are sensible defaults, not set in stone). */
const RESALE_POST_DEFAULTS = ["Facebook Marketplace", "OfferUp", "Craigslist"];

/* Item TYPES — branch the staging/posing guidance. Crew picks one when adding the item. */
const RESALE_TYPES = [
  ["furniture", "🪑 Furniture"],
  ["tools", "🔧 Tools / equipment"],
  ["appliances", "🔌 Appliances"],
  ["decor", "🖼️ Decor / housewares"],
  ["other", "📦 Other"]
];
function resaleTypeLabel(t) { const x = RESALE_TYPES.find(e => e[0] === t); return x ? x[1] : "📦 Other"; }

/* Type-specific STAGING guidance (step 3 of the playbook varies by what it is). */
const RESALE_STAGE_TIPS = {
  furniture: ["Set it upright the way a buyer would use it (chair pushed in, drawers shut, cushions square).", "Pull it off the wall so all 4 sides + the top are visible; shoot the best front-3/4 angle first.", "Open one drawer/door in a shot to prove it works and show inside.", "Drape nothing on it — bare wood/upholstery photographs as 'clean'. A throw pillow or small plant adds scale + warmth.", "Shoot any flaws (scratch, stain, chip) honestly + close-up — it kills lowball haggling later."],
  tools: ["Wipe off grease/dust first — a clean tool looks like it works.", "Lay it flat on a clean surface (workbench/cardboard), tool centered, plenty of light.", "Photograph the brand name + model number plate — buyers search by model.", "Show it powered on / running if it's electric, or with the blade/bit attached.", "Group small loose pieces (bits, blades, manual, case) in one 'what's included' shot."],
  appliances: ["Clean it inside AND out — fingerprints + crumbs read as 'neglected'. Wipe stainless with the grain.", "Shoot it plugged in and powered ON (lit display) to prove it works.", "Photograph the model/serial sticker — buyers look up specs + age.", "Open the door/lid for a clean interior shot; show racks/shelves included.", "Note dimensions in a photo or the description — buyers need to know it fits their space."],
  decor: ["Style it like a store display — on a shelf, table, or hung, not on the floor.", "Use a clean, plain background so the piece pops; natural window light is best.", "Shoot it straight-on AND at a slight angle to show depth/frame.", "Photograph any maker's mark, signature, or label — it can raise the value.", "Show scale — set it next to a common object or note dimensions so size is clear."],
  other: ["Clean it up and set it on a plain, uncluttered background.", "Shoot multiple angles + any label/brand/model markings.", "Show it working or in-use if that proves condition.", "Get a close-up of any flaw so the listing is honest.", "Note size/dimensions so buyers know what they're getting."]
};

/* The PLAYBOOK — the per-item checklist steps. Each item walks these in order.
   `branch:"stage"` injects the type-specific staging tips at render time. */
const RESALE_STEPS = [
  { id: "photo", icon: "📸", title: "Photograph it", tips: [
    "Shoot in good light — outside in shade or by a big window. No flash, no dark garage corner.",
    "Clean, uncluttered background — blank wall, floor, or driveway. Hide clutter behind it.",
    "Take 5–8 shots: straight-on front, both sides, back, top, and a close-up of any flaw.",
    "Hold the phone level, fill the frame with the item, tap to focus before each shot.",
    "Honesty sells — photograph scratches/stains so buyers don't haggle you down at pickup." ] },
  { id: "clean", icon: "🧽", title: "Clean it", tips: [
    "A clean item looks worth more and sells faster — 10 minutes of wiping = a higher price.",
    "Wood/furniture: dust, wipe with a damp cloth, dry it. Magic-eraser scuffs; tighten loose screws.",
    "Upholstery: vacuum, spot-clean stains, knock off pet hair (lint roller / rubber glove).",
    "Tools/appliances: degrease, wipe down, shine the metal; clean appliances inside AND out.",
    "Decor/glass: dust and glass-cleaner so it photographs sharp." ] },
  { id: "stage", icon: "🎬", title: "Stage / pose it", branch: "stage", tips: [
    "How you pose it depends on what it is — see the type-specific tips below." ] },
  { id: "listing", icon: "✍️", title: "Write the listing", tips: [
    "TITLE: what it is + brand + key detail. e.g. \"Solid Oak 6-Drawer Dresser — great condition\".",
    "DESCRIPTION: type, size/dimensions, material, condition, any flaws, what's included. Be specific.",
    "CONDITION: New / Like-new / Good / Fair — match the photos; don't oversell it.",
    "PRICE: check what similar items go for on Marketplace; price a little under to move it fast.",
    "Add pickup area (general, not your exact address) + \"cash on pickup\". First come, first served." ] },
  { id: "post", icon: "📣", title: "Post it — where", branch: "post", tips: [
    "List on all the platforms below to reach the most buyers (it's free).",
    "Cross-post the same photos + title + price everywhere; mark it POSTED here when it's up.",
    "Paste the listing URL into this item so anyone can find it again." ] },
  { id: "track", icon: "✅", title: "Track it to SOLD", tips: [
    "Respond fast — the first reply usually gets the sale.",
    "When it sells: mark it SOLD here, log the price + buyer, and TAKE DOWN the other listings.",
    "Sold money flows into the resale total — it's real revenue off a junk job." ] }
];

function actResale() { return (D().resale || []).filter(r => r && !r.deleted); }
function resaleLabel(s) { const x = RESALE_STATES.find(e => e[0] === s); return x ? x[1] : (s || "—"); }
function resaleAgeDays(r) { const since = r.status === "posted" ? (r.listedDate ? Date.parse(r.listedDate + "T00:00:00") : r.updatedAt) : r.updatedAt; return since ? Math.max(0, Math.round((now() - since) / 86400000)) : 0; }
function resaleStale(r) { const a = resaleAgeDays(r); return (r.status === "to-list" && a > RESALE_TOLIST_STALE) || (r.status === "posted" && a > RESALE_POSTED_STALE); }
function resaleProv(r) { const d = D(); if (r.customerId) { const c = (d.customers || []).find(x => x.id === r.customerId); if (c) return c.name || c.company || ""; } const j = r.jobId ? (d.jobs || []).find(x => x.id === r.jobId) : null; return j ? (j.title || "") : ""; }
function resaleForJob(jobId) { return actResale().filter(r => r.jobId === jobId); }

/* checklist progress: steps is {stepId:true}. Count of done / total. */
function resaleStepsDone(r) { const s = r.steps || {}; return RESALE_STEPS.reduce((n, st) => n + (s[st.id] ? 1 : 0), 0); }
function resaleProgress(r) { return Math.round(100 * resaleStepsDone(r) / RESALE_STEPS.length); }

function rResale() {
  const all = actResale();
  const by = s => all.filter(r => r.status === s);
  const tolist = by("to-list").concat(by("pulled")), posted = by("posted"), sold = by("sold");
  const soldTotal = sold.reduce((s, r) => s + (+r.price || 0), 0);
  let h = `<div class="secthd" style="margin-top:0"><h2>Resale</h2><button class="btn ghost sm" onclick="openResale()">+ Item</button></div>`;
  h += resaleGuideCard();
  h += `<div class="card"><div class="row" style="gap:14px;flex-wrap:wrap">
      <div class="grow"><div class="sub">To post</div><div class="nm" style="font-size:20px;${tolist.some(resaleStale) ? "color:var(--danger)" : ""}">${tolist.length}</div></div>
      <div class="grow"><div class="sub">Posted</div><div class="nm" style="font-size:20px">${posted.length}</div></div>
      <div class="grow"><div class="sub">Sold</div><div class="nm" style="font-size:20px">${sold.length} · ${money(soldTotal)}</div></div>
    </div></div>`;
  if (!all.length) { view.innerHTML = h + `<div class="empty"><div class="big">♻️</div>No resale items yet.<br>Pull something from a junk job → tap <b>+ Item</b>, or add it on the job.<br><span class="sub">Each item walks the crew through photograph → clean → stage → list → post → sold.</span></div>`; return; }
  const sec = (title, arr, showAge) => arr.length ? `<div class="secthd"><h2>${title}</h2><span class="ct">${arr.length}</span></div><div class="card">` + arr.map(r => {
    const age = showAge ? resaleAgeDays(r) : 0, stale = showAge && resaleStale(r), prov = resaleProv(r);
    const prog = r.status === "sold" ? 100 : resaleProgress(r);
    return `<div class="li" style="align-items:flex-start" onclick="openResale('${r.id}')"><div class="grow">
      <div class="nm" style="${stale ? "color:var(--danger)" : ""}">${stale ? "🔴 " : ""}${esc(r.item || "Item")}${r.status === "sold" && r.price ? " · " + money(r.price) : ""}</div>
      <div class="sub" style="white-space:normal">${resaleTypeLabel(r.type)} · ${resaleLabel(r.status)}${prov ? " · from " + esc(prov) : ""}${r.status === "posted" && r.platform ? " · " + esc(r.platform) : ""}${showAge && age ? " · " + age + "d" : ""}</div>
      ${r.status !== "sold" ? `<div class="sub" style="white-space:normal">📋 Checklist ${resaleStepsDone(r)}/${RESALE_STEPS.length}${prog ? " · " + prog + "%" : ""}</div>` : ""}</div>
      ${resaleNextBtn(r)}</div>`;
  }).join("") + `</div>` : "";
  h += sec("📝 To post", tolist, true) + sec("📣 Posted", posted, true) + sec("✅ Sold", sold, false);
  view.innerHTML = h;
}

/* The general "How to resell" PLAYBOOK — a collapsible guide the whole crew can read.
   Mirrors the per-item checklist so the steps are learned once, then followed per item. */
function resaleGuideCard() {
  const stepLi = RESALE_STEPS.map((st, i) => {
    let tips = st.tips.slice();
    if (st.branch === "stage") tips = tips.concat(RESALE_TYPES.map(t => `${t[1].replace(/^[^ ]+ /, "")}: ${RESALE_STAGE_TIPS[t[0]][0]}`));
    if (st.branch === "post") tips = tips.concat(["OBX defaults: " + RESALE_POST_DEFAULTS.join(", ") + "."]);
    return `<div style="margin-top:8px"><b>${st.icon} ${i + 1}. ${esc(st.title)}</b><ul style="margin:3px 0 0 18px;padding:0">${tips.map(x => `<li style="margin:2px 0">${esc(x)}</li>`).join("")}</ul></div>`;
  }).join("");
  return `<details class="card" style="border-left:4px solid var(--accent)"><summary style="font-weight:800;cursor:pointer">🧭 How to resell — the crew playbook</summary>
    <div style="font-size:13px;line-height:1.5;margin-top:6px">
      <div class="sub">Every pulled item walks the same 6 steps. Open any item to follow its checklist; this is the reference.</div>
      ${stepLi}
    </div></details>`;
}

function resaleNextBtn(r) {
  if (r.status === "sold") return "";
  const next = r.status === "posted" ? ["sold", "✓ Sold"] : ["posted", "→ Posted"];
  return `<button class="btn acc sm" style="flex:0 0 auto" onclick="event.stopPropagation();openResale('${r.id}','','${next[0]}')">${next[1]}</button>`;
}

/* inline on the job modal (#j_resale): this job's pulled items + a quick "+ Resale pulled" */
window.renderJobResale = function (jobId) {
  const box = document.getElementById("j_resale"); if (!box) return;
  const items = resaleForJob(jobId);
  const rows = items.map(r => `<div class="li" style="align-items:center" onclick="openResale('${r.id}')"><div class="grow"><div class="nm" style="font-size:15px">${esc(r.item || "Item")}</div><div class="sub">${resaleLabel(r.status)}${r.status !== "sold" ? " · 📋 " + resaleStepsDone(r) + "/" + RESALE_STEPS.length : ""}${r.status === "sold" && r.price ? " · " + money(r.price) : ""}</div></div></div>`).join("");
  box.innerHTML = (rows || `<div class="muted">Nothing pulled to flip.</div>`) + `<button class="btn ghost sm" style="margin-top:8px" onclick="openResale(null,'${jobId}')">+ Resale pulled</button>`;
};

/* The per-item CHECKLIST block (the guided process for THIS item). Shown inside the item modal.
   Each step is a tappable row that toggles done; staging tips branch by the item's type. */
function resaleChecklistHtml(r) {
  const steps = r.steps || {};
  const type = r.type || "other";
  const rows = RESALE_STEPS.map((st, i) => {
    const done = !!steps[st.id];
    let tips = st.tips.slice();
    if (st.branch === "stage") tips = (RESALE_STAGE_TIPS[type] || RESALE_STAGE_TIPS.other);
    if (st.branch === "post") tips = tips.concat(["List on: " + RESALE_POST_DEFAULTS.join(", ") + "."]);
    return `<div class="card" style="margin:6px 0;padding:8px;border-left:4px solid ${done ? "var(--accent)" : "var(--soft)"}">
      <div class="row" style="align-items:flex-start;gap:8px;cursor:pointer" onclick="resaleToggleStep('${r.id}','${st.id}')">
        <div style="font-size:18px;flex:0 0 auto">${done ? "✅" : "☐"}</div>
        <div class="grow"><div class="nm" style="font-size:15px;${done ? "text-decoration:line-through;color:var(--muted)" : ""}">${st.icon} ${i + 1}. ${esc(st.title)}</div></div>
      </div>
      <details style="margin-top:4px"><summary style="cursor:pointer;font-size:12px;color:var(--accent-ink)">${st.branch === "stage" ? "Staging tips for " + resaleTypeLabel(type) : "How"}</summary>
        <ul style="margin:4px 0 0 18px;padding:0;font-size:12.5px;line-height:1.45">${tips.map(x => `<li style="margin:2px 0">${esc(x)}</li>`).join("")}</ul></details>
    </div>`;
  }).join("");
  const done = resaleStepsDone(r), pct2 = resaleProgress(r);
  return `<div style="margin-top:4px"><div class="row" style="align-items:center;gap:8px"><b>📋 Resell checklist</b><span class="sub">${done}/${RESALE_STEPS.length} · ${pct2}%</span></div>
    <div style="height:6px;background:var(--soft);border-radius:4px;overflow:hidden;margin:6px 0"><div style="height:100%;width:${pct2}%;background:var(--accent)"></div></div>
    ${rows}</div>`;
}

/* toggle a step done/undone — persists on the resale record (rides LWW), re-renders the open modal. */
window.resaleToggleStep = function (id, stepId) {
  const r = (D().resale || []).find(x => x.id === id); if (!r) return;
  r.steps = r.steps || {};
  if (r.steps[stepId]) delete r.steps[stepId]; else r.steps[stepId] = true;
  touch(r); save();
  const box = document.getElementById("rs_checklist"); if (box) box.innerHTML = resaleChecklistHtml(r);
};

window.openResale = function (id, jobId, presetStatus) {
  const d = D();
  const r = id ? (d.resale || []).find(x => x.id === id) : { id: uid(), status: presetStatus || "to-list", jobId: jobId || "", type: "", steps: {}, createdAt: now() };
  if (!r) return;
  const isNew = !id, st = presetStatus || r.status || "to-list";
  const jobOpts = `<option value="">— none —</option>` + (typeof actJ === "function" ? actJ() : []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(j => `<option value="${j.id}" ${r.jobId === j.id ? "selected" : ""}>${esc((j.title || "Job") + (j.date ? " · " + fmtDate(j.date) : ""))}</option>`).join("");
  const platOpts = RESALE_PLATFORMS.map(p => `<option value="${p}" ${r.platform === p ? "selected" : ""}>${p || "— select —"}</option>`).join("");
  const typeOpts = `<option value="">— pick a type —</option>` + RESALE_TYPES.map(t => `<option value="${t[0]}" ${r.type === t[0] ? "selected" : ""}>${t[1]}</option>`).join("");
  modal(isNew ? "Resale item" : "Resale item", `
    <label>Item</label><input id="rs_item" value="${esc(r.item || "")}" placeholder="e.g. Oak dresser">
    <label>Type (sets the staging tips)</label><select id="rs_type">${typeOpts}</select>
    <label>Status</label><select id="rs_status" onchange="resaleStatusToggle()">${RESALE_STATES.map(s => `<option value="${s[0]}" ${st === s[0] ? "selected" : ""}>${s[1]}</option>`).join("")}</select>
    <label>From job (where it was pulled)</label><select id="rs_job">${jobOpts}</select>
    <div id="rs_posted_box" style="display:none">
      <label>Platform</label><select id="rs_platform">${platOpts}</select>
      <label>Listing URL</label><input id="rs_url" value="${esc(r.url || "")}" placeholder="link to the listing" inputmode="url">
      <label>Listed date</label><input id="rs_listed" type="date" value="${r.listedDate || ""}">
    </div>
    <div id="rs_sold_box" style="display:none">
      <label>Sold price ($)</label><input id="rs_price" type="number" min="0" step="1" inputmode="decimal" value="${r.price != null ? r.price : ""}">
      <label>Buyer (optional)</label><input id="rs_buyer" value="${esc(r.buyer || "")}">
      <label>Sold date</label><input id="rs_solddate" type="date" value="${r.soldDate || ""}">
    </div>
    <label>Notes</label><textarea id="rs_notes">${esc(r.notes || "")}</textarea>
    ${isNew ? `<div class="note" style="font-size:12px;color:var(--muted);margin-top:6px">Save it, then reopen to walk the resell checklist.</div>` : `<div id="rs_checklist" style="margin-top:14px">${resaleChecklistHtml(r)}</div>`}
    <button class="btn acc" style="margin-top:12px" onclick="saveResale('${r.id}',${isNew})">Save</button>
    ${isNew ? "" : `<button class="btn danger" style="margin-top:10px" onclick="delResale('${r.id}')">Delete</button>`}
  `);
  resaleStatusToggle();
};
window.resaleStatusToggle = function () {
  const s = val("rs_status");
  const pb = document.getElementById("rs_posted_box"), sb = document.getElementById("rs_sold_box");
  if (pb) pb.style.display = (s === "posted" || s === "sold") ? "block" : "none";
  if (sb) sb.style.display = (s === "sold") ? "block" : "none";
};
window.saveResale = function (id, isNew) {
  const d = D(); let r = isNew ? { id, steps: {}, createdAt: now() } : (d.resale || []).find(x => x.id === id);
  if (!r) return;
  r.item = val("rs_item"); r.status = val("rs_status") || "to-list"; r.jobId = val("rs_job"); r.notes = val("rs_notes");
  r.type = val("rs_type") || r.type || "";
  if (!r.item) { alert("Name the item."); return; }
  const job = r.jobId ? (d.jobs || []).find(j => j.id === r.jobId) : null;
  r.customerId = (job && job.customerId) || r.customerId || "";
  if (r.status === "posted" || r.status === "sold") {
    r.platform = val("rs_platform"); r.url = val("rs_url");
    r.listedDate = val("rs_listed") || r.listedDate || (typeof today === "function" ? today() : "");
  }
  if (r.status === "sold") {
    r.price = Math.max(0, +val("rs_price") || 0); r.buyer = val("rs_buyer");
    r.soldDate = val("rs_solddate") || r.soldDate || (typeof today === "function" ? today() : "");
  }
  touch(r); if (isNew) { d.resale = d.resale || []; d.resale.push(r); }
  if (typeof logChange === "function") logChange(isNew ? "create" : "update", "resale", r.id, (isNew ? "Resale: " : "Resale " + r.status + ": ") + (r.item || "item") + (r.status === "sold" && r.price ? " · " + money(r.price) : ""));
  save(); closeModal(); render();
};
window.delResale = function (id) {
  if (!confirm("Delete this resale item?")) return;
  const r = (D().resale || []).find(x => x.id === id); if (!r) return;
  r.deleted = true; touch(r);
  if (typeof logChange === "function") logChange("delete", "resale", id, "Deleted resale " + (r.item || "item"));
  save(); closeModal(); render();
};
