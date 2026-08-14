/* ---------- JOURNAL → OFFERS (js/132) ----------------------------------------------------------------
   Ray, 2026-08-13: "it need to take the informatino i give it and act on it. mark things on the calendar,
   do stuff in the app, etc. even remind me of things at certain days and times"

   ⚠️ THE THING THIS MUST NOT BECOME. The personal app was deliberately built not to act — the companion
   gets no tools, and its instructions say "WHEN HE VENTS, LET HIM… do not turn it into an action item."
   That is why the journal is somewhere he can actually say things. If unloading about a bad day produced a
   to-do list, the feature would have eaten the thing it was built on top of.

   So this is a SECOND PASS, and it only ever OFFERS:
     - the entry is already saved, untouched, before this runs
     - the server pass returns a list and holds no tools; it cannot write anything
     - nothing here reaches the calendar, to-dos or reminders without a tap
     - pure venting returns [] and this renders NOTHING AT ALL — no card, no badge, no counter
     - ignored offers expire on their own after a week and are never mentioned again

   Offers live in localStorage, NOT in the synced store. They are a suggestion on one device, not data:
   never syncing them means an ignored offer can't follow him to another phone, and nothing half-accepted
   ends up in the record. Once he taps Add, the thing created IS a normal synced record. */

var JA_BUSY = {};                       // noteId -> true while the server pass is running
var JA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function jaKey() { return "jrnl_offers_" + ((typeof S !== "undefined" && S.biz) || "none"); }
function jaAll() {
  try { return JSON.parse(localStorage.getItem(jaKey()) || "{}") || {}; } catch (e) { return {}; }
}
function jaWrite(o) { try { localStorage.setItem(jaKey(), JSON.stringify(o)); } catch (e) {} }

/* drop anything stale on every read — an offer he ignored for a week is an answer */
function jaLive() {
  var all = jaAll(), now = Date.now(), keep = {}, changed = false;
  Object.keys(all).forEach(function (k) {
    var v = all[k];
    if (v && (now - (v.ts || 0)) < JA_TTL_MS && Array.isArray(v.items) && v.items.length) keep[k] = v;
    else changed = true;
  });
  if (changed) jaWrite(keep);
  return keep;
}
function jaCount() {
  var live = jaLive(), n = 0;
  Object.keys(live).forEach(function (k) { n += live[k].items.length; });
  return n;
}

/* ---- ask the server what's in an entry ---- */
function jaScan(noteId, text, cb) {
  if (!noteId || JA_BUSY[noteId]) return;
  if (!(typeof S !== "undefined" && S.sync && S.sync.url && S.sync.token)) return;
  if (!String(text || "").trim()) return;
  JA_BUSY[noteId] = true;
  var base = ((S.sync && S.sync.url) || location.origin).replace(/\/+$/, "");
  fetch(base + "/api/journal/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ((S.sync && S.sync.token) || "") },
    body: JSON.stringify({ org: (typeof S !== "undefined" && S.biz) || "", text: String(text) })
  }).then(function (r) { return r.json(); }).then(function (j) {
    JA_BUSY[noteId] = false;
    var items = (j && Array.isArray(j.items)) ? j.items : [];
    if (!items.length) return cb && cb(0);          // the normal case: say nothing
    var all = jaAll();
    all[noteId] = { ts: Date.now(), items: items };
    jaWrite(all);
    if (typeof render === "function") render();
    cb && cb(items.length);
  }).catch(function () { JA_BUSY[noteId] = false; });
}

/* ---- accepting one ---- */
if (typeof window !== "undefined") window.jaAccept = function (noteId, idx) {
  var all = jaAll(), rec = all[noteId];
  if (!rec || !rec.items || !rec.items[idx]) return;
  var it = rec.items[idx];
  var d = D();
  var newId = function (p) { return p + (typeof uid === "function" ? uid() : String(Date.now())); };

  if (it.kind === "event") {
    if (!Array.isArray(d.personalEvents)) d.personalEvents = [];
    var e = { id: newId("pev_"), date: it.date || ((typeof today === "function") ? today() : ""), title: it.title,
              note: it.note || "", annual: false, confirmed: true, deleted: false };
    if (typeof touch === "function") touch(e);
    d.personalEvents.push(e);
  } else if (it.kind === "reminder") {
    if (!Array.isArray(d.reminders)) d.reminders = [];
    var me = (typeof curUser === "function") ? curUser() : null;
    var r = { id: newId("rm_"), text: it.title, dueAt: rmDueAt(it.date, it.time || "09:00"),
              fired: false, sourceNoteId: noteId, userId: (me && me.id) || "", deleted: false };
    if (typeof touch === "function") touch(r);
    d.reminders.push(r);
  } else {
    if (!Array.isArray(d.todos)) d.todos = [];
    var t = { id: newId(""), title: it.title, priority: "Medium", due: it.date || "", done: false,
              notes: it.note || "", deleted: false };
    if (typeof touch === "function") touch(t);
    d.todos.push(t);
  }

  rec.items.splice(idx, 1);
  if (!rec.items.length) delete all[noteId]; else all[noteId] = rec;
  jaWrite(all);
  if (typeof save === "function") save();
  if (typeof render === "function") render();
};

if (typeof window !== "undefined") window.jaDismiss = function (noteId, idx) {
  var all = jaAll(), rec = all[noteId];
  if (!rec || !rec.items) return;
  rec.items.splice(idx, 1);
  if (!rec.items.length) delete all[noteId]; else all[noteId] = rec;
  jaWrite(all);
  if (typeof render === "function") render();
};
if (typeof window !== "undefined") window.jaDismissAll = function () { jaWrite({}); if (typeof render === "function") render(); };

/* re-read an entry on demand — for a typed entry, or one recorded before this existed */
if (typeof window !== "undefined") window.jaRescan = function (noteId) {
  var n = (D().lifeNotes || []).find(function (x) { return x && x.id === noteId; });
  if (!n) return;
  jaScan(noteId, n.body || "", function (count) {
    if (!count) alert("Nothing in there that needed adding.");
  });
};

/* ---- the card. Absent entirely when there is nothing to offer. ---- */
function jaCardHTML() {
  var live = jaLive();
  var keys = Object.keys(live);
  if (!keys.length) return "";
  var LBL = { event: ["📅", "Calendar"], reminder: ["⏰", "Reminder"], todo: ["✅", "To-do"] };
  var h = '<div class="card">'
    + '<div class="row" style="align-items:center;gap:8px"><div style="font-weight:800" class="grow">From what you said</div>'
    + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="jaDismissAll()">Not now</button></div>'
    + '<div class="sub" style="white-space:normal;margin:4px 0 8px">Nothing is added unless you tap it.</div>';
  keys.forEach(function (noteId) {
    live[noteId].items.forEach(function (it, i) {
      var L = LBL[it.kind] || LBL.todo;
      var when = it.date ? ((typeof fmtDate === "function") ? fmtDate(it.date) : it.date) + (it.time ? " · " + it.time : "") : "";
      h += '<div class="li" style="align-items:flex-start">'
        + '<div class="grow"><div class="nm">' + L[0] + ' ' + esc(it.title) + '</div>'
        + '<div class="sub" style="white-space:normal">' + esc(L[1]) + (when ? ' · ' + esc(when) : '')
        + (it.note ? ' · ' + esc(it.note) : '') + '</div></div>'
        + '<button class="btn acc sm" style="flex:0 0 auto" onclick="jaAccept(\'' + noteId + '\',' + i + ')">Add</button>'
        + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="jaDismiss(\'' + noteId + '\',' + i + ')">✕</button>'
        + '</div>';
    });
  });
  return h + '</div>';
}

if (typeof window !== "undefined") {
  window.jaCardHTML = jaCardHTML;
  window.jaScan = jaScan;
  window.jaCount = jaCount;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { jaLive: jaLive };
}
