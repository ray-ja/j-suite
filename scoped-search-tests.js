/* SCOPED-SEARCH RE-RENDER — behavior-identity + focus/caret proof for the per-keystroke search inputs.
 *
 * Run headless in the real app:  node verify-app.js "$(cat scoped-search-tests.js)"
 *
 * What it proves:
 *  1. BYTE-IDENTITY: rQuotes()/rCustomers()/rProperties() produce a #view that equals the PRE-CHANGE golden
 *     (captured before the refactor) transformed by EXACTLY the two intended changes — (a) the search input
 *     gained an inline oninput="…SearchOn(this.value)" attribute, and (b) the results list is now wrapped in a
 *     stable <div id="qlist|clist|plist">. Any OTHER drift (a row, an empty-state string, ordering) fails.
 *  2. SCOPED == FULL: the pure *ListHTML() output exactly equals the substring the full render puts inside the
 *     wrapper container — so the keystroke path (which rebuilds only that container) can never diverge.
 *  3. FOCUS + CARET: typing into #qsearch and firing its real oninput leaves document.activeElement === the same
 *     input with the caret preserved, WITHOUT any setSelectionRange() refocus hack (the input is never destroyed).
 *
 * Fixtures: empty / one / many / with-search-set / no-match, per screen.  */

window.alert = function () {}; window.confirm = function () { return true; };

// ---- sign in an owner so the crew <select> etc. render identically to the golden capture ----
var ssU = { id: "u_g", username: "G", active: true };
S.users = S.users || []; if (!S.users.some(function (u) { return u && u.id === "u_g"; })) S.users.push(ssU);
if (typeof orgSetRole === "function") orgSetRole("u_g", "obx", "owner");
localStorage.setItem("jra_session", "u_g"); localStorage.setItem("jra_offline_ok", "1"); S.biz = "obx";

var view = document.getElementById("view");
var fails = [];
function eq(name, got, want) {
  if (got === want) return;
  var i = 0; while (i < Math.max(got.length, want.length) && got[i] === want[i]) i++;
  fails.push(name + ": mismatch @" + i + "\n  WANT " + JSON.stringify(want.slice(Math.max(0, i - 15), i + 55)) + "\n  GOT  " + JSON.stringify(got.slice(Math.max(0, i - 15), i + 55)));
}
function setData(cs, ps, qs) { var d = D(); d.customers = cs; d.properties = ps; d.quotes = qs; d.jobs = d.jobs || []; }

// ---- fixtures (identical to the golden capture) ----
var C1 = [{ id: "c1", name: "Alpha Cust", phone: "2525551212", updatedAt: 1 }];
var Cmany = [{ id: "c1", name: "Alpha", phone: "2525551212", updatedAt: 1 }, { id: "c2", name: "Beta", company: "BetaCo", updatedAt: 1 }, { id: "c3", name: "Gamma", email: "g@x.com", updatedAt: 1 }];
var P1 = [{ id: "p1", label: "Prop One", address: "1 Main St", updatedAt: 1 }];
var Pmany = [{ id: "p1", label: "Prop One", address: "1 Main St", updatedAt: 1 }, { id: "p2", label: "Prop Two", address: "2 Oak Ave", updatedAt: 1 }];
var Q1 = [{ id: "q1", cust: "Alpha", customerId: "c1", date: "2026-06-01", total: 100, items: [{ name: "Junk" }], updatedAt: 1 }];
var Qmany = [{ id: "q1", cust: "Alpha", customerId: "c1", date: "2026-06-01", total: 100, items: [{ name: "Junk" }], updatedAt: 1 }, { id: "q2", cust: "Beta", customerId: "c2", date: "2026-06-05", total: 200, accepted: true, jobId: "j2", items: [{ name: "Paver" }], updatedAt: 1 }, { id: "q3", cust: "Gamma", customerId: "c3", date: "2026-05-20", total: 50, paid: true, items: [{ name: "Cleanup" }], updatedAt: 1 }];

// ---- PRE-CHANGE GOLDEN: the exact #view innerHTML each render produced BEFORE the scoped-search refactor ----
var GOLDEN = {"q_empty":"<h2>Jobs</h2><button class=\"btn acc\" style=\"margin-bottom:10px\" onclick=\"startWizard()\">✨ Guided Quote (step-by-step)</button><div class=\"empty\"><div class=\"big\">🧾</div>No jobs yet.<br>Use Guided Quote above, or tap + for the quick builder.</div>","q_one":"<h2>Jobs</h2><button class=\"btn acc\" style=\"margin-bottom:10px\" onclick=\"startWizard()\">✨ Guided Quote (step-by-step)</button><input class=\"search\" id=\"qsearch\" placeholder=\"Search jobs (customer, type, date)…\" value=\"\"><div class=\"subnav\" style=\"margin:8px 0\"><button class=\"subbtn on\" onclick=\"quoteFilter('all')\">All</button><button class=\"subbtn \" onclick=\"quoteFilter('quote')\">Quote</button><button class=\"subbtn \" onclick=\"quoteFilter('job')\">Job</button><button class=\"subbtn \" onclick=\"quoteFilter('expense')\">Expense</button><button class=\"subbtn \" onclick=\"quoteFilter('invoice')\">Invoice</button><button class=\"subbtn \" onclick=\"quoteFilter('paid')\">Paid</button></div><select onchange=\"quoteCrewFilter(this.value)\" style=\"font-size:13px;margin-bottom:10px\"><option value=\"\" selected=\"\">👥 All crew</option><option value=\"u_g\">G</option></select><div class=\"card grid2\"><div class=\"li\" onclick=\"openQuote('q1')\" style=\"border-left:4px solid #97a0ad;padding-left:10px\">\n      <div class=\"grow\"><div class=\"nm\" style=\"white-space:normal\">Alpha <span style=\"font-weight:600;color:var(--muted)\">· Junk</span></div>\n      <div class=\"sub\">06/01/26 · <span style=\"color:#97a0ad;font-weight:700\">Quote</span></div></div>\n      <div style=\"font-weight:800;color:var(--brand-text);text-align:right\">$100</div></div></div>","q_many":"<h2>Jobs</h2><button class=\"btn acc\" style=\"margin-bottom:10px\" onclick=\"startWizard()\">✨ Guided Quote (step-by-step)</button><input class=\"search\" id=\"qsearch\" placeholder=\"Search jobs (customer, type, date)…\" value=\"\"><div class=\"subnav\" style=\"margin:8px 0\"><button class=\"subbtn on\" onclick=\"quoteFilter('all')\">All</button><button class=\"subbtn \" onclick=\"quoteFilter('quote')\">Quote</button><button class=\"subbtn \" onclick=\"quoteFilter('job')\">Job</button><button class=\"subbtn \" onclick=\"quoteFilter('expense')\">Expense</button><button class=\"subbtn \" onclick=\"quoteFilter('invoice')\">Invoice</button><button class=\"subbtn \" onclick=\"quoteFilter('paid')\">Paid</button></div><select onchange=\"quoteCrewFilter(this.value)\" style=\"font-size:13px;margin-bottom:10px\"><option value=\"\" selected=\"\">👥 All crew</option><option value=\"u_g\">G</option></select><div class=\"card grid2\"><div class=\"li\" onclick=\"openQuote('q2')\" style=\"border-left:4px solid #2f6fed;padding-left:10px\">\n      <div class=\"grow\"><div class=\"nm\" style=\"white-space:normal\">Beta <span style=\"font-weight:600;color:var(--muted)\">· Paver</span></div>\n      <div class=\"sub\">06/05/26 · <span style=\"color:#2f6fed;font-weight:700\">Job</span></div></div>\n      <div style=\"font-weight:800;color:var(--brand-text);text-align:right\">$200</div></div><div class=\"li\" onclick=\"openQuote('q1')\" style=\"border-left:4px solid #97a0ad;padding-left:10px\">\n      <div class=\"grow\"><div class=\"nm\" style=\"white-space:normal\">Alpha <span style=\"font-weight:600;color:var(--muted)\">· Junk</span></div>\n      <div class=\"sub\">06/01/26 · <span style=\"color:#97a0ad;font-weight:700\">Quote</span></div></div>\n      <div style=\"font-weight:800;color:var(--brand-text);text-align:right\">$100</div></div><div class=\"li\" onclick=\"openQuote('q3')\" style=\"border-left:4px solid #1a7f37;padding-left:10px\">\n      <div class=\"grow\"><div class=\"nm\" style=\"white-space:normal\">Gamma <span style=\"font-weight:600;color:var(--muted)\">· Cleanup</span></div>\n      <div class=\"sub\">05/20/26 · <span style=\"color:#1a7f37;font-weight:700\">Paid</span></div></div>\n      <div style=\"font-weight:800;color:#1a7f37;text-align:right\">$50</div></div></div>","q_search":"<h2>Jobs</h2><button class=\"btn acc\" style=\"margin-bottom:10px\" onclick=\"startWizard()\">✨ Guided Quote (step-by-step)</button><input class=\"search\" id=\"qsearch\" placeholder=\"Search jobs (customer, type, date)…\" value=\"alpha\"><div class=\"subnav\" style=\"margin:8px 0\"><button class=\"subbtn on\" onclick=\"quoteFilter('all')\">All</button><button class=\"subbtn \" onclick=\"quoteFilter('quote')\">Quote</button><button class=\"subbtn \" onclick=\"quoteFilter('job')\">Job</button><button class=\"subbtn \" onclick=\"quoteFilter('expense')\">Expense</button><button class=\"subbtn \" onclick=\"quoteFilter('invoice')\">Invoice</button><button class=\"subbtn \" onclick=\"quoteFilter('paid')\">Paid</button></div><select onchange=\"quoteCrewFilter(this.value)\" style=\"font-size:13px;margin-bottom:10px\"><option value=\"\" selected=\"\">👥 All crew</option><option value=\"u_g\">G</option></select><div class=\"card grid2\"><div class=\"li\" onclick=\"openQuote('q1')\" style=\"border-left:4px solid #97a0ad;padding-left:10px\">\n      <div class=\"grow\"><div class=\"nm\" style=\"white-space:normal\">Alpha <span style=\"font-weight:600;color:var(--muted)\">· Junk</span></div>\n      <div class=\"sub\">06/01/26 · <span style=\"color:#97a0ad;font-weight:700\">Quote</span></div></div>\n      <div style=\"font-weight:800;color:var(--brand-text);text-align:right\">$100</div></div></div>","q_nomatch":"<h2>Jobs</h2><button class=\"btn acc\" style=\"margin-bottom:10px\" onclick=\"startWizard()\">✨ Guided Quote (step-by-step)</button><input class=\"search\" id=\"qsearch\" placeholder=\"Search jobs (customer, type, date)…\" value=\"zzznomatch\"><div class=\"subnav\" style=\"margin:8px 0\"><button class=\"subbtn on\" onclick=\"quoteFilter('all')\">All</button><button class=\"subbtn \" onclick=\"quoteFilter('quote')\">Quote</button><button class=\"subbtn \" onclick=\"quoteFilter('job')\">Job</button><button class=\"subbtn \" onclick=\"quoteFilter('expense')\">Expense</button><button class=\"subbtn \" onclick=\"quoteFilter('invoice')\">Invoice</button><button class=\"subbtn \" onclick=\"quoteFilter('paid')\">Paid</button></div><select onchange=\"quoteCrewFilter(this.value)\" style=\"font-size:13px;margin-bottom:10px\"><option value=\"\" selected=\"\">👥 All crew</option><option value=\"u_g\">G</option></select><div class=\"empty\">No matches.</div>","c_empty":"<input class=\"search\" id=\"csearch\" placeholder=\"Search customers…\" value=\"\"><select aria-label=\"Sort customers\" onchange=\"cSetSort(this.value)\" style=\"font-size:13px;margin-bottom:10px\"><option value=\"name\" selected=\"\">Name A–Z</option><option value=\"namez\">Name Z–A</option><option value=\"recent\">Recently added</option></select><div class=\"empty\"><div class=\"big\">👥</div>No customers yet.<br>Tap + to add your first one.</div>","c_one":"<input class=\"search\" id=\"csearch\" placeholder=\"Search customers…\" value=\"\"><select aria-label=\"Sort customers\" onchange=\"cSetSort(this.value)\" style=\"font-size:13px;margin-bottom:10px\"><option value=\"name\" selected=\"\">Name A–Z</option><option value=\"namez\">Name Z–A</option><option value=\"recent\">Recently added</option></select><div class=\"card grid2\"><div class=\"li\" onclick=\"openCustomer('c1')\">\n    <div class=\"grow\"><div class=\"nm\">Alpha Cust</div>\n    <div class=\"sub\" style=\"white-space:normal\"><a href=\"tel:2525551212\" onclick=\"event.stopPropagation()\" style=\"color:var(--brand-text);text-decoration:underline\">📞 (252) 555-1212</a></div><div class=\"sub\" style=\"white-space:normal\">🏠 0 properties</div></div>\n    <span class=\"badge s-Lead\">Lead</span></div></div>","c_many":"<input class=\"search\" id=\"csearch\" placeholder=\"Search customers…\" value=\"\"><select aria-label=\"Sort customers\" onchange=\"cSetSort(this.value)\" style=\"font-size:13px;margin-bottom:10px\"><option value=\"name\" selected=\"\">Name A–Z</option><option value=\"namez\">Name Z–A</option><option value=\"recent\">Recently added</option></select><div class=\"card grid2\"><div class=\"li\" onclick=\"openCustomer('c1')\">\n    <div class=\"grow\"><div class=\"nm\">Alpha</div>\n    <div class=\"sub\" style=\"white-space:normal\"><a href=\"tel:2525551212\" onclick=\"event.stopPropagation()\" style=\"color:var(--brand-text);text-decoration:underline\">📞 (252) 555-1212</a></div><div class=\"sub\" style=\"white-space:normal\">🏠 0 properties</div></div>\n    <span class=\"badge s-Lead\">Lead</span></div><div class=\"li\" onclick=\"openCustomer('c2')\">\n    <div class=\"grow\"><div class=\"nm\">Beta</div>\n    <div class=\"sub\" style=\"white-space:normal\">BetaCo</div><div class=\"sub\" style=\"white-space:normal\">🏠 0 properties</div></div>\n    <span class=\"badge s-Lead\">Lead</span></div><div class=\"li\" onclick=\"openCustomer('c3')\">\n    <div class=\"grow\"><div class=\"nm\">Gamma</div>\n    <div class=\"sub\" style=\"white-space:normal\"><a href=\"mailto:g@x.com\" onclick=\"event.stopPropagation()\" style=\"color:var(--brand-text);text-decoration:underline\">✉️ g@x.com</a></div><div class=\"sub\" style=\"white-space:normal\">🏠 0 properties</div></div>\n    <span class=\"badge s-Lead\">Lead</span></div></div>","c_search":"<input class=\"search\" id=\"csearch\" placeholder=\"Search customers…\" value=\"alpha\"><select aria-label=\"Sort customers\" onchange=\"cSetSort(this.value)\" style=\"font-size:13px;margin-bottom:10px\"><option value=\"name\" selected=\"\">Name A–Z</option><option value=\"namez\">Name Z–A</option><option value=\"recent\">Recently added</option></select><div class=\"card grid2\"><div class=\"li\" onclick=\"openCustomer('c1')\">\n    <div class=\"grow\"><div class=\"nm\">Alpha</div>\n    <div class=\"sub\" style=\"white-space:normal\"><a href=\"tel:2525551212\" onclick=\"event.stopPropagation()\" style=\"color:var(--brand-text);text-decoration:underline\">📞 (252) 555-1212</a></div><div class=\"sub\" style=\"white-space:normal\">🏠 0 properties</div></div>\n    <span class=\"badge s-Lead\">Lead</span></div></div>","c_nomatch":"<input class=\"search\" id=\"csearch\" placeholder=\"Search customers…\" value=\"zzz\"><select aria-label=\"Sort customers\" onchange=\"cSetSort(this.value)\" style=\"font-size:13px;margin-bottom:10px\"><option value=\"name\" selected=\"\">Name A–Z</option><option value=\"namez\">Name Z–A</option><option value=\"recent\">Recently added</option></select><div class=\"empty\">No matches.</div>","p_empty":"<input class=\"search\" id=\"psearch\" placeholder=\"Search properties…\" value=\"\"><div class=\"empty\"><div class=\"big\">📍</div>No properties yet.<br>Add one, or they're created when you quote.</div>","p_one":"<input class=\"search\" id=\"psearch\" placeholder=\"Search properties…\" value=\"\"><div class=\"card grid2\"><div class=\"li\" onclick=\"openProperty('p1')\"><div class=\"grow\"><div class=\"nm\">Prop One</div><div class=\"sub\" style=\"white-space:normal\"><a href=\"https://maps.google.com/?q=1%20Main%20St\" target=\"_blank\" rel=\"noopener\" onclick=\"event.stopPropagation()\" style=\"color:var(--brand-text);text-decoration:underline\">1 Main St</a></div></div></div></div>","p_many":"<input class=\"search\" id=\"psearch\" placeholder=\"Search properties…\" value=\"\"><div class=\"card grid2\"><div class=\"li\" onclick=\"openProperty('p1')\"><div class=\"grow\"><div class=\"nm\">Prop One</div><div class=\"sub\" style=\"white-space:normal\"><a href=\"https://maps.google.com/?q=1%20Main%20St\" target=\"_blank\" rel=\"noopener\" onclick=\"event.stopPropagation()\" style=\"color:var(--brand-text);text-decoration:underline\">1 Main St</a></div></div></div><div class=\"li\" onclick=\"openProperty('p2')\"><div class=\"grow\"><div class=\"nm\">Prop Two</div><div class=\"sub\" style=\"white-space:normal\"><a href=\"https://maps.google.com/?q=2%20Oak%20Ave\" target=\"_blank\" rel=\"noopener\" onclick=\"event.stopPropagation()\" style=\"color:var(--brand-text);text-decoration:underline\">2 Oak Ave</a></div></div></div></div>","p_search":"<input class=\"search\" id=\"psearch\" placeholder=\"Search properties…\" value=\"oak\"><div class=\"card grid2\"><div class=\"li\" onclick=\"openProperty('p2')\"><div class=\"grow\"><div class=\"nm\">Prop Two</div><div class=\"sub\" style=\"white-space:normal\"><a href=\"https://maps.google.com/?q=2%20Oak%20Ave\" target=\"_blank\" rel=\"noopener\" onclick=\"event.stopPropagation()\" style=\"color:var(--brand-text);text-decoration:underline\">2 Oak Ave</a></div></div></div></div>","p_nomatch":"<input class=\"search\" id=\"psearch\" placeholder=\"Search properties…\" value=\"zzz\"><div class=\"empty\">No matches.</div>"};

// derive the EXPECTED post-change #view from the golden by applying ONLY the two intended transforms
var WRAP = { q: "qlist", c: "clist", p: "plist" }, SID = { q: "qsearch", c: "csearch", p: "psearch" }, HN = { q: "qSearchOn", c: "cSearchOn", p: "pSearchOn" };
function expected(key) {
  var v = GOLDEN[key], p = key[0], sid = SID[p], id = WRAP[p], hn = HN[p];
  var inTag = '<input class="search" id="' + sid + '" placeholder="';
  var ii = v.indexOf(inTag);
  if (ii >= 0) { var close = v.indexOf(">", ii); v = v.slice(0, close) + ' oninput="' + hn + '(this.value)"' + v.slice(close); }
  var from = 0; var ic = v.indexOf(inTag); if (ic >= 0) from = v.indexOf(">", ic) + 1;
  var mE = v.indexOf('<div class="empty">', from), mC = v.indexOf('<div class="card grid2">', from);
  var cands = [mE, mC].filter(function (x) { return x >= 0; });
  var ls = cands.length ? Math.min.apply(null, cands) : -1;
  if (ls < 0) return v;
  return v.slice(0, ls) + '<div id="' + id + '">' + v.slice(ls) + '</div>';
}
// pull the inner HTML of the wrapper container out of a rendered #view
function innerOf(v, id) {
  var open = '<div id="' + id + '">', ix = v.indexOf(open); if (ix < 0) return null;
  var inner = v.slice(ix + open.length); return inner.slice(0, inner.length - 6); // strip trailing </div>
}

// ================= QUOTES =================
QSEARCH = ""; QSTAGE_FILTER = "all"; QCREW_FILTER = "";
[["q_empty", [], [], []], ["q_one", C1, [], Q1], ["q_many", Cmany, [], Qmany]].forEach(function (f) {
  setData(f[1], f[2], f[3]); rQuotes();
  eq(f[0] + " #view", view.innerHTML, expected(f[0]));
  eq(f[0] + " scoped==inner", quotesListHTML(), innerOf(view.innerHTML, "qlist"));
});
QSEARCH = "alpha"; setData(Cmany, [], Qmany); rQuotes();
eq("q_search #view", view.innerHTML, expected("q_search"));
eq("q_search scoped==inner", quotesListHTML(), innerOf(view.innerHTML, "qlist"));
QSEARCH = "zzznomatch"; setData(Cmany, [], Qmany); rQuotes();
eq("q_nomatch #view", view.innerHTML, expected("q_nomatch"));
eq("q_nomatch scoped==inner", quotesListHTML(), innerOf(view.innerHTML, "qlist"));
QSEARCH = "";

// ================= CUSTOMERS =================
// accounts now lives in the "People & Places" nav group: its subnav renders into #subnav (the merged ppSubnav
// row), so the in-view acctSubnav() is suppressed when TAB is inside that group. Render as the app does.
TAB = "accounts";
CSEARCH = ""; ACCTSUB = "customers"; CSORT = "name";
[["c_empty", [], [], []], ["c_one", C1, [], []], ["c_many", Cmany, [], []]].forEach(function (f) {
  setData(f[1], f[2], f[3]); rCustomers();
  eq(f[0] + " #view", view.innerHTML, expected(f[0]));
  eq(f[0] + " scoped==inner", customersListHTML(), innerOf(view.innerHTML, "clist"));
});
CSEARCH = "alpha"; setData(Cmany, [], []); rCustomers();
eq("c_search #view", view.innerHTML, expected("c_search"));
eq("c_search scoped==inner", customersListHTML(), innerOf(view.innerHTML, "clist"));
CSEARCH = "zzz"; setData(Cmany, [], []); rCustomers();
eq("c_nomatch #view", view.innerHTML, expected("c_nomatch"));
CSEARCH = "";

// ================= PROPERTIES =================
PSEARCH = "";
[["p_empty", [], [], []], ["p_one", [], P1, []], ["p_many", [], Pmany, []]].forEach(function (f) {
  setData(f[1], f[2], f[3]); rProperties();
  eq(f[0] + " #view", view.innerHTML, expected(f[0]));
  eq(f[0] + " scoped==inner", propertiesListHTML(), innerOf(view.innerHTML, "plist"));
});
PSEARCH = "oak"; setData([], Pmany, []); rProperties();
eq("p_search #view", view.innerHTML, expected("p_search"));
eq("p_search scoped==inner", propertiesListHTML(), innerOf(view.innerHTML, "plist"));
PSEARCH = "zzz"; setData([], Pmany, []); rProperties();
eq("p_nomatch #view", view.innerHTML, expected("p_nomatch"));
PSEARCH = "";

// ================= FOCUS + CARET (no setSelectionRange) =================
QSEARCH = ""; QSTAGE_FILTER = "all"; QCREW_FILTER = "";
setData(Cmany, [], Qmany); rQuotes();
var qs = document.getElementById("qsearch");
if (!qs) fails.push("focus: #qsearch missing");
else {
  qs.focus();
  qs.value = "alph";           // simulate typing 4 chars
  qs.setSelectionRange(4, 4);  // caret at end (as the browser would after typing)
  qs.dispatchEvent(new Event("input", { bubbles: true }));  // fires the inline oninput → qSearchOn
  var af = document.activeElement;
  if (!af || af.id !== "qsearch") fails.push("focus: activeElement is '" + (af && af.id) + "', expected 'qsearch' (input was destroyed)");
  var same = document.getElementById("qsearch") === qs;
  if (!same) fails.push("focus: #qsearch node was replaced (not scoped)");
  if (qs.selectionStart !== 4 || qs.selectionEnd !== 4) fails.push("caret: expected 4/4, got " + qs.selectionStart + "/" + qs.selectionEnd);
  // and the scoped update actually filtered the list
  var inner = innerOf(view.innerHTML, "qlist");
  if (inner.indexOf("Alpha") < 0 || inner.indexOf("Beta") >= 0) fails.push("scoped filter: expected only Alpha after typing 'alph', got: " + inner.slice(0, 80));
}
// caret preserved MID-string (proves it survives, not just because it was at the end)
QSEARCH = ""; setData(Cmany, [], Qmany); rQuotes();
var qs2 = document.getElementById("qsearch");
qs2.focus(); qs2.value = "aXlpha"; qs2.setSelectionRange(2, 2);
qs2.dispatchEvent(new Event("input", { bubbles: true }));
if (document.activeElement !== qs2) fails.push("caret-mid: focus lost");
if (qs2.selectionStart !== 2) fails.push("caret-mid: caret moved to " + qs2.selectionStart + " (expected 2)");
QSEARCH = "";

if (fails.length) { __errs.push("scoped-search: " + fails.length + " failure(s):\n  - " + fails.join("\n  - ")); }
else { diag("scoped-search: ALL PASS (" + "byte-identity + scoped==inner + focus/caret, no setSelectionRange)"); }
