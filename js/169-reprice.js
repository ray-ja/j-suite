/* ---------- REPRICE WITH ACTUALS (js/169) ---------------------------------------------------------------
   Ray, 2026-09-01: "After the receipts have been entered, I want the ability to go back to the initial
   pricing screen — but with the receipts factored in. The actual hard line for what we spent, so I can
   adjust the final price when needed. I wanna be able to see the market bands and everything."

   ⭐ THE LOOP THIS CLOSES: quote → work → receipts → BACK to the pricing table. The estimators price a job
   from guesses (est hours, est disposal, est materials); the receipts pipeline then collects what actually
   happened — and until now those two never met again. This module re-runs the SAME quote-engine math
   (qeEval, js/70 — the one every estimator prices through) with filed actuals, against the SAME market
   bands the quote froze at estimate time, and lets him set a new final price from an informed seat.

   ⚠️ MATERIALS CANCEL, AND THE MATH MUST SAY SO. His model bills materials at cost (pass-through): they sit
   inside the invoice total AND inside the cost line, so they wash out of margin/take-home entirely. They're
   shown — hiding a $683 line item breeds distrust — but labeled as cancelling, and the MARKET BAND compares
   the WORK price (price minus pass-through materials), because the bands were built from labor-value
   pricing where materials ride at cost (mkt.pay45 ≈ the work floor proves it: 2060 vs the 2039 work price).

   ⛔⛔ THE TIMECLOCK IS NOT CONSULTED. AT ALL. Ray, 2026-09-01, minutes after v1 shipped with clock-hours
   prefill: "definitely don't factor in clocked-in hours — those are absolutely worthless for these jobs.
   That system doesn't really work yet." He's right and the data agrees: 24-hour "shifts" from forgotten
   clock-outs, whole jobs with zero entries. My v1 capped entries at 12h and called it a prefill — but a
   number that appears in the box IS an endorsement, and a plausible-looking wrong prefill is worse than an
   empty box because it gets accepted unread. Hours start EMPTY; he types what the job really took. When
   the timeclock system is actually trusted, restoring the prefill is a two-line change here.

   ⛔ APPLYING IS A CHANGE ORDER, NOT A SIDE-CHANNEL. The apply writes finalPrice through the same
   snapshotQuoteVersion (js/90) every committed-quote edit uses, so version history shows who moved the
   price, from what, to what, and why. Owner only. Self-contained; safe to relocate. */

var RP = null;   // { qId, jobId, price, ph, other } — live modal state

function rpCanRun() { return (typeof isOwner !== "function") || isOwner(); }
function rpRound(n) { return Math.round((+n || 0) * 100) / 100; }
function rpMoney(n) { return (typeof money === "function") ? money(rpRound(n)) : "$" + rpRound(n).toFixed(2); }

/* filed actuals for a job — the numbers the receipts pipeline produced */
function rpActuals(jobId) {
  var d = (typeof D === "function") ? D() : {};
  var live = function (a) { return (a || []).filter(function (x) { return x && !x.deleted; }); };
  var mats = live(d.jobMaterials).filter(function (m) { return m.jobId === jobId; })
    .reduce(function (s, m) { return s + (+m.amount || 0); }, 0);
  /* ⛔ FUEL AND MEALS STAY OUT OF THE PRICING MATH. Ray, 2026-09-01, seeing \$54 of Wawa in the hard line:
     "that's just snacks and water for the crew — I don't want it to affect the reprice screen." And the
     model backs him twice over: fuel is already inside the \$0.725/mi mileage rate (counting it here
     double-counts it), and crew snacks are a perk he chooses, not a cost the JOB imposes. They still hit
     the job P&L — that screen's question is "what did this really make" — but pricing maths on disposal,
     rentals, tools, and the like. */
  var RP_SKIP_CATS = /^(fuel|meals)$/i;
  var exps = live(d.jobExpenses).filter(function (m) { return m.jobId === jobId && !RP_SKIP_CATS.test(m.category || ""); })
    .reduce(function (s, m) { return s + (+m.amount || 0); }, 0);
  /* ⛔ no timeclock read here — see the header. Hours are HIS input, always. */
  return { materials: rpRound(mats), expenses: rpRound(exps) };
}

/* the band the quote froze at estimate time (items[].mkt) + its label */
function rpBand(q) {
  var it = (q.items || []).filter(function (x) { return x && x.mkt; })[0];
  if (!it) return null;
  var label = (typeof MARKET_BANDS !== "undefined" && MARKET_BANDS[it.bandKey] && MARKET_BANDS[it.bandKey].label) || it.bandKey || "market";
  return { mkt: it.mkt, label: label };
}

/* pure: everything the readout shows for a candidate price. Reuses qeEval — the engine's own verdict. */
function rpCalc(q, inp) {
  var price = rpRound(inp.price), ph = +inp.ph || 0;
  var hard = rpRound(inp.materials + inp.expenses + (+inp.other || 0));
  var ev = (typeof qeEval === "function")
    ? qeEval(price, { crew: 1, onsiteHrs: ph, materials: hard })
    : { net: price - hard, takeHome: ph > 0 ? (price - hard) * 0.48 / ph : 0, margin: price > 0 ? (price - hard) / price : 0, ok: false, PH: ph, hard: hard };
  var workPrice = rpRound(price - inp.materials);          // the band compares labor-value, not pass-through
  var band = rpBand(q), pos = "";
  if (band) pos = workPrice < band.mkt.obxLo ? "below" : workPrice > band.mkt.obxHi ? "above" : "inside";
  var estPrice = rpRound(q.finalPrice || q.total || 0);
  var estHard = rpRound(q.cost || 0);
  return { price: price, ph: ph, hard: hard, ev: ev, workPrice: workPrice, band: band, pos: pos,
           estPrice: estPrice, estHard: estHard,
           estMargin: estPrice > 0 ? (estPrice - estHard - inp.materials) / estPrice : 0 };
}

function rpReadoutHTML(q, inp) {
  var c = rpCalc(q, inp);
  var col = c.ev.takeHome >= ((typeof QE !== "undefined" && QE.TAKE_HOME) || 45) ? "#1a7f37" : "#c1121f";
  var h = '<div class="card" style="text-align:center;border:2px solid ' + col + ';margin-top:10px">'
    + '<div style="font-size:12px;font-weight:700;color:var(--muted)">AT THIS PRICE, EACH PERSON ACTUALLY TOOK HOME</div>'
    + '<div style="font-size:30px;font-weight:800;line-height:1.1;color:' + col + '">' + rpMoney(c.ev.takeHome) + '/hr</div>'
    + '<div style="font-size:12px;color:' + col + ';font-weight:700">'
    + (c.ev.takeHome >= ((typeof QE !== "undefined" && QE.TAKE_HOME) || 45) ? "✓ clears the $" + ((typeof QE !== "undefined" && QE.TAKE_HOME) || 45) + "/hr floor — with REAL numbers" : "⚠ under the floor at what this job REALLY took") + '</div></div>'
    + '<div class="sub" style="margin:8px 2px;line-height:1.8;white-space:normal">'
    + c.ph.toFixed(1) + ' person-hours (actual) · hard costs ' + rpMoney(c.hard) + ' (actual) · margin ' + Math.round(c.ev.margin * 100) + '%'
    + '<br>estimate was: ' + rpMoney(c.estPrice) + ' price · ' + rpMoney(c.estHard) + ' est costs</div>';
  if (c.band) {
    var sc = c.pos === "inside" ? "#1a7f37" : c.pos === "below" ? "#c1121f" : "var(--muted)";
    h += '<div class="sub" style="margin:2px 2px;white-space:normal">📊 Local ' + esc(c.band.label) + ' range '
      + rpMoney(c.band.mkt.obxLo) + '–' + rpMoney(c.band.mkt.obxHi)
      + ' (national ' + rpMoney(c.band.mkt.natLo) + '–' + rpMoney(c.band.mkt.natHi) + ') — your work price '
      + rpMoney(c.workPrice) + ' is <b style="color:' + sc + '">' + c.pos + '</b>'
      + '<br><span style="opacity:.75">(band compares the work price — pass-through materials excluded on both sides)</span></div>';
  }
  return h;
}

function rpBtnHTML(j) {
  if (!rpCanRun() || !j) return "";
  var d = (typeof D === "function") ? D() : {};
  var q = (d.quotes || []).filter(function (x) { return x && !x.deleted && x.jobId === j.id; })[0];
  if (!q) return "";
  return '<button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="rpOpen(\'' + esc(q.id) + '\')">'
    + '⚖️ Reprice with actuals — the estimate screen, fed the receipts</button>';
}

if (typeof window !== "undefined") {
  window.rpBtnHTML = rpBtnHTML; window.rpActuals = rpActuals; window.rpCalc = rpCalc; window.rpBand = rpBand;

  window.rpOpen = function (qId) {
    var d = D(); var q = (d.quotes || []).find(function (x) { return x && x.id === qId; });
    if (!q) return;
    var a = rpActuals(q.jobId);
    RP = { qId: qId, price: rpRound(q.finalPrice || q.total || 0), ph: 0, other: 0,
           materials: a.materials, expenses: a.expenses };
    var body = ''
      + '<p class="muted" style="margin:0 0 10px;font-size:13px;white-space:normal">The pricing math, re-run with what the job '
      + '<b>actually</b> cost — filed materials, filed expenses, real hours. Adjust the price and watch the same readout the estimator showed.</p>'
      + '<label>Final price to the customer</label>'
      + '<input id="rp_price" type="number" inputmode="decimal" step="1" value="' + RP.price + '" oninput="rpLive()">'
      + '<div class="row" style="gap:8px"><div class="grow">'
      + '<label>Actual person-hours</label>'
      + '<input id="rp_ph" type="number" inputmode="decimal" step="0.5" value="' + RP.ph + '" oninput="rpLive()">'
      + '<div class="sub">' + (RP.ph > 0 ? "prefilled from the timeclock (entries capped at 12h)" : "no clock entries — type what it really took") + '</div>'
      + '</div><div class="grow">'
      + '<label>Other hard costs $</label>'
      + '<input id="rp_other" type="number" inputmode="decimal" step="0.01" value="0" oninput="rpLive()">'
      + '<div class="sub">dump runs, rentals — anything not filed to the job</div>'
      + '</div></div>'
      + '<div class="sub" style="margin-top:6px;white-space:normal">Filed to this job: <b>' + rpMoney(RP.expenses) + '</b> expenses · '
      + '<b>' + rpMoney(RP.materials) + '</b> pass-through materials <span style="opacity:.75">(billed at cost — cancels out of margin)</span></div>'
      + '<div id="rp_readout">' + rpReadoutHTML(q, RP) + '</div>'
      + '<button class="btn acc" style="margin-top:12px" onclick="rpApply()">Apply as a change order</button>'
      + '<div class="sub" style="margin-top:6px;white-space:normal">Writes the new final price with a version entry — the invoice updates in place, payments and history untouched.</div>';
    modal("⚖️ Reprice with actuals", body);
  };

  window.rpLive = function () {
    if (!RP) return;
    var v = function (id) { var el = document.getElementById(id); return el ? parseFloat(el.value) || 0 : 0; };
    RP.price = v("rp_price"); RP.ph = v("rp_ph"); RP.other = v("rp_other");
    var q = (D().quotes || []).find(function (x) { return x && x.id === RP.qId; });
    var el = document.getElementById("rp_readout");
    if (el && q) el.innerHTML = rpReadoutHTML(q, RP);
  };

  window.rpApply = function () {
    if (!RP) return;
    var q = (D().quotes || []).find(function (x) { return x && x.id === RP.qId; });
    if (!q) return;
    var newP = rpRound(RP.price);
    if (!(newP > 0)) { alert("Enter a price."); return; }
    var prevTotal = (typeof quoteEffectiveTotal === "function") ? quoteEffectiveTotal(q) : (q.finalPrice || q.total || 0);
    if (newP === rpRound(prevTotal)) { closeModal(); return; }   // no change, no ceremony
    var prevItems = JSON.parse(JSON.stringify(q.items || []));
    q.finalPrice = newP;
    q.adjNote = ((q.adjNote ? q.adjNote + " · " : "")
      + "Repriced after actuals " + ((typeof today === "function") ? today() : "")
      + ": " + rpMoney(prevTotal) + " → " + rpMoney(newP)
      + " (" + (+RP.ph || 0) + " real person-hours, " + rpMoney(RP.materials + RP.expenses + (+RP.other || 0)) + " real costs)").slice(0, 400);
    if (typeof snapshotQuoteVersion === "function") snapshotQuoteVersion(q, "Repriced with actuals", "reprice", prevTotal, prevItems);
    if (typeof touch === "function") touch(q);
    if (typeof logChange === "function") logChange("update", "quote", q.id, "Repriced with actuals → " + rpMoney(newP));
    if (typeof save === "function") save();
    closeModal();
    if (typeof render === "function") render();
    if (typeof toast === "function") toast("Final price " + rpMoney(newP) + " — recorded as a change order");
  };
}
if (typeof module !== "undefined" && module.exports) module.exports = { rpCalc: rpCalc, rpActuals: rpActuals };
