/* ---------- JUNK SLOTS (js/179) — Tuesdays and Thursdays, 9 · 12 · 3 ----------
   Ray, 2026-09-17: "we're doing junk hauling only on Tuesdays and Thursdays, and our time slots are nine AM,
   noon, and three PM." Mon/Wed/Fri are the day job, weekends are off (see Cap's Playbook: Ray's week).

   What this does: the next open junk slots as tap-to-book chips in the job modal (sets the date + time) and as
   an "offer these" list on the Call Lead screen; a warning when a junk job is saved outside the slots; and a
   one-line count on the Stand-up card. Rules live in JUNK_SLOT_DAYS / JUNK_SLOT_TIMES so they're one edit. */
const JUNK_SLOT_DAYS = [2, 4];                        // Tue, Thu (JS getDay)
const JUNK_SLOT_TIMES = ["09:00", "12:00", "15:00"];
const JUNK_SLOT_DAY_NAMES = { 2: "Tue", 4: "Thu" };

/* ===================== pure (node-testable) ===================== */
function junkSlotYmd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
/* the next n slots on or after `from` (YYYY-MM-DD), each marked taken if a live job sits on that date + time */
function junkSlotsNext(from, jobs, n) {
  n = n || 8;
  const busy = {};
  (jobs || []).forEach(j => { if (!j || j.deleted || j.done) return; const days = Array.isArray(j.workDays) && j.workDays.length ? j.workDays : (j.date ? [j.date] : []); days.forEach(d => { busy[d + " " + (j.time || "")] = j.title || "Job"; }); });
  const out = []; const d = new Date(from + "T00:00:00");
  for (let i = 0; i < 60 && out.length < n; i++) {
    const day = d.getDay();
    if (JUNK_SLOT_DAYS.indexOf(day) >= 0) {
      const ymd = junkSlotYmd(d);
      JUNK_SLOT_TIMES.forEach(t => { if (out.length >= n) return; const key = ymd + " " + t; out.push({ date: ymd, time: t, day: JUNK_SLOT_DAY_NAMES[day], taken: !!busy[key], job: busy[key] || "" }); });
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}
function junkSlotIsValid(date, time) {
  if (!date) return false;
  const day = new Date(date + "T00:00:00").getDay();
  return JUNK_SLOT_DAYS.indexOf(day) >= 0 && (!time || JUNK_SLOT_TIMES.indexOf(String(time).slice(0, 5)) >= 0);
}
function junkSlotLabel(s) { const h = +s.time.slice(0, 2); const t = h === 12 ? "noon" : (h > 12 ? (h - 12) + " pm" : h + " am"); return s.day + " " + (+s.date.slice(5, 7)) + "/" + (+s.date.slice(8, 10)) + " " + t; }
/* is this job a junk job? the quote's kind/items say so; a title mentioning junk/haul/cleanout is the fallback */
function junkSlotJobIsJunk(j, quote) {
  if (quote && typeof quoteIsJunk === "function" && quoteIsJunk(quote)) return true;
  return /junk|haul|clean.?out|move.?out/i.test(String((j && j.title) || ""));
}

/* ===================== UI ===================== */
function junkSlotsHTML(dateId, timeId, onSet) {
  const jobs = (typeof actJ === "function") ? actJ() : [];
  const from = (typeof today === "function") ? today() : junkSlotYmd(new Date());
  const slots = junkSlotsNext(from, jobs, 9);
  const openCount = slots.filter(s => !s.taken).length;
  const chip = s => dateId
    ? `<button type="button" class="btn ${s.taken ? "ghost" : "acc"} sm" style="flex:0 0 auto;opacity:${s.taken ? .55 : 1}" title="${s.taken ? esc("taken: " + s.job) : "tap to book this slot"}" onclick="junkSlotPick('${s.date}','${s.time}','${dateId}','${timeId || ""}','${onSet || ""}')">${esc(junkSlotLabel(s))}${s.taken ? " ✕" : ""}</button>`
    : `<span class="badge" style="background:${s.taken ? "var(--soft)" : "#e9f1dc"};color:${s.taken ? "var(--muted)" : "#1b2330"};${s.taken ? "text-decoration:line-through" : ""}">${esc(junkSlotLabel(s))}</span>`;
  return `<div style="margin:6px 0 10px"><div class="sub" style="margin-bottom:4px">🗓 Junk slots · Tue &amp; Thu · 9, noon, 3 · <b>${openCount} open</b> in the next two weeks</div><div class="row" style="gap:6px;flex-wrap:wrap">${slots.map(chip).join("")}</div></div>`;
}
if (typeof window !== "undefined") {
  window.junkSlotPick = function (date, time, dateId, timeId, onSet) {
    const de = document.getElementById(dateId); if (de) de.value = date;
    const te = timeId ? document.getElementById(timeId) : null; if (te) te.value = time;
    if (onSet && typeof window[onSet] === "function") window[onSet]();
    if (typeof toast === "function") toast("Slot set: " + date + " " + time);
  };
  /* the save-time check: a junk job outside the slots asks before it books */
  window.junkSlotConfirm = function (j, quote) {
    if (!junkSlotJobIsJunk(j, quote)) return true;
    if (junkSlotIsValid(j.date, j.time)) return true;
    return confirm("Junk jobs run Tuesdays and Thursdays at 9, noon or 3. This one is " + (j.date || "undated") + (j.time ? " at " + j.time : "") + ". Book it anyway?");
  };
  window.junkSlotsHTML = junkSlotsHTML;
  /* one line for the Stand-up card */
  window.junkSlotsWeekLine = function () {
    const jobs = (typeof actJ === "function") ? actJ() : []; const from = (typeof today === "function") ? today() : junkSlotYmd(new Date());
    const wk = junkSlotsNext(from, jobs, 6); const open = wk.filter(s => !s.taken);
    return open.length ? "🗓 Junk slots open: " + open.slice(0, 4).map(junkSlotLabel).join(" · ") + (open.length > 4 ? " +" + (open.length - 4) : "") : "🗓 Junk slots: all six taken this week and next";
  };
}
if (typeof module !== "undefined" && module.exports) { module.exports = { junkSlotsNext: junkSlotsNext, junkSlotIsValid: junkSlotIsValid, junkSlotLabel: junkSlotLabel, junkSlotJobIsJunk: junkSlotJobIsJunk, JUNK_SLOT_DAYS: JUNK_SLOT_DAYS, JUNK_SLOT_TIMES: JUNK_SLOT_TIMES }; }
