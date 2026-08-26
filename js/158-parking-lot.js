/* ---------- PARKING-LOT CLEANING — the quote tool the lot-measuring belongs to ----------------------------
   Ray, 2026-08-26: "can you separate the draw lot / count spaces tool? that goes in a parking lot cleaning
   quote tool not on the map."

   ⭐ HE IS DESCRIBING A CATEGORY ERROR, NOT A LAYOUT PREFERENCE. Drawing a lot and counting spaces are the
   first STEP OF QUOTING one — they exist to produce a number that a price is built from. They were living on
   the Map, which is a reference view of where things are, and the quote wizard's 🅿️ Parking lot option
   literally did `TAB="map"; render()` — it ABANDONED the quote you were in the middle of, dropped you on a
   different screen with no customer and no way back, and left you to find the wizard again afterwards. The
   measurement had nowhere to go because there was nothing at the other end of it.

   So this is that other end: measure → scope → condition → disposal → price, ending in the normal wizard
   review with the customer still attached.

   PRICING — NOTHING HERE IS INVENTED. Every rule below already existed somewhere in the app and is now in one
   place where it can be seen and changed:
     · plBaseFrom() is the EXACT tier table the old map tool used ($79 / $129 / $199 / $349 / $499 / $799,
       then ×$1.60/space). ⛔ Kept byte-for-byte on purpose — it is what he has already quoted lots at, and a
       tool that silently re-prices old work is worse than no tool. It is the LIGHT, one-time, litter-only
       price; the catalogue calls it "Parking-lot cleanup (FROM)" and that is exactly what it is.
     · Scope, hazards and the disposal question come from CREW SOP 05 (js/43), which Ray set: "lot/roadside
       litter, dumpster-area, storefront/sidewalk, post-event" · "Disposal: customer dumpster (free) vs we
       haul (add dump fee)" · "recurring plans 20% off" · biohazard/sharps → don't handle.
     · CREW_BANDS.parking [$79-400] is the crew's on-site guardrail. Shown as a note when a lot prices out of
       it — NOT enforced, because a 400-space lot legitimately leaves that band and a cap would just be wrong.

   COST MODEL (CLAUDE.md): hard costs only — disposal, mileage, consumables. NO hourly-labor line; the owners
   are paid from the revenue split, not wages. Cost / Price / Profit / Margin with the 35% margin-floor warning.

   ⚠️ AND THE DISPOSAL LINE IS USUALLY $0, HONESTLY. Lot litter is light: even a heavy 200-space pick is a few
   hundred pounds, under the 500 lb the transfer station waives. Most of the time the customer's own dumpster
   takes it and there is no dump run at all. The tool says $0 and says why, rather than padding a fee to look
   thorough. */

if (typeof window === "undefined") { var window = {}; }   // node test shim (browser: no-op)

var PL_SQFT_PER_SPACE = 325;    // incl. drive aisles — the same default the map tool used
var PL_CONSUM_BASE    = 8;      // contractor bags, gloves, grabber wear
var PL_CONSUM_PER_SP  = 0.05;   // per space
var PL_CORRAL_PRICE   = 25;     // per dumpster corral: pick + sweep the pad + broom the corners (SOP 05)
var PL_STORE_PER_FT   = 0.35;   // storefront / sidewalk sweep, per linear ft
var PL_RECUR_DISC     = 0.20;   // recurring contract — 20% off, the app-wide rule

/* condition → [price multiplier, lb of debris per space, minutes per space] */
var PL_COND = {
  light:  { label: "Light — routine policing",        mult: 1.00, lbs: 0.35, min: 0.55 },
  normal: { label: "Normal — a week's worth",         mult: 1.30, lbs: 1.00, min: 1.10 },
  heavy:  { label: "Heavy — neglected, wind-blown",   mult: 1.70, lbs: 2.50, min: 2.10 },
  event:  { label: "Post-event / storm",              mult: 2.20, lbs: 6.00, min: 3.60 }
};
var PL_FREQ = {
  once:    { label: "One-time",   perYear: 0,  recur: false },
  weekly:  { label: "Weekly",     perYear: 52, recur: true  },
  biweek:  { label: "Bi-weekly",  perYear: 26, recur: true  },
  monthly: { label: "Monthly",    perYear: 12, recur: true  }
};

/* ---------- pure geometry (MOVED here from js/19 — it was only ever used to price a lot) ---------- */
/* shoelace on a lat/lng ring, projected to feet at the ring's own latitude. Same math as the map tool had. */
function plPolyAreaSqft(pts) {
  pts = pts || [];
  if (pts.length < 3) return 0;
  var lat0 = pts[0].lat * Math.PI / 180;
  var mx = function (p) { return p.lng * 111320 * Math.cos(lat0); };
  var my = function (p) { return p.lat * 110540; };
  var a = 0;
  for (var i = 0; i < pts.length; i++) {
    var j = (i + 1) % pts.length;
    a += mx(pts[i]) * my(pts[j]) - mx(pts[j]) * my(pts[i]);
  }
  return Math.abs(a / 2) * 10.7639;   // m² → sq ft
}
function plSpacesFromSqft(sqft, per) {
  var p = (+per > 0) ? +per : PL_SQFT_PER_SPACE;
  return Math.max(0, Math.round((+sqft || 0) / p));
}

/* ---------- HIS EXISTING TIERS — do not "improve" these without him ---------- */
function plBaseFrom(spaces) {
  var s = Math.max(0, +spaces || 0);
  return s <= 25 ? 79 : s <= 50 ? 129 : s <= 100 ? 199 : s <= 200 ? 349 : s <= 300 ? 499 : s <= 500 ? 799 : Math.round(s * 1.6);
}

/* ---------- the whole quote, as one pure function (node-testable, no DOM, no globals) ---------- */
function plQuote(inp) {
  inp = inp || {};
  var spaces  = Math.max(0, Math.round(+inp.spaces || 0));
  var cond    = PL_COND[inp.cond] ? inp.cond : "normal";
  var C       = PL_COND[cond];
  var corrals = Math.max(0, Math.round(+inp.corrals || 0));
  var storeFt = Math.max(0, +inp.storeFt || 0);
  var freq    = PL_FREQ[inp.freq] ? inp.freq : "once";
  var F       = PL_FREQ[freq];
  var weHaul  = !!inp.weHaul;                  // false = it goes in the customer's dumpster (SOP 05 default)
  var crew    = Math.max(1, Math.round(+inp.crew || 1));

  /* ---- price: the FROM tier, lifted by condition, plus the scope add-ons ---- */
  var base    = plBaseFrom(spaces);
  var lotWork = base * C.mult;
  var corralP = corrals * PL_CORRAL_PRICE;
  var storeP  = storeFt * PL_STORE_PER_FT;
  var visitRaw = lotWork + corralP + storeP;
  /* the recurring discount applies to the WORK, not to the drive — the drive costs the same every visit */
  var disc    = F.recur ? visitRaw * PL_RECUR_DISC : 0;
  var work    = Math.round((visitRaw - disc) / 5) * 5;

  /* ---- hard costs ---- */
  var lbs  = spaces * C.lbs + corrals * 40 + storeFt * 0.2;
  var tons = lbs / 2000;
  /* ⛔ tipping ONLY when we take it away. On the customer's dumpster there is no tip fee and no dump run —
     that is the SOP's own words, and it is the single biggest lever on a small lot's margin. */
  var CD  = (typeof QE !== "undefined") ? QE.CD_TON : 73.16;
  var FRE = (typeof QE !== "undefined") ? QE.FREE_LBS : 500;
  var MIL = (typeof QE !== "undefined") ? QE.MILEAGE : 0.725;
  var tip = weHaul ? Math.round(Math.max(0, lbs - FRE) / 2000 * CD * 100) / 100 : 0;
  var consum = Math.round((PL_CONSUM_BASE + spaces * PL_CONSUM_PER_SP) * 100) / 100;

  var dr = (typeof inp.drive === "object" && inp.drive) ? inp.drive
         : (typeof wizDriveCharge === "function") ? wizDriveCharge(crew) : { charge: 0, miles: 0, min: 0 };
  var DUMPMI = (typeof DISPOSAL_TRIP_MILES !== "undefined") ? DISPOSAL_TRIP_MILES : 55;
  var LOADED = (typeof QE !== "undefined") ? QE.TAKE_HOME / QE.FIELD_SPLIT : 93.75;
  var dumpRun = weHaul ? Math.round(DUMPMI * MIL + (80 / 60) * LOADED) : 0;
  var driveCharge = (dr.charge || 0) + dumpRun;
  var driveMi = Math.round(((dr.miles || 0) + (weHaul ? DUMPMI : 0)) * MIL * 100) / 100;

  var cost = Math.round((tip + consum + driveMi) * 100) / 100;
  var price = work + driveCharge;
  var profit = Math.round((price - cost) * 100) / 100;
  var margin = price > 0 ? profit / price : 0;

  /* ---- minutes → the $/hr-each check every other estimator shows ---- */
  /* ⚠️ `mins` is TOTAL PERSON-MINUTES OF WORK, not minutes of elapsed time — two people picking a lot halve
     the clock, they do not double the labour. Multiplying this by crew (my first cut) inflated a 2-person job
     to twice its real cost and made the $/hr warning fire on jobs that pay fine. Driving IS multiplied: the
     whole crew sits in the truck for the same trip. Same shape as demoCalc (js/30). */
  var mins = spaces * C.min + corrals * 12 + storeFt * 0.09 + 10;   // +10 setup: cones, vest, walk the hazards
  var personHrs = (mins / 60) + crew * (((dr.min || 0) + (weHaul ? 80 : 0)) / 60);
  var TAKE = (typeof QE !== "undefined") ? QE.TAKE_HOME : 45;
  var FLOOR = (typeof QE !== "undefined") ? QE.CREW_FLOOR : 30;
  var SPLIT = (typeof QE !== "undefined") ? QE.FIELD_SPLIT : 0.48;
  var perHr = personHrs > 0 ? Math.floor(profit * SPLIT / personHrs) : 0;
  var hrsEach = crew > 0 ? Math.round(personHrs / crew * 10) / 10 : 0;

  var band = (typeof CREW_BANDS !== "undefined" && CREW_BANDS.parking) ? CREW_BANDS.parking : [79, 400];
  var MF = (typeof QE !== "undefined") ? QE.MARGIN_FLOOR : 0.35;

  return {
    spaces: spaces, cond: cond, condLabel: C.label, freq: freq, freqLabel: F.label, recurring: F.recur,
    crew: crew, weHaul: weHaul,
    base: base, lotWork: Math.round(lotWork), corralP: corralP, storeP: Math.round(storeP * 100) / 100,
    disc: Math.round(disc), work: work, driveCharge: driveCharge, driveMin: (dr.min || 0) + (weHaul ? 80 : 0),
    driveMi: driveMi, price: price,
    lbs: Math.round(lbs), tons: Math.round(tons * 100) / 100, tip: tip, consum: consum,
    cost: cost, profit: profit, margin: margin, marginLow: margin < MF,
    mins: Math.round(mins), personHrs: Math.round(personHrs * 100) / 100, hrsEach: hrsEach,
    perHr: perHr, payTier: perHr >= TAKE ? 2 : perHr >= FLOOR ? 1 : 0,
    perYear: F.perYear, annual: F.perYear ? price * F.perYear : 0, monthly: F.perYear ? Math.round(price * F.perYear / 12) : 0,
    outOfBand: price < band[0] || price > band[1], band: band
  };
}

/* ================================ THE SCREEN ================================================ */
var PL = null;          // live input state while the modal is open
var PL_MAP = null, PL_POLY = [], PL_COUNT = [], PL_POLYL = null, PL_COUNTL = null, PL_MODE = "draw";

window.openParkingLotEst = function () {
  PL = { spaces: 0, cond: "normal", corrals: 0, storeFt: 0, freq: "once", weHaul: false, crew: 2, per: PL_SQFT_PER_SPACE };
  PL_MAP = null; PL_POLY = []; PL_COUNT = []; PL_MODE = "draw";
  modal("🅿️ Parking-lot cleaning", `
    <p class="muted" style="margin:0 0 8px">Litter policing, dumpster areas and storefronts. Crew labor is paid from the revenue split, so it isn't a cost line — only disposal, drive and consumables are.</p>

    <div class="row" style="gap:8px;align-items:flex-end">
      <div class="grow"><label>Parking spaces</label><input id="pl_spaces" type="number" inputmode="numeric" min="0" value="0" oninput="plSet('spaces',this.value)"></div>
      <button class="btn ghost" style="flex:0 0 auto;margin-bottom:2px" onclick="plToggleMap()" id="pl_mapbtn">🛰️ Measure it</button>
    </div>

    <div id="pl_maprow" style="display:none;margin-top:8px">
      <div class="maptop"><input id="pl_search" placeholder="Search the address…" style="flex:1;min-width:140px" onkeydown="if(event.key==='Enter')plSearch()"><button class="btn ghost sm" onclick="plSearch()">Go</button></div>
      <div class="maptop">
        <button class="subbtn on" id="plm_draw" onclick="plSetMode('draw')">▱ Draw lot</button>
        <button class="subbtn" id="plm_count" onclick="plSetMode('count')">• Count spaces</button>
        <button class="btn ghost sm" onclick="plClearMap()">Clear</button>
      </div>
      <div class="maptop"><label style="margin:0">Sq ft / space</label><input id="pl_per" type="number" value="${PL_SQFT_PER_SPACE}" style="width:80px" onchange="plSet('per',this.value)"><span class="muted">~325 incl. drive aisles</span></div>
      <div id="pl_map" style="height:300px;border-radius:10px;overflow:hidden"></div>
      <div class="sub" id="pl_mapres" style="margin-top:6px">Tap the corners of the lot — the area becomes a space count.</div>
    </div>

    <label style="margin-top:10px">Condition</label>
    <select id="pl_cond" onchange="plSet('cond',this.value)">${Object.keys(PL_COND).map(k => `<option value="${k}"${k === "normal" ? " selected" : ""}>${esc(PL_COND[k].label)}</option>`).join("")}</select>

    <div class="row" style="gap:8px">
      <div class="grow"><label>Dumpster corrals</label><input id="pl_corrals" type="number" inputmode="numeric" min="0" value="0" oninput="plSet('corrals',this.value)"></div>
      <div class="grow"><label>Storefront / sidewalk (ft)</label><input id="pl_store" type="number" inputmode="numeric" min="0" value="0" oninput="plSet('storeFt',this.value)"></div>
    </div>

    <label style="margin-top:10px">How often</label>
    <select id="pl_freq" onchange="plSet('freq',this.value)">${Object.keys(PL_FREQ).map(k => `<option value="${k}">${esc(PL_FREQ[k].label)}${PL_FREQ[k].recur ? " — 20% off" : ""}</option>`).join("")}</select>

    <div class="toggle" style="margin-top:10px"><input type="checkbox" id="pl_haul" onchange="plSet('weHaul',this.checked)"><label style="margin:0">We haul the debris away <span class="muted">(off = it goes in the customer's dumpster)</span></label></div>

    <div class="row" style="gap:6px;align-items:center;margin-top:8px"><div class="grow sub" style="font-weight:700">Crew on this job</div><span id="pl_crew">${(typeof pvCrewBtns === "function") ? pvCrewBtns(2, "plSetCrew") : ""}</span></div>

    <div class="card" id="pl_break" style="margin-top:12px"></div>
    <div class="card" style="background:var(--accent);color:var(--accent-ink);text-align:center;margin-top:8px"><div style="font-size:13px;font-weight:700">PRICE TO GIVE</div><div id="pl_price" style="font-size:32px;font-weight:800;line-height:1.1">$0</div><div id="pl_sub" style="font-size:12px;opacity:.85"></div></div>

    <div class="card" style="border-left:4px solid var(--danger);font-size:12.5px;line-height:1.55">
      <b>Excluded — say this out loud:</b><br>
      • <b>No biohazard, sharps or hazmat.</b> Basic litter only — anything else stops and comes to Ray.<br>
      • <b>Traffic areas need cones + high-vis.</b> Build it into the visit, not into an argument on site.<br>
      • If a one-off <b>balloons into a haul-off</b>, it stops being this job — <a href="#" style="color:inherit;font-weight:700;text-decoration:underline" onclick="closeModal();openJunkEst();return false">re-quote it as junk removal</a>.
    </div>

    <label>Save under customer / job name</label><input id="pl_name" placeholder="e.g. Seagate Center lot">
    <button class="btn acc" style="margin-top:10px" onclick="savePlQuote()">Review quote →</button>`);
  setTimeout(plCalc, 40);
};

window.plSet = function (k, v) {
  if (!PL) return;
  if (k === "weHaul") PL.weHaul = !!v;
  else if (k === "cond" || k === "freq") PL[k] = v;
  else PL[k] = parseFloat(v) || 0;
  if (k === "per") plMapRecalc();
  plCalc();
};
window.plSetCrew = function (n) {
  if (!PL) return;
  PL.crew = Math.max(1, n);
  var r = document.getElementById("pl_crew");
  if (r && typeof pvCrewBtns === "function") r.innerHTML = pvCrewBtns(PL.crew, "plSetCrew");
  plCalc();
};

/* ---------- the satellite measure, lifted whole from the old Map page ---------- */
window.plToggleMap = function () {
  var row = document.getElementById("pl_maprow"); if (!row) return;
  var show = row.style.display === "none";
  row.style.display = show ? "" : "none";
  var b = document.getElementById("pl_mapbtn"); if (b) b.textContent = show ? "▲ Hide map" : "🛰️ Measure it";
  if (show) setTimeout(plInitMap, 30);
};
function plInitMap() {
  var el = document.getElementById("pl_map"); if (!el) return;
  if (typeof L === "undefined") { el.innerHTML = '<div class="muted" style="padding:24px">Map library didn\'t load — measuring needs an internet connection. Type the space count instead.</div>'; return; }
  if (PL_MAP) { try { PL_MAP.invalidateSize(); } catch (e) {} return; }
  PL_MAP = L.map("pl_map").setView([36.07, -75.70], 11);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20, attribution: "Imagery © Esri" }).addTo(PL_MAP);
  PL_POLYL = L.layerGroup().addTo(PL_MAP); PL_COUNTL = L.layerGroup().addTo(PL_MAP);
  PL_MAP.on("click", function (e) {
    if (PL_MODE === "draw") { PL_POLY.push(e.latlng); plDrawPoly(); }
    else { PL_COUNT.push(e.latlng); plDrawCount(); }
    plMapRecalc();
  });
  /* ⚠️ a map created inside a hidden container measures itself as 0×0 and renders one grey tile — this is the
     line that makes it appear at all inside a modal that was display:none a moment ago */
  setTimeout(function () { try { PL_MAP.invalidateSize(); } catch (e) {} }, 60);
}
window.plSetMode = function (m) {
  PL_MODE = m;
  ["draw", "count"].forEach(function (x) { var b = document.getElementById("plm_" + x); if (b) b.classList.toggle("on", x === m); });
};
function plDrawPoly() {
  PL_POLYL.clearLayers();
  PL_POLY.forEach(function (p) { L.circleMarker(p, { radius: 4, color: "#8BC34A", fillColor: "#8BC34A", fillOpacity: 1 }).addTo(PL_POLYL); });
  if (PL_POLY.length >= 2) L.polygon(PL_POLY, { color: "#8BC34A", weight: 2, fillOpacity: 0.15 }).addTo(PL_POLYL);
}
function plDrawCount() {
  PL_COUNTL.clearLayers();
  PL_COUNT.forEach(function (p, i) {
    L.marker(p, { icon: L.divIcon({ className: "", iconSize: [20, 20], html: '<div style="background:#1B2A4E;color:#fff;border-radius:50%;width:20px;height:20px;font-size:11px;font-weight:700;text-align:center;line-height:20px">' + (i + 1) + '</div>' }) }).addTo(PL_COUNTL);
  });
}
window.plClearMap = function () {
  PL_POLY = []; PL_COUNT = [];
  if (PL_POLYL) PL_POLYL.clearLayers(); if (PL_COUNTL) PL_COUNTL.clearLayers();
  plMapRecalc();
};
/* the measurement WRITES the spaces field — the number stays editable by hand afterwards, because the count
   off a satellite photo is a starting point and he is the one standing in the lot */
function plMapRecalc() {
  var out = document.getElementById("pl_mapres"); if (!out || !PL) return;
  var n = null, why = "";
  if (PL_COUNT.length) { n = PL_COUNT.length; why = PL_COUNT.length + " tapped"; }
  else {
    var sqft = plPolyAreaSqft(PL_POLY);
    if (sqft >= 50) { n = plSpacesFromSqft(sqft, PL.per); why = Math.round(sqft).toLocaleString() + " sq ft ÷ " + (PL.per || PL_SQFT_PER_SPACE) + " sq ft/space"; }
  }
  if (n == null) { out.textContent = PL_MODE === "count" ? "Tap each space to count them." : "Tap the corners of the lot — the area becomes a space count."; return; }
  PL.spaces = n;
  var f = document.getElementById("pl_spaces"); if (f) f.value = n;
  out.innerHTML = "→ <b>" + n + " spaces</b> <span class='muted'>(" + esc(why) + ") — edit the number above if it's off</span>";
  plCalc();
}
window.plSearch = function () {
  var q = (document.getElementById("pl_search") || {}).value; if (!q) return;
  fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q))
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d[0] && PL_MAP) PL_MAP.setView([+d[0].lat, +d[0].lon], 19); else alert("Address not found."); })
    .catch(function () { alert("Search failed — the map needs an internet connection."); });
};

/* ---------- live recalc ---------- */
window.plCalc = function () {
  if (!PL) return;
  var q = plQuote(PL);
  window._pl = q;
  var m = (typeof money === "function") ? money : function (n) { return "$" + Math.round(n); };

  var b = document.getElementById("pl_break");
  if (b) b.innerHTML = `<div style="font-size:13px;line-height:1.85">
      Lot: <b>${q.spaces} space${q.spaces === 1 ? "" : "s"}</b> · ${esc(q.condLabel)}<br>
      Litter policing (from ${m(q.base)} × ${PL_COND[q.cond].mult.toFixed(2)}): <b>${m(q.lotWork)}</b><br>
      ${q.corralP ? `Dumpster corrals ×${PL.corrals} @ ${m(PL_CORRAL_PRICE)}: <b>${m(q.corralP)}</b><br>` : ""}
      ${q.storeP ? `Storefront / sidewalk ${PL.storeFt} ft @ $${PL_STORE_PER_FT}/ft: <b>${m(q.storeP)}</b><br>` : ""}
      ${q.disc ? `<span style="color:var(--accent)">Recurring contract — 20% off: <b>−${m(q.disc)}</b></span><br>` : ""}
      Debris: <b>${q.lbs.toLocaleString()} lb</b> · ${q.weHaul
        ? `we haul it — tipping ${q.tip > 0 ? m(q.tip) : "<b>$0</b> (under the first 500 lb, waived)"} + a dump run`
        : `<b>customer's dumpster — $0 to dispose, no dump run</b>`}<br>
      Consumables (bags, gloves): <b>${m(q.consum)}</b><br>
      🚗 Drive: <b>${m(q.driveCharge)}</b> <span class="muted">(${q.driveMi ? "$" + q.driveMi.toFixed(2) + " of it is real mileage cost" : "no mileage cost"})</span>
    </div>
    <div class="row" style="justify-content:space-between;align-items:baseline;margin-top:8px;flex-wrap:wrap;gap:6px">
      <div class="sub">Cost <b>${m(q.cost)}</b> · Profit <b>${m(q.profit)}</b> · Margin <b style="color:${q.marginLow ? "var(--danger)" : "var(--accent)"}">${Math.round(q.margin * 100)}%</b>${q.marginLow ? " ⚠ under the 35% floor" : ""}</div>
      <div class="nm" style="font-size:17px;color:${["var(--danger)", "#b8860b", "var(--accent)"][q.payTier]}">${m(q.perHr)}/hr each ${["⚠", "⚠", "✓"][q.payTier]}</div>
    </div>
    <div class="sub">${q.crew} ${q.crew === 1 ? "person" : "people"} × ~${q.hrsEach} hr each${q.outOfBand ? ` · <span style="color:#b8860b">outside the crew's $${q.band[0]}–${q.band[1]} guardrail — your call, not theirs</span>` : ""}</div>`;

  var p = document.getElementById("pl_price"); if (p) p.textContent = m(q.price);
  var s = document.getElementById("pl_sub");
  if (s) s.textContent = q.recurring
    ? `per visit · ${q.freqLabel.toLowerCase()} → ${m(q.monthly)}/mo · ${m(q.annual)}/yr`
    : `work ${m(q.work)} + drive ${m(q.driveCharge)}`;
};

/* ---------- into the normal wizard review, with the customer still attached ---------- */
window.savePlQuote = function () {
  var q = window._pl || {};
  if (!(q.price > 0) || !q.spaces) { alert("Enter the number of spaces first — or tap 🛰️ Measure it."); return; }
  if (typeof WZON === "undefined" || !WZON || typeof WZ === "undefined" || !WZ) { alert("Open this from a quote so it links the customer."); return; }
  var nm = (typeof val === "function") ? val("pl_name") : "";
  if (nm && WZ.cust && !WZ.cust.name) WZ.cust.name = nm;

  var notes = [
    "Parking-lot cleaning — " + q.spaces + " spaces · " + q.condLabel + (q.freqLabel !== "One-time" ? " · " + q.freqLabel : "") + ".",
    "Includes: lot litter policing" + (PL.corrals ? " · " + PL.corrals + " dumpster corral" + (PL.corrals > 1 ? "s" : "") + " (pick + sweep the pad)" : "") + (PL.storeFt ? " · " + PL.storeFt + " ft of storefront/sidewalk sweep" : "") + ".",
    q.weHaul ? "We haul the debris (dump run + tipping included)." : "Debris goes in the customer's dumpster on site — no haul-off in this price.",
    "Excludes: biohazard / sharps / hazmat. A one-off that turns into a haul-off is re-quoted as junk removal."
  ];
  WZ.items = WZ.items || [];
  WZ.items.push({
    serviceId: "", name: "Parking-lot cleaning — " + q.spaces + " spaces", unit: q.recurring ? "visit" : "job",
    price: q.price, qty: 1, cost: q.cost, notes: notes, bandKey: "parking",
    breakdown: [q.spaces + " spaces · " + q.condLabel + " · " + q.lbs.toLocaleString() + " lb debris" + (q.weHaul ? " (we haul)" : " (customer's dumpster)")]
  });
  /* ⭐ a recurring frequency IS the recurring contract — flip the wizard's own toggle rather than making him
     find it again two screens later, since the 20% is already in the price above */
  if (q.recurring) WZ.recurring = true;
  WZ.crewN = q.crew;
  WZ.hours = q.hrsEach;
  WZ.modalBuilt = true;
  closeModal(); WZ.step = "review"; if (typeof render === "function") render();
};

if (typeof window !== "undefined") {
  window.plQuote = plQuote; window.plBaseFrom = plBaseFrom;
  window.plPolyAreaSqft = plPolyAreaSqft; window.plSpacesFromSqft = plSpacesFromSqft;
  window.PL_COND = PL_COND; window.PL_FREQ = PL_FREQ;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { plQuote: plQuote, plBaseFrom: plBaseFrom, plPolyAreaSqft: plPolyAreaSqft, plSpacesFromSqft: plSpacesFromSqft, PL_COND: PL_COND, PL_FREQ: PL_FREQ, PL_SQFT_PER_SPACE: PL_SQFT_PER_SPACE };
}
