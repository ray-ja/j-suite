/* ROLE ACCESS + NORMALIZATION smoke — runs inside the booted app (via verify-app.js) so the REAL client role
 * resolvers (canSee / roleAllows / roleActionAllows) + the loss-free role-registry normalization are exercised
 * end-to-end against a legacy store.
 *
 * Reproduces + fixes the Chase bug: a stored __roles__ crew role with actions:undefined + pages missing "data"
 * used to (a) fail-open into the Admin panel and (b) be locked out of Settings. Asserts the fix + that a genuinely
 * CUSTOM role's fail-open is preserved and no account/role is dropped.
 *
 * Run:  node verify-app.js "$(cat role-access-tests.js)"    (a failed assert pushes to __errs → FAILs the harness)
 */
(function () {
  function T(name, cond) { if (cond) { diag("✓ " + name); } else { __errs.push("ROLE-TEST FAIL: " + name); } }

  // ---- install a LEGACY store: crew role has NO actions array + pages without "data"; a CUSTOM 'lead' role also
  //      has no actions (must keep its backward-compat fail-open). Four accounts + memberships in obx. ----
  var legacyCrewPages = ["schedule", "time", "today", "messages", "jobs", "inventory", "routes"];   // note: no "data"
  S.users = [
    { id: "own", username: "own", role: "owner", updatedAt: 1 },
    { id: "cru", username: "cru", role: "crew", updatedAt: 1 },
    { id: "adm", username: "adm", role: "admin", updatedAt: 1 },
    { id: "mgr", username: "mgr", role: "manager", updatedAt: 1 },
    { id: "__roles__", kind: "roles", updatedAt: 1, roles: [
      { key: "owner", label: "Owner", builtin: true },
      { key: "admin", label: "Admin", pages: ALL_TABS.slice(), actions: ALL_ACTION_KEYS.slice() },
      { key: "crew", label: "Crew", pages: legacyCrewPages.slice() },                 // actions:undefined (legacy) + no "data"
      { key: "manager", label: "Manager", pages: ALL_TABS.slice(), actions: ["assign-guides", "edit-schedule", "edit-settings", "manage-members", "edit-tools"] },
      { key: "lead", label: "Lead", pages: ["today", "jobs"] }                        // CUSTOM role, actions:undefined → fail-open must survive
    ] },
    { id: "mem_obx_own", kind: "membership", orgId: "obx", accountId: "own", role: "owner", active: true, updatedAt: 1 },
    { id: "mem_obx_cru", kind: "membership", orgId: "obx", accountId: "cru", role: "crew", active: true, updatedAt: 1 },
    { id: "mem_obx_adm", kind: "membership", orgId: "obx", accountId: "adm", role: "admin", active: true, updatedAt: 1 },
    { id: "mem_obx_mgr", kind: "membership", orgId: "obx", accountId: "mgr", role: "manager", active: true, updatedAt: 1 }
  ];
  S.biz = "obx";
  try { localStorage.setItem("jra_offline_ok", "1"); } catch (e) {}
  function asUser(id) { try { localStorage.setItem("jra_session", id); } catch (e) {} }

  // ---- MIGRATION / NORMALIZATION (ensureRolesRec runs normalizeBuiltinRoles on any role access) ----
  var rec = rolesRec();                                   // triggers normalization
  var crew = rec.roles.find(function (r) { return r.key === "crew"; });
  var lead = rec.roles.find(function (r) { return r.key === "lead"; });
  T("crew.actions normalized to [] (legacy no-actions built-in filled with its default)", Array.isArray(crew.actions) && crew.actions.length === 0);
  T("crew.pages gains 'data' (crew can reach Settings)", crew.pages.indexOf("data") >= 0);
  T("crew.pages keeps ALL its original pages (loss-free)", legacyCrewPages.every(function (p) { return crew.pages.indexOf(p) >= 0; }));
  T("custom 'lead' role UNTOUCHED — actions stay undefined (fail-open preserved)", !Array.isArray(lead.actions));
  T("custom 'lead' role pages UNTOUCHED", JSON.stringify(lead.pages) === JSON.stringify(["today", "jobs"]));
  T("all four accounts survive normalization (zero loss)", ["own", "cru", "adm", "mgr"].every(function (id) { return realAccounts().some(function (u) { return u.id === id; }); }));

  // ---- RESOLVER hardening: built-in restricted role can't fail-open to a privileged action; custom role still does ----
  T("roleActionAllows('crew','manage-members') === false (leak closed)", roleActionAllows("crew", "manage-members") === false);
  T("roleActionAllows('game-guide','manage-members') === false", roleActionAllows("game-guide", "manage-members") === false);
  T("roleActionAllows('lead','manage-members') === true (custom fail-open preserved)", roleActionAllows("lead", "manage-members") === true);
  T("roleActionAllows('manager','manage-members') === true (manager keeps grant)", roleActionAllows("manager", "manage-members") === true);
  T("roleAllows('crew','admin') === false", roleAllows("crew", "admin") === false);
  T("roleAllows('owner','admin') === true", roleAllows("owner", "admin") === true);
  T("roleAllows('admin','admin') === true", roleAllows("admin", "admin") === true);
  T("roleAllows('manager','admin') === true", roleAllows("manager", "admin") === true);

  // ---- SESSION-LEVEL canSee (the real field question: what does Chase's device show?) ----
  asUser("cru");
  T("CREW session: canSee('admin') === false (Admin unreachable)", canSee("admin") === false);
  T("CREW session: canSee('data') === true (Settings reachable)", canSee("data") === true);
  T("CREW session: roleActionAllows(curRoleKey(),'manage-members') === false", roleActionAllows(curRoleKey(), "manage-members") === false);
  asUser("own"); T("OWNER session: canSee('admin') === true", canSee("admin") === true);
  asUser("adm"); T("ADMIN session: canSee('admin') === true", canSee("admin") === true);
  asUser("mgr"); T("MANAGER session: canSee('admin') === true", canSee("admin") === true);

  // ---- DOM: crew nav has NO Admin group, HAS Settings; crew Settings hides rate editor + sync config ----
  asUser("cru");
  TAB = "today";
  if (typeof renderNav === "function") renderNav();
  var nav = document.querySelector("nav");
  var navHtml = (nav && nav.innerHTML) || "";
  T("CREW nav: NO Admin group rendered", navHtml.indexOf('data-group="admin"') < 0);
  T("CREW nav: Settings group (more) IS rendered", navHtml.indexOf('data-group="more"') >= 0);

  TAB = "data";
  rData();
  var dataHtml = (view && view.innerHTML) || "";
  T("CREW Settings: rate editor HIDDEN", dataHtml.indexOf("Edit deep quote rates") < 0);
  T("CREW Settings: legacy rates editor HIDDEN", dataHtml.indexOf("Edit legacy rates") < 0);
  T("CREW Settings: job costs editor HIDDEN", dataHtml.indexOf("Edit job costs") < 0);
  T("CREW Settings: sync server URL/token config HIDDEN", dataHtml.indexOf("Sync server URL") < 0 && dataHtml.indexOf("Access token") < 0);
  T("CREW Settings: home base config HIDDEN", dataHtml.indexOf("Home base") < 0);
  T("CREW Settings: backups/restore HIDDEN", dataHtml.indexOf("Restore from a backup") < 0);
  T("CREW Settings: still shows the crew-appropriate Sync status + Update", dataHtml.indexOf("Get the latest version") >= 0 && dataHtml.indexOf("Last synced") >= 0);

  // owner Settings SHOULD show the config (sanity — the gate isn't hiding it from everyone)
  asUser("own");
  rData();
  var ownerHtml = (view && view.innerHTML) || "";
  T("OWNER Settings: rate editor + sync config SHOWN", ownerHtml.indexOf("Edit deep quote rates") >= 0 && ownerHtml.indexOf("Sync server URL") >= 0);

  // defense-in-depth: a crew-session direct call to a sensitive opener must no-op (guard fires)
  asUser("cru");
  window.__ratesOpened = false;
  var _modal = window.modal; window.modal = function () { window.__ratesOpened = true; };
  window.alert = function () {};
  try { openDeepEditor(); } catch (e) {}
  window.modal = _modal;
  T("CREW openDeepEditor() no-ops (handler re-checks)", window.__ratesOpened === false);

  diag("role-access-tests complete");
})();
