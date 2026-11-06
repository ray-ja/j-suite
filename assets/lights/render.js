/* OBX Holiday Lights: draws a house's lights onto its photo, in any color.
   Same math as tools/lights-render/look.py (keep them in step):
     out_lin = base_lin + albedo * spill * albedoGain + bulbs, soft shoulder, then sRGB.
   Data comes from tools/lights-render/build.py: lights.json (bulb points, look), irr-<run>.png (spill maps).
   Usage:
     LightsRender.load("/assets/quotes/<slug>/lights/").then(function (house) {
       house.draw(canvas, "front", ["rf", "fu"], "warm");   // returns a promise
     });
   Plain script, no build step. */
(function (root) {
  "use strict";
  var LUT = new Uint8Array(4097);
  for (var i = 0; i <= 4096; i++) { var v = i / 4096; LUT[i] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); }
  var S2L = new Float32Array(256);
  for (var j = 0; j < 256; j++) { var c = j / 255; S2L[j] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function hexlin(h) { return [1, 3, 5].map(function (k) { return S2L[parseInt(h.substr(k, 2), 16)]; }); }
  function twinkle(n, v) { var x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return 1 - v * (x - Math.floor(x)); }
  function img(src) { return new Promise(function (ok, bad) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = bad; im.src = src; }); }
  function pixels(im, w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; var g = c.getContext("2d"); g.drawImage(im, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; }

  function House(dir, L) {
    this.dir = dir; this.L = L; this.W = L.w; this.H = L.h; this.w2 = (L.w + 1) >> 1; this.h2 = (L.h + 1) >> 1;
    this.views = {}; this.irr = {}; this.sprites = {};
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
      return { base: base, alb: alb, photo: im };
    });
  };
  /* spill map: 4 groups (bulb n % 4) stacked in one gray PNG at half size, sqrt-encoded */
  House.prototype.spill = function (id) {
    var self = this;
    if (this.irr[id]) return this.irr[id];
    return this.irr[id] = img(this.dir + "irr-" + id + ".png?v=" + (this.L.stamp || 1)).then(function (im) {
      var w2 = self.w2, h2 = self.h2, px = pixels(im, w2, h2 * 4), sc = self.L.runs[id].scale, out = [];
      for (var g = 0; g < 4; g++) {
        var a = new Float32Array(w2 * h2), o = g * w2 * h2;
        for (var p = 0; p < w2 * h2; p++) { var q = px[(o + p) * 4] / 255; a[p] = q * q * sc; }
        out.push(a);
      }
      return out;
    });
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
  /* Draw view v with the given runs lit in palette pal onto canvas cv (sized to the photo). */
  House.prototype.draw = function (cv, v, runs, pal) {
    var self = this, L = this.L, K = L.look;
    runs = runs.filter(function (id) { return L.runs[id] && L.runs[id].view === v; });
    return Promise.all([this.view(v)].concat(runs.map(function (id) { return self.spill(id); }))).then(function (got) {
      var V = got[0], W = self.W, H = self.H, w2 = self.w2, h2 = self.h2, N = W * H;
      var cols = (K.palettes[pal] || K.palettes.warm).map(hexlin), k = cols.length;
      var scol = cols.map(function (c) { return c.map(function (x) { return Math.pow(x, K.spillSat); }); });
      /* spill at half size */
      var sp = new Float32Array(w2 * h2 * 3);
      runs.forEach(function (id, ri) {
        var maps = got[ri + 1], I = K.kinds[L.runs[id].kind].spillI;
        for (var g = 0; g < 4; g++) {
          var m = maps[g], c = scol[g % k], c0 = c[0] * I, c1 = c[1] * I, c2 = c[2] * I;
          for (var p = 0; p < w2 * h2; p++) { var a = m[p]; if (a) { sp[p * 3] += a * c0; sp[p * 3 + 1] += a * c1; sp[p * 3 + 2] += a * c2; } }
        }
      });
      /* bulbs, full size */
      var add = new Float32Array(N * 3);
      runs.forEach(function (id) {
        var R0 = L.runs[id], P = K.kinds[R0.kind], pts = R0.pts, vary = P.vary || 0;
        for (var n = 0, b = 0; b < pts.length; b += 2, n++) {
          var S = self.sprite(R0.kind, cols[n % k]), R = S.R, tw = twinkle(n, vary), bx = pts[b] - R, by = pts[b + 1] - R;
          for (var y = 0; y < S.n; y++) {
            var yy = by + y; if (yy < 0 || yy >= H) continue;
            for (var x = 0; x < S.n; x++) {
              var xx = bx + x; if (xx < 0 || xx >= W) continue;
              var o = (yy * W + xx) * 3, so = (y * S.n + x) * 3;
              add[o] += S.s[so] * tw; add[o + 1] += S.s[so + 1] * tw; add[o + 2] += S.s[so + 2] * tw;
            }
          }
        }
      });
      /* compose: base + albedo * spill (bilinear from half size) + bulbs, shoulder, sRGB */
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      var g2 = cv.getContext("2d"), out = g2.createImageData(W, H), d = out.data, base = V.base, alb = V.alb;
      var gain = K.albedoGain, kn = K.knee, ik = 1 - kn;
      for (var y = 0; y < H; y++) {
        var sy = Math.min(Math.max((y + 0.5) / 2 - 0.5, 0), h2 - 1), y0 = sy | 0, y1 = Math.min(y0 + 1, h2 - 1), fy = sy - y0;
        for (var x = 0; x < W; x++) {
          var sx = Math.min(Math.max((x + 0.5) / 2 - 0.5, 0), w2 - 1), x0 = sx | 0, x1 = Math.min(x0 + 1, w2 - 1), fx = sx - x0;
          var p = y * W + x, a = (y0 * w2 + x0) * 3, b2 = (y0 * w2 + x1) * 3, c = (y1 * w2 + x0) * 3, e = (y1 * w2 + x1) * 3;
          for (var ch = 0; ch < 3; ch++) {
            var s = (sp[a + ch] * (1 - fx) + sp[b2 + ch] * fx) * (1 - fy) + (sp[c + ch] * (1 - fx) + sp[e + ch] * fx) * fy;
            var o2 = base[p * 3 + ch] + alb[p * 3 + ch] * s * gain + add[p * 3 + ch];
            if (o2 > kn) o2 = kn + ik * (1 - Math.exp(-(o2 - kn) / ik));
            d[p * 4 + ch] = LUT[(o2 * 4096) | 0];
          }
          d[p * 4 + 3] = 255;
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
