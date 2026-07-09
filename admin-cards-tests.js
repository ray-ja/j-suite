/* admin-cards-tests.js — ADMIN → 💳 CARDS consolidated table (js/105, rows reuse the js/94 ops).
   Ray's ask: "just have a table of all the cards under Admin." This test loads the SHIPPED js/94 + js/105 in a
   vm sandbox (stubbed app globals) and asserts:
     1) adminCardsData() AGGREGATES every active member's personal cards + the org's company cards (correct
        count / peopleCount / company count),
     2) the Edit/Reassign/Remove/Add row actions are the EXISTING js/94 handlers with the SAME gating — a
        MANAGER (non-owner) cannot cross-user edit/reassign, an OWNER can (cardCanEditFor / cardCanCross),
     3) only owner/manager reach the section — adminAllCardsCard() renders for owner/manager and returns "" for
        crew (defence-in-depth on top of rAdmin's gate), and never throws,
     4) only the last-4 is ever stored (a pasted PAN is truncated by the reused js/94 op).
   Run: node admin-cards-tests.js   (exit 0 = green) */
const vm = require("vm");
const fs = require("fs");
let fail = 0;
function ok(c, m) { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; }

function makeCtx(meId, meRole) {
  const S = {
    biz: "obx",
    users: [
      { id: "u_owner", username: "Ray", name: "Ray", role: "owner", active: true, cards: [{ id: "c_o", last4: "1111", label: "owner visa", kind: "personal", addedAt: 1 }] },
      { id: "u_mgr", username: "Morgan", name: "Morgan", role: "manager", active: true, cards: [{ id: "c_m", last4: "2222", label: "mgr card", kind: "personal", addedAt: 1 }] },
      { id: "u_crew", username: "Chase", name: "Chase", role: "crew", active: true, cards: [{ id: "c_x", last4: "1005", label: "debit", kind: "personal", addedAt: 1 }, { id: "c_x2", last4: "3009", label: "", kind: "business", addedAt: 1 }] },
      { id: "u_crew2", username: "Pierce", name: "Pierce", role: "crew", active: true, cards: [{ id: "c_y", last4: "2020", label: "Pierce card", kind: "personal", addedAt: 1 }] },
      { id: "u_off", username: "Old", name: "Old", role: "crew", active: false, cards: [{ id: "c_off", last4: "9999", kind: "personal", addedAt: 1 }] } // inactive → excluded
    ],
    registry: [{ id: "obx", name: "OBX", businessCards: [{ id: "b1", last4: "4000", label: "business amex", active: true, addedAt: 1 }, { id: "b2", last4: "5000", label: "retired card", active: true, deleted: true, addedAt: 1 }] }]
  };
  const me = S.users.find(u => u.id === meId) || null;
  const owner = !!(me && meRole === "owner");
  const sandbox = {
    window: {}, module: { exports: {} }, console, S: S,
    curUser: () => me,
    isOwner: () => owner,
    canManageMembers: () => owner || meRole === "manager",
    canManageVehicles: () => owner || meRole === "manager",
    canDo: () => owner || meRole === "manager",
    roleBadge: k => "[" + k + "]",
    teamRoleKey: u => u.role || "crew",
    esc: s => String(s == null ? "" : s),
    uid: () => "id" + Math.random().toString(36).slice(2),
    now: () => 2,
    touch: u => { if (u) u.updatedAt = 2; },
    save: () => {}, render: () => {}, scheduleAutoPush: () => {}, logChange: () => {},
    alert: () => {}, prompt: () => null, confirm: () => true,
    teamMembers: () => S.users.filter(u => u && !u.kind && !u.deleted && u.active !== false)
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(__dirname + "/js/94-card-attribution.js", "utf8"), sandbox, { filename: "js/94-card-attribution.js" });
  vm.runInContext(fs.readFileSync(__dirname + "/js/105-admin-cards.js", "utf8"), sandbox, { filename: "js/105-admin-cards.js" });
  // js/94 top-level `function` decls live on the sandbox global (its module.exports is overwritten by js/105)
  const api = {
    adminCardsData: sandbox.adminCardsData, adminAllCardsCard: sandbox.adminAllCardsCard, adminCardAddPick: sandbox.window.adminCardAddPick,
    cardCanEditFor: sandbox.cardCanEditFor, cardCanCross: sandbox.cardCanCross,
    cardEditFor: sandbox.cardEditFor, cardReassign: sandbox.cardReassign, cardAddFor: sandbox.cardAddFor,
    _all: sandbox
  };
  return { S, api, win: sandbox.window };
}

/* ---- 1) aggregation ---- */
(function () {
  const { api } = makeCtx("u_owner", "owner");
  const d = api.adminCardsData();
  // active members with cards: owner(1) + mgr(1) + crew(2) + crew2(1) = 5 personal cards across 4 people; inactive Old excluded
  ok(d.count === 5, "adminCardsData counts every ACTIVE member's personal cards (5) — got " + d.count);
  ok(d.peopleCount === 4, "adminCardsData reports 4 people with ≥1 card (inactive member excluded) — got " + d.peopleCount);
  ok(!d.people.some(p => p.userId === "u_off"), "an inactive member is NOT included in the table");
  ok(d.company.length === 1 && d.company[0].last4 === "4000", "company cards = the org's non-deleted businessCards (1: ••••4000)");
})();

/* ---- 2) row actions reuse js/94 ops with the SAME gating ---- */
(function () {
  const { api } = makeCtx("u_mgr", "manager");   // a MANAGER viewing the table
  ok(api.cardCanEditFor("u_mgr") === true, "manager can edit their OWN card (self-write)");
  ok(api.cardCanEditFor("u_crew") === false, "manager CANNOT cross-user edit (cardCanEditFor(peer) = false) — the Edit/Remove buttons are hidden, shown as 🔒 owner-only");
  ok(api.cardCanCross() === false, "manager cardCanCross() = false → Reassign hidden");
  const blocked = api.cardEditFor("u_crew", "c_x", { label: "hax" });
  ok(blocked.ok === false && blocked.error === "not-authorized", "the reused js/94 op REFUSES a manager's cross-user edit (would sanitize-revert)");
})();
(function () {
  const { S, api } = makeCtx("u_owner", "owner");   // an OWNER viewing the table
  ok(api.cardCanCross() === true && api.cardCanEditFor("u_crew") === true, "owner can cross-user edit + reassign (cardCanCross/cardCanEditFor = true)");
  const edit = api.cardEditFor("u_crew", "c_x", { label: "renamed" });
  ok(edit.ok === true && edit.card.label === "renamed", "owner Edit routes to js/94 cardEditFor and applies");
  const re = api.cardReassign("u_crew", "c_x", "u_crew2");
  ok(re.ok === true, "owner Reassign routes to js/94 cardReassign and moves the card");
  ok(S.users.find(u => u.id === "u_crew").cards.find(c => c.id === "c_x").deleted === true, "reassign soft-deletes on the source (js/94 behaviour, unchanged)");
  // only last-4 stored through the Admin-table add path
  const add = api.cardAddFor("u_crew2", "4111 1111 1111 4242", "PAN", "personal");
  ok(add.ok === true && add.card.last4 === "4242" && add.truncated === true, "Add through the reused op truncates a pasted PAN to last-4 (4242) — only last-4 stored");
})();

/* ---- 3) section gating (owner/manager see it, crew gets "") + never throws ---- */
(function () {
  const owner = makeCtx("u_owner", "owner");
  const ownerHtml = owner.api.adminAllCardsCard();
  ok(/💳 Cards/.test(ownerHtml) && /••••1111/.test(ownerHtml) && /🏢 Company/.test(ownerHtml), "OWNER: adminAllCardsCard renders personal (••••1111) + 🏢 Company sections");
  ok(/personal cards across/.test(ownerHtml), "the count header 'N personal cards across M people' is present");
  ok(/cardEditForPrompt\('u_crew'/.test(ownerHtml) && /cardReassignPrompt\('u_crew'/.test(ownerHtml), "owner rows wire the js/94 Edit + Reassign handlers");

  const mgr = makeCtx("u_mgr", "manager");
  const mgrHtml = mgr.api.adminAllCardsCard();
  ok(/💳 Cards/.test(mgrHtml) && /••••1005/.test(mgrHtml), "MANAGER: the whole roster is VISIBLE (sees crew's ••••1005)");
  ok(/owner-only/.test(mgrHtml) && !/cardReassignPrompt\('u_crew'/.test(mgrHtml), "MANAGER: cross-user Edit/Reassign are hidden — shown as a subtle 🔒 owner-only affordance, not a broken button");

  const crew = makeCtx("u_crew", "crew");
  ok(crew.api.adminAllCardsCard() === "", "CREW: adminAllCardsCard() returns \"\" (defence-in-depth; crew also can't reach rAdmin at all)");

  // never throws even with a broken store
  let threw = false;
  try {
    const ctx = makeCtx("u_owner", "owner"); ctx.S.users = null; ctx.api._all.S.users = null;
    ctx.api.adminAllCardsCard();
  } catch (e) { threw = true; }
  ok(!threw, "adminAllCardsCard never throws, even on a malformed store");
})();

console.log(fail ? ("\n  ✗ " + fail + " FAILED") : "\n  ✓ ALL PASS — Admin 💳 Cards table aggregates every active member's personal cards + company cards with correct counts, rows reuse the js/94 ops with owner-only cross-user gating (manager sees but can't cross-edit), only owner/manager render the section, only last-4 stored, never throws.");
process.exit(fail ? 1 : 0);
