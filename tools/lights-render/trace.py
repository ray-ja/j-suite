# Magenta guide renders -> bulb points. Used by build.py.
import numpy as np, math, random
from PIL import Image

def magenta(path, W, H):
  a = np.asarray(Image.open(path).convert('RGB').resize((W, H))).astype(int)
  return (a[..., 0] > 170) & (a[..., 2] > 170) & (a[..., 1] < 110)

def components(m, mn):
  """Drop connected specks smaller than mn pixels (8-connected)."""
  if mn <= 1: return m
  H, W = m.shape
  keep = np.zeros_like(m); seen = np.zeros_like(m)
  for y0, x0 in zip(*np.nonzero(m)):
    if seen[y0, x0]: continue
    st = [(y0, x0)]; seen[y0, x0] = True; comp = []
    while st:
      y, x = st.pop(); comp.append((y, x))
      for a in (-1, 0, 1):
        for b in (-1, 0, 1):
          yy, xx = y + a, x + b
          if 0 <= yy < H and 0 <= xx < W and m[yy, xx] and not seen[yy, xx]:
            seen[yy, xx] = True; st.append((yy, xx))
    if len(comp) >= mn:
      for q in comp: keep[q] = True
  return keep

def dilate(m, r):
  """Grow a mask by r px (joins dashed traces into one line before thinning)."""
  H, W = m.shape; p = np.pad(m, r); out = m.copy()
  for dy in range(-r, r + 1):
    for dx in range(-r, r + 1):
      if dx*dx + dy*dy <= r*r: out |= p[r + dy:r + dy + H, r + dx:r + dx + W]
  return out

def mask(path, W, H, y=None, x=None, mn=25, bridge=0):
  m = magenta(path, W, H)
  if bridge: m = dilate(m, bridge)
  if y: m[:y[0]] = False; m[y[1]:] = False
  if x: m[:, :x[0]] = False; m[:, x[1]:] = False
  return components(m, mn)

def thin(m):  # Zhang-Suen
  m = m.copy().astype(np.uint8)
  while True:
    ch = False
    for step in (0, 1):
      p = np.pad(m, 1)
      P = [p[1:-1, 1:-1], p[:-2, 1:-1], p[:-2, 2:], p[1:-1, 2:], p[2:, 2:], p[2:, 1:-1], p[2:, :-2], p[1:-1, :-2], p[:-2, :-2]]
      B = sum(P[1:]); seq = P[1:] + [P[1]]
      A = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(int) for i in range(8))
      c = (P[1]*P[3]*P[5] == 0) & (P[3]*P[5]*P[7] == 0) if step == 0 else (P[1]*P[3]*P[7] == 0) & (P[1]*P[5]*P[7] == 0)
      d = (m == 1) & (B >= 2) & (B <= 6) & (A == 1) & c
      if d.any(): m[d] = 0; ch = True
    if not ch: return m.astype(bool)

def walks(m):
  """The traced lines as ordered pixel paths [(x, y), ...], one per connected stroke."""
  pts = set(zip(*np.nonzero(thin(m)))); out = []
  N = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
  deg = lambda q: sum((q[0] + a, q[1] + b) in pts for a, b in N)
  while pts:
    ends = [q for q in pts if deg(q) <= 1]; cur = min(ends) if ends else min(pts); path = []
    while cur:
      pts.discard(cur); path.append((cur[1], cur[0]))
      nb = [(cur[0] + a, cur[1] + b) for a, b in N if (cur[0] + a, cur[1] + b) in pts]
      cur = min(nb, key=lambda q: abs(q[0] - cur[0]) + abs(q[1] - cur[1])) if nb else None
    out.append(path)
  return out

def dedupe(out, d):
  res = []
  for p in out:  # drop near-duplicates where two walks meet
    if all((p[0] - q[0])**2 + (p[1] - q[1])**2 >= (0.6*d)**2 for q in res[-80:]): res.append(p)
  return res

def along(m, d):
  """Bulbs every d px along each traced line."""
  out = []
  for path in walks(m):
    acc = d; prev = None
    for p in path:
      if prev: acc += math.hypot(p[0] - prev[0], p[1] - prev[1])
      if acc >= d: out.append(p); acc = 0
      prev = p
  return dedupe(out, d)

def spiral(m, pitch, radius, per_turn=6):
  """Mini lights spiral-wrapped around a rail: per_turn bulbs per turn, a turn every pitch px along the rail.
  Only the half of each turn facing the camera shows, so it reads as short slanted dashes with gaps."""
  out = []
  for path in walks(m):
    if len(path) < 3: continue
    xs = np.array([p[0] for p in path], float); ys = np.array([p[1] for p in path], float)
    k = 5; xs = np.convolve(np.pad(xs, k, mode="edge"), np.ones(2*k + 1)/(2*k + 1), "valid")   # smooth the
    ys = np.convolve(np.pad(ys, k, mode="edge"), np.ones(2*k + 1)/(2*k + 1), "valid")          # pixel stair-steps
    seg = np.hypot(np.diff(xs), np.diff(ys)); s = np.concatenate([[0], np.cumsum(seg)]); L = s[-1]
    i = 0
    while True:
      t = i*pitch/per_turn
      if t > L: break
      ph = 2*math.pi*i/per_turn; i += 1
      if math.cos(ph) < 0.2: continue   # back of the rail
      j = min(np.searchsorted(s, t), len(xs) - 1); j0 = max(j - 3, 0); j1 = min(j + 3, len(xs) - 1)
      dx, dy = xs[j1] - xs[j0], ys[j1] - ys[j0]; n = math.hypot(dx, dy) or 1
      off = math.sin(ph)*radius
      out.append((int(round(xs[j] - dy/n*off)), int(round(ys[j] + dx/n*off))))
  return out

def strands(m, d, gap=None, slope=0.0, amp=None, seed=7):
  """Net / wrap lights: wavy strands across a filled area, bulbs every d px along each strand.
  slope tilts the strands (trees ~0.3, shrubs 0), gap = distance between strands."""
  rnd = random.Random(seed); H, W = m.shape
  gap = gap or 2.2*d; amp = amp if amp is not None else 0.35*gap
  ys, xs = np.nonzero(m)
  if not len(xs): return []
  x0, x1 = xs.min(), xs.max(); out = []
  y = ys.min() - abs(slope)*(x1 - x0) - gap
  while y < ys.max() + abs(slope)*(x1 - x0) + gap:
    ph = rnd.uniform(0, 6.28); lam = rnd.uniform(4, 8)*d; a = amp*rnd.uniform(0.5, 1.4); x = x0 + rnd.uniform(0, d)
    tilt = slope*rnd.uniform(0.4, 1.6)
    while x <= x1:
      # scallops: a strand droops between the branch tips it hangs from
      yy = y + tilt*(x - x0) + a*abs(math.sin(x/lam*3.14 + ph))
      px, py = int(round(x + rnd.uniform(-0.25, 0.25)*d)), int(round(yy + rnd.uniform(-0.25, 0.25)*d))
      if 0 <= px < W and 0 <= py < H and m[py, px]: out.append((px, py))
      x += d/math.sqrt(1 + slope*slope)
    y += gap
  return out

def scatter(m, d, seed=7):
  """Net lights: bulbs scattered over a filled area, at least d px apart (Poisson disk)."""
  rnd = random.Random(seed); ys, xs = np.nonzero(m); idx = list(range(len(xs))); rnd.shuffle(idx)
  cell = {}; res = []
  for i in idx:
    x, y = int(xs[i]), int(ys[i]); cx, cy = x//d, y//d; ok = True
    for a in (-1, 0, 1):
      for b in (-1, 0, 1):
        for q in cell.get((cx + a, cy + b), ()):
          if (q[0] - x)**2 + (q[1] - y)**2 < d*d: ok = False; break
        if not ok: break
      if not ok: break
    if ok: cell.setdefault((cx, cy), []).append((x, y)); res.append((x, y))
  return res

def wobble(pts, w):
  """Mini lights wrapped on a rail sit just above and below it: alternate a small sideways offset."""
  out = []
  for i, (x, y) in enumerate(pts):
    a = pts[max(0, i - 1)]; b = pts[min(len(pts) - 1, i + 1)]
    dx, dy = b[0] - a[0], b[1] - a[1]; n = math.hypot(dx, dy) or 1
    if n > 4*w + 20: out.append((x, y)); continue  # jump between separate runs
    s = w if i % 2 else -w
    out.append((int(round(x - dy/n*s)), int(round(y + dx/n*s))))
  return out

def wrap(a, b, width, turns, d):
  """Spiral wrap around a trunk, column or post from point a to point b (image px).
  Only the front half of each turn faces the camera, so only those bulbs are kept."""
  (ax, ay), (bx, by) = a, b; L = math.hypot(bx - ax, by - ay) or 1
  ux, uy = (bx - ax)/L, (by - ay)/L; nx, ny = -uy, ux
  out = []; acc = d; prev = None; steps = int(L*4 + turns*60)
  for i in range(steps + 1):
    t = i/steps; ph = t*turns*2*math.pi
    if math.cos(ph) < 0: prev = None; continue   # behind the trunk
    s = math.sin(ph)*width/2
    p = (ax + ux*L*t + nx*s, ay + uy*L*t + ny*s)
    if prev: acc += math.hypot(p[0] - prev[0], p[1] - prev[1])
    if prev is None or acc >= d: out.append((int(round(p[0])), int(round(p[1])))); acc = 0
    prev = p
  return out
