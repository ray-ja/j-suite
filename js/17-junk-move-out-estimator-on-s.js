/* ---------- JUNK / MOVE-OUT ESTIMATOR (on-site quoting) ---------- */
window.openJunkEst=function(){
  modal("Junk / Move-Out Estimator",`
    <p class="muted" style="margin:0 0 8px">Build a number while you walk the property. The total updates live as you tap.</p>
    <label>How full will the load be?</label>
    <select id="je_load" onchange="junkCalc()" oninput="junkCalc()"><option value="min">Minimum (1/8 truck) — a few items</option><option value="quarter">1/4 truck</option><option value="half" selected>1/2 truck</option><option value="tquarter">3/4 truck</option><option value="full">Full truck / trailer load</option></select>
    <label>Extra full loads (big move-outs need multiple trips)</label><input id="je_extra" type="number" value="0" min="0" oninput="junkCalc()">
    <label>Access / difficulty</label>
    <select id="je_access" onchange="junkCalc()" oninput="junkCalc()"><option value="1">Ground floor, easy</option><option value="1.15">Some stairs</option><option value="1.3">Attic / tight / long carry</option></select>
    <label>Extra labor hours — disassembly, attic hauling ($75/hr)</label><input id="je_labor" type="number" value="0" min="0" step="0.5" oninput="junkCalc()">
    <div style="font-weight:800;margin:12px 0 4px">Special / hazardous items (price includes disposal)</div>
    <div style="font-size:14px">
      <label style="display:flex;justify-content:space-between;align-items:center;margin:6px 0">❄️ Freon units (fridge / AC / freezer) <input id="je_freon" type="number" value="0" min="0" style="width:74px" oninput="junkCalc()"></label>
      <label style="display:flex;justify-content:space-between;align-items:center;margin:6px 0">🛏️ Mattresses / box springs <input id="je_mattress" type="number" value="0" min="0" style="width:74px" oninput="junkCalc()"></label>
      <label style="display:flex;justify-content:space-between;align-items:center;margin:6px 0">🛞 Tires <input id="je_tire" type="number" value="0" min="0" style="width:74px" oninput="junkCalc()"></label>
      <label style="display:flex;justify-content:space-between;align-items:center;margin:6px 0">📺 TVs / e-waste <input id="je_ewaste" type="number" value="0" min="0" style="width:74px" oninput="junkCalc()"></label>
      <label style="display:flex;justify-content:space-between;align-items:center;margin:6px 0">🪣 Paint / chemical cans <input id="je_paint" type="number" value="0" min="0" style="width:74px" oninput="junkCalc()"></label>
      <label style="display:flex;justify-content:space-between;align-items:center;margin:6px 0">🧺 Other appliances (washer/dryer/stove) <input id="je_appl" type="number" value="0" min="0" style="width:74px" oninput="junkCalc()"></label>
    </div>
    <div class="card" id="je_break" style="margin-top:12px"></div>
    <div class="card" style="background:var(--accent);color:var(--accent-ink);text-align:center;margin-top:8px"><div style="font-size:13px;font-weight:700">QUOTE TO GIVE ON SITE</div><div id="je_total" style="font-size:32px;font-weight:800;line-height:1.1">$0</div></div>
    <div class="card" style="border-left:4px solid var(--danger);font-size:12.5px;line-height:1.5">❄️ <b>Freon rule:</b> fridges, freezers, window ACs, and dehumidifiers must have refrigerant recovered by an EPA-certified tech before the landfill (Dare County) will accept them. The per-unit fee covers that — line up your recovery plan before you haul. When unsure, quote a bit high and tell the customer it covers certified disposal.</div>
    <label>Save under customer name</label><input id="je_name" placeholder="e.g. Smith move-out (Monday)">
    <button class="btn acc" style="margin-top:10px" onclick="saveJunkQuote()">Save as quote</button>`);
  setTimeout(junkCalc,40);
};
window.junkCalc=function(){
  const base={min:125,quarter:200,half:375,tquarter:525,full:700};
  const wt={min:200,quarter:450,half:900,tquarter:1400,full:1800};
  const load=val("je_load")||"half",extra=+val("je_extra")||0;
  const access=parseFloat(val("je_access"))||1,labor=parseFloat(val("je_labor"))||0;
  const fr=+val("je_freon")||0,ma=+val("je_mattress")||0,ti=+val("je_tire")||0,ew=+val("je_ewaste")||0,pa=+val("je_paint")||0,ap=+val("je_appl")||0;
  const baseHaul=(base[load]||0)+extra*600;
  const accessAdd=Math.round(baseHaul*(access-1));
  const laborAdd=labor*75;
  const special=fr*45+ma*25+ti*8+ew*30+pa*10+ap*25;
  const lbs=(wt[load]||0)+extra*1800;
  const dump=Math.round(lbs/2000*94);
  let total=Math.ceil((baseHaul+accessAdd+laborAdd+special+dump)/25)*25;
  const floor=Math.ceil((baseHaul*0.55+special+dump)/25)*25;
  const cost=dump+30;
  const b=document.getElementById("je_break");
  if(b)b.innerHTML=`<div style="font-size:13px;line-height:1.85">Base haul (by volume): <b>${money(baseHaul)}</b><br>Access factor (${access}×): <b>+${money(accessAdd)}</b><br>Extra labor: <b>+${money(laborAdd)}</b><br>Special-item disposal: <b>+${money(special)}</b><br>Landfill fee (est. ${lbs} lb @ $94/ton): <b>+${money(dump)}</b></div><div class="sub" style="margin-top:6px">Rough hard cost (dump+fuel) ≈ ${money(cost)} · don't go below ~${money(floor)}.</div>`;
  const t=document.getElementById("je_total");if(t)t.textContent=money(total);
  window._jeTotal=total;
};
window.saveJunkQuote=function(){
  const nm=val("je_name")||"Move-out junk quote",total=window._jeTotal||0;
  const br=document.getElementById("je_break"),notes=br?br.innerText:"";
  const q={id:uid(),customerId:null,cust:nm,propertyId:null,address:"",date:today(),items:[{serviceId:"",name:"Junk / move-out removal",unit:"job",price:total,qty:1}],recurring:false,subtotal:total,discount:0,total:total,kind:"junk",notes:notes,updatedAt:now()};
  S.obx.quotes.push(q);save();closeModal();
  alert("Saved "+money(total)+" quote for "+nm+" to OBX Lot Solutions. Find it in the Quotes tab (switch to OBX).");
  render();
};

