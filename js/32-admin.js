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
  { tab: "today", label: "CEO desk" }, { tab: "accounts", label: "Accounts" },
  { tab: "quotes", label: "Quotes" }, { tab: "schedule", label: "Schedule" },
  { tab: "map", label: "Map" }, { tab: "sales", label: "Sales" },
  { tab: "todo", label: "To-Do" }, { tab: "plan", label: "Plan" },
  { tab: "training", label: "Train" }, { tab: "market", label: "Market" },
  { tab: "opps", label: "Opps" }, { tab: "sites", label: "Sites" },
  { tab: "buildplan", label: "Build Plan" }, { tab: "inventory", label: "Inventory" },
  { tab: "time", label: "Time" }, { tab: "data", label: "Data" }
];
const ALL_TABS = ADMIN_PAGES.map(p => p.tab);
const CREW_PAGES = ["today", "accounts", "quotes", "schedule", "map", "sales", "todo", "inventory", "time"];
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
  if (u && u.role) return u.role;
  return hasAnyAccount() ? NO_SESSION_ROLE : "owner";
}
function isOwner() { return curRoleKey() === "owner"; }
function roleAllows(key, tab) {
  if (key === "owner") return true;            // owner sees everything, incl. the admin panel
  if (tab === "admin") return false;           // admin panel is owner-only, always
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
  const navs = document.querySelectorAll("nav button");
  navs.forEach(b => { b.style.display = canSee(b.dataset.tab) ? "" : "none"; });
  if (!canSee(TAB)) {
    let dest = canSee("today") ? "today" : null;
    if (!dest) { const f = [...navs].find(b => b.dataset.tab !== "admin" && canSee(b.dataset.tab)); dest = f ? f.dataset.tab : "today"; }
    TAB = dest;
  }
  // never leave the user on a hidden destination (e.g. a misconfigured role with no pages)
  navs.forEach(b => { if (b.dataset.tab === TAB) b.style.display = ""; });
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
        <div class="sub">${roleBadge(u.role || "crew")} ${active ? `<span class="badge" style="background:var(--soft);color:var(--muted)">Active</span>` : `<span class="badge" style="background:var(--danger);color:#fff">Deactivated</span>`}</div></div>
        <select onchange="adminSetRole('${u.id}',this.value)" style="width:auto;min-width:110px">${roleOpts(u.role || "crew")}</select></div>
      <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
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
  view.innerHTML = h;
}

/* ----- account actions ----- */
window.adminOpenCreate = function () {
  const roles = allRoles();
  modal("New account", `
    <p class="muted" style="margin-bottom:8px">Username + password (no email). Pick the role this person signs in as.</p>
    <label>Username</label><input id="ac_name" autocomplete="off">
    <label>Password</label><input id="ac_pw" type="password" autocomplete="new-password">
    <label>Role</label><select id="ac_role">${roles.map(r => `<option value="${esc(r.key)}" ${r.key === "crew" ? "selected" : ""}>${esc(r.label)}</option>`).join("")}</select>
    <button class="btn acc" style="margin-top:14px" onclick="adminCreateAccount()">Create account</button>`);
};
window.adminCreateAccount = async function () {
  const un = val("ac_name"), pw = val("ac_pw"), role = val("ac_role") || "crew";
  if (!un || !pw) { alert("Username and password required."); return; }
  if (users().some(u => u.username.toLowerCase() === un.toLowerCase())) { alert("That username is taken."); return; }
  if (!S.users) S.users = [];
  S.users.push({ id: uid(), username: un, passhash: await hashPw(pw), role: role, active: true, settings: { theme: (typeof themePref === "function" ? themePref() : "light") }, updatedAt: now() });
  if (typeof logChange === "function") logChange("create", "account", "", "Created account " + un + " (" + role + ")");
  save(); closeModal(); render();
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
