/* ---------- NEXT CHECK (js/119) — one screen: what each person is owed on the next payout ---------------------
   Ray: "one screen where I know how much I owe each person on the next check — reimbursements, mileage, and actual
   pay, all itemized and totaled for each crew member." Pulls the SAME finance engine every other Money screen
   uses (no new math), but presents it as a clean per-person check: labor pay (field/sales/admin) + mileage +
   out-of-pocket reimbursements, minus a fault deduction or anything already paid this run.

   UNITS: finRollup / finMileage / payPaidByMember / finFaultDeductions are all CENTS; rcptReimbOwed is DOLLARS
   (×100 here). Owner/admin only. Additive + typeof-guarded. */

function nextCheckCanView() { return (typeof finCanView === "function") ? finCanView() : true; }

function nextCheckModel() {
  const adminId = (typeof finAdminMember === "function") ? finAdminMember() : "";
  const inc = (typeof popAcceptedIncome === "function") ? popAcceptedIncome() : [];
  const roll = (typeof finRollup === "function") ? finRollup(inc, { adminMemberId: adminId }) : { member: {} };
  const mil = (typeof finMileage === "function") ? finMileage(((typeof D === "function") ? D().timeclock : []) || [], { confirmedOnly: true }) : { perMember: {} };
  const reimbD = (typeof rcptReimbOwed === "function") ? rcptReimbOwed() : {};                     // DOLLARS
  const paid = (typeof payPaidByMember === "function") ? payPaidByMember() : {};                   // CENTS
  const fault = ((typeof finFaultDeductions === "function") ? finFaultDeductions(((typeof D === "function") ? D().jobs : []) || []) : { perMember: {} }).perMember || {};

  const seen = {};
  [roll.member || {}, mil.perMember || {}, reimbD || {}, fault || {}].forEach(o => Object.keys(o).forEach(id => { seen[id] = 1; }));

  const rows = Object.keys(seen).map(id => {
    const m = (roll.member || {})[id] || { field: 0, sales: 0, admin: 0 };
    const field = m.field || 0, sales = m.sales || 0, admin = m.admin || 0;
    const mileage = (mil.perMember || {})[id] || 0;
    const reimb = Math.round(((reimbD || {})[id] || 0) * 100);
    const flt = (fault || {})[id] || 0;
    const alreadyPaid = (paid || {})[id] || 0;
    const pay = field + sales + admin;
    const owed = Math.max(0, pay + mileage + reimb - flt - alreadyPaid);
    return { id: id, name: (typeof finName === "function") ? finName(id) : id, field: field, sales: sales, admin: admin, pay: pay, mileage: mileage, reimb: reimb, fault: flt, alreadyPaid: alreadyPaid, owed: owed };
  }).filter(r => r.owed > 0 || r.pay > 0 || r.mileage > 0 || r.reimb > 0)
    .sort((a, b) => b.owed - a.owed);

  const grand = rows.reduce((s, r) => s + r.owed, 0);
  return { rows: rows, grand: grand, adminId: adminId };
}

function rNextCheck() {
  if (!nextCheckCanView()) { view.innerHTML = `<div class="secthd"><h2>Next check</h2></div><div class="card"><div class="muted">Owner / Admin only.</div></div>`; return; }
  const M = nextCheckModel();
  const F = c => (typeof fm === "function") ? fm(c) : "$" + (Math.round(c || 0) / 100).toFixed(2);
  let h = `<div class="secthd"><h2>🧾 Next check</h2><span class="ct">${F(M.grand)}</span></div>`;
  h += `<div class="card"><div class="sub" style="white-space:normal">Everything you owe the crew on the next payout — <b>labor pay + mileage + out-of-pocket reimbursements</b>, itemized per person. Pay reflects all accepted work; reimbursements are personal-card spend not yet paid back.</div></div>`;

  if (!M.rows.length) { h += `<div class="card"><div class="muted">Nobody's owed anything right now. 🎉</div></div>`; view.innerHTML = h; return; }

  const line = (label, val) => val ? `<div class="row" style="justify-content:space-between"><span class="sub">${label}</span><span>${(typeof fm === "function") ? fm(val) : val}</span></div>` : "";
  M.rows.forEach(r => {
    h += `<div class="card">`
      + `<div class="row" style="justify-content:space-between;align-items:center"><div class="nm" style="font-size:16px">${esc(r.name)}</div><b style="font-size:17px">${F(r.owed)}</b></div>`
      + `<div style="margin-top:6px">`
      + line("💵 Field pay", r.field)
      + line("💵 Sales", r.sales)
      + line("💵 Admin", r.admin)
      + line("🚗 Mileage reimbursement", r.mileage)
      + line("🧾 Out-of-pocket reimbursements", r.reimb)
      + (r.fault ? `<div class="row" style="justify-content:space-between"><span class="sub" style="color:var(--danger)">⚠ Fault deduction</span><span style="color:var(--danger)">−${F(r.fault)}</span></div>` : "")
      + (r.alreadyPaid ? `<div class="row" style="justify-content:space-between"><span class="sub">− Already paid this run</span><span>−${F(r.alreadyPaid)}</span></div>` : "")
      + `<div class="row" style="justify-content:space-between;margin-top:4px;padding-top:6px;border-top:1px solid var(--line)"><b>On the next check</b><b>${F(r.owed)}</b></div>`
      + `</div>`
      + `<div class="row" style="gap:8px;margin-top:8px"><button class="btn acc sm grow" onclick="nextCheckPay('${r.id}')">✓ Record payout</button>${r.reimb ? `<button class="btn ghost sm grow" onclick="nextCheckSettleReimb('${r.id}')">Mark reimb. paid back</button>` : ""}</div>`
      + `</div>`;
  });
  view.innerHTML = h;
}
window.rNextCheck = rNextCheck;

/* record a payout to this person (opens the disbursement modal with the member preset — Ray enters the amount) */
window.nextCheckPay = function (id) {
  if (!nextCheckCanView()) return;
  if (typeof recordDisbursement === "function") recordDisbursement("payout", null, id);
  else alert("Record the payout in Money → Finance → Cash.");
};
/* mark this person's out-of-pocket receipts reimbursed (stamps reimbursedAt via the receipts settle flow) */
window.nextCheckSettleReimb = function (id) {
  if (!nextCheckCanView()) return;
  if (typeof rcptSettle === "function") rcptSettle(id);
  else alert("Settle reimbursements in the Receipts area.");
};
