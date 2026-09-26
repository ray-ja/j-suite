/* ---------- EVERY SCREEN, THE SAME RULES (js/198) — Phase 8 of the UX reorg ----------
   Ray, 2026-09-26: "find and apply rules to fix the UX. dont stop until its done. the whole app all the way
   through." Phase 7 fixed Today; this pass takes the same rules to the rest of the desktop screenshots
   (Clock in, Settings, Receipts, Customers, Messages, Finance overview, Calendar):

     1. READING WIDTH. A form or a list of rows never runs 1,600px wide. Screens that are a form, a reading
        page or a single list get a narrower column (body[data-narrow], app.css). Grids, calendars and
        dashboards keep the full width.
     2. SAY IT ONCE. When the sidebar already lists this screen as a row (Invoices · Receipts · My Pay under
        Money), the chip row across the top of the page repeats it. body.navrow hides that row at desktop
        width; the phone keeps it because the phone has no sidebar.
     3. CONTROLS SHARE A LINE. Search box + sort menu sit side by side on desktop instead of two full-width
        bars stacked.
     4. SECONDARY ACTIONS SHARE A LINE. Receipts: one primary (Upload), the two secondaries in a row beneath,
        the two hint lines merged into one.
     5. LONG TEXT FOLDS. Coaching paragraphs at the foot of a card (Finance overview: "If that one customer
        stops calling…", "Hours are summed across everyone…") show three lines and a "more".
     6. LIST + DETAIL. Messages at expanded width: the inbox stays on the left while a thread is open on the
        right, so the next thread is one click (Material 3 list-detail).
   Post-render over what each screen already rendered, fails open (js/156 pattern). Pure helpers tested in
   screens-tests.js. */
var SC_NARROW_TABS = ["time", "data", "admin", "messages", "pay", "nextcheck", "todo", "approvals", "files", "playbook", "research", "receipts", "invoices", "jobs", "quotes", "leads", "recurring", "team",
  /* the personal org: lists and forms too (its Today is the wide dashboard, js/03 wideday, and stays out) */
  "budget", "life", "journal", "shelf", "workout", "cal"];
/* Phase 9 (2026-09-26, the other fifteen screens):
     7. A CARD THAT IS A HEADLINE AND ONE BUTTON IS A ROW. Playbook's starter packs, Invoices' "Generate pay
        links", Files' upload box: text on the left, the button on the right, one line tall.
     8. QUIET SECTIONS OUTSIDE TODAY TAKE ONE LINE TOO. "Ready to invoice · 0 · No completed jobs waiting" is a
        line you can expand, the same as js/197 does on Today. */
var SC_QUIET = /^(no |nothing|none|nobody|not yet|all caught up|—|–)/i;
/* is this heading + body pair quiet? Pure. */
function scIsQuiet(text, hasControl, count) {
  if (hasControl) return false; if (count > 0) return false;
  var s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > 0 && s.length < 160 && SC_QUIET.test(s);
}
/* is this card a headline + one action? shape = {buttons, controls, children, chars}. Pure. */
function scIsPromo(shape) {
  shape = shape || {};
  return shape.buttons === 1 && !shape.controls && shape.children >= 2 && shape.children <= 4 && (+shape.chars || 0) < 420;
}
function scNarrow(tab) { return SC_NARROW_TABS.indexOf(String(tab || "")) >= 0; }
/* the in-page chip row repeats the sidebar when the sidebar lists this tab as a plain row of its group. Pure. */
function scRowRedundant(rows, tab, host) {
  rows = rows || []; if (rows.length < 2) return false;
  var t = host || tab;   // a hidden tab (quotes, routes, nextcheck) is listed by its host row (jobs, route, pay)
  return rows.some(function (r) { return r && (r.tab === tab || r.tab === t); });
}
/* how many trailing paragraphs of a card to fold. paras = [{chars, control}] in document order; the fold
   takes the run of control-free paragraphs at the END and folds it when it totals more than minChars. Pure. */
function scFoldTail(paras, minChars) {
  paras = paras || []; minChars = minChars || 220;
  var n = 0, chars = 0;
  for (var i = paras.length - 1; i >= 0; i--) { var p = paras[i]; if (!p || p.control) break; n++; chars += (+p.chars || 0); }
  return chars > minChars ? n : 0;
}
/* index of a search box immediately followed by a select, else -1. kinds = ["search","select",…]. Pure. */
function scToolbarPair(kinds) {
  kinds = kinds || [];
  for (var i = 0; i + 1 < kinds.length; i++) if (kinds[i] === "search" && kinds[i + 1] === "select") return i;
  return -1;
}
if (typeof window !== "undefined") {
  var scTier = function () { return (typeof dkTier === "function") ? dkTier(window.innerWidth) : "compact"; };
  /* rule 1 */
  function scWidth(tab) {
    if (scNarrow(tab)) document.body.setAttribute("data-narrow", "1"); else document.body.removeAttribute("data-narrow");
  }
  /* rule 2 */
  function scNavRow(tab) {
    var on = false;
    try {
      if (typeof tabGroup === "function" && typeof navDeepFor === "function") {
        var g = tabGroup(tab), rows = navDeepFor(g.key), host = (typeof NAV_HOST !== "undefined" && NAV_HOST[tab]) || "";
        on = scRowRedundant(rows, tab, host) && !(typeof navDeepRedundant === "function" && navDeepRedundant(g.key, rows));
      }
    } catch (e) { on = false; }
    document.body.classList.toggle("navrow", on);
  }
  /* rule 3 */
  function scToolbar(view) {
    if (scTier() === "compact" || view.querySelector(".sc-toolbar")) return;
    var kids = Array.prototype.slice.call(view.children);
    var i = scToolbarPair(kids.map(function (k) { return k.tagName === "INPUT" && k.classList.contains("search") ? "search" : k.tagName === "SELECT" ? "select" : k.tagName.toLowerCase(); }));
    if (i < 0) return;
    var bar = document.createElement("div"); bar.className = "sc-toolbar";
    view.insertBefore(bar, kids[i]); bar.appendChild(kids[i]); bar.appendChild(kids[i + 1]);
  }
  /* rule 4 */
  function scReceipts(view) {
    if (scTier() === "compact") return;
    var inp = view.querySelector("#rcpt_files"); var card = inp && inp.closest(".card"); if (!card || card.querySelector(".sc-actrow")) return;
    var primary = card.querySelector(":scope > button.btn.acc"); if (!primary) return;
    /* only the secondaries BELOW the primary (the "? Tips" chip js/187 puts at the top of the card stays put) */
    var ghosts = Array.prototype.slice.call(card.querySelectorAll(":scope > button.btn.ghost")).filter(function (b) { return !!(primary.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); });
    if (ghosts.length < 2) return;
    var row = document.createElement("div"); row.className = "sc-actrow"; primary.after(row);
    ghosts.forEach(function (b) { b.style.width = ""; b.style.marginTop = ""; row.appendChild(b); });
    var subs = Array.prototype.slice.call(card.querySelectorAll(":scope > .sub")).filter(function (p) { return !p.id && /ctrl|drag photos/i.test(p.textContent || ""); });
    if (subs.length === 2) { subs[0].style.display = "none"; subs[1].innerHTML = "<b>Ctrl&nbsp;+&nbsp;V</b> pastes a copied screenshot · or drag photos onto this box"; }
  }
  /* rule 5 */
  function scFold(view, tab) {
    if (tab === "today") return;   // js/197 owns Today
    Array.prototype.slice.call(view.querySelectorAll(".card")).forEach(function (card) {
      if (card.querySelector(".sc-fold")) return;
      var kids = Array.prototype.slice.call(card.children);
      var paras = kids.map(function (k) {
        var cs = getComputedStyle(k);
        var isSub = k.classList.contains("sub") && !k.id && cs.whiteSpace !== "nowrap";
        /* a hidden paragraph (a tip behind "? Tips", a warning that is off) weighs nothing and folds nothing */
        return { chars: (isSub && cs.display !== "none") ? (k.textContent || "").trim().length : 0, control: !isSub || !!k.querySelector("input,textarea,select,button,a") };
      });
      var n = scFoldTail(paras, 220); if (!n) return;
      var box = document.createElement("div"); box.className = "sc-fold db-clamp";
      var first = kids[kids.length - n]; card.insertBefore(box, first);
      kids.slice(kids.length - n).forEach(function (k) { box.appendChild(k); });
      var t = document.createElement("button"); t.className = "db-more"; t.textContent = "more";
      t.onclick = function () { var on = box.classList.toggle("db-clamp"); t.textContent = on ? "more" : "less"; };
      box.after(t);
    });
  }
  /* rule 6 */
  function scMessages(view) {
    var open = (typeof MSG_OPEN !== "undefined") ? MSG_OPEN : null;   // js/47's top-level let (script scope, not window)
    if (scTier() !== "expanded" || !open || typeof msgInboxHTML !== "function") return;
    var pane = view.querySelector("#msgpane"); if (!pane || view.querySelector(".msg-split")) return;
    var split = document.createElement("div"); split.className = "msg-split";
    var aside = document.createElement("aside"); aside.className = "msg-list"; aside.innerHTML = msgInboxHTML();
    var cur = aside.querySelector('.li[onclick*="' + String(open).replace(/["'\\]/g, "") + '"]'); if (cur) cur.classList.add("on");
    var main = document.createElement("div"); main.className = "msg-main";
    view.insertBefore(split, pane); split.appendChild(aside); split.appendChild(main); main.appendChild(pane);
    /* the pane was sized for its old top; size it again where it now sits, keeping the scroll position */
    if (typeof msgFitPane === "function") { var ml = document.getElementById("msglist"); var st = ml ? ml.scrollTop : null; msgFitPane(false, st); }
  }
  /* rule 7 */
  function scPromo(view, tab) {
    if (tab === "today" || scTier() === "compact") return;
    Array.prototype.slice.call(view.querySelectorAll(".card")).forEach(function (card) {
      if (card.classList.contains("sc-promo") || card.getAttribute("onclick") || card.querySelector(".card, .li, .secthd, table, .grid2")) return;
      var kids = Array.prototype.slice.call(card.children);
      var btns = kids.filter(function (k) { return k.tagName === "BUTTON"; });
      var shape = { buttons: btns.length, controls: !!card.querySelector("input,select,textarea,details") || card.querySelectorAll("button,a").length > 1, children: kids.length, chars: (card.textContent || "").trim().length };
      if (!scIsPromo(shape) || !btns[0].classList.contains("btn")) return;
      var txt = document.createElement("div"); txt.className = "sc-promo-txt";
      kids.forEach(function (k) { if (k !== btns[0]) txt.appendChild(k); });
      card.classList.add("sc-promo"); card.insertBefore(txt, btns[0]); card.appendChild(btns[0]);
      btns[0].style.width = ""; btns[0].style.marginTop = "";
    });
  }
  /* rule 8 */
  var SC_OPEN = {};
  function scQuiet(view, tab) {
    if (tab === "today") return;
    Array.prototype.slice.call(view.querySelectorAll(":scope > .secthd")).forEach(function (head) {
      var body = head.nextElementSibling; if (!body || !(body.classList.contains("card") || body.classList.contains("empty"))) return;
      if (body.nextElementSibling && body.nextElementSibling.classList.contains("card")) return;   // a heading with several cards is a list, not a state
      var title = ((head.querySelector("h2") || head).textContent || "").trim(); var ct = head.querySelector(".ct");
      var count = ct ? (parseInt(ct.textContent, 10) || 0) : 0;
      var hasControl = !!body.querySelector("input,select,textarea,button,a,details");
      if (!scIsQuiet(body.textContent, hasControl, count) || SC_OPEN[tab + "/" + title]) return;
      var line = document.createElement("div"); line.className = "db-quiet";
      line.innerHTML = '<span class="t">' + (typeof esc === "function" ? esc(title) : title) + '</span><span class="s">' + (typeof esc === "function" ? esc(body.textContent.trim()) : body.textContent.trim()) + '</span><span class="chev">▸</span>';
      line.onclick = function () { SC_OPEN[tab + "/" + title] = true; if (typeof render === "function") render(); };
      head.style.display = "none"; body.style.display = "none"; head.parentNode.insertBefore(line, head);
    });
  }
  /* the job page head: the Crew Guide button and "Edit layout" share a line at desktop width (three rows of
     controls before the first card became one) */
  function scJobHead(view) {
    if (scTier() === "compact") return;
    var pg = view.querySelector(".jobpg"); if (!pg || pg.querySelector(".sc-jobhead")) return;
    var kids = Array.prototype.slice.call(pg.children), guides = [], editRow = null;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.classList.contains("secthd")) continue;
      if (k.tagName === "BUTTON" && k.classList.contains("acc") && /Crew Guide/i.test(k.textContent || "")) { guides.push(k); continue; }
      if (k.classList.contains("row") && k.querySelector("button[onclick^='jobLayoutToggleEdit']")) { editRow = k; break; }
      if (!(k.textContent || "").trim() && !k.children.length) continue;   // an empty spacer div sits between them
      if (guides.length) break;
    }
    if (!guides.length || !editRow) return;
    var head = document.createElement("div"); head.className = "sc-jobhead";
    pg.insertBefore(head, guides[0]); guides.forEach(function (g) { head.appendChild(g); }); head.appendChild(editRow);
  }
  function scApply(tab) {
    try {
      var view = document.getElementById("view"); if (!view) return;
      scWidth(tab); scNavRow(tab);
      if (tab === "schedule" && window.JOB_OPEN) scJobHead(view);
      if (tab === "accounts" || tab === "team") scToolbar(view);
      if (tab === "receipts") scReceipts(view);
      if (tab === "messages") scMessages(view);
      scPromo(view, tab); scQuiet(view, tab);
      scFold(view, tab);
    } catch (e) { try { console.warn("screens pass skipped:", e); } catch (_) {} }
  }
  if (typeof secSplit === "function") { var _ss8 = secSplit; secSplit = function (tab) { var r = _ss8.apply(this, arguments); scApply(tab); return r; }; window.secSplit = secSplit; }
  window.scNarrow = scNarrow; window.scRowRedundant = scRowRedundant; window.scFoldTail = scFoldTail; window.scToolbarPair = scToolbarPair; window.scIsQuiet = scIsQuiet; window.scIsPromo = scIsPromo;
}
if (typeof module !== "undefined" && module.exports) { module.exports = { SC_NARROW_TABS: SC_NARROW_TABS, scNarrow: scNarrow, scRowRedundant: scRowRedundant, scFoldTail: scFoldTail, scToolbarPair: scToolbarPair, scIsQuiet: scIsQuiet, scIsPromo: scIsPromo }; }
