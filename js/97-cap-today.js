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
  capEnsureVoiceStyle();
  setTimeout(capScrollThread, 40);
  if (CAP_LISTENING) setTimeout(function () { capSetMicState(true); }, 0);   // restore recording state across a re-render mid-listen
  const header = `<div class="secthd"><h2>🧭 Cap</h2><span class="sub" style="margin-left:auto">your day, at a glance</span></div>`;
  // 🎤 voice input — only when the browser has SpeechRecognition AND a secure context (HTTPS Tailscale PWA); on
  // file://, plain http, or an unsupported browser the mic is HIDDEN and the panel is a normal text chat.
  const mic = capSpeechSupported()
    ? `<button id="cap-mic" class="btn ghost" style="flex:0 0 auto;width:auto;min-width:46px;padding:12px 14px;font-size:18px" onclick="capMicTap()" title="Tap to talk" aria-label="Talk to Cap">🎤</button>`
    : "";
  const panel = `<div class="card" style="border-top:4px solid var(--accent)">
    <div id="cap-thread" style="display:flex;flex-direction:column;gap:8px;max-height:340px;overflow-y:auto;-webkit-overflow-scrolling:touch">${capThreadInner()}</div>
    <div class="row" style="gap:6px;margin-top:10px">
      <input id="cap-input" placeholder="Ask Cap about today…" autocomplete="off" style="flex:1;min-width:0" onkeydown="if(event.key==='Enter'){event.preventDefault();capSend();}">
      ${mic}
      <button class="btn acc" style="flex:0 0 auto;width:auto" onclick="capSend()">Send</button>
    </div>
    ${capVoiceControls()}
    ${capOnline() ? "" : `<div class="muted" style="font-size:12px;margin-top:6px">Cap answers when you're signed in online.</div>`}
  </div>`;
  return header + panel;
}
/* the read-back toggle (voice mode only) OR the graceful-degradation hint when speech input isn't available. */
function capVoiceControls() {
  if (capSpeechSupported()) {
    if (!capSynthSupported()) return "";   // input works but no read-back voice → nothing to toggle
    const on = capReadbackOn();
    return `<div class="row" style="gap:8px;margin-top:6px;align-items:center">
      <button id="cap-voice-toggle" class="btn ghost sm" style="flex:0 0 auto" onclick="capToggleReadback()">${on ? "🔊 Read-back on" : "🔇 Read-back off"}</button>
      <span class="muted" style="font-size:11px">Cap speaks replies in voice mode</span></div>`;
  }
  // unavailable: one-line hint, then fall through to text
  try { if (typeof window !== "undefined" && !window.isSecureContext) return `<div class="muted" style="font-size:12px;margin-top:6px">🎤 Voice needs the app opened via the secure Tailscale link.</div>`; } catch (e) {}
  return `<div class="muted" style="font-size:12px;margin-top:6px">🎤 Voice input isn't supported on this browser — type to Cap instead.</div>`;
}
if (typeof window !== "undefined") window.capTodayPanel = capTodayPanel;

/* ----- send ----- */
function capErrLine(err) {
  if (err && /not set up/i.test(err)) return "Cap isn't switched on for this crew yet — an owner can enable it in Admin → Assistant.";
  if (err && /too many/i.test(err)) return "Give me a sec — a lot of questions at once. Try again in a moment.";
  return "Something went wrong reaching me — try again in a moment.";
}
/* voice === true → this turn was spoken (mic), so Cap READS its reply back (Ray's rule: speak in voice mode,
   SILENT when typed). Send/Enter call capSend() with no arg → voice is falsy → silent. The POST path is shared
   exactly — voice only decides read-back, never a different request. */
window.capSend = function (voice) {
  const inp = document.getElementById("cap-input"); if (!inp) return;
  const text = (inp.value || "").trim(); if (!text || CAP_BUSY) return;
  const spoken = voice === true;
  if (!capOnline()) {
    CAP_THREAD.push({ role: "user", content: text });
    const off = "I'm offline right now — I work when you're signed in online. Try again once you're connected.";
    CAP_THREAD.push({ role: "assistant", content: off });
    capSaveThread(); inp.value = ""; capRenderThread();
    if (spoken) capSpeakTurn(off, []);
    return;
  }
  CAP_THREAD.push({ role: "user", content: text }); capSaveThread(); inp.value = ""; CAP_BUSY = true; capRenderThread();
  const hist = CAP_THREAD.filter(m => m && (m.role === "user" || m.role === "assistant")).slice(-8);   // only the conversation, never action cards
  fetch(capBase() + "/api/org-ai/assistant", { method: "POST", headers: capHeaders(), body: JSON.stringify({ org: (typeof S !== "undefined" ? S.biz : ""), messages: hist, cats: (typeof RCPT_CATS !== "undefined" ? RCPT_CATS : []) }) })
    .then(r => r.json().then(j => ({ ok: r.ok, j: j })).catch(() => ({ ok: false, j: {} })))
    .then(res => {
      CAP_BUSY = false; const j = res.j || {};
      if (res.ok) {
        const reply = (typeof j.reply === "string") ? j.reply.trim() : "";
        if (reply) CAP_THREAD.push({ role: "assistant", content: reply });
        const acts = Array.isArray(j.actions) ? j.actions : [];
        acts.forEach(a => { if (a && typeof a.action === "string") CAP_THREAD.push({ role: "action", action: a, state: "pending", cid: capCid(), err: null }); });
        if (!reply && !acts.length) CAP_THREAD.push({ role: "assistant", content: "Got it." });
        capSaveThread(); capRenderThread();
        // read-back: speak the reply + each confirm-card's narration. The cards STILL render visually and still
        // require a thumb-tap to Confirm — voice never auto-confirms a mutating action (eyes verify the odometer).
        if (spoken) capSpeakTurn(reply || "Got it.", acts);
        return;
      }
      const el = capErrLine(j.error);
      CAP_THREAD.push({ role: "assistant", content: el });
      capSaveThread(); capRenderThread();
      if (spoken) capSpeakTurn(el, []);
    })
    .catch(() => { CAP_BUSY = false; const e = "Something went wrong reaching me — try again in a moment."; CAP_THREAD.push({ role: "assistant", content: e }); capSaveThread(); capRenderThread(); if (spoken) capSpeakTurn(e, []); });
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
/* the plan for a logExpense proposal — computed ONCE from local data so the confirm-card narration and the actual
   file agree (what you confirm is what you get). Merges Cap's clamped action with rcptSmartDefaults (js/98): a blank
   job/category inherits the smart default (clocked-in job, per-vendor memory); paidBy resolves to ME only when Cap
   said "self" (their own card → reimburse), else "" (no reimburse); cardLast4 comes from the smart default. Crew
   self-scoped: paidBy can NEVER be another person (server clamps to self/"" and the card is always the caller's). */
function capLogExpensePlan(a) {
  const me = (typeof curUser === "function") ? curUser() : null, meId = (me && me.id) || "";
  const d = (typeof rcptSmartDefaults === "function") ? (rcptSmartDefaults({ vendor: a.vendor, meId: meId }) || {}) : {};
  const jobId = a.jobId || d.jobId || "";
  return {
    amount: a.amount, vendor: a.vendor || "",
    type: a.type || (jobId ? "pass-through" : "business"),
    jobId: jobId,
    paidBy: (a.paidBy === "self") ? meId : "",
    cardLast4: d.cardLast4 || "",
    category: a.category || d.category || "",
    note: a.note || "", refund: !!a.refund, deposit: !!a.deposit
  };
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
  if (a.action === "logExpense") {
    const p = a._plan || (a._plan = capLogExpensePlan(a));
    const amt = (typeof money === "function") ? money(Math.abs(p.amount)) : ("$" + Math.abs(p.amount));
    const typeLabel = p.type === "pass-through" ? "🧱 pass-through" : p.type === "job-expense" ? "🔧 job expense" : "🏢 business";
    let dest = "";
    if (p.jobId) { const cust = capJobCust(capJob(p.jobId)); dest = " to " + esc(capJobTitle(p.jobId)) + (cust ? " — " + esc(cust) : ""); }
    const card = p.paidBy ? (" · your card" + (p.cardLast4 ? " ••••" + esc(p.cardLast4) : "")) : (p.cardLast4 ? " · card ••••" + esc(p.cardLast4) : "");
    const flags = (p.refund ? " · ↩ refund" : "") + (p.deposit ? " · ⚠ deposit" : "");
    return "💵 Log " + amt + (p.vendor ? " at " + esc(p.vendor) : "") + (p.note ? " — " + esc(p.note) : "")
      + " · " + typeLabel + dest + card + flags + " — Confirm?";
  }
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
  if (a.action === "logExpense") {
    if (typeof rcptFileFromFields !== "function") return { ok: false, error: "unavailable" };
    const me = (typeof curUser === "function") ? curUser() : null, meId = (me && me.id) || "";
    const p = a._plan || (a._plan = capLogExpensePlan(a));
    return rcptFileFromFields({
      amount: p.refund ? -Math.abs(p.amount) : p.amount, vendor: p.vendor, type: p.type, jobId: p.jobId,
      category: p.category, paidBy: p.paidBy, attributedTo: meId, desc: p.note,
      kind: p.refund ? "refund" : "", isDeposit: !!p.deposit
    }, { meId: meId });
  }
  return { ok: false, error: "unknown" };
}
function capAckLine(a) {
  if (a.action === "clockIn") return "Done — clocked in, drive safe. 👍";
  if (a.action === "clockOut") return "Done — clocked out. Nice work today.";
  if (a.action === "setOdometer") return "Got it — starting odometer saved.";
  if (a.action === "assignSelfToJob") return "Done — you're on " + capJobTitle(a.jobId) + ".";
  if (a.action === "markWorkDay") return "Done — marked as a work day.";
  if (a.action === "logExpense") {
    const p = a._plan || capLogExpensePlan(a);
    const amt = (typeof money === "function") ? money(Math.abs(p.amount)) : ("$" + Math.abs(p.amount));
    return "Done — logged " + amt + (p.vendor ? " at " + p.vendor : "") + ". 👍";
  }
  return "Done.";
}
function capErrForAction(res, a) {
  const err = res && res.error;
  // logExpense surfaces the receipt-engine's own plain-English validation message (rcptFileValidate) so Cap can
  // re-ask ("Pick a job for this receipt…"); only the "unavailable" code falls through to the generic line.
  if (a && a.action === "logExpense" && typeof err === "string" && err && err !== "unavailable") return err;
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

/* ============================ VOICE (Phase 3) — hands-free, secure-context gated ============================
   INPUT  = the Web Speech API SpeechRecognition (webkit fallback), tap-to-talk: live interim transcript in the
            input → on end, send it exactly like a typed message but flagged voice-initiated.
   OUTPUT = speechSynthesis read-back, but ONLY for voice-initiated turns (Ray: speak in voice mode, silent when
            typing). Cancels any in-flight utterance first.
   GATE   = feature-detect + window.isSecureContext. Missing/insecure → mic hidden, text still works, never throws.
            iOS Safari: recognition is flaky/gesture-gated; if it throws/never fires we degrade to text but KEEP
            synthesis read-back (iOS supports it). A browser with no APIs shows the normal text panel. */
let CAP_REC = null;          // the active SpeechRecognition instance (null = not listening)
let CAP_LISTENING = false;   // module-level so a rToday re-render can restore the recording state

function capSpeechSupported() {
  try {
    return !!(typeof window !== "undefined" && window.isSecureContext &&
      (typeof window.SpeechRecognition === "function" || typeof window.webkitSpeechRecognition === "function"));
  } catch (e) { return false; }
}
function capSynthSupported() {
  try { return !!(typeof window !== "undefined" && window.speechSynthesis && (typeof window.SpeechSynthesisUtterance === "function")); }
  catch (e) { return false; }
}
function capIsIOS() {
  try {
    const p = (navigator && navigator.platform) || "", ua = (navigator && navigator.userAgent) || "";
    return /iP(hone|ad|od)/.test(p) || /iP(hone|ad|od)/.test(ua) || (/Mac/.test(p) && (navigator.maxTouchPoints || 0) > 1);
  } catch (e) { return false; }
}

/* read-back preference — persisted per-user on the account (u.settings.capVoice, synced like theme) with a
   device localStorage fallback when signed out. Default = ON in voice mode (Ray's decision). */
function capReadbackOn() {
  const s = (typeof curUserSettings === "function") ? curUserSettings() : null;
  if (s && typeof s.capVoice === "boolean") return s.capVoice;
  try { const v = localStorage.getItem("cap_voice_readback"); if (v === "0") return false; if (v === "1") return true; } catch (e) {}
  return true;
}
window.capToggleReadback = function () {
  const next = !capReadbackOn();
  try { localStorage.setItem("cap_voice_readback", next ? "1" : "0"); } catch (e) {}   // device fallback
  const u = (typeof curUser === "function") ? curUser() : null;
  if (u) {
    u.settings = u.settings || {}; u.settings.capVoice = next;
    u.updatedAt = (typeof now === "function") ? now() : Date.now();
    if (typeof save === "function") save();
    try { if (typeof S !== "undefined" && S.sync && S.sync.url && S.sync.token && S.sync.auto && typeof syncNow === "function") syncNow(); } catch (e) {}
  }
  const b = document.getElementById("cap-voice-toggle"); if (b) b.textContent = next ? "🔊 Read-back on" : "🔇 Read-back off";
  if (!next) { try { if (capSynthSupported()) window.speechSynthesis.cancel(); } catch (e) {} }   // silence anything in flight
};

/* ----- OUTPUT: speak (voice-mode only) ----- */
function capStripForSpeech(s) {
  try {
    return String(s || "").replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ")
      .replace(/[←-⇿⌀-➿⬀-⯿️]/g, " ")   // arrows, misc-symbols, dingbats, variation-selector
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, " ")                    // any surrogate-pair emoji (🎤 ✅ 🚚 …)
      .replace(/\s+/g, " ").trim();
  } catch (e) { return String(s || ""); }
}
function capSpeak(text) {
  if (!capSynthSupported()) return;                         // synthesis absent → skip read-back, text still shows
  const t = capStripForSpeech(text); if (!t) return;
  try {
    window.speechSynthesis.cancel();                        // cancel any in-flight utterance before a new one
    const u = new SpeechSynthesisUtterance(t);
    u.lang = "en-US"; u.rate = 1; u.pitch = 1;
    window.speechSynthesis.speak(u);
  } catch (e) {}
}
/* speak Cap's reply, then each proposed action's plain-English narration (the same line the confirm card shows). */
function capSpeakTurn(reply, acts) {
  if (!capReadbackOn()) return;
  const parts = [];
  if (reply) parts.push(reply);
  (acts || []).forEach(a => { if (a && typeof a.action === "string") { try { parts.push(capNarrate(a)); } catch (e) {} } });
  const text = parts.join(". ").replace(/—/g, "-");
  if (text) capSpeak(text);
}

/* ----- INPUT: tap-to-talk ----- */
function capEnsureVoiceStyle() {
  try {
    if (typeof document === "undefined" || document.getElementById("cap-voice-style")) return;
    const st = document.createElement("style"); st.id = "cap-voice-style";
    st.textContent = "@keyframes capPulse{0%{box-shadow:0 0 0 0 rgba(192,57,43,.55)}70%{box-shadow:0 0 0 9px rgba(192,57,43,0)}100%{box-shadow:0 0 0 0 rgba(192,57,43,0)}}"
      + ".cap-mic-live{background:var(--danger,#c0392b)!important;color:#fff!important;animation:capPulse 1.25s infinite}";
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {}
}
function capSetMicState(live) {
  const b = document.getElementById("cap-mic"); if (!b) return;
  if (live) { b.classList.add("cap-mic-live"); b.textContent = "⏺"; b.title = "Listening… tap to stop"; }
  else { b.classList.remove("cap-mic-live"); b.textContent = "🎤"; b.title = "Tap to talk"; }
}
function capMicHint(msg) {   // one-off inline note under the input (degradation / permission problems)
  const inp = document.getElementById("cap-input"); if (!inp || !inp.parentNode || !inp.parentNode.parentNode) return;
  let n = document.getElementById("cap-mic-hint");
  if (!n) { n = document.createElement("div"); n.id = "cap-mic-hint"; n.className = "muted"; n.style.cssText = "font-size:12px;margin-top:6px"; inp.parentNode.parentNode.appendChild(n); }
  n.textContent = msg;
}
function capStopRec(send) {
  if (CAP_REC) { try { if (!send) CAP_REC.onend = null; CAP_REC.stop(); } catch (e) {} }
  if (!send) { CAP_REC = null; CAP_LISTENING = false; capSetMicState(false); }
}
window.capMicTap = function () {
  if (!capSpeechSupported()) return;                        // gated — button shouldn't exist, but never act if it does
  if (CAP_LISTENING) { capStopRec(true); return; }          // tap again → stop gracefully, send whatever was captured
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec;
  try { rec = new SR(); } catch (e) { capMicHint("Couldn't start the mic — type to Cap instead."); return; }
  try { if (capSynthSupported()) window.speechSynthesis.cancel(); } catch (e) {}   // stop Cap talking when you start talking
  rec.continuous = false; rec.interimResults = true; rec.lang = "en-US"; rec.maxAlternatives = 1;
  let finalText = "", aborted = false;
  rec.onresult = function (ev) {
    let interim = "", fin = "";
    try {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]; if (r.isFinal) fin += r[0].transcript; else interim += r[0].transcript;
      }
    } catch (e) {}
    if (fin) finalText += fin;
    const inp = document.getElementById("cap-input");
    if (inp) inp.value = (finalText + interim).replace(/\s+/g, " ").trim();   // live interim transcript in the input
  };
  rec.onerror = function (ev) {
    const err = ev && ev.error;
    if (err === "not-allowed" || err === "service-not-allowed") { aborted = true; capMicHint("Microphone permission is off — allow it in your browser, or type to Cap."); }
    else if (err === "no-speech") { aborted = true; }   // nothing captured → don't send
    else if (err === "aborted") { aborted = true; }
    // other errors (audio-capture, network): let onend send whatever transcript exists, else no-op
  };
  rec.onend = function () {
    CAP_REC = null; CAP_LISTENING = false; capSetMicState(false);
    const inp = document.getElementById("cap-input");
    const t = inp ? (inp.value || "").trim() : "";
    if (!aborted && t) window.capSend(true);   // VOICE-initiated send → read-back on the reply
  };
  CAP_REC = rec; CAP_LISTENING = true; capSetMicState(true);
  try { rec.start(); }
  catch (e) {   // iOS Safari can throw here (needs a fresh gesture / unsupported) → degrade to text, keep read-back
    CAP_REC = null; CAP_LISTENING = false; capSetMicState(false);
    capMicHint("Voice input didn't start" + (capIsIOS() ? " (Safari can be finicky)" : "") + " — type to Cap instead.");
  }
};
