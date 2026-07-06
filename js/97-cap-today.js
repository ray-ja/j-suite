/* ---------- CAP TODAY (Phase 1 — read-only conversational secretary) ----------
   The panel at the TOP of the Today page (replaces the notice board). Opens with the day's Sentinel digest
   (or a local templated opener), then a scrollable chat thread + a text input. Talks to the read-only
   /api/org-ai/assistant endpoint (member-gated + rate-limited server-side; NO actions this phase).

   Thread state lives in a module var (survives rToday re-renders) and is persisted per-user-per-DAY in
   localStorage (auto-expires on date rollover). It is NOT synced — no bloat, no data-loss surface. Actions
   (clock in/out, odometer, …) are Phase 2. Degrades gracefully with no server / no AI / offline — never blank.
   Reuses: curUser, esc, D, today, isOwner, editDoc, actJ, orgAiBase/orgAiHeaders (js/75). */

let CAP_THREAD = [];      // [{role:"user"|"assistant", content}] — the CURRENT day's conversation (opener is separate)
let CAP_BUSY = false;     // a request is in flight → show a typing bubble + block double-send

/* ----- server plumbing (mirror js/75 org-ai) ----- */
function capBase() { return (typeof orgAiBase === "function") ? orgAiBase() : (((typeof S !== "undefined" && S.sync && S.sync.url) || "").replace(/\/+$/, "")); }
function capHeaders() { return (typeof orgAiHeaders === "function") ? orgAiHeaders() : { "Content-Type": "application/json", "Authorization": "Bearer " + ((typeof S !== "undefined" && S.sync && S.sync.token) || "") }; }
function capOnline() { return !!capBase() && !!(typeof S !== "undefined" && S.sync && S.sync.token); }

/* ----- per-user-per-day localStorage (auto-expires on rollover; prunes yesterday's keys) ----- */
function capStoreKey() { const me = (typeof curUser === "function") ? curUser() : null; const t = (typeof today === "function") ? today() : ""; return "cap_today_" + ((me && me.id) || "anon") + "_" + t; }
function capLoadThread() {
  const key = capStoreKey();
  try {   // prune stale days for THIS user (keep the localStorage clean)
    const me = (typeof curUser === "function") ? curUser() : null, pfx = "cap_today_" + ((me && me.id) || "anon") + "_";
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.indexOf(pfx) === 0 && k !== key) localStorage.removeItem(k); }
  } catch (e) {}
  try { const a = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(a) ? a.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") : []; }
  catch (e) { return []; }
}
/* persist ONLY user/assistant turns — action confirm-cards are ephemeral, in-memory proposals (single-use; a
   reload should never re-surface a stale pending action). The durable outcome of a confirmed action lives in the
   timeclock/job records + logChange, and Cap's ack ("Done — clocked in") is a normal assistant turn that persists. */
function capSaveThread() { try { localStorage.setItem(capStoreKey(), JSON.stringify(CAP_THREAD.filter(m => m && (m.role === "user" || m.role === "assistant")).slice(-40))); } catch (e) {} }

/* ----- the opening bubble: today's Sentinel digest, else a local templated opener ----- */
function capLatestDigest() {
  try {
    const coll = (typeof D === "function" && D().messages) ? D().messages : [];
    const msgs = coll.filter(m => m && !m.kind && !m.deleted && m.threadId === "thr_crew_broadcast" && m.senderLabel === "Sentinel")
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return msgs.length ? msgs[msgs.length - 1] : null;
  } catch (e) { return null; }
}
function capLocalOpener() {   // plain text (escaped once by capThreadInner)
  const me = (typeof curUser === "function") ? curUser() : null;
  const t = (typeof today === "function") ? today() : "";
  let mine = [];
  try { mine = (typeof actJ === "function" ? actJ() : []).filter(j => j && !j.done && j.date === t && me && (j.crew || []).indexOf(me.id) >= 0).sort((a, b) => ((a.time || "") < (b.time || "") ? -1 : 1)); } catch (e) {}
  const hi = me ? ("Morning, " + (me.username || "") + " — ") : "Morning — ";
  if (!mine.length) return hi + "no jobs on your plate today. Ask me anything about today.";
  const first = mine[0];
  return hi + "you've got " + mine.length + " job" + (mine.length > 1 ? "s" : "") + " today, first is " + (first.title || "a job") + (first.time ? " at " + first.time : "") + ".";
}
function capOpening() {
  const d = capLatestDigest();
  if (d && d.body) {
    const dd = new Date(d.ts || 0), t = (typeof today === "function") ? today() : "";
    const iso = dd.getFullYear() + "-" + String(dd.getMonth() + 1).padStart(2, "0") + "-" + String(dd.getDate()).padStart(2, "0");
    if (iso === t) return { digest: true, text: d.body };
  }
  return { digest: false, text: capLocalOpener() };
}

/* ----- pinned strip (the folded notice board — owner-editable, preserves the `ceo` doc + Edit) ----- */
function capPinnedStrip() {
  const owner = (typeof isOwner === "function" && isOwner());
  const dir = (((typeof D === "function" ? D().docs : null) || []).find(x => x && x.id === "ceo" && !x.deleted) || {}).text || "";
  if (!dir && !owner) return "";
  return `<div class="card" style="align-self:stretch;border-left:4px solid var(--accent);margin:2px 0"><div class="row" style="align-items:flex-start;gap:8px"><div class="grow"><div class="nm" style="font-size:13px">📌 Pinned</div>` +
    (dir ? `<div style="white-space:pre-wrap;font-size:13px;line-height:1.45;margin-top:2px">${esc(dir)}</div>` : `<div class="muted" style="font-size:13px;margin-top:2px">Nothing pinned.</div>`) +
    `</div>${owner ? `<button class="btn ghost sm" style="flex:0 0 auto" onclick="editDoc('ceo','Pinned')">Edit</button>` : ``}</div></div>`;
}

/* ----- bubbles + thread render ----- */
function capBubble(kind, html) {
  const me = kind === "me";
  const style = me
    ? "align-self:flex-end;background:var(--accent);color:var(--accent-ink,#fff);border-radius:14px 14px 4px 14px"
    : "align-self:flex-start;background:var(--line,#eee);color:var(--ink,inherit);border-radius:14px 14px 14px 4px";
  return `<div style="max-width:88%;padding:8px 11px;font-size:14px;line-height:1.42;white-space:normal;${style}">${html}</div>`;
}
function capThreadInner() {
  const op = capOpening();
  let h = capBubble("cap", (op.digest ? "📣 " : "") + esc(op.text).replace(/\n/g, "<br>"));
  h += capPinnedStrip();
  CAP_THREAD.forEach(m => {
    if (m.role === "action") { h += capActionCard(m); return; }
    h += capBubble(m.role === "user" ? "me" : "cap", esc(m.content).replace(/\n/g, "<br>"));
  });
  // multi-action stack → a single "Confirm all (N)" shortcut when 2+ are still pending
  const pend = CAP_THREAD.filter(m => m && m.role === "action" && m.state === "pending").length;
  if (pend >= 2) h += `<div style="align-self:stretch;text-align:center;margin-top:2px"><button class="btn acc sm" onclick="capConfirmAll()">✅ Confirm all ${pend}</button></div>`;
  if (CAP_BUSY) h += capBubble("cap", '<span class="muted">Cap is typing…</span>');
  return h;
}
function capScrollThread() { const box = document.getElementById("cap-thread"); if (box) box.scrollTop = box.scrollHeight; }
function capRenderThread() { const box = document.getElementById("cap-thread"); if (box) { box.innerHTML = capThreadInner(); box.scrollTop = box.scrollHeight; } }

/* ----- the panel (top of rToday) ----- */
function capTodayPanel() {
  CAP_THREAD = capLoadThread();
  setTimeout(capScrollThread, 40);
  const header = `<div class="secthd"><h2>🧭 Cap</h2><span class="sub" style="margin-left:auto">your day, at a glance</span></div>`;
  const panel = `<div class="card" style="border-top:4px solid var(--accent)">
    <div id="cap-thread" style="display:flex;flex-direction:column;gap:8px;max-height:340px;overflow-y:auto;-webkit-overflow-scrolling:touch">${capThreadInner()}</div>
    <div class="row" style="gap:6px;margin-top:10px">
      <input id="cap-input" placeholder="Ask Cap about today…" autocomplete="off" style="flex:1" onkeydown="if(event.key==='Enter'){event.preventDefault();capSend();}">
      <button class="btn acc" style="flex:0 0 auto" onclick="capSend()">Send</button>
    </div>
    ${capOnline() ? "" : `<div class="muted" style="font-size:12px;margin-top:6px">Cap answers when you're signed in online.</div>`}
  </div>`;
  return header + panel;
}
if (typeof window !== "undefined") window.capTodayPanel = capTodayPanel;

/* ----- send ----- */
function capErrLine(err) {
  if (err && /not set up/i.test(err)) return "Cap isn't switched on for this crew yet — an owner can enable it in Admin → Assistant.";
  if (err && /too many/i.test(err)) return "Give me a sec — a lot of questions at once. Try again in a moment.";
  return "Something went wrong reaching me — try again in a moment.";
}
window.capSend = function () {
  const inp = document.getElementById("cap-input"); if (!inp) return;
  const text = (inp.value || "").trim(); if (!text || CAP_BUSY) return;
  if (!capOnline()) {
    CAP_THREAD.push({ role: "user", content: text });
    CAP_THREAD.push({ role: "assistant", content: "I'm offline right now — I work when you're signed in online. Try again once you're connected." });
    capSaveThread(); inp.value = ""; capRenderThread(); return;
  }
  CAP_THREAD.push({ role: "user", content: text }); capSaveThread(); inp.value = ""; CAP_BUSY = true; capRenderThread();
  const hist = CAP_THREAD.filter(m => m && (m.role === "user" || m.role === "assistant")).slice(-8);   // only the conversation, never action cards
  fetch(capBase() + "/api/org-ai/assistant", { method: "POST", headers: capHeaders(), body: JSON.stringify({ org: (typeof S !== "undefined" ? S.biz : ""), messages: hist }) })
    .then(r => r.json().then(j => ({ ok: r.ok, j: j })).catch(() => ({ ok: false, j: {} })))
    .then(res => {
      CAP_BUSY = false; const j = res.j || {};
      if (res.ok) {
        const reply = (typeof j.reply === "string") ? j.reply.trim() : "";
        if (reply) CAP_THREAD.push({ role: "assistant", content: reply });
        const acts = Array.isArray(j.actions) ? j.actions : [];
        acts.forEach(a => { if (a && typeof a.action === "string") CAP_THREAD.push({ role: "action", action: a, state: "pending", cid: capCid(), err: null }); });
        if (!reply && !acts.length) CAP_THREAD.push({ role: "assistant", content: "Got it." });
      } else {
        CAP_THREAD.push({ role: "assistant", content: capErrLine(j.error) });
      }
      capSaveThread(); capRenderThread();
    })
    .catch(() => { CAP_BUSY = false; CAP_THREAD.push({ role: "assistant", content: "Something went wrong reaching me — try again in a moment." }); capSaveThread(); capRenderThread(); });
};

/* ============================ CONFIRM-BEFORE-ACT — the action cards + dispatch ============================
   The server returns clamped PROPOSALS (never executes). Each renders as a single-use confirm card narrated in
   plain English from LOCAL data (resolved job title/customer/time, not raw ids). On Confirm → the mapped EXISTING
   client fn runs (clockIn→tcClockInWith, clockOut→tcClockOutWith, setOdometer→tcSetStartOdo, assignSelfToJob→
   capAssignSelf, markWorkDay→jobPageCommitDays). Cap acks; on Cancel it's dismissed; on a fn error the card shows
   it and Cap re-asks. Cards lock after Confirm/Cancel (single-use — the _tcInBusy/submit-guard pattern for dupes). */
function capCid() { return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function capNum(n) { try { return (+n).toLocaleString(); } catch (e) { return String(n); } }
function capJob(id) { try { return (typeof actJ === "function" ? actJ() : []).find(j => j && j.id === id) || null; } catch (e) { return null; } }
function capJobTitle(id) { const j = capJob(id); return (j && j.title) ? j.title : "a job"; }
function capJobCust(j) { try { return (j && j.customerId && typeof custName === "function") ? custName(j.customerId) : ""; } catch (e) { return ""; } }
function capMyOpen() { try { return (typeof tcMyOpen === "function") ? tcMyOpen() : null; } catch (e) { return null; } }
function capNowClock() { try { return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
function capFmtDay(d) { try { return (typeof fmtDate === "function" && d) ? fmtDate(d) : (d || (typeof today === "function" ? today() : "")); } catch (e) { return d || ""; } }
function capDur(ms) { try { return (typeof tcFmtDur === "function") ? tcFmtDur(ms) : ""; } catch (e) { return ""; } }

/* the plan for a clock-in proposal, computed once from local data (used by BOTH the card narration AND the
   dispatch so they always agree): if an odometer was given AND this crew has a pickable vehicle, clock in as the
   driver on the first vehicle with that starting odometer; otherwise a plain no-vehicle clock-in (odometer can't
   attach without a vehicle). Crew confirm the readback either way. */
function capClockInPlan(a) {
  const opts = (typeof tcVehicleOptionList === "function") ? (tcVehicleOptionList() || []) : [];
  let role = "none", vehicleEnc = "", vehicleLabel = "", odoStart = null;
  if (a.odometer != null && opts.length) {
    role = "driver"; vehicleEnc = opts[0].value; vehicleLabel = String(opts[0].label || "vehicle").replace(/^🚚\s*/, ""); odoStart = a.odometer;
  }
  return { job: capJob(a.jobId), role: role, vehicleEnc: vehicleEnc, vehicleLabel: vehicleLabel, odoStart: odoStart, odo: a.odometer };
}
function capNarrate(a) {
  if (a.action === "clockIn") {
    const plan = capClockInPlan(a), cust = capJobCust(plan.job);
    return "✅ Clock you in to " + esc(capJobTitle(a.jobId)) + (cust ? " — " + esc(cust) : "") + " at " + capNowClock()
      + (plan.role === "driver" ? (" · 🚚 " + esc(plan.vehicleLabel) + (plan.odoStart != null ? " · odometer " + capNum(plan.odoStart) : "")) : "") + " — Confirm?";
  }
  if (a.action === "clockOut") {
    const open = capMyOpen(), j = open ? capJob(open.jobId) : null, dur = open ? capDur(Date.now() - (open.clockIn || Date.now())) : "";
    return "⏱ Clock you out" + (j ? " of " + esc(j.title || "the job") : "") + (dur ? " — " + dur : "") + (a.odometer != null ? " · odometer " + capNum(a.odometer) : "") + " — Confirm?";
  }
  if (a.action === "setOdometer") { const open = capMyOpen(); return "📍 Set your starting odometer to " + capNum(a.miles) + (open && open.vehicle ? " on " + esc(open.vehicle) : "") + " — Confirm?"; }
  if (a.action === "assignSelfToJob") { const cust = capJobCust(capJob(a.jobId)); return "➕ Put you on " + esc(capJobTitle(a.jobId)) + (cust ? " — " + esc(cust) : "") + " — Confirm?"; }
  if (a.action === "markWorkDay") { return "📅 Mark " + esc(capFmtDay(a.date)) + " as a work day on " + esc(capJobTitle(a.jobId)) + " — Confirm?"; }
  return "Confirm this action?";
}
function capActionCard(item) {
  const st = item.state;
  let inner = `<div class="nm" style="font-size:13px;white-space:normal;line-height:1.4">${capNarrate(item.action)}</div>`;
  if (st === "pending") {
    inner += `<div class="row" style="gap:8px;margin-top:9px">
      <button class="btn acc" style="flex:1;min-height:42px" onclick="capConfirmAction('${item.cid}')">Confirm</button>
      <button class="btn ghost" style="flex:1;min-height:42px" onclick="capCancelAction('${item.cid}')">Cancel</button></div>`;
  } else if (st === "working") { inner += `<div class="muted" style="font-size:12px;margin-top:6px">Working…</div>`; }
  else if (st === "done") { inner += `<div style="font-size:12px;margin-top:6px;color:var(--accent);font-weight:800">✓ Done</div>`; }
  else if (st === "cancelled") { inner += `<div class="muted" style="font-size:12px;margin-top:6px">Cancelled</div>`; }
  else if (st === "error") { inner += `<div style="font-size:12px;margin-top:6px;color:var(--danger)">${esc(item.err || "Couldn't do that")}</div>`; }
  return `<div class="card" style="align-self:stretch;border-left:4px solid var(--accent);margin:2px 0;padding:10px">${inner}</div>`;
}

/* the mapped EXISTING client fns. assignSelfToJob + markWorkDay are tiny local helpers; the timeclock ones route
   through the shared tc*With cores in js/38 (same submit-lock, same records, same rules as the buttons). */
function capAssignSelf(jobId) {
  const me = (typeof curUser === "function") ? curUser() : null;
  const j = capJob(jobId);
  if (!j) return { ok: false, error: "not-found" };
  if (!me || !me.id) return { ok: false, error: "no-user" };
  j.crew = Array.isArray(j.crew) ? j.crew : [];
  if (j.crew.indexOf(me.id) < 0) j.crew.push(me.id);
  if (typeof touch === "function") touch(j);
  if (typeof save === "function") save();
  return { ok: true, entry: j };
}
function capMarkWorkDay(jobId, date) {
  const j = capJob(jobId);
  if (!j) return { ok: false, error: "not-found" };
  const cur = (typeof jobWorkDays === "function") ? jobWorkDays(j) : (Array.isArray(j.workDays) ? j.workDays : (j.date ? [j.date] : []));
  const day = date || (typeof today === "function" ? today() : "");
  if (!day) return { ok: false, error: "no-date" };
  if (cur.indexOf(day) < 0 && typeof jobPageCommitDays === "function") jobPageCommitDays(j, cur.concat([day]));
  return { ok: true, entry: j, day: day };
}
function capExecAction(a) {
  if (a.action === "clockIn") {
    if (typeof tcClockInWith !== "function") return { ok: false, error: "unavailable" };
    const plan = capClockInPlan(a); a._plan = plan;
    return tcClockInWith({ jobId: a.jobId, role: plan.role, vehicle: plan.vehicleEnc, odoStart: plan.role === "driver" ? plan.odoStart : null });
  }
  if (a.action === "clockOut") {
    if (typeof tcClockOutWith !== "function") return { ok: false, error: "unavailable" };
    const open = capMyOpen(); if (!open) return { ok: false, error: "not-open" };
    return tcClockOutWith(open.id, { odoEnd: a.odometer != null ? a.odometer : null });
  }
  if (a.action === "setOdometer") {
    if (typeof tcSetStartOdo !== "function") return { ok: false, error: "unavailable" };
    const open = capMyOpen(); if (!open) return { ok: false, error: "not-open" };
    return tcSetStartOdo(open.id, a.miles);
  }
  if (a.action === "assignSelfToJob") return capAssignSelf(a.jobId);
  if (a.action === "markWorkDay") return capMarkWorkDay(a.jobId, a.date);
  return { ok: false, error: "unknown" };
}
function capAckLine(a) {
  if (a.action === "clockIn") return "Done — clocked in, drive safe. 👍";
  if (a.action === "clockOut") return "Done — clocked out. Nice work today.";
  if (a.action === "setOdometer") return "Got it — starting odometer saved.";
  if (a.action === "assignSelfToJob") return "Done — you're on " + capJobTitle(a.jobId) + ".";
  if (a.action === "markWorkDay") return "Done — marked as a work day.";
  return "Done.";
}
function capErrForAction(res, a) {
  const err = res && res.error;
  if (err === "already-open") return "you're already clocked in — clock out first.";
  if (err === "not-open") return "you're not clocked in right now.";
  if (err === "odo-required") return "I need your ending odometer to close a driving shift — what does it read?";
  if (err === "odo-low") return "that reading is below your start (" + capNum(res.odoStart) + ") — what does the odometer read now?";
  if (err === "no-vehicle") return "no vehicle is set up to clock in as the driver.";
  if (err === "no-job") return "I couldn't tell which job.";
  if (err === "not-found") return "I couldn't find that job.";
  if (err === "unavailable") return "that isn't available right now.";
  return "something went wrong.";
}
window.capConfirmAction = function (cid) {
  const item = CAP_THREAD.find(m => m && m.role === "action" && m.cid === cid);
  if (!item || item.state !== "pending") return Promise.resolve();   // SINGLE-USE guard (kills rapid double-taps)
  item.state = "working"; capRenderThread();
  return Promise.resolve().then(() => capExecAction(item.action)).then(res => {
    if (res && res.ok) { item.state = "done"; CAP_THREAD.push({ role: "assistant", content: capAckLine(item.action) }); }
    else { item.state = "error"; item.err = "Couldn't do that — " + capErrForAction(res, item.action); CAP_THREAD.push({ role: "assistant", content: capErrForAction(res, item.action) + " Want me to try again?" }); }
    capSaveThread(); capRenderThread();
    try { if (typeof renderClockPill === "function") renderClockPill(); } catch (e) {}
  }).catch(() => { item.state = "error"; item.err = "Couldn't do that — something went wrong."; capSaveThread(); capRenderThread(); });
};
window.capCancelAction = function (cid) {
  const item = CAP_THREAD.find(m => m && m.role === "action" && m.cid === cid);
  if (!item || item.state !== "pending") return;   // single-use
  item.state = "cancelled";
  CAP_THREAD.push({ role: "assistant", content: "Okay, cancelled that." });
  capSaveThread(); capRenderThread();
};
window.capConfirmAll = function () {
  const pend = CAP_THREAD.filter(m => m && m.role === "action" && m.state === "pending");
  return pend.reduce((p, it) => p.then(() => window.capConfirmAction(it.cid)), Promise.resolve());
};
