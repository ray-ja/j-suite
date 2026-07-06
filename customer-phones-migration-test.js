/* customer-phones-migration-test.js — MANDATORY migration fixture (CLAUDE.md) for the CUSTOMER MULTI-PHONE model.
 * Additive: c.phones = [{num,label}] holds up to 3 numbers, each with a note; c.phone stays the PRIMARY number
 * (== phones[0].num) so ALL existing code that reads c.phone is UNCHANGED.
 * Loads a realistic PRE-change store (customers with only c.phone, one with NONE, one already multi) through:
 *   1) sync-server migrateStore + a no-op mergeState round-trip (per-record LWW passthrough) — zero customer loss,
 *      every c.phone preserved byte-for-byte, and
 *   2) the REAL client js/02-state.js load() (vm sandbox) — every legacy number survives into c.phones[0].num,
 *      c.phone is UNCHANGED, a phone-less customer gets phones:[] (never invents a number), an already-multi
 *      customer is preserved verbatim.
 * Also unit-checks the custPhones() display helper (js/06). Read-only: builds its own fixture; writes nothing.
 * Run: node customer-phones-migration-test.js   (exit 0 = green) */
const vm = require("vm");
const fs = require("fs");
const SS = require("./sync-server");
let fail = 0;
function ok(c, m) { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; }

/* realistic PRE-CHANGE fixture (server/data.json shape) — customers as they existed with only c.phone */
function freshPre() {
  return {
    users: [{ id: "u_ray", username: "Ray", role: "owner", updatedAt: 1 }],
    registry: [],
    obx: {
      customers: [
        { id: "c1", name: "Alpha Cust", phone: "2525551212", updatedAt: 1 },          // plain 10-digit
        { id: "c2", name: "Beta NoPhone", updatedAt: 1 },                             // NO phone at all
        { id: "c3", name: "Gamma Fmt", phone: "(252) 555-3434", updatedAt: 1 },        // already-formatted number
        // a customer who ALREADY has the multi-phone model — must be preserved VERBATIM (no clobber)
        { id: "c4", name: "Delta Multi", phone: "2525550001",
          phones: [{ num: "2525550001", label: "wife" }, { num: "2525550002", label: "site manager" }], updatedAt: 1 },
        { id: "c5", name: "Echo Empty", phone: "", updatedAt: 1 }                       // empty-string phone → []
      ],
      properties: [], quotes: [], jobs: [], income: [], expenses: [], inventory: [], locks: [],
      timeclock: [], messages: [], resale: [], pendingChanges: [], knowledge: [], disbursements: [], changelog: [], docs: [], places: []
    },
    jam: { customers: [], quotes: [], jobs: [] }
  };
}
function custCount(store) { return ((store.obx && store.obx.customers) || []).filter(c => c && !c.deleted).length; }
const cById = (store, id) => ((store.obx && store.obx.customers) || []).find(c => c && c.id === id) || null;

/* ============ 1) SERVER — migrateStore + a no-op round-trip drops no customer, preserves every c.phone ============ */
const pre = freshPre();
const beforeN = custCount(pre);
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(pre)));
const round = SS.mergeState(migrated, {});
ok(custCount(migrated) >= beforeN && custCount(round) >= beforeN, "server round-trip: no customer loss (before=" + beforeN + " migrated=" + custCount(migrated) + " round=" + custCount(round) + ")");
freshPre().obx.customers.forEach(b => { const r = cById(round, b.id); ok(!!r && (r.phone || "") === (b.phone || ""), "server: " + b.id + " c.phone preserved byte-for-byte ('" + (b.phone || "") + "')"); });
const sC4 = cById(round, "c4");
ok(!!sC4 && Array.isArray(sC4.phones) && sC4.phones.length === 2 && sC4.phones[1].label === "site manager", "server: already-multi customer's phones[] survives verbatim");

/* ============ 2) CLIENT — the REAL js/02 load(), then js/06 for custPhones() ============ */
const localStorageStub = { _data: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; } };
const sandbox = { console, localStorage: localStorageStub, window: { __syncApplying: false }, migrateBudgetBooks: () => {}, isFinite: isFinite, parseFloat: parseFloat };
const ctx = vm.createContext(sandbox);
const clientPre = JSON.parse(JSON.stringify(pre));
Object.assign(clientPre, { biz: "obx", propsV2: true, seeded: true, researchV2: true, researchV3: true, marketingV2: true, ceoV1: true, ceoV3: true, msgIAv1: true, todoGbp: true });
localStorageStub._data["jra_app_v1"] = JSON.stringify(clientPre);
vm.runInContext(fs.readFileSync("js/02-state.js", "utf8"), ctx, { filename: "js/02-state.js" });
vm.runInContext(fs.readFileSync("js/06-customers.js", "utf8"), ctx, { filename: "js/06-customers.js" });
vm.runInContext("load();", ctx);
const S_after = vm.runInContext("S", ctx);

ok(custCount(S_after) === beforeN, "client load(): no customer loss (after=" + custCount(S_after) + " of " + beforeN + ")");
// every legacy number survives into c.phones[0].num, and c.phone is UNCHANGED
[["c1", "2525551212"], ["c3", "(252) 555-3434"]].forEach(([id, num]) => {
  const c = cById(S_after, id);
  ok(!!c && Array.isArray(c.phones) && c.phones.length === 1 && c.phones[0].num === num && c.phones[0].label === "", "client: " + id + " phone → phones[0].num='" + num + "', empty label");
  ok(!!c && c.phone === num, "client: " + id + " c.phone UNCHANGED ('" + num + "')");
});
// phone-less customers → phones:[] (never invents a number)
["c2", "c5"].forEach(id => { const c = cById(S_after, id); ok(!!c && Array.isArray(c.phones) && c.phones.length === 0, "client: " + id + " (no number) → phones:[] (nothing invented)"); ok(!!c && !c.phone, "client: " + id + " c.phone still empty"); });
// already-multi customer preserved verbatim
const c4 = cById(S_after, "c4");
ok(!!c4 && c4.phones.length === 2 && c4.phones[0].num === "2525550001" && c4.phones[0].label === "wife" && c4.phones[1].label === "site manager", "client: already-multi customer preserved verbatim (2 labeled numbers)");
ok(!!c4 && c4.phone === "2525550001", "client: already-multi customer c.phone stays primary (phones[0].num)");
// idempotent: a second load() must not change anything
vm.runInContext("load();", ctx);
const S2 = vm.runInContext("S", ctx);
ok(cById(S2, "c1").phones.length === 1 && cById(S2, "c2").phones.length === 0 && cById(S2, "c4").phones.length === 2, "client: load() is idempotent (re-run doesn't grow/shrink phones[])");

/* ---- unit: custPhones() display helper (up to 3, drops empties, falls back to c.phone) ---- */
const custPhones = vm.runInContext("custPhones", ctx);
ok(custPhones({ phone: "2525551212" }).length === 1 && custPhones({ phone: "2525551212" })[0].num === "2525551212", "custPhones: falls back to single c.phone when phones[] absent");
ok(custPhones({}).length === 0 && custPhones(null).length === 0, "custPhones: empty/null customer → []");
const many = custPhones({ phones: [{ num: "1", label: "a" }, { num: "2", label: "b" }, { num: "3", label: "c" }, { num: "4", label: "d" }] });
ok(many.length === 3, "custPhones: caps at 3 numbers");
const withEmpty = custPhones({ phones: [{ num: "1", label: "x" }, { num: "", label: "y" }, { num: "  ", label: "z" }] });
ok(withEmpty.length === 1 && withEmpty[0].num === "1", "custPhones: drops empty/blank numbers");

console.log(fail ? ("\n  ✗ " + fail + " FAILED") : "\n  ✓ ZERO LOSS — every legacy c.phone survives into c.phones[0].num, c.phone is unchanged, phone-less customers get [] (nothing invented), already-multi customers are verbatim, and the backfill is idempotent through migrateStore + a sync round-trip + client load().");
process.exit(fail ? 1 : 0);
