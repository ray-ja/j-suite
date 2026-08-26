/* ---------- ADMIN, CONSOLIDATED (js/157) -----------------------------------------------------------
   Ray, 2026-08-26, still working through it: "Move admin PIN to roles and permissions. Also, consolidate
   members and roles and permissions… I would just make each of the roles a drop down. It doesn't have to
   show the big list of all the pages. Also the list is really hard — it's not sortable or anything. We
   should make it a sortable table. It's just a big blob of text… You can also consolidate menu order since
   it has all of the tabs. You should just have a checkbox that lets you turn on and off each one, as well
   as change the order."

   Three consolidations, and each one removes a screen rather than adding a nicer one:

   ⭐ 1. MEMBERS = the people table + the roles that govern them + the PIN that guards the page. They were
   three sections describing one subject: who gets in and what they can touch. The roles are collapsed —
   every role was printing a checkbox for every page and every action, which is dozens of boxes for a
   two-person company, permanently expanded, above the list he actually came to read.

   ⭐ 2. A REAL TABLE. The member list was a stack of cards you could sort only from a dropdown above it.
   Now it is a table with sortable column headers, which is what "sortable" means to anyone who has used a
   computer. ⚠️ It scrolls inside its own container — CLAUDE.md is explicit that wide content must never
   make the page scroll sideways, and he works from a 390px phone.

   ⭐ 3. MENU + TOOLS ARE ONE LIST. "Which tools exist" and "what order they appear in" were two screens
   editing the same menu. One row per group: a checkbox to turn it on, arrows to move it.
   ⚠️ They work at different GRANULARITIES — tools toggle individual TABS, order moves GROUPS — so a group
   holding several tabs expands to per-tab checkboxes rather than pretending it is one switch. And toggling
   a whole group writes ONCE, instead of calling save() and render() per tab underneath it. */

function apActive(a) { return (a || []).filter(function (x) { return x && !x.deleted; }); }

/* ---------- 1 + 2: the members table ---------- */
var AP_SORT = "name", AP_DIR = 1;

/* something legible for every member, however sparse the record */
function apName(u) {
  return String((u && (u.name || u.username)) || "").trim() || "(unnamed)";
}
function apRoleOf(u) {
  return (typeof roleInOrg === "function" ? roleInOrg(u.id, S.biz) : "") || u.role || "crew";
}
function apMembers() {
  var all = (typeof orgMembers === "function") ? orgMembers(S.biz) : [];
  var q = String(typeof ADMIN_SEARCH !== "undefined" ? ADMIN_SEARCH : "").toLowerCase().trim();
  var list = q ? all.filter(function (u) {
    return (String(u.username || "") + " " + String(u.name || "") + " " + String(u.email || "")).toLowerCase().indexOf(q) >= 0;
  }) : all.slice();
  var val = function (u) {
    if (AP_SORT === "user") return String(u.username || "\uffff").toLowerCase();   // no-login sorts last, not first
    if (AP_SORT === "role") return apRoleOf(u).toLowerCase();
    if (AP_SORT === "status") return (u.active === false) ? "1off" : "0on";
    return apName(u).toLowerCase();
  };
  list.sort(function (a, b) { var x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * AP_DIR; });
  return { list: list, total: all.length, filtered: !!q };
}

function apHead(key, label) {
  var on = AP_SORT === key;
  return '<th style="cursor:pointer;user-select:none" onclick="apSort(\'' + key + '\')">'
    + esc(label) + (on ? (AP_DIR > 0 ? " ▲" : " ▼") : "") + '</th>';
}

function adminMembersTable() {
  var me = (typeof curUser === "function") ? curUser() : null;
  var g = apMembers();
  if (!g.list.length) return '<div class="muted" style="margin:4px">No matching members.</div>';

  var h = '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">'
    + '<table class="otable" style="font-size:13px"><thead><tr>'
    + apHead("name", "Name") + apHead("user", "Username") + apHead("role", "Role")
    + apHead("status", "Status") + '<th></th></tr></thead><tbody>';

  g.list.forEach(function (u) {
    var active = u.active !== false, mine = me && me.id === u.id;
    var open = (typeof ADMIN_EXPANDED !== "undefined") && u.id === ADMIN_EXPANDED;
    h += '<tr onclick="adminToggleAcct(\'' + u.id + '\')" style="cursor:pointer">'
      /* ⚠️ a no-login helper (js: "+ Helper") has no username and may have no name — the row rendered
         blank, which reads as a corrupt record rather than as Dad or Chaz. Always something legible. */
      + '<td>' + esc(apName(u)) + (mine ? ' <span class="sub">· you</span>' : '') + '</td>'
      + '<td class="sub">' + (u.username ? "@" + esc(u.username) : '<span class="muted">no login</span>')
      +   ' <span id="pres_' + u.id + '"></span></td>'
      + '<td>' + ((typeof roleBadge === "function") ? roleBadge(apRoleOf(u)) : esc(apRoleOf(u))) + '</td>'
      + '<td>' + (active ? '<span class="sub">active</span>'
                         : '<span class="badge" style="background:var(--danger);color:#fff">off</span>') + '</td>'
      + '<td class="sub" style="text-align:right">' + (open ? "▾" : "▸") + '</td></tr>';
    if (open) {
      h += '<tr><td colspan="5" style="white-space:normal;background:var(--soft)">'
        + '<div class="row" style="align-items:center;gap:8px;margin-bottom:8px"><div class="sub grow">Role in this org</div>'
        + '<select onchange="adminSetRole(\'' + u.id + '\',this.value)" style="width:auto;min-width:120px">'
        + ((typeof adminRoleOpts === "function") ? adminRoleOpts(apRoleOf(u)) : "") + '</select></div>'
        + '<div class="row" style="gap:6px;flex-wrap:wrap">'
        + '<button class="btn ghost sm" onclick="event.stopPropagation();adminSetName(\'' + u.id + '\')">🧑 ' + (u.name ? esc(u.name) : "Set name") + '</button>'
        + '<button class="btn ghost sm" onclick="event.stopPropagation();adminSetEmail(\'' + u.id + '\')">✉ ' + (u.email ? esc(u.email) : "Set email") + '</button>'
        + '<button class="btn ghost sm" onclick="event.stopPropagation();adminResetPw(\'' + u.id + '\')">Reset PW</button>'
        + '<button class="btn ghost sm" onclick="event.stopPropagation();adminLogoutEverywhere(\'' + u.id + '\')">🚪 Log out</button>'
        + '<button class="btn ghost sm" onclick="event.stopPropagation();adminToggleActive(\'' + u.id + '\')">' + (active ? "Deactivate" : "Reactivate") + '</button>'
        + '<button class="btn danger sm" onclick="event.stopPropagation();adminRemove(\'' + u.id + '\')">Remove</button>'
        + '</div></td></tr>';
    }
  });
  h += '</tbody></table></div>';
  h += '<div class="sub" style="margin-top:6px">' + (g.filtered ? ("Showing " + g.list.length + " of " + g.total) : (g.total + " member" + (g.total === 1 ? "" : "s"))) + '</div>';
  return h;
}

/* ---------- roles, collapsed ---------- */
function adminRolesHTML() {
  if (!(typeof isOwner === "function" && isOwner())) return "";
  var roles = (typeof allRoles === "function") ? allRoles() : [];
  var pages = (typeof ADMIN_PAGES !== "undefined") ? ADMIN_PAGES : [];
  var actions = (typeof ALL_ACTIONS !== "undefined") ? ALL_ACTIONS : [];
  var h = '<div class="row" style="align-items:center;margin:16px 2px 8px"><div class="grow sub" style="font-weight:700">Roles &amp; permissions</div>'
    + '<button class="btn ghost sm" style="width:auto" onclick="adminOpenAddRole()">+ Role</button></div>';

  roles.forEach(function (r) {
    var builtin = r.key === "owner";
    /* ⭐ COLLAPSED. Every role used to print a checkbox per page AND per action, always expanded — dozens
       of boxes above the member list, for a company of two. */
    var nPages = builtin ? pages.length : pages.filter(function (p) { return (typeof roleAllows === "function") && roleAllows(r.key, p.tab); }).length;
    h += '<details class="card" style="padding:10px 12px;margin-bottom:6px">'
      + '<summary style="cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px">'
      + '<span class="grow"><span class="nm" style="font-size:15px">' + esc(r.label) + '</span> '
      + ((typeof roleBadge === "function") ? roleBadge(r.key) : "")
      + '<div class="sub">' + (builtin ? "Full access · built-in" : (nPages + " of " + pages.length + " pages")) + '</div></span>'
      + '<span class="sub">▾</span></summary>';
    if (builtin) {
      h += '<div class="muted" style="margin-top:10px">Full access — every page and every action, including this panel. Cannot be restricted.</div>';
    } else {
      h += '<div class="row" style="justify-content:flex-end;margin-top:8px">'
        + '<button class="btn danger sm" style="width:auto" onclick="adminDeleteRole(\'' + esc(r.key) + '\')">Delete role</button></div>'
        + '<div class="sub" style="margin-top:8px;font-weight:600">Pages</div><div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px">'
        + pages.map(function (p) {
            var on = (typeof roleAllows === "function") && roleAllows(r.key, p.tab);
            return '<label style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:600;white-space:nowrap">'
              + '<input type="checkbox" style="width:18px;height:18px" ' + (on ? "checked" : "")
              + ' onchange="adminTogglePage(\'' + esc(r.key) + '\',\'' + p.tab + '\')">' + esc(p.label) + '</label>';
          }).join("") + '</div>'
        + '<div class="sub" style="margin-top:12px;font-weight:600">Actions</div><div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px">'
        + actions.map(function (a) {
            var on = (typeof roleActionAllows === "function") && roleActionAllows(r.key, a.key);
            return '<label style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:600;white-space:nowrap">'
              + '<input type="checkbox" style="width:18px;height:18px" ' + (on ? "checked" : "")
              + ' onchange="adminToggleAction(\'' + esc(r.key) + '\',\'' + a.key + '\')">' + esc(a.label) + '</label>';
          }).join("") + '</div>';
    }
    h += '</details>';
  });
  return h;
}

/* ---------- 3: menu order and tools, one list ---------- */
function apGroupTabs(g) {
  var conf = (typeof orgConfigurableTabs === "function") ? orgConfigurableTabs() : [];
  return (g.tabs || []).filter(function (t) { return conf.indexOf(t) >= 0; });
}
function apGroupOn(g) {
  var t = apGroupTabs(g);
  if (!t.length) return null;                                   // core / always-on
  return t.filter(function (x) { return (typeof orgHasTab === "function") ? orgHasTab(x) : true; }).length;
}

function adminMenuToolsCard() {
  var groups = (typeof NAV_GROUPS !== "undefined") ? NAV_GROUPS : [];
  var byKey = {}; groups.forEach(function (g) { byKey[g.key] = g; });
  var order = (typeof navOrderEditable === "function") ? navOrderEditable() : groups.map(function (g) { return g.key; });
  var meta = (typeof TAB_META !== "undefined") ? TAB_META : {};

  var h = '<div class="card"><div class="nm" style="font-size:15px">🧭 Menu &amp; tools</div>'
    + '<div class="sub" style="margin-bottom:10px">Turn a section on or off and set the order it appears in the menu — for <b>'
    + esc(typeof orgName === "function" ? orgName(S.biz) : S.biz) + '</b>. Both sync to everyone in this org.</div>'
    + '<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">'
    + '<button class="btn ghost sm" style="width:auto" onclick="orgApplyTemplate(\'full\')">🛠️ Field services</button>'
    + '<button class="btn ghost sm" style="width:auto" onclick="orgApplyTemplate(\'bookings\')">🎟️ Bookings</button>'
    + '<button class="btn ghost sm" style="width:auto" onclick="orgApplyTemplate(\'personal\')">🌱 Personal</button></div>'
    + '<div style="display:flex;flex-direction:column;gap:4px">';

  order.forEach(function (k, i) {
    var g = byKey[k]; if (!g) return;
    var tabs = apGroupTabs(g), on = apGroupOn(g);
    var locked = on === null;                                   // nothing configurable in it
    var checked = locked ? true : on > 0;
    var partial = !locked && on > 0 && on < tabs.length;
    h += '<div style="border:1px solid var(--line);border-radius:10px;padding:7px 9px">'
      + '<div class="row" style="align-items:center;gap:8px">'
      + '<input type="checkbox" style="width:18px;height:18px;flex:0 0 auto"' + (checked ? " checked" : "")
      +   (locked ? " disabled title=\"Always on\"" : "") + ' onchange="apToggleGroup(\'' + esc(k) + '\')">'
      + '<span style="font-size:17px;width:22px;text-align:center;flex:0 0 auto">' + (g.icon || "") + '</span>'
      + '<span class="grow" style="font-weight:600;min-width:0">' + esc(g.label || k)
      +   (partial ? ' <span class="sub">· ' + on + ' of ' + tabs.length + '</span>' : '')
      +   (locked ? ' <span class="sub">· always on</span>' : '') + '</span>'
      + '<button class="btn ghost sm" style="width:auto;padding:3px 9px" ' + (i === 0 ? "disabled" : "")
      +   ' onclick="navOrderMove(\'' + esc(k) + '\',-1)">▲</button>'
      + '<button class="btn ghost sm" style="width:auto;padding:3px 9px" ' + (i === order.length - 1 ? "disabled" : "")
      +   ' onclick="navOrderMove(\'' + esc(k) + '\',1)">▼</button></div>';
    /* ⚠️ a group holding several tools expands rather than pretending to be one switch */
    if (tabs.length > 1) {
      h += '<div style="display:flex;flex-wrap:wrap;gap:4px 12px;margin:6px 0 2px 30px">'
        + tabs.map(function (t) {
            var tOn = (typeof orgHasTab === "function") ? orgHasTab(t) : true, m = meta[t] || {};
            return '<label style="display:flex;align-items:center;gap:5px;font-size:12.5px;white-space:nowrap">'
              + '<input type="checkbox" style="width:15px;height:15px" ' + (tOn ? "checked" : "")
              + ' onchange="orgToolToggle(\'' + t + '\')">' + esc(m.l || t) + '</label>';
          }).join("") + '</div>';
    }
    h += '</div>';
  });
  return h + '</div></div>';
}

if (typeof window !== "undefined") {
  window.adminMembersTable = adminMembersTable; window.adminRolesHTML = adminRolesHTML;
  window.adminMenuToolsCard = adminMenuToolsCard; window.apMembers = apMembers; window.apGroupTabs = apGroupTabs; window.apName = apName;

  window.apSort = function (key) {
    if (AP_SORT === key) AP_DIR = -AP_DIR; else { AP_SORT = key; AP_DIR = 1; }
    var el = document.getElementById("acctlist");
    if (el) el.innerHTML = adminMembersTable();
    else if (typeof render === "function") render();
  };

  /* ⭐ ONE WRITE for a whole group. Calling orgToolToggle() per tab would save() and render() once per
     tab — several full re-renders and several sync pushes for one click, with the list rebuilding
     underneath his finger between them. */
  window.apToggleGroup = function (key) {
    var g = ((typeof NAV_GROUPS !== "undefined") ? NAV_GROUPS : []).find(function (x) { return x.key === key; });
    if (!g) return;
    var tabs = apGroupTabs(g); if (!tabs.length) return;
    var anyOn = tabs.some(function (t) { return (typeof orgHasTab === "function") ? orgHasTab(t) : true; });
    var cur = ((typeof orgConfigurableTabs === "function") ? orgConfigurableTabs() : [])
      .filter(function (t) { return (typeof orgHasTab === "function") ? orgHasTab(t) : true; });
    var next = anyOn
      ? cur.filter(function (t) { return tabs.indexOf(t) < 0; })          // turning the group off
      : cur.concat(tabs.filter(function (t) { return cur.indexOf(t) < 0; }));
    if (typeof orgSetTabs === "function") orgSetTabs(next);
  };
}
if (typeof module !== "undefined" && module.exports) module.exports = { apRoleOf: apRoleOf };
