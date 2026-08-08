/* ---------- PRODUCT BACK END — the catalogue (js/129) ---------------------------------------------
   Ray, 2026-08-08: "We essentially need, like, our own SKUs… the list of cameras, where we get them,
   all their different specs… We need to be able to easily compare them. We need to see what we have
   in inventory. That's our biggest build, I think, right now is our product back end."

   THE PROBLEM THIS SOLVES. Today the price of a thing lives in three places that disagree: the service
   catalogue (js/01), the website, and whatever the last quote happened to say. There is no record of
   what a thing COSTS us, so nobody can tell a good job from a bad one. And every job re-decides which
   camera to fit, which is a decision tax paid over and over for no benefit.

   THE MODEL. One record per thing we sell, carrying both sides of the trade:
     · what it IS       — sku, name, brand, model, the specs that actually decide a job
     · what it COSTS    — our assumed buy price, plus every source we have found, with the price and URL
     · what it SELLS FOR— our standard price, so a quote never has to invent one
     · what it TAKES    — install hours, feeding the quote tools
     · what we HAVE     — stock on hand

   Two deliberate decisions, both Ray's:
   1. `cost` is the STANDARD assumed buy price, not the last price paid. "We should have a set price
      that we assume in the quote. If we can find it cheaper, great. But we never wanna lose money on
      hardware." So the quote is built on the standard, and beating it is upside — never a shortfall.
   2. Sell price is ours to set and hardware is NOT at cost. The old "no markup" promise is gone.

   This file is the catalogue and the list. The editor, the comparison and the research importer are
   js/130 — kept apart so neither file grows into the thing we split the app up to avoid. */

var PROD_CAT = "", PROD_Q = "", PROD_SORT = "cat", PROD_SEL = {};

/* ---- data ---- */
function prodAll() { return (D().catalogSkus || []).filter(function (p) { return p && !p.deleted; }); }
function prodCats() {
  var m = {}; prodAll().forEach(function (p) { if (p.cat) m[p.cat] = (m[p.cat] || 0) + 1; });
  return Object.keys(m).sort().map(function (c) { return [c, m[c]]; });
}
/* Margin on OUR price. Guard the divide — a $0 sell price is a thing we stock but do not sell (a tool,
   a consumable), and it must read as "n/a", never as -100%. */
function prodMargin(p) {
  var s = +(p && p.sell) || 0, c = +(p && p.cost) || 0;
  if (s <= 0) return null;
  return (s - c) / s;
}
function prodMarginPct(p) { var m = prodMargin(p); return m === null ? "—" : Math.round(m * 100) + "%"; }
/* The cheapest source we know about, so the list can show when the standard cost is stale. */
function prodBestSource(p) {
  var ss = (p && p.sources) || [];
  var best = null;
  ss.forEach(function (s) { var v = +(s && s.price) || 0; if (v > 0 && (!best || v < best.price)) best = s; });
  return best;
}
function prodStatusChip(p) {
  var st = (p && p.status) || "active";
  var col = st === "active" ? "#1a7f37" : st === "eval" ? "#8a5510" : "#8b8b8b";
  var lab = st === "active" ? "active" : st === "eval" ? "evaluating" : "dropped";
  return '<span style="font-size:10px;font-weight:800;color:' + col + '">' + lab + '</span>';
}

/* ---- the filtered, sorted view ---- */
function prodView() {
  var q = PROD_Q.trim().toLowerCase();
  var list = prodAll().filter(function (p) {
    if (PROD_CAT && p.cat !== PROD_CAT) return false;
    if (!q) return true;
    return [p.sku, p.name, p.brand, p.model, p.specs, p.notes, p.tier]
      .join(" ").toLowerCase().indexOf(q) >= 0;
  });
  var s = PROD_SORT;
  list.sort(function (a, b) {
    if (s === "margin") { var ma = prodMargin(a), mb = prodMargin(b); return (mb === null ? -1 : mb) - (ma === null ? -1 : ma); }
    if (s === "cost") return (+b.cost || 0) - (+a.cost || 0);
    if (s === "sell") return (+b.sell || 0) - (+a.sell || 0);
    if (s === "name") return String(a.name || "").localeCompare(String(b.name || ""));
    return String(a.cat || "").localeCompare(String(b.cat || "")) ||
           String(a.name || "").localeCompare(String(b.name || ""));
  });
  return list;
}

/* ---- the page ---- */
function rProducts() {
  var all = prodAll(), list = prodView(), cats = prodCats();
  var m = (typeof money === "function") ? money : function (n) { return "$" + (+n || 0).toFixed(0); };

  var h = '<div class="card"><div class="row" style="gap:8px;align-items:flex-start">'
    + '<div class="grow"><div class="nm">🏷️ Products</div>'
    + '<div class="sub" style="white-space:normal">Our own SKUs — what a thing is, what it costs us, what we sell it for, '
    + 'and how long it takes to fit. The quote tools read from here, so a price only ever gets decided once.</div></div>'
    + '<button class="btn acc" style="flex:0 0 auto" onclick="prodEdit()">＋ New</button></div>';

  if (!all.length) {
    return h + '<div class="card"><div class="muted" style="font-size:13px;white-space:normal">'
      + 'Nothing in the catalogue yet. Deep research on networking, cameras, locks, Starlink and lighting is '
      + 'running now — when it lands it can be imported straight in here, and you can audit every line before '
      + 'anything goes near a quote.</div>'
      + '<button class="btn ghost" style="margin-top:10px;width:100%" onclick="prodImport()">📥 Import research results</button></div>';
  }

  /* summary — the numbers you would otherwise have to work out by hand */
  var withSell = all.filter(function (p) { return prodMargin(p) !== null; });
  var avgM = withSell.length
    ? Math.round(withSell.reduce(function (t, p) { return t + prodMargin(p); }, 0) / withSell.length * 100) + "%"
    : "—";
  var stockVal = all.reduce(function (t, p) { return t + (+p.stock || 0) * (+p.cost || 0); }, 0);
  var noCost = all.filter(function (p) { return !(+p.cost); }).length;
  h += '<div class="card"><div class="row" style="gap:14px;flex-wrap:wrap">'
    + '<div><div class="sub" style="font-size:11px">SKUs</div><div style="font-weight:800">' + all.length + '</div></div>'
    + '<div><div class="sub" style="font-size:11px">Avg margin</div><div style="font-weight:800">' + avgM + '</div></div>'
    + '<div><div class="sub" style="font-size:11px">Stock at cost</div><div style="font-weight:800">' + m(stockVal) + '</div></div>'
    + (noCost ? '<div><div class="sub" style="font-size:11px">No cost yet</div><div style="font-weight:800;color:#c1121f">' + noCost + '</div></div>' : '')
    + '</div></div>';

  /* filters */
  h += '<div class="card"><input placeholder="Search SKU, name, brand, spec…" value="' + esc(PROD_Q) + '"'
    + ' oninput="PROD_Q=this.value;render()" onkeydown="if(event.key===\'Enter\')this.blur()">'
    + '<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">'
    + '<button class="btn ' + (PROD_CAT ? "ghost" : "acc") + ' sm" onclick="PROD_CAT=\'\';render()">All ' + all.length + '</button>';
  cats.forEach(function (c) {
    h += '<button class="btn ' + (PROD_CAT === c[0] ? "acc" : "ghost") + ' sm" onclick="PROD_CAT=' + JSON.stringify(c[0]).replace(/"/g, "&quot;") + ';render()">'
      + esc(c[0]) + ' ' + c[1] + '</button>';
  });
  h += '</div><div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">'
    + '<span class="sub" style="font-size:11px;align-self:center">Sort</span>';
  [["cat", "Category"], ["name", "Name"], ["margin", "Margin"], ["cost", "Cost"], ["sell", "Price"]].forEach(function (o) {
    h += '<button class="btn ' + (PROD_SORT === o[0] ? "acc" : "ghost") + ' sm" onclick="PROD_SORT=\'' + o[0] + '\';render()">' + o[1] + '</button>';
  });
  h += '</div></div>';

  var selN = Object.keys(PROD_SEL).filter(function (k) { return PROD_SEL[k]; }).length;
  if (selN) {
    h += '<div class="card"><div class="row" style="gap:8px;align-items:center">'
      + '<div class="grow" style="font-size:13px"><b>' + selN + ' selected</b></div>'
      + '<button class="btn ghost sm" onclick="PROD_SEL={};render()">Clear</button>'
      + '<button class="btn acc sm" onclick="prodCompare()"' + (selN < 2 ? " disabled" : "") + '>⚖ Compare</button>'
      + '</div></div>';
  }

  /* the rows */
  h += '<div class="card" style="padding-top:4px">';
  var lastCat = null;
  list.forEach(function (p) {
    if (PROD_SORT === "cat" && p.cat !== lastCat) {
      lastCat = p.cat;
      h += '<div class="sub" style="font-size:11px;font-weight:800;margin:10px 0 2px;letter-spacing:.04em">' + esc(p.cat || "Uncategorised") + '</div>';
    }
    var best = prodBestSource(p), cost = +p.cost || 0;
    var cheaper = best && cost && best.price < cost * 0.95;
    h += '<div style="border-top:1px solid var(--line);padding:8px 0">'
      + '<div class="row" style="gap:8px;align-items:flex-start">'
      + '<input type="checkbox" style="flex:0 0 auto;margin-top:3px"' + (PROD_SEL[p.id] ? " checked" : "")
      + ' onchange="PROD_SEL[' + JSON.stringify(p.id) + ']=this.checked;render()">'
      + '<div class="grow" style="min-width:0" onclick="prodEdit(' + JSON.stringify(p.id) + ')">'
      + '<div style="font-weight:700;font-size:13.5px;white-space:normal">' + esc(p.name || p.sku || "unnamed") + '</div>'
      + '<div class="sub" style="font-size:11px;white-space:normal">' + esc(p.sku || "")
      + (p.brand || p.model ? ' · ' + esc([p.brand, p.model].filter(Boolean).join(" ")) : "")
      + ' · ' + prodStatusChip(p) + '</div>'
      + (p.specs ? '<div class="sub" style="font-size:11px;white-space:normal;margin-top:2px">' + esc(p.specs) + '</div>' : "")
      + (cheaper ? '<div style="font-size:11px;color:#1a7f37;margin-top:2px">↓ seen at ' + m(best.price) + ' from ' + esc(best.vendor || "a source") + '</div>' : "")
      + '</div>'
      + '<div style="flex:0 0 auto;text-align:right;font-variant-numeric:tabular-nums">'
      + '<div style="font-weight:800;font-size:13.5px">' + (p.sell ? m(p.sell) : '<span class="sub">no price</span>') + '</div>'
      + '<div class="sub" style="font-size:11px">cost ' + (cost ? m(cost) : '<span style="color:#c1121f">?</span>')
      + ' · ' + prodMarginPct(p) + '</div>'
      + (p.laborHours ? '<div class="sub" style="font-size:11px">' + (+p.laborHours) + ' hr</div>' : "")
      + (p.stock ? '<div class="sub" style="font-size:11px">' + (+p.stock) + ' on hand</div>' : "")
      + '</div></div></div>';
  });
  if (!list.length) h += '<div class="muted" style="font-size:13px;padding:10px 0">Nothing matches that.</div>';
  h += '</div>';

  h += '<div class="card"><button class="btn ghost" style="width:100%" onclick="prodImport()">📥 Import research results</button></div>';
  return h;
}

if (typeof window !== "undefined") {
  window.rProducts = rProducts; window.prodAll = prodAll; window.prodView = prodView;
  window.prodMargin = prodMargin; window.prodMarginPct = prodMarginPct; window.prodBestSource = prodBestSource;
}
if (typeof module !== "undefined" && module.exports) module.exports = { prodMargin: prodMargin };
