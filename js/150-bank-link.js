/* ---------- BANK LINK (js/150) — the browser half of Plaid ------------------------------------------
   Ray, 2026-08-25: "plaid sounds fine."

   ⭐ THE FEED CHANGES NOTHING ABOUT HOW MONEY ENTERS THE APP. Rows come down from the server, go through
   ledgerIngest (js/143) exactly like a CSV, land PENDING, and wait for him on the Review tab. A bank
   connection cannot move a single number on its own — which is the whole reason the ingest door was built
   before anything was plugged into it.

   ⚠️ PLAID LINK IS AN EXTERNAL SCRIPT, AND THIS APP MUST STILL OPEN OVER file://. CLAUDE.md is explicit:
   no build step, no modules, and the shell has to load off the filesystem. So the Plaid script is NOT in
   the shell's script list — it is fetched on demand, only when he taps Connect, and only when the page is
   being served over https. Opened from a file, the button says why instead of failing silently.

   ⛔ THE ACCESS TOKEN NEVER COMES HERE. The browser sees a link_token that expires in four hours and is
   useless by itself. Everything else lives on the server. */

var PLAID_CDN = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
var BANK_STATUS = null;

function bankApiBase() { return (typeof phBase === "function") ? phBase() : (location.origin || ""); }
function bankToken() { try { return (typeof syncToken === "function") ? syncToken() : (localStorage.getItem("jsuite_token") || ""); } catch (e) { return ""; } }
function bankHeaders() { return { "Content-Type": "application/json", "Authorization": "Bearer " + bankToken() }; }

/* ⚠️ over file:// there is no origin to call and no https to load Link from */
function bankCanLink() { return /^https?:$/.test(location.protocol) && location.protocol === "https:"; }

function bankLoadPlaid(cb) {
  if (window.Plaid) return cb(null);
  var s = document.createElement("script");
  s.src = PLAID_CDN;
  s.onload = function () { cb(window.Plaid ? null : new Error("Plaid didn't load")); };
  s.onerror = function () { cb(new Error("Couldn't reach Plaid — check the connection")); };
  document.head.appendChild(s);
}

function bankRefresh(cb) {
  fetch(bankApiBase() + "/api/plaid/status", { headers: bankHeaders() })
    .then(function (r) { return r.json(); })
    .then(function (j) { BANK_STATUS = j; if (cb) cb(j); })
    .catch(function () { BANK_STATUS = { ready: false, items: [] }; if (cb) cb(BANK_STATUS); });
}

/* ---------- connect ---------- */
function bankConnect() {
  if (!bankCanLink()) {
    alert("Bank linking needs the app open over its https address, not from a file.");
    return;
  }
  fetch(bankApiBase() + "/api/plaid/link-token", { method: "POST", headers: bankHeaders(), body: "{}" })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j || !j.link_token) throw new Error(j && j.error ? j.error : "no link token");
      bankLoadPlaid(function (err) {
        if (err) { alert(err.message); return; }
        var handler = window.Plaid.create({
          token: j.link_token,
          onSuccess: function (publicToken, meta) {
            var label = (meta && meta.institution && meta.institution.name) || "Bank";
            fetch(bankApiBase() + "/api/plaid/exchange", { method: "POST", headers: bankHeaders(),
              body: JSON.stringify({ public_token: publicToken, label: label }) })
              .then(function (r) { return r.json(); })
              .then(function (out) {
                if (out && out.error) { alert(out.error); return; }
                bankRefresh(function () { if (typeof render === "function") render(); });
                if (typeof toast === "function") toast("Connected " + label);
              });
          },
          onExit: function (e) { if (e && e.error_message) alert(e.error_message); }
        });
        handler.open();
      });
    })
    .catch(function (e) { alert("Couldn't start the bank connection: " + (e.message || e)); });
}

/* ---------- pull ---------- */
/* ⭐ THE ORDER HERE MATTERS. Ingest first, save, and only then tell the server to advance its cursor. If
   anything fails in between, the cursor stays where it was and the same rows simply arrive again next
   time — the failure mode is a repeat, which the externalId dedupe absorbs, rather than a silent hole. */
function bankSync(itemId) {
  if (typeof ledgerIngest !== "function") return;
  fetch(bankApiBase() + "/api/plaid/sync", { method: "POST", headers: bankHeaders(), body: JSON.stringify({ itemId: itemId }) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j && j.error) {
        /* ⚠️ the error he will actually hit: the bank wants him to sign in again */
        if (j.code === "ITEM_LOGIN_REQUIRED") alert("Your bank needs you to sign in again — reconnect it and it'll pick up where it left off.");
        else alert(j.error);
        return;
      }
      var rows = (j.rows || []).filter(function (r) { return r.accountId; });
      var unmapped = (j.rows || []).length - rows.length;
      var res = { added: 0, duplicates: 0 };
      if (rows.length) res = ledgerIngest(rows, { source: "bank" });

      /* ⚠️ a retracted transaction has to leave the queue, or it waits there forever to be approved */
      var dropped = bankDropRemoved(j.removed || []);

      /* ⛔⛔ DO NOT ADVANCE THE CURSOR IF ANYTHING WAS DROPPED FOR WANT OF A MAPPING. A row whose Plaid
         account isn't paired to one of his budget accounts is filtered out above — and committing the
         cursor anyway would tell Plaid "I have those", so they would NEVER be offered again. Silent,
         permanent loss of real transactions, on the very first sync of a new bank, which is exactly when
         nothing is mapped yet. Holding the cursor means the same rows simply arrive again once he has
         paired the accounts. The failure mode has to be a repeat, never a hole. */
      if (unmapped) {
        bankRefresh(function () { if (typeof render === "function") render(); });
        alert(unmapped + " transaction" + (unmapped === 1 ? "" : "s") + " came from an account that isn't paired"
          + " with one of your accounts yet.\n\nPair them below and hit Get transactions again — nothing was lost.");
        return;
      }

      fetch(bankApiBase() + "/api/plaid/commit", { method: "POST", headers: bankHeaders(),
        body: JSON.stringify({ itemId: itemId, cursor: j.cursor }) })
        .then(function () { bankRefresh(function () { if (typeof render === "function") render(); }); });

      var msg = res.added + " to review";
      if (res.duplicates) msg += " · " + res.duplicates + " already here";
      if (dropped) msg += " · " + dropped + " withdrawn by the bank";
      if (unmapped) msg += " · " + unmapped + " from an unmatched account";
      if (typeof toast === "function") toast(msg);
      if (typeof BUDGET_SUB !== "undefined" && res.added) BUDGET_SUB = "review";
    })
    .catch(function (e) { alert("Sync failed: " + (e.message || e)); });
}

/* Plaid retracted these — drop the ones still waiting. ⛔ An APPROVED transaction is left alone and
   reported instead: silently deleting money he has already reviewed is not a thing this does. */
function bankDropRemoved(ids) {
  if (!ids || !ids.length) return 0;
  var n = 0;
  try {
    var d = D();
    (d.budgetTx || []).forEach(function (t) {
      if (!t || t.deleted || !t.externalId) return;
      if (ids.indexOf(t.externalId) < 0) return;
      if (!t.pending) return;                       // ⛔ already approved — his, not mine to remove
      t.deleted = true; if (typeof touch === "function") touch(t); n++;
    });
    if (n && typeof save === "function") save();
  } catch (e) {}
  return n;
}

/* ⭐ PAIRING. A bank connection can hold several accounts; each has to be told which of HIS accounts it
   is, or its transactions have nowhere to land. Drawn from what the bank reported on the last pull, so it
   needs no extra call. */
function bankPairHTML(it) {
  var known = it.known || [];
  if (!known.length) {
    return '<div class="sub" style="white-space:normal;margin:2px 0 8px 10px">'
      + 'Hit <b>Get transactions</b> once and the accounts in this bank will appear here to pair.</div>';
  }
  var mine = [];
  try { mine = (D().budgetAccounts || []).filter(function (a) { return a && !a.deleted; }); } catch (e) {}
  var map = it.accounts || {};
  return '<div style="margin:2px 0 10px 10px">' + known.map(function (a) {
    var sel = map[a.id] || "";
    return '<div class="row" style="gap:8px;align-items:center;padding:4px 0">'
      + '<div class="grow" style="min-width:0"><div class="sub">' + esc(a.name)
      +   (a.mask ? ' ····' + esc(a.mask) : '') + '</div></div>'
      + '<select style="width:auto;max-width:58%" onchange="bankPair(\'' + esc(it.itemId) + '\',\'' + esc(a.id) + '\',this.value)">'
      + '<option value="">— not tracked —</option>'
      + mine.map(function (m) {
          return '<option value="' + esc(m.id) + '"' + (sel === m.id ? " selected" : "") + '>' + esc(m.name) + '</option>';
        }).join("")
      + '</select></div>';
  }).join("")
  + '<div class="sub" style="white-space:normal;margin-top:4px">Anything left <i>not tracked</i> is skipped — '
  + 'its transactions won\'t be pulled in.</div></div>';
}

/* ---------- the card, on Budget → Settings ---------- */
function bankCardHTML() {
  var st = BANK_STATUS;
  var h = '<div class="secthd"><h2>Bank connections</h2></div><div class="card">';
  if (!st) { bankRefresh(function () { if (typeof render === "function") render(); });
    return h + '<div class="sub">Checking…</div></div>'; }

  if (!st.ready) {
    return h + '<div class="sub" style="white-space:normal">Not set up on the server yet. '
      + 'It needs a Plaid client ID and secret in <b>plaid-config.json</b> — that file is gitignored and never leaves this machine.</div></div>';
  }
  if (st.env === "sandbox") {
    h += '<div class="sub" style="white-space:normal;margin-bottom:8px">Running against Plaid\'s <b>sandbox</b> — '
      + 'test banks only, no real accounts.</div>';
  }
  (st.items || []).forEach(function (it) {
    h += '<div class="li"><div class="grow"><div class="nm">' + esc(it.label) + '</div>'
      + '<div class="sub">' + (it.syncedAt ? 'last checked ' + esc(new Date(it.syncedAt).toISOString().slice(0, 10))
                                           : 'never pulled yet') + '</div></div>'
      + '<button class="btn ghost sm" style="flex:0 0 auto;width:auto" onclick="bankSync(\'' + esc(it.itemId) + '\')">Get transactions</button></div>';
    h += bankPairHTML(it);
  });
  if (!(st.items || []).length) h += '<div class="sub" style="white-space:normal">No banks connected yet.</div>';

  h += '<button class="btn acc" style="width:100%;margin-top:10px" onclick="bankConnect()">＋ Connect a bank</button>';
  if (!bankCanLink()) {
    h += '<div class="sub" style="white-space:normal;margin-top:6px">Open the app at its https address to connect a bank.</div>';
  }
  h += '<div class="sub" style="white-space:normal;margin-top:8px">Anything pulled in lands on the '
    + '<b>Review</b> tab first. Nothing counts toward your budget until you approve it.</div>';
  return h + '</div>';
}

if (typeof window !== "undefined") {
  window.bankConnect = bankConnect; window.bankSync = bankSync; window.bankRefresh = bankRefresh;
  window.bankPairHTML = bankPairHTML;
  window.bankPair = function (itemId, plaidAccountId, budgetAccountId) {
    fetch(bankApiBase() + "/api/plaid/commit", { method: "POST", headers: bankHeaders(),
      body: JSON.stringify({ itemId: itemId, map: { plaidAccountId: plaidAccountId, budgetAccountId: budgetAccountId } }) })
      .then(function () { bankRefresh(function () { if (typeof render === "function") render(); }); });
  };
  window.bankCardHTML = bankCardHTML; window.bankDropRemoved = bankDropRemoved; window.bankCanLink = bankCanLink;
}
