# Jamieson Automation — Master Inventory

**Single source of truth.** Ray marks **Have?** and **Qty** here ONCE. The per-install-type sheets in this folder are filtered lenses that point back to these rows — don't mark status there.

**How to use:** put an `x` in the Have? box (`☑`) for things you already own; leave `☐` for gaps. Fill Qty where it matters. Strategy reads this table to generate a *"what's missing for install X"* gap report and to flow **consumable** costs into the quote tool's COGS layer.

**Category legend:** `tool` (hand/power tools) · `equipment` (test gear, cases, bigger kit) · `consumable` (used up per job — feeds per-job material cost) · `PPE` · `vehicle` · `chemical`.

**Used-by tags:** `STAR` Starlink · `NET` networking/mesh · `LOCK` smart locks · `CAM` cameras · `HOME` smart home/climate · `AV` TV & AV · `LIGHT` permanent LED lighting · `ALL` used on essentially every job.

**⚑ Consumables are the COGS feed** — every `consumable` row is a candidate per-job material line in the quote tool. Keep their unit cost current.

---

## Tools

| Item | Category | Have? | Qty | Used-by | Notes |
|---|---|:--:|:--:|---|---|
| Cordless drill/driver + impact driver | tool | ☐ |  | ALL | Core mounting tool every job |
| Drill/driver bit set (+ masonry bits) | tool | ☐ |  | ALL | OBX brick/stucco/Hardie needs masonry bits |
| Hole saw set (½"–2½") | tool | ☐ |  | STAR, CAM, NET, AV | Cable pass-throughs / exterior penetrations |
| Oscillating multi-tool | tool | ☐ |  | CAM, NET, AV | Clean cutouts, trim |
| Stud finder | tool | ☐ |  | AV, CAM, LOCK, NET | Locate studs/blocking for mounts |
| Laser level + bubble/torpedo level | tool | ☐ |  | AV, CAM, STAR | TV/camera/dish alignment |
| Fish tape / glow rods | tool | ☐ |  | NET, CAM, AV, STAR | Pulling cable in walls/attics |
| Wire strippers | tool | ☐ |  | NET, CAM, HOME | |
| RJ45 crimp tool | tool | ☐ |  | NET, CAM | Terminate ethernet ends |
| Punch-down tool (110) | tool | ☐ |  | NET, CAM | Keystone jacks / patch panels |
| Network cable tester (PoE-capable) | tool | ☐ |  | NET, CAM | Verify runs before close-up |
| Precision + standard screwdriver set | tool | ☐ |  | ALL | Locks, devices, plates |
| Nut driver set | tool | ☐ |  | LOCK, AV, STAR | |
| Tape measure | tool | ☐ |  | ALL | |
| Utility knife | tool | ☐ |  | ALL | |
| Caulk gun | tool | ☐ |  | STAR, CAM | For exterior sealant |
| Heat gun | tool | ☐ |  | NET, CAM, STAR | Heat-shrink, weatherproofing |
| Angle grinder | tool | ☐ |  | STAR | Cut/trim pole & mast mounts |
| Reciprocating saw (cordless) | tool | ☐ |  | STAR, CAM | Optional — rough penetrations |
| Multimeter | tool | ☐ |  | HOME, NET, CAM | Thermostat C-wire, PoE voltage |
| Coax/F-connector crimper | tool | ☐ |  | AV, NET | Only if reusing coax |
| Label maker / label printer | tool | ☐ |  | NET, CAM | Label cables + ports |
| Shop vac | tool | ☐ |  | ALL | Drill-dust cleanup inside homes |
| Extension ladder | tool | ☐ |  | STAR, CAM | Roof/eave access |
| Step ladder | tool | ☐ |  | AV, NET, LOCK, HOME | Interior |
| Ladder stabilizer / standoff | tool | ☐ |  | STAR, CAM | Roof-edge safety |

## Equipment

| Item | Category | Have? | Qty | Used-by | Notes |
|---|---|:--:|:--:|---|---|
| Config laptop/tablet (UniFi controller) | equipment | ☐ |  | NET, CAM | Provision network + NVR |
| WiFi analyzer (app or device) | equipment | ☐ |  | NET | Site survey, coverage check |
| Portable HDMI test monitor | equipment | ☐ |  | CAM, AV | Verify NVR/TV output on site |
| PoE injector (bench/test) | equipment | ☐ |  | CAM, NET | Power a device for testing |
| Tool bag + hard cases | equipment | ☐ |  | ALL | |
| Headlamp / work light | equipment | ☐ |  | ALL | Attics, crawlspaces |
| Extension cords / power strip | equipment | ☐ |  | ALL | |
| Portable power station / inverter | equipment | ☐ |  | ALL | Job-site power where none |
| Magnetic parts tray | equipment | ☐ |  | ALL | Don't lose lock/dish screws |

## Install hardware (BOM — billed to the job, hardware at cost)

| Item | Category | Have? | Qty | Used-by | Notes |
|---|---|:--:|:--:|---|---|
| Starlink Standard Kit | equipment | ☐ |  | STAR | ~$349; customer usually buys direct |
| Starlink roof pivot mount | equipment | ☐ |  | STAR | $35–65 |
| Starlink pole/mast mount + pipe adapter | equipment | ☐ |  | STAR | Fits 1.25–2.5" pole |
| Starlink ethernet adapter | equipment | ☐ |  | STAR, NET | ~$25, for mesh hand-off |
| Smart lock (Yale Assure 2 / Schlage Encode) | equipment | ☐ |  | LOCK | $188–300; Yale = Airbnb favorite |
| Retrofit lock (August) + keypad | equipment | ☐ |  | LOCK | Keeps existing key; +$50 keypad |
| Z-Wave/Zigbee hub | equipment | ☐ |  | LOCK, HOME | $149; multi-door scaling |
| Smart hub (Home Assistant / SmartThings) | equipment | ☐ |  | HOME | ~$199 setup |
| Mesh/UniFi access point (U6 Lite/Pro) | equipment | ☐ |  | NET | $99–199 ea |
| UniFi gateway/router (UDM/UCG) | equipment | ☐ |  | NET | Premium/commercial backbone |
| PoE switch | equipment | ☐ |  | NET, CAM | Powers APs + cameras |
| PoE camera (UniFi G5/G6 Bullet/Flex) | equipment | ☐ |  | CAM | $129 ea / $199 4K |
| NVR (UniFi / Reolink / Lorex) + hard drive | equipment | ☐ |  | CAM | Local recording, no cloud fee |
| Smart thermostat | equipment | ☐ |  | HOME | Low-voltage, no electrician |
| Smart switch/dimmer (plug-in / low-voltage only) | equipment | ☐ |  | HOME | ⚠️ line-voltage = electrician partner |
| TV wall mount (fixed/tilt/full-motion) | equipment | ☐ |  | AV | Size to TV weight |
| Soundbar / speakers / AV receiver | equipment | ☐ |  | AV | Per project |
| Permanent LED lighting track + controller | equipment | ☐ |  | LIGHT | ~$25/linear ft; controller ~$650 |
| Keystone jacks + wall plates | equipment | ☐ |  | NET, CAM | Terminations |

## Consumables ⚑ (per-job material cost → quote tool)

| Item | Category | Have? | Qty | Used-by | Notes |
|---|---|:--:|:--:|---|---|
| Cat6 cable (box/spool) | consumable | ☐ |  | NET, CAM | Sold per run (~$89/run in quotes) |
| Cat6 cable, pre-terminated (25/50/100 ft) | consumable | ☐ |  | NET, CAM | Saves time on clean runs |
| Starlink cable extension (50 / 150 ft) | consumable | ☐ |  | STAR | $59/50 ft quote line |
| RJ45 connectors + boots | consumable | ☐ |  | NET, CAM | |
| Cable clips / staples / J-hooks | consumable | ☐ |  | NET, CAM, AV | Secure runs |
| Velcro ties / zip ties | consumable | ☐ |  | ALL | Cable management |
| Wall anchors (drywall + masonry) | consumable | ☐ |  | ALL | |
| Screws / fasteners (exterior-rated assorted) | consumable | ☐ |  | ALL | Stainless near coast |
| Lag bolts / mounting hardware (TV, dish, pole) | consumable | ☐ |  | AV, STAR, CAM | |
| Exterior silicone sealant / butyl tape | consumable | ☐ |  | STAR, CAM | Weatherproof every penetration |
| Cable raceway / surface conduit | consumable | ☐ |  | CAM, NET, AV | Clean surface runs |
| Weatherproof junction / gang box | consumable | ☐ |  | CAM, AV | |
| Grommets / bushings / cable entry covers | consumable | ☐ |  | STAR, CAM | Tidy + sealed pass-through |
| Heat-shrink tubing | consumable | ☐ |  | NET, CAM | |
| Electrical tape | consumable | ☐ |  | ALL | |
| Wire nuts / lever (Wago) connectors | consumable | ☐ |  | HOME | Thermostat/low-voltage |
| Thermostat C-wire / common-wire kit | consumable | ☐ |  | HOME | When no C-wire present |
| Coax + F-connectors | consumable | ☐ |  | AV, NET | Only if reusing coax |
| AV cabling (HDMI / in-wall HDMI / speaker wire) | consumable | ☐ |  | AV | In-wall-rated for fished runs |
| Pole-mount concrete / ground anchors | consumable | ☐ |  | STAR | Ground-pole installs |
| Drywall patch / spackle | consumable | ☐ |  | ALL | Cleanup after fishing wire |
| Labels / label tape | consumable | ☐ |  | NET, CAM | |
| Batteries (AA/AAA, lock/sensor) | consumable | ☐ |  | LOCK, HOME | Locks last 6–12 mo |

## Chemical

| Item | Category | Have? | Qty | Used-by | Notes |
|---|---|:--:|:--:|---|---|
| Dielectric grease | chemical | ☐ |  | STAR, CAM | Weatherproof outdoor connectors |
| Electronics contact cleaner | chemical | ☐ |  | NET, CAM, AV | |
| Isopropyl alcohol | chemical | ☐ |  | CAM, AV | Lens/surface prep |
| Cable pulling lubricant | chemical | ☐ |  | NET, CAM | Conduit pulls |

## PPE

| Item | Category | Have? | Qty | Used-by | Notes |
|---|---|:--:|:--:|---|---|
| Safety glasses | PPE | ☐ |  | ALL | |
| Work gloves | PPE | ☐ |  | ALL | |
| Cut-resistant gloves | PPE | ☐ |  | ALL | Stripping/cutting cable |
| Knee pads | PPE | ☐ |  | ALL | Floor/baseboard work |
| Dust mask / N95 | PPE | ☐ |  | ALL | Attics, drilling |
| Hearing protection | PPE | ☐ |  | STAR, ALL | Grinder/hammer-drill |
| Roof fall-protection harness + rope | PPE | ☐ |  | STAR, CAM | Roof-mounted work |
| First-aid kit | PPE | ☐ |  | ALL | Keep in vehicle |

## Vehicle

| Item | Category | Have? | Qty | Used-by | Notes |
|---|---|:--:|:--:|---|---|
| Work van / truck | vehicle | ☐ |  | ALL | ⚠️ no commercial auto coverage — see entity facts |
| Roof ladder rack | vehicle | ☐ |  | STAR, CAM | Haul extension ladder |
| Van shelving / parts organization | vehicle | ☐ |  | ALL | Consumable bins by category |
