# Wreaths and garland as transparent full-frame layers (the page stacks them over the lit photo).
# usage: python3 decor.py house.json [--only wg,gs]
# Sprites: sprites/wreath.webp and sprites/garland.webp, made once by the image model on flat magenta
# (prompts in README) and keyed out with keyed(). Spec, per item under "decor":
#   {"view": "front", "type": "wreath", "at": [x, y], "sizes": {"36": 31, "48": 42}}   -> <id>-36.webp, <id>-48.webp
#   {"view": "front", "type": "wreath", "at": [x, y], "size": 21}                      -> <id>.webp
#   {"view": "front", "type": "garland", "follow": "fs", "thick": 7}                   -> <id>.webp along run fs's trace
import sys, os, json, math
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, here)
from build import out_dir, REPO
from trace import mask, walks
SPRITES = os.environ.get("LIGHTS_SPRITES", os.path.join(here, "sprites"))   # keyed RGBA: wreath.webp, garland.webp

def keyed(path):
  """Magenta background -> alpha, with the pink fringe pulled out of the edges. Cropped to the object.
  A sprite that already has transparency (the ones in sprites/) is used as-is."""
  src = Image.open(path)
  if src.mode == "RGBA" and np.asarray(src)[..., 3].min() < 250: return src
  a = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
  r, g, b = a[..., 0], a[..., 1], a[..., 2]
  score = np.minimum(r, b) - g                        # how magenta a pixel is
  alpha = np.clip(1 - (score - 35)/60, 0, 1)
  lim = g + 8                                        # despill: red/blue can't exceed green by much at the edges
  edge = alpha < 0.999
  a[..., 0] = np.where(edge, np.minimum(r, lim + (r - lim)*alpha), r)
  a[..., 2] = np.where(edge, np.minimum(b, lim + (b - lim)*alpha), b)
  rgba = np.dstack([a, alpha*255]).astype(np.uint8)
  ys, xs = np.nonzero(alpha > 0.05)
  return Image.fromarray(rgba, "RGBA").crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

def dusk(im, amb, k=0.42):
  """Daylight sprite -> dusk: greenery dimmed and tinted like the scene, its own little lights left bright."""
  a = np.asarray(im).astype(np.float32); rgb = a[..., :3]/255
  lum = rgb.mean(2, keepdims=True); lit = np.clip((lum - 0.72)/0.2, 0, 1)
  tint = np.asarray(amb, np.float32); tint = tint/tint.max()
  dim = rgb*k*(0.55 + 0.45*tint)
  out = dim*(1 - lit) + rgb*lit
  return Image.fromarray(np.dstack([np.clip(out*255, 0, 255), a[..., 3]]).astype(np.uint8), "RGBA")

def wreath_layer(W, H, spr, at, d):
  layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); s = spr.resize((d, max(1, round(d*spr.height/spr.width))), Image.LANCZOS)
  layer.alpha_composite(s, (int(at[0] - s.width/2), int(at[1] - s.height/2))); return layer

def garland_layer(W, H, spr, paths, thick):
  layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
  tile = spr.resize((max(4, round(thick*spr.width/spr.height)), thick), Image.LANCZOS)
  piece = min(tile.width, thick*4); tile = tile.crop((0, 0, piece, thick))
  for path in paths:
    if len(path) < 6: continue
    xs = np.array([p[0] for p in path], float); ys = np.array([p[1] for p in path], float)
    k = 4; xs = np.convolve(np.pad(xs, k, mode="edge"), np.ones(2*k + 1)/(2*k + 1), "valid")
    ys = np.convolve(np.pad(ys, k, mode="edge"), np.ones(2*k + 1)/(2*k + 1), "valid")
    s = np.concatenate([[0], np.cumsum(np.hypot(np.diff(xs), np.diff(ys)))]); t = 0.0
    while t < s[-1]:
      j = min(np.searchsorted(s, t), len(xs) - 1); j0, j1 = max(j - 3, 0), min(j + 3, len(xs) - 1)
      ang = math.degrees(math.atan2(ys[j1] - ys[j0], xs[j1] - xs[j0]))
      rot = tile.rotate(-ang, resample=Image.BICUBIC, expand=True)
      layer.alpha_composite(rot, (int(xs[j] - rot.width/2), int(ys[j] + thick*0.25 - rot.height/2)))   # hangs on the rail's front
      t += piece*0.55
  return layer

def run_mask(run, root, W, H):
  rel = lambda p: p if os.path.isabs(p) else os.path.join(root, p)
  g = run.get("guide"); gs = g if isinstance(g, list) else ([g] if g else [])
  m = np.zeros((H, W), bool)
  for p in gs: m |= mask(rel(p), W, H, run.get("y"), run.get("x"), run.get("minSpeck", 25), run.get("bridge", 0))
  if run.get("lines"):
    from PIL import ImageDraw
    im = Image.fromarray(m.astype(np.uint8)*255); dr = ImageDraw.Draw(im)
    for x0, y0, x1, y1 in run["lines"]: dr.line((x0, y0, x1, y1), fill=255, width=3)
    m = np.asarray(im) > 0
  for x0, y0, x1, y1 in run.get("erase", []): m[y0:y1, x0:x1] = False
  return m

def main():
  spec_path = sys.argv[1]; root = os.path.dirname(os.path.abspath(spec_path)); S = json.load(open(spec_path))
  only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else None
  W, H = S["size"]; out = out_dir(S, root); L = json.load(open(os.path.join(out, "lights.json")))
  spr = {}
  for did, D in S.get("decor", {}).items():
    if only and did not in only: continue
    kind = D["type"]; amb = L["views"][D["view"]]["ambient"]
    if kind not in spr: spr[kind] = keyed(os.path.join(SPRITES, kind + ".webp"))
    s = dusk(spr[kind], amb, D.get("dim", 0.5 if kind == "wreath" else 0.7))
    if kind == "wreath":
      sizes = D.get("sizes") or {"": D["size"]}
      for lab, d in sizes.items():
        name = did + ("-" + lab if lab else "") + ".webp"
        wreath_layer(W, H, s, D["at"], d).save(os.path.join(out, name), lossless=False, quality=88); print(name)
    else:
      paths = walks(run_mask(S["runs"][D["follow"]], root, W, H)) + [[(x0 + (x1 - x0)*i/40, y0 + (y1 - y0)*i/40) for i in range(41)] for x0, y0, x1, y1 in D.get("lines", [])]
      garland_layer(W, H, s, paths, D.get("thick", 7)).save(os.path.join(out, did + ".webp"), lossless=False, quality=88); print(did + ".webp")

if __name__ == "__main__":
  main()
