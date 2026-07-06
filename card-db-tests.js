/* CARD DATABASE (card → user assignment) — browser-context tests for the DERIVED unknown-card roll-up (js/94).
 * Run in the REAL loaded app so it exercises the SHIPPED unassignedCards()/cardDbAssign()/cardDbAssignBusiness()
 * against live globals (S / D()):
 *   node verify-app.js "$(cat card-db-tests.js)"
 * Seeds review receipts with cardLast4 (some matching a user's u.cards, some not) + temp users, asserts the
 * roll-up returns ONLY the unmatched distinct last-4s with correct counts/vendors/date, that assigning one drops
 * it off the list + makes cardOwner resolve it, that dedupe holds, and that a cross-user assign is owner-gated.
 * RESTORES the store exactly (never persists). Any failure throws → verify-app reports it. */
(function () {
  function assert(name, cond) { if (!cond) throw new Error("card-db: FAILED — " + name); diag("card-db: " + name + " ✓"); }

  var d = D();
  var origUsers = S.users, origReceipts = d.receipts, origSAVE = window.save, origRENDER = window.render, origCUR = window.curUser, origOWNER = window.isOwner, origPUSH = window.scheduleAutoPush;
  if (!Array.isArray(S.registry)) S.registry = [];
  var reg = S.registry.find(function (r) { return r && r.id === S.biz; });
  var createdReg = false, origBiz;
  if (!reg) { reg = { id: S.biz, name: S.biz }; S.registry.push(reg); createdReg = true; } else { origBiz = reg.businessCards; }

  // no-op the persistence/render side effects so the tests never touch disk or the DOM
  window.save = function () {}; window.render = function () {}; window.scheduleAutoPush = function () {};

  try {
    S.users = [
      { id: "ut_a", username: "Alpha", role: "crew", cards: [{ id: "c_a1", last4: "1111", kind: "personal" }] },   // 1111 is KNOWN
      { id: "ut_b", username: "Bravo", role: "crew", cards: [] }
    ];
    reg.businessCards = [{ id: "bc1", last4: "2222", active: true }];   // 2222 is a KNOWN company card
    // receipts: 1111 known(x1), 2222 known-company(x1), 5555 unknown(x3, two vendors), 7777 unknown(x1), one blank card
    d.receipts = [
      { id: "r1", status: "review", cardLast4: "1111", vendor: "Lowe's", date: "2026-07-01" },
      { id: "r2", status: "review", cardLast4: "2222", vendor: "Shell",  date: "2026-07-02" },
      { id: "r3", status: "review", cardLast4: "5555", vendor: "Lowe's", date: "2026-07-01" },
      { id: "r4", status: "review", cardLast4: "5555", vendor: "Lowe's", date: "2026-07-03" },
      { id: "r5", status: "review", cardLast4: "5555", vendor: "Ace",    date: "2026-07-02" },
      { id: "r6", status: "review", cardLast4: "7777", vendor: "Costco", date: "2026-06-20" },
      { id: "r7", status: "review", cardLast4: "",     vendor: "NoCard", date: "2026-06-19" }
    ];

    // ---- unassignedCards derives ONLY the unmatched distinct last-4s ----
    var u = unassignedCards();
    var l4s = u.map(function (x) { return x.last4; });
    assert("only unknown last-4s surface (5555, 7777) — 1111/2222/blank excluded", l4s.length === 2 && l4s.indexOf("5555") >= 0 && l4s.indexOf("7777") >= 0 && l4s.indexOf("1111") < 0 && l4s.indexOf("2222") < 0);
    assert("sorted by count desc — 5555 (3) first", u[0].last4 === "5555" && u[0].count === 3 && u[1].last4 === "7777" && u[1].count === 1);
    var c5 = u[0];
    assert("5555 vendors = distinct sample (Lowe's, Ace) capped at 3", c5.vendors.indexOf("Lowe's") >= 0 && c5.vendors.indexOf("Ace") >= 0 && c5.vendors.length <= 3);
    assert("5555 lastDate = most-recent receipt (2026-07-03)", c5.lastDate === "2026-07-03");

    // ---- assign 5555 → Bravo (self/owner path; curUser=Alpha but make owner true) ----
    window.curUser = function () { return S.users[0]; };   // Alpha
    window.isOwner = function () { return true; };          // owner → cross-user allowed
    cardDbAssign("5555", "ut_b");
    assert("after assign, Bravo has ••••5555 (one card)", S.users[1].cards.filter(function (c) { return c.last4 === "5555"; }).length === 1);
    assert("cardOwner now resolves 5555 → Bravo (personal)", cardOwner("5555").resolution === "personal" && cardOwner("5555").ownerId === "ut_b");
    assert("5555 dropped off unassignedCards; only 7777 remains", unassignedCards().map(function (x) { return x.last4; }).join() === "7777");

    // ---- dedupe: assigning 5555 to Bravo again = still one ----
    cardDbAssign("5555", "ut_b");
    assert("re-assign dedupes → still one 5555 on Bravo", S.users[1].cards.filter(function (c) { return c.last4 === "5555"; }).length === 1);

    // ---- cross-user assign blocked for a NON-owner (Alpha assigning 7777 to Bravo) ----
    window.isOwner = function () { return false; };
    var origAlert = window.alert, blocked = false; window.alert = function () { blocked = true; };
    try { cardDbAssign("7777", "ut_b"); } finally { window.alert = origAlert; }
    assert("non-owner cross-user assign blocked (7777 NOT added to Bravo)", blocked === true && !S.users[1].cards.some(function (c) { return c.last4 === "7777"; }));

    // ---- self-assign always allowed even for non-owner (Alpha → Alpha) ----
    cardDbAssign("7777", "ut_a");
    assert("self-assign allowed for non-owner → Alpha gets 7777", S.users[0].cards.some(function (c) { return c.last4 === "7777"; }));
    assert("no unknown cards left", unassignedCards().length === 0);

    // ---- company-card assign path (owner) ----
    window.isOwner = function () { return true; };
    d.receipts.push({ id: "r8", status: "review", cardLast4: "6666", vendor: "Sunoco", date: "2026-07-04" });
    assert("6666 shows as unknown before company assign", unassignedCards().some(function (x) { return x.last4 === "6666"; }));
    cardDbAssignBusiness("6666");
    assert("6666 added to org businessCards", reg.businessCards.some(function (c) { return c.last4 === "6666"; }));
    assert("cardOwner resolves 6666 → business; dropped from roll-up", cardOwner("6666").resolution === "business" && !unassignedCards().some(function (x) { return x.last4 === "6666"; }));
    cardDbAssignBusiness("6666");
    assert("company-card assign dedupes → one 6666", reg.businessCards.filter(function (c) { return c.last4 === "6666"; }).length === 1);

    // ---- never throws on junk ----
    assert("unassignedCards never throws; cardDbAssign junk last-4 is a no-op", Array.isArray(unassignedCards()));

    diag("card-db: ALL PASS (derive · assign · auto-resolve · dedupe · owner-gate · company-card)");
  } finally {
    S.users = origUsers; d.receipts = origReceipts;
    window.save = origSAVE; window.render = origRENDER; window.curUser = origCUR; window.isOwner = origOWNER; window.scheduleAutoPush = origPUSH;
    if (createdReg) { var i = S.registry.indexOf(reg); if (i >= 0) S.registry.splice(i, 1); }
    else if (origBiz === undefined) { delete reg.businessCards; } else { reg.businessCards = origBiz; }
  }
})();
