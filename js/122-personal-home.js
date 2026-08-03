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
  try { const a = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(a) ? a.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") : []; }
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
if (typeof window !== "undefined") window.phAddInterest = function () {
  modal("Things you're into", ''
    + '<div class="sub" style="white-space:normal;margin-bottom:8px">Hobbies, things you used to do, things you keep meaning to get back to. It gives us something to talk about that isn\'t work.</div>'
    + '<label>Add one</label><input id="ph_int" placeholder="e.g. fishing, guitar, working on the truck" autocomplete="off">'
    + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="phSaveInterest()">Add</button>'
    + (phInterests().length ? '<div style="border-top:1px solid var(--line);margin-top:12px;padding-top:8px">'
        + phInterests().map(i => '<div class="row" style="gap:6px;align-items:center;margin-bottom:4px"><div class="grow">' + esc(i.label) + '</div>'
        + '<button class="btn ghost sm" onclick="phDelInterest(\'' + i.id + '\')">✕</button></div>').join("") + '</div>' : ''));
};
if (typeof window !== "undefined") window.phSaveInterest = function () {
  const v = (typeof val === "function" ? val("ph_int") : "").trim(); if (!v) return;
  const t = phInterestsDoc();
  t.list.push({ id: "int-" + (typeof uid === "function" ? uid() : String(Date.now())), label: v.slice(0, 60) });
  t.updatedAt = (typeof now === "function") ? now() : Date.now();
  if (typeof touch === "function") touch(t);
  if (typeof save === "function") save();
  window.phAddInterest();
};
if (typeof window !== "undefined") window.phDelInterest = function (id) {
  const t = phInterestsDoc(); const i = t.list.find(x => x && x.id === id); if (i) i.deleted = true;
  t.updatedAt = (typeof now === "function") ? now() : Date.now();
  if (typeof touch === "function") touch(t);
  if (typeof save === "function") save();
  window.phAddInterest();
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
  PH_THREAD.forEach(m => { h += phBubble(m.role === "user" ? "me" : "them", esc(m.content).replace(/\n/g, "<br>")); });
  if (PH_BUSY) h += phBubble("them", '<span class="muted">…</span>');
  return h;
}
function phRender() { const b = document.getElementById("ph-thread"); if (b) { b.innerHTML = phThreadInner(); b.scrollTop = b.scrollHeight; } }

/* ---- the talk card: the anchor of this page, works with zero data ---- */
function phTalkCard() {
  const saveBtn = PH_THREAD.length
    ? '<button class="btn ghost sm" style="flex:0 0 auto" onclick="phSaveToJournal()">Save to journal</button>'
    : '';
  const clearBtn = PH_THREAD.length
    ? '<button class="btn ghost sm" style="flex:0 0 auto" onclick="phClear()">Clear</button>'
    : '';
  return '<div class="card" style="border-top:4px solid var(--accent)">'
    + '<div id="ph-thread" style="display:flex;flex-direction:column;gap:8px;max-height:360px;overflow-y:auto;-webkit-overflow-scrolling:touch">' + phThreadInner() + '</div>'
    + '<div class="row" style="gap:6px;margin-top:10px">'
    + '<input id="ph-input" placeholder="What\'s on your mind?" autocomplete="off" style="flex:1;min-width:0" onkeydown="if(event.key===\'Enter\'){event.preventDefault();phSend();}">'
    + '<button class="btn acc" style="flex:0 0 auto;width:auto" onclick="phSend()">Send</button></div>'
    + ((saveBtn || clearBtn) ? '<div class="row" style="gap:6px;margin-top:8px">' + saveBtn + clearBtn + '</div>' : '')
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
  const hist = PH_THREAD.slice(-14);
  fetch(phBase() + "/api/org-ai/assistant", {
    method: "POST", headers: phHeaders(),
    body: JSON.stringify({ org: (typeof S !== "undefined" ? S.biz : ""), messages: hist })
  })
    .then(r => r.json().then(j => ({ ok: r.ok, j: j })).catch(() => ({ ok: false, j: {} })))
    .then(res => {
      PH_BUSY = false; const j = res.j || {};
      if (res.ok && typeof j.reply === "string" && j.reply.trim()) PH_THREAD.push({ role: "assistant", content: j.reply.trim() });
      else if (res.ok) PH_THREAD.push({ role: "assistant", content: "I'm here." });
      else PH_THREAD.push({ role: "assistant", content: (j.error && /not set up/i.test(j.error)) ? "I'm not switched on yet — an owner can add a key in Admin → Assistant." : "Something went wrong reaching me. Try again in a sec." });
      phSave(); phRender();
    })
    .catch(() => { PH_BUSY = false; PH_THREAD.push({ role: "assistant", content: "Something went wrong reaching me. Try again in a sec." }); phSave(); phRender(); });
};

/* keeping a conversation is HIS choice — venting is not silently filed */
if (typeof window !== "undefined") window.phSaveToJournal = function () {
  if (!PH_THREAD.length) return;
  const body = PH_THREAD.map(m => (m.role === "user" ? "Me: " : "— ") + m.content).join("\n\n");
  const d = D(); if (!d.lifeNotes) d.lifeNotes = [];
  const n = { id: "life-note-" + (typeof uid === "function" ? uid() : String(Date.now())),
              date: phToday(), title: "Talked it out", body: body, deleted: false };
  if (typeof touch === "function") touch(n);
  d.lifeNotes.push(n);
  if (typeof save === "function") save();
  alert("Saved to your journal.");
  if (typeof render === "function") render();
};
if (typeof window !== "undefined") window.phClear = function () {
  if (!confirm("Clear this conversation? It isn't saved anywhere unless you saved it to your journal.")) return;
  PH_THREAD = []; phSave(); phRender();
};

/* ---- interests card ---- */
function phInterestsCard() {
  const list = phInterests();
  if (!list.length) {
    return '<div class="card"><div class="row" style="gap:8px;align-items:center">'
      + '<div class="grow"><div class="nm">What are you into?</div>'
      + '<div class="sub" style="white-space:normal">Add a few things — fishing, guitar, whatever. Gives us something to talk about besides work.</div></div>'
      + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="phAddInterest()">Add</button></div></div>';
  }
  return '<div class="card"><div class="row" style="gap:8px;align-items:flex-start">'
    + '<div class="grow"><div class="nm">Things you\'re into</div>'
    + '<div class="sub" style="white-space:normal;margin-top:2px">' + list.map(i => esc(i.label)).join(" · ") + '</div></div>'
    + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="phAddInterest()">Edit</button></div></div>';
}

/* ---- one older journal entry, resurfaced. Silent until there's something to resurface. ---- */
function phLookBackCard() {
  let notes = [];
  try { notes = (typeof actLifeNotes === "function") ? actLifeNotes() : ((D().lifeNotes || []).filter(n => n && !n.deleted)); } catch (e) { return ""; }
  const older = notes.filter(n => n.date && n.date < phToday());
  if (!older.length) return "";
  const pick = older[Math.floor(older.length / 2)] || older[0];   // stable within a render, not random churn
  const body = String(pick.body || "").replace(/\s+/g, " ").slice(0, 160);
  return '<div class="card" style="border-left:4px solid var(--accent);cursor:pointer" onclick="openLifeNote(\'' + pick.id + '\')">'
    + '<div class="nm" style="font-size:13px">From your journal · ' + esc((typeof fmtDate === "function") ? fmtDate(pick.date) : pick.date) + '</div>'
    + '<div class="sub" style="white-space:normal;margin-top:3px">' + esc(body) + (body.length >= 160 ? '…' : '') + '</div></div>';
}

/* ---- quick ways in, so the page is never a dead end ---- */
function phQuickCard() {
  return '<div class="row" style="gap:8px;margin-bottom:14px">'
    + '<button class="btn ghost" style="flex:1" onclick="openLifeNote(null)">📓 Write something</button>'
    + '<button class="btn ghost" style="flex:1" onclick="if(typeof navSub===\'function\')navSub(\'life\')">🌱 Log the day</button>'
    + '</div>';
}

/* ---- THE PAGE ---- */
function personalHome() {
  PH_THREAD = phLoad();
  setTimeout(function () { const b = document.getElementById("ph-thread"); if (b) b.scrollTop = b.scrollHeight; }, 40);
  let h = '<div class="secthd"><h2>' + esc(phGreeting()) + '</h2></div>';
  h += phTalkCard();
  h += phQuickCard();
  h += phLookBackCard();
  h += phInterestsCard();
  return h;
}
if (typeof window !== "undefined") {
  window.personalHome = personalHome;
  window.phInterests = phInterests;
  window.phGreeting = phGreeting;
}
if (typeof module !== "undefined" && module.exports) module.exports = { phGreeting: phGreeting };
