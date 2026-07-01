/* ---------- RECEIPTS — mass upload + sortable, CLICK-TO-EDIT table (Money → Receipts) ----------
   The owner dumps a stack of receipt photos in now and categorizes them later, then invoices off them.

   DATA MODEL (correct + reversible — see CLAUDE.md data rules):
     • A new synced top-level `receipts` collection is the HOME for UNASSIGNED / "needs review" uploads only
       (each {id, receiptId(photo), amount, vendor, date, type, jobId, category, paidBy, desc, uploadedBy, by,
        status:"review", suggested, ts, deleted, updatedAt}). Mass upload writes review records here.
     • ATTRIBUTED receipts still live in their EXISTING billing arrays — job.materials[] (pass-through, billed
       to the customer), job.expenses[] (job expense, reimbursed to the uploader), and this org's `expenses[]`
       (plain business expense). Those arrays + all billing/P&L/invoicing code are UNCHANGED, so job cost +
       customer invoicing math stay byte-identical. When a review receipt is attributed (or a filed one is
       re-bucketed) it MOVES between arrays PRESERVING its id + photo (js/87 rcptApplyEdit) — never a
       delete-and-remake. One receipt lives in exactly ONE array at a time, so the table never double-counts.
     • The on-the-job uploads (js/61 jobAddExpense/jobAddMaterial) are untouched and feed the SAME arrays, so
       everything they log shows up in this table too.
   The Receipts table AGGREGATES all four homes into one sortable, click-to-edit view. */

const RCPT_CATS = ["materials", "tools/equipment", "disposal", "fuel", "rentals", "subscription/software", "marketing/ads", "uniforms", "office/admin", "other"];
let RCPT_SORT = { col: "date", dir: "desc" };   // survives re-render; header taps toggle
let RCPT_FILTER = "all";                          // all | review | filed

function rcptColl() { const d = D(); if (!Array.isArray(d.receipts)) d.receipts = []; return d.receipts; }
function rcptReview() { return rcptColl().filter(r => r && !r.deleted && r.status === "review"); }
function rcptMembers() { return (typeof schedMembers === "function") ? schedMembers() : []; }
function rcptJobs() { return ((typeof actJ === "function") ? actJ() : []).filter(j => j && !j.deleted && !Array.isArray(j.sharedJobIds)).sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))); }
function rcptFinFull() { return (typeof finCanView === "function") ? finCanView() : (typeof isOwner === "function" ? isOwner() : true); }   // owner/admin: full financial table + editing
function rcptMe() { return (typeof curUser === "function") ? curUser() : null; }

/* per-member personal-card spend (paidBy set) across job expenses, pass-through materials, and business expenses */
function rcptReimbOwed() {
  const per = {}; const add = e => { if (e && !e.deleted && e.paidBy && !e.reimbursedAt) per[e.paidBy] = (per[e.paidBy] || 0) + (+e.amount || 0); };
  (D().jobs || []).forEach(j => { if (j && !j.deleted) { (j.expenses || []).forEach(add); (j.materials || []).forEach(add); } });
  (D().expenses || []).forEach(add);
  return per;
}
function rcptThumb(id) {
  const up = (typeof jsUploadUrl === "function") ? jsUploadUrl(id) : "";
  if (!id) return `<div style="width:64px;height:64px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1px dashed var(--line);background:var(--soft);flex:0 0 auto;font-size:22px">📷</div>`;
  if (/\.pdf$/i.test(id || "")) return `<a href="${up}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:flex;width:64px;height:64px;align-items:center;justify-content:center;border-radius:8px;border:1px solid var(--line);background:var(--soft);text-decoration:none;flex:0 0 auto"><div style="text-align:center"><div style="font-size:22px;line-height:1">📄</div><div class="sub" style="font-size:9px">PDF</div></div></a>`;
  return `<a href="${up}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="flex:0 0 auto"><img src="${up}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--line)" loading="lazy"></a>`;
}

/* every ATTRIBUTED (filed) receipt across job expenses, pass-through materials, and business expenses (only
   those with a receiptId photo). Shape = the record's own fields + {store, jobId, where}. Used by the table,
   the dup detector, and CSV/ZIP export. */
function rcptAllFiled() {
  const out = [];
  (D().jobs || []).forEach(function (j) { if (!j || j.deleted) return;
    (j.expenses || []).forEach(function (e) { if (e && !e.deleted && e.receiptId) out.push(Object.assign({}, e, { store: "jobexp", jobId: j.id, where: (j.title || "job") })); });
    (j.materials || []).forEach(function (e) { if (e && !e.deleted && e.receiptId) out.push(Object.assign({}, e, { store: "jobmat", jobId: j.id, where: (j.title || "job") + " · pass-through" })); });
  });
  (D().expenses || []).forEach(function (e) { if (e && !e.deleted && e.receiptId) out.push(Object.assign({}, e, { store: "biz", jobId: null, where: "business expense" })); });
  return out.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
}
/* EVERY receipt for the table: unassigned review uploads + all filed receipts. recId = the record id in its home. */
function rcptAllRows() {
  const out = [];
  rcptReview().forEach(r => out.push(Object.assign({}, r, { store: "review", recId: r.id, jobId: r.jobId || null })));
  rcptAllFiled().forEach(e => out.push(Object.assign({}, e, { recId: e.id })));
  return out;
}
/* normalized display/sort metadata for a row */
function rcptRowMeta(r) {
  let type = r.type;
  if (!type) type = r.store === "jobmat" ? "pass-through" : r.store === "jobexp" ? "job-expense" : r.store === "biz" ? "business" : "review";
  const status = r.store === "review" ? "review" : "filed";
  let jobLabel = "", cust = "";
  if (r.jobId) { const j = (D().jobs || []).find(x => x && x.id === r.jobId); if (j) { jobLabel = j.title || "Job"; cust = (j.customerId && typeof custName === "function") ? custName(j.customerId) : ""; } }
  const uploader = (r.uploadedBy && typeof userName === "function" && userName(r.uploadedBy)) || r.by || "";
  const forName = (r.attributedTo && typeof userName === "function" && userName(r.attributedTo)) || "";   // "For" = whose receipt it is / who gets paid back
  return { type: type, status: status, jobLabel: jobLabel, cust: cust, uploader: uploader, forName: forName };
}
const RCPT_TYPE_LABEL = { "review": "🕓 Needs review", "business": "🏢 Business", "job-expense": "💵 Job expense", "pass-through": "🧱 Pass-through" };

/* a duplicate = same amount + same (normalized) description/vendor */
function rcptDupKey(e) { const v = String(e.vendor || "").trim().toLowerCase(), dsc = String(e.desc || e.note || "").trim().toLowerCase(); return Math.round((+e.amount || 0) * 100) + "|" + (v || dsc).replace(/\s+/g, " "); }
function rcptDupSet(filed) { const cnt = {}, s = {}; (filed || []).forEach(function (e) { if (!(+e.amount)) return; const k = rcptDupKey(e); cnt[k] = (cnt[k] || 0) + 1; }); Object.keys(cnt).forEach(function (k) { if (cnt[k] > 1) s[k] = cnt[k]; }); return s; }

/* tax records: standardized DATE-first filename + a CSV export.
   `capRead` (when Cap has read the receipt) provides the real transaction date/vendor; else we use the filed date. */
function rcptDate(e) { const cr = e.capRead || {}; if (cr.date) return String(cr.date).slice(0, 10); if (e.date) return String(e.date).slice(0, 10); if (e.ts) { try { return new Date(e.ts).toISOString().slice(0, 10); } catch (x) {} } return ""; }
function rcptSan(s, n) { s = String(s || "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); return n ? s.slice(0, n) : s; }
function rcptStdName(e) { const ext = (/\.([A-Za-z0-9]+)$/.exec(e.receiptId || "") || [, "jpg"])[1]; return [rcptDate(e) || "undated", rcptSan(e.vendor || "vendor", 24), "$" + (+e.amount || 0).toFixed(2), rcptSan(e.desc || e.note || "", 24)].filter(Boolean).join("_") + "." + ext; }
function rcptCsvString() {
  const filed = rcptAllFiled(), base = ((S.sync && S.sync.url) || location.origin).replace(/\/+$/, "");
  const rows = [["Date", "Vendor", "Amount", "What", "Category", "Paid by", "Card", "Reimbursed", "Where", "Standard filename", "Receipt link"]];
  filed.forEach(function (e) { rows.push([ rcptDate(e), e.vendor || "", (+e.amount || 0).toFixed(2), e.desc || e.note || "", e.category || "", e.paidBy ? ((typeof userName === "function" ? userName(e.paidBy) : "") || "") : "", e.paidBy ? "personal" : "business", e.reimbursedAt ? "yes" : (e.paidBy ? "no" : ""), e.where || "", rcptStdName(e), base + "/uploads/" + (e.receiptId || "") ]); });
  return rows.map(function (r) { return r.map(function (c) { c = String(c == null ? "" : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(","); }).join("\r\n");
}
function rcptDownload(name, data, mime) {
  try { const blob = new Blob([data], { type: mime }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(a.href); } catch (z) {} }, 120); } catch (x) { alert("Export failed: " + (x.message || x)); }
}
window.rcptExportCSV = function () {
  if (!rcptAllFiled().length) { alert("No filed receipts to export yet."); return; }
  rcptDownload("receipts-" + (typeof today === "function" ? today() : "export") + ".csv", rcptCsvString(), "text/csv");
};
/* hand-rolled minimal ZIP (STORE method — receipts are already-compressed images/PDFs, so no deflate needed; no library, fits the no-build rule) */
function rcptCrc32(u8) { let c = ~0; for (let i = 0; i < u8.length; i++) { c ^= u8[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; }
function rcptZip(files) {
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
  const parts = [], central = []; let offset = 0;
  files.forEach(function (f) {
    const name = new TextEncoder().encode(f.name), data = f.data, crc = rcptCrc32(data), sz = data.length;
    const lfh = new Uint8Array([].concat([0x50,0x4b,0x03,0x04], u16(20), u16(0), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(sz), u32(sz), u16(name.length), u16(0)));
    parts.push(lfh, name, data);
    central.push(new Uint8Array([].concat([0x50,0x4b,0x01,0x02], u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(sz), u32(sz), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
    offset += lfh.length + name.length + sz;
  });
  let cdSize = 0; central.forEach(p => cdSize += p.length);
  const eocd = new Uint8Array([].concat([0x50,0x4b,0x05,0x06], u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)));
  const all = parts.concat(central, [eocd]); let total = 0; all.forEach(p => total += p.length);
  const out = new Uint8Array(total); let pos = 0; all.forEach(function (p) { out.set(p, pos); pos += p.length; }); return out;
}
window.rcptExportZip = async function () {
  const filed = rcptAllFiled(); if (!filed.length) { alert("No filed receipts to export yet."); return; }
  if (filed.length > 300 && !confirm(filed.length + " receipts — building the zip may take a moment. Continue?")) return;
  const base = ((S.sync && S.sync.url) || location.origin).replace(/\/+$/, "");
  const files = [], used = {};
  for (const e of filed) {
    if (!e.receiptId) continue;
    let name = rcptStdName(e); if (used[name]) { used[name]++; name = name.replace(/(\.[^.]+)$/, "-" + used[name] + "$1"); } else used[name] = 1;
    try { const r = await fetch(base + "/uploads/" + encodeURIComponent(e.receiptId)); if (!r.ok) continue; files.push({ name: name, data: new Uint8Array(await r.arrayBuffer()) }); } catch (x) {}
  }
  if (!files.length) { alert("Couldn't fetch any receipt files."); return; }
  files.push({ name: "_manifest.csv", data: new TextEncoder().encode(rcptCsvString()) });
  rcptDownload("receipts-" + (typeof today === "function" ? today() : "export") + ".zip", rcptZip(files), "application/zip");
};

/* ============================== MASS / BATCH UPLOAD ============================== */
function rcptIsReceipt(f) { return !!(f && (/^image\//.test(f.type || "") || f.type === "application/pdf" || /\.pdf$/i.test(f.name || ""))); }
/* one review record per uploaded photo — blank metadata, "needs review" state, synced */
function rcptNewReview(receiptId) {
  const me = rcptMe();
  // attributedTo = WHOSE receipt it is (who it concerns / gets reimbursed) — distinct from uploadedBy. Defaults
  // to the uploader so a crew member sees their own upload; the owner can re-attribute it when they file it.
  return { id: uid(), receiptId: receiptId, amount: null, vendor: "", date: "", type: null, jobId: null, category: "", paidBy: null, desc: "", uploadedBy: me ? me.id : "", attributedTo: me ? me.id : "", by: me ? (me.username || "") : "", status: "review", suggested: null, ts: now(), deleted: false, updatedAt: now() };
}
let _rcptUpBusy = false;
function rcptSetUpStatus(txt) { const el = document.getElementById("rcpt_upstatus"); if (el) el.textContent = txt || ""; }
function rcptUploadFiles(files) {
  files = (files || []).filter(rcptIsReceipt);
  if (!files.length) return;
  if (typeof jsUpload !== "function") { alert("Upload needs a connection."); return; }
  if (_rcptUpBusy) return;   // a batch is already uploading — ignore repeat taps so a slow upload can't double-create (submitGuard-style busy flag)
  _rcptUpBusy = true;
  const total = files.length; let pending = total, ok = 0;
  rcptSetUpStatus("Uploading 0/" + total + "…");
  const done = () => { if (--pending <= 0) { _rcptUpBusy = false; rcptSetUpStatus(""); if (typeof render === "function") render(); } };
  files.forEach(f => {
    jsUpload(f).then(id => {
      rcptColl().push(rcptNewReview(id));   // one review receipt per photo
      if (typeof save === "function") save();
      ok++; rcptSetUpStatus("Uploaded " + ok + "/" + total + "…"); done();
    }).catch(e => { alert("One upload failed: " + (e.message || e)); done(); });
  });
}
window.rcptUpload = function (input) {
  rcptUploadFiles(input && input.files ? Array.prototype.slice.call(input.files) : []);
  if (input) input.value = "";   // clear so the same batch can't be re-read on a second tap
};
window.rcptPickFiles = function () { const el = document.getElementById("rcpt_files"); if (el) el.click(); };
window.rcptDragOver = function (e) { if (e && e.preventDefault) e.preventDefault(); const dz = e && e.currentTarget; if (dz && dz.style) { dz.style.outline = "2px dashed var(--accent)"; dz.style.outlineOffset = "-4px"; } };
window.rcptDragLeave = function (e) { const dz = e && e.currentTarget; if (dz && dz.style) dz.style.outline = ""; };
window.rcptDrop = function (e) {
  if (e && e.preventDefault) e.preventDefault();
  const dz = e && e.currentTarget; if (dz && dz.style) dz.style.outline = "";
  rcptUploadFiles((e && e.dataTransfer && e.dataTransfer.files) ? Array.prototype.slice.call(e.dataTransfer.files) : []);
};

/* ============================== SORT ============================== */
function rcptSortVal(r, col) {
  const m = rcptRowMeta(r);
  switch (col) {
    case "vendor": return String(r.vendor || "").toLowerCase();
    case "amount": return (r.amount == null || r.amount === "") ? -1 : (+r.amount || 0);
    case "type": return m.type;
    case "job": return (m.cust || m.jobLabel || "").toLowerCase();
    case "uploader": return String(m.uploader || "").toLowerCase();
    case "attributedTo": return String(m.forName || "").toLowerCase();
    case "category": return String(r.category || "").toLowerCase();
    case "status": return m.status;
    case "date": default: return rcptDate(r) || "0000-00-00";
  }
}
function rcptSortCmp(a, b) {
  const col = RCPT_SORT.col, dir = RCPT_SORT.dir === "asc" ? 1 : -1;
  const va = rcptSortVal(a, col), vb = rcptSortVal(b, col);
  if (va < vb) return -1 * dir; if (va > vb) return 1 * dir;
  return (b.ts || 0) - (a.ts || 0);   // stable tiebreak: newest first
}
function rcptSortedRows() {
  let rows = rcptAllRows();
  if (RCPT_FILTER === "review") rows = rows.filter(r => r.store === "review");
  else if (RCPT_FILTER === "filed") rows = rows.filter(r => r.store !== "review");
  else if (RCPT_FILTER === "owed") rows = rows.filter(r => r.paidBy && !r.reimbursedAt);        // personal-card, not yet reimbursed
  else if (RCPT_FILTER === "paidback") rows = rows.filter(r => r.paidBy && r.reimbursedAt);      // reimbursed / settled
  return rows.sort(rcptSortCmp);
}
window.rcptSortBy = function (col) {
  if (RCPT_SORT.col === col) RCPT_SORT.dir = RCPT_SORT.dir === "asc" ? "desc" : "asc";
  else { RCPT_SORT.col = col; RCPT_SORT.dir = (col === "date" || col === "amount") ? "desc" : "asc"; }
  render();
};
window.rcptSetFilter = function (f) { RCPT_FILTER = f; render(); };
function rcptSortArrow(col) { return RCPT_SORT.col === col ? (RCPT_SORT.dir === "asc" ? " ▲" : " ▼") : ""; }

/* ============================== PAGE ============================== */
function rReceipts() {
  if (typeof canSee === "function" && !canSee("receipts")) { view.innerHTML = `<div class="secthd"><h2>Receipts</h2></div><div class="card"><div class="muted">Not available for your role.</div></div>`; return; }
  if (!rcptFinFull()) { view.innerHTML = rcptCrewView(); return; }   // crew: upload + own review queue only (no finance data)

  const rows = rcptSortedRows();
  const reviewCount = rcptReview().length;
  const filed = rcptAllFiled(), dups = rcptDupSet(filed), dupCount = Object.keys(dups).length;

  let h = `<div class="secthd"><h2>📸 Receipts</h2><span class="ct">${rcptAllRows().length}</span></div>`;

  // MASS UPLOAD
  h += `<div class="card" ondragover="rcptDragOver(event)" ondragleave="rcptDragLeave(event)" ondrop="rcptDrop(event)">
    <div class="sub" style="white-space:normal">Dump a whole <b>stack</b> of receipts in now — snap or pick several at once, or <b>drag &amp; drop</b> them here. Each lands in <b>Needs review</b>; tap any row below to set vendor/amount/type/job and file it.</div>
    <input type="file" id="rcpt_files" accept="image/*,application/pdf,.pdf" multiple style="display:none" onchange="rcptUpload(this)">
    <button class="btn acc" style="width:100%;margin-top:8px" onclick="rcptPickFiles()">📷 Upload receipt photos</button>
    <div id="rcpt_upstatus" class="sub" style="text-align:center;margin-top:6px;color:var(--accent);min-height:16px"></div>
    <div class="sub" style="text-align:center;opacity:.6">⬇ or drag photos onto this box (desktop)</div></div>`;

  if (reviewCount) h += `<div class="card" style="border-left:4px solid var(--accent)"><b>🕓 ${reviewCount} receipt${reviewCount > 1 ? "s" : ""} need${reviewCount > 1 ? "" : "s"} review</b> — untagged uploads. Tap one to set vendor, amount, type &amp; job.</div>`;
  if (dupCount) h += `<div class="card" style="border-left:4px solid var(--danger)"><b>⚠ ${dupCount} possible duplicate${dupCount > 1 ? "s" : ""}</b> — same amount + description filed more than once. Flagged in the table; open &amp; delete the extras.</div>`;

  // FILTER + EXPORT bar
  h += `<div class="row" style="gap:6px;align-items:center;flex-wrap:wrap;margin:12px 0 6px">
    <button class="btn ${RCPT_FILTER === "all" ? "acc" : "ghost"} sm" onclick="rcptSetFilter('all')">All ${rcptAllRows().length}</button>
    <button class="btn ${RCPT_FILTER === "review" ? "acc" : "ghost"} sm" onclick="rcptSetFilter('review')">Needs review ${reviewCount}</button>
    <button class="btn ${RCPT_FILTER === "filed" ? "acc" : "ghost"} sm" onclick="rcptSetFilter('filed')">Filed ${filed.length}</button>
    <button class="btn ${RCPT_FILTER === "owed" ? "acc" : "ghost"} sm" onclick="rcptSetFilter('owed')">💸 Owed ${rcptAllRows().filter(r => r.paidBy && !r.reimbursedAt).length}</button>
    <button class="btn ${RCPT_FILTER === "paidback" ? "acc" : "ghost"} sm" onclick="rcptSetFilter('paidback')">✓ Paid back ${rcptAllRows().filter(r => r.paidBy && r.reimbursedAt).length}</button>
    <span class="grow"></span>
    <button class="btn ghost sm" onclick="rcptExportCSV()">📤 CSV</button><button class="btn ghost sm" onclick="rcptExportZip()">📦 ZIP</button></div>`;

  // TABLE
  h += rcptTableHTML(rows, dups);

  // reimbursements owed
  const owed = rcptReimbOwed(), oids = Object.keys(owed).filter(id => owed[id] > 0.005);
  if (oids.length) {
    h += `<div class="secthd" style="margin-top:14px"><h2>💸 Reimbursements owed</h2></div><div class="card">` + oids.map(id => `<div class="li"><div class="grow"><div class="nm">${esc((typeof userName === "function" ? userName(id) : "") || "?")}</div><div class="sub">personal-card spend on jobs + business</div></div><div class="row" style="gap:8px;align-items:center"><b>${money(owed[id])}</b><button class="btn ghost sm" onclick="rcptSettle('${id}')">✓ Mark paid back</button></div></div>`).join("") + `<div class="sub" style="margin-top:6px">"Mark paid back" clears their balance once you've reimbursed them from business funds.</div></div>`;
  }
  view.innerHTML = h;
}

function rcptTableHTML(rows, dups) {
  if (!rows.length) return `<div class="card"><div class="muted">No receipts here. Upload a stack above.</div></div>`;
  const th = (col, label, align) => `<th onclick="rcptSortBy('${col}')" style="text-align:${align || "left"};cursor:pointer;white-space:nowrap;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted);user-select:none">${label}${rcptSortArrow(col)}</th>`;
  let h = `<div class="card" style="padding:4px 4px 6px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr>${th("date", "Date")}${th("vendor", "Vendor")}${th("amount", "Amount", "right")}${th("type", "Type")}${th("category", "Category")}${th("job", "Job / Customer")}${th("uploader", "By")}${th("attributedTo", "For")}<th style="padding:8px 6px;border-bottom:2px solid var(--line)">📎</th>${th("status", "Status")}</tr></thead><tbody>`;
  rows.slice(0, 500).forEach(r => {
    const m = rcptRowMeta(r);
    const isDup = !!(r.amount && dups[rcptDupKey(r)]);
    const amt = (r.amount == null || r.amount === "") ? `<span style="color:var(--muted)">—</span>` : money(r.amount);
    const d = rcptDate(r);
    const statusBadge = m.status === "review"
      ? `<span class="badge" style="background:var(--accent);color:#fff">review</span>`
      : r.paidBy
        ? (r.reimbursedAt
            ? `<span class="badge" style="background:var(--accent);color:#fff">✓ Paid back</span>`
            : `<span class="badge" style="background:#e0a800;color:#fff">Owed</span>`)
        : `<span class="badge" style="background:var(--soft);color:var(--muted)">filed</span>`;
    h += `<tr onclick="rcptEditOpen('${r.store}','${r.jobId || ""}','${r.recId}')" style="cursor:pointer;border-bottom:1px solid var(--line)${isDup ? ";background:var(--danger-soft,#fdecea)" : ""}">
      <td style="padding:8px 6px;white-space:nowrap">${d ? esc(fmtDate(d)) : `<span style="color:var(--muted)">—</span>`}</td>
      <td style="padding:8px 6px;white-space:normal">${r.vendor ? esc(r.vendor) : `<span style="color:var(--muted)">—</span>`}${(r.desc || r.note) ? `<div class="sub" style="font-size:11px;white-space:normal">${esc(r.desc || r.note)}</div>` : ""}${isDup ? ` <span class="badge" style="background:var(--danger);color:#fff">⚠ dup</span>` : ""}${r.suggested ? ` <span class="badge" style="background:#6b3fa0;color:#fff">🤖 Cap</span>` : ""}</td>
      <td style="padding:8px 6px;text-align:right;white-space:nowrap">${amt}${r.paidBy ? `<div class="sub" style="font-size:10px">${r.reimbursedAt ? "✓ reimb" : "reimb"}</div>` : ""}</td>
      <td style="padding:8px 6px;white-space:nowrap">${esc(RCPT_TYPE_LABEL[m.type] || m.type)}</td>
      <td style="padding:8px 6px;white-space:nowrap">${r.category ? esc(r.category) : `<span style="color:var(--muted)">—</span>`}</td>
      <td style="padding:8px 6px;white-space:normal">${m.cust ? esc(m.cust) : ""}${m.jobLabel ? `<div class="sub" style="font-size:11px">${esc(m.jobLabel)}</div>` : (m.cust ? "" : `<span style="color:var(--muted)">—</span>`)}</td>
      <td style="padding:8px 6px;white-space:nowrap">${esc(m.uploader || "—")}</td>
      <td style="padding:8px 6px;white-space:nowrap">${m.forName ? esc(m.forName) : `<span style="color:var(--muted)">—</span>`}</td>
      <td style="padding:8px 6px" onclick="event.stopPropagation()">${r.receiptId ? `<a href="${(typeof jsUploadUrl === "function") ? jsUploadUrl(r.receiptId) : ""}" target="_blank" rel="noopener">📎</a>` : ""}</td>
      <td style="padding:8px 6px;white-space:nowrap">${statusBadge}</td></tr>`;
  });
  h += `</tbody></table>${rows.length > 500 ? `<div class="sub" style="text-align:center;margin-top:6px">Showing first 500 of ${rows.length}.</div>` : ""}</div>`;
  return h;
}

/* is this receipt row THIS person's? — uploaded by them, attributed to them, or reimbursed to them (legacy). */
function rcptIsMine(r, meId) { return !!meId && (r.uploadedBy === meId || r.attributedTo === meId || r.paidBy === meId); }
/* CREW view — upload + a scannable list of receipts on file FOR THEM (their uploads + owner-attributed to them),
   so they can eyeball "is this already here?" and not re-upload a duplicate. NO business-wide financials, no
   other people's receipts, no edit/re-bucket/approve controls. */
function rcptCrewView() {
  const me = rcptMe(), meId = me ? me.id : "";
  const mine = rcptAllRows().filter(r => rcptIsMine(r, meId)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const pending = mine.filter(r => r.store === "review").length;
  let h = `<div class="secthd"><h2>📸 Receipts</h2></div>`;
  h += `<div class="card" ondragover="rcptDragOver(event)" ondragleave="rcptDragLeave(event)" ondrop="rcptDrop(event)">
    <div class="sub" style="white-space:normal">Snap or pick your receipts — pile them all in at once. They go to the owner to categorize &amp; file. You don't need to sort them. Check the list below first so you don't re-upload one that's already here.</div>
    <input type="file" id="rcpt_files" accept="image/*,application/pdf,.pdf" multiple style="display:none" onchange="rcptUpload(this)">
    <button class="btn acc" style="width:100%;margin-top:8px" onclick="rcptPickFiles()">📷 Upload receipt photos</button>
    <div id="rcpt_upstatus" class="sub" style="text-align:center;margin-top:6px;color:var(--accent);min-height:16px"></div></div>`;
  h += `<div class="secthd" style="margin-top:14px"><h2>Your receipts on file</h2><span class="ct">${mine.length}${pending ? " · " + pending + " pending" : ""}</span></div>`;
  if (!mine.length) { h += `<div class="card"><div class="muted">None yet. Upload a receipt above — it'll show here once it's on file.</div></div>`; return h; }
  h += `<div class="card" style="padding:4px 4px 6px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr><th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted)">Date</th><th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted)">Vendor</th><th style="text-align:right;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted)">Amount</th><th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted)">Job</th><th style="padding:8px 6px;border-bottom:2px solid var(--line)">📎</th><th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted)">Status</th></tr></thead><tbody>`;
  h += mine.slice(0, 300).map(r => {
    const m = rcptRowMeta(r), d = rcptDate(r);
    const amt = (r.amount == null || r.amount === "") ? `<span style="color:var(--muted)">—</span>` : money(r.amount);
    const statusBadge = m.status === "review" ? `<span class="badge" style="background:var(--accent);color:#fff">pending</span>` : `<span class="badge" style="background:var(--soft);color:var(--muted)">on file</span>`;
    return `<tr style="border-bottom:1px solid var(--line)">
      <td style="padding:8px 6px;white-space:nowrap">${d ? esc(fmtDate(d)) : "—"}</td>
      <td style="padding:8px 6px;white-space:normal">${r.vendor ? esc(r.vendor) : `<span style="color:var(--muted)">—</span>`}${(r.desc || r.note) ? `<div class="sub" style="font-size:11px">${esc(r.desc || r.note)}</div>` : ""}</td>
      <td style="padding:8px 6px;text-align:right;white-space:nowrap">${amt}${r.paidBy === meId ? `<div class="sub" style="font-size:10px">${r.reimbursedAt ? "✓ paid back" : "reimburse"}</div>` : ""}</td>
      <td style="padding:8px 6px;white-space:normal">${m.cust ? esc(m.cust) : (m.jobLabel ? esc(m.jobLabel) : `<span style="color:var(--muted)">—</span>`)}</td>
      <td style="padding:8px 6px">${r.receiptId ? `<a href="${(typeof jsUploadUrl === "function") ? jsUploadUrl(r.receiptId) : ""}" target="_blank" rel="noopener">📎</a>` : ""}</td>
      <td style="padding:8px 6px;white-space:nowrap">${statusBadge}</td></tr>`;
  }).join("");
  h += `</tbody></table></div>`;
  return h;
}

/* delete a receipt from wherever it lives (owner/admin only) */
window.rcptDelRow = function (store, jobId, id) {
  if (!rcptFinFull()) return;
  if (!confirm("Delete this receipt?")) return;
  const d = D();
  if (store === "review") { const e = (d.receipts || []).find(x => x && x.id === id); if (e) { e.deleted = true; if (typeof touch === "function") touch(e); } }
  else if (store === "biz") { const e = (d.expenses || []).find(x => x && x.id === id); if (e) { e.deleted = true; if (typeof touch === "function") touch(e); } }
  else { const j = (d.jobs || []).find(x => x && x.id === jobId); if (j) { const arr = store === "jobmat" ? (j.materials || []) : (j.expenses || []); const e = arr.find(x => x && x.id === id); if (e) { e.deleted = true; if (typeof touch === "function") touch(j); } } }
  if (typeof save === "function") save(); if (typeof closeModal === "function") closeModal(); render();
};
window.rcptSettle = function (memberId) {
  if (!rcptFinFull()) return;
  const owed = (rcptReimbOwed()[memberId] || 0), nm = (typeof userName === "function" ? userName(memberId) : "") || "this person";
  if (!confirm("Mark " + nm + " reimbursed for " + money(owed) + "? Clears their personal-card balance — do this once you've actually paid them back from the business funds.")) return;
  const t = now(), d = D();
  const settle = function (e) { if (e && !e.deleted && e.paidBy === memberId && !e.reimbursedAt) { e.reimbursedAt = t; return true; } return false; };
  (d.jobs || []).forEach(function (j) { if (j && !j.deleted) { let ch = false; (j.expenses || []).forEach(function (e) { if (settle(e)) ch = true; }); (j.materials || []).forEach(function (e) { if (settle(e)) ch = true; }); if (ch && typeof touch === "function") touch(j); } });
  (d.expenses || []).forEach(function (e) { if (settle(e) && typeof touch === "function") touch(e); });
  if (typeof logChange === "function") logChange("update", "expense", memberId, "Reimbursed " + nm + " " + money(owed) + " (personal-card spend settled)");
  if (typeof save === "function") save(); render();
};
