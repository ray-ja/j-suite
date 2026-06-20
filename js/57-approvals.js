/* ---------- APPROVALS — owner-only inbox for Cap's proposed writes (Step 2) ----------
   The approval queue. Cap PROPOSES into pendingChanges (server, /api/ceo/propose, whitelist-scoped);
   the owner APPROVES here; APPLY is this file's deterministic plain code (NO model) writing the real
   record via the normal touch()/save()/auto-sync path. Reject discards. Owner-only, hard-gated in
   roleAllows() (js/32) + re-checked here. Step 2 ships todos only. */

const APPR_BIZES = ["obx", "jam"];
// business collections Cap may propose into (mirror of server PROPOSE_COLLECTIONS) — excludes system/meta
const APPR_WRITABLE = ["customers", "quotes", "jobs", "todos", "mktTracker", "docs", "places", "properties", "inventory", "timeclock", "income", "expenses", "resale"];
function apprCanView() { return (typeof isOwner === "function") ? isOwner() : false; }

// every non-deleted proposal across both businesses, tagged with its biz
function apprAll() {
  const out = [];
  APPR_BIZES.forEach(b => (((S[b] || {}).pendingChanges) || []).forEach(pc => { if (pc && !pc.deleted) out.push({ biz: b, pc: pc }); }));
  return out;
}
function apprPending() { return apprAll().filter(x => x.pc.status === "pending").sort((a, b) => (a.pc.createdAt || 0) - (b.pc.createdAt || 0)); }
function apprResolved() { return apprAll().filter(x => x.pc.status !== "pending").sort((a, b) => (b.pc.decidedAt || 0) - (a.pc.decidedAt || 0)); }

// plain-language "what this does" — the human-readable diff. Step 2: todos.
const APPR_NOUNS = { customers: "customer", quotes: "quote", jobs: "job", todos: "to-do", properties: "property", inventory: "inventory item", income: "income", expenses: "expense", resale: "resale item", docs: "doc", places: "place", mktTracker: "marketing entry", timeclock: "time entry" };
function apprLabel(pc) { const a = pc.after || {}, b = pc.before || {}; return esc(a.title || a.name || a.cust || a.item || a.label || a.note || b.title || b.name || b.cust || b.item || pc.targetId || "(record)"); }
function apprWhat(pc) {
  const verb = pc.type === "create" ? "Add" : pc.type === "softDelete" ? "Remove" : "Update";
  const noun = APPR_NOUNS[pc.collection] || esc(pc.collection);
  const a = pc.after || {};
  let extra = "";
  if (pc.collection === "todos" && a.due) extra = ` · due ${esc(a.due)}`;
  const amt = (a.total != null ? a.total : (a.amount != null ? a.amount : null));
  if (amt != null && ["quotes", "income", "expenses"].indexOf(pc.collection) >= 0) extra = ` · ${typeof money === "function" ? money(amt) : "$" + amt}`;
  return `${verb} ${noun}: <b>${apprLabel(pc)}</b>${extra}`;
}
function apprStatusBadge(pc) {
  const s = pc.status;
  return s === "applied" ? `<span class="badge p-Low">✓ applied</span>`
    : s === "rejected" ? `<span class="badge">✗ rejected</span>`
    : s === "failed" ? `<span class="badge p-High">⚠ failed</span>`
    : `<span class="badge">pending</span>`;
}

function apprRow(x, pending) {
  const pc = x.pc, who = esc(pc.proposedBy || "cap"), bizLabel = (typeof BIZ !== "undefined" && BIZ[x.biz]) ? esc(BIZ[x.biz].name) : x.biz;
  return `<div class="li" style="align-items:flex-start">
    <div class="grow">
      <div class="nm">${apprWhat(pc)}</div>
      <div class="sub" style="white-space:normal">${esc(pc.summary || "")}</div>
      <div class="sub">proposed by ${who} · ${bizLabel}${pc.note ? ` · <span style="color:var(--bad)">${esc(pc.note)}</span>` : ""}</div>
    </div>
    ${pending
      ? `<div class="row" style="gap:6px;flex:0 0 auto">
           <button class="btn acc sm" onclick="apprApprove('${x.biz}','${pc.id}')">Approve</button>
           <button class="btn ghost sm" onclick="apprReject('${x.biz}','${pc.id}')">Reject</button>
         </div>`
      : apprStatusBadge(pc)}
  </div>`;
}

function rApprovals() {
  if (!apprCanView()) { view.innerHTML = `<div class="card"><div class="nm">Owner only</div><div class="sub">The Approvals inbox is restricted to the Owner role.</div></div>`; return; }
  const pending = apprPending(), resolved = apprResolved();
  let h = `<div class="secthd"><h2>Approvals</h2><span class="ct">${pending.length} pending</span></div>`;
  if (!pending.length && !resolved.length) {
    h += `<div class="empty"><div class="big">✅</div>Nothing waiting. Cap's proposals will appear here for your OK.</div>`;
  } else {
    if (pending.length) h += `<div class="card">${pending.map(x => apprRow(x, true)).join("")}</div>`;
    else h += `<div class="empty">No pending proposals.</div>`;
    if (resolved.length) h += `<details style="margin-top:14px"><summary style="cursor:pointer;font-weight:700;padding:10px 4px">History (${resolved.length})</summary><div class="card" style="margin-top:8px">${resolved.map(x => apprRow(x, false)).join("")}</div></details>`;
  }
  view.innerHTML = h;
}

// ----- APPLY (deterministic, no model) — runs only on the owner's tap -----
function apprFind(biz, id) { return (((S[biz] || {}).pendingChanges) || []).find(p => p && p.id === id); }

window.apprApprove = function (biz, id) {
  if (!apprCanView()) return;
  const pc = apprFind(biz, id);
  if (!pc || pc.status !== "pending") return;
  let applied = false, err = "";
  try {
    // generic apply — works for ANY whitelisted business collection (everything proposable). Still owner-gated.
    // Mirrors the server PROPOSE_COLLECTIONS list (defense in depth: refuse system/meta here too).
    if (APPR_WRITABLE.indexOf(pc.collection) < 0) { err = "collection not allowed: " + pc.collection; }
    else {
      const coll = (S[biz][pc.collection] || (S[biz][pc.collection] = []));
      if (pc.type === "create") {
        const rec = Object.assign({}, pc.after, { updatedAt: now() });
        if (!rec.id) rec.id = uid();
        const ix = coll.findIndex(r => r && r.id === rec.id);   // idempotent: LWW-replace if it already exists
        if (ix >= 0) coll[ix] = rec; else coll.push(rec);
        applied = true;
      } else if (pc.type === "update") {
        const tgt = coll.find(r => r && r.id === pc.targetId);
        if (!tgt) err = "target record not found in " + pc.collection; else { Object.assign(tgt, pc.after || {}, { id: pc.targetId, updatedAt: now() }); applied = true; }
      } else if (pc.type === "softDelete") {
        const tgt = coll.find(r => r && r.id === pc.targetId);
        if (!tgt) err = "target record not found in " + pc.collection; else { tgt.deleted = true; touch(tgt); applied = true; }
      } else err = "unsupported type: " + pc.type;
    }
  } catch (e) { err = String((e && e.message) || e); }
  pc.status = applied ? "applied" : "failed";
  pc.decidedBy = (typeof curUser === "function" && curUser()) ? curUser().id : "owner";
  pc.decidedAt = now();
  if (err) pc.note = err;
  touch(pc);
  if (typeof logChange === "function") logChange(applied ? (pc.type === "create" ? "create" : "update") : "update", pc.collection, (pc.after && pc.after.id) || pc.targetId || pc.id, (applied ? "Approved " : "Apply FAILED ") + pc.type + ": " + (pc.summary || ""));
  save();   // persists + auto-syncs the new/updated record AND the proposal status
  render();
};

window.apprReject = function (biz, id) {
  if (!apprCanView()) return;
  const pc = apprFind(biz, id);
  if (!pc || pc.status !== "pending") return;
  pc.status = "rejected";
  pc.decidedBy = (typeof curUser === "function" && curUser()) ? curUser().id : "owner";
  pc.decidedAt = now();
  touch(pc);
  if (typeof logChange === "function") logChange("update", "pendingChange", pc.id, "Rejected " + pc.type + ": " + (pc.summary || ""));
  save();
  render();
};
