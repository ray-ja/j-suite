# Build a house's light layers from its spec.  usage: python3 build.py house.json [--only rf,fp] [--no-preview]
# Writes into spec["out"]: lights.json (bulb points + look), irr-<run>.png (spill maps), base-<view>.jpg,
# and spec["qa"]: trace sheets and preview renders for every view and palette.
import sys, os, json, time, shutil
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from trace import mask, along, strands, scatter, wobble
from look import LOOK, compose, ambient

def falloff_kernel(r0, R):
  yy, xx = np.mgrid[-R:R+1, -R:R+1].astype(np.float32); d = np.hypot(xx, yy)
  k = 1/(1 + (d/r0)**2); edge = np.clip((R - d)/(0.25*R), 0, 1)
  return k*edge*edge*(3 - 2*edge)

def convolve(img, ker):
  H, W = img.shape; kh, kw = ker.shape; ph, pw = H + kh, W + kw
  F = np.fft.rfft2(img, (ph, pw))*np.fft.rfft2(ker, (ph, pw))
  out = np.fft.irfft2(F, (ph, pw)); oy, ox = kh//2, kw//2
  return out[oy:oy+H, ox:ox+W].astype(np.float32)

def points(run, path, W, H, sky=None):
  m = mask(path, W, H, run.get("y"), run.get("x"), run.get("minSpeck", 25))
  if sky is not None and run.get("mode", "line") != "line": m = m & ~sky   # nets and trees: no bulbs in the gaps where sky shows
  mode = run.get("mode", "line"); d = run["spacing"]
  if mode == "line":
    pts = along(m, d)
    if run.get("wobble"): pts = wobble(pts, run["wobble"])
  elif mode == "net": pts = scatter(m, d)
  else: pts = strands(m, d, run.get("gap"), run.get("slope", 0.0 if mode == "net" else 0.3), run.get("amp"))
  return pts + [tuple(p) for p in run.get("extra", [])], m

def irradiance(pts, kind, sky, W, H):
  P = LOOK["kinds"][kind]; ker = falloff_kernel(P["r0"], P["R"]); maps = []
  for g in range(4):
    imp = np.zeros((H, W), np.float32)
    for n, (x, y) in enumerate(pts):
      if n % 4 == g and 0 <= x < W and 0 <= y < H: imp[int(y), int(x)] += 1
    irr = np.maximum(convolve(imp, ker), 0); irr[sky] = 0; maps.append(irr)
  return maps

def encode(maps, W, H):
  """4 spill maps -> one grayscale PNG, half size, stacked top to bottom, sqrt-encoded."""
  w2, h2 = (W + 1)//2, (H + 1)//2
  small = [np.asarray(Image.fromarray(m).resize((w2, h2), Image.BILINEAR)) for m in maps]
  scale = float(max(np.percentile(s, 99.95) for s in small) or 1)
  img = np.concatenate([np.clip(np.sqrt(np.clip(s, 0, None)/scale), 0, 1) for s in small], 0)
  return Image.fromarray((img*255 + 0.5).astype(np.uint8), "L"), scale

def decode(png, scale, W, H):
  a = np.asarray(png).astype(np.float32)/255; h2 = a.shape[0]//4
  return [np.asarray(Image.fromarray((a[g*h2:(g+1)*h2]**2)*scale).resize((W, H), Image.BILINEAR)) for g in range(4)]

def main():
  spec_path = sys.argv[1]; root = os.path.dirname(os.path.abspath(spec_path)); S = json.load(open(spec_path))
  only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else None
  rel = lambda p: p if os.path.isabs(p) else os.path.join(root, p)
  W, H = S["size"]; out = rel(S["out"]); qa = rel(S.get("qa", "qa")); os.makedirs(out, exist_ok=True); os.makedirs(qa, exist_ok=True)
  old = json.load(open(os.path.join(out, "lights.json"))) if os.path.exists(os.path.join(out, "lights.json")) else {"runs": {}}
  L = {"w": W, "h": H, "stamp": int(time.time()), "look": LOOK, "views": {}, "runs": {}}
  bases, skies = {}, {}
  for v, V in S["views"].items():
    b = Image.open(rel(V["base"])).convert("RGB").resize((W, H)); bases[v] = np.asarray(b)
    b.save(os.path.join(out, "base-%s.jpg" % v), quality=90); L["views"][v] = {"base": "base-%s.jpg" % v}
    skies[v] = mask(rel(V["sky"]), W, H, mn=1) if V.get("sky") else np.zeros((H, W), bool)
    L["views"][v]["ambient"] = [round(float(c), 4) for c in (V.get("ambient") or ambient(bases[v], skies[v]))]
  traces = {}
  for rid, run in S["runs"].items():
    if only and rid not in only and rid in old["runs"]:
      L["runs"][rid] = old["runs"][rid]; continue
    t = time.time(); pts, m = points(run, rel(run["guide"]), W, H, skies[run["view"]]); traces[rid] = m
    maps = irradiance(pts, run["kind"], skies[run["view"]], W, H)
    png, scale = encode(maps, W, H); png.save(os.path.join(out, "irr-%s.png" % rid), optimize=True)
    L["runs"][rid] = {"view": run["view"], "kind": run["kind"], "scale": round(scale, 5), "pts": [int(c) for p in pts for c in p]}
    print("%-4s %-5s %4d bulbs  %.1fs" % (rid, run["kind"], len(pts), time.time() - t))
  json.dump(L, open(os.path.join(out, "lights.json"), "w"), separators=(",", ":"))
  if "--no-preview" in sys.argv: return
  # QA 1: every run's bulbs over its view, one sheet per view (check placement before anything else)
  hue = [(255, 60, 60), (60, 255, 90), (80, 160, 255), (255, 220, 40), (255, 80, 255), (40, 240, 240)]
  for v in S["views"]:
    im = Image.fromarray((bases[v]*0.5).astype(np.uint8)); d = ImageDraw.Draw(im); i = 0
    for rid, R in L["runs"].items():
      if R["view"] != v: continue
      c = hue[i % len(hue)]; i += 1; p = R["pts"]
      for k in range(0, len(p), 2): d.ellipse((p[k]-1.5, p[k+1]-1.5, p[k]+1.5, p[k+1]+1.5), fill=c)
      d.text((p[0] + 4, p[1] - 12), rid, fill=c)
    im.save(os.path.join(qa, "trace-%s.jpg" % v), quality=85)
  # QA 2: full renders, every view x palette
  for v in S["views"]:
    runs = []
    for rid, R in L["runs"].items():
      if R["view"] != v: continue
      p = R["pts"]; irr = decode(Image.open(os.path.join(out, "irr-%s.png" % rid)), R["scale"], W, H)
      runs.append({"kind": R["kind"], "pts": list(zip(p[::2], p[1::2])), "irr": irr})
    for pal in S.get("previewPalettes", ["warm", "multi", "redwhite"]):
      Image.fromarray(compose(bases[v], runs, pal, amb=L["views"][v]["ambient"])).save(os.path.join(qa, "render-%s-%s.jpg" % (v, pal)), quality=88)
  print("qa ->", qa)

if __name__ == "__main__":
  main()
