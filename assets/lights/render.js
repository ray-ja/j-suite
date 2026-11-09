/* OBX Holiday Lights: draws a house's lights onto its photo, in any color.
   Same math as tools/lights-render/look.py (keep them in step):
     out_lin = base_lin + albedo * spill * albedoGain + bulbs, soft shoulder, then sRGB.
   Data comes from tools/lights-render/build.py: lights.json (bulb points, look), irr-<run>.png (spill maps).
   Usage:
     LightsRender.load("/assets/quotes/<slug>/lights/").then(function (house) {
       house.draw(canvas, "front", ["rf", "fu"], "warm");   // returns a promise
     });
   Speed: only the 16 px blocks a lit run touches are recomputed; the rest is the photo as-is.
   Plain script, no build step. */
(function (root) {
  "use strict";
  var B = 16;   // block size for the touched-area map
  var LUT = new Uint8Array(4097);
  for (var i = 0; i <= 4096; i++) { var v = i / 4096; LUT[i] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); }
  var S2L = new Float32Array(256);
  for (var j = 0; j < 256; j++) { var c = j / 255; S2L[j] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function hexlin(h) { return [1, 3, 5].map(function (k) { return S2L[parseInt(h.substr(k, 2), 16)]; }); }
  function twinkle(n, v) { var x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return 1 - v * (x - Math.floor(x)); }
  function img(src) { return new Promise(function (ok, bad) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = bad; im.src = src; }); }
  function pixels(im, w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; var g = c.getContext("2d"); g.drawImage(im, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; }

  function House(dir, L) {
    var W = L.w, H = L.h, w2 = (W + 1) >> 1, h2 = (H + 1) >> 1;
    this.dir = dir; this.L = L; this.W = W; this.H = H; this.w2 = w2; this.h2 = h2;
    this.bw = Math.ceil(W / B); this.bh = Math.ceil(H / B);
    this.views = {}; this.irr = {}; this.sprites = {}; this.tint = {};
    /* bilinear lookup from full size into the half-size spill, per column and per row (computed once) */
    this.cx0 = new Int32Array(W); this.cx1 = new Int32Array(W); this.cfx = new Float32Array(W);
    for (var x = 0; x < W; x++) { var sx = Math.min(Math.max((x + 0.5) / 2 - 0.5, 0), w2 - 1); this.cx0[x] = sx | 0; this.cx1[x] = Math.min((sx | 0) + 1, w2 - 1); this.cfx[x] = sx - (sx | 0); }
    this.cy0 = new Int32Array(H); this.cy1 = new Int32Array(H); this.cfy = new Float32Array(H);
    for (var y = 0; y < H; y++) { var sy = Math.min(Math.max((y + 0.5) / 2 - 0.5, 0), h2 - 1); this.cy0[y] = sy | 0; this.cy1[y] = Math.min((sy | 0) + 1, h2 - 1); this.cfy[y] = sy - (sy | 0); }
  }
  /* base photo -> linear light + albedo (photo / the scene's white, mostly gray, capped) */
  House.prototype.view = function (v) {
    var self = this;
    if (this.views[v]) return this.views[v];
    return this.views[v] = img(this.dir + this.L.views[v].base).then(function (im) {
      var W = self.W, H = self.H, N = W * H, px = pixels(im, W, H), K = self.L.look;
      var base = new Float32Array(N * 3), alb = new Float32Array(N * 3), amb = self.L.views[v].ambient || [1, 1, 1];
      var aY = amb[0] * 0.2126 + amb[1] * 0.7152 + amb[2] * 0.0722, t = K.albedoTint, cap = K.albedoCap;
      for (var p = 0; p < N; p++) {
        var r = S2L[px[p * 4]], g = S2L[px[p * 4 + 1]], b = S2L[px[p * 4 + 2]], gray = (r * 0.2126 + g * 0.7152 + b * 0.0722) / aY;
        base[p * 3] = r; base[p * 3 + 1] = g; base[p * 3 + 2] = b;
        alb[p * 3] = Math.min(gray * (1 - t) + r / amb[0] * t, cap);
        alb[p * 3 + 1] = Math.min(gray * (1 - t) + g / amb[1] * t, cap);
        alb[p * 3 + 2] = Math.min(gray * (1 - t) + b / amb[2] * t, cap);
      }
      /* the photo through the same tone curve, so untouched blocks match lit ones exactly */
      var bytes = new Uint8ClampedArray(px), kn = K.knee, ik = 1 - kn;
      for (var q = 0; q < N * 3; q++) { var o2 = base[q]; if (o2 > kn) o2 = kn + ik * (1 - Math.exp(-(o2 - kn) / ik)); bytes[((q / 3) | 0) * 4 + q % 3] = LUT[(o2 * 4096) | 0]; }
      return { base: base, alb: alb, bytes: bytes, photo: im };
    });
  };
  /* spill map: 4 groups (bulb n % 4) stacked in one gray PNG at half size, sqrt-encoded.
     Also records which blocks the run touches (spill or bulb sprites). */
  House.prototype.spill = function (id) {
    var self = this;
    if (this.irr[id]) return this.irr[id];
    return this.irr[id] = img(this.dir + "irr-" + id + ".png?v=" + (this.L.stamp || 1)).then(function (im) {
      var w2 = self.w2, h2 = self.h2, px = pixels(im, w2, h2 * 4), R0 = self.L.runs[id], sc = R0.scale, maps = [];
      var bw = self.bw, touch = new Uint8Array(bw * self.bh);
      for (var g = 0; g < 4; g++) {
        var a = new Float32Array(w2 * h2), o = g * w2 * h2;
        for (var p = 0; p < w2 * h2; p++) {
          var q = px[(o + p) * 4];
          if (q) { q /= 255; a[p] = q * q * sc; var hx = p % w2, hy = (p / w2) | 0; touch[((hy * 2 / B) | 0) * bw + ((hx * 2 / B) | 0)] = 1; }
        }
        maps.push(a);
      }
      var K = self.L.look.kinds[R0.kind], R = Math.ceil(K.glow * 2.2) + 2, pts = R0.pts;
      for (var b = 0; b < pts.length; b += 2) {
        for (var yy = Math.max(0, pts[b + 1] - R); yy <= Math.min(self.H - 1, pts[b + 1] + R); yy += B / 2)
          for (var xx = Math.max(0, pts[b] - R); xx <= Math.min(self.W - 1, pts[b] + R); xx += B / 2) touch[((yy / B) | 0) * bw + ((xx / B) | 0)] = 1;
        touch[((Math.min(self.H - 1, pts[b + 1] + R) / B) | 0) * bw + ((Math.min(self.W - 1, pts[b] + R) / B) | 0)] = 1;
      }
      /* bilinear reads reach one half-size pixel past a touched block: grow by one block */
      var grown = new Uint8Array(touch.length);
      for (var by = 0; by < self.bh; by++) for (var bx = 0; bx < bw; bx++) if (touch[by * bw + bx])
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var ny = by + dy, nx = bx + dx; if (ny >= 0 && nx >= 0 && ny < self.bh && nx < bw) grown[ny * bw + nx] = 1; }
      return { maps: maps, touch: grown };
    });
  };
  /* one run's spill in one palette, colored, at half size (cached: toggling is then a cheap sum) */
  House.prototype.tinted = function (id, S, pal, cols) {
    var key = id + "|" + pal;
    if (this.tint[key]) return this.tint[key];
    var K = this.L.look, I = K.kinds[this.L.runs[id].kind].spillI, n = this.w2 * this.h2, out = new Float32Array(n * 3), k = cols.length;
    for (var g = 0; g < 4; g++) {
      var m = S.maps[g], c = cols[g % k], c0 = Math.pow(c[0], K.spillSat) * I, c1 = Math.pow(c[1], K.spillSat) * I, c2 = Math.pow(c[2], K.spillSat) * I;
      for (var p = 0; p < n; p++) { var a = m[p]; if (a) { out[p * 3] += a * c0; out[p * 3 + 1] += a * c1; out[p * 3 + 2] += a * c2; } }
    }
    return this.tint[key] = out;
  };
  House.prototype.sprite = function (kind, col) {
    var key = kind + col.join(",");
    if (this.sprites[key]) return this.sprites[key];
    var P = this.L.look.kinds[kind], R = Math.ceil(P.glow * 2.2), n = 2 * R + 1, s = new Float32Array(n * n * 3);
    var sat = 1 - Math.min.apply(null, col) / Math.max(Math.max.apply(null, col), 1e-6), w = P.white * (1 - sat) * (1 - sat);  /* colored bulbs stay colored */
    var cc = col.map(function (c) { return c * (1 - w) + w; });
    for (var y = -R; y <= R; y++) for (var x = -R; x <= R; x++) {
      var r = Math.sqrt(x * x + y * y), core = P.coreI * Math.exp(-Math.pow(r / P.core, 4));
      var halo = P.haloI * Math.exp(-(r / P.halo) * (r / P.halo)) + P.glowI * Math.exp(-(r / P.glow) * (r / P.glow));
      var o = ((y + R) * n + (x + R)) * 3;
      for (var k = 0; k < 3; k++) s[o + k] = core * cc[k] + halo * col[k];
    }
    return this.sprites[key] = { R: R, n: n, s: s };
  };
  /* linear light (0..8, 8192 steps per unit) -> shoulder -> sRGB byte, as one table */
  House.prototype.toneLUT = function () {
    if (this._tone) return this._tone;
    var kn = this.L.look.knee, ik = 1 - kn, T = new Uint8Array(65536);
    for (var i = 0; i < 65536; i++) { var o2 = i / 8192; if (o2 > kn) o2 = kn + ik * (1 - Math.exp(-(o2 - kn) / ik)); T[i] = LUT[Math.min(4096, (o2 * 4096) | 0)]; }
    return this._tone = T;
  };
  /* Draw view v with the given runs lit in palette pal onto canvas cv (sized to the photo). */
  House.prototype.draw = function (cv, v, runs, pal) {
    var self = this, L = this.L, K = L.look;
    runs = runs.filter(function (id) { return L.runs[id] && L.runs[id].view === v; });
    return Promise.all([this.view(v)].concat(runs.map(function (id) { return self.spill(id); }))).then(function (got) {
      var V = got[0], W = self.W, H = self.H, w2 = self.w2, N = W * H, bw = self.bw, bh = self.bh;
      if (!K.palettes[pal]) pal = "warm";
      var cols = K.palettes[pal].map(hexlin), k = cols.length;
      /* which blocks to recompute, and the summed spill */
      var touch = new Uint8Array(bw * bh), sp = new Float32Array(w2 * self.h2 * 3);
      runs.forEach(function (id, ri) {
        var S = got[ri + 1], t = self.tinted(id, S, pal, cols);
        for (var q = 0; q < touch.length; q++) touch[q] |= S.touch[q];
        for (var p = 0; p < sp.length; p++) sp[p] += t[p];
      });
      /* bulbs, full size (buffer reused between draws) */
      var add = self._add || (self._add = new Float32Array(N * 3)); add.fill(0);
      runs.forEach(function (id) {
        var R0 = L.runs[id], P = K.kinds[R0.kind], pts = R0.pts, vary = P.vary || 0;
        for (var n = 0, b = 0; b < pts.length; b += 2, n++) {
          var S = self.sprite(R0.kind, cols[n % k]), R = S.R, s = S.s, sn = S.n, tw = twinkle(n, vary), bx = pts[b] - R, by = pts[b + 1] - R;
          for (var y = 0; y < sn; y++) {
            var yy = by + y; if (yy < 0 || yy >= H) continue;
            var row = yy * W;
            for (var x = 0; x < sn; x++) {
              var xx = bx + x; if (xx < 0 || xx >= W) continue;
              var o = (row + xx) * 3, so = (y * sn + x) * 3;
              add[o] += s[so] * tw; add[o + 1] += s[so + 1] * tw; add[o + 2] += s[so + 2] * tw;
            }
          }
        }
      });
      /* compose touched blocks: base + albedo * spill (bilinear from half size) + bulbs, shoulder, sRGB */
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      var g2 = cv.getContext("2d"), out = self._out || (self._out = g2.createImageData(W, H)), d = out.data, base = V.base, alb = V.alb;
      d.set(V.bytes);
      var gain = K.albedoGain, cx0 = self.cx0, cx1 = self.cx1, cfx = self.cfx, TONE = self.toneLUT();
      for (var by2 = 0; by2 < bh; by2++) {
        var yA = by2 * B, yB = Math.min(yA + B, H);
        for (var bx2 = 0; bx2 < bw; bx2++) {
          if (!touch[by2 * bw + bx2]) continue;
          var xA = bx2 * B, xB = Math.min(xA + B, W);
          for (var y = yA; y < yB; y++) {
            var r0 = self.cy0[y] * w2, r1 = self.cy1[y] * w2, fy = self.cfy[y], gy = 1 - fy;
            for (var x = xA; x < xB; x++) {
              var fx = cfx[x], gx = 1 - fx, a = (r0 + cx0[x]) * 3, b2 = (r0 + cx1[x]) * 3, c = (r1 + cx0[x]) * 3, e = (r1 + cx1[x]) * 3;
              var p = y * W + x, p3 = p * 3, p4 = p * 4;
              var s0 = (sp[a] * gx + sp[b2] * fx) * gy + (sp[c] * gx + sp[e] * fx) * fy;
              var s1 = (sp[a + 1] * gx + sp[b2 + 1] * fx) * gy + (sp[c + 1] * gx + sp[e + 1] * fx) * fy;
              var s2 = (sp[a + 2] * gx + sp[b2 + 2] * fx) * gy + (sp[c + 2] * gx + sp[e + 2] * fx) * fy;
              var a0 = add[p3], a1 = add[p3 + 1], a2 = add[p3 + 2];
              if (s0 + s1 + s2 + a0 + a1 + a2 === 0) continue;   // nothing lands here: keep the photo pixel
              var o0 = (base[p3] + alb[p3] * s0 * gain + a0) * 8192, o1 = (base[p3 + 1] + alb[p3 + 1] * s1 * gain + a1) * 8192, o3 = (base[p3 + 2] + alb[p3 + 2] * s2 * gain + a2) * 8192;
              d[p4] = TONE[o0 < 65535 ? o0 | 0 : 65535]; d[p4 + 1] = TONE[o1 < 65535 ? o1 | 0 : 65535]; d[p4 + 2] = TONE[o3 < 65535 ? o3 | 0 : 65535];
            }
          }
        }
      }
      g2.putImageData(out, 0, 0);
      return cv;
    });
  };
  root.LightsRender = {
    load: function (dir) {
      return fetch(dir + "lights.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (L) { return new House(dir, L); });
    }
  };
})(window);
