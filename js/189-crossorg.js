/* ---------- PROJECTS ACROSS ORGS (js/189) — Phase 4 of the UX reorg ----------
   Ray, 2026-09-22, UX audit: one project lived in three orgs (the waterfall: a stone job, a Jamieson quote, an
   OBX customer) and seeing the other half meant switching org and hunting. Two things fix the bouncing:

   1. A job can carry `j.quoteRef = {org, quoteId, num}` pointing at a quote in ANOTHER org, and the job page
      shows that quote as a card: number, customer, total, where it stands (quote / deposit / invoiced / paid),
      the written-quote and deposit links, and "Open in <org>" which switches org and opens it. A job with no
      link gets a "Link a quote from another org" picker (quotes in the other orgs you belong to, this job's
      customer first). Nothing is copied between orgs; the link is a pointer, the quote stays where it is billed.
   2. The org switcher remembers the screen you were on in each org (this device) and puts you back there.

   Pure helpers (candidate picking, last-screen resolution) are node-testable: crossorg-tests.js. */
/* quotes in the other orgs that could belong to this job: same customer name first, then the rest, newest first */
function xqCandidates(store, orgIds, curOrg, custName, limit) {
  limit = limit || 40; var want = String(custName || "").trim().toLowerCase(); var out = [];
  (orgIds || []).forEach(function (org) {
    if (org === curOrg) return; var s = store && store[org]; if (!s) return;
    (s.quotes || []).forEach(function (q) {
      if (!q || q.deleted) return;
      var name = String(q.cust || "").trim().toLowerCase();
      out.push({ org: org, id: q.id, num: q.num, cust: q.cust || "", total: +q.total || 0, date: q.date || "", updatedAt: +q.updatedAt || 0, match: !!(want && name && (name === want || name.indexOf(want) >= 0 || want.indexOf(name) >= 0)) });
    });
  });
  out.sort(function (a, b) { return (b.match - a.match) || (b.updatedAt - a.updatedAt); });
  return out.slice(0, limit);
}
/* where a quote stands, from its flags */
function xqState(q) {
  if (!q) return "";
  if (q.paid) return "paid";
  if (q.invoiced) return "invoiced";
  if (q.depositPaid || q.depositPaidAt) return "deposit paid";
  if (q.depositLink) return "deposit link out";
  if (q.accepted) return "accepted";
  return "quote";
}
/* which screen to land on when switching to `org`: the saved one if it is still valid, else Today. Pure. */
function orgLastResolve(saved, valid) {
  var tab = saved && saved.tab; if (tab && (typeof valid !== "function" || valid(tab))) return { tab: tab, job: saved.job || null };
  return { tab: "today", job: null };
}
if (typeof window !== "undefined") {
  var xqE = function (s) { return (typeof esc === "function") ? esc(String(s == null ? "" : s)) : String(s == null ? "" : s); };
  var xqOrgName = function (o) { return (typeof orgName === "function") ? orgName(o) : o; };
  var xqOrgIds = function () { try { return (typeof myOrgs === "function") ? myOrgs().map(function (x) { return x.id; }) : Object.keys(S).filter(function (k) { return S[k] && S[k].quotes; }); } catch (e) { return []; } };
  var xqMoney = function (n) { return "$" + (Math.round((+n || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); };
  window.jobLinkedQuoteHTML = function (j) {
    if (!j) return "";
    var ref = j.quoteRef; var others = xqOrgIds().filter(function (o) { return o !== S.biz; });
    if (!ref || !ref.org || ref.org === S.biz) {
      if (!others.length) return "";
      return '<div class="card"><div style="font-weight:800;margin-bottom:4px">🔗 Linked quote</div><div class="sub" style="white-space:normal;margin-bottom:8px">Billed from another organization? Link the quote here so this page shows it.</div><button class="btn ghost sm" onclick="xqPickOpen(\'' + xqE(j.id) + '\')">Link a quote from another org</button></div>';
    }
    var slab = S[ref.org] || {}; var q = (slab.quotes || []).find(function (x) { return x && x.id === ref.quoteId; });
    var h = '<div class="card" style="border-left:4px solid var(--brand,#1B2A4E)"><div style="font-weight:800;margin-bottom:4px">🔗 Quote in ' + xqE(xqOrgName(ref.org)) + '</div>';
    if (!q) return h + '<div class="sub" style="white-space:normal">Quote #' + xqE(ref.num || "?") + ' is not in this device\'s copy of ' + xqE(xqOrgName(ref.org)) + ' (not synced yet, or archived).</div><button class="btn ghost sm" style="margin-top:8px" onclick="xqUnlink(\'' + xqE(j.id) + '\')">Unlink</button></div>';
    var st = xqState(q);
    h += '<div class="nm" style="font-size:15px">#' + xqE(q.num) + ' · ' + xqE(q.cust || "") + ' · <b>' + xqMoney(q.total) + '</b> <span class="badge" style="background:var(--soft);color:var(--muted)">' + xqE(st) + '</span></div>';
    var first = (q.items && q.items[0] && q.items[0].name) || ""; if (first) h += '<div class="sub" style="white-space:normal">' + xqE(first.slice(0, 120)) + (q.items.length > 1 ? " · +" + (q.items.length - 1) + " more" : "") + '</div>';
    var links = [];
    if (q.invoiceToken) links.push('<a href="/i/' + xqE(q.invoiceToken) + '" target="_blank" rel="noopener" style="color:var(--brand-text);font-weight:700">Written quote</a>');
    if (q.depositLink && !q.paid) links.push('<a href="' + xqE(q.depositLink) + '" target="_blank" rel="noopener" style="color:var(--brand-text);font-weight:700">Deposit ' + (q.depositAmount ? xqMoney(q.depositAmount) : "") + '</a>');
    if (links.length) h += '<div class="sub" style="margin-top:6px">' + links.join(" · ") + '</div>';
    h += '<div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn acc sm" onclick="xqOpen(\'' + xqE(ref.org) + '\',\'' + xqE(q.id) + '\')">Open in ' + xqE(xqOrgName(ref.org)) + '</button><button class="btn ghost sm" onclick="xqUnlink(\'' + xqE(j.id) + '\')">Unlink</button></div></div>';
    return h;
  };
  window.xqOpen = function (org, quoteId) {
    if (org !== S.biz && typeof setBiz === "function") setBiz(org);
    var q = ((S[S.biz] || {}).quotes || []).find(function (x) { return x && x.id === quoteId; });
    if (q && q.invoiced && typeof openInvoice === "function") return openInvoice(quoteId);
    if (typeof openQuote === "function") openQuote(quoteId);
  };
  window.xqPickOpen = function (jobId) {
    var j = (D().jobs || []).find(function (x) { return x && x.id === jobId; }); if (!j || typeof modal !== "function") return;
    var custName = j.cust || (function () { var c = (D().customers || []).find(function (x) { return x && x.id === j.customerId; }); return c ? c.name : ""; })();
    var rows = xqCandidates(S, xqOrgIds(), S.biz, custName);
    var h = '<div class="sub" style="white-space:normal;margin-bottom:8px">Quotes in your other organizations' + (custName ? ', <b>' + xqE(custName) + '</b> first' : "") + '.</div>';
    if (!rows.length) h += '<div class="sub">No quotes in your other organizations yet.</div>';
    h += rows.map(function (r) { return '<button class="rsrow" onclick="xqLink(\'' + xqE(jobId) + '\',\'' + xqE(r.org) + '\',\'' + xqE(r.id) + '\',' + (+r.num || 0) + ')"><div class="grow"><div class="nm">#' + xqE(r.num) + ' · ' + xqE(r.cust || "(no name)") + ' · ' + xqMoney(r.total) + (r.match ? ' <span class="badge" style="background:#e9f1dc;color:#2f4a12">same customer</span>' : "") + '</div><div class="sub">' + xqE(xqOrgName(r.org)) + (r.date ? " · " + xqE(r.date) : "") + '</div></div><span class="rsgo">›</span></button>'; }).join("");
    modal("Link a quote", h);
  };
  window.xqLink = function (jobId, org, quoteId, num) {
    var j = (D().jobs || []).find(function (x) { return x && x.id === jobId; }); if (!j) return;
    j.quoteRef = { org: org, quoteId: quoteId, num: num || undefined };
    if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof closeModal === "function") closeModal(); if (typeof render === "function") render();
  };
  window.xqUnlink = function (jobId) {
    var j = (D().jobs || []).find(function (x) { return x && x.id === jobId; }); if (!j) return;
    delete j.quoteRef; if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
  };
  /* ---- the org switcher remembers where you were in each org (this device) ---- */
  var ORG_LAST = {}; try { ORG_LAST = JSON.parse(localStorage.getItem("jra_org_last") || "{}") || {}; } catch (e) {}
  function orgLastSave() { try { localStorage.setItem("jra_org_last", JSON.stringify(ORG_LAST)); } catch (e) {} }
  if (typeof setBiz === "function") {
    var _sb = setBiz;
    setBiz = function (b) {
      try {
        if (S && S.biz && S.biz !== b) ORG_LAST[S.biz] = { tab: (typeof TAB !== "undefined") ? TAB : "today", job: window.JOB_OPEN || null };
        S.biz = b;                                                   // so the validity check sees the NEW org
        var to = orgLastResolve(ORG_LAST[b], function (t) { return (typeof validTab === "function") ? validTab(t) : true; });
        if (typeof TAB !== "undefined") TAB = to.tab;
        var jobOk = to.job && ((S[b] || {}).jobs || []).some(function (x) { return x && !x.deleted && x.id === to.job; });
        window.JOB_OPEN = jobOk ? to.job : null;
        orgLastSave();
      } catch (e) {}
      return _sb.apply(this, arguments);
    };
    window.setBiz = setBiz;
  }
  window.xqCandidates = xqCandidates; window.xqState = xqState; window.orgLastResolve = orgLastResolve;
}
if (typeof module !== "undefined" && module.exports) { module.exports = { xqCandidates: xqCandidates, xqState: xqState, orgLastResolve: orgLastResolve }; }
