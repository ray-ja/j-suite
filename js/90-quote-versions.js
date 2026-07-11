/* ---------- QUOTE VERSIONING (change orders) ----------
   Ray's model: a change order is NOT a new record — it's an edit to the SAME quote, logged as a version.
   q.versions[] is an append-only change-event log that rides the quote record's LWW (no new collection).
   Each entry = {v, ts, by, note, prevTotal, newTotal, delta, prevItems, source}. It is REVIEW-ONLY — no
   finance/AR/invoicing/payout code reads versions[], so the money side stays byte-identical. The LIVE quote
   (q.total/q.finalPrice/q.items/q.payments) is always the current truth; versions[] only remembers how it got
   there. One invoice per job reflects the current price (post-invoice edits ADJUST IN PLACE — no new #).

   Snapshots are COMMIT-GATED: a version is recorded only once the quote is committed (accepted/invoiced/paid)
   AND only when the effective total OR the line items actually change — drafts overwrite silently as before. */

/* a quote is "committed" once it's been accepted, invoiced, or paid — before that, edits overwrite silently */
function quoteIsCommitted(q) { return !!(q && (q.accepted || q.invoiced || q.paid)); }
/* the number the money side bills — mirrors js/50 quoteTotalAmt / js/40 syncQuoteIncome / js/52 jobProfit */
function quoteEffectiveTotal(q) { return q ? (+(q.finalPrice || q.total) || 0) : 0; }
/* NC SALES TAX the business COLLECTS. Off by default (most OBX work is capital-improvement paver installs — the
   contractor pays tax on materials, doesn't charge the customer; see the Playbook "Which of our services are
   taxable"). Mark a quote taxable (q.taxable) for RMI services — recurring maintenance/cleanups — and 6.75%
   (Dare/Currituck) rides on the invoice as a SEPARATE line. Collected tax is a LIABILITY held for NCDOR, NOT
   revenue: income/payout stay on the pre-tax service total, and the collected tax is tracked for remittance (js/64). */
const SALES_TAX_RATE = 0.0675;
function quoteTaxable(q) { return !!(q && q.taxable); }
function quoteSalesTax(q) { return quoteTaxable(q) ? Math.round(quoteEffectiveTotal(q) * SALES_TAX_RATE * 100) / 100 : 0; }
function quoteTotalWithTax(q) { return Math.round((quoteEffectiveTotal(q) + quoteSalesTax(q)) * 100) / 100; }
/* CASH DISCOUNT — a card payment costs ~3% in Square/Stripe fees, so a cash/check payment genuinely saves that.
   Shown on the invoice as a cash discount ("save 3% paying cash") off the amount due — cleaner (and safer under
   card-network/NC rules) than surcharging cards. Purely presentational: the recorded amount is still the card price
   unless the owner sets the final price to the cash amount when they collect it. */
const CASH_DISCOUNT_RATE = 0.03;
function quoteCashDiscount(due) { return Math.round((+due || 0) * CASH_DISCOUNT_RATE * 100) / 100; }
function quoteCashPrice(due) { return Math.round(((+due || 0) - quoteCashDiscount(due)) * 100) / 100; }
if (typeof window !== "undefined") { window.SALES_TAX_RATE = SALES_TAX_RATE; window.quoteTaxable = quoteTaxable; window.quoteSalesTax = quoteSalesTax; window.quoteTotalWithTax = quoteTotalWithTax; window.CASH_DISCOUNT_RATE = CASH_DISCOUNT_RATE; window.quoteCashDiscount = quoteCashDiscount; window.quoteCashPrice = quoteCashPrice; }

/* billable-shape equality of two line-item arrays — compares only the fields that affect what's charged, so a
   re-save that reorders internal metadata (but bills the identical lines) is NOT logged as a spurious version. */
function _qvItemsEqual(a, b) {
  a = a || []; b = b || [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] || {}, y = b[i] || {};
    if ((x.name || "") !== (y.name || "")) return false;
    if ((+x.price || 0) !== (+y.price || 0)) return false;
    if ((x.qty || 1) !== (y.qty || 1)) return false;
    if ((+x.cost || 0) !== (+y.cost || 0)) return false;
    if ((x.serviceId || "") !== (y.serviceId || "")) return false;
    if ((x.unit || "") !== (y.unit || "")) return false;
  }
  return true;
}

/* Record a change on a COMMITTED quote. prevTotal + prevItems are captured by the caller BEFORE it applies the
   edit; `q` already carries the applied edit. Returns the pushed version, or null (no-op) when: the quote isn't
   committed yet (drafts overwrite silently), or nothing billable changed (same effective total AND same items).
   NEVER writes q.total/finalPrice/payments — only appends to q.versions[]. */
function snapshotQuoteVersion(q, note, source, prevTotal, prevItems) {
  if (!q || !quoteIsCommitted(q)) return null;   // drafts (pre-commit) overwrite silently, as today
  const newTotal = quoteEffectiveTotal(q);
  const newItems = q.items || [];
  prevItems = prevItems || [];
  const totalSame = ((+prevTotal || 0) === newTotal);
  const itemsSame = _qvItemsEqual(prevItems, newItems);
  if (totalSame && itemsSame) return null;   // only when the effective total OR line items change
  if (!Array.isArray(q.versions)) q.versions = [];
  const who = (typeof tcWho === "function" && tcWho()) ? tcWho().name
    : ((typeof curUser === "function" && curUser()) ? curUser().username : "");
  const v = {
    v: q.versions.length + 1,
    ts: (typeof now === "function") ? now() : Date.now(),
    by: who || "",
    note: note || "",
    prevTotal: +prevTotal || 0,
    newTotal: newTotal,
    delta: Math.round((newTotal - (+prevTotal || 0)) * 100) / 100,
    prevItems: JSON.parse(JSON.stringify(prevItems)),
    source: source || "edit"
  };
  q.versions.push(v);
  return v;
}

/* ---- version-history modal (OWNER / ADMIN review-only; no revert — a correction is another forward edit) ---- */
function quoteVersionsGate() {
  return (typeof isOwner === "function" && isOwner()) || (typeof canDo === "function" && canDo("manage-members"));
}
function _qvMoney(n) { return (typeof money === "function") ? money(n) : ("$" + Math.round(+n || 0)); }
function _qvWhen(ts) { if (!ts) return ""; try { return (typeof relTime === "function") ? relTime(ts) : new Date(ts).toLocaleString(); } catch (e) { return ""; } }
function _qvEsc(s) { return (typeof esc === "function") ? esc(s) : String(s == null ? "" : s); }
/* one line-items block for the expandable diff (the state AS OF that point) */
function _qvItemsHTML(items) {
  items = (items || []).filter(it => it);
  if (!items.length) return `<div class="muted" style="font-size:12px">No line-item snapshot.</div>`;
  return items.map(it => `<div class="sub" style="white-space:normal">• ${_qvEsc(it.name || "line")}${(it.qty > 1) ? " ×" + it.qty : ""} — ${_qvMoney((+it.price || 0) * (it.qty || 1))}</div>`).join("");
}
window.quoteVersionHistory = function (quoteId) {
  if (!quoteVersionsGate()) { alert("Owner/admin only."); return; }
  const q = (typeof actQ === "function") ? actQ().find(x => x && x.id === quoteId) : ((typeof D === "function" && D().quotes) || []).find(x => x && x.id === quoteId);
  if (!q) { alert("Quote not found."); return; }
  const vers = (Array.isArray(q.versions) ? q.versions : []).slice().sort((a, b) => (a.v || 0) - (b.v || 0));
  const who = q.cust || ((q.customerId && typeof custName === "function") ? custName(q.customerId) : "");
  const liveTotal = quoteEffectiveTotal(q);
  let h = `<p class="muted" style="margin-bottom:8px;white-space:normal">How this quote changed over time${who ? ` for <b>${_qvEsc(who)}</b>` : ""} — oldest first. Review-only: the live quote is always the current price; each change order is one forward edit (there's no revert — a correction is just another change).</p>`;
  if (!vers.length) {
    h += `<div class="card"><div class="nm" style="font-size:16px">${_qvMoney(liveTotal)} <span class="sub" style="font-weight:400">· current — no changes recorded yet</span></div></div>`;
    modal("📜 Version history", h);
    return;
  }
  // baseline = the state BEFORE the first recorded change (its prevTotal / prevItems) — "as accepted"
  const first = vers[0];
  h += `<div class="card" style="border-left:4px solid var(--muted)"><div class="nm" style="font-size:15px">v1 · ${_qvMoney(first.prevTotal || 0)} <span class="sub" style="font-weight:400">· as accepted</span></div>
    <details style="margin-top:4px"><summary class="sub" style="cursor:pointer">line items</summary><div style="margin-top:4px">${_qvItemsHTML(first.prevItems)}</div></details></div>`;
  vers.forEach((v, i) => {
    const legacy = v.source === "legacy-change-order";
    const dz = (+v.delta || 0);
    const dCol = legacy ? "var(--muted)" : (dz > 0 ? "var(--accent)" : dz < 0 ? "var(--danger)" : "var(--muted)");
    const dTxt = (dz > 0 ? "+" : "") + _qvMoney(dz);
    const srcLbl = legacy ? "legacy change order — noted, not billed" : (v.source === "final-price" ? "final price adjusted" : "quote edited");
    h += `<div class="card" style="margin-top:8px;border-left:4px solid ${dCol}">
      <div class="row" style="justify-content:space-between;align-items:baseline">
        <div class="nm" style="font-size:15px">v${i + 2} · ${_qvMoney(legacy ? (v.newTotal || 0) : v.newTotal)}</div>
        <div class="nm" style="font-size:15px;color:${dCol}">${dTxt}</div>
      </div>
      <div class="sub" style="white-space:normal;margin-top:2px">${v.note ? _qvEsc(v.note) + " · " : ""}<span class="muted">${srcLbl}</span></div>
      <div class="sub" style="margin-top:2px">${v.by ? _qvEsc(v.by) + " · " : ""}${_qvWhen(v.ts)}</div>
      ${(v.prevItems && v.prevItems.length) ? `<details style="margin-top:4px"><summary class="sub" style="cursor:pointer">what it was before this change</summary><div style="margin-top:4px">${_qvItemsHTML(v.prevItems)}</div></details>` : ""}
    </div>`;
  });
  h += `<div class="card" style="margin-top:8px;border-left:4px solid var(--accent)"><div class="nm" style="font-size:16px">${_qvMoney(liveTotal)} <span class="sub" style="font-weight:400">· current live price</span></div>
    <details style="margin-top:4px"><summary class="sub" style="cursor:pointer">current line items</summary><div style="margin-top:4px">${_qvItemsHTML(q.items)}</div></details></div>`;
  modal("📜 Version history", h);
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { snapshotQuoteVersion: snapshotQuoteVersion, quoteIsCommitted: quoteIsCommitted, quoteEffectiveTotal: quoteEffectiveTotal };
}
