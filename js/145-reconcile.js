/* ---------- RECONCILIATION + DERIVED BALANCES (js/145) ------------------------------------------------
   Ray, 2026-08-25: "instead of me setting the balance for my accounts, i want to be able to link them."

   A bank link is coming, but it is not what actually solves this. A balance you type is stale the moment
   you type it — that is why all three of his accounts sat at $0 and the money card had to say "not set".
   A balance you RECONCILE is a fact with a date on it, and everything after it is arithmetic.

   ⭐ THE MODEL, which is QuickBooks' and YNAB's and every ledger's since the fifteenth century:

       live balance = the last checkpoint + every approved transaction since it

   A checkpoint is `balance` + `balanceDate` on the account — "on this date the bank said this". He gets
   one by reconciling against a statement. From then on the app derives the balance itself, and a bank
   feed later just adds transactions to the same sum rather than replacing the idea.

   ⚠️ BACKWARD-COMPATIBLE BY CONSTRUCTION. An account with no `balanceDate` behaves EXACTLY as before —
   the derived branch is skipped entirely. Fourteen call sites in js/79 read budgetAccountBalance(), so
   changing its meaning for existing records would have quietly moved To-Be-Budgeted, every envelope and
   every cash total in one commit. Nothing changes until he reconciles an account on purpose.

   ⚠️ A BALANCE COUNTS TRANSFERS; INCOME AND SPENDING DO NOT. actBudgetTx() excludes transfers and card
   payments because they are not income or spending — but they absolutely move cash, and a balance that
   ignored them would drift by exactly the amount he shuffles between accounts. So the derivation reads
   the raw collection with its own filter. Getting this backwards is the classic ledger bug. */

function recActive(arr) { return (arr || []).filter(function (x) { return x && !x.deleted; }); }
function recTx() { try { return recActive(D().budgetTx); } catch (e) { return []; } }

/* every approved transaction belonging to one account — pending rows are not money yet (js/143) */
function acctTx(acctId) {
  return recTx().filter(function (t) { return t.accountId === acctId && !t.pending; })
    .sort(function (a, b) { return String(a.date || "").localeCompare(String(b.date || "")); });
}

/* the signed effect of one transaction on THIS account's balance.
   ⚠️ A credit account is the mirror image: a charge (dir "out") makes the balance more negative — more
   owed — and a payment to it (dir "in", or the card-payment leg) moves it toward zero. */
function acctDelta(t, isCredit) {
  var amt = Math.abs(+t.amount || 0);
  var out = (t.dir || "out") === "out";
  if (isCredit) return out ? -amt : amt;
  return out ? -amt : amt;
}

/* balance as at the end of `iso` (or today). Checkpoint + everything after it. */
function acctBalanceAt(a, iso) {
  if (!a) return 0;
  var asOf = iso || ((typeof today === "function") ? today() : "9999-12-31");
  var from = a.balanceDate || "";
  var isCredit = a.type === "credit";
  var bal = +a.balance || 0;
  acctTx(a.id).forEach(function (t) {
    var d = String(t.date || "");
    if (from && d <= from) return;          // already inside the checkpoint
    if (d > asOf) return;                   // not yet
    bal += acctDelta(t, isCredit);
  });
  return Math.round(bal * 100) / 100;
}
function acctIsDerived(a) { return !!(a && a.balanceDate); }
function acctLive(a) { return acctBalanceAt(a, null); }

/* transactions since the checkpoint — what he'd be ticking off against a statement */
function acctSinceCheckpoint(a) {
  if (!a) return [];
  var from = a.balanceDate || "";
  return acctTx(a.id).filter(function (t) { return !from || String(t.date || "") > from; });
}
/* what a statement ending on `iso` should say, if our records are complete */
function acctExpected(a, iso) { return acctBalanceAt(a, iso); }

/* ⭐ RECONCILE. He gives the statement's ending date and balance; we compare and, if he accepts, write a
   new checkpoint. The difference is the interesting number: it is the money the app doesn't know about. */
function reconcilePreview(a, iso, statementBalance) {
  var expected = acctExpected(a, iso);
  var diff = Math.round(((+statementBalance || 0) - expected) * 100) / 100;
  var since = acctSinceCheckpoint(a).filter(function (t) { return String(t.date || "") <= iso; });
  return { expected: expected, statement: Math.round((+statementBalance || 0) * 100) / 100,
           difference: diff, matched: Math.abs(diff) < 0.005, count: since.length };
}

/* ⭐ APPLY. The statement balance becomes the new truth as at that date. Everything on or before it is
   marked cleared, so it is visibly settled and a later reconciliation starts from here.
   ⛔ It never edits or deletes a transaction to force a match. If the difference is real, the fix is a
   missing transaction he adds — not a number quietly bent to agree. */
function reconcileApply(acctId, iso, statementBalance) {
  var d = D();
  var a = recActive(d.budgetAccounts).find(function (x) { return x.id === acctId; });
  if (!a || !iso) return null;
  var before = acctExpected(a, iso);
  acctTx(acctId).forEach(function (t) {
    if (String(t.date || "") <= iso && !t.cleared) { t.cleared = true; if (typeof touch === "function") touch(t); }
  });
  a.balance = Math.round((+statementBalance || 0) * 100) / 100;
  a.balanceDate = iso;
  a.reconciledAt = (typeof now === "function") ? now() : Date.now();
  if (typeof touch === "function") touch(a);
  if (typeof save === "function") save();
  return { account: a.id, at: iso, balance: a.balance, wasExpecting: before,
           difference: Math.round((a.balance - before) * 100) / 100 };
}

/* total spendable cash across non-credit accounts, using derived balances where they exist */
function acctTotalCash() {
  var accts = [];
  try { accts = recActive(D().budgetAccounts); } catch (e) { return 0; }
  return Math.round(accts.filter(function (a) { return a.type !== "credit"; })
    .reduce(function (s, a) { return s + acctLive(a); }, 0) * 100) / 100;
}

if (typeof window !== "undefined") {
  window.acctBalanceAt = acctBalanceAt; window.acctLive = acctLive; window.acctIsDerived = acctIsDerived;
  window.acctSinceCheckpoint = acctSinceCheckpoint; window.acctExpected = acctExpected;
  window.reconcilePreview = reconcilePreview; window.reconcileApply = reconcileApply;
  window.acctTotalCash = acctTotalCash; window.acctTx = acctTx;

  /* ---- the reconcile dialog ---- */
  window.openReconcile = function (acctId) {
    var a = recActive(D().budgetAccounts).find(function (x) { return x.id === acctId; });
    if (!a) return;
    var since = acctSinceCheckpoint(a);
    var last = a.balanceDate ? ("Last reconciled to " + esc(a.balanceDate)) : "Never reconciled";
    modal("Reconcile " + (a.name || "account"), ''
      + '<p class="muted" style="margin:0 0 10px;font-size:13px">Open your statement and type its ending date and balance. '
      + 'From then on this balance is worked out for you — you won\'t have to set it again.</p>'
      + '<div class="sub" style="margin-bottom:8px">' + last
      + ' · ' + since.length + ' transaction' + (since.length === 1 ? '' : 's') + ' since then</div>'
      + '<label>Statement ending date</label><input id="rc_date" type="date" value="'
      + esc((typeof today === "function") ? today() : "") + '">'
      + '<label>Statement ending balance</label><input id="rc_bal" type="number" inputmode="decimal" step="0.01" placeholder="0.00">'
      + '<div id="rc_out" style="margin-top:10px"></div>'
      + '<button class="btn" style="margin-top:10px;width:100%" onclick="reconcileCheck(\'' + a.id + '\')">Check it</button>');
  };

  window.reconcileCheck = function (acctId) {
    var a = recActive(D().budgetAccounts).find(function (x) { return x.id === acctId; });
    var iso = (typeof val === "function") ? val("rc_date") : "";
    var bal = parseFloat((typeof val === "function") ? val("rc_bal") : "");
    var box = document.getElementById("rc_out"); if (!box || !a) return;
    if (!iso || isNaN(bal)) { box.innerHTML = '<div class="sub">Give me the date and the balance from the statement.</div>'; return; }
    var p = reconcilePreview(a, iso, bal);
    var money = function (n) { return (typeof budgetMoney === "function") ? budgetMoney(n) : "$" + n; };
    box.innerHTML = '<div class="card" style="padding:10px 12px">'
      + '<div class="row"><div class="grow sub">Your statement says</div><div class="nm" style="font-variant-numeric:tabular-nums">' + esc(money(p.statement)) + '</div></div>'
      + '<div class="row"><div class="grow sub">This app works out</div><div class="nm" style="font-variant-numeric:tabular-nums">' + esc(money(p.expected)) + '</div></div>'
      + '<div class="row" style="border-top:1px solid var(--line);margin-top:6px;padding-top:6px">'
      +   '<div class="grow sub">Difference</div><div class="nm" style="font-variant-numeric:tabular-nums;color:'
      +   (p.matched ? 'var(--accent)' : 'var(--danger)') + '">' + esc(money(p.difference)) + '</div></div>'
      + (p.matched
          ? '<div class="sub" style="white-space:normal;margin-top:6px">They agree. Everything up to that date is settled.</div>'
          /* ⛔ never "fix" this by editing a transaction — the difference is information */
          : '<div class="sub" style="white-space:normal;margin-top:6px">'
            + (p.difference > 0 ? 'The bank has ' + esc(money(Math.abs(p.difference))) + ' more than this app knows about — money in that was never recorded.'
                                : 'This app thinks you have ' + esc(money(Math.abs(p.difference))) + ' more than the bank does — spending that was never recorded.')
            + ' You can accept the statement anyway; it becomes the new starting point.</div>')
      + '</div>'
      + '<button class="btn acc" style="margin-top:10px;width:100%" onclick="reconcileAccept(\'' + a.id + '\',\'' + esc(iso) + '\',' + p.statement + ')">'
      + (p.matched ? 'Accept — done' : 'Use the statement anyway') + '</button>';
  };

  window.reconcileAccept = function (acctId, iso, bal) {
    reconcileApply(acctId, iso, bal);
    if (typeof closeModal === "function") closeModal();
    if (typeof render === "function") render();
    if (typeof toast === "function") toast("Reconciled to " + iso);
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { acctDelta: acctDelta };
