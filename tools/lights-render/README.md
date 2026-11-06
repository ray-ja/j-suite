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

## A new house (about 20 minutes)

Work folder outside git, e.g. `~/lights-houses/<slug>/`:

```
photos/baseF.jpg  baseB.jpg ...     dusk photos, one per view, same size (1195x896 is what we use)
house.json                          the spec (copy houses/kim-voyager.json and edit)
```

In `house.json`, per view: `base` photo and `sky` (mask path, made for you). Per run:

| key | meaning |
|---|---|
| `view` | which photo |
| `kind` | `c9` (roofline bulbs), `mini` (rails, columns, posts), `net` (shrubs, trees) |
| `mode` | `line` (bulbs along a traced line), `net` (scattered over a filled shape), `wrap` (draped strands over a tree) |
| `spacing` | px between bulbs: c9 13, mini 4, net 6, wrap 5 |
| `describe` | where the lights go, plain words. The model reads this. Say the level ("same level as the front door", "about 60 percent down the image") |
| `guide` | where the trace is saved |
| optional | `wobble` 1.5-2 (minis wrapped on a rail), `gap`/`slope`/`amp` (tree strands), `y`/`x` [min,max] crop, `extra` [[x,y],...] hand-placed bulbs, `minSpeck` |

Then:

```
node   tools/lights-render/gemini.js   # (used by guides.py; key from org-ai-config.json)
python3 tools/lights-render/guides.py ~/lights-houses/<slug>/house.json      # traces + sky masks, in parallel
python3 tools/lights-render/build.py  ~/lights-houses/<slug>/house.json      # bulbs, spill maps, QA
```

Set `"out"` to `<repo>/assets/quotes/<page slug>/lights` so the page can load it.

## QA, every house

1. `qa/trace-<view>.jpg`: every run's bulbs in its own color on a dimmed photo. Check each run sits on the right thing.
   The model's usual miss is the wrong level (porch vs top deck). Fix the words, then
   `guides.py house.json --only fp --force` and rebuild with `build.py house.json --only fp`.
   Short bits it missed: add `extra` points. Stray lines elsewhere: crop with `y`/`x`.
2. `qa/render-<view>-<palette>.jpg`: the finished look in warm, multi, red/white.
3. Optional: `sheet.py <house dir> out.jpg rf=ref.png ...` puts any reference picture beside ours, cropped to the run.
4. Open the page at phone width (390) and desktop, flip views and colors.

## The page

```html
<script src="/assets/lights/render.js"></script>
LightsRender.load("/assets/quotes/<slug>/lights/").then(h => h.draw(canvas, "front", ["rf", "fu"], "warm"))
```

`draw` paints the whole lit photo onto the canvas (about 40-90 ms on a laptop). Palettes and the look live in
`look.py` (`LOOK`) and are copied into `lights.json` at build time; after changing the look, run
`build.py house.json --only none` to refresh `lights.json` without retracing.

Tools: `preview.py` renders any view/runs/palette to a jpg; `compare.py` makes crop sheets. Python needs only PIL and numpy.
