/* ---------- APPROVALS — owner-only inbox for Cap's proposed writes (Step 2) ----------
   The approval queue. Cap PROPOSES into pendingChanges (server, /api/ceo/propose, whitelist-scoped);
   the owner APPROVES here; APPLY is this file's deterministic plain code (NO model) writing the real
   record via the normal touch()/save()/auto-sync path. Reject discards. Owner-only, hard-gated in
   roleAllows() (js/32) + re-checked here. Step 2 ships todos only. */

const APPR_BIZES = ["obx", "jam"];
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
function apprWhat(pc) {
  const a = pc.after || {}, title = esc(a.title || (pc.before && pc.before.title) || pc.targetId || "");
  if (pc.collection === "todos") {
    if (pc.type === "create") return `Add to-do: <b>${title}</b>${a.due ? ` · due ${esc(a.due)}` : ""}${a.priority ? ` · ${esc(a.priority)}` : ""}`;
    if (pc.type === "update") return `Update to-do <b>${title}</b>`;
    if (pc.type === "softDelete") return `Remove to-do <b>${title}</b>`;
  }
  return `${esc(pc.type)} on ${esc(pc.collection)}`;
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
    if (pc.collection === "todos") {
      const coll = (S[biz].todos || (S[biz].todos = []));
      if (pc.type === "create") {
        const rec = Object.assign({ done: false }, pc.after, { updatedAt: now() });
        if (!rec.id) rec.id = uid();
        const ix = coll.findIndex(t => t.id === rec.id);   // idempotent: LWW-replace if it already exists
        if (ix >= 0) coll[ix] = rec; else coll.push(rec);
        applied = true;
      } else if (pc.type === "update") {
        const tgt = coll.find(t => t.id === pc.targetId);
        if (!tgt) err = "target to-do not found"; else { Object.assign(tgt, pc.after || {}, { id: pc.targetId, updatedAt: now() }); applied = true; }
      } else if (pc.type === "softDelete") {
        const tgt = coll.find(t => t.id === pc.targetId);
        if (!tgt) err = "target to-do not found"; else { tgt.deleted = true; touch(tgt); applied = true; }
      } else err = "unsupported type: " + pc.type;
    } else err = "unsupported collection: " + pc.collection;
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
