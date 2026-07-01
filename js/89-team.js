/* ---------- TEAM CONTACT PROFILES (js/89) ----------
   A team/contacts DIRECTORY (every active member of the active org) + a per-member PROFILE page with a big
   avatar, role/title, and ONE-TAP 📞 Call (tel:) · 💬 Text (sms:) · ✉️ Email (mailto:). A member may edit
   THEIR OWN profile (photo/phone/email/title); an owner/manager may edit ANY member's (mirrors the Admin
   panel + the server's sanitizeUserWrites self-write rule — a crew member's write to someone ELSE's record is
   reverted server-side, and the owner-only role/passhash/active fields are never touched here).

   Access: the directory is visible to every SIGNED-IN role (crew need to reach each other); roleAllows()
   special-cases "team" like "receipts". Signed-out sees nothing. Contact fields are additive on the account
   record: phone / email / avatarId / title — backfilled by teamProfileMigrate() (mirrors the server's
   migrateStore) so legacy accounts default cleanly with zero loss. */

/* ----- additive-field migration (client mirror of the server's migrateStore backfill) ----- */
function teamProfileMigrate() {
  if (!Array.isArray(S.users)) return;
  S.users.forEach(u => {
    if (!u || u.kind || u.deleted) return;           // real accounts only (skip memberships / __roles__ / tombstones)
    if (u.phone === undefined) u.phone = "";
    if (u.email === undefined) u.email = "";
    if (u.avatarId === undefined) u.avatarId = null;
    if (u.title === undefined) u.title = "";
    // NB: no updatedAt bump — this local default always LOSES to a real profile edit on merge (loss-free + idempotent).
  });
}
window.teamProfileMigrate = teamProfileMigrate;

/* ----- helpers ----- */
window.TEAM_OPEN = window.TEAM_OPEN || null;   // an account id when a profile page is open; null = the directory
function teamMembers() {
  // active members of the ACTIVE org (same source as the Admin panel), name-sorted
  const list = (typeof orgMembers === "function") ? orgMembers(S.biz) : (typeof realAccounts === "function" ? realAccounts() : []);
  return list.filter(u => u && u.active !== false)
    .sort((a, b) => String(a.name || a.username || "").toLowerCase().localeCompare(String(b.name || b.username || "").toLowerCase()));
}
function teamMemberById(id) { return (S.users || []).find(u => u && u.id === id && !u.kind && !u.deleted) || null; }
function teamDisplayName(u) { return (u && (u.name || u.username)) || "—"; }
function teamRoleKey(u) { return (u && ((typeof roleInOrg === "function" && roleInOrg(u.id, S.biz)) || u.role)) || "crew"; }
function teamTitle(u) {   // the member's own free-text title, else the role's label
  if (u && u.title) return u.title;
  const rk = teamRoleKey(u);
  return (typeof roleLabel === "function") ? roleLabel(rk) : rk;
}
function teamInitials(u) {
  const s = String((u && (u.name || u.username)) || "").trim();
  if (!s) return "🙂";
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}
// a stable, pleasant color per member (hashed from the id) for the initials fallback
const TEAM_COLORS = ["#1B2A4E", "#2E7D64", "#8A4B2B", "#5A4B8A", "#8A2B4B", "#2B6E8A", "#6E5A2B", "#3B5A2B"];
function teamColor(u) {
  const s = String((u && (u.id || u.username)) || "x");
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TEAM_COLORS[h % TEAM_COLORS.length];
}
// avatar block: the uploaded photo, or a colored initials circle. size = px diameter.
function teamAvatar(u, size) {
  size = size || 44;
  const fs = Math.round(size * 0.4);
  const base = `width:${size}px;height:${size}px;border-radius:50%;flex:0 0 auto;object-fit:cover;display:inline-flex;align-items:center;justify-content:center`;
  if (u && u.avatarId && typeof jsUploadUrl === "function") {
    return `<img src="${esc(jsUploadUrl(u.avatarId))}" alt="" style="${base};background:var(--soft)">`;
  }
  return `<span aria-hidden="true" style="${base};background:${teamColor(u)};color:#fff;font-weight:800;font-size:${fs}px">${esc(teamInitials(u))}</span>`;
}
// sanitizers for the one-tap links (mirror js/61 tel() + js/06 customer link handling)
function teamTel(ph) { return String(ph || "").replace(/[^0-9+]/g, ""); }
function teamEmailOk(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || "").trim()); }
function teamFmtPhone(ph) { return (typeof fmtPhone === "function") ? fmtPhone(ph) : String(ph || ""); }
// may the current session edit THIS member's profile? self always; owner/manager for anyone (Admin-panel parity).
function teamCanEdit(id) {
  const me = (typeof curUser === "function") ? curUser() : null;
  if (me && me.id === id) return true;
  return (typeof canManageMembers === "function") && canManageMembers();
}

/* ----- the page (dispatched from render() on TAB==="team") ----- */
function rTeam() {
  const me = (typeof curUser === "function") ? curUser() : null;
  if (!me) { view.innerHTML = `<div class="card"><div class="nm">Team</div><div class="sub">Sign in to see the team directory.</div></div>`; return; }
  if (window.TEAM_OPEN) {
    const u = teamMemberById(window.TEAM_OPEN);
    if (u && teamMembers().some(m => m.id === u.id)) { teamRenderProfile(u); return; }
    window.TEAM_OPEN = null;   // stale / not a member of this org → fall back to the directory
  }
  teamRenderDirectory();
}
window.rTeam = rTeam;

function teamQuickIcons(u) {
  const tel = teamTel(u.phone), email = (u.email || "").trim();
  let h = `<div class="row" style="gap:6px;flex:0 0 auto" onclick="event.stopPropagation()">`;
  if (tel) h += `<a class="btn ghost sm" href="tel:${esc(tel)}" aria-label="Call" title="Call" style="padding:6px 10px">📞</a>`;
  if (tel) h += `<a class="btn ghost sm" href="sms:${esc(tel)}" aria-label="Text" title="Text" style="padding:6px 10px">💬</a>`;
  if (teamEmailOk(email)) h += `<a class="btn ghost sm" href="mailto:${esc(email)}" aria-label="Email" title="Email" style="padding:6px 10px">✉️</a>`;
  return h + `</div>`;
}

function teamRenderDirectory() {
  const members = teamMembers();
  let h = `<div class="secthd"><h2>Team</h2></div>
    <p class="muted" style="margin:0 4px 10px">Everyone on the ${esc(typeof orgName === "function" ? orgName(S.biz) : S.biz)} team. Tap a person for their profile, or use the quick call / text / email.</p>`;
  if (!members.length) { view.innerHTML = h + `<div class="card"><div class="muted">No team members yet.</div></div>`; return; }
  h += `<div style="display:flex;flex-direction:column;gap:8px">`;
  members.forEach(u => {
    const mine = me_is(u);
    h += `<div class="card" style="padding:10px 12px" onclick="teamOpen('${esc(u.id)}')" role="button" tabindex="0">
      <div class="row" style="align-items:center;gap:12px;cursor:pointer">
        ${teamAvatar(u, 46)}
        <div class="grow" style="min-width:0">
          <div class="nm" style="font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(teamDisplayName(u))}${mine ? ` <span class="sub" style="display:inline">· you</span>` : ""}</div>
          <div class="sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(teamTitle(u))}</div>
        </div>
        ${teamQuickIcons(u)}
      </div></div>`;
  });
  h += `</div>`;
  view.innerHTML = h;
}
function me_is(u) { const me = (typeof curUser === "function") ? curUser() : null; return !!(me && u && me.id === u.id); }

function teamRenderProfile(u) {
  const rk = teamRoleKey(u), tel = teamTel(u.phone), email = (u.email || "").trim();
  const bigBtn = (href, icon, label, color) =>
    `<a class="btn" href="${href}" style="flex:1 1 30%;min-width:96px;text-align:center;background:${color};color:#fff;padding:14px 8px;font-weight:700">${icon}<br>${label}</a>`;
  let h = `<div class="row" style="align-items:center;gap:8px;margin:2px 2px 12px">
      <button class="btn ghost sm" onclick="teamBack()">← Team</button>
      <div class="grow"></div>
      ${teamCanEdit(u.id) ? `<button class="btn ghost sm" onclick="teamEditProfile('${esc(u.id)}')">✏️ Edit</button>` : ""}
    </div>`;
  h += `<div class="card" style="text-align:center;padding:22px 16px">
      <div style="display:flex;justify-content:center;margin-bottom:12px">${teamAvatar(u, 112)}</div>
      <div class="nm" style="font-size:22px;margin-bottom:4px">${esc(teamDisplayName(u))}</div>
      <div style="margin-bottom:2px">${(typeof roleBadge === "function") ? roleBadge(rk) : esc(rk)}</div>
      ${u.title ? `<div class="sub" style="margin-top:6px">${esc(u.title)}</div>` : ""}`;

  const buttons = [];
  if (tel) buttons.push(bigBtn(`tel:${esc(tel)}`, "📞", "Call", "var(--accent)"));
  if (tel) buttons.push(bigBtn(`sms:${esc(tel)}`, "💬", "Text", "#2E7D64"));
  if (teamEmailOk(email)) buttons.push(bigBtn(`mailto:${esc(email)}`, "✉️", "Email", "#5A4B8A"));
  if (buttons.length) h += `<div class="row" style="gap:8px;flex-wrap:wrap;justify-content:center;margin-top:16px">${buttons.join("")}</div>`;

  const lines = [];
  if (u.phone) lines.push(`<div class="row" style="justify-content:center;gap:6px"><span class="sub">📞</span><a href="tel:${esc(tel)}" style="color:var(--brand-text,var(--accent));text-decoration:underline">${esc(teamFmtPhone(u.phone))}</a></div>`);
  if (teamEmailOk(email)) lines.push(`<div class="row" style="justify-content:center;gap:6px"><span class="sub">✉️</span><a href="mailto:${esc(email)}" style="color:var(--brand-text,var(--accent));text-decoration:underline;word-break:break-all">${esc(email)}</a></div>`);
  if (lines.length) h += `<div style="margin-top:16px;display:flex;flex-direction:column;gap:6px">${lines.join("")}</div>`;
  else if (!buttons.length) h += `<div class="muted" style="margin-top:14px">No contact details yet.${teamCanEdit(u.id) ? " Tap Edit to add a phone, email, or photo." : ""}</div>`;

  h += `</div>`;
  view.innerHTML = h;
}

window.teamOpen = function (id) { window.TEAM_OPEN = id; render(); };
window.teamBack = function () { window.TEAM_OPEN = null; render(); };
window.teamEditMine = function () { const me = (typeof curUser === "function") ? curUser() : null; if (me) teamEditProfile(me.id); };

/* ----- edit ----- */
window.teamEditProfile = function (id) {
  if (!teamCanEdit(id)) { alert("You can only edit your own profile."); return; }
  const u = teamMemberById(id); if (!u) return;
  const who = me_is(u) ? "your profile" : esc(teamDisplayName(u)) + "’s profile";
  modal("Edit " + who, `
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;margin-bottom:10px">
      <div id="team_avaprev">${teamAvatar(u, 96)}</div>
      <div class="row" style="gap:6px">
        <button class="btn ghost sm" onclick="teamPickPhoto('${esc(u.id)}')">📷 ${u.avatarId ? "Change photo" : "Add photo"}</button>
        ${u.avatarId ? `<button class="btn ghost sm" onclick="teamRemovePhoto('${esc(u.id)}')">Remove</button>` : ""}
      </div>
      <div id="team_avamsg" class="sub" style="min-height:14px"></div>
    </div>
    <label>Title (e.g. Crew, Owner-operator)</label><input id="tp_title" autocomplete="off" value="${esc(u.title || "")}" placeholder="Crew">
    <label>Phone</label><input id="tp_phone" type="tel" autocomplete="off" inputmode="tel" value="${esc(u.phone || "")}" placeholder="(252) 555-0100">
    <label>Email</label><input id="tp_email" type="email" autocomplete="off" inputmode="email" value="${esc(u.email || "")}" placeholder="name@example.com">
    <button class="btn acc" style="margin-top:14px;width:100%" onclick="teamSaveProfile('${esc(u.id)}')">Save profile</button>`);
};

// upload happens immediately (its own action); phone/email/title save on "Save profile".
window.teamPickPhoto = function (id) {
  if (!teamCanEdit(id)) return;
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*";
  inp.onchange = function () { const f = inp.files && inp.files[0]; if (f) teamUploadPhoto(id, f); };
  inp.click();
};
function teamUploadPhoto(id, file) {
  if (typeof submitGuard === "function" && !submitGuard("team_photo", 800)) return;
  const msg = document.getElementById("team_avamsg"); if (msg) msg.textContent = "Uploading…";
  Promise.resolve(typeof jsUpload === "function" ? jsUpload(file) : Promise.reject(new Error("upload unavailable")))
    .then(function (blobId) {
      const u = teamMemberById(id); if (!u) return;
      u.avatarId = blobId; if (typeof touch === "function") touch(u); save();
      if (typeof logChange === "function") logChange("update", "account", u.id, "Updated profile photo for " + (u.username || u.name || u.id));
      const prev = document.getElementById("team_avaprev"); if (prev) prev.innerHTML = teamAvatar(u, 96);
      if (msg) msg.textContent = "Photo updated.";
    })
    .catch(function (e) { if (msg) msg.textContent = "Couldn't upload — " + ((e && e.message) || "try again."); });
}
window.teamRemovePhoto = function (id) {
  if (!teamCanEdit(id)) return;
  const u = teamMemberById(id); if (!u || !u.avatarId) return;
  u.avatarId = null; if (typeof touch === "function") touch(u); save();
  if (typeof logChange === "function") logChange("update", "account", u.id, "Removed profile photo for " + (u.username || u.name || u.id));
  const prev = document.getElementById("team_avaprev"); if (prev) prev.innerHTML = teamAvatar(u, 96);
  const msg = document.getElementById("team_avamsg"); if (msg) msg.textContent = "Photo removed.";
  render();   // refresh the underlying page too (still on the modal); harmless
};
window.teamSaveProfile = function (id) {
  if (!teamCanEdit(id)) { alert("You can only edit your own profile."); return; }
  if (typeof submitGuard === "function" && !submitGuard("team_save", 800)) return;
  const u = teamMemberById(id); if (!u) return;
  const email = (val("tp_email") || "").trim().toLowerCase();
  if (email && !teamEmailOk(email)) { alert("That email doesn't look right. Use name@example.com — or leave it blank."); return; }
  u.title = (val("tp_title") || "").trim();
  u.phone = (val("tp_phone") || "").trim();
  u.email = email;
  if (typeof touch === "function") touch(u);
  save();
  if (typeof logChange === "function") logChange("update", "account", u.id, "Updated profile for " + (u.username || u.name || u.id));
  if (typeof closeModal === "function") closeModal();
  render();
};
