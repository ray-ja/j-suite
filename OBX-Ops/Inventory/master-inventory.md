# OBX Lot Solutions — Master Inventory
**This is the single source of truth.** Mark `Have?` (☐ → ☑) and fill `Qty` **here, once.** The per-job sheets in `by-job-type/` are generated, read-only lenses that inherit this status — never mark them by hand (they'd drift). After editing this file, regenerate the lenses with `build-inventory-sheets.py`.

**Columns:** `Item | Category | Have? | Qty | Est. cost | Brand/model (e.g.) | Used-by (job tags) | Notes`
**Categories:** tool · equipment · consumable · PPE · vehicle · chemical
**Consumables + chemicals** are the items that feed **per-job material cost** in the quote tool — flagged distinctly by category.
**`RENTAL`** in Notes = don't have to buy; rent per job and pass the cost through to the quote.
**Est. cost / Brand-model are rough 2026 reference examples** to size a purchase — confirm current pricing locally (Home Depot KDH, pool-supply for chemicals, etc.). Going broad on purpose: an item being in here does **not** mean buy it — the `Have?` box does that work.

**Job tags:** `junk` · `house-wash` · `roof-wash` · `driveway` · `deck` · `windows` · `gutters` · `land-clearing` · `yard` · `brush` · `storm` · `parking-lot` · `home-watch` · `all` (every job).

---

## ⚠ Tree / limb work — scope policy (binding)
**In scope:** limb removal, branch cutting, brush, and **small-tree** removal — **ground-based only, anything reachable from a 30-ft ladder or shorter.** Ray has the 30-ft ladder and a small chainsaw; bigger gear is rented per job.
**Out of scope — sub or refer (e.g., Crew Cutters, a licensed/insured tree service):** full/large tree removal, anything requiring **climbing** the tree, anything **above ~30 ft / out of ladder reach**, and heavy controlled drops. *We are not a tree-removal service.* This protects the crew, the GL policy, and the brand. Same wording lives in the cost model and the LS site service copy.

---

## Vehicle & transport

| Item | Category | Have? | Qty | Est. cost | Brand/model (e.g.) | Used-by | Notes |
|---|---|---|---|---|---|---|---|
| Pickup truck | vehicle | ☑ | __ | owned | Ford F-150 / similar | all | Primary work vehicle + light hauling |
| Utility / dump trailer | vehicle | ☐ | __ | $1,000–9,000 | Big Tex 70PI util / 7×12 dump | junk, brush, land-clearing, storm, yard | Gating buy — rent until volume steady (see Hauling doc) |
| Roll-off dumpster | equipment | ☐ | __ | $300–500/wk | Soundside Recycling (Dare) | junk, land-clearing, storm | RENTAL — pass-through; includes haul + tonnage |

## Wash equipment

| Item | Category | Have? | Qty | Est. cost | Brand/model (e.g.) | Used-by | Notes |
|---|---|---|---|---|---|---|---|
| Pressure washer (gas, ~4 GPM) | equipment | ☐ | __ | $400–1,200 | Simpson/DeWalt 4200psi (Honda GX390) | driveway, deck, parking-lot | High pressure for concrete only — never roofs/siding |
| Surface cleaner attachment | equipment | ☐ | __ | $80–300 | BE Whirlaway 24" / Simpson 15" | driveway, deck, parking-lot | Even, streak-free flat cleaning |
| Soft-wash system (12V pump + tank) | equipment | ☐ | __ | $300–1,200 | Soft Wash Systems / Everflo 12V build | house-wash, roof-wash, deck | Low-pressure chemical application — core of the wash line |
| Downstream injector + J-rod | equipment | ☐ | __ | $30–80 | General Pump / Sooke | house-wash, roof-wash, driveway, deck | Draws SH mix through the line |
| Buffer / water tank (50–100 gal) | equipment | ☐ | __ | $150–400 | Norwesco | house-wash, roof-wash | Mix + supply when spigot flow is weak |
| Pressure hose + reel (150 ft) | equipment | ☐ | __ | $150–400 | Legacy 3/8" + Titan reel | driveway, deck, parking-lot, house-wash, roof-wash | Reach without moving the rig |
| Garden hose + reel | tool | ☐ | __ | $40–120 | Flexzilla 5/8" | house-wash, roof-wash, driveway, deck, windows, parking-lot | Customer spigot supply / rinse |
| Spray gun + wand (pressure) | tool | ☐ | __ | $40–120 | General Pump | driveway, deck, parking-lot | |
| Telescoping wand | tool | ☐ | __ | $120–300 | General Pump 18 ft | house-wash, roof-wash | Reach 2nd-story siding from ground |
| Pump-up sprayer (1–2 gal) | equipment | ☐ | __ | $20–60 | Chapin / Solo | house-wash, deck, yard | Spot treatment, weed/mildew app |
| 5-gal buckets | tool | ☐ | __ | $5–8 ea | Home Depot Homer | house-wash, windows, deck, driveway | Mix / carry |
| Spray bottles | tool | ☐ | __ | $5–12 | Tolco chemical-resistant | windows, house-wash | Spot + detail |

## Ladders & access

| Item | Category | Have? | Qty | Est. cost | Brand/model (e.g.) | Used-by | Notes |
|---|---|---|---|---|---|---|---|
| Extension ladder (30 ft) | equipment | ☑ | __ | owned | Werner D1132-2 (32 ft) | roof-wash, gutters, house-wash, windows, brush, land-clearing, storm | **Owned.** Defines the tree/limb reach cap — ladder-reach only |
| Step ladder (6–8 ft) | equipment | ☑ | __ | $80–200 | Werner 8 ft fiberglass | windows, gutters, house-wash, deck | Owned (Ray has ladders) |
| Ladder stabilizer / standoff | tool | ☐ | __ | $40–80 | Werner AC78 | roof-wash, gutters, house-wash | Stand off the wall/gutter safely |
| Water-fed pole system (+ DI filter) | equipment | ☐ | __ | $300–900 | Unger HydroPower / XERO | windows, house-wash, gutters | Clean high glass from the ground — safer than ladders |
| Roof anchor / temp tie-off kit | equipment | ☐ | __ | $50–150 | Guardian | roof-wash | Pairs with the harness for roof-plane work |

## Window tools

| Item | Category | Have? | Qty | Est. cost | Brand/model (e.g.) | Used-by | Notes |
|---|---|---|---|---|---|---|---|
| Squeegee set (various sizes) | tool | ☐ | __ | $30–120 | Unger / Ettore | windows | |
| Window strip washer / scrubber | tool | ☐ | __ | $20–50 | Unger | windows | |
| Window scraper (razor) | tool | ☐ | __ | $10–25 | Ettore | windows | Paint/debris on glass |
| Extension pole (squeegee) | tool | ☐ | __ | $40–150 | Unger OptiLoc | windows | |

## Gutter tools

| Item | Category | Have? | Qty | Est. cost | Brand/model (e.g.) | Used-by | Notes |
|---|---|---|---|---|---|---|---|
| Gutter scoop / trowel | tool | ☐ | __ | $8–20 | Amerimax | gutters | |
| Telescoping gutter wand / tongs | tool | ☐ | __ | $30–80 | Gutter Sense / Orbit | gutters | Clear from ground where possible |
| Wet/dry vac | equipment | ☐ | __ | $80–250 | Ridgid 14 gal | gutters | Optional — dry-debris pickup |

## Junk / clear-out tools

| Item | Category | Have? | Qty | Est. cost | Brand/model (e.g.) | Used-by | Notes |
|---|---|---|---|---|---|---|---|
| Hand truck / dolly | tool | ☐ | __ | $40–120 | Cosco / Magna Cart | junk | |
| Appliance dolly | tool | ☐ | __ | $120–300 | Harper / Milwaukee | junk | Fridges, washers — heavy items |
| Moving straps | tool | ☐ | __ | $20–40 | Forearm Forklift | junk | Two-person lift aid |
| Moving blankets | tool | ☐ | __ | $10–25 ea | US Cargo Control | junk | Protect floors/walls on the way out |
| Box cutter / utility knife | tool | ☐ | __ | $8–20 | Milwaukee Fastback | junk | |
| Cordless drill / driver | tool | ☐ | __ | $80–250 | DeWalt 20V / Milwaukee M18 | junk, home-watch | Disassemble furniture; minor fixes |
| Pry bar | tool | ☐ | __ | $15–40 | Stanley FatMax | junk | |
| Hammer / sledgehammer | tool | ☐ | __ | $20–50 | Estwing | junk | Break down bulky items |
| Hand tool set (wrenches/screwdrivers) | tool | ☐ | __ | $50–200 | DeWalt / Crescent | junk, home-watch | |
| Ratchet / cargo straps | tool | ☐ | __ | $20–50 set | Keeper / SmartStraps | junk, brush, storm | Secure loads in truck/trailer |

## Yard / brush / land-clearing equipment

| Item | Category | Have? | Qty | Est. cost | Brand/model (e.g.) | Used-by | Notes |
|---|---|---|---|---|---|---|---|
| Lawn mower (self-propelled / ZT) | equipment | ☐ | __ | push $300–700 · ZT $3,000–6,000 | Honda HRX / Toro TimeMaster · ZT Toro/Ariens | yard | Push to start; zero-turn once routes are steady |
| String trimmer / weed eater | equipment | ☐ | __ | $150–400 | Echo SRM-225 / Stihl FS 91 R | yard, brush, land-clearing | |
| Lawn edger | equipment | ☐ | __ | $130–350 | Echo PE-225 | yard | |
| Backpack leaf blower | equipment | ☐ | __ | $250–600 | Stihl BR 600 / Echo PB-580 | yard, gutters, parking-lot, storm, driveway | Cleanup + clearing finished surfaces |
| Hedge trimmer | equipment | ☐ | __ | $150–400 | Stihl HS 45 / Echo HC-152 | yard, brush | |
| Chainsaw — small (16–18") | equipment | ☑ | __ | $200–400 | Stihl MS 170/180 | brush, land-clearing, storm | **Owned.** Limb/small-tree work only — see scope policy |
| Chainsaw — larger (20"+) | equipment | ☐ | __ | $400–800 or RENTAL | Stihl MS 271 | brush, land-clearing, storm | RENTAL — only within scope (ground/ladder-reach drops) |
| Pole saw (powered) | equipment | ☐ | __ | $200–500 or RENTAL | Stihl HT 133 / rent | brush, land-clearing, storm | RENTAL-able — overhead limbs from ground, within reach cap |
| Wheelbarrow | tool | ☐ | __ | $80–200 | Jackson 6 cu ft | yard, brush, land-clearing | Move debris / mulch |
| Generator (portable) | equipment | ☐ | __ | $400–1,200 | Honda EU2200i / Champion | land-clearing, storm | Power at remote/off-grid sites |
| Brush mower (walk-behind) | equipment | ☐ | __ | RENTAL | DR / Billy Goat | land-clearing | RENTAL — heavy overgrowth |
| Stump grinder | equipment | ☐ | __ | RENTAL $85–160/day | Barreto (Home Depot KDH) | land-clearing | RENTAL |
| Wood chipper / chipper-shredder | equipment | ☐ | __ | RENTAL | Vermeer / Home Depot | brush, land-clearing, storm | RENTAL — reduces haul volume |
| Mini skid steer / compact loader | equipment | ☐ | __ | RENTAL | Bobcat MT55 / Ditch Witch | land-clearing | RENTAL — big lot clearing only |

## Hand tools — yard / brush / cleanup

| Item | Category | Have? | Qty | Est. cost | Brand/model (e.g.) | Used-by | Notes |
|---|---|---|---|---|---|---|---|
| Loppers | tool | ☐ | __ | $30–70 | Fiskars / Corona | yard, brush | |
| Pruning shears | tool | ☐ | __ | $15–50 | Felco F-2 | yard, brush | |
| Bow saw / hand saw | tool | ☐ | __ | $15–40 | Bahco | brush, storm | |
| Machete / brush axe | tool | ☐ | __ | $20–50 | Council Tool | land-clearing, brush | |
| Leaf rake | tool | ☐ | __ | $15–35 | Ames | yard, brush, storm | |
| Landscape / bow rake | tool | ☐ | __ | $25–50 | True Temper | yard, land-clearing | |
| Round-point shovel | tool | ☐ | __ | $25–45 | Razor-Back | junk, land-clearing, storm, yard | |
| Flat shovel | tool | ☐ | __ | $25–45 | Razor-Back | junk, parking-lot, storm | Scoop debris off hard surfaces |
| Pitchfork / mulch fork | tool | ☐ | __ | $30–60 | Razor-Back | yard, brush | |
| Push broom | tool | ☐ | __ | $20–45 | Libman 24" | parking-lot, driveway, deck, storm | |
| Trash grabber / picker | tool | ☐ | __ | $15–35 | Unger Nifty Nabber | parking-lot | Lot/roadside litter |
| Tape measure | tool | ☐ | __ | $15–35 | Milwaukee 25 ft | junk, land-clearing, yard | On-site quoting / sizing |
| Tarps (heavy, 10×12) | tool | ☐ | __ | $20–50 | B-Air heavy-duty | junk, brush, yard, storm, gutters | Drag debris / protect surfaces |
| Gas cans (mix + straight) | tool | ☐ | __ | $15–35 ea | No-Spill 5 gal | yard, brush, land-clearing, storm | Label clearly — wrong fuel kills 2-strokes |
| Extension cords (outdoor) | tool | ☐ | __ | $30–80 | US Wire 100 ft 12 ga | gutters, parking-lot | Electric tools / lighting |
| Flashlight / headlamp | tool | ☐ | __ | $20–60 | Coast / Energizer | home-watch, 