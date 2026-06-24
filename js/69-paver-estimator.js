/* ---------- PAVER PATIO / PAD ESTIMATOR — hardscape installs (patios, walkways, hot-tub pads) ----------
   Price = area × value $/sq ft by paver tier, pushed by base depth (a hot-tub pad needs a deeper base),
   cuts/curves, and access. Hard cost = pavers + base gravel + sand + edging + excavation haul + drive —
   no labor line (crew is paid from the revenue split). Optional override to log a job at the price you
   actually charged. Reached from the quote wizard's service list (🧱 Paver patio / pad). */
const PAVER_TIERS = { econ: { label: "Economy concrete paver", price: 14, mat: 4.5 }, std: { label: "Standard paver", price: 19, mat: 6.5 }, prem: { label: "Premium / large-format", price: 26, mat: 10 } };
const PAVER_BASE = { "4": { label: '4" base — walkway / light patio', rate: 1.8, push: 0 }, "6": { label: '6" base — standard patio', rate: 2.6, push: 0.10 }, "8": { label: '8" base — hot tub / heavy load', rate: 3.6, push: 0.25 } };
const PAVER_SAND = 0.75, PAVER_EDGE = 2.5, DIRT_TON = 45, SOIL_TON_PER_CUYD = 1.35;

window.openPaverEst = function () {
  modal("Paver Patio / Pad", `
    <p class="muted" style="margin:0 0 8px">Hardscape install — patios, walkways, hot-tub pads. Price updates live. Crew labor is paid from the revenue split, so it isn't a cost line — only materials, disposal &amp; drive are.</p>
    <div class="row" style="gap:8px">
      <div class="grow"><label>Length (ft)</label><input id="pv_l" type="number" inputmode="decimal" value="10" min="1" oninput="paverCalc()"></div>
      <div class="grow"><label>Width (ft)</label><input id="pv_w" type="number" inputmode="decimal" value="10" min="1" oninput="paverCalc()"></div>
    </div>
    <label>Paver tier</label>
    <select id="pv_tier" onchange="paverCalc()">${Object.keys(PAVER_TIERS).map(k => `<option value="${k}"${k === "std" ? " selected" : ""}>${esc(PAVER_TIERS[k].label)} — $${PAVER_TIERS[k].price}/sq ft</option>`).join("")}</select>
    <label>Base depth</label>
    <select id="pv_base" onchange="paverCalc()">${Object.keys(PAVER_BASE).map(k => `<option value="${k}"${k === "6" ? " selected" : ""}>${esc(PAVER_BASE[k].label)}</option>`).join("")}</select>
    <label>Access</label>
    <select id="pv_access" onchange="paverCalc()"><option value="easy">Easy — wheelbarrow run from the truck</option><option value="tight">Tight — long carry / gate / backyard</option></select>
    <div class="toggle"><input type="checkbox" id="pv_edge" checked onchange="paverCalc()"><label style="margin:0">Paver edging / restraint around the perimeter</label></div>
    <div class="toggle"><input type="checkbox" id="pv_cuts" onchange="paverCalc()"><label style="margin:0">Lots of cuts / curves / pattern (more labor &amp; waste)</label></div>
    <div class="toggle"><input type="checkbox" id="pv_haul" checked onchange="paverCalc()"><label style="margin:0">Excavate &amp; haul off the dug-out soil</label></div>
    <label>Travel zone</label>
    <select id="pv_zone" onchange="paverCalc()">${TRAVEL_ZONE_ORDER.map(z => `<option value="${z}">${esc(TRAVEL_ZONES_DEFAULT[z].label)}</option>`).join("")}</select>
    <label>Round-trip miles to disposal</label><input id="pv_miles" type="number" inputmode="decimal" value="30" min="0" oninput="paverCalc()">

    <div class="card" id="pv_break" style="margin-top:12px"></div>
    <div class="card" style="background:var(--accent);color:var(--accent-ink);text-align:center;margin-top:8px"><div style="font-size:13px;font-weight:700">PRICE TO GIVE</div><div id="pv_price" style="font-size:32px;font-weight:800;line-height:1.1">$0</div><div id="pv_band" style="font-size:12px;opacity:.85"></div></div>
    <div id="pv_cogs"></div>

    <label style="margin-top:10px">Actual price charged (optional — to log a job you already did)</label>
    <input id="pv_override" type="number" inputmode="decimal" placeholder="leave blank to use the estimate" oninput="paverCalc()">

    <label>Save under customer / job name</label><input id="pv_name" placeholder="e.g. Brodeur hot-tub pad">
    <button class="btn acc" style="margin-top:10px" onclick="savePaverQuote()">Save as quote</button>`);
  setTimeout(paverCalc, 40);
};

window.paverCalc = function () {
  const L = parseFloat(val("pv_l")) || 0, W = parseFloat(val("pv_w")) || 0, area = Math.max(0, L * W);
  const tier = PAVER_TIERS[val("pv_tier")] || PAVER_TIERS.std, base = PAVER_BASE[val("pv_base")] || PAVER_BASE["6"];
  const access = val("pv_access") || "easy";
  const edgeOn = (document.getElementById("pv_edge") || {}).checked !== false;
  const cuts = !!(document.getElementById("pv_cuts") || {}).checked;
  const haulOn = (document.getElementById("pv_haul") || {}).checked !== false;
  const zone = val("pv_zone") || "local", miles = parseFloat(val("pv_miles")) || 0;
  // --- hard cost ---
  const paverMat = area * tier.mat, baseMat = area * base.rate, sand = area * PAVER_SAND;
  const perim = 2 * (L + W), edge = edgeOn ? perim * PAVER_EDGE : 0;
  const materials = paverMat + baseMat + sand + edge;
  let soilTons = 0, haul = 0;
  if (haulOn) { const digFt = ((parseFloat(val("pv_base")) || 6) + 2) / 12; const cuyd = area * digFt / 27; soilTons = cuyd * SOIL_TON_PER_CUYD; haul = soilTons * DIRT_TON; }
  const tc = travelCharge({ zone: zone, miles: miles }), drive = mileageCost(miles);
  const workCost = Math.round((materials + haul) * 100) / 100;
  const cost = Math.round((workCost + drive) * 100) / 100;
  // --- value price ---
  let push = base.push + (cuts ? 0.15 : 0) + (access === "tight" ? 0.15 : 0); push = Math.min(0.4, push);
  let workPrice = Math.round(area * tier.price * (1 + push) / 25) * 25;
  const floorPrice = workCost > 0 ? Math.ceil((workCost / (1 - MARGIN_FLOOR)) / 25) * 25 : 0;
  if (workPrice < floorPrice) workPrice = floorPrice;
  const override = parseFloat(val("pv_override")) || 0;
  const grand = override > 0 ? override : (workPrice + tc.charge);
  // --- breakdown ---
  const b = document.getElementById("pv_break");
  if (b) b.innerHTML = `<div style="font-size:13px;line-height:1.85">
      Area: <b>${L}×${W} = ${Math.round(area)} sq ft</b> · ${esc(base.label.split("—")[0].trim())}<br>
      Pavers (${esc(tier.label)}, $${tier.mat}/sq ft): <b>${money(paverMat)}</b><br>
      Base gravel + sand: <b>${money(baseMat + sand)}</b><br>
      ${edgeOn ? `Edging (${Math.round(perim)} ft × $${PAVER_EDGE}): <b>${money(edge)}</b><br>` : ""}
      ${haulOn ? `Excavate &amp; haul (${soilTons.toFixed(1)} ton @ $${DIRT_TON}/ton): <b>${money(haul)}</b><br>` : ""}
      Travel (${esc(tc.short)} · ${tc.miles} mi): <b>${money(tc.charge)}</b>
    </div>
    <div class="sub" style="margin-top:6px">Install ${money(override > 0 ? override : workPrice)}${override > 0 ? " (your actual price)" : ` (${Math.round(area)} sq ft × $${tier.price}${push > 0 ? ` +${Math.round(push * 100)}%` : ""})`}${override > 0 ? "" : ` + travel ${money(tc.charge)}`} = <b>${money(grand)}</b>.</div>`;
  const p = document.getElementById("pv_price"); if (p) p.textContent = money(grand);
  const bd = document.getElementById("pv_band"); if (bd) bd.textContent = override > 0 ? `logged at your actual price ${money(override)}` : `install ${money(workPrice)} + travel ${money(tc.charge)}`;
  const cg = document.getElementById("pv_cogs"); if (cg) cg.innerHTML = cogsStrip(grand, cost);
  window._paver = { workPrice: workPrice, workCost: workCost, price: grand, cost: cost, override: override, area: area, L: L, W: W, zone: zone, miles: miles, tier: tier.label, base: base.label, notes: b ? b.innerText : "" };
};

window.savePaverQuote = function () {
  const d = window._paver || {};
  const nm = val("pv_name") || (d.L && d.W ? `${d.L}×${d.W} paver patio` : "Paver patio quote");
  const grand = d.price || 0, override = d.override || 0;
  const notes = (d.notes || "") + "\n" + (d.tier || "") + " · " + (d.base || "");
  let items;
  if (override > 0) { items = [{ serviceId: "", name: "Paver patio / pad install + materials", unit: "job", price: override, qty: 1, cost: d.cost || 0 }]; }
  else {
    items = [{ serviceId: "", name: "Paver patio / pad install + materials", unit: "job", price: d.workPrice || 0, qty: 1, cost: d.workCost || 0 }];
    const tline = travelLineItem({ zone: d.zone || "local", miles: d.miles || 0 }); if (tline.price > 0) items.push(tline);
  }
  const q = { id: uid(), customerId: null, cust: nm, propertyId: null, address: "", date: today(), items: items, recurring: false, subtotal: grand, discount: 0, total: grand, cost: d.cost || 0, kind: "paver", notes: notes, updatedAt: now() };
  if (!q.num && typeof nextQuoteNum === "function") q.num = nextQuoteNum();
  S.obx.quotes.push(q); save();
  if (typeof logEvent === "function") logEvent("Paver quote created — " + money(grand) + " · " + nm, "quote");
  closeModal();
  alert("Saved " + money(grand) + " paver quote for " + nm + ". Find it on the Jobs → Pipeline (Quote stage).");
  render();
};
