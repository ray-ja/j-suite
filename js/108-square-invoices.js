/* ---------- SQUARE INVOICE IMPORT + RECONCILIATION (Money → Finance) ----------
   Ray invoices customers in Square; the paid Square invoice is the SOURCE OF TRUTH for what was actually
   collected (what matters for taxes), not the quotes we drafted. This module imports a Square invoices CSV
   export, matches each invoice to a j-Suite customer + quote(s), and shows a reconciliation review that
   flags mismatches/over-bookings (e.g. two quotes both marked paid when Square shows ONE invoice).

   PHASE 1 (this module) is ADDITIVE + read-only for finance: it creates a synced `invoices` collection and
   proposes matches. It does NOT change income yet — the "apply / book the invoice as income + suppress the
   duplicate quotes" step (invoice-wins) is Phase 2, gated behind Ray's per-case sign-off.

   Collection `invoices` record (dollars, matching quote.total/income.amount convention):
     { id:<Square token>, source:"square", invoiceNo, invoiceDate, serviceDate, dueDate, lastPaymentDate,
       customerName, email, phone, title, status, requested, amountPaid, tip,
       customerId, quoteIds:[], reconciled:false, updatedAt }
   id = the Square Invoice Token (globally unique) so re-importing the same export dedupes, never duplicates. */

function actInvoices() { return (D().invoices || []).filter(x => x && !x.deleted); }
/* $960.00 / "1,234.5" → number (dollars). Blank/garbage → 0. */
function sqMoney(s) { const n = parseFloat(String(s == null ? "" : s).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; }
function sqNorm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, ""); }
function sqPhone10(s) { return String(s == null ? "" : s).replace(/[^0-9]/g, "").slice(-10); }
/* header-name → column index (robust to Square reordering columns). re tested against each trimmed header. */
function sqColIdx(headers, re) { for (let i = 0; i < headers.length; i++) { if (re.test(String(headers[i] || "").trim())) return i; } return -1; }
/* parse the Square export text → array of invoice objects (paid + not; caller filters). Returns [] if not a
   recognizable Square invoices CSV (no Invoice Token / Amount Paid columns). */
function sqInvParse(text) {
  const rows = (typeof budgetParseCSV === "function") ? budgetParseCSV(text) : [];
  if (!rows.length) return [];
  const H = rows[0].map(x => String(x || "").trim());
  const idx = {
    token: sqColIdx(H, /^invoice token$/i), no: sqColIdx(H, /^invoice id$/i), date: sqColIdx(H, /^invoice date$/i),
    cust: sqColIdx(H, /^customer name$/i), email: sqColIdx(H, /^customer email$/i), phone: sqColIdx(H, /^customer phone$/i),
    title: sqColIdx(H, /^invoice title$/i), status: sqColIdx(H, /^status$/i), requested: sqColIdx(H, /^requested amount$/i),
    due: sqColIdx(H, /^due date$/i), lastPay: sqColIdx(H, /^last payment date$/i), paid: sqColIdx(H, /^amount paid$/i),
    tip: sqColIdx(H, /^tip amount$/i), service: sqColIdx(H, /^service date$/i)
  };
  // must at least have a token + amount-paid column to be a Square invoices export
  if (idx.token < 0 || idx.paid < 0) return [];
  const get = (r, i) => (i >= 0 && r[i] != null) ? String(r[i]).trim() : "";
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (!row || !row.length) continue;
    const token = get(row, idx.token); if (!token) continue;
    out.push({
      id: token, source: "square",
      invoiceNo: get(row, idx.no), invoiceDate: get(row, idx.date), serviceDate: get(row, idx.service),
      dueDate: get(row, idx.due), lastPaymentDate: get(row, idx.lastPay),
      customerName: get(row, idx.cust), email: get(row, idx.email), phone: get(row, idx.phone),
      title: get(row, idx.title), status: get(row, idx.status),
      requested: sqMoney(get(row, idx.requested)), amountPaid: sqMoney(get(row, idx.paid)), tip: sqMoney(get(row, idx.tip))
    });
  }
  return out;
}
/* match a Square invoice to a j-Suite customer by name / phone-last-10 / email. Returns the customer or null. */
function sqMatchCustomer(inv) {
  const cs = (typeof actC === "function") ? actC() : [];
  const nm = sqNorm(inv.customerName), ph = sqPhone10(inv.phone), em = sqNorm(inv.email);
  return cs.find(c => c && ((nm && sqNorm(c.name || c.company) === nm) || (ph && ph.length === 10 && sqPhone10(c.phone) === ph) || (em && sqNorm(c.email) === em))) || null;
}
function sqQuoteTotal(q) { return +(q.finalPrice || q.total) || 0; }
/* CUSTOMER-LEVEL reconciliation — over-booking is a per-CUSTOMER fact (their paid quotes vs their paid Square
   invoices), NOT per-invoice: Virginia legitimately has two invoices, each matching one quote. We group invoices
   by matched customer and claim each quote at most once (greedy, largest invoice first), so:
     - per invoice: kind = match (one quote = its amount) / combo (two quotes sum to it) / none / newcust
     - per customer: paid quotes NOT claimed by any invoice = the over-count (the duplicate/mess to clean)
   Returns { rows:[{inv,cust,kind,quoteIds}], cust:{cid:{cust,over,orphans:[q]}}, truth, booked, delta }.
   Read-only — computes off live quotes so it always reflects current data. */
function sqReconcile(list) {
  const EPS = 0.01, byC = {};
  (list || []).forEach(inv => { const c = sqMatchCustomer(inv); const cid = c ? c.id : ("__none_" + inv.id); (byC[cid] = byC[cid] || { cust: c, invs: [], claimed: {}, over: 0, orphans: [] }).invs.push(inv); });
  const rows = []; let truth = 0, booked = 0;
  Object.keys(byC).forEach(cid => {
    const g = byC[cid], cust = g.cust;
    const qs = cust ? ((typeof actQ === "function") ? actQ() : []).filter(q => q && q.customerId === cust.id) : [];
    // biggest invoice first → stable claiming when several quotes could match
    g.invs.slice().sort((a, b) => b.amountPaid - a.amountPaid).forEach(inv => {
      truth += inv.amountPaid;
      let kind = "none", qids = [];
      if (!cust) kind = "newcust";
      else {
        let hit = qs.find(q => !g.claimed[q.id] && Math.abs(sqQuoteTotal(q) - inv.amountPaid) < EPS);
        if (hit) { kind = "match"; qids = [hit.id]; g.claimed[hit.id] = 1; }
        else {
          combo: for (let i = 0; i < qs.length; i++) for (let j = i + 1; j < qs.length; j++) {
            if (!g.claimed[qs[i].id] && !g.claimed[qs[j].id] && Math.abs(sqQuoteTotal(qs[i]) + sqQuoteTotal(qs[j]) - inv.amountPaid) < EPS) { kind = "combo"; qids = [qs[i].id, qs[j].id]; g.claimed[qs[i].id] = 1; g.claimed[qs[j].id] = 1; break combo; }
          }
        }
      }
      rows.push({ inv, cust, kind, quoteIds: qids });
    });
    if (cust) { const paidQs = qs.filter(q => q.paid); g.orphans = paidQs.filter(q => !g.claimed[q.id]); g.over = g.orphans.reduce((a, q) => a + sqQuoteTotal(q), 0); booked += paidQs.reduce((a, q) => a + sqQuoteTotal(q), 0); }
  });
  return { rows: rows, cust: byC, truth: truth, booked: booked, delta: booked - truth };
}
/* ---------- import flow (modal, mirrors the receipts CSV importer; parsed on-device, nothing uploaded) ---------- */
let SQIMP = null;
window.sqInvImportOpen = function () {
  if (typeof finCanView === "function" && !finCanView()) { alert("Owner/admin only."); return; }
  if (typeof modal !== "function") return;
  const n = actInvoices().length;
  modal("Import Square invoices", `
    <p class="muted" style="margin:0 0 10px;white-space:normal">Export your invoices from Square (CSV) and drop the file here — it's parsed on your phone, nothing is uploaded. Re-importing the same export is safe (matched on the Square invoice #, never duplicated).${n ? ` <b>${n}</b> invoice${n === 1 ? "" : "s"} already imported.` : ""}</p>
    <input type="file" id="sqinv_file" accept=".csv,text/csv,text/plain" onchange="sqInvPick(this)" style="width:100%;margin-bottom:10px">
    <details><summary style="cursor:pointer;color:var(--muted);font-size:13px">…or paste the CSV text</summary>
      <textarea id="sqinv_text" rows="6" placeholder="Invoice Token,Invoice Date,...,Amount Paid,..." style="width:100%;font-family:monospace;font-size:12px;margin-top:8px"></textarea>
      <button class="btn ghost sm" style="margin-top:6px" onclick="sqInvParsePasted()">Parse pasted text</button>
    </details>
    ${n ? `<button class="btn ghost" style="width:100%;margin-top:12px" onclick="sqInvReconcileOpen()">📋 View reconciliation (${n})</button>` : ""}`);
};
window.sqInvPick = function (input) { const f = input && input.files && input.files[0]; if (f) sqInvHandleFile(f); if (input) input.value = ""; };
window.sqInvHandleFile = function (file) {
  if (!file) return; const rdr = new FileReader();
  rdr.onload = function () { sqInvStart(String(rdr.result || "")); };
  rdr.onerror = function () { alert("Could not read that CSV file."); };
  try { rdr.readAsText(file); } catch (e) { alert("Could not read that CSV file."); }
};
window.sqInvParsePasted = function () { const t = (typeof val === "function") ? val("sqinv_text") : (document.getElementById("sqinv_text") || {}).value; sqInvStart(String(t || "")); };
function sqInvStart(text) {
  const parsed = sqInvParse(text);
  if (!parsed.length) { alert("That didn't look like a Square invoices CSV (needs an 'Invoice Token' + 'Amount Paid' column)."); return; }
  // PAID-ONLY per Ray's call — unpaid/partial invoices are A/R, added later.
  const paidOnly = parsed.filter(p => /paid/i.test(p.status) && p.amountPaid > 0);
  SQIMP = { all: parsed, list: paidOnly };
  sqInvPreviewStep();
}
/* preview = the reconciliation the import will store: each invoice + its matched customer + proposed quote(s) +
   a status pill, plus the truth-vs-booked totals. */
function sqQName(id) { const q = ((typeof actQ === "function") ? actQ() : []).find(x => x.id === id); return q ? (q.title || (q.items || []).map(i => i.name)[0] || "quote") : id; }
function sqInvReviewRows(list) {
  const R = sqReconcile(list);
  const rows = R.rows.slice().sort((a, b) => String((b.inv.lastPaymentDate || b.inv.invoiceDate || "")).localeCompare(String(a.inv.lastPaymentDate || a.inv.invoiceDate || ""))).map(r => {
    const inv = r.inv;
    const pill = { match: ["✓ matched", "var(--accent)"], combo: ["＋ 2 quotes → 1 invoice", "#2f6fed"], none: ["＋ no matching quote", "#e0a800"], newcust: ["⚠ no customer on file", "#e0a800"] }[r.kind] || ["?", "var(--muted)"];
    const qnames = r.quoteIds.map(sqQName);
    return `<div class="li" style="align-items:flex-start"><div class="grow" style="min-width:0"><div class="nm" style="font-size:14px;white-space:normal">${esc(inv.invoiceNo || "")} · ${esc(inv.customerName || "—")} · <b>${money(inv.amountPaid)}</b></div>
      <div class="sub" style="white-space:normal">${esc(inv.title || "(no title)")} · ${esc(inv.lastPaymentDate || inv.invoiceDate || "")}</div>
      <div class="sub" style="white-space:normal;margin-top:2px"><span class="badge" style="background:${pill[1]};color:#fff">${pill[0]}</span>${qnames.length ? " → " + esc(qnames.join(" + ")) : ""}</div></div></div>`;
  }).join("");
  // per-customer over-booked warnings (paid quotes with no matching invoice — the duplicates to clean)
  let warns = "";
  Object.keys(R.cust).forEach(cid => { const g = R.cust[cid]; if (g.cust && g.over > 0.5 && g.orphans.length) warns += `<div class="card" style="border-left:4px solid #c1121f;background:var(--soft);margin-bottom:8px"><div class="nm" style="font-size:14px;color:#c1121f">⚠ ${esc(g.cust.name || "Customer")} over-booked by ${money(g.over)}</div><div class="sub" style="white-space:normal;margin-top:2px">These paid quotes have no matching Square invoice — likely duplicates: ${esc(g.orphans.map(q => sqQName(q.id) + " (" + money(sqQuoteTotal(q)) + ")").join(", "))}. Cleanup (book the invoice as income, archive the duplicate) is the next step.</div></div>`; });
  const summary = `<div class="card" style="background:var(--soft);margin-bottom:10px"><div class="row" style="justify-content:space-between"><span class="sub">Square collected (truth)</span><b>${money(R.truth)}</b></div><div class="row" style="justify-content:space-between"><span class="sub">j-Suite paid quotes (matched customers)</span><b>${money(R.booked)}</b></div>${R.delta > 0.5 ? `<div class="row" style="justify-content:space-between;color:#c1121f;font-weight:800;margin-top:2px"><span>Over-booked to clean up</span><span>${money(R.delta)}</span></div>` : `<div class="sub" style="color:var(--accent);margin-top:2px">✓ books match Square</div>`}</div>`;
  return summary + warns + rows;
}
function sqInvPreviewStep() {
  if (!SQIMP || typeof modal !== "function") return;
  const list = SQIMP.list;
  modal(`Reconcile ${list.length} paid invoice${list.length === 1 ? "" : "s"}`,
    `<p class="muted" style="margin:0 0 10px;white-space:normal">Paid invoices only. Review the matches, then Import to save them (this stores the invoices + proposed matches — it does <b>not</b> change any income yet).</p>`
    + sqInvReviewRows(list)
    + `<button class="btn acc" style="width:100%;margin-top:12px" onclick="sqInvCommit()">Import ${list.length} invoice${list.length === 1 ? "" : "s"}</button>`);
}
/* upsert the invoices (dedupe on the Square token id), storing the matched customer + proposed quote links.
   reconciled stays false — Phase 2 books income + archives duplicates on Ray's sign-off. */
window.sqInvCommit = function () {
  if (!SQIMP) return;
  if (typeof finCanView === "function" && !finCanView()) { alert("Owner/admin only."); return; }
  const d = D(); d.invoices = d.invoices || [];
  let added = 0, updated = 0;
  const R = sqReconcile(SQIMP.list), byId = {}; R.rows.forEach(r => { byId[r.inv.id] = r; });
  SQIMP.list.forEach(inv => {
    const r = byId[inv.id] || { cust: sqMatchCustomer(inv), quoteIds: [], kind: "none" };
    let rec = d.invoices.find(x => x && x.id === inv.id);
    const fields = { source: "square", invoiceNo: inv.invoiceNo, invoiceDate: inv.invoiceDate, serviceDate: inv.serviceDate, dueDate: inv.dueDate, lastPaymentDate: inv.lastPaymentDate, customerName: inv.customerName, email: inv.email, phone: inv.phone, title: inv.title, status: inv.status, requested: inv.requested, amountPaid: inv.amountPaid, tip: inv.tip, customerId: r.cust ? r.cust.id : "", quoteIds: r.quoteIds, matchKind: r.kind };
    if (rec) { Object.assign(rec, fields); if (rec.reconciled == null) rec.reconciled = false; updated++; }
    else { rec = Object.assign({ id: inv.id, reconciled: false }, fields); d.invoices.push(rec); added++; }
    if (typeof touch === "function") touch(rec);
  });
  if (typeof logChange === "function") logChange("import", "invoices", "square", `Imported ${added} + updated ${updated} Square invoices`);
  if (typeof save === "function") save();
  if (S.sync && S.sync.url && S.sync.token && S.sync.auto && typeof syncNow === "function") syncNow();
  if (typeof closeModal === "function") closeModal();
  if (typeof toast === "function") toast(`Imported ${added} new · ${updated} updated`); else alert(`Imported ${added} new · ${updated} updated invoices.`);
  if (typeof render === "function") render();
};
/* reopen the reconciliation review from the STORED invoices (recomputes matches live so it always reflects the
   current quotes). Phase-1: read-only report. */
window.sqInvReconcileOpen = function () {
  if (typeof finCanView === "function" && !finCanView()) { alert("Owner/admin only."); return; }
  const list = actInvoices().slice().sort((a, b) => String(b.lastPaymentDate || b.invoiceDate || "").localeCompare(String(a.lastPaymentDate || a.invoiceDate || "")));
  if (!list.length) { sqInvImportOpen(); return; }
  if (typeof modal !== "function") return;
  modal(`Square reconciliation (${list.length})`,
    `<p class="muted" style="margin:0 0 10px;white-space:normal">Paid Square invoices matched to your quotes. ⚠ over-booked rows are where j-Suite has more marked paid than Square actually collected — the cleanup (booking the invoice as the income of record + archiving duplicates) is the next step.</p>`
    + sqInvReviewRows(list)
    + `<button class="btn ghost" style="width:100%;margin-top:12px" onclick="sqInvImportOpen()">⬆ Import more / re-import</button>`);
};
/* the entry card shown on the Finance page (owner/admin) — launch import + a live over-booked flag. */
function sqInvFinanceCard() {
  const list = actInvoices();
  let flag = "";
  if (list.length) {
    const R = sqReconcile(list);
    flag = `<div class="sub" style="margin-top:4px;white-space:normal">${list.length} imported · ${R.delta > 0.5 ? `<span style="color:#c1121f;font-weight:700">${money(R.delta)} over-booked to reconcile</span>` : `<span style="color:var(--accent)">books match Square ✓</span>`}</div>`;
  }
  return `<div class="card"><div style="font-weight:800;margin-bottom:4px">🧾 Square invoices <span class="sub" style="font-weight:400">· the paid-invoice source of truth</span></div>
    <div class="sub" style="white-space:normal;margin-bottom:8px">Import your Square invoice export and reconcile it against the quotes — the invoice is what was actually collected.</div>${flag}
    <div class="row" style="gap:8px;margin-top:8px"><button class="btn acc grow" onclick="sqInvImportOpen()">⬆ Import Square invoices</button>${list.length ? `<button class="btn ghost grow" onclick="sqInvReconcileOpen()">📋 Reconcile (${list.length})</button>` : ""}</div></div>`;
}
window.sqInvFinanceCard = sqInvFinanceCard;
