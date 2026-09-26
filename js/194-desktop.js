/* ---------- DESKTOP PASS (js/194) — Phase 5 of the UX reorg ----------
   Ray, 2026-09-26: "the phone app is quite a bit better but the desktop app is still nearly unusable, there's
   just so many menus… a harness where it just adapts to the design standards."

   THE STANDARDS APPLIED (one codebase; the WINDOW WIDTH decides, never the device):
     - Material 3 window size classes: compact (< 900 here, the phone rules from Phases 1 to 4), medium
       (900 to 1279: one pane, sidebar rail), expanded (1280 and up: two panes).
     - Material 3 canonical "list-detail": at expanded width a record opens in a side sheet and the list stays
       live behind it, so the next row is one click, not close-and-find.
     - Navigation rail / drawer: the sidebar shows the same four primaries as the phone bar plus the open group;
       everything else folds under More (js/184 does the folding; app.css hides the rest).
     - NN/g reading width: prose in cards is capped at 72 characters; the job page runs two columns of cards at
       expanded width instead of one 1,000-pixel column.
     - Keyboard: N = new (the + sheet), Esc = close the sheet, / = find (js/186).
   Everything here is post-render and fails open, like js/156, 187, 188. Pure helpers: desktop-tests.js. */
function dkTier(w) { w = +w || 0; return w < 900 ? "compact" : w < 1280 ? "medium" : "expanded"; }
/* what the sidebar shows: primaries + the open group; the rest under More. Pure (mirrors js/184 + app.css). */
function dkSidebar(groups, primary, curKey) {
  groups = groups || []; primary = primary || [];
  var shown = groups.filter(function (g) { return primary.indexOf(g) >= 0 || g === curKey; });
  var more = groups.filter(function (g) { return primary.indexOf(g) < 0; });
  return { shown: shown, more: more, hidden: more.filter(function (g) { return g !== curKey; }).length };
}
/* the run of job-page nodes to put in a grid: after the tab row, up to the trailing Back button, at least two
   cards. nodes = [{tabs, card, back}]. Pure. */
function dkJobGridRange(nodes) {
  nodes = nodes || []; var t = -1;
  for (var i = 0; i < nodes.length; i++) if (nodes[i] && nodes[i].tabs) { t = i; break; }
  if (t < 0) return null;
  var end = nodes.length; for (var j = t + 1; j < nodes.length; j++) if (nodes[j] && nodes[j].back) { end = j; break; }
  var cards = 0; for (var k = t + 1; k < end; k++) if (nodes[k] && nodes[k].card) cards++;
  if (cards < 2) return null;
  return { start: t + 1, count: end - (t + 1) };
}
if (typeof window !== "undefined") {
  function dkApplyTier() { try { document.body.setAttribute("data-tier", dkTier(window.innerWidth)); } catch (e) {} }
  /* the job page, two columns at expanded width */
  function dkJobGrid() {
    try {
      if (dkTier(window.innerWidth) !== "expanded") return;
      var pg = document.querySelector("#view .jobpg"); if (!pg || pg.querySelector(".jobgrid")) return;
      var kids = Array.prototype.slice.call(pg.children);
      var model = kids.map(function (k) { return { tabs: k.classList.contains("row") && !!k.querySelector("button[onclick^='jobSetTab']"), card: k.classList.contains("card"), back: k.tagName === "BUTTON" && /Back/.test(k.textContent || "") }; });
      var r = dkJobGridRange(model); if (!r) return;
      var grid = document.createElement("div"); grid.className = "jobgrid";
      pg.insertBefore(grid, kids[r.start]);
      for (var i = 0; i < r.count; i++) grid.appendChild(kids[r.start + i]);
    } catch (e) {}
  }
  function dkPass(tab) { dkApplyTier(); if (tab === "schedule" && window.JOB_OPEN) dkJobGrid(); }
  if (typeof secSplit === "function") { var _ss5 = secSplit; secSplit = function (tab) { var r = _ss5.apply(this, arguments); dkPass(tab); return r; }; window.secSplit = secSplit; }
  window.addEventListener("resize", function () { dkApplyTier(); });
  dkApplyTier();
  /* the side sheet: the page knows when one is open (app.css narrows the content beside it) */
  (function () {
    var ov = document.getElementById("overlay"); if (!ov || typeof MutationObserver === "undefined") return;
    var sync = function () { document.body.classList.toggle("sheetopen", ov.classList.contains("show")); };
    new MutationObserver(sync).observe(ov, { attributes: true, attributeFilter: ["class"] }); sync();
  })();
  /* keyboard: Esc closes the sheet, N opens the + sheet (when not typing) */
  document.addEventListener("keydown", function (e) {
    var t = e.target, tag = t && t.tagName, typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable);
    if (e.key === "Escape") { var ov = document.getElementById("overlay"); if (ov && ov.classList.contains("show") && typeof closeModal === "function") { closeModal(); e.preventDefault(); } return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === "n" || e.key === "N") && !document.body.classList.contains("signedout") && typeof quickAddOpen === "function") { var ov2 = document.getElementById("overlay"); if (ov2 && ov2.classList.contains("show")) return; e.preventDefault(); quickAddOpen(); }
  });
  window.dkTier = dkTier; window.dkSidebar = dkSidebar;
}
if (typeof module !== "undefined" && module.exports) { module.exports = { dkTier: dkTier, dkSidebar: dkSidebar, dkJobGridRange: dkJobGridRange }; }
