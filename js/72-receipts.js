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
let RCPT_JOBFILTER = "needs";                      // owner close-out roll-up: needs | ready | all
let _rcptBulkBusy = false;                          // Phase B: guard the bulk "file all confident" so a double-tap can't double-file

function rcptColl() { const d = D(); if (!Array.isArray(d.receipts)) d.receipts = []; return d.receipts; }
function rcptReview() { return rcptColl().filter(r => r && !r.deleted && r.status === "review"); }
function rcptMembers() { return (typeof schedMembers === "function") ? schedMembers() : []; }
function rcptJobs() { return ((typeof actJ === "function") ? actJ() : []).filter(j => j && !j.deleted && !Array.isArray(j.sharedJobIds)).sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))); }
function rcptFinFull() { return (typeof finCanView === "function") ? finCanView() : (typeof isOwner === "function" ? isOwner() : true); }   // owner/admin: full financial table + editing
function rcptMe() { return (typeof curUser === "function") ? curUser() : null; }

/* ============================== PER-JOB RECEIPT CLOSE-OUT ==============================
   Each crew member marks a job "closed out" for receipts — "I've submitted all my expenses/receipts for this
   job, I have no more to report." Lives on job.receiptsClosedBy = [{userId,ts}] (additive, rides the job's LWW;
   see js/02 blank()/load()). A job is FULLY closed — safe for the owner to invoice accurately — when every
   assigned, active crew member has closed out. Reversible (a crew member can reopen their own entry). */
function jobReceiptsClosedBy(job) { return (job && Array.isArray(job.receiptsClosedBy)) ? job.receiptsClosedBy.filter(x => x && x.userId) : []; }
function jobReceiptsClosedByMe(job, meId) { return !!meId && jobReceiptsClosedBy(job).some(x => x.userId === meId); }
/* the set of currently-active account ids (real team members) — used to ignore stale/removed crew ids */
function rcptActiveIdSet() { const s = {}; ((typeof schedMembers === "function") ? schedMembers() : []).forEach(u => { if (u && u.id) s[u.id] = 1; }); return s; }
/* a job's ASSIGNED crew, narrowed to still-active accounts (a deactivated member can't block "fully closed") */
function jobCrewActiveIds(job) { const act = rcptActiveIdSet(); return (job && Array.isArray(job.crew) ? job.crew : []).filter(id => id && act[id]); }
/* every active assigned crew member has closed out. Requires ≥1 active crew — a job with nobody assigned is
   NOT "fully closed" (there's no crew whose sign-off we're gating the invoice on), so it never shows a false
   "ready to invoice" signal. */
function jobReceiptsFullyClosed(job) {
  const crew = jobCrewActiveIds(job);
  if (!crew.length) return false;
  const closed = jobReceiptsClosedBy(job).map(x => x.userId);
  return crew.every(id => closed.indexOf(id) >= 0);
}
/* active crew who have NOT yet closed out (the "waiting on…" list) */
function jobReceiptsOpenCrew(job) { const closed = jobReceiptsClosedBy(job).map(x => x.userId); return jobCrewActiveIds(job).filter(id => closed.indexOf(id) < 0); }
/* count of THIS person's receipts on a job (on-job billing arrays + any review upload tagged to the job) */
function rcptMyCountOnJob(job, meId) {
  if (!job || !meId) return 0;
  let n = (job.materials || []).concat(job.expenses || []).filter(e => e && !e.deleted && (e.uploadedBy === meId || e.attributedTo === meId || e.paidBy === meId)).length;
  n += rcptReview().filter(r => r.jobId === job.id && rcptIsMine(r, meId)).length;
  return n;
}
/* jobId → 1 for every real (non-deleted, non-stop) job this person WORKED: on the crew, has a receipt/expense
   attributed to them, or has a timeclock entry on it. Drives the crew close-out queue. */
function rcptMyJobIds(meId) {
  const set = {};
  if (!meId) return set;
  (D().jobs || []).forEach(j => {
    if (!j || j.deleted || Array.isArray(j.sharedJobIds)) return;   // skip stop/overhead sub-jobs (match rcptJobs())
    if ((j.crew || []).indexOf(meId) >= 0) { set[j.id] = 1; return; }
    if ((j.materials || []).concat(j.expenses || []).some(e => e && !e.deleted && (e.uploadedBy === meId || e.attributedTo === meId || e.paidBy === meId))) { set[j.id] = 1; return; }
    if (rcptReview().some(r => r.jobId === j.id && rcptIsMine(r, meId))) set[j.id] = 1;
  });
  (D().timeclock || []).forEach(e => { if (e && !e.deleted && e.userId === meId && e.jobId) set[e.jobId] = 1; });
  return set;
}
function rcptWorkedJobsForMe(meId) {
  const ids = rcptMyJobIds(meId);
  return Object.keys(ids)
    .map(id => (D().jobs || []).find(j => j && j.id === id && !j.deleted && !Array.isArray(j.sharedJobIds)))
    .filter(Boolean)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}
/* CLOSE / REOPEN — scoped to ME only: the handlers never touch anyone else's entry, so a crew member can
   only close/reopen their OWN status (can't sign off for a teammate). Idempotent (dup entries impossible). */
window.jobCloseReceipts = function (jobId) {
  const me = rcptMe(), meId = me ? me.id : ""; if (!meId) return;
  const j = (D().jobs || []).find(x => x && x.id === jobId && !x.deleted); if (!j) return;
  if (!Array.isArray(j.receiptsClosedBy)) j.receiptsClosedBy = [];
  if (j.receiptsClosedBy.some(x => x && x.userId === meId)) return;   // already closed — idempotent no-op
  j.receiptsClosedBy.push({ userId: meId, ts: now() });
  if (typeof touch === "function") touch(j);
  if (typeof logChange === "function") logChange("update", "job", j.id, "Closed out receipts — " + ((typeof userName === "function" ? userName(meId) : "") || "crew") + " has no more expenses for “" + (j.title || "job") + "”");
  if (typeof save === "function") save();
  if (typeof render === "function") render();
};
window.jobReopenReceipts = function (jobId) {
  const me = rcptMe(), meId = me ? me.id : ""; if (!meId) return;
  const j = (D().jobs || []).find(x => x && x.id === jobId && !x.deleted); if (!j) return;
  if (!Array.isArray(j.receiptsClosedBy)) return;
  const before = j.receiptsClosedBy.length;
  j.receiptsClosedBy = j.receiptsClosedBy.filter(x => !(x && x.userId === meId));   // remove ONLY my entry
  if (j.receiptsClosedBy.length === before) return;
  if (typeof touch === "function") touch(j);
  if (typeof logChange === "function") logChange("update", "job", j.id, "Reopened receipts — " + ((typeof userName === "function" ? userName(meId) : "") || "crew") + " has more to add on “" + (j.title || "job") + "”");
  if (typeof save === "function") save();
  if (typeof render === "function") render();
};

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
const RCPT_TYPE_LABEL = { "review": "🕓 Needs review", "business": "🔧 Business / tool", "job-expense": "🚚 Job expense", "pass-through": "🧱 Pass-through" };

/* ---- SPLIT grouping (display only) — flat-value receipt slices share a splitGroup (js/92). Group all live rows
   by splitGroup (falling back to receiptId, then record id, so a non-split receipt is a lone group of 1). A
   group with >1 slice gets a muted sub-line under each row: "part of a $200 <vendor> receipt · 🧱 $120 · 🔧 $80".
   NO math change — each slice is an ordinary record in its own bucket. */
function rcptGroupKey(r) { return r.splitGroup || r.receiptId || ("id:" + (r.recId || r.id)); }
function rcptBucketEmoji(r) { const t = (typeof rcptRowMeta === "function") ? rcptRowMeta(r).type : r.type; return t === "pass-through" ? "🧱" : t === "job-expense" ? "🚚" : t === "business" ? "🔧" : "🕓"; }
function rcptSplitGroupMap() { const map = {}; rcptAllRows().forEach(r => { const k = rcptGroupKey(r); (map[k] || (map[k] = [])).push(r); }); return map; }
function rcptSplitSubline(r, groupMap) {
  if (!r.splitGroup) return "";                       // only genuine splits carry a splitGroup
  const grp = groupMap[rcptGroupKey(r)];
  if (!grp || grp.length < 2) return "";              // sole surviving slice (rest deleted) → not really split anymore
  const total = grp.reduce((s, x) => s + (+x.amount || 0), 0);
  const parts = grp.map(x => rcptBucketEmoji(x) + " " + money2(+x.amount || 0)).join(" · ");
  const vend = (grp.map(x => x.vendor).find(Boolean)) || "";
  return `<div class="sub" style="font-size:11px;white-space:normal;color:var(--muted)">🔀 part of a ${money2(total)}${vend ? " " + esc(vend) : ""} receipt · ${parts}</div>`;
}

/* a duplicate = the SAME vendor transaction. When a receipt carries a refNo (vendor order/trans #, e.g. a CSV import),
   that IS the identity — distinct orders (even same $/day) never collide, an exact re-import is caught. Absent a refNo
   we fall back to exact cents + vendor (+ card last-4 as a disambiguator when present, so two same-$ buys on DIFFERENT
   cards aren't false-flagged). Kept in lock-step with rcptCsvDupKey (js/93) so the table badge agrees with the import. */
function rcptDupKey(e) { e = e || {}; const v = String(e.vendor || "").trim().toLowerCase(); if (e.refNo) return "ref|" + v + "|" + e.refNo; return Math.round((+e.amount || 0) * 100) + "|" + v + (e.cardLast4 ? "|" + e.cardLast4 : ""); }
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
/* a purchase-history CSV (Lowe's / Home Depot export) — NOT a photo; parsed into review records (js/93), never blob-uploaded */
function rcptIsCsvFile(f) { return !!(f && (/\.csv$/i.test(f.name || "") || f.type === "text/csv" || f.type === "application/csv")); }
/* one review record per uploaded photo — blank metadata, "needs review" state, synced */
function rcptNewReview(receiptId) {
  const me = rcptMe();
  // attributedTo = WHOSE receipt it is (who it concerns / gets reimbursed) — distinct from uploadedBy. Defaults
  // to the uploader so a crew member sees their own upload; the owner can re-attribute it when they file it.
  return { id: uid(), receiptId: receiptId, amount: null, vendor: "", date: "", type: null, jobId: null, category: "", paidBy: null, desc: "", uploadedBy: me ? me.id : "", attributedTo: me ? me.id : "", by: me ? (me.username || "") : "", status: "review", suggested: null, ts: now(), deleted: false, updatedAt: now() };
}
let _rcptUpBusy = false;
function rcptSetUpStatus(txt) { const el = document.getElementById("rcpt_upstatus"); if (el) el.textContent = txt || ""; }
/* AUTO Cap-read after ANY upload (no batch-size cap): if an org AI key exists, kick a NON-BLOCKING
   capRcptRun({auto:true}). capRcptRun DRAINS the whole needs-review pile ONE AT A TIME (sequential vision
   calls, throttled) so a 7- or 100-photo drop reads every one — Ray dropped 7 at once and the old ≤4 gate
   silently skipped them. Idempotent (its own busy flag; reads only receipts with no `suggested`) +
   owner/admin-gated inside capRcptRun (crew/auto returns silently). No key or offline → the explicit
   "🤖 Read N" button path is untouched. Never throws. */
function rcptMaybeAutoRead(n) {
  try {
    if (!(n > 0)) return;   // any successful upload kicks the queue — no size cap (the drain reads them one at a time)
    if (typeof ORG_AI_ST === "undefined" || !ORG_AI_ST || !ORG_AI_ST.enabled || !ORG_AI_ST.hasKey) return;   // client sees a key EXISTS (never the key)
    if (typeof capRcptRun !== "function") return;
    if (typeof _capRcptBusy !== "undefined" && _capRcptBusy) return;   // a read is already running — don't double-fire
    capRcptRun({ auto: true });   // fire-and-forget; stamps only rec.suggested, then re-renders itself
  } catch (x) {}
}
function rcptUploadFiles(files) {
  files = (files || []);
  // Branch: a purchase-history CSV isn't a photo — parse it into review records (js/93) instead of blob-uploading
  // it. One CSV at a time; everything else falls through to the normal photo/PDF upload path unchanged.
  const csvs = files.filter(rcptIsCsvFile);
  if (csvs.length && typeof rcptCsvHandle === "function") rcptCsvHandle(csvs[0]);
  files = files.filter(rcptIsReceipt);
  if (!files.length) return;
  if (typeof jsUpload !== "function") { alert("Upload needs a connection."); return; }
  if (_rcptUpBusy) return;   // a batch is already uploading — ignore repeat taps so a slow upload can't double-create (submitGuard-style busy flag)
  _rcptUpBusy = true;
  const total = files.length; let pending = total, ok = 0;
  rcptSetUpStatus("Uploading 0/" + total + "…");
  if (typeof uploadStatus === "function") uploadStatus("uploading", 0, total > 1 ? "(1 of " + total + ")" : "");
  const done = () => { if (--pending <= 0) {
      _rcptUpBusy = false; rcptSetUpStatus("");
      // "✓ safe to close" is tied to the RECORD's sync push, not the blob upload — uploadTrackSync watches it.
      if (ok > 0 && typeof uploadTrackSync === "function") uploadTrackSync(total > 1 ? "(" + ok + " receipt" + (ok > 1 ? "s" : "") + ")" : "");
      else if (typeof uploadStatus === "function") uploadStatus("hide");
      rcptMaybeAutoRead(ok); if (typeof render === "function") render();
    } };
  files.forEach((f, idx) => {
    const note = total > 1 ? "(" + (idx + 1) + " of " + total + ")" : "";
    jsUpload(f, function (pct) { if (typeof uploadStatus === "function") uploadStatus("uploading", pct, note); }).then(id => {
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

/* ============================== PHASE B — ONE-TAP / BULK FILE (spine funnel) ==============================
   Both file EXISTING review rows in place through rcptFileSuggestion (js/98) → rcptApplyEdit → a BYTE-IDENTICAL
   record to a hand save. Explicit human taps = the confirm; nothing auto-files. Owner/admin only. */
/* one row: "✓ Looks right — file it" on a high-confidence review row */
window.rcptFileItRow = function (store, jobId, recId) {
  if (!rcptFinFull()) return;
  if (typeof rcptFileSuggestion !== "function") return;
  const res = rcptFileSuggestion(store, jobId || null, recId);   // non-batch → logs + saves itself
  if (!res || !res.ok) alert("Couldn't file this one automatically — open it to finish by hand." + (res && res.error ? "\n\n" + res.error : ""));
  if (typeof render === "function") render();
};
/* bulk: file every confident review row at once, then ONE save() + render(). Low-confidence rows stay in the
   queue; idempotent (each filed row leaves review, so a re-run skips it). */
window.rcptFileAllConfident = function () {
  if (!rcptFinFull()) return;
  if (typeof rcptFileSuggestion !== "function" || typeof rcptSuggestionOneTapOk !== "function") return;
  if (_rcptBulkBusy) return;
  const rows = rcptReview().filter(rcptSuggestionOneTapOk);
  if (!rows.length) return;
  _rcptBulkBusy = true;
  let filed = 0;
  try {
    rows.forEach(r => { const res = rcptFileSuggestion(r.store || "review", r.jobId, r.id, { batch: true }); if (res && res.ok) filed++; });
    if (filed && typeof logChange === "function") logChange("update", "expense", "bulk", "Filed " + filed + " confident Cap receipt" + (filed === 1 ? "" : "s") + " in one tap (bulk)");
    if (typeof save === "function") save();
  } finally { _rcptBulkBusy = false; }
  if (typeof render === "function") render();
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
    <input type="file" id="rcpt_files" accept="image/*,application/pdf,.pdf,.csv,text/csv" multiple style="display:none" onchange="rcptUpload(this)">
    <button class="btn acc" style="width:100%;margin-top:8px" onclick="rcptPickFiles()">📷 Upload receipt photos</button>
    <input type="file" id="rcpt_csv" accept=".csv,text/csv" style="display:none" onchange="rcptCsvPick(this)">
    <button class="btn ghost" style="width:100%;margin-top:6px" onclick="rcptCsvPickOpen()">📄 Import a purchase CSV (Lowe's / Home Depot…)</button>
    <div id="rcpt_upstatus" class="sub" style="text-align:center;margin-top:6px;color:var(--accent);min-height:16px"></div>
    <div class="sub" style="text-align:center;opacity:.6">⬇ or drag photos onto this box (desktop)</div></div>`;

  if (reviewCount) h += `<div class="card" style="border-left:4px solid var(--accent)"><b>🕓 ${reviewCount} receipt${reviewCount > 1 ? "s" : ""} need${reviewCount > 1 ? "" : "s"} review</b> — untagged uploads. Tap one to set vendor, amount, type &amp; job.</div>`;
  if (typeof capRcptButtonHTML === "function") h += capRcptButtonHTML();   // 🤖 Cap: categorize needs-review (owner/admin only)
  // ✓ FILE ALL N CONFIDENT (Phase B) — every review row Cap is confident about (rcptSuggestionOneTapOk) files in
  // one tap through the SAME spine funnel; low-confidence ones stay in the queue. Owner/admin only.
  if (rcptFinFull() && typeof rcptSuggestionOneTapOk === "function") {
    const confN = rcptReview().filter(rcptSuggestionOneTapOk).length;
    if (confN) h += `<div class="card" style="border-left:4px solid #1e9e5a"><div class="row" style="align-items:center;gap:10px;flex-wrap:wrap">
      <div class="grow" style="white-space:normal"><b>✓ ${confN} confident receipt${confN > 1 ? "s" : ""} ready to file</b><div class="sub">Cap is confident about ${confN > 1 ? "these" : "this one"} (high confidence · real amount · job resolved or business). File ${confN > 1 ? "them all" : "it"} in one tap — anything iffy stays in the queue for you to review.</div></div>
      <button class="btn sm" style="background:#1e9e5a;border-color:#1e9e5a;color:#fff" onclick="rcptFileAllConfident()">✓ File all ${confN} confident</button></div></div>`;
  }
  const suggCount = rows.filter(r => r && r.suggested).length;
  if (suggCount) h += `<div class="card" style="border-left:4px solid #6b3fa0"><b>🤖 ${suggCount} receipt${suggCount > 1 ? "s have" : " has"} Cap suggestions to review</b> — 🤖 rows below. Open one, tap "Use Cap's guess", then Save to confirm.</div>`;
  if (dupCount) h += `<div class="card" style="border-left:4px solid var(--danger)"><b>⚠ ${dupCount} possible duplicate${dupCount > 1 ? "s" : ""}</b> — same amount + description filed more than once. Flagged in the table; open &amp; delete the extras.</div>`;

  // 🏗 RENTAL DEPOSITS AWAITING REFUND (js/96) — held out of job cost until the owner confirms the refund
  if (typeof depositsAwaitingRefund === "function") { const _deps = depositsAwaitingRefund(); if (_deps.length) h += rcptDepositsAwaitingHTML(_deps); }

  // PER-JOB CLOSE-OUT ROLL-UP — when is a job safe to invoice? (all its crew have closed out their receipts)
  h += rcptJobCloseoutHTML();

  // FILTER + EXPORT bar
  h += `<div class="secthd" style="margin-top:14px"><h2>All receipts</h2></div>`;
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
    h += `<div class="secthd" style="margin-top:14px"><h2>💸 Reimbursements owed</h2></div><div class="card">` + oids.map(id => `<div class="li"><div class="grow"><div class="nm">${esc((typeof userName === "function" ? userName(id) : "") || "?")}</div><div class="sub">personal-card spend on jobs + business</div></div><div class="row" style="gap:8px;align-items:center"><b>${money2(owed[id])}</b><button class="btn ghost sm" onclick="rcptSettle('${id}')">✓ Mark paid back</button></div></div>`).join("") + `<div class="sub" style="margin-top:6px">"Mark paid back" clears their balance once you've reimbursed them from business funds.</div></div>`;
  }
  view.innerHTML = h;
}

/* 🏗 RENTAL DEPOSITS AWAITING REFUND (js/96 depositsAwaitingRefund) — each open deposit that's HELD out of job cost
   until its refund is confirmed. Tapping "Settle" opens the js/96 refund-entry modal. Mirrors the dup/close-out cards. */
function rcptDepositsAwaitingHTML(deps) {
  let h = `<div class="card" style="border-left:4px solid #e0a800"><b>🏗 ${deps.length} rental deposit${deps.length > 1 ? "s" : ""} awaiting refund</b> — held out of job cost until you confirm the refund. Settle each once the refund comes back.`;
  h += deps.map(d => {
    const dep = d.deposit, j = d.job;
    const cust = (j && j.customerId && typeof custName === "function") ? custName(j.customerId) : "";
    const where = (j ? (j.title || "Job") : "no job") + (cust ? " · " + cust : "");
    const state = d.hasRefund ? `refund so far ${money2(-d.refundSoFar)} → net ${money2(d.net)}` : "no refund yet";
    return `<div class="li" style="align-items:center;gap:8px;margin-top:6px"><div class="grow" style="min-width:0"><div class="nm" style="white-space:normal">🏗 ${money2(dep.amount)} deposit${dep.vendor ? " · " + esc(dep.vendor) : ""} · ${esc(where)}</div><div class="sub" style="white-space:normal">${state} — tap Settle to enter the refund / mark it settled</div></div><button class="btn acc sm" onclick="if(typeof depositSettleOpen==='function')depositSettleOpen('${esc(dep.id)}')">Settle</button></div>`;
  }).join("");
  h += `</div>`;
  return h;
}

function rcptTableHTML(rows, dups) {
  if (!rows.length) return `<div class="card"><div class="muted">No receipts here. Upload a stack above.</div></div>`;
  const th = (col, label, align) => `<th onclick="rcptSortBy('${col}')" style="text-align:${align || "left"};cursor:pointer;white-space:nowrap;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted);user-select:none">${label}${rcptSortArrow(col)}</th>`;
  let h = `<div class="card" style="padding:4px 4px 6px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr>${th("date", "Date")}${th("vendor", "Vendor")}${th("amount", "Amount", "right")}${th("type", "Type")}${th("category", "Category")}${th("job", "Job / Customer")}${th("uploader", "By")}${th("attributedTo", "For")}<th style="padding:8px 6px;border-bottom:2px solid var(--line)">📎</th>${th("status", "Status")}</tr></thead><tbody>`;
  const splitGroups = rcptSplitGroupMap();
  const canFileIt = rcptFinFull();   // one-tap "file it" is owner/admin only (crew never see this table)
  rows.slice(0, 500).forEach(r => {
    const m = rcptRowMeta(r);
    const isDup = !!(r.amount && dups[rcptDupKey(r)]);
    // Phase B — a REVIEW row Cap is confident about gets a prominent green one-tap "file it" (in addition to the
    // row opening the modal on tap). Files through rcptFileSuggestion → the spine funnel → byte-identical record.
    const oneTap = canFileIt && r.store === "review" && typeof rcptSuggestionOneTapOk === "function" && rcptSuggestionOneTapOk(r);
    const fileItBtn = oneTap ? `<div style="margin-top:5px"><button class="btn sm" style="background:#1e9e5a;border-color:#1e9e5a;color:#fff;white-space:normal" onclick="event.stopPropagation();rcptFileItRow('${r.store}','${r.jobId || ""}','${r.recId}')">✓ Looks right — file it</button></div>` : "";
    const amt = (r.amount == null || r.amount === "") ? `<span style="color:var(--muted)">—</span>` : money2(r.amount);
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
      <td style="padding:8px 6px;white-space:normal">${r.vendor ? esc(r.vendor) : `<span style="color:var(--muted)">—</span>`}${(r.desc || r.note) ? `<div class="sub" style="font-size:11px;white-space:normal">${esc(r.desc || r.note)}</div>` : ""}${rcptSplitSubline(r, splitGroups)}${isDup ? ` <span class="badge" style="background:var(--danger);color:#fff">⚠ dup</span>` : ""}${r.suggested ? ` <span class="badge" style="background:#6b3fa0;color:#fff">🤖 Cap</span>` : ""}${typeof rentalDepositBadge === "function" ? " " + rentalDepositBadge(r) : ""}${typeof cardUnknownBadge === "function" ? cardUnknownBadge(r) : ""}${fileItBtn}</td>
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

/* ============================== OWNER: PER-JOB CLOSE-OUT ROLL-UP ==============================
   Ray scans this to know when a job is safe to invoice accurately. Each active job with assigned crew shows
   N/M crew closed + who's still out ("waiting on Pierce"), or a clear ✓ ready-to-invoice badge when every
   crew member has closed. Filter: needs close-out (the queue) / ready to invoice / all. */
window.rcptSetJobFilter = function (f) { RCPT_JOBFILTER = f; render(); };
function rcptCloseoutJobs() { return rcptJobs().filter(j => jobCrewActiveIds(j).length > 0); }   // only jobs with active assigned crew to gate on
/* current expense total logged against a job = pass-through materials + job expenses (non-deleted).
   Shown in the close-out roll-up so the owner sees "how much is on this job" at a glance before invoicing. */
function jobExpenseTotal(j) {
  if (!j) return 0;
  const held = x => typeof depositHeld === "function" && depositHeld(x);   // HOLD-OUT (js/96): an unsettled deposit group is $0 here until settled at net
  const sum = arr => (Array.isArray(arr) ? arr : []).filter(x => x && !x.deleted && !held(x)).reduce((s, x) => s + (+x.amount || 0), 0);
  return sum(j.materials) + sum(j.expenses);
}
function rcptJobCloseoutHTML() {
  const jobs = rcptCloseoutJobs();
  const ready = jobs.filter(jobReceiptsFullyClosed);
  const needs = jobs.filter(j => !jobReceiptsFullyClosed(j));
  let shown = RCPT_JOBFILTER === "ready" ? ready : RCPT_JOBFILTER === "all" ? jobs : needs;
  let h = `<div class="secthd" style="margin-top:14px"><h2>📋 Job close-out</h2><span class="ct">${ready.length} ready</span></div>`;
  h += `<div class="row" style="gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 6px">
    <button class="btn ${RCPT_JOBFILTER === "needs" ? "acc" : "ghost"} sm" onclick="rcptSetJobFilter('needs')">⏳ Needs close-out ${needs.length}</button>
    <button class="btn ${RCPT_JOBFILTER === "ready" ? "acc" : "ghost"} sm" onclick="rcptSetJobFilter('ready')">✓ Ready to invoice ${ready.length}</button>
    <button class="btn ${RCPT_JOBFILTER === "all" ? "acc" : "ghost"} sm" onclick="rcptSetJobFilter('all')">All ${jobs.length}</button></div>`;
  if (!jobs.length) return h + `<div class="card"><div class="muted">No active jobs with assigned crew yet. Once a job has crew, its receipt close-out status shows here.</div></div>`;
  if (!shown.length) return h + `<div class="card"><div class="muted">${RCPT_JOBFILTER === "ready" ? "No jobs are fully closed out yet — waiting on crew." : RCPT_JOBFILTER === "needs" ? "✓ Every job with crew is closed out — all clear to invoice." : "Nothing here."}</div></div>`;
  h += `<div class="card">`;
  shown.forEach(j => {
    const crew = jobCrewActiveIds(j), open = jobReceiptsOpenCrew(j), closedN = crew.length - open.length;
    const cust = (j.customerId && typeof custName === "function") ? custName(j.customerId) : "";
    const full = jobReceiptsFullyClosed(j);
    const badge = full
      ? `<span class="badge" style="background:var(--accent);color:#fff">✓ Receipts closed — ready to invoice</span>`
      : `<span class="badge" style="background:#e0a800;color:#fff">${closedN}/${crew.length} crew closed</span>`;
    const waiting = open.map(id => (typeof userName === "function" ? userName(id) : "") || "?").filter(Boolean).join(", ");
    const expTot = jobExpenseTotal(j);   // pass-through materials + job expenses logged so far
    // whole row taps through to the job's expense page (js/61 openJobPage → the materials/expenses section)
    h += `<div class="li" onclick="if(typeof openJobPage==='function')openJobPage('${esc(j.id)}')" style="cursor:pointer;align-items:flex-start;flex-wrap:wrap;gap:6px${full ? "" : ";border-left:3px solid #e0a800;padding-left:8px"}">
      <div class="grow" style="min-width:160px"><div class="nm">${esc(j.title || "Job")} <span class="sub" style="color:var(--muted)">›</span></div><div class="sub">${cust ? esc(cust) + " · " : ""}${j.date ? esc(fmtDate(j.date)) : "no date"} · <b>${money2(expTot)}</b> expenses${!full && waiting ? ` · <span style="color:#b8860b">waiting on ${esc(waiting)}</span>` : ""}</div></div>
      <div style="flex:0 0 auto">${badge}</div></div>`;
  });
  h += `</div>`;
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
    <input type="file" id="rcpt_files" accept="image/*,application/pdf,.pdf,.csv,text/csv" multiple style="display:none" onchange="rcptUpload(this)">
    <button class="btn acc" style="width:100%;margin-top:8px" onclick="rcptPickFiles()">📷 Upload receipt photos</button>
    <div id="rcpt_upstatus" class="sub" style="text-align:center;margin-top:6px;color:var(--accent);min-height:16px"></div></div>`;

  // JOBS TO CLOSE OUT — the crew's clear "am I done?" list. Every job they worked (on the crew / have a
  // receipt on / clocked in) that they haven't yet marked done. Closing tells the owner no more expenses are
  // coming from them, so he can invoice accurately. Reversible.
  const worked = rcptWorkedJobsForMe(meId);
  const toClose = worked.filter(j => !jobReceiptsClosedByMe(j, meId));
  const doneJobs = worked.filter(j => jobReceiptsClosedByMe(j, meId));
  h += `<div class="secthd" style="margin-top:14px"><h2>📋 Jobs to close out</h2><span class="ct">${toClose.length}</span></div>`;
  if (!worked.length) {
    h += `<div class="card"><div class="muted">No jobs to close out yet — once you're on a job (or upload a receipt for one), it'll show here so you can mark when you're done adding expenses.</div></div>`;
  } else {
    h += `<div class="card"><div class="sub" style="white-space:normal;margin-bottom:8px">Once you've uploaded <b>all</b> your receipts &amp; expenses for a job and organized them, tap <b>Done</b>. That tells the owner no more expenses are coming from you, so he can invoice it accurately. Remembered one? Reopen it.</div>`;
    if (!toClose.length) h += `<div class="sub" style="color:var(--accent);margin-bottom:6px">✓ You're all caught up — every job you worked is closed out.</div>`;
    toClose.forEach(j => {
      const cust = (j.customerId && typeof custName === "function") ? custName(j.customerId) : "";
      const cnt = rcptMyCountOnJob(j, meId);
      h += `<div class="li" style="align-items:flex-start;flex-wrap:wrap;gap:8px">
        <div class="grow" style="min-width:150px"><div class="nm">${esc(j.title || "Job")}</div><div class="sub">${cust ? esc(cust) + " · " : ""}${j.date ? esc(fmtDate(j.date)) : "no date"} · ${cnt} of your receipt${cnt === 1 ? "" : "s"}</div></div>
        <button class="btn acc" style="flex:0 0 auto" onclick="jobCloseReceipts('${j.id}')">✓ Done — no more receipts for this job</button></div>`;
    });
    doneJobs.forEach(j => {
      const cust = (j.customerId && typeof custName === "function") ? custName(j.customerId) : "";
      h += `<div class="li" style="align-items:center;flex-wrap:wrap;gap:8px;opacity:.75">
        <div class="grow" style="min-width:150px"><div class="nm">${esc(j.title || "Job")} <span class="badge" style="background:var(--accent);color:#fff">✓ Closed</span></div><div class="sub">${cust ? esc(cust) + " · " : ""}${j.date ? esc(fmtDate(j.date)) : "no date"}</div></div>
        <button class="btn ghost sm" style="flex:0 0 auto" onclick="jobReopenReceipts('${j.id}')">Reopen</button></div>`;
    });
    h += `</div>`;
  }

  h += `<div class="secthd" style="margin-top:14px"><h2>Your receipts on file</h2><span class="ct">${mine.length}${pending ? " · " + pending + " pending" : ""}</span></div>`;
  if (!mine.length) { h += `<div class="card"><div class="muted">None yet. Upload a receipt above — it'll show here once it's on file.</div></div>`; return h; }
  h += `<div class="card" style="padding:4px 4px 6px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr><th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted)">Date</th><th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted)">Vendor</th><th style="text-align:right;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted)">Amount</th><th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted)">Job</th><th style="padding:8px 6px;border-bottom:2px solid var(--line)">📎</th><th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted)">Status</th></tr></thead><tbody>`;
  h += mine.slice(0, 300).map(r => {
    const m = rcptRowMeta(r), d = rcptDate(r);
    const amt = (r.amount == null || r.amount === "") ? `<span style="color:var(--muted)">—</span>` : money2(r.amount);
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
