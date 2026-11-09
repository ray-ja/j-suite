# Is a dusk base still the same picture as the daytime photo? (traces are drawn on the base, so geometry must match)
# usage: python3 aligncheck.py day.jpg dusk.png out.jpg [W H]
# Prints the global shift (px) and the share of 64 px tiles whose edges moved > 3 px. Good: shift 0-1 px, moved tiles < 5%.
# Writes out.jpg: dusk base with the daytime photo's edges in green (they should sit exactly on the dusk edges).
import sys
import numpy as np
from PIL import Image, ImageFilter
day, dusk, dst = sys.argv[1:4]
W, H = (int(sys.argv[4]), int(sys.argv[5])) if len(sys.argv) > 5 else (1195, 896)
def edges(p):
  g = np.asarray(Image.open(p).convert("L").resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)
  gx = np.zeros_like(g); gy = np.zeros_like(g); gx[:, 1:-1] = g[:, 2:] - g[:, :-2]; gy[1:-1] = g[2:] - g[:-2]
  e = np.hypot(gx, gy); return e/(e.mean() + 1e-6)
def shift(a, b):
  """Integer shift of b relative to a by phase correlation."""
  F = np.fft.fft2(a)*np.conj(np.fft.fft2(b)); r = np.fft.ifft2(F/(np.abs(F) + 1e-6)).real
  y, x = np.unravel_index(np.argmax(r), r.shape); h, w = a.shape
  return (y if y < h//2 else y - h), (x if x < w//2 else x - w), r.max()
a, b = edges(day), edges(dusk)
dy, dx, _ = shift(a, b)
moved = 0; tiles = 0; T = 64
for y in range(0, H - T + 1, T):
  for x in range(0, W - T + 1, T):
    ta, tb = a[y:y+T, x:x+T], b[y:y+T, x:x+T]
    if ta.mean() < 0.6: continue          # flat tile (sky, lawn): nothing to compare
    tiles += 1; ty, tx, _ = shift(ta, tb)
    if abs(ty) > 3 or abs(tx) > 3: moved += 1
print("shift dy=%d dx=%d   tiles moved >3px: %d of %d (%.0f%%)" % (dy, dx, moved, tiles, 100.0*moved/max(tiles, 1)))
im = np.asarray(Image.open(dusk).convert("RGB").resize((W, H))).astype(np.float32)
m = a > np.percentile(a, 92); im[m] = im[m]*0.3 + np.array([0, 255, 0])*0.7
Image.fromarray(im.astype(np.uint8)).save(dst, quality=88)
