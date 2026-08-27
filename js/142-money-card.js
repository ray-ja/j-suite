/* ---------- MONEY, AT A GLANCE (js/142) — the left column of the personal Today ---------------------
   Ray, 2026-08-25, with a screenshot of the old bills card: "the bills / money area, lets spruce it up.
   make it show upcoming bills over the next 2 weeks, have it show account balances for obx lot solutions,
   my personal account, and my business account. make it easier to read. its a wall of small text. lots of
   unneeded info in there. make it easier to scan, not read."

   ⭐ SCAN, NOT READ. That last line is the whole spec, and it rules out most of what was there. Every bill
   was dragging its note along — "Loan #1900642651 · 5.125% · principal balance $282,797.73 (Aug 2026). P&I
   $1,637.27 + ESCROW $775.73…" — four lines of 11px prose to tell him one number is due. Notes are for the
   Budget page, where he goes to think about a bill. Here he wants to know WHAT, WHEN, HOW MUCH.

   So each bill is one line, three fixed columns: when · what · how much. Amounts are right-aligned and
   tabular-figure, so the digits stack and he reads the column, not the sentences. Names lose their
   parenthetical ("Iowa mortgage (Johnston, IA rental)" → "Iowa mortgage") because the qualifier is only
   there to disambiguate on a page that lists everything.

   ⚠️ THE BALANCES ARE ALL ZERO IN HIS LIVE STORE — all three accounts, never entered. So this must not
   print "$0.00" three times as if that were a fact about his money; that's the one place a made-up number
   would do real damage. A zero balance renders as "not set" and taps straight into the account editor.
   `balance === 0` is treated as unset because saveBudgetAccount() writes 0 for a blank field, so a truly
   empty account and a never-filled one are the same record. That's a fair trade: for an account genuinely
   at zero the prompt is mildly wrong and one tap fixes it forever.

   ⚠️ NOT actBudgetAccounts()/actBudgetTx() — those filter to the SELECTED book, and Today is not inside a
   book. Read the collections directly so all three accounts show whatever he last had open. */

var MC_DAYS = 14;   // "over the next 2 weeks", in his words

function mcAccounts() {
  try {
    return (D().budgetAccounts || []).filter(function (a) { return a && !a.deleted && !a.debtOnly; })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  } catch (e) { return []; }
}
/* he calls them "obx lot solutions", "my personal account", "my business account" — which is exactly what
   the BOOK each account belongs to is named. Use that, and keep the bank's own name as the tooltip. */
function mcAccountLabel(a) {
  var name = "";
  try {
    var b = (D().budgetBooks || []).find(function (x) { return x && !x.deleted && x.id === a.bookId; });
    if (b && b.name) name = b.name;
  } catch (e) {}
  if (!name) name = String(a.name || "Account").split("—")[0].trim();
  /* three columns on a 400px card leave ~110px each. "Jamieson Automation" ellipsised to "JAMIESON AUTO…"
     is worse than useless, so a long label drops to its first word — which is how he says them out loud
     anyway ("Jamieson", "OBX"). */
  return (name.length > 11) ? name.split(/[\s—-]+/)[0] : (name || "Account");
}
function mcMoney(n) {
  if (typeof calMoney === "function") return calMoney(n);
  if (typeof budgetMoney === "function") return budgetMoney(n);
  return "$" + (Math.round((+n || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/* whole dollars for a balance — the cents are noise when he's scanning three numbers */
function mcRound(n) { return "$" + Math.round(+n || 0).toLocaleString("en-US"); }
var MC_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/* formatted off the ISO STRING, never through Date() — parsing "2026-09-01" as a date is how a bill lands
   on the wrong day for anyone west of UTC */
function mcWhen(iso, days) {
  if (days === 0) return "today";
  if (days === 1) return "tmrw";
  return (MC_MONTHS[(+iso.slice(5, 7) || 1) - 1] || "") + " " + (+iso.slice(8, 10) || "");
}
/* "Iowa mortgage (Johnston, IA rental)" → "Iowa mortgage" */
function mcBillName(name) {
  return String(name || "bill").replace(/\s*\([^)]*\)\s*$/, "").trim() || String(name || "bill");
}

function mcBalancesHTML() {
  var accts = mcAccounts();
  if (!accts.length) return "";
  return '<div class="card" style="padding:12px 14px">'
    + '<div class="row" style="gap:10px;align-items:stretch">'
    + accts.slice(0, 4).map(function (a) {
        var live = (typeof budgetAccountBalance === "function") ? budgetAccountBalance(a) : (+a.balance || 0);
        /* ⭐ A RECONCILED ACCOUNT IS NEVER "unset" — even if it derives to exactly zero, that zero is a
           computed fact with a statement behind it, not a blank field. Only an account with no checkpoint
           AND no typed balance is unknown, and the fix for that is to reconcile it, not to type a number
           that is stale the moment it's typed. */
        var derived = (typeof acctIsDerived === "function") && acctIsDerived(a);
        var unset = !derived && !(+a.balance);
        return '<div class="grow" style="min-width:0;cursor:pointer" title="' + esc(a.name || "") + '"'
          + ' onclick="mcOpenAccount(\'' + a.id + '\')">'
          + '<div class="sub" style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'
          + esc(mcAccountLabel(a)) + '</div>'
          + (unset
              ? '<div class="sub" style="font-size:13px;margin-top:2px;color:var(--accent)">Reconcile</div>'
              : '<div class="nm" style="font-size:19px;margin-top:1px;font-variant-numeric:tabular-nums;white-space:nowrap'
                + (live < 0 ? ';color:var(--danger)' : '') + '">' + esc(mcRound(live)) + '</div>')
          + '</div>';
      }).join('<div style="flex:0 0 1px;background:var(--line)"></div>')
    + '</div></div>';
}

function mcBillsHTML() {
  var due = (typeof calBillsDueSoon === "function") ? calBillsDueSoon(MC_DAYS) : [];
  if (!due.length) return '<div class="card"><div class="sub">Nothing due in the next two weeks.</div></div>';
  var total = due.reduce(function (a, x) { return a + (+x.b.amount || 0); }, 0);
  return '<div class="card" style="padding:10px 14px 12px">'
    + '<div class="row" style="gap:8px;align-items:baseline;margin-bottom:6px">'
    +   '<div class="grow" style="font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)">Next 2 weeks</div>'
    +   '<div class="nm" style="flex:0 0 auto;font-size:17px;font-variant-numeric:tabular-nums">' + esc(mcMoney(total)) + '</div>'
    + '</div>'
    + due.map(function (x) {
        var soon = x.days <= 3;
        /* three fixed columns — when, what, how much. Nothing wraps, nothing else is shown. */
        return '<div class="row" style="gap:10px;align-items:baseline;padding:5px 0;border-top:1px solid var(--line)">'
          + '<div style="flex:0 0 52px;font-size:12px;font-variant-numeric:tabular-nums'
          + (soon ? ';color:var(--danger);font-weight:700' : ';color:var(--muted)') + '">' + esc(mcWhen(x.iso, x.days)) + '</div>'
          + '<div class="grow" style="min-width:0;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'
          + esc(mcBillName(x.b.name)) + '</div>'
          + '<div style="flex:0 0 auto;font-size:14px;font-variant-numeric:tabular-nums">' + esc(mcMoney(+x.b.amount || 0)) + '</div>'
          + '</div>';
      }).join("")
    + '</div>';
}

/* the whole left-column money block, heading included. Silent if he has no budget set up at all. */
function moneyCardHTML() {
  var bal = mcBalancesHTML();
  /* ⛔ THE TWO-WEEK BILL LIST MOVED TO THE CALENDAR (js/163). Ray, 2026-08-27: "we have the bills coming up
     over the next two weeks. Can we just build those into the calendar?" He was right — a bill is a dated
     thing, and keeping it in its own list meant two surfaces answering one question. It is shown here ONLY
     as a fallback for a build without the calendar module, so Today can never silently lose the forecast. */
  var bills = (typeof tcalHTML === "function") ? ""
            : ((typeof calBillsDueSoon === "function" && calBillsDueSoon(MC_DAYS).length) ? mcBillsHTML() : "");
  if (!bal && !bills) return "";

  /* ⭐ the forecast sits with the balances, because "what you have" and "what happens next" are one
     thought. Silent when there is nothing solid to project from. */
  var flow = (typeof cashflowLineHTML === "function") ? cashflowLineHTML() : "";
  return '<div class="secthd"><h2 style="font-size:13px">Money</h2><div class="grow"></div>'
    + '<button class="btn ghost sm" style="width:auto;flex:0 0 auto;padding:2px 10px;font-size:12px" onclick="mcGoBudget()">Budget</button></div>'
    + bal + flow + bills;
}

if (typeof window !== "undefined") {
  window.moneyCardHTML = moneyCardHTML; window.mcBalancesHTML = mcBalancesHTML; window.mcBillsHTML = mcBillsHTML;
  window.mcAccountLabel = mcAccountLabel; window.mcBillName = mcBillName; window.mcWhen = mcWhen; window.MC_DAYS = MC_DAYS;
  window.mcOpenAccount = function (id) {
    /* an account with no checkpoint wants reconciling, not a typed number — that's the whole point */
    var a = (function () { try { return (D().budgetAccounts || []).find(function (x) { return x && x.id === id; }); } catch (e) { return null; } })();
    if (a && !a.balanceDate && typeof openReconcile === "function") return openReconcile(id);
    if (typeof openBudgetAccount === "function") return openBudgetAccount(id);   // reuse the real editor
    if (typeof navSub === "function") navSub("budget");
  };
  window.mcGoBudget = function () {
    if (typeof TAB !== "undefined") { TAB = "budget"; if (typeof render === "function") render(); }
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { MC_DAYS: MC_DAYS };
}
