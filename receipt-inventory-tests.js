/* ➕ Add-to-inventory — data-layer unit tests (DOM-free).
 * Loads js/72-receipts.js + js/87-receipt-edit.js under lightweight stubs and asserts the model:
 *   - the "➕ Add to inventory" suggestion shows ONLY for a tools/equipment receipt, owner/admin, not-yet-linked
 *   - a non-tool receipt (materials/fuel/etc) shows NO button
 *   - crew (no finance access) never see the button
 *   - rcptInvAdd creates a d.inventory item with cat "tool" / name from desc / string price / fromReceiptId,
 *     and sets receipt.inventoryItemId (two-way link)
 *   - a SECOND tap is a no-op / linked state — no duplicate inventory item
 *   - the item is created for a review receipt AND a filed business-expense receipt (biz store)
 * Run: node receipt-inventory-tests.js  →  expect all passed, 0 failed. */

const fs = require("fs");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (got !== undefined ? "  got " + JSON.stringify(got) : "")); } }

/* ---- lightweight browser/global stubs ---- */
global.window = global;
global.document = { getElementById: function () { return null; } };
let STORE;
function resetStore() { STORE = { jobs: [{ id: "j1", title: "Paver patio", customerId: "c1", materials: [], expenses: [] }], expenses: [], receipts: [], inventory: [], customers: [{ id: "c1", name: "Smith" }] }; }
resetStore();
global.D = function () { return STORE; };
global.now = function () { return Date.now(); };
let _n = 0; global.uid = function () { return "id_" + (++_n); };
global.today = function () { return "2026-07-09"; };
global.actJ = function () { return STORE.jobs.filter(j => !j.deleted); };
global.custName = function (id) { const c = STORE.customers.find(x => x.id === id); return c ? c.name : "—"; };
global.userName = function (id) { return ({ u_ray: "Ray", u_chase: "Chase" })[id] || id; };
global.schedMembers = function () { return [{ id: "u_chase", username: "Chase" }]; };
let CURUSER = { id: "u_ray", username: "Ray" };
global.curUser = function () { return CURUSER; };
let FINFULL = true;
global.finCanView = function () { return FINFULL; };
global.isOwner = function () { return FINFULL; };
global.touch = function (r) { r.updatedAt = Date.now(); return r; };
global.save = function () {};
global.render = function () {};
global.logChange = function () {};
global.alert = function () {};
global.confirm = function () { return true; };
global.esc = function (s) { return String(s == null ? "" : s); };
global.money = function (n) { return "$" + Math.round(n); };
global.money2 = function (n) { return "$" + (+n || 0).toFixed(2); };
global.fmtDate = function (d) { return d; };
global.jsUploadUrl = function (id) { return id ? "/uploads/" + id : ""; };
global.S = { biz: "obx" };

const code = fs.readFileSync(__dirname + "/js/72-receipts.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/87-receipt-edit.js", "utf8");
try { eval(code); } catch (e) { console.log("FATAL eval error: " + (e && e.stack || e)); process.exit(1); }

function seedReview(fields) { const r = rcptNewReview(fields.receiptId || "blob"); Object.assign(r, fields); STORE.receipts.push(r); return r; }

function main() {
  console.log("\n— button visibility (tools/equipment only · owner/admin · not-yet-linked) —");
  resetStore(); FINFULL = true;
  const tool = seedReview({ receiptId: "blobT", amount: 189.99, vendor: "Home Depot", desc: "Cordless drill", category: "tools/equipment" });
  ok("tools/equipment receipt → button shows (canAdd true)", rcptCanAddToInventory(tool) === true);
  const mat = seedReview({ receiptId: "blobM", amount: 50, vendor: "Lowe's", desc: "pavers", category: "materials" });
  ok("materials receipt → NO button (canAdd false)", rcptCanAddToInventory(mat) === false);
  const fuel = seedReview({ receiptId: "blobF", amount: 40, vendor: "Shell", desc: "gas", category: "fuel" });
  ok("fuel receipt → NO button", rcptCanAddToInventory(fuel) === false);
  const uncat = seedReview({ receiptId: "blobU", amount: 20, vendor: "?", desc: "?", category: "" });
  ok("uncategorized receipt → NO button", rcptCanAddToInventory(uncat) === false);

  console.log("— crew (no finance access) never see the button —");
  FINFULL = false;
  ok("crew → tools/equipment receipt shows NO button", rcptCanAddToInventory(tool) === false);
  FINFULL = true;

  console.log("— rcptInvAdd: creates the inventory asset + two-way link —");
  resetStore();
  const t = seedReview({ receiptId: "blobT", amount: 189.99, vendor: "Home Depot", date: "2026-07-08", desc: "Cordless drill", category: "tools/equipment" });
  const res = rcptInvAdd({ store: "review", jobId: null, recId: t.id });
  ok("rcptInvAdd → ok + created", res.ok === true && res.created === true);
  ok("one inventory item created", STORE.inventory.length === 1, STORE.inventory.length);
  const item = STORE.inventory[0];
  ok("item.cat === 'tool'", item.cat === "tool", item.cat);
  ok("item.name from receipt desc", item.name === "Cordless drill", item.name);
  ok("item.have === true", item.have === true);
  ok("item.qty === '1' (string)", item.qty === "1", item.qty);
  ok("item.price is the paid amount string", item.price === "$189.99", item.price);
  ok("item.tags is []", Array.isArray(item.tags) && item.tags.length === 0);
  ok("item.fromReceiptId back-links to the receipt", item.fromReceiptId === t.id, item.fromReceiptId);
  ok("item.purchasedAt from receipt date", item.purchasedAt === "2026-07-08", item.purchasedAt);
  ok("item.notes mentions From receipt + vendor", /^From receipt · Home Depot/.test(item.notes), item.notes);
  ok("item.id looks hand-added (inv-c-…)", /^inv-c-/.test(item.id), item.id);
  ok("receipt.inventoryItemId set (two-way link)", t.inventoryItemId === item.id, t.inventoryItemId);

  console.log("— linked receipt: canAdd flips false, rcptInvItem resolves the live item —");
  ok("linked receipt → canAdd false (linked state wins)", rcptCanAddToInventory(t) === false);
  ok("rcptInvItem resolves the linked item", rcptInvItem(t.inventoryItemId) === item);
  ok("rcptInvBlockHTML shows the 🧰 In inventory ✓ chip", /🧰 In inventory ✓/.test(rcptInvBlockHTML(t)));
  ok("rcptInvBlockHTML on a non-tool returns ''", rcptInvBlockHTML({ category: "materials" }) === "");

  console.log("— DEDUP: a second tap is a no-op, never a duplicate —");
  const res2 = rcptInvAdd({ store: "review", jobId: null, recId: t.id });
  ok("second rcptInvAdd → ok + created:false", res2.ok === true && res2.created === false);
  ok("returns the SAME item", res2.item === item);
  ok("still only ONE inventory item (no dup)", STORE.inventory.length === 1, STORE.inventory.length);

  console.log("— stale link (item deleted) → canAdd true again (can re-add) —");
  item.deleted = true;
  ok("deleted linked item → rcptInvItem null", rcptInvItem(t.inventoryItemId) === null);
  ok("deleted linked item → canAdd true again", rcptCanAddToInventory(t) === true);
  item.deleted = false;

  console.log("— FILED business-expense (biz store) tool receipt works too —");
  resetStore();
  STORE.expenses.push({ id: "e1", receiptId: "blobB", amount: 73.16, vendor: "Ace", desc: "Pry bar", category: "tools/equipment", deleted: false });
  const bres = rcptInvAdd({ store: "biz", jobId: null, recId: "e1" });
  ok("biz-store tool receipt → item created", bres.ok && bres.created && STORE.inventory.length === 1);
  ok("biz receipt.inventoryItemId set", STORE.expenses[0].inventoryItemId === STORE.inventory[0].id);
  ok("biz item price from amount", STORE.inventory[0].price === "$73.16", STORE.inventory[0].price);

  console.log("— no amount → empty price (no crash) —");
  resetStore();
  const na = seedReview({ receiptId: "blobN", amount: null, vendor: "Gift", desc: "Free tool", category: "tools/equipment" });
  const nres = rcptInvAdd({ store: "review", jobId: null, recId: na.id });
  ok("no-amount tool → item created, price ''", nres.ok && STORE.inventory[0].price === "", STORE.inventory[0].price);

  console.log("\n=========  " + pass + " passed, " + fail + " failed  =========");
  process.exit(fail ? 1 : 0);
}
main();
