/* ---------- SECTION TABS (js/156) — splitting a monolith without cutting it open -------------------
   Ray, 2026-08-26: "the admin page and the settings page are way too monolithic. They need a lot more
   subtabs. You need to be able to find what you're looking for much easier."

   He is right — Settings is nine sections in one scroll: Sync, Appearance, Cards, Pricing rates, Job costs,
   Home base, Archive, Backups, Security. Admin is a PIN gate plus members plus everything else.

   ⚠️ BUT THOSE SCREENS ARE ONE TEMPLATE LITERAL EACH, with conditionals wrapping whole sections
   (`${cfg ? "<h2>Pricing rates</h2>…" : ""}`). Cutting them into real sub-tab functions means editing the
   screen that holds Sync, Backups and Security by hand, and getting a nested template boundary wrong there
   is how someone loses their backups page.

   ⭐ SO THIS SPLITS THE RENDERED DOM INSTEAD OF THE SOURCE. The screen renders exactly as it always has;
   afterwards this walks the result, groups everything under each <h2>, and shows one group at a time with
   a tab row. The template is never touched.

   ⛔ AND IT FAILS OPEN. If anything is unexpected — no headings, one heading, an error — it leaves the page
   exactly as rendered. The worst case is the long page he has today, never a blank one. That is the whole
   reason for doing it this way round.

   ⚠️ Anything ABOVE the first heading stays pinned and visible on every tab. On Settings that's the error
   log; on Admin it's the PIN gate. Hiding either would be actively harmful. */

var SEC_SUB = {};                       // tab -> the section title currently showing
var SEC_SCREENS = ["data", "admin"];    // which screens get split

/* ⭐ THE ORDER THE SECTIONS SHOULD READ IN, which is not the order the template happens to emit them.
   Ray, 2026-08-26: "make logical groupings and make dropdowns for them." Declaring the order here means
   both the tab row and the sidebar list can follow it without anyone editing the screen's markup — the
   same reason this file splits the DOM instead of the source. Anything not listed keeps its DOM position
   at the end, so a new section can never vanish by being forgotten here. */
var SEC_ORDER = {
  data:  ["sync", "appearance", "home-base", "pricing-rates", "job-costs-cogs", "cards", "security", "backups", "archive"],
  admin: ["members", "roles-pages-actions", "tools", "menu-order", "ai-tools", "admin", "activity"]
};
function secSortGroups(tab, groups) {
  var want = SEC_ORDER[tab];
  if (!want) return groups;
  var rank = function (g) { var i = want.indexOf(g.key); return i < 0 ? 999 : i; };
  return groups.slice().sort(function (a, b) { return rank(a) - rank(b) || groups.indexOf(a) - groups.indexOf(b); });
}

function secKey(title) { return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

/* ⭐ A HEADING IS EITHER A BARE <h2> OR THIS APP'S STANDARD HEADING ROW: <div class="secthd"><h2>…</h2>
   …buttons…</div>. Settings uses the first form, Admin uses the second — so looking only for direct <h2>
   children found ONE heading on Admin, which failed open and left that screen unsplit while three sidebar
   links pointed at sections that would never exist. Dead links, silently. */
function secHeadOf(node) {
  if (!node) return null;
  if (node.tagName === "H2") return node;
  var kids = node.children;
  if (kids && kids.length && kids[0] && kids[0].tagName === "H2") return kids[0];
  return null;
}

/* the visible text of a heading, minus any org name interpolated into it */
function secTitle(h2) {
  var t = (h2.textContent || "").trim();
  var dash = t.indexOf(" — ");
  return (dash > 0 ? t.slice(0, dash) : t).trim();
}

function secSplit(tab) {
  try {
    if (SEC_SCREENS.indexOf(tab) < 0) return;
    var view = document.getElementById("view");
    if (!view) return;
    if (view.querySelector("[data-secrow]")) return;              // already split this render

    var kids = Array.prototype.slice.call(view.children);
    var heads = kids.filter(function (n) { return !!secHeadOf(n); });
    /* ⛔ fail open: nothing to split, or only one section, means leave it alone */
    if (heads.length < 2) return;

    var pinned = [], groups = [], cur = null;
    kids.forEach(function (n) {
      var h = secHeadOf(n);
      if (h) {
        cur = { title: secTitle(h), key: secKey(secTitle(h)), nodes: [n], bare: (n === h) };
        groups.push(cur);
      } else if (cur) cur.nodes.push(n);
      else pinned.push(n);                                        // above the first heading
    });
    if (!groups.length) return;

    groups = secSortGroups(tab, groups);
    var want = SEC_SUB[tab];
    if (!groups.some(function (g) { return g.key === want; })) want = groups[0].key;
    SEC_SUB[tab] = want;

    /* one wrapper per section, so showing/hiding is a single style change */
    groups.forEach(function (g) {
      var box = document.createElement("div");
      box.setAttribute("data-sec", g.key);
      box.style.display = (g.key === want) ? "" : "none";
      /* ⚠️ APPENDED, not inserted where the heading was — the groups have been reordered, so putting each
         wrapper back at its original position would undo the sort. Only one section is visible at a time,
         so DOM order is invisible to him either way; it just has to be consistent. */
      view.appendChild(box);
      g.nodes.forEach(function (n) { box.appendChild(n); });
      /* ⚠️ ONLY a BARE heading is hidden. A .secthd row carries buttons — "+ Add member", "+ Helper",
         "+ Role" — and hiding it to avoid showing the title twice would take those with it. A duplicated
         word is a nuisance; a missing Add-member button is a broken screen. */
      if (g.bare) g.nodes[0].style.display = "none";
    });

    var row = document.createElement("div");
    row.className = "subnav";
    row.setAttribute("data-secrow", tab);
    row.innerHTML = groups.map(function (g) {
      /* ⭐ the key lives in a data attribute, not in the onclick string. secGo used to identify the active
         button by string-matching its handler, which throws the moment getAttribute("onclick") is null —
         on a click, on the Settings page. An attribute is what attributes are for. */
      return '<button class="subbtn' + (g.key === want ? " on" : "") + '" data-seckey="' + escSec(g.key) + '"'
        + ' onclick="secGo(\'' + tab + '\',\'' + g.key + '\')">' + escSec(g.title) + '</button>';
    }).join("");
    /* below anything pinned, above the sections */
    if (pinned.length) pinned[pinned.length - 1].parentNode.insertBefore(row, pinned[pinned.length - 1].nextSibling);
    else view.insertBefore(row, view.firstChild);
  } catch (e) { /* ⛔ fail open — the page stays exactly as the screen rendered it */ }
}

function escSec(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

if (typeof window !== "undefined") {
  window.secSplit = secSplit; window.SEC_SUB = SEC_SUB; window.SEC_SCREENS = SEC_SCREENS;
  window.secKey = secKey; window.secTitle = secTitle; window.secHeadOf = secHeadOf; window.SEC_ORDER = SEC_ORDER; window.secSortGroups = secSortGroups;
  /* ⭐ the sidebar's deep rows call setter(sub) and may be coming from ANOTHER tab, where this screen has
     not rendered yet — so this records the choice and re-renders, letting secSplit apply it. secGo below
     is the in-page version, for when the sections are already on screen. */
  window.secGoDeep = function (sub) {
    if (typeof TAB !== "undefined") SEC_SUB[TAB] = sub;
    if (typeof render === "function") render();
  };
  window.secGo = function (tab, key) {
    SEC_SUB[tab] = key;
    var view = document.getElementById("view"); if (!view) return;
    Array.prototype.forEach.call(view.querySelectorAll("[data-sec]"), function (b) {
      b.style.display = (b.getAttribute("data-sec") === key) ? "" : "none";
    });
    Array.prototype.forEach.call(view.querySelectorAll("[data-seckey]"), function (b) {
      b.className = "subbtn" + (b.getAttribute("data-seckey") === key ? " on" : "");
    });
    try { window.scrollTo(0, 0); } catch (e) {}
  };
}
if (typeof module !== "undefined" && module.exports) module.exports = { secKey: secKey, SEC_SCREENS: SEC_SCREENS };
