/* ---------- DEEP QUOTE ENGINE (line-item builders, Junk-parity for every service) ---------- */
// Reusable per-line condition modifiers [value,label,pct]
const COND=[["norm","Normal soiling",0],["heavy","Heavy algae / mildew (+20%)",0.20],["severe","Severe / long-neglected (+40%)",0.40]];
const PROX=[["open","Open — clear drop zone",0],["near","Near a structure (+30%)",0.30],["wires","Over wires / roof (+50%)",0.50]];
const OILM=[["norm","Normal",0],["oil","Oil / rust / grease (+25%)",0.25]];
const HWSIZE=[["s","Small home",0],["m","Medium home (+20%)",0.20],["l","Large / estate (+50%)",0.50]];
const RUNDIFF=[["easy","Open attic / crawl run",0],["fin","Finished walls / hard run (+20%)",0.20]];
// Reusable job-level modifiers
const M_REPEAT={k:"repeat",label:"Contract / repeat customer — 10% off",t:"chk",pct:-0.10,tip:"Apply for anyone on a recurring plan or who's hired us before. A small loyalty cut protects the relationship — worth far more than squeezing one job."};
const M_RUSH={k:"rush",label:"Rush / next-day scheduling (+20%)",t:"chk",pct:0.20,tip:"Apply only when they need it sooner than your normal lead time and it bumps other booked work. Don't apply for normal scheduling."};
const M_WKND={k:"wknd",label:"Weekend / holiday work (+15%)",t:"chk",pct:0.15,tip:"Apply when the customer specifically needs it done on a weekend or holiday."};
const M_HAUL={k:"haul",label:"Distance to dump / disposal",t:"sel",tip:"The OBX has limited transfer sites. A far site — or hauling down to Hatteras/Ocracoke — burns real time and fuel.",opts:[["close","Dump under 10 mi",{}],["far","Dump 10–25 mi (+$120)",{flat:120}],["vfar","25 mi+ / down island (+$250)",{flat:250}]]};
const M_ACCESS={k:"access",label:"Site access",t:"sel",tip:"How close can the truck or trailer get to the work? Hand-carrying everything out adds real labor time.",opts:[["easy","Truck reaches the work",{}],["carry","Hand-carry / tight lot (+20%)",{pct:0.20}],["remote","Remote / no vehicle access (+35%)",{pct:0.35}]]};
const M_SLOPE={k:"slope",label:"Slope / soft or wet ground (+15%)",t:"chk",pct:0.15,tip:"Sandy, wet, or sloped ground slows equipment and footing — common near the sound and the dunes."};
const M_EMERG={k:"emerg",label:"Emergency / after-hours dispatch (+50%)",t:"chk",pct:0.50,tip:"Same-day or outside business hours. The industry-standard storm premium is 1.5–2× — this is the low end of that."};
const M_HAZARD={k:"hazard",label:"Hazard — near power lines or a structure (+40%)",t:"chk",pct:0.40,tip:"Anything within reach of wires, a roof, a fence, or a vehicle needs rigging and extra care. Never freehand a hazard tree."};
const M_AFTERHRS={k:"aft",label:"After-hours / weekend (+50%)",t:"chk",pct:0.50,tip:"Work outside normal business hours that the customer specifically requested."};

const DEEP={
 softwash:{label:"House soft wash",min:199,unc:{pct:0.10,reason:"final wall area is measured on site"},
  std:"Soft washing is priced by exterior WALL area in sq ft (footprint perimeter × wall height, ~10 ft per story). Low pressure plus a cleaning solution kills algae safely — never high pressure on siding. Bigger homes cost less per sq ft (sliding scale).",
  how:"<b>Estimate the wall area:</b> walk the perimeter (or pace it), multiply by ~10 ft per story. A typical 1-story ranch is ~1,500 sq ft of wall; a 2-story is ~3,000. Enter siding sq ft, add any screens/soffits, then set the conditions. <b>Read the green number, say it once, stop talking.</b>",
  script:["\"I'll soft-wash the whole exterior — that's low pressure and a solution that kills the algae at the root, so it stays clean longer than a blast with a pressure washer.\"","Walk the house; note 1 vs 2 story and how heavy the growth is.","\"For the full house, washed and treated, it's <b>[the number]</b>.\" Then stop.","If they hesitate: \"That includes the solution, the labor, and a safe low-pressure wash that won't force water behind the siding.\"","\"Want me to get you on the schedule? Annual plans save 20%.\""],
  glossary:[["Soft wash","Low-pressure spray + a cleaning solution. Kills mold/algae instead of just blasting it off, so it stays clean longer. The correct method for siding, roofs, and screens."],["Wall area","Not the floor area — the area of the outside walls. Perimeter of the house × the wall height."],["Sliding scale","The per-sq-ft rate drops as the job gets bigger, because setup time is fixed. The tool does this automatically."]],
  groups:[["Surfaces",[
   {k:"siding",label:"House siding — soft wash",kind:"area",tiers:[[1500,0.18],[3000,0.15],[1e9,0.12]],unit:"sq ft",mods:COND},
   {k:"soffit",label:"Soffits / eaves / overhangs",kind:"area",tiers:[[1e9,0.10]],unit:"sq ft"},
   {k:"screen",label:"Screened porch / lanai",kind:"area",tiers:[[1e9,0.20]],unit:"sq ft",mods:COND},
   {k:"fence",label:"Fence wash",kind:"count",rate:3,unit:"linear ft",in:"num"}
  ]]],
  mods:[{k:"stories",label:"Stories",t:"sel",tip:"More stories = more ladder/reach time and risk. Pick the tallest part of the house.",opts:[["1","1 story",{}],["2","2 stories (+25%)",{pct:0.25}],["3","3 stories (+50%)",{pct:0.50}]]},M_ACCESS,M_REPEAT,M_RUSH]},

 roofwash:{label:"Roof soft wash",min:299,unc:{pct:0.15,reason:"pitch and roof access are confirmed on site"},
  std:"ALWAYS soft-wash a roof — high pressure strips the shingle granules and voids warranties. Priced by roof surface area (sq ft). A roof is bigger than the footprint: for a typical pitch, use footprint × 1.3.",
  how:"<b>Estimate roof area:</b> take the home's footprint (length × width) and multiply by ~1.3 for a normal pitch. Enter it, set walkable vs steep, and set how heavy the black streaking is. <b>Never quote a pressure wash on a roof.</b>",
  script:["\"Those black streaks are algae (Gloeocapsa magma). We kill it with a soft wash — low pressure and a treatment — never a pressure washer, which would tear up your shingles.\"","\"For the roof, treated and rinsed, it's <b>[the number]</b>.\"","If they ask how long it lasts: \"Usually a couple of years; an annual plan keeps it from coming back and saves 20%.\""],
  glossary:[["Soft wash (roof)","The only safe way to clean a roof — low pressure + algaecide. High pressure removes the protective granules and shortens the roof's life."],["Pitch","How steep the roof is. Steeper roofs need more safety setup, so they cost more."],["Gloeocapsa magma","The algae that causes black streaks on shingles. Common in humid coastal air."]],
  groups:[["Surfaces",[
   {k:"roof",label:"Roof — soft wash",kind:"area",tiers:[[2000,0.30],[1e9,0.25]],unit:"sq ft",mods:COND}
  ]]],
  mods:[{k:"steep",label:"Roof access",t:"sel",tip:"Walkable low-pitch roofs are quick. Steep or fragile roofs need ropes/anchors and more time.",opts:[["walk","Walkable / low pitch",{}],["steep","Steep / hard access (+30%)",{pct:0.30}]]},M_REPEAT,M_RUSH]},

 pressure:{label:"Pressure wash — concrete",min:99,unc:{pct:0.10,reason:"square footage and stain severity confirmed on site"},
  std:"High pressure is fine on concrete. Priced by flat area in sq ft (length × width). Sliding scale on size. Oil and rust stains need pre-treatment and add cost.",
  how:"Measure each flat area (driveway, walkway, patio). A 2-car driveway is roughly 600 sq ft. Enter each, flag any oil/rust. <b>Set realistic expectations on old stains</b> — some won't come 100% out.",
  script:["\"I'll pressure-wash the concrete — that's safe on flat hard surfaces.\"","Point out any oil/rust: \"These spots I'll pre-treat, but very old stains may lighten rather than disappear completely — I'd rather tell you that up front.\"","\"For all the concrete, it's <b>[the number]</b>.\""],
  glossary:[["Pressure wash","High-pressure water — correct for concrete and hard flat surfaces, wrong for siding or roofs.","" ],["Pre-treatment","A cleaner applied before washing to break down oil/rust so the pressure can lift it."]],
  groups:[["Surfaces",[
   {k:"drive",label:"Driveway",kind:"area",tiers:[[600,0.30],[2000,0.22],[1e9,0.18]],unit:"sq ft",mods:OILM},
   {k:"walk",label:"Walkway / sidewalk",kind:"area",tiers:[[600,0.30],[1e9,0.22]],unit:"sq ft",mods:OILM},
   {k:"patio",label:"Patio / pool deck",kind:"area",tiers:[[600,0.30],[1e9,0.22]],unit:"sq ft",mods:OILM},
   {k:"steps",label:"Steps / entry",kind:"count",rate:25,unit:"set"}
  ]]],
  mods:[M_REPEAT,M_RUSH]},

 deck:{label:"Deck / patio wash",min:129,unc:{pct:0.10,reason:"area and wood condition confirmed on site"},
  std:"Decks are soft-washed (wood) or pressure-washed gently (composite). Priced by surface area in sq ft.",
  how:"Measure the deck (length × width). Wood gets a gentle wash so you don't furr the grain; composite can take a bit more. Flag heavy mildew on shaded decks.",
  script:["\"I'll wash the deck on the gentle setting so I don't raise the grain of the wood.\"","\"For the deck, it's <b>[the number]</b>. If you ever want it sealed, I can quote that separately.\""],
  glossary:[["Furring / raising the grain","Too much pressure on wood lifts splinters and fuzz. We wash decks gently to avoid it."]],
  groups:[["Surfaces",[
   {k:"deck",label:"Deck / patio surface",kind:"area",tiers:[[300,0.45],[1e9,0.35]],unit:"sq ft",mods:COND},
   {k:"rail",label:"Railing detail",kind:"count",rate:2,unit:"linear ft",in:"num"}
  ]]],
  mods:[M_REPEAT,M_RUSH]},

 windows:{label:"Window cleaning",min:99,unc:{pct:0.05,reason:"final pane count confirmed on site"},
  std:"Priced per pane. Interior + exterior is about 1.5× exterior-only. Upper-floor panes cost a bit more for ladder/pole time.",
  how:"Count the panes (each sash/section is a pane). Split them into ground-floor and upper-floor. Add screens and track detailing if they want the full treatment.",
  script:["\"I price windows by the pane. Do you want exterior only, or inside and out?\"","Count as you walk. \"That's [N] panes — for inside and out it's <b>[the number]</b>.\""],
  glossary:[["Pane","One section of glass. A typical double-hung window has 2 panes (top and bottom)."],["In + out","Cleaning both sides of the glass — about 1.5× the price of exterior only."]],
  groups:[["Windows",[
   {k:"ground",label:"Ground-floor pane",kind:"count",rate:9,unit:"pane",in:"num"},
   {k:"upper",label:"Upper-floor pane",kind:"count",rate:13,unit:"pane",in:"num"},
   {k:"screen",label:"Screen cleaning",kind:"count",rate:3,unit:"screen",in:"num"},
   {k:"track",label:"Track / sill detail",kind:"count",rate:4,unit:"window",in:"num"}
  ]]],
  mods:[{k:"inout",label:"Coverage",t:"sel",tip:"Exterior only is fastest. Interior + exterior means moving furniture/blinds and doing both sides.",opts:[["out","Exterior only",{}],["both","Interior + exterior (+50%)",{pct:0.50}]]},M_REPEAT,M_RUSH]},

 gutters:{label:"Gutter cleaning",min:149,unc:{pct:0.10,reason:"linear footage and debris load confirmed on site"},
  std:"Priced by linear feet of gutter (roughly the home's perimeter). 2-story homes add for ladder work. Guard installs are priced separately per foot.",
  how:"Estimate the gutter run ≈ the perimeter of the house. A typical home is 120–180 ft. Flag 2-story. Offer gutter-face brightening as an upsell while you're up there.",
  script:["\"I'll clear the gutters and downspouts and bag the debris — and flush them to make sure they drain.\"","\"For the gutters it's <b>[the number]</b>. While I'm up there I can brighten the gutter faces or add guards — want a price on either?\""],
  glossary:[["Linear feet","The total length of gutter, measured along the roofline. Roughly equals the home's perimeter."],["Gutter guard","A mesh/cover that keeps leaves out so they don't clog — priced per foot installed."]],
  groups:[["Gutters",[
   {k:"clean",label:"Gutter cleaning + flush",kind:"count",rate:1.5,unit:"linear ft",in:"num"},
   {k:"bright",label:"Gutter-face brightening",kind:"count",rate:1.5,unit:"linear ft",in:"num"},
   {k:"guard",label:"Gutter guard install",kind:"count",rate:6,unit:"linear ft",in:"num"},
   {k:"down",label:"Downspout clear (each)",kind:"count",rate:15,unit:"spout"}
  ]]],
  mods:[{k:"stories",label:"Stories",t:"sel",tip:"2-story gutters need taller ladders and more setup/safety time.",opts:[["1","1 story",{}],["2","2 stories (+30%)",{pct:0.30}]]},M_REPEAT,M_RUSH]},

 lotclear:{label:"Lot / land clearing",min:250,unc:{pct:0.15,reason:"tree count and brush density are hard to eyeball until we walk the lot"},
  std:"The trade prices land clearing three ways, often combined: by the ACRE for brush/undergrowth (light $1,200–2,500, heavy $4,000–6,000), PER TREE by height for removals, and PER INCH of diameter for stump grinding (~$4/in). Haul-off of the debris is separate.",
  how:"<b>Walk the lot with the customer.</b> Estimate the brushy acreage (a typical OBX building lot is ~0.25 acre — enter 0.25). Count trees by rough height and set how close each is to the house/wires. Add stumps (measure diameter in inches). Add haul-off loads for the debris. Set access and slope. <b>Tell them it's a ±15% range until you've walked it.</b>",
  script:["\"Let's walk the lot so I can see the trees and how thick the undergrowth is.\"","\"For the brush I price by the acre; trees by size; stumps by how big around they are. Hauling it off is separate.\"","Point at hazards: \"That one's leaning toward the house and there's a line right there — that's a careful, rigged removal, so it's priced higher for safety.\"","\"All in, this comes to about <b>[the number]</b>, give or take 15% until I get into it. Want me to lock in a date?\""],
  glossary:[["Acre","43,560 sq ft — about 90% of a football field. A typical OBX residential lot is a quarter to a third of an acre."],["Caliper / diameter","How big around a trunk or stump is, in inches, measured across. Stump grinding is priced per inch."],["Hazard tree","A tree near wires, a roof, or a structure. It must be rigged down in pieces, not felled — that's why it costs more."],["Haul-off","Loading and trucking the cut material to a disposal site. Priced per load; OBX transfer sites are limited."]],
  groups:[["Brush & undergrowth (by the acre)",[
   {k:"light",label:"Light brush / saplings",kind:"count",rate:1800,unit:"acre",in:"num",hint:"scattered small stuff under 6 in"},
   {k:"medium",label:"Medium wooded",kind:"count",rate:3500,unit:"acre",in:"num",hint:"mixed trees + dense undergrowth"},
   {k:"heavy",label:"Heavy / dense forest",kind:"count",rate:5500,unit:"acre",in:"num",hint:"mature canopy, big trees"}
  ]],["Tree removal (per tree, by height)",[
   {k:"tree_s",label:"Small tree (≤30 ft)",kind:"count",rate:350,unit:"tree",mods:PROX},
   {k:"tree_m",label:"Medium tree (30–60 ft)",kind:"count",rate:650,unit:"tree",mods:PROX},
   {k:"tree_l",label:"Large tree (60–80 ft)",kind:"count",rate:1200,unit:"tree",mods:PROX},
   {k:"tree_xl",label:"Extra-large tree (80 ft+)",kind:"count",rate:2200,unit:"tree",mods:PROX}
  ]],["Stumps & haul-off",[
   {k:"stump",label:"Stump grinding",kind:"count",rate:4,unit:"inch dia.",in:"num",hint:"enter total inches across all stumps"},
   {k:"haulpu",label:"Debris haul-off — pickup load",kind:"count",rate:175,unit:"load",hint:"2–4 cu yd"},
   {k:"hauldump",label:"Debris haul-off — dump trailer load",kind:"count",rate:300,unit:"load",hint:"5–7 cu yd"}
  ]]],
  mods:[M_ACCESS,M_SLOPE,M_HAUL,M_HAZARD,M_REPEAT,M_RUSH]},

 brush:{label:"Brush & yard-debris removal",min:95,unc:{pct:0.10,reason:"pile volume confirmed on site"},
  std:"Lighter than full land clearing — for piled brush, limbs, and yard waste. Priced by cubic yard (~$15–25/yd) or by pickup load (2–4 cu yd ≈ $150–200). Limbs that need cutting are priced by the hour.",
  how:"Eyeball the pile in cubic yards (a typical pickup bed is ~2.5 cu yd heaped) or just count pickup loads. Add hours if there are big limbs to cut down first. Set the dump distance.",
  script:["\"I can clear that brush pile — I price it by the truckload.\"","\"That's about [N] loads, so it's <b>[the number]</b>, hauled and disposed of.\"","Upsell: \"While I'm here, want me to knock down those overhanging limbs too?\""],
  glossary:[["Cubic yard","A box 3 ft × 3 ft × 3 ft. A heaped pickup bed holds about 2.5 of them."],["Pickup load","One full-size truck bed, roughly 2–4 cubic yards of loose brush."]],
  groups:[["Brush & debris",[
   {k:"cuyd",label:"Brush / limbs",kind:"count",rate:22,unit:"cu yd",in:"num"},
   {k:"pickup",label:"Full pickup load",kind:"count",rate:175,unit:"load",hint:"2–4 cu yd"},
   {k:"mixed",label:"Mixed yard debris",kind:"count",rate:30,unit:"cu yd",in:"num"},
   {k:"bags",label:"Bagged leaves / clippings",kind:"count",rate:6,unit:"bag",in:"num"},
   {k:"cut",label:"Limb / brush cutting labor",kind:"count",rate:75,unit:"hour",in:"num"}
  ]]],
  mods:[M_ACCESS,M_HAUL,M_WKND,M_REPEAT,M_RUSH]},

 storm:{label:"Storm cleanup / emergency",min:200,unc:{pct:0.20,reason:"storm scope almost always changes once the crew is on site"},
  std:"Priced by crew hours + equipment hours + debris haul. Crew labor runs $50–100/person-hour; chipper $100–150/hr. After-hours or same-day storm work carries the industry-standard 1.5–2× emergency premium. Hazard trees (on wires/structures) cost more for rigging.",
  how:"Estimate person-hours (crew size × hours), add equipment hours (chainsaw, chipper, skid-steer), and debris haul loads. Flag emergency/after-hours and any hazard near wires or a structure. <b>This is a ±20% range</b> — storm jobs grow once you're in them; say that clearly.",
  script:["\"I can get a crew out and clear this. Storm work is priced by crew time plus equipment plus hauling — and because it's [today / after hours] there's an emergency rate.\"","On hazards: \"That trunk is on the power line — I won't touch that until the utility de-energizes it, for everyone's safety.\"","\"My estimate is about <b>[the number]</b>, give or take 20% — storm jobs almost always uncover more once we start. I'll keep you posted before doing anything beyond this.\""],
  glossary:[["Person-hour","One worker for one hour. A 3-person crew for 4 hours = 12 person-hours."],["Emergency premium","The 1.5–2× rate for same-day or after-hours work — standard across the trade for storm response."],["Hazard / rigging","Cutting a tree down in controlled pieces with ropes because it's on a structure or wire. Slower and far more skilled than felling."],["Chipper","A machine that grinds limbs into chips so the debris hauls in a fraction of the volume."]],
  groups:[["Crew & equipment (by the hour)",[
   {k:"crew",label:"Crew labor",kind:"count",rate:65,unit:"person-hr",in:"num"},
   {k:"saw",label:"Chainsaw operator",kind:"count",rate:85,unit:"hour",in:"num"},
   {k:"chip",label:"Chipper",kind:"count",rate:125,unit:"hour",in:"num"},
   {k:"skid",label:"Skid-steer / loader",kind:"count",rate:150,unit:"hour",in:"num"}
  ]],["Trees down & debris",[
   {k:"tree_s",label:"Fallen tree — small (≤30 ft)",kind:"count",rate:350,unit:"tree",mods:PROX},
   {k:"tree_m",label:"Fallen tree — medium (30–60 ft)",kind:"count",rate:650,unit:"tree",mods:PROX},
   {k:"tree_l",label:"Fallen tree — large (60–80 ft)",kind:"count",rate:1200,unit:"tree",mods:PROX},
   {k:"haul",label:"Debris haul",kind:"count",rate:200,unit:"dump load",hint:"2–4 cu yd"},
   {k:"tarp",label:"Emergency tarp / cover",kind:"count",rate:120,unit:"each"}
  ]]],
  mods:[M_EMERG,M_HAZARD,M_ACCESS,M_HAUL]},

 parking:{label:"Parking-lot cleanup",min:79,unc:{pct:0.10,reason:"space count confirmed from satellite or on site"},
  std:"Priced per parking space (use the Map tool to count from satellite). Recurring routes are discounted per service because setup is amortized.",
  how:"Count the spaces (the Map tool estimates from satellite). Pick blow/pickup vs a full pressure wash per space. Set the frequency — recurring routes get a per-visit discount.",
  script:["\"I price lot cleanup by the space. For [N] spaces, one-time, it's <b>[the number]</b>.\"","\"If you put it on a weekly route it drops to [recurring number] per visit and your lot always looks sharp for guests.\""],
  glossary:[["Per space","The standard unit for lot work. Counting spaces is more consistent than guessing square footage."],["Route discount","Recurring visits cost less each because the drive time and setup are spread across many visits."]],
  groups:[["Per space",[
   {k:"blow",label:"Blow + debris pickup",kind:"count",rate:3,unit:"space",in:"num"},
   {k:"wash",label:"Pressure-wash space",kind:"count",rate:6,unit:"space",in:"num"},
   {k:"gum",label:"Gum / stain spot",kind:"count",rate:5,unit:"spot",in:"num"},
   {k:"cans",label:"Empty trash receptacle",kind:"count",rate:4,unit:"can",in:"num"}
  ]]],
  mods:[{k:"freq",label:"Frequency",t:"sel",tip:"Recurring routes are cheaper per visit because drive time and setup are spread out.",opts:[["one","One-time",{}],["weekly","Weekly route (−20%)",{pct:-0.20}],["daily","Daily route (−30%)",{pct:-0.30}]]}]},

 housewatch:{label:"House-watch (per visit)",min:50,unc:{pct:0,reason:""},
  std:"Recurring property checks for absentee owners — a photo report every visit. Priced per visit by home size and frequency. Bill per visit on the chosen cadence.",
  how:"Pick the visit and set the home size on it. Add pre/post-storm checks, errands, or a pool look as needed. Set the frequency — more frequent plans cost a little less per visit. <b>This is a per-visit price, not a one-time total.</b>",
  script:["\"I'll check the home inside and out and send you a photo report every visit, so you always know it's fine.\"","\"For a [size] home on a [frequency] plan, it's <b>[the number] per visit</b>.\"","\"I also do pre- and post-storm checks — important for your insurance — and can meet vendors or run errands while I'm there.\""],
  glossary:[["Home-watch","Scheduled inspections of a home you don't live in — checking for leaks, pests, storm/break-in damage — with a photo report each time."],["Per visit","The price is for each visit. A monthly plan bills this amount once a month."]],
  groups:[["Visit & add-ons",[
   {k:"visit",label:"Interior + exterior check",kind:"count",rate:50,unit:"visit",mods:HWSIZE},
   {k:"storm",label:"Pre / post-storm check",kind:"count",rate:75,unit:"visit"},
   {k:"errand",label:"Vendor meet / errand",kind:"count",rate:35,unit:"visit"},
   {k:"pool",label:"Pool / spa look",kind:"count",rate:15,unit:"visit"}
  ]]],
  mods:[{k:"freq",label:"Frequency",t:"sel",tip:"More frequent plans cost a little less per visit — they're more efficient to route.",opts:[["monthly","Monthly",{}],["bi","Bi-weekly (−10%)",{pct:-0.10}],["weekly","Weekly (−20%)",{pct:-0.20}]]}]},

 lock:{label:"Smart lock(s)",min:149,unc:{pct:0.05,reason:"door condition and wifi at the door confirmed on site"},
  std:"Price = hardware + install labor per door + options. Wi-Fi locks need solid wifi AT the door — if it's weak, budget a mesh node or the lock will keep dropping (the #1 callback).",
  how:"Pick the lock type per door and the count. If wifi is weak at the door, add a mesh node — don't skip it. Add a hub for Z-Wave/Zigbee or for many doors, and code programming for rentals.",
  script:["\"For a rental, a Wi-Fi keypad deadbolt with auto guest codes is the move — no more meeting guests with a key.\"","Check the signal: \"Your wifi's weak out here at the door — I'd add a small mesh point, otherwise the lock drops offline and that's the #1 thing people call me back about.\"","\"Installed and set up, it's <b>[the number]</b>.\""],
  glossary:[["Deadbolt vs retrofit","A full deadbolt replaces the lock; a retrofit (like August) mounts inside and keeps your existing key. Retrofits are quick but rely on the old hardware."],["Z-Wave / Zigbee","Low-power smart-home radios. Need a hub. Useful for many devices or where wifi is poor."],["Mesh node","A small wifi extender placed near the door so the lock has a reliable signal."],["Guest codes","Temporary PINs that auto-expire at checkout — set per booking for rentals."]],
  groups:[["Locks (per door)",[
   {k:"wifi",label:"Wi-Fi deadbolt (Yale/Schlage)",kind:"count",rate:409,unit:"door",hint:"hardware + install"},
   {k:"retro",label:"Retrofit (August — keeps key)",kind:"count",rate:329,unit:"door"},
   {k:"budget",label:"Budget keypad (Ultraloq/Wyze)",kind:"count",rate:289,unit:"door"},
   {k:"supplied",label:"Customer-supplied (install only)",kind:"count",rate:149,unit:"door"}
  ]],["Options",[
   {k:"mesh",label:"Mesh node at the door (weak-wifi fix)",kind:"count",rate:149,unit:"each"},
   {k:"hub",label:"Z-Wave / Zigbee hub",kind:"count",rate:149,unit:"each"},
   {k:"code",label:"Guest / PMS code programming",kind:"count",rate:39,unit:"lock"}
  ]]],
  mods:[M_RUSH,M_AFTERHRS]},

 camera:{label:"PoE camera system",min:200,unc:{pct:0.10,reason:"cable-run difficulty confirmed on site"},
  std:"Wired PoE cameras record to an NVR with no monthly fee. Each camera needs a Cat6 run; runs through finished walls or to a second story cost more. Price = NVR + per-camera + cable runs.",
  how:"Add one NVR per system, then a camera per location. Budget an extra run charge for any camera that's far or behind finished walls. Set run difficulty for the whole job.",
  script:["\"I run wired PoE cameras to a recorder here on site — no monthly cloud fee, and you own all your footage.\"","\"For [N] cameras with the recorder, installed and tested, it's <b>[the number]</b>.\"","\"Four or more cameras is where wired really beats wifi cams on reliability.\""],
  glossary:[["PoE","Power over Ethernet — one Cat6 cable carries both power and data to each camera. Clean and reliable."],["NVR","Network Video Recorder — the box that stores footage locally. No subscription, unlike cloud cameras."],["Cable run","Pulling a Cat6 wire from the NVR to each camera. Long runs or finished walls take more time."]],
  groups:[["System",[
   {k:"nvr",label:"NVR + system setup",kind:"count",rate:430,unit:"system"},
   {k:"cam",label:"PoE camera (supplied & installed)",kind:"count",rate:300,unit:"camera"},
   {k:"door",label:"PoE doorbell camera",kind:"count",rate:320,unit:"each"},
   {k:"run",label:"Extra-long / 2-story cable run",kind:"count",rate:89,unit:"run"},
   {k:"mon",label:"Viewing monitor",kind:"count",rate:180,unit:"each"}
  ]]],
  mods:[{k:"run",label:"Cable-run difficulty",t:"sel",tip:"Open attics/crawlspaces are quick to run. Finished walls or a slab mean fishing wire — much slower.",opts:[["easy","Open attic / crawl",{}],["fin","Finished walls / hard runs (+20%)",{pct:0.20}]]},M_RUSH,M_AFTERHRS]},

 network:{label:"Networking / WiFi",min:199,unc:{pct:0.10,reason:"coverage needs confirmed after a walk-through"},
  std:"Coverage that keeps locks, cameras, and Starlink reliable. Price = base gateway config + access points + Cat6 data drops + optional design/documentation.",
  how:"Start with the base config, then add an access point per ~1,500 sq ft or dead zone, plus any hard-wired data drops. Add design+documentation for rentals/PMs who need it handed off cleanly.",
  script:["\"Most 'my smart lock keeps dropping' problems are really wifi problems. I'll put in coverage that actually reaches every door.\"","\"For your square footage I'd run [N] access points — installed and configured it's <b>[the number]</b>.\""],
  glossary:[["Access point (AP)","A device that broadcasts wifi. Big or thick-walled homes need several for full coverage."],["Data drop","A hard-wired Cat6 jack — rock-solid for TVs, offices, and APs."],["Mesh vs wired AP","Mesh APs talk wirelessly (easy); wired APs are more reliable for bigger homes."]],
  groups:[["Network",[
   {k:"base",label:"Router / gateway + base config",kind:"count",rate:249,unit:"system"},
   {k:"ap",label:"WiFi access point (UniFi) installed",kind:"count",rate:279,unit:"AP"},
   {k:"drop",label:"Cat6 data drop",kind:"count",rate:89,unit:"drop"},
   {k:"switch",label:"PoE switch",kind:"count",rate:179,unit:"each"},
   {k:"design",label:"Network design + documentation",kind:"count",rate:149,unit:"each"}
  ]]],
  mods:[M_RUSH,M_AFTERHRS]},

 starlink:{label:"Starlink install",min:299,unc:{pct:0.10,reason:"mount type and roof access confirmed on site"},
  std:"The kit is customer-supplied (~$349 from Starlink). You're pricing the mount, a clean weather-sealed cable run, and whole-home wifi. Pick ONE mount type plus any extras.",
  how:"Pick the mount that fits the sky view and roof, add cable extensions for long runs, and a mesh node if the kit's router won't cover the home. Confirm a clear view of the northern sky.",
  script:["\"Starlink gives you the internet; I make it reach every room and mount it so coastal weather won't tear it up.\"","\"You buy the kit direct (~$349); my install with the [mount] and whole-home wifi is <b>[the number]</b>.\""],
  glossary:[["Kit","The dish + router you buy from Starlink (~$349). Not included in the install price."],["Eave / pole / roof mount","Where the dish gets bolted. Driven by where the clear sky view is."],["Clear view","Starlink needs an unobstructed view of the sky to the north — trees/roofs block it."]],
  groups:[["Mount (pick one)",[
   {k:"eave",label:"Standard eave / ground mount",kind:"count",rate:299,unit:"install"},
   {k:"roof",label:"Roof pivot mount",kind:"count",rate:449,unit:"install"},
   {k:"pole",label:"Pole / mast mount",kind:"count",rate:499,unit:"install"}
  ]],["Extras",[
   {k:"ext",label:"50-ft cable extension",kind:"count",rate:59,unit:"each"},
   {k:"mesh",label:"Add mesh wifi node",kind:"count",rate:149,unit:"node"}
  ]]],
  mods:[{k:"height",label:"Height / roof access",t:"sel",tip:"A 2-story or steep roof mount needs more setup and safety time.",opts:[["1","Single story / easy",{}],["2","2-story / steep roof (+20%)",{pct:0.20}]]},M_RUSH,M_AFTERHRS]},

 labor:{label:"Tech labor",min:125,unc:{pct:0.10,reason:"actual hours confirmed as the job is scoped"},
  std:"Hourly for custom or uncatalogued work. Round to the nearest half hour. Add a trip fee for small jobs and pass through materials at cost.",
  how:"Enter tech hours (and helper hours if a second set of hands is needed). Add a trip fee for short visits and any materials cost. Flag rush or after-hours.",
  script:["\"For custom work I bill by the hour plus any parts. I'd estimate about [N] hours, so roughly <b>[the number]</b> — I'll confirm before I run over.\""],
  glossary:[["Trip / dispatch fee","A flat charge that covers showing up for a small job, so a 20-minute fix is still worth the drive."],["Materials at cost","Parts are passed through at what they cost — no markup games."]],
  groups:[["Labor & materials",[
   {k:"hr",label:"Tech labor",kind:"count",rate:125,unit:"hour",in:"num"},
   {k:"helper",label:"Helper",kind:"count",rate:65,unit:"hour",in:"num"},
   {k:"trip",label:"Trip / dispatch fee",kind:"count",rate:49,unit:"each"},
   {k:"mat",label:"Materials / parts",kind:"count",rate:1,unit:"$ entered",in:"num"}
  ]]],
  mods:[M_RUSH,M_AFTERHRS]}
};

// Source citations shown in the rate editor so the operator knows where each number came from
const DEEP_SRC={
 softwash:"OBX market benchmarking — competitor washing pricing (Market tab, 2026).",
 roofwash:"OBX market benchmarking — roof soft-wash pricing (Market tab, 2026).",
 pressure:"OBX market benchmarking — concrete pressure-wash pricing (Market tab, 2026).",
 deck:"OBX market benchmarking — deck/patio wash pricing (Market tab, 2026).",
 windows:"OBX market benchmarking — per-pane window pricing (Market tab, 2026).",
 gutters:"OBX market benchmarking — per-linear-ft gutter pricing (Market tab, 2026).",
 lotclear:"Land clearing $1,200–6,000/acre by density; trees $250–3,500 by height; stump grinding ~$2–5/in (Angi, HomeAdvisor, LawnStarter, 2025-26).",
 brush:"Yard/brush debris $15–25/cu yd; full pickup load $150–200 (HomeGuide, Yelp, 2025).",
 storm:"Storm crews $50–100/person-hr; chipper $100–150/hr; haul $75–250/load; emergency 1.5–2× premium (Angi, HomeGuide, Monster Tree, 2025-26).",
 parking:"OBX commercial lot-cleanup benchmarking (Market tab, 2026).",
 housewatch:"OBX home-watch per-visit benchmarking (Market tab, 2026).",
 lock:"Smart-lock hardware + install benchmarking (vendor pricing + Market tab, 2026).",
 camera:"PoE camera/NVR + cabling benchmarking (vendor pricing + Market tab, 2026).",
 network:"UniFi networking install benchmarking (vendor pricing + Market tab, 2026).",
 starlink:"Starlink install/mount benchmarking (Starlink + installer pricing, 2026).",
 labor:"Low-voltage tech labor rate benchmarking (regional shop rates, 2026)."
};
// Editable-rate overlay: getDeepCfg merges the researched DEEP defaults with the operator's saved tweaks (doc id "deepover").
function deepOverrides(){try{const d=D().docs.find(x=>x.id==="deepover"&&!x.deleted);if(d)return JSON.parse(d.text);}catch(e){}return {};}
function setDeepOverrides(o){let d=D().docs.find(x=>x.id==="deepover");if(d){d.text=JSON.stringify(o);d.updatedAt=now();}else D().docs.push({id:"deepover",text:JSON.stringify(o),updatedAt:now()});save();}
function getDeepCfg(key){const base=JSON.parse(JSON.stringify(DEEP[key]));const ov=(deepOverrides()||{})[key];if(!ov)return base;
  if(ov.min!=null)base.min=ov.min;
  base.groups.forEach(g=>g[1].forEach(it=>{const o=ov.items&&ov.items[it.k];if(o){if(o.rate!=null)it.rate=o.rate;if(o.tiers)it.tiers=o.tiers;}
    if(it.mods&&ov.lmods&&ov.lmods[it.k])it.mods=it.mods.map(m=>{const nv=ov.lmods[it.k][m[0]];return nv!=null?[m[0],m[1],nv]:m;});}));
  if(ov.jmods&&base.mods)base.mods=base.mods.map(md=>{const o=ov.jmods[md.k];if(o==null)return md;const m=JSON.parse(JSON.stringify(md));
    if(md.t==="chk"){if(m.pct!=null)m.pct=o;else m.flat=o;}
    else if(md.t==="sel"&&typeof o==="object")m.opts=m.opts.map(opt=>{const nv=o[opt[0]];if(nv==null)return opt;const e=Object.assign({},opt[2]||{});if(e.pct!=null)e.pct=nv;else if(e.flat!=null)e.flat=nv;return [opt[0],opt[1],e];});
    return m;});
  return base;}
function deepItem(key,ik){const cfg=getDeepCfg(key);if(!cfg)return null;for(const g of cfg.groups)for(const it of g[1])if(it.k===ik)return it;return null;}
function deepLines(key){if(!WZ.deep)WZ.deep={};if(!WZ.deep[key])WZ.deep[key]=[];return WZ.deep[key];}
function calcDeep(key){
  const cfg=getDeepCfg(key);const lines=(WZ.deep&&WZ.deep[key])||[];const mods=(WZ.deepMods&&WZ.deepMods[key])||{};
  let sub=0,fees=0,rows=[];
  lines.forEach(li=>{const it=deepItem(key,li.key);if(!it||!li.qty)return;
    let base=it.kind==="area"?tierPrice(li.qty,it.tiers):it.rate*li.qty;
    let pct=0,ml="";
    if(it.mods){const m=it.mods.find(x=>x[0]===(li.mod||it.mods[0][0]));if(m&&m[2]){pct=m[2];ml=" · "+m[1];}}
    const afterMod=base*(1+pct),fee=it.fee?it.fee*li.qty:0;
    sub+=afterMod;fees+=fee;
    rows.push({label:it.label+" ×"+(+li.qty.toFixed(2))+" "+it.unit+ml,amt:Math.round(afterMod+fee)});
  });
  let mult=1,adds=0,modRows=[];
  (cfg.mods||[]).forEach(md=>{const v=mods[md.k];
    if(md.t==="chk"){if(v){if(md.pct){mult*=(1+md.pct);modRows.push([md.label,(md.pct>0?"+":"")+Math.round(md.pct*100)+"%"]);}else if(md.flat){adds+=md.flat;modRows.push([md.label,"+"+money(md.flat)]);}}}
    else if(md.t==="sel"){const o=md.opts.find(x=>x[0]===v);if(o&&o[2]){if(o[2].pct){mult*=(1+o[2].pct);modRows.push([o[1],(o[2].pct>0?"+":"")+Math.round(o[2].pct*100)+"%"]);}else if(o[2].flat){adds+=o[2].flat;modRows.push([o[1],"+"+money(o[2].flat)]);}}}
  });
  let total=sub*mult+fees+adds;
  if(sub<=0&&fees<=0)total=0;else total=Math.max(cfg.min,rnd5(total));
  const unc=cfg.unc&&cfg.unc.pct?Math.round(total*cfg.unc.pct/5)*5:0;
  return {sub:Math.round(sub),fees:Math.round(fees),rows:rows,modRows:modRows,total:total,unc:unc};
}
function deepBreakHTML(c){let h=c.rows.length?c.rows.map(r=>`${esc(r.label)}: <b>${money(r.amt)}</b>`).join("<br>"):'<span class="muted">No items yet — tap + on what the job needs.</span>';
  if(c.modRows.length)h+=`<br><span class="muted">Adjustments —</span><br>`+c.modRows.map(m=>`${esc(m[0])}: <b>${m[1]}</b>`).join("<br>");
  return h;}
function deepCatalogHTML(key){const cfg=getDeepCfg(key);const L=(WZ.deep&&WZ.deep[key])||[];
  const row=it=>{const li=L.find(x=>x.key===it.k);const q=li?li.qty:0;const mod=li?li.mod:(it.mods?it.mods[0][0]:null);
    const rateTxt=it.kind==="area"?("from $"+it.tiers[0][1]+"/"+it.unit):("$"+it.rate+"/"+it.unit);
    let r=`<div style="border-bottom:1px solid var(--line);padding:8px 0"><div class="row" style="align-items:center"><div class="grow"><div class="nm" style="font-size:14px">${esc(it.label)}${it.fee?` <span class="badge" style="background:var(--soft);color:var(--muted)">+$${it.fee}</span>`:""}</div><div class="sub">${rateTxt}${it.hint?" · "+esc(it.hint):""}</div></div>`;
    if(it.in==="num"||it.kind==="area")r+=`<input type="number" inputmode="decimal" value="${q||""}" placeholder="0" style="width:84px" oninput="wizDQn('${key}','${it.k}',this.value)"></div>`;
    else r+=`<div class="row" style="gap:6px;align-items:center"><button class="btn ghost sm" style="width:40px" onclick="wizDQ('${key}','${it.k}',-1)">−</button><b style="min-width:20px;text-align:center">${q}</b><button class="btn ghost sm" style="width:40px" onclick="wizDQ('${key}','${it.k}',1)">+</button></div></div>`;
    if(q>0){const base=it.kind==="area"?tierPrice(q,it.tiers):it.rate*q;const mp=it.mods?((it.mods.find(x=>x[0]===mod)||[0,0,0])[2]||0):0;
      if(it.mods)r+=`<div style="margin-top:6px"><select onchange="wizDM('${key}','${it.k}',this.value)" style="font-size:13px">${it.mods.map(m=>`<option value="${m[0]}" ${mod===m[0]?"selected":""}>📍 ${esc(m[1])}</option>`).join("")}</select></div>`;
      r+=`<div class="sub" style="margin-top:4px">${(+q.toFixed(2))} ${esc(it.unit)} = ${money(Math.round(base*(1+mp)))}${it.fee?` · +${money(it.fee*q)}`:""}</div>`;}
    return r+`</div>`;};
  const s=(WZ.deepSearch||"").trim().toLowerCase();
  if(s){const hits=[];cfg.groups.forEach(g=>g[1].forEach(it=>{if(it.label.toLowerCase().indexOf(s)>=0||(it.hint||"").toLowerCase().indexOf(s)>=0)hits.push(it);}));
    if(!hits.length)return `<div class="card"><div class="muted">No items match “${esc(WZ.deepSearch)}”. Clear the search to browse, or add a Custom line back on the services screen.</div></div>`;
    return `<div class="card"><div class="sub" style="margin-bottom:4px">${hits.length} match${hits.length>1?"es":""}</div>`+hits.map(row).join("")+`</div>`;}
  return cfg.groups.map((g,gi)=>`<details class="card" ${gi<2?"open":""}><summary style="font-weight:800;cursor:pointer">${esc(g[0])}</summary><div style="margin-top:4px">`+g[1].map(row).join("")+`</div></details>`).join("");
}
/* Local OBX market ranges per service (typical whole-job), folded in from the quote-rehearsal
   tool. Used by marketBandHTML to show the quote against the local range. Editable benchmarks. */
const MARKET_BANDS={
 softwash:{lo:300,hi:650,label:"house soft wash"},
 roofwash:{lo:400,hi:900,label:"roof soft wash"},
 pressure:{lo:150,hi:450,label:"concrete pressure wash"},
 deck:{lo:150,hi:500,label:"deck / patio wash"},
 windows:{lo:150,hi:450,label:"window cleaning"},
 gutters:{lo:150,hi:400,label:"gutter cleaning"},
 lotclear:{lo:1500,hi:6000,label:"lot / land clearing"},
 brush:{lo:150,hi:600,label:"brush & yard debris"},
 storm:{lo:500,hi:3000,label:"storm cleanup"},
 parking:{lo:150,hi:800,label:"parking-lot cleanup"},
 housewatch:{lo:40,hi:75,label:"house-watch (per visit)"},
 junk:{lo:150,hi:800,label:"junk / cleanout (scales with volume)"},
 demo:{lo:350,hi:1000,label:"shed demolition"}
};
/* rehearsal-style band: a red(below)/green(in)/amber(above) bar with the quote marked. Self-contained inline styles. */
function marketBandHTML(price,lo,hi,label){
  if(!(hi>0))return "";
  const maxScale=Math.max(hi*1.25,price*1.1,lo*1.5,1);
  const loP=Math.min(100,lo/maxScale*100),hiP=Math.min(100,hi/maxScale*100),pP=Math.min(100,Math.max(0,price/maxScale*100));
  const status=price<lo?`<span style="color:var(--danger);font-weight:700">below the local range</span> — don't underprice the volume you saw`:price>hi?`<span style="font-weight:700">above the local range</span> — fine if access/volume justifies it`:`<span style="color:#1a7f37;font-weight:700">inside the local range</span> — firm, defensible number`;
  return `<div class="card"><div style="font-weight:800;font-size:13px;margin-bottom:4px">📊 Market check — ${esc(label)}</div>
    <div style="position:relative;height:30px;border-radius:8px;border:1px solid var(--line);overflow:hidden;background:linear-gradient(90deg,#fde2e1 0,#fde2e1 ${loP}%,#e7f4ea ${loP}%,#e7f4ea ${hiP}%,#fff3d6 ${hiP}%,#fff3d6 100%)"><div style="position:absolute;top:-3px;bottom:-3px;left:${pP}%;width:3px;background:var(--brand)" title="${money(price)}"></div></div>
    <div class="row" style="justify-content:space-between;font-size:11px;color:var(--muted);margin-top:3px"><span>${money(lo)}</span><span>local range</span><span>${money(hi)}</span></div>
    <div class="sub" style="margin-top:4px">Your ${money(price)} is ${status}.</div></div>`;
}
function wizDeepUI(key){const cfg=getDeepCfg(key);const c=calcDeep(key);const mods=(WZ.deepMods&&WZ.deepMods[key])||{};
  let h=wizHead(3,5,cfg.label);
  h+=`<details class="card"><summary style="font-weight:800;cursor:pointer">📋 How to use this (tap)</summary><div style="font-size:13px;line-height:1.6;margin-top:8px">${cfg.how}</div></details>`;
  if(cfg.script)h+=`<details class="card"><summary style="font-weight:800;cursor:pointer">💬 What to say to the customer (tap)</summary><div style="font-size:13px;line-height:1.7;margin-top:8px">${cfg.script.map((s,i)=>(i+1)+". "+s).join("<br>")}</div></details>`;
  h+=`<div class="card" style="padding:10px"><input id="dz_search" value="${esc(WZ.deepSearch||"")}" placeholder="🔎 Search items…" autocomplete="off" oninput="wizDSearch()" style="margin:0">${WZ.deepSearch?`<button class="btn ghost sm" style="margin-top:8px" onclick="WZ.deepSearch='';render()">✕ Clear search</button>`:""}</div>`;
  h+=`<div id="dz_catalog">`+deepCatalogHTML(key)+`</div>`;
  if(cfg.mods&&cfg.mods.length){h+=`<div class="card"><div style="font-weight:800;margin-bottom:6px">Job conditions <span style="cursor:help;color:var(--muted);font-weight:700" title="These adjust the whole quote. Tap the ⓘ on each to see exactly when to apply it.">ⓘ</span></div>`+cfg.mods.map(md=>{const v=mods[md.k];const tip=md.tip?` <span style="cursor:help;color:var(--accent);font-weight:700" title="${esc(md.tip)}">ⓘ</span>`:"";
    if(md.t==="chk")return `<div class="toggle"><input type="checkbox" ${v?"checked":""} onchange="wizDJobMod('${key}','${md.k}',this.checked)"><label style="margin:0">${esc(md.label)}${tip}</label></div>`;
    return `<label style="margin-top:8px">${esc(md.label)}${tip}</label><select onchange="wizDJobMod('${key}','${md.k}',this.value)" style="font-size:13px">${md.opts.map(o=>`<option value="${o[0]}" ${(v||md.opts[0][0])===o[0]?"selected":""}>${esc(o[1])}</option>`).join("")}</select>`;
  }).join("")+`</div>`;}
  h+=`<details class="card"><summary style="font-weight:800;cursor:pointer">💵 How the price is built (tap)</summary><div style="font-size:12.5px;line-height:1.6;margin-top:8px"><b>Industry standard:</b> ${cfg.std}<br><br>Each line = rate × quantity (area items use a sliding scale — bigger jobs cost less per unit). Per-item and job conditions adjust the labor.${cfg.unc&&cfg.unc.pct?` The ± range reflects real uncertainty: ${esc(cfg.unc.reason)}.`:""} Rounds to the nearest $5; ${money(cfg.min)} minimum.</div></details>`;
  if(cfg.glossary)h+=`<details class="card"><summary style="font-weight:800;cursor:pointer">📖 Plain-English glossary (tap)</summary><div style="font-size:12.5px;line-height:1.6;margin-top:8px">${cfg.glossary.map(g=>`<b>${esc(g[0])}:</b> ${esc(g[1])}`).join("<br><br>")}</div></details>`;
  h+=`<div class="card"><div style="font-weight:800;margin-bottom:6px">Itemized breakdown</div><div style="font-size:13px;line-height:1.9" id="dz_break">${deepBreakHTML(c)}</div><div style="border-top:1px solid var(--line);margin:8px 0"></div><div class="row" style="justify-content:space-between;align-items:center"><span class="sub">Estimate</span><b id="dz_total" style="font-size:20px">${money(c.total)}</b></div>${c.unc?`<div class="sub" id="dz_range">Likely range ${money(c.total-c.unc)}–${money(c.total+c.unc)}</div>`:""}</div>`;
  h+=`<div class="card" style="background:var(--accent);color:var(--accent-ink);text-align:center"><div style="font-size:13px;font-weight:700">QUOTE TO GIVE ON SITE</div><div style="font-size:32px;font-weight:800;line-height:1.1">${money(c.total)}</div>${c.unc?`<div style="font-size:12px;opacity:.9">± ${money(c.unc)} until confirmed on site</div>`:""}</div>`;
  if(MARKET_BANDS[key])h+=marketBandHTML(c.total,MARKET_BANDS[key].lo,MARKET_BANDS[key].hi,MARKET_BANDS[key].label);
  h+=`<div class="wizfoot"><div class="wf-amt"><span class="wf-lab">Quote</span><b id="dz_foot">${money(c.total)}</b></div><button class="btn ghost sm" onclick="WZ.step='pick';render()">← Back</button><button class="btn acc grow" onclick="wizAddDeep('${key}')">Add to quote</button></div>`;
  return h;
}
window.wizDQ=function(key,ik,d){const L=deepLines(key);let li=L.find(x=>x.key===ik);const it=deepItem(key,ik);if(!li&&d>0){li={key:ik,qty:0,mod:it&&it.mods?it.mods[0][0]:null};L.push(li);}if(li){li.qty=Math.max(0,(li.qty||0)+d);if(li.qty===0)WZ.deep[key]=L.filter(x=>x.key!==ik);}render();};
window.wizDQn=function(key,ik,val){const L=deepLines(key);const q=Math.max(0,parseFloat(val)||0);let li=L.find(x=>x.key===ik);const it=deepItem(key,ik);if(!li&&q>0){li={key:ik,qty:0,mod:it&&it.mods?it.mods[0][0]:null};L.push(li);}if(li){li.qty=q;if(q===0)WZ.deep[key]=L.filter(x=>x.key!==ik);}wizDLive(key);};
window.wizDLive=function(key){const c=calcDeep(key);const t=document.getElementById("dz_total");if(t)t.textContent=money(c.total);const f=document.getElementById("dz_foot");if(f)f.textContent=money(c.total);const b=document.getElementById("dz_break");if(b)b.innerHTML=deepBreakHTML(c);const r=document.getElementById("dz_range");if(r&&c.unc)r.textContent="Likely range "+money(c.total-c.unc)+"–"+money(c.total+c.unc);};
window.wizDM=function(key,ik,v){const li=(WZ.deep[key]||[]).find(x=>x.key===ik);if(li){li.mod=v;render();}};
window.wizDJobMod=function(key,mk,v){if(!WZ.deepMods)WZ.deepMods={};if(!WZ.deepMods[key])WZ.deepMods[key]={};WZ.deepMods[key][mk]=v;render();};
window.wizDSearch=function(){const e=document.getElementById("dz_search");WZ.deepSearch=e?e.value:"";const c=document.getElementById("dz_catalog");if(c)c.innerHTML=deepCatalogHTML(WZ.svc);};
window.wizAddDeep=function(key){const c=calcDeep(key),cfg=getDeepCfg(key);if(!c.rows.length){alert("Add at least one line item first.");return;}
  const notes=[];
  if(c.unc)notes.push("Estimate ±"+money(c.unc)+" — "+(cfg.unc.reason||"confirmed on site")+".");
  c.modRows.forEach(m=>notes.push(m[0]+" ("+m[1]+")."));
  var deepCost=(c.fees||0)+Math.round((c.sub||0)*CONSUMABLES_PCT); // hard cost: per-item disposal/material fees + chemical/consumable allowance (no labor; mileage added per-quote)
  WZ.items.push({name:cfg.label+" — "+c.rows.length+" line"+(c.rows.length>1?"s":""),price:c.total,cost:deepCost,notes:notes,qty:1,unit:"job",serviceId:"",breakdown:c.rows.map(r=>r.label+": "+money(r.amt))});
  if(WZ.deep)WZ.deep[key]=[];if(WZ.deepMods)WZ.deepMods[key]={};WZ.step="pick";render();
};

