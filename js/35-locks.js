/* ---------- IN-USE SOFT LOCK (reusable, keyed by entity-type + record id) ----------
   When a user opens a record in a full edit form, we write a synced lock record into the current
   business's D().locks collection. A second user opening the same record sees a read-only
   "🔒 [Name] is editing this" banner with a "Take over editing" override. Soft lock only — the
   data itself stays protected by per-record LWW + the change log regardless of who edits.

   Robustness: a heartbeat refreshes the lock every ~30s while the editor is open; a lock is
   considered active only while it's < ~2min old, so a dead/offline/closed device never leaves a
   record stuck-locked. Locks release on save/close/navigate-away.

   Locks are plain per-business records that ride the existing sync. They are NEVER written to the
   change log (no logChange) and are not counted as business data (storeIsEmpty + the Data-tab
   counts only enumerate real collections, not locks).

   Adding lockability to a future entity is ONE call from its editor:
       lockGuard(entity, isNew ? null : rec.id, () => reopenTheEditor());   // modal editors
   New records (no id) are skipped — two users can't collide on a not-yet-saved record. Quick
   atomic toggles and single-owner records (inventory have/qty, per-user availability/settings,
   todos) are intentionally NOT locked: per-record LWW already prevents loss there. */

const LOCK_TTL = 120000;   // a lock older than this (no heartbeat) is treated as expired/free
const LOCK_BEAT = 30000;   // refresh our lock this often while the editor is open
let LOCKCTX = null;        // the lock we currently hold for the open editor (singleton: one editor at a time)
let _lockBeat = null;

function locks() { const d = D(); if (!d.locks) d.locks = []; return d.locks; }
function lockKey(entity, recId) { return "lk_" + entity + "_" + recId; }
function lockActive(lk) { return !!(lk && !lk.deleted && (now() - (lk.ts || 0)) < LOCK_TTL); }
function findLockRec(entity, recId) { return locks().find(l => l.id === lockKey(entity, recId)) || null; }
function activeLock(entity, recId) { const l = findLockRec(entity, recId); return lockActive(l) ? l : null; }
function lockInitials(name) {
  const p = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (p.length > 1 ? (p[0][0] + p[1][0]) : p[0].slice(0, 2)).toUpperCase();
}
function lockMe() {
  const u = (typeof curUser === "function") ? curUser() : null;
  if (u) return { userId: u.id, name: u.username, initials: lockInitials(u.username) };
  // no signed-in user (e.g. offline/crew device): use a stable per-device id so heartbeat/ownership still works
  let d = localStorage.getItem("jra_device"); if (!d) { d = "dev_" + uid(); try { localStorage.setItem("jra_device", d); } catch (e) {} }
  return { userId: d, name: "A teammate", initials: "👤" };
}
function otherActiveLock(entity, recId) { const l = activeLock(entity, recId); const me = lockMe(); return (l && l.userId !== me.userId) ? l : null; }

function writeLock(entity, recId) {
  const me = lockMe(), id = lockKey(entity, recId), arr = locks();
  let l = arr.find(x => x.id === id);
  if (!l) { l = { id: id, entity: entity, recId: recId }; arr.push(l); }
  l.userId = me.userId; l.name = me.name; l.initials = me.initials; l.ts = now(); l.updatedAt = now(); l.deleted = false;
  return l;
}
function releaseLock(entity, recId) {
  const l = findLockRec(entity, recId), me = lockMe();
  if (l && l.userId === me.userId) { l.deleted = true; l.ts = 0; l.updatedAt = now(); }   // tombstone so the release syncs
}

/* acquire + start heartbeat. opts: { onLost(takerLock), alive()->bool } */
function lockAcquire(entity, recId, opts) {
  opts = opts || {};
  writeLock(entity, recId);
  LOCKCTX = { entity: entity, recId: recId, onLost: opts.onLost || null, alive: opts.alive || null };
  save();
  lockStartBeat();
}
function lockStartBeat() { lockStopBeat(); _lockBeat = setInterval(lockHeartbeat, LOCK_BEAT); }
function lockStopBeat() { if (_lockBeat) { clearInterval(_lockBeat); _lockBeat = null; } }
function lockHeartbeat() {
  if (!LOCKCTX) { lockStopBeat(); return; }
  // editor gone (navigated away / closed without our hook) → release
  if (LOCKCTX.alive && !LOCKCTX.alive()) { lockReleaseCurrent(); return; }
  const cur = findLockRec(LOCKCTX.entity, LOCKCTX.recId), me = lockMe();
  if (cur && cur.userId !== me.userId && lockActive(cur)) {            // someone took over
    const ctx = LOCKCTX; LOCKCTX = null; lockStopBeat();
    if (ctx.onLost) { try { ctx.onLost(cur); } catch (e) {} }
    return;
  }
  writeLock(LOCKCTX.entity, LOCKCTX.recId); save();                   // refresh our claim
}
function lockReleaseCurrent() {
  if (!LOCKCTX) return;
  const ctx = LOCKCTX; LOCKCTX = null; lockStopBeat();
  releaseLock(ctx.entity, ctx.recId); save();
}
window.lockReleaseCurrent = lockReleaseCurrent;
/* closeModal hook — only release locks owned by a MODAL editor, never the wizard's own lock
   (so opening a sub-modal over the quote wizard, e.g. Accept & schedule, doesn't drop its lock). */
function lockReleaseOnModalClose() { if (LOCKCTX && LOCKCTX.alive === lockModalAlive) lockReleaseCurrent(); }
window.lockReleaseOnModalClose = lockReleaseOnModalClose;
/* called from render() — releases the lock the moment its editor stops being shown (navigate-away) */
function lockCheckAlive() { if (LOCKCTX && LOCKCTX.alive && !LOCKCTX.alive()) lockReleaseCurrent(); }
window.lockCheckAlive = lockCheckAlive;
function lockTakeOver(entity, recId) { writeLock(entity, recId); save(); }   // force our claim; old holder's heartbeat detects it
window.lockTakeOver = lockTakeOver;
function lockHeld(entity, recId) { return !!(LOCKCTX && LOCKCTX.entity === entity && LOCKCTX.recId === recId); }
window.lockHeld = lockHeld;

/* ----- modal-editor integration: ONE call at the end of an opener ----- */
function lockModalAlive() { const ov = document.getElementById("overlay"); return !!(ov && ov.classList.contains("show")); }
function lockGuard(entity, recId, reopenFn) {
  if (!recId) return;                                  // new record → nothing to collide on
  const sheet = document.getElementById("sheet"); if (!sheet) return;
  const other = otherActiveLock(entity, recId);
  if (other) {
    lockRenderReadonly(sheet, other, entity, recId, reopenFn);
  } else {
    lockAcquire(entity, recId, { onLost: function () { if (typeof reopenFn === "function") reopenFn(); }, alive: lockModalAlive });
  }
}
window.lockGuard = lockGuard;
function lockRenderReadonly(sheet, lock, entity, recId, reopenFn) {
  sheet.querySelectorAll("input,select,textarea,button").forEach(el => {
    if (el.classList.contains("cl")) return;           // keep the × close button usable
    el.disabled = true; el.style.opacity = "0.55";
  });
  const ban = document.createElement("div");
  ban.className = "lockbanner";
  ban.innerHTML = `<div class="grow">🔒 <b>${esc(lock.name || "Someone")}</b>${lock.initials ? ` (${esc(lock.initials)})` : ""} is editing this — opened read-only.</div>
    <button class="btn acc sm" id="lk_takeover">Take over editing</button>`;
  const head = sheet.querySelector(".shead");
  if (head && head.nextSibling) sheet.insertBefore(ban, head.nextSibling); else sheet.appendChild(ban);
  const btn = document.getElementById("lk_takeover");
  if (btn) btn.onclick = function () { lockTakeOver(entity, recId); closeModal(); if (typeof reopenFn === "function") reopenFn(); };
}
