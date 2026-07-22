/* ---------- INSTALLMENT PAYBACKS (js/116) --------------------------------------------------------------
   Track paying a partner back for a large up-front purchase over N monthly installments — e.g. Chase fronted
   the $10,541.74 dump trailer; pay him back ~$439.24/mo × 24. This is a standalone SCHEDULE TRACKER: it holds
   the debt + which payments are made, so anyone can see "how much is still owed and when the next one's due."
   It deliberately does NOT post to the P&L / 1099 — a payback repays money a partner fronted, it is not income
   or compensation to them, and the purchase is a capital asset, not this month's expense. Owner/admin only.
   New synced collection `installments` (wired into blank()/load()/server COLLECTIONS). Record:
   {id"inst_", payeeId, payeeName, label, total, count, start"YYYY-MM", paidNs:[], note, createdBy, createdAt,
    deleted, updatedAt}. per-payment = round(total/count); the LAST payment absorbs the rounding remainder so
    the sum is exactly `total`. */
function instColl() { const d = (typeof D === "function") ? D() : null; if (d && !Array.isArray(d.installments)) d.installments = []; return d ? d.installments : []; }
function instActive() { return instColl().filter(p => p && !p.deleted); }
function instPer(p) { return Math.round((+p.total || 0) / (p.count || 1) * 100) / 100; }
function instPaymentAmt(p, n) { return (n >= (p.count || 1)) ? Math.round(((+p.total || 0) - instPer(p) * ((p.count || 1) - 1)) * 100) / 100 : instPer(p); }
function instPaidCount(p) { return (p.paidNs || []).length; }
function instPaidAmt(p) { return Math.round((p.paidNs || []).reduce((s, n) => s + instPaymentAmt(p, n), 0) * 100) / 100; }
function instRemaining(p) { return Math.round(((+p.total || 0) - instPaidAmt(p)) * 100) / 100; }
function instNextN(p) { for (let n = 1; n <= (p.count || 0); n++) if ((p.paidNs || []).indexOf(n) < 0) return n; return 0; }
function instMonthLabel(start, offset) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(start || "")); if (!m) return "";
  let idx = (parseInt(m[1], 10) * 12) + (parseInt(m[2], 10) - 1) + (offset || 0);
  const y = Math.floor(idx / 12), mo = idx % 12;
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mo] + " " + y;
}
function instCanRun() { return (typeof finCanView === "function") ? finCanView() : true; }

function instPageHTML() {
  if (!instCanRun()) return `<div class="card"><div class="muted">Owner / Admin only.</div></div>`;
  const plans = instActive().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const M = (n) => (typeof money2 === "function") ? money2(n) : "$" + (Math.round((+n || 0) * 100) / 100).toFixed(2);
  const E = (typeof esc === "function") ? esc : (s => String(s == null ? "" : s));
  let h = `<div class="secthd"><h2>🚜 Paybacks</h2><span class="ct">${plans.length}</span></div>`;
  h += `<div class="card"><div class="sub" style="white-space:normal">Track paying a partner back for something they fronted (a trailer, a big materials run) over a set number of monthly payments. Repaying what they fronted — <b>not</b> income to them and not a business expense — so this stays off the P&amp;L and 1099.</div></div>`;
  if (!plans.length) h += `<div class="card"><div class="muted">No payback plans yet. Set one up below.</div></div>`;
  plans.forEach(p => {
    const paid = instPaidCount(p), next = instNextN(p), rem = instRemaining(p), done = paid >= p.count;
    const pct = Math.min(100, Math.round(paid / (p.count || 1) * 100));
    h += `<div class="card" style="border-left:4px solid ${done ? "#1e9e5a" : "#6b3fa0"}">
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px">
        <div class="grow" style="white-space:normal"><div class="nm">${E(p.label || "Payback")}</div>
          <div class="sub">to <b>${E(p.payeeName || "?")}</b> · ${M(p.total)} total · ${p.count} payments of ${M(instPer(p))}/mo${p.note ? " · " + E(p.note) : ""}</div></div>
        <div style="text-align:right;flex:0 0 auto"><div class="nm">${M(rem)}</div><div class="sub">${done ? "✓ paid off" : "remaining"}</div></div>
      </div>
      <div style="background:var(--soft);border-radius:8px;height:8px;margin:8px 0;overflow:hidden"><div style="background:${done ? "#1e9e5a" : "#6b3fa0"};height:100%;width:${pct}%"></div></div>
      <div class="row" style="justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div class="sub">${paid} of ${p.count} paid${next ? ` · next: payment ${next}, due ${instMonthLabel(p.start, next - 1)} (${M(instPaymentAmt(p, next))})` : ""}</div>
        <div class="row" style="gap:6px;flex:0 0 auto">
          ${next ? `<button class="btn acc sm" onclick="instPay('${p.id}')">✓ Log payment ${next}</button>` : ""}
          ${paid ? `<button class="btn ghost sm" onclick="instUnpay('${p.id}')">↩ Undo last</button>` : ""}
          <button class="btn ghost sm" style="color:var(--danger)" onclick="instDelete('${p.id}')">🗑</button>
        </div>
      </div></div>`;
  });
  // create form
  const members = (typeof finMembers === "function") ? finMembers() : ((S && S.users) || []).filter(u => u && !u.kind && !u.deleted);
  const thisMonth = (typeof today === "function" ? today() : "").slice(0, 7) || "";
  h += `<div class="card"><div class="nm" style="margin-bottom:8px">＋ New payback plan</div>
    <label>Pay back who?</label><select id="inst_payee">${members.map(u => `<option value="${u.id}">${E(u.name || u.username || u.id)}</option>`).join("")}</select>
    <label style="margin-top:8px">What for?</label><input id="inst_label" placeholder="e.g. Dump trailer">
    <div class="row" style="gap:8px;margin-top:8px">
      <div class="grow"><label>Total ($)</label><input id="inst_total" type="number" inputmode="decimal" placeholder="10541.74"></div>
      <div class="grow"><label># payments</label><input id="inst_count" type="number" inputmode="numeric" value="24"></div>
    </div>
    <div class="row" style="gap:8px;margin-top:8px">
      <div class="grow"><label>First payment (month)</label><input id="inst_start" type="month" value="${thisMonth}"></div>
    </div>
    <label style="margin-top:8px">Note (optional)</label><input id="inst_note" placeholder="e.g. Chase fronted the whole purchase">
    <button class="btn acc" style="width:100%;margin-top:12px" onclick="instCreate()">Create payback plan</button></div>`;
  return h;
}

window.instCreate = function () {
  if (!instCanRun()) { alert("Owner / Admin only."); return; }
  const v = id => { const el = document.getElementById(id); return el ? el.value : ""; };
  const payeeId = v("inst_payee"), label = (v("inst_label") || "").trim(), total = parseFloat(v("inst_total")) || 0;
  const count = Math.max(1, Math.round(parseFloat(v("inst_count")) || 0)), start = v("inst_start") || (typeof today === "function" ? today() : "").slice(0, 7);
  if (!payeeId) { alert("Pick who you're paying back."); return; }
  if (!label) { alert("Add what it's for."); return; }
  if (!(total > 0)) { alert("Enter the total amount."); return; }
  if (!/^\d{4}-\d{2}$/.test(start)) { alert("Pick the first-payment month."); return; }
  if (typeof submitGuard === "function" && !submitGuard("instCreate:" + payeeId + label)) return;
  const members = (typeof finMembers === "function") ? finMembers() : (S.users || []);
  const payee = members.find(u => u && u.id === payeeId) || {};
  const d = D(); if (!Array.isArray(d.installments)) d.installments = [];
  const rec = { id: "inst_" + (typeof uid === "function" ? uid() : Date.now().toString(36)), payeeId: payeeId, payeeName: payee.name || payee.username || "", label: label, total: Math.round(total * 100) / 100, count: count, start: start, paidNs: [], note: (v("inst_note") || "").trim(), createdBy: (typeof meId === "function" ? meId() : ""), createdAt: (typeof now === "function" ? now() : Date.now()), deleted: false, updatedAt: (typeof now === "function" ? now() : Date.now()) };
  d.installments.push(rec);
  if (typeof touch === "function") touch(rec);
  if (typeof logChange === "function") logChange("create", "installment", rec.id, "Payback plan " + label + " · " + rec.count + "×");
  if (typeof save === "function") save(); if (typeof render === "function") render();
};
window.instPay = function (id) {
  const p = instActive().find(x => x.id === id); if (!p) return;
  const n = instNextN(p); if (!n) return;
  if (typeof submitGuard === "function" && !submitGuard("instPay:" + id + n)) return;
  if (!Array.isArray(p.paidNs)) p.paidNs = [];
  p.paidNs.push(n); p.updatedAt = (typeof now === "function" ? now() : Date.now());
  if (typeof touch === "function") touch(p);
  if (typeof logChange === "function") logChange("update", "installment", p.id, "Logged payback " + n + "/" + p.count + " · " + p.label);
  if (typeof save === "function") save(); if (typeof render === "function") render();
};
window.instUnpay = function (id) {
  const p = instActive().find(x => x.id === id); if (!p || !(p.paidNs || []).length) return;
  p.paidNs.sort((a, b) => a - b).pop(); p.updatedAt = (typeof now === "function" ? now() : Date.now());
  if (typeof touch === "function") touch(p);
  if (typeof save === "function") save(); if (typeof render === "function") render();
};
window.instDelete = function (id) {
  const p = instActive().find(x => x.id === id); if (!p) return;
  if (typeof confirm === "function" && !confirm("Delete the payback plan “" + (p.label || "") + "”? This only removes the tracker, not any money.")) return;
  p.deleted = true; p.updatedAt = (typeof now === "function" ? now() : Date.now());
  if (typeof touch === "function") touch(p);
  if (typeof save === "function") save(); if (typeof render === "function") render();
};
