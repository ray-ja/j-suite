# Overlay one or more raw magenta traces on the base photo (green = traced), side by side, to pick the good one.
# usage: python3 tracecheck.py base.jpg out.jpg trace1.png [trace2.png ...] [--crop x0,y0,x1,y1]
import sys, os
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from trace import magenta
a = sys.argv[1:]; crop = None
if "--crop" in a: i = a.index("--crop"); crop = tuple(int(v) for v in a[i+1].split(",")); a = a[:i] + a[i+2:]
base, dst, traces = a[0], a[1], a[2:]
b = Image.open(base).convert("RGB"); W, H = b.size; tiles = []
for t in traces:
  m = magenta(t, W, H); im = (np.asarray(b).astype(float)*0.5); im[m] = [0, 255, 0]
  im = Image.fromarray(im.astype(np.uint8))
  if crop: im = im.crop(crop)
  im = im.resize((800, int(800*im.height/im.width))); ImageDraw.Draw(im).text((6, 6), os.path.basename(t), fill=(255, 235, 120)); tiles.append(im)
S = Image.new("RGB", (810*len(tiles), tiles[0].height), (18, 18, 18))
for k, t in enumerate(tiles): S.paste(t, (k*810, 0))
S.save(dst, quality=86)
