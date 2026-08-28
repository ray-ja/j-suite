/* ---------- CREW SOPs / FIELD DECISION AIDS ---------- */
/* Crew-facing (Chase + Pierce scope + price on-site without calling Ray). Source: OBX-Ops/Crew-Playbook SOPs.
   Guardrail bands are Ray-set; the crew quotes within them and never free-lances price. */
const CREW_BANDS={housewatch:[40,95],softwash:[299,549],roofwash:[399,900],pressure:[99,199],deck:[99,399],gutters:[129,399],parking:[79,400],junk:[350,2500],brush:[600,1800],shrubrem:[600,1800],lotclear:[600,1800],mow:[45,150]};
const CREW_SOPS=[
 {id:"01",name:"Home-Watch",tier:"SPINE",crew:"1 OK",svc:["housewatch"],
  pricing:"monthly $50 · bi-weekly $45 · weekly $40 · one-off $75 · storm $95 — recurring is the goal (20% off)",
  scopeIn:["Recurring property checks — sell the plan","On-plan add-ons: package pickup, contractor meet-in, storm prep"],
  scopeOut:["Authorizing repairs — that is the owner's call, flag to Ray"],
  aids:["Confirm gate/alarm codes + key/lockbox ON the customer record, not loose paper","Every visit ENDS in a photo + text report","Damage or safety issue → document + escalate to Ray same day; do not fix it"],
  checklist:["Exterior perimeter: roof/eaves, siding, foundation, windows, doors","Storm/limb damage, pests, wasp nests, standing water","Doors/windows secure, no break-in signs","Interior: leaks/water stains, musty smell; run water + flush toilets","HVAC at set point (humidity off-season); breaker panel normal","Re-lock, reset alarm, return key; send 2–6 photos + one-line report","Mark the visit complete in the app"]},
 {id:"02",name:"Soft / Pressure Washing",tier:"SPINE",crew:"2 on 2-story / roof",svc:["softwash","roofwash","pressure","deck","windows"],
  pricing:"house $299/$399/$549 · roof from $399 · driveway $99/$149/$199 — recurring 20% off",
  scopeIn:["Soft wash (~100 PSI + SH) for roofs/siding/screens","Pressure wash CONCRETE only — driveways, pads, sidewalks","Pre-rinse + plant protection + dwell + rinse + spot-treat"],
  scopeOut:["Never pressure-wash shingles — roofs are soft-wash always","3-story / steep / past safe ladder reach → refer","Sealing, gutter brightening, screen removal, deck refinishing → quote separately"],
  aids:["2-story or roof = 2-person, ladder footed + spotted, never solo on a ladder","PPE for SH: chem gloves + eye protection (roof: face shield + non-slip)","Mind overspray onto cars/neighbors","Every one-off wash → offer the annual plan before leaving, log it for Ray"],
  checklist:["Walk property, confirm surfaces + size = quote tier","Pre-wet + tarp landscaping; plant-rinse ready","Mix ratio: siding ~2.5% SH, concrete up to ~4%, +surfactant","Apply low-pressure bottom-up, let it dwell (don't dry on surface)","Rinse top-down; re-rinse ALL plants thoroughly","Coil hoses, no chemical containers left out"]},
 {id:"03",name:"Mowing / Yard Routes",tier:"SPINE",crew:"1–2",svc:["mow"],
  pricing:"mow+trim+edge from $45/visit · hedges from $89 · debris haul from $99 · big lot from $69 — recurring 20% off",
  scopeIn:["Mow + string-trim + edge + blow hardscape","Hedge/shrub trim, leaf/debris cleanup, mulch (materials line)","Limb/small-tree ONLY if reachable from ground or 30-ft ladder"],
  scopeOut:["No climbing, no large trees — refer to a tree service, note for Ray"],
  aids:["Veg/brush disposal is NOT free for us — $75/ton at our station. STILL keep green waste separate: veg is cheaper than mixed C&D ($90/ton). Always put a dump-fee line on brush jobs.","Remote north (Corolla/Carova) → higher minimum + travel line, bundle the route","Flat per visit, never hourly"],
  checklist:["Mow at right height (don't scalp coastal lawns)","Trim fence lines/beds/obstacles; edge walks + driveway","Blow clippings off all hardscape","Walk for trash/limbs, bag + haul","Photo the finished yard for the route log"]},
 {id:"04",name:"Junk Removal / Clear-Outs",tier:"SPINE",crew:"2",svc:["junk"],
  pricing:"$350–850 typical · whole-house $1,200–2,500 · price by volume + dump fees + access — flat, never hourly",
  scopeIn:["Volume-priced haul-off (truck/trailer-bed fraction)","Set aside resaleable items (log them — free resale = real money)","Separate clean veg from C&D to save dump fees"],
  scopeOut:["Hazardous (paint, chemicals, propane, fuel) → don't haul, flag separate","Huge hoarder load / needs a 3rd body or multiple days → price to SUB, flag Ray"],
  aids:["BED-BUG question (scripted): \"Standard question for anything with fabric — any history of bed bugs?\" Right to decline or surcharge — one infestation contaminates the truck + every job after","Don't undersize furniture — a love seat is a 2–3 seater; confirm real counts","ACCESS bump: stairs, floors, long carry, blocked driveway = more effort = higher price","ONE scheduled trip — set up front, extra trips are billed (the 5-visit job is the margin killer)","Move-outs: movers finish FIRST → then junk → then cleaners; get the cleared-for-disposal sign-off"],
  checklist:["Walk full scope, confirm what's going","Protect floors/walls on the carry-out","Set aside + log resale items (never take unauthorized)","Separate clean veg from C&D","Price the dump fee IN — EVERY pound counts: $90/ton mixed C&D, $75/ton veg. Nothing is free for us; the free allowances are residential","Sweep the cleared space; before/after photos","Invoice through the app + drop the review link"]},
 {id:"05",name:"Cleanup (Residential + Light-Commercial)",tier:"SECONDARY",crew:"1–2",svc:["parking","storm","cleanup"],
  pricing:"by lot size / scope · recurring plans 20% off (daily/weekly/monthly) — flat per visit",
  scopeIn:["Lot/roadside litter, dumpster-area, storefront/sidewalk, post-event, light grounds policing","Recurring is the play — sell the scheduled plan, document with photos"],
  scopeOut:["Biohazard/sharps/hazmat beyond basic litter → don't handle, flag Ray","One-off that balloons into a haul-off → re-quote as junk (SOP 04)"],
  aids:["High-vis vest + cones near traffic/drive lanes","Disposal: customer dumpster (free) vs we haul (add dump fee)","Travel/zone bump for remote sites; bundle into a route"],
  checklist:["Walk the area, note hazards (glass/sharps → grabber, don't hand-pick)","Litter pick + bag (contractor bags)","Dumpster area: pick + sweep pad + broom corners","Storefront: sidewalk sweep, entry debris","Confirm disposal route; before/after photos with the visit log"]},
 {id:"06",name:"Small / Medium Ground Brush",tier:"SECONDARY",crew:"2",svc:["brush","shrubrem","lotclear"],
  pricing:"by area / crew-day (~$600–900/crew-day) + rental + disposal — flat per job",
  scopeIn:["Ground-based brush, overgrowth, saplings, limbs/branches","Small trees reachable from ground or the 30-ft ladder"],
  scopeOut:["Climbing, large trees/big trunks, anything above ~30 ft or needing a controlled drop → STOP and refer","Near power lines / needs a climber → refer, no exceptions"],
  aids:["STIHL AP saw is OWNED — no chainsaw rental line (still rent stump grinder/pole saw when needed)","Chainsaw chaps whenever the saw runs + eye/ear/gloves/boots","Keep vegetative debris clean/separate → dumps FREE","Bigger than a crew-day / needs a 3rd body → price to sub, flag Ray"],
  checklist:["Walk area: property lines, utilities, septic, irrigation to protect","Spot hazards: power lines, ground hornets/snakes, poison ivy, wet ground","Confirm keepers vs goes with the customer","Cut low-to-high, drag to staging pile, chip or load","Rake + clear; before/after photos"]},
 {id:"07",name:"Small Shed Demo",tier:"SECONDARY",crew:"2",svc:["demo"],
  pricing:"by structure size + haul/disposal + access — flat per job",
  scopeIn:["Small single-story sheds/outbuildings (≈ ≤10×12), wood/metal, hand-demo + haul"],
  scopeOut:["Live electrical/plumbing connected → flag Ray to arrange disconnect, don't demo","Slab needing breaking, permits, or asbestos/lead suspicion (pre-1990) → STOP, refer/test","Multi-story or attached to the house → refer"],
  aids:["Confirm utilities DISCONNECTED before touching it","Check age/materials — suspect siding/roofing → asbestos/lead risk → stop","C&D debris pays tonnage ($90/ton) — price it in, this is NOT free veg","Call 811 if any digging near the pad"],
  checklist:["PPE: gloves, eye protection, hard hat, boots, dust mask","De-construct top-down: roof → walls → frame → floor","Sort clean wood / mixed C&D / metal (metal may be scrap)","Load + haul; rake the pad clean; before/after photos"]},
 {id:"08",name:"Gutter Cleaning",tier:"SECONDARY",crew:"2 always",svc:["gutters"],
  pricing:"by linear footage / stories + access — flat per job; bundle with a wash",
  scopeIn:["1- and 2-story gutters reachable from the 30-ft ladder or water-fed pole"],
  scopeOut:["3-story, steep/unsafe pitch, past safe ladder reach → refer","No working off the roof edge on a sketchy pitch","Gutter repair / guards / fascia = separate quote / possible refer"],
  aids:["2-PERSON ALWAYS — one works, one foots/spots the ladder the entire time","Ladder on firm level ground, stabilizer/standoff on; 3-point contact, never overreach","Stay clear of power lines / service drops; wet/windy → reschedule","Offer the recurring/seasonal plan + bundle with washing"],
  checklist:["Tarp under work zones to protect plantings/hardscape","Scoop debris by hand/trowel into a bucket, bag it","FLUSH each run toward the downspout, confirm flow","Clear/confirm downspouts + splash blocks","Note gutter damage/loose hangers for Ray (don't repair); before/after photos"]}
];
function crewSop(svc){if(!svc)return null;return CREW_SOPS.find(s=>s.svc&&s.svc.indexOf(svc)>=0)||null;}
function crewBand(svc){return CREW_BANDS[svc]||null;}
function crewAidCard(svc){
  const s=crewSop(svc);if(!s)return "";
  const b=crewBand(svc);
  const band=`<div class="sub" style="margin-top:2px">🎯 Ray's range: ${b?`<b>$${b[0]}–$${b[1]}</b> · `:""}${esc(s.pricing)}</div>`;
  const li=arr=>arr&&arr.length?arr.map(x=>`<li style="margin:2px 0">${esc(x)}</li>`).join(""):"";
  const inl=s.scopeIn&&s.scopeIn.length?`<div style="margin-top:7px"><b style="color:var(--accent-ink)">✅ In scope</b><ul style="margin:3px 0 0 18px;padding:0">${li(s.scopeIn)}</ul></div>`:"";
  const outl=s.scopeOut&&s.scopeOut.length?`<div style="margin-top:7px"><b style="color:var(--danger)">⛔ Refer / not us</b><ul style="margin:3px 0 0 18px;padding:0">${li(s.scopeOut)}</ul></div>`:"";
  const aids=s.aids&&s.aids.length?`<div style="margin-top:7px"><b>⚠ Scope it right</b><ul style="margin:3px 0 0 18px;padding:0">${li(s.aids)}</ul></div>`:"";
  const chk=s.checklist&&s.checklist.length?`<details style="margin-top:7px"><summary style="cursor:pointer;font-weight:700">📋 On-site checklist (${s.checklist.length})</summary><ul style="margin:5px 0 0 18px;padding:0;list-style:none">${s.checklist.map(x=>`<li style="margin:3px 0">☐ ${esc(x)}</li>`).join("")}</ul></details>`:"";
  return `<details class="card" style="border-left:4px solid var(--accent)"><summary style="font-weight:800;cursor:pointer">🧭 Crew SOP — ${esc(s.name)} <span class="badge" style="background:var(--soft);color:var(--muted)">${esc(s.tier)} · ${esc(s.crew)}</span></summary><div style="font-size:13px;line-height:1.5;margin-top:6px">${band}${inl}${outl}${aids}${chk}</div></details>`;
}
function guardrailFlag(svc,price){
  const b=crewBand(svc);if(!b||!price||price<=0)return "";
  if(price<b[0])return `<div class="card" style="border-left:4px solid #e0a800;background:var(--soft);font-size:13px;margin-top:6px"><b>⚠ Below Ray's range.</b> $${Math.round(price)} is under the $${b[0]} floor for this line — fine for a small/partial job, otherwise you may be underpricing. Check with Ray before you quote it.</div>`;
  if(price>b[1])return `<div class="card" style="border-left:4px solid #e0a800;background:var(--soft);font-size:13px;margin-top:6px"><b>⚠ Above Ray's range.</b> $${Math.round(price)} is over the $${b[1]} typical ceiling — fine if scope + travel justify it, but double-check or flag Ray.</div>`;
  return "";
}
