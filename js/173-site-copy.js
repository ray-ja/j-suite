/* ── 🌐 WEBSITES: edit the words on the live sites from inside the app. ────────────────────────────────
   Ray, 2026-09-14: "I don't really need to code myself. I just want to do the text."
   The page renders in an iframe exactly as it looks live (its own CSS and images load from the live
   site); every text block is contenteditable in plaintext-only mode, so he can change WORDS and nothing
   else. Publish sends {id, orig, inner} per changed block; the server keeps the original tags byte-for-
   byte, refuses anything structural, writes the file, commits under his name, pushes and deploys.
   Owner only, and it rides the settings "Websites" section so it lives with Keys and Backups. */
(function () {
  if (typeof window === "undefined") return;
  var ST = { sites: [], site: "", page: "", blocks: {}, changed: {}, url: "", job: null };

  function api(path, opts) {
    var base = (S.sync && S.sync.url) || "", tok = (S.sync && S.sync.token) || "";
    return fetch(base + path, Object.assign({ headers: Object.assign({ "Content-Type": "application/json" }, tok ? { Authorization: "Bearer " + tok } : {}) }, opts || {})).then(function (r) { return r.json(); });
  }
  function $(id) { return document.getElementById(id); }

  function panelHtml() {
    return '<h2>🌐 Websites</h2>' +
      '<p class="muted" style="margin:0 4px 10px;font-size:13.5px">Change the words on any page of any site. Tap a piece of text in the preview, type, then <b>Publish</b>. Only the words can change; links, buttons and layout stay put. Every publish is saved to the site\'s history under your name.</p>' +
      '<div class="card" style="padding:12px 14px">' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
          '<select id="sc_site" onchange="siteCopyPickSite(this.value)" style="flex:1;min-width:160px"><option value="">Loading sites…</option></select>' +
          '<select id="sc_page" onchange="siteCopyPickPage(this.value)" style="flex:1;min-width:160px" disabled><option value="">Page</option></select>' +
        '</div>' +
        '<div id="sc_bar" style="display:none;margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
          '<span id="sc_status" class="sub" style="flex:1;min-width:140px">Tap any text to edit it.</span>' +
          '<button class="btn ghost" onclick="siteCopyReload()">↺ Discard</button>' +
          '<button class="btn" id="sc_pub" onclick="siteCopyPublish()" disabled>Publish</button>' +
          '<a class="btn ghost" id="sc_live" href="#" target="_blank" rel="noopener" style="display:none">View live ↗</a>' +
        '</div>' +
        '<div id="sc_log" class="sub" style="display:none;margin-top:8px;white-space:pre-wrap;font-size:12.5px"></div>' +
        '<div id="sc_hero" style="display:none;margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:10px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b>Hero graphic</b><span class="sub" style="font-size:12.5px">Drag the sliders; the preview moves live. Publish when it looks right.</span></div>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px 16px;margin-top:8px;font-size:13px">' +
            '<label>Left / right <span id="hm_mx_v"></span><input type="range" id="hm_mx" min="-80" max="60" step="1" oninput="siteHeroPreview()" style="width:100%"></label>' +
            '<label>Up / down <span id="hm_my_v"></span><input type="range" id="hm_my" min="-80" max="60" step="1" oninput="siteHeroPreview()" style="width:100%"></label>' +
            '<label>Size <span id="hm_mh_v"></span><input type="range" id="hm_mh" min="40" max="260" step="2" oninput="siteHeroPreview()" style="width:100%"></label>' +
            '<label>Opacity <span id="hm_mo_v"></span><input type="range" id="hm_mo" min="0" max="80" step="1" oninput="siteHeroPreview()" style="width:100%"></label>' +
          '</div>' +
          '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn" id="hm_pub" onclick="siteHeroPublish()">Publish graphic</button><button class="btn ghost" onclick="siteHeroReset()">Back to saved</button></div>' +
        '</div>' +
        '<iframe id="sc_frame" title="Page preview" style="display:none;width:100%;height:68vh;min-height:420px;border:1px solid var(--line);border-radius:10px;background:#fff;margin-top:10px"></iframe>' +
      '</div>';
  }

  /* rData() writes view.innerHTML itself (it returns nothing), so our section is appended to the view
     right after it runs; secSplit runs after the screen function and carves it into its own subpage */
  var _rData = window.rData;
  if (typeof _rData === "function") {
    window.rData = function () {
      var r = _rData.apply(this, arguments);
      try {
        var v = document.getElementById("view");
        if (v && typeof isOwner === "function" && isOwner()) { v.insertAdjacentHTML("beforeend", panelHtml()); setTimeout(siteCopyInit, 0); }
      } catch (e) {}
      return r;
    };
  }

  function siteCopyInit() {
    var sel = $("sc_site"); if (!sel || sel.getAttribute("data-ready")) return;
    sel.setAttribute("data-ready", "1");
    api("/api/sites").then(function (d) {
      if (!d || !d.ok) { sel.innerHTML = '<option value="">' + (d && d.error === "forbidden" ? "Owner only" : "Server unavailable") + '</option>'; return; }
      ST.sites = d.sites || [];
      sel.innerHTML = '<option value="">Site…</option>' + ST.sites.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.label) + '</option>'; }).join("");
      var remembered = ""; try { remembered = localStorage.getItem("jra_sitecopy_site") || ""; } catch (e) {}
      if (remembered && ST.sites.some(function (s) { return s.id === remembered; })) { sel.value = remembered; siteCopyPickSite(remembered); }
    }).catch(function () { sel.innerHTML = '<option value="">Server unavailable</option>'; });
  }

  window.siteCopyPickSite = function (id) {
    ST.site = id; ST.page = ""; var ps = $("sc_page"); if (!ps) return;
    try { localStorage.setItem("jra_sitecopy_site", id); } catch (e) {}
    var site = ST.sites.filter(function (s) { return s.id === id; })[0];
    if (!site) { ps.innerHTML = '<option value="">Page</option>'; ps.disabled = true; return; }
    ps.disabled = false;
    /* the list is the site's own link tree: Home, then the pages Home links to in nav order, then theirs */
    ps.innerHTML = '<option value="">Page…</option>' + site.pages.map(function (p) {
      var pad = ""; for (var i = 0; i < (p.depth || 0); i++) pad += "\u00a0\u00a0\u00a0\u00a0";
      return '<option value="' + esc(p.file) + '">' + pad + (p.depth ? "\u2514 " : "") + esc(p.title) + (p.orphan ? " (not linked from any page)" : "") + '</option>';
    }).join("");
    $("sc_frame").style.display = "none"; $("sc_bar").style.display = "none";
  };

  window.siteCopyPickPage = function (file) { ST.page = file; if (file) siteCopyLoad(); };
  window.siteCopyReload = function () { if (Object.keys(ST.changed).length && !confirm("Throw away your unpublished changes?")) return; siteCopyLoad(); };

  function setStatus(t, tone) { var s = $("sc_status"); if (s) { s.textContent = t; s.style.color = tone === "bad" ? "var(--danger)" : tone === "good" ? "var(--good)" : ""; } }

  function siteCopyLoad() {
    var fr = $("sc_frame"), bar = $("sc_bar"); if (!fr) return;
    ST.changed = {}; ST.blocks = {}; $("sc_pub").disabled = true; $("sc_log").style.display = "none";
    setStatus("Loading…");
    api("/api/sites/page?site=" + encodeURIComponent(ST.site) + "&page=" + encodeURIComponent(ST.page)).then(function (d) {
      if (!d || !d.ok) { setStatus((d && d.error) || "Could not load the page", "bad"); return; }
      (d.blocks || []).forEach(function (b) { ST.blocks[b.id] = b; });
      ST.url = d.url;
      var live = $("sc_live"); live.href = d.url + "/" + ST.page.replace(/\.html$/, "").replace(/^index$/, ""); live.style.display = "";
      var editorCss = '<style id="sc_editor_css">' +
        '[data-ce]{outline:2px dashed rgba(184,137,74,.55);outline-offset:3px;cursor:text;transition:outline-color .15s}' +
        '[data-ce]:hover{outline-color:#b8894a}[data-ce]:focus{outline:3px solid #b8894a;outline-offset:3px;background:rgba(184,137,74,.08)}' +
        '[data-ce][data-changed]{outline-color:#2a9d5c;background:rgba(42,157,92,.07)}' +
        'html{scroll-behavior:auto}</style>';
      var editorJs = '<script>(function(){' +
        'document.querySelectorAll("[data-ce]").forEach(function(el){el.setAttribute("contenteditable","plaintext-only");el.setAttribute("spellcheck","true");});' +
        'document.addEventListener("click",function(e){var a=e.target.closest("a,button,label,summary");if(a&&!a.hasAttribute("data-ce")&&!a.closest("[data-ce]")){e.preventDefault();}else if(a&&a.tagName==="A"){e.preventDefault();}},true);' +
        'document.addEventListener("submit",function(e){e.preventDefault();},true);' +
        'document.addEventListener("input",function(e){var el=e.target.closest&&e.target.closest("[data-ce]");if(!el)return;el.setAttribute("data-changed","1");parent.postMessage({sc:"changed",id:el.getAttribute("data-ce"),inner:el.innerHTML},"*");});' +
        '})();<\/script>';
      var html = d.html.replace(/<head([^>]*)>/i, '<head$1><base href="' + d.url + '/" target="_parent">' + editorCss);
      html = html.replace(/<\/body>/i, editorJs + "</body>");
      fr.srcdoc = html; fr.style.display = ""; bar.style.display = "flex";
      ST.hero = d.heroMark || null; siteHeroInit();
      setStatus("Tap any text to edit it. " + Object.keys(ST.blocks).length + " editable blocks on this page.");
    }).catch(function () { setStatus("Could not load the page", "bad"); });
  }

  window.addEventListener("message", function (e) {
    var m = e.data; if (!m || m.sc !== "changed") return;
    var b = ST.blocks[m.id]; if (!b) return;
    if (m.inner === b.inner) delete ST.changed[m.id]; else ST.changed[m.id] = m.inner;
    var n = Object.keys(ST.changed).length;
    $("sc_pub").disabled = !n; $("sc_pub").textContent = n ? "Publish " + n + " change" + (n === 1 ? "" : "s") : "Publish";
    if (n) setStatus(n + " unpublished change" + (n === 1 ? "" : "s") + ".");
  });

  window.siteCopyPublish = function () {
    var ids = Object.keys(ST.changed); if (!ids.length) return;
    var edits = ids.map(function (id) { return { id: +id, orig: ST.blocks[id].inner, inner: ST.changed[id] }; });
    $("sc_pub").disabled = true; setStatus("Publishing…");
    var log = $("sc_log"); log.style.display = ""; log.textContent = "Saving " + edits.length + " change" + (edits.length === 1 ? "" : "s") + "…";
    api("/api/sites/publish", { method: "POST", body: JSON.stringify({ site: ST.site, page: ST.page, edits: edits }) }).then(function (d) {
      if (!d || !d.ok) {
        var why = (d && d.errors && d.errors.length) ? d.errors.map(function (x) { return "• " + x.reason; }).join("\n") : ((d && d.error) || "Publish failed");
        log.textContent = why; setStatus("Not published. See the note below.", "bad"); $("sc_pub").disabled = false; return;
      }
      if (!d.job) { log.textContent = "Nothing changed."; setStatus("Nothing to publish."); return; }
      ST.job = d.job; pollJob();
    }).catch(function () { setStatus("Publish failed (server unreachable)", "bad"); $("sc_pub").disabled = false; });
  };

  function pollJob() {
    api("/api/sites/job?id=" + encodeURIComponent(ST.job)).then(function (d) {
      var log = $("sc_log"); if (!d || !d.ok) { log.textContent = "Lost track of the publish job."; return; }
      var names = { stage: "Saved", commit: "Recorded in history", push: "Backed up to GitHub", deploy: "Sent to the live site" };
      log.textContent = d.steps.map(function (s) { return (s.ok === null ? "⏳ " : s.ok ? "✓ " : "✗ ") + (names[s.name] || s.name) + (s.ok === false ? "\n   " + (s.out || "").trim().split("\n").slice(-3).join("\n   ") : ""); }).join("\n");
      if (d.state === "running") return setTimeout(pollJob, 1500);
      if (d.state === "done" || d.state === "done-unpushed") {
        setStatus("Live. It can take a minute to show everywhere.", "good");
        if (d.state === "done-unpushed") log.textContent += "\n(The GitHub backup did not go through; the site is live. Tell Claude.)";
        ST.changed = {}; $("sc_pub").textContent = "Publish";
        Object.keys(ST.blocks).forEach(function (id) { /* refresh baseline from the frame so a second round of edits diffs cleanly */
          try { var el = $("sc_frame").contentDocument.querySelector('[data-ce="' + id + '"]'); if (el) { ST.blocks[id].inner = el.innerHTML; el.removeAttribute("data-changed"); } } catch (e) {}
        });
        setTimeout(siteCopyLoad, 1200);
      } else { setStatus("Publish failed. Nothing is live yet; tell Claude.", "bad"); $("sc_pub").disabled = false; }
    });
  }
  /* ── hero graphic sliders: live preview via CSS variables on the iframe's .hero-mark, publish writes the same four numbers ── */
  var HM = ["mx", "my", "mh", "mo"];
  function heroEl() { try { return $("sc_frame").contentDocument.querySelector(".hero-mark"); } catch (e) { return null; } }
  function siteHeroInit() {
    var box = $("sc_hero"); if (!box) return;
    if (!ST.hero) { box.style.display = "none"; return; }
    box.style.display = "";
    HM.forEach(function (k) { var el = $("hm_" + k); el.value = k === "mo" ? Math.round(ST.hero[k] * 100) : ST.hero[k]; });
    siteHeroPreview(false);
  }
  window.siteHeroPreview = function (apply) {
    var v = {}; HM.forEach(function (k) { v[k] = +$("hm_" + k).value; });
    $("hm_mx_v").textContent = v.mx + "%"; $("hm_my_v").textContent = v.my + "%"; $("hm_mh_v").textContent = v.mh + "%"; $("hm_mo_v").textContent = v.mo + "%";
    var el = heroEl(); if (!el || apply === false) return;
    el.style.setProperty("--mx", v.mx + "%"); el.style.setProperty("--my", v.my + "%"); el.style.setProperty("--mh", v.mh + "%"); el.style.setProperty("--mo", String(v.mo / 100));
  };
  window.siteHeroReset = function () { if (ST.hero) { siteHeroInit(); var el = heroEl(); if (el) HM.forEach(function (k) { el.style.setProperty("--" + k, k === "mo" ? String(ST.hero[k]) : ST.hero[k] + "%"); }); } };
  window.siteHeroPublish = function () {
    var v = { site: ST.site, page: ST.page }; HM.forEach(function (k) { v[k] = k === "mo" ? (+$("hm_" + k).value) / 100 : +$("hm_" + k).value; });
    $("hm_pub").disabled = true; setStatus("Publishing the graphic…");
    var log = $("sc_log"); log.style.display = ""; log.textContent = "Saving graphic placement…";
    api("/api/sites/heromark", { method: "POST", body: JSON.stringify(v) }).then(function (d) {
      $("hm_pub").disabled = false;
      if (!d || !d.ok) { log.textContent = (d && d.error) || "Publish failed"; setStatus("Not published.", "bad"); return; }
      if (!d.job) { log.textContent = "Nothing changed."; setStatus("Nothing to publish."); return; }
      ST.hero = d.values || ST.hero; ST.job = d.job; pollJob();
    }).catch(function () { $("hm_pub").disabled = false; setStatus("Publish failed (server unreachable)", "bad"); });
  };
  window.siteCopyInit = siteCopyInit;
})();
