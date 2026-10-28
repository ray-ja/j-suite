/* ---------- BUY LIST (js/203) — one list, every vendor side by side ----------------------------------
   Ray, 2026-10-28, after we priced the stone-course cart by hand: "We should just make this into a tool and
   make it part of our normal operating procedures. A nice interface that compares all of these vendors. Puts
   them all in a nice organized table with differences between them, price, shipping, estimated delivery date."

   THE RULE IT ENCODES (memory three-store-purchasing): every buy list is priced at Amazon, Home Depot and
   Walmart (all near him, pickup ok); Lowe's only for big-ticket items, ordered ONLINE for the military
   discount. He has Amazon Prime and Walmart+, so those ship free unless a third-party seller charges; Home
   Depot and Lowe's charge shipping, so they are compared at the store-pickup price. The comparison is always
   LANDED cost: price × qty + shipping.

   WHERE THE NUMBERS COME FROM (honest about it, on every cell): Home Depot, Lowe's and Walmart block automated
   price pulls, and the services that get around that cost $50-75 a month, which Ray does not want. So an offer
   carries a `src`: "verified" (read off the vendor's page or the Amazon cart), "snippet" (web-search result,
   shown with ≈), or "manual" (he typed or pasted it in the aisle). A paste box takes a product link from any
   of the four store apps and files it under the right vendor.

   RECORDS — buyItems, a synced collection (stable "buy_" ids, per org):
     { id, list, name, qty, spec, status, note, invId, offers:[{v,sku,url,price,ship,pickup,eta,seller,src,checkedAt}] }
     status: need · cart · ordered · received · own · later · skip.  "own" is the inventory bridge: marking an
     item owned writes a have:true inventory record (js/31 shape) so the stone/jam/obx inventory stays the one
     list of what he has. Nothing here places an order; the Amazon plan is a JSON list my cart scripts read. */

var BUY_VENDORS = [
  { k: "amazon",  l: "Amazon",     s: "Amz" },
  { k: "hd",      l: "Home Depot", s: "HD" },
  { k: "walmart", l: "Walmart",    s: "Wmt" },
  { k: "lowes",   l: "Lowe's",     s: "Low" }
];
var BUY_STATUS = ["need", "cart", "ordered", "received", "own", "later", "skip"];
var BUY_LIST = null;   /* null = every list */

function buyVendor(k) { for (var i = 0; i < BUY_VENDORS.length; i++) if (BUY_VENDORS[i].k === k) return BUY_VENDORS[i]; return { k: k || "other", l: k || "Other", s: "—" }; }
function actBuy() { return (D().buyItems || []).filter(function (x) { return x && !x.deleted; }); }
function buyLists() { var seen = []; actBuy().forEach(function (x) { var l = x.list || "Unfiled"; if (seen.indexOf(l) < 0) seen.push(l); }); return seen.sort(); }

/* a store link → which vendor and which product id. Pure. */
function buyParseUrl(url) {
  var u = String(url || "").trim(); if (!u) return null;
  var m;
  if ((m = /amazon\.[a-z.]+\/(?:.*?\/)?(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i.exec(u)) || (m = /^([A-Z0-9]{10})$/.exec(u))) return { v: "amazon", sku: m[1].toUpperCase(), url: /^http/.test(u) ? u : "https://www.amazon.com/dp/" + m[1].toUpperCase() };
  if ((m = /homedepot\.com\/p\/(?:.*?\/)?(\d{6,})/i.exec(u))) return { v: "hd", sku: m[1], url: u };
  if ((m = /walmart\.com\/ip\/(?:.*?\/)?(\d{5,})/i.exec(u))) return { v: "walmart", sku: m[1], url: u };
  if ((m = /lowes\.com\/pd\/(?:.*?\/)?(\d{6,})/i.exec(u))) return { v: "lowes", sku: m[1], url: u };
  if (/^https?:\/\//i.test(u)) return { v: "other", sku: "", url: u };
  return null;
}
/* landed cost of one offer for the item's quantity: price × qty + shipping (pickup = no shipping). null = no price yet */
function buyLanded(o, qty) {
  if (!o || !(+o.price > 0)) return null;
  var q = Math.max(1, +qty || 1), ship = o.pickup ? 0 : (+o.ship || 0);
  return Math.round((+o.price * q + ship) * 100) / 100;
}
function buyOffer(item, v) { return ((item && item.offers) || []).filter(function (o) { return o && o.v === v; })[0] || null; }
/* the cheapest landed offer; ties go to a verified price over a snippet, then to Amazon (it is already in the cart flow) */
function buyBest(item) {
  var best = null;
  ((item && item.offers) || []).forEach(function (o) {
    var l = buyLanded(o, item.qty); if (l == null) return;
    var rank = (o.src === "snippet" ? 1 : 0) + (o.v === "amazon" ? 0 : 0.1);
    if (!best || l < best.landed - 0.005 || (Math.abs(l - best.landed) < 0.005 && rank < best.rank)) best = { v: o.v, landed: l, rank: rank, src: o.src || "" };
  });
  return best;
}
function buyDelta(item, v) { var b = buyBest(item), o = buyOffer(item, v), l = buyLanded(o, item && item.qty); if (!b || l == null) return null; return Math.round((l - b.landed) * 100) / 100; }
/* totals: per vendor (only items that vendor prices), the best-mix total, Amazon-only total, how many items still have no price */
function buyTotals(items) {
  var out = { vendors: {}, best: 0, bestN: 0, amazon: 0, amazonN: 0, unpriced: 0 };
  BUY_VENDORS.forEach(function (v) { out.vendors[v.k] = { n: 0, sum: 0 }; });
  (items || []).forEach(function (it) {
    if (!it || it.deleted) return;
    if (BUY_STATUS.indexOf(it.status) >= 0 && it.status !== "need" && it.status !== "cart") return;   /* only what is still to be bought counts */
    var b = buyBest(it); if (!b) { out.unpriced++; return; }
    out.best += b.landed; out.bestN++;
    var a = buyLanded(buyOffer(it, "amazon"), it.qty); if (a != null) { out.amazon += a; out.amazonN++; }
    BUY_VENDORS.forEach(function (v) { var l = buyLanded(buyOffer(it, v.k), it.qty); if (l != null) { out.vendors[v.k].n++; out.vendors[v.k].sum += l; } });
  });
  ["best", "amazon"].forEach(function (k) { out[k] = Math.round(out[k] * 100) / 100; });
  BUY_VENDORS.forEach(function (v) { out.vendors[v.k].sum = Math.round(out.vendors[v.k].sum * 100) / 100; });
  return out;
}
/* paste a list: "- Name, qty 2, $18.70" with the link on the next line, or "Name x2 $18.70 https://…" on one line. Pure. */
function buyParseList(text) {
  var lines = String(text || "").split(/\r?\n/), out = [], cur = null;
  lines.forEach(function (raw) {
    var l = raw.trim(); if (!l) return;
    var urlOnly = /^(https?:\/\/\S+)$/.exec(l);
    if (urlOnly && cur) { cur.url = urlOnly[1]; return; }
    if (/^#/.test(l)) return;   /* headings */
    var line = l.replace(/^[-*•]\s*|^\[ \]\s*/, ""), url = (/(https?:\/\/\S+)/.exec(line) || [])[1] || "";
    line = line.replace(/https?:\/\/\S+/, "").trim();
    var price = (/\$\s?(\d[\d,]*(?:\.\d\d)?)/.exec(line) || [])[1]; price = price ? +price.replace(/,/g, "") : 0;
    var qty = (/\bqty\s*:?\s*(\d+)/i.exec(line) || /\bx\s?(\d+)\b/i.exec(line) || [])[1]; qty = qty ? +qty : 1;
    var name = line.replace(/,?\s*\bqty\s*:?\s*\d+[^,$]*/i, "").replace(/\s*x\s?\d+\b/i, "").replace(/,?\s*\$\s?[\d,.]+(\s*(each|ea)\b)?(\s*x\s?\d+)?/i, "").replace(/\s*,\s*$/, "").replace(/\s+/g, " ").trim();
    if (!name) return;
    cur = { name: name, qty: qty, price: price, url: url }; out.push(cur);
  });
  return out;
}
/* what my Amazon cart scripts read: every item still to buy whose best (or only) offer is Amazon */
function buyAmazonPlan(items) {
  return (items || []).filter(function (it) {
    if (!it || it.deleted || (it.status !== "need" && it.status !== "cart")) return false;
    var o = buyOffer(it, "amazon"), b = buyBest(it); return o && o.sku && (!b || b.v === "amazon");
  }).map(function (it) { return { asin: buyOffer(it, "amazon").sku, qty: Math.max(1, +it.qty || 1) }; });
}
/* the store run: items whose best price is a pickup vendor, grouped by store */
function buyStoreRun(items) {
  var g = {};
  (items || []).forEach(function (it) {
    if (!it || it.deleted || (it.status !== "need" && it.status !== "cart")) return;
    var b = buyBest(it); if (!b || b.v === "amazon") return;
    var o = buyOffer(it, b.v); (g[b.v] = g[b.v] || []).push({ name: it.name, qty: it.qty || 1, landed: b.landed, sku: o && o.sku, url: o && o.url, src: o && o.src });
  });
  return g;
}

/* ---- render ---- */
function buyMoney(n) { return (typeof money2 === "function") ? money2(n) : "$" + (Math.round(n * 100) / 100).toFixed(2); }
function buyCell(it, v) {
  var o = buyOffer(it, v), l = buyLanded(o, it.qty);
  if (!o || l == null) return '<td class="buy-c buy-none">' + (o && o.url ? '<a href="' + esc(o.url) + '" target="_blank" rel="noopener" class="muted">link</a>' : '<span class="muted">—</span>') + '</td>';
  var b = buyBest(it), isBest = b && b.v === v, d = buyDelta(it, v);
  var sub = [];
  if (o.pickup) sub.push("pickup"); else if (+o.ship > 0) sub.push("+" + buyMoney(+o.ship) + " ship"); else sub.push("free ship");
  if (o.eta) sub.push(esc(o.eta));
  return '<td class="buy-c' + (isBest ? ' buy-best' : '') + '">' + (o.url ? '<a href="' + esc(o.url) + '" target="_blank" rel="noopener">' : '') + (o.src === "snippet" ? "≈" : "") + buyMoney(l) + (o.url ? '</a>' : '')
    + (isBest || d == null || d === 0 ? '' : ' <span class="muted" style="font-size:11px">+' + buyMoney(d) + '</span>')
    + '<div class="muted" style="font-size:10px;white-space:nowrap">' + sub.join(" · ") + '</div></td>';
}
function rBuy() { view.innerHTML = buyHTML(); }
function buyHTML() {
  var all = actBuy(), lists = buyLists();
  var items = all.filter(function (x) { return !BUY_LIST || (x.list || "Unfiled") === BUY_LIST; });
  var open = items.filter(function (x) { return x.status === "need" || x.status === "cart"; });
  var t = buyTotals(items);
  var h = '<div class="secthd"><h2>🛒 Buy list</h2>'
    + '<button class="btn ghost sm" style="margin-left:auto" onclick="openBuyItem(null)">＋ Item</button>'
    + '<button class="btn ghost sm" onclick="buyPasteList()">📋 Paste list</button>'
    + '<button class="btn ghost sm" onclick="buyPasteLink()">🔗 Paste link</button></div>';
  if (lists.length > 1) {
    h += '<div class="subnav" style="margin-bottom:10px"><button class="subbtn ' + (!BUY_LIST ? "on" : "") + '" onclick="buySetList(null)">All</button>'
      + lists.map(function (l) { return '<button class="subbtn ' + (BUY_LIST === l ? "on" : "") + '" onclick="buySetList(' + JSON.stringify(l).replace(/"/g, "&quot;") + ')">' + esc(l) + '</button>'; }).join("") + '</div>';
  }
  if (!items.length) return h + '<div class="card"><div class="muted">Nothing on the list. Paste the list you were given, or add one item.</div></div>';
  /* totals: what it costs to buy what is left, at Amazon alone vs the cheapest store for each line */
  var saving = Math.round((t.amazon - t.best) * 100) / 100;
  h += '<div class="card" style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline">'
    + '<div><div class="muted" style="font-size:11px">Still to buy</div><b>' + open.length + '</b> items</div>'
    + '<div><div class="muted" style="font-size:11px">Best mix</div><b>' + buyMoney(t.best) + '</b></div>'
    + '<div><div class="muted" style="font-size:11px">All at Amazon</div>' + buyMoney(t.amazon) + (t.amazonN < t.bestN ? ' <span class="muted" style="font-size:11px">(' + t.amazonN + ' of ' + t.bestN + ' priced)</span>' : '') + '</div>'
    + (saving > 0.5 ? '<div><div class="muted" style="font-size:11px">Saved by splitting</div><b style="color:var(--ok,#2a7)">' + buyMoney(saving) + '</b></div>' : '')
    + (t.unpriced ? '<div><div class="muted" style="font-size:11px">No price yet</div>' + t.unpriced + '</div>' : '')
    + '<div style="margin-left:auto;display:flex;gap:6px"><button class="btn ghost sm" onclick="buyCopyAmazonPlan()">📦 Amazon plan</button><button class="btn ghost sm" onclick="buyShowStoreRun()">🏬 Store run</button></div>'
    + '</div>';
  h += '<div class="card" style="padding:0;overflow:auto"><table class="otable buy-t"><thead><tr><th>Item</th><th class="c">Qty</th>'
    + BUY_VENDORS.map(function (v) { return '<th>' + esc(v.l) + '</th>'; }).join("") + '<th>Status</th></tr></thead><tbody>';
  var order = { need: 0, cart: 1, ordered: 2, received: 3, later: 4, own: 5, skip: 6 };
  items.slice().sort(function (a, b) { return (order[a.status] || 0) - (order[b.status] || 0) || String(a.name).localeCompare(String(b.name)); }).forEach(function (it) {
    var dim = it.status === "own" || it.status === "skip" || it.status === "received";
    h += '<tr' + (dim ? ' style="opacity:.55"' : '') + ' onclick="openBuyItem(\'' + it.id + '\')" style="cursor:pointer">'
      + '<td>' + esc(it.name) + (it.spec ? '<div class="muted" style="font-size:11px;font-weight:400;white-space:normal">' + esc(it.spec) + '</div>' : '') + '</td>'
      + '<td class="c">' + (it.qty || 1) + '</td>' + BUY_VENDORS.map(function (v) { return buyCell(it, v.k); }).join("")
      + '<td><span class="badge">' + esc(it.status || "need") + '</span></td></tr>';
  });
  h += '</tbody></table></div>';
  h += '<div class="muted" style="font-size:11px;margin-top:6px">Landed = price × qty + shipping. Bold is the cheapest. ≈ means the price came from a web search, not the store page: check it in the store app before you drive.</div>';
  return h;
}

/* ---- actions ---- */
if (typeof window !== "undefined") {
  window.buySetList = function (l) { BUY_LIST = l; render(); };
  window.openBuyItem = function (id) {
    var isNew = !id;
    var x = isNew ? { id: "buy_" + uid(), list: BUY_LIST || "", name: "", qty: 1, spec: "", status: "need", note: "", offers: [] } : actBuy().filter(function (y) { return y.id === id; })[0];
    if (!x) return;
    var opt = function (list, cur) { return list.map(function (s) { return '<option value="' + s + '"' + (s === cur ? " selected" : "") + '>' + s + '</option>'; }).join(""); };
    var vend = BUY_VENDORS.map(function (v) {
      var o = buyOffer(x, v.k) || {};
      return '<div class="card" style="padding:8px;margin-top:8px"><b>' + esc(v.l) + '</b>'
        + '<div class="row" style="gap:6px;flex-wrap:wrap"><div style="flex:1 1 80px"><label>Price</label><input id="bo_' + v.k + '_price" type="number" step="0.01" inputmode="decimal" value="' + esc(o.price || "") + '"></div>'
        + '<div style="flex:1 1 80px"><label>Shipping</label><input id="bo_' + v.k + '_ship" type="number" step="0.01" inputmode="decimal" value="' + esc(o.ship || "") + '"></div>'
        + '<div style="flex:1 1 90px"><label>Delivery / pickup date</label><input id="bo_' + v.k + '_eta" value="' + esc(o.eta || "") + '" placeholder="Nov 2"></div></div>'
        + '<label><input type="checkbox" id="bo_' + v.k + '_pickup"' + (o.pickup ? " checked" : "") + '> Store pickup (no shipping)</label>'
        + '<label>Link</label><input id="bo_' + v.k + '_url" value="' + esc(o.url || "") + '" placeholder="paste the product link">'
        + '<div class="row" style="gap:6px"><div class="grow"><label>Seller</label><input id="bo_' + v.k + '_seller" value="' + esc(o.seller || "") + '" placeholder="Amazon · marketplace · store"></div>'
        + '<div style="flex:0 0 130px"><label>Price source</label><select id="bo_' + v.k + '_src">' + opt(["verified", "snippet", "manual"], o.src || "manual") + '</select></div></div></div>';
    }).join("");
    modal(isNew ? "Add to the buy list" : "Buy list item",
      '<label style="margin-top:0">Item</label><input id="bi_name" value="' + esc(x.name) + '" autocomplete="off">'
      + '<div class="row" style="gap:8px"><div style="flex:0 0 70px"><label>Qty</label><input id="bi_qty" type="number" inputmode="numeric" value="' + esc(x.qty || 1) + '"></div>'
      + '<div class="grow"><label>List</label><input id="bi_list" value="' + esc(x.list || "") + '" list="bi_lists" placeholder="e.g. Stone course"><datalist id="bi_lists">' + buyLists().map(function (l) { return '<option value="' + esc(l) + '">'; }).join("") + '</datalist></div>'
      + '<div style="flex:0 0 110px"><label>Status</label><select id="bi_status">' + opt(BUY_STATUS, x.status || "need") + '</select></div></div>'
      + '<label>Spec / size</label><input id="bi_spec" value="' + esc(x.spec || "") + '">'
      + '<label>Note</label><textarea id="bi_note" rows="2">' + esc(x.note || "") + '</textarea>'
      + vend
      + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="saveBuyItem(\'' + x.id + '\',' + (isNew ? "true" : "false") + ')">Save</button>'
      + (isNew ? "" : '<button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="buyMarkOwned(\'' + x.id + '\')">✅ I own this → inventory</button>'
        + '<button class="btn ghost sm" style="margin-top:8px;width:100%;color:var(--danger)" onclick="delBuyItem(\'' + x.id + '\')">Remove</button>'));
  };
  window.saveBuyItem = function (id, isNew) {
    var name = val("bi_name"); if (!name) { alert("Name the item."); return; }
    var d = D(); if (!d.buyItems) d.buyItems = [];
    var x = isNew ? { id: id, offers: [] } : d.buyItems.filter(function (y) { return y && y.id === id; })[0];
    if (!x) return;
    x.name = name; x.qty = Math.max(1, parseInt(val("bi_qty"), 10) || 1); x.list = val("bi_list") || "Unfiled";
    x.status = val("bi_status") || "need"; x.spec = val("bi_spec"); x.note = val("bi_note");
    x.offers = (x.offers || []).filter(function (o) { return o && BUY_VENDORS.every(function (v) { return v.k !== o.v; }); });   /* keep any "other" offers */
    BUY_VENDORS.forEach(function (v) {
      var price = parseFloat(val("bo_" + v.k + "_price")) || 0, url = val("bo_" + v.k + "_url");
      if (!(price > 0) && !url) return;
      var p = buyParseUrl(url);
      x.offers.push({ v: v.k, sku: (p && p.v === v.k) ? p.sku : "", url: url, price: price, ship: parseFloat(val("bo_" + v.k + "_ship")) || 0,
        pickup: (document.getElementById("bo_" + v.k + "_pickup") || {}).checked === true, eta: val("bo_" + v.k + "_eta"), seller: val("bo_" + v.k + "_seller"),
        src: val("bo_" + v.k + "_src") || "manual", checkedAt: typeof today === "function" ? today() : "" });
    });
    x.deleted = false; if (typeof touch === "function") touch(x);
    if (isNew) d.buyItems.push(x);
    if (typeof save === "function") save(); if (typeof closeModal === "function") closeModal(); render();
  };
  window.delBuyItem = function (id) {
    if (!confirm("Remove this item from the buy list?")) return;
    var x = (D().buyItems || []).filter(function (y) { return y && y.id === id; })[0];
    if (x) { x.deleted = true; if (typeof touch === "function") touch(x); if (typeof save === "function") save(); }
    if (typeof closeModal === "function") closeModal(); render();
  };
  /* the inventory bridge: owned here = a have:true record over there, once */
  window.buyMarkOwned = function (id) {
    var d = D(), x = (d.buyItems || []).filter(function (y) { return y && y.id === id; })[0]; if (!x) return;
    if (!d.inventory) d.inventory = [];
    var inv = x.invId ? d.inventory.filter(function (i) { return i && i.id === x.invId; })[0] : null;
    if (!inv) {
      inv = { id: "inv_buy_" + x.id, name: x.name, cat: "tool", have: true, qty: String(x.qty || 1), price: "", brand: "", tags: [], section: x.list || "", notes: "Marked owned on the buy list " + (typeof today === "function" ? today() : "") + (x.spec ? ". " + x.spec : "") };
      d.inventory.push(inv); x.invId = inv.id;
    }
    inv.have = true; inv.deleted = false; if (typeof touch === "function") touch(inv);
    x.status = "own"; if (typeof touch === "function") touch(x);
    if (typeof save === "function") save(); if (typeof closeModal === "function") closeModal(); render();
  };
  window.buyPasteList = function () {
    modal("Paste a list", '<div class="muted" style="font-size:12px">One item per line. "- Name, qty 2, $18.70" with the link on the next line works, so does "Name x2 $18.70 https://…".</div>'
      + '<label>List name</label><input id="bp_list" value="' + esc(BUY_LIST || "") + '" placeholder="e.g. Stone course">'
      + '<textarea id="bp_text" rows="10" style="margin-top:8px" placeholder="paste here"></textarea>'
      + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="buyImportPasted()">Add them</button>');
  };
  window.buyImportPasted = function () {
    var rows = buyParseList((document.getElementById("bp_text") || {}).value || ""), list = val("bp_list") || "Unfiled";
    if (!rows.length) { alert("Nothing I could read on those lines."); return; }
    var d = D(); if (!d.buyItems) d.buyItems = [];
    rows.forEach(function (r) {
      var p = buyParseUrl(r.url), x = { id: "buy_" + uid(), list: list, name: r.name, qty: r.qty, spec: "", status: "need", note: "", offers: [], deleted: false };
      if (p || r.price) x.offers.push({ v: p ? p.v : "amazon", sku: p ? p.sku : "", url: r.url || "", price: r.price || 0, ship: 0, pickup: false, eta: "", seller: "", src: "manual", checkedAt: typeof today === "function" ? today() : "" });
      if (typeof touch === "function") touch(x); d.buyItems.push(x);
    });
    BUY_LIST = list; if (typeof save === "function") save(); if (typeof closeModal === "function") closeModal(); render();
  };
  /* a link from a store app: file it under the vendor on an existing item, or start a new item with it */
  window.buyPasteLink = function () {
    var opts = actBuy().filter(function (x) { return x.status === "need" || x.status === "cart"; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); })
      .map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join("");
    modal("Paste a product link", '<label style="margin-top:0">Link</label><input id="bl_url" placeholder="https://www.homedepot.com/p/…">'
      + '<div class="row" style="gap:8px"><div class="grow"><label>Price</label><input id="bl_price" type="number" step="0.01" inputmode="decimal"></div><div style="flex:0 0 110px"><label>Shipping</label><input id="bl_ship" type="number" step="0.01" inputmode="decimal" placeholder="0"></div></div>'
      + '<label><input type="checkbox" id="bl_pickup" checked> Store pickup</label>'
      + '<label>For which item</label><select id="bl_item"><option value="">New item…</option>' + opts + '</select>'
      + '<label>New item name (if new)</label><input id="bl_name">'
      + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="buySaveLink()">Save</button>');
  };
  window.buySaveLink = function () {
    var p = buyParseUrl(val("bl_url")); if (!p) { alert("That is not a store link I recognise."); return; }
    var d = D(); if (!d.buyItems) d.buyItems = [];
    var id = val("bl_item"), x = id ? d.buyItems.filter(function (y) { return y && y.id === id; })[0] : null;
    if (!x) { var nm = val("bl_name"); if (!nm) { alert("Name the new item."); return; } x = { id: "buy_" + uid(), list: BUY_LIST || "Unfiled", name: nm, qty: 1, spec: "", status: "need", note: "", offers: [], deleted: false }; d.buyItems.push(x); }
    x.offers = (x.offers || []).filter(function (o) { return o && o.v !== p.v; });
    x.offers.push({ v: p.v, sku: p.sku, url: p.url, price: parseFloat(val("bl_price")) || 0, ship: parseFloat(val("bl_ship")) || 0, pickup: (document.getElementById("bl_pickup") || {}).checked === true, eta: "", seller: "", src: "manual", checkedAt: typeof today === "function" ? today() : "" });
    if (typeof touch === "function") touch(x); if (typeof save === "function") save(); if (typeof closeModal === "function") closeModal(); render();
  };
  window.buyCopyAmazonPlan = function () {
    var items = actBuy().filter(function (x) { return !BUY_LIST || (x.list || "Unfiled") === BUY_LIST; }), plan = buyAmazonPlan(items), txt = JSON.stringify(plan);
    var done = function () { modal("Amazon plan", '<div class="muted" style="font-size:12px">' + plan.length + ' items whose best price is Amazon. This is what the cart scripts read; nothing is ordered from here.</div><textarea rows="6" style="margin-top:8px" readonly>' + esc(txt) + '</textarea>'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, done); else done();
  };
  window.buyShowStoreRun = function () {
    var items = actBuy().filter(function (x) { return !BUY_LIST || (x.list || "Unfiled") === BUY_LIST; }), g = buyStoreRun(items), keys = Object.keys(g);
    if (!keys.length) { modal("Store run", '<div class="muted">Nothing beats Amazon right now, so there is no store run.</div>'); return; }
    modal("Store run", keys.map(function (k) {
      var rows = g[k], sum = rows.reduce(function (s, r) { return s + r.landed; }, 0);
      return '<h3 style="margin:8px 0 4px">' + esc(buyVendor(k).l) + ' <span class="muted" style="font-weight:400">' + buyMoney(sum) + '</span></h3>'
        + rows.map(function (r) { return '<div class="row" style="gap:8px;padding:4px 0;border-bottom:1px solid var(--line)"><div class="grow">' + (r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' : '') + esc(r.name) + (r.url ? '</a>' : '') + (r.qty > 1 ? ' ×' + r.qty : '') + (r.src === "snippet" ? ' <span class="muted">≈ check in app</span>' : '') + '</div><div>' + buyMoney(r.landed) + '</div></div>'; }).join("");
    }).join(""));
  };
  window.rBuy = rBuy; window.buyHTML = buyHTML; window.actBuy = actBuy;
}
if (typeof module !== "undefined") module.exports = { BUY_VENDORS: BUY_VENDORS, BUY_STATUS: BUY_STATUS, buyParseUrl: buyParseUrl, buyLanded: buyLanded, buyBest: buyBest, buyDelta: buyDelta, buyTotals: buyTotals, buyParseList: buyParseList, buyAmazonPlan: buyAmazonPlan, buyStoreRun: buyStoreRun, buyOffer: buyOffer, buyHTML: buyHTML };
