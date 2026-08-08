/* ---------- PRODUCT BACK END — editor, compare, importer (js/130) ---------------------------------
   The write half of js/129. Kept in its own file so the catalogue page stays a page and this stays a
   set of tools; neither grows into the monolith we split the app up to avoid.

   Three jobs:
     · EDIT     — one SKU, every field, including the list of sources with the price and the URL.
                  The source list is the point: a standard cost you cannot trace is just a rumour.
     · COMPARE  — two or more SKUs side by side. Ray asked for this by name; picking a camera means
                  reading four of them against each other, not opening four records in turn.
     · IMPORT   — paste the JSON a research agent produced and review it BEFORE it lands. Nothing is
                  written until he has looked at it, because the whole quoting system is about to sit
                  on top of these numbers. */

var PROD_IMPORT = null;

function prodBlank() {
  return { id: "sku_" + (typeof uid === "function" ? uid() : String(Date.now())),
           sku: "", cat: "", name: "", brand: "", model: "", specs: "",
           cost: 0, costNote: "", sources: [], sell: 0, sellNote: "",
           laborHours: 0, tier: "", stock: 0, status: "active", confidence: "", notes: "",
           deleted: false };
}
function prodById(id) { return (D().catalogSkus || []).find(function (p) { return p && p.id === id; }); }

/* ---- edit ---- */
if (typeof window !== "undefined") window.prodEdit = function (id) {
  var p = id ? prodById(id) : null, isNew = !p;
  if (!p) p = prodBlank();
  var m = (typeof money === "function") ? money : function (n) { return "$" + (+n || 0).toFixed(0); };
  var f = function (k, label, type, ph) {
    return '<div style="margin-bottom:8px"><div class="sub" style="font-size:11px">' + label + '</div>'
      + '<input ' + (type === "num" ? 'type="number" step="any" inputmode="decimal" ' : "")
      + 'value="' + esc(p[k] == null ? "" : String(p[k])) + '"'
      + (ph ? ' placeholder="' + esc(ph) + '"' : "")
      + ' oninput="PROD_DRAFT[' + JSON.stringify(k) + ']=this.value"'
      + ' onkeydown="if(event.key===\'Enter\')this.blur()"></div>';
  };
  window.PROD_DRAFT = {};
  window.PROD_EDIT_ID = p.id; window.PROD_EDIT_NEW = isNew;

  var srcHTML = (p.sources || []).map(function (s, i) {
    return '<div class="row" style="gap:5px;align-items:center;margin-top:3px">'
      + '<div class="grow" style="font-size:12px;white-space:normal">' + esc(s.vendor || "source")
      + ' — <b>' + m(+s.price || 0) + '</b>'
      + (s.url ? ' <a href="' + esc(s.url) + '" target="_blank" rel="noopener">link</a>' : "") + '</div>'
      + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="prodDelSource(' + i + ')">✕</button></div>';
  }).join("");

  modal(isNew ? "New product" : esc(p.name || p.sku || "Product"),
    f("sku", "Our SKU", "", "JAM-NET-AP-U7PRO")
    + f("name", "Name", "", "UniFi U7 Pro access point")
    + '<div class="row" style="gap:8px">'
    + '<div class="grow">' + f("cat", "Category", "", "Networking") + '</div>'
    + '<div class="grow">' + f("tier", "Tier", "", "unifi") + '</div></div>'
    + '<div class="row" style="gap:8px">'
    + '<div class="grow">' + f("brand", "Brand", "") + '</div>'
    + '<div class="grow">' + f("model", "Model", "") + '</div></div>'
    + f("specs", "Specs that decide a job", "", "wifi 7, PoE+, 2.5G, indoor")
    + '<div style="border-top:1px solid var(--line);margin:10px 0 8px;padding-top:8px">'
    + '<div class="sub" style="font-size:11px;font-weight:800">MONEY</div></div>'
    + '<div class="row" style="gap:8px">'
    + '<div class="grow">' + f("cost", "Standard cost (what we assume we pay)", "num") + '</div>'
    + '<div class="grow">' + f("sell", "Our price", "num") + '</div></div>'
    + f("costNote", "Cost basis", "", "ADI account price, Jul 2026")
    + f("sellNote", "Why this price", "")
    + '<div class="row" style="gap:8px">'
    + '<div class="grow">' + f("laborHours", "Install hours", "num") + '</div>'
    + '<div class="grow">' + f("stock", "On hand", "num") + '</div></div>'
    + '<div style="border-top:1px solid var(--line);margin:10px 0 8px;padding-top:8px">'
    + '<div class="sub" style="font-size:11px;font-weight:800">WHERE WE GET IT</div>'
    + '<div class="sub" style="font-size:11px;white-space:normal">A standard cost you cannot trace is a rumour. Log the source.</div>'
    + srcHTML
    + '<div class="row" style="gap:5px;margin-top:6px">'
    + '<input id="psV" placeholder="vendor" style="flex:2 1 0;min-width:0">'
    + '<input id="psP" placeholder="price" type="number" step="any" inputmode="decimal" style="flex:1 1 0;min-width:0">'
    + '</div><input id="psU" placeholder="url (optional)" style="margin-top:5px">'
    + '<button class="btn ghost sm" style="margin-top:5px;width:100%" onclick="prodAddSource()">＋ Add source</button></div>'
    + '<div style="margin-bottom:8px"><div class="sub" style="font-size:11px">Status</div>'
    + '<select onchange="PROD_DRAFT.status=this.value">'
    + ["active", "eval", "dropped"].map(function (s) {
        return '<option value="' + s + '"' + ((p.status || "active") === s ? " selected" : "") + '>'
          + (s === "active" ? "Active — we sell this" : s === "eval" ? "Evaluating" : "Dropped") + '</option>';
      }).join("") + '</select></div>'
    + f("notes", "Notes", "")
    + '<button class="btn acc" style="margin-top:10px;width:100%" onclick="prodSave()">Save</button>'
    + (isNew ? "" : '<button class="btn ghost" style="margin-top:6px;width:100%" onclick="prodDel()">Delete</button>'));
};

if (typeof window !== "undefined") window.prodAddSource = function () {
  var v = (document.getElementById("psV") || {}).value || "";
  var pr = +((document.getElementById("psP") || {}).value || 0);
  var u = (document.getElementById("psU") || {}).value || "";
  if (!v && !pr) return;
  var p = prodById(window.PROD_EDIT_ID);
  if (!p) { (window.PROD_DRAFT.sources = window.PROD_DRAFT.sources || []).push({ vendor: v, price: pr, url: u }); }
  else { if (!Array.isArray(p.sources)) p.sources = []; p.sources.push({ vendor: v, price: pr, url: u, seenAt: (typeof now === "function" ? now() : Date.now()) });
         if (typeof touch === "function") touch(p); if (typeof save === "function") save(); }
  window.prodEdit(window.PROD_EDIT_ID && prodById(window.PROD_EDIT_ID) ? window.PROD_EDIT_ID : null);
};
if (typeof window !== "undefined") window.prodDelSource = function (i) {
  var p = prodById(window.PROD_EDIT_ID); if (!p || !Array.isArray(p.sources)) return;
  p.sources.splice(i, 1);
  if (typeof touch === "function") touch(p); if (typeof save === "function") save();
  window.prodEdit(p.id);
};

if (typeof window !== "undefined") window.prodSave = function () {
  var d = D(); if (!Array.isArray(d.catalogSkus)) d.catalogSkus = [];
  var p = prodById(window.PROD_EDIT_ID);
  if (!p) { p = prodBlank(); p.id = window.PROD_EDIT_ID || p.id; d.catalogSkus.push(p); }
  var dr = window.PROD_DRAFT || {};
  ["sku", "cat", "name", "brand", "model", "specs", "costNote", "sellNote", "tier", "status", "notes", "confidence"]
    .forEach(function (k) { if (dr[k] != null) p[k] = String(dr[k]).slice(0, 400); });
  ["cost", "sell", "laborHours", "stock"].forEach(function (k) { if (dr[k] != null) p[k] = +dr[k] || 0; });
  if (Array.isArray(dr.sources) && dr.sources.length) p.sources = (p.sources || []).concat(dr.sources);
  if (!p.name && !p.sku) { alert("Give it a name or a SKU."); return; }
  if (typeof touch === "function") touch(p);
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  if (typeof render === "function") render();
};
if (typeof window !== "undefined") window.prodDel = function () {
  var p = prodById(window.PROD_EDIT_ID); if (!p) return;
  if (!confirm("Remove " + (p.name || p.sku) + " from the catalogue?")) return;
  p.deleted = true;
  if (typeof touch === "function") touch(p);
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  if (typeof render === "function") render();
};

/* ---- compare: the reason the catalogue exists ---- */
if (typeof window !== "undefined") window.prodCompare = function () {
  var ids = Object.keys(PROD_SEL).filter(function (k) { return PROD_SEL[k]; });
  var ps = ids.map(prodById).filter(Boolean);
  if (ps.length < 2) return;
  var m = (typeof money === "function") ? money : function (n) { return "$" + (+n || 0).toFixed(0); };
  var rows = [
    ["Brand", function (p) { return esc([p.brand, p.model].filter(Boolean).join(" ")) || "—"; }],
    ["Specs", function (p) { return esc(p.specs || "—"); }],
    ["Our cost", function (p) { return p.cost ? m(p.cost) : '<span style="color:#c1121f">unknown</span>'; }],
    ["Best seen", function (p) { var b = prodBestSource(p); return b ? m(b.price) + '<div class="sub" style="font-size:10px">' + esc(b.vendor || "") + '</div>' : "—"; }],
    ["Our price", function (p) { return p.sell ? m(p.sell) : "—"; }],
    ["Margin", function (p) { return prodMarginPct(p); }],
    ["Install", function (p) { return p.laborHours ? (+p.laborHours) + " hr" : "—"; }],
    ["On hand", function (p) { return (+p.stock || 0); }],
    ["Status", function (p) { return esc(p.status || "active"); }],
    ["Notes", function (p) { return esc(p.notes || "—"); }]
  ];
  var h = '<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:12px;min-width:100%">'
    + '<tr><th style="text-align:left;padding:6px 8px;position:sticky;left:0;background:var(--card)"></th>'
    + ps.map(function (p) { return '<th style="text-align:left;padding:6px 8px;white-space:normal;min-width:130px">' + esc(p.name || p.sku) + '</th>'; }).join("")
    + '</tr>'
    + rows.map(function (r, i) {
        return '<tr style="background:' + (i % 2 ? "var(--line-2,transparent)" : "transparent") + '">'
          + '<td style="padding:6px 8px;font-weight:700;white-space:nowrap;position:sticky;left:0;background:var(--card)">' + r[0] + '</td>'
          + ps.map(function (p) { return '<td style="padding:6px 8px;white-space:normal;vertical-align:top">' + r[1](p) + '</td>'; }).join("")
          + '</tr>';
      }).join("")
    + '</table></div>';
  modal("Compare " + ps.length, h);
};

/* ---- import: research lands here, and nothing is written until he has looked at it ---- */
if (typeof window !== "undefined") window.prodImport = function () {
  modal("Import research results",
    '<div class="sub" style="white-space:normal;margin-bottom:8px">Paste the JSON array a research agent produced. '
    + 'Nothing is saved until you have seen the list — the quote tools are about to sit on these numbers.</div>'
    + '<textarea id="pimp" rows="7" placeholder=\'[{"sku":"JAM-NET-...","name":"...","cost":0,"sellPrice":0}]\'></textarea>'
    + '<button class="btn acc" style="margin-top:8px;width:100%" onclick="prodImportParse()">Review</button>');
};
if (typeof window !== "undefined") window.prodImportParse = function () {
  var raw = (document.getElementById("pimp") || {}).value || "";
  var arr; try { arr = JSON.parse(raw); } catch (e) { alert("That is not valid JSON: " + e.message); return; }
  if (!Array.isArray(arr)) { alert("Expected a JSON array."); return; }
  var have = {}; prodAll().forEach(function (p) { if (p.sku) have[String(p.sku).toUpperCase()] = p; });
  PROD_IMPORT = arr.map(function (r) {
    r = r || {};
    var sku = String(r.sku || "").toUpperCase();
    return { keep: true, dup: !!have[sku], r: r };
  });
  var m = (typeof money === "function") ? money : function (n) { return "$" + (+n || 0).toFixed(0); };
  var dups = PROD_IMPORT.filter(function (x) { return x.dup; }).length;
  modal("Review " + PROD_IMPORT.length + " products",
    (dups ? '<div class="note" style="margin-bottom:8px">' + dups + ' already exist by SKU and will be skipped.</div>' : "")
    + PROD_IMPORT.map(function (x, i) {
        var r = x.r;
        return '<div style="border-bottom:1px solid var(--line);padding:6px 0">'
          + '<div class="row" style="gap:6px;align-items:flex-start">'
          + '<input type="checkbox"' + (x.keep && !x.dup ? " checked" : "") + (x.dup ? " disabled" : "")
          + ' style="flex:0 0 auto;margin-top:3px" onchange="PROD_IMPORT[' + i + '].keep=this.checked">'
          + '<div class="grow" style="min-width:0"><div style="font-size:12.5px;font-weight:700;white-space:normal">'
          + esc(r.name || r.sku || "unnamed") + (x.dup ? ' <span class="sub">(already have)</span>' : "") + '</div>'
          + '<div class="sub" style="font-size:11px;white-space:normal">' + esc(r.sku || "") + ' · ' + esc(r.cat || "")
          + ' · cost ' + m(+r.cost || 0) + ' → ' + m(+(r.sellPrice != null ? r.sellPrice : r.sell) || 0)
          + (r.confidence ? ' · ' + esc(r.confidence) + ' confidence' : "") + '</div></div></div></div>';
      }).join("")
    + '<button class="btn acc" style="margin-top:10px;width:100%" onclick="prodImportApply()">Add the ticked ones</button>');
};
if (typeof window !== "undefined") window.prodImportApply = function () {
  if (!PROD_IMPORT) return;
  var d = D(); if (!Array.isArray(d.catalogSkus)) d.catalogSkus = [];
  var n = 0;
  PROD_IMPORT.forEach(function (x) {
    if (!x.keep || x.dup) return;
    var r = x.r, p = prodBlank();
    p.sku = String(r.sku || "").slice(0, 60); p.cat = String(r.cat || "").slice(0, 60);
    p.name = String(r.name || "").slice(0, 200); p.brand = String(r.brand || "").slice(0, 80);
    p.model = String(r.model || "").slice(0, 80); p.specs = String(r.specs || "").slice(0, 400);
    p.cost = +r.cost || 0; p.costNote = String(r.costNote || "").slice(0, 300);
    p.sell = +(r.sellPrice != null ? r.sellPrice : r.sell) || 0;
    p.sellNote = String(r.sellNote || "").slice(0, 300);
    p.laborHours = +r.laborHours || 0; p.tier = String(r.tier || "").slice(0, 40);
    p.confidence = String(r.confidence || "").slice(0, 20);
    p.notes = String(r.notes || "").slice(0, 400);
    /* Anything the research could not stand behind arrives as "evaluating", never "active" — an
       unverified price must not be able to walk straight into a customer quote. */
    p.status = (String(r.confidence || "").toLowerCase() === "low") ? "eval" : "active";
    p.sources = (Array.isArray(r.sources) ? r.sources : []).slice(0, 12).map(function (s) {
      return { vendor: String((s && s.vendor) || "").slice(0, 80), price: +((s && s.price)) || 0,
               url: String((s && s.url) || "").slice(0, 400) };
    });
    if (typeof touch === "function") touch(p);
    d.catalogSkus.push(p); n++;
  });
  if (typeof save === "function") save();
  PROD_IMPORT = null;
  if (typeof closeModal === "function") closeModal();
  if (typeof render === "function") render();
  alert(n + " product" + (n === 1 ? "" : "s") + " added to the catalogue.");
};

if (typeof module !== "undefined" && module.exports) module.exports = { prodBlank: prodBlank };
