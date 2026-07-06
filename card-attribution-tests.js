/* CARD LAST-4 AUTO-ATTRIBUTION — browser-context unit tests for the PURE match + last-4 validation (js/94).
 * Run in the REAL loaded app so it exercises the SHIPPED cardOwner()/cardNorm4() against live globals (S):
 *   node verify-app.js "$(cat card-attribution-tests.js)"
 * It seeds temp users' u.cards + the org's registry.businessCards, asserts none/personal/business/ambiguous +
 * last-4 normalization, then RESTORES the store exactly (never persists / never saves). Any failure throws →
 * verify-app reports it. */
(function () {
  function assert(name, cond) { if (!cond) throw new Error("card-attribution: FAILED — " + name); diag("card: " + name + " ✓"); }

  // ---- snapshot the live store so we restore it byte-for-byte ----
  var origUsers = S.users;
  if (!Array.isArray(S.registry)) S.registry = [];
  var reg = S.registry.find(function (r) { return r && r.id === S.biz; });
  var createdReg = false, origBiz;
  if (!reg) { reg = { id: S.biz, name: S.biz }; S.registry.push(reg); createdReg = true; }
  else { origBiz = reg.businessCards; }

  try {
    // ---- seed: two personal-card owners + one company card + a SHARED (ambiguous) last-4 ----
    S.users = [
      { id: "ut_a", username: "Alpha", role: "crew", cards: [{ id: "c_a1", last4: "1111", label: "Alpha Visa", kind: "personal" }, { id: "c_a3", last4: "3333", kind: "personal" }] },
      { id: "ut_b", username: "Bravo", role: "crew", cards: [{ id: "c_b3", last4: "3333", kind: "personal" }] },
      { id: "ut_gone", username: "Ghost", role: "crew", deleted: true, cards: [{ id: "c_g", last4: "1111", kind: "personal" }] },   // deleted account must be ignored
      { id: "mem_x", kind: "membership", orgId: S.biz, accountId: "ut_a" }   // non-account sentinel must be ignored
    ];
    reg.businessCards = [
      { id: "bc1", last4: "2222", label: "Business Amex", active: true },
      { id: "bc_off", last4: "8888", label: "Retired card", active: false }   // inactive company card must NOT match
    ];

    // ---- cardOwner resolutions ----
    var none = cardOwner("9999");
    assert("no match → resolution 'none', ownerId null, 0 matches", none.resolution === "none" && none.ownerId === null && none.matches.length === 0);

    var personal = cardOwner("1111");
    assert("single personal (deleted-account dup ignored) → 'personal' + correct ownerId", personal.resolution === "personal" && personal.ownerId === "ut_a" && personal.matches.length === 1);

    var business = cardOwner("2222");
    assert("company card, no personal → 'business', ownerId null (no reimburse)", business.resolution === "business" && business.ownerId === null && business.matches.length === 1);

    assert("inactive company card 8888 does NOT match → 'none'", cardOwner("8888").resolution === "none");

    var amb = cardOwner("3333");
    assert("two distinct personal owners → 'ambiguous', ownerId null, 2 matches", amb.resolution === "ambiguous" && amb.ownerId === null && amb.matches.length === 2);

    assert("cardOwner tolerates junk/empty input → 'none' (never throws)", cardOwner("").resolution === "none" && cardOwner(null).resolution === "none" && cardOwner("12").resolution === "none" && cardOwner("••••1111").resolution === "personal");

    // ---- last-4 validation / normalization ----
    var n4 = cardNorm4("1234"); assert("cardNorm4('1234') = {1234, not truncated}", n4.last4 === "1234" && n4.truncated === false);
    var nFull = cardNorm4("4111 1111 1111 1234"); assert("a full PAN keeps only the last 4 + truncated flag", nFull.last4 === "1234" && nFull.truncated === true);
    var nShort = cardNorm4("12"); assert("<4 digits → invalid (last4 '')", nShort.last4 === "" && nShort.truncated === false);
    assert("cardNorm4 strips non-digits ('12-34' → '1234')", cardNorm4("12-34").last4 === "1234");
    assert("cardIsValid4: '1234' valid, '123'/'12ab' invalid", cardIsValid4("1234") === true && cardIsValid4("123") === false && cardIsValid4("12ab") === false);
    assert("cardClean4 keeps digits only", cardClean4("a1b2c3d4") === "1234");

    diag("card-attribution: ALL PASS (none/personal/business/ambiguous + last-4 validation)");
  } finally {
    // ---- restore the live store exactly ----
    S.users = origUsers;
    if (createdReg) { var i = S.registry.indexOf(reg); if (i >= 0) S.registry.splice(i, 1); }
    else if (origBiz === undefined) { delete reg.businessCards; } else { reg.businessCards = origBiz; }
  }
})();
