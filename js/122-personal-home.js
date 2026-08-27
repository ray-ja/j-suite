/* ---------- PERSONAL HOME (js/122) — the personal org's Today page ------------------------------------
   Ray, 2026-08-03: "can you make the personal organization something that I can turn to when I need to talk?
   As a business owner, a solopreneur, it gets kinda lonely… I just need help organizing, someplace I can vent,
   someone I can talk to about hobbies and interests… just make it a nice place for me to visit. Make me want
   to visit it."

   DESIGNED FOR THE EMPTY STATE FIRST. Across 852 deploy snapshots the personal org has never held a single
   journal entry, tracker, to-do or transaction. So a page that leads with "no entries yet" would be the whole
   experience. The talk box is therefore the anchor: it works on the very first visit with zero data, and every
   other surface here either helps him start something in one tap or stays silent.

   NOT CAP. Cap is work (OBX / Jamieson) and is hidden on this org. This is a separate thing on a separate
   persona with no tools and no business data — see PERSONAL_COMPANION_SYSTEM in sync-server.js.

   NOT THERAPY. He was emphatic and it is honoured in the system prompt, not just here.

   The conversation is per-day localStorage (same proven pattern as js/97 — device-local, never synced, no data
   loss surface). Venting is not silently filed anywhere; if a conversation was worth keeping he taps "Save to
   journal" and it becomes a normal lifeNotes entry he owns. */

let PH_THREAD = [];
let PH_BUSY = false;

/* ---- plumbing (mirrors js/75) ---- */
function phBase() { return (typeof orgAiBase === "function") ? orgAiBase() : (((typeof S !== "undefined" && S.sync && S.sync.url) || "").replace(/\/+$/, "")); }
function phHeaders() { return (typeof orgAiHeaders === "function") ? orgAiHeaders() : { "Content-Type": "application/json", "Authorization": "Bearer " + ((typeof S !== "undefined" && S.sync && S.sync.token) || "") }; }
function phOnline() { return !!phBase() && !!(typeof S !== "undefined" && S.sync && S.sync.token); }
function phMe() { return (typeof curUser === "function") ? curUser() : null; }
function phToday() { return (typeof today === "function") ? today() : ""; }

/* ---- per-day thread (device-local, never synced) ---- */
function phKey() { const me = phMe(); return "ph_talk_" + ((me && me.id) || "anon") + "_" + ((typeof S !== "undefined" && S.biz) || "") + "_" + phToday(); }
function phLoad() {
  const key = phKey();
  try {
    const me = phMe(), pfx = "ph_talk_" + ((me && me.id) || "anon") + "_", suf = "_" + phToday();
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.indexOf(pfx) === 0 && k.slice(-suf.length) !== suf) localStorage.removeItem(k); }
  } catch (e) {}
  /* `action` is a third role (2026-08-25) — a proposed calendar/to-do/reminder card. It has no `content`,
     so the old filter would have silently dropped every one of them on reload. */
  try { const a = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(a) ? a.filter(m => m && ((m.role === "action" && m.action) || ((m.role === "user" || m.role === "assistant") && typeof m.content === "string"))) : []; }
  catch (e) { return []; }
}
function phSave() { try { localStorage.setItem(phKey(), JSON.stringify(PH_THREAD.slice(-60))); } catch (e) {} }

/* ---- INTERESTS — the things he's into. Stored in `docs` (an existing synced collection) so this adds no
       new collection and needs no migration. Fed to the companion so it has something real to talk about. ---- */
function phInterestsDoc() {
  const d = D(); d.docs = d.docs || [];
  let t = d.docs.find(x => x && x.id === "personalInterests");
  if (!t) { t = { id: "personalInterests", list: [], updatedAt: (typeof now === "function") ? now() : Date.now() }; d.docs.push(t); }
  if (!Array.isArray(t.list)) t.list = [];
  return t;
}
function phInterests() { return phInterestsDoc().list.filter(x => x && !x.deleted); }
/* Interests carry a CATEGORY and an `aspiration` flag.
   The flag exists because of something Ray said precisely: philosophy, languages (Russian, then Chinese, then
   Japanese) and the keyboard are "things I like the idea of, but I've never actually gotten good at."
   Those must NEVER become nags. An app that reminds him of his unfinished ambitions is the same guilt machine
   the check-in thread turned into — see PERSONAL_COMPANION_SYSTEM, which is told to treat them as things to be
   curious about, never to chase. */
const PH_CATS = [
  { key: "reading", label: "Reading" },
  { key: "games",   label: "Games" },
  { key: "ideas",   label: "Ideas & learning" },
  { key: "faith",   label: "Faith" },
  { key: "music",   label: "Music" },
  { key: "other",   label: "Other" }
];
function phCatLabel(k) { const c = PH_CATS.find(x => x.key === k); return c ? c.label : "Other"; }

function phInterestListHTML() {
  const list = phInterests();
  if (!list.length) return '<div class="muted" style="font-size:13px">Nothing yet.</div>';
  let h = "";
  PH_CATS.forEach(function (c) {
    const inCat = list.filter(i => (i.cat || "other") === c.key);
    if (!inCat.length) return;
    h += '<div class="sub" style="font-weight:700;margin-top:8px">' + esc(c.label) + '</div>';
    inCat.forEach(function (i) {
      h += '<div class="row" style="gap:6px;align-items:center;margin-top:3px">'
        + '<div class="grow" style="font-size:13.5px">' + esc(i.label)
        + (i.aspiration ? ' <span class="muted" style="font-size:11px">· want to get back to</span>' : '')
        + '</div>'
        + '<button class="btn ghost sm" onclick="phDelInterest(\'' + i.id + '\')">✕</button></div>';
    });
  });
  return h;
}
function phRefreshInterestList() {
  const el = document.getElementById("ph_int_list");
  if (el) el.innerHTML = phInterestListHTML();
}

/* THE ENTER FIX. Ray: "I tried adding them manually, but it's really slow because I can't hit enter."
   He was right — there was no key handler, so every item meant reaching for a button, and saving rebuilt the
   whole modal and threw away focus. Now: Enter adds, the field clears and KEEPS focus, and only the list below
   re-renders. You can rattle off twenty things without leaving the keyboard. */
if (typeof window !== "undefined") window.phAddInterest = function () {
  modal("Things you're into", ''
    + '<div class="sub" style="white-space:normal;margin-bottom:8px">Type one and hit Enter. Keep going — it stays open.</div>'
    + '<label>Add</label><input id="ph_int" placeholder="e.g. Morrowind, sci-fi, Age of Mythology" autocomplete="off" '
    + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();phSaveInterest();}">'
    + '<label style="margin-top:8px">Category</label>'
    + '<select id="ph_int_cat">' + PH_CATS.map(c => '<option value="' + c.key + '">' + esc(c.label) + '</option>').join("") + '</select>'
    + '<label class="toggle" style="margin-top:8px"><input type="checkbox" id="ph_int_asp"> Something I want to get back to</label>'
    + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="phSaveInterest()">Add</button>'
    + '<div id="ph_int_list" style="border-top:1px solid var(--line);margin-top:12px;padding-top:8px">' + phInterestListHTML() + '</div>');
  setTimeout(function () { const el = document.getElementById("ph_int"); if (el) el.focus(); }, 60);
};
if (typeof window !== "undefined") window.phSaveInterest = function () {
  const inp = document.getElementById("ph_int"); if (!inp) return;
  const v = (inp.value || "").trim(); if (!v) return;
  const catEl = document.getElementById("ph_int_cat"), aspEl = document.getElementById("ph_int_asp");
  const t = phInterestsDoc();
  t.list.push({ id: "int-" + (typeof uid === "function" ? uid() : String(Date.now())),
                label: v.slice(0, 80),
                cat: (catEl && catEl.value) || "other",
                aspiration: !!(aspEl && aspEl.checked) });
  t.updatedAt = (typeof now === "function") ? now() : Date.now();
  if (typeof touch === "function") touch(t);
  if (typeof save === "function") save();
  inp.value = "";                 // clear, KEEP focus, refresh only the list — no modal rebuild
  phRefreshInterestList();
  inp.focus();
};
if (typeof window !== "undefined") window.phDelInterest = function (id) {
  const t = phInterestsDoc(); const i = t.list.find(x => x && x.id === id); if (i) i.deleted = true;
  t.updatedAt = (typeof now === "function") ? now() : Date.now();
  if (typeof touch === "function") touch(t);
  if (typeof save === "function") save();
  phRefreshInterestList();
  const el = document.getElementById("ph_int"); if (el) el.focus();
};

/* ---- a greeting that reads like a person, not a dashboard ---- */
function phGreeting() {
  const me = phMe(), name = (me && me.username) ? String(me.username).split(/\s+/)[0] : "";
  let h = 12; try { h = new Date().getHours(); } catch (e) {}
  const part = h < 5 ? "Late one" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : h < 22 ? "Evening" : "Late one";
  return part + (name ? ", " + name : "");
}

/* ---- bubbles ---- */
function phBubble(kind, html) {
  const me = kind === "me";
  const style = me
    ? "align-self:flex-end;background:var(--accent);color:var(--accent-ink,#fff);border-radius:14px 14px 4px 14px"
    : "align-self:flex-start;background:var(--line,#eee);color:var(--ink,inherit);border-radius:14px 14px 14px 4px";
  return '<div style="max-width:88%;padding:9px 12px;font-size:14.5px;line-height:1.45;white-space:normal;' + style + '">' + html + '</div>';
}
function phThreadInner() {
  let h = "";
  if (!PH_THREAD.length) {
    h += '<div class="muted" style="font-size:13.5px;line-height:1.5;white-space:normal;padding:2px 2px 6px">'
      + 'Nothing you say here goes anywhere else — not to the crew, not into the business. '
      + 'Talk about the day, or something that has nothing to do with work.</div>';
  }
  PH_THREAD.forEach(m => {
    if (m.role === "action") { h += phActionCard(m); return; }          // a card, not a bubble
    h += phBubble(m.role === "user" ? "me" : "them", esc(m.content).replace(/\n/g, "<br>"));
  });
  if (PH_BUSY) h += phBubble("them", '<span class="muted">…</span>');
  return h;
}
function phRender() { const b = document.getElementById("ph-thread"); if (b) { b.innerHTML = phThreadInner(); b.scrollTop = b.scrollHeight; } }

/* ---- the talk card: the anchor of this page, works with zero data ---- */
function phTalkCard() {
  /* ⛔ NO "Save to journal" BUTTON. Ray, 2026-08-25: "in the text chat, there shouldn't be a save to
     journal button. That's… those are separate things." Talking to me and keeping a journal are two
     different acts, and a button that quietly turns one into the other blurs them. The Journal tab is where
     journal entries are written. */
  const clearBtn = PH_THREAD.length
    ? '<button class="btn ghost sm" style="flex:0 0 auto" onclick="phClear()">Clear</button>'
    : '';
  return '<div class="card" style="border-top:4px solid var(--accent)">'
    + '<div id="ph-thread" class="ph-thread">' + phThreadInner() + '</div>'
    + '<div class="row" style="gap:6px;margin-top:10px">'
    + '<input id="ph-input" placeholder="Talk, or ask me to add something" autocomplete="off" style="flex:1;min-width:0" onkeydown="if(event.key===\'Enter\'){event.preventDefault();phSend();}">'
    /* ⭐ TALK TO IT. Ray, 2026-08-27: "if I was able to talk to the message thing that we have in top right.
       I do everything at voice to text that I can." The dictation engine (js/68) already exists and already
       writes into whatever field has focus — it just had no way in from here except the floating button,
       which only appears once a field is focused and is easy to miss.
       ⛔ Hidden where the browser can't do speech recognition, rather than offered and then failing. */
    + ((typeof riTalk === "function" && (window.SpeechRecognition || window.webkitSpeechRecognition))
        ? '<button class="btn ghost" style="flex:0 0 auto;width:auto" title="Talk instead of typing" '
          + 'onclick="riTalk(\'ph-input\')">🎤</button>' : '')
    + '<button class="btn acc" style="flex:0 0 auto;width:auto" onclick="phSend()">Send</button></div>'
    /* it can act now (2026-08-25) and he had no way to know — an empty thread says so once, then gets out
       of the way rather than captioning every screen forever */
    + (PH_THREAD.length ? '' : '<div class="sub" style="white-space:normal;margin-top:8px">Ask me about your list, your bills, your calendar or your workouts — or say “remind me Tuesday to…” and I’ll set it up for you to confirm.</div>')
    + (clearBtn ? '<div class="row" style="gap:6px;margin-top:8px">' + clearBtn + '</div>' : '')
    + (phOnline() ? '' : '<div class="muted" style="font-size:12px;margin-top:6px">Back when you\'re online.</div>')
    + '</div>';
}

/* ---- send ---- */
if (typeof window !== "undefined") window.phSend = function () {
  const inp = document.getElementById("ph-input"); if (!inp) return;
  const text = (inp.value || "").trim(); if (!text || PH_BUSY) return;
  if (!phOnline()) {
    PH_THREAD.push({ role: "user", content: text });
    PH_THREAD.push({ role: "assistant", content: "I'm offline right now — I'll be here when you're back on." });
    phSave(); inp.value = ""; phRender(); return;
  }
  PH_THREAD.push({ role: "user", content: text }); phSave(); inp.value = ""; PH_BUSY = true; phRender();
  /* only real conversation turns go to the model — an action card has no `content` and would be a
     malformed message. It stays in HIS view of the thread, just not in the API payload. */
  const hist = PH_THREAD.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-14);
  fetch(phBase() + "/api/org-ai/assistant", {
    method: "POST", headers: phHeaders(),
    body: JSON.stringify({ org: (typeof S !== "undefined" ? S.biz : ""), messages: hist })
  })
    .then(r => r.json().then(j => ({ ok: r.ok, j: j })).catch(() => ({ ok: false, j: {} })))
    .then(res => {
      PH_BUSY = false; const j = res.j || {};
      if (res.ok && typeof j.reply === "string" && j.reply.trim()) PH_THREAD.push({ role: "assistant", content: j.reply.trim() });
      /* PROPOSED ACTIONS (server tools, 2026-08-25). Nothing is written here — each becomes a card he
         confirms or cancels, the same path the business Cap has always used. */
      if (res.ok && Array.isArray(j.actions)) {
        j.actions.forEach(function (a) {
          if (a && a.kind) PH_THREAD.push({ role: "action", action: a, state: "pending", cid: "a" + Date.now() + Math.random().toString(36).slice(2, 6) });
        });
      }
      else if (res.ok) PH_THREAD.push({ role: "assistant", content: "I'm here." });
      else PH_THREAD.push({ role: "assistant", content: (j.error && /not set up/i.test(j.error)) ? "I'm not switched on yet — an owner can add a key in Admin → Assistant." : "Something went wrong reaching me. Try again in a sec." });
      phSave(); phRender();
    })
    .catch(() => { PH_BUSY = false; PH_THREAD.push({ role: "assistant", content: "Something went wrong reaching me. Try again in a sec." }); phSave(); phRender(); });
};

/* ---- a proposed action, as a card he taps ----
   Ray, 2026-08-25: "it told me that it can't add things to my calendar. Can we make it able to do that?"
   It can now — but it PROPOSES. He confirms. That keeps the one thing that mattered: this box never
   silently does something to his life because he was thinking out loud in it. */
function phActionCard(item) {
  const a = item.action || {};
  const when = a.date ? ((typeof fmtDate === "function") ? fmtDate(a.date) : a.date) + (a.time ? " at " + a.time : "") : "";
  const LBL = { addEvent: ["📅", "Put on your calendar"], addTodo: ["✅", "Add to your to-do list"],
                addReminder: ["⏰", "Remind you"], addBill: ["💵", "Add to your bills"] };
  const L = LBL[a.kind] || ["•", "Do that"];
  /* ⭐ a money proposal shows the AMOUNT and whether it repeats, right on the card. He is confirming a claim
     about what he owes, and "recurring" vs "once" is the difference between $736 and $736 every month. */
  const headline = (a.kind === "addBill")
    ? esc(a.name || "") + ' · ' + esc((typeof calMoney === "function") ? calMoney(a.amount) : "$" + a.amount)
    : esc(a.title || a.text || "");
  const detail = (a.kind === "addBill")
    ? (a.recurring ? 'Every month on the ' + esc(String(a.dayOfMonth || 1)) : 'One-time' + (when ? ' · ' + esc(when) : ''))
    : ((when ? ' · ' + esc(when) : '') + (a.annual ? ' · every year' : ''));
  let inner = '<div class="nm" style="font-size:14px;white-space:normal">' + L[0] + ' ' + headline + '</div>'
    + '<div class="sub" style="white-space:normal">' + esc(L[1]) + (a.kind === "addBill" ? ' · ' + detail : detail) + '</div>';
  if (item.state === "pending") {
    inner += '<div class="row" style="gap:8px;margin-top:9px">'
      + '<button class="btn acc" style="flex:1" onclick="phConfirmAction(\'' + item.cid + '\')">Confirm</button>'
      + '<button class="btn ghost" style="flex:1" onclick="phCancelAction(\'' + item.cid + '\')">Cancel</button></div>';
  } else if (item.state === "done") inner += '<div style="font-size:12px;margin-top:6px;color:var(--accent);font-weight:800">✓ Done</div>';
  else if (item.state === "cancelled") inner += '<div class="sub" style="margin-top:6px">Cancelled</div>';
  else if (item.state === "error") inner += '<div style="font-size:12px;margin-top:6px;color:var(--danger)">' + esc(item.err || "Couldn\'t do that") + '</div>';
  return '<div class="card" style="border-left:4px solid var(--accent);margin:2px 0;padding:10px">' + inner + '</div>';
}

if (typeof window !== "undefined") window.phConfirmAction = function (cid) {
  const item = PH_THREAD.find(function (m) { return m && m.cid === cid; });
  if (!item || item.state !== "pending") return;
  const a = item.action || {};
  try {
    const d = D();
    if (a.kind === "addEvent") {
      if (!Array.isArray(d.personalEvents)) d.personalEvents = [];
      const e = { id: "pev_" + (typeof uid === "function" ? uid() : String(Date.now())), date: a.date, title: a.title,
                  note: a.time ? ("at " + a.time) : "", annual: !!a.annual, confirmed: true, deleted: false };
      if (typeof touch === "function") touch(e);
      d.personalEvents.push(e);
    } else if (a.kind === "addTodo") {
      if (!Array.isArray(d.todos)) d.todos = [];
      const t = { id: (typeof uid === "function" ? uid() : String(Date.now())), title: a.title, priority: "Medium",
                  due: a.due || "", done: false, notes: "", deleted: false };
      if (typeof touch === "function") touch(t);
      d.todos.push(t);
    } else if (a.kind === "addReminder") {
      if (!Array.isArray(d.reminders)) d.reminders = [];
      const me = (typeof curUser === "function") ? curUser() : null;
      const r = { id: "rm_" + (typeof uid === "function" ? uid() : String(Date.now())), text: a.text,
                  dueAt: (typeof rmDueAt === "function") ? rmDueAt(a.date, a.time) : 0,
                  fired: false, userId: (me && me.id) || "", deleted: false };
      if (typeof touch === "function") touch(r);
      d.reminders.push(r);
    } else if (a.kind === "addBill") {
      if (!Array.isArray(d.budgetBills)) d.budgetBills = [];
      /* the book a bill lands in: his default (Personal), the same one the Budget page uses. Without a book
         it would exist but be invisible on every screen that scopes by book. */
      const bookId = (typeof budgetDefaultBookId === "function") ? budgetDefaultBookId()
        : (((d.budgetBooks || []).find(function (b) { return b && !b.deleted; }) || {}).id || "");
      const bill = { id: "bgt-bill-" + (typeof uid === "function" ? uid() : String(Date.now())),
                     bookId: bookId, name: a.name, amount: a.amount, catId: "",
                     frequency: a.recurring ? "monthly" : "once",
                     dueDay: a.recurring ? (a.dayOfMonth || 1) : 1,
                     nextDue: a.recurring ? "" : (a.date || ""),
                     autoEstimate: false, active: true, deleted: false };
      if (typeof touch === "function") touch(bill);
      d.budgetBills.push(bill);
    } else { item.state = "error"; item.err = "I don\'t know how to do that one."; phSave(); phRender(); return; }
    if (typeof save === "function") save();
    item.state = "done";
  } catch (e) { item.state = "error"; item.err = String((e && e.message) || e).slice(0, 120); }
  phSave(); phRender();
};
if (typeof window !== "undefined") window.phCancelAction = function (cid) {
  const item = PH_THREAD.find(function (m) { return m && m.cid === cid; });
  if (item && item.state === "pending") { item.state = "cancelled"; phSave(); phRender(); }
};

if (typeof window !== "undefined") window.phClear = function () {
  if (!confirm("Clear this conversation?")) return;
  PH_THREAD = []; phSave(); phRender();
};

/* ---- interests card ---- */
function phInterestsCard() {
  const list = phInterests();
  if (!list.length) {
    return '<div class="card"><div class="row" style="gap:8px;align-items:center">'
      + '<div class="grow"><div class="nm">What are you into?</div>'
      + '<div class="sub" style="white-space:normal">Add a few things. Gives us something to talk about besides work.</div></div>'
      + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="phAddInterest()">Add</button></div></div>';
  }
  let body = "";
  PH_CATS.forEach(function (c) {
    const inCat = list.filter(i => (i.cat || "other") === c.key);
    if (!inCat.length) return;
    /* .sub is globally nowrap + ellipsis (right for one-line list rows in the business app, wrong for a
       paragraph). Without white-space:normal these lists ran off the card and scrolled the whole page
       sideways, cutting his own interests mid-word. */
    body += '<div style="margin-top:6px;white-space:normal">'
      + '<span class="sub" style="font-weight:700;white-space:normal">' + esc(c.label) + '</span> '
      + '<span class="sub" style="white-space:normal;overflow:visible">' + inCat.map(i => esc(i.label)).join(" · ") + '</span></div>';
  });
  return '<div class="card"><div class="row" style="gap:8px;align-items:flex-start">'
    + '<div class="grow"><div class="nm">Things you\'re into</div>' + body + '</div>'
    + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="phAddInterest()">Edit</button></div></div>';
}

/* ⛔ phLookBackCard is gone. It resurfaced an old journal entry on Today. Ray, 2026-08-25: "I don't
   understand what the from your journal box is for. I don't need that there. I don't need a random journal
   entry on my today page." Today is what's happening today; a paragraph from two weeks ago is not. */

/* phQuickCard is gone. Its three buttons — journal, workout, daily check-in — are routine items now, so
   they sit at the hour of the day he actually does them instead of in a floating row. See js/141. */

/* ---------- TODAY'S PLAN — the actual point of this page ----------------------------------------------
   Ray, 2026-08-25, defining what Today is for: "Today is for things that I need to know that are happening
   today, like what needs to get done today… my to do list, essentially. And it should, like, track how I'm
   doing, and it should carry things over to the next day as long as they're not getting checked off. Don't
   just make it static."

   ⭐ CARRY-OVER WITH NO MOVING PARTS. A to-do carries `planDate` — the day it was put on the plan. Today
   shows everything with planDate <= today that isn't done. So an item planned for Monday and not ticked is
   simply still there on Tuesday, and on Wednesday, without a cron, a migration, or anything running at
   midnight to shuffle records. The thing that "carries it over" is that nothing ever moved it.

   Items with no planDate at all still appear if they're due today or overdue — a dated commitment is part of
   today whether or not anyone planned it.

   "Track how I'm doing" = what he ticked off TODAY. A count of things done, never a fraction of a target and
   never a streak: this is a work list, but it's still his day, and a score is how a list starts nagging. */
function phPlanItems() {
  var t = phToday();
  var all = (typeof actTodo === "function") ? actTodo() : ((D().todos || []).filter(function (x) { return x && !x.deleted; }));
  var open = all.filter(function (x) { return !x.done; });
  var plan = open.filter(function (x) {
    if (x.planDate && String(x.planDate) <= t) return true;      // planned today or an earlier day, still open
    if (x.due && String(x.due) <= t) return true;                // due today or overdue
    return false;
  });
  /* nothing explicitly planned yet — fall back to the ordered list so the page is never empty and useless */
  if (!plan.length) plan = open.slice();
  return (typeof sortTodos === "function") ? sortTodos(plan) : plan;
}
function phDoneToday() {
  var t = phToday();
  var all = (typeof actTodo === "function") ? actTodo() : ((D().todos || []).filter(function (x) { return x && !x.deleted; }));
  return all.filter(function (x) {
    if (!x.done) return false;
    var when = x.doneAt || x.updatedAt;
    if (!when) return false;
    try { var dt = new Date(+when); var p = function (n) { return String(n).padStart(2, "0"); };
      return (dt.getFullYear() + "-" + p(dt.getMonth() + 1) + "-" + p(dt.getDate())) === t; } catch (e) { return false; }
  }).length;
}
/* how much time the world is giving him on a marked deadline. Never a scold, never a count of attempts. */
function phDeadlineHTML(td, t) {
  var d0 = Date.parse(String(t) + "T00:00:00Z"), d1 = Date.parse(String(td.due || "") + "T00:00:00Z");
  if (isNaN(d1)) return '';
  var days = Math.round((d1 - d0) / 86400000);
  var txt = days < 0 ? "the window closed " + (-days) + (days === -1 ? " day" : " days") + " ago"
          : days === 0 ? "closes today"
          : days === 1 ? "closes tomorrow"
          : "closes in " + days + " days";
  return '<span style="color:' + (days <= 7 ? 'var(--danger)' : 'var(--muted)') + ';font-weight:600">' + esc(txt) + '</span>';
}

function phPlanCard() {
  var t = phToday();
  var list = phPlanItems();
  var done = phDoneToday();
  var h = '<div class="secthd"><h2>Today</h2>'
    + (done ? '<span class="ct">✓ ' + done + ' done</span>' : '') + '</div>';
  if (!list.length) {
    return h + '<div class="card"><div class="sub" style="white-space:normal">Nothing on the list. '
      + 'Add something, or just tell me what you\'re doing and I\'ll put it here.</div></div>';
  }
  h += '<div class="card" style="padding:6px 10px">';
  list.slice(0, 12).forEach(function (td) {
    var carried = td.planDate && String(td.planDate) < t;
    var overdue = td.due && String(td.due) < t;
    /* ⭐ amber: something that has to happen TODAY, as opposed to the routine's grey. Same colour the
       calendar uses for a to-do, so one thing means one thing across the app. */
    h += '<div class="li rt-li rt-kind-todo" style="align-items:flex-start">'
      + '<input type="checkbox" class="rt-box" ' + (td.done ? "checked" : "")
      + ' onchange="phTickTodo(\'' + td.id + '\')">'
      + '<div class="grow" style="cursor:pointer" onclick="if(typeof openTodo===\'function\')openTodo(\'' + td.id + '\')">'
      + '<div class="nm" style="font-size:15px">' + (td.hardDeadline ? '⏳ ' : '') + esc(td.title || "(untitled)") + '</div>'
      + '<div class="sub" style="white-space:normal">'
      /* ⭐ A HARD DEADLINE COUNTS DOWN THE WORLD, NOT HIM. Ray, 2026-08-25: escalate on consequence, not
         elapsed time — "competitors take deposits this month", never "you still haven't done this". So a
         marked item shows how long the outside world is giving him, and his own note about what closes.
         Everything else keeps the flat overdue/carried label: a to-do that slipped is not an emergency. */
      + (td.hardDeadline ? phDeadlineHTML(td, t) + (td.deadlineWhy ? ' · ' + esc(String(td.deadlineWhy).slice(0, 90)) : '')
          : ((overdue ? '<span style="color:var(--danger);font-weight:600">overdue</span> · ' : '')
             + (carried ? 'carried over · ' : '')
             + esc(td.notes ? String(td.notes).slice(0, 90) : (td.due ? "due " + ((typeof fmtDate === "function") ? fmtDate(td.due) : td.due) : ""))))
      + '</div></div></div>';
  });
  if (list.length > 12) h += '<div class="sub" style="padding:4px 2px">+ ' + (list.length - 12) + ' more on the To-Do tab</div>';
  return h + '</div>';
}
if (typeof window !== "undefined") window.phTickTodo = function (id) {
  var td = ((D().todos) || []).find(function (x) { return x && x.id === id; });
  if (!td) return;
  td.done = !td.done;
  td.doneAt = td.done ? Date.now() : 0;          // so "done today" can be counted honestly
  if (typeof touch === "function") touch(td);
  if (typeof save === "function") save();
  if (typeof render === "function") render();
};

/* ---- THE PAGE ---- */
const MC_DAYS_FALLBACK = 14;
function personalHome() {
  PH_THREAD = phLoad();
  setTimeout(function () { const b = document.getElementById("ph-thread"); if (b) b.scrollTop = b.scrollHeight; }, 40);
  if (typeof rtSeed === "function") rtSeed();

  /* ⭐ TODAY IS A DAY, AND ON A WIDE SCREEN IT IS TWO COLUMNS THAT MEAN SOMETHING.

     Ray, 2026-08-25: "keep the chat and finance overlook on the left, make the daily routine stuff linear on
     the right. its jumbled right now."

     ⚠️ It was jumbled because the whole page was poured into `.pgcols` — `column-count:2`, a NEWSPAPER flow.
     Multicol fills the left column to the bottom and continues in the right, so the sequence he asked for
     (morning → the day → evening) got cut at whatever height the break landed on and read down-then-across.
     Now each block is ASSIGNED its column (.daycols in app.css), and the day is one unbroken run.

       LEFT   the box he talks to  ·  bills due  ·  what's coming up          — reference, not tasks
       RIGHT  MORNING → on today → his plan → the businesses → DAY → EVENING  — linear, in order

     Every section still disappears when it's empty, so a quiet day is a short page. On a phone there are no
     columns: chat, then the day, then money — the routine matters more than the balances on a small screen. */
  /* ⭐ THE ARRANGEMENT IS HIS NOW (js/164). Ray, 2026-08-27: "maybe you can make it, like, draggable, and
     then I can just try a few different ways to do it." He has told me where these blocks go four times and
     been right each time — the lesson is not the arrangement, it is that I keep guessing at something he can
     settle in ten seconds if the app lets him. ◀ ▲ ▼ ▶ on each block, saved per device. */
  if (typeof tlTodayHTML === "function") {
    return '<div class="secthd"><h2>' + esc(phGreeting()) + '</h2></div>' + tlTodayHTML();
  }

  /* ⛔ fallback for a build without js/164 — Today must never come up empty */
  const part = (k) => {
    if (typeof rtPartHTML !== "function" || typeof ROUTINE_PARTS === "undefined") return "";
    const p = ROUTINE_PARTS.find(function (x) { return x.key === k; });
    return p ? rtPartHTML(p) : "";
  };
  let side = (typeof moneyCardHTML === "function") ? moneyCardHTML()
           : ((typeof calBillsCardHTML === "function") ? calBillsCardHTML(MC_DAYS_FALLBACK) : "");
  if (typeof evHomeCardHTML === "function") side += evHomeCardHTML(30);
  let day = part("morning");
  day += (typeof rtJobsTodayHTML === "function") ? rtJobsTodayHTML() : "";
  day += phPlanCard();
  day += (typeof piCardHTML === "function") ? piCardHTML() : "";
  day += part("day") + part("evening");
  day += '<button class="btn ghost sm" style="width:100%;margin-top:6px" onclick="rtEdit(\'\')">＋ Add to your routine</button>';
  return '<div class="secthd"><h2>' + esc(phGreeting()) + '</h2></div>'
    + ((typeof tcalHTML === "function") ? tcalHTML() : "")
    + '<div class="daycols">'
    +   '<div class="dc-chat">' + phTalkCard() + '</div>'
    +   '<div class="dc-day">' + day + '</div>'
    +   '<div class="dc-money">' + side + '</div>'
    + '</div>';
}

if (typeof window !== "undefined") {
  window.personalHome = personalHome;
  window.phInterestsCard = phInterestsCard;   // the Life tab renders it now, not Today
  window.phInterests = phInterests;
  window.phGreeting = phGreeting;
}
if (typeof module !== "undefined" && module.exports) module.exports = { phGreeting: phGreeting };
