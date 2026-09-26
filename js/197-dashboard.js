/* ---------- TODAY, TRIAGED (js/197) — Phase 7 of the UX reorg ----------
   Ray, 2026-09-26, a desktop screenshot of Today: twelve cards in two newspaper columns, quiet cards as tall as
   urgent ones, a seven-row list of what is owed, a stand-up card with a paragraph of "Due:" text. "This is so
   hard to use."

   THE RULES APPLIED (NN/g dashboard guidance, progressive disclosure, Fitts):
     1. Triage order. What needs a decision or a call comes first; money second; status third; tools last.
     2. Quiet things take one line. A card whose only content is "nothing waiting" is not a card, it is a
        line you can expand. Attention goes where there is something to do.
     3. Lists stop at five. "All N →" takes you to the screen that owns the list.
     4. Long text folds. The stand-up's Due paragraph shows three lines and a "more".
     5. Wide screens get a third column (app.css, ≥ 1800px) instead of dead air.
   Post-render over the DOM js/05 already produced, fails open, business orgs only. Pure helpers tested in
   dashboard-tests.js. */
var DB_TIERS = [
  { tier: 0, re: /approvals|follow-ups|equipment service|payment plans|today's jobs|top to-dos|duty/i },
  { tier: 1, re: /awaiting payment|open quotes|payouts|invoices to send/i },
  { tier: 2, re: /who's working|working today|schedule|clock in/i },
  { tier: 3, re: /stand-up|^cap\b|\bcap\b|ads|sentinel/i }
];
var DB_QUIET = /nothing waiting|nothing due|no jobs today|nobody(?:'s| is) (?:owed|on)|not confirmed\s*$|no leads to follow|nothing outstanding|no open questions|nothing to review|all caught up|no payouts/i;
function dbTierOf(title) { var t = String(title || ""); for (var i = 0; i < DB_TIERS.length; i++) if (DB_TIERS[i].re.test(t)) return DB_TIERS[i].tier; return 2; }
/* a block is quiet when its body says so, it has no controls, and it is short. Pure. */
function dbIsQuiet(text, hasControl, count) {
  if (hasControl) return false; if (count > 0) return false;
  var s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length < 160 && DB_QUIET.test(s);
}
/* sort blocks by tier, keeping the original order inside a tier; quiet blocks sink to the end of their tier. Pure. */
function dbOrder(blocks) {
  return blocks.map(function (b, i) { return { b: b, i: i }; }).sort(function (x, y) {
    var tx = dbTierOf(x.b.title) + (x.b.quiet ? 0.5 : 0), ty = dbTierOf(y.b.title) + (y.b.quiet ? 0.5 : 0);
    return tx - ty || x.i - y.i;
  }).map(function (x) { return x.b; });
}
if (typeof window !== "undefined") {
  var DB_OPEN = {};   // quiet blocks the user expanded this session
  var dbE = function (s) { return (typeof esc === "function") ? esc(String(s == null ? "" : s)) : String(s == null ? "" : s); };
  function dbBlocks(col) {
    var kids = Array.prototype.slice.call(col.children), blocks = [], cur = null;
    kids.forEach(function (k) {
      var isHead = k.classList.contains("secthd") || k.tagName === "H2";
      if (isHead) { cur = { head: k, nodes: [], title: (k.querySelector("h2") || k).textContent.trim(), count: 0 }; var ct = k.querySelector(".ct"); if (ct) cur.count = parseInt(ct.textContent, 10) || 0; blocks.push(cur); return; }
      /* a heading owns the nodes up to its first card; a second card (Stand-up, Cap's chat, Clock in) is a
         block of its own, titled from its first bold line */
      if (!cur || (k.classList.contains("card") && cur.nodes.some(function (n) { return n.classList.contains("card"); }))) { cur = { head: null, nodes: [], title: "", count: 0 }; blocks.push(cur); }
      cur.nodes.push(k);
      if (!cur.title) { var nm = k.querySelector(".nm, b, strong, h3"); cur.title = ((nm && nm.textContent) || k.textContent || "").trim().slice(0, 40); }
    });
    return blocks;
  }
  function dbApply() {
    try {
      if (typeof TAB === "undefined" || TAB !== "today") return; if (typeof orgIsPersonalOrg === "function" && orgIsPersonalOrg()) return;
      var col = document.querySelector("#view .pgcols"); if (!col || col.getAttribute("data-db")) return;
      col.setAttribute("data-db", "1");
      var blocks = dbBlocks(col);
      blocks.forEach(function (b) {
        var text = b.nodes.map(function (n) { return n.textContent || ""; }).join(" ");
        var hasControl = b.nodes.some(function (n) { return !!n.querySelector("input, textarea, select") || n.querySelectorAll("button, a").length > 1; });
        b.quiet = !!b.head && dbIsQuiet(text, hasControl, b.count) && !DB_OPEN[b.title];
        /* rule 3: long lists stop at five */
        b.nodes.forEach(function (n) {
          var rows = Array.prototype.slice.call(n.querySelectorAll(":scope > .li")); if (rows.length <= 5 || n.querySelector("[data-db-more]")) return;
          rows.slice(5).forEach(function (r) { r.style.display = "none"; r.setAttribute("data-db-hid", "1"); });
          var more = document.createElement("button"); more.className = "btn ghost sm"; more.setAttribute("data-db-more", "1"); more.style.marginTop = "6px"; more.textContent = "All " + rows.length + " →";
          more.onclick = function () { rows.forEach(function (r) { r.style.display = ""; }); more.remove(); };
          n.appendChild(more);
        });
        /* rule 4: the stand-up's Due paragraph folds */
        b.nodes.forEach(function (n) { Array.prototype.slice.call(n.querySelectorAll(".sub")).forEach(function (p) { if (p.getAttribute("data-db-clamp") || (p.textContent || "").length < 260 || p.querySelector("input,textarea,select,button")) return; p.setAttribute("data-db-clamp", "1"); p.classList.add("db-clamp"); var t = document.createElement("button"); t.className = "db-more"; t.textContent = "more"; t.onclick = function () { var on = p.classList.toggle("db-clamp"); t.textContent = on ? "more" : "less"; }; p.after(t); }); });
      });
      /* rule 2: quiet blocks become one line */
      blocks.forEach(function (b) {
        if (!b.quiet) return;
        var line = document.createElement("div"); line.className = "db-quiet"; line.setAttribute("data-db-quiet", "1");
        var body = b.nodes.map(function (n) { var rows = n.querySelectorAll(".li"); if (rows.length) return Array.prototype.slice.call(rows).map(function (r) { return Array.prototype.slice.call(r.querySelectorAll("*")).filter(function (x) { return !x.children.length; }).map(function (x) { return (x.textContent || "").trim(); }).filter(Boolean).join(" "); }).join(" · "); return (n.innerText || n.textContent || "").replace(/\s+/g, " ").trim(); }).join(" ").slice(0, 90);
        line.innerHTML = '<span class="t">' + dbE(b.title) + '</span><span class="s">' + dbE(body) + '</span><span class="chev">▸</span>';
        line.onclick = function () { DB_OPEN[b.title] = true; if (typeof render === "function") render(); };
        b.nodes.forEach(function (n) { n.style.display = "none"; }); b.head.style.display = "none";
        b.nodes.unshift(line); col.insertBefore(line, b.head);
      });
      /* rule 1: triage order */
      var ordered = dbOrder(blocks);
      ordered.forEach(function (b) { if (b.head) col.appendChild(b.head); b.nodes.forEach(function (n) { col.appendChild(n); }); });
    } catch (e) { try { console.warn("dashboard pass skipped:", e); } catch (_) {} }
  }
  if (typeof secSplit === "function") { var _ss7 = secSplit; secSplit = function (tab) { var r = _ss7.apply(this, arguments); dbApply(); return r; }; window.secSplit = secSplit; }
  window.dbTierOf = dbTierOf; window.dbOrder = dbOrder; window.dbIsQuiet = dbIsQuiet;
}
if (typeof module !== "undefined" && module.exports) { module.exports = { dbTierOf: dbTierOf, dbIsQuiet: dbIsQuiet, dbOrder: dbOrder, DB_TIERS: DB_TIERS }; }
