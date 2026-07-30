/* ---------- BUDGET RECEIPT SCAN (js/121) -----------------------------------------------------
   Snap a receipt on the Budget page and let Cap turn it into a transaction.

   WHY IT LIVES HERE and not on the Receipts page: the Receipts page routes everything to BUSINESS
   destinations (job-expense / pass-through material / business expense). Ray's personal org is being
   trimmed to life + budget + todo + messages — there IS no Receipts tab there. The transaction belongs
   where the money lives, so the camera goes on the Budget page.

   THE FLOW, and why it's ordered this way:
     1. upload the photo            -> a blob id (jsUpload, js/27)
     2. create a PENDING budgetTx carrying that receiptId, and save()
     3. WAIT FOR THE SYNC TO LAND   <- the whole reason this works
     4. ask the server to read it   -> /api/org-ai/read-receipt
     5. fill the pending tx from the read, then open the normal edit modal to confirm

   Step 3 is not optional. The blob uploads instantly but the RECORD rides a debounced save() push, so
   the server's rcptOwnedByOrg() check 404s if we read before the record lands. That exact race is what
   broke "12 phone receipts won't read" — whenSynced() (js/26) is the fix, so never remove it.

   PENDING is a real flag, not a UI state: actBudgetTx() (js/79) excludes t.pending, so a half-finished
   scan never reaches a total, an envelope, To-Be-Budgeted, or the tax estimate. Confirming in the modal
   clears it (saveBudgetTx). Unfinished scans surface in their own card so they can't get stranded. */

var BGT_RCPT = { busy: false, msg: "", pct: 0 };

function bgtRcptPendingAll() {
  return (D().budgetTx || []).filter(function (t) { return t && !t.deleted && t.pending; });
}
/* pending scans for the CURRENT book selection (Combined shows all) */
function bgtRcptPending() {
  return bgtRcptPendingAll().filter(function (t) {
    return (typeof budgetInBook === "function") ? budgetInBook(t) : true;
  });
}

function bgtRcptCanScan() {
  return typeof jsUpload === "function" && typeof whenSynced === "function" && !!(S && S.sync && S.sync.token);
}

/* ---- the card that goes at the top of the Transactions tab ---- */
function bgtRcptCardHTML() {
  var pend = bgtRcptPending();
  var h = '<div class="card">';
  if (BGT_RCPT.busy) {
    h += '<div style="font-weight:800">📷 Reading the receipt…</div>'
      + '<div class="sub" style="margin-top:4px">' + esc(BGT_RCPT.msg || "working") + '</div>'
      + '<div style="height:8px;border-radius:4px;background:var(--line);overflow:hidden;margin-top:8px">'
      + '<div style="height:100%;width:' + Math.max(4, Math.min(100, BGT_RCPT.pct)) + '%;background:var(--accent);transition:width .2s"></div></div>';
  } else if (!bgtRcptCanScan()) {
    h += '<div style="font-weight:800">📷 Scan a receipt</div>'
      + '<div class="sub" style="margin-top:4px">Needs a signed-in, synced device — open the app from the server, not a local file.</div>';
  } else {
    h += '<div class="row" style="gap:8px;align-items:center">'
      + '<div class="grow"><div style="font-weight:800">📷 Scan a receipt</div>'
      + '<div class="sub">Snap it and Cap fills in the amount, date and category. You confirm before it saves.</div></div>'
      + '<button class="btn acc" onclick="bgtRcptPick()">Scan</button></div>';
  }
  if (BGT_RCPT.msg && !BGT_RCPT.busy) {
    h += '<div class="note" style="margin-top:8px;white-space:normal">' + esc(BGT_RCPT.msg) + '</div>';
  }
  if (pend.length) {
    h += '<div style="border-top:1px solid var(--line);margin-top:10px;padding-top:8px">'
      + '<div class="sub" style="margin-bottom:6px"><b>' + pend.length + ' unfinished scan' + (pend.length === 1 ? "" : "s")
      + '</b> — not counted anywhere until you confirm.</div>';
    pend.slice(0, 6).forEach(function (t) {
      h += '<div class="row" style="gap:6px;align-items:center;margin-bottom:4px">'
        + '<div class="grow"><div style="font-size:13px">' + esc(t.note || "(unread receipt)")
        + (t.amount > 0 ? ' — <b>' + (typeof money2 === "function" ? money2(t.amount) : t.amount) + '</b>' : '')
        + '</div><div class="sub" style="font-size:11px">' + esc(t.date || "") + '</div></div>'
        + '<button class="btn ghost sm" onclick="openBudgetTx(\'' + t.id + '\')">Finish</button>'
        + '<button class="btn ghost sm" onclick="bgtRcptDiscard(\'' + t.id + '\')">✕</button></div>';
    });
    h += '</div>';
  }
  return h + '</div>';
}

/* ---- pick a file ---- */
if (typeof window !== "undefined") window.bgtRcptPick = function () {
  if (!bgtRcptCanScan()) { alert("This needs a signed-in, synced device."); return; }
  var inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*,application/pdf"; inp.capture = "environment";
  inp.onchange = function () { var f = inp.files && inp.files[0]; if (f) bgtRcptGo(f); };
  inp.click();
};

function bgtRcptStep(msg, pct) {
  BGT_RCPT.busy = true; BGT_RCPT.msg = msg; BGT_RCPT.pct = pct;
  if (typeof budgetRenderTx === "function" && BUDGET_SUB === "tx") budgetRenderTx(); else if (typeof render === "function") render();
}
function bgtRcptDone(msg) {
  BGT_RCPT.busy = false; BGT_RCPT.msg = msg || ""; BGT_RCPT.pct = 0;
  if (typeof budgetRenderTx === "function" && BUDGET_SUB === "tx") budgetRenderTx(); else if (typeof render === "function") render();
}

/* ---- the whole flow ---- */
if (typeof window !== "undefined") window.bgtRcptGo = async function (file) {
  if (BGT_RCPT.busy) return;
  var bookId = (typeof budgetDefaultBookId === "function") ? budgetDefaultBookId() : "";
  var txId = "bgt-tx-" + uid();
  try {
    bgtRcptStep("uploading the photo", 10);
    var receiptId = await jsUpload(file, function (p) { bgtRcptStep("uploading the photo", 10 + Math.round(p * 0.3)); });
    if (!receiptId) throw new Error("upload returned no id");

    /* the pending record must EXIST and be SYNCED before the server will read the blob */
    var d = D();
    if (!Array.isArray(d.budgetTx)) d.budgetTx = [];
    var t = { id: txId, receiptId: receiptId, pending: true, bookId: bookId,
              date: (typeof today === "function") ? today() : "", dir: "out", amount: 0, catId: "", note: "" };
    if (typeof touch === "function") touch(t);
    d.budgetTx.push(t);
    if (typeof save === "function") save();

    bgtRcptStep("saving, then reading it", 45);
    /* NEVER remove: the blob is up but the RECORD rides a debounced push. Reading first 404s. */
    await whenSynced(15000);

    bgtRcptStep("Cap is reading the receipt", 60);
    var read = await bgtRcptRead(receiptId);
    if (read.error) {
      bgtRcptDone("Uploaded, but the read failed: " + read.error + ". The scan is saved below — tap Finish to enter it by hand.");
      return;
    }
    var s = read.suggested || read;
    var filled = bgtRcptApply(txId, s);
    if (typeof save === "function") save();
    bgtRcptDone("");
    if (typeof openBudgetTx === "function") openBudgetTx(txId);
    if (!filled.amount) {
      setTimeout(function () { /* let the modal paint first */
        var el = document.getElementById("bt_amount"); if (el) el.focus();
      }, 60);
    }
  } catch (e) {
    bgtRcptDone("Couldn't scan that: " + ((e && e.message) || "unknown error") + (txId ? " The draft is saved below." : ""));
  }
};

/* ---- ask the server to read the blob (same route the business receipts use) ---- */
async function bgtRcptRead(receiptId) {
  var base = ((S.sync && S.sync.url) || location.origin).replace(/\/+$/, "");
  if (!base) return { error: "offline" };
  var cats = ((D().budgetCats) || []).filter(function (c) { return c && !c.deleted && !c.paymentEnvelope; })
    .map(function (c) { return c.name; }).slice(0, 40);
  try {
    var r = await fetch(base + "/api/org-ai/read-receipt", {
      method: "POST",
      headers: (typeof orgAiHeaders === "function") ? orgAiHeaders() : { "Content-Type": "application/json", "Authorization": "Bearer " + ((S.sync && S.sync.token) || "") },
      body: JSON.stringify({ org: S.biz, receiptId: receiptId, cats: cats, jobs: [] })
    });
    var j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) return { error: (j && j.error) || ("HTTP " + r.status) };
    if (j && j.skip) return { error: j.reason || "skipped" };
    return j || { error: "empty response" };
  } catch (e) { return { error: (e && e.message) || "request failed" }; }
}

/* ---- map a read onto the pending tx. Everything is untrusted: coerce and clamp. ---- */
function bgtRcptApply(txId, s) {
  var t = (D().budgetTx || []).find(function (x) { return x && x.id === txId; });
  if (!t || !s) return { amount: 0 };
  var amt = (s.amount == null || isNaN(+s.amount)) ? 0 : Math.abs(+s.amount);
  if (s.refund === true) amt = -amt;                       // a return/credit is money coming back
  if (amt) t.amount = Math.round(amt * 100) / 100;
  if (typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date)) t.date = s.date;
  var label = [s.vendor, s.desc].filter(function (x) { return x && typeof x === "string"; })[0] || "";
  if (label) t.note = String(label).slice(0, 120);
  /* the read returns a category NAME from the list we sent; resolve it to an id in THIS tx's book */
  if (s.category) {
    var want = String(s.category).toLowerCase();
    var c = ((D().budgetCats) || []).find(function (x) {
      return x && !x.deleted && !x.paymentEnvelope && (!t.bookId || x.bookId === t.bookId)
        && String(x.name || "").toLowerCase() === want;
    });
    if (c) { t.catId = c.id; t.dir = (c.kind === "in") ? "in" : "out"; }
  }
  if (t.amount < 0) { t.amount = Math.abs(t.amount); t.dir = "in"; }   // refund => income, positive amount
  if (typeof touch === "function") touch(t);
  return { amount: t.amount || 0 };
}

/* ---- drop an unfinished scan ---- */
if (typeof window !== "undefined") window.bgtRcptDiscard = function (id) {
  var t = (D().budgetTx || []).find(function (x) { return x && x.id === id; });
  if (!t) return;
  if (!confirm("Discard this unfinished scan? The photo stays on the server.")) return;
  t.deleted = true; t.pending = false;
  if (typeof touch === "function") touch(t);
  if (typeof save === "function") save();
  bgtRcptDone("");
};

if (typeof window !== "undefined") {
  window.bgtRcptCardHTML = bgtRcptCardHTML;
  window.bgtRcptPending = bgtRcptPending;
  window.bgtRcptPendingAll = bgtRcptPendingAll;
  window.bgtRcptApply = bgtRcptApply;
  window.bgtRcptCanScan = bgtRcptCanScan;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { bgtRcptApply: bgtRcptApply, bgtRcptPendingAll: bgtRcptPendingAll };
}
