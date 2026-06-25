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
  const per = {}; const add = e => { if (e && !e.deleted && e.paidBy) per[e.paidBy] = (per[e.paidBy]||0) + (+e.amount||0); };
  (D().jobs || []).forEach(j => { if (j && !j.deleted) { (j.expenses||[]).forEach(add); (j.materials||[]).forEach(add); } });
  (D().expenses || []).forEach(add);
  return per;
}
function rcptThumb(id){
  const up = (typeof jsUploadUrl === "function") ? jsUploadUrl(id) : "";
  if (/\.pdf$/i.test(id || "")) return `<a href="${up}" target="_blank" rel="noopener" style="display:flex;width:84px;height:84px;align-items:center;justify-content:center;border-radius:8px;border:1px solid var(--line);background:var(--soft);text-decoration:none;flex:0 0 auto"><div style="text-align:center"><div style="font-size:26px;line-height:1">📄</div><div class="sub" style="font-size:10px">PDF</div></div></a>`;
  return `<a href="${up}" target="_blank" rel="noopener" style="flex:0 0 auto"><img src="${up}" style="width:84px;height:84px;object-fit:cover;border-radius:8px;border:1px solid var(--line)" loading="lazy"></a>`;
}

function rReceipts(){
  if (typeof canSee === "function" && !canSee("receipts")) { view.innerHTML = `<div class="secthd"><h2>Receipts</h2></div><div class="card"><div class="muted">Owner / admin only.</div></div>`; return; }
  const q = rcptQueue(), members = rcptMembers(), jobs = rcptJobs();
  const upUrl = id => (typeof jsUploadUrl === "function") ? jsUploadUrl(id) : "";
  let h = `<div class="secthd"><h2>📸 Receipts</h2></div>`;
  h += `<div class="card" ondragover="rcptDragOver(event)" ondragleave="rcptDragLeave(event)" ondrop="rcptDrop(event)"><div class="sub" style="white-space:normal">Upload a pile of receipt photos — tap the button, or <b>drag &amp; drop</b> them right onto this box — then attribute each below: which job (or a business expense), category, pass-through vs not, and who paid (a person = their personal card → reimburse; blank = business card). Files stage here until you file them.</div>
    <input type="file" id="rcpt_files" accept="image/*,application/pdf,.pdf" multiple style="display:none" onchange="rcptUpload(this)">
    <button class="btn acc" style="width:100%;margin-top:8px" onclick="document.getElementById('rcpt_files').click()">📷 Upload receipt photos</button>
    <div class="sub" style="text-align:center;margin-top:6px;opacity:.65">⬇ or drag photos onto this box (desktop)</div></div>`;
  if (q.length) {
    h += `<div class="secthd" style="margin-top:14px"><h2>To attribute</h2><span class="ct">${q.length}</span></div>`;
    h += q.map(r => {
      const jobOpts = `<option value="">— no job: business expense —</option>` + jobs.map(j => `<option value="${esc(j.id)}">${esc(j.title || "Job")}${j.customerId && typeof custName === "function" ? " · " + esc(custName(j.customerId)) : ""}${j.date ? " · " + fmtDate(j.date) : ""}</option>`).join("");
      const memOpts = `<option value="">— business card (no reimburse) —</option>` + members.map(u => `<option value="${esc(u.id)}">${esc(u.username)} — personal (reimburse)</option>`).join("");
      const catOpts = RCPT_CATS.map(c => `<option${c === "materials" ? " selected" : ""}>${c}</option>`).join("");
      return `<div class="card"><div class="row" style="gap:10px;align-items:flex-start">${rcptThumb(r.id)}
        <div class="grow"><div class="row" style="gap:8px"><input id="ra_${r.id}" type="number" inputmode="decimal" placeholder="$ amount" style="flex:0 0 100px"><input id="rd_${r.id}" placeholder="What — vendor / item (required)" style="flex:2"></div>
        <label style="margin-top:6px">Category</label><select id="rc_${r.id}">${catOpts}</select>
        <label>Job</label><select id="rj_${r.id}" onchange="rcptJobChange('${r.id}')">${jobOpts}</select>
        <label class="toggle" id="rpw_${r.id}" style="margin-top:8px;display:none"><input type="checkbox" id="rp_${r.id}"><span style="margin:0">Pass-through material (billed to the customer at cost)</span></label>
        <label>Who paid?</label><select id="rm_${r.id}">${memOpts}</select></div></div>
        <div class="row" style="gap:8px;margin-top:10px"><button class="btn ghost grow" onclick="rcptDiscard('${r.id}')">Discard</button><button class="btn acc grow" onclick="rcptFile('${r.id}')">✓ File it</button></div></div>`;
    }).join("");
  } else {
    h += `<div class="card"><div class="muted">No receipts staged. Upload a batch above — then attribute each one.</div></div>`;
  }
  const owed = rcptReimbOwed(), oids = Object.keys(owed).filter(id => owed[id] > 0.005);
  if (oids.length) {
    h += `<div class="secthd" style="margin-top:14px"><h2>💸 Reimbursements owed</h2></div><div class="card">` + oids.map(id => `<div class="li"><div class="grow"><div class="nm">${esc((typeof userName === "function" ? userName(id) : "") || "?")}</div><div class="sub">personal-card spend logged on jobs + business</div></div><b>${money(owed[id])}</b></div>`).join("") + `<div class="sub" style="margin-top:6px">Everything logged as paid on a personal card. Settle these from the business funds.</div></div>`;
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
window.rcptFile = function (rid) {
  const amt = parseFloat(val("ra_" + rid)); if (!(amt > 0)) { alert("Enter the amount."); return; }
  const desc = (val("rd_" + rid) || "").trim(); if (!desc) { alert("Enter what it was for."); return; }
  const cat = val("rc_" + rid) || "other", jobId = val("rj_" + rid), paidBy = val("rm_" + rid) || "";
  const pwEl = document.getElementById("rp_" + rid), passthrough = !!(jobId && pwEl && pwEl.checked);
  const by = (typeof curUser === "function" && curUser()) ? curUser().username : "";
  const rec = { id: uid(), amount: amt, desc: desc, category: cat, receiptId: rid, paidBy: paidBy || null, by: by, ts: now() };
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
