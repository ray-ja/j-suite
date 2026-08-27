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
  ok("...defaulting to no decision rather than guessing — and a guess about which of two identically-named\n     accounts is his wife's is exactly the guess not to make",
    /— not decided yet —/.test(CLIENT));
  /* ⛔ THE LINE THAT STILL HOLDS: no account or routing numbers, ever. That is the real privacy boundary and
     nothing needs them.
     ⚠️ RELAXED 2026-08-27 FOR BALANCE, DELIBERATELY. Navy Federal sent two accounts called "EveryDay
     Checking", two called "Share Savings" and two called "Used Vehicle Loan" — the balance is one of only two
     things that tells them apart, and the Visa has no mask at all, so on that one it is the only thing. It
     has to survive a page load or the pairing screen goes ambiguous again the moment he navigates away.
     The file already holds long-lived access tokens, is mode 600 and gitignored, so a balance is not an
     escalation — but a STALE balance reading as current would be, which is why the screen dates it. */
  ok("⛔ no account or routing numbers are ever stored", (function () {
    const src = R("plaid.js").slice(R("plaid.js").indexOf("function plaidSaveAccounts"));
    return !/account_number|routing|available/.test(src.slice(0, 900));
  })());
  ok("⭐ the stored balance is shown DATED, so it can't be misread as live",
    /Balances shown are from the/.test(CLIENT) && /not as a live figure/.test(CLIENT));

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

console.log("\n--- ⛔ setting up and using it must be the same screen ---");
{
  /* 2026-08-27: Ray saved his Plaid keys on OBX and they verified against production in 218ms — and then
     there was nowhere to go. `budget` is in ORG_OPTIN_TABS and OBX does not have it enabled, while the
     ＋ Connect a bank list rendered ONLY from the Budget screen. Two screens apart, and one of them did not
     exist in the org he had just set up. A setup flow that dead-ends after the hard part is worse than one
     that never started, because he has no way to tell whether the keys took. */
  const ADM = CODE(R("js/32-admin.js"));
  ok("⭐ the key card and the connect card are on the same screen",
    /bankKeyCard\(\)/.test(ADM) && /bankCardHTML\(/.test(ADM));
  ok("...in that order — keys first, then what they unlock",
    ADM.indexOf("bankKeyCard()") < ADM.indexOf("bankCardHTML("));
  ok("⭐ Budget keeps its copy, so the two can't drift apart",
    /bankCardHTML==="function"/.test(CODE(R("js/79-budget.js"))));
  ok("⚠️ and why is recorded", /ORG_OPTIN_TABS tab that OBX does not have enabled/.test(R("js/32-admin.js")));

  /* the reachability rule this came from, checked directly rather than by memory */
  const RT = R("js/03-routing.js");
  const optin = (RT.match(/const ORG_OPTIN_TABS = \[([^\]]*)\]/) || [, ""])[1];
  ok("⚠️ budget IS opt-in, so no org gets it by default", /"budget"/.test(optin), optin);
  ok("⭐ admin is CORE, so the bank cards are reachable in every org",
    /const ORG_CORE_TABS = \[[^\]]*"admin"/.test(RT));
}

console.log("\n--- ⛔ a key lands in an ORG, and that has to be a decision ---");
{
  /* Ray, 2026-08-27: "oh my bad those keys should have gone on the personal page." He had just entered a live
     production credential against OBX. The org name was already in the card's heading — and that was never
     going to be enough, because he came to type a key, not to audit which org he was standing in.
     ⚠️ Getting it wrong does not fail. It succeeds, into the wrong ledger. */
  const BL = R("js/150-bank-link.js"), BLC = CODE(BL);
  ok("⭐ the destination org is confirmed by name", /confirm\("Save Plaid keys to " \+ orgLabel/.test(BLC));
  ok("⭐ ...BEFORE the secret is asked for, while changing your mind is free",
    BLC.indexOf("confirm(\"Save Plaid keys to") < BLC.indexOf("prompt(\"Plaid client_id"));
  ok("⭐ and it says what the choice actually controls", /transactions land in/.test(BL));
  ok("...and that nothing has been saved yet", /nothing is saved yet/.test(BL));
  ok("⭐ the secret prompt names the org too", /Plaid secret for " \+ orgLabel/.test(BLC));
}

console.log("\n--- ⛔ an <h2> inside a section becomes a SUB-TAB (js/156) ---");
{
  /* Ray, 2026-08-27: "i dont see connect a bank." He was on Admin → AI tools, where I had put the card the
     day before. It was there — as its OWN sub-tab, several clicks away at the end of the row.
     ⚠️ js/156 splits Admin and Settings by walking their <h2> elements. So a card that emits a heading and is
     rendered INSIDE another section does not join that section; it silently becomes one, and being absent
     from SEC_ORDER it sorts to rank 999 — last. I wrote that splitter and then fed it a heading without
     thinking about what that means. */
  const vm = require("vm");
  const ctx = { console };
  ctx.window = ctx;
  ctx.esc = x => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  ctx.S = { biz: "mqwvs3mq98pij", sync: { url: "https://app.jsuite.dev", token: "t" } };
  ctx.orgName = id => "RBJVL";
  ctx.location = { protocol: "https:", origin: "https://app.jsuite.dev" };
  ctx.document = { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {} }) };
  ctx.fetch = () => new Promise(() => {});
  vm.createContext(ctx);
  vm.runInContext(R("js/150-bank-link.js"), ctx);
  ctx.BANK_STATUS = { ready: true, env: "production", org: "mqwvs3mq98pij", items: [], verified: true };

  const bare = ctx.bankCardHTML({ bare: true });
  const full = ctx.bankCardHTML();
  ok("⭐⭐ bare emits NO <h2>, so it stays inside the section it was placed in", !/<h2/.test(bare));
  ok("⛔ ...while the standalone form still has its heading for the Budget screen", /<h2>Bank connections<\/h2>/.test(full));
  ok("⭐⭐ and the button he was looking for is actually in the bare card", /Connect a bank/.test(bare), bare.slice(0, 120));
  ok("⭐ Admin passes bare:true", /bankCardHTML\(\{ bare: true \}\)/.test(CODE(R("js/32-admin.js"))));

  /* the whole AI-tools section must contain exactly ONE heading — its own */
  const section = "<h2>AI tools</h2>" + ctx.bankKeyCard() + bare;
  ok("⭐⭐ the AI tools section has exactly one <h2> — extra ones would each become a tab",
    (section.match(/<h2/g) || []).length === 1, (section.match(/<h2/g) || []).length);

  ok("⚠️ the trap is written down where the next card gets added", /becomes a section of its own/.test(R("js/150-bank-link.js")));
  ok("⭐ and js/156 is the thing that makes it true", /secHeadOf/.test(CODE(R("js/156-section-tabs.js"))));
}

console.log("\n--- 🏦 seven accounts, three names: the pairing screen ---");
{
  /* Ray, 2026-08-27: "it grabbed a bunch of my navy federal accounts like my wifes and my car loans all of
     which is fine but you may need to organize a bit."
     ⚠️ WHAT NAVY FEDERAL ACTUALLY SENT — verified against his live item, not imagined:
        EveryDay Checking ····5377 $502.12   ·   EveryDay Checking ····9652 $46.85
        Share Savings     ····0301 $5.03     ·   Share Savings     ····3621 $5.01
        Used Vehicle Loan ····1319 $16,898   ·   Used Vehicle Loan ····6172 $16,158
        Visa Signature cashRewards Plus — mask NULL — $23,644
     Three names for seven accounts. Mask and balance are the only discriminators, and the Visa has no mask. */
  const vm = require("vm");
  const ctx = { console }; ctx.window = ctx;
  ctx.esc = x => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  ctx.money = n => "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  ctx.S = { biz: "o", sync: { url: "https://x", token: "t" } };
  ctx.orgName = () => "RBJVL";
  ctx.location = { protocol: "https:", origin: "https://x" };
  ctx.document = { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {} }) };
  ctx.fetch = () => new Promise(() => {});
  ctx.D = () => ({
    budgetAccounts: [{ id: "bgt-acct-nfcu-personal", bookId: "bk1", name: "Navy Federal — checking", deleted: false }],
    budgetBooks: [{ id: "bk1", name: "Personal", deleted: false }, { id: "bk2", name: "OBX Lot Solutions", deleted: false }]
  });
  vm.createContext(ctx);
  vm.runInContext(R("js/150-bank-link.js"), ctx);

  const KNOWN = [
    { id: "a1", name: "EveryDay Checking", mask: "5377", type: "depository", subtype: "checking", balance: 502.12 },
    { id: "a2", name: "EveryDay Checking", mask: "9652", type: "depository", subtype: "checking", balance: 46.85 },
    { id: "a3", name: "Share Savings", mask: "0301", type: "depository", subtype: "savings", balance: 5.03 },
    { id: "a4", name: "Share Savings", mask: "3621", type: "depository", subtype: "savings", balance: 5.01 },
    { id: "a5", name: "Visa Signature cashRewards Plus", mask: "", type: "credit", subtype: "credit card", balance: 23644.53 },
    { id: "a6", name: "Used Vehicle Loan", mask: "1319", type: "loan", subtype: "loan", balance: 16898.66 },
    { id: "a7", name: "Used Vehicle Loan", mask: "6172", type: "loan", subtype: "loan", balance: 16158.36 }
  ];
  const html = ctx.bankPairHTML({ itemId: "i1", known: KNOWN, accounts: {} });

  ok("⭐ grouped by what the account IS", /Checking &amp; savings/.test(html) && /Credit cards/.test(html) && /Loans/.test(html));
  ok("...with a count per group", /Checking &amp; savings<\/b>? ?<span[^>]*>\(4\)/.test(html) || /\(4\)/.test(html));
  ok("⭐⭐ every row carries the mask, because the NAMES COLLIDE",
    /5377/.test(html) && /9652/.test(html) && /0301/.test(html) && /3621/.test(html) && /1319/.test(html) && /6172/.test(html));
  ok("⭐⭐ and the balance, which on the maskless Visa is the ONLY discriminator",
    /502\.12/.test(html) && /46\.85/.test(html) && /23,644\.53/.test(html));
  ok("⛔ the maskless Visa says so rather than showing a blank", /no number shown/.test(html));
  /* ⚠️ REVERSED 2026-08-27 BY RAY, AND HE WAS RIGHT. This asserted the opposite yesterday — that loans were
     left untracked because the car payment already leaves checking and counting the loan side too would
     double it. That is only true if the two sides are never connected. They ARE: ledgerFindTransfer pairs
     opposite legs and marks both isTransfer, which keeps them out of income and spending while still moving
     both balances. So the second side isn't a double-count, it's the CHECK on the first — and tracking only
     one side is what actually loses information, because the money looks like it left. */
  ok("⭐ loans are worth tracking, and it says why", /worth tracking/.test(html) && /nothing is counted twice/.test(html));
  ok("⛔ the old 'leave loans untracked' guidance is gone", !/left untracked on purpose/.test(html));
  ok("⭐ and the screen asks him to pair all of them", /Pair all of them if you can/.test(html));
  ok("...explaining that one-sided tracking is the lossy option", /only moved rooms/.test(html));
  ok("⛔ nothing is pre-paired — every row defaults to don't import", !/selected/.test(html));
  ok("⭐ each row offers to create the matching account inline", (html.match(/__new__/g) || []).length === 7,
    (html.match(/__new__/g) || []).length);
  ok("⭐ existing accounts show which book they're in, so the twins can't be mixed up", /\(Personal\)/.test(html));

  /* grouping itself, including the OLD collapsed shape that a bank linked before today still has on disk */
  const g = ctx.bankGroupOf;
  ok("⭐ live shape groups right", g(KNOWN[0]) === "cash" && g(KNOWN[4]) === "credit" && g(KNOWN[5]) === "loan");
  ok("⭐⭐ the OLD collapsed shape (type:'credit card' / 'checking') still groups right — no re-sync needed",
    g({ type: "credit card" }) === "credit" && g({ type: "checking" }) === "cash" && g({ type: "savings" }) === "cash");
  ok("⛔ something unrecognised lands in Other, never silently in spending", g({ type: "brokerage" }) === "other");

  /* and the storage bug that would have made all of the above group as "other" */
  const PJC = CODE(R("plaid.js"));
  ok("⭐ plaidSaveAccounts keeps type AND subtype, not one collapsed into the other",
    /type: a\.type \|\| ""/.test(PJC) && /subtype: a\.subtype \|\| ""/.test(PJC));
  ok("⭐ ...and the balance", /balances && a\.balances\.current/.test(PJC));
  ok("⚠️ the collapse and why it mattered is written down", /collapse subtype into type|COLLAPSE SUBTYPE INTO TYPE/i.test(R("plaid.js")));

  /* the inline account it creates must be a normal budgetAccounts record, with a stable id */
  const BL = CODE(R("js/150-bank-link.js"));
  ok("⭐ a created account gets a DERIVED id, so re-pairing can't duplicate it",
    /"bgt-acct-plaid-" \+ String\(plaidAccountId\)/.test(BL));
  ok("⭐ it asks which BOOK — that's what keeps his wife's money out of the business numbers",
    /Which set of books does it belong to/.test(R("js/150-bank-link.js")));
  ok("⭐ and it saves through the normal path so it syncs like any other record",
    /d\.budgetAccounts\.push\(rec\)/.test(BL) && /typeof save === "function"/.test(BL));
}

console.log("\n--- ⛔ 'declined' and 'undecided' are different answers ---");
{
  /* ⚠️ FOUND WHILE WIRING RAY'S SEVEN ACCOUNTS, 2026-08-27. The client refuses to advance the cursor while
     any row lands unmapped — correct, because committing it would tell Plaid "I have those" and lose them.
     But with only ONE unmapped state, deliberately declining an account DEADLOCKED the feed: the same rows
     arrived on every pull forever and the bank could never finish syncing. The dropdown offered "don't
     import" as though it were a choice; it was a trap. */
  const P = require("./plaid.js");
  ok("⭐ there is an explicit decline value", P.PLAID_IGNORE === "__ignore__");

  const tx = id => ({ transaction_id: "t" + id, date: "2026-08-05", amount: 10, name: "X", account_id: id });
  const map = { paired: "bgt-acct-1", declined: P.PLAID_IGNORE };
  const rPaired = P.plaidToRow(tx("paired"), map);
  const rDeclined = P.plaidToRow(tx("declined"), map);
  const rUnknown = P.plaidToRow(tx("never-seen"), map);

  ok("⭐ a paired account resolves to its budget account", rPaired.accountId === "bgt-acct-1" && rPaired.ignored === false);
  ok("⭐⭐ a DECLINED account yields no accountId but IS flagged ignored",
    rDeclined.accountId === "" && rDeclined.ignored === true);
  ok("⛔ ...and the sentinel never leaks into accountId as if it were a real account",
    rDeclined.accountId !== P.PLAID_IGNORE);
  ok("⭐ an UNDECIDED account is unmapped and NOT ignored — it still holds the cursor",
    rUnknown.accountId === "" && rUnknown.ignored === false);

  const BL = CODE(R("js/150-bank-link.js"));
  ok("⭐⭐ the client subtracts declined rows before deciding to hold the cursor",
    /var declined = \(j\.rows \|\| \[\]\)\.filter\(function \(r\) \{ return !r\.accountId && r\.ignored; \}\)\.length;/.test(BL)
    && /var unmapped = \(j\.rows \|\| \[\]\)\.length - rows\.length - declined;/.test(BL));
  ok("⛔ the cursor guard itself is untouched — undecided rows still stop it",
    /if \(unmapped\) \{[\s\S]{0,400}return;/.test(BL));
  ok("⭐ the dropdown separates the two answers",
    /— not decided yet —/.test(BL) && /Never import this one/.test(BL));
  ok("...and says what each one does", /holds the\s*'\s*\+\s*'sync/.test(R("js/150-bank-link.js")) || /holds the/.test(R("js/150-bank-link.js")));
  ok("⚠️ the deadlock is written down where someone would collapse the states again",
    /deadlock/.test(R("plaid.js")) && /DIFFERENT ANSWERS/.test(R("plaid.js")));
}

console.log("\n--- ⛔ an account list belongs to the ITEM, not to a transactions page ---");
{
  /* Ray connected six more banks, 2026-08-27, and every one showed an empty pairing list. Navy Federal —
     the one bank that HAD synced — showed 4 accounts while 7 were paired underneath.
     ⚠️ TWO CAUSES, ONE WRONG IDEA. `known` was only ever written by a /transactions/sync response, and that
     response's `accounts` array carries only the accounts THAT PAGE touched. So: a bank that had never
     synced listed nothing, and a partial page silently DELETED the accounts it didn't mention. The old UI
     even told him to "hit Get transactions once and the accounts will appear" — backwards, because the rows
     then arrive with nowhere to go and are held back while he's asked to pair accounts he can't see. */
  const PJ = R("plaid.js"), PJC = CODE(PJ);
  ok("⭐⭐ accounts are fetched at LINK time", /plaidCall\(orgId, "\/accounts\/get"[\s\S]{0,200}plaidSaveAccounts/.test(PJC));
  ok("⛔ ...and a failure there is not an error — the item is already linked",
    /if \(!e2 && acc && Array\.isArray\(acc\.accounts\)\)/.test(PJC));
  ok("⭐⭐ plaidSaveAccounts MERGES — a partial page can add or update, never remove",
    /const prev = c\.items\[itemId\]\.known \|\| \[\];/.test(PJC) && /byId\[a\.account_id\] = \{/.test(PJC));
  ok("...and a merge that omits a balance keeps the one it had",
    /byId\[a\.account_id\] \? byId\[a\.account_id\]\.balance : null/.test(PJC));
  ok("⭐ there is a repair path for banks linked before this", /function plaidRefreshAccounts/.test(PJC));
  ok("...routed and reachable", /route === "refresh-accounts"/.test(CODE(R("sync-server.js")))
    && /bankRefreshAccounts/.test(CODE(R("js/150-bank-link.js"))));
  ok("⛔ the empty list no longer tells him to pull transactions first",
    !/accounts in this bank will appear here to pair/.test(R("js/150-bank-link.js")));
  ok("⚠️ and why that instruction was backwards is recorded", /rows would arrive with nowhere to go/.test(R("js/150-bank-link.js")));

  /* the merge, exercised rather than grepped */
  const os = require("os"), fsx = require("fs"), pathx = require("path");
  const dir = fsx.mkdtempSync(pathx.join(os.tmpdir(), "plaidmerge-"));
  const cfgFile = pathx.join(dir, "plaid-config.json");
  fsx.writeFileSync(cfgFile, JSON.stringify({ o: { clientId: "c", secret: "s", env: "sandbox",
    items: { it1: { accessToken: "t", itemId: "it1", cursor: "", accounts: {}, known: [] } } } }));
  const vm2 = require("vm");
  const mod = { exports: {} };
  const ctx2 = { module: mod, exports: mod.exports, require, __dirname: dir, console, process, setImmediate, Buffer };
  vm2.createContext(ctx2);
  vm2.runInContext(PJ, ctx2);
  const M = mod.exports;
  const full = [
    { account_id: "A", name: "EveryDay Checking", mask: "5377", type: "depository", subtype: "checking", balances: { current: 502.12 } },
    { account_id: "B", name: "Share Savings", mask: "0301", type: "depository", subtype: "savings", balances: { current: 5.03 } },
    { account_id: "C", name: "Used Vehicle Loan", mask: "1319", type: "loan", subtype: "loan", balances: { current: 16898.66 } }
  ];
  M.plaidSaveAccounts("o", "it1", full);
  let known = M.plaidCfg("o").items.it1.known;
  ok("⭐ a full list lands", known.length === 3, known.length);

  /* now the partial page that used to wipe the rest */
  M.plaidSaveAccounts("o", "it1", [{ account_id: "A", name: "EveryDay Checking", mask: "5377", type: "depository", subtype: "checking", balances: { current: 480.00 } }]);
  known = M.plaidCfg("o").items.it1.known;
  ok("⭐⭐ a PARTIAL page does not delete the other two — this is the bug he hit", known.length === 3, known.length);
  ok("...the mentioned one is updated", known.find(k => k.id === "A").balance === 480);
  ok("...and the unmentioned ones keep their balances",
    known.find(k => k.id === "B").balance === 5.03 && known.find(k => k.id === "C").balance === 16898.66);
  try { fsx.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
