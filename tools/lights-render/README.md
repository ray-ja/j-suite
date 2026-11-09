# Lights render

Shows a customer their own house lit, one toggle per run, in any color. Bulbs sit exactly where we would hang them
(traced on the photo), and the light looks real: warm halos, glow spilling onto white trim and rails, nets that light
the shrubs. Nothing is AI-painted in the final picture, so there is no smear, grid, or floating light, and recolor is free.

How it works:
1. The image model traces each run on the photo in pure magenta (a line for rooflines and rails, a filled shape for
   shrubs and trees) and fills the sky. These are only guides, never shown.
2. `build.py` turns each trace into bulb positions and a spill map (how much light each surface gets), using the sky
   mask so the sky never lights up.
3. `/assets/lights/render.js` lights the photo in the browser: photo + surface albedo x spill + bulb sprites,
   in linear light. `look.py` is the same math in Python for previews. Change one, change the other.

## A new house (Mikey's took about 2.5 hours, most of it first-time tooling; the next should be about 1 hour)

Work folder outside git, e.g. `~/lights-houses/<slug>/`:

```
photos/<originals>                  customer photos, any time of day
photos/baseF.png  baseB.png ...     dusk bases, one per view, 1195x896
house.json                          the spec (copy houses/mikey-bay.json and edit)
```

0. Dusk bases from daytime photos. Crop each view to 4:3 around the house and resize to 1195x896, then
   `node gemini.js front-day.jpg duskF-a.png dusk-prompt.txt` twice per view (removes sun, flare and shadows, adds
   warm windows). Check each take: `python3 aligncheck.py front-day.jpg duskF-a.png sheet.jpg` must print shift 0
   and under about 5% moved tiles, and the green day-edges in the sheet must sit on the house. Pick the cleaner take.
   Avoid takes that light porch lamps brightly (they read as lights we sell).

In `house.json`, per view: `base` photo and `sky` (mask path, made for you). Per run:

| key | meaning |
|---|---|
| `view` | which photo |
| `kind` | `c9` (roofline bulbs), `mini` (rails, columns, posts), `net` (shrub nets), `tree` (strands on trees) |
| `mode` | `line` (bulbs along a traced line), `net` (scattered over a filled shape), `wrap` (draped strands over a filled tree, fallback) |
| `spacing` | px between bulbs: c9 13, mini 4, net 6, tree 4 |
| `describe` | where the lights go, plain words. The model reads this. Say the level ("same level as the front door", "about 60 percent down the image") |
| `guide` | where the trace is saved |
| `spiral` | rails (all $6/ft railings): `{"pitch": 7, "radius": 2.2, "perTurn": 6}` = minis spiral-wrapped on the handrail, front half of each turn shows |
| `wraps` | trunks, posts: `[{"from":[x,y],"to":[x,y],"width":10,"turns":9,"spacing":3}]` spiral between two points, no trace needed |
| `lines` | `[[x0,y0,x1,y1],...]` hand-drawn segments added to the trace (short bits the model missed); they get the same spiral |
| `erase` | `[[x0,y0,x1,y1],...]` boxes wiped out of the trace: ridges, stray strokes the model added |
| optional | `guide` may be a list (union of several takes), `bridge` 1-2 (join dashed traces), `y`/`x` [min,max] crop, `extra` [[x,y],...] loose bulbs, `minSpeck`, `gap`/`slope`/`amp` (wrap mode) |

Trees: trace the tier edges as lines, not a fill. Words that work: "trace the lower outer edge of EVERY branch tier ... following how each tier droops from the trunk side out to the branch tips; one line per tier". Run it twice and list both files in `guide`. The model can't trace trunks; use `wraps`.

Then:

```
node   tools/lights-render/gemini.js   # (used by guides.py; key from org-ai-config.json)
python3 tools/lights-render/guides.py ~/lights-houses/<slug>/house.json      # traces + sky masks, in parallel
python3 tools/lights-render/build.py  ~/lights-houses/<slug>/house.json      # bulbs, spill maps, QA
```

Set `"out"` to `assets/quotes/<page slug>/lights`. It is relative to the repo that holds the tool, so the spec works from any checkout.
`tracecheck.py base.jpg out.jpg take1.png take2.png --crop x0,y0,x1,y1` overlays raw traces to pick the better take.

Placing wraps, lines and decor by hand: `python3 gridcrop.py base.png out.jpg x0,y0,x1,y1` gives a zoomed crop with
image coordinates. Wraps: about 13 px per turn on a porch column (`turns` = height/13), width = the column's width.

## Wreaths and garland (`decor.py`)

Under `"decor"` in the spec; writes transparent layers into the same `lights/` folder:

```
"wg": {"view": "front", "type": "wreath", "at": [760, 140], "sizes": {"36": 32, "48": 42, "60": 53}}   -> wg-36.webp ...
"gs": {"view": "front", "type": "garland", "follow": "fs", "thick": 10}                                 -> gs.webp along run fs
```

Size in px = inches / (inches per px at that wall); a front door (80 in) or siding courses (about 7 in) give the scale.
Sprites are `sprites/wreath.webp` and `sprites/garland.webp` (keyed once from image-model renders on flat magenta; to
make a new one, render on a magenta canvas and run it through `decor.keyed`). The page loads sized wreaths as
`lights/<id>-<inches>.webp`.

## QA, every house

1. `qa/trace-<view>.jpg`: every run's bulbs in its own color on a dimmed photo. Check each run sits on the right thing.
   The model's usual miss is the wrong level (porch vs top deck). Fix the words, then
   `guides.py house.json --only fp --force` and rebuild with `build.py house.json --only fp`.
   Short bits it missed: add `extra` points. Stray lines elsewhere: crop with `y`/`x`.
2. `qa/render-<view>-<palette>.jpg`: the finished look in warm, multi, red/white.
3. Optional: `sheet.py <house dir> out.jpg rf=ref.png ...` puts any reference picture beside ours, cropped to the run.
4. `node qa-shots.js <page url> <shots prefix> <item ids> <views>` (serve the repo with `python3 -m http.server` first):
   phone and desktop shots of the default picks and of everything on, every view, warm and multi; prints page errors.

## The page

```html
<script src="/assets/lights/render.js"></script>
LightsRender.load("/assets/quotes/<slug>/lights/").then(h => h.draw(canvas, "front", ["rf", "fu"], "warm"))
```

`draw` paints the whole lit photo onto the canvas. Only the 16 px blocks a lit run touches are recomputed. Measured toggles on Kim:
20-30 ms on a laptop, under 100 ms at 4x CPU throttle, under 145 ms at 6x; first open of a view 0.4-0.7 s (once).
Roofline glow on dark shingles: c9 `floor` raises their albedo, baked into the c9 spill maps at build time so nets and trees are unaffected. Palettes and the look live in
`look.py` (`LOOK`) and are copied into `lights.json` at build time; after changing the look, run
`build.py house.json --only none` to refresh `lights.json` without retracing.

Tools: `preview.py` renders any view/runs/palette to a jpg; `compare.py` makes crop sheets. Python needs only PIL and numpy.
