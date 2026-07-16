/* ---------- CREW MESSAGING (in-app inbox / threads) ----------
   Owner/Admin/CEO → crew comms riding the synced `messages` collection (per-record LWW, stable ids;
   see js/02 blank()/load() + server COLLECTIONS). Records are kind-discriminated within the one
   collection: {kind:"thread"} descriptor, {kind:"read"} per-(user×thread) high-water marker, and
   plain messages (no kind). Read state is a separate per-user marker so two recipients never clobber
   each other (see sync-server-tests). Availability replies write STRUCTURED data (flip the crew
   member's real availability) — not text Strategy must parse.

   ROLLOUT GATE: OFF by default (production). While off the nav tab is hidden + unreachable and
   nothing sends. DEV wire-test enables it via the dev-only shell flag window.DEV_MESSAGING (set in
   the `dev` branch shell, like window.DEV_NO_LOGIN) — production never sets it, so prod stays OFF.
   Production activation (no redeploy): set MESSAGING_ON=1 (env) / ceo-config.json {messagingOn:true}
   + restart — the server injects window.JSUITE_MESSAGING=true into the shell. DEV uses window.DEV_MESSAGING. */
let MSG_ENABLED = (typeof window !== "undefined" && (window.JSUITE_MESSAGING === true || window.DEV_MESSAGING === true));
function msgEnabled() { return MSG_ENABLED === true; }
let MSG_OPEN = null;   // open thread id (null = inbox list). Persisted so a sync re-render keeps you IN the thread (no kick-back).
window.msgResetOpen = function () { MSG_OPEN = null; };

/* ----- accessors ----- */
function msgColl() { return (D().messages || (D().messages = [])); }
function msgThreads() { return msgColl().filter(m => m && m.kind === "thread" && !m.deleted); }
/* viewer-relative title: who you're talking to — pinned 📢 Broadcast / 📋 a per-job Cap thread / "Cap" / the other member's name(s). */
function jobThreadLabel(t){
  if(!t||!t.jobId) return "";
  const j=(typeof actJ==="function")?actJ().find(x=>x&&x.id===t.jobId):null;
  const cust=(j&&j.customerId&&typeof custName==="function")?custName(j.customerId):"";
  const name=(j&&j.title)||(t.title?String(t.title).replace(/^Cap\s·\s/,""):"")||"Job";
  return "📋 Job: "+name+((cust&&cust!=="—")?" · "+cust:"");
}
function threadTitle(t){ if(!t) return "Thread"; if(t.type==="broadcast") return "📢 Broadcast"; if(t.jobId) return jobThreadLabel(t); if(t.sender==="sentinel"||t.title==="Sentinel") return "Sentinel"; const me=myUid(); const o=(t.members||[]).filter(id=>id!==me).map(id=>userName(id)).filter(Boolean); return o.length?o.join(", "):"Cap"; }
/* one canonical crew broadcast thread — reuse, never spawn a new one. */
function ensureBroadcastThread(){ const t=msgThreads().find(x=>x.type==="broadcast"); if(t) return t.threadId; const tid="thr_crew_broadcast"; const crew=(typeof realAccounts==="function"?realAccounts():(S.users||[]).filter(x=>x&&!x.kind&&!x.deleted)).filter(x=>x.active!==false).map(x=>x.id); msgColl().push({id:tid,kind:"thread",threadId:tid,title:"Broadcast",type:"broadcast",members:crew,createdBy:myUid(),deleted:false,updatedAt:now()}); return tid; }
function threadById(tid) { return msgColl().find(m => m && m.kind === "thread" && m.threadId === tid && !m.deleted); }
function threadMsgs(tid) { return msgColl().filter(m => m && !m.kind && !m.deleted && m.threadId === tid).sort((a, b) => (a.ts || 0) - (b.ts || 0)); }
function myUid() { const u = (typeof curUser === "function") ? curUser() : null; return u ? u.id : null; }
function msgCanBroadcast() { const k = (typeof curRoleKey === "function") ? curRoleKey() : "crew"; return k === "owner" || k === "admin" || k === "ceo"; }
/* the crew (user ids) assigned to a jobId thread's job — the shared-job-thread membership source of truth.
   Looks up the job in the active biz first, then any loaded biz (migration runs per-biz, not just active). */
function jobThreadCrew(t) {
  if (!t || !t.jobId) return [];
  let j = (typeof actJ === "function") ? actJ().find(x => x && x.id === t.jobId && !x.deleted) : null;
  if (!j) { for (const b of ["obx", "jam"]) { const Sb = S[b]; if (Sb && Array.isArray(Sb.jobs)) { const f = Sb.jobs.find(x => x && x.id === t.jobId && !x.deleted); if (f) { j = f; break; } } } }
  return (j && Array.isArray(j.crew)) ? j.crew.filter(Boolean) : [];
}
function threadVisible(t, uid) {
  if (!uid) return false;
  if (t.type === "broadcast") return true;   // a broadcast is for EVERYONE signed in (crew included) — not just the post-time member snapshot (a crew member who joins/logs-in later must still see it)
  // A JOB thread is the ONE shared "📋 Job: …" conversation everyone on the job + Cap share. Visible to
  // any member OR anyone currently on the job's crew (so the whole crew sees the same thread even if the
  // member snapshot lags). This widen is ONLY for jobId threads — DMs stay strict (below).
  if (t.jobId) return (t.members || []).indexOf(uid) >= 0 || jobThreadCrew(t).indexOf(uid) >= 0;
  // EVERYTHING else (DM / availability / ops) is PARTICIPANT-STRICT: only members can see it.
  // Owner/admin do NOT pierce a private DM — role grants the ability to BROADCAST (msgCanBroadcast,
  // used for composing), never the ability to READ someone's private thread. (Cap privacy fix.)
  return (t.members || []).indexOf(uid) >= 0;
}
/* fold the job's crew (+ the current viewer) into a shared job thread's members, so server-side push /
   Cap-reply fan-out (which is members-driven) reaches the whole crew. Returns true if it changed. */
function ensureJobThreadMembers(t) {
  if (!t || !t.jobId) return false;
  const want = jobThreadCrew(t).slice(); const me = myUid(); if (me && want.indexOf(me) < 0) want.push(me);
  const have = t.members || (t.members = []); let changed = false;
  want.forEach(id => { if (id && have.indexOf(id) < 0) { have.push(id); changed = true; } });
  if (changed) t.updatedAt = now();
  return changed;
}
function readMarker(tid, uid) { return msgColl().find(m => m && m.kind === "read" && m.threadId === tid && m.userId === uid); }
function unreadCount(tid, uid) { const rm = readMarker(tid, uid), last = rm ? (rm.lastReadTs || 0) : 0; return threadMsgs(tid).filter(m => (m.ts || 0) > last && m.senderId !== uid).length; }
function totalUnread() { const uid = myUid(); if (!uid) return 0; return msgThreads().filter(t => threadVisible(t, uid)).reduce((n, t) => n + unreadCount(t.threadId, uid), 0); }

/* ----- nav unread badge (called every render via applyAccess) ----- */
function updateMsgBadge() {
  const el = document.getElementById("msgbadge"); if (!el) return;
  const n = msgEnabled() ? totalUnread() : 0;
  if (n > 0) { el.textContent = n > 99 ? "99+" : String(n); el.style.display = ""; }
  else { el.textContent = ""; el.style.display = "none"; }
}
window.updateMsgBadge = updateMsgBadge;

/* ----- write helpers ----- */
let MSG_PENDING = null;   // an uploaded-but-unsent photo id for the reply composer
function msgPost(tid, body, senderLabelOverride, attachments) {
  const u = (typeof curUser === "function") ? curUser() : null; if (!u) { alert("Sign in to send."); return; }
  body = (body || "").trim(); attachments = (attachments || []).filter(a => a && a.id);
  if (!body && !attachments.length) return;
  msgColl().push({ id: "msg_" + uid(), threadId: tid, senderId: u.id, senderLabel: senderLabelOverride || u.username || "—", body: body, ts: now(), attachments: attachments.length ? attachments : undefined, deleted: false, updatedAt: now() });
  markRead(tid);   // your own send counts as read
  if (typeof logChange === "function") logChange("create", "message", tid, "Message in " + tid);
  save();
}
function markRead(tid) {
  const uid2 = myUid(); if (!uid2) return;
  const last = threadMsgs(tid).reduce((mx, m) => Math.max(mx, m.ts || 0), 0);
  const id = "rd_" + tid + "_" + uid2;   // deterministic → one record per user×thread, monotonic LWW
  let rm = msgColl().find(m => m && m.id === id);
  if (!rm) { rm = { id: id, kind: "read", threadId: tid, userId: uid2, lastReadTs: 0, updatedAt: 0 }; msgColl().push(rm); }
  if (last > (rm.lastReadTs || 0)) { rm.lastReadTs = last; rm.updatedAt = now(); }   // strict: don't churn updatedAt (and sync) on a no-op re-render
}

/* ----- inbox ----- */
function rMessages() {
  if (!msgEnabled()) { view.innerHTML = `<div class="card"><div class="nm">Messages</div><div class="sub">Not active yet.</div></div>`; return; }
  // keep shared job threads' members in step with the job crew (crew added to a job later → see the thread)
  let _mc = false; msgThreads().forEach(t => { if (t.jobId && ensureJobThreadMembers(t)) _mc = true; }); if (_mc && typeof save === "function") save();
  if (MSG_OPEN) {   // a thread is open → keep rendering IT across sync re-renders (the kick-back fix)
    const ot = threadById(MSG_OPEN);
    if (ot && threadVisible(ot, myUid())) { renderThread(MSG_OPEN); return; }
    MSG_OPEN = null;   // thread gone/invisible → fall back to the inbox
  }
  const uid2 = myUid();
  const mine = msgThreads().filter(t => threadVisible(t, uid2)).sort((a, b) => {
    // the broadcast thread is always pinned first, above DMs / job threads
    if ((a.type === "broadcast") !== (b.type === "broadcast")) return a.type === "broadcast" ? -1 : 1;
    const la = threadMsgs(a.threadId).slice(-1)[0], lb = threadMsgs(b.threadId).slice(-1)[0];
    return ((lb ? lb.ts : b.updatedAt || 0) - (la ? la.ts : a.updatedAt || 0));
  });
  // "+ New" on its OWN row below the title (mobile-friendly — no longer crammed into the header)
  let h = `<div class="secthd"><h2>Messages</h2></div>`;
  if (msgCanBroadcast()) h += `<div class="row" style="margin-bottom:10px"><button class="btn ghost sm" onclick="msgNew()">+ New</button></div>`;
  if (!mine.length) h += `<div class="empty"><div class="big">💬</div>No messages yet.</div>`;
  else h += mine.map(t => {
    const last = threadMsgs(t.threadId).slice(-1)[0], un = unreadCount(t.threadId, uid2);
    const snip = last ? (esc(last.senderLabel) + ": " + esc((last.body || "").slice(0, 60))) : `<span class="muted">No messages</span>`;
    const capTick = last ? (last.capRead ? ` <span title="Cap read it" style="color:var(--accent);font-weight:800">✓✓</span>` : last.capReceived ? ` <span title="Cap received it" style="color:var(--muted);font-weight:800">✓</span>` : "") : "";
    // owner/admin may delete a whole thread (soft-delete + tombstone its messages) — never on broadcast (the one canonical crew channel)
    const delThread = (msgCanBroadcast() && t.type !== "broadcast") ? `<button class="btn ghost sm" title="Delete thread" onclick="event.stopPropagation();msgDeleteThread('${t.threadId}')" style="color:var(--danger)">🗑</button>` : ``;
    return `<div class="li" onclick="msgOpen('${t.threadId}')"><div class="grow"><div class="nm">${esc(threadTitle(t))}${t.availAsk ? ` <span class="badge" style="background:#e0a800;color:#1a1a1a">availability</span>` : ``}</div>
      <div class="sub" style="white-space:normal">${snip}${capTick}</div></div>${un ? `<span class="badge" style="background:var(--danger);color:#fff">${un}</span>` : (last ? `<span class="sub">${relTime(last.ts)}</span>` : ``)}${delThread}</div>`;
  }).join("");
  view.innerHTML = h;
}

/* who has read message m in thread tid — Cap (capRead) + crew whose read-marker is at/after m.ts (i.e. they opened the thread after it). Shown on hover; never on the inbox (seeing a preview ≠ opening). */
function msgReadersTip(tid, m) {
  const t = threadById(tid); if (!t || !m) return "";
  const names = [];
  if (m.capRead) names.push("Cap");
  (t.members || []).forEach(uid => {
    if (uid === m.senderId) return;
    const rm = readMarker(tid, uid);
    if (rm && (rm.lastReadTs || 0) >= (m.ts || 0)) names.push((typeof userName === "function" && userName(uid)) || uid);
  });
  return names.length ? ("Read by " + names.join(", ")) : "Not read yet";
}
/* ----- thread view ----- */
function renderThread(tid) {
  const t = threadById(tid); if (!t) { MSG_OPEN = null; rMessages(); return; }
  const uid2 = myUid();
  const _prev = document.getElementById("msg_reply");   // preserve an in-progress reply across sync re-renders
  const _draft = _prev ? _prev.value : "", _focused = !!_prev && document.activeElement === _prev;
  const _selS = _prev ? _prev.selectionStart : 0, _selE = _prev ? _prev.selectionEnd : 0;
  // preserve the message-list scroll across sync re-renders: stay pinned to newest ONLY if already near the bottom
  const _oldList = document.getElementById("msglist");
  const _wasNearBottom = _oldList ? (_oldList.scrollHeight - _oldList.scrollTop - _oldList.clientHeight < 80) : true;
  const _oldTop = _oldList ? _oldList.scrollTop : null;
  markRead(tid); save();
  const list = threadMsgs(tid).map(m => {
    const mineMsg = m.senderId === uid2;
    const _att = (m.attachments || []).filter(a => a && a.id && !a.deleted);
    const _attHtml = _att.length ? `<div class="msg-atts">` + _att.map(a => { const u = (typeof jsUploadUrl === "function") ? jsUploadUrl(a.id) : ""; return `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" loading="lazy"></a>`; }).join("") + `</div>` : "";
    const canDel = mineMsg || msgCanBroadcast();   // your OWN message always; any message for owner/admin (soft-delete/tombstone)
    const delBtn = canDel ? `<button class="msg-del" title="Delete message" onclick="msgDelete('${tid}','${m.id}')">🗑</button>` : ``;
    const ticks = m.capRead ? ` <span title="Cap read it" style="color:var(--accent);font-weight:800">✓✓</span>` : m.capReceived ? ` <span title="Cap received it" style="color:var(--muted);font-weight:800">✓</span>` : "";
    return `<div class="msgrow ${mineMsg ? "me" : "them"}" title="${esc(msgReadersTip(tid, m))}"><div class="bubble"><div class="msg-meta">${esc(m.senderLabel || "—")}${mineMsg ? " · you" : ""} · ${relTime(m.ts)}${ticks}</div><div class="msg-text">${esc(m.body)}</div>${_attHtml}</div>${delBtn}</div>`;
  }).join("") || `<div class="muted" style="text-align:center;padding:24px 8px">No messages yet — say hi.</div>`;
  const availHtml = t.availAsk ? msgAvailChips(tid) : "";
  const pendHtml = MSG_PENDING ? `<div class="row" style="gap:8px;margin-bottom:6px;align-items:center"><img src="${(typeof jsUploadUrl === "function") ? jsUploadUrl(MSG_PENDING) : ""}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;border:1px solid var(--line)"><span class="sub">photo attached</span><button class="btn ghost sm" onclick="msgClearPhoto()">✕</button></div>` : "";
  view.innerHTML = `<div class="msgpane" id="msgpane">`
    + `<div class="secthd msgpane-hd"><h2>${esc(threadTitle(t))}</h2><button class="btn ghost sm" onclick="msgBack()">← Inbox</button></div>`
    + `<div class="msglist" id="msglist">${list}</div>`
    + `<div class="msgcompose">${availHtml}${pendHtml}`
    + `<div class="row" style="gap:8px;align-items:flex-end"><textarea id="msg_reply" placeholder="Write a reply…" rows="1"></textarea>`
    + `<input type="file" id="msg_photo" accept="image/*" style="display:none" onchange="msgAddPhoto(this)">`
    + `<button class="btn ghost sm" title="Add photo" onclick="document.getElementById('msg_photo').click()">📷</button>`
    + `<button class="btn acc" onclick="msgSendReply('${tid}')">Send</button></div></div></div>`;
  const _ta = document.getElementById("msg_reply");
  if (_ta) { if (_draft) _ta.value = _draft; if (_focused) { _ta.focus(); try { _ta.setSelectionRange(_selS, _selE); } catch (e) {} } }
  msgFitPane(_wasNearBottom, _oldTop);
}
/* size the chat pane to fill the space between the header and the fixed bottom nav so the MESSAGE LIST scrolls
   internally (not the page) and opens pinned to the newest message. Re-fits on resize (keyboard open / rotate). */
function msgFitPane(toBottom, restoreTop) {
  const pane = document.getElementById("msgpane"); if (!pane) return;
  let reserve = 0;
  try {
    const navEl = document.querySelector("nav");
    const navH = (navEl && getComputedStyle(navEl).position === "fixed") ? navEl.offsetHeight : 0;
    const padB = parseInt(getComputedStyle(document.body).paddingBottom) || 0;
    reserve = Math.max(navH, padB);
  } catch (e) {}
  const top = pane.getBoundingClientRect().top;
  pane.style.height = Math.max(240, window.innerHeight - top - reserve - 4) + "px";
  const ml = document.getElementById("msglist"); if (!ml) return;
  if (toBottom) ml.scrollTop = ml.scrollHeight;
  else if (restoreTop != null) ml.scrollTop = restoreTop;
  if (!window._msgFitBound) {
    window._msgFitBound = true;
    window.addEventListener("resize", function () { if (MSG_OPEN && document.getElementById("msgpane")) msgFitPane(true, null); });
  }
}
window.msgOpen = function (tid) {
  if (!msgEnabled()) return;
  const t = threadById(tid); if (!t) { MSG_OPEN = null; rMessages(); return; }
  if (!threadVisible(t, myUid())) { alert("You're not on this thread."); TAB = "today"; render(); return; }
  MSG_OPEN = tid;
  renderThread(tid);
};
window.msgBack = function () { MSG_OPEN = null; render(); };
window.msgSendReply = function (tid) { const b = val("msg_reply"); const atts = MSG_PENDING ? [{ id: MSG_PENDING, ts: now() }] : []; if (!b && !atts.length) return; msgPost(tid, b, null, atts); MSG_PENDING = null; const _ta = document.getElementById("msg_reply"); if (_ta) _ta.value = ""; render(); };
window.msgAddPhoto = function (input) { const file = input && input.files && input.files[0]; if (!file) return; if (typeof jsUpload !== "function") { alert("Photo needs a connection."); return; } jsUpload(file).then(function (id) { MSG_PENDING = id; render(); }).catch(function (e) { alert("Upload failed: " + (e.message || e)); }); };
window.msgClearPhoto = function () { MSG_PENDING = null; render(); };

/* ----- soft-delete (tombstone) — your own message always; any message + whole threads for owner/admin.
   Client-side check is UX-only; the SERVER re-enforces it (sanitizeMessageDeletes) so a non-admin can
   never tombstone another user's record. NEVER hard-remove — bump updatedAt so LWW keeps the tombstone. */
window.msgDelete = function (tid, mid) {
  if (!msgEnabled()) return;
  const u = (typeof curUser === "function") ? curUser() : null; if (!u) { alert("Sign in first."); return; }
  const m = msgColl().find(x => x && x.id === mid && !x.kind); if (!m || m.deleted) return;
  if (!(m.senderId === u.id || msgCanBroadcast())) { alert("You can only delete your own messages."); return; }
  if (!confirm("Delete this message?")) return;
  m.deleted = true; m.updatedAt = now();
  if (typeof logChange === "function") logChange("delete", "message", mid, "Message deleted in " + tid);
  save(); render();
};
window.msgDeleteThread = function (tid) {
  if (!msgEnabled() || !msgCanBroadcast()) return;
  const t = threadById(tid); if (!t || t.type === "broadcast") return;
  if (!confirm("Delete this whole thread? This hides it for everyone.")) return;
  t.deleted = true; t.updatedAt = now();                                  // tombstone the thread record
  msgColl().forEach(m => { if (m && m.threadId === tid && !m.deleted) { m.deleted = true; m.updatedAt = now(); } });   // + tombstone its messages/read markers (LWW-safe)
  if (typeof logChange === "function") logChange("delete", "thread", tid, "Thread deleted");
  if (MSG_OPEN === tid) MSG_OPEN = null;
  save(); render();
};

/* ----- availability quick-replies: write STRUCTURED availability data, not text ----- */
function msgAvailChips(tid) {
  const days = [];
  for (let i = 0; i < 5; i++) { const ds = (i === 0) ? today() : addDays(today(), i); days.push(ds); }
  const lbl = ds => (ds === today() ? "today" : (DOW[dowOf(ds)]));
  return `<div class="card" style="margin-top:12px;border-left:4px solid #e0a800">
    <div class="nm" style="font-size:15px">Quick reply — update your availability</div>
    <div class="sub" style="margin-bottom:8px">Tap a day, then a status. This updates your real availability (Strategy sees the data).</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      <button class="btn acc sm" onclick="availQuickSet('${tid}','${today()}','full')">🟢 Available now</button>
      <button class="btn ghost sm" onclick="availQuickSet('${tid}','${today()}','off')">🔴 Off today</button>
    </div>
    <div class="sub" style="margin-top:10px">Mark a day available:</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
      ${days.map(ds => `<button class="btn ghost sm" onclick="availQuickSet('${tid}','${ds}','full')">🟢 ${lbl(ds)}</button>`).join("")}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
      ${days.map(ds => `<button class="btn ghost sm" onclick="availQuickSet('${tid}','${ds}','off')">🔴 ${lbl(ds)}</button>`).join("")}
    </div></div>`;
}
window.availQuickSet = function (tid, ds, v) {
  const u = (typeof curUser === "function") ? curUser() : null; if (!u) { alert("Sign in first."); return; }
  if (!u.avail) u.avail = { days: [false, true, true, true, true, true, false], start: "08:00", end: "17:00" };
  if (!u.avail.overrides) u.avail.overrides = {};
  u.avail.overrides[ds] = v;                  // STRUCTURED write to the real availability data
  touch(u);                                   // per-record account LWW (rides existing sync)
  if (typeof logChange === "function") logChange("update", "account", u.id, "Availability " + ds + " → " + v);
  const word = v === "full" ? "available" : (v === "off" ? "not available" : v);
  const when = ds === today() ? "today" : (DOW[dowOf(ds)] + " " + fmtDate(ds));
  msgPost(tid, "✅ I'm " + word + " " + when + ".");   // structured confirmation back into the thread
  render();
};

/* ----- user-initiated: anyone (crew + owner) starts/opens their thread TO Strategy -----
   The missing half of two-way: crew can reach Strategy unprompted. The thread is availAsk so the
   structured availability quick-replies appear too — crew can send availability without being asked.
   Strategy reads it via GET /api/ceo?view=messages and replies via the scoped write path. */
/* the (existing or new) private DM thread between this user and Cap (participant-scoped: [user]; Cap reads via the read path) */
function capDmTitle(u) { return ((typeof userName === "function" && userName(u.id)) || u.username || "Crew") + " ↔ Cap"; }
function capThreadId(u) { return "thr_cap_" + u.id; }   // DETERMINISTIC → one canonical Cap DM per user (so receipt-checks/briefs fold into it instead of spawning dup "Cap" rows; multi-device converges, no dup)
function ensureCapThread(u) {
  // reuse the canonical thread, then ANY pre-existing toStrategy thread for this user (legacy random ids)
  const t = threadById(capThreadId(u)) || msgThreads().find(x => x.toStrategy && (x.members || []).indexOf(u.id) >= 0);
  if (t) return t.threadId;
  const tid = capThreadId(u);
  msgColl().push({ id: tid, kind: "thread", threadId: tid, title: capDmTitle(u), type: "dm", toStrategy: true, members: [u.id], createdBy: u.id, deleted: false, updatedAt: now() });
  save();
  return tid;
}
window.msgToStrategy = function () {
  if (!msgEnabled()) return;
  const u = (typeof curUser === "function") ? curUser() : null;
  if (!u) { alert("Sign in first."); return; }
  msgOpen(ensureCapThread(u));
};

/* ----- compose (broadcaster only) ----- */
window.msgNew = function () {
  if (!msgEnabled() || !msgCanBroadcast()) return;
  const u = (typeof curUser === "function") ? curUser() : null;
  const crew = (typeof realAccounts === "function" ? realAccounts() : (S.users || []).filter(x => x && !x.kind && !x.deleted)).filter(x => x.active !== false);
  const dmOpts = crew.filter(x => !u || x.id !== u.id).map(x => `<option value="${x.id}">${esc(x.username)}</option>`).join("");
  modal("New message", `
    <label>Send to</label>
    <select id="mn_to"><option value="__cap__">💬 Cap (private)</option><option value="__crew__">📣 All crew (broadcast)</option>${dmOpts}</select>
    <label style="margin-top:8px"><input type="checkbox" id="mn_avail"> Availability check (adds tap-to-update chips for the crew)</label>
    <label style="margin-top:8px">As</label>
    <select id="mn_as"><option value="me">${esc((u && u.username) || "Me")}</option><option value="biz">${esc(BIZ[S.biz] ? BIZ[S.biz].name : "The business")}</option></select>
    <label style="margin-top:8px">Message</label>
    <textarea id="mn_body" style="min-height:90px" placeholder="What do you want to tell the crew?"></textarea>
    <button class="btn acc" style="margin-top:12px" onclick="msgCreate()">Send</button>`);
};
window.msgCreate = function () {
  const to = val("mn_to"), body = val("mn_body");
  const availAsk = !!(document.getElementById("mn_avail") || {}).checked;
  const u = (typeof curUser === "function") ? curUser() : null;
  const asBiz = val("mn_as") === "biz";
  if (!body && !availAsk) { alert("Write a message."); return; }
  if (to === "__cap__") {   // private DM to Cap — reuse the user's existing Cap thread (no duplicates)
    if (!u) { alert("Sign in first."); return; }
    const tid = ensureCapThread(u);
    if (body) msgPost(tid, body);
    closeModal(); msgOpen(tid); return;
  }
  const crew = (typeof realAccounts === "function" ? realAccounts() : (S.users || []).filter(x => x && !x.kind && !x.deleted)).filter(x => x.active !== false);
  let tid;
  if (to === "__crew__") { tid = ensureBroadcastThread(); }
  else {
    const m = crew.find(x => x.id === to); const members = [u ? u.id : null, to].filter(Boolean); const title = m ? m.username : "Direct";
    tid = "thr_" + uid();
    msgColl().push({ id: tid, kind: "thread", threadId: tid, title: title, type: "dm", availAsk: availAsk, members: members, createdBy: u ? u.id : null, deleted: false, updatedAt: now() });
  }
  if (body) msgPost(tid, body, asBiz ? (BIZ[S.biz] ? BIZ[S.biz].name : "The business") : null);
  else { save(); }
  closeModal(); if (typeof msgResetOpen === "function") msgResetOpen(); TAB = "messages"; render();
};

/* ----- Messages information-architecture cleanup (Cap, one-time; guarded by S.msgIAv1 in load) -----
   Clear, unmistakable labels + no system noise in the crew's view. Idempotent + NON-DESTRUCTIVE:
   only edits thread titles/flags and tombstones the malformed all-member "Cap" ops broadcast — never
   touches a message record. Runs on the client, so the relabels ride the normal sync up to prod. */
function migrateThreadIA() {
  ["obx", "jam"].forEach(b => {
    const Sb = S[b]; if (!Sb || !Array.isArray(Sb.messages)) return;
    const coll = Sb.messages;
    coll.forEach(t => {
      if (!t || t.kind !== "thread" || t.deleted) return;
      // the malformed all-member "Cap" broadcast = system/ops alerts that leaked into the crew view → kill it.
      // (ONLY title "Cap" — the REAL crew broadcast is titled "Strategy"/"Crew" and must be relabeled, not killed.)
      if (t.type === "broadcast" && t.title === "Cap") { t.deleted = true; t.updatedAt = now(); return; }
      // the real crew broadcast (incl. the leftover "Strategy" name) → one unmistakable label
      if (t.type === "broadcast") { if (t.title !== "Crew — Broadcast") { t.title = "Crew — Broadcast"; t.updatedAt = now(); } return; }
      // a JOB thread is the ONE shared "📋 Job: …" conversation. Old per-user threads were keyed
      // thr_job_<jobId>_<uid>; migrate them into the shared thr_job_<jobId> (re-point messages + reads,
      // retire the per-user thread record) so nothing is lost and the crew converges on one thread.
      if (t.jobId) {
        const shared = "thr_job_" + t.jobId;
        if (t.threadId !== shared) {
          // re-point this per-user thread's messages + read markers onto the shared thread id
          coll.forEach(m => {
            if (!m || m.deleted || m.threadId !== t.threadId) return;
            if (!m.kind) { m.threadId = shared; m.updatedAt = now(); }                 // a message → move it
            else if (m.kind === "read") { m.deleted = true; m.updatedAt = now(); }      // a per-user read marker → drop (re-derived against the shared thread)
          });
          // ensure the shared thread record exists (reuse this record's title if we're the first)
          let sh = coll.find(x => x && x.kind === "thread" && x.threadId === shared && !x.deleted);
          if (!sh) { sh = { id: shared, kind: "thread", threadId: shared, title: t.title || "Job", type: "dm", toStrategy: true, jobId: t.jobId, members: [], createdBy: t.createdBy || "__ceo__", deleted: false, updatedAt: now() }; coll.push(sh); }
          ensureJobThreadMembers(sh);
          t.deleted = true; t.updatedAt = now();   // retire the per-user thread record
        } else {
          ensureJobThreadMembers(t);   // already shared → keep its members in step with the job crew
        }
        return;
      }
      // a Sentinel-sender thread → its OWN unmistakable "Sentinel" label, kept distinct from Cap. Never folded.
      if (t.sender === "sentinel" || t.title === "Sentinel") { if (t.title !== "Sentinel") { t.title = "Sentinel"; t.updatedAt = now(); } return; }
      // a per-user DM with Cap (incl. receipt-checks/briefs Cap spawned titled "Cap") → CONSOLIDATE into the
      // ONE canonical Cap DM per user (thr_cap_<uid>), so the inbox never shows multiple identical "Cap" rows.
      const member = (t.members || []).filter(Boolean)[0];
      // a dedicated per-crew Availability CHANNEL is its own intentional thread — never fold it into the Cap DM
      const isCapDm = member && !t.availChannel && (t.members || []).filter(Boolean).length === 1 && (t.toStrategy || t.title === "Cap" || t.title === "Strategy" || t.createdBy === "__ceo__");
      if (isCapDm) {
        const canon = "thr_cap_" + member;
        if (t.threadId !== canon) {
          // re-point this duplicate's messages onto the canonical Cap thread; drop its per-user read marker; retire it
          coll.forEach(m => {
            if (!m || m.deleted || m.threadId !== t.threadId) return;
            if (!m.kind) { m.threadId = canon; m.updatedAt = now(); }
            else if (m.kind === "read") { m.deleted = true; m.updatedAt = now(); }
          });
          let sh = coll.find(x => x && x.kind === "thread" && x.threadId === canon && !x.deleted);
          if (!sh) { sh = { id: canon, kind: "thread", threadId: canon, title: ((typeof userName === "function" && userName(member)) || "Crew") + " ↔ Cap", type: "dm", toStrategy: true, members: [member], createdBy: member, deleted: false, updatedAt: now() }; coll.push(sh); }
          t.deleted = true; t.updatedAt = now();
        } else {
          const nt = ((typeof userName === "function" && userName(member)) || "Crew") + " ↔ Cap";
          if (t.title !== nt) { t.title = nt; t.updatedAt = now(); }
          if (!t.toStrategy) { t.toStrategy = true; t.updatedAt = now(); }
          if (t.availAsk && !t.availChannel) { t.availAsk = false; t.updatedAt = now(); }   // a DM is not an availability channel
        }
        return;
      }
    });
    // ensure a dedicated per-crew Availability channel (obx = the crew-comms business) where Cap logs scheduling
    if (b === "obx") {
      const crew = (S.users || []).filter(u => u && !u.kind && !u.deleted && u.role === "crew");
      crew.forEach(u => {
        const has = coll.some(t => t.kind === "thread" && !t.deleted && t.availChannel && (t.members || []).indexOf(u.id) >= 0);
        if (!has) {
          const tid = "thr_avail_" + u.id;
          coll.push({ id: tid, kind: "thread", threadId: tid, title: ((typeof userName === "function" && userName(u.id)) || "Crew") + " — Availability", type: "dm", availAsk: true, availChannel: true, members: [u.id], createdBy: "__ceo__", deleted: false, updatedAt: now() });
        }
      });
    }
  });
}
window.migrateThreadIA = migrateThreadIA;
