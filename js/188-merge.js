/* ---------- ONE HOME PER THING (js/188) — Phase 3 of the UX reorg ----------
   Ray, 2026-09-22, UX audit: "there's a lot of redundant stuff. I don't necessarily want to hardcore delete
   anything." So nothing is deleted; each doubled surface keeps one front door and the others become a view of
   it or a link to it. Same post-render pattern as js/156 and js/187: screens render as they always have, this
   pass adjusts the result and fails open.

     - JOBS + QUOTES: same screen (rQuotes), two menus. Now one chip under Work; `quotes` stays routable and
       hidden from the row (js/03 NAV_HIDDEN_TABS, js/155 skips its deep row). Nothing to do here.
     - ROUTE: Route planner (`route`) and Route review (`routes`) read as two versions of one thing. One chip,
       Route, and a Plan | Review toggle under the heading of both screens.
     - RESEARCH: the home is Reference → Research (the synced research collection). The Plan screen's own
       "Research" chip (a one-blob market-research doc) becomes a link to that home, and the home carries a
       small link back to the old notes so they are still one tap away.
     - MONEY OWED: the home is Finance → A/R (js/50 + js/154 together). The Invoices heading's "$… owed" is now
       a link to it instead of a second number to reconcile by eye.
     - LISTS: already one list. Today's to-do card and the proposals card both read and write D().todos;
       Approvals is the owner's inbox for record changes; reminders are personal alarms on the Life tracker.
       The one confusing label, Today's "+ Add a task" (which creates a JOB), now says so (js/05). */
if (typeof window !== "undefined") {
  /* insert `node` right after the screen heading (a .secthd or a leading h2), else at the top */
  function mgAfterHeading(view, node) {
    var first = view.firstElementChild;
    var head = (first && (first.classList.contains("secthd") || first.tagName === "H2")) ? first : null;
    if (head && head.nextSibling) view.insertBefore(node, head.nextSibling); else if (head) view.appendChild(node); else view.insertBefore(node, view.firstChild);
  }
  /* Plan | Review toggle on both route screens */
  function mgRoute(view, tab) {
    if (view.querySelector("[data-mg-route]")) return;
    var row = document.createElement("div"); row.className = "subnav"; row.setAttribute("data-mg-route", "1"); row.style.margin = "0 4px 12px";
    row.innerHTML = '<button class="subbtn' + (tab === "route" ? " on" : "") + '" onclick="navSub(\'route\')">🚗 Plan a route</button>'
      + '<button class="subbtn' + (tab === "routes" ? " on" : "") + '" onclick="navSub(\'routes\')">🗺️ Review what was driven</button>';
    mgAfterHeading(view, row);
  }
  /* Plan: the Research chip points at the one home */
  function mgPlan(view) {
    var chip = view.querySelector(".subnav button[onclick=\"planSub('research')\"]"); if (!chip || chip.getAttribute("data-mg")) return;
    chip.setAttribute("data-mg", "1"); chip.textContent = "📚 Research ↗"; chip.title = "Research lives under Reference";
    chip.setAttribute("onclick", "navSub('research')");
  }
  /* Research: a quiet way back to the old market-research notes that lived on Plan */
  function mgResearch(view) {
    if (view.querySelector("[data-mg-oldnotes]")) return;
    var hasOld = false; try { hasOld = !!((D().docs || []).find(function (d) { return d && !d.deleted && d.id === "research" && String(d.text || d.body || "").trim(); })); } catch (e) {}
    if (!hasOld || typeof navSub !== "function") return;
    var p = document.createElement("div"); p.className = "sub"; p.setAttribute("data-mg-oldnotes", "1"); p.style.cssText = "margin:0 4px 10px;white-space:normal";
    p.innerHTML = '<a href="#" onclick="event.preventDefault();PLANSUB=\'research\';navSub(\'plan\')" style="color:var(--brand-text);font-weight:600">Older market-research notes</a> (the free-text page that used to live on Plan).';
    mgAfterHeading(view, p);
  }
  /* Invoices: the owed figure links to Finance → A/R, the one home for what is owed */
  function mgInvoices(view) {
    var ct = view.querySelector(".secthd .ct"); if (!ct || ct.getAttribute("data-mg") || !/owed/i.test(ct.textContent || "")) return;
    if (typeof navDeepGo !== "function") return;
    ct.setAttribute("data-mg", "1"); ct.style.cursor = "pointer"; ct.title = "Open A/R";
    ct.innerHTML = '<a href="#" onclick="event.preventDefault();navDeepGo(\'finance\',\'owed\',\'finSub\')" style="color:inherit;text-decoration:underline dotted">' + ct.innerHTML + ' ↗</a>';
  }
  /* My pay | Next check: one screen for pay. Crew see only their own; owner/admin get the toggle. */
  function mgPay(view, tab) {
    if (view.querySelector("[data-mg-pay]")) return;
    var owner = (typeof finCanView === "function") ? finCanView() : false; if (!owner) return;
    var row = document.createElement("div"); row.className = "subnav"; row.setAttribute("data-mg-pay", "1"); row.style.margin = "0 4px 12px";
    row.innerHTML = '<button class="subbtn' + (tab === "pay" ? " on" : "") + '" onclick="navSub(\'pay\')">💵 My pay</button>'
      + '<button class="subbtn' + (tab === "nextcheck" ? " on" : "") + '" onclick="navSub(\'nextcheck\')">🧾 Next check, everyone</button>';
    mgAfterHeading(view, row);
  }
  function merge(tab) {
    try {
      var view = document.getElementById("view"); if (!view) return;
      if (tab === "route" || tab === "routes") mgRoute(view, tab);
      if (tab === "pay" || tab === "nextcheck") mgPay(view, tab);
      if (tab === "plan") mgPlan(view);
      if (tab === "research") mgResearch(view);
      if (tab === "invoices") mgInvoices(view);
    } catch (e) { try { console.warn("merge(" + tab + ") skipped:", e); } catch (_) {} }
  }
  window.merge = merge;
  if (typeof secSplit === "function") {
    var _ss2 = secSplit;
    secSplit = function (tab) { var r = _ss2.apply(this, arguments); merge(tab); return r; };
    window.secSplit = secSplit;
  }
}
