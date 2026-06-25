/* ---------- PAVER PATIO / PAD ESTIMATOR — premium hardscape installs ----------
   We build it RIGHT every time: full crushed-stone base + weed underlayment + sand (bed + joints) +
   polymeric sand on top, paver edging/restraint, excavate & haul the spoil. So there's NO "base prep"
   choice — it's always the full build. Price = area × your $/sq ft + the static drive (figured from the
   property address, like junk). Hard cost = pavers (an AVG estimate if WE supply — the customer usually
   hasn't picked yet) + base materials + edging + spoil tipping + mileage. No labor line (crew paid from
   the revenue split). Opened from the quote wizard (🧱 Paver patio / pad); links the customer/property. */
const PAVER_EDGE = 2.5, DIRT_TON = 45, SOIL_TON_PER_CUYD = 1.35;
const PAVER_BASE_FULL = 3.35;   // $/sq ft material — crushed stone + sand + underlayment + polymeric (the full proper build)
const PAVER_DIG_IN = 8;         // inches excavated for the full base (drives spoil-haul volume)
const PAVER_AVG_COST = 7;       // $/sq ft — AVERAGE premium paver material; a placeholder until the customer actually picks

function paverDrive(){
  const pid = (typeof WZ !== "undefined") && WZ.cust && WZ.cust.propertyId;
  if(pid){const p=(D().properties||[]).find(x=>x.id===pid);if(p&&p.lat!=null&&typeof driveFromBase==="function"){const dd=driveFromBase(p.lat,p.lng);if(dd)return {rt:dd.roundMiles,min:dd.min*2};}}
  return {rt:20,min:30};   // fallback until the property is geocoded
}

window.openPaverEst = function () {
  const nm0 = (typeof WZ !== "undefined" && WZ.cust && WZ.cust.name) ? WZ.cust.name : "";
  modal("Paver Patio / Pad", `
    <p class="muted" style="margin:0 0 8px">Premium hardscape — full stone base, sand, polymeric joints, edging, spoil hauled. We build it right every time. Price updates live; crew labor is paid from the revenue split, so only materials, disposal &amp; drive are costs.</p>
    <div class="row" style="gap:8px">
      <div class="grow"><label>Length (ft)</label><input id="pv_l" type="number" inputmode="decimal" value="10" min="1" oninput="paverCalc()"></div>
      <div class="grow"><label>Width (ft)</label><input id="pv_w" type="number" inputmode="decimal" value="10" min="1" oninput="paverCalc()"></div>
    </div>
    <label>Price you charge ($ per sq ft) — your all-in premium rate</label>
    <input id="pv_price" type="number" inputmode="decimal" value="20" min="0" oninput="paverCalc()">
    <label>Who supplies the pavers?</label>
    <select id="pv_pavers" onchange="paverCalc()"><option value="us">We buy the pavers</option><option value="cust">Customer supplies the pavers</option></select>
    <div id="pv_pcost_row"><label>Paver cost — what WE pay ($/sq ft) <span class="sub">· average estimate; adjust once they pick</span></label><input id="pv_pcost" type="number" inputmode="decimal" value="${PAVER_AVG_COST}" min="0" oninput="paverCalc()"></div>
    <div class="toggle"><input type="checkbox" id="pv_edge" checked onchange="paverCalc()"><label style="margin:0">Paver edging / restraint around the perimeter</label></div>
    <div class="toggle"><input type="checkbox" id="pv_haul" checked onchange="paverCalc()"><label style="margin:0">Excavate &amp; haul off the dug-out soil</label></div>
    <div class="sub" style="margin-top:6px">🚗 Drive is figured from the property address automatically — no travel zone to pick.</div>

    <div class="card" id="pv_break" style="margin-top:12px"></div>
    <div class="card" style="background:var(--accent);color:var(--accent-ink);text-align:center;margin-top:8px"><div style="font-size:13px;font-weight:700">PRICE TO GIVE</div><div id="pv_price_out" style="font-size:32px;font-weight:800;line-height:1.1">$0</div><div id="pv_band" style="font-size:12px;opacity:.85"></div></div>
    <div id="pv_cogs"></div>

    <label style="margin-top:10px">Actual price charged (optional — to log a job you already did)</label>
    <input id="pv_override" type="number" inputmode="decimal" placeholder="leave blank to use the estimate" oninput="paverCalc()">

    <label>Save under customer / job name</label><input id="pv_name" value="${esc(nm0)}" placeholder="e.g. Brodeur hot-tub pad">
    <button class="btn acc" style="margin-top:10px" onclick="savePaverQuote()">Review quote →</button>`);
  setTimeout(paverCalc, 40);
};

window.paverCalc = function () {
  const L = parseFloat(val("pv_l")) || 0, W = parseFloat(val("pv_w")) || 0, area = Math.max(0, L * W);
  const priceSqft = parseFloat(val("pv_price")) || 0;
  const paversBy = val("pv_pavers") || "us";
  const paverCostSqft = paversBy === "us" ? (parseFloat(val("pv_pcost")) || 0) : 0;
  const edgeOn = (document.getElementById("pv_edge") || {}).checked !== false;
  const haulOn = (document.getElementById("pv_haul") || {}).checked !== false;
  const pcRow = document.getElementById("pv_pcost_row"); if (pcRow) pcRow.style.display = (paversBy === "us") ? "" : "none";
  const MIL = (typeof QE !== "undefined" ? QE.MILEAGE : 0.725), LOADED = (typeof QE !== "undefined" ? QE.TAKE_HOME / QE.FIELD_SPLIT : 93.75), MF = (typeof MARGIN_FLOOR !== "undefined" ? MARGIN_FLOOR : 0.35);
  // --- materials: ALWAYS the full proper build ---
  const paverMat = area * paverCostSqft, baseMat = area * PAVER_BASE_FULL;
  const perim = 2 * (L + W), edge = edgeOn ? perim * PAVER_EDGE : 0;
  let soilTons = 0, haulTip = 0;
  if (haulOn) { const cuyd = area * (PAVER_DIG_IN / 12) / 27; soilTons = cuyd * SOIL_TON_PER_CUYD; haulTip = soilTons * DIRT_TON; }
  // --- static drive from the property address ---
  const dr = paverDrive(), driveMiles = dr.rt, driveCharge = Math.round(driveMiles * MIL + 2 * (dr.min / 60) * LOADED);
  const materials = paverMat + baseMat + edge + haulTip;
  const workCost = Math.round(materials * 100) / 100;
  const cost = Math.round((workCost + driveMiles * MIL) * 100) / 100;   // hard cost = materials + drive mileage (drive labor is paid from the split)
  // --- price (you set $/sq ft) ---
  let workPrice = Math.round(area * priceSqft / 25) * 25;
  const floorPrice = workCost > 0 ? Math.ceil((workCost / (1 - MF)) / 25) * 25 : 0;
  if (workPrice < floorPrice) workPrice = floorPrice;
  const override = parseFloat(val("pv_override")) || 0;
  const grand = override > 0 ? override : (workPrice + driveCharge);
  // --- breakdown ---
  const b = document.getElementById("pv_break");
  if (b) b.innerHTML = `<div style="font-size:13px;line-height:1.85">
      Area: <b>${L}×${W} = ${Math.round(area)} sq ft</b><br>
      Pavers: <b>${paversBy === "us" ? money(paverMat) + " (we buy · avg $" + paverCostSqft + "/sq ft)" : "customer-supplied — $0 to us"}</b><br>
      Full base — stone + sand + polymeric: <b>${money(baseMat)}</b><br>
      ${edgeOn ? `Edging / restraint (${Math.round(perim)} ft × $${PAVER_EDGE}): <b>${money(edge)}</b><br>` : ""}
      ${haulOn ? `Excavate &amp; haul spoil (${soilTons.toFixed(1)} ton @ $${DIRT_TON}/ton): <b>${money(haulTip)}</b><br>` : ""}
      🚗 Drive (static · ${driveMiles} mi RT from the address): <b>${money(driveCharge)}</b>
    </div>
    <div class="sub" style="margin-top:6px">Install ${money(override > 0 ? override : workPrice)}${override > 0 ? " (your actual price)" : ` (${Math.round(area)} sq ft × $${priceSqft})`}${override > 0 ? "" : ` + drive ${money(driveCharge)}`} = <b>${money(grand)}</b>.</div>`;
  const p = document.getElementById("pv_price_out"); if (p) p.textContent = money(grand);
  const bd = document.getElementById("pv_band"); if (bd) bd.textContent = override > 0 ? `logged at your actual price ${money(override)}` : `install ${money(workPrice)} + drive ${money(driveCharge)}`;
  const cg = document.getElementById("pv_cogs"); if (cg) cg.innerHTML = cogsStrip(grand, cost);
  window._paver = { workPrice: workPrice, workCost: workCost, price: grand, cost: cost, override: override, area: area, L: L, W: W, driveCharge: driveCharge, driveMin: dr.min, pavers: paversBy, notes: b ? b.innerText : "" };
};

window.savePaverQuote = function () {
  const d = window._paver || {};
  const grand = d.price || 0, override = d.override || 0, price = override > 0 ? override : grand;
  if (!(price > 0)) { alert("Enter the patio size first."); return; }
  if (typeof WZON === "undefined" || !WZON || typeof WZ === "undefined" || !WZ) { alert("Open this from a quote so it links the customer."); return; }
  const nm = val("pv_name"); if (nm && WZ.cust && !WZ.cust.name) WZ.cust.name = nm;
  const notes = ["Full premium build — stone base + sand + polymeric + edging." + (d.pavers === "cust" ? " Customer-supplied pavers." : " We supply pavers (avg estimate — adjust once they pick).")];
  if ((d.driveCharge || 0) > 0 && !(override > 0)) notes.push("Incl. ~" + money(d.driveCharge) + " round-trip drive from the property address.");
  WZ.items = WZ.items || [];
  WZ.items.push({ serviceId: "", name: "Paver patio / pad install (full premium build)", unit: "job", price: price, qty: 1, cost: d.cost || 0, notes: notes, bandKey: "paver", breakdown: (d.L && d.W) ? [d.L + "×" + d.W + " = " + Math.round(d.area) + " sq ft"] : [] });
  // pay-check hours: full build ~6 work-min/sq ft, 2-person crew, + static drive + 20-min on-site baseline
  const crew = 2, workMin = (d.area || 0) * 6, driveMin = d.driveMin || 0;
  const totalPH = (workMin / 60) + crew * (driveMin / 60) + crew * (20 / 60);
  WZ.crewN = crew; WZ.hours = totalPH > 0 ? Math.round(totalPH / crew * 10) / 10 : 0;
  WZ.modalBuilt = true;   // a modal-built tool — the review hides "back to build" (rebuild via the service picker)
  closeModal(); WZ.step = "review"; render();
};
