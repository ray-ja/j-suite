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
function capSaveThread() { try { localStorage.setItem(capStoreKey(), JSON.stringify(CAP_THREAD.slice(-40))); } catch (e) {} }

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
  CAP_THREAD.forEach(m => { h += capBubble(m.role === "user" ? "me" : "cap", esc(m.content).replace(/\n/g, "<br>")); });
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
  fetch(capBase() + "/api/org-ai/assistant", { method: "POST", headers: capHeaders(), body: JSON.stringify({ org: (typeof S !== "undefined" ? S.biz : ""), messages: CAP_THREAD.slice(-8) }) })
    .then(r => r.json().then(j => ({ ok: r.ok, j: j })).catch(() => ({ ok: false, j: {} })))
    .then(res => {
      CAP_BUSY = false; const j = res.j || {};
      CAP_THREAD.push({ role: "assistant", content: (res.ok && typeof j.reply === "string") ? j.reply : capErrLine(j.error) });
      capSaveThread(); capRenderThread();
    })
    .catch(() => { CAP_BUSY = false; CAP_THREAD.push({ role: "assistant", content: "Something went wrong reaching me — try again in a moment." }); capSaveThread(); capRenderThread(); });
};
