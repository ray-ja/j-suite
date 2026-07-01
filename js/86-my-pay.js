/* ---------- MY PAY / EARNINGS (per-person attribution) ----------
   Breaks the ONE pooled "👷 Owed to members" number (js/64 finAccountBalances: allocatedLabor + mileage −
   payouts paid) into a PER-PERSON view, and gives the crew a self-only "My Pay" page.

   One source of truth: the pooled split engine (js/39 finRollup) computes each job's field POOL + the
   sales/admin shares exactly as the owner Payouts/Cash pages already do. finPerPerson (js/39) then re-splits
   each job's field pool by who actually CLOCKED that job (timeclock hours), so the per-person totals SUM
   BACK to the pooled total — only the per-crew split changes (hours-weighted instead of equal). Mileage is
   the per-vehicle-owner reimbursement; payouts already paid (disbursements with a memberId) are subtracted.

   PRIVACY: a crew member sees ONLY their own earned/paid/owed + their own per-job breakdown. They never see
   business finances, job margins/profit, customer financials, or anyone else's pay. The page is gated to the
   "pay" tab (CREW_PAGES) and rPay() hard-restricts a non-owner/admin to their OWN userId — enforced in the
   render, not just hidden. Owner/admin can view anyone (a member picker).

   Org isolation: every accessor reads D() (the active org's store) — never cross-org. */

/* payouts already paid to each member, from the disbursements collection (type "payout" carrying a memberId).
   opts.from/to optionally restrict to a period (by disbursement date); default = all-time, to match the
   pooled all-time "Owed to members" number on the Cash page. */
function payPaidByMember(opts) {
  opts = opts || {};
  const disb = (typeof actDisb === "function") ? actDisb() : ((D().disbursements || []).filter(x => x && !x.deleted));
  const out = {};
  disb.forEach(d => {
    if (!d || d.type !== "payout" || !d.memberId) return;
    if ((opts.from && d.date < opts.from) || (opts.to && d.date > opts.to)) return;
    out[d.memberId] = (out[d.memberId] || 0) + (typeof finCents === "function" ? finCents(d.amount) : Math.round((+d.amount || 0) * 100));
  });
  return out;
}

/* the canonical per-person earnings view for the active org. opts.from/to optionally scope to a period;
   default = ALL-TIME so it reconciles to the Cash page's pooled "Owed to members". Returns finPerPerson(). */
function payPerPerson(opts) {
  opts = opts || {};
  const adminId = (typeof finAdminMember === "function") ? finAdminMember() : "";
  const roll = finRollup(actIncome(), Object.assign({ adminMemberId: adminId }, opts.from ? { from: opts.from } : {}, opts.to ? { to: opts.to } : {}));
  const mil = finMileage(D().timeclock || [], Object.assign({ confirmedOnly: true }, opts.from ? { from: opts.from } : {}, opts.to ? { to: opts.to } : {}));
  const hoursByJob = finHoursByJob(D().timeclock || [], opts.from || opts.to ? { from: opts.from, to: opts.to } : {});
  const payouts = payPaidByMember(opts);
  const pp = finPerPerson(roll, mil, hoursByJob, payouts);
  return Object.assign(pp, { roll: roll, hoursByJob: hoursByJob, adminId: adminId });
}

/* per-person, per-job breakdown for ONE member: which jobs they earned a field share on + how much.
   Built from the same rollup.perJob the pooled engine produced, re-split EQUALLY among that job's crew
   (matches finPerPerson — not hours-weighted; a faster crew member isn't paid less for finishing quicker).
   Self-only data: it returns only THIS member's share per job (no margins, no other members' shares, no
   customer money). Hours are still shown per job (informational), just not used to size the share. */
function payJobsForMember(pp, memberId) {
  const rows = [];
  (pp.roll.perJob || []).forEach(pj => {
    const crew = Object.keys(pj.field || {});
    if (crew.indexOf(memberId) < 0) return;
    const es = finSplitEqual(pj.fieldPool, crew);
    const share = es.perMember[memberId] || 0;
    if (!(share > 0)) return;
    const j = (D().jobs || []).find(x => x && x.id === pj.jobId);
    const myHrs = (pp.hoursByJob[pj.jobId] && pp.hoursByJob[pj.jobId][memberId]) || 0;
    rows.push({ jobId: pj.jobId, title: (j && j.title) || "Job", date: pj.date, share: share, hours: myHrs });
  });
  // sales credit the member originated, by job (their 15% on jobs they sold)
  const salesRows = [];
  (pp.roll.perJob || []).forEach(pj => {
    if (pj.split && pj.split.salesToOriginator > 0 && pj.split.originator === memberId) {
      const j = (D().jobs || []).find(x => x && x.id === pj.jobId);
      salesRows.push({ jobId: pj.jobId, title: (j && j.title) || "Job", date: pj.date, sales: pj.split.salesToOriginator });
    }
  });
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  salesRows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { field: rows, sales: salesRows };
}

/* ===================== MY PAY page (crew self-only; owner/admin can view anyone) ===================== */
let PAY_MEMBER = null;   // owner/admin: which member is being viewed (null = self / first)

/* can the current session view OTHER members' pay? Owner or admin-tier (manage-members), else self-only. */
function payCanViewOthers() {
  if (typeof isOwner === "function" && isOwner()) return true;
  return (typeof canManageMembers === "function") && canManageMembers();   // admin/manager tier
}

window.paySetMember = function (id) { PAY_MEMBER = id || null; render(); };

function rPay() {
  const me = (typeof curUser === "function") ? curUser() : null;
  if (!me) { view.innerHTML = `<div class="card"><div class="nm">Sign in to see your pay</div><div class="sub">Your earnings show here once you're signed in.</div></div>`; return; }
  const viewOthers = payCanViewOthers();
  // PRIVACY GATE (enforced, not just visual): a non-owner/admin can ONLY ever view their OWN id.
  const targetId = viewOthers ? (PAY_MEMBER || me.id) : me.id;
  const isSelf = targetId === me.id;
  const pp = payPerPerson();   // all-time, reconciles to the pooled "Owed to members"
  const m = pp.member[targetId] || { field: 0, sales: 0, admin: 0, earned: 0, mileage: 0, paid: 0, owed: 0 };
  const nm = (typeof finName === "function") ? finName(targetId) : targetId;

  let h = "";
  // owner/admin: member picker (self-only sees no picker at all)
  if (viewOthers) {
    const members = (typeof finMembers === "function") ? finMembers() : [];
    h += `<div class="card"><label>Whose pay</label><select onchange="paySetMember(this.value)">${members.map(u => `<option value="${u.id}" ${targetId === u.id ? "selected" : ""}>${esc(u.username)}${u.id === me.id ? " (you)" : ""}</option>`).join("")}</select>
      <div class="sub" style="margin-top:6px">You can review any member's pay. Crew see only their own.</div></div>`;
  }

  // headline: earned / paid / owed — ONLY this person's numbers
  h += `<div class="card" style="text-align:center">
    <div class="sub">${esc(isSelf ? "Your pay" : nm + "'s pay")} · to date</div>
    <div style="font-size:30px;font-weight:800;color:var(--accent)">${fm(m.owed)}</div>
    <div class="sub">still owed (earned + gas reimbursement − paid)</div>
    <div class="row" style="gap:6px;margin-top:10px;text-align:center">
      <div class="grow"><div class="nm" style="font-size:18px">${fm(m.earned)}</div><div class="sub">earned</div></div>
      <div class="grow" style="border-left:1px solid var(--line)"><div class="nm" style="font-size:18px">${fm(m.mileage)}</div><div class="sub">gas reimb.</div></div>
      <div class="grow" style="border-left:1px solid var(--line)"><div class="nm" style="font-size:18px">${fm(m.paid)}</div><div class="sub">paid</div></div>
    </div></div>`;

  // earned breakdown (field / sales / admin) — the person's own shares only
  h += `<div class="secthd"><h2>How it adds up</h2></div><div class="card">
    <div class="li"><div class="grow"><div class="nm">👷 Field work</div><div class="sub">your share of jobs you worked (by your clocked hours)</div></div><b>${fm(m.field)}</b></div>
    ${m.sales ? `<div class="li"><div class="grow"><div class="nm">🤝 Sales credit</div><div class="sub">15% on jobs you booked (3-month window)</div></div><b>${fm(m.sales)}</b></div>` : ""}
    ${m.admin ? `<div class="li"><div class="grow"><div class="nm">🗂️ Admin</div><div class="sub">5% admin share (capped $500/mo)</div></div><b>${fm(m.admin)}</b></div>` : ""}
    <div class="li"><div class="grow"><div class="nm">⛽ Gas reimbursement</div><div class="sub">your vehicle's confirmed miles @ $${(typeof FIN !== "undefined" ? FIN.MILEAGE_RATE : 0.725)}/mi — covers fuel, not earnings</div></div><b>${fm(m.mileage)}</b></div>
    <div style="border-top:2px solid var(--line);margin:6px 0 0;padding-top:6px"></div>
    <div class="li"><div class="grow"><div class="nm" style="font-weight:800">Total to date</div></div><b>${fm(m.earned + m.mileage)}</b></div>
    <div class="li"><div class="grow"><div class="nm">Already paid</div></div><b>−${fm(m.paid)}</b></div>
    <div class="li"><div class="grow"><div class="nm" style="font-weight:800;color:var(--accent)">Still owed</div></div><b style="color:var(--accent)">${fm(m.owed)}</b></div>
  </div>`;

  // per-job breakdown — which jobs, the person's share (NO margins / NO customer money / NO other crew)
  const jb = payJobsForMember(pp, targetId);
  h += `<div class="secthd"><h2>Your jobs</h2><span class="ct">${jb.field.length}</span></div>`;
  if (!jb.field.length) h += `<div class="card"><div class="muted">No field earnings yet. Clock into the jobs you work — your share shows here once the job is recorded as income.</div></div>`;
  else h += `<div class="card">` + jb.field.map(r => `<div class="li"><div class="grow"><div class="nm" style="font-size:15px">${esc(r.title)}</div><div class="sub">${(typeof fmtDate === "function") ? fmtDate(r.date) : r.date}${r.hours ? " · " + (Math.round(r.hours * 10) / 10) + "h clocked" : ""}</div></div><b>${fm(r.share)}</b></div>`).join("") + `</div>`;

  if (jb.sales.length) {
    h += `<div class="secthd"><h2>Sales you booked</h2><span class="ct">${jb.sales.length}</span></div><div class="card">` +
      jb.sales.map(r => `<div class="li"><div class="grow"><div class="nm" style="font-size:15px">${esc(r.title)}</div><div class="sub">${(typeof fmtDate === "function") ? fmtDate(r.date) : r.date} · sales credit</div></div><b>${fm(r.sales)}</b></div>`).join("") + `</div>`;
  }

  h += `<div class="card" style="background:var(--soft)"><div class="sub" style="white-space:normal">This is your pay only. Field work splits each job's crew pool by the hours you clocked; sales credit is 15% on jobs you booked within 3 months; gas reimbursement is your confirmed mileage. Ask Ray about a payout.</div></div>`;
  view.innerHTML = h;
}
window.rPay = rPay;

/* ===================== OWNER per-person "Owed" breakdown (for the Cash page) =====================
   Breaks the pooled "👷 Owed to members" into a per-person list (name → owed), each tappable to record a
   payout to that member (the existing recordDisbursement('payout', id, memberId) already supports it).
   All-time, so it sums to the pooled owedBal on the Cash card. */
function finOwedPerPersonHTML() {
  const pp = payPerPerson();   // all-time
  const ids = Object.keys(pp.member).filter(id => Math.abs(pp.member[id].owed) > 0 || pp.member[id].earned > 0)
    .sort((a, b) => pp.member[b].owed - pp.member[a].owed);
  if (!ids.length) return `<div class="card"><div class="muted">No member earnings yet — record income to compute each person's share.</div></div>`;
  let h = `<div class="card">` + ids.map(id => {
    const m = pp.member[id];
    return `<div class="li" onclick="recordDisbursement('payout',null,'${id}')" style="cursor:pointer;align-items:flex-start"><div class="grow"><div class="nm">${esc(finName(id))}</div>
      <div class="sub" style="white-space:normal">earned ${fm(m.earned)}${m.mileage ? " + gas " + fm(m.mileage) : ""}${m.paid ? " − paid " + fm(m.paid) : ""}</div></div>
      <div style="text-align:right;flex:0 0 auto"><b style="${m.owed < 0 ? "color:var(--danger)" : ""}">${fm(m.owed)}</b><div class="sub" style="font-size:11px">tap to pay</div></div></div>`;
  }).join("") + `</div>`;
  if (pp.unallocatedField > 0) h += `<div class="card" style="border-left:4px solid var(--accent)"><div class="sub" style="white-space:normal">• ${fm(pp.unallocatedField)} field work is unassigned (jobs recorded with no crew) — assign crew on the income entry so it distributes to a person.</div></div>`;
  return h;
}
window.finOwedPerPersonHTML = finOwedPerPersonHTML;

/* ===================== NEW-CREW QUICK-START =====================
   A first-login, dismissible checklist for a freshly-set-up CREW account: set your availability, pick your
   default truck, skim the playbook. Each step auto-checks off as its data appears (u.avail / u.defaultVehicleId);
   the whole card hides once every step is done OR the member taps Dismiss (additive flag u.onboardDismissed,
   stored on the account record so it rides the existing per-record LWW sync — no new collection). It never
   nags forever: dismissed or complete → gone. Owner/admin don't see it (it's a crew first-run aid). */
function crewStepsDone() {
  const me = (typeof curUser === "function") ? curUser() : null; if (!me) return null;
  const availSet = !!(me.avail && me.avail.days) || (Array.isArray(me.timeoff) && me.timeoff.length > 0);
  const truckSet = !!me.defaultVehicleId;
  const pbSeen = !!me.playbookSeen;
  return { me: me, availSet: availSet, truckSet: truckSet, pbSeen: pbSeen, all: availSet && truckSet && pbSeen };
}
function crewQuickStartHTML() {
  // only for a signed-in CREW member (not owner/admin/manager) who hasn't dismissed or finished it
  if (typeof isOwner === "function" && isOwner()) return "";
  if (typeof canManageMembers === "function" && canManageMembers()) return "";
  const s = crewStepsDone(); if (!s) return "";
  if (s.me.onboardDismissed || s.all) return "";
  const row = (done, icon, label, sub, onclick) =>
    `<div class="li" style="align-items:center;cursor:pointer" onclick="${onclick}">
       <span style="font-size:20px;flex:0 0 auto;margin-right:4px">${done ? "✅" : "⬜"}</span>
       <div class="grow"><div class="nm" style="font-size:15px;${done ? "color:var(--muted);text-decoration:line-through" : ""}">${icon} ${label}</div><div class="sub" style="white-space:normal">${sub}</div></div>
       ${done ? "" : `<span class="sub" style="flex:0 0 auto">›</span>`}</div>`;
  let h = `<div class="card" style="border-left:4px solid var(--accent)">
    <div class="row" style="align-items:center"><div class="grow"><div class="nm" style="font-size:16px">👋 Welcome — quick setup</div><div class="sub">Three quick taps and you're ready for the crew.</div></div>
      <button class="btn ghost sm" style="flex:0 0 auto" onclick="crewDismissOnboard()">Dismiss</button></div>`;
  h += row(s.availSet, "🗓", "Set your availability", "Tell the team which days/hours you can work.", "crewQsAvail()");
  h += row(s.truckSet, "🚚", "Pick your default truck", "Pre-selects when you clock in (you can change it per shift).", "crewQsTruck()");
  h += row(s.pbSeen, "📒", "Skim the playbook", "How we quote, dump, and run a job — the basics.", "crewQsPlaybook()");
  return h + `</div>`;
}
window.crewQuickStartHTML = crewQuickStartHTML;
window.crewQsAvail = function () { const me = (typeof curUser === "function") ? curUser() : null; if (me && typeof openAvailability === "function") openAvailability(me.id); else if (typeof navSub === "function") navSub("schedule"); };
window.crewQsTruck = function () { if (typeof tcSetDefaultVehicle === "function") tcSetDefaultVehicle(); else if (typeof navSub === "function") navSub("time"); };
window.crewQsPlaybook = function () {   // mark the playbook step seen (additive flag) + jump to it
  const me = (typeof curUser === "function") ? curUser() : null;
  if (me) { me.playbookSeen = true; if (typeof touch === "function") touch(me); if (typeof save === "function") save(); if (typeof scheduleAutoPush === "function") scheduleAutoPush(); }
  if (typeof navSub === "function") navSub("playbook"); else render();
};
window.crewDismissOnboard = function () {
  const me = (typeof curUser === "function") ? curUser() : null; if (!me) return;
  me.onboardDismissed = true; if (typeof touch === "function") touch(me); if (typeof save === "function") save();
  if (typeof scheduleAutoPush === "function") scheduleAutoPush();
  render();
};

if (typeof module !== "undefined" && module.exports) { module.exports = { payPerPerson: payPerPerson, payJobsForMember: payJobsForMember, payPaidByMember: payPaidByMember }; }
