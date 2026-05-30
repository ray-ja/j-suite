/*
 * J-Suite — QuickBooks Online bridge (scaffold)
 * Zero-dependency QBO OAuth2 + API helper used by sync-server.js.
 *
 * SETUP (you do this once):
 *   1. Create a free Intuit Developer account at developer.intuit.com
 *   2. Create an app, enable the "Accounting" scope.
 *   3. Copy qb-config.example.json -> qb-config.json and paste your
 *      Client ID, Client Secret, and redirect URI (http://localhost:4000/qb/callback).
 *   4. Start the server, then visit http://localhost:4000/qb/connect to authorize.
 *
 * Tokens are stored in qb-tokens.json (gitignored). Both config and tokens stay on
 * your machine and are never committed.
 *
 * NOTE: createInvoice() is a starting point — QBO usually wants an ItemRef on each line.
 * We'll finalize the field mapping when we test live against your company file.
 */
const https = require("https");
const fs = require("fs");
const path = require("path");
const querystring = require("querystring");

const DIR = __dirname;
const CONFIG_FILE = path.join(DIR, "qb-config.json");
const TOKENS_FILE = path.join(DIR, "qb-tokens.json");

function haveConfig() { return fs.existsSync(CONFIG_FILE); }
function cfg() { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); }
function loadTokens() { try { return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")); } catch (e) { return null; } }
function saveTokens(t) { fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2)); }
function apiHost(c) { return (c.environment === "production") ? "quickbooks.api.intuit.com" : "sandbox-quickbooks.api.intuit.com"; }

function httpsReq(opts, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, resp => {
      let d = ""; resp.on("data", c => d += c); resp.on("end", () => resolve({ status: resp.statusCode, body: d }));
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

async function tokenRequest(form) {
  const c = cfg();
  const body = querystring.stringify(form);
  const auth = Buffer.from(c.clientId + ":" + c.clientSecret).toString("base64");
  const resp = await httpsReq({
    hostname: "oauth.platform.intuit.com", path: "/oauth2/v1/tokens", method: "POST",
    headers: { "Authorization": "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "Content-Length": Buffer.byteLength(body) }
  }, body);
  const j = JSON.parse(resp.body || "{}");
  if (resp.status >= 400) throw new Error("QB token error: " + (j.error_description || j.error || resp.status));
  return j;
}

function authorizeUrl() {
  const c = cfg();
  return "https://appcenter.intuit.com/connect/oauth2?" + querystring.stringify({
    client_id: c.clientId, response_type: "code", scope: "com.intuit.quickbooks.accounting",
    redirect_uri: c.redirectUri, state: "jsuite"
  });
}

async function handleCallback(code, realmId) {
  const c = cfg();
  const t = await tokenRequest({ grant_type: "authorization_code", code: code, redirect_uri: c.redirectUri });
  t.realmId = realmId; t.obtained = Date.now(); saveTokens(t); return t;
}

async function validToken() {
  let t = loadTokens();
  if (!t) throw new Error("Not connected. Visit /qb/connect to authorize QuickBooks.");
  const age = (Date.now() - (t.obtained || 0)) / 1000;
  if (age > (t.expires_in || 3600) - 120) {
    const nt = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
    nt.realmId = t.realmId; nt.obtained = Date.now();
    if (!nt.refresh_token) nt.refresh_token = t.refresh_token;
    saveTokens(nt); t = nt;
  }
  return t;
}

async function apiGet(qpath) {
  const c = cfg(); const t = await validToken();
  const resp = await httpsReq({
    hostname: apiHost(c), path: "/v3/company/" + t.realmId + qpath, method: "GET",
    headers: { "Authorization": "Bearer " + t.access_token, "Accept": "application/json" }
  });
  return JSON.parse(resp.body || "{}");
}

async function apiPost(qpath, obj) {
  const c = cfg(); const t = await validToken(); const body = JSON.stringify(obj);
  const resp = await httpsReq({
    hostname: apiHost(c), path: "/v3/company/" + t.realmId + qpath, method: "POST",
    headers: { "Authorization": "Bearer " + t.access_token, "Accept": "application/json", "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
  }, body);
  return JSON.parse(resp.body || "{}");
}

// Pull a dashboard summary: number of open invoices and total unpaid (AR).
async function summary() {
  const q = encodeURIComponent("select * from Invoice where Balance > '0' maxresults 1000");
  const data = await apiGet("/query?query=" + q + "&minorversion=70");
  const inv = (data.QueryResponse && data.QueryResponse.Invoice) || [];
  const unpaid = inv.reduce((s, i) => s + (parseFloat(i.Balance) || 0), 0);
  return { openInvoices: inv.length, unpaid: Math.round(unpaid) };
}

// Push an invoice into QBO. payload: { customerId, lines:[{description, amount}] }
async function createInvoice(payload) {
  const Line = (payload.lines || []).map(l => ({
    DetailType: "SalesItemLineDetail", Amount: Number(l.amount) || 0,
    Description: l.description || "", SalesItemLineDetail: {}
  }));
  const obj = { Line: Line, CustomerRef: { value: String(payload.customerId) } };
  return await apiPost("/invoice?minorversion=70", obj);
}

module.exports = { haveConfig, authorizeUrl, handleCallback, summary, createInvoice };
