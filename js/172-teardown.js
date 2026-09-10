/* ---------- TEARDOWN ESTIMATOR — deck · fence · interior · small concrete (js/172) ----------
   Ray, 2026-09-09: demolition is the gap-closer — "deck removal sounds great… fences, interiors,
   outbuildings all sounds good. i think we can manage small concrete slabs and walls. we can always rent a
   home depot truck to tow if we need to… I will price at market. i didnt before because i was just putting
   my toe in. im ready to price at market."

   ⭐ MARKET PRICING, BY HIS EXPLICIT CALL. The hardscape jobs paid $12/hr blended because they were priced
   at the market FLOOR (see business-positioning memory). These bands sit at market MID for 2026:
   deck removal $5–12/sq ft (HomeGuide/Angi: most 200–400 sq ft decks land $1,000–2,500+), fence $3–6/lf,
   interior strip-out $3–6/sq ft, concrete $4–8/sq ft. Do not quietly lower them.

   ⚠️ THE TRAILER DECIDES WHICH DEMO PAYS. Debris is light-bulky (deck lumber ~8 lb/sq ft — one load) or
   dense (concrete 12.5 lb per sq ft per INCH — a 4" slab is 50 lb/sq ft). Every estimate computes LOADS at
   the ~3,600 lb cargo cap and charges a full dump run PER LOAD; 3+ loads surfaces the Home-Depot-rental
   note instead of silently pricing a day of shuttling. Shares js/30's cost model: no hourly-labor cost
   line, hard cost = tipping + consumables + drive mileage.

   ⛔ SCOPE GUARDS (say them out loud, they're in the notes): residential ≤4 units ONLY — commercial demo
   inherits NC asbestos survey/notification rules (accredited inspector, HHCU form, even asbestos-free).
   Power/gas/water disconnected by owner. Nothing structural to the HOUSE itself on interiors. */

var TD_TON = 90;                    // mixed C&D $/ton — the close station (dirty concrete is also $90)
var TD_CAP = (typeof HAUL_CARGO_CAP_LB !== "undefined") ? HAUL_CARGO_CAP_LB : 3600;
var TD_DUMP_MIN = 50;               // minutes per Soundside run
var TD_CONSUM = { deck: 30, fence: 20, interior: 35, slab: 45, wall: 45 };   // blades/bags/fuel; concrete eats blades

/* ---- pure calc (node-testable) -------------------------------------------------------------------- */
/* debris lbs per type. inp: {area,lf,heightFt,thickIn,railLf,stairs,footings,fenceKind,gut,boatFt,hull,motor} */
function tdWeight(type, inp) {
  inp = inp || {};
  var a = Math.max(0, +inp.area || 0), lf = Math.max(0, +inp.lf || 0);
  if (type === "boat") {
    /* hull weight per foot by construction: aluminum jon ~15, fiberglass skiff ~55, wood ~70 */
    var perFt = inp.hull === "alu" ? 15 : inp.hull === "wood" ? 70 : 55;
    return Math.round(Math.max(0, +inp.boatFt || 0) * perFt + (inp.motor ? 250 : 0));
  }
  /* dry acrylic shell + cabinet: 2-4 person ~700, 5-7 ~900, swim spa ~1,500 (per Ray: LIFTED out, never cut) */
  if (type === "hottub") return inp.tubSize === "small" ? 700 : inp.tubSize === "swim" ? 1500 : 900;
  /* pavers lift, they don't break: ~11 lb/sq ft of paver + ~2 of scraped setting sand */
  if (type === "pavers") return Math.round(a * 13);
  if (type === "deck")
    return Math.round(a * 8 + (+inp.railLf || 0) * 5 + (+inp.stairs || 0) * 150 + (+inp.footings || 0) * 60);
  if (type === "fence") {
    var perLf = inp.fenceKind === "chain" ? 4 : (+inp.heightFt || 6) >= 6 ? 12 : 9;
    var posts = Math.ceil(lf / 8);
    return Math.round(lf * perLf + (inp.footings ? posts * 50 : 0));
  }
  if (type === "interior") return Math.round(a * (inp.gut ? 10 : 4));
  /* slab/wall: concrete ~150 lb/cu ft → 12.5 lb per sq ft per inch of thickness */
  return Math.round(a * 12.5 * Math.max(1, +inp.thickIn || 4));
}
/* market price band for the WORK (drive added separately). Returns [lo, hi, min]. */
function tdBand(type, inp) {
  inp = inp || {};
  var a = Math.max(0, +inp.area || 0), lf = Math.max(0, +inp.lf || 0);
  /* boat disposal market runs $400–1,800, length-driven (researched 2026-09-09) */
  if (type === "boat") { var bf = Math.max(0, +inp.boatFt || 0); return [bf * 35, bf * 110, 400]; }
  if (type === "hottub") return inp.tubSize === "swim" ? [700, 1200, 700] : [350, 650, 350];   // 2026 market $300-600 + swim-spa tier
  if (type === "pavers") return [a * 2.5, a * 5, 400];   // lifting, not breaking — cheaper than concrete
  if (type === "deck") return [a * 5, a * 12, 600];
  if (type === "fence") return [lf * 3, lf * 6, 400];
  if (type === "interior") return [a * (inp.gut ? 4 : 3), a * (inp.gut ? 8 : 6), 500];
  return [a * 4, a * 8, 500];       // slab & wall, per face sq ft (thickness pushes within the band)
}
/* trailer loads at the cargo cap — every load is a full dump run */
function tdLoads(lbs) { return Math.max(1, Math.ceil(Math.max(0, +lbs || 0) / TD_CAP)); }
/* tear-down work minutes (crew-total), scaled by the push factors → feeds the $45/hr pay check */
function tdWorkMin(type, inp, push) {
  inp = inp || {};
  var a = Math.max(0, +inp.area || 0), lf = Math.max(0, +inp.lf || 0);
  var base = type === "boat" ? Math.max(0, +inp.boatFt || 0) * (inp.hull === "alu" ? 8 : inp.hull === "wood" ? 12 : 14)   // fiberglass cuts slowest
    : type === "hottub" ? (inp.tubSize === "swim" ? 240 : 120)   // disconnect-check, tip, walk, load — crew-total minutes
    : type === "pavers" ? a * 2                                  // lift + stack + scrape
    : type === "deck" ? a * 3 : type === "fence" ? lf * 5 : type === "interior" ? a * (inp.gut ? 5 : 2.5)
    : a * (8 + Math.max(0, (+inp.thickIn || 4) - 4));   // concrete: slower per inch past 4"
  return Math.round(base * (1 + (push || 0) * 0.5));
}

/* ---- BOAT PAPERWORK (Ray, 2026-09-09: "all of this should be built into the tool as reminders") ------
   NC titles vessels 14 ft+ (and all PWC). The boat NEVER changes hands — we are a demo contractor
   destroying the owner's property — so no title transfer. The verified NCWRC process:
     · lien check is FREE: the lienholder is printed on the face of an NC title, and NCWRC runs a free
       public online lookup (basic title/lien info) + phone confirm at 800-628-3773.
     · a recorded lien = someone's loan collateral. Destroying collateral is the one real trap — needs a
       notarized release from the lender first, or we walk.
     · after destruction the OWNER reports the vessel destroyed/scrapped to NCWRC within 15 DAYS
       (800-628-3773) — their call, not ours; the tool makes us remind them. */
function tdBoatChecklist(titled) {
  var items = [
    ["Title/registration seen — name matches the customer", true],
    ["Lien clear — check the title's lienholder line + NCWRC free lookup (800-628-3773)", titled],
    ["Disposal authorization signed (Print button below)", true],
    ["HIN plate photographed BEFORE and AFTER the cut", true],
    ["⭐ Remind the owner: report it destroyed to NC Wildlife within 15 DAYS — 800-628-3773", titled]
  ];
  return items.filter(function (x) { return x[1]; }).map(function (x) { return x[0]; });
}

/* ---- UI ------------------------------------------------------------------------------------------- */
/* node-requireable for teardown-tests.js: the pure calc above is the tested surface; the DOM handlers
   below land on a throwaway object when there is no window (same trick as the shared cwRead modules). */
if (typeof window === "undefined") var window = {};
var TD_TYPES = [["deck", "🪵 Deck"], ["fence", "🚧 Fence"], ["hottub", "♨️ Hot tub"], ["interior", "🧱 Interior strip-out"], ["slab", "🪨 Concrete slab"], ["wall", "🧊 Concrete wall"], ["pavers", "🟫 Paver patio"], ["boat", "🛶 Boat"]];

window.openTeardownEst = function () {
  if (!window._tdCrew) window._tdCrew = 2;
  if (!window._tdType) window._tdType = "deck";
  modal("Teardown — deck / fence / interior / concrete", ''
    + '<div class="row" style="gap:6px;flex-wrap:wrap" id="td_tabs"></div>'
    + '<div id="td_fields"></div>'
    + '<label>Access</label><select id="td_access" onchange="tdCalc()"><option value="easy">Easy — trailer reaches it</option><option value="tight">Tight — long carry / hand-out</option></select>'
    + '<div class="row" style="gap:6px;align-items:center;margin-top:8px"><div class="grow sub" style="font-weight:700">Crew on this job</div><span id="td_crew">' + ((typeof pvCrewBtns === "function") ? pvCrewBtns(window._tdCrew, "tdSetCrew") : "") + '</span></div>'
    + '<div class="sub" style="margin-top:6px">🚗 Drive is figured automatically — site round trip + a full dump run <b>per trailer load</b>.</div>'
    + '<div class="card" id="td_break" style="margin-top:12px"></div>'
    + '<div class="card" style="background:var(--accent);color:var(--accent-ink);text-align:center;margin-top:8px"><div style="font-size:13px;font-weight:700">PRICE TO GIVE</div><div id="td_price" style="font-size:32px;font-weight:800;line-height:1.1">$0</div><div id="td_band" style="font-size:12px;opacity:.85"></div></div>'
    + '<div class="card" style="border-left:4px solid var(--danger);font-size:12.5px;line-height:1.55"><b>Say this out loud:</b><br>'
    + '• <b>Residential only (≤4 units).</b> Commercial teardown needs an asbestos survey + state notification — refer it.<br>'
    + '• <b>Power / gas / water disconnected by the owner</b> before we touch anything attached to the house.<br>'
    + '• <b>Interiors: nothing load-bearing.</b> Surfaces, fixtures, non-structural walls only.<br>'
    + '• Contents emptied first — a full room is a junk line, <a href="#" onclick="closeModal();openJunkEst();return false">quote it there</a>.</div>'
    + '<label>Save under customer / job name</label><input id="td_name" placeholder="e.g. Miller oceanfront deck">'
    + '<button class="btn acc" style="margin-top:10px" onclick="saveTeardownQuote()">Review quote →</button>');
  tdTabs(); tdFields(); setTimeout(tdCalc, 40);
};
function tdTabs() {
  var el = document.getElementById("td_tabs"); if (!el) return;
  el.innerHTML = TD_TYPES.map(function (t) {
    return '<button class="btn ' + (window._tdType === t[0] ? "acc" : "ghost") + ' sm" style="flex:1 1 30%" onclick="tdSetType(\'' + t[0] + '\')">' + t[1] + '</button>';
  }).join("");
}
window.tdSetType = function (k) { window._tdType = k; tdTabs(); tdFields(); tdCalc(); };
window.tdSetCrew = function (n) { window._tdCrew = Math.max(1, n); var r = document.getElementById("td_crew"); if (r && typeof pvCrewBtns === "function") r.innerHTML = pvCrewBtns(window._tdCrew, "tdSetCrew"); tdCalc(); };

function tdFields() {
  var el = document.getElementById("td_fields"); if (!el) return;
  var t = window._tdType, h = "";
  var num = function (id, label, v) { return '<div class="grow"><label>' + label + '</label><input id="' + id + '" type="number" inputmode="decimal" value="' + v + '" min="0" oninput="tdCalc()"></div>'; };
  if (t === "deck") {
    h = '<div class="row" style="gap:8px">' + num("td_l", "Length (ft)", 16) + num("td_w", "Width (ft)", 12) + '</div>'
      + '<div class="row" style="gap:8px">' + num("td_rail", "Railing (linear ft)", 40) + num("td_stairs", "Stair flights", 1) + '</div>'
      + '<label>Height off grade</label><select id="td_elev" onchange="tdCalc()"><option value="low">Low (&lt; 4 ft)</option><option value="high">Elevated (4 ft+)</option></select>'
      + '<div class="toggle"><input type="checkbox" id="td_footings" onchange="tdCalc()"><label style="margin:0">Dig out + haul the footings (else cut flush)</label></div>';
  } else if (t === "fence") {
    h = '<div class="row" style="gap:8px">' + num("td_lf", "Fence length (linear ft)", 100) + num("td_h", "Height (ft)", 6) + '</div>'
      + '<label>Type</label><select id="td_fk" onchange="tdCalc()"><option value="wood">Wood panel / privacy</option><option value="chain">Chain link</option></select>'
      + '<div class="toggle"><input type="checkbox" id="td_footings" onchange="tdCalc()"><label style="margin:0">Posts set in concrete — dig + haul the footings</label></div>';
  } else if (t === "interior") {
    h = '<div class="row" style="gap:8px">' + num("td_l", "Room length (ft)", 15) + num("td_w", "Width (ft)", 12) + '</div>'
      + '<label>Scope</label><select id="td_gut" onchange="tdCalc()"><option value="light">Strip-out — flooring, trim, fixtures, cabinets</option><option value="gut">Full gut — down to studs (drywall out)</option></select>';
  } else if (t === "hottub") {
    h = '<label>Size</label><select id="td_tub" onchange="tdCalc()"><option value="std">Standard (5–7 person)</option><option value="small">Small (2–4 person)</option><option value="swim">Swim spa / oversized</option></select>'
      + '<label>Where it sits</label><select id="td_tubloc" onchange="tdCalc()"><option value="ground">Ground level / patio</option><option value="deck">On a deck (elevated)</option><option value="upstairs">Upper deck / tight spot</option></select>'
      + '<div class="sub" style="white-space:normal">Lifted out whole — we don\'t cut tubs. Owner kills the power at the breaker before we arrive; we drain if it\'s still wet (add time).</div>'
      + '<div class="toggle"><input type="checkbox" id="td_wet" onchange="tdCalc()"><label style="margin:0">Still full of water (we drain it first)</label></div>';
  } else if (t === "pavers") {
    h = '<div class="row" style="gap:8px">' + num("td_l", "Patio length (ft)", 12) + num("td_w", "Width (ft)", 10) + '</div>'
      + '<div class="toggle"><input type="checkbox" id="td_base" onchange="tdCalc()"><label style="margin:0">Scrape &amp; haul the sand base too</label></div>'
      + '<div class="sub" style="white-space:normal">Pavers lift, they don\'t break — cheaper than concrete. Good pavers have resale/reuse value; ask if the customer wants any kept.</div>';
  } else if (t === "boat") {
    h = '<div class="row" style="gap:8px">' + num("td_boatft", "Hull length (ft)", 14) + '</div>'
      + '<label>Construction</label><select id="td_hull" onchange="tdCalc()"><option value="glass">Fiberglass</option><option value="alu">Aluminum (jon boat)</option><option value="wood">Wood</option></select>'
      + '<div class="toggle"><input type="checkbox" id="td_motor" onchange="tdCalc()"><label style="margin:0">Motor still on it (comes too)</label></div>'
      + '<div class="sub" style="white-space:normal">⚠️ A boat TRAILER is a titled vehicle — the boat comes off it, the trailer stays (junk-car buyers take those). ⚠️ Fiberglass at Soundside: unconfirmed — it\'s on the to-do list; confirm before the first fiberglass quote.</div>'
      + '<div class="card" id="td_boatck" style="border-left:4px solid var(--danger);font-size:12.5px;line-height:1.6"></div>'
      + '<button class="btn ghost sm" style="width:100%" onclick="tdPrintBoatForm()">🖨 Print disposal authorization</button>';
  } else {
    h = '<div class="row" style="gap:8px">'
      + num("td_l", t === "slab" ? "Slab length (ft)" : "Wall length (ft)", t === "slab" ? 10 : 20)
      + num("td_w", t === "slab" ? "Width (ft)" : "Height (ft)", t === "slab" ? 10 : 4)
      + num("td_thick", "Thickness (in)", 4) + '</div>'
      + '<div class="sub" style="white-space:normal">Small slabs & walls only — a 10×10×4&quot; slab is already ~5,000 lb (2 loads). Big pours wait for the dually or get referred.</div>';
  }
  el.innerHTML = h;
}

window.tdCalc = function () {
  var t = window._tdType, g = function (id) { var e = document.getElementById(id); return e ? parseFloat(e.value) || 0 : 0; };
  var ck = function (id) { var e = document.getElementById(id); return !!(e && e.checked); };
  var sel = function (id) { var e = document.getElementById(id); return e ? e.value : ""; };
  var inp = { area: g("td_l") * g("td_w"), lf: g("td_lf"), heightFt: g("td_h") || 6, thickIn: g("td_thick") || 4,
    railLf: g("td_rail"), stairs: g("td_stairs"), footings: ck("td_footings"), fenceKind: sel("td_fk") || "wood", gut: sel("td_gut") === "gut",
    boatFt: g("td_boatft"), hull: sel("td_hull") || "glass", motor: ck("td_motor"),
    tubSize: (sel("td_tub") === "small" ? "small" : sel("td_tub") === "swim" ? "swim" : "std"), tubLoc: sel("td_tubloc") || "ground", wet: ck("td_wet"), base: ck("td_base") };
  if (t === "fence") inp.area = 0;
  var qty = t === "fence" ? inp.lf : t === "boat" ? inp.boatFt : t === "hottub" ? 1 : inp.area;
  /* the boat paperwork checklist, live with the titled/untitled line at 14 ft */
  if (t === "boat") {
    var bck = document.getElementById("td_boatck");
    if (bck) {
      var titled = inp.boatFt >= 14;
      bck.innerHTML = '<b>' + (titled ? "14 ft+ — TITLED vessel. Before the first cut:" : "Under 14 ft — no NC title. Before the first cut:") + '</b><br>'
        + tdBoatChecklist(titled).map(function (s) { return "☐ " + s; }).join("<br>");
    }
  }
  var lbs = tdWeight(t, inp), tons = lbs / 2000, loads = tdLoads(lbs);
  var disposal = Math.round(tons * TD_TON * 100) / 100;
  var consum = TD_CONSUM[t] || 25;

  /* push toward the top of the band by what makes it genuinely harder */
  var push = 0;
  if (sel("td_access") === "tight") push += 0.25;
  if (t === "deck") { if (sel("td_elev") === "high") push += 0.2; if (inp.footings) push += 0.25; if ((inp.stairs || 0) > 1) push += 0.1; }
  if (t === "fence" && inp.footings) push += 0.25;
  if (t === "interior" && inp.gut) push += 0.1;
  if (t === "boat") { if (inp.motor) push += 0.1; if (inp.boatFt >= 14) push += 0.1; }   // titled = paperwork time
  if (t === "hottub") { if (inp.tubLoc === "deck") push += 0.2; else if (inp.tubLoc === "upstairs") push += 0.45; if (inp.wet) push += 0.15; }
  if (t === "pavers" && inp.base) push += 0.2;   // the sand base adds shovel time and a heavier load
  if ((t === "slab" || t === "wall") && inp.thickIn > 4) push += Math.min(0.3, (inp.thickIn - 4) * 0.1);
  push = Math.min(1, push);

  var band = tdBand(t, inp), lo = band[0], hi = band[1], min = band[2];
  var workPrice = Math.max(min, Math.round((lo + (hi - lo) * push) / 25) * 25);

  /* drive: site round trip + a FULL dump run per load */
  var crew = window._tdCrew || 2;
  var dr = (typeof wizDriveCharge === "function") ? wizDriveCharge(crew) : { charge: 0, miles: 0, min: 0 };
  var MIL = (typeof QE !== "undefined" ? QE.MILEAGE : 0.725), LOADED = (typeof QE !== "undefined" ? QE.TAKE_HOME / QE.FIELD_SPLIT : 93.75);
  var DUMPMI = (typeof DISPOSAL_TRIP_MILES !== "undefined" ? DISPOSAL_TRIP_MILES : 14);
  var dumpRun = Math.round(DUMPMI * MIL + (TD_DUMP_MIN / 60) * LOADED);
  var driveCharge = dr.charge + dumpRun * loads;
  var driveMileage = Math.round((dr.miles + DUMPMI * loads) * MIL);
  var cost = Math.round((disposal + consum + driveMileage) * 100) / 100;
  var grand = workPrice + driveCharge;

  /* pay check — same convention as js/30: work minutes + drive/dump minutes per crew member */
  var workMin = tdWorkMin(t, inp, push);
  var totalPH = (workMin / 60) + crew * ((dr.min + TD_DUMP_MIN * loads + 20) / 60);
  var perHr = totalPH > 0 ? Math.floor((grand - cost) * 0.48 / totalPH) : 0;
  var hrsEach = crew > 0 ? Math.round(totalPH / crew * 10) / 10 : 0;
  var tier = perHr >= (typeof QE !== "undefined" ? QE.TAKE_HOME : 45) ? 2 : perHr >= (typeof QE !== "undefined" ? QE.CREW_FLOOR : 30) ? 1 : 0;

  var b = document.getElementById("td_break");
  if (b) b.innerHTML = '<div style="font-size:13px;line-height:1.85">'
    + (t === "fence" ? 'Fence: <b>' + inp.lf + ' lf × ' + inp.heightFt + ' ft</b>'
      : t === "boat" ? 'Hull: <b>' + inp.boatFt + ' ft ' + (inp.hull === "alu" ? "aluminum" : inp.hull === "wood" ? "wood" : "fiberglass") + '</b>' + (inp.motor ? ' + motor' : '') + (inp.boatFt >= 14 ? ' · <b style="color:#c1121f">TITLED</b>' : ' · no title')
      : t === "hottub" ? 'Tub: <b>' + (inp.tubSize === "small" ? "2–4 person" : inp.tubSize === "swim" ? "swim spa" : "5–7 person") + '</b> · ' + (inp.tubLoc === "ground" ? "ground level" : inp.tubLoc === "deck" ? "on a deck" : "upper deck / tight") + (inp.wet ? ' · <b>still wet</b>' : '')
      : 'Size: <b>' + Math.round(qty) + (t === "wall" ? ' sq ft face' : ' sq ft') + '</b>' + ((t === "slab" || t === "wall") ? ' × ' + inp.thickIn + '"' : '')) + '<br>'
    + 'Est. debris: <b>' + lbs.toLocaleString() + ' lb (' + tons.toFixed(2) + ' ton) = ' + loads + ' load' + (loads > 1 ? 's' : '') + '</b><br>'
    + 'C&amp;D tipping @ $' + TD_TON + '/ton: <b>' + money(disposal) + '</b> · consumables <b>' + money(consum) + '</b><br>'
    + '🚗 Site trip + ' + loads + ' dump run' + (loads > 1 ? 's' : '') + ' (' + DUMPMI + ' mi each): <b>' + money(driveCharge) + '</b></div>'
    + ((typeof haulCapNote === "function") ? haulCapNote(lbs, loads) : "")
    + (loads >= 3 ? '<div class="sub" style="color:#b8860b;font-weight:600;white-space:normal">🛻 ' + loads + ' loads — consider a Home Depot flatbed rental for the day (pass-through) instead of shuttling the trailer.</div>' : '')
    + '<div class="sub" style="margin-top:6px">Market band: ' + money(lo) + '–' + money(hi) + (min > lo ? ' (min ' + money(min) + ')' : '') + '. Work ' + money(workPrice) + ' + drive ' + money(driveCharge) + ' = <b>' + money(grand) + '</b>.</div>'
    + '<div class="row" style="justify-content:space-between;align-items:baseline;margin-top:6px"><div class="sub">' + crew + ' ' + (crew === 1 ? "person" : "people") + ' × ~' + hrsEach + ' hr each</div><div class="nm" style="font-size:17px;color:' + ["var(--danger)", "#b8860b", "var(--accent)"][tier] + '">' + money(perHr) + '/hr each ' + ["⚠", "⚠", "✓"][tier] + '</div></div>';
  var p = document.getElementById("td_price"); if (p) p.textContent = money(grand);
  var bd = document.getElementById("td_band"); if (bd) bd.textContent = TD_TYPES.filter(function (x) { return x[0] === t; })[0][1].replace(/^\S+\s/, "") + " · " + loads + " load" + (loads > 1 ? "s" : "") + " · band " + money(lo) + "–" + money(hi);

  window._td = { type: t, price: grand, workPrice: workPrice, cost: cost, lbs: lbs, tons: tons, loads: loads,
    disposal: disposal, driveCharge: driveCharge, driveMin: dr.min + TD_DUMP_MIN * loads, mins: workMin, crew: crew, qty: qty, inp: inp };
};

/* ---- printable vessel disposal authorization -------------------------------------------------------
   One page, fill-in-by-hand in the driveway. The legal shape (verified 2026-09-09): the boat never
   changes hands — DYAD is a demolition contractor destroying the OWNER'S property, so no title transfer;
   the owner attests sole ownership + no liens, authorizes destruction, and acknowledges THEIR 15-day
   NCWRC notification duty (800-628-3773). Opens a print window; works from file:// too.
   ⚠️ CUSTOMER-FACING — Ray reviews the wording before the first real signature (operating agreement). */
window.tdPrintBoatForm = function () {
  var ft = (function () { var e = document.getElementById("td_boatft"); return e ? e.value : ""; })();
  var w = window.open("", "_blank", "width=700,height=900");
  if (!w) { alert("Pop-up blocked — allow pop-ups to print the form."); return; }
  var L = function (lbl, wpx) { return '<div style="margin:14px 0"><span style="font-size:11px;color:#555">' + lbl + '</span><div style="border-bottom:1px solid #000;height:22px;width:' + (wpx || "100%") + '"></div></div>'; };
  w.document.write('<!DOCTYPE html><html><head><title>Vessel Disposal Authorization</title></head>'
    + '<body style="font-family:Georgia,serif;max-width:640px;margin:28px auto;color:#111;font-size:14px;line-height:1.5">'
    + '<div style="text-align:center;border-bottom:3px solid #111;padding-bottom:10px;margin-bottom:18px">'
    + '<div style="font-size:21px;font-weight:bold">VESSEL DISPOSAL AUTHORIZATION</div>'
    + '<div style="font-size:12px">OBX Junk Co. — a service of OBX Lot Solutions (DYAD Holdings LLC) · (252) 207-5985</div></div>'
    + '<table style="width:100%"><tr><td style="width:60%">' + L("Owner name") + '</td><td>' + L("Date") + '</td></tr></table>'
    + L("Owner address") + '<table style="width:100%"><tr><td style="width:50%">' + L("Phone") + '</td><td>' + L("NC registration # (if any)") + '</td></tr></table>'
    + '<table style="width:100%"><tr><td style="width:50%">' + L("Hull ID number (HIN)") + '</td><td style="width:25%">' + L("Length (ft)", "90%") + '</td><td>' + L("Make / type") + '</td></tr></table>'
    + '<p style="margin:18px 0 6px"><b>I state and agree that:</b></p>'
    + '<ol style="margin:0 0 14px;padding-left:22px">'
    + '<li>I am the sole owner of the vessel described above, and it is free of all liens and encumbrances.</li>'
    + '<li>I authorize OBX Junk Co. to demolish, remove and dispose of this vessel. Ownership does not transfer; the vessel is destroyed as my property, at my direction.</li>'
    + '<li>If this vessel is titled or registered in North Carolina, <b>I will notify the NC Wildlife Resources Commission that it has been destroyed within 15 days</b> (800-628-3773).</li>'
    + '<li>The boat trailer, if any, is not included and remains mine.</li></ol>'
    + '<table style="width:100%;margin-top:26px"><tr><td style="width:55%">' + L("Owner signature") + '</td><td>' + L("Date") + '</td></tr>'
    + '<tr><td>' + L("OBX Junk Co. crew signature") + '</td><td>' + L("HIN photographed ☐ before ☐ after") + '</td></tr></table>'
    + '<script>window.print();<\/script></body></html>');
  w.document.close();
};

window.saveTeardownQuote = function () {
  var d = window._td || {};
  if (!(d.price > 0)) { alert("Enter the size first."); return; }
  if (typeof WZON === "undefined" || !WZON || typeof WZ === "undefined" || !WZ) { alert("Open this from a quote so it links the customer."); return; }
  var nm = val("td_name"); if (nm && WZ.cust && !WZ.cust.name) WZ.cust.name = nm;
  var label = { deck: "Deck removal + haul-off", fence: "Fence removal + haul-off", interior: "Interior strip-out + haul-off", slab: "Concrete slab removal + haul-off", wall: "Concrete wall removal + haul-off", boat: "Boat disposal — cut up + haul-off", hottub: "Hot tub removal + haul-off", pavers: "Paver patio removal + haul-off" }[d.type];
  var notes;
  if (d.type === "boat") {
    /* ⭐ THE PAPERWORK RIDES ON THE QUOTE (Ray: "make sure all of this is in the tool as reminders") —
       so the checklist is on the record the crew opens at the job, not just in a modal someone closed. */
    var titled = (d.inp && d.inp.boatFt >= 14);
    notes = [label + (titled ? " — TITLED vessel (14 ft+)." : " — under 14 ft, no NC title."),
      "BEFORE THE CUT: " + tdBoatChecklist(titled).join(" · "),
      "Boat trailer NOT included — that's a titled vehicle; the boat comes off it.",
      "Price includes " + d.loads + " dump run" + (d.loads > 1 ? "s" : "") + " + tipping (" + (d.tons || 0).toFixed(2) + " ton)."];
  } else if (d.type === "hottub") {
    notes = [label + " — lifted out whole, never cut.",
      "Power killed at the breaker by the owner BEFORE we arrive; we disconnect nothing electrical.",
      (d.inp && d.inp.wet ? "Tub is wet — drain on site before the lift." : "Tub confirmed drained."),
      "Price includes the dump run + tipping (" + (d.tons || 0).toFixed(2) + " ton)."];
  } else if (d.type === "pavers") {
    notes = [label + " — pavers lifted and hauled" + (d.inp && d.inp.base ? ", sand base scraped and hauled too." : "; base left raked level."),
      "Ask before loading: does the customer want any pavers kept for reuse?",
      "Price includes " + d.loads + " dump run" + (d.loads > 1 ? "s" : "") + " + tipping (" + (d.tons || 0).toFixed(2) + " ton)."];
  } else {
    notes = [label + " — residential (≤4 units) only.",
      "Utilities disconnected by owner before work. " + (d.type === "interior" ? "Non-structural surfaces only." : ""),
      "Must-dump — price includes " + d.loads + " dump run" + (d.loads > 1 ? "s" : "") + " + C&D tipping (" + (d.tons || 0).toFixed(2) + " ton)."];
  }
  WZ.items = WZ.items || [];
  WZ.items.push({ serviceId: "", name: label, unit: "job", price: d.price, qty: 1, cost: d.cost || 0, notes: notes,
    bandKey: d.type === "deck" ? "deckdemo" : d.type === "fence" ? "fencedemo" : d.type === "interior" ? "intdemo" : d.type === "boat" ? "boatdemo" : d.type === "hottub" ? "hottubdemo" : d.type === "pavers" ? "paverdemo" : "concdemo",
    breakdown: [(d.type === "hottub" ? "1 tub" : Math.round(d.qty) + (d.type === "fence" ? " lf" : d.type === "boat" ? " ft hull" : " sq ft")) + " · " + (d.tons || 0).toFixed(2) + " ton · " + d.loads + " load" + (d.loads > 1 ? "s" : "")] });
  var crew = d.crew || 2, totalPH = ((d.mins || 0) / 60) + crew * ((d.driveMin || 0) / 60) + crew * (20 / 60);
  WZ.crewN = crew; WZ.hours = totalPH > 0 ? Math.round(totalPH / crew * 10) / 10 : 0;
  WZ.modalBuilt = true;
  closeModal(); WZ.step = "review"; render();
};

if (typeof module !== "undefined" && module.exports) module.exports = { tdWeight: tdWeight, tdBand: tdBand, tdLoads: tdLoads, tdWorkMin: tdWorkMin, tdBoatChecklist: tdBoatChecklist, TD_CAP: TD_CAP };
