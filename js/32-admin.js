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
  { tab: "quotes", label: "All jobs" }, { tab: "booking", label: "Booking" }, { tab: "schedule", label: "Schedule" },
  { tab: "messages", label: "Messages" },
  { tab: "map", label: "Map" }, { tab: "sales", label: "Sales" },
  { tab: "todo", label: "To-Do" }, { tab: "plan", label: "Plan" },
  { tab: "training", label: "Train" }, { tab: "market", label: "Market" },
  { tab: "opps", label: "Opps" }, { tab: "sites", label: "Sites" },
  { tab: "buildplan", label: "Build Plan" }, { tab: "inventory", label: "Inventory" },
  { tab: "resale", label: "Resale" }, { tab: "escape", label: "Room board" }, { tab: "life", label: "Life" },
  { tab: "playbook", label: "Playbook" },
  { tab: "time", label: "Time" }, { tab: "finance", label: "Finance" }, { tab: "receipts", label: "Receipts" }, { tab: "data", label: "Data" }
];
const ALL_TABS = ADMIN_PAGES.map(p => p.tab);
const CREW_PAGES = ["today", "accounts", "quotes", "booking", "schedule", "messages", "map", "sales", "todo", "inventory", "resale", "time"];
let ADMIN_SEARCH = "", ADMIN_SORT = "name", ADMIN_EXPANDED = null;   // Team-accounts search / sort / which row is expanded (survives re-render)
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
  let real;
  if (u && u.superAdmin) real = "owner";   // MULTI-ORG: platform owner → owner in every org
  else if (u) real = ((typeof roleInOrg === "function" && S.biz) ? roleInOrg(u.id, S.biz) : null) || u.role || "crew";   // role in the ACTIVE org; fall back to the global role (transition / no membership)
  else real = hasAnyAccount() ? NO_SESSION_ROLE : "owner";   // signed out → crew unless bootstrapping the first owner
  // Owner "view-as" preview (js/48): downgrade only, and only for a real owner — never escalates.
  if (window.VIEW_AS && real === "owner" && window.VIEW_AS !== "owner") return window.VIEW_AS;
  return real;
}
function isSuperAdmin() { const u = (typeof curUser === "function") ? curUser() : null; return !!(u && u.superAdmin); }   // platform owner
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
function canSee(tab) { return roleAllows(curRoleKey(), tab) && (typeof orgHasTab !== "function" || orgHasTab(tab)); }   // role gate AND per-org tool visibility
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
/* MULTI-ORG (Phase 3a) — membership model. A membership ties an account to an org with a per-org role.
   Records live in S.users with kind:"membership" (so realAccounts() already excludes them). */
function membershipsOf(accountId) { return (S.users || []).filter(m => m && m.kind === "membership" && m.accountId === accountId && m.active !== false); }
function roleInOrg(accountId, orgId) { const m = (S.users || []).find(x => x && x.kind === "membership" && x.accountId === accountId && x.orgId === orgId && x.active !== false); return m ? m.role : null; }
function membershipFor(accountId, orgId) { return (S.users || []).find(m => m && m.kind === "membership" && m.accountId === accountId && m.orgId === orgId); }
function orgMembers(orgId) { return realAccounts().filter(u => !!roleInOrg(u.id, orgId)); }   // accounts with an ACTIVE membership in this org
function orgOwners(orgId) { return orgMembers(orgId).filter(u => roleInOrg(u.id, orgId) === "owner" && u.active !== false); }
function orgSetRole(accountId, orgId, role) {   // add/update a member's per-org role (creates the membership if missing)
  let m = membershipFor(accountId, orgId);
  if (!m) { m = { id: "mem_" + orgId + "_" + accountId, kind: "membership", orgId: orgId, accountId: accountId }; (S.users = S.users || []).push(m); }
  m.role = role || "crew"; m.active = true; m.deleted = false; m.updatedAt = now();
}
function orgRemoveMember(accountId, orgId) { const m = membershipFor(accountId, orgId); if (m) { m.active = false; m.deleted = true; m.updatedAt = now(); } }
/* ----- per-org tool visibility (Phase 5) — make each org feel like its own app ----- */
function orgConfigurableTabs() { return ALL_TABS.filter(t => ORG_CORE_TABS.indexOf(t) < 0); }
function orgToolsCard() {
  const meta = (typeof TAB_META !== "undefined") ? TAB_META : {};
  let h = `<div class="card" style="margin-top:8px;border-left:3px solid var(--acc)" id="orgtools-card">
    <div class="nm" style="font-size:15px">🧩 Tools for ${esc(typeof orgName === "function" ? orgName(S.biz) : S.biz)}</div>
    <div class="sub" style="margin-bottom:8px">Pick which tools this organization shows — hidden ones are completely unavailable here, so each org feels like its own app. (Home, Admin &amp; Settings always stay.)</div>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn ghost sm" onclick="orgApplyTemplate('full')">Field services (all)</button>
      <button class="btn ghost sm" onclick="orgApplyTemplate('bookings')">Bookings / shop</button>
      <button class="btn ghost sm" onclick="orgApplyTemplate('personal')">Personal</button></div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">`;
  orgConfigurableTabs().forEach(t => {
    const on = (typeof orgHasTab === "function") ? orgHasTab(t) : true, m = meta[t] || {};
    h += `<label style="cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:14px;font-size:13px;background:${on ? "var(--acc)" : "var(--line)"};color:${on ? "#fff" : "inherit"}"><input type="checkbox" style="width:auto;margin:0" ${on ? "checked" : ""} onchange="orgToolToggle('${t}')">${(m.i || "")} ${esc(m.l || t)}</label>`;
  });
  return h + `</div></div>`;
}
function orgSetTabs(tabs) {
  const r = (S.registry || []).find(x => x && x.id === S.biz); if (!r) return;
  r.tabs = tabs; r.updatedAt = now();
  if (typeof logChange === "function") logChange("update", "account", S.biz, "Changed tools for " + (typeof orgName === "function" ? orgName(S.biz) : S.biz));
  save(); if (typeof scheduleAutoPush === "function") scheduleAutoPush(); render();
}
window.orgApplyTemplate = function (name) {
  if (typeof isOwner === "function" && !isOwner()) { alert("Owner only."); return; }
  orgSetTabs(ORG_TEMPLATES[name] ? ORG_TEMPLATES[name].slice() : null);
};
window.orgToolToggle = function (tab) {
  if (typeof isOwner === "function" && !isOwner()) { alert("Owner only."); return; }
  let cur = orgTabs(); if (!cur) cur = orgConfigurableTabs().slice();   // materialize "all" before turning one off
  const i = cur.indexOf(tab); if (i >= 0) cur.splice(i, 1); else cur.push(tab);
  orgSetTabs(cur);
};
function myOrgIds() {
  const me = (typeof curUser === "function") ? curUser() : null; if (!me) return [];
  if (me.superAdmin) return (S.registry || []).filter(r => r && !r.deleted).map(r => r.id);   // super-admin sees every org
  return membershipsOf(me.id).map(m => m.orgId);
}
// ONE-TIME: migrate the pre-multi-org crew (everyone belonged to obx + jam) into memberships; owner → super-admin.
function membershipMigrate() {
  if (S.membersV1) return;
  const accs = realAccounts(); if (!accs.length) return;   // wait for accounts (bootstrap) — retries next load
  let changed = false;
  ["obx", "jam"].forEach(oid => { if (!S[oid]) return; accs.forEach(u => {
    const mid = "mem_" + oid + "_" + u.id;
    if (!(S.users || []).find(x => x && x.id === mid)) { S.users.push({ id: mid, kind: "membership", orgId: oid, accountId: u.id, role: u.role || "crew", active: true, updatedAt: now() }); changed = true; }
  }); });
  accs.forEach(u => { if (u.role === "owner" && !u.superAdmin) { u.superAdmin = true; touch(u); changed = true; } });   // existing owner → platform super-admin
  S.membersV1 = true; if (changed) save();
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
  const accs = orgMembers(S.biz), roles = allRoles();   // MULTI-ORG: the ACTIVE org's members only
  const me = (typeof curUser === "function") ? curUser() : null;
  // PIN gate — lock the Admin page behind the owner's PIN (unlocked for the browser session once entered)
  let _adminOk = false; try { _adminOk = !!(me && sessionStorage.getItem("jra_admin_ok") === me.id); } catch (e) {}
  if (me && me.adminPin && !_adminOk) {
    view.innerHTML = `<div class="card" style="max-width:340px;margin:36px auto;text-align:center">
      <div class="nm" style="font-size:18px">🛡️ Admin locked</div>
      <p class="muted" style="margin:8px 0 14px">Enter your admin PIN to continue.</p>
      <input id="adminpin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="••••" style="width:100%;text-align:center;font-size:22px;letter-spacing:8px" onkeydown="if(event.key==='Enter')adminPinSubmit()">
      <div id="adminpinmsg" class="sub" style="color:var(--danger);min-height:18px;margin-top:6px"></div>
      <button class="btn acc" style="width:100%;margin-top:8px" onclick="adminPinSubmit()">Unlock</button></div>`;
    setTimeout(() => { const _e = document.getElementById("adminpin"); if (_e) _e.focus(); }, 30);
    return;
  }
  const roleOpts = sel => roles.map(r => `<option value="${esc(r.key)}" ${sel === r.key ? "selected" : ""}>${esc(r.label)}</option>`).join("");

  let h = `<div class="secthd"><h2>Admin</h2><button class="btn ghost sm" onclick="adminOpenCreate()">+ Account</button></div>
    <div class="card" style="margin-bottom:6px;border-left:3px solid var(--acc)"><div class="nm" style="font-size:14px">🏢 Managing: ${esc(typeof orgName === "function" ? orgName(S.biz) : S.biz)}</div><div class="sub">${(typeof isSuperAdmin === "function" && isSuperAdmin()) ? "Super-admin — switch organization (👤 menu) to manage another. " : ""}People here belong to this organization only.</div></div>
    <p class="muted" style="margin:0 4px 6px">Manage who can sign in, what role they hold, and which tabs each role sees. Roles &amp; access sync to every device.</p>`;
  h += `<div class="card" style="margin-bottom:6px"><div class="row"><div class="grow"><div class="nm" style="font-size:15px">🔒 Admin PIN</div><div class="sub">${me && me.adminPin ? "On — Admin asks for a PIN each session" : "Off — anyone on your unlocked phone can open Admin"}</div></div>
    <div class="row" style="gap:6px"><button class="btn ghost sm" onclick="adminSetPin()">${me && me.adminPin ? "Change" : "Set PIN"}</button>${me && me.adminPin ? `<button class="btn ghost sm" onclick="adminRemovePin()">Remove</button>` : ""}</div></div></div>`;

  if (typeof orgToolsCard === "function") h += orgToolsCard();   // per-org tool visibility (org-owner)
  if (typeof orgAiCard === "function") h += orgAiCard();   // per-org AI assistant setup (org-owner)
  /* ---- accounts (searchable + sortable + collapsed rows for scale) ---- */
  h += `<div class="secthd" style="margin-top:6px"><h2 style="margin:0">Members</h2><button class="btn acc sm" onclick="adminOpenCreate()">+ Add member</button></div>`;
  if (!accs.length) h += `<div class="card"><div class="muted">No members yet. Tap “+ Add member”.</div></div>`;
  else {
    h += `<div class="row" style="gap:8px;margin:0 2px 8px">
      <input id="acctsearch" value="${esc(ADMIN_SEARCH)}" placeholder="🔍 Search name, username or email" oninput="adminFilterAccounts()" style="flex:1">
      <select id="acctsort" onchange="adminFilterAccounts()" style="width:auto">
        <option value="name"${ADMIN_SORT === "name" ? " selected" : ""}>Name A–Z</option>
        <option value="role"${ADMIN_SORT === "role" ? " selected" : ""}>By role</option>
        <option value="active"${ADMIN_SORT === "active" ? " selected" : ""}>Active first</option>
      </select></div>
    <div id="acctlist">${adminAccountsHTML()}</div>`;
  }

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
      const dt = ms => { try { const d = new Date(ms); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); } catch (x) { return ""; } };
      const recOf = e => { try { const biz = (e.b === "obx" || e.b === "jam") ? S[e.b] : null; return biz && Array.isArray(biz[e.c]) ? biz[e.c].find(r => r && r.id === e.id) : null; } catch (x) { return null; } };
      const custOf = rec => rec.cust || (rec.customerId && typeof custName === "function" ? custName(rec.customerId) : "") || "";
      // build a readable descriptor live from the store: quotes get #num + customer + type; everything else its name/title
      const desc = e => {
        const coll = String(e.c).replace(/s$/, ""), rec = recOf(e);
        if (e.c === "quotes" && rec) {
          const num = (typeof quoteNum === "function" ? quoteNum(rec) : "") || ("#" + String(e.id).slice(-5));
          const type = (rec.items && rec.items[0] && rec.items[0].name) || "";
          return `quote <b>${esc(num)}</b> for ${esc(custOf(rec) || "a customer")}${type ? " · " + esc(type) : ""}`;
        }
        if (rec) return `${coll} ${esc(rec.name || rec.title || custOf(rec) || rec.label || rec.desc || rec.what || rec.vendor || e.label || e.id)}`;
        return `${coll} ${esc(e.label || e.id)}`;
      };
      el.innerHTML = list.slice(0, 100).map(e => `<div style="padding:7px 0;border-bottom:1px solid var(--line)"><b>${esc(nm(e.u))}</b> ${esc(e.act)} ${desc(e)} <span class="sub">· ${dt(e.t)}</span></div>`).join("");
    })
    .catch(() => { el.textContent = "Activity unavailable (offline?)."; });
};
window.adminLogoutEverywhere = function (id) {
  const u = (S.users || []).find(x => x && x.id === id); if (!u) return;
  if (!confirm("Sign " + (u.name || u.username) + " out on all their devices? They'll have to log in again.")) return;
  u.logoutAt = now(); if (typeof touch === "function") touch(u); save();
  if (typeof syncRun === "function") syncRun("push");
  if (typeof render === "function") render();
  alert((u.name || u.username) + " will be signed out on every device on their next sync.");
};
window.adminPinSubmit = async function () {
  const me = (typeof curUser === "function") ? curUser() : null; if (!me) return;
  const el = document.getElementById("adminpin"), msg = document.getElementById("adminpinmsg");
  const pin = ((el && el.value) || "").trim();
  if (!pin) { if (msg) msg.textContent = "Enter your PIN."; return; }
  try { const hh = await hashPw(pin); if (hh === me.adminPin) { try { sessionStorage.setItem("jra_admin_ok", me.id); } catch (e) {} render(); return; } } catch (e) {}
  if (msg) msg.textContent = "Wrong PIN."; if (el) { el.value = ""; el.focus(); }
};
window.adminSetPin = async function () {
  const pin = prompt("Set a 4–8 digit Admin PIN:"); if (pin == null) return;
  const p = String(pin).trim();
  if (!/^\d{4,8}$/.test(p)) { alert("PIN must be 4–8 digits."); return; }
  const again = prompt("Re-enter the PIN to confirm:"); if (again == null) return;
  if (String(again).trim() !== p) { alert("PINs didn't match — try again."); return; }
  let hash; try { hash = await hashPw(p); } catch (e) { alert("Couldn't set the PIN."); return; }
  const me = (typeof curUser === "function") ? curUser() : null; if (!me) return;   // RE-FETCH after the await: a sync that landed while the prompt was open may have replaced S.users (the bug that silently dropped the PIN)
  me.adminPin = hash; if (typeof touch === "function") touch(me); save();
  try { sessionStorage.setItem("jra_admin_ok", me.id); } catch (e) {}
  if (typeof syncRun === "function") syncRun("auto");
  render(); alert("Admin PIN set — you'll be asked for it each session.");
};
window.adminRemovePin = function () {
  const me = (typeof curUser === "function") ? curUser() : null; if (!me) return;
  if (!confirm("Remove the Admin PIN? Anyone with your unlocked phone could then open Admin.")) return;
  me.adminPin = ""; if (typeof touch === "function") touch(me); save();
  if (typeof syncRun === "function") syncRun("push"); render(); alert("Admin PIN removed.");
};
function adminRoleOpts(sel) { return allRoles().map(r => `<option value="${esc(r.key)}" ${sel === r.key ? "selected" : ""}>${esc(r.label)}</option>`).join(""); }
function adminSortFn(mode) {
  const nm = u => String(u.name || u.username || "").toLowerCase();
  if (mode === "role") return (a, b) => String(a.role || "").localeCompare(String(b.role || "")) || nm(a).localeCompare(nm(b));
  if (mode === "active") return (a, b) => ((b.active !== false) - (a.active !== false)) || nm(a).localeCompare(nm(b));
  return (a, b) => nm(a).localeCompare(nm(b));
}
function adminAccountsHTML() {
  const me = (typeof curUser === "function") ? curUser() : null;
  const all = orgMembers(S.biz);   // MULTI-ORG: members of the active org only
  const q = String(ADMIN_SEARCH || "").toLowerCase().trim();
  let list = q ? all.filter(u => (String(u.username || "") + " " + String(u.name || "") + " " + String(u.email || "")).toLowerCase().indexOf(q) >= 0) : all.slice();
  list.sort(adminSortFn(ADMIN_SORT));
  let h = `<div class="sub" style="margin:0 2px 8px">${q ? ("Showing " + list.length + " of " + all.length) : (all.length + " account" + (all.length === 1 ? "" : "s"))}</div>`;
  if (!list.length) return h + `<div class="muted" style="margin:4px">No matching accounts.</div>`;
  list.forEach(u => {
    const active = u.active !== false, mine = me && me.id === u.id, open = u.id === ADMIN_EXPANDED;
    h += `<div class="card" style="padding:10px 12px;margin-bottom:6px">
      <div class="row" onclick="adminToggleAcct('${u.id}')" style="cursor:pointer;align-items:center">
        <div class="grow"><div class="nm" style="font-size:15px">${esc(u.name || u.username)} ${roleBadge(roleInOrg(u.id, S.biz) || u.role || "crew")}${active ? "" : ` <span class="badge" style="background:var(--danger);color:#fff">off</span>`}${mine ? ` <span class="sub" style="display:inline">· you</span>` : ""}</div>
        <div class="sub">@${esc(u.username)} <span id="pres_${u.id}" style="color:var(--muted)"></span></div></div>
        <span class="sub" style="font-size:16px">${open ? "▾" : "▸"}</span></div>`;
    if (open) h += `<div style="border-top:1px solid var(--line);margin-top:10px;padding-top:10px">
        <div class="row" style="align-items:center;gap:8px;margin-bottom:10px"><div class="sub grow">Role in this org</div><select onchange="adminSetRole('${u.id}',this.value)" style="width:auto;min-width:120px">${adminRoleOpts(roleInOrg(u.id, S.biz) || u.role || "crew")}</select></div>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <button class="btn ghost sm" onclick="adminSetName('${u.id}')">🧑 ${u.name ? esc(u.name) : "Set name"}</button>
          <button class="btn ghost sm" onclick="adminSetEmail('${u.id}')">✉ ${u.email ? esc(u.email) : "Set email"}</button>
          <button class="btn ghost sm" onclick="adminResetPw('${u.id}')">Reset PW</button>
          <button class="btn ghost sm" onclick="adminLogoutEverywhere('${u.id}')">🚪 Log out</button>
          <button class="btn ghost sm" onclick="adminToggleActive('${u.id}')">${active ? "Deactivate" : "Reactivate"}</button>
          <button class="btn danger sm" onclick="adminRemove('${u.id}')">Remove</button>
        </div></div>`;
    h += `</div>`;   // close the account card — was missing, so cards nested inside each other
  });
  return h;
}
window.adminFilterAccounts = function () {
  const s = document.getElementById("acctsearch"), so = document.getElementById("acctsort");
  if (s) ADMIN_SEARCH = s.value; if (so) ADMIN_SORT = so.value;
  const c = document.getElementById("acctlist"); if (c) c.innerHTML = adminAccountsHTML();
  if (window.loadPresenceUI) setTimeout(loadPresenceUI, 10);
};
window.adminToggleAcct = function (id) {
  ADMIN_EXPANDED = (ADMIN_EXPANDED === id) ? null : id;
  const c = document.getElementById("acctlist"); if (c) c.innerHTML = adminAccountsHTML();
  if (window.loadPresenceUI) setTimeout(loadPresenceUI, 10);
};

/* ----- account actions ----- */
window.adminOpenCreate = function () {
  if (typeof isSuperAdmin === "function" && !isSuperAdmin()) { alert("New accounts are created by the platform owner. You can set roles and remove members here — ask the platform owner to add a new person, then assign them."); return; }
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
  const _nid = uid();
  S.users.push({ id: _nid, username: un, name: (val("ac_full") || "").trim(), email: (val("ac_email") || "").trim().toLowerCase(), passhash: await hashPw(pw), role: role, active: true, settings: { theme: (typeof themePref === "function" ? themePref() : "light") }, updatedAt: now() });
  if (S.biz) orgSetRole(_nid, S.biz, role);   // MULTI-ORG: member of the ACTIVE org (so they're scoped here, not auto-migrated to obx/jam)
  if (typeof logChange === "function") logChange("create", "account", _nid, "Added " + un + " to " + (typeof orgName === "function" ? orgName(S.biz) : S.biz) + " (" + role + ")");
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
  if (roleInOrg(id, S.biz) === "owner" && key !== "owner" && orgOwners(S.biz).length <= 1) { alert("Can't change the last owner of this organization — promote another owner first."); render(); return; }
  orgSetRole(id, S.biz, key);   // per-org role
  if (typeof logChange === "function") logChange("update", "account", id, "Set " + u.username + " role in " + (typeof orgName === "function" ? orgName(S.biz) : S.biz) + " → " + (roleByKey(key) ? roleByKey(key).label : key));
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
  if (roleInOrg(id, S.biz) === "owner" && orgOwners(S.biz).length <= 1) { alert("Can't remove the last owner of this organization."); return; }
  if (!confirm("Remove " + u.username + " from " + (typeof orgName === "function" ? orgName(S.biz) : S.biz) + "? They keep their account but lose access to this organization.")) return;
  orgRemoveMember(id, S.biz);   // remove the membership (not the global account)
  if (typeof logChange === "function") logChange("delete", "account", id, "Removed " + u.username + " from " + (typeof orgName === "function" ? orgName(S.biz) : S.biz));
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
