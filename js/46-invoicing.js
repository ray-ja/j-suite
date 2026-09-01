/* ---------- INVOICING (generate a customer invoice from a quote) ----------
   Turns an existing quote into a shareable / printable invoice. Stays OUT of the data layer:
   no new synced collection — it reads the quote + customer, and the only writes are a few small
   fields ON the existing quote record (invoiced / invoiceNo / invoicedDate / paid), which already
   ride the per-record LWW sync. Print = a standalone window; reminder reuses Message Templates. */

/* stable, counter-free invoice number from the quote (date + last 4 of id) */
function invNo(q) {
  if (q.invoiceNo) return q.invoiceNo;
  const ds = (q.date || (typeof today === "function" ? today() : "")).replace(/-/g, "");
  return "INV-" + (ds || "00000000") + "-" + String(q.id || "").slice(-4).toUpperCase();
}
function invItems(q) {
  return (q.items || []).filter(it => it && (it.name || it.serviceId));
}
function invRowsHTML(q) {
  return invItems(q).map(it =>
    `<tr><td>${esc(it.name || "Item")}</td><td style="text-align:center">${it.qty || 1}</td><td style="text-align:right">${money2((it.price || 0) * (it.qty || 1))}</td></tr>`
  ).join("") || `<tr><td colspan="3" style="color:#888">No line items on this quote.</td></tr>`;
}
/* The invoice must charge the FINAL price (finalPrice override), not the raw line-item subtotal — A/R collects
   against quoteEffectiveTotal, so a divergent invoice document meant the customer's bill and what we chased didn't
   match (a set-final-price job would show the old number, then sit "awaiting payment" forever). When the final price
   differs from the line-item subtotal, show a Subtotal + Adjustment pair so the document still reconciles. */
function invEffectiveTotal(q) { return (typeof quoteEffectiveTotal === "function") ? quoteEffectiveTotal(q) : (+(q.finalPrice || q.total) || 0); }
/* ---------- BILL MODE: fixed estimate  vs  reconcile-to-actual (q.billMode) --------------------------------
   Our estimators (paver/drain/stepping-stone) already BUILD materials INTO the quote price (labor + est.
   materials + drive), so an invoice must NEVER add materials on top — that double-counts. Instead every job
   invoices one of two ways, flipped at invoice time:
     • "fixed"  (default) — charge the agreed all-in estimate. Materials already inside; not itemized.
     • "actual"          — reconcile to receipts: charge (labor+drive) + ACTUAL materials, but the estimate is
                           the FLOOR — overages pass through, savings you keep. Shows the breakdown.
   To reconcile without double-counting we need the materials already IN the estimate (estMat): captured by the
   estimator on the item (item.estMat), overridable per-invoice (q.estMat), else the stored line-item cost. */
/* Strip Cap/import annotation cruft from a material description so notes never land on a customer invoice —
   "likely for…", "materials to install for customer", "PO: MIKE", "installation material", "to install on job".
   Preserves the real product name + quantity specs ("0.95 tons", "x6", "(QTY 15)"). Display-only. */
function invCleanMatDesc(desc) {
  let s = String(desc || "").trim();
  s = s.replace(/\s*[—–-]\s*PO:\s*\S+/gi, "");                                  // "— PO: MIKE"
  s = s.replace(/\s*[—–-]?\s*likely for\b[^—–]*/gi, "");                        // "— likely for patio/paver job"
  s = s.replace(/\s*[—–-]?\s*materials to install for customer\b[^—–]*/gi, ""); // Cap's job note
  s = s.replace(/\s*[—–-]\s*install(?:ation)? materials?\b[^—–]*/gi, "");       // "- installation material"
  s = s.replace(/\s+installation materials?\b\s*$/gi, "");
  s = s.replace(/\s+to install\s+(?:on job|for (?:the )?customer|for job)\b[^—–]*/gi, ""); // "to install on job"
  s = s.replace(/\s{2,}/g, " ").replace(/\s*[—–,-]\s*$/, "").trim();            // tidy trailing punctuation
  return s;
}
function invBillMode(q) { return (q && q.billMode === "actual") ? "actual" : "fixed"; }
/* ACTUAL material receipts filed to this quote's job (cleaned). Independent of bill mode. */
function invMaterials(q) {
  if (!q) return [];
  const j = (typeof invJobFor === "function") ? invJobFor(q) : null; if (!j) return [];
  return ((D().jobMaterials) || []).filter(m => m && !m.deleted && m.jobId === j.id)
    .map(m => { const raw = m.desc || m.vendor || "Material"; return { desc: invCleanMatDesc(raw) || raw, amount: Math.round((+m.amount || 0) * 100) / 100 }; })
    .filter(m => m.amount > 0);
}
function invActualMat(q) { return Math.round(invMaterials(q).reduce((s, m) => s + m.amount, 0) * 100) / 100; }
/* materials already baked into the agreed estimate (see header). Manual per-invoice override wins. */
function invEstMat(q) {
  if (q && q.estMat != null) return Math.round((+q.estMat || 0) * 100) / 100;
  const items = (q && q.items) || [];
  if (items.some(it => it && it.estMat != null)) return Math.round(items.reduce((s, it) => s + (+it.estMat || 0), 0) * 100) / 100;
  return Math.round(items.reduce((s, it) => s + (+it.cost || 0), 0) * 100) / 100;
}
/* Reconciliation, estimate-is-the-floor. billed = max(estimate, (labor+drive) + actual materials). */
function invReconcile(q) {
  const est = invEffectiveTotal(q), estMat = invEstMat(q);
  const laborDrive = Math.round((est - estMat) * 100) / 100;
  const actualMat = invActualMat(q);
  const actualTotal = Math.round((laborDrive + actualMat) * 100) / 100;
  const billed = Math.round(Math.max(est, actualTotal) * 100) / 100;
  return { est: est, estMat: estMat, laborDrive: laborDrive, actualMat: actualMat, actualTotal: actualTotal, billed: billed, overage: Math.round((billed - est) * 100) / 100 };
}
/* the invoiced service total — fixed = the estimate; actual = the reconciled (floored) amount. Never adds on top. */
function invGrandTotal(q) { return (invBillMode(q) === "actual") ? invReconcile(q).billed : invEffectiveTotal(q); }
/* line rows: fixed shows the quote items; actual shows one labor line (= grand − actual materials, so the floor
   folds in) + the itemized actual materials. */
function invLineRowsHTML(q) {
  if (invBillMode(q) !== "actual") return invRowsHTML(q);
  const mats = invMaterials(q), labor = Math.round((invGrandTotal(q) - invActualMat(q)) * 100) / 100;
  let h = `<tr><td>Labor &amp; installation</td><td style="text-align:center">1</td><td style="text-align:right">${money2(labor)}</td></tr>`;
  if (mats.length) h += `<tr><td colspan="3" style="padding:10px 0 2px;font-weight:700">Materials (actual, at cost)</td></tr>`
    + mats.map(m => `<tr><td style="padding-left:12px">${esc(m.desc)}</td><td style="text-align:center">1</td><td style="text-align:right">${money2(m.amount)}</td></tr>`).join("");
  return h;
}
window.invToggleBillMode = function (quoteId) {
  const q = (D().quotes || []).find(x => x && x.id === quoteId); if (!q) return;
  q.billMode = (q.billMode === "actual") ? "fixed" : "actual";
  if (typeof touch === "function") touch(q); if (typeof save === "function") save();
  if (q.paymentLink) alert("The amount may have changed — regenerate the pay link before sending.");
  if (typeof openInvoice === "function") { closeModal(); openInvoice(quoteId); } else if (typeof render === "function") render();
};
window.invSetEstMat = function (quoteId, val) {
  const q = (D().quotes || []).find(x => x && x.id === quoteId); if (!q) return;
  const n = parseFloat(val); q.estMat = isNaN(n) ? 0 : Math.round(n * 100) / 100;
  if (typeof touch === "function") touch(q); if (typeof save === "function") save();
  if (typeof openInvoice === "function") { closeModal(); openInvoice(quoteId); }
};
/* the fixed / actual lever + (in actual mode) the reconciliation breakdown with an editable estimate-materials figure */
function invModeControl(q) {
  if (typeof finCanView === "function" && !finCanView()) return "";
  if (invBillMode(q) !== "actual") {
    return `<div class="card" style="margin-top:8px;padding:10px"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><div><b>📋 Fixed price</b><div class="sub" style="white-space:normal">Charging the agreed estimate. Materials already included.</div></div><button class="btn ghost sm" style="flex:0 0 auto" onclick="invToggleBillMode('${q.id}')">Reconcile to actual →</button></div></div>`;
  }
  const r = invReconcile(q), over = r.actualTotal > r.est + 0.005;
  return `<div class="card" style="margin-top:8px;padding:10px;border-left:4px solid var(--accent)">
    <div class="row" style="justify-content:space-between;align-items:center;gap:8px"><div><b>🧾 Reconciled to actual</b><div class="sub" style="white-space:normal">Estimate is the floor — overages pass through.</div></div><button class="btn ghost sm" style="flex:0 0 auto" onclick="invToggleBillMode('${q.id}')">← Back to fixed</button></div>
    <div class="sub" style="display:flex;justify-content:space-between;margin-top:8px"><span>Agreed estimate</span><span>${money2(r.est)}</span></div>
    <div class="sub" style="display:flex;justify-content:space-between;align-items:center"><span>Materials already in the estimate</span><span>$<input type="number" step="0.01" value="${r.estMat}" style="width:78px;text-align:right" onchange="invSetEstMat('${q.id}',this.value)"></span></div>
    <div class="sub" style="display:flex;justify-content:space-between"><span>Actual receipts</span><span>${money2(r.actualMat)}</span></div>
    <div class="row" style="justify-content:space-between;font-weight:700;margin-top:4px;color:${over ? "var(--danger)" : "var(--accent)"}"><span>${over ? "Overage billed" : "Under estimate — billing the floor"}</span><span>${over ? "+" + money2(r.actualMat - r.estMat) : "—"}</span></div></div>`;
}
function invAdjRows(q) {
  const sub = invItems(q).reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);
  const adj = Math.round((invEffectiveTotal(q) - sub) * 100) / 100;
  if (Math.abs(adj) < 0.005) return "";
  return `<tr><td colspan="2" style="text-align:right;padding-top:6px">Subtotal</td><td style="text-align:right;padding-top:6px">${money2(sub)}</td></tr>`
    + `<tr><td colspan="2" style="text-align:right">Adjustment</td><td style="text-align:right">${adj < 0 ? "−" : "+"}${money2(Math.abs(adj))}</td></tr>`;
}
/* the amount the CUSTOMER actually pays = service total + NC sales tax when the quote is taxable */
function invAmountDue(q) { const tax = (typeof quoteSalesTax === "function") ? quoteSalesTax(q) : 0; return Math.round((invGrandTotal(q) + tax) * 100) / 100; }
/* ⭐ pure: partition the awaiting list into render groups. A COMBO = same customer + same combinedAt stamp
   (one Print/Copy stamps its members with one timestamp, so equality IS group identity). Everything else is
   that customer's loose pile; 2+ loose invoices → offer combining, inline and small. Order: customers by
   their oldest debt first (the list's existing instinct), combos before loose within a customer. */
function invAwaitingGroups(awaiting) {
  const byCust = {};
  (awaiting || []).forEach(q => { const k = q.customerId || "?"; (byCust[k] || (byCust[k] = [])).push(q); });
  const out = [];
  Object.keys(byCust).forEach(cid => {
    const qs = byCust[cid];
    const combos = {};
    const loose = [];
    qs.forEach(q => { if (q.combinedAt) (combos[+q.combinedAt] || (combos[+q.combinedAt] = [])).push(q); else loose.push(q); });
    Object.keys(combos).sort().forEach(ts => {
      const rows = combos[ts];
      /* a "combo" of one — its partners got paid off — still shows as the group the customer holds */
      out.push({ kind: "combo", cid: cid, when: new Date(+ts).toISOString().slice(0, 10), rows: rows, oldest: Math.max(...rows.map(q => invAgeDays(q) || 0)) });
    });
    if (loose.length) out.push({ kind: "loose", cid: cid, rows: loose, offerCombine: loose.length > 1, oldest: Math.max(...loose.map(q => invAgeDays(q) || 0)) });
  });
  return out.sort((a, b) => b.oldest - a.oldest);
}
/* ⭐ WHAT'S ACTUALLY LEFT. Ray, 2026-09-01, reading the Awaiting list: the French drain showed \$1,160 in
   red with \$622 already paid on it. invAmountDue is the invoice's face value — right for the document,
   wrong for a list whose whole question is "how much am I still waiting on". Partial payments are normal
   here (Mike pays in \$1,000 chunks across a group), so the list must show the remainder or it overstates
   A/R every time someone pays anything less than everything. */
function invPaidAmt2(q) { return ((q && q.payments) || []).filter(p => p && !p.deleted).reduce((s, p) => s + (+p.amount || 0), 0); }
function invRemaining(q) { return Math.max(0, Math.round((invAmountDue(q) - invPaidAmt2(q)) * 100) / 100); }
/* AUTO-GENERATE a Stripe card-payment link for THIS invoice's exact amount (server-side, using the restricted key
   saved in Settings — the key never touches the client). Saves the URL to q.paymentLink so the invoice shows the
   "Pay online" button. Owner/admin only. */
// low-level: create + save a Stripe link for one quote. Returns {ok, url, error}. No alerts, no render (batch-safe).
async function invMakePayLink(q) {
  if (!q) return { ok: false, error: "no invoice" };
  const amt = invAmountDue(q);
  if (!(amt >= 0.5)) return { ok: false, error: "amount under $0.50" };
  const cust = (typeof custName === "function" && q.customerId) ? custName(q.customerId) : (q.cust || "");
  const job = (typeof quoteType === "function" && quoteType(q)) || q.title || "Services";
  const label = ("OBX Lot Solutions · " + invNo(q) + (cust ? (" · " + cust) : "") + " · " + job).slice(0, 120);
  const base = (S.sync && S.sync.url) || "", tok = (S.sync && S.sync.token) || "";
  if (!base) return { ok: false, error: "sync not set up on this device" };
  const ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
  const kill = ctl ? setTimeout(() => { try { ctl.abort(); } catch (e) {} }, 30000) : null;
  try {
    const r = await fetch(base + "/api/stripe/paylink", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, tok ? { Authorization: "Bearer " + tok } : {}), body: JSON.stringify({ amountCents: Math.round(amt * 100), label: label, quoteId: q.id, org: (typeof S !== "undefined" ? S.biz : "") }), signal: ctl ? ctl.signal : undefined });
    if (kill) clearTimeout(kill);
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.url) {
      q.paymentLink = d.url;
      if (d.id) q.stripeLinkId = d.id;   // the payment-link id → the paid-webhook matches on this to auto-mark the invoice paid
      if (typeof touch === "function") touch(q);
      if (typeof save === "function") save();
      return { ok: true, url: d.url };
    }
    return { ok: false, error: (d && d.error) || ("HTTP " + r.status) };
  } catch (e) {
    if (kill) clearTimeout(kill);
    if (e && e.name === "AbortError") return { ok: false, error: "timed out after 30s — check the connection and try again" };
    return { ok: false, error: (e && e.message) || "offline" };
  }
}
// HOSTED INVOICE LINK — mint (once) an unguessable token, sync it up, and copy the public /i/<token> URL the
// customer opens in any browser to view the invoice + pay. Owner/admin only.
window.invShareLink = async function (quoteId) {
  if (typeof finCanView === "function" && !finCanView()) { alert("Owner / Admin only."); return; }
  const q = (D().quotes || []).find(x => x && x.id === quoteId); if (!q) return;
  if (!q.invoiceToken) {
    let tok = "";
    try { tok = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, "0")).join(""); }
    catch (e) { tok = "inv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }
    q.invoiceToken = tok; if (typeof touch === "function") touch(q); if (typeof save === "function") save();
  }
  const origin = (S.sync && S.sync.url ? String(S.sync.url).replace(/\/+$/, "") : "");
  if (!origin) { alert("Sync isn't set up on this device, so there's no public address to share from."); return; }
  const url = origin + "/i/" + q.invoiceToken;
  const btn = document.getElementById("inv_share_" + quoteId);
  if (btn) { btn.disabled = true; btn.textContent = "Publishing…"; }
  try { if (typeof syncRun === "function") await syncRun("auto"); } catch (e) {}   // push the token so the link is live server-side
  let copied = false;
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(url); copied = true; } } catch (e) {}
  if (btn) { btn.disabled = false; btn.textContent = "🔗 Copy invoice link"; }
  invShareSheet(q, url, copied);
};
/* The share screen (replaced the un-selectable browser alert): preview the page exactly as the customer
   sees it, copy the link, and see the open history. Preview opens carry ?preview so the server never
   counts them as customer reads — and they mark this browser as the owner's for good measure. */
function invShareSheet(q, url, copied) {
  modal("Invoice link — " + invNo(q), `
    <a class="btn acc" style="display:block;text-align:center" href="${esc(url)}?preview=1" target="_blank" rel="noopener">👁 Preview — see exactly what they'll see</a>
    <input readonly value="${esc(url)}" onclick="this.select()" style="width:100%;margin-top:10px;font-size:13px">
    <button class="btn ghost" id="inv_copyurl_${q.id}" style="width:100%;margin-top:8px" onclick="invCopyShareUrl('${q.id}')">${copied ? "✓ Copied — paste it into a text or email" : "🔗 Copy link"}</button>
    <div class="sub" style="margin-top:10px;white-space:normal">Every time the customer opens this page you'll get a ping in Messages (and on your phone). Opens from the preview button — or from any browser you've previewed in — are never counted as customer reads.</div>
    ${invViewsHTML(q.id)}
    <button class="btn ghost sm" style="width:100%;margin-top:12px" onclick="openInvoice('${q.id}')">← Back to invoice</button>
  `);
}
window.invCopyShareUrl = async function (quoteId) {
  const q = (D().quotes || []).find(x => x && x.id === quoteId); if (!q || !q.invoiceToken) return;
  const origin = (S.sync && S.sync.url ? String(S.sync.url).replace(/\/+$/, "") : "");
  const btn = document.getElementById("inv_copyurl_" + quoteId);
  try { await navigator.clipboard.writeText(origin + "/i/" + q.invoiceToken); if (btn) btn.textContent = "✓ Copied — paste it into a text or email"; }
  catch (e) { if (btn) btn.textContent = "Couldn't copy — press-and-hold the link above"; }
};
/* Open history for one invoice — customer reads logged by the server on the hosted page. */
function invViewsOf(quoteId) {
  return (D().invoiceViews || []).filter(v => v && !v.deleted && v.quoteId === quoteId).sort((a, b) => (+b.at || 0) - (+a.at || 0));
}
function invViewTime(t) {
  const d = new Date(+t || 0);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function invViewsHTML(quoteId) {
  if (typeof finCanView === "function" && !finCanView()) return "";
  const vs = invViewsOf(quoteId);
  if (!vs.length) return `<div class="sub" style="margin-top:10px">👁 Not opened by the customer yet.</div>`;
  return `<div style="margin-top:10px"><div class="sub" style="font-weight:700">👁 Opened ${vs.length}× — last ${invViewTime(vs[0].at)}</div>${vs.slice(0, 5).map(v => `<div class="sub">· ${invViewTime(v.at)}</div>`).join("")}${vs.length > 5 ? `<div class="sub">…and ${vs.length - 5} earlier</div>` : ""}</div>`;
}
// single-button flow (alerts + re-render on the result)
window.invGenPayLink = async function (quoteId) {
  if (typeof finCanView === "function" && !finCanView()) { alert("Owner / Admin only."); return; }
  const q = (D().quotes || []).find(x => x && x.id === quoteId); if (!q) return;
  const btn = document.getElementById("inv_genlink_" + quoteId);
  const prevLabel = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Making link…"; }
  const res = await invMakePayLink(q);
  if (res.ok) {
    // The button usually lives inside the invoice modal — render() only repaints the page BEHIND it,
    // so re-open the modal in place to show the fresh link (else the button froze on "Making link…" forever).
    if (document.getElementById("inv_doc") && typeof openInvoice === "function") openInvoice(quoteId);
    else if (btn) { btn.disabled = false; btn.textContent = "✓ Link updated"; }
    if (typeof render === "function") render();
  } else {
    alert("Couldn't create the link: " + res.error + "\n\nCheck that your Stripe key is saved in Settings (Prices + Payment Links = Write).");
    if (btn) { btn.disabled = false; btn.textContent = prevLabel || "⚡ Generate card-payment link"; }
  }
};
// BATCH: generate a Stripe link for every current invoice that doesn't have one yet (Ray: "make Stripe links for
// all current invoices to see them"). Serial (gentle on Stripe), reports a summary. Owner/admin only.
window.invGenPayLinksAll = async function () {
  if (typeof finCanView === "function" && !finCanView()) { alert("Owner / Admin only."); return; }
  const inv = (D().quotes || []).filter(q => q && !q.deleted && q.invoiced && !q.paymentLink && invAmountDue(q) >= 0.5);
  if (!inv.length) { alert("Every current invoice already has a payment link (or there are none needing one)."); return; }
  if (!confirm("Create a Stripe card-payment link for " + inv.length + " invoice" + (inv.length === 1 ? "" : "s") + "?\n\nThese are real Stripe links but nobody's charged until a customer actually pays one.")) return;
  const btn = document.getElementById("inv_genall");
  if (btn) { btn.disabled = true; }
  let done = 0, failed = 0, firstErr = "";
  for (const q of inv) {
    if (btn) btn.textContent = "Making links… " + (done + failed + 1) + "/" + inv.length;
    const res = await invMakePayLink(q);
    if (res.ok) done++; else { failed++; if (!firstErr) firstErr = res.error; }
  }
  if (typeof render === "function") render();
  alert("Done — " + done + " link" + (done === 1 ? "" : "s") + " created" + (failed ? (", " + failed + " failed (" + firstErr + ")") : "") + ".\n\nOpen any invoice and tap “Pay online” to see the Stripe page.");
};
/* cash-discount line — "pay cash/check and save 3%". Presentational; shown on every invoice. */
function invCashNote(q) {
  if (typeof quoteCashPrice !== "function") return "";
  const due = invAmountDue(q), disc = quoteCashDiscount(due), cash = quoteCashPrice(due);
  if (!(disc >= 0.5)) return "";
  return `💵 Paying cash or check? Save ${Math.round((typeof CASH_DISCOUNT_RATE !== "undefined" ? CASH_DISCOUNT_RATE : 0.03) * 100)}% — ${money2(cash)} (you save ${money2(disc)})`;
}
/* invoice tax rows — a "Sales tax (6.75%)" line + a "Total due" line, only when the quote is a taxable service */
function invTaxRows(q, totCls) {
  if (!(typeof quoteTaxable === "function" && quoteTaxable(q))) return "";
  const tax = (typeof quoteSalesTax === "function") ? quoteSalesTax(q) : 0;
  return `<tr><td colspan="2" style="text-align:right">Sales tax (6.75%)</td><td style="text-align:right">${money2(tax)}</td></tr>`
    + `<tr><td colspan="2" style="text-align:right${totCls ? '" class="tot"' : ';font-weight:800;padding-top:8px"'}>Total due</td><td style="text-align:right${totCls ? '" class="tot"' : ';font-weight:800;padding-top:8px"'}>${money2(invAmountDue(q))}</td></tr>`;
}

/* Receipt close-out signal for the owner — informational only, never blocks invoicing. If the job linked to
   this quote has crew who haven't closed out their receipts, more expenses may still land, so the invoice
   total could be off. Reads the per-job close-out helpers from js/72 (guarded). */
function invReceiptsNote(q) {
  try {
    if (typeof jobReceiptsFullyClosed !== "function") return "";
    const j = (D().jobs || []).find(x => x && !x.deleted && (x.quoteId === q.id || x.id === q.jobId));
    if (!j) return "";
    const crew = (typeof jobCrewActiveIds === "function") ? jobCrewActiveIds(j) : [];
    if (!crew.length) return "";
    if (jobReceiptsFullyClosed(j)) return `<div class="note" style="border-left:4px solid var(--accent);background:var(--soft);padding:8px;border-radius:6px;margin-top:8px;white-space:normal">✓ <b>Receipts closed</b> — all crew reported their expenses for this job. Safe to invoice.</div>`;
    const open = (typeof jobReceiptsOpenCrew === "function") ? jobReceiptsOpenCrew(j) : [];
    const names = open.map(id => (typeof userName === "function" ? userName(id) : "") || "?").filter(Boolean).join(", ");
    return `<div class="note" style="border-left:4px solid #e0a800;background:var(--soft);padding:8px;border-radius:6px;margin-top:8px;white-space:normal">⏳ <b>Waiting on ${open.length} crew</b> to close out receipts${names ? " (" + esc(names) + ")" : ""} — more expenses may still come in. You can still invoice now if you want.</div>`;
  } catch (e) { return ""; }
}

window.openInvoice = function (quoteId) {
  const d = D();
  const q = (d.quotes || []).find(x => x.id === quoteId);
  if (!q) { alert("Quote not found."); return; }
  const cust = (d.customers || []).find(x => x.id === q.customerId);
  const biz = BIZ[S.biz] || { name: "", phone: "" };
  const no = invNo(q);
  const status = q.paid ? `<span class="badge s-Won">✓ Paid</span>` : (q.invoiced ? `<span class="badge">Invoiced</span>` : `<span class="badge s-Lead">Draft</span>`);
  const billTo = cust ? [cust.name || cust.company, cust.company && cust.name ? cust.company : "", cust.address, cust.phone, cust.email].filter(Boolean) : ["(no customer linked)"];
  modal("Invoice " + esc(no), `
    <div class="card" id="inv_doc" style="padding:12px">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><div class="nm" style="font-size:17px">${esc(biz.name)}</div><div class="sub">${esc(biz.phone || "")}</div></div>
        <div style="text-align:right"><div class="nm">INVOICE</div><div class="sub">${esc(no)}</div><div class="sub">${esc(fmtDate(q.invoicedDate || q.date || today()))}</div></div>
      </div>
      <div style="margin-top:10px"><div class="sub" style="font-weight:700">Bill to</div>${billTo.map(l => `<div class="sub">${esc(l)}</div>`).join("")}</div>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:14px">
        <thead><tr><th style="text-align:left">Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${invLineRowsHTML(q)}</tbody>
        <tfoot>${invBillMode(q) === "actual" ? "" : invAdjRows(q)}<tr><td colspan="2" style="text-align:right;font-weight:800;padding-top:8px">Total</td><td style="text-align:right;font-weight:800;padding-top:8px">${money2(invGrandTotal(q))}</td></tr>${invTaxRows(q,false)}</tfoot>
      </table>
      ${invModeControl(q)}
      <div class="sub" style="margin-top:8px">Status: ${status} · Due on receipt</div>${q.invoiceToken ? invViewsHTML(q.id) : ""}${invCashNote(q)?`<div class="note" style="margin-top:6px;background:var(--soft);padding:6px 8px;border-radius:6px;white-space:normal">${invCashNote(q)}</div>`:""}
      ${q.paymentLink
        ? `<a class="btn acc" style="display:block;margin-top:8px;text-align:center" href="${esc(q.paymentLink)}" target="_blank" rel="noopener">💳 Pay online — ${money2(invAmountDue(q))}</a>${(typeof finCanView !== "function" || finCanView()) ? `<button class="btn ghost sm" id="inv_genlink_${q.id}" style="display:block;width:100%;margin-top:6px" onclick="invGenPayLink('${q.id}')">↻ Regenerate link (if the amount changed)</button>` : ""}`
        : ((typeof finCanView !== "function" || finCanView())
          ? `<button class="btn acc" id="inv_genlink_${q.id}" style="display:block;width:100%;margin-top:8px" onclick="invGenPayLink('${q.id}')">⚡ Generate card-payment link</button>`
          : `<div class="sub" style="margin-top:8px;white-space:normal">💳 No online-payment link yet.</div>`)}
    </div>${invReceiptsNote(q)}
    ${(typeof finCanView !== "function" || finCanView()) ? `<button class="btn acc" id="inv_share_${q.id}" style="width:100%;margin-top:10px" onclick="invShareLink('${q.id}')">🔗 Invoice link — preview, send &amp; see opens</button>` : ""}
    <div class="row" style="gap:8px;margin-top:8px">
      ${!q.invoiced ? `<button class="btn acc grow" onclick="invMark('${q.id}')">Mark invoiced</button>` : (!q.paid ? `<button class="btn acc grow" onclick="invMarkPaid('${q.id}')">Mark paid</button>` : ``)}
      <button class="btn ghost grow" onclick="invPrint('${q.id}')">🖨️ Print / PDF</button>
    </div>
    <div class="row" style="gap:8px;margin-top:8px">
      <button class="btn ghost sm grow" onclick="invCopy('${q.id}')">Copy</button>
      ${cust ? `<button class="btn ghost sm grow" onclick="closeModal();openMessageComposer('${cust.id}',{total:'${money2(invAmountDue(q))}'})">Send reminder</button>` : ``}
    </div>`);
};

function invText(q, cust, biz, no) {
  const lines = invItems(q).map(it => `  ${it.name}${(it.qty || 1) > 1 ? " ×" + it.qty : ""} — ${money2((it.price || 0) * (it.qty || 1))}`);
  const matLines = invMaterials(q);
  if (matLines.length) { lines.push("", "  Materials (pass-through, at cost):"); matLines.forEach(m => lines.push("    " + m.desc + " — " + money2(m.amount))); }
  return [
    biz.name, biz.phone || "", "",
    "INVOICE " + no, fmtDate(q.invoicedDate || q.date || today()), "",
    "Bill to: " + ((cust && (cust.name || cust.company)) || "—"),
    "", ...lines, "",
    "TOTAL: " + money2(invGrandTotal(q)),
    ...(typeof quoteTaxable==="function"&&quoteTaxable(q) ? ["Sales tax (6.75%): "+money2(quoteSalesTax(q)), "TOTAL DUE: "+money2(invAmountDue(q))] : []),
    ...(invCashNote(q) ? [invCashNote(q)] : []),
    "Due on receipt", "",
    "Thank you for your business!"
  ].join("\n");
}

window.invMark = function (quoteId) {
  const q = (D().quotes || []).find(x => x.id === quoteId); if (!q) return;
  q.invoiced = true;
  if (!q.invoiceNo) q.invoiceNo = invNo(q);
  q.invoicedDate = (typeof today === "function") ? today() : "";
  touch(q);
  if (typeof logChange === "function") logChange("update", "quote", q.id, "Invoiced " + q.invoiceNo + " · " + money2(invEffectiveTotal(q)));
  save(); openInvoice(quoteId);
  var _rj = q.jobId || ((D().jobs || []).find(function (x) { return x && x.quoteId === q.id && !x.deleted; }) || {}).id;
  if (_rj && typeof reviewPrompt === "function") reviewPrompt(_rj);   /* review prompt at the INVOICED moment (moved off job-done per Ray) */
};
window.invMarkPaid = function (quoteId) {
  if (typeof recordPayment === "function") { recordPayment(quoteId); return; }   // proper payment flow (records + syncs income)
  const q = (D().quotes || []).find(x => x.id === quoteId); if (!q) return;
  q.paid = true; q.paidDate = (typeof today === "function") ? today() : "";
  touch(q); if (typeof syncQuoteIncome === "function") syncQuoteIncome(q);
  if (typeof logChange === "function") logChange("update", "quote", q.id, "Marked paid · " + money2(invEffectiveTotal(q)));
  save(); openInvoice(quoteId);
};
window.invCopy = function (quoteId) {
  const d = D(), q = (d.quotes || []).find(x => x.id === quoteId); if (!q) return;
  const cust = (d.customers || []).find(x => x.id === q.customerId), biz = BIZ[S.biz] || {};
  const txt = invText(q, cust, biz, invNo(q));
  const ta = document.createElement("textarea");
  ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); alert("Invoice copied — paste it into a text or email."); }
  catch (e) { alert("Copy failed — use Print / PDF instead."); }
  document.body.removeChild(ta);
};
window.invPrint = function (quoteId) {
  const d = D(), q = (d.quotes || []).find(x => x.id === quoteId); if (!q) return;
  const cust = (d.customers || []).find(x => x.id === q.customerId), biz = BIZ[S.biz] || {};
  const no = invNo(q);
  const billTo = cust ? [cust.name || cust.company, cust.company && cust.name ? cust.company : "", cust.address, cust.phone, cust.email].filter(Boolean) : ["(no customer)"];
  const dateStr = fmtDate(q.invoicedDate || q.date || today());
  const amountDue = money2(invAmountDue(q));
  let logoUrl = ""; try { if (biz.logo) logoUrl = new URL(biz.logo, location.href).href; } catch (e) {}
  const AC = "#0a7d4b";   // OBX green accent
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Invoice ${esc(no)}</title><style>
    *{box-sizing:border-box} html,body{margin:0}
    body{font:14px/1.55 -apple-system,"Segoe UI",Roboto,system-ui,sans-serif;color:#1a1a1a;background:#eef0f3;padding:24px}
    .sheet{max-width:720px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.09);overflow:hidden}
    .bar{height:6px;background:linear-gradient(90deg,${AC},#12b877)}
    .pad{padding:34px 40px}
    .top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap}
    .biz{display:flex;align-items:center;gap:12px}
    .biz img{height:44px;width:auto;border-radius:8px}
    .bizname{font-size:20px;font-weight:800;letter-spacing:-.2px}
    .muted{color:#6b7280;font-size:13px}
    .badge{text-align:right}
    .badge .lbl{font-size:24px;font-weight:800;color:${AC};letter-spacing:2px}
    .billrow{display:flex;justify-content:space-between;gap:24px;margin-top:30px;flex-wrap:wrap}
    .lbl2{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;font-weight:700;margin-bottom:5px}
    .due{font-size:24px;font-weight:800}
    table{width:100%;border-collapse:collapse;margin-top:30px}
    th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;padding:0 0 10px;border-bottom:2px solid #e5e7eb}
    td{padding:13px 0;border-bottom:1px solid #f1f2f4}
    th.n,td.n{text-align:right;font-variant-numeric:tabular-nums} th.c,td.c{text-align:center}
    tfoot td{border-bottom:none;padding:5px 0} tfoot .tot{font-weight:800;font-size:18px;border-top:2px solid #1a1a1a;padding-top:13px}
    .pay{display:block;text-align:center;background:${AC};color:#fff!important;text-decoration:none;font-weight:700;padding:15px;border-radius:10px;margin-top:28px;font-size:15px}
    .payurl{text-align:center;font-size:11px;color:#9ca3af;margin-top:7px;word-break:break-all}
    .cash{margin-top:16px;background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;padding:11px 14px;border-radius:8px;font-weight:600;font-size:13px}
    .paidstamp{display:inline-block;margin-top:6px;border:2px solid ${AC};color:${AC};font-weight:800;letter-spacing:2px;padding:3px 12px;border-radius:6px;transform:rotate(-4deg);font-size:14px}
    .foot{margin-top:26px;color:#6b7280;font-size:13px;text-align:center;border-top:1px solid #f1f2f4;padding-top:18px}
    .printbtn{display:block;margin:22px auto 0;padding:11px 22px;border:1px solid #d1d5db;background:#fff;border-radius:8px;font:inherit;cursor:pointer}
    @media print{body{background:#fff;padding:0}.sheet{box-shadow:none;border-radius:0;max-width:none}.printbtn{display:none}}
    </style></head><body>
    <div class="sheet"><div class="bar"></div><div class="pad">
      <div class="top">
        <div class="biz">${logoUrl ? `<img src="${esc(logoUrl)}" onerror="this.style.display='none'" alt="">` : ""}<div><div class="bizname">${esc(biz.name || "")}</div><div class="muted">${esc(biz.phone || "")}</div></div></div>
        <div class="badge"><div class="lbl">INVOICE</div><div class="muted">${esc(no)}</div><div class="muted">${esc(dateStr)}</div></div>
      </div>
      <div class="billrow">
        <div><div class="lbl2">Bill to</div>${billTo.map(l => `<div${l === billTo[0] ? ' style="font-weight:700;color:#1a1a1a"' : ' class="muted"'}>${esc(l)}</div>`).join("")}</div>
        <div style="text-align:right"><div class="lbl2">${q.paid ? "Amount" : "Amount due"}</div><div class="due">${amountDue}</div>${q.paid ? `<div class="paidstamp">PAID</div>` : `<div class="muted">Due on receipt</div>`}</div>
      </div>
      <table><thead><tr><th>Item</th><th class="c">Qty</th><th class="n">Amount</th></tr></thead>
      <tbody>${invLineRowsHTML(q)}</tbody>
      <tfoot>${invBillMode(q) === "actual" ? "" : invAdjRows(q)}<tr><td colspan="2" class="n tot">Total</td><td class="n tot">${money2(invGrandTotal(q))}</td></tr>${invTaxRows(q, true)}</tfoot></table>
      ${q.paymentLink && !q.paid ? `<a class="pay" href="${esc(q.paymentLink)}" target="_blank" rel="noopener">💳 Pay online — ${amountDue}</a><div class="payurl">${esc(q.paymentLink)}</div>` : ""}
      ${!q.paid && invCashNote(q) ? `<div class="cash">${invCashNote(q)}</div>` : ""}
      <div class="foot">Thank you for your business! &nbsp;·&nbsp; ${esc(biz.name || "")}${biz.phone ? " &nbsp;·&nbsp; " + esc(biz.phone) : ""}</div>
      <button class="printbtn" onclick="window.print()">Print / Save as PDF</button>
    </div></div>
    </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Pop-up blocked — allow pop-ups to print, or use Copy."); return; }
  w.document.open(); w.document.write(html); w.document.close();
};

/* ---------- INVOICES TAB (Money → Invoices) ----------
   One place for the billing pipeline: jobs that are DONE + not yet invoiced surface as "Ready to invoice",
   then "Awaiting payment" (invoiced, unpaid, with A/R + days outstanding), then recently "Paid". Read-only over
   the quotes/jobs collections — a quote IS the invoice (invoiced/paid flags live on it). Owner/admin. */
function invJobFor(q) { const d = D(); return (d.jobs || []).find(x => x && !x.deleted && (x.id === q.jobId || x.quoteId === q.id)) || null; }
function invReadyState(q) { const j = invJobFor(q); return j && j.done ? "done" : (q.accepted || j ? "inprogress" : "quote"); }
function invAgeDays(q) { const dt = q.invoicedDate || q.date; if (!dt) return null; const t = new Date(dt + "T00:00:00"); if (isNaN(t)) return null; return Math.max(0, Math.floor((Date.now() - t) / 86400000)); }
function rInvoices() {
  if (typeof finCanView === "function" && !finCanView()) return `<div class="secthd"><h2>Invoices</h2></div><div class="card"><div class="muted">Owner / Admin only.</div></div>`;
  const d = D();
  const qs = (d.quotes || []).filter(q => q && !q.deleted && (q.accepted || q.invoiced || q.paid || q.jobId));
  const cust = q => esc((q.cust || (q.customerId && typeof custName === "function" ? custName(q.customerId) : "") || "—"));
  const type = q => esc((typeof quoteType === "function" ? quoteType(q) : "") || q.title || "Job");
  const amt = q => money2(invAmountDue(q));
  // buckets, most-actionable first: DONE jobs not invoiced, then other accepted-not-invoiced, then awaiting pay, then paid
  const notBilled = qs.filter(q => !q.invoiced && !q.paid);
  const ready = notBilled.filter(q => invReadyState(q) === "done").sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const inprog = notBilled.filter(q => invReadyState(q) !== "done").sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const awaiting = qs.filter(q => q.invoiced && !q.paid).sort((a, b) => (invAgeDays(b) || 0) - (invAgeDays(a) || 0));
  const paid = qs.filter(q => q.paid).sort((a, b) => String(b.paidDate || b.date || "").localeCompare(String(a.paidDate || a.date || ""))).slice(0, 20);
  const arTotal = awaiting.reduce((s, q) => s + invRemaining(q), 0);   // the REMAINDER — partial payments already netted

  const row = (q, right) => `<div class="li" onclick="openInvoice('${q.id}')" style="cursor:pointer;align-items:flex-start"><div class="grow"><div class="nm">${type(q)} · <span style="font-weight:400">${cust(q)}</span></div><div class="sub">${q.date ? fmtDate(q.date) : ""}${q.invoiceNo ? " · " + esc(q.invoiceNo) : ""}${q.paymentLink ? " · 💳 pay link" : ""}</div></div><div style="text-align:right;flex:0 0 auto">${right}</div></div>`;

  let h = `<div class="secthd"><h2>🧾 Invoices</h2>${arTotal ? `<span class="ct">${money2(arTotal)} owed</span>` : ""}</div>`;

  const needLink = awaiting.filter(q => !q.paymentLink && invAmountDue(q) >= 0.5).length;
  if (needLink) h += `<div class="card" style="border-left:4px solid var(--accent)"><button class="btn acc" id="inv_genall" style="width:100%" onclick="invGenPayLinksAll()">⚡ Generate Stripe pay links for ${needLink} invoice${needLink === 1 ? "" : "s"}</button><div class="sub" style="margin-top:6px;white-space:normal">Makes a card-payment link for each awaiting invoice that doesn't have one yet. Real links — but nobody's charged until a customer actually pays.</div></div>`;

  h += `<div class="secthd" style="margin-top:8px"><h2 style="font-size:15px">✅ Ready to invoice</h2><span class="ct">${ready.length}</span></div>`;
  if (!ready.length) h += `<div class="card"><div class="muted">No completed jobs waiting to be invoiced. A job shows here once it's marked done.</div></div>`;
  else h += `<div class="card">` + ready.map(q => row(q, `<b>${amt(q)}</b><div class="sub"><button class="btn acc sm" style="margin-top:4px" onclick="event.stopPropagation();invMark('${q.id}')">Create invoice</button></div>`)).join("") + `</div>`;

  if (inprog.length) h += `<div class="secthd" style="margin-top:10px"><h2 style="font-size:15px">🛠 In progress</h2><span class="ct">${inprog.length}</span></div><div class="card">` + inprog.map(q => row(q, `<b>${amt(q)}</b><div class="sub">not done yet</div>`)).join("") + `</div>`;

  h += `<div class="secthd" style="margin-top:10px"><h2 style="font-size:15px">📤 Awaiting payment</h2><span class="ct">${money2(arTotal)}</span></div>`;
  if (!awaiting.length) h += `<div class="card"><div class="muted">Nothing outstanding. 🎉</div></div>`;
  else {
    /* ⭐⭐ COMBINED INVOICES READ AS GROUPS, RIGHT IN THE LIST. Ray, 2026-09-01: "imagine multiple customers,
       multiple single and multiple combined invoices — you don't want a big purple button for each. It
       should land on the invoices and the invoice group when applicable." So the global banner is gone;
       a combined set renders as ONE bordered group — header with the combined date, the remaining total,
       and its own View action — with its member invoices inside. Loose invoices stay plain rows, and a
       customer with 2+ loose ones gets a slim combine-offer line under THEIR rows, not a billboard. */
    invAwaitingGroups(awaiting).forEach(g => {
      const inner = g.rows.map(q => { const days = invAgeDays(q); const paid = invPaidAmt2(q);
        return row(q, `<b style="color:var(--danger)">${money2(invRemaining(q))}</b><div class="sub">${paid > 0 ? "paid " + money2(paid) + " of " + money2(invAmountDue(q)) + " · " : ""}${days != null ? days + "d outstanding" : "invoiced"}</div>`); }).join("");
      if (g.kind === "combo") {
        const left = g.rows.reduce((s2, q) => s2 + invRemaining(q), 0);
        h += `<div class="card" style="border-left:4px solid #6b3fa0;padding-top:8px">
          <div class="row" style="gap:8px;align-items:baseline;padding:0 0 4px">
            <div class="grow" style="min-width:0"><div class="nm" style="font-size:13px;color:#a78bda">🧾 Combined invoice · ${esc(cust(g.rows[0]))}</div>
            <div class="sub">sent ${esc(g.when)} · ${g.rows.length} jobs · the customer holds ONE document</div></div>
            <div style="flex:0 0 auto;text-align:right"><b style="font-variant-numeric:tabular-nums">${money2(left)}</b><div class="sub">left on it</div></div>
            <button class="btn ghost sm" style="flex:0 0 auto;width:auto" onclick="invComboOpen('${esc(g.cid)}')">View</button>
          </div>${inner}</div>`;
      } else {
        h += `<div class="card">${inner}` +
          (g.offerCombine ? `<button class="btn ghost sm" style="width:100%;margin-top:6px;color:#a78bda" onclick="invComboOpen('${esc(g.cid)}')">🧾 Combine ${esc(cust(g.rows[0]))}'s ${g.rows.length} invoices into one</button>` : "") + `</div>`;
      }
    });
  }


  if (paid.length) h += `<div class="secthd" style="margin-top:10px"><h2 style="font-size:15px">✓ Paid</h2><span class="ct">${paid.length}</span></div><div class="card">` + paid.map(q => row(q, `<b style="color:var(--accent)">${amt(q)}</b><div class="sub">${q.paidDate ? "paid " + fmtDate(q.paidDate) : "paid"}</div>`)).join("") + `</div>`;

  view.innerHTML = h;   // top-level screen renderer sets #view itself (render() only calls it)
}
window.rInvoices = rInvoices;
