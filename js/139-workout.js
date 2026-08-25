/* ---------- WORKOUT BRIDGE (js/139) — his own app, mirrored into j-Suite ------------------------------
   Ray, 2026-08-24, uploading rjworkout.html: "this is my workout app. could we integrate it or bridge it so
   you can track my workouts?"

   ⭐ BRIDGE, NOT PORT — and that's a deliberate call, not laziness. His app is 92KB of working single-file
   HTML he built and uses. Rewriting it into j-Suite modules would risk a tool that already does its job, be
   a big rewrite, and gain nothing he asked for: he wants the DATA visible here, not the UI moved.

   HOW THE BRIDGE WORKS — same-origin localStorage. workout.html is now served by sync-server from j-Suite's
   own origin, so his app and this app share a localStorage. His file is byte-identical to what he uploaded
   and is never modified: this module simply READS `rj-workout-v3` and mirrors a summary into a synced
   collection. If he improves his app, he drops the new file in and nothing here needs touching.

   ⚠️ ONE-TIME CARRY-OVER. localStorage is per-origin, so history from wherever he opened the file BEFORE
   does not come along. There's a paste-in box for that — his raw `rj-workout-v3` value, once.

   WHAT GETS MIRRORED is a SUMMARY, not the raw blob: his state carries a full copy of `intents` inside every
   one of up to 120 history days, which would bloat data.json for no benefit. One record per session — date,
   what he trained, each exercise's sets, total volume — which is what "track my workouts" actually needs and
   what Cap can read.

   ⛔ NO STREAKS, NO TARGETS, NO "you haven't trained since…". Same rule as the reading list and the shelf:
   this records what he did. It does not grade him. The mirror is a log, and the numbers shown are his own. */

var WK_KEY = "rj-workout-v3";
var WK_URL = "/workout.html";

function wkRaw() {
  try { var s = localStorage.getItem(WK_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
function actWorkouts() { return (D().workoutLogs || []).filter(function (w) { return w && !w.deleted; }); }

/* the active plan's day definitions, so an exercise id can be given its real name */
function wkPlanDays(raw) {
  if (!raw || !Array.isArray(raw.plans)) return [];
  var p = raw.plans.find(function (x) { return x && x.id === raw.activePlanId; }) || raw.plans[0];
  return (p && Array.isArray(p.days)) ? p.days : [];
}
function wkNameMap(days) {
  var m = {};
  (days || []).forEach(function (d) {
    m[d.id] = { day: d.day || d.id, label: d.label || "", ex: {} };
    (d.exercises || []).forEach(function (e) { m[d.id].ex[e.id] = { name: e.name || e.id, unit: e.unit || "lbs" }; });
  });
  return m;
}

/* ---- SUMMARISE one history day into session records. Pure: raw in, records out. ---- */
function wkSessions(raw) {
  if (!raw) return [];
  var out = [];
  var plans = Array.isArray(raw.plans) ? raw.plans : [];
  plans.forEach(function (p) {
    var names = wkNameMap(p.days || []);
    (p.history || []).forEach(function (h) {
      if (!h || !h.date || !h.days) return;
      Object.keys(h.days).forEach(function (dayId) {
        var exs = h.days[dayId] || {};
        var meta = names[dayId] || { day: dayId, label: "", ex: {} };
        var lines = [], volume = 0, sets = 0;
        Object.keys(exs).forEach(function (exId) {
          var rounds = exs[exId];
          if (!rounds) return;
          var arr = Array.isArray(rounds) ? rounds : Object.keys(rounds).map(function (k) { return rounds[k]; });
          var done = arr.filter(function (r) { return r && (+r.weight > 0 || +r.reps > 0); })
                        .map(function (r) { return { weight: +r.weight || 0, reps: +r.reps || 0 }; });
          if (!done.length) return;
          done.forEach(function (r) { volume += r.weight * r.reps; sets++; });
          var em = meta.ex[exId] || { name: exId, unit: "lbs" };
          lines.push({ name: em.name, unit: em.unit, sets: done });
        });
        if (!lines.length) return;
        out.push({
          id: "wk_" + h.date + "_" + dayId,
          date: h.date, dayId: dayId,
          dayName: meta.day, label: meta.label,
          planId: p.id || "", planName: p.name || "",
          exercises: lines, setCount: sets,
          volume: Math.round(volume)
        });
      });
    });
  });
  return out.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
}

/* body weight log — its own small series, kept whole because it IS small */
function wkBody(raw) {
  if (!raw || !Array.isArray(raw.bodyLog)) return [];
  return raw.bodyLog.filter(function (e) { return e && e.date; })
    .map(function (e) { return { date: e.date, weight: (+e.weight || null), bodyFat: (e.bodyFat == null ? null : +e.bodyFat), notes: e.notes || "" }; })
    .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
}

/* ---- MIRROR into the synced collection. Idempotent by id (date+day), so re-running is free and a
   corrected session overwrites rather than duplicating. Returns how many records changed. ---- */
function wkSync(raw) {
  raw = raw || wkRaw();
  if (!raw) return 0;
  var sessions = wkSessions(raw);
  if (!sessions.length) return 0;
  var d = D(); if (!Array.isArray(d.workoutLogs)) d.workoutLogs = [];
  var byId = {};
  d.workoutLogs.forEach(function (w) { if (w && w.id) byId[w.id] = w; });
  var changed = 0;
  sessions.forEach(function (s) {
    var cur = byId[s.id];
    var next = JSON.stringify({ e: s.exercises, v: s.volume, c: s.setCount });
    if (cur && JSON.stringify({ e: cur.exercises, v: cur.volume, c: cur.setCount }) === next) return;
    if (cur) { Object.assign(cur, s, { deleted: false }); if (typeof touch === "function") touch(cur); }
    else { var r = Object.assign({}, s, { deleted: false }); if (typeof touch === "function") touch(r); d.workoutLogs.push(r); }
    changed++;
  });
  /* body log rides on a single doc-style record — one series, not one record per weigh-in */
  var body = wkBody(raw);
  if (body.length) {
    var bid = "wk_body";
    var b = d.workoutLogs.find(function (w) { return w && w.id === bid; });
    var payload = { id: bid, kind: "body", date: body[0].date, series: body, deleted: false };
    if (!b) { if (typeof touch === "function") touch(payload); d.workoutLogs.push(payload); changed++; }
    else if (JSON.stringify(b.series) !== JSON.stringify(body)) { Object.assign(b, payload); if (typeof touch === "function") touch(b); changed++; }
  }
  if (changed && typeof save === "function") save();
  return changed;
}

/* ---- the card on the Life tab ---- */
function wkCardHTML() {
  var logs = actWorkouts().filter(function (w) { return w.kind !== "body"; })
    .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  var bodyRec = actWorkouts().find(function (w) { return w.kind === "body"; });
  var latestBody = (bodyRec && bodyRec.series && bodyRec.series[0]) || null;

  var h = '<div class="card"><div class="row" style="align-items:center;gap:8px">'
    + '<div class="grow" style="font-weight:800">🏋️ Workouts</div>'
    + '<a class="btn ghost sm" style="flex:0 0 auto;text-decoration:none" href="' + WK_URL + '">Open</a></div>';

  if (!logs.length) {
    h += '<div class="sub" style="white-space:normal;margin-top:6px">Nothing mirrored yet. Open the app and log a session — it syncs here on its own.</div>'
      + '<button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="wkImport()">Bring my old history over</button></div>';
    return h;
  }
  if (latestBody && latestBody.weight) {
    h += '<div class="sub" style="margin-top:2px">' + esc(latestBody.weight) + ' lb'
      + (latestBody.bodyFat != null ? ' · ' + esc(latestBody.bodyFat) + '% bf' : '')
      + ' · ' + esc((typeof fmtDate === "function") ? fmtDate(latestBody.date) : latestBody.date) + '</div>';
  }
  logs.slice(0, 6).forEach(function (w) {
    h += '<div class="li" style="align-items:flex-start;cursor:pointer" onclick="wkOpen(\'' + w.id + '\')">'
      + '<div class="grow"><div class="nm">' + esc(w.dayName || w.dayId) + (w.label ? ' · ' + esc(String(w.label).split("—")[0].trim()) : '') + '</div>'
      + '<div class="sub">' + esc((typeof fmtDate === "function") ? fmtDate(w.date) : w.date)
      + ' · ' + w.setCount + ' set' + (w.setCount === 1 ? '' : 's')
      + (w.volume ? ' · ' + w.volume.toLocaleString() + ' lb moved' : '') + '</div></div></div>';
  });
  if (logs.length > 6) h += '<div class="sub" style="padding:4px 2px">+ ' + (logs.length - 6) + ' more</div>';
  return h + '</div>';
}

if (typeof window !== "undefined") {
  window.wkRaw = wkRaw; window.wkSessions = wkSessions; window.wkBody = wkBody;
  window.wkSync = wkSync; window.wkCardHTML = wkCardHTML; window.actWorkouts = actWorkouts;

  window.wkOpen = function (id) {
    var w = actWorkouts().find(function (x) { return x.id === id; }); if (!w) return;
    var body = '<div class="sub" style="margin-bottom:8px">' + esc((typeof fmtDate === "function") ? fmtDate(w.date) : w.date)
      + (w.label ? ' · ' + esc(w.label) : '') + '</div>';
    (w.exercises || []).forEach(function (e) {
      body += '<div style="margin-bottom:8px"><div style="font-weight:700">' + esc(e.name) + '</div>'
        + '<div class="sub">' + (e.sets || []).map(function (s) {
            return (e.unit === "BW" || !s.weight) ? (s.reps + (e.unit === "sec" ? "s" : " reps"))
                                                  : (s.weight + " × " + s.reps);
          }).join("  ·  ") + '</div></div>';
    });
    body += '<div class="sub" style="margin-top:6px">' + w.setCount + ' sets'
      + (w.volume ? ' · ' + w.volume.toLocaleString() + ' lb total' : '') + '</div>';
    modal(w.dayName || "Session", body);
  };

  /* one-time carry-over: paste the raw rj-workout-v3 value from wherever he used the app before */
  window.wkImport = function () {
    modal("Bring your history over", ''
      + '<div class="sub" style="white-space:normal;margin-bottom:8px">Your workout history lives in the browser you opened the app in. '
      + 'To carry it over once: open your old copy, and paste its saved data here.</div>'
      + '<label style="margin-top:0">Paste it here</label><textarea id="wk_in" rows="6" placeholder=\'{"version":4,"plans":[…]}\'></textarea>'
      + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="wkImportSave()">Import</button>');
  };
  window.wkImportSave = function () {
    var txt = (typeof val === "function" ? val("wk_in") : "").trim();
    if (!txt) { alert("Paste the data first."); return; }
    var raw = null;
    try { raw = JSON.parse(txt); } catch (e) { alert("That isn't valid data — paste the whole thing, starting with {"); return; }
    if (!raw || !Array.isArray(raw.plans)) { alert("That doesn't look like workout data (no plans in it)."); return; }
    /* seed the app's OWN storage too, so opening it here shows his history rather than an empty app */
    try { if (!localStorage.getItem(WK_KEY)) localStorage.setItem(WK_KEY, JSON.stringify(raw)); } catch (e) {}
    var n = wkSync(raw);
    if (typeof closeModal === "function") closeModal();
    if (typeof render === "function") render();
    alert(n ? ("Brought over " + n + " session" + (n === 1 ? "" : "s") + ".") : "Nothing new to bring over.");
  };

  /* mirror on load — cheap, idempotent, and means he never has to remember to press anything */
  setTimeout(function () { try { wkSync(); } catch (e) {} }, 3000);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { wkSessions: wkSessions, wkBody: wkBody, wkNameMap: wkNameMap };
}
