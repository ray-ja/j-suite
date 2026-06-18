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

/* ----- accessors ----- */
function msgColl() { return (D().messages || (D().messages = [])); }
function msgThreads() { return msgColl().filter(m => m && m.kind === "thread" && !m.deleted); }
function threadById(tid) { return msgColl().find(m => m && m.kind === "thread" && m.threadId === tid && !m.deleted); }
function threadMsgs(tid) { return msgColl().filter(m => m && !m.kind && !m.deleted && m.threadId === tid).sort((a, b) => (a.ts || 0) - (b.ts || 0)); }
function myUid() { const u = (typeof curUser === "function") ? curUser() : null; return u ? u.id : null; }
function msgCanBroadcast() { const k = (typeof curRoleKey === "function") ? curRoleKey() : "crew"; return k === "owner" || k === "admin" || k === "ceo"; }
function threadVisible(t, uid) {
  if (!uid) return false;
  if (t.type === "broadcast") return true;   // a broadcast is for EVERYONE signed in (crew included) — not just the post-time member snapshot (a crew member who joins/logs-in later must still see it)
  // EVERYTHING else (DM / availability / ops) is PARTICIPANT-STRICT: only members can see it.
  // Owner/admin do NOT pierce a private DM — role grants the ability to BROADCAST (msgCanBroadcast,
  // used for composing), never the ability to READ someone's private thread. (Cap privacy fix.)
  return (t.members || []).indexOf(uid) >= 0;
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
function msgPost(tid, body, senderLabelOverride) {
  const u = (typeof curUser === "function") ? curUser() : null; if (!u) { alert("Sign in to send."); return; }
  body = (body || "").trim(); if (!body) return;
  msgColl().push({ id: "msg_" + uid(), threadId: tid, senderId: u.id, senderLabel: senderLabelOverride || u.username || "—", body: body, ts: now(), deleted: false, updatedAt: now() });
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
  if (last >= (rm.lastReadTs || 0)) { rm.lastReadTs = last; rm.updatedAt = now(); }
}

/* ----- inbox ----- */
function rMessages() {
  if (!msgEnabled()) { view.innerHTML = `<div class="card"><div class="nm">Messages</div><div class="sub">Not active yet.</div></div>`; return; }
  const uid2 = myUid();
  const mine = msgThreads().filter(t => threadVisible(t, uid2)).sort((a, b) => {
    const la = threadMsgs(a.threadId).slice(-1)[0], lb = threadMsgs(b.threadId).slice(-1)[0];
    return ((lb ? lb.ts : b.updatedAt || 0) - (la ? la.ts : a.updatedAt || 0));
  });
  let h = `<div class="secthd"><h2>Messages</h2><div style="display:flex;gap:6px">
    <button class="btn acc sm" onclick="msgToStrategy()">✉️ Message Cap</button>
    ${msgCanBroadcast() ? `<button class="btn ghost sm" onclick="msgNew()">+ New</button>` : ``}</div></div>`;
  if (!mine.length) h += `<div class="empty"><div class="big">💬</div>No messages yet.</div>`;
  else h += mine.map(t => {
    const last = threadMsgs(t.threadId).slice(-1)[0], un = unreadCount(t.threadId, uid2);
    const snip = last ? (esc(last.senderLabel) + ": " + esc((last.body || "").slice(0, 60))) : `<span class="muted">No messages</span>`;
    return `<div class="li" onclick="msgOpen('${t.threadId}')"><div class="grow"><div class="nm">${esc(t.title || "Thread")}${t.availAsk ? ` <span class="badge" style="background:#e0a800;color:#1a1a1a">availability</span>` : ``}</div>
      <div class="sub" style="white-space:normal">${snip}</div></div>${un ? `<span class="badge" style="background:var(--danger);color:#fff">${un}</span>` : (last ? `<span class="sub">${fmtDate(new Date(last.ts).toISOString().slice(0, 10))}</span>` : ``)}</div>`;
  }).join("");
  view.innerHTML = h;
}

/* ----- thread view ----- */
window.msgOpen = function (tid) {
  if (!msgEnabled()) return;
  const t = threadById(tid); if (!t) { rMessages(); return; }
  const uid2 = myUid();
  if (!threadVisible(t, uid2)) { alert("You're not on this thread."); TAB = "today"; render(); return; }
  markRead(tid); save();
  const list = threadMsgs(tid).map(m => {
    const mineMsg = m.senderId === uid2;
    return `<div class="li" style="${mineMsg ? "background:var(--soft)" : ""}"><div class="grow"><div class="sub" style="font-weight:700">${esc(m.senderLabel || "—")}${mineMsg ? " · you" : ""} <span style="font-weight:400">· ${fmtDate(new Date(m.ts).toISOString().slice(0, 10))}</span></div><div style="white-space:pre-wrap">${esc(m.body)}</div></div></div>`;
  }).join("") || `<div class="muted">No messages yet.</div>`;
  let h = `<div class="secthd"><h2>${esc(t.title || "Thread")}</h2><button class="btn ghost sm" onclick="TAB='messages';render()">← Inbox</button></div>${list}`;
  if (t.availAsk) h += msgAvailChips(tid);
  h += `<div class="row" style="gap:8px;margin-top:12px"><textarea id="msg_reply" placeholder="Write a reply…" style="min-height:60px"></textarea></div>
    <button class="btn acc" style="margin-top:8px" onclick="msgSendReply('${tid}')">Send</button>`;
  view.innerHTML = h;
};
window.msgSendReply = function (tid) { const b = val("msg_reply"); if (!b) return; msgPost(tid, b); render(); };

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
function ensureCapThread(u) {
  const t = msgThreads().find(x => x.toStrategy && (x.members || []).indexOf(u.id) >= 0);
  if (t) return t.threadId;
  const tid = "thr_" + uid();
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
  let members, title;
  if (to === "__crew__") { members = crew.map(x => x.id); title = "Crew — Broadcast"; }
  else { const m = crew.find(x => x.id === to); members = [u ? u.id : null, to].filter(Boolean); title = m ? m.username : "Direct"; }
  const tid = "thr_" + uid();
  msgColl().push({ id: tid, kind: "thread", threadId: tid, title: title, type: to === "__crew__" ? "broadcast" : "dm", availAsk: availAsk, members: members, createdBy: u ? u.id : null, deleted: false, updatedAt: now() });
  if (body) msgPost(tid, body, asBiz ? (BIZ[S.biz] ? BIZ[S.biz].name : "The business") : null);
  else { save(); }
  closeModal(); TAB = "messages"; render();
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
      // a person's DM with Cap → labeled by who; kill the bare "Cap"/"Strategy"; drop the stray availability tag
      if (t.toStrategy || t.title === "Cap" || t.title === "Strategy") {
        const who = (typeof userName === "function" && userName((t.members || [])[0])) || "Crew";
        const nt = who + " ↔ Cap";
        if (t.title !== nt) { t.title = nt; t.updatedAt = now(); }
        if (!t.toStrategy) { t.toStrategy = true; t.updatedAt = now(); }
        if (t.availAsk && !t.availChannel) { t.availAsk = false; t.updatedAt = now(); }   // a DM is not an availability channel
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
