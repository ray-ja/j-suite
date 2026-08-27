/* plaid-tests.js — the bank feed.

   Ray, 2026-08-25: "plaid sounds fine."

   ⚠️ NEITHER OF US CAN RUN THIS END TO END WITHOUT HIS CREDENTIALS. So every part that can be wrong
   without a network — the conversion, the dedupe, the ordering, what reaches the browser — is tested
   against fixtures shaped exactly like Plaid's documented responses. The API shapes below were read from
   plaid.com/docs during the build, not recalled.

   THE FOUR THINGS THAT WOULD HAVE BEEN SILENTLY WRONG:

   1. ⚠️ PLAID'S `amount` IS POSITIVE WHEN MONEY LEAVES. "Positive values when money moves out of the
      account; negative values when money moves in." That is the inverse of this app's `dir`. Reversed,
      every transaction is filed as its own opposite, perfectly consistently, with nothing to notice.

   2. ⚠️ A PENDING ROW AND ITS POSTED ROW ARE DIFFERENT transaction_ids. Ingest both and every card
      purchase appears twice — past the externalId dedupe, because they really are two different ids.

   3. ⚠️ `removed` MEANS THE BANK RETRACTED IT. It has to leave the review queue or it waits forever.

   4. ⛔ THE ACCESS TOKEN MUST NEVER REACH THE BROWSER.

   Pure node. Run: node plaid-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }
const R = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const CODE = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/* ⚠️ PROSE IN A COMMENT WRAPS. Three assertions in this session failed on a regex spanning a line break,
   never on the behaviour. Match documentation text through this, never against the raw source. */
const PROSE = (src) => src.replace(/\s+/g, " ");

const plaid = require("./plaid.js");
const SRV = R("sync-server.js"), CLIENT = R("js/150-bank-link.js"), SHELL = R("Business App (v1).html");
const GITIGNORE = R(".gitignore"), BUD = R("js/79-budget.js"), LEDGER = R("js/143-ledger.js");

/* a transaction shaped exactly as the API reference documents it */
const ptx = (o) => Object.assign({
  transaction_id: "tx_" + Math.random().toString(36).slice(2, 10),
  account_id: "plaid_acct_1", amount: 12.34, date: "2026-08-20",
  name: "HARRIS TEETER #1234", merchant_name: "Harris Teeter",
  pending: false, pending_transaction_id: null, iso_currency_code: "USD"
}, o);
const MAP = { plaid_acct_1: "a_chk" };

console.log("\n--- ⚠️ 1. the sign convention (positive = money OUT) ---");
{
  const spend = plaid.plaidToRow(ptx({ amount: 42.5 }), MAP);
  eq("⭐ a POSITIVE Plaid amount is money going OUT", spend.dir, "out");
  eq("...stored as a magnitude, never a signed number", spend.amount, 42.5);

  const income = plaid.plaidToRow(ptx({ amount: -1500 }), MAP);
  eq("⭐ a NEGATIVE Plaid amount is money coming IN", income.dir, "in");
  eq("...also a magnitude", income.amount, 1500);

  ok("the convention is quoted from the docs, not assumed", /Positive values when money moves out/.test(PROSE(R("plaid.js"))));
  ok("...and flagged where the one line lives", /POSITIVE = money OUT/.test(R("plaid.js")));

  /* the whole point: an inverted mapping is internally consistent and impossible to spot later */
  ok("⛔ the two directions are genuinely opposite", spend.dir !== income.dir);
}

console.log("\n--- ⚠️ 2. pending is not posted ---");
{
  ok("⭐ a pending transaction is not ingested at all", plaid.plaidToRow(ptx({ pending: true }), MAP) === null);
  ok("...its posted twin is", !!plaid.plaidToRow(ptx({ pending: false, pending_transaction_id: "tx_earlier" }), MAP));
  ok("the duplicate mechanism is written down", /DIFFERENT transaction_id/.test(PROSE(R("plaid.js"))));
  ok("...and the cash-basis reason too", /the cash moved when it posted/.test(PROSE(R("plaid.js"))));
}

console.log("\n--- the rest of the conversion ---");
{
  const r = plaid.plaidToRow(ptx({ amount: 42.5 }), MAP);
  eq("⭐ transaction_id becomes the externalId the ledger dedupes on", r.externalId.slice(0, 3), "tx_");
  ok("...which is exactly what ledgerIngest looks for first", /externalId/.test(CODE(LEDGER)));
  eq("the merchant name is preferred over the raw one", r.desc, "Harris Teeter");
  eq("...falling back to the raw description", plaid.plaidToRow(ptx({ merchant_name: null }), MAP).desc, "HARRIS TEETER #1234");
  eq("the Plaid account maps to one of his budget accounts", r.accountId, "a_chk");
  eq("...and an unmapped account is left blank, not guessed", plaid.plaidToRow(ptx({ account_id: "unknown" }), MAP).accountId, "");
  eq("the plaid account id is kept, so it can be mapped later", r.plaidAccountId, "plaid_acct_1");
  eq("the date is a plain ISO day", r.date, "2026-08-20");

  ok("⛔ a zero-amount row is dropped", plaid.plaidToRow(ptx({ amount: 0 }), MAP) === null);
  ok("⛔ a non-numeric amount is dropped", plaid.plaidToRow(ptx({ amount: "x" }), MAP) === null);
  ok("⛔ a row with no id is dropped", plaid.plaidToRow(ptx({ transaction_id: null }), MAP) === null);
  ok("⛔ garbage doesn't throw", plaid.plaidToRow(null, MAP) === null && plaid.plaidToRow(undefined) === null);
  ok("a missing map doesn't throw", !!plaid.plaidToRow(ptx({}), null));
}

console.log("\n--- ⚠️ 3. a retracted transaction leaves the queue ---");
{
  const store = { p: { budgetTx: [
    { id: "t1", externalId: "tx_gone", pending: true, amount: 10, deleted: false },
    { id: "t2", externalId: "tx_approved", pending: false, amount: 20, deleted: false },
    { id: "t3", externalId: "tx_keep", pending: true, amount: 30, deleted: false }
  ] } };
  const ctx = { console, S: store, BIZ: "p", window: {}, touch: r => r, save: () => {}, D: () => store.p };
  vm.createContext(ctx); vm.runInContext(CLIENT, ctx); Object.assign(ctx, ctx.window);

  const n = ctx.bankDropRemoved(["tx_gone", "tx_approved"]);
  eq("⭐ a withdrawn transaction still waiting is dropped", n, 1);
  ok("...by soft delete", store.p.budgetTx[0].deleted === true);
  ok("⛔ ...but one he has ALREADY APPROVED is left alone", store.p.budgetTx[1].deleted === false);
  ok("...and the reason is recorded", /his, not mine to remove/.test(PROSE(CLIENT)));
  ok("an unrelated pending row is untouched", store.p.budgetTx[2].deleted === false);
  eq("nothing to remove is not an error", ctx.bankDropRemoved([]), 0);
  eq("...nor is garbage", ctx.bankDropRemoved(null), 0);
}

console.log("\n--- ⭐ per-organisation keys, entered in the app ---");
{
  const tmp = plaid.PLAID_FILE + ".testbak2";
  let had = false;
  try { fs.copyFileSync(plaid.PLAID_FILE, tmp); had = true; } catch (e) {}
  plaid.plaidSave({});

  plaid.plaidSetConfig("obx", { clientId: "cid-obx", secret: "sec-obx", env: "production" });
  plaid.plaidSetConfig("me", { clientId: "cid-me", secret: "sec-me" });

  eq("⭐ each org holds its own credentials", plaid.plaidCfg("obx").clientId, "cid-obx");
  eq("...separately", plaid.plaidCfg("me").clientId, "cid-me");
  eq("⭐ and its own environment", plaid.plaidCfg("obx").env, "production");
  eq("...defaulting to sandbox, never to live money", plaid.plaidCfg("me").env, "sandbox");
  eq("...which picks the right host", plaid.plaidCfg("obx").host, "production.plaid.com");
  eq("an org with no keys is simply not ready", plaid.plaidReady("nope"), false);

  /* ⚠️ a blank field must never wipe a working key */
  plaid.plaidSetConfig("obx", { clientId: "", secret: "" });
  eq("⛔ saving blanks does NOT clear an existing key", plaid.plaidCfg("obx").clientId, "cid-obx");
  plaid.plaidSetConfig("obx", { clear: true });
  eq("⭐ ...clearing is explicit and separate", plaid.plaidCfg("obx").clientId, "");

  /* the shared fallback, same shape as the Anthropic key */
  plaid.plaidSave({ [plaid.PLAID_SHARED]: { clientId: "shared", secret: "s" },
                    obx: { items: { i1: { accessToken: "A", itemId: "i1", label: "NFCU" } } },
                    me: { clientId: "own", secret: "s2", items: {} } });
  eq("an org with no key of its own can fall back to the shared one", plaid.plaidCfg("obx").clientId, "shared");
  eq("...and its own always wins", plaid.plaidCfg("me").clientId, "own");
  /* ⛔ THE ONE THING THAT MUST NOT BE SHARED */
  ok("⛔ bank CONNECTIONS are never inherited from the shared entry — one org must not see another's",
    Object.keys(plaid.plaidCfg("me").items).length === 0 && Object.keys(plaid.plaidCfg("obx").items).length === 1);
  ok("...and the reason is recorded", /one org seeing another's transactions/.test(PROSE(R("plaid.js"))));

  const st = plaid.plaidStatus("obx");
  ok("⛔ status still reveals no credential", !/shared|accessToken|"A"/.test(JSON.stringify(st).replace(/"org":"[^"]*"/, "")));
  eq("...and says which org it is for", st.org, "obx");

  ok("the card is in the app, under AI tools", /bankKeyCard/.test(CODE(R("js/32-admin.js"))));
  ok("...write-only: it can say a key is set, never what it is", !/clientId/.test(CODE(CLIENT).split("bankKeyCard")[1].split("function")[0] || ""));
  ok("⚠️ it warns the secret differs per environment — the usual first stumble", /different per environment/.test(PROSE(CLIENT)));
  ok("...and what sandbox actually means", /fake test banks/.test(PROSE(CLIENT)));

  try { if (had) fs.copyFileSync(tmp, plaid.PLAID_FILE); else fs.unlinkSync(plaid.PLAID_FILE); fs.unlinkSync(tmp); } catch (e) {}
}

console.log("\n--- every route is scoped to an org ---");
{
  const seg = CODE(SRV).slice(CODE(SRV).indexOf('/api/plaid/'), CODE(SRV).indexOf("/api/org-ai/assistant"));
  ok("⭐ reads require MEMBERSHIP of that org", /orgsForUser\(loadStore\(\), acct\)\.indexOf\(org\) < 0/.test(seg));
  ok("⭐ anything that writes requires OWNERSHIP", /writerOwnsOrg\(store, acct\.id, org\)/.test(seg));
  ok("...and the distinction is explained", /ownership, not membership/.test(PROSE(SRV)));
  ok("every plaid call passes the org through", /plaid\.plaidSyncItem\(org,/.test(seg) && /plaid\.plaidLinkToken\(org,/.test(seg));
  ok("an unknown sub-route is refused, not ignored", /unknown plaid route/.test(seg));
  ok("the client sends its current org on every call", (CLIENT.match(/org: bankOrg\(\)/g) || []).length >= 5);
}

console.log("\n--- ⛔ 4. the access token never reaches the browser ---");
{
  const tmp = plaid.PLAID_FILE + ".testbak";
  let had = false;
  try { fs.copyFileSync(plaid.PLAID_FILE, tmp); had = true; } catch (e) {}
  plaid.plaidSave({ obx: { clientId: "cid", secret: "SECRET_VALUE", env: "sandbox",
    items: { item_1: { accessToken: "access-sandbox-DO-NOT-LEAK", itemId: "item_1", label: "Navy Federal", cursor: "abc", accounts: {} } } } });

  const st = plaid.plaidStatus("obx");
  const json = JSON.stringify(st);
  ok("⛔ NO access token in what the client is given", !/access-sandbox-DO-NOT-LEAK/.test(json), json);
  ok("⛔ no secret either", !/SECRET_VALUE/.test(json));
  ok("⛔ nor the client id", !/"cid"/.test(json));
  ok("...it does say which banks are connected", /Navy Federal/.test(json));
  ok("...and whether it's sandbox or live", st.env === "sandbox");
  ok("...and whether it has ever pulled", st.items[0].everSynced === true);

  /* the status route is what serves this */
  ok("the status route returns exactly that object", /plaidStatus\(org\)/.test(CODE(SRV)));
  ok("⛔ no route ever returns an access token", !/accessToken/.test(CODE(SRV)));

  try { if (had) fs.copyFileSync(tmp, plaid.PLAID_FILE); else fs.unlinkSync(plaid.PLAID_FILE); fs.unlinkSync(tmp); } catch (e) {}
}

console.log("\n--- credentials stay out of git ---");
{
  ok("⭐ plaid-config.json is gitignored", /^plaid-config\.json$/m.test(GITIGNORE));
  ok("...alongside the other server secrets", /qb-config\.json/.test(GITIGNORE));
  ok("the file is written owner-only", /mode: 0o600/.test(R("plaid.js")));
  ok("⛔ no credential is hard-coded anywhere", !/client_id *: *"[a-z0-9]{8}/i.test(R("plaid.js")));
}

console.log("\n--- the routes ---");
{
  /* ⚠️ REWRITTEN for the per-org dispatcher. The five routes used to be five `if` blocks each repeating
     its own auth check; they are now one guarded dispatcher, so assert the PROPERTY — every route is
     reachable and nothing gets past the guard — rather than the old syntax. */
  const seg = CODE(SRV).slice(CODE(SRV).indexOf('/api/plaid/'), CODE(SRV).indexOf("/api/org-ai/assistant"));
  ["link-token", "exchange", "status", "sync", "commit", "config"].forEach(r => {
    ok('/api/plaid/' + r + " is handled", new RegExp('route === "' + r + '"').test(seg));
  });
  ok("⛔ the guard runs BEFORE any route is dispatched",
    seg.indexOf("writerOwnsOrg") < seg.indexOf('route === "link-token"'));
  ok("⛔ ...and there is no route reachable without it",
    !/route === "[a-z-]+"/.test(seg.slice(0, seg.indexOf("writerOwnsOrg"))) || /route === "status"/.test(seg.slice(0, seg.indexOf("writerOwnsOrg"))));
  ok("⭐ the SERVER never writes budget data from a bank pull — it returns rows",
    /rows: rows/.test(seg) && !/budgetTx/.test(seg));
  ok("...so the approval path is unchanged", /ledgerIngest/.test(CODE(CLIENT)));
  ok("⭐ ingested rows land pending, like any other source", /source: "bank"/.test(CODE(CLIENT)));
  ok("the API base URLs are the documented ones", /sandbox\.plaid\.com/.test(R("plaid.js")) && /production\.plaid\.com/.test(R("plaid.js")));
  ok("...and are overridable, since a wrong host is a one-line fix not a rebuild", /c\.host \|\|/.test(R("plaid.js")));
}

console.log("\n--- ⛔ pairing, and the cursor bug behind it ---");
{
  ok("⭐ a bank's accounts are offered for pairing with his own", /bankPairHTML/.test(CODE(CLIENT)));
  ok("...from what the bank already reported, needing no extra pull", /it\.known/.test(CODE(CLIENT)) && /plaidSaveAccounts/.test(CODE(SRV)));
  ok("...defaulting to NOT tracked rather than guessing", /not tracked/.test(CLIENT));
  ok("⛔ the saved account list carries names and masks only", (function () {
    const src = R("plaid.js").slice(R("plaid.js").indexOf("function plaidSaveAccounts"));
    return !/balance|available|current|account_number|routing/.test(src.slice(0, 600));
  })());

  /* ⛔⛔ THE BUG: dropping unmapped rows AND advancing the cursor loses them forever */
  ok("⭐ the cursor is NOT committed when rows were dropped for want of a pairing",
    /if \(unmapped\) \{[\s\S]{0,400}return;/.test(CODE(CLIENT)));
  ok("...and the commit call sits AFTER that guard",
    CODE(CLIENT).indexOf("if (unmapped)") < CODE(CLIENT).indexOf("/api/plaid/commit"));
  ok("...so he is told nothing was lost", /nothing was lost/.test(CLIENT));
  ok("the reason is recorded where someone would 'simplify' it",
    /would NEVER be offered again/.test(PROSE(R("js/150-bank-link.js"))));
  ok("⭐ ...naming when it would bite: the first sync of a new bank", /first sync of a new bank/.test(PROSE(CLIENT)));
}

console.log("\n--- ⚠️ the cursor: a failure must repeat, never skip ---");
{
  ok("⭐ the cursor is committed by a SEPARATE call, after the rows are saved",
    CODE(CLIENT).indexOf("ledgerIngest") < CODE(CLIENT).indexOf("/api/plaid/commit"));
  ok("...so a failed save simply repeats next time", /the failure mode is a repeat/.test(PROSE(CLIENT)));
  ok("⚠️ a failed page restarts from the ORIGINAL cursor, not a partial one", /restart from the ORIGINAL cursor/.test(PROSE(R("plaid.js"))));
  ok("...and nothing is persisted mid-run", /Nothing is persisted until the whole run succeeds/.test(PROSE(R("plaid.js"))));
  ok("paging is bounded, so a bad feed can't loop forever", /pages\+\+ < 40/.test(CODE(R("plaid.js"))));
  ok("both added AND modified rows are taken", /out\.added\.concat\(out\.modified\)/.test(CODE(SRV)));
}

console.log("\n--- ⚠️ it must not break file:// ---");
{
  ok("⛔ the Plaid script is NOT in the shell's script list", !/cdn\.plaid\.com/.test(SHELL));
  ok("⭐ ...it is fetched on demand, only when he taps Connect", /createElement\("script"\)/.test(CODE(CLIENT)));
  ok("⭐ ...and only over https", /location\.protocol === "https:"/.test(CODE(CLIENT)));
  ok("opened from a file, it says why instead of failing silently", /needs the app open over its https address/.test(PROSE(CLIENT)));
  ok("the client module itself IS in the shell, and loads without network", /js\/150-bank-link\.js/.test(SHELL));
  ok("a CDN failure is reported, not swallowed", /Couldn't reach Plaid/.test(CLIENT));
}

console.log("\n--- what he sees ---");
{
  ok("the card lives on Budget → Settings", /bankCardHTML/.test(CODE(BUD)));
  ok("⭐ it says plainly that nothing counts until he approves it", /until you approve it/.test(PROSE(CLIENT)));
  ok("...and warns when it's pointed at Plaid's sandbox", /sandbox/.test(CLIENT) && /test banks only/.test(CLIENT));
  ok("...and says where to set it up when it isn't", /Admin → AI tools/.test(PROSE(CLIENT)));
  ok("⚠️ the re-login error is named in words, not a code", /sign in again/.test(CLIENT));
}

console.log("\n--- ⭐ keys are VERIFIED on save, not just stored ---");
{
  /* Ray is setting these up for real (2026-08-27). The card already warns that the secret differs per
     environment and calls it "the usual first stumble" — and then the save didn't check. Warning about a
     mistake without testing for it is the worst of both: he reads the warning, believes he got it right,
     sees "Saved ✓", and finds out at Connect-a-bank with an opaque error, by which point the wrong secret is
     the last thing he'd suspect. */
  const PJ = R("plaid.js"), PJC = CODE(PJ);
  const SRVC = CODE(R("sync-server.js"));
  const BL = R("js/150-bank-link.js"), BLC = CODE(BL);

  ok("⭐ there is a verify step", /function plaidVerify/.test(PJC));
  ok("⭐ it probes with link/token/create — free, creates nothing, exercises id+secret+env together",
    /function plaidVerify[\s\S]{0,400}plaidLinkToken/.test(PJC));
  ok("⛔ it NEVER blocks the save — the keys are stored either way",
    /plaid\.plaidSetConfig\(org, p2\);[\s\S]{0,340}plaidVerify/.test(SRVC));
  ok("⭐ INVALID_API_KEYS is translated into the thing he'd have to go and do",
    /INVALID_API_KEYS/.test(PJ) && /DIFFERENT value per/.test(PJ));
  ok("...and a Transactions-not-enabled account is named as that, not as bad keys", /PRODUCTS_NOT_SUPPORTED/.test(PJ));
  ok("⭐ the card reports verified rather than claiming 'saved' on its own",
    /verified/.test(BLC) && /did not accept them/.test(BL));
  ok("⚠️ switching environment re-checks too — that IS the moment a good secret stops being valid",
    /j\.ready && !j\.verified/.test(BLC));

  /* the same timeout-less https.request that pinned "Cap is reading 1 of 1" was in this file too */
  ok("⏱ plaidCall has a socket deadline", /req\.setTimeout\(PLAID_TIMEOUT_MS/.test(PJC));
  ok("⛔ ...and cb can't fire twice when the deadline races the response", /cb = plaidOnce\(cb\)/.test(PJC));
  ok("⚠️ the cross-reference to the shared rule is recorded", /SAME DEADLINE RULE AS EVERY OTHER OUTBOUND CALL/.test(PJ));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
