# Side-by-side sheet: reference image(s) vs our render, full frame plus zoomed crops.
# usage: python3 compare.py out.jpg "Label A=ref.png" "Label B=render.jpg" [--crop x0,y0,x1,y1 ...]
import sys
from PIL import Image, ImageDraw
args = sys.argv[2:]; crops = []; imgs = []
i = 0
while i < len(args):
  if args[i] == "--crop": crops.append(tuple(int(v) for v in args[i+1].split(","))); i += 2
  else: lab, p = args[i].split("=", 1); imgs.append((lab, Image.open(p).convert("RGB"))); i += 1
W = 600; rows = []
for lab, im in imgs:
  im = im.resize((1195, 896)); tiles = [im.resize((W, int(W*896/1195)))]
  for c in crops:
    cw, ch = c[2]-c[0], c[3]-c[1]; tiles.append(im.crop(c).resize((W, int(W*ch/cw)), Image.LANCZOS))
  h = max(t.height for t in tiles); row = Image.new("RGB", (W*len(tiles), h + 24), (20, 20, 20))
  for k, t in enumerate(tiles): row.paste(t, (k*W, 24))
  ImageDraw.Draw(row).text((6, 5), lab, fill=(255, 230, 120)); rows.append(row)
S = Image.new("RGB", (rows[0].width, sum(r.height for r in rows)))
y = 0
for r in rows: S.paste(r, (0, y)); y += r.height
S.save(sys.argv[1], quality=88)
