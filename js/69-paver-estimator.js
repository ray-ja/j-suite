/* ---------- PAVER PATIO / PAD ESTIMATOR — hardscape installs (patios, walkways, hot-tub pads) ----------
   Price = area × the $/sq ft you charge (+ travel). Hard cost = pavers (only if WE buy them) + base prep
   + edging + excavation haul + drive — no labor line (crew is paid from the revenue split). A proper paver
   install needs a crushed-stone base AND sand; skipping the stone is the cheap/wrong way. Optional override
   to log a job at the price you actually charged. Reached from the quote wizard (🧱 Paver patio / pad). */
const PAVER_EDGE = 2.5, DIRT_TON = 45, SOIL_TON_PER_CUYD = 1.35;
const PAVER_BASE_RATES = { full: 3.35, sand: 0.85, prepped: 0 };   // $/sq ft material: stone+sand / sand only / customer prepped
const PAVER_DIG_IN = { full: 8, sand: 3, prepped: 0 };             // inches excavated (drives haul volume)

window.openPaverEst = function () {
  modal("Paver Patio / Pad", `
    <p class="muted" style="margin:0 0 8px">Hardscape install — patios, walkways, hot-tub pads. Price updates live. Crew labor is paid from the revenue split, so it isn't a cost line — only materials, disposal &amp; drive are.</p>
    <div class="row" style="gap:8px">
      <div class="grow"><label>Length (ft)</label><input id="pv_l" type="number" inputmode="decimal" value="10" min="1" oninput="paverCalc()"></div>
      <div class="grow"><label>Width (ft)</label><input id="pv_w" type="number" inputmode="decimal" value="10" min="1" oninput="paverCalc()"></div>
    </div>
    <label>Price you charge ($ per sq ft) — your all-in rate</label>
    <input id="pv_price" type="number" inputmode="decimal" value="13" min="0" oninput="paverCalc()">
    <label>Who supplies the pavers?</label>
    <select id="pv_pavers" onchange="paverCalc()"><option value="us">We buy the pavers</option><option value="cust">Customer supplies the pavers</option></select>
    <div id="pv_pcost_row"><label>Paver cost — what WE pay ($ per sq ft)</label><input id="pv_pcost" type="number" inputmode="decimal" value="5" min="0" oninput="paverCalc()"></div>
    <label>Base prep</label>
    <select id="pv_base" onchange="paverCalc()">
      <option value="full">Full crushed-stone base + sand (proper install)</option>
      <option value="sand">Sand bed only — no stone base (cheap, not recommended)</option>
      <option value="prepped">Base already prepped — we just set the pavers</option>
    </select>
    <div class="toggle"><input type="checkbox" id="pv_edge" checked onchange="paverCalc()"><label style="margin:0">Paver edging / restraint around the perimeter</label></div>
    <div class="toggle"><input type="checkbox" id="pv_haul" checked onchange="paverCalc()"><label style="margin:0">Excavate &amp; haul off the dug-out soil</label></div>
    <label>Travel zone</label>
    <select id="pv_zone" onchange="paverCalc()">${TRAVEL_ZONE_ORDER.map(z => `<option value="${z}">${esc(TRAVEL_ZONES_DEFAULT[z].label)}</option>`).join("")}</select>
    <label>Round-trip miles to disposal</label><input id="pv_miles" type="number" inputmode="decimal" value="30" min="0" oninput="paverCalc()">

    <div class="card" id="pv_break" style="margin-top:12px"></div>
    <div class="card" style="background:var(--accent);color:var(--accent-ink);text-align:center;margin-top:8px"><div style="font-size:13px;font-weight:700">PRICE TO GIVE</div><div id="pv_price_out" style="font-size:32px;font-weight:800;line-height:1.1">$0</div><div id="pv_band" style="font-size:12px;opacity:.85"></div></div>
    <div id="pv_cogs"></div>

    <label style="margin-top:10px">Actual price charged (optional — to log a job you already did)</label>
    <input id="pv_override" type="number" inputmode="decimal" placeholder="leave blank to use the estimate" oninput="paverCalc()">

    <label>Save under customer / job name</label><input id="pv_name" placeholder="e.g. Brodeur hot-tub pad">
    <button class="btn acc" style="margin-top:10px" onclick="savePaverQuote()">Save as quote</button>`);
  setTimeout(paverCalc, 40);
};

window.paverCalc = function () {
  const L = parseFloat(val("pv_l")) || 0, W = parseFloat(val("pv_w")) || 0, area = Math.max(0, L * W);
  const priceSqft = parseFloat(val("pv_price")) || 0;
  const paversBy = val("pv_pavers") || "us";
  const paverCostSqft = paversBy === "us" ? (parseFloat(val("pv_pcost")) || 0) : 0;
  const baseSel = val("pv_base") || "full";
  const edgeOn = (document.getElementById("pv_edge") || {}).checked !== false;
  const haulOn = (document.getElementById("pv_haul") || {}).checked !== false;
  const zone = val("pv_zone") || "local", miles = parseFloat(val("pv_miles")) || 0;
  const pcRow = document.getElementById("pv_pcost_row"); if (pcRow) pcRow.style.display = (paversBy === "us") ? "" : "none";
  // --- hard cost ---
  const paverMat = area * paverCostSqft, baseMat = area * (PAVER_BASE_RATES[baseSel] || 0);
  const perim = 2 * (L + W), edge = edgeOn ? perim * PAVER_EDGE : 0;
  const materials = paverMat + baseMat + edge;
  let soilTons = 0, haul = 0;
  if (haulOn) { const cuyd = area * ((PAVER_DIG_IN[baseSel] || 0) / 12) / 27; soilTons = cuyd * SOIL_TON_PER_CUYD; haul = soilTons * DIRT_TON; }
  const tc = travelCharge({ zone: zone, miles: miles }), drive = mileageCost(miles);
  const workCost = Math.round((materials + haul) * 100) / 100;
  const cost = Math.round((workCost + drive) * 100) / 100;
  // --- price (you set $/sq ft) ---
  let workPrice = Math.round(area * priceSqft / 25) * 25;
  const floorPrice = workCost > 0 ? Math.ceil((workCost / (1 - MARGIN_FLOOR)) / 25) * 25 : 0;
  if (workPrice < floorPrice) workPrice = floorPrice;
  const override = parseFloat(val("pv_override")) || 0;
  const grand = override > 0 ? override : (workPrice + tc.charge);
  // --- breakdown ---
  const baseLbl = baseSel === "full" ? "stone base + sand" : baseSel === "sand" ? "sand bed only (no stone)" : "customer-prepped base";
  const b = document.getElementById("pv_break");
  if (b) b.innerHTML = `<div style="font-size:13px;line-height:1.85">
      Area: <b>${L}×${W} = ${Math.round(area)} sq ft</b><br>
      Pavers: <b>${paversBy === "us" ? money(paverMat) + " (we buy, $" + paverCostSqft + "/sq ft)" : "customer-supplied — $0 to us"}</b><br>
      Base prep (${esc(baseLbl)}): <b>${money(baseMat)}</b><br>
      ${edgeOn ? `Edging (${Math.round(perim)} ft × $${PAVER_EDGE}): <b>${money(edge)}</b><br>` : ""}
      ${haulOn ? `Excavate &amp; haul (${soilTons.toFixed(1)} ton @ $${DIRT_TON}/ton): <b>${money(haul)}</b><br>` : ""}
      Travel (${esc(tc.short)} · ${tc.miles} mi): <b>${money(tc.charge)}</b>
    </div>
    <div class="sub" style="margin-top:6px">Install ${money(override > 0 ? override : workPrice)}${override > 0 ? " (your actual price)" : ` (${Math.round(area)} sq ft × $${priceSqft})`}${override > 0 ? "" : ` + travel ${money(tc.charge)}`} = <b>${money(grand)}</b>.</div>`;
  const p = document.getElementById("pv_price_out"); if (p) p.textContent = money(grand);
  const bd = document.getElementById("pv_band"); if (bd) bd.textContent = override > 0 ? `logged at your actual price ${money(override)}` : `install ${money(workPrice)} + travel ${money(tc.charge)}`;
  const cg = document.getElementById("pv_cogs"); if (cg) cg.innerHTML = cogsStrip(grand, cost);
  window._paver = { workPrice: workPrice, workCost: workCost, price: grand, cost: cost, override: override, area: area, L: L, W: W, zone: zone, miles: miles, pavers: paversBy, base: baseLbl, notes: b ? b.innerText : "" };
};

window.savePaverQuote = function () {
  const d = window._paver || {};
  const nm = val("pv_name") || (d.L && d.W ? `${d.L}×${d.W} paver patio` : "Paver patio quote");
  const grand = d.price || 0, override = d.override || 0;
  const notes = (d.notes || "") + "\nPavers: " + (d.pavers === "cust" ? "customer-supplied" : "we supplied") + " · base: " + (d.base || "");
  let items;
  if (override > 0) { items = [{ serviceId: "", name: "Paver patio / pad install", unit: "job", price: override, qty: 1, cost: d.cost || 0 }]; }
  else {
    items = [{ serviceId: "", name: "Paver patio / pad install", unit: "job", price: d.workPrice || 0, qty: 1, cost: d.workCost || 0 }];
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
