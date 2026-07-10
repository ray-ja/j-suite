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
/* match a Square invoice to a j-Suite customer. A COMMITTED invoice already carries the resolved customerId — use
   it directly (survives a later name change). Otherwise (fresh import) match by name / phone-last-10 / email. */
function sqMatchCustomer(inv) {
  const cs = (typeof actC === "function") ? actC() : [];
  if (inv && inv.customerId) { const byId = cs.find(c => c && c.id === inv.customerId); if (byId) return byId; }
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
/* ========================= PHASE 2 — INVOICE-WINS APPLY (Ray's rule: the Square invoice is the income of record) =========================
   Applying a customer's reconciliation: (1) book EACH of their paid Square invoices as an income record (inc_sq_<token> =
   amountPaid), and (2) stamp reconciledInvoiceId on ALL their paid quotes so syncQuoteIncome TOMBSTONES the quotes' own
   income (js/40) → no double-count. Net taxable income for the customer = what Square actually collected. Orphan paid
   quotes (no matching invoice) are flagged reconciledDuplicate — income suppressed, record kept (non-destructive; Ray can
   archive the quote later). Fully reversible via Undo. FINANCE-CRITICAL — only changes income on this explicit action. */
function sqInvCustReconciled(custId) { const invs = actInvoices().filter(iv => iv.customerId === custId); return invs.length > 0 && invs.every(iv => iv.reconciled); }
window.sqInvApplyCustomer = function (custId) {
  if (typeof finCanView === "function" && !finCanView()) { alert("Owner/admin only."); return; }
  const d = D(); const cust = ((typeof actC === "function") ? actC() : []).find(c => c && c.id === custId); if (!cust) return;
  const invs = actInvoices().filter(iv => iv.customerId === custId); if (!invs.length) { alert("No imported Square invoices for this customer."); return; }
  const R = sqReconcile(invs), claimByQuote = {}; R.rows.forEach(r => (r.quoteIds || []).forEach(qid => { claimByQuote[qid] = r.inv.id; }));
  d.income = d.income || [];
  // (1) book each invoice as the income of record
  invs.forEach(iv => {
    const incId = "inc_sq_" + iv.id;
    const jobs = (iv.quoteIds || []).map(qid => { const q = (d.quotes || []).find(x => x.id === qid); return q && q.jobId ? (d.jobs || []).find(j => j && j.id === q.jobId) : null; }).filter(Boolean);
    const crew = []; jobs.forEach(j => (j.crew || []).forEach(m => { if (crew.indexOf(m) < 0) crew.push(m); }));
    let e = d.income.find(x => x && x.id === incId);
    const fields = { invoiceId: iv.id, fromInvoice: true, source: "square", amount: iv.amountPaid, date: iv.lastPaymentDate || iv.invoiceDate || (typeof today === "function" ? today() : ""), crew: crew, originator: cust.soldBy || "", bookedAt: iv.invoiceDate || "", houseAccount: false, deleted: false };
    if (e) Object.assign(e, fields); else { e = Object.assign({ id: incId }, fields); d.income.push(e); }
    if (typeof touch === "function") touch(e);
    iv.reconciled = true; if (typeof touch === "function") touch(iv);
  });
  // (2) suppress every one of this customer's paid quotes' own income — invoice wins (no double count)
  (d.quotes || []).filter(q => q && !q.deleted && q.customerId === custId && q.paid).forEach(q => {
    q.reconciledInvoiceId = claimByQuote[q.id] || invs[0].id;   // its claiming invoice, or (orphan) the first invoice
    q.reconciledDuplicate = !claimByQuote[q.id];                // orphan paid quote = a duplicate / over-booking
    if (typeof touch === "function") touch(q);
    if (typeof syncQuoteIncome === "function") syncQuoteIncome(q);   // tombstones inc_q_<id>
  });
  if (typeof logChange === "function") logChange("update", "invoices", custId, "Reconciled " + (cust.name || "") + " to Square (" + invs.length + " invoice" + (invs.length > 1 ? "s" : "") + ")");
  if (typeof save === "function") save();
  if (S.sync && S.sync.url && S.sync.token && S.sync.auto && typeof syncNow === "function") syncNow();
  if (typeof render === "function") render();
};
window.sqInvUnapplyCustomer = function (custId) {
  if (typeof finCanView === "function" && !finCanView()) { alert("Owner/admin only."); return; }
  const d = D();
  actInvoices().filter(iv => iv.customerId === custId).forEach(iv => { const e = (d.income || []).find(x => x && x.id === "inc_sq_" + iv.id); if (e && !e.deleted) { e.deleted = true; if (typeof touch === "function") touch(e); } iv.reconciled = false; if (typeof touch === "function") touch(iv); });
  (d.quotes || []).filter(q => q && q.customerId === custId && q.reconciledInvoiceId).forEach(q => { delete q.reconciledInvoiceId; delete q.reconciledDuplicate; if (typeof touch === "function") touch(q); if (typeof syncQuoteIncome === "function") syncQuoteIncome(q); });
  if (typeof logChange === "function") logChange("update", "invoices", custId, "Un-reconciled from Square");
  if (typeof save === "function") save();
  if (S.sync && S.sync.url && S.sync.token && S.sync.auto && typeof syncNow === "function") syncNow();
  if (typeof render === "function") render();
};
/* customer-grouped reconcile view WITH the apply/undo actions (from the stored invoices; recomputes matches live). */
function sqInvReconcileRows() {
  const list = actInvoices(), R = sqReconcile(list), byCust = {};
  R.rows.forEach(r => { const cid = r.cust ? r.cust.id : ("__none_" + r.inv.id); (byCust[cid] = byCust[cid] || { cust: r.cust, rows: [], over: 0, orphans: [] }).rows.push(r); });
  Object.keys(R.cust).forEach(cid => { if (byCust[cid]) { byCust[cid].over = R.cust[cid].over; byCust[cid].orphans = R.cust[cid].orphans; } });
  let truth = 0, unresolved = 0, html = "";
  Object.keys(byCust).sort((a, b) => byCust[b].rows.reduce((s, r) => s + r.inv.amountPaid, 0) - byCust[a].rows.reduce((s, r) => s + r.inv.amountPaid, 0)).forEach(cid => {
    const g = byCust[cid], cust = g.cust, invTotal = g.rows.reduce((a, r) => a + r.inv.amountPaid, 0);
    truth += invTotal;
    const reconciled = cust && sqInvCustReconciled(cust.id);
    if (cust && !reconciled && g.over > 0.5) unresolved += g.over;
    html += `<div class="card" style="margin-bottom:8px${reconciled ? ";border-left:4px solid var(--accent)" : (g.over > 0.5 ? ";border-left:4px solid #c1121f" : "")}">`;
    html += `<div class="row" style="align-items:baseline"><div class="grow nm" style="font-size:15px">${esc(cust ? cust.name : (g.rows[0].inv.customerName || "—"))}</div><b>${money(invTotal)}</b></div>`;
    g.rows.forEach(r => { const inv = r.inv, qn = r.quoteIds.map(sqQName); html += `<div class="sub" style="white-space:normal;margin-top:3px">${esc(inv.invoiceNo || "")} · ${money(inv.amountPaid)} · ${esc(inv.title || "(no title)")}${qn.length ? " → " + esc(qn.join(" + ")) : ` <span style="color:#e0a800">· no matching quote</span>`}</div>`; });
    if (!cust) { html += `<div class="sub" style="color:#e0a800;white-space:normal;margin-top:6px">⚠ No customer on file matches this invoice — add/rename the customer, then re-import.</div>`; }
    else if (reconciled) {
      html += `<div class="sub" style="color:var(--accent);font-weight:700;margin-top:6px">✓ Reconciled — booking ${money(invTotal)} from Square as the income of record</div>`;
      html += `<button class="btn ghost sm" style="margin-top:6px" onclick="sqInvUnapplyCustomer('${cust.id}')">Undo reconcile</button>`;
    } else {
      if (g.over > 0.5) html += `<div class="sub" style="color:#c1121f;white-space:normal;margin-top:6px">⚠ Over-booked ${money(g.over)} — paid quotes with no matching invoice (likely duplicates): ${esc(g.orphans.map(q => sqQName(q.id) + " (" + money(sqQuoteTotal(q)) + ")").join(", "))}</div>`;
      html += `<button class="btn acc sm" style="margin-top:6px;width:100%" onclick="sqInvApplyCustomer('${cust.id}')">✅ Reconcile — book ${money(invTotal)} from Square${g.over > 0.5 ? ", stop the " + money(g.over) + " over-book" : ""}</button>`;
    }
    html += `</div>`;
  });
  const summary = `<div class="card" style="background:var(--soft);margin-bottom:10px"><div class="row" style="justify-content:space-between"><span class="sub">Square collected (truth)</span><b>${money(truth)}</b></div>${unresolved > 0.5 ? `<div class="row" style="justify-content:space-between;color:#c1121f;font-weight:800"><span>Still over-booked (unreconciled)</span><span>${money(unresolved)}</span></div>` : `<div class="sub" style="color:var(--accent)">✓ all reconciled — books match Square</div>`}</div>`;
  return summary + html;
}
/* reopen the reconciliation review from the STORED invoices, WITH the per-customer Apply/Undo actions. */
window.sqInvReconcileOpen = function () {
  if (typeof finCanView === "function" && !finCanView()) { alert("Owner/admin only."); return; }
  if (!actInvoices().length) { sqInvImportOpen(); return; }
  if (typeof modal !== "function") return;
  modal(`Square reconciliation (${actInvoices().length})`,
    `<p class="muted" style="margin:0 0 10px;white-space:normal">Paid Square invoices vs your quotes. <b>Reconcile</b> books the invoice as the income of record and stops the matched quotes from double-counting — so income = what Square actually collected. Reversible.</p>`
    + sqInvReconcileRows()
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
