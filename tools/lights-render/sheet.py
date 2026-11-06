# Comparison sheet: for each run, a reference image (e.g. an earlier AI render) next to ours, cropped to the run.
# usage: python3 sheet.py <house dir> <out.jpg> run=ref.png [run=ref.png ...]
import sys, os, json, subprocess
import numpy as np
from PIL import Image, ImageDraw
here = os.path.dirname(os.path.abspath(__file__))
house, dst = sys.argv[1], sys.argv[2]
out_dir = json.load(open(os.path.join(house, "house.json")))["out"]
out_dir = out_dir if os.path.isabs(out_dir) else os.path.join(house, out_dir)
L = json.load(open(os.path.join(out_dir, "lights.json")))
rows = []
for arg in sys.argv[3:]:
  rid, ref = arg.split("=", 1); R = L["runs"][rid]; p = np.array(R["pts"]).reshape(-1, 2)
  mine = os.path.join(house, "qa", "sheet-%s.jpg" % rid)
  subprocess.run(["python3", os.path.join(here, "preview.py"), out_dir, R["view"], rid, "warm", mine], check=True)
  x0, y0 = p.min(0) - 40; x1, y1 = p.max(0) + 40
  x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(L["w"], x1), min(L["h"], y1)
  if (x1 - x0) < 1.6*(y1 - y0): c = (x0 + x1)/2; hw = 0.8*(y1 - y0); x0, x1 = max(0, c - hw), min(L["w"], c + hw)
  tiles = []
  for lab, path in (("before: AI render", ref), ("now", mine)):
    im = Image.open(path).convert("RGB").resize((L["w"], L["h"])).crop((int(x0), int(y0), int(x1), int(y1)))
    im = im.resize((800, int(800*im.height/im.width)), Image.LANCZOS); ImageDraw.Draw(im).text((8, 6), "%s  %s" % (rid, lab), fill=(255, 235, 120))
    tiles.append(im)
  row = Image.new("RGB", (1610, tiles[0].height), (18, 18, 18)); row.paste(tiles[0], (0, 0)); row.paste(tiles[1], (810, 0)); rows.append(row)
S = Image.new("RGB", (1610, sum(r.height + 10 for r in rows)), (18, 18, 18)); y = 0
for r in rows: S.paste(r, (0, y)); y += r.height + 10
S.save(dst, quality=86); print(dst)
