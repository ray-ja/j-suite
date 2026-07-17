/* js/115 — DRAW-TO-SCOPE plant marker.
   The owner opens a survey photo and draws a ring around ONE plant; the tool crops that region and sends JUST it to
   Cap (POST /api/org-ai/read-plant, focus mode) → one reviewable line item, tagged with the circle so you know which
   plant it is. Reuse the SAME photo to ring several plants. This is the owner-SCOPED alternative to auto-reading a
   whole photo, which over-counts the same plant seen from many angles (a small lot became 99 detections / ~$9k).
   Fully self-contained. The overlay lives OUTSIDE render()'s #view (appended to <body>), so the app's frequent
   re-renders never wipe an in-progress drawing. Owner/admin only (rcptFinFull), same gate as the survey's AI. */
(function () {
  var PM = null;   // active state: {photoId, url, circle:{cx,cy,rx,ry}|null, marked:[circle...], busy}

  function el(id) { return document.getElementById(id); }
  function svNow() { return (typeof landCurrent === "function") ? landCurrent() : null; }
  function E(s) { return (typeof esc === "function") ? esc(s) : String(s == null ? "" : s); }

  // rings already placed on THIS photo (drawn dim so you don't double-mark the same plant)
  function marksFor(photoId) {
    var sv = svNow(); if (!sv) return [];
    return (sv.items || []).filter(function (it) { return it && !it.deleted && it.photoId === photoId && it.circle; })
      .map(function (it) { return it.circle; });
  }

  window.landMarkOpen = function (photoId) {
    if (!(typeof rcptFinFull === "function" ? rcptFinFull() : false)) { if (typeof alert === "function") alert("Only an owner or admin can mark plants."); return; }
    var url = (typeof jsUploadUrl === "function") ? jsUploadUrl(photoId) : "";
    if (!url) { if (typeof alert === "function") alert("Photo not available."); return; }
    PM = { photoId: photoId, url: url, circle: null, marked: marksFor(photoId), busy: false };
    landMarkRender();
  };

  window.landMarkClose = function () {
    var o = el("pmwrap"); if (o && o.parentNode) o.parentNode.removeChild(o);
    PM = null;
    if (typeof render === "function") render();   // refresh the survey list underneath with the items we just added
  };

  function ringHTML(c, live) {
    var color = live ? "#ffd400" : "rgba(120,220,140,.95)";
    var sw = live ? 3 : 2;
    return '<div style="position:absolute;left:' + (c.cx * 100).toFixed(2) + '%;top:' + (c.cy * 100).toFixed(2) + '%;'
      + 'width:' + (c.rx * 200).toFixed(2) + '%;height:' + (c.ry * 200).toFixed(2) + '%;transform:translate(-50%,-50%);'
      + 'border:' + sw + 'px solid ' + color + ';border-radius:50%;box-shadow:0 0 0 2px rgba(0,0,0,.55);pointer-events:none"></div>';
  }
  function drawOverlay() {
    var ov = el("pmoverlay"); if (!ov || !PM) return;
    var h = PM.marked.map(function (c) { return ringHTML(c, false); }).join("");
    if (PM.circle) h += ringHTML(PM.circle, true);
    ov.innerHTML = h;
  }

  function landMarkRender() {
    if (!PM) return;
    var o = el("pmwrap");
    if (!o) {
      o = document.createElement("div");
      o.id = "pmwrap";
      o.style.cssText = "position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.93);display:flex;flex-direction:column;overscroll-behavior:contain";
      document.body.appendChild(o);
    }
    o.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:12px 14px;color:#fff">'
        + '<div style="flex:1;font-weight:800;font-size:16px">✏️ Circle a plant</div>'
        + '<div id="pmcount" style="font-size:13px;opacity:.8">' + PM.marked.length + ' marked</div>'
        + '<button onclick="landMarkClose()" style="background:#fff;color:#111;border:0;border-radius:8px;padding:8px 14px;font-weight:700;font-size:14px">Done</button>'
      + '</div>'
      + '<div id="pmstage" style="flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;padding:0 10px 10px;-webkit-overflow-scrolling:touch">'
        + '<div id="pmbox" style="position:relative;display:inline-block;line-height:0;touch-action:none">'
          + '<img id="pmimg" src="' + E(PM.url) + '" crossorigin="anonymous" draggable="false" style="max-width:100%;max-height:78vh;width:auto;height:auto;display:block;border-radius:8px;background:#000;user-select:none;-webkit-user-drag:none">'
          + '<div id="pmoverlay" style="position:absolute;inset:0;pointer-events:none"></div>'
        + '</div>'
      + '</div>'
      + '<div style="padding:12px 14px;color:#fff;display:flex;flex-direction:column;gap:8px">'
        + '<div id="pmhint" style="font-size:13px;opacity:.85;text-align:center;white-space:normal">Press on a plant and drag out to draw a ring around it. Reuse this photo to circle each plant.</div>'
        + '<div style="display:flex;gap:8px">'
          + '<button id="pmredo" onclick="landMarkClear()" style="flex:0 0 auto;background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:9px;padding:12px 14px;font-weight:600;font-size:14px" disabled>↺ Redo</button>'
          + '<button id="pmread" onclick="landMarkRead()" style="flex:1;background:#1a7f37;color:#fff;border:0;border-radius:9px;padding:13px;font-weight:800;font-size:15px;opacity:.5" disabled>🔍 Read this plant</button>'
        + '</div>'
      + '</div>';
    drawOverlay();
    wire();
  }

  window.landMarkClear = function () {
    if (!PM) return; PM.circle = null; drawOverlay();
    var rd = el("pmread"), re = el("pmredo");
    if (rd) { rd.disabled = true; rd.style.opacity = ".5"; }
    if (re) re.disabled = true;
    var hint = el("pmhint"); if (hint) hint.textContent = "Press on a plant and drag out to draw a ring around it.";
  };

  function wire() {
    var box = el("pmbox"), img = el("pmimg"); if (!box || !img) return;
    var drawing = false, cx = 0, cy = 0;
    function frac(e) {
      var r = img.getBoundingClientRect();
      return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
    }
    box.onpointerdown = function (e) {
      if (PM.busy) return;
      e.preventDefault();
      var f = frac(e); cx = f.x; cy = f.y; drawing = true;
      try { box.setPointerCapture(e.pointerId); } catch (_e) {}
      PM.circle = { cx: cx, cy: cy, rx: 0.01, ry: 0.01 }; drawOverlay();
    };
    box.onpointermove = function (e) {
      if (!drawing) return;
      var f = frac(e);
      PM.circle = { cx: cx, cy: cy, rx: Math.max(0.01, Math.abs(f.x - cx)), ry: Math.max(0.01, Math.abs(f.y - cy)) };
      drawOverlay();
    };
    box.onpointerup = function () {
      if (!drawing) return; drawing = false;
      var ok = PM.circle && (PM.circle.rx > 0.02 || PM.circle.ry > 0.02);
      var rd = el("pmread"), re = el("pmredo");
      if (ok) { if (rd) { rd.disabled = false; rd.style.opacity = "1"; } if (re) re.disabled = false; }
      else landMarkClear();
    };
    box.onpointercancel = function () { drawing = false; };
  }

  // crop the circled bounding box (+padding) out of the ORIGINAL image → a jpeg data URL (capped small for the POST)
  function crop(cb) {
    var c = PM && PM.circle; if (!c) { cb(null); return; }
    var im = new Image(); im.crossOrigin = "anonymous";
    im.onload = function () {
      var nw = im.naturalWidth || im.width, nh = im.naturalHeight || im.height;
      var pad = 0.16, rx = c.rx * (1 + pad), ry = c.ry * (1 + pad);
      var x0 = Math.max(0, c.cx - rx) * nw, y0 = Math.max(0, c.cy - ry) * nh;
      var x1 = Math.min(1, c.cx + rx) * nw, y1 = Math.min(1, c.cy + ry) * nh;
      var sw = Math.max(8, Math.round(x1 - x0)), sh = Math.max(8, Math.round(y1 - y0));
      var scale = Math.min(1, 900 / Math.max(sw, sh));
      var cw = Math.max(8, Math.round(sw * scale)), ch = Math.max(8, Math.round(sh * scale));
      var cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
      try {
        cv.getContext("2d").drawImage(im, Math.round(x0), Math.round(y0), sw, sh, 0, 0, cw, ch);
        cb(cv.toDataURL("image/jpeg", 0.85));
      } catch (_e) { cb(null); }
    };
    im.onerror = function () { cb(null); };
    im.src = PM.url;
  }

  window.landMarkRead = function () {
    if (!PM || !PM.circle || PM.busy) return;
    PM.busy = true;
    var rd = el("pmread"), hint = el("pmhint");
    var circle = { cx: PM.circle.cx, cy: PM.circle.cy, rx: PM.circle.rx, ry: PM.circle.ry };
    if (rd) { rd.disabled = true; rd.textContent = "🔍 Reading…"; rd.style.opacity = ".7"; }
    if (hint) hint.textContent = "Cap is identifying the plant…";
    crop(function (dataUrl) {
      function fail(msg) {
        PM.busy = false;
        if (rd) { rd.textContent = "🔍 Read this plant"; rd.disabled = false; rd.style.opacity = "1"; }
        if (hint) hint.textContent = msg;
      }
      if (!dataUrl) { fail("Couldn't read that spot — try again."); return; }
      var base = ((S.sync && S.sync.url) || location.origin).replace(/\/+$/, "");
      var tok = (S.sync && S.sync.token) || "";
      fetch(base + "/api/org-ai/read-plant", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
        body: JSON.stringify({ org: S.biz, image: dataUrl })
      }).then(function (r) { return r.json().catch(function () { return null; }); }).then(function (j) {
        var raw = j && j.suggested && Array.isArray(j.suggested.items) ? j.suggested.items[0] : null;
        if (!raw) { fail("Couldn't identify that — try a tighter circle." + (j && j.error ? " (" + j.error + ")" : "")); return; }
        var sv = svNow(); if (!sv) { fail("Survey closed."); return; }
        var it = landItemFromSuggested(PM.photoId, raw);
        it.spot = { x: circle.cx, y: circle.cy };   // marker center = where you circled
        it.circle = circle;                          // so we can redraw the ring + know it was owner-scoped
        it.markScoped = true;
        sv.items.push(it);
        if (typeof touch === "function") touch(sv);
        if (typeof save === "function") save();
        PM.marked.push(circle); PM.circle = null; PM.busy = false;
        drawOverlay();
        var cnt = el("pmcount"); if (cnt) cnt.textContent = PM.marked.length + " marked";
        if (rd) { rd.textContent = "🔍 Read this plant"; rd.disabled = true; rd.style.opacity = ".5"; }
        var re = el("pmredo"); if (re) re.disabled = true;
        if (hint) hint.textContent = "✓ Added: " + (raw.plant || "plant") + " · " + (raw.service || "care") + ". Circle the next plant.";
      }).catch(function (e) { fail("Cap hit an error — " + (e && e.message ? e.message : "try again") + "."); });
    });
  };
})();
