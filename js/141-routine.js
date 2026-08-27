/* ---------- THE ROUTINE (js/141) — Today, shaped like a day ------------------------------------------
   Ray, 2026-08-26: "i want the today page to look more like a routine. in order of morning stuff, like mood
   journal a quick little note of how i feel and stuff, then workout, then morning tasks like email checks,
   invoice statuses, etc. i run multiple businesses, today needs to be my one stop shop for what my day
   looks like"

   ⭐ A ROUTINE ITEM IS NOT A TO-DO, which is why this is its own collection. A to-do is finished once and
   gone. "Check email" happens every single morning — putting it on the to-do list either clutters it forever
   or gets ticked and disappears. So: routine items recur, and to-dos don't, and they live apart.

   ⭐ THE RESET HAS NO MOVING PARTS. `doneOn` holds a DATE, not a boolean. Ticked-today means
   doneOn === today, so tomorrow every item is simply un-ticked again — no cron, no midnight job, nothing to
   fail silently. Same trick as the to-do carry-over: the behaviour comes from what the data means, not from
   something running.

   ⛔ AND IT KEEPS NO HISTORY, DELIBERATELY. One date per item, overwritten. That makes a streak literally
   uncomputable, which is the point: he told me long ago that the things he "likes the idea of but never got
   good at" must never become nudges, and a daily checklist that remembers every miss is exactly how that
   turns into guilt. It shows what's left today. Tomorrow it forgets.

   THREE PARTS to a day, in order, because that's how he described it: morning, the day, evening. */

var ROUTINE_PARTS = [
  { key: "morning", label: "Morning" },
  { key: "day",     label: "During the day" },
  { key: "evening", label: "Evening" }
];

/* The starter routine, in his own order: how he feels, then workout, then the business checks he named.
   Seeded once; his to edit, reorder or delete afterwards. */
var ROUTINE_SEED = [
  { key: "feel",     part: "morning", label: "How are you feeling?", hint: "a line about how you woke up", action: "journal", order: 10 },
  { key: "workout",  part: "morning", label: "Workout",              hint: "",                              action: "workout", order: 20 },
  { key: "email",    part: "morning", label: "Check email",          hint: "reply to anything with a person waiting", action: "", order: 30 },
  { key: "invoices", part: "morning", label: "Check invoice statuses", hint: "who's paid, who hasn't, what needs sending", action: "invoices", order: 40 },
  { key: "plan",     part: "morning", label: "Look at today's jobs",  hint: "across both businesses",        action: "", order: 50 },
  { key: "receipts", part: "day",     label: "Log receipts as you go", hint: "snap them before they pile up", action: "receipts", order: 10 },
  { key: "journal",  part: "evening", label: "Journal entry",         hint: "how the day actually went",     action: "journal", order: 10 }
];

function actRoutine() {
  return (D().routineItems || []).filter(function (r) { return r && !r.deleted; })
    .sort(function (a, b) { return (a.order || 0) - (b.order || 0) || String(a.label || "").localeCompare(String(b.label || "")); });
}
function rtToday() { return (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10); }
function rtDone(item) { return !!(item && item.doneOn && item.doneOn === rtToday()); }
function rtFor(part) { return actRoutine().filter(function (r) { return (r.part || "morning") === part; }); }

/* seed once, idempotent by key — a deleted item stays deleted rather than returning every load */
function rtSeed() {
  try {
    var d = D(); if (!Array.isArray(d.routineItems)) d.routineItems = [];
    var have = {}; d.routineItems.forEach(function (r) { if (r && r.key) have[r.key] = 1; });
    var added = 0;
    ROUTINE_SEED.forEach(function (s) {
      if (have[s.key]) return;
      var r = { id: "rt_" + s.key, key: s.key, part: s.part, label: s.label, hint: s.hint || "",
                action: s.action || "", order: s.order, doneOn: "", deleted: false };
      if (typeof touch === "function") touch(r);
      d.routineItems.push(r); added++;
    });
    if (added && typeof save === "function") save();
    return added;
  } catch (e) { return 0; }
}

/* what tapping an item's label does, beyond ticking it */
var ROUTINE_ACTIONS = [
  { key: "",         label: "Just tick it off",  go: "" },
  { key: "journal",  label: "Open a journal entry", go: "openLifeNote(null)" },
  { key: "checkin",  label: "Open the daily check-in", go: "navSub('life')" },
  { key: "workout",  label: "Open the workout app",  go: "location.href='/workout.html'" },
  { key: "invoices", label: "Open Invoices",      go: "rtGo('invoices')" },
  { key: "receipts", label: "Open Receipts",      go: "rtGo('receipts')" },
  { key: "money",    label: "Open Money",         go: "rtGo('finance')" },
  { key: "todo",     label: "Open the to-do list", go: "rtGo('todo')" }
];
function rtAction(item) {
  var a = ROUTINE_ACTIONS.find(function (x) { return x.key === ((item && item.action) || ""); });
  return a ? a.go : "";
}

/* ---- one part of the day ---- */
function rtPartHTML(part) {
  var items = rtFor(part.key);
  if (!items.length) return "";
  var left = items.filter(function (r) { return !rtDone(r); }).length;
  var h = '<div class="secthd"><h2 style="font-size:13px">' + esc(part.label) + '</h2>'
    + (left ? '' : '<span class="ct">done</span>') + '</div>'
    + '<div class="card" style="padding:6px 10px">';
  items.forEach(function (r) {
    var done = rtDone(r);
    var go = rtAction(r);
    h += '<div class="li" style="align-items:flex-start">'
      /* ⚠️ SIZED BY DEVICE, BECAUSE BOTH COMPLAINTS ARE RIGHT. Ray, 2026-08-27: "the checkboxes are way too
         big on the routine thing" — said on a 1440p screen, where 22px made the box the largest thing in the
         card and read as the point of it. But a test already asserted they are thumb-sized on a phone, and
         that is a standing rule here: the crew works from phones and a 16px tap target is a miss.
         ⛔ So it is a class with a media query, not a number: 22px on a phone, 16px from 900px up. Shrinking
         it everywhere would have traded his annoyance for someone else's mis-tap. */
      + '<input type="checkbox" class="rt-box"' + (done ? " checked" : "")
      + ' onchange="rtTick(\'' + r.id + '\')">'
      + '<div class="grow"' + (go ? ' style="cursor:pointer" onclick="' + go + '"' : '') + '>'
      + '<div class="nm" style="font-size:15px' + (done ? ';color:var(--muted);text-decoration:line-through' : '') + '">'
      + esc(r.label || "") + '</div>'
      + (r.hint && !done ? '<div class="sub" style="white-space:normal">' + esc(r.hint) + '</div>' : '')
      + '</div></div>';
  });
  return h + '</div>';
}

/* ---- ⭐ ONE STOP SHOP: what's on today across every business ---- */
function rtJobsTodayHTML() {
  var t = rtToday();
  var rows = [];
  ((typeof S !== "undefined" && S.registry) || []).forEach(function (o) {
    if (!o || !o.id || !S[o.id] || typeof S[o.id] !== "object" || Array.isArray(S[o.id])) return;
    ((S[o.id] || {}).jobs || []).forEach(function (j) {
      if (!j || j.deleted || j.done) return;
      var on = (typeof jobOnDay === "function") ? jobOnDay(j, t) : (j.date === t);
      if (!on) return;
      /* ⚠️ NOT custName() — that resolves against D(), the org you're STANDING IN. From the personal org
         every business customer id would miss and render "—". Look the customer up in the job's own org. */
      var c = j.customerId ? ((S[o.id] || {}).customers || []).find(function (x) { return x && x.id === j.customerId; }) : null;
      rows.push({ org: o.name || o.id, title: j.title || "Job", time: j.time || "",
                  who: c ? (c.name || c.company || "") : "" });
    });
  });
  if (!rows.length) return "";
  rows.sort(function (a, b) { return String(a.time || "zz").localeCompare(String(b.time || "zz")); });
  var h = '<div class="secthd"><h2 style="font-size:13px">On today</h2><span class="ct">' + rows.length + '</span></div>'
    + '<div class="card" style="padding:6px 10px">';
  rows.forEach(function (r) {
    h += '<div class="li"><div class="grow"><div class="nm" style="font-size:15px">'
      + (r.time ? '<span class="badge" style="background:var(--soft);color:var(--ink);margin-right:6px">' + esc(r.time) + '</span>' : '')
      + esc(r.title) + '</div>'
      + '<div class="sub">' + esc(r.org) + (r.who ? ' · ' + esc(r.who) : '') + '</div></div></div>';
  });
  return h + '</div>';
}

if (typeof window !== "undefined") {
  window.actRoutine = actRoutine; window.rtSeed = rtSeed; window.rtPartHTML = rtPartHTML;
  window.rtJobsTodayHTML = rtJobsTodayHTML; window.ROUTINE_PARTS = ROUTINE_PARTS; window.rtDone = rtDone;
  window.ROUTINE_ACTIONS = ROUTINE_ACTIONS; window.rtAction = rtAction;

  window.rtTick = function (id) {
    var r = actRoutine().find(function (x) { return x.id === id; }); if (!r) return;
    r.doneOn = rtDone(r) ? "" : rtToday();      // a date, not a flag — tomorrow it simply isn't today
    if (typeof touch === "function") touch(r);
    if (typeof save === "function") save();
    if (typeof render === "function") render();
  };
  window.rtGo = function (tab) {
    if (typeof TAB !== "undefined") { TAB = tab; if (typeof render === "function") render(); }
  };

  /* ---- editing the routine: it's HIS day, not a shape I imposed ---- */
  window.rtEdit = function (id) {
    var r = id ? actRoutine().find(function (x) { return x.id === id; }) : null;
    modal(r ? "Routine item" : "Add to your routine", ''
      + '<label style="margin-top:0">What is it?</label>'
      + '<input id="rt_label" value="' + esc(r ? (r.label || "") : "") + '" placeholder="e.g. Check the weather" autofocus>'
      + '<label>When</label><select id="rt_part">'
      + ROUTINE_PARTS.map(function (p) {
          return '<option value="' + p.key + '"' + ((r ? r.part : "morning") === p.key ? " selected" : "") + '>' + esc(p.label) + '</option>';
        }).join("") + '</select>'
      + '<label>Tapping it should</label><select id="rt_act">'
      + ROUTINE_ACTIONS.map(function (a) {
          return '<option value="' + a.key + '"' + ((r ? (r.action || "") : "") === a.key ? " selected" : "") + '>' + esc(a.label) + '</option>';
        }).join("")
      + '</select>'
      + '<label>A note to yourself <span class="muted" style="font-weight:400">(optional)</span></label>'
      + '<input id="rt_hint" value="' + esc(r ? (r.hint || "") : "") + '" placeholder="what it means, or how to start">'
      + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="rtSave(\'' + (id || "") + '\')">Save</button>'
      + (r ? '<button class="btn ghost sm" style="margin-top:8px;width:100%;color:var(--danger)" onclick="rtDel(\'' + r.id + '\')">Remove from routine</button>' : ''));
  };
  window.rtSave = function (id) {
    var label = (typeof val === "function" ? val("rt_label") : "").trim();
    if (!label) { alert("What is it?"); return; }
    var d = D(); if (!Array.isArray(d.routineItems)) d.routineItems = [];
    var r = id ? d.routineItems.find(function (x) { return x && x.id === id; }) : null;
    if (!r) { r = { id: "rt_" + (typeof uid === "function" ? uid() : String(Date.now())), order: 500, doneOn: "" }; d.routineItems.push(r); }
    r.label = label.slice(0, 80);
    r.part = (typeof val === "function") ? (val("rt_part") || "morning") : "morning";
    r.hint = ((typeof val === "function") ? val("rt_hint") : "").slice(0, 120);
    r.action = (typeof val === "function") ? (val("rt_act") || "") : "";
    r.deleted = false;
    if (typeof touch === "function") touch(r);
    if (typeof save === "function") save();
    if (typeof closeModal === "function") closeModal();
    if (typeof render === "function") render();
  };
  window.rtDel = function (id) {
    if (!confirm("Take this out of your routine?")) return;
    var r = actRoutine().find(function (x) { return x.id === id; }); if (!r) return;
    r.deleted = true;
    if (typeof touch === "function") touch(r);
    if (typeof save === "function") save();
    if (typeof closeModal === "function") closeModal();
    if (typeof render === "function") render();
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ROUTINE_SEED: ROUTINE_SEED, ROUTINE_PARTS: ROUTINE_PARTS, ROUTINE_ACTIONS: ROUTINE_ACTIONS };
}
