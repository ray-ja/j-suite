#!/usr/bin/env node
/* ---------- HEADLESS BANK PULL (plaid-pull.js) ----------------------------------------------------------
   Ray, 2026-09-01: "can you pull updated transactions and update the account totals? can you make it
   happen 3 times a day?"

   ⭐ THIS IS THE BROWSER FLOW WITHOUT THE BROWSER. The app's design puts the ledger brains client-side
   (js/143 ledgerIngest: externalId dedupe, transfer pairing, learned-category suggestions) and the server
   is a dumb Plaid proxy — so a scheduled pull must run the SAME js/143 in a vm, exactly the way the test
   suites load it, not a reimplementation that would drift the moment the ledger learns a new trick.

   Flow per run (mirrors js/150 bankSync, same order, same failure modes):
     1. read the live store through POST /sync (empty push = authenticated read)
     2. per bank item: /api/plaid/sync → rows; ledgerIngest(rows) in the vm against the live store
     3. ⛔ THE CURSOR ONLY ADVANCES ON A CLEAN ITEM (js/150's rule): if any row arrived for an unmapped
        account, the cursor holds so those rows come again — the failure mode must be a repeat, never a hole.
     4. push ONLY the records that changed (per-record LWW merge keeps everything else)
     5. update mapped accounts' balance anchors: balance = Plaid current (sign-flipped for credit/loan,
        whose balances this ledger stores negative), balanceDate = today. acctBalanceAt() then derives
        forward from there, and every txn through today rode in on the same pull, so the checkpoint and
        the feed can't double-count.
     6. commit cursors, one summary line to the log.

   ⛔ NEVER writes data.json directly — the server owns the file; everything goes through /sync.
   ⚠️ ITEM_LOGIN_REQUIRED is logged loudly but doesn't stop other banks: one expired login must not
   starve the other six accounts of updates. The in-app bank card shows the reconnect button. */

const fs = require("fs"), http = require("http"), vm = require("vm"), path = require("path");
const DIR = __dirname;
const ORG = "mqwvs3mq98pij";
const PORT = 4000;
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (m) => console.log(`[${stamp()}] ${m}`);

function userToken() {
  const t = JSON.parse(fs.readFileSync(path.join(DIR, "user-tokens.json"), "utf8"));
  const arr = Array.isArray(t) ? t : (t.tokens || Object.entries(t).map(([k, v]) => ({ token: k, ...v })));
  const mine = arr.filter(r => r.userId === "mq5bu9z3vc4ey");
  if (!mine.length) throw new Error("no owner token in user-tokens.json");
  return mine[mine.length - 1].token;
}

function call(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1", port: PORT, path: p, method,
      headers: Object.assign({ "Content-Type": "application/json" },
        data ? { "Content-Length": Buffer.byteLength(data) } : {}, headers || {})
    }, res => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch (e) { reject(new Error("bad json from " + p + ": " + d.slice(0, 120))); } });
    });
    req.on("error", reject);
    req.end(data);
  });
}

/* today in LOCAL time, matching the app's js/02 today() — toISOString would call tomorrow "today" after 8pm */
function localToday() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* the exact module-loading recipe ledger-tests.js uses — same slices, same order */
function ledgerContext(store) {
  const R = f => fs.readFileSync(path.join(DIR, f), "utf8");
  const ctx = {
    console, S: Object.assign({ biz: ORG }, store),
    /* the budget page's view globals — js/79's helpers read them even headless (same as ledger-tests) */
    BUDGET_BOOK: "__all__", BUDGET_SUB: "month", BUDGET_MONTH: localToday().slice(0, 7),
    today: localToday, now: () => Date.now(),
    uid: () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    touch: r => { r.updatedAt = Date.now(); return r; },
    save: () => {}, render: () => {}, alert: () => {},
    esc: s => String(s == null ? "" : s),
    document: { getElementById: () => null }, window: {}
  };
  ctx.D = () => ctx.S[ORG];
  vm.createContext(ctx);
  const BUD = R("js/79-budget.js");
  vm.runInContext(BUD.slice(BUD.indexOf("function actBudgetBooks"), BUD.indexOf("/* ---------- main render")), ctx);
  const CSV = R("js/80-budget-csv.js");
  vm.runInContext(CSV.match(/function budgetMemoKey[\s\S]*?\n\}/)[0], ctx);
  vm.runInContext(R("js/143-ledger.js"), ctx);
  Object.assign(ctx, ctx.window);
  return ctx;
}

(async () => {
  const token = userToken();
  const auth = { Authorization: "Bearer " + token };

  // 1. live store (authenticated read = empty push)
  const pull = await call("POST", "/sync", { token, state: {} });
  if (!pull.ok || !pull.state || !pull.state[ORG]) throw new Error("could not read the store via /sync");
  const store = pull.state;
  const d = store[ORG];
  d.budgetTx = d.budgetTx || []; d.budgetAccounts = d.budgetAccounts || [];

  // snapshot to diff against after ingest
  const before = new Map(d.budgetTx.map(t => [t.id, t.updatedAt || 0]));

  // 2. the banks
  const status = await call("GET", `/api/plaid/status?org=${ORG}`, null, auth);
  if (!status.ready) throw new Error("plaid not configured for this org");
  const ctx = ledgerContext(store);

  let added = 0, dups = 0, dropped = 0, held = [], failed = [], cleanItems = [];
  const balByBudgetId = {};   // budgetAccountId -> plaid current balance

  for (const item of status.items) {
    let j;
    try {
      j = await call("POST", "/api/plaid/sync", { org: ORG, itemId: item.itemId }, auth);
    } catch (e) { failed.push(`${item.label}: ${e.message}`); continue; }
    if (j.error) { failed.push(`${item.label}: ${j.error}${j.code ? " (" + j.code + ")" : ""}`); continue; }

    const rows = (j.rows || []).filter(r => r.accountId);
    const declined = (j.rows || []).filter(r => !r.accountId && r.ignored).length;
    const unmapped = (j.rows || []).length - rows.length - declined;

    if (rows.length) {
      const res = ctx.ledgerIngest(rows, { source: "bank" });
      added += (res && res.added) || 0; dups += (res && res.duplicates) || 0;
    }
    // a transaction the bank retracted leaves the pending queue (mirror of bankDropRemoved)
    (j.removed || []).forEach(id => {
      const t = d.budgetTx.find(x => x && x.externalId === id && x.pending && !x.deleted);
      if (t) { t.deleted = true; ctx.touch(t); dropped++; }
    });

    // balances for accounts this item maps
    const map = item.accounts || {};
    (j.accounts || []).forEach(a => {
      const bid = map[a.id];
      if (bid && bid !== "__ignore__" && a.balance != null) balByBudgetId[bid] = a.balance;
    });

    if (unmapped) held.push(`${item.label}: ${unmapped} rows from unpaired accounts — cursor held`);
    else cleanItems.push({ itemId: item.itemId, cursor: j.cursor, label: item.label });
  }

  // 3. balance anchors — sign convention: this ledger stores debt NEGATIVE, Plaid reports it positive
  const changedAccts = [];
  const T = localToday();
  Object.entries(balByBudgetId).forEach(([bid, cur]) => {
    const a = d.budgetAccounts.find(x => x && x.id === bid && !x.deleted);
    if (!a) return;
    const isDebt = a.type === "credit" || a.type === "loan";
    const want = Math.round((isDebt ? -Math.abs(cur) : cur) * 100) / 100;
    if (a.balance === want && a.balanceDate === T) return;
    a.balance = want; a.balanceDate = T; ctx.touch(a);
    changedAccts.push(a);
  });

  // 4. push only what changed
  const changedTx = d.budgetTx.filter(t => t && (!before.has(t.id) || (t.updatedAt || 0) !== before.get(t.id)));
  if (changedTx.length || changedAccts.length) {
    const push = await call("POST", "/sync", { token, state: { [ORG]: Object.assign({},
      changedTx.length ? { budgetTx: changedTx } : {},
      changedAccts.length ? { budgetAccounts: changedAccts } : {}) } });
    if (!push.ok) throw new Error("push failed");
  }

  // 5. cursors advance only for clean items, only after the data is saved
  for (const it of cleanItems) {
    await call("POST", "/api/plaid/commit", { org: ORG, itemId: it.itemId, cursor: it.cursor }, auth);
  }

  log(`pulled ${status.items.length} banks: +${added} new, ${dups} dup, ${dropped} retracted, ` +
      `${changedAccts.length} balances re-anchored, ${cleanItems.length} cursors committed` +
      (held.length ? ` | HELD: ${held.join("; ")}` : "") +
      (failed.length ? ` | FAILED: ${failed.join("; ")}` : ""));
  if (failed.some(f => /ITEM_LOGIN_REQUIRED/.test(f))) {
    log("⚠️ a bank wants a fresh sign-in — open the app's bank card and reconnect; it resumes where it left off");
  }
  process.exit(failed.length && !cleanItems.length ? 1 : 0);
})().catch(e => { log("FATAL: " + e.message); process.exit(1); });
