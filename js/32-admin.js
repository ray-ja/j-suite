/* ---------- ADMIN PANEL (owner-only) ----------
   Central place to manage team accounts: roles, per-role page access, password reset,
   deactivate/reactivate, remove. Roles + the access map live on the synced account records
   (S.users), so they ride the existing sync with no server-protocol change:
     - each real account carries  u.role  (key into the roles list) and, when deactivated, u.active:false
     - the roles + page-access map is one sentinel record in S.users: {id:"__roles__",kind:"roles",roles:[...]}
   Access is ENFORCED in render()/nav (see applyAccess in 03-routing): pages a role can't see are
   hidden AND coerced-away from, so they aren't reachable, not merely invisible. */

const ROLES_ID = "__roles__";

/* canonical page registry — mirrors the nav tabs (the admin tab itself is owner-only and excluded) */
const ADMIN_PAGES = [
  { tab: "today", label: "CEO desk" }, { tab: "pipeline", label: "Pipeline" }, { tab: "accounts", label: "Customers" },
  { tab: "quotes", label: "All jobs" }, { tab: "schedule", label: "Schedule" },
  { tab: "messages", label: "Messages" },
  { tab: "map", label: "Map" }, { tab: "sales", label: "Sales" },
  { tab: "todo", label: "To-Do" }, { tab: "plan", label: "Plan" },
  { tab: "training", label: "Train" }, { tab: "market", label: "Market" },
  { tab: "opps", label: "Opps" }, { tab: "sites", label: "Sites" },
  { tab: "buildplan", label: "Build Plan" }, { tab: "inventory", label: "Inventory" },
  { tab: "resale", label: "Resale" },
  { tab: "time", label: "Time" }, { tab: "finance", label: "Finance" }, { tab: "receipts", label: "Receipts" }, { tab: "data", label: "Data" }
];
const ALL_TABS = ADMIN_PAGES.map(p => p.tab);
const CREW_PAGES = ["today", "accounts", "quotes", "schedule", "messages", "map", "sales", "todo", "inventory", "resale", "time"];
/* owner is implicit "all access" (no pages list); admin/crew seed the editable defaults */
const DEFAULT_ROLES = [
  { key: "owner", label: "Owner", builtin: true },
  { key: "admin", label: "Admin", pages: ALL_TABS.slice() },
  { key: "crew", label: "Crew", pages: CREW_PAGES.slice() }
];

/* ----- accessors ----- */
function realAccounts() { return (S.users || []).filter(u => u && !u.kind && !u.deleted); }
function ensureRolesRec() {
  if (!Array.isArray(S.users)) S.users = [];
  let r = S.users.find(u => u && u.id === ROLES_ID);
  if (!r) {
    // updatedAt:1 so a freshly-seeded default always LOSES to any real, server-side config on merge
    r = { id: ROLES_ID, kind: "roles", roles: JSON.parse(JSON.stringify(DEFAULT_ROLES)), updatedAt: 1 };
    S.users.push(r);
  }
  if (!Array.isArray(r.roles)) r.roles = JSON.parse(JSON.stringify(DEFAULT_ROLES));
  if (!r.roles.some(x => x.key === "owner")) r.roles.unshift({ key: "owner", label: "Owner", builtin: true });
  return r;
}
function rolesRec() { return ensureRolesRec(); }
function allRoles() { return rolesRec().roles; }
function roleByKey(key) { return allRoles().find(r => r.key === key) || (key === "owner" ? { key: "owner", label: "Owner", builtin: true } : null); }
function touchRoles() { rolesRec().updatedAt = now(); }

function hasAnyAccount() { return realAccounts().length > 0; }
/* role for the current session. No signed-in user:
   - while NO accounts exist yet (brand-new server / #token= bootstrap) ⇒ owner, so the very
     first device can reach Admin/Data and create the initial owner account to finish setup;
   - once any account exists, a signed-out / offline device is RESTRICTED to a crew-equivalent
     view (never owner) — a logged-out device must not see owner-only tabs. */
const NO_SESSION_ROLE = "__nosession__";
function curRoleKey() {
  const u = (typeof curUser === "function") ? curUser() : null;
  const real = (u && u.role) ? u.role : (hasAnyAccount() ? NO_SESSION_ROLE : "owner");
  // Owner "view-as" preview (js/48): downgrade only, and only for a real owner — never escalates.
  if (window.VIEW_AS && real === "owner" && window.VIEW_AS !== "owner") return window.VIEW_AS;
  return real;
}
function isOwner() { return curRoleKey() === "owner"; }
function roleAllows(key, tab) {
  if (key === "owner") return true;            // owner sees everything, incl. the admin panel
  if (tab === "admin" || tab === "approvals") return false;   // admin panel + approvals inbox are owner-only, always (hard-gated: hidden AND coerced-away)
  if (key === NO_SESSION_ROLE) return CREW_PAGES.indexOf(tab) >= 0;  // signed-out: fixed crew-equivalent set, independent of editable roles
  const r = roleByKey(key);
  if (!r) return true;                          // unknown role ⇒ fail-open, never brick a user
  if (!Array.isArray(r.pages)) return true;     // role with no restriction ⇒ all pages
  return r.pages.indexOf(tab) >= 0;
}
function canSee(tab) { return roleAllows(curRoleKey(), tab); }
function activeOwners() { return realAccounts().filter(u => u.role === "owner" && u.active !== false); }

/* ----- migration: run from load() once accounts exist ----- */
function adminMigrate() {
  if (!Array.isArray(S.users)) S.users = [];
  ensureRolesRec();
  const accs = realAccounts();
  let changed = false;
  if (accs.length && !accs.some(u => u.role === "owner")) {
    // legacy data with accounts but no roles: promote the earliest-created account to owner
    const owner = accs.slice().sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))[0];
    owner.role = "owner"; touch(owner); changed = true;     // genuine intent ⇒ bump so it syncs/wins
  }
  accs.forEach(u => { if (!u.role) u.role = "crew"; });      // remaining roleless ⇒ crew (no churn)
  if (changed) save();
}

/* ----- nav/render enforcement (called from render() in 03-routing) ----- */
function applyAccess() {
  // The grouped nav (renderNav in js/03) already hides any group with no accessible tab, so visibility
  // is handled there. Here we only COERCE TAB away from a page this role can't see (incl. the messaging
  // rollout gate) so a hidden page is never reachable.
  const msgOff = (typeof msgEnabled === "function") ? !msgEnabled() : true;
  const allowed = t => (t === "messages" && msgOff) ? false : canSee(t);
  if (!allowed(TAB)) TAB = allowed("today") ? "today" : (ALL_TABS.filter(allowed)[0] || "today");
  if (typeof updateMsgBadge === "function") updateMsgBadge();
}
window.applyAccess = applyAccess;

/* ===================== the panel ===================== */
function roleBadge(key) {
  const r = roleByKey(key), label = r ? r.label : (key || "—");
  const c = key === "owner" ? "background:var(--brand);color:#fff" : key === "admin" ? "background:var(--accent);color:var(--accent-ink)" : "background:var(--soft);color:var(--ink)";
  return `<span class="badge" style="${c}">${esc(label)}</span>`;
}
function rAdmin() {
  if (!isOwner()) { view.innerHTML = `<div class="card"><div class="nm">Owner only</div><div class="sub">This screen is restricted to the Owner role.</div></div>`; return; }
  const accs = realAccounts(), roles = allRoles();
  const me = (typeof curUser === "function") ? curUser() : null;
  const roleOpts = sel => roles.map(r => `<option value="${esc(r.key)}" ${sel === r.key ? "selected" : ""}>${esc(r.label)}</option>`).join("");

  let h = `<div class="secthd"><h2>Admin</h2><button class="btn ghost sm" onclick="adminOpenCreate()">+ Account</button></div>
    <p class="muted" style="margin:0 4px 6px">Manage who can sign in, what role they hold, and which tabs each role sees. Roles &amp; access sync to every device.</p>`;

  /* ---- accounts ---- */
  h += `<h2>Team accounts</h2>`;
  if (!accs.length) h += `<div class="card"><div class="muted">No accounts yet. Add one to start assigning roles.</div></div>`;
  accs.forEach(u => {
    const active = u.active !== false, mine = me && me.id === u.id;
    h += `<div class="card">
      <div class="row"><div class="grow"><div class="nm">${esc(u.username)}${mine ? ` <span class="sub" style="display:inline">· you</span>` : ""}</div>
        <div class="sub">${roleBadge(u.role || "crew")} ${active ? `<span class="badge" style="background:var(--soft);color:var(--muted)">Active</span>` : `<span class="badge" style="background:var(--danger);color:#fff">Deactivated</span>`} <span class="sub" id="pres_${u.id}" style="display:inline;color:var(--muted)"></span></div></div>
        <select onchange="adminSetRole('${u.id}',this.value)" style="width:auto;min-width:110px">${roleOpts(u.role || "crew")}</select></div>
      <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn ghost sm" onclick="adminSetName('${u.id}')">🧑 ${u.name ? esc(u.name) : "Set full name"}</button>
        <button class="btn ghost sm" onclick="adminSetEmail('${u.id}')">✉ ${u.email ? esc(u.email) : "Set email (SSO)"}</button>
        <button class="btn ghost sm" onclick="adminResetPw('${u.id}')">Reset password</button>
        <button class="btn ghost sm" onclick="adminToggleActive('${u.id}')">${active ? "Deactivate" : "Reactivate"}</button>
        <button class="btn danger sm" onclick="adminRemove('${u.id}')">Remove</button>
      </div></div>`;
  });

  /* ---- roles & page access ---- */
  h += `<div class="secthd" style="margin-top:18px"><h2>Roles &amp; page access</h2><button class="btn ghost sm" onclick="adminOpenAddRole()">+ Role</button></div>`;
  roles.forEach(r => {
    const builtin = r.key === "owner";
    h += `<div class="card"><div class="row"><div class="grow"><div class="nm">${esc(r.label)} ${roleBadge(r.key)}</div>
      <div class="sub">${esc(r.key)}${builtin ? " · built-in" : ""}</div></div>
      ${builtin ? "" : `<button class="btn danger sm" onclick="adminDeleteRole('${esc(r.key)}')">Delete role</button>`}</div>`;
    if (builtin) { h += `<div class="muted" style="margin-top:8px">Full access — every page, including this Admin panel. Cannot be restricted.</div>`; }
    else {
      h += `<div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px">` + ADMIN_PAGES.map(p => {
        const on = roleAllows(r.key, p.tab);
        return `<label style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:600;white-space:nowrap">
          <input type="checkbox" style="width:18px;height:18px" ${on ? "checked" : ""} onchange="adminTogglePage('${esc(r.key)}','${p.tab}')">${esc(p.label)}</label>`;
      }).join("") + `</div>`;
    }
    h += `</div>`;
  });
  h += `<h2 style="margin-top:18px">Activity</h2><div class="card"><div id="auditlog" class="sub">Loading recent changes…</div></div>`;
  view.innerHTML = h;
  if (window.loadPresenceUI) setTimeout(loadPresenceUI, 30);
  if (window.loadAuditUI) setTimeout(loadAuditUI, 30);
}
window.agoTxt = function (ms) {
  if (!ms) return "never synced";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return "online now";
  const m = Math.round(s / 60); if (m < 60) return m + "m ago";
  const hr = Math.round(m / 60); if (hr < 36) return hr + "h ago";
  return Math.round(hr / 24) + "d ago";
};
window.loadPresenceUI = function () {
  const base = (S.sync && S.sync.url) || "", tok = (S.sync && S.sync.token) || "";
  fetch(base + "/api/presence", { headers: tok ? { Authorization: "Bearer " + tok } : {} })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(p => { (S.users || []).forEach(u => { const el = document.getElementById("pres_" + u.id); if (el) { const t = p[u.id]; el.textContent = "· " + agoTxt(t); el.style.color = (t && Date.now() - t < 90000) ? "var(--ok,#1a9a5a)" : "var(--muted)"; } }); })
    .catch(() => {});
};
window.loadAuditUI = function () {
  const el = document.getElementById("auditlog"); if (!el) return;
  const base = (S.sync && S.sync.url) || "", tok = (S.sync && S.sync.token) || "";
  fetch(base + "/api/audit", { headers: tok ? { Authorization: "Bearer " + tok } : {} })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(list => {
      if (!list || !list.length) { el.textContent = "No changes recorded yet."; return; }
      const nm = id => { const u = (S.users || []).find(x => x && x.id === id); return u ? (u.name || u.username) : "someone"; };
      // resolve a readable label live from the store (so even already-logged entries read well, not raw ids)
      const lbl = e => { try { const biz = (e.b === "obx" || e.b === "jam") ? S[e.b] : null; const rec = biz && Array.isArray(biz[e.c]) ? biz[e.c].find(r => r && r.id === e.id) : null; if (rec) { const cust = rec.cust || (rec.customerId && typeof custName === "function" ? custName(rec.customerId) : ""); return rec.name || rec.title || cust || rec.label || rec.desc || rec.what || rec.vendor || e.label || e.id; } } catch (x) {} return e.label || e.id; };
      el.innerHTML = list.slice(0, 100).map(e => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><b>${esc(nm(e.u))}</b> ${esc(e.act)} ${esc(String(e.c).replace(/s$/, ""))} <span class="sub">${esc(lbl(e))}</span> · <span class="sub">${agoTxt(e.t)}</span></div>`).join("");
    })
    .catch(() => { el.textContent = "Activity unavailable (offline?)."; });
};

/* ----- account actions ----- */
window.adminOpenCreate = function () {
  const roles = allRoles();
  modal("New account", `
    <p class="muted" style="margin-bottom:8px">Username + password + role. Add the person's email to enable one-tap Cloudflare Access sign-in.</p>
    <label>Username</label><input id="ac_name" autocomplete="off">
    <label>Full name (for crew initials, e.g. Ray Jamieson)</label><input id="ac_full" autocomplete="off" placeholder="First Last">
    <label>Email (for Access SSO)</label><input id="ac_email" autocomplete="off" placeholder="name@obxlotsolutions.com">
    <label>Password</label><input id="ac_pw" type="password" autocomplete="new-password">
    <label>Role</label><select id="ac_role">${roles.map(r => `<option value="${esc(r.key)}" ${r.key === "crew" ? "selected" : ""}>${esc(r.label)}</option>`).join("")}</select>
    <button class="btn acc" style="margin-top:14px" onclick="adminCreateAccount()">Create account</button>`);
};
window.adminCreateAccount = async function () {
  const un = val("ac_name"), pw = val("ac_pw"), role = val("ac_role") || "crew";
  if (!un || !pw) { alert("Username and password required."); return; }
  if (users().some(u => u.username.toLowerCase() === un.toLowerCase())) { alert("That username is taken."); return; }
  if (!S.users) S.users = [];
  S.users.push({ id: uid(), username: un, name: (val("ac_full") || "").trim(), email: (val("ac_email") || "").trim().toLowerCase(), passhash: await hashPw(pw), role: role, active: true, settings: { theme: (typeof themePref === "function" ? themePref() : "light") }, updatedAt: now() });
  if (typeof logChange === "function") logChange("create", "account", "", "Created account " + un + " (" + role + ")");
  save(); closeModal(); render();
};
window.adminSetName = function (id) {
  const u = (S.users || []).find(x => x.id === id); if (!u) return;
  const nm = prompt("Full name (used for crew initials, e.g. Ray Jamieson):", u.name || "");
  if (nm === null) return;
  u.name = nm.trim(); u.updatedAt = now();
  if (typeof logChange === "function") logChange("update", "account", id, "Set full name for " + u.username);
  save(); render();
};
window.adminSetEmail = function (id) {
  const u = (S.users || []).find(x => x.id === id); if (!u) return;
  const e = prompt("Email for Cloudflare Access SSO (must match their Access login email):", u.email || "");
  if (e === null) return;
  u.email = e.trim().toLowerCase(); touch(u);
  if (typeof logChange === "function") logChange("update", "account", u.id, "Set SSO email " + (u.email || "(cleared)"));
  save(); render();
};
window.adminSetRole = function (id, key) {
  const u = realAccounts().find(x => x.id === id); if (!u) return;
  if (u.role === "owner" && key !== "owner" && activeOwners().length <= 1) { alert("Can't change the last owner — promote another owner first."); render(); return; }
  u.role = key; touch(u);
  if (typeof logChange === "function") logChange("update", "account", id, "Set " + u.username + " role → " + (roleByKey(key) ? roleByKey(key).label : key));
  save(); render();
};
window.adminToggleActive = function (id) {
  const u = realAccounts().find(x => x.id === id); if (!u) return;
  const willActivate = u.active === false;
  if (!willActivate && u.role === "owner" && activeOwners().length <= 1) { alert("Can't deactivate the last active owner."); return; }
  u.active = willActivate ? true : false; touch(u);
  if (typeof logChange === "function") logChange("update", "account", id, (willActivate ? "Reactivated " : "Deactivated ") + u.username);
  save(); render();
};
window.adminResetPw = function (id) {
  const u = realAccounts().find(x => x.id === id); if (!u) return;
  modal("Reset password — " + esc(u.username), `
    <label>New password</label><input id="rp_pw" type="password" autocomplete="new-password">
    <p class="muted" style="margin-top:6px">Sets a new password for this account. Tell them their new password directly.</p>
    <button class="btn acc" style="margin-top:12px" onclick="adminDoResetPw('${id}')">Set password</button>`);
};
window.adminDoResetPw = async function (id) {
  const u = realAccounts().find(x => x.id === id); if (!u) return;
  const pw = val("rp_pw"); if (!pw) { alert("Enter a new password."); return; }
  u.passhash = await hashPw(pw); touch(u);
  if (typeof logChange === "function") logChange("update", "account", id, "Reset password for " + u.username);
  save(); closeModal(); render();
};
window.adminRemove = function (id) {
  const u = realAccounts().find(x => x.id === id); if (!u) return;
  if (u.role === "owner" && activeOwners().length <= 1) { alert("Can't remove the last owner."); return; }
  if (!confirm("Remove " + u.username + "? They won't be able to sign in.")) return;
  u.deleted = true; touch(u);
  if (localStorage.getItem("jra_session") === id) localStorage.removeItem("jra_session");
  if (typeof logChange === "function") logChange("delete", "account", id, "Removed account " + u.username);
  save(); render();
};

/* ----- role actions ----- */
window.adminTogglePage = function (key, tab) {
  const r = roleByKey(key); if (!r || r.key === "owner") return;
  if (!Array.isArray(r.pages)) r.pages = ALL_TABS.slice();   // materialize "all" before toggling one off
  const i = r.pages.indexOf(tab);
  if (i >= 0) r.pages.splice(i, 1); else r.pages.push(tab);
  touchRoles();
  if (typeof logChange === "function") logChange("update", "account", "", (i >= 0 ? "Hid " : "Showed ") + tab + " for role " + r.label);
  save(); render();
};
window.adminOpenAddRole = function () {
  modal("New role", `
    <label>Role name</label><input id="nr_label" placeholder="e.g. Lead, Office, Subcontractor" autocomplete="off">
    <p class="muted" style="margin-top:6px">Starts with the same pages as Crew — adjust its page access after creating.</p>
    <button class="btn acc" style="margin-top:12px" onclick="adminAddRole()">Create role</button>`);
};
window.adminAddRole = function () {
  const label = val("nr_label"); if (!label) { alert("Give the role a name."); return; }
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || ("role" + (now() % 100000));
  if (allRoles().some(r => r.key === key)) { alert("A role with that name already exists."); return; }
  allRoles().push({ key: key, label: label, pages: CREW_PAGES.slice() }); touchRoles();
  if (typeof logChange === "function") logChange("create", "account", "", "Added role " + label);
  save(); closeModal(); render();
};
window.adminDeleteRole = function (key) {
  if (key === "owner") { alert("The Owner role can't be deleted."); return; }
  const inUse = realAccounts().filter(u => u.role === key);
  if (inUse.length) { alert("Reassign " + inUse.length + " member(s) off this role first."); return; }
  if (!confirm("Delete this role?")) return;
  const rs = allRoles(), i = rs.findIndex(r => r.key === key); if (i < 0) return;
  const label = rs[i].label; rs.splice(i, 1); touchRoles();
  if (typeof logChange === "function") logChange("delete", "account", "", "Deleted role " + label);
  save(); render();
};
