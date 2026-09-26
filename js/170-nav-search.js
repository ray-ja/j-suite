/* ---------- NAV SEARCH (sidebar) ----------------------------------------------------------------
   Ray, 2026-09-01: "our sidebar menu has become too unwieldy — I need a search bar to search for the
   right menu." A filter box pinned to the top of the DESKTOP sidebar: type → every matching
   destination (top-level groups, sub-tabs, and all the level-3 screens registered in NAV_DEEP)
   drops down as rows. Click a row — or press Enter for the top match — to go. Esc clears.
   Role-gating is inherited for free: the index is built from navGroupsOrdered()/groupTabs()/
   navDeepFor(), the same gated sources the sidebar itself renders from, so search can never
   surface a page the signed-in role can't see. Mobile keeps the bottom bar untouched (CSS-hidden
   there — no room in a horizontal bar, and the query state means nothing to it). */
(function () {
  var Q = "";            // the live query — survives re-renders (a sync can repaint nav mid-type)
  var FOCUSED = false;   // whether the box had focus when the nav was last repainted
  var IDX = [];          // flat destination index, rebuilt on every nav render

  /* what a human CALLS a page vs what the menu labels it (Ray 2026-09-04: searched "timesheet",
     found nothing — the page is labeled "Time"). Searched alongside the label, never shown. */
  var NAVQ_ALIASES = {
    time: "timesheet time sheet hours clock in out timeclock punch",
    pay: "paycheck wages payout take home", nextcheck: "paycheck next check",
    invoices: "billing bill owed", receipts: "expense expenses scan",
    finance: "money cash income expenses history past jobs split who worked transactions bank card square tag tagging", schedule: "calendar week",
    accounts: "customers clients properties", team: "crew people staff",
    todo: "tasks task list checklist", map: "pins locations",
    admin: "users roles permissions", data: "settings preferences sync security keys secrets tokens api cloudflare stripe google ads websites site copy text edit publish",
    budget: "envelopes money personal", journal: "diary notes voice",
    messages: "chat dm broadcast texts", jobs: "work orders job list",
    quotes: "estimates estimate pricing", leads: "calls call lead pipeline",
    recurring: "plans subscriptions repeat", inventory: "tools gear equipment",
    resale: "sell flip marketplace", products: "catalog skus parts",
    route: "driving directions stops", routes: "gps driven review",
    playbook: "guides how-to sop", research: "ventures ideas notes",
    workout: "gym exercise lifting", cal: "birthdays dates personal calendar",
    studio: "video clips tiktok footage", shelf: "books reading library",
    life: "habits trackers", booking: "reservations tickets",
    files: "upload uploads documents document manual manuals pdf attachments folder send file"
  };
  function navSearchIndex() {
    var out = [];
    if (typeof navGroupsOrdered !== "function") return out;
    navGroupsOrdered().forEach(function (g) {
      var tabs = (typeof groupTabs === "function") ? groupTabs(g) : (g.tabs || []);
      if (!tabs.length) return;
      out.push({ icon: g.icon, label: g.label, crumb: "", s: String(g.label || "").toLowerCase(),
        go: function () { if (typeof navGroup === "function") navGroup(g.key); } });
      var rows = (typeof navDeepFor === "function") ? navDeepFor(g.key) : [];
      rows.forEach(function (d) {
        if (String(d.label || "").toLowerCase() === String(g.label || "").toLowerCase()) return;   // lone child named like its parent = noise
        out.push({ icon: d.icon || "•", label: d.label, crumb: g.label,
          s: (String(d.label || "") + " " + String(g.label || "") + " " + (NAVQ_ALIASES[d.tab] || "")).toLowerCase(),
          go: d.plain
            ? function () { if (typeof navSub === "function") navSub(d.tab); }
            : function () { if (typeof navDeepGo === "function") navDeepGo(d.tab, d.sub || "", d.setter || ""); } });
      });
    });
    return out;
  }

  function paintResults() {
    var box = document.getElementById("navsr"); if (!box) return;
    var q = Q.trim().toLowerCase();
    if (!q) { box.innerHTML = ""; return; }
    var hits = [];
    for (var i = 0; i < IDX.length && hits.length < 5; i++) if (IDX[i].s.indexOf(q) >= 0) hits.push(i);
    /* Phase 6 (2026-09-26): the same box finds RECORDS (js/186), so a name typed in the sidebar opens the
       customer, job or quote — no menu hunt in between */
    var recs = [];
    try { if (typeof recordSearchIndex === "function" && typeof recordSearchRun === "function" && q.length >= 2) { var orgs = (typeof myOrgs === "function") ? myOrgs().map(function (o) { return o.id; }) : [S.biz]; recs = recordSearchRun(recordSearchIndex(S, orgs.length ? orgs : [S.biz]), q, 6); } } catch (e) { recs = []; }
    var KL = { customer: "👤", property: "🏠", job: "🔨", quote: "🧾", file: "📎" };
    box.innerHTML = (hits.length || recs.length)
      ? (hits.length ? '<div class="navhead">Screens</div>' : '') + hits.map(function (i) {
          var r = IDX[i];
          return '<button class="navsub" onclick="navSearchPick(' + i + ')"><span class="ic">' + r.icon + '</span>' + esc(r.label)
            + (r.crumb ? '<span class="navbadge">' + esc(r.crumb) + '</span>' : '') + '</button>';
        }).join("")
        + (recs.length ? '<div class="navhead">Records</div>' + recs.map(function (r) { return '<button class="navsub" onclick="navSearchRec(\'' + esc(r.org) + '\',\'' + esc(r.kind) + '\',\'' + esc(r.id) + '\')"><span class="ic">' + (KL[r.kind] || "•") + '</span>' + esc(r.title) + (r.org !== S.biz ? '<span class="navbadge">' + esc((typeof orgName === "function") ? orgName(r.org) : r.org) + '</span>' : '') + '</button>'; }).join("") : '')
      : '<div class="navhead">No match</div>';
  }

  window.navSearchInput = function (v) { Q = String(v || ""); paintResults(); };
  window.navSearchFocus = function (on) { FOCUSED = !!on; };
  window.navSearchKey = function (ev) {
    if (ev.key === "Enter") { var first = document.querySelector("#navsr .navsub"); if (first) first.click(); }
    else if (ev.key === "Escape") { Q = ""; var inp = document.getElementById("navq"); if (inp) inp.value = ""; paintResults(); }
  };
  window.navSearchPick = function (i) { var r = IDX[i]; if (!r) return; Q = ""; FOCUSED = false; r.go(); };
  window.navSearchRec = function (org, kind, id) { Q = ""; FOCUSED = false; if (typeof recordSearchGo === "function") recordSearchGo(org, kind, id); };

  /* renderNav() (js/03) rebuilds nav.innerHTML on every render — so we wrap it and re-inject the box
     each time, restoring the query (and focus) so a background sync can't eat what he was typing. */
  if (typeof renderNav === "function") {
    var _rn = renderNav;
    renderNav = function () {
      _rn();
      var nav = document.querySelector("nav"); if (!nav) return;
      IDX = navSearchIndex();
      var wrap = document.createElement("div");
      wrap.className = "navsearch";
      wrap.innerHTML = '<input id="navq" type="search" placeholder="🔍 Find a customer, job, screen…" autocomplete="off"'
        + ' oninput="navSearchInput(this.value)" onkeydown="navSearchKey(event)"'
        + ' onfocus="navSearchFocus(true)" onblur="navSearchFocus(false)">'
        + '<div id="navsr" class="navkids"></div>';
      nav.insertBefore(wrap, nav.firstChild);
      if (Q) {
        var inp = document.getElementById("navq");
        if (inp) { inp.value = Q; if (FOCUSED) { try { inp.focus(); inp.setSelectionRange(Q.length, Q.length); } catch (e) {} } }
        paintResults();
      }
    };
  }
})();
