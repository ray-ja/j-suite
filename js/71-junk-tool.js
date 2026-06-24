/* ---------- JUNK REMOVAL — the detailed item/weight tool, now priced by the shared engine (js/70) ----------
   Keeps the special/heavy-item detail you built (freon, mattresses, tires, e-waste, paint, appliances) —
   those add their real disposal COSTS — and the warehouse-aware STASH vs STRAIGHT-TO-DUMP model. The
   load size pre-fills hours + weight; you eyeball-adjust; the strip shows take-home/hr live against $45. */
const JUNK_LOADS = { min: { label: "Minimum — a few items", hrs: 0.5, lbs: 200 }, q: { label: "¼ truck load", hrs: 0.75, lbs: 600 }, half: { label: "½ truck load", hrs: 1.25, lbs: 1200 }, tq: { label: "¾ truck load", hrs: 1.75, lbs: 1800 }, full: { label: "Full truck load", hrs: 2.25, lbs: 2500 } };
const JUNK_DIFF = { easy: { label: "Easy — drive up, ground floor", mult: 1 }, stairs: { label: "Stairs / upper floor / long carry (+35%)", mult: 1.35 }, tough: { label: "Tough — tight, heavy, multi-flight (+70%)", mult: 1.7 } };
/* per-unit special DISPOSAL COST (what we pay to get rid of it — feeds hard costs, not a price markup) */
const JUNK_SPECIAL = [
  { k: "freon", icon: "❄️", label: "Freon units (fridge / AC / freezer)", cost: 45 },
  { k: "mattress", icon: "🛏️", label: "Mattresses / box springs", cost: 15 },
  { k: "tire", icon: "🛞", label: "Tires", cost: 8 },
  { k: "ewaste", icon: "📺", label: "TVs / e-waste", cost: 30 },
  { k: "paint", icon: "🪣", label: "Paint / chemical cans", cost: 12 },
  { k: "appl", icon: "🧺", label: "Other appliances (washer / dryer / stove)", cost: 5 }
];

window.openJunkTool = function () {
  window._jkPriceTouched = false;
  modal("Junk Removal", `
    <p class="muted" style="margin:0 0 8px">Priced to pay everyone <b>$${QE.TAKE_HOME}/hr take-home</b>. Stash couches/appliances at the warehouse — no dump run per job. Updates live as you tap.</p>
    <label>How much is it?</label>
    <select id="jk_load" onchange="junkSetHours()">${Object.keys(JUNK_LOADS).map(k => `<option value="${k}"${k === "half" ? " selected" : ""}>${esc(JUNK_LOADS[k].label)}</option>`).join("")}</select>
    <div class="row" style="gap:8px">
      <div class="grow"><label># of loads</label><input id="jk_loads" type="number" inputmode="decimal" value="1" min="1" step="0.5" onchange="junkSetHours()"></div>
      <div class="grow"><label>Crew (people)</label><input id="jk_crew" type="number" inputmode="numeric" value="2" min="1" oninput="junkCalc()"></div>
    </div>
    <label>Difficulty / access</label>
    <select id="jk_diff" onchange="junkSetHours()">${Object.keys(JUNK_DIFF).map(k => `<option value="${k}">${esc(JUNK_DIFF[k].label)}</option>`).join("")}</select>
    <label>Hours on site (crew loading time)</label><input id="jk_onsite" type="number" inputmode="decimal" value="1.25" min="0" step="0.25" oninput="junkCalc()">

    <div style="font-weight:800;margin:12px 0 4px">Special / heavy items (extra disposal cost)</div>
    <div style="font-size:14px">${JUNK_SPECIAL.map(s => `<label style="display:flex;justify-content:space-between;align-items:center;margin:6px 0">${s.icon} ${esc(s.label)} <input id="jk_${s.k}" type="number" value="0" min="0" style="width:74px" oninput="junkCalc()"></label>`).join("")}</div>
    <div id="jk_freonwarn" class="card" style="display:none;border-left:4px solid var(--danger);font-size:12.5px;line-height:1.5">❄️ <b>Freon rule:</b> fridges, freezers, window ACs, and dehumidifiers need refrigerant recovered by an EPA-certified tech before Dare County will accept them. The fee covers it — line up recovery before you haul.</div>

    <div class="row" style="gap:8px">
      <div class="grow"><label>Drive to site — RT miles</label><input id="jk_smiles" type="number" inputmode="decimal" value="10" min="0" oninput="junkCalc()"></div>
      <div class="grow"><label>RT minutes</label><input id="jk_smin" type="number" inputmode="decimal" value="20" min="0" oninput="junkCalc()"></div>
    </div>
    <label>Where does it go?</label>
    <select id="jk_mode" onchange="junkCalc()"><option value="stash">Stash at the warehouse (dump later)</option><option value="dump">Straight to the dump (this job)</option></select>
    <div id="jk_dumprow" style="display:none">
      <div class="row" style="gap:8px">
        <div class="grow"><label>Dump run — RT miles</label><input id="jk_dmiles" type="number" inputmode="decimal" value="50" min="0" oninput="junkCalc()"></div>
        <div class="grow"><label>RT minutes (1 person)</label><input id="jk_dmin" type="number" inputmode="decimal" value="80" min="0" oninput="junkCalc()"></div>
      </div>
    </div>
    <label>Est. total weight (lbs) — for the tip fee</label><input id="jk_lbs" type="number" inputmode="decimal" value="1200" min="0" oninput="junkCalc()">

    <div id="jk_strip" style="margin-top:10px"></div>
    <label>Price to charge</label><input id="jk_price" type="number" inputmode="decimal" oninput="junkPriceEdit()" placeholder="defaults to the floor">

    <label>Save under customer / job name</label><input id="jk_name" placeholder="e.g. Smith garage cleanout">
    <button class="btn acc" style="margin-top:10px" onclick="saveJunkQuote()">Save as quote</button>`);
  setTimeout(junkCalc, 40);
};

window.junkSetHours = function () {
  const load = JUNK_LOADS[val("jk_load")] || JUNK_LOADS.half;
  const loads = parseFloat(val("jk_loads")) || 1;
  const diff = JUNK_DIFF[val("jk_diff")] || JUNK_DIFF.easy;
  const hEl = document.getElementById("jk_onsite"); if (hEl) hEl.value = Math.round(load.hrs * loads * diff.mult * 4) / 4;
  const wEl = document.getElementById("jk_lbs"); if (wEl) wEl.value = Math.round(load.lbs * loads);
  junkCalc();
};
window.junkPriceEdit = function () { window._jkPriceTouched = true; junkCalc(); };
function junkSpecialCost() { return JUNK_SPECIAL.reduce((s, x) => s + (parseFloat(val("jk_" + x.k)) || 0) * x.cost, 0); }
function junkSpecialSummary() { return JUNK_SPECIAL.map(x => { const n = parseFloat(val("jk_" + x.k)) || 0; return n ? `${n}× ${x.label}` : ""; }).filter(Boolean).join(", "); }

function junkObj() {
  return {
    crew: parseFloat(val("jk_crew")) || 2,
    onsiteHrs: parseFloat(val("jk_onsite")) || 0,
    siteMiles: parseFloat(val("jk_smiles")) || 0,
    siteDriveHrs: (parseFloat(val("jk_smin")) || 0) / 60,
    mode: val("jk_mode") || "stash",
    lbs: parseFloat(val("jk_lbs")) || 0, dtype: "cd",
    dumpMiles: parseFloat(val("jk_dmiles")) || 0,
    dumpHrs: (parseFloat(val("jk_dmin")) || 0) / 60,
    materials: Math.round(junkSpecialCost() * 100) / 100
  };
}
window.junkCalc = function () {
  const dump = val("jk_mode") === "dump";
  const dr = document.getElementById("jk_dumprow"); if (dr) dr.style.display = dump ? "" : "none";
  const fw = document.getElementById("jk_freonwarn"); if (fw) fw.style.display = (parseFloat(val("jk_freon")) || 0) > 0 ? "" : "none";
  const o = junkObj(), q = qeQuote(o);
  const pf = document.getElementById("jk_price");
  let price = parseFloat(val("jk_price")) || 0;
  if (!window._jkPriceTouched) { price = q.floor; if (pf) pf.value = q.floor; }
  const strip = document.getElementById("jk_strip"); if (strip) strip.innerHTML = qeStrip(price, o, "junk");
  window._junk = { o: o, price: price, floor: q.floor };
};
window.saveJunkQuote = function () {
  const d = window._junk || {}, o = d.o || {};
  const price = parseFloat(val("jk_price")) || d.price || d.floor || 0;
  const nm = val("jk_name") || "Junk removal";
  const ev = qeEval(price, o);
  const spec = junkSpecialSummary();
  const notes = `Junk removal · ${val("jk_load")} ×${val("jk_loads")} · ${o.mode === "dump" ? "straight to dump" : "stash at warehouse"} · ${o.crew} crew · ${ev.PH.toFixed(1)} person-hrs · take-home ${money(ev.takeHome)}/hr each` + (spec ? " · special: " + spec : "");
  const items = [{ serviceId: "", name: "Junk removal & haul-off", unit: "job", price: price, qty: 1, cost: Math.round(ev.hard * 100) / 100 }];
  const q = { id: uid(), customerId: null, cust: nm, propertyId: null, address: "", date: today(), items: items, recurring: false, subtotal: price, discount: 0, total: price, cost: Math.round(ev.hard * 100) / 100, kind: "junk", notes: notes, updatedAt: now() };
  if (!q.num && typeof nextQuoteNum === "function") q.num = nextQuoteNum();
  S.obx.quotes.push(q); save();
  if (typeof logEvent === "function") logEvent("Junk quote — " + money(price) + " · " + nm, "quote");
  closeModal();
  alert("Saved " + money(price) + " junk quote for " + nm + ". Find it on Jobs → Pipeline (Quote stage).");
  render();
};
window.openJunkEst = window.openJunkTool;   // the old detailed estimator now opens this engine-priced version
