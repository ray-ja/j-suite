/* ---------- PLAYBOOK LIBRARY (Phase 1) ----------
   A reusable, synced library of plant + process GUIDE entries the crew guides PULL from, so we stop regenerating
   the same reference image / identify / care per job. Backed by the per-org `playbookLib` collection (js/02
   blank/load + server COLLECTIONS + migrateStore backfill). Each record: {id:"pl_"+key, kind:"plant"|"process",
   key, name, latin, category, identify, do[], dont[], when, tools[], safety[], refImage(blob id), aliases[],
   deleted, updatedAt}. Stable pl_<key> ids so a re-seed across devices dedupes via LWW instead of duplicating.
   Holds NO money → finance byte-identical. Owner/admin curate (edit text + swap the reference photo). The SAME
   pull logic is mirrored server-side (sync-server landGuideRenderHTML / pathGuideRenderHTML) so the shareable
   crew guide reuses the canonical reference too. */

/* PLAYBOOK_SEED — the 16 starter entries (12 plants + 4 processes) for coastal-NC / OBX. refImage is a blob id
   already saved in uploads/ (an AI reference photo the owner can later swap for a real one). Embedded verbatim. */
const PLAYBOOK_SEED = [
 { key:"crape_myrtle", kind:"plant", name:"Crape myrtle", latin:"Lagerstroemia indica", category:"tree",
   identify:"Multi-trunk small tree; smooth mottled tan/gray peeling bark; clusters of crinkled summer blooms (pink/white/purple).",
   do:["Thin to structure — remove crossing/inward branches, dead twigs, and base suckers"],
   dont:["Do NOT top to stubs ('crape murder')","Do not hard-prune in summer/fall — removes bloom & stresses it"],
   when:"Late winter (February) before spring bud break", tools:["Hand pruners","Loppers","Pruning saw"], safety:[], refImage:"e208c71b1e7d539e89bf1ccb.jpg" },
 { key:"oleander", kind:"plant", name:"Oleander", latin:"Nerium oleander", category:"shrub",
   identify:"Large dense evergreen shrub; long narrow leathery leaves in whorls of 3; clusters of white/pink 5-petal flowers.",
   do:["Thin & reduce oldest canes to the ground to renew","Head back tall growth after bloom"],
   dont:["ALL PARTS TOXIC — never burn or chip near people/pets; don't let clippings touch skin","Avoid removing more than ~1/3"],
   when:"After bloom (late summer) or late winter (Feb)", tools:["Loppers","Hand pruners","Thick gloves"],
   safety:["TOXIC — gloves, bag clippings, never burn/chip near people or pets"], refImage:"112f38c13c8b10c885435902.jpg" },
 { key:"yucca", kind:"plant", name:"Yucca", latin:"Yucca aloifolia", category:"shrub",
   identify:"Stiff sword-shaped spine-tipped leaves in a rosette; may have a woody cane; tall white bloom stalk.",
   do:["Remove dead/browned lower leaves & spent bloom stalks","Can cut back tall canes to reduce height (resprouts)"],
   dont:["Don't overwater — likes fast-draining sandy soil"],
   when:"Spring, or anytime for cleanup", tools:["Loppers","Hand pruners","Eye protection","Gloves"],
   safety:["Sharp spine-tipped leaves — eye protection"], refImage:"a58aa8ccf9d4aedcb0429d2d.jpg" },
 { key:"wax_myrtle", kind:"plant", name:"Wax myrtle / bayberry", latin:"Morella cerifera", category:"shrub",
   identify:"Fast multi-stem evergreen screen; narrow aromatic olive-green leaves; small waxy blue-gray berries.",
   do:["Selectively thin interior stems for airflow","Cut to laterals at varied heights for a natural shape"],
   dont:["Don't shear flat-topped — it looks unnatural; thin instead","Avoid removing >1/3 of canopy"],
   when:"Any time; late winter (Feb) preferred for bigger cuts", tools:["Loppers","Hand pruners","Pruning saw"], safety:[], refImage:"acd383bcaf78ea81c28f0c57.jpg" },
 { key:"live_oak", kind:"plant", name:"Live oak", latin:"Quercus virginiana", category:"tree",
   identify:"Large sprawling evergreen oak; small leathery oval leaves; wide low wind-firm canopy; the signature OBX shade tree.",
   do:["Remove dead/crossing limbs only","Inspect for limbs overhanging the structure"],
   dont:["Do NOT prune Apr–Jun (oak-wilt fresh-wound risk)","Check Dare County tree ordinances before any removal"],
   when:"Late winter (Feb–Mar) or after leaf hardening (Jul–Aug)", tools:["Pole saw","Pruning saw","Loppers"],
   safety:["Ordinance check before removal; big cuts near structures = pro/safety flag"], refImage:"5271e242d8132ea6672bf1ed.jpg" },
 { key:"yaupon_holly", kind:"plant", name:"Yaupon holly", latin:"Ilex vomitoria", category:"shrub",
   identify:"Dense small-leaved evergreen holly; tiny round scalloped leaves; red berries on female plants; takes shaping/topiary well.",
   do:["Shear or hand-prune to keep a rounded form","Light thin for airflow"],
   dont:["Avoid heavy shear in peak summer heat"],
   when:"Late winter for size; light shear spring–summer", tools:["Hedge shears","Hand pruners"], safety:[], refImage:"9892b2c6797db5ddf07d9fc7.jpg" },
 { key:"ligustrum", kind:"plant", name:"Ligustrum / privet", latin:"Ligustrum sinense", category:"shrub",
   identify:"Dense fast broadleaf shrub/small tree; small oval glossy leaves; fragrant white flower spikes; dark berries. INVASIVE.",
   do:["Reduce & reshape the dense mass","Thin the interior for light/air; tolerates hard renovation"],
   dont:["Bag any berried clippings — privet is invasive and spreads","Avoid heavy cuts in peak summer heat"],
   when:"Late winter (Feb–Mar); light shaping any time", tools:["Loppers","Hedge shears","Contractor bags"],
   safety:["Invasive — bag berried clippings so it doesn't spread"], refImage:"d094e700b88eef686fd4c9d7.jpg" },
 { key:"sago_palm", kind:"plant", name:"Sago palm", latin:"Cycas revoluta", category:"shrub",
   identify:"Stiff symmetrical rosette of dark glossy feather-like fronds from a shaggy trunk; NOT a true palm (a cycad).",
   do:["Cut only fully-brown/dead fronds at the base with clean shears","Retain healthy green fronds"],
   dont:["ALL PARTS TOXIC (cycasin) — highly poisonous to pets; don't chip/burn near people/animals"],
   when:"Late spring after frost risk; light cleanup any time", tools:["Hand pruners","Gloves","Eye protection"],
   safety:["TOXIC (cycad) — poisonous to pets; gloves; sharp fronds — eye protection"], refImage:"48d4e2c64904f8c2ebbb9c71.jpg" },
 { key:"windmill_palm", kind:"plant", name:"Windmill palm", latin:"Trachycarpus fortunei", category:"tree",
   identify:"Cold-hardy fan palm; fan-shaped fronds; single trunk wrapped in coarse brown fiber.",
   do:["Remove only fully-brown/dead fronds, cut close to the trunk","Leave all green & partially-green fronds"],
   dont:["Do NOT 'hurricane cut' or strip green fronds — it weakens/kills the palm"],
   when:"Anytime; late spring/summer fine for dead-frond cleanup", tools:["Pruning saw","Loppers","Gloves"], safety:[], refImage:"613fc91f0696da1c78aa0f6b.jpg" },
 { key:"fatsia", kind:"plant", name:"Japanese aralia (Fatsia)", latin:"Fatsia japonica", category:"shrub",
   identify:"Bold tropical-looking shrub; very large glossy deeply-lobed hand-shaped leaves.",
   do:["Remove oldest/tallest canes at the base to reduce height & open the clump","Takes rejuvenation well"],
   dont:["Do not shear like a hedge — forces awkward regrowth","Avoid hard renovation in peak summer heat"],
   when:"Late winter to early spring (Feb–Mar) before new flush", tools:["Loppers","Hand pruners"], safety:[], refImage:"e06a35f5269dfb13a823e7f2.jpg" },
 { key:"vitex", kind:"plant", name:"Vitex / chaste tree", latin:"Vitex agnus-castus", category:"shrub",
   identify:"Large multi-stem shrub/small tree; gray-green hand-shaped aromatic leaves; upright spikes of blue-purple summer flowers.",
   do:["Blooms on NEW wood — after bloom cut back to a manageable framework","Remove crossing/dead wood"],
   dont:["Don't cut while in bloom — sacrifices flowers & pollinators"],
   when:"Late summer after bloom (Aug–Sep) or late winter (Feb)", tools:["Loppers","Hand pruners","Pruning saw"], safety:[], refImage:"3d1524c1fbc1137c3ec7c7c6.jpg" },
 { key:"loropetalum", kind:"plant", name:"Loropetalum", latin:"Loropetalum chinense", category:"shrub",
   identify:"Evergreen shrub with burgundy/purple oval leaves; fringy pink ribbon-like flowers in spring.",
   do:["Prune right AFTER spring bloom — it blooms on old wood","Thin to keep a natural loose form"],
   dont:["Don't hard-prune now if you want next year's flowers — it blooms on old wood","Can burn in exposed salty sites"],
   when:"Right after spring bloom", tools:["Hand pruners","Loppers"], safety:[], refImage:"95c3cb1110d7324b09c5052d.jpg" },
 { key:"path_steppingstone", kind:"process", name:"Stepping-stone / rock path", latin:"", category:"hardscape",
   identify:"A single row of large pavers with marble-chip joints between and marble borders down the sides, over a base.",
   do:["Mark & excavate the curved path","Fabric + tamped base under the stones","Set stones level with even gaps, fill joints & borders with marble","Sweep the stone tops clean"],
   dont:["Don't set stones unlevel or with inconsistent gaps","Don't leave marble on the paver faces"],
   when:"Dry ground; per the job's spec sheet", tools:["Marking paint","Spade","Mattock","Tamper","4-ft level","Rubber mallet","Push broom"], safety:[], refImage:"a8fcd7b245ec3b51dd6dfb35.jpg" },
 { key:"paver_patio", kind:"process", name:"Paver patio / pad", latin:"", category:"hardscape",
   identify:"A solid field of interlocking pavers on a compacted base with edge restraint and polymeric-sand joints.",
   do:["Excavate & compact a base","Screed leveling sand","Lay pavers tight to pattern","Edge restraint, then sweep in polymeric sand & compact"],
   dont:["Don't skimp on base compaction — it causes settling","Don't wet polymeric sand before it's fully swept off the faces"],
   when:"Dry weather; per the job's spec", tools:["Plate compactor","Screed rail","Rubber mallet","Level","Paver saw","Push broom"], safety:[], refImage:"e53d3c132c401d307e2007a0.jpg" },
 { key:"french_drain", kind:"process", name:"French drain", latin:"", category:"drainage",
   identify:"A gravel-filled trench with fabric and perforated pipe that carries water away from a low/wet area.",
   do:["Trench to a steady downhill slope","Line with fabric","Bed of #57 stone, lay perforated pipe (holes down)","Backfill stone, wrap fabric, cap"],
   dont:["Don't run the pipe uphill or flat — it must fall","Don't skip the fabric wrap — the trench silts up"],
   when:"Per the job's spec; not in heavy rain", tools:["Trencher/shovel","Level/laser","Wheelbarrow","Utility knife"], safety:[], refImage:"d6b6215f67fc98fe7ac4b431.jpg" },
 { key:"downspout_move", kind:"process", name:"Downspout relocation & outlet cap", latin:"", category:"repair",
   identify:"Moving a downspout to a new spot on the same gutter run, capping the hole it left, and re-running the elbows for the new path to the wall.",
   do:["CHECK THE SLOPE FIRST — gutters fall toward the outlet. If the run still pitches to the old hole, re-hang that section to fall toward the NEW one, or it ponds at the cap.",
       "Match size and colour before buying: 5\" vs 6\" gutter, 2×3 vs 3×4 downspout.",
       "New outlet: mark it, drill a starter hole, cut with aviation snips, seal the outlet in.",
       "Build the offset dry first — A elbows go in/out from the wall, B elbows go left/right along it. Cut the connector piece to fit the ACTUAL gap, then fasten.",
       "Cap the old hole with an aluminium patch INSIDE the gutter, bedded in gutter sealant, riveted, then sealed over the perimeter and the rivet heads — water flows over the seam instead of into it.",
       "Strap the new run to the wall every 4-6 ft, and get the water away at the bottom with a splash block or extension.",
       "Fill and touch up the old strap holes in the siding."],
   dont:["Don't use plain silicone — it won't hold on aluminium in standing water. Use a butyl/tripolymer gutter & lap sealant.",
         "Don't patch the old hole from the outside only — water works into the seam.",
         "Don't cap the old outlet before checking the pitch; that's the callback.",
         "Don't reuse the old drop outlet — cutting it out usually wrecks it.",
         "Don't drop offcuts or tools off the ladder into the yard or the water."],
   when:"Dry day. Sealant needs to skin over before rain — check the forecast.",
   tools:["Ladder","Aviation snips (left & right)","Cordless drill","Rivet gun","Caulk gun","Tape measure","Marker","Level or string line"],
   safety:["Ladder set on solid, level ground and tied off if possible","Gloves — cut aluminium edges are sharp","Watch for the service drop and any wiring near the fascia"],
   refImage:"" },
 { key:"brush_removal", kind:"process", name:"Brush / tree removal & haul", latin:"", category:"cleanup",
   identify:"Cutting down and hauling off overgrowth, brush, or small trees; site left clean.",
   do:["Drop in safe sections away from structures","Cut, load, and haul to the transfer station","Rake & blow the area clean"],
   dont:["Don't remove protected/ordinance trees without clearing it with the owner first","Don't leave debris or ruts"],
   when:"Any time; check ordinances for larger trees", tools:["Chainsaw","Loppers","Pole saw","Rake","Tarps","Trailer"],
   safety:["Ordinance/HOA check on big trees; drop away from structures; PPE"], refImage:"01a299eb40e79f85b6ba34d2.jpg" },

 /* ── TEARDOWN & HAUL GUIDES (seeded 2026-09-10) — one per service the ads now sell (Ray: "make sure we
    have good crew guides for them too"). Same idempotent seed path as everything above. ── */
 { key:"deck_teardown", kind:"process", name:"Deck teardown & haul-off", latin:"", category:"teardown",
   identify:"Removing a wood deck: boards, framing, railings, stairs — down to posts cut flush or dug out per the quote.",
   do:["Walk it with the customer FIRST — confirm what stays (posts? footings? ledger?) against the quote notes",
       "Deck boards first (pry from the outside edge in), then rails/stairs, then joists, then beams/posts",
       "Cut framing into trailer-length pieces as you go — don't build a pile you have to cut twice",
       "De-nail or bend nails flat as pieces come off — a nail through a boot ends the day",
       "Load heavy framing low and flat, boards on top; strap before the road",
       "Sweep the footprint magnet-style for fasteners before leaving"],
   dont:["Don't cut the ledger or anything attached to the HOUSE unless the quote explicitly says so",
         "Don't drop sections onto irrigation, hose bibs, or AC lines hiding below",
         "Don't leave footings proud of grade if the quote says cut-flush — trip hazard with our name on it"],
   when:"Dry footing preferred; wind under ~20 mph for rail sections",
   tools:["Recip saw + demo blades","Circular saw","Pry bars / wrecking bar","Sledge","Cat's paw","Magnet sweeper","Straps & tarps"],
   safety:["Nails UP never sideways in stacked lumber","Gloves + eye pro on saws","Watch for wasp nests under boards","Two people on rail/stair sections"], refImage:"" },

 { key:"shed_demo", kind:"process", name:"Shed / outbuilding demo", latin:"", category:"teardown",
   identify:"Tear-down of a shed or small outbuilding: roof, walls, floor per quote — hauled the same visit.",
   do:["Confirm power is DEAD at the source before touching anything wired — owner's job, our check",
       "Empty it completely first (contents are a junk line, not part of demo time)",
       "Top down: roofing, then roof framing, then walls in panels, then floor",
       "Push walls INWARD when dropping panels — the debris lands where the shed was",
       "Photograph the pad/footprint after cleanup"],
   dont:["Don't cut standing walls at the base and hope — control every panel",
         "Don't demo with contents inside 'to save a trip'",
         "Don't take a structure with a meter, sub-panel, or plumbing still live"],
   when:"Any dry day; shingle tear-off is brutal in July heat — start early",
   tools:["Recip saw","Circular saw","Sledge","Pry bars","Shingle fork if shingled","Straps, tarps, magnet sweeper"],
   safety:["Roof work = two people minimum","Check for wasps/snakes before reaching into cavities","Shingles are heavy — don't overload the first trip"], refImage:"" },

 { key:"fence_removal", kind:"process", name:"Fence removal & haul", latin:"", category:"teardown",
   identify:"Pulling fence runs: panels/pickets, posts, and (if quoted) the concrete footings.",
   do:["Confirm the LINE with the customer — which runs go, which stay, where the neighbour's fence starts",
       "Panels off first, stack flat; then posts",
       "Footings quoted OUT: rock the post loose, lever with a digging bar, or chain-pull with the machine; fill holes with soil and tamp",
       "Footings quoted CUT: cut posts at grade and note it on the job"],
   dont:["Don't pull a shared/boundary fence without the customer confirming it's theirs — fence disputes are neighbour wars",
         "Don't leave open post holes — fill and tamp every one",
         "Don't yank posts blind next to irrigation or the water meter"],
   when:"Soft ground after rain makes footing pulls EASIER — heavy clay when dry",
   tools:["Recip saw","Digging bar","Post puller or farm jack","Shovel","Chain (machine pulls)","Magnet sweeper"],
   safety:["811 rules of thumb: hand-dig near meters/lines","Panels catch wind — two people on 6-ft privacy panels"], refImage:"" },

 { key:"hottub_removal", kind:"process", name:"Hot tub removal", latin:"", category:"teardown",
   identify:"Dead spa lifted out WHOLE (we don't cut tubs), cabinet and all, onto the trailer.",
   do:["Owner kills power at the BREAKER before we arrive — verify with a non-contact tester at the disconnect",
       "Drain fully if wet (pump or gravity) — water is 8 lb/gallon and a wet tub is a back injury",
       "Unbolt/unscrew cabinet corners if it slims the profile for the route out",
       "Tip on edge, walk it on furniture dollies or pipe-roll it; ramps + winch onto the trailer",
       "Photograph the empty pad and the disconnected whip"],
   dont:["Don't touch the electrical whip until the tester confirms dead — 240V",
         "Don't drag it across a deck it will gouge — dollies or sacrificial ply",
         "Don't lift wet, ever; drain first even when it costs an hour"],
   when:"Dry deck/ground for footing; two-person minimum, three for uppers",
   tools:["Non-contact voltage tester","Drain pump + hose","Furniture dollies","2-3 pipes for rolling","Ramps","Winch/come-along","Straps"],
   safety:["240V verify-dead is NON-NEGOTIABLE","Backs: tip and roll, never dead-lift","Watch fingers under the shell edge"], refImage:"" },

 { key:"interior_stripout", kind:"process", name:"Interior strip-out", latin:"", category:"teardown",
   identify:"Non-structural interior demo: cabinets, counters, flooring, trim, fixtures — surfaces only, never framing.",
   do:["Walk the scope room by room with the customer; tape off anything that STAYS",
       "Kill power to the room at the panel for anything wired (fixtures, disposals); cap water before pulling sinks/dishwashers",
       "Uppers before lowers on cabinets; counters off before base cabinets",
       "Floor protection on every exit path — ram board or ply",
       "Broom-clean finish; photograph every room done"],
   dont:["Don't open or cut ANY wall — we are strictly non-structural, and pre-1980s wall cavities can hold asbestos or live knob-and-tube",
         "Don't pull flooring in a pre-1980 house without the customer confirming it's not asbestos tile — if it's 9-inch tile, STOP and tell Ray",
         "Don't disconnect gas appliances — owner's plumber does gas, always"],
   when:"House empty of furniture in the work rooms; power/water confirmations first",
   tools:["Pry bars","Recip saw","Oscillating tool","Utility knives","Ram board","Dust masks/respirators","Contractor bags"],
   safety:["9-inch floor tile or crumbly pipe wrap in an old house = asbestos until proven otherwise — stop work, call Ray","Respirators for dusty pulls","Cap live water lines properly, not with rags"], refImage:"" },

 { key:"concrete_removal", kind:"process", name:"Concrete slab & wall removal", latin:"", category:"teardown",
   identify:"Breaking and hauling slabs, walkways, and garden walls — sledge/breaker to liftable pieces, machine loads.",
   do:["Score the free edge and work FROM it — concrete breaks toward daylight",
       "Break to pieces two people (or the machine) can actually lift — grapefruit-to-microwave size",
       "Pull wire mesh / rebar as you go, cut with the grinder, keep it in its own pile",
       "Machine does the loading; keep every load under the 3,600 lb cap — the tool's load count is the plan",
         "Rake and level the dirt left behind"],
   dont:["Don't break blind next to the house — check for conduit/plumbing runs under old slabs",
         "Don't overload 'to save a trip' — the trailer cap is the law",
         "Don't leave rebar stubs proud of the ground"],
   when:"Any dry day; hearing/eye protection non-negotiable",
   tools:["SDS-max breaker (rented) or sledges + wedges","Angle grinder + cutoff wheels (rebar)","Digging bar","Machine + bucket","Gloves rated for handling"],
   safety:["Full eye pro — chips fly (Ray took chips to the face on the pond job; glasses saved it)","Hearing protection on the breaker","Lift with the machine, not backs"], refImage:"" },

 { key:"paver_removal", kind:"process", name:"Paver patio removal", latin:"", category:"teardown",
   identify:"Lifting a paver patio/walk: pavers up whole, sand base per quote — no breaking involved.",
   do:["ASK FIRST: does the customer want any pavers kept? Good pavers have reuse value — that's goodwill or a discount lever",
       "Pop the first paver with two flat screwdrivers or a trowel; hand-lift from there",
       "Stack on the trailer like books, tight rows — loose pavers slide and crack",
       "Base per quote: scrape and haul the sand, or rake it level and leave it",
       "Edge restraint and spikes come out too — magnet sweep"],
   dont:["Don't toss pavers in loose — a shifting half-ton of loose brick is dangerous at 45 mph",
         "Don't scrape the base if the quote says leave it — the customer may be re-topping"],
   when:"Any time; wet sand is heavier — mind the load math",
   tools:["Flat screwdrivers/trowel","Gloves","Dollies","Straps","Flat shovel for base","Magnet sweeper"],
   safety:["Fingers between pavers when stacking","Strap stacked loads tight — they're the slide risk"], refImage:"" },

 { key:"boat_cutup", kind:"process", name:"Boat cut-up & disposal", latin:"", category:"teardown",
   identify:"Dead skiff/jon boat/dinghy cut to trailer pieces and hauled. TITLED (14 ft+) vessels carry paperwork steps that are NOT optional.",
   do:["PAPERWORK FIRST on any titled hull (the quote notes carry the checklist): title seen + name matches · lien line blank (NCWRC free lookup / 800-628-3773) · disposal authorization SIGNED · HIN photographed BEFORE",
       "Drain every fluid before a blade touches it: fuel siphoned to a jerry can, oil out of any motor — fuel goes back to the owner or our cans, never the dump",
       "Battery out first (core credit at the parts store); motor off (scrap value)",
       "Cut hull into liftable sections — recip saw w/ demo blades on aluminum/wood; grinder + recip on fiberglass",
       "Photograph the HIN plate AFTER the cut; remind the owner: report destroyed to NC Wildlife within 15 DAYS",
       "Fiberglass dust: full respirator + long sleeves, cut wet if possible"],
   dont:["Don't cut ANY titled hull before the authorization is signed and the lien is confirmed clear — destroying someone's loan collateral is a lawsuit",
         "Don't cut a fuel tank, EVER — drain, vent, remove whole",
         "Don't take the boat TRAILER — titled vehicle, it stays",
         "Don't grind fiberglass without a respirator; the itch is the least of it"],
   when:"Outdoors only; wind at your back on fiberglass cuts",
   tools:["Recip saw + demo blades","Angle grinder","Siphon + jerry cans","Battery wrench","Respirators (P100)","Tyvek or long sleeves","Camera for HIN shots"],
   safety:["Fuel vapor is the explosion risk — no cutting near a wet tank","P100 respirator on fiberglass, no exceptions","Cut sections are sharp — glove up for loading"], refImage:"" },

 { key:"cleanout_protocol", kind:"process", name:"Cleanout — rental / office / foreclosure", latin:"", category:"cleanup",
   identify:"Clearing a whole unit or space. THE MODEL: everything pointed at goes — we don't sort, pick through, or decide what's valuable. That rule is why these jobs are profitable (see the one we don't do: attic/estate picking).",
   do:["Walk it (or work the photo list) BEFORE loading; confirm anything that STAYS is marked or moved aside by the customer",
       "One pass per room, big furniture first, boxes/loose last",
       "Freon units (fridge/freezer/AC) set aside — they ride separate for certified recovery, per the quote's per-unit fee",
       "Photograph every room empty — the after-photos ARE the deliverable for off-island owners",
       "Broom-clean each room on the way out"],
   dont:["Don't start sorting 'keep vs toss' with the customer mid-job — that's the estate-cleanout trap; pointed at = goes, full stop",
         "Don't pocket or set aside 'good stuff' without the customer offering — everything on the trailer is theirs until it's disposal",
         "Don't take documents/safes/firearms found in a foreclosure — flag the property manager, photograph in place"],
   when:"On the customer's window — rental turnovers are clock jobs; be early",
   tools:["Dollies","Contractor bags","Shrink wrap","Straps","Broom","Camera"],
   safety:["Foreclosures: assume sharps/unknowns in bags — grip from outside, never blind-reach","Two people on mattresses/sofas on stairs"], refImage:"" },

 { key:"junk_haul", kind:"process", name:"Junk haul & dump run", latin:"", category:"cleanup",
   identify:"The bread-and-butter load: pickup, load, weigh, dump, done. The habits here are the margin.",
   do:["Photo-match on arrival: does the pile match what was quoted? Bigger = re-quote at the door BEFORE loading (price agreed before we start — that's the promise)",
       "Load dense/heavy low and forward over the axles; bulky/light on top; strap and tarp every road load",
       "Weigh every C&D load — the scale ticket is the billing record; photograph it",
       "Clock the miles at confirm — the odometer IS first truth in the pay math now",
       "Same-day dump when the load has C&D or anything that smells — never let it sit on the trailer overnight",
       "Before leaving: 'While we're here, anything else?' — the cheapest upsell in the business"],
   dont:["Don't take items on the banned list (liquids, hazmat, titled anything) 'just this once' — the list is the law",
         "Don't overload past ~3,600 lb cargo — two trips beat one ticket or one axle",
         "Don't leave without the review ask on a happy job: say it out loud, then send the link same day"],
   when:"Soundside hours; batch Hatteras/Ocracoke runs — never one small job alone past Oregon Inlet",
   tools:["Straps","Tarps","Dollies","Gloves","Magnet sweeper","Phone for scale/before-after photos"],
   safety:["Strap + tarp is DOT law, not a suggestion","Lift in pairs on anything over ~70 lb","Watch load balance — tongue-heavy beats tail-heavy"], refImage:"" }
];

/* pbLibNorm — normalize a plant name for matching: lowercase, strip everything after "/", strip non [a-z ], trim.
   Identical to landGuidePlants' key logic (js/113) so the guide's per-plant key matches a library entry. */
function pbLibNorm(name){ return String(name==null?"":name).toLowerCase().replace(/\s*\/.*/, "").replace(/[^a-z ]/g, "").trim(); }

/* pbLibSeed — insert-if-absent the 16 seed entries by KEY into the current org's playbookLib. Stable pl_<key> ids,
   never clobbers a live record (so owner edits stick). Called on boot from js/02 load() (idempotent, no-op once
   seeded). Never throws. Mirrors pbSeedTax/pbSeedPlants (js/63). */
window.pbLibSeed = function(){
  try{
    const d = (typeof D==="function") ? D() : null; if(!d) return 0;
    if(!Array.isArray(d.playbookLib)) d.playbookLib = [];
    const have = {}; d.playbookLib.forEach(function(r){ if(r&&!r.deleted&&r.key) have[r.key]=1; });
    let added = 0;
    PLAYBOOK_SEED.forEach(function(e){
      if(have[e.key]) return;
      const r = {
        id:"pl_"+e.key, kind:e.kind, key:e.key, name:e.name, latin:e.latin||"", category:e.category||"",
        identify:e.identify||"", do:(e.do||[]).slice(), dont:(e.dont||[]).slice(), when:e.when||"",
        tools:(e.tools||[]).slice(), safety:(e.safety||[]).slice(), refImage:e.refImage||"", aliases:[],
        deleted:false, updatedAt:(typeof now==="function"?now():Date.now())
      };
      if(typeof touch==="function") touch(r);
      d.playbookLib.push(r); added++;
    });
    if(added && typeof save==="function") save();
    return added;
  }catch(e){ return 0; }
};

/* live playbookLib records for the current org */
function pbLibAll(){ try{ const d=(typeof D==="function")?D():null; return (d&&Array.isArray(d.playbookLib))?d.playbookLib.filter(function(r){return r&&!r.deleted;}):[]; }catch(e){ return []; } }

/* pbLibMatch(name) — return the kind:"plant" library entry matching a plant name, else null. Matches on the
   normalized name OR the normalized key (underscores → spaces) OR any normalized alias. */
window.pbLibMatch = function(name){
  const q = pbLibNorm(name); if(!q) return null;
  const list = pbLibAll();
  for(let i=0;i<list.length;i++){
    const e = list[i]; if(!e || e.kind!=="plant") continue;
    if(pbLibNorm(e.name) === q) return e;
    if(pbLibNorm(String(e.key||"").replace(/_/g," ")) === q) return e;
    if(Array.isArray(e.aliases) && e.aliases.some(function(a){ return pbLibNorm(a)===q; })) return e;
  }
  return null;
};

/* pbLibProcess(key) — return the kind:"process" library entry with this key, else null. */
window.pbLibProcess = function(key){
  const k = String(key==null?"":key);
  const list = pbLibAll();
  for(let i=0;i<list.length;i++){ const e=list[i]; if(e && e.kind==="process" && String(e.key)===k) return e; }
  return null;
};

/* pbLibShow(key) — modal for ONE process guide, for the job-page Crew Guide buttons (js/61). The crew
   reads this standing in the driveway: identify → do → don't → safety, in that order, big enough to tap. */
window.pbLibShow = function(key){
  const e = (typeof pbLibProcess==="function") ? pbLibProcess(key) : null;
  if(!e){ if(typeof toast==="function") toast("No guide found."); return; }
  const E = (typeof esc==="function") ? esc : function(s){ return String(s==null?"":s); };
  const sec = function(title, items, color){
    if(!items || !items.length) return "";
    return '<div style="font-weight:800;margin:12px 0 4px;color:'+(color||"var(--ink)")+'">'+title+'</div>'
      + items.map(function(x){ return '<div style="display:flex;gap:8px;margin:5px 0;font-size:14px;line-height:1.5"><span style="flex:0 0 auto">'+(color==="var(--danger)"?"✋":"•")+'</span><span style="white-space:normal">'+E(x)+'</span></div>'; }).join("");
  };
  modal("📋 "+E(e.name), ''
    + (e.identify ? '<p class="sub" style="white-space:normal;margin:0 0 4px">'+E(e.identify)+'</p>' : '')
    + sec("Do it this way", e.do)
    + sec("Never", e.dont, "var(--danger)")
    + (e.safety && e.safety.length ? sec("Safety", e.safety, "#b8860b") : "")
    + (e.when ? '<div class="sub" style="white-space:normal;margin-top:10px"><b>When:</b> '+E(e.when)+'</div>' : '')
    + (e.tools && e.tools.length ? '<div class="sub" style="white-space:normal;margin-top:6px"><b>Bring:</b> '+E(e.tools.join(" · "))+'</div>' : ''));
};

/* ---------- VIEWER UI (reachable from the Playbook area — js/63 button) ---------- */
function pbLibCanEdit(){ return ((typeof isOwner==="function")&&isOwner()) || ((typeof canManageMembers==="function")&&canManageMembers()); }
function pbLibUrl(id){ return (id && typeof jsUploadUrl==="function") ? jsUploadUrl(id) : ""; }

window.pbLibView = function(){
  if(typeof pbLibSeed==="function") pbLibSeed();
  const E = (typeof esc==="function") ? esc : function(s){ return String(s==null?"":s); };
  const canEdit = pbLibCanEdit();
  const list = pbLibAll().slice().sort(function(a,b){ return String(a.name||"").localeCompare(String(b.name||"")); });
  const plants = list.filter(function(e){ return e.kind==="plant"; });
  const procs  = list.filter(function(e){ return e.kind==="process"; });
  function card(e){
    const img = pbLibUrl(e.refImage);
    let h = '<div class="li" style="align-items:flex-start;gap:10px">';
    h += img ? ('<img src="'+E(img)+'" onerror="this.style.display=\'none\'" style="width:64px;height:64px;object-fit:cover;border-radius:8px;flex:0 0 auto">') : '<div style="width:64px;height:64px;border-radius:8px;background:var(--soft);flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:24px">'+(e.kind==="process"?"🛠":"🌿")+'</div>';
    h += '<div class="grow" style="min-width:0">';
    h += '<div class="nm" style="font-size:15px;white-space:normal">'+E(e.name||e.key)+(e.latin?' <span class="sub" style="font-style:italic">'+E(e.latin)+'</span>':"")+'</div>';
    if(e.identify) h += '<div class="sub" style="white-space:normal"><b>How to spot it:</b> '+E(e.identify)+'</div>';
    if(Array.isArray(e.do)&&e.do.length) h += '<div class="sub" style="white-space:normal;color:#2f7d33"><b>DO:</b> '+E(e.do.join(" · "))+'</div>';
    if(Array.isArray(e.dont)&&e.dont.length) h += '<div class="sub" style="white-space:normal;color:var(--danger)"><b>DON\'T:</b> '+E(e.dont.join(" · "))+'</div>';
    if(e.when) h += '<div class="sub" style="white-space:normal;color:#a9760a"><b>WHEN:</b> '+E(e.when)+'</div>';
    if(Array.isArray(e.safety)&&e.safety.length) h += '<div class="sub" style="white-space:normal;color:var(--danger)">⚠ '+E(e.safety.join(" · "))+'</div>';
    if(canEdit) h += '<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" onclick="pbLibEdit(\''+E(e.id)+'\')">✏️ Edit</button><button class="btn ghost sm" onclick="pbLibSwapPhoto(\''+E(e.id)+'\')">📷 Swap reference photo</button></div>';
    h += '</div></div>';
    return h;
  }
  let h = '<div class="secthd"><h2>🌿 Guide library</h2><button class="btn ghost sm" style="margin-left:auto" onclick="TAB=\'playbook\';render()">← Playbook</button></div>';
  h += '<div class="card" style="background:var(--soft)"><div class="sub" style="white-space:normal">Reusable reference entries the crew guides PULL from — the canonical photo, how to spot it, and the do/don\'t/when for each known plant &amp; process. Known species reuse this instead of being regenerated per job.'+(canEdit?' Swap the AI reference photo for a real one anytime.':'')+'</div></div>';
  h += '<h2 class="sub" style="margin:14px 2px 6px;text-transform:uppercase;letter-spacing:.08em;font-size:12px">🌿 Plants ('+plants.length+')</h2>';
  h += plants.length ? ('<div class="card">'+plants.map(card).join("")+'</div>') : '<div class="empty">No plant entries.</div>';
  h += '<h2 class="sub" style="margin:14px 2px 6px;text-transform:uppercase;letter-spacing:.08em;font-size:12px">🛠 Processes ('+procs.length+')</h2>';
  h += procs.length ? ('<div class="card">'+procs.map(card).join("")+'</div>') : '<div class="empty">No process entries.</div>';
  view.innerHTML = h;
};

function pbLibById(id){ return pbLibAll().find(function(e){ return e && e.id===id; }) || null; }

window.pbLibEdit = function(id){
  if(!pbLibCanEdit()){ alert("Owner or admin only."); return; }
  const e = pbLibById(id); if(!e) return;
  const ta = function(v){ return (Array.isArray(v)?v.join("\n"):(v||"")); };
  modal("Edit — "+(e.name||e.key), ''+
    '<label>Name</label><input id="pbl_name" value="'+esc(e.name||"")+'" autocomplete="off">'+
    '<label>Latin</label><input id="pbl_latin" value="'+esc(e.latin||"")+'" autocomplete="off">'+
    '<label>Category</label><input id="pbl_cat" value="'+esc(e.category||"")+'" autocomplete="off">'+
    '<label>How to spot it</label><textarea id="pbl_identify" style="min-height:56px">'+esc(e.identify||"")+'</textarea>'+
    '<label>DO (one per line)</label><textarea id="pbl_do" style="min-height:56px">'+esc(ta(e.do))+'</textarea>'+
    '<label>DON\'T (one per line)</label><textarea id="pbl_dont" style="min-height:56px">'+esc(ta(e.dont))+'</textarea>'+
    '<label>WHEN</label><input id="pbl_when" value="'+esc(e.when||"")+'" autocomplete="off">'+
    '<label>Safety (one per line)</label><textarea id="pbl_safety" style="min-height:48px">'+esc(ta(e.safety))+'</textarea>'+
    '<label>Aliases (comma-separated, for matching)</label><input id="pbl_aliases" value="'+esc((e.aliases||[]).join(", "))+'" placeholder="e.g. bayberry, southern wax myrtle" autocomplete="off">'+
    '<button class="btn acc" style="margin-top:12px;width:100%" onclick="pbLibSave(\''+esc(e.id)+'\')">Save</button>');
};

window.pbLibSave = function(id){
  if(!pbLibCanEdit()){ alert("Owner or admin only."); return; }
  const e = pbLibById(id); if(!e) return;
  const lines = function(s){ return String(s||"").split("\n").map(function(x){ return x.trim(); }).filter(Boolean); };
  e.name = val("pbl_name") || e.name;
  e.latin = val("pbl_latin");
  e.category = val("pbl_cat");
  e.identify = val("pbl_identify");
  e.do = lines(val("pbl_do"));
  e.dont = lines(val("pbl_dont"));
  e.when = val("pbl_when");
  e.safety = lines(val("pbl_safety"));
  e.aliases = String(val("pbl_aliases")||"").split(",").map(function(x){ return x.trim(); }).filter(Boolean);
  e.deleted = false;
  if(typeof touch==="function") touch(e);
  if(typeof save==="function") save();
  if(S.sync&&S.sync.url&&S.sync.token&&S.sync.auto&&typeof syncNow==="function") syncNow();
  if(typeof closeModal==="function") closeModal();
  pbLibView();
};

/* swap reference photo — file picker → jsUpload → set refImage to the new blob id → touch + save. This is the
   "swap the AI reference for a real photo later" capability. */
window.pbLibSwapPhoto = function(id){
  if(!pbLibCanEdit()){ alert("Owner or admin only."); return; }
  const e = pbLibById(id); if(!e) return;
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*"; inp.style.display = "none";
  inp.onchange = function(){
    const f = inp.files && inp.files[0]; if(!f){ if(inp.parentNode) inp.parentNode.removeChild(inp); return; }
    if(typeof uploadStatus==="function") uploadStatus("uploading", 0);
    Promise.resolve(typeof jsUpload==="function" ? jsUpload(f, function(pct){ if(typeof uploadStatus==="function") uploadStatus("uploading", pct); }) : Promise.reject(new Error("upload unavailable")))
      .then(function(blobId){
        e.refImage = blobId; e.deleted = false;
        if(typeof touch==="function") touch(e);
        if(typeof save==="function") save();
        if(S.sync&&S.sync.url&&S.sync.token&&S.sync.auto&&typeof syncNow==="function") syncNow();
        if(typeof uploadStatus==="function") uploadStatus("done", 100);
        if(typeof toast==="function") toast("Reference photo updated");
        pbLibView();
      })
      .catch(function(err){ if(typeof uploadStatus==="function") uploadStatus("error", 0); alert("Photo upload failed: "+((err&&err.message)||err)); })
      .then(function(){ if(inp.parentNode) inp.parentNode.removeChild(inp); });
  };
  document.body.appendChild(inp); inp.click();
};
