/* ---------- MEMBER AVAILABILITY ----------
   Each member sets the weekday/hours they can work + time-off blocks. Stored on their own
   account record (u.avail / u.timeoff) so it rides the existing per-record LWW sync — a member
   owns their own availability; the owner may edit anyone's. Scheduling (js/09-schedule.js) reads
   these to surface "who's free [date]" and flag conflicts when placing a job. */

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_AVAIL = { days: [false, true, true, true, true, true, false], start: "08:00", end: "17:00" };

/* active, real team accounts (excludes the roles config record + deactivated/deleted) */
function schedMembers() {
  const list = (typeof realAccounts === "function") ? realAccounts() : (S.users || []).filter(u => u && !u.kind && !u.deleted);
  return list.filter(u => u.active !== false);
}
function dowOf(ds) { return new Date(ds + "T00:00:00").getDay(); }
function addDays(ds, n) { const d = new Date(ds + "T00:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

/* availability status of a member on a given YYYY-MM-DD */
function availOn(u, ds) {
  const to = (u.timeoff || []).find(b => b && !b.deleted && ds >= b.start && ds <= (b.end || b.start));
  if (to) return { status: "timeoff", label: "Time off" + (to.note ? " · " + to.note : ""), cls: "off" };
  const av = u.avail;
  if (!av || !av.days) return { status: "unset", label: "Available · not set", cls: "unset" };
  if (av.days[dowOf(ds)]) return { status: "on", label: "Available" + (av.start && av.end ? " " + av.start + "–" + av.end : ""), cls: "on" };
  return { status: "off", label: "Off (" + DOW[dowOf(ds)] + ")", cls: "off" };
}
function isFree(u, ds) { const s = availOn(u, ds).status; return s === "on" || s === "unset"; }
function jobsForMemberOn(uid, ds) { return actJ().filter(j => j.date === ds && (j.crew || []).indexOf(uid) >= 0); }
function availBadge(u, ds) {
  const a = availOn(u, ds);
  const c = a.cls === "on" ? "background:var(--accent);color:var(--accent-ink)" : a.cls === "off" ? "background:var(--danger);color:#fff" : "background:var(--soft);color:var(--muted)";
  const txt = a.status === "on" ? "Free" : a.status === "timeoff" ? "Time off" : a.status === "off" ? "Off" : "Free?";
  return `<span class="badge" style="${c}">${txt}</span>`;
}

/* ===== self-service editor (owner may edit anyone) ===== */
let AVED = null;   // transient working copy of time-off while the modal is open
window.openAvailability = function (userId) {
  const me = (typeof curUser === "function") ? curUser() : null;
  const u = userId ? schedMembers().find(x => x.id === userId) : me;
  if (!u) { alert("Sign in to set your availability."); return; }
  if (!(me && me.id === u.id) && !(typeof isOwner === "function" && isOwner())) { alert("Only the owner can edit another member's availability."); return; }
  const av = u.avail || DEFAULT_AVAIL, days = av.days || DEFAULT_AVAIL.days;
  AVED = { userId: u.id, timeoff: (u.timeoff || []).filter(b => !b.deleted).map(b => ({ ...b })) };
  modal("Availability — " + esc(u.username), `
    <p class="muted" style="margin-bottom:8px">Days &amp; hours ${me && me.id === u.id ? "you" : "this member"} can work, plus any time off. Syncs to every device.</p>
    <label>Work days</label>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${DOW.map((d, i) => `<label class="subbtn" style="cursor:pointer;display:flex;align-items:center;gap:5px"><input type="checkbox" id="av_d${i}" ${days[i] ? "checked" : ""}>${d}</label>`).join("")}</div>
    <div class="row" style="gap:8px;margin-top:10px"><div class="grow"><label>Start</label><input id="av_start" type="time" value="${esc(av.start || DEFAULT_AVAIL.start)}"></div><div class="grow"><label>End</label><input id="av_end" type="time" value="${esc(av.end || DEFAULT_AVAIL.end)}"></div></div>
    <label style="margin-top:12px">Time off</label>
    <div id="av_to"></div>
    <div class="row" style="gap:6px;margin-top:6px"><div class="grow"><label class="sub">From</label><input id="av_tstart" type="date"></div><div class="grow"><label class="sub">To</label><input id="av_tend" type="date"></div></div>
    <input id="av_tnote" placeholder="Note (optional) — e.g. vacation" autocomplete="off">
    <button class="btn ghost sm" style="margin-top:6px" onclick="availAddTimeoff()">+ Add time off</button>
    <button class="btn acc" style="margin-top:14px" onclick="availSave()">Save availability</button>`);
  renderAvTimeoff();
};
function renderAvTimeoff() {
  const e = document.getElementById("av_to"); if (!e) return;
  if (!AVED.timeoff.length) { e.innerHTML = `<div class="muted">No time off scheduled.</div>`; return; }
  e.innerHTML = AVED.timeoff.slice().sort((a, b) => a.start < b.start ? -1 : 1).map(b =>
    `<div class="li"><div class="grow"><div class="nm" style="font-size:14px">${fmtDate(b.start)}${b.end && b.end !== b.start ? " – " + fmtDate(b.end) : ""}</div>${b.note ? `<div class="sub">${esc(b.note)}</div>` : ""}</div><button class="btn danger sm" onclick="availDelTimeoff('${b.id}')">Remove</button></div>`).join("");
}
window.availAddTimeoff = function () {
  const s = val("av_tstart"); let en = val("av_tend") || s; const note = val("av_tnote");
  if (!s) { alert("Pick a start date for the time off."); return; }
  if (en < s) en = s;
  AVED.timeoff.push({ id: uid(), start: s, end: en, note: note });
  ["av_tstart", "av_tend", "av_tnote"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  renderAvTimeoff();
};
window.availDelTimeoff = function (id) { AVED.timeoff = AVED.timeoff.filter(b => b.id !== id); renderAvTimeoff(); };
window.availSave = function () {
  const u = schedMembers().find(x => x.id === AVED.userId); if (!u) return;
  u.avail = { days: DOW.map((d, i) => !!(document.getElementById("av_d" + i) || {}).checked), start: val("av_start"), end: val("av_end") };
  u.timeoff = AVED.timeoff.map(b => ({ ...b, updatedAt: now() }));
  touch(u);   // per-record LWW: bump the account record so availability syncs and wins
  if (typeof logChange === "function") logChange("update", "account", u.id, "Updated availability for " + u.username);
  save(); closeModal(); render();
};
