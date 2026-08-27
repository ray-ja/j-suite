/* ---------- THE REVIEW QUEUE (js/144) — where he says yes ---------------------------------------------
   Ray, 2026-08-25: "autotagging after something is recognized but everything needs approvals. like ynab."

   The engine is js/143; this is the one screen that turns pending rows into real money. Two things shape
   how it looks:

   ⭐ EVERY SUGGESTION SHOWS ITS REASON. "you've filed 7 of these as Groceries" is a fact he can check.
   A category sitting in a dropdown with no explanation is indistinguishable from a guess, and he would
   have to audit each one to trust any of them. The reason is what makes bulk approval safe.

   ⭐ RECOGNIZED AND UNRECOGNIZED ARE SEPARATED. The recognized ones are a batch he can accept in one tap
   after a glance. The new payees are the only rows that actually need a decision. Mixing them means the
   pile is only as fast as its worst row, which is how a review queue becomes a thing you never open.

   ⛔ There is no "approve everything" button that spans both groups. Approving a payee I have never seen,
   sight unseen, is exactly the thing approvals exist to prevent. */

function lrMoney(n) {
  return (typeof budgetMoney === "function") ? budgetMoney(n)
    : "$" + (Math.round((+n || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function lrName(t) {
  var n = (typeof ledgerDisplayName === "function") ? ledgerDisplayName(t.note) : "";
  return n || t.note || "(no description)";
}
function lrDate(d) { return (typeof fmtDate === "function") ? fmtDate(d) : String(d || ""); }
function lrRecognized(t) { return !!(t.suggestTransfer || t.suggestCardPayment || (t.suggestedCatId && (t.suggestion || {}).confidence === "high")); }

/* the category picker for one row, scoped to that row's book */
function lrCatOptions(t) {
  var cats = [];
  try {
    cats = (D().budgetCats || []).filter(function (c) {
      return c && !c.deleted && c.bookId === t.bookId && !c.paymentEnvelope && !c.taxEnvelope
        && (c.kind || "out") === (t.dir === "in" ? "in" : "out");
    }).sort(function (a, b) { return (a.order || 0) - (b.order || 0) || String(a.name || "").localeCompare(b.name || ""); });
  } catch (e) {}
  var sel = t.suggestedCatId || "";
  return '<option value="">— pick a category —</option>'
    + cats.map(function (c) { return '<option value="' + c.id + '"' + (sel === c.id ? " selected" : "") + '>' + esc(c.name) + '</option>'; }).join("");
}

function lrRow(t) {
  var conf = (t.suggestion || {}).confidence || "none";
  var why = (t.suggestion || {}).why || "";
  var moves = t.suggestTransfer || t.suggestCardPayment;
  var badge = moves ? '<span class="badge" style="background:var(--soft);color:var(--ink)">moves cash</span>'
    : conf === "high" ? '<span class="badge" style="background:var(--accent);color:#08130a">recognized</span>'
    : conf === "medium" ? '<span class="badge" style="background:var(--soft);color:var(--ink)">probably</span>'
    : '<span class="badge" style="background:var(--soft);color:var(--muted)">new</span>';

  return '<div class="card" style="padding:10px 12px;margin-bottom:8px" id="lr_' + t.id + '">'
    + '<div class="row" style="gap:8px;align-items:baseline">'
    /* ⭐ the payee as he'd recognise it, not the bank's string. The raw line stays below it — he has to be
       able to check what he is approving against his statement, so nothing is hidden, only demoted. */
    +   '<div class="grow" style="min-width:0"><div class="nm" style="font-size:15px;white-space:normal">'
    +     esc(lrName(t)) + '</div>'
    /* ⭐ what it actually WAS, when an order history told us (js/162). "Amazon $358.19" is unfileable;
       "Amazon · DeWalt 20V Max drill kit" files itself. */
    +   (t.detail ? '<div class="sub" style="white-space:normal;color:var(--accent)">' + esc(String(t.detail).slice(0, 90)) + '</div>' : '')
    +   '<div class="sub">' + esc(lrDate(t.date)) + ' · ' + badge + '</div></div>'
    +   '<div class="nm" style="flex:0 0 auto;font-variant-numeric:tabular-nums;font-size:16px'
    +     (t.dir === "in" ? ';color:var(--accent)' : '') + '">' + (t.dir === "in" ? "+" : "−") + esc(lrMoney(t.amount)) + '</div>'
    + '</div>'
    /* ⭐ the reason, always. This is what makes approving a batch safe instead of a leap. */
    + (why ? '<div class="sub" style="white-space:normal;margin-top:4px">' + esc(why) + '</div>' : '')
    + (lrName(t) !== (t.note || "") ? '<div class="sub" style="white-space:normal;margin-top:2px;font-size:11px;opacity:.65">'
        + esc(String(t.note || "").slice(0, 90)) + '</div>' : '')
    /* ⭐ a bank row that is already recorded elsewhere (js/152) — offered before he picks a category */
    + ((typeof matchRowHTML === "function") ? matchRowHTML(t) : "")
    + ((typeof matchIsMatched === "function" && matchIsMatched(t))
        ? ''
        : (moves
        ? '<div class="sub" style="margin-top:6px">Won\'t count as income or spending.</div>'
        : '<select id="lrcat_' + t.id + '" style="margin-top:8px">' + lrCatOptions(t) + '</select>'))
    + '<div class="row" style="gap:6px;margin-top:8px">'
    +   '<button class="btn acc sm" style="flex:1" onclick="lrApprove(\'' + t.id + '\')">Approve</button>'
    +   '<button class="btn ghost sm" style="flex:0 0 auto;width:auto" onclick="lrReject(\'' + t.id + '\')">Not mine</button>'
    + '</div></div>';
}

function lrGroup(title, list, hint, bulkLabel) {
  if (!list.length) return "";
  var h = '<div class="secthd"><h2 style="font-size:13px">' + esc(title) + '</h2><div class="grow"></div>'
    + '<span class="ct">' + list.length + '</span></div>';
  if (hint) h += '<div class="sub" style="white-space:normal;margin:0 4px 8px">' + esc(hint) + '</div>';
  if (bulkLabel) {
    h += '<button class="btn acc" style="width:100%;margin-bottom:10px" onclick="lrApproveGroup(\''
      + list.map(function (t) { return t.id; }).join(",") + '\')">' + esc(bulkLabel) + '</button>';
  }
  return h + list.map(lrRow).join("");
}

function rLedgerReview() {
  var inbox = (typeof ledgerInbox === "function") ? ledgerInbox() : [];
  if (!inbox.length) {
    return '<div class="empty"><div class="big">✅</div>Nothing waiting.'
      + '<div class="sub" style="white-space:normal;margin-top:6px">Imported transactions land here first. '
      + 'Nothing counts toward your budget until you approve it.</div></div>';
  }
  var tot = ledgerInboxTotals();
  var known = inbox.filter(lrRecognized);
  var unknown = inbox.filter(function (t) { return !lrRecognized(t); });

  var h = '<div class="card" style="padding:12px 14px;margin-bottom:12px">'
    + '<div class="row" style="gap:14px">'
    +   '<div class="grow"><div class="sub" style="font-size:11px;text-transform:uppercase;letter-spacing:.4px">Waiting</div>'
    +     '<div class="nm" style="font-size:20px;font-variant-numeric:tabular-nums">' + inbox.length + '</div></div>'
    +   '<div class="grow"><div class="sub" style="font-size:11px;text-transform:uppercase;letter-spacing:.4px">Money in</div>'
    +     '<div class="nm" style="font-size:20px;font-variant-numeric:tabular-nums;color:var(--accent)">' + esc(lrMoney(tot.in)) + '</div></div>'
    +   '<div class="grow"><div class="sub" style="font-size:11px;text-transform:uppercase;letter-spacing:.4px">Money out</div>'
    +     '<div class="nm" style="font-size:20px;font-variant-numeric:tabular-nums">' + esc(lrMoney(tot.out)) + '</div></div>'
    + '</div>'
    + '<div class="sub" style="white-space:normal;margin-top:8px">None of this is in your budget yet.</div></div>';

  /* ⭐⭐ USE WHAT HE HAS ALREADY DECIDED. Ray, 2026-08-27: "we need to automate as much as possible I don't
     have time to be an accountant too." He had already categorised 263 transactions — and the learning table
     had ZERO rules in it, because rules are only written on approval and that history predates the ledger.
     263 answers he'd already given, sitting unused while this screen asked him again.
     Measured: backfilling them and re-asking answers 141 of the 276 unplaced rows, 51%, in one tap. */
  var _unlearned = 0;
  try {
    _unlearned = (typeof ledgerRules === "function" && !ledgerRules().length && typeof ledgerTx === "function")
      ? ledgerTx().filter(function (t) { return !t.pending && t.catId && !t.isTransfer && !t.isCardPayment; }).length : 0;
  } catch (e) {}
  /* ⭐ ORDER HISTORY (js/162) — the only place that knows what an "Amazon" charge actually was. */
  h += '<input type="file" id="oi_file" accept=".csv,text/csv" style="display:none" '
    + 'onchange="oiHandleFile(this.files &amp;&amp; this.files[0]); this.value=\'\'">'
    + '<button class="btn ghost" style="width:100%;margin-bottom:10px" onclick="oiPickFile()">'
    + '\ud83d\udce6 Import an order history (Amazon, Home Depot\u2026) \u2014 says what each charge was</button>';

  if (_unlearned > 20) {
    h += '<div class="card" style="border-left:4px solid #1e9e5a"><div class="row" style="align-items:center;gap:10px;flex-wrap:wrap">'
      + '<div class="grow" style="white-space:normal"><b>You\'ve already filed ' + _unlearned + ' transactions</b>'
      + '<div class="sub">I never learned from them — those rules only get written when you approve something here, '
      + 'and that history came in before this screen existed. Let me read them and re-check everything waiting.</div></div>'
      + '<button class="btn sm" style="background:#1e9e5a;border-color:#1e9e5a;color:#fff" onclick="lrLearnFromHistory()">Use my history</button>'
      + '</div></div>';
  }
  h += lrGroup("Recognized", known,
    "I've seen these payees before, or they just move cash between your own accounts.",
    known.length > 1 ? "Approve all " + known.length + " recognized" : "");
  /* ⛔ deliberately NO bulk button on this group */
  /* ⭐ BY PAYEE FIRST (js/160). On a first sync the recognised group is nearly empty and this one holds
     everything — 276 rows on Ray's, from about forty payees. Grouping them turns the pile into forty
     considered decisions instead of 276 identical ones, and each decision teaches a rule, so the row-by-row
     list below shrinks every time it's used. The flat list stays underneath for the ones that genuinely need
     handling individually. */
  var _pg = (typeof pgSectionHTML === "function") ? pgSectionHTML() : "";
  if (_pg) {
    h += _pg;
    h += '<div class="secthd"><h2 style="font-size:13px">…or one at a time</h2><div class="grow"></div>'
      + '<span class="ct">' + unknown.length + '</span></div>';
    h += unknown.map(lrRow).join("");
  } else {
    h += lrGroup("New payees", unknown,
      "First time I've seen these. Pick a category and I'll remember it for next time.", "");
  }
  return h;
}

if (typeof window !== "undefined") {
  window.rLedgerReview = rLedgerReview; window.lrRecognized = lrRecognized; window.lrRow = lrRow;
  window.lrName = lrName;

  /* one tap: learn from his own filed history, then re-ask for every row still waiting */
  window.lrLearnFromHistory = function () {
    var b = (typeof ledgerBackfillMemo === "function") ? ledgerBackfillMemo() : { rules: 0 };
    var r = (typeof ledgerResuggest === "function") ? ledgerResuggest() : { gained: 0 };
    if (typeof toast === "function") {
      toast(b.rules + " payee rule" + (b.rules === 1 ? "" : "s") + " learned · "
        + r.gained + " waiting transaction" + (r.gained === 1 ? "" : "s") + " now recognised");
    }
    if (typeof render === "function") render();
  };

  window.lrApprove = function (id) {
    var sel = document.getElementById("lrcat_" + id);
    var over = sel ? { catId: sel.value } : {};
    if (typeof ledgerApprove === "function") ledgerApprove(id, over);
    if (typeof render === "function") render();
  };
  /* bulk approve takes each row's ON-SCREEN category, not the stored suggestion — if he corrected one and
     then hit the group button, silently approving the old suggestion would file it wrong. */
  window.lrApproveGroup = function (csv) {
    var ids = String(csv || "").split(",").filter(Boolean);
    ids.forEach(function (id) {
      var sel = document.getElementById("lrcat_" + id);
      if (typeof ledgerApprove === "function") ledgerApprove(id, sel ? { catId: sel.value } : {});
    });
    if (typeof toast === "function") toast("Approved " + ids.length);
    if (typeof render === "function") render();
  };
  window.lrReject = function (id) {
    if (!confirm("Drop this one? It won't be imported again unless it comes in fresh.")) return;
    if (typeof ledgerReject === "function") ledgerReject(id);
    if (typeof render === "function") render();
  };
}
