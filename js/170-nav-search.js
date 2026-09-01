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
          s: (String(d.label || "") + " " + String(g.label || "")).toLowerCase(),
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
    for (var i = 0; i < IDX.length && hits.length < 9; i++) if (IDX[i].s.indexOf(q) >= 0) hits.push(i);
    box.innerHTML = hits.length
      ? hits.map(function (i) {
          var r = IDX[i];
          return '<button class="navsub" onclick="navSearchPick(' + i + ')"><span class="ic">' + r.icon + '</span>' + esc(r.label)
            + (r.crumb ? '<span class="navbadge">' + esc(r.crumb) + '</span>' : '') + '</button>';
        }).join("")
      : '<div class="navhead">No match</div>';
  }

  window.navSearchInput = function (v) { Q = String(v || ""); paintResults(); };
  window.navSearchFocus = function (on) { FOCUSED = !!on; };
  window.navSearchKey = function (ev) {
    if (ev.key === "Enter") { var first = document.querySelector("#navsr .navsub"); if (first) first.click(); }
    else if (ev.key === "Escape") { Q = ""; var inp = document.getElementById("navq"); if (inp) inp.value = ""; paintResults(); }
  };
  window.navSearchPick = function (i) { var r = IDX[i]; if (!r) return; Q = ""; FOCUSED = false; r.go(); };

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
      wrap.innerHTML = '<input id="navq" type="search" placeholder="🔍 Search menu" autocomplete="off"'
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
