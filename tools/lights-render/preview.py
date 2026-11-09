# Render one view with chosen runs and palette from a built house.
# usage: python3 preview.py <house dir or out dir> <view> <run,run|all> <palette> <out.jpg>
import sys, os, json
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from look import compose
from build import decode

d, view, sel, pal, dst = sys.argv[1:6]
if os.path.exists(os.path.join(d, "out", "lights.json")): d = os.path.join(d, "out")
L = json.load(open(os.path.join(d, "lights.json"))); W, H = L["w"], L["h"]
base = np.asarray(Image.open(os.path.join(d, L["views"][view]["base"])).convert("RGB"))
runs = []
for rid, R in L["runs"].items():
  if R["view"] != view or (sel != "all" and rid not in sel.split(",")): continue
  p = R["pts"]
  runs.append({"kind": R["kind"], "pts": list(zip(p[::2], p[1::2])),
               "irr": decode(Image.open(os.path.join(d, "irr-%s.png" % rid)), R["scale"], W, H)})
Image.fromarray(compose(base, runs, pal, amb=L["views"][view].get("ambient"))).save(dst, quality=90)
