"use strict";
/* ---------- PLAID (server) — bank connections, and the transaction feed ------------------------------
   Ray, 2026-08-25: "plaid sounds fine."

   This is the server half: link tokens, the credential exchange, and pulling transactions. It hands what
   it pulls to the ledger's one door (ledgerIngest, js/143), so everything downstream — recognition,
   approval, learning, splits, statements — works exactly as it already does. A bank feed is just another
   source; that was the point of building the door first.

   ═══ FOUR THINGS THE DOCS SAY THAT ARE EASY TO GET BACKWARDS ═══

   ⚠️ 1. PLAID'S `amount` IS POSITIVE WHEN MONEY LEAVES THE ACCOUNT. Verified against the API reference,
   not remembered: "Positive values when money moves out of the account; negative values when money moves
   in." That is the inverse of the intuitive reading and the inverse of this app's `dir`. Get it wrong and
   every single transaction is filed as its own opposite — income as spending, spending as income — with
   perfect internal consistency and no error anywhere to notice.

   ⚠️ 2. A PENDING TRANSACTION IS NOT THE POSTED ONE. Plaid sends a purchase first as pending with one
   transaction_id, then again as posted with a DIFFERENT transaction_id, linking them by
   pending_transaction_id. Ingest both and every card purchase appears twice, past the externalId dedupe,
   because they genuinely are two different ids. ⭐ So pending rows are skipped entirely — which is also
   just correct for a cash-basis ledger: the cash moved when it posted.

   ⚠️ 3. THE FEED IS A CURSOR, NOT A DATE RANGE. /transactions/sync returns added/modified/removed since
   the last cursor. Store next_cursor per item or the same transactions arrive forever; page while
   has_more is true; and if a page fails, restart from the ORIGINAL cursor, not the failed one.

   ⚠️ 4. `removed` MEANS THE BANK RETRACTED IT. Usually a pending row that never posted. It has to be
   dropped from the queue or it sits there forever asking to be approved.

   ⛔ CREDENTIALS NEVER TOUCH GIT AND NEVER REACH THE CLIENT. plaid-config.json is gitignored alongside
   qb-config.json. The browser only ever sees a short-lived link_token; the access_token lives here. */

const fs = require("fs");
const path = require("path");
const https = require("https");

const PLAID_FILE = path.join(__dirname, "plaid-config.json");
const PLAID_HOSTS = { sandbox: "sandbox.plaid.com", production: "production.plaid.com" };
const PLAID_SHARED = "_shared";

/* ⭐ PER-ORGANISATION, AND ENTERED IN THE APP. Ray, 2026-08-26: "Just make an interface in the app where I
   can give you the plaid key… All the keys should be transmittable through the app. and it should be by
   organization."

   The shape mirrors org-ai-config.json exactly — an org's own credentials, falling back to a `_shared`
   entry — because that pattern already exists in this app for the Anthropic key and a second, subtly
   different one would be a thing to get wrong later. Each org can hold its own Plaid account, and its bank
   connections live under it, so linking a bank to OBX cannot pull transactions into the personal books.

   ⛔ A KEY GOES IN AND NEVER COMES OUT. plaidStatus() reports whether one is set, never what it is. */
function plaidLoad() { try { return JSON.parse(fs.readFileSync(PLAID_FILE, "utf8")); } catch (e) { return {}; } }
function plaidSave(m) {
  const tmp = PLAID_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, PLAID_FILE);
}
function plaidCfg(orgId) {
  const all = plaidLoad();
  const own = (orgId && all[orgId]) || {};
  const shared = all[PLAID_SHARED] || {};
  const c = (shared.clientId || shared.secret) ? Object.assign({}, shared, own) : own;
  const env = (c.env === "production") ? "production" : "sandbox";
  return { clientId: c.clientId || "", secret: c.secret || "", env: env,
           host: c.host || PLAID_HOSTS[env],
           /* ⚠️ items are NEVER inherited from _shared. A shared CREDENTIAL is a convenience; a shared bank
              CONNECTION would mean one org seeing another's transactions. */
           items: (own.items) || {} };
}
function plaidReady(orgId) { const c = plaidCfg(orgId); return !!(c.clientId && c.secret); }

/* save what he typed in the app. Only ever called behind an owner check on the route. */
function plaidSetConfig(orgId, patch) {
  if (!orgId) return false;
  const all = plaidLoad();
  const c = all[orgId] || {};
  if (typeof patch.clientId === "string" && patch.clientId.trim()) c.clientId = patch.clientId.trim().slice(0, 120);
  if (typeof patch.secret === "string" && patch.secret.trim()) c.secret = patch.secret.trim().slice(0, 200);
  if (patch.env === "sandbox" || patch.env === "production") c.env = patch.env;
  /* ⛔ clearing is explicit and separate — a blank field must never silently wipe a working key */
  if (patch.clear === true) { delete c.clientId; delete c.secret; }
  all[orgId] = c;
  plaidSave(all);
  return true;
}

/* one POST to Plaid. Credentials go in the BODY (the docs allow either; body keeps them out of any
   header-logging middleware). */
function plaidCall(orgId, endpoint, body, cb) {
  const c = plaidCfg(orgId);
  if (!c.clientId || !c.secret) return void setImmediate(() => cb(new Error("Plaid is not set up on this server")));
  const payload = JSON.stringify(Object.assign({ client_id: c.clientId, secret: c.secret }, body || {}));
  const req = https.request({ host: c.host, path: endpoint, method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
    res => {
      let d = "";
      res.on("data", ch => d += ch);
      res.on("end", () => {
        let j = null;
        try { j = JSON.parse(d); } catch (e) { return cb(new Error("Plaid sent something that isn't JSON")); }
        /* ⭐ Plaid's own error shape, surfaced rather than swallowed — "ITEM_LOGIN_REQUIRED" is the one he
           will actually hit (the bank wants him to log in again) and it needs to say so, not "failed". */
        if (j && j.error_code) return cb(Object.assign(new Error(j.error_message || j.error_code), {
          plaidCode: j.error_code, plaidType: j.error_type }));
        if (res.statusCode >= 400) return cb(new Error("Plaid HTTP " + res.statusCode));
        cb(null, j);
      });
    });
  req.on("error", e => cb(e));
  req.write(payload); req.end();
}

/* ---------- the connect flow ---------- */
function plaidLinkToken(orgId, userId, cb) {
  plaidCall(orgId, "/link/token/create", {
    client_name: "j-Suite",
    language: "en",
    country_codes: ["US"],
    user: { client_user_id: String(userId || "owner") },
    products: ["transactions"]
  }, cb);
}

/* exchange the browser's short-lived public_token for the long-lived access_token, and remember it */
function plaidExchange(orgId, publicToken, label, cb) {
  plaidCall(orgId, "/item/public_token/exchange", { public_token: publicToken }, (err, j) => {
    if (err) return cb(err);
    if (!j || !j.access_token) return cb(new Error("Plaid returned no access token"));
    const all = plaidLoad();
    const c = all[orgId] || (all[orgId] = {});
    c.items = c.items || {};
    c.items[j.item_id] = { accessToken: j.access_token, itemId: j.item_id,
      label: String(label || "Bank").slice(0, 60), cursor: "", linkedAt: Date.now(), accounts: {} };
    plaidSave(all);
    cb(null, { itemId: j.item_id });
  });
}

/* ---------- ⭐ the transaction shape, converted ---------- */
/* Plaid → the ledger's row shape. This function is the whole sign-convention risk, in one place, so it
   can be tested against fixtures without a network or a credential. */
function plaidToRow(t, accountMap) {
  if (!t || !t.transaction_id) return null;
  if (t.pending) return null;                       // ⭐ see note 2 in the header
  const amt = +t.amount;
  if (!isFinite(amt) || amt === 0) return null;
  return {
    externalId: t.transaction_id,
    date: String(t.date || "").slice(0, 10),
    /* ⚠️ POSITIVE = money OUT. This one line is note 1. */
    dir: amt > 0 ? "out" : "in",
    amount: Math.abs(amt),
    desc: String(t.merchant_name || t.name || "").slice(0, 200),
    accountId: (accountMap && accountMap[t.account_id]) || "",
    plaidAccountId: t.account_id
  };
}

/* ---------- the feed ---------- */
/* Pulls everything new for one item, paging until has_more is false. Returns the converted rows plus the
   removed ids and the cursor to store. Does NOT write anything — the caller decides. */
function plaidSyncItem(orgId, itemId, cb) {
  const c = plaidCfg(orgId);
  const item = c.items[itemId];
  if (!item || !item.accessToken) return void setImmediate(() => cb(new Error("unknown bank connection")));
  const startCursor = item.cursor || "";
  const added = [], removed = [], modified = [];
  let pages = 0;

  const page = (cursor) => {
    const body = { access_token: item.accessToken, count: 500 };
    if (cursor) body.cursor = cursor;
    plaidCall(orgId, "/transactions/sync", body, (err, j) => {
      /* ⚠️ note 3: a failed page restarts from the ORIGINAL cursor, never a partial one. Nothing is
         persisted until the whole run succeeds, so a mid-stream failure simply repeats next time. */
      if (err) return cb(err);
      (j.added || []).forEach(t => added.push(t));
      (j.modified || []).forEach(t => modified.push(t));
      (j.removed || []).forEach(r => { if (r && r.transaction_id) removed.push(r.transaction_id); });
      if (j.has_more && pages++ < 40) return page(j.next_cursor);
      cb(null, { itemId: itemId, cursor: j.next_cursor || startCursor,
                 added: added, modified: modified, removed: removed,
                 accounts: j.accounts || [] });
    });
  };
  page(startCursor);
}

/* store the cursor only after the caller has safely written the rows */
function plaidCommitCursor(orgId, itemId, cursor) {
  const all = plaidLoad();
  const c = all[orgId] || {};
  if (!c.items || !c.items[itemId]) return false;
  c.items[itemId].cursor = cursor || "";
  c.items[itemId].syncedAt = Date.now();
  plaidSave(all);
  return true;
}
/* remember what the bank told us its accounts are called, so the mapping screen can be drawn without
   forcing another pull. ⛔ Names and masks only — never balances, never numbers. */
function plaidSaveAccounts(orgId, itemId, accounts) {
  const all = plaidLoad();
  const c = all[orgId] || {};
  if (!c.items || !c.items[itemId]) return false;
  c.items[itemId].known = (accounts || []).map(a => ({
    id: a.account_id, name: a.name || a.official_name || "Account",
    mask: a.mask || "", type: a.subtype || a.type || ""
  }));
  plaidSave(all);
  return true;
}

/* map a Plaid account onto one of his budget accounts, so rows land in the right ledger */
function plaidMapAccount(orgId, itemId, plaidAccountId, budgetAccountId) {
  const all = plaidLoad();
  const c = all[orgId] || {};
  if (!c.items || !c.items[itemId]) return false;
  c.items[itemId].accounts = c.items[itemId].accounts || {};
  c.items[itemId].accounts[plaidAccountId] = budgetAccountId || "";
  plaidSave(all);
  return true;
}
function plaidForget(orgId, itemId) {
  const all = plaidLoad();
  const c = all[orgId] || {};
  if (!c.items || !c.items[itemId]) return false;
  delete c.items[itemId];
  plaidSave(all);
  return true;
}
/* ⛔ NEVER includes an access token — this is what the client is allowed to see */
function plaidStatus(orgId) {
  const c = plaidCfg(orgId);
  return {
    ready: plaidReady(orgId), env: c.env, org: orgId || "",
    items: Object.keys(c.items).map(id => ({
      itemId: id, label: c.items[id].label || "Bank",
      linkedAt: c.items[id].linkedAt || 0, syncedAt: c.items[id].syncedAt || 0,
      everSynced: !!c.items[id].cursor,
      accounts: c.items[id].accounts || {},
      known: c.items[id].known || []
    }))
  };
}

module.exports = {
  PLAID_FILE, PLAID_HOSTS, plaidCfg, plaidReady, plaidCall, plaidLinkToken, plaidExchange,
  plaidToRow, plaidSyncItem, plaidCommitCursor, plaidMapAccount, plaidForget, plaidStatus, plaidLoad, plaidSave, plaidSaveAccounts, plaidSetConfig, PLAID_SHARED
};
