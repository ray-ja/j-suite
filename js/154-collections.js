/* ---------- COLLECTIONS (js/154) — what he is actually owed, and chasing it ------------------------
   $7,487 outstanding against a business that has collected $4,452 in its life, and 96% of it sits with one
   customer. That is more than a month of what he needs to live on. No feature in this app is worth more
   right now than getting some of it in.

   ⚠️ BUT FIRST: THE A/R SCREEN WAS OVERSTATING BY $1,437, AND CHASING THAT WOULD HAVE BEEN WORSE THAN
   DOING NOTHING. A quote's balance is total − Σ q.payments[]. Three of his jobs were paid, the income was
   booked against them, and no payment row was ever written on the quote — so they still read as unpaid:

       Michelle Brown  $960   payments logged $0   income booked $960
       Virginia Tucker $192   payments logged $0   income booked $192
       Virginia Tucker $285   payments logged $0   income booked $285

   Those are the two customers who pay him on time. Sending them a reminder for money they had already
   handed over is the kind of mistake that costs a relationship, and the app would have told him to do it
   with a straight face. ⭐ So the balance here is total − MAX(payments logged, income booked), and the
   discrepancy is surfaced for him to fix rather than silently patched — his records, his call.

   ⛔ AND NOTHING HERE SENDS ANYTHING. It drafts. He reads it, edits it, and taps his own phone's SMS or
   mail app. The operating agreement is that nothing customer-facing ships without his review, and a
   dunning letter going out in his name while he sleeps is exactly what that rule is for. */

function colActive(a) { return (a || []).filter(function (x) { return x && !x.deleted; }); }
function colRound(n) { return Math.round((+n || 0) * 100) / 100; }
function colTotal(q) { return +(q.finalPrice || q.total || 0) || 0; }
function colLogged(q) { return colActive(q.payments).reduce(function (s, p) { return s + (+p.amount || 0); }, 0); }

/* income booked against this quote — the other, often more accurate, record of having been paid */
function colBooked(q, d) {
  d = d || D();
  return colActive(d.income).filter(function (i) {
    return i.quoteId === q.id || (q.jobId && i.jobId === q.jobId);
  }).reduce(function (s, i) { return s + (+i.amount || 0); }, 0);
}

/* ⭐ THE TRUTH. Whichever record shows MORE money received is the one to believe — a payment that exists
   in either place is a payment that happened, and only one of them being written down is a bookkeeping
   gap, not evidence he wasn't paid. */
function colBalance(q, d) {
  return colRound(Math.max(0, colTotal(q) - Math.max(colLogged(q), colBooked(q, d))));
}
/* the quotes where the two records disagree — money he has that his A/R says he hasn't */
function colMismatches() {
  var d = D();
  return colActive(d.quotes).filter(function (q) {
    return colTotal(q) > 0 && colBooked(q, d) > colLogged(q) + 0.005;
  }).map(function (q) {
    return { id: q.id, name: q.cust || ((typeof custName === "function") ? custName(q.customerId) : "") || "—",
             total: colRound(colTotal(q)), logged: colRound(colLogged(q)), booked: colRound(colBooked(q, d)),
             fully: colBooked(q, d) >= colTotal(q) - 0.005 };
  });
}

function colDaysOld(dateStr) {
  if (!dateStr) return 0;
  var t = (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10);
  var a = Date.parse(String(dateStr) + "T00:00:00Z"), b = Date.parse(t + "T00:00:00Z");
  return (isNaN(a) || isNaN(b)) ? 0 : Math.max(0, Math.round((b - a) / 86400000));
}

/* ---------- what is genuinely owed ---------- */
function colOwed() {
  var d = D();
  var t = (typeof today === "function") ? today() : "";
  return colActive(d.quotes).map(function (q) {
    var bal = colBalance(q, d);
    if (bal <= 0.5) return null;
    /* ⛔⛔ WORK NOT YET DONE IS NOT A RECEIVABLE. Found 2026-08-27 while itemising his A/R: the largest
       "owed to you" line was $6,492 from a RECURRING occurrence dated 2026-09-23 — a landscaping visit a
       month in the future. Nobody owes money for a job that hasn't happened, and counting it inflated his
       receivables by 46% on the screen he'd use to decide who to chase.
       ⭐ Removing it brings the total to $7,487, which is exactly the figure reconciled from his records
       back in July — an independent check that this is the right cut, not a convenient one.
       ⚠️ Strictly future only: a job dated TODAY has been done and is properly owed. */
    if (t && String(q.date || "") > t) return null;
    var age = colDaysOld(q.date);
    return { id: q.id, customerId: q.customerId,
      name: q.cust || ((typeof custName === "function") ? custName(q.customerId) : "") || "—",
      total: colRound(colTotal(q)), balance: bal, age: age, date: q.date || "",
      invoiced: !!q.invoiced, payLink: q.paymentLink || "",
      lastChase: colLastSent(q.id),
      /* ⭐ what to do next, and they are different actions. An uninvoiced job isn't a slow payer —
         nobody has asked them for the money yet. */
      action: !q.invoiced ? "invoice" : "chase" };
  }).filter(Boolean).sort(function (a, b) {
    if (a.action !== b.action) return a.action === "invoice" ? -1 : 1;   // billing beats chasing
    return (b.balance * (b.age + 1)) - (a.balance * (a.age + 1));        // big and old first
  });
}
function colTotalOwed() { return colRound(colOwed().reduce(function (s, x) { return s + x.balance; }, 0)); }

/* ---------- the follow-up log ---------- */
function colFollowUps(quoteId) {
  try {
    return colActive(D().followUps).filter(function (f) { return !quoteId || f.quoteId === quoteId; })
      /* ⚠️ tie-break on id: two chases logged in the same millisecond otherwise sort arbitrarily, and
         "last chased" would flip between renders. Rare, but a wrong "you already chased this today" is
         exactly the kind of thing that stops him chasing. */
      .sort(function (a, b) { return (b.sentAt || 0) - (a.sentAt || 0) || String(b.id).localeCompare(String(a.id)); });
  } catch (e) { return []; }
}
function colLastSent(quoteId) {
  var f = colFollowUps(quoteId)[0];
  return f ? { at: f.sentAt, days: colDaysOld(new Date(f.sentAt).toISOString().slice(0, 10)), channel: f.channel } : null;
}
function colLogSent(quoteId, channel, text) {
  var d = D(); if (!Array.isArray(d.followUps)) d.followUps = [];
  var q = colActive(d.quotes).find(function (x) { return x.id === quoteId; });
  var me = (typeof curUser === "function") ? curUser() : null;
  var rec = { id: "fu_" + (typeof uid === "function" ? uid() : String(Date.now())),
    quoteId: quoteId, customerId: (q && q.customerId) || "",
    sentAt: (typeof now === "function") ? now() : Date.now(),
    channel: channel || "note", text: String(text || "").slice(0, 1000),
    byUserId: (me && me.id) || "", deleted: false };
  if (typeof touch === "function") touch(rec);
  d.followUps.push(rec);
  if (typeof save === "function") save();
  return rec;
}

/* ---------- ⭐ the draft ----------
   Tone follows AGE, because a fortnight and four months are different conversations and using the same
   words for both is how a reminder reads as either nagging or spineless. Written the way he talks —
   direct, no corporate padding, no apology for asking to be paid for work he did. */
function colDraft(row) {
  var money = function (n) { return (typeof budgetMoney === "function") ? budgetMoney(n) : "$" + (+n || 0).toFixed(2); };
  var first = String(row.name || "").trim().split(/\s+/)[0] || "there";
  var amt = money(row.balance);
  var link = row.payLink ? ("\n\nYou can pay online here: " + row.payLink) : "";
  var n = colFollowUps(row.id).length;

  if (row.action === "invoice") {
    return "Hi " + first + " — I've got the invoice ready for the work we finished"
      + (row.date ? " on " + row.date : "") + ", " + amt + ". Sending it over now."
      + "\n\nLet me know if anything looks off." + link;
  }
  if (row.age <= 14) {
    return "Hi " + first + " — just checking the invoice for " + amt + " came through OK."
      + " No rush, only want to make sure it didn't get buried." + link;
  }
  if (row.age <= 30) {
    return "Hi " + first + " — following up on the " + amt + " invoice from " + (row.date || "last month")
      + ". Could you let me know when I can expect it?" + link;
  }
  if (row.age <= 60) {
    return "Hi " + first + " — the " + amt + " invoice from " + (row.date || "") + " is now "
      + row.age + " days out. I'd like to get this closed out. Can you tell me a date it'll be paid?" + link;
  }
  return "Hi " + first + " — I still haven't received the " + amt + " from "
    + (row.date || "") + ", now " + row.age + " days. "
    + (n > 1 ? "I've followed up " + n + " times. " : "")
    + "I need a firm date from you this week so I know where we stand." + link;
}

/* ---------- rendering ---------- */
function colMoney(n) { return (typeof budgetMoney === "function") ? budgetMoney(n) : "$" + (+n || 0).toFixed(2); }

/* ⚠️ the discrepancy card comes FIRST — chasing money he already has is the worst outcome here */
function colMismatchHTML() {
  var m = colMismatches();
  if (!m.length) return "";
  var total = colRound(m.reduce(function (s, x) { return s + Math.min(x.booked, x.total) - x.logged; }, 0));
  return '<div class="card" style="border-left:4px solid var(--danger)">'
    + '<div class="nm">⚠️ ' + esc(colMoney(total)) + ' looks already paid</div>'
    + '<div class="sub" style="white-space:normal;margin-top:4px">'
    + m.length + ' job' + (m.length === 1 ? '' : 's') + ' with income recorded but no payment logged on the quote, '
    + 'so they still show as owed. Don\'t chase these until you\'ve checked.</div>'
    + m.map(function (x) {
        return '<div class="li"><div class="grow"><div class="nm" style="font-size:14px">' + esc(x.name) + '</div>'
          + '<div class="sub">' + esc(colMoney(x.total)) + ' quoted · ' + esc(colMoney(x.booked)) + ' received'
          + (x.fully ? ' · paid in full' : '') + '</div></div>'
          + '<button class="btn ghost sm" style="flex:0 0 auto;width:auto" onclick="colFixPaid(\'' + x.id + '\')">Mark paid</button></div>';
      }).join("")
    + '</div>';
}

function colOwedHTML() {
  var rows = colOwed();
  if (!rows.length) return colMismatchHTML() + '<div class="empty"><div class="big">✅</div>Nothing outstanding.</div>';
  var total = colRound(rows.reduce(function (s, x) { return s + x.balance; }, 0));
  var toBill = colRound(rows.filter(function (r) { return r.action === "invoice"; }).reduce(function (s, x) { return s + x.balance; }, 0));

  var h = colMismatchHTML()
    + '<div class="card" style="padding:12px 14px">'
    + '<div class="sub" style="font-size:11px;text-transform:uppercase;letter-spacing:.4px">Actually owed</div>'
    + '<div class="nm" style="font-size:26px;font-variant-numeric:tabular-nums">' + esc(colMoney(total)) + '</div>'
    + (toBill > 0.5 ? '<div class="sub" style="white-space:normal;margin-top:4px;color:var(--danger)">'
        + esc(colMoney(toBill)) + ' of that has never been invoiced — nobody has asked for it yet.</div>' : '')
    + '</div>';

  rows.forEach(function (r) {
    var last = r.lastChase;
    h += '<div class="card" style="padding:10px 12px">'
      + '<div class="row" style="gap:8px;align-items:baseline">'
      +   '<div class="grow" style="min-width:0"><div class="nm" style="font-size:15px">' + esc(r.name) + '</div>'
      +   '<div class="sub">' + esc(r.date) + ' · ' + r.age + ' days'
      +   (r.action === "invoice" ? ' · <span style="color:var(--danger);font-weight:600">not invoiced</span>' : '')
      +   (last ? ' · chased ' + (last.days === 0 ? 'today' : last.days + 'd ago') : '')
      +   '</div></div>'
      +   '<div class="nm" style="flex:0 0 auto;font-variant-numeric:tabular-nums">' + esc(colMoney(r.balance)) + '</div>'
      + '</div>'
      + '<button class="btn ' + (r.action === "invoice" ? 'acc' : 'ghost') + ' sm" style="width:100%;margin-top:8px"'
      + ' onclick="colOpenDraft(\'' + r.id + '\')">'
      + (r.action === "invoice" ? 'Draft the invoice message' : 'Draft a follow-up') + '</button>'
      + '</div>';
  });
  return h;
}

if (typeof window !== "undefined") {
  window.colOwed = colOwed; window.colBalance = colBalance; window.colBooked = colBooked;
  window.colMismatches = colMismatches; window.colDraft = colDraft; window.colFollowUps = colFollowUps;
  window.colLogSent = colLogSent; window.colLastSent = colLastSent; window.colTotalOwed = colTotalOwed;
  window.colOwedHTML = colOwedHTML; window.colMismatchHTML = colMismatchHTML; window.colDaysOld = colDaysOld;

  /* ⛔ he reads it, edits it, and sends it from his own phone. Nothing leaves this app on its own. */
  window.colOpenDraft = function (quoteId) {
    var row = colOwed().find(function (r) { return r.id === quoteId; });
    if (!row) return;
    var tel = "";
    try {
      var c = (D().customers || []).find(function (x) { return x && x.id === row.customerId; });
      tel = ((c && c.phone) || "").replace(/[^0-9+]/g, "");
      var mail = (c && c.email) || "";
      window._colMail = mail;
    } catch (e) {}
    window._colTel = tel; window._colQuote = quoteId;
    modal("Follow up · " + (row.name || ""), ''
      + '<p class="muted" style="margin:0 0 8px;font-size:13px">' + esc(colMoney(row.balance)) + ' · '
      + row.age + ' days · read it before it goes anywhere.</p>'
      + '<textarea id="col_text" style="min-height:180px">' + esc(colDraft(row)) + '</textarea>'
      + '<div class="row" style="gap:6px;margin-top:10px">'
      + (tel ? '<button class="btn acc" style="flex:1" onclick="colSend(\'sms\')">Text it</button>' : '')
      + (window._colMail ? '<button class="btn acc" style="flex:1" onclick="colSend(\'email\')">Email it</button>' : '')
      + '</div>'
      + '<button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="colSend(\'note\')">'
      + 'Just log that I followed up</button>'
      + (colFollowUps(quoteId).length
          ? '<div class="sub" style="white-space:normal;margin-top:10px">Previously: '
            + colFollowUps(quoteId).map(function (f) {
                return new Date(f.sentAt).toISOString().slice(0, 10) + ' (' + esc(f.channel) + ')';
              }).join(", ") + '</div>'
          : ''));
  };

  window.colSend = function (channel) {
    var text = (typeof val === "function") ? val("col_text") : "";
    var q = window._colQuote;
    if (!text || !q) return;
    colLogSent(q, channel, text);               // logged FIRST, so a chase is never lost to a failed handoff
    if (channel === "sms" && window._colTel) location.href = "sms:" + window._colTel + "?&body=" + encodeURIComponent(text);
    else if (channel === "email" && window._colMail) location.href = "mailto:" + window._colMail
      + "?subject=" + encodeURIComponent("Invoice follow-up") + "&body=" + encodeURIComponent(text);
    if (typeof closeModal === "function") closeModal();
    if (typeof render === "function") render();
  };

  /* the discrepancy fix: record the payment that the income says already happened */
  window.colFixPaid = function (quoteId) {
    var d = D();
    var q = colActive(d.quotes).find(function (x) { return x.id === quoteId; });
    if (!q) return;
    var booked = colBooked(q, d), logged = colLogged(q);
    var add = colRound(Math.min(booked, colTotal(q)) - logged);
    if (add <= 0.005) return;
    if (!confirm("Record " + colMoney(add) + " as paid on this job? The income is already booked against it.")) return;
    if (!Array.isArray(q.payments)) q.payments = [];
    q.payments.push({ id: (typeof uid === "function" ? uid() : String(Date.now())), amount: add,
      date: (typeof today === "function") ? today() : "", method: "", ref: "reconciled from income",
      by: ((typeof curUser === "function" && curUser()) ? curUser().username : ""), ts: (typeof now === "function") ? now() : Date.now() });
    if (typeof recReconcilePaid === "function") recReconcilePaid(q, (typeof today === "function") ? today() : "");
    if (typeof touch === "function") touch(q);
    if (typeof save === "function") save();
    if (typeof render === "function") render();
  };
}
if (typeof module !== "undefined" && module.exports) module.exports = { colRound: colRound };
