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
/* ⛔⛔ THE TOKEN IS S.sync.token. NOTHING ELSE. Ray, 2026-08-27: "I put in the client ID, and then it says
   put in the secret… It said forbidden. So neither one works anyways."

   ⚠️ IT WAS NEVER PLAID, AND IT WAS NEVER THE KEYS. This used to read `syncToken()` with a localStorage
   fallback — and `syncToken` DOES NOT EXIST ANYWHERE IN THIS APP, nor does anything ever write a
   "jsuite_token" key. I invented two accessors that sounded plausible and never once called them against a
   live server. So bankToken() returned "" every time, every request went out as `Authorization: Bearer `,
   the server resolved no account, and the guard answered 403 "forbidden" before Plaid was ever contacted.
   The bank feed could not have worked a single time, for anybody, since the day it was written.

   ⭐ Every other module reads the token the same way (js/26, js/32, js/111, js/122): S.sync.token. There was
   a working convention sitting right there and I didn't use it. */
function bankToken() { try { return (typeof S !== "undefined" && S.sync && S.sync.token) || ""; } catch (e) { return ""; } }
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

function bankOrg() { try { return S.biz; } catch (e) { return ""; } }
function bankRefresh(cb) {
  fetch(bankApiBase() + "/api/plaid/status?org=" + encodeURIComponent(bankOrg()), { headers: bankHeaders() })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      /* ⚠️ "not set up" and "not allowed to ask" are different problems wearing the same empty card. Keep the
         error so the card can say which — this is what let a pure auth failure read as missing keys. */
      BANK_STATUS = (j && j.error) ? { ready: false, items: [], error: j.error } : j;
      if (cb) cb(BANK_STATUS);
    })
    .catch(function (e) { BANK_STATUS = { ready: false, items: [], error: (e && e.message) || "couldn't reach the server" }; if (cb) cb(BANK_STATUS); });
}

/* ---------- connect ---------- */
function bankConnect() {
  if (!bankCanLink()) {
    alert("Bank linking needs the app open over its https address, not from a file.");
    return;
  }
  fetch(bankApiBase() + "/api/plaid/link-token", { method: "POST", headers: bankHeaders(), body: JSON.stringify({ org: bankOrg() }) })
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
              body: JSON.stringify({ org: bankOrg(), public_token: publicToken, label: label }) })
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
  fetch(bankApiBase() + "/api/plaid/sync", { method: "POST", headers: bankHeaders(), body: JSON.stringify({ org: bankOrg(), itemId: itemId }) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j && j.error) {
        /* ⚠️ the error he will actually hit: the bank wants him to sign in again */
        if (j.code === "ITEM_LOGIN_REQUIRED") alert("Your bank needs you to sign in again — reconnect it and it'll pick up where it left off.");
        else alert(j.error);
        return;
      }
      var rows = (j.rows || []).filter(function (r) { return r.accountId; });
      /* ⛔ ONLY *UNDECIDED* ROWS HOLD THE CURSOR. A row from an account he explicitly declined is skipped on
         purpose and must not block the feed — otherwise "don't import" is a deadlock rather than a choice,
         and the same rows arrive on every pull forever while the bank never finishes syncing. */
      var declined = (j.rows || []).filter(function (r) { return !r.accountId && r.ignored; }).length;
      var unmapped = (j.rows || []).length - rows.length - declined;
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
        body: JSON.stringify({ org: bankOrg(), itemId: itemId, cursor: j.cursor }) })
        .then(function () { bankRefresh(function () { if (typeof render === "function") render(); }); });

      var msg = res.added + " to review";
      if (res.duplicates) msg += " · " + res.duplicates + " already here";
      if (dropped) msg += " · " + dropped + " withdrawn by the bank";
      if (declined) msg += " · " + declined + " skipped (accounts you chose not to track)";
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
/* ---------- PAIRING SEVEN ACCOUNTS THAT SHARE THREE NAMES -------------------------------------------
   Ray, 2026-08-27: "it grabbed a bunch of my navy federal accounts like my wifes and my car loans all of
   which is fine but you may need to organize a bit."

   ⚠️ WHAT NAVY FEDERAL ACTUALLY SENT: seven accounts, under three distinct names —
       EveryDay Checking ····5377 $502.12      EveryDay Checking ····9652 $46.85
       Share Savings     ····0301 $5.03        Share Savings     ····3621 $5.01
       Used Vehicle Loan ····1319 $16,898      Used Vehicle Loan ····6172 $16,158
       Visa Signature cashRewards Plus — NO MASK AT ALL — $23,644
   A flat list of seven dropdowns labelled by name would have offered him the same words three times over.
   The mask and the balance are the only things that tell the twins apart, and the Visa has no mask, so on
   that one the balance is the only thing. Both now show on every row.

   ⭐⭐ TRACK ALL OF THEM. Ray, 2026-08-27: "i want you to keep and track all of them. you should be able to
   catch the transactions moving between accounts, thats actually good for reconciliation."

   He is right and this reverses what I shipped yesterday. I had loans defaulting to untracked, reasoning
   that the car payment already leaves checking and counting the loan side too would double it. That is only
   true if the two sides are never connected. They ARE: the ledger pairs opposite legs of the same movement
   (ledgerFindTransfer, js/143) and marks both isTransfer, which excludes them from income and spending while
   still moving both balances. So the second side is not a double-count — it is the CHECK on the first.
   ⛔ Tracking one side of a transfer is what actually loses information: the money looks like it left.

   Grouped by what the account IS, because that is what decides how it should be treated. */

var BANK_GROUPS = [
  { key: "cash",   label: "Checking &amp; savings", hint: "the money moving in and out — these are what a budget is made of" },
  { key: "credit", label: "Credit cards",           hint: "purchases here are real spending; paying the card off from checking is matched as a transfer, not counted twice" },
  { key: "loan",   label: "Loans",                  hint: "worth tracking: the payment leaving checking and arriving at the loan get matched to each other, so the balance comes down and nothing is counted twice" },
  { key: "other",  label: "Other",                  hint: "" }
];
/* ⚠️ READS type AND subtype, AND TOLERATES THE OLD COLLAPSED SHAPE. Records stored before 2026-08-27 kept
   `type: subtype || type`, so an existing item on disk may carry type:"credit card" or type:"checking" where
   Plaid's own type is "credit"/"depository". Matching on either means a bank linked before this change groups
   correctly without needing a re-sync — and an unrecognised value lands in "Other" rather than being silently
   filed as spending. */
function bankGroupOf(a) {
  var t = String((a && a.type) || "").toLowerCase();
  var st = String((a && a.subtype) || "").toLowerCase();
  var both = t + " " + st;
  if (/\bloan\b|mortgage|student|auto/.test(both)) return "loan";
  if (t === "credit" || /credit card|paypal credit|line of credit/.test(both)) return "credit";
  if (t === "depository" || /checking|savings|money market|cd\b|cash management/.test(both)) return "cash";
  return "other";
}
/* the twins problem in one string: never show a name without whatever distinguishes it */
function bankAcctLabel(a) {
  var bits = [];
  if (a.mask) bits.push("····" + a.mask);
  else bits.push("no number shown");
  if (a.subtype && String(a.subtype).toLowerCase() !== "loan") bits.push(esc(a.subtype));
  return bits.join(" · ");
}
function bankMoney(n) {
  if (n == null || !isFinite(n)) return "";
  try { return (typeof money === "function") ? money(n) : ("$" + Math.round(n).toLocaleString()); }
  catch (e) { return "$" + Math.round(n); }
}

function bankPairHTML(it) {
  var known = it.known || [];
  if (!known.length) {
    /* ⛔ NEVER TELL HIM TO PULL TRANSACTIONS FIRST. That was the old instruction, and it was backwards: the
       rows would arrive with nowhere to go, get held back, and he'd be asked to pair accounts he still
       couldn't see. Accounts are fetched at link time now — this is the repair path for a bank linked
       before that, and for an account opened since. */
    return '<div class="sub" style="white-space:normal;margin:2px 0 8px 10px">No accounts listed yet — '
      + '<a href="#" onclick="bankRefreshAccounts(\'' + esc(it.itemId) + '\');return false">ask this bank again</a>.</div>';
  }
  var mine = [], books = {};
  try {
    mine = (D().budgetAccounts || []).filter(function (a) { return a && !a.deleted; });
    (D().budgetBooks || []).forEach(function (b) { if (b && !b.deleted) books[b.id] = b.name; });
  } catch (e) {}
  var map = it.accounts || {};

  var h = '<div style="margin:2px 0 10px 10px">';
  /* ⚠️ SAY WHEN THE BALANCES ARE FROM. They are stored from the last pull so the accounts stay tellable-apart
     between visits (two "EveryDay Checking" with no other difference) — which means on any later page load
     they are HISTORICAL. A number that looks live and isn't is worse than no number, so it is dated once here
     rather than left to be assumed current. */
  h += '<div class="sub" style="white-space:normal;margin:2px 0 6px;opacity:.75">Balances shown are from the '
    + 'last check' + (it.syncedAt ? ' (' + esc(new Date(it.syncedAt).toISOString().slice(0, 10)) + ')' : '')
    + ' — they are here to tell same-named accounts apart, not as a live figure.</div>';
  BANK_GROUPS.forEach(function (g) {
    var rows = known.filter(function (a) { return bankGroupOf(a) === g.key; });
    if (!rows.length) return;
    h += '<div class="sub" style="font-weight:700;margin:10px 0 2px">' + g.label
      + ' <span style="font-weight:400;opacity:.7">(' + rows.length + ')</span></div>';
    if (g.hint) h += '<div class="sub" style="white-space:normal;margin-bottom:4px;opacity:.8">' + g.hint + '</div>';
    rows.forEach(function (a) {
      var sel = map[a.id] || "";
      h += '<div class="row" style="gap:8px;align-items:center;padding:5px 0;border-top:1px solid var(--line)">'
        + '<div class="grow" style="min-width:0">'
        +   '<div style="font-weight:600;font-size:13.5px">' + esc(a.name) + '</div>'
        +   '<div class="sub" style="font-variant-numeric:tabular-nums">' + bankAcctLabel(a)
        +     (a.balance != null ? ' · <b>' + bankMoney(a.balance) + '</b>' : '') + '</div>'
        + '</div>'
        + '<select style="width:auto;max-width:56%" onchange="bankPair(\'' + esc(it.itemId) + '\',\'' + esc(a.id) + '\',this.value)">'
        + '<option value="">— not decided yet —</option>'
        + '<option value="__ignore__"' + (sel === "__ignore__" ? " selected" : "") + '>⊘ Never import this one</option>'
        + mine.map(function (m) {
            var bk = books[m.bookId] ? (" (" + books[m.bookId] + ")") : "";
            return '<option value="' + esc(m.id) + '"' + (sel === m.id ? " selected" : "") + '>' + esc(m.name + bk) + '</option>';
          }).join("")
        /* ⭐ he has three budget accounts and this bank sent seven. Making the other four by hand, in another
           screen, matching them back up by memory, is where a pairing job gets abandoned half-done. */
        + '<option value="__new__">＋ Create an account for this…</option>'
        + '</select></div>';
    });
  });
  h += '<div class="sub" style="white-space:normal;margin-top:8px"><b>Pair all of them if you can.</b> When both '
    + 'sides of a movement are tracked — money leaving checking and landing on the card or the loan — they get '
    + 'matched to each other and counted once, not twice. Tracking only one side is what makes money look like '
    + 'it left when it only moved rooms.</div>'
    + '<div class="sub" style="white-space:normal;margin-top:4px">Anything left <i>not decided yet</i> holds the '
    + 'sync — the same transactions simply arrive again next time, so nothing is ever lost by waiting. Pick '
    + '<i>⊘ Never import this one</i> for an account you genuinely don\'t want, and the feed stops waiting on it.'
    + '</div></div>';
  return h;
}

/* ⭐ THE KEY GOES IN HERE, NOT INTO A FILE ON A SERVER. Ray, 2026-08-26: "Just make an interface in the
   app where I can give you the plaid key… All the keys should be transmittable through the app. And it
   should be by organization."

   Modelled on the Anthropic key card (js/75) deliberately — that pattern already exists in this app, and a
   second, subtly different one is a thing to get wrong later. ⛔ The key is write-only: it posts to the
   server and is never returned, so this card can say whether one is set and never what it is. */
function bankKeyCard() {
  var st = BANK_STATUS;
  if (!st) { bankRefresh(function () { if (typeof render === "function") render(); }); }
  var org = (typeof orgName === "function") ? orgName(bankOrg()) : bankOrg();
  var ready = !!(st && st.ready), env = (st && st.env) || "sandbox";
  return '<div class="card"><div class="nm" style="font-size:15px">🏦 Bank feed (Plaid) · ' + esc(org) + '</div>'
    + '<div class="sub" style="margin-bottom:8px">'
    + (ready ? '✓ Set up — running against <b>' + esc(env) + '</b>'
             : (st && st.error) ? '<span style="color:var(--danger)">⚠ ' + esc(st.error) + '</span>'
             : 'Not set up for this organization yet.') + '</div>'
    + '<div class="row" style="gap:6px;flex-wrap:wrap">'
    +   '<button class="btn ghost sm" style="width:auto" onclick="bankSetKey()">🔑 ' + (ready ? "Replace keys" : "Set keys") + '</button>'
    +   '<button class="btn ghost sm" style="width:auto" onclick="bankSetEnv()">Environment: ' + esc(env) + '</button>'
    + '</div>'
    + '<div class="sub" style="white-space:normal;margin-top:8px;font-size:12px;line-height:1.45">'
    + 'From <b>dashboard.plaid.com → Team Settings → Keys</b>. ⚠️ The <b>secret is different per environment</b> — '
    + 'a Sandbox secret will not work in Production, and that is the usual first stumble. '
    + '<b>Sandbox</b> connects to fake test banks; <b>Production</b> connects to your real ones. '
    + 'Keys are stored server-side for this organization only and are never shown again after saving.</div>'
    + '</div>';
}

/* ---------- the card, on Budget → Settings ---------- */
/* ⚠️ `opts.bare` OMITS THE <h2>, AND THAT IS NOT COSMETIC. js/156 splits the Admin and Settings screens into
   sub-tabs BY WALKING THEIR <h2> ELEMENTS. So a card that emits its own heading and is rendered INSIDE another
   section doesn't join that section — it silently becomes a section of its own, and (being absent from
   SEC_ORDER) sorts to the far end of the sub-tab row.

   Ray, 2026-08-27: "i dont see connect a bank." He was on Admin → AI tools, where I had just put this card;
   it had been split out into its own tab several clicks away. I wrote the splitter and then fed it a heading
   without thinking about what that means. ⛔ Anything rendered inside an existing section passes bare:true. */
function bankCardHTML(opts) {
  opts = opts || {};
  var st = BANK_STATUS;
  var h = opts.bare
    ? '<div class="card" style="margin-top:8px"><div class="nm" style="font-size:15px">Bank connections</div>'
    : '<div class="secthd"><h2>Bank connections</h2></div><div class="card">';
  if (!st) { bankRefresh(function () { if (typeof render === "function") render(); });
    return h + '<div class="sub">Checking…</div></div>'; }

  if (!st.ready) {
    return h + '<div class="sub" style="white-space:normal">No Plaid keys for this organization yet — '
      + 'add them under <b>Admin → AI tools</b>.</div></div>';
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
  window.bankPairHTML = bankPairHTML; window.bankKeyCard = bankKeyCard; window.bankOrg = bankOrg;

  window.bankSetKey = function () {
    /* ⛔ NAME THE ORG AND MAKE HIM AGREE TO IT. Ray, 2026-08-27: "oh my bad those keys should have gone on
       the personal page." He'd just entered a live PRODUCTION Plaid credential against OBX. The card had the
       org name in its heading and that wasn't enough — of course it wasn't: he came here to type a key, not
       to audit which organisation he happened to be standing in.

       ⚠️ Keys are per-org for a real reason: whichever org holds them is the one whose books a linked bank
       feeds. Getting it wrong doesn't fail — it succeeds, into the wrong ledger. So the destination is
       confirmed BEFORE the secret is asked for, while changing your mind is still free. */
    var orgLabel = (typeof orgName === "function") ? orgName(bankOrg()) : bankOrg();
    if (!confirm("Save Plaid keys to " + orgLabel + "?\n\n"
      + "Whichever organization holds the keys is the one a linked bank's transactions land in. "
      + "If these belong somewhere else, switch organization first — nothing is saved yet.")) return;
    var cid = prompt("Plaid client_id for " + orgLabel + ":");
    if (cid === null) return;
    var sec = prompt("Plaid secret for " + orgLabel + " (the one matching the environment you picked):");
    if (sec === null) return;
    if (!String(cid).trim() || !String(sec).trim()) { alert("Both values are needed."); return; }
    fetch(bankApiBase() + "/api/plaid/config", { method: "POST", headers: bankHeaders(),
      body: JSON.stringify({ org: bankOrg(), clientId: String(cid).trim(), secret: String(sec).trim() }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.error) { alert(j.error); return; }
        BANK_STATUS = j;
        /* ⭐ the server just tried the keys for real. Say which happened — "saved" on its own is a claim we
           haven't earned, and the failure it hides (a sandbox secret in production) looks like anything but
           a wrong secret when it finally surfaces at Connect-a-bank. */
        if (j && j.verified) {
          if (typeof toast === "function") toast("✓ Keys saved and verified against Plaid " + (j.env || ""));
        } else {
          alert("Saved, but Plaid did not accept them:\n\n" + ((j && j.reason) || "couldn't verify")
            + "\n\nFix them and set them again — nothing will connect until this passes.");
        }
        if (typeof render === "function") render();
      })
      .catch(function (e) { alert("Couldn't save: " + (e.message || e)); });
  };
  window.bankSetEnv = function () {
    var cur = (BANK_STATUS && BANK_STATUS.env) || "sandbox";
    var next = cur === "production" ? "sandbox" : "production";
    if (!confirm("Switch this organization's bank feed to " + next + "?\n\n"
      + (next === "production" ? "Production connects to your REAL bank accounts. You'll need your production secret — it is a different value from the sandbox one."
                               : "Sandbox connects to fake test banks only."))) return;
    fetch(bankApiBase() + "/api/plaid/config", { method: "POST", headers: bankHeaders(),
      body: JSON.stringify({ org: bankOrg(), env: next }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        /* ⛔ SAY WHEN IT DIDN'T WORK. Ray: "I tried in the app to change the environment in the sandbox, but
           that button doesn't do anything. I click on it. It doesn't do anything." It was taking the same 403
           as everything else — but unlike bankSetKey this handler never looked at j.error, so a hard failure
           was indistinguishable from a no-op. A button that fails silently is worse than one that errors: it
           sends him hunting for the bug in the wrong place. */
        if (j && j.error) { alert("Couldn't switch environment: " + j.error); return; }
        BANK_STATUS = j;
        /* ⚠️ switching environment re-checks the SAME stored secret against the NEW environment — which is
           exactly when it stops being valid. Better he hears it now than at Connect-a-bank. */
        if (j && j.ready && !j.verified) {
          alert("Switched to " + next + ", but the stored secret isn't valid there:\n\n" + ((j && j.reason) || "")
            + "\n\nSet the " + next + " secret with 🔑 Replace keys.");
        }
        if (typeof render === "function") render();
      });
  };
  /* ⭐ CREATE THE MATCHING ACCOUNT RIGHT HERE. He has three budget accounts; Navy Federal sent seven. Sending
     him to another screen to make four records and then match them back up from memory is exactly where a
     pairing job gets abandoned half-finished — and a half-paired bank is the one state that loses rows,
     because the cursor can't be committed until every row has somewhere to go. */
  window.bankPair = function (itemId, plaidAccountId, budgetAccountId) {
    if (budgetAccountId === "__new__") {
      var made = bankCreateAccountFor(itemId, plaidAccountId);
      if (!made) { if (typeof render === "function") render(); return; }   // cancelled → redraw so the select snaps back
      budgetAccountId = made;
    }
    fetch(bankApiBase() + "/api/plaid/commit", { method: "POST", headers: bankHeaders(),
      body: JSON.stringify({ org: bankOrg(), itemId: itemId, map: { plaidAccountId: plaidAccountId, budgetAccountId: budgetAccountId } }) })
      .then(function () { bankRefresh(function () { if (typeof render === "function") render(); }); });
  };

  /* makes a budgetAccounts record in the SAME shape js/79 makes them ({id,bookId,name,type,balance,deleted,
     updatedAt}) and saves through the normal path, so it syncs and migrates like any other. Returns its id.
     ⚠️ The BOOK matters more than the name: it is what keeps his wife's checking, the Iowa rental and the
     two businesses out of each other's numbers. So it is asked, defaulted to Personal, never guessed. */
  function bankCreateAccountFor(itemId, plaidAccountId) {
    try {
      var st = BANK_STATUS || {}, it = (st.items || []).filter(function (x) { return x.itemId === itemId; })[0] || {};
      var a = (it.known || []).filter(function (x) { return x.id === plaidAccountId; })[0] || {};
      var suggested = a.name + (a.mask ? " ····" + a.mask : "");
      var name = prompt("Name this account as you want to see it in your budget:\n\n"
        + "(Navy Federal sent two called \"" + (a.name || "this") + "\" — the last four digits and the balance "
        + "are what tell them apart.)", suggested);
      if (name === null || !String(name).trim()) return "";

      var books = [];
      try { books = (D().budgetBooks || []).filter(function (b) { return b && !b.deleted; }); } catch (e) {}
      var bookId = books.length ? books[0].id : "";
      if (books.length > 1) {
        var pick = prompt("Which set of books does it belong to?\n\n"
          + books.map(function (b, i) { return (i + 1) + ". " + b.name; }).join("\n")
          + "\n\nEnter a number:", "1");
        if (pick === null) return "";
        var n = parseInt(pick, 10);
        if (!(n >= 1 && n <= books.length)) { alert("That wasn't one of the numbers — nothing created."); return ""; }
        bookId = books[n - 1].id;
      }

      var grp = bankGroupOf(a);
      var rec = {
        id: "bgt-acct-plaid-" + String(plaidAccountId).slice(-12),   /* ⭐ stable + derived → re-pairing the same
                                                                        Plaid account can never make a duplicate */
        bookId: bookId,
        name: String(name).trim().slice(0, 80),
        type: grp === "credit" ? "credit" : grp === "loan" ? "loan" : (a.subtype === "savings" ? "savings" : "checking"),
        balance: 0,
        deleted: false
      };
      var d = D();
      d.budgetAccounts = d.budgetAccounts || [];
      var existing = d.budgetAccounts.filter(function (x) { return x && x.id === rec.id; })[0];
      if (existing) { existing.deleted = false; existing.name = rec.name; existing.bookId = rec.bookId; if (typeof touch === "function") touch(existing); }
      else { if (typeof touch === "function") touch(rec); d.budgetAccounts.push(rec); }
      if (typeof save === "function") save();
      if (typeof toast === "function") toast("Created “" + rec.name + "”");
      return rec.id;
    } catch (e) { alert("Couldn't create that account: " + ((e && e.message) || e)); return ""; }
  }
  window.bankCreateAccountFor = bankCreateAccountFor;
  window.bankRefreshAccounts = function (itemId) {
    fetch(bankApiBase() + "/api/plaid/refresh-accounts", { method: "POST", headers: bankHeaders(),
      body: JSON.stringify({ org: bankOrg(), itemId: itemId }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.error) { alert(j.error); return; }
        BANK_STATUS = j;
        if (typeof toast === "function") toast("Found " + (j.count || 0) + " account" + (j.count === 1 ? "" : "s"));
        if (typeof render === "function") render();
      })
      .catch(function (e) { alert("Couldn't ask the bank: " + ((e && e.message) || e)); });
  };
  window.bankCardHTML = bankCardHTML; window.bankDropRemoved = bankDropRemoved; window.bankCanLink = bankCanLink;
}
