/* ---------- DOWNSPOUT / GUTTER REPAIR — ITEM-COUNT ESTIMATOR (js/134) --------------------------------
   Ray, 2026-08-17, on a job the same day: "they want us to remove one gutter downspout and just move it
   somewhere else… in the new place it has a different path from the gutter to the wall. And then we also
   have to cap the old hole. Can you add this to the quote tool?"

   WHY THIS IS ITS OWN ESTIMATOR and not a field on the existing `gutters` service: that service prices
   CLEANING by linear feet of gutter. Repair work has nothing to do with gutter length — it is driven by
   how many discrete things you do (relocate a downspout, cap an outlet, cut a new one, hang straps).
   Pricing it per foot of gutter would be nonsense on a one-downspout job.

   PRICING MODEL — the house model, unchanged (matches js/101 French drain and js/112 stepping-stone):
     - PRICE = LABOR only. Each work item carries a labor price and an estimated crew-hour figure.
     - EVERY material is a PURE PASS-THROUGH at cost, zero margin, each with its own editable price and a
       who-supplies toggle. Ray's jobs routinely have the customer already holding most of the parts —
       which is exactly the case here ("they have most of the material") — so "customer provides" has to
       be one tap per line, not an all-or-nothing switch.
     - Drive is the static charge, same as every other estimator.
   Cost / Price / Profit / Margin with the 35% margin-floor warning.

   ⚠️ THE RE-PITCH LINE IS NOT PADDING. Gutters are pitched toward the downspout. Move the downspout and
   the run may now fall toward a dead end, ponding at the capped hole. Re-hanging that section is the
   difference between a finished job and a callback in three weeks, so it is a first-class line item with
   its own warning rather than something to discover on site. */

if (typeof window === "undefined") { var window = {}; }   // node test shim (browser: no-op)

const DS_DRIVE_DEF = 45;      // static drive charge, same convention as the other estimators

/* THE WORK ITEMS. price = labor $, hrs = crew-hours (drives the est $/hr sanity read, not the price).
   Calibrated against the 2026-08-17 job: relocate one downspout + cap the old outlet ≈ 2-3 hrs for two. */
const DS_WORK = [
  { key:"relocate", label:"Relocate a downspout", hint:"Take one down and re-run it somewhere else on the same gutter", price:165, hrs:1.5 },
  { key:"capout",   label:"Cap an old outlet hole", hint:"Riveted aluminium patch bedded in gutter sealant, inside the gutter", price:65,  hrs:0.5 },
  { key:"newout",   label:"Cut a new outlet", hint:"Mark, cut and seal a new drop outlet in the gutter", price:55,  hrs:0.4 },
  { key:"newdrop",  label:"New downspout run", hint:"A fresh downspout from gutter to grade", price:145, hrs:1.2 },
  { key:"repitch",  label:"Re-pitch a gutter section", hint:"⚠️ Re-hang so it falls to the NEW outlet — skip this and it ponds", price:95,  hrs:0.8 },
  { key:"reseal",   label:"Re-seal a joint or end cap", hint:"Clean and re-bed a leaking seam", price:45,  hrs:0.3 },
  { key:"rehang",   label:"Re-secure loose gutter", hint:"New hangers/screws where it has pulled away", price:75,  hrs:0.6 },
  { key:"extend",   label:"Add extension / splash block", hint:"Get the water away from the foundation", price:40,  hrs:0.3 }
];

/* MATERIALS — each with a real Home Depot-ish price, its own basis, and a who-supplies default.
   `perWork` ties a material's suggested quantity to a work item so the sheet fills itself in. */
const DS_MATS = [
  { key:"outlet",  label:"Drop outlet (2×3)",            unit:"ea",  cost:5.50,  def:"us", perWork:{ newout:1, relocate:1 } },
  { key:"elbow",   label:"Elbow (A or B style)",         unit:"ea",  cost:6.50,  def:"us", perWork:{ relocate:3, newdrop:3 } },
  { key:"pipe",    label:"Downspout, 10 ft section",     unit:"ea",  cost:12.00, def:"us", perWork:{ relocate:1, newdrop:1 } },
  { key:"strap",   label:"Downspout strap / bracket",    unit:"ea",  cost:4.00,  def:"us", perWork:{ relocate:3, newdrop:3 } },
  { key:"sealant", label:"Gutter/lap sealant (tube)",    unit:"ea",  cost:9.00,  def:"us", perWork:{ capout:1, reseal:1 } },
  { key:"flash",   label:"Aluminium flashing / coil",    unit:"ea",  cost:15.00, def:"us", perWork:{ capout:1 } },
  { key:"rivets",  label:"Rivets + zip screws (box)",    unit:"ea",  cost:14.00, def:"us", perWork:{ capout:1, relocate:1, newdrop:1 } },
  { key:"hanger",  label:"Hidden hanger",                unit:"ea",  cost:3.50,  def:"us", perWork:{ repitch:4, rehang:4 } },
  { key:"splash",  label:"Splash block / extension",     unit:"ea",  cost:11.00, def:"us", perWork:{ extend:1 } }
];

/* ---- THE CORE. Pure: counts in, money out. No globals, no DOM — node-testable. ---- */
function dsCalc(ds) {
  ds = ds || {};
  const work = ds.work || {};                 // {relocate:1, capout:1, …}
  const matQty = ds.matQty || {};             // explicit overrides
  const matCosts = ds.matCosts || {};
  const mats = ds.mats || {};                 // "us" | "cust"
  const crew = Math.max(1, +ds.crew || 2);

  /* labor + hours from the work items chosen */
  let laborPrice = 0, hours = 0;
  const lines = [];
  DS_WORK.forEach(w => {
    const n = Math.max(0, +work[w.key] || 0);
    if (!n) return;
    const p = (ds.workPrice && ds.workPrice[w.key] != null) ? Math.max(0, +ds.workPrice[w.key]) : w.price;
    laborPrice += p * n;
    hours += w.hrs * n;
    lines.push({ key: w.key, label: w.label, n: n, each: p, total: p * n });
  });

  /* suggested material quantities follow the work, unless overridden */
  let matCost = 0;
  const matLines = [];
  DS_MATS.forEach(m => {
    let q = 0;
    if (matQty[m.key] != null) q = Math.max(0, +matQty[m.key] || 0);
    else Object.keys(m.perWork || {}).forEach(wk => { q += (Math.max(0, +work[wk] || 0)) * m.perWork[wk]; });
    if (!q) return;
    const who = mats[m.key] || m.def;
    const unitCost = (matCosts[m.key] != null) ? Math.max(0, +matCosts[m.key]) : m.cost;
    const line = { key: m.key, label: m.label, qty: q, unit: m.unit, each: unitCost, who: who, total: 0 };
    if (who === "us") { line.total = Math.round(q * unitCost * 100) / 100; matCost += line.total; }
    matLines.push(line);
  });
  matCost = Math.round(matCost * 100) / 100;

  const drive = (ds.drive != null) ? Math.max(0, +ds.drive) : DS_DRIVE_DEF;
  /* materials are pass-through: they move price and cost by the same amount, so labor profit is untouched */
  const price = Math.round((laborPrice + matCost + drive) * 100) / 100;
  const cost = Math.round((matCost + drive) * 100) / 100;
  const profit = Math.round((price - cost) * 100) / 100;
  const margin = price > 0 ? Math.round((profit / price) * 1000) / 10 : 0;
  const perHr = hours > 0 ? Math.round((profit / (hours * crew)) * 100) / 100 : 0;

  return { lines, matLines, laborPrice: Math.round(laborPrice * 100) / 100, materials: matCost, matCost,
           drive, price, cost, profit, margin, hours: Math.round(hours * 100) / 100, crew, perHr,
           lowMargin: price > 0 && margin < 35 };
}

/* the quote line this becomes */
function dsItem(c) {
  const bits = c.lines.map(l => l.n + "× " + l.label).join(" · ");
  const notes = [];
  if (c.matLines.some(m => m.who === "cust")) notes.push("Customer provides: " + c.matLines.filter(m => m.who === "cust").map(m => m.label).join(", "));
  if (c.lines.some(l => l.key === "repitch")) notes.push("Includes re-pitching the gutter so it falls to the new outlet.");
  return {
    serviceId: "", name: "Gutter / downspout repair", unit: "job", price: c.price, qty: 1, cost: c.cost,
    estMat: c.materials, breakdown: [bits], notes: notes, bandKey: "downspout",
    estHours: c.hours, estCrew: c.crew
  };
}

if (typeof window !== "undefined") {
  window.dsCalc = dsCalc; window.dsItem = dsItem; window.DS_WORK = DS_WORK; window.DS_MATS = DS_MATS;

  window.wizDownspoutStart = function () {
    if (typeof WZ === "undefined" || !WZ) return;
    WZ.svc = "downspout";
    if (!WZ.ds) WZ.ds = { work: { relocate: 1, capout: 1 }, mats: {}, matCosts: {}, matQty: {}, workPrice: {}, crew: 2, drive: DS_DRIVE_DEF };
    if (typeof render === "function") render();
  };
  window.openDownspoutEst = window.wizDownspoutStart;

  window.wizDsWork = function (k, n) { if (!WZ.ds) return; if (!WZ.ds.work) WZ.ds.work = {}; WZ.ds.work[k] = Math.max(0, (+WZ.ds.work[k] || 0) + n); if (typeof render === "function") render(); };
  window.wizDsWorkPrice = function (k, v) { if (!WZ.ds) return; if (!WZ.ds.workPrice) WZ.ds.workPrice = {}; WZ.ds.workPrice[k] = Math.max(0, parseFloat(v) || 0); if (typeof render === "function") render(); };
  window.wizDsMatSrc = function (k, who) { if (!WZ.ds) return; if (!WZ.ds.mats) WZ.ds.mats = {}; WZ.ds.mats[k] = (who === "cust") ? "cust" : "us"; if (typeof render === "function") render(); };
  window.wizDsMatQty = function (k, v) { if (!WZ.ds) return; if (!WZ.ds.matQty) WZ.ds.matQty = {}; const n = parseFloat(v); if (v === "" || isNaN(n)) delete WZ.ds.matQty[k]; else WZ.ds.matQty[k] = Math.max(0, n); if (typeof render === "function") render(); };
  window.wizDsMatCost = function (k, v) { if (!WZ.ds) return; if (!WZ.ds.matCosts) WZ.ds.matCosts = {}; WZ.ds.matCosts[k] = Math.max(0, parseFloat(v) || 0); if (typeof render === "function") render(); };
  window.wizDsCrew = function (n) { if (!WZ.ds) return; WZ.ds.crew = Math.max(1, n); if (typeof render === "function") render(); };
  window.wizDsDrive = function (v) { if (!WZ.ds) return; WZ.ds.drive = Math.max(0, parseFloat(v) || 0); if (typeof render === "function") render(); };

  window.wizDownspoutUI = function () {
    const ds = WZ.ds || {};
    const c = dsCalc(ds);
    const money_ = (typeof money === "function") ? money : (n => "$" + (+n || 0).toFixed(2));

    let h = '<div class="card"><div style="font-weight:800;margin-bottom:2px">🏚️ Gutter / downspout repair</div>'
      + '<div class="sub" style="white-space:normal">Count what you\'re doing. Price is labour; every part is pass-through at cost.</div></div>';

    h += '<div class="card"><div style="font-weight:800;margin-bottom:6px">What are we doing?</div>';
    DS_WORK.forEach(w => {
      const n = Math.max(0, +(ds.work || {})[w.key] || 0);
      const p = (ds.workPrice && ds.workPrice[w.key] != null) ? ds.workPrice[w.key] : w.price;
      h += '<div class="li" style="align-items:flex-start">'
        + '<div class="grow"><div class="nm" style="font-size:14px">' + esc(w.label) + '</div>'
        + '<div class="sub" style="white-space:normal">' + esc(w.hint) + '</div>'
        + (n ? '<div class="sub" style="margin-top:4px">$<input type="number" value="' + p + '" onchange="wizDsWorkPrice(\'' + w.key + '\',this.value)" style="width:74px;display:inline-block;padding:4px 6px" inputmode="decimal"> each</div>' : '')
        + '</div>'
        + '<div class="row" style="flex:0 0 auto;gap:4px;align-items:center">'
        + '<button class="btn ghost sm" onclick="wizDsWork(\'' + w.key + '\',-1)">−</button>'
        + '<div style="min-width:22px;text-align:center;font-weight:800">' + n + '</div>'
        + '<button class="btn ghost sm" onclick="wizDsWork(\'' + w.key + '\',1)">+</button></div></div>';
    });
    h += '</div>';

    if (c.matLines.length) {
      h += '<div class="card"><div style="font-weight:800;margin-bottom:2px">🔩 Parts — who provides each?</div>'
        + '<div class="sub" style="white-space:normal;margin-bottom:6px">Ours are pass-through at cost. Quantities follow the work above — override any of them.</div>';
      c.matLines.forEach(m => {
        h += '<div class="li" style="align-items:flex-start"><div class="grow">'
          + '<div class="nm" style="font-size:14px">' + esc(m.label) + '</div>'
          + '<div class="sub" style="margin-top:3px">'
          + '<input type="number" value="' + m.qty + '" onchange="wizDsMatQty(\'' + m.key + '\',this.value)" style="width:62px;display:inline-block;padding:4px 6px" inputmode="decimal"> × $'
          + '<input type="number" value="' + m.each + '" onchange="wizDsMatCost(\'' + m.key + '\',this.value)" style="width:70px;display:inline-block;padding:4px 6px" inputmode="decimal">'
          + (m.who === "us" ? ' = <b>' + esc(money_(m.total)) + '</b>' : ' <span class="sub">— customer\'s</span>') + '</div></div>'
          + '<div class="row" style="flex:0 0 auto;gap:4px">'
          + '<button class="btn ' + (m.who === "us" ? "acc" : "ghost") + ' sm" onclick="wizDsMatSrc(\'' + m.key + '\',\'us\')">We do</button>'
          + '<button class="btn ' + (m.who === "cust" ? "acc" : "ghost") + ' sm" onclick="wizDsMatSrc(\'' + m.key + '\',\'cust\')">They do</button>'
          + '</div></div>';
      });
      h += '</div>';
    }

    h += '<div class="card"><div class="row" style="gap:10px">'
      + '<div class="grow"><label style="margin-top:0">Crew</label><div class="row" style="gap:4px">'
      + [1, 2, 3].map(n => '<button class="btn ' + (c.crew === n ? "acc" : "ghost") + ' sm" onclick="wizDsCrew(' + n + ')">' + n + '</button>').join("")
      + '</div></div>'
      + '<div class="grow"><label style="margin-top:0">Drive</label><input type="number" value="' + c.drive + '" onchange="wizDsDrive(this.value)" inputmode="decimal"></div>'
      + '</div></div>';

    h += '<div class="card"><div style="font-size:13px;line-height:1.9">'
      + '🔨 Labour: <b>' + esc(money_(c.laborPrice)) + '</b><br>'
      + '🔩 Parts — pass-through at cost: <b>+' + esc(money_(c.materials)) + '</b><br>'
      + '🚗 Drive: <b>+' + esc(money_(c.drive)) + '</b></div>'
      + '<div style="margin-top:8px;font-size:20px;font-weight:800;color:var(--brand-text)">' + esc(money_(c.price)) + '</div>'
      + '<div class="sub">cost ' + esc(money_(c.cost)) + ' · profit ' + esc(money_(c.profit)) + ' · margin ' + c.margin + '%'
      + (c.hours ? ' · ~' + c.hours + 'h × ' + c.crew + ' = ' + esc(money_(c.perHr)) + '/hr each' : '') + '</div>'
      + (c.lowMargin ? '<div class="sub" style="color:var(--danger);margin-top:6px;white-space:normal">⚠ Under the 35% margin floor.</div>' : '')
      + '</div>';

    if ((ds.work || {}).relocate && !(ds.work || {}).repitch) {
      h += '<div class="card" style="border-left:4px solid #E1A100;background:var(--soft)"><div class="sub" style="white-space:normal">'
        + '⚠ <b>Moving a downspout without re-pitching?</b> Gutters fall toward the outlet. If that run still slopes to the old hole, '
        + 'water will pond at the cap. Check the slope on site — add the re-pitch line if it needs it.</div></div>';
    }
    return h;
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { dsCalc: dsCalc, dsItem: dsItem, DS_WORK: DS_WORK, DS_MATS: DS_MATS };
}
