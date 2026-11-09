# Zoomed crop with an image-coordinate grid, for hand-placing wraps / lines / extra points.
# usage: python3 gridcrop.py base.png out.jpg x0,y0,x1,y1 [step=10] [zoom=3]
import sys
from PIL import Image, ImageDraw
src, dst, box = sys.argv[1], sys.argv[2], [int(v) for v in sys.argv[3].split(",")]
step = int(sys.argv[4]) if len(sys.argv) > 4 else 10; z = int(sys.argv[5]) if len(sys.argv) > 5 else 3
x0, y0, x1, y1 = box
im = Image.open(src).convert("RGB").crop(box).resize(((x1 - x0)*z, (y1 - y0)*z), Image.LANCZOS); d = ImageDraw.Draw(im)
for x in range((x0//step + 1)*step, x1, step):
  X = (x - x0)*z; strong = x % (step*5) == 0
  d.line([(X, 0), (X, im.height)], fill=(255, 40, 40) if strong else (110, 30, 30))
  if strong: d.text((X + 2, 2), str(x), fill=(255, 255, 0))
for y in range((y0//step + 1)*step, y1, step):
  Y = (y - y0)*z; strong = y % (step*5) == 0
  d.line([(0, Y), (im.width, Y)], fill=(255, 40, 40) if strong else (110, 30, 30))
  if strong: d.text((2, Y + 2), str(y), fill=(255, 255, 0))
im.save(dst, quality=88)
