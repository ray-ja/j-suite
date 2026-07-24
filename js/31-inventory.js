/* ---------- INVENTORY — master + per-job-type lenses + gap report ----------
   The MASTER is the single source of truth: mark Have?/Qty once, here. The
   per-job-type views are read-only filtered lenses that INHERIT that status —
   same doctrine as OBX-Ops/Inventory/master-inventory.md → by-job-type/*.md, so
   they can never drift. INV_SEED below IS that master, imported into app data via
   the existing sync layer: each biz gets an `inventory` collection that merges
   per-record (last-write-wins on updatedAt), exactly like customers/quotes/etc.

   Per-job-type gap report = "what's still missing for job X", with est. price and
   brand/model where known, so a shopping run is one tap away.

   Jamieson has no master yet — S.jam.inventory stays empty and shows an
   add-later empty state. To add it later: define a JAM seed, seed it into
   S.jam.inventory the same way OBX is seeded, and bump INV_SEED_V to re-import.
   Items can also be added by hand from the tab (the + button). */

var INV_SEED_V = 1;   // bump when INV_SEED content changes → re-imports reference fields, preserving the user's Have?/Qty marks

/* the 13 job types — [tag, title] — mirror of build-inventory-sheets.py JOBS */
var INV_JOBS = [
  ["junk","Junk / Clear-Out"],["house-wash","House Soft Wash"],["roof-wash","Roof Soft Wash"],
  ["driveway","Driveway / Concrete"],["deck","Deck / Patio"],["windows","Windows"],
  ["gutters","Gutters"],["land-clearing","Lot / Land Clearing"],["yard","Yard Work"],
  ["brush","Brush / Debris"],["storm","Storm Cleanup"],["parking-lot","Parking Lot"],
  ["home-watch","Home-Watch"]
];
var INV_CATS = ["tool","equipment","consumable","PPE","vehicle","chemical"];
var INV_MATERIAL_CATS = {consumable:1, chemical:1};   // these feed per-job material cost
/* PHASE 3 (asset register) — optional condition of an item. "" = unset (treated as normal/in-service). */
var INV_STATUSES = [["","—"],["in-service","In service"],["needs-repair","Needs repair"],["retired","Retired"]];
function invStatusLabel(s){var f=INV_STATUSES.find(function(x){return x[0]===s;});return f?f[1]:s;}
function invHolderName(id){return (id&&typeof userName==="function")?(userName(id)||""):"";}
/* a condition chip — needs-repair loud (warning), retired muted; in-service/unset render nothing (no clutter) */
function invStatusChip(s){
  if(s==="needs-repair")return '<span class="badge" style="background:var(--danger);color:#fff">🔧 needs repair</span>';
  if(s==="retired")return '<span class="badge" style="background:var(--soft);color:var(--muted)">retired</span>';
  return "";
}
/* PHASE 4 (cleaning/maintenance) — a "needs cleaning" chip, shown wherever an item is surfaced so a dirty
   tool (chainsaw/mower) is obvious. needsCleaning is set on job-wrap (dirtiesWithUse gear) or by hand. */
function invCleanChip(i){
  return (i&&i.needsCleaning)?'<span class="badge" style="background:#b8860b;color:#fff">🧽 needs cleaning</span>':"";
}
/* asset-register detail line for a card/row: plate · 📍 location · 🧑 who-has-it, + status + needs-cleaning chips.
   Returns "" when nothing is set, so untouched items look exactly as before. */
function invDetailLine(i){
  var bits=[];
  if(i.plate)bits.push('🔖 '+esc(i.plate));
  if(i.location)bits.push('📍 '+esc(i.location));
  var hn=invHolderName(i.heldBy); if(hn)bits.push('🧑 '+esc(hn));
  var line=bits.join(" · "), chips=[invStatusChip(i.status),invCleanChip(i)].filter(Boolean).join(" ");
  if(!line&&!chips)return "";
  return '<div class="sub" style="white-space:normal;margin-top:2px">'+line+(chips?(line?" ":"")+chips:"")+'</div>';
}
function invJobTitle(tag){var j=INV_JOBS.find(function(x){return x[0]===tag;});return j?j[1]:tag;}
function invIsMaterial(i){return !!INV_MATERIAL_CATS[(i.cat||"").toLowerCase()];}
function invPriceKnown(p){p=(p||"").trim();return p&&p!=="owned"&&p!=="$0"&&p!=="—";}
function invBrandKnown(b){b=(b||"").trim();return b&&b!=="—";}

/* INV_SEED — generated from OBX-Ops/Inventory/master-inventory.md (110 items).
   Stable inv-<slug> ids so re-seed and multi-device sync dedupe by id instead of duplicating. */
var INV_SEED = [
  {id:"inv-pickup-truck",name:"Pickup truck",cat:"vehicle",have:true,qty:"",price:"owned",brand:"Ford F-150 / similar",tags:["all"],section:"Vehicle & transport",notes:"Primary work vehicle + light hauling"},
  {id:"inv-utility-dump-trailer",name:"Utility / dump trailer",cat:"vehicle",have:false,qty:"",price:"$1,000–9,000",brand:"Big Tex 70PI util / 7×12 dump",tags:["junk","brush","land-clearing","storm","yard"],section:"Vehicle & transport",notes:"Gating buy — rent until volume steady (see Hauling doc)"},
  {id:"inv-roll-off-dumpster",name:"Roll-off dumpster",cat:"equipment",have:false,qty:"",price:"$300–500/wk",brand:"Soundside Recycling (Dare)",tags:["junk","land-clearing","storm"],section:"Vehicle & transport",notes:"RENTAL — pass-through; includes haul + tonnage"},
  {id:"inv-pressure-washer-gas-4-gpm",name:"Pressure washer (gas, ~4 GPM)",cat:"equipment",have:false,qty:"",price:"$400–1,200",brand:"Simpson/DeWalt 4200psi (Honda GX390)",tags:["driveway","deck","parking-lot"],section:"Wash equipment",notes:"High pressure for concrete only — never roofs/siding"},
  {id:"inv-surface-cleaner-attachment",name:"Surface cleaner attachment",cat:"equipment",have:false,qty:"",price:"$80–300",brand:"BE Whirlaway 24\" / Simpson 15\"",tags:["driveway","deck","parking-lot"],section:"Wash equipment",notes:"Even, streak-free flat cleaning"},
  {id:"inv-soft-wash-system-12v-pump-tank",name:"Soft-wash system (12V pump + tank)",cat:"equipment",have:false,qty:"",price:"$300–1,200",brand:"Soft Wash Systems / Everflo 12V build",tags:["house-wash","roof-wash","deck"],section:"Wash equipment",notes:"Low-pressure chemical application — core of the wash line"},
  {id:"inv-downstream-injector-j-rod",name:"Downstream injector + J-rod",cat:"equipment",have:false,qty:"",price:"$30–80",brand:"General Pump / Sooke",tags:["house-wash","roof-wash","driveway","deck"],section:"Wash equipment",notes:"Draws SH mix through the line"},
  {id:"inv-buffer-water-tank-50-100-gal",name:"Buffer / water tank (50–100 gal)",cat:"equipment",have:false,qty:"",price:"$150–400",brand:"Norwesco",tags:["house-wash","roof-wash"],section:"Wash equipment",notes:"Mix + supply when spigot flow is weak"},
  {id:"inv-pressure-hose-reel-150-ft",name:"Pressure hose + reel (150 ft)",cat:"equipment",have:false,qty:"",price:"$150–400",brand:"Legacy 3/8\" + Titan reel",tags:["driveway","deck","parking-lot","house-wash","roof-wash"],section:"Wash equipment",notes:"Reach without moving the rig"},
  {id:"inv-garden-hose-reel",name:"Garden hose + reel",cat:"tool",have:false,qty:"",price:"$40–120",brand:"Flexzilla 5/8\"",tags:["house-wash","roof-wash","driveway","deck","windows","parking-lot"],section:"Wash equipment",notes:"Customer spigot supply / rinse"},
  {id:"inv-spray-gun-wand-pressure",name:"Spray gun + wand (pressure)",cat:"tool",have:false,qty:"",price:"$40–120",brand:"General Pump",tags:["driveway","deck","parking-lot"],section:"Wash equipment",notes:null},
  {id:"inv-telescoping-wand",name:"Telescoping wand",cat:"tool",have:false,qty:"",price:"$120–300",brand:"General Pump 18 ft",tags:["house-wash","roof-wash"],section:"Wash equipment",notes:"Reach 2nd-story siding from ground"},
  {id:"inv-pump-up-sprayer-1-2-gal",name:"Pump-up sprayer (1–2 gal)",cat:"equipment",have:false,qty:"",price:"$20–60",brand:"Chapin / Solo",tags:["house-wash","deck","yard"],section:"Wash equipment",notes:"Spot treatment, weed/mildew app"},
  {id:"inv-5-gal-buckets",name:"5-gal buckets",cat:"tool",have:false,qty:"",price:"$5–8 ea",brand:"Home Depot Homer",tags:["house-wash","windows","deck","driveway"],section:"Wash equipment",notes:"Mix / carry"},
  {id:"inv-spray-bottles",name:"Spray bottles",cat:"tool",have:false,qty:"",price:"$5–12",brand:"Tolco chemical-resistant",tags:["windows","house-wash"],section:"Wash equipment",notes:"Spot + detail"},
  {id:"inv-extension-ladder-30-ft",name:"Extension ladder (30 ft)",cat:"equipment",have:true,qty:"",price:"owned",brand:"Werner D1132-2 (32 ft)",tags:["roof-wash","gutters","house-wash","windows","brush","land-clearing","storm"],section:"Ladders & access",notes:"Owned. Defines the tree/limb reach cap — ladder-reach only"},
  {id:"inv-step-ladder-6-8-ft",name:"Step ladder (6–8 ft)",cat:"equipment",have:true,qty:"",price:"$80–200",brand:"Werner 8 ft fiberglass",tags:["windows","gutters","house-wash","deck"],section:"Ladders & access",notes:"Owned (Ray has ladders)"},
  {id:"inv-ladder-stabilizer-standoff",name:"Ladder stabilizer / standoff",cat:"tool",have:false,qty:"",price:"$40–80",brand:"Werner AC78",tags:["roof-wash","gutters","house-wash"],section:"Ladders & access",notes:"Stand off the wall/gutter safely"},
  {id:"inv-water-fed-pole-system-di-filter",name:"Water-fed pole system (+ DI filter)",cat:"equipment",have:false,qty:"",price:"$300–900",brand:"Unger HydroPower / XERO",tags:["windows","house-wash","gutters"],section:"Ladders & access",notes:"Clean high glass from the ground — safer than ladders"},
  {id:"inv-roof-anchor-temp-tie-off-kit",name:"Roof anchor / temp tie-off kit",cat:"equipment",have:false,qty:"",price:"$50–150",brand:"Guardian",tags:["roof-wash"],section:"Ladders & access",notes:"Pairs with the harness for roof-plane work"},
  {id:"inv-squeegee-set-various-sizes",name:"Squeegee set (various sizes)",cat:"tool",have:false,qty:"",price:"$30–120",brand:"Unger / Ettore",tags:["windows"],section:"Window tools",notes:null},
  {id:"inv-window-strip-washer-scrubber",name:"Window strip washer / scrubber",cat:"tool",have:false,qty:"",price:"$20–50",brand:"Unger",tags:["windows"],section:"Window tools",notes:null},
  {id:"inv-window-scraper-razor",name:"Window scraper (razor)",cat:"tool",have:false,qty:"",price:"$10–25",brand:"Ettore",tags:["windows"],section:"Window tools",notes:"Paint/debris on glass"},
  {id:"inv-extension-pole-squeegee",name:"Extension pole (squeegee)",cat:"tool",have:false,qty:"",price:"$40–150",brand:"Unger OptiLoc",tags:["windows"],section:"Window tools",notes:null},
  {id:"inv-gutter-scoop-trowel",name:"Gutter scoop / trowel",cat:"tool",have:false,qty:"",price:"$8–20",brand:"Amerimax",tags:["gutters"],section:"Gutter tools",notes:null},
  {id:"inv-telescoping-gutter-wand-tongs",name:"Telescoping gutter wand / tongs",cat:"tool",have:false,qty:"",price:"$30–80",brand:"Gutter Sense / Orbit",tags:["gutters"],section:"Gutter tools",notes:"Clear from ground where possible"},
  {id:"inv-wet-dry-vac",name:"Wet/dry vac",cat:"equipment",have:false,qty:"",price:"$80–250",brand:"Ridgid 14 gal",tags:["gutters"],section:"Gutter tools",notes:"Optional — dry-debris pickup"},
  {id:"inv-hand-truck-dolly",name:"Hand truck / dolly",cat:"tool",have:false,qty:"",price:"$40–120",brand:"Cosco / Magna Cart",tags:["junk"],section:"Junk / clear-out tools",notes:null},
  {id:"inv-appliance-dolly",name:"Appliance dolly",cat:"tool",have:false,qty:"",price:"$120–300",brand:"Harper / Milwaukee",tags:["junk"],section:"Junk / clear-out tools",notes:"Fridges, washers — heavy items"},
  {id:"inv-moving-straps",name:"Moving straps",cat:"tool",have:false,qty:"",price:"$20–40",brand:"Forearm Forklift",tags:["junk"],section:"Junk / clear-out tools",notes:"Two-person lift aid"},
  {id:"inv-moving-blankets",name:"Moving blankets",cat:"tool",have:false,qty:"",price:"$10–25 ea",brand:"US Cargo Control",tags:["junk"],section:"Junk / clear-out tools",notes:"Protect floors/walls on the way out"},
  {id:"inv-box-cutter-utility-knife",name:"Box cutter / utility knife",cat:"tool",have:false,qty:"",price:"$8–20",brand:"Milwaukee Fastback",tags:["junk"],section:"Junk / clear-out tools",notes:null},
  {id:"inv-cordless-drill-driver",name:"Cordless drill / driver",cat:"tool",have:false,qty:"",price:"$80–250",brand:"DeWalt 20V / Milwaukee M18",tags:["junk","home-watch"],section:"Junk / clear-out tools",notes:"Disassemble furniture; minor fixes"},
  {id:"inv-pry-bar",name:"Pry bar",cat:"tool",have:false,qty:"",price:"$15–40",brand:"Stanley FatMax",tags:["junk"],section:"Junk / clear-out tools",notes:null},
  {id:"inv-hammer-sledgehammer",name:"Hammer / sledgehammer",cat:"tool",have:false,qty:"",price:"$20–50",brand:"Estwing",tags:["junk"],section:"Junk / clear-out tools",notes:"Break down bulky items"},
  {id:"inv-hand-tool-set-wrenches-screwdrivers",name:"Hand tool set (wrenches/screwdrivers)",cat:"tool",have:false,qty:"",price:"$50–200",brand:"DeWalt / Crescent",tags:["junk","home-watch"],section:"Junk / clear-out tools",notes:null},
  {id:"inv-ratchet-cargo-straps",name:"Ratchet / cargo straps",cat:"tool",have:false,qty:"",price:"$20–50 set",brand:"Keeper / SmartStraps",tags:["junk","brush","storm"],section:"Junk / clear-out tools",notes:"Secure loads in truck/trailer"},
  {id:"inv-lawn-mower-self-propelled-zt",name:"Lawn mower (self-propelled / ZT)",cat:"equipment",have:false,qty:"",price:"push $300–700 · ZT $3,000–6,000",brand:"Honda HRX / Toro TimeMaster · ZT Toro/Ariens",tags:["yard"],section:"Yard / brush / land-clearing equipment",notes:"Push to start; zero-turn once routes are steady"},
  {id:"inv-string-trimmer-weed-eater",name:"String trimmer / weed eater",cat:"equipment",have:false,qty:"",price:"$150–400",brand:"Echo SRM-225 / Stihl FS 91 R",tags:["yard","brush","land-clearing"],section:"Yard / brush / land-clearing equipment",notes:null},
  {id:"inv-lawn-edger",name:"Lawn edger",cat:"equipment",have:false,qty:"",price:"$130–350",brand:"Echo PE-225",tags:["yard"],section:"Yard / brush / land-clearing equipment",notes:null},
  {id:"inv-backpack-leaf-blower",name:"Backpack leaf blower",cat:"equipment",have:false,qty:"",price:"$250–600",brand:"Stihl BR 600 / Echo PB-580",tags:["yard","gutters","parking-lot","storm","driveway"],section:"Yard / brush / land-clearing equipment",notes:"Cleanup + clearing finished surfaces"},
  {id:"inv-hedge-trimmer",name:"Hedge trimmer",cat:"equipment",have:false,qty:"",price:"$150–400",brand:"Stihl HS 45 / Echo HC-152",tags:["yard","brush"],section:"Yard / brush / land-clearing equipment",notes:null},
  {id:"inv-chainsaw-small-16-18",name:"Chainsaw — small (16–18\")",cat:"equipment",have:true,qty:"",price:"$200–400",brand:"Stihl MS 170/180",tags:["brush","land-clearing","storm"],section:"Yard / brush / land-clearing equipment",notes:"Owned. Limb/small-tree work only — see scope policy"},
  {id:"inv-chainsaw-larger-20",name:"Chainsaw — larger (20\"+)",cat:"equipment",have:false,qty:"",price:"$400–800 or RENTAL",brand:"Stihl MS 271",tags:["brush","land-clearing","storm"],section:"Yard / brush / land-clearing equipment",notes:"RENTAL — only within scope (ground/ladder-reach drops)"},
  {id:"inv-pole-saw-powered",name:"Pole saw (powered)",cat:"equipment",have:false,qty:"",price:"$200–500 or RENTAL",brand:"Stihl HT 133 / rent",tags:["brush","land-clearing","storm"],section:"Yard / brush / land-clearing equipment",notes:"RENTAL-able — overhead limbs from ground, within reach cap"},
  {id:"inv-wheelbarrow",name:"Wheelbarrow",cat:"tool",have:false,qty:"",price:"$80–200",brand:"Jackson 6 cu ft",tags:["yard","brush","land-clearing"],section:"Yard / brush / land-clearing equipment",notes:"Move debris / mulch"},
  {id:"inv-generator-portable",name:"Generator (portable)",cat:"equipment",have:false,qty:"",price:"$400–1,200",brand:"Honda EU2200i / Champion",tags:["land-clearing","storm"],section:"Yard / brush / land-clearing equipment",notes:"Power at remote/off-grid sites"},
  {id:"inv-brush-mower-walk-behind",name:"Brush mower (walk-behind)",cat:"equipment",have:false,qty:"",price:"RENTAL",brand:"DR / Billy Goat",tags:["land-clearing"],section:"Yard / brush / land-clearing equipment",notes:"RENTAL — heavy overgrowth"},
  {id:"inv-stump-grinder",name:"Stump grinder",cat:"equipment",have:false,qty:"",price:"RENTAL $85–160/day",brand:"Barreto (Home Depot KDH)",tags:["land-clearing"],section:"Yard / brush / land-clearing equipment",notes:"RENTAL"},
  {id:"inv-wood-chipper-chipper-shredder",name:"Wood chipper / chipper-shredder",cat:"equipment",have:false,qty:"",price:"RENTAL",brand:"Vermeer / Home Depot",tags:["brush","land-clearing","storm"],section:"Yard / brush / land-clearing equipment",notes:"RENTAL — reduces haul volume"},
  {id:"inv-mini-skid-steer-compact-loader",name:"Mini skid steer / compact loader",cat:"equipment",have:false,qty:"",price:"RENTAL",brand:"Bobcat MT55 / Ditch Witch",tags:["land-clearing"],section:"Yard / brush / land-clearing equipment",notes:"RENTAL — big lot clearing only"},
  {id:"inv-loppers",name:"Loppers",cat:"tool",have:false,qty:"",price:"$30–70",brand:"Fiskars / Corona",tags:["yard","brush"],section:"Hand tools — yard / brush / cleanup",notes:null},
  {id:"inv-pruning-shears",name:"Pruning shears",cat:"tool",have:false,qty:"",price:"$15–50",brand:"Felco F-2",tags:["yard","brush"],section:"Hand tools — yard / brush / cleanup",notes:null},
  {id:"inv-bow-saw-hand-saw",name:"Bow saw / hand saw",cat:"tool",have:false,qty:"",price:"$15–40",brand:"Bahco",tags:["brush","storm"],section:"Hand tools — yard / brush / cleanup",notes:null},
  {id:"inv-machete-brush-axe",name:"Machete / brush axe",cat:"tool",have:false,qty:"",price:"$20–50",brand:"Council Tool",tags:["land-clearing","brush"],section:"Hand tools — yard / brush / cleanup",notes:null},
  {id:"inv-leaf-rake",name:"Leaf rake",cat:"tool",have:false,qty:"",price:"$15–35",brand:"Ames",tags:["yard","brush","storm"],section:"Hand tools — yard / brush / cleanup",notes:null},
  {id:"inv-landscape-bow-rake",name:"Landscape / bow rake",cat:"tool",have:false,qty:"",price:"$25–50",brand:"True Temper",tags:["yard","land-clearing"],section:"Hand tools — yard / brush / cleanup",notes:null},
  {id:"inv-round-point-shovel",name:"Round-point shovel",cat:"tool",have:false,qty:"",price:"$25–45",brand:"Razor-Back",tags:["junk","land-clearing","storm","yard"],section:"Hand tools — yard / brush / cleanup",notes:null},
  {id:"inv-flat-shovel",name:"Flat shovel",cat:"tool",have:false,qty:"",price:"$25–45",brand:"Razor-Back",tags:["junk","parking-lot","storm"],section:"Hand tools — yard / brush / cleanup",notes:"Scoop debris off hard surfaces"},
  {id:"inv-pitchfork-mulch-fork",name:"Pitchfork / mulch fork",cat:"tool",have:false,qty:"",price:"$30–60",brand:"Razor-Back",tags:["yard","brush"],section:"Hand tools — yard / brush / cleanup",notes:null},
  {id:"inv-push-broom",name:"Push broom",cat:"tool",have:false,qty:"",price:"$20–45",brand:"Libman 24\"",tags:["parking-lot","driveway","deck","storm"],section:"Hand tools — yard / brush / cleanup",notes:null},
  {id:"inv-trash-grabber-picker",name:"Trash grabber / picker",cat:"tool",have:false,qty:"",price:"$15–35",brand:"Unger Nifty Nabber",tags:["parking-lot"],section:"Hand tools — yard / brush / cleanup",notes:"Lot/roadside litter"},
  {id:"inv-tape-measure",name:"Tape measure",cat:"tool",have:false,qty:"",price:"$15–35",brand:"Milwaukee 25 ft",tags:["junk","land-clearing","yard"],section:"Hand tools — yard / brush / cleanup",notes:"On-site quoting / sizing"},
  {id:"inv-tarps-heavy-10-12",name:"Tarps (heavy, 10×12)",cat:"tool",have:false,qty:"",price:"$20–50",brand:"B-Air heavy-duty",tags:["junk","brush","yard","storm","gutters"],section:"Hand tools — yard / brush / cleanup",notes:"Drag debris / protect surfaces"},
  {id:"inv-gas-cans-mix-straight",name:"Gas cans (mix + straight)",cat:"tool",have:false,qty:"",price:"$15–35 ea",brand:"No-Spill 5 gal",tags:["yard","brush","land-clearing","storm"],section:"Hand tools — yard / brush / cleanup",notes:"Label clearly — wrong fuel kills 2-strokes"},
  {id:"inv-extension-cords-outdoor",name:"Extension cords (outdoor)",cat:"tool",have:false,qty:"",price:"$30–80",brand:"US Wire 100 ft 12 ga",tags:["gutters","parking-lot"],section:"Hand tools — yard / brush / cleanup",notes:"Electric tools / lighting"},
  {id:"inv-flashlight-headlamp",name:"Flashlight / headlamp",cat:"tool",have:false,qty:"",price:"$20–60",brand:"Coast / Energizer",tags:["home-watch","storm"],section:"Hand tools — yard / brush / cleanup",notes:null},
  {id:"inv-safety-cones",name:"Safety cones",cat:"tool",have:false,qty:"",price:"$25–60 set",brand:"JBC 28\"",tags:["parking-lot","storm"],section:"Hand tools — yard / brush / cleanup",notes:"Traffic / work-zone marking"},
  {id:"inv-fire-extinguisher-abc",name:"Fire extinguisher (ABC)",cat:"tool",have:false,qty:"",price:"$25–60",brand:"Kidde",tags:["brush","land-clearing","storm"],section:"Hand tools — yard / brush / cleanup",notes:"Keep on the truck whenever a saw runs"},
  {id:"inv-phone-w-camera-photo-report",name:"Phone w/ camera (photo report)",cat:"tool",have:true,qty:"",price:"owned",brand:"smartphone",tags:["all"],section:"Home-watch kit",notes:"Every visit + before/after assets"},
  {id:"inv-property-watch-checklist-app-printed",name:"Property-watch checklist (app/printed)",cat:"tool",have:false,qty:"",price:"$0",brand:"J-Suite app / printed",tags:["home-watch"],section:"Home-watch kit",notes:"Standard walk-through, photo report each visit"},
  {id:"inv-moisture-meter",name:"Moisture meter",cat:"tool",have:false,qty:"",price:"$25–80",brand:"General Tools MMD4E",tags:["home-watch"],section:"Home-watch kit",notes:"Catch leaks/humidity early"},
  {id:"inv-lockbox-key-storage",name:"Lockbox (key storage)",cat:"tool",have:false,qty:"",price:"$20–40",brand:"Master Lock 5400D",tags:["home-watch"],section:"Home-watch kit",notes:"Secure key access on recurring accounts"},
  {id:"inv-contractor-trash-bags-3-mil",name:"Contractor trash bags (3 mil)",cat:"consumable",have:false,qty:"",price:"$20–40/box",brand:"Husky Contractor",tags:["junk","parking-lot","yard","storm","gutters"],section:"Consumables",notes:null},
  {id:"inv-microfiber-towels",name:"Microfiber towels",cat:"consumable",have:false,qty:"",price:"$15–30/pack",brand:"Zwipes",tags:["windows","house-wash"],section:"Consumables",notes:null},
  {id:"inv-trimmer-line",name:"Trimmer line",cat:"consumable",have:false,qty:"",price:"$15–30",brand:"Echo Cross-Fire / Oregon",tags:["yard","brush","land-clearing"],section:"Consumables",notes:null},
  {id:"inv-2-stroke-oil-fuel-mix",name:"2-stroke oil / fuel mix",cat:"consumable",have:false,qty:"",price:"$5–10/bottle",brand:"Stihl HP / Echo Power Blend",tags:["yard","brush","land-clearing","storm"],section:"Consumables",notes:null},
  {id:"inv-bar-and-chain-oil",name:"Bar & chain oil",cat:"consumable",have:false,qty:"",price:"$10–20/gal",brand:"Stihl / Husqvarna",tags:["brush","land-clearing","storm"],section:"Consumables",notes:null},
  {id:"inv-fuel-stabilizer",name:"Fuel stabilizer",cat:"consumable",have:false,qty:"",price:"$8–15",brand:"Sta-Bil",tags:["yard","brush","land-clearing","storm"],section:"Consumables",notes:"Off-season equipment storage"},
  {id:"inv-mower-blades-air-filter-spark-plug",name:"Mower blades / air filter / spark plug",cat:"consumable",have:false,qty:"",price:"$20–50",brand:"OEM",tags:["yard"],section:"Consumables",notes:"Wear items"},
  {id:"inv-gasoline-equipment",name:"Gasoline (equipment)",cat:"consumable",have:false,qty:"",price:"market",brand:"—",tags:["yard","brush","land-clearing","storm","driveway","parking-lot","deck"],section:"Consumables",notes:null},
  {id:"inv-mulch-per-job",name:"Mulch (per job)",cat:"consumable",have:false,qty:"",price:"$3–5/bag · $30–45/yd bulk",brand:"—",tags:["yard"],section:"Consumables",notes:"Materials pass-through (cost + markup)"},
  {id:"inv-landscape-fabric",name:"Landscape fabric",cat:"consumable",have:false,qty:"",price:"$20–50/roll",brand:"DeWitt",tags:["yard"],section:"Consumables",notes:null},
  {id:"inv-sandpaper-scrub-pads",name:"Sandpaper / scrub pads",cat:"consumable",have:false,qty:"",price:"$10–20",brand:"3M",tags:["deck"],section:"Consumables",notes:null},
  {id:"inv-nitrile-gloves-box",name:"Nitrile gloves (box)",cat:"consumable",have:false,qty:"",price:"$10–20",brand:"—",tags:["house-wash","roof-wash","driveway","deck"],section:"Consumables",notes:"Disposable, per job"},
  {id:"inv-shoe-covers-booties",name:"Shoe covers / booties",cat:"consumable",have:false,qty:"",price:"$10–20/100",brand:"—",tags:["home-watch"],section:"Consumables",notes:"Protect customer floors"},
  {id:"inv-sodium-hypochlorite-12-5-sh",name:"Sodium hypochlorite 12.5% (SH)",cat:"chemical",have:false,qty:"",price:"$2.50–3.00/gal",brand:"local pool-supply / bulk",tags:["house-wash","roof-wash","driveway","deck","parking-lot"],section:"Chemicals",notes:"The workhorse"},
  {id:"inv-surfactant-snot",name:"Surfactant (\"snot\")",cat:"chemical",have:false,qty:"",price:"$20–40/gal",brand:"Slooshie / Elemonator",tags:["house-wash","roof-wash","deck"],section:"Chemicals",notes:"~1 oz per gal of mix — cling + dwell"},
  {id:"inv-concrete-degreaser",name:"Concrete degreaser",cat:"chemical",have:false,qty:"",price:"$15–30",brand:"Simple Green / Purple Power",tags:["driveway","parking-lot"],section:"Chemicals",notes:"Oil/grease on hard surfaces"},
  {id:"inv-wood-brightener-oxalic-acid",name:"Wood brightener / oxalic acid",cat:"chemical",have:false,qty:"",price:"$20–35",brand:"F18 / Savogran",tags:["deck"],section:"Chemicals",notes:"Restore color after wash"},
  {id:"inv-mold-mildew-inhibitor",name:"Mold / mildew inhibitor",cat:"chemical",have:false,qty:"",price:"$20–40",brand:"Wet & Forget",tags:["house-wash","deck"],section:"Chemicals",notes:"Extends time between washes"},
  {id:"inv-plant-landscape-neutralizer-rinse",name:"Plant / landscape neutralizer (rinse)",cat:"chemical",have:false,qty:"",price:"$15–30",brand:"Plant Wash (or plain water)",tags:["house-wash","roof-wash"],section:"Chemicals",notes:"Protect customer landscaping from SH"},
  {id:"inv-window-cleaning-concentrate",name:"Window cleaning concentrate",cat:"chemical",have:false,qty:"",price:"$10–20",brand:"Glass Gleam / Dawn",tags:["windows"],section:"Chemicals",notes:null},
  {id:"inv-efflorescence-rust-remover",name:"Efflorescence / rust remover",cat:"chemical",have:false,qty:"",price:"$20–40",brand:"F9 BARC",tags:["driveway"],section:"Chemicals",notes:"Optional — masonry stains"},
  {id:"inv-work-gloves",name:"Work gloves",cat:"PPE",have:false,qty:"",price:"$10–25",brand:"Mechanix",tags:["all"],section:"PPE & safety",notes:null},
  {id:"inv-chemical-resistant-gloves-nitrile-neoprene",name:"Chemical-resistant gloves (nitrile/neoprene)",cat:"PPE",have:false,qty:"",price:"$15–30",brand:"Atlas / MAPA",tags:["house-wash","roof-wash","driveway","deck","parking-lot"],section:"PPE & safety",notes:"Reusable, for SH handling"},
  {id:"inv-safety-glasses-goggles",name:"Safety glasses / goggles",cat:"PPE",have:false,qty:"",price:"$5–20",brand:"3M / DeWalt",tags:["all"],section:"PPE & safety",notes:null},
  {id:"inv-face-shield",name:"Face shield",cat:"PPE",have:false,qty:"",price:"$15–30",brand:"Sellstrom",tags:["house-wash","roof-wash","land-clearing"],section:"PPE & safety",notes:"Overhead chemical / debris"},
  {id:"inv-respirator-n95-masks",name:"Respirator / N95 masks",cat:"PPE",have:false,qty:"",price:"$20–40",brand:"3M 6200 / N95 box",tags:["junk","house-wash","roof-wash"],section:"PPE & safety",notes:"Dust, mold, chemical fumes"},
  {id:"inv-ear-protection",name:"Ear protection",cat:"PPE",have:false,qty:"",price:"$15–35",brand:"3M Peltor",tags:["yard","brush","land-clearing","parking-lot","driveway","storm"],section:"PPE & safety",notes:"Powered equipment"},
  {id:"inv-chainsaw-chaps",name:"Chainsaw chaps",cat:"PPE",have:false,qty:"",price:"$60–120",brand:"Husqvarna / Forester",tags:["brush","land-clearing","storm"],section:"PPE & safety",notes:"Required whenever the saw runs"},
  {id:"inv-hard-hat",name:"Hard hat",cat:"PPE",have:false,qty:"",price:"$15–40",brand:"MSA",tags:["land-clearing","storm"],section:"PPE & safety",notes:"Overhead hazards"},
  {id:"inv-work-boots-steel-composite-toe",name:"Work boots (steel/composite toe)",cat:"PPE",have:false,qty:"",price:"$90–180",brand:"Timberland PRO",tags:["all"],section:"PPE & safety",notes:null},
  {id:"inv-roof-safe-non-slip-footwear",name:"Roof-safe / non-slip footwear",cat:"PPE",have:false,qty:"",price:"$80–150",brand:"Cougar Paws",tags:["roof-wash"],section:"PPE & safety",notes:null},
  {id:"inv-fall-protection-harness",name:"Fall-protection harness",cat:"PPE",have:false,qty:"",price:"$80–200",brand:"Guardian / Malta",tags:["roof-wash"],section:"PPE & safety",notes:"Any time you're on the roof plane"},
  {id:"inv-high-vis-vest",name:"High-vis vest",cat:"PPE",have:false,qty:"",price:"$10–25",brand:"—",tags:["parking-lot","storm"],section:"PPE & safety",notes:"Traffic / roadside"},
  {id:"inv-rain-chemical-suit-tyvek",name:"Rain / chemical suit (Tyvek)",cat:"PPE",have:false,qty:"",price:"$10–30",brand:"DuPont Tyvek",tags:["roof-wash","house-wash"],section:"PPE & safety",notes:"Overhead SH drip"},
  {id:"inv-knee-pads",name:"Knee pads",cat:"PPE",have:false,qty:"",price:"$15–40",brand:"NoCry",tags:["windows","deck"],section:"PPE & safety",notes:null},
  {id:"inv-first-aid-kit",name:"First-aid kit",cat:"PPE",have:false,qty:"",price:"$20–50",brand:"—",tags:["all"],section:"PPE & safety",notes:null},
  {id:"inv-water-cooler-hydration",name:"Water cooler / hydration",cat:"PPE",have:false,qty:"",price:"$30–80",brand:"Igloo / Coleman",tags:["all"],section:"PPE & safety",notes:"OBX heat is a real hazard May–Sept"}
];

/* one-time / versioned import of the master into S.obx.inventory via the sync collection.
   Upserts by id: inserts missing items (carrying their seed Have? default), and on a version
   bump refreshes reference fields (price/brand/tags/notes/…) while PRESERVING the user's
   Have?/Qty marks — the master file stays the source of truth for reference data, the app
   stays the source of truth for what's actually owned. */
function seedInventory(){
  if(S.invSeedV===INV_SEED_V) return;
  var list=S.obx.inventory||(S.obx.inventory=[]);
  var byId={}; list.forEach(function(r){byId[r.id]=r;});
  INV_SEED.forEach(function(seed){
    var ex=byId[seed.id];
    if(ex){
      ex.name=seed.name; ex.cat=seed.cat; ex.price=seed.price; ex.brand=seed.brand;
      ex.tags=seed.tags.slice(); ex.section=seed.section; ex.notes=seed.notes; ex.updatedAt=now();
    }else{
      list.push({id:seed.id,name:seed.name,cat:seed.cat,have:!!seed.have,qty:"",
        price:seed.price,brand:seed.brand,tags:seed.tags.slice(),section:seed.section,
        notes:seed.notes,updatedAt:now()});
    }
  });
  S.invSeedV=INV_SEED_V; save();
}

/* PHASE 2 (vehicle unification) — idempotently migrate the legacy synthesized personal vehicles into real,
   first-class INVENTORY vehicles: seed ONE personal clock-in vehicle per ACTIVE member (schedMembers()) into
   this biz's inventory, keyed on a STABLE id (inv-veh-personal-<uid>) so a re-seed or a second device dedupes
   via the inventory LWW sync instead of duplicating. Each is personal (ownerId=member) + clockIn:true, so it
   flows into the clock-in picker and mileage reimburses the OWNER — identical semantics to the old synthesized
   "<name>'s vehicle" option, which is now dropped from the picker UI (js/38 tcVehicleOptionList), while
   historical owner:<uid> entries still resolve via tcResolveVehicle. ADDITIVE: creates inventory rows only —
   never touches timeclock entries or mileage math. */
function seedClockInVehicles(){
  var members=(typeof schedMembers==="function")?schedMembers():[];
  if(!members.length)return;
  var d=D(); if(!d.inventory)d.inventory=[];
  var byId={}; d.inventory.forEach(function(r){if(r&&r.id)byId[r.id]=r;});
  var added=false;
  members.forEach(function(u){
    if(!u||!u.id)return;
    var id="inv-veh-personal-"+u.id;
    if(byId[id])return;   // already seeded (stable id) — no dup on re-run / another device
    d.inventory.push({id:id,name:(u.username||"Crew")+"'s vehicle",cat:"vehicle",personal:true,ownerId:u.id,
      clockIn:true,active:true,have:true,qty:"",tags:[],section:"Vehicle & transport",updatedAt:now()});
    added=true;
  });
  if(added)save();
}

/* active (non-deleted) inventory for the current biz */
function actInv(){return (D().inventory||[]).filter(function(i){return !i.deleted;});}
/* PHASE 4 (cleaning) — items currently flagged as needing cleaning (drives the view + subnav/Today badges). */
function invNeedsCleaning(){return actInv().filter(function(i){return i.needsCleaning;});}
/* AUTO-FLAG ON JOB WRAP — when a job is completed (js/09 toggleJob), any of its required gear that
   "dirties with use" (chainsaw, mower…) gets flagged needs-cleaning + stamped with when/who. IDEMPOTENT:
   an already-flagged item is left untouched (never re-stamped), so re-completing / a later status pipeline
   can't churn the audit trail; reopening a job does NOT clear it (cleaning is a physical act). Additive —
   mutates inventory items in place; the caller saves. Returns the number of items newly flagged. */
function invAutoFlagCleaningForJob(job){
  if(!job)return 0;
  var lines=(typeof jobEquip==="function")?jobEquip(job):[];
  if(!lines.length)return 0;
  var byWho=(typeof curUser==="function"&&curUser())?curUser().id:null;
  var flagged=0;
  lines.forEach(function(e){
    var i=(typeof eqItemById==="function")?eqItemById(e.itemId):null;
    if(!i||!i.dirtiesWithUse||i.needsCleaning)return;   // only dirties-with-use gear, and never re-stamp
    i.needsCleaning=true; i.cleanFlaggedAt=now(); i.cleanFlaggedBy=byWho;
    if(typeof touch==="function")touch(i); flagged++;
  });
  return flagged;
}
/* MANUAL flag / clear — operational, so anyone (crew included) can flag a dirty tool or mark it cleaned.
   Both stamp when + who; clearing keeps the flag/cleared audit stamps so history survives. */
window.invFlagCleaning=function(id){var i=actInv().find(function(x){return x.id===id;});if(!i)return;
  i.needsCleaning=true; i.cleanFlaggedAt=now(); i.cleanFlaggedBy=(typeof curUser==="function"&&curUser())?curUser().id:null;
  touch(i);save();
  if(typeof logEvent==="function")logEvent("Flagged needs cleaning: "+i.name,"inventory");
  if(typeof closeModal==="function")closeModal(); render();};
window.invClearCleaning=function(id){var i=actInv().find(function(x){return x.id===id;});if(!i)return;
  i.needsCleaning=false; i.cleanClearedAt=now(); i.cleanClearedBy=(typeof curUser==="function"&&curUser())?curUser().id:null;
  touch(i);save();
  if(typeof logEvent==="function")logEvent("Marked cleaned: "+i.name,"inventory");
  if(typeof closeModal==="function")closeModal(); render();};
/* jump straight to the needs-cleaning list (used by the Today nudge) */
window.invGotoCleaning=function(){INVVIEW="cleaning";if(typeof navSub==="function")navSub("inventory");else{TAB="inventory";render();}};
/* items tagged for a job (its tag or the catch-all "all") */
function invLensItems(tag){return actInv().filter(function(i){var t=i.tags||[];return t.indexOf(tag)>=0||t.indexOf("all")>=0;});}

/* ---- tab state ---- */
var INVVIEW="master";          // "master" | "job" | "avail"
var INVJOB="house-wash";       // active job-type lens
var INVSEARCH="";
var INV_AVAIL_DATE=null;        // selected date for the equipment-availability-by-date view

window.invSetView=function(v){INVVIEW=v;render();};
window.invSetJob=function(t){INVJOB=t;render();};
window.invSearchOn=function(v){INVSEARCH=(v||"").toLowerCase();invRenderMaster();};
window.invAvailDate=function(v){INV_AVAIL_DATE=v;invRenderAvail();};

function invBizName(){return S.biz==="obx"?"OBX Lot Solutions":"Jamieson Automation";}

/* category badge color reuse the priority palette loosely via inline style */
function invCatBadge(cat){
  var c=(cat||"").toLowerCase();
  var col=c==="chemical"?"#8e44ad":c==="consumable"?"#0070b8":c==="ppe"?"#c0392b":c==="vehicle"?"#5d4037":c==="equipment"?"#1b7f4d":"#6b7280";
  return '<span class="badge" style="background:'+col+';color:#fff;margin-left:6px">'+esc(cat)+'</span>';
}
function invMetaLine(i){
  var bits=[];
  if(invPriceKnown(i.price))bits.push(esc(i.price));
  else if((i.price||"")==="owned")bits.push("owned");
  if(invBrandKnown(i.brand))bits.push("e.g. "+esc(i.brand));
  if(i.notes)bits.push(esc(i.notes));
  return bits.join(" · ");
}

function rInventory(){
  var inv=actInv();
  var ncount=invNeedsCleaning().length;
  var sub='<div class="subnav">'
    +'<button class="subbtn '+(INVVIEW==="master"?"on":"")+'" onclick="invSetView(\'master\')">Master list</button>'
    +'<button class="subbtn '+(INVVIEW==="buy"?"on":"")+'" onclick="invSetView(\'buy\')">🛒 To buy'+(invToBuyCount()?' <span class="badge" style="background:#6b3fa0;color:#fff;margin-left:4px">'+invToBuyCount()+'</span>':"")+'</button>'
    +'<button class="subbtn '+(INVVIEW==="vehicles"?"on":"")+'" onclick="invSetView(\'vehicles\')">🚚 Vehicles</button>'
    +'<button class="subbtn '+(INVVIEW==="cleaning"?"on":"")+'" onclick="invSetView(\'cleaning\')">🧽 Needs cleaning'+(ncount?' <span class="badge" style="background:#b8860b;color:#fff;margin-left:4px">'+ncount+'</span>':"")+'</button>'
    +'<button class="subbtn '+(INVVIEW==="job"?"on":"")+'" onclick="invSetView(\'job\')">By job type</button>'
    +'<button class="subbtn '+(INVVIEW==="avail"?"on":"")+'" onclick="invSetView(\'avail\')">Availability by date</button>'
    +'</div>';

  // Vehicles + cleaning views render their own content/empty-states, so keep the subnav reachable even when this biz has no inventory yet.
  if(!inv.length&&INVVIEW!=="vehicles"&&INVVIEW!=="cleaning"){
    var why=S.biz==="jam"
      ? "No Jamieson inventory master yet. The OBX master (110 items) is already seeded — switch to OBX to use it. A Jamieson master can be added the same way later; for now, tap + to add items by hand."
      : "No inventory yet. Tap + to add an item.";
    view.innerHTML=sub+'<div class="empty"><div class="big">🧰</div>'+esc(why)+'</div>';
    return;
  }
  view.innerHTML=sub+'<div id="inv_body"></div>';
  if(INVVIEW==="vehicles")invRenderVehicles();else if(INVVIEW==="cleaning")invRenderCleaning();else if(INVVIEW==="avail")invRenderAvail();else if(INVVIEW==="job")invRenderJob();else if(INVVIEW==="buy")invRenderBuy();else invRenderMaster();
}

/* count of don't-have, non-vehicle items = the shopping list badge */
function invToBuyCount(){ return actInv().filter(function(i){return !i.have && (i.cat||"")!=="vehicle";}).length; }
/* ---------- TO BUY (the shopping list) — every don't-have item; check one off → it moves to the Master list ---------- */
function invRenderBuy(){
  var body=document.getElementById("inv_body"); if(!body)return;
  var all=actInv();
  var list=all.filter(function(i){return !i.have && (i.cat||"")!=="vehicle";});
  var q=INVSEARCH; if(q)list=list.filter(function(i){return (i.name+" "+i.brand+" "+i.section+" "+(i.tags||[]).join(" ")+" "+(i.notes||"")).toLowerCase().indexOf(q)>=0;});
  var h='<div class="secthd"><h2>🛒 To buy</h2><span class="ct">'+list.length+'</span></div>';
  h+='<p class="muted" style="margin:0 4px 8px;font-size:13px">The gear we still need. Check one off when you get it and it moves to your Master list. Tap ＋ to add anything missing.</p>';
  h+='<input class="search" placeholder="Search the buy list…" oninput="invSearchOn(this.value)" value="'+esc(INVSEARCH)+'">';
  if(!list.length){h+='<div class="empty"><div class="big">✅</div>Nothing on the buy list'+(q?' matches "'+esc(q)+'"':' — you have everything logged')+'.</div>';body.innerHTML=h;return;}
  var order=[],groups={};
  list.forEach(function(i){var s=i.section||"Other";if(!groups[s]){groups[s]=[];order.push(s);}groups[s].push(i);});
  order.forEach(function(s){var g=groups[s];
    h+='<div class="secthd"><h2>'+esc(s)+'</h2><span class="ct">'+g.length+'</span></div><div class="card" style="padding:6px 10px">'+g.map(invMasterRow).join("")+'</div>';
  });
  body.innerHTML=h;
}

/* ---------- MASTER (edit Have?/Qty here, once) ---------- */
function invRenderMaster(){
  var body=document.getElementById("inv_body"); if(!body)return;
  var all=actInv();
  var owned=all.filter(function(i){return i.have;}).length;
  var q=INVSEARCH;
  var list=q?all.filter(function(i){return (i.name+" "+i.brand+" "+i.section+" "+(i.tags||[]).join(" ")+" "+(i.notes||"")).toLowerCase().indexOf(q)>=0;}):all;

  var h='<div class="secthd"><h2>Inventory · '+invBizName()+'</h2><span class="ct">'+owned+'/'+all.length+' owned</span></div>';
  h+='<div class="kpi" style="display:flex;gap:8px;margin:0 4px 10px">'
    +'<div class="k"><div class="kn">'+all.length+'</div><div class="kl">items</div></div>'
    +'<div class="k"><div class="kn">'+owned+'</div><div class="kl">have</div></div>'
    +'<div class="k"><div class="kn">'+(all.length-owned)+'</div><div class="kl">still needed</div></div>'
    +'</div>';
  h+='<p class="muted" style="margin:0 4px 8px;font-size:13px">This is the single source of truth — set <b>Have?</b> and <b>Qty</b> here, once. The <b>By job type</b> views are read-only lenses that inherit this status. Est. price / brand are rough 2026 reference examples — confirm locally.</p>';
  // VEHICLE UNIFICATION — anyone can add their own vehicle here; it flows straight into the clock-in picker.
  h+='<button class="btn ghost" style="width:100%;margin:0 4px 10px;width:calc(100% - 8px)" onclick="tcAddMyVehicle(false)">🚗 ＋ Add my vehicle (for clock-in)</button>';
  h+='<input class="search" placeholder="Search items, brands, tags…" oninput="invSearchOn(this.value)" value="'+esc(INVSEARCH)+'">';

  if(!list.length){h+='<div class="empty">No items match "'+esc(INVSEARCH)+'".</div>';body.innerHTML=h;return;}

  // group by section, preserving INV_SEED section order then any extras
  var order=[]; var groups={};
  list.forEach(function(i){var s=i.section||"Other";if(!groups[s]){groups[s]=[];order.push(s);}groups[s].push(i);});
  order.forEach(function(s){
    var g=groups[s];var gowned=g.filter(function(i){return i.have;}).length;
    h+='<div class="secthd"><h2>'+esc(s)+'</h2><span class="ct">'+gowned+'/'+g.length+'</span></div><div class="card" style="padding:6px 10px">';
    h+=g.map(invMasterRow).join("");
    h+='</div>';
  });
  body.innerHTML=h;
}
function invMasterRow(i){
  return '<div class="li" style="align-items:flex-start">'
    +'<input type="checkbox" style="width:22px;height:22px;margin-top:2px" '+(i.have?"checked":"")+' onchange="invToggleHave(\''+i.id+'\')" title="Have it?">'
    +'<div class="grow" onclick="openInvItem(\''+i.id+'\')">'
      +'<div class="nm">'+esc(i.name)+invCatBadge(i.cat)+'</div>'
      +'<div class="sub" style="white-space:normal">'+invMetaLine(i)+'</div>'
      +invDetailLine(i)
    +'</div>'
    +'<div style="text-align:right;flex:0 0 auto">'
      +'<input type="text" inputmode="numeric" value="'+esc(i.qty||"")+'" placeholder="qty" style="width:54px;text-align:center;padding:6px" onchange="invSetQty(\''+i.id+'\',this.value)" onclick="event.stopPropagation()">'
    +'</div>'
  +'</div>';
}
window.invToggleHave=function(id){var i=actInv().find(function(x){return x.id===id;});if(!i)return;i.have=!i.have;touch(i);save();
  if(typeof logEvent==="function")logEvent((i.have?"Marked owned: ":"Marked not owned: ")+i.name,"inventory");
  if(INVVIEW==="master")invRenderMaster();else invRenderJob();};
window.invSetQty=function(id,v){var i=actInv().find(function(x){return x.id===id;});if(!i)return;i.qty=(v||"").trim();touch(i);save();};

/* ---------- VEHICLES (Phase 3 asset register) — one place for every driveable asset ----------
   Surfaces BOTH homes of the clock-in fleet so "where's my truck's info" is never ambiguous:
     • inventory cat:"vehicle" items — editable here (tap → openInvItem), with plate / owner / personal
     • registry company trucks (js/32 registry[org].vehicles) — READ-ONLY (their authz stays admin-only,
       enforced server-side); owner/admin gets a "Manage in Admin ›" deep-link, nothing editable here. */
function invRenderVehicles(){
  var body=document.getElementById("inv_body"); if(!body)return;
  var invVeh=actInv().filter(function(i){return (i.cat||"")==="vehicle";});
  var reg=(typeof orgVehicles==="function")?orgVehicles().filter(function(v){return v&&!v.deleted;}):[];
  var canAdmin=(typeof canManageVehicles==="function")&&canManageVehicles();

  var h='<div class="secthd"><h2>🚚 Vehicles</h2><span class="ct">'+(invVeh.length+reg.length)+'</span></div>';
  h+='<p class="muted" style="margin:0 4px 8px;font-size:13px">Every driveable asset in one place — <b>inventory vehicles</b> (add/edit here) and the <b>company trucks</b> managed in Admin. The <b>driver</b> picks one of these at clock-in.</p>';
  h+='<button class="btn ghost" style="width:calc(100% - 8px);margin:0 4px 10px" onclick="tcAddMyVehicle(false)">🚗 ＋ Add my vehicle (for clock-in)</button>';

  h+='<div class="secthd"><h2>Inventory vehicles</h2><span class="ct">'+invVeh.length+'</span></div>';
  if(!invVeh.length)h+='<div class="empty" style="margin:0 4px">No inventory vehicles yet. Tap ＋ above to add yours (plate, personal/company, clock-in).</div>';
  else h+='<div class="card" style="padding:6px 10px">'+invVeh.map(invVehicleRow).join("")+'</div>';

  // owner-tagged registry trucks (Rj's F-150) are personal — show them as the owner's, NOT under company
  var regOwned=reg.filter(function(v){return v.ownerId;});
  var regCompany=reg.filter(function(v){return !v.ownerId;});
  if(regOwned.length){
    h+='<div class="secthd"><h2>Crew-owned trucks</h2><span class="ct">'+regOwned.length+'</span>'
      +(canAdmin?'<button class="btn ghost sm" style="margin-left:8px" onclick="navSub(\'admin\')">Manage in Admin ›</button>':'')+'</div>';
    h+='<p class="muted" style="margin:0 4px 6px;font-size:12.5px">A crew member’s own truck used for company work — mileage credits them. Owner/plate managed in Admin.</p>';
    h+='<div class="card" style="padding:6px 10px">'+regOwned.map(invRegTruckRow).join("")+'</div>';
  }
  h+='<div class="secthd"><h2>Company trucks &amp; trailers</h2><span class="ct">'+regCompany.length+'</span>'
    +(canAdmin?'<button class="btn ghost sm" style="margin-left:8px" onclick="navSub(\'admin\')">Manage in Admin ›</button>':'')+'</div>';
  if(!regCompany.length)h+='<div class="empty" style="margin:0 4px">No company-owned trucks or trailers yet.'+(canAdmin?' Add them in Admin.':'')+'</div>';
  else h+='<div class="card" style="padding:6px 10px">'+regCompany.map(invRegTruckRow).join("")+'</div>';
  h+='<p class="muted" style="margin:8px 4px;font-size:12.5px">Company trucks are managed by the owner/admin in <b>Admin</b> — shown here read-only so every vehicle + its plate is visible in one place.</p>';
  body.innerHTML=h;
}
/* an editable inventory vehicle row — personal vs company marked clearly, plate/owner/location surfaced */
function invVehicleRow(i){
  var tags='<span class="badge" style="background:'+(i.personal?"#5d4037":"#1b7f4d")+';color:#fff;margin-left:6px">'+(i.personal?"Personal":"Company")+'</span>';
  if(i.clockIn)tags+='<span class="badge" style="background:var(--soft);color:var(--muted);margin-left:4px">clock-in</span>';
  var owner=(i.personal&&i.ownerId)?invHolderName(i.ownerId):"";
  var meta=[];
  if(i.plate)meta.push('🔖 '+esc(i.plate));
  if(owner)meta.push('reimburses '+esc(owner));
  if(i.location)meta.push('📍 '+esc(i.location));
  var hn=invHolderName(i.heldBy); if(hn&&i.heldBy!==i.ownerId)meta.push('🧑 '+esc(hn));
  return '<div class="li" style="align-items:flex-start;cursor:pointer" onclick="openInvItem(\''+i.id+'\')">'
    +'<div class="grow"><div class="nm">🚗 '+esc(i.name||"Vehicle")+tags+(invStatusChip(i.status)?" "+invStatusChip(i.status):"")+'</div>'
    +'<div class="sub" style="white-space:normal">'+(meta.length?meta.join(" · "):'<span class="muted">no plate set — tap to add</span>')+'</div></div>'
    +'<div class="sub" style="flex:0 0 auto;color:var(--muted)">Edit ›</div></div>';
}
/* a READ-ONLY registry company truck/trailer row — name + plate + kind; never editable from Inventory */
function invRegTruckRow(v){
  var isTrailer=(typeof vehIsTrailer==="function")?vehIsTrailer(v):(v&&v.kind==="trailer");
  var meta=[];
  if(v.plate)meta.push('🔖 '+esc(v.plate));
  meta.push(isTrailer?"trailer · no odometer":"truck");
  // an owner-tagged truck (e.g. Rj's F-150) is that person's vehicle used for company work — badge it as theirs,
  // NOT "Company" (mileage credits the owner). Only an UNOWNED registry truck is truly company-owned.
  var _own=v.ownerId&&(typeof userName==="function")?userName(v.ownerId):"";
  return '<div class="li" style="align-items:flex-start">'
    +'<div class="grow"><div class="nm">'+(isTrailer?"🚛 ":"🚚 ")+esc(v.name||(isTrailer?"Trailer":"Truck"))
      +(_own?'<span class="badge" style="background:#5d4037;color:#fff;margin-left:6px">'+esc(_own)+"’s</span>":'<span class="badge" style="background:#1b7f4d;color:#fff;margin-left:6px">Company</span>')
      +(v.active===false?'<span class="badge" style="background:var(--soft);color:var(--muted);margin-left:4px">retired</span>':"")+'</div>'
    +'<div class="sub" style="white-space:normal">'+meta.join(" · ")+'</div></div>'
    +'<div class="sub" style="flex:0 0 auto;color:var(--muted)">read-only</div></div>';
}

/* ---------- NEEDS CLEANING (Phase 4) — everything flagged dirty, with one-tap "✓ Mark cleaned" ----------
   Auto-flagged when a job using a "dirties-with-use" item (chainsaw, mower) wraps (js/09 toggleJob →
   invAutoFlagCleaningForJob), or flagged by hand. Operational: any crew can clear an item once it's clean. */
function invRenderCleaning(){
  var body=document.getElementById("inv_body"); if(!body)return;
  var list=invNeedsCleaning();
  var h='<div class="secthd"><h2>🧽 Needs cleaning</h2><span class="ct">'+list.length+'</span></div>';
  h+='<p class="muted" style="margin:0 4px 8px;font-size:13px">Gear flagged dirty — auto-flagged when a job using a <b>dirties-with-use</b> item wraps, or flagged by hand. Clean it, then tap <b>✓ Mark cleaned</b>. Mark a tool "needs cleaning after use" on its item page.</p>';
  if(!list.length){body.innerHTML=h+'<div class="empty"><div class="big">✨</div>Nothing needs cleaning right now.</div>';return;}
  h+='<div class="card" style="padding:6px 10px">'+list.map(invCleaningRow).join("")+'</div>';
  body.innerHTML=h;
}
function invCleaningRow(i){
  var when=(i.cleanFlaggedAt&&typeof relTime==="function")?relTime(i.cleanFlaggedAt):"";
  var who=invHolderName(i.cleanFlaggedBy);
  var meta=[]; if(who)meta.push("flagged by "+esc(who)); if(when)meta.push(esc(when));
  return '<div class="li" style="align-items:flex-start">'
    +'<div class="grow" style="cursor:pointer" onclick="openInvItem(\''+i.id+'\')"><div class="nm">'+esc(i.name)+invCatBadge(i.cat)+'</div>'
    +'<div class="sub" style="white-space:normal">'+(meta.length?meta.join(" · "):"flagged for cleaning")+'</div></div>'
    +'<button class="btn acc sm" style="flex:0 0 auto" onclick="event.stopPropagation();invClearCleaning(\''+i.id+'\')">✓ Mark cleaned</button>'
  +'</div>';
}

/* ---------- BY JOB TYPE — gap report + read-only lens ---------- */
function invRenderJob(){
  var body=document.getElementById("inv_body"); if(!body)return;
  var tag=INVJOB, title=invJobTitle(tag);
  var picker='<label style="margin:0 4px">Job type</label>'
    +'<select onchange="invSetJob(this.value)" style="margin:4px 0 12px">'
    +INV_JOBS.map(function(j){return '<option value="'+j[0]+'" '+(j[0]===tag?"selected":"")+'>'+esc(j[1])+'</option>';}).join("")
    +'</select>';

  var sel=invLensItems(tag);
  var missing=sel.filter(function(i){return !i.have;});
  var have=sel.filter(function(i){return i.have;});
  var missGear=missing.filter(function(i){return !invIsMaterial(i);});
  var missMat=missing.filter(invIsMaterial);

  // ---- gap report (the actionable part) ----
  var gap='<div class="secthd"><h2>Gap report — '+esc(title)+'</h2><span class="ct">'+missing.length+' of '+sel.length+' missing</span></div>';
  if(!missing.length){
    gap+='<div class="card" style="border-left:4px solid var(--accent)"><b>✓ You have everything tagged for '+esc(title)+'.</b><div class="sub" style="white-space:normal;margin-top:4px">All '+sel.length+' items on this lens are marked owned.</div></div>';
  }else{
    gap+='<div class="card" style="border-left:4px solid var(--danger)">'
      +'<div style="font-weight:700;margin-bottom:6px">Still needed for '+esc(title)+' — '+missing.length+' item'+(missing.length===1?"":"s")+'</div>';
    if(missGear.length){gap+='<div class="sub" style="margin:8px 0 4px;font-weight:700;color:var(--ink)">Gear / tools / PPE ('+missGear.length+')</div>'+missGear.map(invGapRow).join("");}
    if(missMat.length){gap+='<div class="sub" style="margin:10px 0 4px;font-weight:700;color:var(--ink)">Materials — feed per-job cost ('+missMat.length+')</div>'+missMat.map(invGapRow).join("");}
    gap+='</div>';
  }

  // ---- full lens (read-only mirror of master status) ----
  var lens='<details class="card" style="margin-top:4px"><summary style="font-weight:800;cursor:pointer">Full lens — all '+sel.length+' items tagged for '+esc(title)+' ('+have.length+' owned)</summary>'
    +'<div class="sub" style="white-space:normal;margin:6px 0 8px">Read-only — these inherit the master\'s Have?/Qty. Mark status on the <b>Master list</b>.</div>';
  lens+=sel.map(invLensRow).join("");
  lens+='</details>';

  body.innerHTML=picker+gap+lens;
}
function invGapRow(i){
  var meta=[];
  if(invPriceKnown(i.price))meta.push(esc(i.price));
  if(invBrandKnown(i.brand))meta.push("e.g. "+esc(i.brand));
  var rental=/RENTAL/i.test(i.price||"")||/RENTAL/i.test(i.notes||"");
  return '<div class="li" style="align-items:flex-start;cursor:pointer" onclick="openInvItem(\''+i.id+'\')">'
    +'<div class="grow"><div class="nm">'+esc(i.name)+invCatBadge(i.cat)+(rental?'<span class="badge" style="background:#b8860b;color:#fff;margin-left:6px">RENTAL</span>':"")+'</div>'
    +'<div class="sub" style="white-space:normal">'+(meta.length?meta.join(" · "):'<span class="muted">price/brand n/a</span>')+'</div></div>'
    +'<button class="btn ghost sm" style="flex:0 0 auto" onclick="event.stopPropagation();invToggleHave(\''+i.id+'\')">Mark have</button>'
  +'</div>';
}
function invLensRow(i){
  return '<div class="li" style="align-items:flex-start;opacity:'+(i.have?"1":".7")+'" onclick="openInvItem(\''+i.id+'\')">'
    +'<div style="width:22px;font-size:18px;text-align:center">'+(i.have?"✅":"⬜")+'</div>'
    +'<div class="grow"><div class="nm" style="'+(i.have?"":"color:var(--muted)")+'">'+esc(i.name)+invCatBadge(i.cat)+'</div>'
    +'<div class="sub" style="white-space:normal">'+invMetaLine(i)+(i.qty?' · qty '+esc(i.qty):"")+'</div>'
    +invDetailLine(i)+'</div>'
  +'</div>';
}

/* ---------- AVAILABILITY BY DATE — what gear is committed/free on a chosen day ----------
   Reads scheduled jobs (js/09) through the shared engine (js/36): every item required by an active
   job on the date, rolled up to owned / committed / free, with over-commitments flagged loudly so
   the owner can rent, buy, or reschedule before the truck rolls. */
function invRenderAvail(){
  var body=document.getElementById("inv_body"); if(!body)return;
  var ds=INV_AVAIL_DATE||today();
  var rows=(typeof eqAvailabilityByDate==="function")?eqAvailabilityByDate(ds):[];
  var conflicts=rows.filter(function(r){return r.conflict;});

  var h='<div class="card"><label>Pick a date</label><input type="date" value="'+ds+'" onchange="invAvailDate(this.value)">'
    +'<div class="sub" style="margin-top:6px">'+DOW[dowOf(ds)]+' · '+fmtDate(ds)+' — equipment required by jobs this day</div></div>';

  h+='<div class="secthd"><h2>Committed equipment</h2><span class="ct">'+rows.length+' item'+(rows.length===1?"":"s")+'</span></div>';

  if(conflicts.length){
    h+='<div class="card" style="border-left:4px solid var(--danger)">'
      +'<div style="font-weight:700;margin-bottom:6px">⚠ '+conflicts.length+' over-committed on '+fmtDate(ds)+'</div>'
      +conflicts.map(function(r){return '<div class="sub" style="white-space:normal">'+esc(eqShortMsg(r.item,r.owned,r.committed,r.jobs))+'</div>';}).join("")
      +'</div>';
  }

  if(!rows.length){
    body.innerHTML=h+'<div class="empty"><div class="big">🗓</div>No equipment is required by any job on '+fmtDate(ds)+'. Attach gear to a job from the Schedule tab.</div>';
    return;
  }

  h+='<div class="card" style="padding:6px 10px">'+rows.map(function(r){
    var i=r.item, nm=i?i.name:"(removed item)";
    var col=r.conflict?"var(--danger)":(r.free<=0?"var(--muted)":"var(--accent)");
    return '<div class="li" style="align-items:flex-start'+(r.conflict?";background:var(--danger-soft);border-radius:8px":"")+'">'
      +'<div class="grow"><div class="nm">'+esc(nm)+(i?invCatBadge(i.cat):"")+'</div>'
      +'<div class="sub" style="white-space:normal">'+r.jobs.map(function(x){return esc(x.job.title||"Job")+" ×"+x.qty;}).join(" · ")+'</div></div>'
      +'<div style="text-align:right;flex:0 0 auto;min-width:64px">'
        +'<div style="font-weight:700;color:'+col+'">'+r.committed+"/"+r.owned+'</div>'
        +'<div class="sub">'+(r.conflict?("short "+(r.committed-r.owned)):(r.free+" free"))+'</div>'
      +'</div></div>';
  }).join("")+'</div>';

  body.innerHTML=h;
}

/* ---------- add / edit an item (also how a Jamieson master gets built by hand) ---------- */
window.openInvItem=function(id){
  var isNew=!id;
  var i=isNew?{id:"inv-c-"+uid(),cat:"tool",have:false,qty:"",tags:[],section:""}:actInv().find(function(x){return x.id===id;});
  if(!i)return;
  var seeded=INV_SEED.some(function(s){return s.id===i.id;});
  var tagBoxes=INV_JOBS.concat([["all","Every job (all)"]]).map(function(j){
    var on=(i.tags||[]).indexOf(j[0])>=0;
    return '<label style="display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:600;background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:5px 8px;margin:0">'
      +'<input type="checkbox" class="inv_tag" value="'+j[0]+'" '+(on?"checked":"")+' style="width:auto">'+esc(j[1])+'</label>';
  }).join(" ");
  var isVeh=(i.cat||"")==="vehicle";
  var members=(typeof schedMembers==="function")?schedMembers():[];
  var heldByOpts='<option value="">— nobody / shared</option>'+members.map(function(u){
    return '<option value="'+esc(u.id)+'"'+((i.heldBy||"")===u.id?" selected":"")+'>'+esc(u.username||"Crew")+'</option>';}).join("");
  var statusOpts=INV_STATUSES.map(function(s){
    return '<option value="'+esc(s[0])+'"'+((i.status||"")===s[0]?" selected":"")+'>'+esc(s[1])+'</option>';}).join("");
  modal(isNew?"Add inventory item":"Inventory item",''
    +'<label>Item</label><input id="iv_name" value="'+esc(i.name||"")+'" placeholder="e.g. Surface cleaner attachment">'
    +'<div class="row" style="gap:8px"><div class="grow"><label>Category</label><select id="iv_cat">'
      +INV_CATS.map(function(c){return '<option '+((i.cat||"tool")===c?"selected":"")+'>'+c+'</option>';}).join("")
    +'</select></div><div class="grow"><label>Qty</label><input id="iv_qty" value="'+esc(i.qty||"")+'" placeholder="e.g. 2"></div></div>'
    +'<div class="toggle"><input type="checkbox" id="iv_have" '+(i.have?"checked":"")+'><label style="margin:0">Have it (owned)</label></div>'
    // CLEANING (Phase 4) — mark gear that needs cleaning after each use (auto-flags on job wrap).
    +'<div class="toggle"><input type="checkbox" id="iv_dirties" '+(i.dirtiesWithUse?"checked":"")+'><label style="margin:0">Needs cleaning after use — e.g. chainsaw, mower</label></div>'
    +(isNew?"":'<div class="row" style="gap:8px;margin:4px 0 2px">'
       +(i.needsCleaning
         ?'<button class="btn acc grow" onclick="invClearCleaning(\''+i.id+'\')">✓ Mark cleaned</button>'
         :'<button class="btn ghost grow" onclick="invFlagCleaning(\''+i.id+'\')">🧽 Flag needs cleaning</button>')
       +'</div>'+(i.needsCleaning?'<div class="note" style="font-size:12.5px;margin-top:2px">🧽 Currently flagged as needing cleaning.</div>':""))
    // VEHICLE UNIFICATION — flag a vehicle item as pickable at clock-in (only takes effect for cat "vehicle").
    +'<div class="toggle"><input type="checkbox" id="iv_clockin" '+(i.clockIn?"checked":"")+'><label style="margin:0">Usable at clock-in (a real vehicle crew can pick)</label></div>'
    +(i.personal&&i.ownerId?'<div class="note" style="margin-top:6px;font-size:12.5px">Personal vehicle — mileage is reimbursed to its owner.</div>':"")
    // ASSET REGISTER (Phase 3) — plate (esp. vehicles) + where it is + who has it + condition.
    +'<label>License plate'+(isVeh?"":' <span class="sub">· for vehicles</span>')+'</label><input id="iv_plate" value="'+esc(i.plate||"")+'" placeholder="e.g. LCW-4430"'+(isVeh?' autocapitalize="characters"':"")+'>'
    +'<label>Location <span class="sub">· where is it</span></label><input id="iv_location" value="'+esc(i.location||"")+'" placeholder="e.g. garage / on the trailer / in the truck">'
    +'<div class="row" style="gap:8px"><div class="grow"><label>Who has it</label><select id="iv_heldby">'+heldByOpts+'</select></div>'
      +'<div class="grow"><label>Status</label><select id="iv_status">'+statusOpts+'</select></div></div>'
    +'<label>Est. price</label><input id="iv_price" value="'+esc(i.price||"")+'" placeholder="e.g. $80–300">'
    +'<label>Brand / model (e.g.)</label><input id="iv_brand" value="'+esc(i.brand||"")+'" placeholder="e.g. BE Whirlaway 24\"">'
    +'<label>Section</label><input id="iv_section" value="'+esc(i.section||"")+'" placeholder="e.g. Wash equipment">'
    +'<label>Used-by (job tags)</label><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">'+tagBoxes+'</div>'
    +'<label>Notes</label><textarea id="iv_notes">'+esc(i.notes||"")+'</textarea>'
    +(seeded?'<div class="note" style="margin-top:8px;font-size:12.5px">This is a seeded master item. Editing Have?/Qty here is fine; edits to name/price/brand may be overwritten on the next master re-import.</div>':"")
    +'<button class="btn acc" style="margin-top:12px" onclick="saveInvItem(\''+i.id+'\','+isNew+')">Save</button>'
    +(isNew?"":'<button class="btn danger" style="margin-top:10px" onclick="delInvItem(\''+i.id+'\')">Delete</button>')
  );
};
window.saveInvItem=function(id,isNew){
  var d=D(); if(!d.inventory)d.inventory=[];
  var i=isNew?{id:id,updatedAt:now()}:d.inventory.find(function(x){return x.id===id;});
  if(!i){closeModal();return;}
  i.name=val("iv_name"); if(!i.name){alert("Give the item a name.");return;}
  i.cat=val("iv_cat"); i.qty=val("iv_qty"); i.price=val("iv_price"); i.brand=val("iv_brand");
  i.section=val("iv_section"); i.notes=val("iv_notes");
  // ASSET REGISTER (Phase 3) — additive detail fields; empty strings are fine (default absent).
  i.plate=val("iv_plate"); i.location=val("iv_location"); i.heldBy=val("iv_heldby"); i.status=val("iv_status");
  i.have=(document.getElementById("iv_have")||{}).checked===true;
  i.dirtiesWithUse=(document.getElementById("iv_dirties")||{}).checked===true;   // CLEANING (Phase 4): auto-flags needsCleaning when a job using it wraps; additive
  i.clockIn=(document.getElementById("iv_clockin")||{}).checked===true;   // pickable at clock-in (used only for cat "vehicle"); additive, preserves personal/ownerId
  if(i.clockIn&&i.active===undefined)i.active=true;
  i.tags=Array.prototype.slice.call(document.querySelectorAll(".inv_tag:checked")).map(function(c){return c.value;});
  if(typeof submitGuard==="function"&&!submitGuard("saveInvItem:"+id))return;   // rapid-tap dupe guard
  touch(i); if(isNew)d.inventory.push(i);
  save(); closeModal(); render();
};
window.delInvItem=function(id){
  if(!confirm("Delete this item from the inventory master?"))return;
  var i=actInv().find(function(x){return x.id===id;}); if(!i)return;
  i.deleted=true; touch(i); save(); closeModal(); render();
};
