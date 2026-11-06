# The lighting model. render.js implements the same math in the browser; keep them in step.
#   out_lin = base_lin + albedo * spill * albedoGain + bulbs    (then a soft shoulder, then sRGB)
#   albedo  = photo / the scene's white (ambient), mostly gray, capped: white trim = 1, windows don't over-glow
#   spill   = sum over bulbs of color * I * falloff(distance), zero on sky
#   bulbs   = per-bulb sprite: core disk + halo + wide glow, in the bulb's color
import numpy as np, json

LOOK = {
  "kinds": {
    "c9":   {"core": 2.2, "coreI": 2.0, "white": 0.30, "halo": 3.0, "haloI": 0.55, "glow": 8.0, "glowI": 0.07,
             "r0": 5.0, "R": 64, "spillI": 1.5},
    "mini": {"core": 0.95, "coreI": 2.2, "white": 0.25, "halo": 1.6, "haloI": 0.55, "glow": 4.0, "glowI": 0.06,
             "r0": 3.0, "R": 32, "spillI": 0.9, "vary": 0.45},
    "net":  {"core": 1.2, "coreI": 2.4, "white": 0.35, "halo": 1.6, "haloI": 0.5, "glow": 4.5, "glowI": 0.06,
             "r0": 6.0, "R": 48, "spillI": 1.3, "vary": 0.7}
  },
  "albedoGain": 0.5,
  "albedoTint": 0.35,
  "albedoCap": 1.0,
  "spillSat": 1.25,
  "knee": 0.78,
  "palettes": {
    "warm":      ["#ffc46a"],
    "cool":      ["#c9dcff"],
    "multi":     ["#ff2a1a", "#19d14a", "#2f6bff", "#ffae1a"],
    "redwhite":  ["#ff2a1a", "#ffd9a8"],
    "bluewhite": ["#2f6bff", "#e6eeff"]
  }
}

def s2l(v):
  v = np.asarray(v, dtype=np.float32)
  return np.where(v <= 0.04045, v/12.92, ((v + 0.055)/1.055)**2.4)

def l2s(v):
  v = np.clip(v, 0, 1)
  return np.where(v <= 0.0031308, v*12.92, 1.055*np.power(v, 1/2.4) - 0.055)

def hexlin(h):
  return s2l([int(h[i:i+2], 16)/255 for i in (1, 3, 5)])

def shoulder(x, k):
  return np.where(x < k, x, k + (1 - k)*(1 - np.exp(-(x - k)/(1 - k))))

def sprite(kind, col):
  """Linear RGB sprite (r x r x 3) for one bulb of this kind and color."""
  P = LOOK["kinds"][kind]; R = int(np.ceil(P["glow"]*2.2))
  yy, xx = np.mgrid[-R:R+1, -R:R+1].astype(np.float32); r = np.hypot(xx, yy)
  core = P["coreI"]*np.exp(-(r/P["core"])**4)
  halo = P["haloI"]*np.exp(-(r/P["halo"])**2) + P["glowI"]*np.exp(-(r/P["glow"])**2)
  sat = 1 - col.min()/max(col.max(), 1e-6); w = P["white"]*(1 - sat)**2  # colored bulbs stay colored
  coreCol = col*(1 - w) + w
  return core[..., None]*coreCol + halo[..., None]*col, R

def twinkle(n, v):
  """Brightness of bulb n: 1 - v .. 1, a fixed pseudo-random per bulb (real strands are uneven)."""
  f = (np.sin(n*12.9898 + 78.233)*43758.5453) % 1.0
  return 1 - v*f

def ambient(base_srgb, sky):
  """Color of the light already on the scene (blue at dusk), from its brightest cool, near-neutral surfaces
  (white trim and rails). Dividing by it turns the photo into albedo, so warm spill turns white trim gold."""
  b = s2l(base_srgb/255.0); lum = b.mean(2); ok = ~sky & (b[..., 2] >= b[..., 0])
  if ok.sum() < 100: return np.ones(3, np.float32)
  t = np.percentile(lum[ok], 99.0); sel = ok & (lum >= t)
  return b[sel].mean(0).astype(np.float32)

def albedo(base_lin, amb):
  Y = lambda c: c[..., 0]*0.2126 + c[..., 1]*0.7152 + c[..., 2]*0.0722
  gray = (Y(base_lin)/Y(amb))[..., None]; chrom = base_lin/amb; t = LOOK["albedoTint"]
  return np.minimum(gray*(1 - t) + chrom*t, LOOK["albedoCap"])

def compose(base_srgb, runs, palette, bulbs=True, amb=None):
  """base_srgb: HxWx3 uint8. runs: list of dicts {kind, pts:[(x,y)...], irr: [4 x HxW float] or None}."""
  H, W = base_srgb.shape[:2]
  base = s2l(base_srgb/255.0)
  cols = [hexlin(c) for c in LOOK["palettes"][palette]]; k = len(cols)
  spill = np.zeros((H, W, 3), np.float32); add = np.zeros((H, W, 3), np.float32)
  for run in runs:
    P = LOOK["kinds"][run["kind"]]
    if run.get("irr") is not None:
      for g in range(4):
        spill += run["irr"][g][..., None]*(cols[g % k]**LOOK["spillSat"])*P["spillI"]
    if bulbs:
      for n, (x, y) in enumerate(run["pts"]):
        sp, R = sprite(run["kind"], cols[n % k]); sp = sp*twinkle(n, P.get("vary", 0))
        x0, y0 = int(round(x)) - R, int(round(y)) - R
        a0, b0 = max(0, -y0), max(0, -x0); a1, b1 = min(sp.shape[0], H - y0), min(sp.shape[1], W - x0)
        if a1 > a0 and b1 > b0: add[y0+a0:y0+a1, x0+b0:x0+b1] += sp[a0:a1, b0:b1]
  amb = np.ones(3, np.float32) if amb is None else np.asarray(amb, np.float32)
  out = base + albedo(base, amb)*spill*LOOK["albedoGain"] + add
  return (l2s(shoulder(out, LOOK["knee"]))*255 + 0.5).astype(np.uint8)
