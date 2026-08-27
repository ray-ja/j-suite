/* ---------- THE LEDGER (js/143) — ingest → recognize → approve → learn -------------------------------
   Ray, 2026-08-25: "lets just build the quickbooks / ynab style backend. cash based accounting.
   autotagging after something is recognized but everything needs approvals. like ynab."

   This is the engine only. No UI lives here (that's js/144), and nothing in here is tied to where a
   transaction came from — a CSV today, a bank link tomorrow. `ledgerIngest(rows, {source})` is the one
   door in, and the seam a bank feed drops into without touching anything else.

   ═══ THE THREE RULES THIS FILE EXISTS TO ENFORCE ═══

   ⭐ 1. CASH BASIS, AND NOTHING ELSE. A transaction's `date` is the date the cash actually moved. Income
   counts when it is RECEIVED, spending when it is PAID. There are no accruals here, no receivables, no
   payables, no depreciation — a bill in this app is a FORECAST of cash leaving, never a liability posted
   to a ledger. That is the whole point of cash basis for a business this size: the numbers have to match
   what the bank says, on the day the bank says it. (The business side has real double-entry GL for
   accrual work — js/40 and friends. Do not blur the two.)

   ⭐ 2. NOTHING POSTS WITHOUT HIS APPROVAL. Every ingested row lands with `pending:true`, and
   actBudgetTx() — the one gate every envelope, total and report already reads through — excludes pending
   rows. So an unapproved transaction is invisible to his budget math. It cannot move an envelope, cannot
   change To-Be-Budgeted, cannot alter a single number he looks at, until he says yes. That property comes
   free from a flag that already existed; do not "optimise" it away by posting on ingest.

   ⭐ 3. THE MEMORY IS MADE OF HIS DECISIONS, NEVER OF MY GUESSES. A suggestion never becomes a rule. A
   rule is written only in ledgerApprove(), from a category he approved. This is the difference between
   "recognized" and "assumed": if autotagging learned from its own output it would confidently compound
   its first mistake across every future transaction from that payee, and he would have no way to see it
   happen. Suggestions are cheap and reversible; rules are earned.

   Rules live in the EXISTING `budgetMemo` collection (merchant key → catId, from js/80). This file adds
   `hits` / `lastUsed` / `lastDesc` to those records — additive, so old rules keep working untouched. */

var LEDGER_SOURCES = ["csv", "bank", "receipt", "manual"];
var LEDGER_XFER_DAYS = 4;        // how far apart the two halves of a transfer may sit

function ledgerActive(arr) { return (arr || []).filter(function (x) { return x && !x.deleted; }); }
function ledgerTx() { try { return ledgerActive(D().budgetTx); } catch (e) { return []; } }
function ledgerAccounts() { try { return ledgerActive(D().budgetAccounts); } catch (e) { return []; } }
function ledgerRules() { try { return ledgerActive(D().budgetMemo); } catch (e) { return []; } }
function ledgerCatOk(id) { return !!(id && typeof budgetCat === "function" && budgetCat(id)); }
/* ---------- ⭐ THE MERCHANT KEY — the thing autotagging actually matches on -------------------------
   ⚠️ THIS IS WHERE THE FIRST VERSION FAILED, AND IT FAILED BADLY. budgetMemoKey() (js/80) takes "the
   first ~3 words after stripping numbers", which is fine for a clean export and useless for his bank.
   Navy Federal writes every card purchase as:

       "POS Debit- Debit Card 9185 07-10-26 Google *jp Pokemon 855-836-3987 CA"

   so the first three words are "pos debit debit" for ALL 122 of them. One rule swallowed every card
   purchase he has ever made and confidently filed the lot as Groceries. Measured against his own filings
   on a proper hold-out — learn from everything before July, predict July onward — that scored 37%.

   The merchant is not at the front. It is after the bank's boilerplate, after the card number, after the
   date, and before the city and state. So: strip the bank's own words first, then read the merchant.

   Every pattern below came from counting his real descriptions, not from imagining what a bank emits.

   ⭐ MEASURED, on his 263 real filings with a hold-out (learn from everything before July, predict July
   onward — 37 transactions it had never seen):

       first 1 word   60 rules   15 right, 12 wrong, 10 silent   56%
       first 2 words  75 rules   20 right,  3 wrong, 14 silent   87%
       first 3 words  82 rules   22 right,  0 wrong, 15 silent  100%   ← this

   Three words wins because two collapses "Transfer To Loan", "Transfer To Checking" and "Transfer To
   Credit Card" into one key, and those are three different things. The 15 silent ones are genuinely new
   payees: it says nothing rather than guessing, which is the behaviour worth having. Re-measure before
   changing the width — the old key scored 37% and looked fine in review. */
var LEDGER_BANK_PREFIX = [
  /^pos\s+debit\s*-?\s*debit\s+card\s*\d*/,     // "POS Debit- Debit Card 9185 …"   (122 of his)
  /^pos\s+debit\s+transaction/,                   // "POS Debit Transaction 07-13-26 …"
  /^pos\s+debit\s*-?/,
  /^deposit\s*-\s*ach\s+paid\s+from/,             // "Deposit - ACH Paid From Venmo Cashout"
  /^ach\s+paid\s+(to|from)/,                       // "ACH Paid To Ashley Belvin"
  /^paid\s+to\s*-?/,                               // "Paid To - Discover E-Payment Chk 9100001"
  /^(preauthorized\s+)?(debit|credit)\s*-?/,
  /^zelle\s+(cr|db)/,                              // "Zelle Cr Alexis Soukup"
  /^(withdrawal|deposit|purchase|transaction)\s*-?/
];
/* payment-processor prefixes glued to the front of the real name: "Sq *ashley's", "Py *front Porch" */
var LEDGER_PROCESSOR = /\b(sq|py|tst|sp|paypal|google|breeze|amzn|amazon)\s*\*+\s*/g;

function ledgerMerchantKey(desc) {
  var s = String(desc || "").toLowerCase();
  s = s.replace(/\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/g, " ");   // the transaction date the bank repeats
  s = s.replace(/\bchk\s*\d+\b/g, " ");                        // "Chk 9100001"
  s = s.replace(/\b\d{3}-\d{3}-\d{4}\b/g, " ");                 // merchant phone numbers
  LEDGER_BANK_PREFIX.forEach(function (re) { s = s.replace(re, " "); });
  s = s.replace(LEDGER_PROCESSOR, " ");
  s = s.replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  /* the trailing city/state the card network appends — drop a lone 2-letter tail so "publix kill devil
     hi nc" and "publix" are the same merchant */
  var w = s.split(" ").filter(Boolean);
  while (w.length > 1 && w[w.length - 1].length <= 2) w.pop();
  return w.slice(0, 3).join(" ");
}
function ledgerKey(desc) { return ledgerMerchantKey(desc); }

/* ⭐ READING IS A DIFFERENT JOB FROM MATCHING. The key is lowercased, de-punctuated and trimmed to three
   words because that is what makes a reliable rule — and it is unreadable. What he sees on the review
   screen has to be the payee as he'd recognise it, so this strips the same bank boilerplate but keeps the
   original casing and the processor prefix that often carries the recognisable half of the name:

     "POS Debit- Debit Card 9185 07-10-26 Google *jp Pokemon 855-836-3987 CA"  →  "Google *jp Pokemon"
     "Deposit - ACH Paid From Venmo Cashout 01Afd5"                            →  "Venmo Cashout"

   The raw string is never thrown away — the row still shows it underneath, because he has to be able to
   check what he is approving against his statement. */
function ledgerDisplayName(desc) {
  var s = String(desc || "").trim();
  if (!s) return "";
  var low = s.toLowerCase(), cut = 0;
  LEDGER_BANK_PREFIX.forEach(function (re) {
    var m = re.exec(low);
    if (m && m[0].length > cut) cut = m[0].length;
  });
  s = s.slice(cut);
  s = s.replace(/^\s*\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\s*/, "");   // the date the bank repeats
  s = s.replace(/\s*\b\d{3}-?\d{3}-?\d{4}\b\s*/g, " ");         // phone numbers
  s = s.replace(/\s*\bChk\s*\d+\b\s*/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  /* trailing city/state noise: drop a 1-2 letter tail, then a trailing all-caps state code */
  s = s.replace(/\s+[A-Za-z]{2}$/, "");
  return s || String(desc || "").trim();
}

/* ---------- RECOGNITION ------------------------------------------------------------------------------
   Four things it can notice, in falling order of certainty. Every one of them returns a SUGGESTION with
   its reason attached, because he is about to be asked to approve it and "why do you think that" is the
   only question that matters. A suggestion with no stated reason is just a guess wearing a badge. */

/* the two halves of a transfer between his OWN accounts. Neither half is income or spending — the money
   never left. Catching these is the single biggest source of double-counted "income" in an import. */
function ledgerFindTransfer(row, within) {
  var days = within == null ? LEDGER_XFER_DAYS : within;
  var d0 = Date.parse(String(row.date || "") + "T00:00:00Z");
  if (isNaN(d0)) return null;
  var amt = Math.round(Math.abs(+row.amount || 0) * 100);
  if (!amt) return null;
  return ledgerTx().find(function (t) {
    /* ⭐⭐ PENDING ROWS COUNT AS CANDIDATES. Ray, 2026-08-27: "you should be able to catch the transactions
       moving between accounts, thats actually good for reconciliation."

       ⚠️ THIS USED TO SKIP THEM, AND THAT BROKE THE ONE CASE THAT MATTERS MOST. A bank pull delivers BOTH
       legs of a transfer in the same batch, and everything in a batch lands pending. So every candidate mate
       was pending, every candidate was skipped, and the very first import — the one carrying months of
       history and every internal transfer in it — detected exactly zero. Verified against the real shape
       before changing it: $412.55 out of checking and $412.55 into the card, same day, ingested together,
       both came back suggestTransfer:false.

       Pairing against a pending row is right, because this produces a SUGGESTION, not a fact. Nothing is
       counted either way until he approves it, and approving one leg flags the other. */
    if (t.id === row.id) return false;
    if (Math.round(Math.abs(+t.amount || 0) * 100) !== amt) return false;
    if ((t.dir || "out") === (row.dir || "out")) return false;              // must be the opposite leg
    if (row.accountId && t.accountId && t.accountId === row.accountId) return false;   // and a different account
    var d1 = Date.parse(String(t.date || "") + "T00:00:00Z");
    return !isNaN(d1) && Math.abs(d1 - d0) <= days * 86400000;
  }) || null;
}

/* a payment to one of his own credit cards — moves cash to the card, is not spending */
function ledgerFindCardPayment(row) {
  if ((row.dir || "out") !== "out") return null;
  var desc = String(row.desc || row.note || "").toLowerCase();
  if (!desc) return null;
  return ledgerAccounts().find(function (a) {
    if (a.type !== "credit") return false;
    var nm = String(a.name || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/)[0];
    var byName = nm && nm.length >= 4 && desc.indexOf(nm) >= 0;
    var byMask = a.mask && desc.indexOf(String(a.mask)) >= 0;
    return !!(byName || byMask);
  }) || null;
}

/* a recurring bill he already told us about, landing at about the right amount */
function ledgerFindBill(row) {
  var amt = Math.abs(+row.amount || 0);
  if (!amt || (row.dir || "out") !== "out") return null;
  var key = ledgerKey(row.desc || row.note || "");
  var bills = (function () { try { return ledgerActive(D().budgetBills); } catch (e) { return []; } })();
  return bills.find(function (b) {
    if (b.active === false) return false;
    var ba = Math.abs(+b.amount || 0);
    if (!ba) return false;
    var close = Math.abs(ba - amt) <= Math.max(1, ba * 0.05);          // within 5% or a dollar
    var named = key && ledgerKey(b.name).split(" ")[0] && key.indexOf(ledgerKey(b.name).split(" ")[0]) >= 0;
    return close && named;
  }) || null;
}

/* ⭐ THE SUGGESTION. Returns { catId, confidence, why, ruleId, isTransfer, isCardPayment }.
   confidence is "high" | "medium" | "none" — never a percentage, because a percentage on a guess about
   his money reads as a measurement and this is not one. */
function ledgerSuggest(row) {
  var out = { catId: "", confidence: "none", why: "", ruleId: "", isTransfer: false, isCardPayment: false, seen: 0 };
  var desc = String(row.desc || row.note || "");

  var xfer = ledgerFindTransfer(row);
  if (xfer) {
    out.isTransfer = true; out.confidence = "high";
    out.why = "looks like a transfer between your own accounts — the matching " +
      ((xfer.dir || "out") === "in" ? "deposit" : "withdrawal") + " is already here on " + (xfer.date || "?");
    return out;
  }

  var card = ledgerFindCardPayment(row);
  if (card) {
    out.isCardPayment = true; out.confidence = "high";
    out.why = "looks like a payment to your " + (card.name || "card") + " — moves cash to the card, not spending";
    return out;
  }

  /* his own decisions, replayed */
  var key = ledgerKey(desc);
  var rule = key ? ledgerRules().find(function (m) { return m.key === key && ledgerCatOk(m.catId); }) : null;
  if (rule) {
    out.catId = rule.catId; out.ruleId = rule.id; out.confidence = "high";
    out.seen = +rule.hits || 0;
    out.why = "you've filed " + (out.seen ? out.seen + " " : "") + (out.seen === 1 ? "one like this" : "of these") +
      " as " + ((typeof budgetCatName === "function") ? budgetCatName(rule.catId) : "that");
    return out;
  }
  var loose = key ? ledgerRules().find(function (m) { return m.key && key.indexOf(m.key) === 0 && ledgerCatOk(m.catId); }) : null;
  if (loose) {
    out.catId = loose.catId; out.ruleId = loose.id; out.confidence = "medium";
    out.seen = +loose.hits || 0;
    out.why = "similar to “" + loose.key + "”, which you file as " +
      ((typeof budgetCatName === "function") ? budgetCatName(loose.catId) : "that");
    return out;
  }

  var bill = ledgerFindBill(row);
  if (bill) {
    out.catId = ledgerCatOk(bill.catId) ? bill.catId : "";
    out.confidence = out.catId ? "medium" : "none";
    out.why = "matches your “" + (bill.name || "bill") + "” bill";
    return out;
  }
  out.why = "new payee — I haven't seen this one before";
  return out;
}

/* ---------- INGEST -----------------------------------------------------------------------------------
   One door in, whatever the source. Rows are normalized: { externalId?, date, amount, dir, desc,
   accountId?, bookId? }. Everything lands PENDING. Nothing here touches a total. */
function ledgerDupKey(r) {
  return String(r.date || "") + "|" + Math.round(Math.abs(+r.amount || 0) * 100) + "|" + ledgerKey(r.desc || r.note || "");
}
/* ⛔⛔ THE SAME TRANSACTION, ARRIVING FROM A SECOND SOURCE, WITH AN ID THIS TIME.
   Found 2026-08-27, before Ray's first Plaid pull, not after. He has 263 transactions imported from Navy
   Federal STATEMENTS — none of which carry an externalId, because a PDF hasn't got one — and 84 of them fall
   inside the window Plaid was about to return. The old rule was "if the incoming row has an id, only compare
   it against rows that also have an id". Statement rows have none, so not one of those 84 could ever match,
   and two months of his real spending would have been counted twice. Silently, in the direction of looking
   poorer than he is, in the numbers he is about to make decisions from.

   ⭐ SO AN ID-LESS HISTORICAL ROW CAN CLAIM AN INCOMING ONE — and when it does it ADOPTS the id, which is
   what makes this a one-time reconciliation rather than a fuzzy match repeated forever. Next sync, that same
   transaction matches by id on the fast, exact path.

   ⚠️ ONE-TO-ONE, VIA `claimed`. The original comment's worry is real: two $4.50 coffees on the same day at
   the same shop are two coffees, not a duplicate. So each historical row may absorb AT MOST ONE incoming
   row. Two identical statement rows absorb two Plaid rows; one statement row absorbs one and the second
   Plaid row is correctly added as new. */
/* ⭐ DO TWO DESCRIPTIONS NAME THE SAME PURCHASE? Only ever asked about rows that ALREADY agree on account,
   date and exact amount — so this is the last guard against a coincidence, not the matcher itself.

   ⚠️ IT HAS TO SURVIVE HOW A BANK STATEMENT IS WRITTEN. Navy Federal's PDF says
       "POS Debit - Debit Card 9185 Transaction 06-02-26 Wal-Mart #2"
   where Plaid says just "Walmart". Same purchase; a normalised whole-string compare shares almost nothing.
   Measured on Ray's real data: whole-string matching caught 33 of 84 genuine overlaps and would have
   double-counted the other 51.

   Strip to letters and digits — "wal-mart #2" and "Walmart" both become walmart-ish — then accept either a
   containment or ANY common run of 8+ characters. That last part is what catches
       "ACH Transaction - IDAHO HOUSING MTGPMT 38356154 ACH DEBIT"
       "Paid To - Idaho Housing Mtgpmt Chk 12400005"
   which share "idahohousingmtgpmt" and no common prefix at all. ⛔ 8 is deliberate: shorter starts matching
   things like "transact" that appear in every row of a statement. */
function ledgerSamePayee(a, b) {
  var A = String(a || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  var B = String(b || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!A || !B) return false;
  if (A.indexOf(B) >= 0 || B.indexOf(A) >= 0) return true;

  /* ⛔ DROP WHAT THEY SHARE AT THE FRONT FIRST. Two DIFFERENT purchases off the same statement read
       "POS Debit - Debit Card 9185 Transaction 06-02-26 Lowes"
       "POS Debit - Debit Card 9185 Transaction 06-02-26 Wendys"
     and share forty characters of boilerplate — enough to satisfy any common-run test and silently swallow a
     real transaction. A shared PREFIX is exactly what boilerplate is, so remove it and compare what is left:
     "lowes" vs "wendys" → no match, correctly. It costs nothing on the pairs that matter, because a Plaid
     description and a statement line start differently ("walmart" vs "posdebit…"), so their common prefix is
     empty and both strings survive intact. */
  /* ⚠️ 20, NOT 8 — MEASURED, NOT PICKED. A shared opening only counts as boilerplate when it is longer than
     any real phrase. At 8 this also swallowed "Transfer from…" (12 chars), which is MEANINGFUL: it wrongly
     split four of Ray's real transfers — "Transfer from THEMEFORGE LLC TFR FR OTHER" against his statement's
     "Transfer From Checking", $11,600 between them, which would have double-counted straight onto his
     balances. At 20 the statement's 38-character "POS Debit - Debit Card 9185 Transaction 06-02-26" prefix
     is still stripped and Lowes-vs-Wendys is still correctly rejected. 84 of 84 overlaps matched, 0 false. */
  var pre = 0, cap = Math.min(A.length, B.length);
  while (pre < cap && A.charAt(pre) === B.charAt(pre)) pre++;
  if (pre >= 20) { A = A.slice(pre); B = B.slice(pre); if (!A || !B) return false; }

  var short = A.length <= B.length ? A : B, long = A.length <= B.length ? B : A;
  if (long.indexOf(short) >= 0) return true;
  for (var i = 0; i + 8 <= short.length; i++) {
    if (long.indexOf(short.substr(i, 8)) >= 0) return true;
  }
  return false;
}

function ledgerIsDuplicate(row, claimed) {
  if (row.externalId) {
    var byId = ledgerTx().some(function (t) { return t.externalId && t.externalId === row.externalId; });
    if (byId) return true;                       // the feed re-sent it — the ordinary case
    /* account + date + exact cents must agree, then the payee test above decides */
    var cents = Math.round(Math.abs(+row.amount || 0) * 100);
    var mate = ledgerTx().find(function (t) {
      if (t.externalId) return false;              // already has an id → not an unmatched historical row
      if (claimed && claimed[t.id]) return false;  // already spoken for by an earlier row in this batch
      if (String(t.date || "") !== String(row.date || "")) return false;
      if (Math.round(Math.abs(+t.amount || 0) * 100) !== cents) return false;
      if (row.accountId && t.accountId && t.accountId !== row.accountId) return false;
      if ((t.dir || "out") !== (row.dir || "out")) return false;
      return ledgerSamePayee(t.note || t.desc, row.desc || row.note);
    });
    if (mate) {
      /* the two sources agree — stamp the id so this is settled for good, and note where it came from */
      mate.externalId = row.externalId;
      mate.reconciledFrom = row.source || "bank";
      if (claimed) claimed[mate.id] = true;
      if (typeof touch === "function") touch(mate);
      return true;
    }
    return false;
  }
  var k = ledgerDupKey(row);
  return ledgerTx().some(function (t) { return !t.externalId && ledgerDupKey(t) === k; });
}

function ledgerIngest(rows, opts) {
  opts = opts || {};
  var src = (LEDGER_SOURCES.indexOf(opts.source) >= 0) ? opts.source : "manual";
  var d = D(); if (!Array.isArray(d.budgetTx)) d.budgetTx = [];
  var bookId = opts.bookId || (typeof budgetDefaultBookId === "function" ? budgetDefaultBookId() : "");
  var added = [], dupes = 0;

  var claimed = {};        /* historical rows already matched in THIS batch — keeps the match one-to-one */
  (rows || []).forEach(function (r) {
    if (!r || !r.date || !(+r.amount)) return;
    if (ledgerIsDuplicate(r, claimed)) { dupes++; return; }
    var s = ledgerSuggest(r);
    var t = {
      id: "bgt-tx-" + (typeof uid === "function" ? uid() : String(Date.now()) + Math.random().toString(36).slice(2, 6)),
      externalId: r.externalId || "",
      bookId: r.bookId || bookId,
      accountId: r.accountId || opts.accountId || "",
      date: r.date,
      dir: (r.dir === "in") ? "in" : "out",
      amount: Math.round(Math.abs(+r.amount) * 100) / 100,
      note: String(r.desc || r.note || "").slice(0, 200),
      catId: "",                       // ⛔ NEVER pre-filled — the suggestion is separate, see rule 3
      suggestedCatId: s.catId,
      suggestion: { confidence: s.confidence, why: s.why, ruleId: s.ruleId, seen: s.seen },
      isTransfer: false, isCardPayment: false,      // proposed only; set on approval
      suggestTransfer: !!s.isTransfer,
      suggestCardPayment: !!s.isCardPayment,
      source: src,
      pending: true,                   // ⭐ THE GATE. actBudgetTx() excludes this from every number.
      deleted: false
    };
    if (typeof touch === "function") touch(t);
    d.budgetTx.push(t);
    added.push(t.id);
  });
  /* ⭐⭐ SECOND PASS: THE EARLIER LEG NEVER SEES THE LATER ONE. Suggestions are computed as each row is
     ingested, so in a batch containing both halves of a transfer only the SECOND half can spot the first —
     the first was suggested against a ledger the second hadn't joined yet. Ray would then scan Review and
     find one leg flagged and its twin apparently ordinary, which reads as the detection being unreliable
     rather than order-dependent.

     So once everything is in, re-ask for every row that came out unflagged. Cheap (only unflagged rows,
     only against the ledger that now exists) and it makes the pair visible from BOTH sides, which is the
     whole point of tracking both accounts. ⛔ Still only a suggestion — nothing is counted until approved. */
  if (added.length) {
    var byId = {};
    d.budgetTx.forEach(function (t) { if (added.indexOf(t.id) >= 0) byId[t.id] = t; });
    added.forEach(function (id) {
      var t = byId[id];
      if (!t || t.suggestTransfer || t.suggestCardPayment) return;
      var mate = ledgerFindTransfer(t);
      if (!mate) return;
      t.suggestTransfer = true;
      t.suggestion = {
        confidence: "high",
        why: "looks like a transfer between your own accounts — the matching "
           + ((mate.dir || "out") === "in" ? "deposit" : "withdrawal") + " came in on the same pull, dated " + (mate.date || "?"),
        ruleId: "transfer", seen: 0
      };
      t.suggestedCatId = "";
      if (typeof touch === "function") touch(t);
    });
  }
  if (added.length && typeof save === "function") save();
  return { added: added.length, ids: added, duplicates: dupes, source: src };
}

/* ---------- THE QUEUE --------------------------------------------------------------------------------
   Everything awaiting his yes. Not book-scoped: an approval queue that hides rows because of which book
   happens to be selected is a queue that silently never empties. */
function ledgerInbox() {
  return ledgerTx().filter(function (t) { return t.pending; })
    .sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); });
}
function ledgerInboxCount() { return ledgerInbox().length; }

/* ---------- LEARNING ---------------------------------------------------------------------------------
   ⭐ Called from ledgerApprove and NOWHERE ELSE. See rule 3 at the top of this file. */
function ledgerLearn(desc, catId) {
  if (!ledgerCatOk(catId)) return null;
  var key = ledgerKey(desc); if (!key) return null;
  var d = D(); if (!Array.isArray(d.budgetMemo)) d.budgetMemo = [];
  var m = d.budgetMemo.find(function (x) { return x && !x.deleted && x.key === key; });
  if (m) {
    /* he re-filed this payee somewhere else — his newest decision wins, and the count restarts, because
       a rule that keeps a high "seen" count after being corrected would keep sounding confident about
       the category he just rejected. */
    if (m.catId !== catId) { m.catId = catId; m.hits = 1; }
    else m.hits = (+m.hits || 0) + 1;
  } else {
    m = { id: "bgt-memo-" + (typeof uid === "function" ? uid() : String(Date.now())), key: key, catId: catId, hits: 1, deleted: false };
    d.budgetMemo.push(m);
  }
  m.lastUsed = (typeof today === "function") ? today() : "";
  m.lastDesc = String(desc || "").slice(0, 120);
  if (typeof touch === "function") touch(m);
  return m;
}

/* approve one row. `over` may carry his corrections: { catId, dir, amount, date, isTransfer, isCardPayment } */
function ledgerApprove(id, over) {
  over = over || {};
  var t = ledgerTx().find(function (x) { return x.id === id; });
  if (!t || !t.pending) return null;

  if (over.catId !== undefined) t.catId = ledgerCatOk(over.catId) ? over.catId : "";
  else t.catId = ledgerCatOk(t.suggestedCatId) ? t.suggestedCatId : "";
  if (over.dir === "in" || over.dir === "out") t.dir = over.dir;
  if (over.amount != null && +over.amount > 0) t.amount = Math.round(Math.abs(+over.amount) * 100) / 100;
  if (over.date) t.date = String(over.date);

  /* ⛔ DO NOT CLOBBER A FLAG THE OTHER LEG ALREADY SET. When the first leg was approved it reached across
     and marked this one isTransfer + transferId. Recomputing from `suggestTransfer` here would throw that
     away — and suggestTransfer is often false on the second leg precisely because its partner was still
     pending when it was ingested. The pair would silently come apart at the moment he finished approving it,
     and one side would go back to counting as spending. His own override still wins over everything. */
  t.isTransfer = (over.isTransfer !== undefined) ? !!over.isTransfer : (!!t.isTransfer || !!t.suggestTransfer);
  t.isCardPayment = (over.isCardPayment !== undefined) ? !!over.isCardPayment : !!t.suggestCardPayment;
  /* a transfer or card payment is cash moving between his own pockets — it carries no category, and
     forcing one on it is how the same dollar ends up counted as spending twice */
  if (t.isTransfer || t.isCardPayment) t.catId = "";

  /* ⭐ A TRANSFER HAS TWO LEGS AND BOTH HAVE TO KNOW IT. Flagging only the leg being approved leaves the
     other one — often imported and approved weeks earlier as ordinary spending — still counted. The
     money would show as having left, when it only moved rooms. So approving one leg marks its partner
     too and links them with a shared transferId (the field js/79 already understands). */
  if (t.isTransfer) {
    var mate = ledgerFindTransfer(t);
    if (mate) {
      t.transferId = t.transferId || mate.transferId || ("xfer-" + (typeof uid === "function" ? uid() : String(Date.now())));
      if (!mate.isTransfer || mate.transferId !== t.transferId) {
        mate.isTransfer = true; mate.transferId = t.transferId; mate.catId = "";
        if (typeof touch === "function") touch(mate);
      }
    }
  }

  t.pending = false;                              // ⭐ only here does it become real money in the budget
  t.approvedAt = (typeof now === "function") ? now() : Date.now();
  if (typeof touch === "function") touch(t);

  if (t.catId) ledgerLearn(t.note, t.catId);      // ⭐ his decision, not my guess
  if (typeof save === "function") save();
  return t;
}

function ledgerApproveMany(ids) {
  var n = 0;
  (ids || []).forEach(function (id) { if (ledgerApprove(id)) n++; });
  return n;
}

/* not his transaction (a duplicate the dedupe missed, someone else's card). Soft delete — this app never
   hard-deletes a record, and a rejected row still has to lose a sync race gracefully. */
function ledgerReject(id) {
  var t = ledgerTx().find(function (x) { return x.id === id; });
  if (!t || !t.pending) return null;
  t.deleted = true;
  if (typeof touch === "function") touch(t);
  if (typeof save === "function") save();
  return t;
}

/* what the queue adds up to, so he knows the size of what he's approving before he starts */
function ledgerInboxTotals() {
  var inn = 0, out = 0, unknown = 0;
  ledgerInbox().forEach(function (t) {
    if (t.suggestTransfer || t.suggestCardPayment) return;      // moves cash, is neither
    if (t.dir === "in") inn += +t.amount || 0; else out += +t.amount || 0;
    if (!t.suggestedCatId) unknown++;
  });
  return { in: Math.round(inn * 100) / 100, out: Math.round(out * 100) / 100, unrecognized: unknown };
}

if (typeof window !== "undefined") { window.ledgerSamePayee = ledgerSamePayee;
  window.ledgerIngest = ledgerIngest; window.ledgerSuggest = ledgerSuggest;
  window.ledgerInbox = ledgerInbox; window.ledgerInboxCount = ledgerInboxCount;
  window.ledgerInboxTotals = ledgerInboxTotals;
  window.ledgerApprove = ledgerApprove; window.ledgerApproveMany = ledgerApproveMany;
  window.ledgerReject = ledgerReject; window.ledgerLearn = ledgerLearn;
  window.ledgerRules = ledgerRules; window.ledgerIsDuplicate = ledgerIsDuplicate;
  window.ledgerFindTransfer = ledgerFindTransfer; window.ledgerFindCardPayment = ledgerFindCardPayment;
  window.ledgerFindBill = ledgerFindBill; window.ledgerKey = ledgerKey;
  window.ledgerMerchantKey = ledgerMerchantKey; window.ledgerDisplayName = ledgerDisplayName; window.LEDGER_SOURCES = LEDGER_SOURCES;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { LEDGER_SOURCES: LEDGER_SOURCES, LEDGER_XFER_DAYS: LEDGER_XFER_DAYS };
}
