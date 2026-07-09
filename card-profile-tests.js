/* card-profile-tests.js — CARDS ON THE TEAM PROFILE (js/94 Phase 4).
   Card management moved off Settings onto each member's PROFILE, admin-editable. This test:
     1) loads the SHIPPED js/94 in a vm sandbox (stubbed app globals) and exercises the ADMIN-capable ops —
        cardAddFor / cardEditFor / cardRemoveFor / cardReassign — asserting self-or-owner/super-admin gating
        (a CREW user cannot write another member's cards), that cardReassign moves a card between members
        (owner), and that ONLY the last-4 is ever stored (a pasted full PAN is truncated), and
     2) drives the REAL sync-server sanitize + merge to prove a cross-user card write SURVIVES the round-trip
        for a verified OWNER (the /sync path BYPASSES sanitizeUserWrites) while a CREW's cross-user write is
        REVERTED with ZERO account loss (the availability-dataloss guarantee — no silent revert we didn't gate).
   Run: node card-profile-tests.js   (exit 0 = green) */
const vm = require("vm");
const fs = require("fs");
const SS = require("./sync-server");
let fail = 0;
function ok(c, m) { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; }

/* ---- 1) js/94 admin ops in a sandbox (window/module + stubbed app globals) ---- */
function makeCtx(meId) {
  const S = {
    biz: "obx",
    users: [
      { id: "u_owner", username: "Ray", role: "owner", cards: [] },
      { id: "u_crew", username: "Chase", role: "crew", cards: [{ id: "c_x", last4: "1005", label: "debit", kind: "personal", addedAt: 1 }] },
      { id: "u_crew2", username: "Pierce", role: "crew", cards: [{ id: "c_y", last4: "2020", label: "Pierce card", kind: "personal", addedAt: 1 }] }
    ],
    registry: [{ id: "obx", name: "OBX" }]
  };
  const me = S.users.find(u => u.id === meId) || null;
  const sandbox = {
    window: {}, module: { exports: {} }, console, S: S,
    curUser: () => me,
    isOwner: () => !!(me && me.role === "owner"),
    esc: s => String(s == null ? "" : s),
    uid: () => "id" + Math.random().toString(36).slice(2),
    now: () => 2,
    touch: u => { if (u) u.updatedAt = 2; },
    save: () => {}, render: () => {}, scheduleAutoPush: () => {}, logChange: () => {},
    alert: () => {}, prompt: () => null, confirm: () => true,
    teamMembers: () => S.users.filter(u => u && !u.kind && !u.deleted)
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(__dirname + "/js/94-card-attribution.js", "utf8"), sandbox, { filename: "js/94-card-attribution.js" });
  return { S, api: sandbox.module.exports };
}

// crew acting on THEMSELF — allowed (self-write always sticks)
(function () {
  const { S, api } = makeCtx("u_crew");
  const r = api.cardAddFor("u_crew", "4242", "my Visa", "personal");
  ok(r.ok === true, "crew can add a card to their OWN profile");
  const crew = S.users.find(u => u.id === "u_crew");
  ok(crew.cards.some(c => c.last4 === "4242" && !c.deleted), "self-add lands on the crew member's cards");
  ok(api.cardCanEditFor("u_crew") === true, "cardCanEditFor(self) = true for a crew member");
})();

// crew acting on ANOTHER member — blocked (would be reverted server-side)
(function () {
  const { S, api } = makeCtx("u_crew");
  ok(api.cardCanEditFor("u_crew2") === false, "cardCanEditFor(peer) = false for a crew member (no cross-user)");
  const add = api.cardAddFor("u_crew2", "9999", "", "personal");
  ok(add.ok === false && add.error === "not-authorized", "crew CANNOT add a card to another member (not-authorized)");
  ok(!(S.users.find(u => u.id === "u_crew2").cards || []).some(c => c.last4 === "9999"), "the blocked add did not mutate the peer's cards");
  const edit = api.cardEditFor("u_crew2", "c_y", { label: "hacked" });
  ok(edit.ok === false && edit.error === "not-authorized", "crew CANNOT edit another member's existing card");
  const rm = api.cardRemoveFor("u_crew2", "c_y");
  ok(rm.ok === false && rm.error === "not-authorized", "crew CANNOT remove another member's card");
  const re = api.cardReassign("u_crew", "c_x", "u_crew2");
  ok(re.ok === false && re.error === "not-authorized", "crew CANNOT reassign a card (owner/super-admin only)");
})();

// OWNER acting on anyone — allowed; only last-4 stored; edit/remove/reassign work
(function () {
  const { S, api } = makeCtx("u_owner");
  ok(api.cardCanCross() === true && api.cardCanEditFor("u_crew") === true, "owner: cardCanCross + cardCanEditFor(anyone) = true");

  // only-last-4: a pasted full PAN keeps its last 4 and nothing else
  const add = api.cardAddFor("u_crew2", "4111 1111 1111 4242", "Pierce card", "personal");
  ok(add.ok === true && add.card.last4 === "4242" && add.truncated === true, "owner adds to a crew member; full PAN truncated to last-4 (4242)");
  const stored = S.users.find(u => u.id === "u_crew2").cards.find(c => c.last4 === "4242");
  ok(stored && Object.keys(stored).sort().join(",") === "addedAt,id,kind,label,last4", "stored card has ONLY {id,last4,label,kind,addedAt} — no full number/CVV/expiry");
  ok(/^\d{4}$/.test(stored.last4), "stored last4 is exactly 4 digits");

  const edit = api.cardEditFor("u_crew", "c_x", { label: "renamed", kind: "business" });
  ok(edit.ok === true && edit.card.label === "renamed" && edit.card.kind === "business", "owner can edit another member's card (label + kind)");
  const editPan = api.cardEditFor("u_crew", "c_x", { last4: "5555 6666 7777 8888" });
  ok(editPan.ok === true && editPan.card.last4 === "8888", "edit also truncates a pasted PAN to last-4 only");

  // reassign: move c_x from crew → crew2 (soft-delete source, add equivalent to target)
  const before = S.users.find(u => u.id === "u_crew").cards.find(c => c.id === "c_x");
  const re = api.cardReassign("u_crew", "c_x", "u_crew2");
  ok(re.ok === true, "owner can reassign a card between members");
  ok(before.deleted === true, "reassign soft-deletes the card on the SOURCE member");
  ok(S.users.find(u => u.id === "u_crew2").cards.some(c => c.last4 === "8888" && !c.deleted), "reassign adds the equivalent card to the TARGET member (last4/label/kind kept)");
  ok(api.cardReassign("u_crew", "c_x", "u_crew").ok === false, "reassign to the same member is rejected");

  const rm = api.cardRemoveFor("u_crew2", stored.id);
  ok(rm.ok === true && stored.deleted === true, "owner can remove another member's card (soft-delete tombstone)");
})();

/* ---- 2) SYNC ROUND-TRIP — cross-user write survives for a verified OWNER, is reverted for CREW (no silent loss) ---- */
function preStore() {
  return {
    users: [
      { id: "u_owner", username: "Ray", role: "owner", updatedAt: 1 },
      { id: "u_crew", username: "Chase", role: "crew", cards: [{ id: "c_x", last4: "1005", kind: "personal", addedAt: 1 }], updatedAt: 1 },
      { id: "u_crew2", username: "Pierce", role: "crew", updatedAt: 1 },
      { id: "mem_obx_ray", kind: "membership", orgId: "obx", accountId: "u_owner", role: "owner", updatedAt: 1 }
    ]
  };
}
function realAccts(store) { return (store.users || []).filter(u => u && !u.kind && !u.deleted).length; }

// OWNER reassigns crew→crew2 cross-user. The /sync path uses `verifiedOwner ? scoped : sanitizeUserWrites(...)`,
// so a verified owner BYPASSES the sanitizer → merge keeps the cross-user write.
(function () {
  const pre = preStore();
  const incoming = { users: [
    Object.assign({}, pre.users.find(u => u.id === "u_crew"), { cards: [{ id: "c_x", last4: "1005", kind: "personal", addedAt: 1, deleted: true }], updatedAt: 5 }),
    Object.assign({}, pre.users.find(u => u.id === "u_crew2"), { cards: [{ id: "c_new", last4: "1005", kind: "personal", addedAt: 5 }], updatedAt: 5 })
  ] };
  // verified-owner path: sanitize is BYPASSED
  const merged = SS.mergeState(JSON.parse(JSON.stringify(pre)), incoming);
  const c2 = merged.users.find(u => u.id === "u_crew2");
  const c1 = merged.users.find(u => u.id === "u_crew");
  ok(c2.cards.some(c => c.last4 === "1005" && !c.deleted), "OWNER cross-user reassign SURVIVES the merge — target has the 1005 card");
  ok((c1.cards.find(c => c.id === "c_x") || {}).deleted === true, "OWNER cross-user reassign SURVIVES — source card soft-deleted");
  ok(realAccts(merged) === realAccts(pre), "no account loss through the owner round-trip (" + realAccts(merged) + " = " + realAccts(pre) + ")");
})();

// CREW attempts the SAME cross-user write → sanitizeUserWrites REVERTS the peer record (why cross-user is owner-gated),
// but the crew's OWN self-write to cards passes. Zero account loss either way.
(function () {
  const pre = preStore();
  const incoming = { users: [
    Object.assign({}, pre.users.find(u => u.id === "u_crew"), { cards: [{ id: "c_x", last4: "1005", kind: "personal", addedAt: 1 }, { id: "c_self", last4: "4242", kind: "personal", addedAt: 5 }], updatedAt: 5 }),
    Object.assign({}, pre.users.find(u => u.id === "u_crew2"), { cards: [{ id: "c_bad", last4: "1005", kind: "personal", addedAt: 5 }], updatedAt: 5 })
  ] };
  const sanitized = SS.sanitizeUserWrites(JSON.parse(JSON.stringify(incoming)), pre, "u_crew");
  const merged = SS.mergeState(JSON.parse(JSON.stringify(pre)), sanitized);
  const c2 = merged.users.find(u => u.id === "u_crew2");
  const c1 = merged.users.find(u => u.id === "u_crew");
  ok(!(c2.cards || []).some(c => !c.deleted), "CREW cross-user write is REVERTED — peer gains NO card (no silent-revert surprise; gated client-side)");
  ok(c1.cards.some(c => c.last4 === "4242" && !c.deleted), "CREW self-write to their OWN cards DOES survive the sanitizer");
  ok(realAccts(merged) === realAccts(pre), "no account loss through the crew round-trip (" + realAccts(merged) + " = " + realAccts(pre) + ")");
})();

console.log(fail ? ("\n  ✗ " + fail + " FAILED") : "\n  ✓ ALL PASS — profile card ops gated (self+owner/super-admin, crew self-only), reassign moves a card, only last-4 stored, cross-user survives sync for a verified owner and is cleanly reverted (zero loss) for crew.");
process.exit(fail ? 1 : 0);
