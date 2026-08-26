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

function secKey(title) { return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

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
    var heads = kids.filter(function (n) { return n.tagName === "H2"; });
    /* ⛔ fail open: nothing to split, or only one section, means leave it alone */
    if (heads.length < 2) return;

    var pinned = [], groups = [], cur = null;
    kids.forEach(function (n) {
      if (n.tagName === "H2") {
        cur = { title: secTitle(n), key: secKey(secTitle(n)), nodes: [n] };
        groups.push(cur);
      } else if (cur) cur.nodes.push(n);
      else pinned.push(n);                                        // above the first heading
    });
    if (!groups.length) return;

    var want = SEC_SUB[tab];
    if (!groups.some(function (g) { return g.key === want; })) want = groups[0].key;
    SEC_SUB[tab] = want;

    /* one wrapper per section, so showing/hiding is a single style change */
    groups.forEach(function (g) {
      var box = document.createElement("div");
      box.setAttribute("data-sec", g.key);
      box.style.display = (g.key === want) ? "" : "none";
      g.nodes[0].parentNode.insertBefore(box, g.nodes[0]);
      g.nodes.forEach(function (n) { box.appendChild(n); });
      /* the heading is the tab label now — showing it twice is the noise he objected to elsewhere */
      if (g.nodes[0].tagName === "H2") g.nodes[0].style.display = "none";
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
  window.secKey = secKey; window.secTitle = secTitle;
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
