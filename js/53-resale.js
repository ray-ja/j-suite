/* ---------- RESALE TRACKER (Cap #5) — junk-pulled items: pulled → to-list → posted → sold ----------
   First-class resale[] collection (each item has its own lifecycle + updatedAt; links back to the job
   that pulled it). Closes the "furniture never got posted" gap and feeds the ops-sweep an
   "unposted resale aging" flag (via view=ops). Mobile-first; crew + owner. */

const RESALE_STATES = [["pulled", "🪑 Pulled"], ["to-list", "📝 To list"], ["posted", "📣 Posted"], ["sold", "✅ Sold"]];
const RESALE_PLATFORMS = ["", "Facebook Marketplace", "Craigslist", "OfferUp", "eBay", "Nextdoor", "Other"];
const RESALE_TOLIST_STALE = 7, RESALE_POSTED_STALE = 21;   // days before "aging" (mirror tools/ops-sweep.js)

function actResale() { return (D().resale || []).filter(r => r && !r.deleted); }
function resaleLabel(s) { const x = RESALE_STATES.find(e => e[0] === s); return x ? x[1] : (s || "—"); }
function resaleAgeDays(r) { const since = r.status === "posted" ? (r.listedDate ? Date.parse(r.listedDate + "T00:00:00") : r.updatedAt) : r.updatedAt; return since ? Math.max(0, Math.round((now() - since) / 86400000)) : 0; }
function resaleStale(r) { const a = resaleAgeDays(r); return (r.status === "to-list" && a > RESALE_TOLIST_STALE) || (r.status === "posted" && a > RESALE_POSTED_STALE); }
function resaleProv(r) { const d = D(); if (r.customerId) { const c = (d.customers || []).find(x => x.id === r.customerId); if (c) return c.name || c.company || ""; } const j = r.jobId ? (d.jobs || []).find(x => x.id === r.jobId) : null; return j ? (j.title || "") : ""; }
function resaleForJob(jobId) { return actResale().filter(r => r.jobId === jobId); }

function rResale() {
  const all = actResale();
  const by = s => all.filter(r => r.status === s);
  const tolist = by("to-list").concat(by("pulled")), posted = by("posted"), sold = by("sold");
  const soldTotal = sold.reduce((s, r) => s + (+r.price || 0), 0);
  let h = `<div class="secthd" style="margin-top:0"><h2>Resale</h2><button class="btn ghost sm" onclick="openResale()">+ Item</button></div>`;
  h += `<div class="card"><div class="row" style="gap:14px;flex-wrap:wrap">
      <div class="grow"><div class="sub">To post</div><div class="nm" style="font-size:20px;${tolist.some(resaleStale) ? "color:var(--danger)" : ""}">${tolist.length}</div></div>
      <div class="grow"><div class="sub">Posted</div><div class="nm" style="font-size:20px">${posted.length}</div></div>
      <div class="grow"><div class="sub">Sold</div><div class="nm" style="font-size:20px">${sold.length} · ${money(soldTotal)}</div></div>
    </div></div>`;
  if (!all.length) { view.innerHTML = h + `<div class="empty"><div class="big">♻️</div>No resale items yet.<br>Pull something from a junk job → tap <b>+ Item</b>, or add it on the job.</div>`; return; }
  const sec = (title, arr, showAge) => arr.length ? `<div class="secthd"><h2>${title}</h2><span class="ct">${arr.length}</span></div><div class="card">` + arr.map(r => {
    const age = showAge ? resaleAgeDays(r) : 0, stale = showAge && resaleStale(r), prov = resaleProv(r);
    return `<div class="li" style="align-items:flex-start" onclick="openResale('${r.id}')"><div class="grow">
      <div class="nm" style="${stale ? "color:var(--danger)" : ""}">${stale ? "🔴 " : ""}${esc(r.item || "Item")}${r.status === "sold" && r.price ? " · " + money(r.price) : ""}</div>
      <div class="sub" style="white-space:normal">${resaleLabel(r.status)}${prov ? " · from " + esc(prov) : ""}${r.status === "posted" && r.platform ? " · " + esc(r.platform) : ""}${showAge && age ? " · " + age + "d" : ""}</div></div>
      ${resaleNextBtn(r)}</div>`;
  }).join("") + `</div>` : "";
  h += sec("📝 To post", tolist, true) + sec("📣 Posted", posted, true) + sec("✅ Sold", sold, false);
  view.innerHTML = h;
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
  const rows = items.map(r => `<div class="li" style="align-items:center" onclick="openResale('${r.id}')"><div class="grow"><div class="nm" style="font-size:15px">${esc(r.item || "Item")}</div><div class="sub">${resaleLabel(r.status)}${r.status === "sold" && r.price ? " · " + money(r.price) : ""}</div></div></div>`).join("");
  box.innerHTML = (rows || `<div class="muted">Nothing pulled to flip.</div>`) + `<button class="btn ghost sm" style="margin-top:8px" onclick="openResale(null,'${jobId}')">+ Resale pulled</button>`;
};

window.openResale = function (id, jobId, presetStatus) {
  const d = D();
  const r = id ? (d.resale || []).find(x => x.id === id) : { id: uid(), status: presetStatus || "to-list", jobId: jobId || "", createdAt: now() };
  if (!r) return;
  const isNew = !id, st = presetStatus || r.status || "to-list";
  const jobOpts = `<option value="">— none —</option>` + (typeof actJ === "function" ? actJ() : []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(j => `<option value="${j.id}" ${r.jobId === j.id ? "selected" : ""}>${esc((j.title || "Job") + (j.date ? " · " + fmtDate(j.date) : ""))}</option>`).join("");
  const platOpts = RESALE_PLATFORMS.map(p => `<option value="${p}" ${r.platform === p ? "selected" : ""}>${p || "— select —"}</option>`).join("");
  modal(isNew ? "Resale item" : "Resale item", `
    <label>Item</label><input id="rs_item" value="${esc(r.item || "")}" placeholder="e.g. Oak dresser">
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
  const d = D(); let r = isNew ? { id, createdAt: now() } : (d.resale || []).find(x => x.id === id);
  if (!r) return;
  r.item = val("rs_item"); r.status = val("rs_status") || "to-list"; r.jobId = val("rs_job"); r.notes = val("rs_notes");
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
