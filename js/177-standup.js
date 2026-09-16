/* ---------- STAND-UP (js/177) — the 9 o'clock meeting, with a record ----------
   Ray, 2026-09-16: "Jason and I… every day we go to the warehouse and meet at nine in the morning… we're gonna
   have, like, a little stand up meeting every day at nine… If you have any questions for us or things that we
   need to know… we could do, like, a little recorded stand up area. Not audio recorded, but a record."

   TWO HALVES.
   1) THE AGENDA — built live from the org's own data, no typing: today's jobs (time, customer, who), to-dos due
      or overdue, bank charges waiting to be tagged, and QUESTIONS Claude/Cap left for the crew. The same agenda
      is posted to the Broadcast thread at 9:00 on weekdays by standup-post.js (crontab), so it is on their phones
      before they sit down.
   2) THE RECORD — one synced doc per day (docs: standup_<YYYY-MM-DD>): each person's "today I'm on" and
      "blockers", plus the answers to the questions. Questions live in docs: standup_questions {items:[{id, q,
      askedAt, answer, answeredBy, answeredAt}]} — Claude adds them from the back end, the crew answers on Today,
      Claude reads the answers from the store. Answered questions drop off the card and stay in the doc.

   ⚠️ NO render() ON KEYSTROKE (same rule as js/168): the inputs save on blur / Save, then re-render once.
   Docs is an existing synced collection (per-record LWW), so this adds no collection and no schema. */
const STANDUP_HOUR = 9;

/* ===================== pure (node-testable) ===================== */
/* the agenda for a day: jobs on that day, to-dos due/overdue, open questions. Every arg is plain data. */
function standupAgenda(day, jobs, todos, questions, names) {
  names = names || {};
  const nm = id => names[id] || id;
  const onDay = j => { const wd = Array.isArray(j.workDays) ? j.workDays.slice() : []; if (j.date) wd.push(j.date); return wd.indexOf(day) >= 0; };
  const jobRows = (jobs || []).filter(j => j && !j.deleted && !j.done && !Array.isArray(j.sharedJobIds) && onDay(j))
    .sort((a, b) => String(a.time || "99") < String(b.time || "99") ? -1 : 1)
    .map(j => ({ id: j.id, time: j.time || "", title: j.title || "Job", cust: j.cust || "", address: j.address || "", crew: (j.crew || []).map(nm) }));
  const due = (todos || []).filter(t => t && !t.deleted && !t.done && (t.due || t.planDate) && (t.planDate || t.due) <= day)
    .sort((a, b) => String(a.planDate || a.due) < String(b.planDate || b.due) ? -1 : 1)
    .map(t => ({ id: t.id, title: t.title || t.text || "", when: t.planDate || t.due, overdue: (t.due && t.due < day) || false }));
  const open = (questions || []).filter(q => q && q.q && !q.answer && !q.deleted);
  return { day: day, jobs: jobRows, due: due, questions: open };
}
/* the Broadcast text the cron posts (plain text, phone-sized) */
function standupText(a, extra) {
  extra = extra || {};
  const L = ["🧭 Stand-up · " + a.day];
  if (a.jobs.length) { L.push("", "Today's jobs"); a.jobs.forEach(j => L.push("• " + (j.time ? j.time + " " : "") + j.title + (j.cust ? " · " + j.cust : "") + (j.crew.length ? " · " + j.crew.join(" + ") : " · nobody assigned"))); }
  else L.push("", "No jobs on the schedule today.");
  if (a.due.length) { L.push("", "Due"); a.due.slice(0, 6).forEach(t => L.push("• " + t.title + (t.overdue ? " (overdue)" : ""))); if (a.due.length > 6) L.push("• +" + (a.due.length - 6) + " more"); }
  if (extra.toTag) L.push("", "💳 " + extra.toTag + " card charge" + (extra.toTag === 1 ? "" : "s") + " waiting to be tagged (Finance → Transactions)");
  if (extra.arOpen) L.push("💸 Open invoices: " + extra.arOpen);
  if (a.questions.length) { L.push("", "Questions for the crew (answer on Today)"); a.questions.forEach(q => L.push("? " + q.q)); }
  L.push("", "Write what you're each on today in the Stand-up card on Today.");
  return L.join("\n");
}

/* ===================== live data ===================== */
function standupDoc(id, create) {
  const d = D(); if (!Array.isArray(d.docs)) d.docs = [];
  let doc = d.docs.find(x => x && x.id === id && !x.deleted);
  if (!doc && create) { doc = { id: id, updatedAt: (typeof now === "function") ? now() : Date.now() }; d.docs.push(doc); }
  return doc || null;
}
function standupQuestions() { const doc = standupDoc("standup_questions", false); return (doc && Array.isArray(doc.items)) ? doc.items : []; }
function standupToday() { return (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10); }
function standupNames() { const m = {}; ((typeof schedMembers === "function") ? schedMembers() : []).forEach(u => { m[u.id] = u.username; }); ((typeof S !== "undefined" && S.users) || []).forEach(u => { if (u && u.username && !m[u.id]) m[u.id] = u.username; }); return m; }
function standupLiveAgenda(day) {
  const d = D(); const names = standupNames();
  const jobs = (d.jobs || []).map(j => Object.assign({}, j, { cust: j.customerId && typeof custName === "function" ? custName(j.customerId) : "" }));
  return standupAgenda(day, jobs, d.todos || [], standupQuestions(), names);
}
function standupSaveAll() { if (typeof save === "function") save(); if (typeof scheduleAutoPush === "function") scheduleAutoPush(); }

if (typeof window !== "undefined") {
  window.standupSaveNote = function (day) {
    const me = (typeof curUser === "function") ? curUser() : null; if (!me) { alert("Sign in first."); return; }
    const plan = (document.getElementById("su_plan") || {}).value || "", blockers = (document.getElementById("su_block") || {}).value || "";
    const doc = standupDoc("standup_" + day, true); doc.date = day; doc.notes = doc.notes || {};
    doc.notes[me.id] = { plan: plan.trim().slice(0, 600), blockers: blockers.trim().slice(0, 600), by: me.username, at: Date.now() };
    if (typeof touch === "function") touch(doc); standupSaveAll();
    if (typeof toast === "function") toast("Stand-up saved"); render();
  };
  window.standupAnswer = function (qid) {
    const me = (typeof curUser === "function") ? curUser() : null; if (!me) { alert("Sign in first."); return; }
    const el = document.getElementById("su_q_" + qid); const a = (el && el.value || "").trim(); if (!a) return;
    const doc = standupDoc("standup_questions", true); doc.items = doc.items || [];
    const q = doc.items.find(x => x && x.id === qid); if (!q) return;
    q.answer = a.slice(0, 600); q.answeredBy = me.username; q.answeredAt = Date.now();
    if (typeof touch === "function") touch(doc);
    /* mirror onto the day's record so the day reads whole on its own */
    const dd = standupDoc("standup_" + standupToday(), true); dd.date = standupToday(); dd.answers = dd.answers || {}; dd.answers[qid] = { q: q.q, a: q.answer, by: me.username };
    if (typeof touch === "function") touch(dd);
    standupSaveAll(); if (typeof toast === "function") toast("Answer saved"); render();
  };
  window.standupToggleYesterday = function () { window.__suYest = !window.__suYest; render(); };
}

/* ===================== the Today card ===================== */
function standupCardHTML() {
  if (typeof orgHasTab === "function" && !orgHasTab("jobs")) return "";   // business orgs only
  const day = standupToday();
  const a = standupLiveAgenda(day);
  const me = (typeof curUser === "function") ? curUser() : null;
  const owner = (typeof isOwner === "function") && isOwner();
  const doc = standupDoc("standup_" + day, false);
  const mine = (doc && doc.notes && me && doc.notes[me.id]) || { plan: "", blockers: "" };
  const others = (doc && doc.notes) ? Object.keys(doc.notes).filter(id => !me || id !== me.id).map(id => doc.notes[id]) : [];
  const toTag = (owner && typeof btxInboxCount === "function") ? btxInboxCount() : 0;
  const fd = d => (typeof fmtDate === "function") ? fmtDate(d) : d;
  let h = `<div class="card" style="border-left:4px solid var(--brand)"><div class="row" style="align-items:center"><div class="grow"><div class="nm" style="font-size:16px">🧭 Stand-up · ${STANDUP_HOUR}:00</div><div class="sub">${esc(fd(day))} · what's on, who's on it, what's in the way</div></div></div>`;
  // agenda
  h += `<div style="margin-top:8px">` + (a.jobs.length
    ? a.jobs.map(j => `<div class="li" onclick="openJobPage('${j.id}')" style="cursor:pointer"><div class="grow"><div class="nm" style="font-size:14px">${j.time ? `<b>${esc(j.time)}</b> · ` : ""}${esc(j.title)}</div><div class="sub" style="white-space:normal">${esc(j.cust)}${j.address ? " · " + esc(j.address) : ""} · ${j.crew.length ? "👷 " + esc(j.crew.join(" + ")) : '<span style="color:var(--danger)">nobody assigned</span>'}</div></div></div>`).join("")
    : `<div class="sub">No jobs on the schedule today.</div>`) + `</div>`;
  if (a.due.length) h += `<div class="sub" style="margin-top:6px;white-space:normal"><b>Due:</b> ` + a.due.slice(0, 5).map(t => esc(t.title) + (t.overdue ? ' <span style="color:var(--danger)">overdue</span>' : "")).join(" · ") + (a.due.length > 5 ? " · +" + (a.due.length - 5) + " more" : "") + `</div>`;
  if (toTag) h += `<div class="sub" style="margin-top:4px"><a href="#" onclick="event.preventDefault();TAB='finance';if(typeof finSub==='function')finSub('bank');">💳 ${toTag} card charge${toTag === 1 ? "" : "s"} to tag</a></div>`;
  // questions from Claude / Cap
  if (a.questions.length) {
    h += `<div style="margin-top:10px;padding:8px 10px;background:var(--soft);border-radius:8px"><div class="nm" style="font-size:13px">❓ Questions for you</div>` +
      a.questions.map(q => `<div style="margin-top:6px"><div style="font-size:13.5px;white-space:normal">${esc(q.q)}</div><div class="row" style="gap:6px;margin-top:4px"><input id="su_q_${esc(q.id)}" placeholder="answer" style="flex:1;min-width:0" onkeydown="if(event.key==='Enter')standupAnswer('${esc(q.id)}')"><button class="btn acc sm" style="flex:0 0 auto" onclick="standupAnswer('${esc(q.id)}')">Save</button></div></div>`).join("") + `</div>`;
  }
  // my record
  h += `<div style="margin-top:10px"><label>Today I'm on</label><textarea id="su_plan" rows="2" placeholder="what you're doing today" style="width:100%">${esc(mine.plan || "")}</textarea>
    <label style="margin-top:6px">In the way</label><input id="su_block" placeholder="blockers, waiting on, need from someone" style="width:100%" value="${esc(mine.blockers || "")}">
    <button class="btn acc sm" style="margin-top:8px" onclick="standupSaveNote('${day}')">Save my stand-up</button></div>`;
  if (others.length) h += `<div style="margin-top:8px">` + others.map(n => `<div class="li" style="align-items:flex-start"><div class="grow"><div class="nm" style="font-size:13.5px">${esc(n.by || "")}</div><div class="sub" style="white-space:normal">${esc(n.plan || "")}${n.blockers ? `<br>⚠ ${esc(n.blockers)}` : ""}</div></div></div>`).join("") + `</div>`;
  // yesterday, folded
  const yd = (typeof plAddDays === "function") ? plAddDays(day, -1) : ""; const ydoc = yd ? standupDoc("standup_" + yd, false) : null;
  if (ydoc && ydoc.notes && Object.keys(ydoc.notes).length) {
    h += `<div class="sub" style="margin-top:8px;cursor:pointer" onclick="standupToggleYesterday()">${(typeof window !== "undefined" && window.__suYest) ? "▲" : "▼"} Yesterday</div>`;
    if (typeof window !== "undefined" && window.__suYest) h += Object.keys(ydoc.notes).map(id => { const n = ydoc.notes[id]; return `<div class="sub" style="white-space:normal;margin-top:2px"><b>${esc(n.by || "")}</b>: ${esc(n.plan || "")}${n.blockers ? " · ⚠ " + esc(n.blockers) : ""}</div>`; }).join("");
  }
  return h + `</div>`;
}
if (typeof window !== "undefined") window.standupCardHTML = standupCardHTML;

if (typeof module !== "undefined" && module.exports) { module.exports = { standupAgenda: standupAgenda, standupText: standupText, STANDUP_HOUR: STANDUP_HOUR }; }
