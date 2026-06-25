/* ---------- RECEIPTS — batch upload + attribute (owner/admin) ----------
   Upload a pile of receipt photos, then attribute each WITHOUT logging into anyone's account: which job
   (or "no job — a business expense"), what category, pass-through vs not, and WHO PAID — a person = their
   personal card → reimburse them; blank = the business card (tracked, not reimbursed). Routes each to the
   right ledger: job → job.expenses (or job.materials if pass-through), no job → the business `expenses`
   collection. Photos stage in a device-local queue (jra_rcptq) until filed, so a batch survives a reload. */
const RCPT_CATS = ["materials", "tools/equipment", "disposal", "fuel", "rentals", "subscription/software", "marketing/ads", "uniforms", "office/admin", "other"];
function rcptQueue(){ try { return JSON.parse(localStorage.getItem("jra_rcptq") || "[]"); } catch(e){ return []; } }
function rcptSaveQ(q){ try { localStorage.setItem("jra_rcptq", JSON.stringify(q || [])); } catch(e){} }
function rcptMembers(){ return (typeof schedMembers === "function") ? schedMembers() : []; }
function rcptJobs(){ return ((typeof actJ === "function") ? actJ() : []).filter(j => j && !j.deleted).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))).slice(0,60); }
/* per-member personal-card spend (paidBy set) across job expenses, pass-through materials, and business expenses */
function rcptReimbOwed(){
  const per = {}; const add = e => { if (e && !e.deleted && e.paidBy && !e.reimbursedAt) per[e.paidBy] = (per[e.paidBy]||0) + (+e.amount||0); };
  (D().jobs || []).forEach(j => { if (j && !j.deleted) { (j.expenses||[]).forEach(add); (j.materials||[]).forEach(add); } });
  (D().expenses || []).forEach(add);
  return per;
}
function rcptThumb(id){
  const up = (typeof jsUploadUrl === "function") ? jsUploadUrl(id) : "";
  if (/\.pdf$/i.test(id || "")) return `<a href="${up}" target="_blank" rel="noopener" style="display:flex;width:84px;height:84px;align-items:center;justify-content:center;border-radius:8px;border:1px solid var(--line);background:var(--soft);text-decoration:none;flex:0 0 auto"><div style="text-align:center"><div style="font-size:26px;line-height:1">📄</div><div class="sub" style="font-size:10px">PDF</div></div></a>`;
  return `<a href="${up}" target="_blank" rel="noopener" style="flex:0 0 auto"><img src="${up}" style="width:84px;height:84px;object-fit:cover;border-radius:8px;border:1px solid var(--line)" loading="lazy"></a>`;
}
/* every filed receipt across job expenses, pass-through materials, and business expenses (only those with a receiptId) */
function rcptAllFiled(){
  const out = [];
  (D().jobs || []).forEach(function (j) { if (!j || j.deleted) return;
    (j.expenses || []).forEach(function (e) { if (e && !e.deleted && e.receiptId) out.push(Object.assign({}, e, { store: "jobexp", jobId: j.id, where: (j.title || "job") })); });
    (j.materials || []).forEach(function (e) { if (e && !e.deleted && e.receiptId) out.push(Object.assign({}, e, { store: "jobmat", jobId: j.id, where: (j.title || "job") + " · pass-through" })); });
  });
  (D().expenses || []).forEach(function (e) { if (e && !e.deleted && e.receiptId) out.push(Object.assign({}, e, { store: "biz", jobId: null, where: "business expense" })); });
  return out.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
}
/* a duplicate = same amount + same (normalized) description/vendor */
function rcptDupKey(e){ const v = String(e.vendor || "").trim().toLowerCase(), dsc = String(e.desc || e.note || "").trim().toLowerCase(); return Math.round((+e.amount || 0) * 100) + "|" + (v || dsc).replace(/\s+/g, " "); }
function rcptDupSet(filed){ const cnt = {}, s = {}; (filed || []).forEach(function (e) { const k = rcptDupKey(e); cnt[k] = (cnt[k] || 0) + 1; }); Object.keys(cnt).forEach(function (k) { if (cnt[k] > 1) s[k] = cnt[k]; }); return s; }
/* tax records: standardized DATE-first filename + a CSV export.
   `capRead` (when Cap has read the receipt) provides the real transaction date/vendor; else we use the filed date. */
function rcptDate(e){ const cr = e.capRead || {}; if (cr.date) return String(cr.date).slice(0,10); if (e.date) return String(e.date).slice(0,10); if (e.ts) { try { return new Date(e.ts).toISOString().slice(0,10); } catch(x){} } return "undated"; }
function rcptSan(s, n){ s = String(s || "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); return n ? s.slice(0, n) : s; }
function rcptStdName(e){ const ext = (/\.([A-Za-z0-9]+)$/.exec(e.receiptId || "") || [, "jpg"])[1]; return [rcptDate(e), rcptSan(e.vendor || "vendor", 24), "$" + (+e.amount || 0).toFixed(2), rcptSan(e.desc || e.note || "", 24)].filter(Boolean).join("_") + "." + ext; }
function rcptCsvString(){
  const filed = rcptAllFiled(), base = ((S.sync && S.sync.url) || location.origin).replace(/\/+$/, "");
  const rows = [["Date", "Vendor", "Amount", "What", "Category", "Paid by", "Card", "Reimbursed", "Where", "Standard filename", "Receipt link"]];
  filed.forEach(function (e) { rows.push([ rcptDate(e), e.vendor || "", (+e.amount || 0).toFixed(2), e.desc || e.note || "", e.category || "", e.paidBy ? ((typeof userName === "function" ? userName(e.paidBy) : "") || "") : "", e.paidBy ? "personal" : "business", e.reimbursedAt ? "yes" : (e.paidBy ? "no" : ""), e.where || "", rcptStdName(e), base + "/uploads/" + (e.receiptId || "") ]); });
  return rows.map(function (r) { return r.map(function (c) { c = String(c == null ? "" : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(","); }).join("\r\n");
}
function rcptDownload(name, data, mime){
  try { const blob = new Blob([data], { type: mime }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(a.href); } catch (z) {} }, 120); } catch (x) { alert("Export failed: " + (x.message || x)); }
}
window.rcptExportCSV = function () {
  if (!rcptAllFiled().length) { alert("No filed receipts to export yet."); return; }
  rcptDownload("receipts-" + (typeof today === "function" ? today() : "export") + ".csv", rcptCsvString(), "text/csv");
};
/* hand-rolled minimal ZIP (STORE method — receipts are already-compressed images/PDFs, so no deflate needed; no library, fits the no-build rule) */
function rcptCrc32(u8){ let c = ~0; for (let i = 0; i < u8.length; i++) { c ^= u8[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; }
function rcptZip(files){
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
  const parts = [], central = []; let offset = 0;
  files.forEach(function (f) {
    const name = new TextEncoder().encode(f.name), data = f.data, crc = rcptCrc32(data), sz = data.length;
    const lfh = new Uint8Array([].concat([0x50,0x4b,0x03,0x04], u16(20), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(sz), u32(sz), u16(name.length), u16(0)));
    parts.push(lfh, name, data);
    central.push(new Uint8Array([].concat([0x50,0x4b,0x01,0x02], u16(20), u16(20), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(sz), u32(sz), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
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

function rReceipts(){
  if (typeof canSee === "function" && !canSee("receipts")) { view.innerHTML = `<div class="secthd"><h2>Receipts</h2></div><div class="card"><div class="muted">Owner / admin only.</div></div>`; return; }
  const q = rcptQueue(), members = rcptMembers(), jobs = rcptJobs();
  const filed = rcptAllFiled(), dups = rcptDupSet(filed), dupCount = Object.keys(dups).length;
  const upUrl = id => (typeof jsUploadUrl === "function") ? jsUploadUrl(id) : "";
  let h = `<div class="secthd"><h2>📸 Receipts</h2></div>`;
  h += `<div class="card" ondragover="rcptDragOver(event)" ondragleave="rcptDragLeave(event)" ondrop="rcptDrop(event)"><div class="sub" style="white-space:normal">Upload a pile of receipt photos — tap the button, or <b>drag &amp; drop</b> them right onto this box — then attribute each below: which job (or a business expense), category, pass-through vs not, and who paid (a person = their personal card → reimburse; blank = business card). Files stage here until you file them.</div>
    <input type="file" id="rcpt_files" accept="image/*,application/pdf,.pdf" multiple style="display:none" onchange="rcptUpload(this)">
    <button class="btn acc" style="width:100%;margin-top:8px" onclick="document.getElementById('rcpt_files').click()">📷 Upload receipt photos</button>
    <div class="sub" style="text-align:center;margin-top:6px;opacity:.65">⬇ or drag photos onto this box (desktop)</div></div>`;
  if (dupCount) h += `<div class="card" style="border-left:4px solid var(--danger)"><b>⚠ ${dupCount} possible duplicate${dupCount > 1 ? "s" : ""}</b> — the same amount + description was filed more than once. Flagged in red under Filed receipts below; delete the extras.</div>`;
  if (q.length) {
    h += `<div class="secthd" style="margin-top:14px"><h2>To attribute</h2><span class="ct">${q.length}</span></div>`;
    h += q.map(r => {
      const jobOpts = `<option value="">— no job: business expense —</option>` + jobs.map(j => `<option value="${esc(j.id)}">${esc(j.title || "Job")}${j.customerId && typeof custName === "function" ? " · " + esc(custName(j.customerId)) : ""}${j.date ? " · " + fmtDate(j.date) : ""}</option>`).join("");
      const memOpts = `<option value="">— business card (no reimburse) —</option>` + members.map(u => `<option value="${esc(u.id)}">${esc(u.username)} — personal (reimburse)</option>`).join("");
      const catOpts = RCPT_CATS.map(c => `<option${c === "materials" ? " selected" : ""}>${c}</option>`).join("");
      return `<div class="card"><div class="row" style="gap:10px;align-items:flex-start">${rcptThumb(r.id)}
        <div class="grow"><div class="row" style="gap:8px"><input id="ra_${r.id}" type="number" inputmode="decimal" placeholder="$ amount" style="flex:0 0 90px"><input id="rv_${r.id}" placeholder="Where — vendor / store (required)" style="flex:2"></div>
        <input id="rd_${r.id}" placeholder="What you bought" style="margin-top:6px">
        <label style="margin-top:6px">Category</label><select id="rc_${r.id}">${catOpts}</select>
        <label>Job</label><select id="rj_${r.id}" onchange="rcptJobChange('${r.id}')">${jobOpts}</select>
        <label class="toggle" id="rpw_${r.id}" style="margin-top:8px;display:none"><input type="checkbox" id="rp_${r.id}"><span style="margin:0">Pass-through material (billed to the customer at cost)</span></label>
        <label>Who paid?</label><select id="rm_${r.id}">${memOpts}</select></div></div>
        <div class="row" style="gap:8px;margin-top:10px"><button class="btn ghost grow" onclick="rcptDiscard('${r.id}')">Discard</button><button class="btn acc grow" onclick="rcptFile('${r.id}')">✓ File it</button></div></div>`;
    }).join("");
  } else {
    h += `<div class="card"><div class="muted">No receipts staged. Upload a batch above — then attribute each one.</div></div>`;
  }
  if (filed.length) {
    h += `<div class="secthd" style="margin-top:14px"><h2>Filed receipts</h2><div class="row" style="gap:8px;align-items:center"><span class="ct">${filed.length}</span><button class="btn ghost sm" onclick="rcptExportCSV()">📤 CSV</button><button class="btn ghost sm" onclick="rcptExportZip()">📦 ZIP</button></div></div>`;
    h += filed.slice(0, 60).map(function (e) {
      const isDup = !!dups[rcptDupKey(e)];
      return `<div class="card"${isDup ? ' style="border-left:4px solid var(--danger)"' : ''}><div class="row" style="gap:10px;align-items:flex-start">${rcptThumb(e.receiptId)}<div class="grow"><div class="nm" style="font-size:15px;white-space:normal">${money(e.amount)}${e.vendor ? " <b>" + esc(e.vendor) + "</b>" : ""}${(e.desc || e.note) ? ' <span class="sub" style="font-weight:400">' + esc(e.desc || e.note) + '</span>' : ''}${isDup ? ' <span class="badge" style="background:var(--danger);color:#fff">⚠ possible duplicate</span>' : ''}</div><div class="sub" style="white-space:normal">${esc(e.where)}${e.category ? " · " + esc(e.category) : ""}${e.paidBy ? (e.reimbursedAt ? " · ✓ reimbursed " + esc((typeof userName === "function" ? userName(e.paidBy) : "") || "") : " · reimburse " + esc((typeof userName === "function" ? userName(e.paidBy) : "") || "")) : ""}${e.ts && typeof relTime === "function" ? " · " + relTime(e.ts) : ""}${e.capRead ? (e.capRead.match ? ' · <span style="color:var(--accent)">🤖 Cap ✓' + (e.capRead.date ? " " + esc(e.capRead.date) : "") + '</span>' : ' · <span style="color:var(--danger)">🤖 Cap reads $' + (e.capRead.amount || 0) + (e.capRead.note ? " — " + esc(e.capRead.note) : "") + '</span>') : ''}</div></div><button class="btn ghost sm" onclick="rcptDelFiled('${e.store}','${e.jobId || ""}','${e.id}')">✕</button></div></div>`;
    }).join("");
  }
  const owed = rcptReimbOwed(), oids = Object.keys(owed).filter(id => owed[id] > 0.005);
  if (oids.length) {
    h += `<div class="secthd" style="margin-top:14px"><h2>💸 Reimbursements owed</h2></div><div class="card">` + oids.map(id => `<div class="li"><div class="grow"><div class="nm">${esc((typeof userName === "function" ? userName(id) : "") || "?")}</div><div class="sub">personal-card spend on jobs + business</div></div><div class="row" style="gap:8px;align-items:center"><b>${money(owed[id])}</b><button class="btn ghost sm" onclick="rcptSettle('${id}')">✓ Mark paid back</button></div></div>`).join("") + `<div class="sub" style="margin-top:6px">Everything logged as paid on a personal card. "Mark paid back" settles it (clears the balance) once you've reimbursed them from the business funds.</div></div>`;
  }
  view.innerHTML = h;
}

function rcptIsReceipt(f){ return !!(f && (/^image\//.test(f.type || "") || f.type === "application/pdf" || /\.pdf$/i.test(f.name || ""))); }
function rcptUploadFiles(files) {
  files = (files || []).filter(rcptIsReceipt);
  if (!files.length) return;
  if (typeof jsUpload !== "function") { alert("Upload needs a connection."); return; }
  let pending = files.length;
  const done = () => { if (--pending === 0 && typeof render === "function") render(); };
  files.forEach(f => { jsUpload(f).then(id => { const q = rcptQueue(); q.push({ id: id, ts: now() }); rcptSaveQ(q); done(); }).catch(e => { alert("One upload failed: " + (e.message || e)); done(); }); });
}
window.rcptUpload = function (input) {
  rcptUploadFiles(input && input.files ? Array.prototype.slice.call(input.files) : []);
  if (input) input.value = "";
};
window.rcptDragOver = function (e) { if (e && e.preventDefault) e.preventDefault(); const dz = e && e.currentTarget; if (dz && dz.style) { dz.style.outline = "2px dashed var(--accent)"; dz.style.outlineOffset = "-4px"; } };
window.rcptDragLeave = function (e) { const dz = e && e.currentTarget; if (dz && dz.style) dz.style.outline = ""; };
window.rcptDrop = function (e) {
  if (e && e.preventDefault) e.preventDefault();
  const dz = e && e.currentTarget; if (dz && dz.style) dz.style.outline = "";
  rcptUploadFiles((e && e.dataTransfer && e.dataTransfer.files) ? Array.prototype.slice.call(e.dataTransfer.files) : []);
};
window.rcptJobChange = function (rid) { const j = val("rj_" + rid); const t = document.getElementById("rpw_" + rid); if (t) t.style.display = j ? "flex" : "none"; };
window.rcptDiscard = function (rid) { if (!confirm("Discard this receipt photo? It won't be filed.")) return; rcptSaveQ(rcptQueue().filter(r => r.id !== rid)); render(); };
window.rcptDelFiled = function (store, jobId, id) {
  if (!confirm("Delete this filed receipt/expense?")) return;
  const d = D();
  if (store === "biz") { const e = (d.expenses || []).find(x => x && x.id === id); if (e) { e.deleted = true; if (typeof touch === "function") touch(e); } }
  else { const j = (d.jobs || []).find(x => x && x.id === jobId); if (j) { const arr = store === "jobmat" ? (j.materials || []) : (j.expenses || []); const e = arr.find(x => x && x.id === id); if (e) { e.deleted = true; if (typeof touch === "function") touch(j); } } }
  if (typeof save === "function") save(); render();
};
window.rcptSettle = function (memberId) {
  const owed = (rcptReimbOwed()[memberId] || 0), nm = (typeof userName === "function" ? userName(memberId) : "") || "this person";
  if (!confirm("Mark " + nm + " reimbursed for " + money(owed) + "? Clears their personal-card balance — do this once you've actually paid them back from the business funds.")) return;
  const t = now(), d = D();
  const settle = function (e) { if (e && !e.deleted && e.paidBy === memberId && !e.reimbursedAt) { e.reimbursedAt = t; return true; } return false; };
  (d.jobs || []).forEach(function (j) { if (j && !j.deleted) { let ch = false; (j.expenses || []).forEach(function (e) { if (settle(e)) ch = true; }); (j.materials || []).forEach(function (e) { if (settle(e)) ch = true; }); if (ch && typeof touch === "function") touch(j); } });
  (d.expenses || []).forEach(function (e) { if (settle(e) && typeof touch === "function") touch(e); });
  if (typeof logChange === "function") logChange("update", "expense", memberId, "Reimbursed " + nm + " " + money(owed) + " (personal-card spend settled)");
  if (typeof save === "function") save(); render();
};
window.rcptFile = function (rid) {
  const amt = parseFloat(val("ra_" + rid)); if (!(amt > 0)) { alert("Enter the amount."); return; }
  const vendor = (val("rv_" + rid) || "").trim(); if (!vendor) { alert("Enter where you bought it (vendor / store)."); return; }
  const desc = (val("rd_" + rid) || "").trim();
  const cat = val("rc_" + rid) || "other", jobId = val("rj_" + rid), paidBy = val("rm_" + rid) || "";
  const pwEl = document.getElementById("rp_" + rid), passthrough = !!(jobId && pwEl && pwEl.checked);
  const by = (typeof curUser === "function" && curUser()) ? curUser().username : "";
  const _dupHit = rcptAllFiled().find(function (e) { return rcptDupKey(e) === rcptDupKey({ amount: amt, vendor: vendor, desc: desc }); });
  if (_dupHit && !confirm("⚠ Possible duplicate — a " + money(amt) + " receipt from \"" + vendor + "\" is already filed (" + _dupHit.where + "). File anyway?")) return;
  const rec = { id: uid(), amount: amt, vendor: vendor, desc: desc, category: cat, receiptId: rid, paidBy: paidBy || null, by: by, ts: now() };
  const d = D();
  if (jobId) {
    const j = (D().jobs || []).find(x => x.id === jobId); if (!j) { alert("Job not found."); return; }
    if (passthrough) { if (!Array.isArray(j.materials)) j.materials = []; j.materials.push(rec); }
    else { if (!Array.isArray(j.expenses)) j.expenses = []; j.expenses.push(rec); }
    if (typeof touch === "function") touch(j);
  } else {
    if (!Array.isArray(d.expenses)) d.expenses = [];
    d.expenses.push(Object.assign({}, rec, { date: (typeof today === "function" ? today() : ""), note: desc, memberId: paidBy || "" }));
  }
  if (typeof logChange === "function") logChange("create", "expense", rec.id, "Receipt filed — " + money(amt) + " · " + cat + (jobId ? (passthrough ? " (job pass-through)" : " (job)") : " (business)") + (paidBy ? " · reimburse " + ((typeof userName === "function" ? userName(paidBy) : "") || "") : ""));
  rcptSaveQ(rcptQueue().filter(r => r.id !== rid));
  if (typeof save === "function") save();
  render();
};
