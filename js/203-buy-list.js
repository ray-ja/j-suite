/* ---------- BUY LIST (js/203) — one list, every vendor side by side ----------------------------------
   Ray, 2026-10-28, after we priced the stone-course cart by hand: "We should just make this into a tool and
   make it part of our normal operating procedures. A nice interface that compares all of these vendors. Puts
   them all in a nice organized table with differences between them, price, shipping, estimated delivery date."
   Same evening, on the first cut: brand column, how many come in the pack, which job it is for, a button to
   rerun the checks and track the price over time, and a place that explains the differences between the
   options "cause cheaper isn't always better". And: dark mode, the blue links were unreadable.

   THE RULE IT ENCODES (memory three-store-purchasing): every buy list is priced at Amazon, Home Depot and
   Walmart (all near him, pickup ok); Lowe's only for big-ticket items, ordered ONLINE for the military
   discount. He has Amazon Prime and Walmart+, so those ship free unless a third-party seller charges; Home
   Depot and Lowe's charge shipping, so they are compared at the store-pickup price. The comparison is always
   LANDED cost: price × qty + shipping.

   WHERE THE NUMBERS COME FROM (honest about it, on every cell): Home Depot, Lowe's and Walmart block automated
   price pulls, and the services that get around that cost $50-75 a month, which Ray does not want. So an offer
   carries a `src`: "verified" (read off the vendor's page or the Amazon cart), "snippet" (web-search result,
   shown with ≈), or "manual" (he typed or pasted it in the aisle). A paste box takes a product link from any
   of the four store apps and files it under the right vendor. "Recheck prices" does not scrape anything: it
   stamps the open items and writes a to-do that I pick up (the Amazon cart scripts + a web check), and every
   offer keeps a price history so the table can say "was $X".

   CHEAPER ISN'T ALWAYS BETTER: the cheapest landed offer is still shown bold, but Ray can PICK a vendor on an
   item (with a reason); totals, the Amazon plan and the store run follow the pick, not the price. Each offer
   has a `diff` note ("4 in, plastic handle", "marketplace seller") shown under the item as the Differences line.

   RECORDS — buyItems, a synced collection (stable "buy_" ids, per org):
     { id, list, name, qty, spec, forJob, status, note, pick, pickWhy, invId, recheckAt,
       offers:[{v,sku,url,price,ship,pickup,eta,seller,brand,pack,diff,src,checkedAt,hist:[{at,price,ship}]}] }
     status: need · cart · ordered · received · own · later · skip.  "own" is the inventory bridge: marking an
     item owned writes a have:true inventory record (js/31 shape). Nothing here places an order. */

var BUY_VENDORS = [
  { k: "amazon",  l: "Amazon",     s: "Amz" },
  { k: "hd",      l: "Home Depot", s: "HD" },
  { k: "walmart", l: "Walmart",    s: "Wmt" },
  { k: "lowes",   l: "Lowe's",     s: "Low" }
];
var BUY_STATUS = ["need", "cart", "ordered", "received", "own", "later", "skip"];
var BUY_OPEN = { need: 1, cart: 1 };   /* statuses that still count as "to buy" */
var BUY_LIST = null;   /* null = every list */

function buyVendor(k) { for (var i = 0; i < BUY_VENDORS.length; i++) if (BUY_VENDORS[i].k === k) return BUY_VENDORS[i]; return { k: k || "other", l: k || "Other", s: "—" }; }
function actBuy() { return (D().buyItems || []).filter(function (x) { return x && !x.deleted; }); }
function buyLists() { var seen = []; actBuy().forEach(function (x) { var l = x.list || "Unfiled"; if (seen.indexOf(l) < 0) seen.push(l); }); return seen.sort(); }
function buyClampQty(n) { n = Math.round(+n || 1); return n < 1 ? 1 : n > 999 ? 999 : n; }
function buyIsOpen(it) { return !!(it && !it.deleted && BUY_OPEN[it.status || "need"]); }

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
/* what we will actually buy: Ray's pick when he made one and it has a price, else the cheapest */
function buyChosen(item) {
  if (item && item.pick) { var l = buyLanded(buyOffer(item, item.pick), item.qty); if (l != null) return { v: item.pick, landed: l, picked: true }; }
  var b = buyBest(item); return b ? { v: b.v, landed: b.landed, picked: false } : null;
}
function buyDelta(item, v) { var b = buyBest(item), o = buyOffer(item, v), l = buyLanded(o, item && item.qty); if (!b || l == null) return null; return Math.round((l - b.landed) * 100) / 100; }
/* price history: when a saved offer's price or shipping differs from before, the old one is kept (newest last, capped). Pure. */
function buyWithHistory(prev, next, at) {
  var hist = (prev && prev.hist ? prev.hist.slice() : []);
  if (prev && +prev.price > 0 && (Math.abs((+prev.price || 0) - (+next.price || 0)) > 0.004 || Math.abs((+prev.ship || 0) - (+next.ship || 0)) > 0.004)) {
    hist.push({ at: prev.checkedAt || "", price: +prev.price || 0, ship: +prev.ship || 0 });
    if (hist.length > 24) hist = hist.slice(-24);
  }
  var out = {}; for (var k in next) out[k] = next[k];
  out.hist = hist; out.checkedAt = at || next.checkedAt || "";
  return out;
}
function buyPrev(o) { var h = (o && o.hist) || []; return h.length ? h[h.length - 1] : null; }
/* totals over what is still to buy: per vendor (only the items it prices), the chosen-mix total, Amazon-only, unpriced */
function buyTotals(items) {
  var out = { vendors: {}, best: 0, bestN: 0, amazon: 0, amazonN: 0, unpriced: 0, picked: 0 };
  BUY_VENDORS.forEach(function (v) { out.vendors[v.k] = { n: 0, sum: 0 }; });
  (items || []).forEach(function (it) {
    if (!buyIsOpen(it)) return;
    var c = buyChosen(it); if (!c) { out.unpriced++; return; }
    out.best += c.landed; out.bestN++; if (c.picked) out.picked++;
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
/* what my Amazon cart scripts read: every open item whose chosen vendor is Amazon (or Amazon is the only price) */
function buyAmazonPlan(items) {
  return (items || []).filter(function (it) {
    if (!buyIsOpen(it)) return false;
    var o = buyOffer(it, "amazon"), c = buyChosen(it); return o && o.sku && (!c || c.v === "amazon");
  }).map(function (it) { return { asin: buyOffer(it, "amazon").sku, qty: Math.max(1, +it.qty || 1) }; });
}
/* the store run: open items whose chosen vendor is a store, grouped by store */
function buyStoreRun(items) {
  var g = {};
  (items || []).forEach(function (it) {
    if (!buyIsOpen(it)) return;
    var c = buyChosen(it); if (!c || c.v === "amazon") return;
    var o = buyOffer(it, c.v); (g[c.v] = g[c.v] || []).push({ name: it.name, qty: it.qty || 1, landed: c.landed, sku: o && o.sku, url: o && o.url, src: o && o.src, picked: c.picked });
  });
  return g;
}
/* the Differences line: every vendor note on the item, in vendor order */
function buyDiffs(item) {
  return BUY_VENDORS.map(function (v) { var o = buyOffer(item, v.k); return o && o.diff ? { v: v.k, s: v.s, text: o.diff } : null; }).filter(Boolean);
}

/* ---- reviews, the per-item store selector, and cart links ----
   Ray, 2026-10-28: "a little selector I can use to pick which one I want to go with… I would also like to see
   the reviews… low number of reviews… should be flagged." An offer carries rating (0-5) and reviews (count).
   Under 5 reviews is "unreliable", under 25 "few reviews"; no count at all says so. Tapping a store's price
   on an item picks that store (tap again to go back to cheapest). Cart links: Amazon's add-to-cart form and
   Walmart's affiliate add-to-cart URL take a list of items; Home Depot and Lowe's have no such link, so
   those are a tap-each list. */
var BUY_REVIEW_FEW = 25, BUY_REVIEW_UNRELIABLE = 5;
function buyReviewFlag(o) {
  if (!o || !(+o.price > 0)) return "";
  var n = +o.reviews; if (!(n >= 0) || o.reviews == null || o.reviews === "") return "no review count";
  if (n < BUY_REVIEW_UNRELIABLE) return "unreliable: " + n + " review" + (n === 1 ? "" : "s");
  if (n < BUY_REVIEW_FEW) return "few reviews: " + n;
  return "";
}
function buyReviewText(o) { if (!o || !(+o.rating > 0)) return ""; return "★" + (Math.round(+o.rating * 10) / 10) + (o.reviews != null && o.reviews !== "" ? " · " + (+o.reviews).toLocaleString() : ""); }
function buyTogglePick(item, v) { return (item && item.pick === v) ? "" : v; }
function buyCartLinks(items) {
  var amz = [], wmt = [], hd = [], low = [];
  (items || []).forEach(function (it) {
    if (!buyIsOpen(it)) return; var c = buyChosen(it); if (!c) return; var o = buyOffer(it, c.v); if (!o) return;
    var q = Math.max(1, +it.qty || 1), row = { name: it.name, qty: q, url: o.url || "", sku: o.sku || "", landed: c.landed };
    if (c.v === "amazon" && o.sku) amz.push(row); else if (c.v === "walmart" && o.sku) wmt.push(row); else if (c.v === "hd") hd.push(row); else if (c.v === "lowes") low.push(row);
  });
  return {
    amazon: { n: amz.length, rows: amz, url: amz.length ? "https://www.amazon.com/gp/aws/cart/add.html?" + amz.map(function (r, i) { return "ASIN." + (i + 1) + "=" + r.sku + "&Quantity." + (i + 1) + "=" + r.qty; }).join("&") : "" },
    walmart: { n: wmt.length, rows: wmt, url: wmt.length ? "https://affil.walmart.com/cart/addToCart?items=" + wmt.map(function (r) { return r.sku + "|" + r.qty; }).join(",") : "" },
    hd: { n: hd.length, rows: hd, url: "" }, lowes: { n: low.length, rows: low, url: "" }
  };
}

/* ---- SEND TO PRICE TOOL (the browser button) ----
   Home Depot, Lowe's and Walmart block automated price pulls; Ray on his own phone or laptop is not automated.
   The bookmark below runs on the product page he is looking at, reads title / price / brand / picture / the
   pickup line off that page, and opens the app with the payload in the URL (?buy=…). No token travels in the
   bookmark; the app is already signed in. The payload lands as a card on the Price tool: pick the item (or a
   new one) and it becomes a VERIFIED offer under the right store, picture included. Pure parts are tested. */
function buyInboxDecode(b64) {
  try { var j = JSON.parse(decodeURIComponent(escape(atob(String(b64 || "").replace(/-/g, "+").replace(/_/g, "/"))))); return (j && j.url) ? j : null; } catch (e) { return null; }
}
function buyInboxOffer(p, at) {
  var u = buyParseUrl(p.url); if (!u) return null;
  var price = parseFloat(String(p.price || "").replace(/[^0-9.]/g, "")) || 0;
  var pick = /pickup|in stock at|aisle|bay \d/i.test(String(p.pickup || "")) && !/not (available|sold)|out of stock|ship(ping)? only|unavailable/i.test(String(p.pickup || ""));
  return { v: u.v, sku: u.sku, url: u.url, price: price, ship: 0, pickup: u.v === "hd" || u.v === "lowes" ? pick : false, eta: String(p.eta || "").slice(0, 40), seller: String(p.seller || "").slice(0, 60), brand: String(p.brand || "").slice(0, 40), pack: "", diff: String(p.pickup || "").slice(0, 80), src: "verified", checkedAt: at || "", hist: [], img: /^https?:\/\//.test(String(p.img || "")) ? String(p.img).slice(0, 400) : "", rating: +p.rating || 0, reviews: (p.reviews === "" || p.reviews == null) ? "" : (parseInt(String(p.reviews).replace(/[^0-9]/g, ""), 10) || 0) };
}
/* the bookmark's code, kept as a function so it reads as code; toString() builds the javascript: link */
function buyBookmarkletFn() {
  var q = function (s) { var e = document.querySelector(s); return e ? (e.content || e.getAttribute("content") || e.textContent || e.src || "").trim() : ""; };
  var ld = ""; try { document.querySelectorAll("script[type=\"application/ld+json\"]").forEach(function (x) { var j = JSON.parse(x.textContent); [].concat(j).forEach(function (o) { if (o && (o["@type"] === "Product" || (o["@graph"] || []).some(function (g) { return g["@type"] === "Product"; }))) { var p = o["@type"] === "Product" ? o : o["@graph"].filter(function (g) { return g["@type"] === "Product"; })[0]; var of = [].concat(p.offers || [])[0] || {}; var ar = p.aggregateRating || {}; ld = { price: of.price || of.lowPrice || "", brand: (p.brand && (p.brand.name || p.brand)) || "", img: [].concat(p.image || [])[0] || "", name: p.name || "", rating: ar.ratingValue || "", reviews: ar.reviewCount || ar.ratingCount || "" }; } }); }); } catch (e) {}
  var price = (ld && ld.price) || q("#corePrice_feature_div .a-offscreen") || q("[data-testid=price] .sui-text-9xl, [data-testid=price]") || q("[itemprop=price]") || q("meta[property=\"product:price:amount\"]") || q(".item-price-dollar") || ((document.body.innerText.match(/\$\s?\d{1,4}(?:[.,]\d\d)/) || [])[0] || "");
  var pickup = ((document.body.innerText.match(/(Free Pickup[^\n.]{0,60}|Pickup[^\n.]{0,60}|In stock at[^\n.]{0,40}|Aisle \d+[^\n.]{0,30}|Out of stock[^\n.]{0,30}|Not sold in stores|Unavailable at[^\n.]{0,40})/) || [])[0] || "");
  var p = { url: location.href.split("?")[0].split("#")[0], title: (ld && ld.name) || q("meta[property=\"og:title\"]") || q("#productTitle") || document.title, price: price, brand: (ld && ld.brand) || q("#bylineInfo") || q("meta[property=\"product:brand\"]") || "", img: (ld && ld.img) || q("meta[property=\"og:image\"]") || q("#landingImage") || "", pickup: pickup, eta: ((document.body.innerText.match(/(?:Get it|Arrives|FREE delivery|Delivery)[^\n.]{0,40}/) || [])[0] || "").slice(0, 40), rating: (ld && ld.rating) || ((q("#acrPopover") || (document.body.innerText.match(/(\d\.\d) out of 5/) || [])[1] || "").match(/\d\.\d/) || [""])[0], reviews: (ld && ld.reviews) || ((q("#acrCustomerReviewText") || (document.body.innerText.match(/([\d,]+)\s+(?:global )?(?:ratings|reviews)/i) || [])[1] || "").replace(/[^0-9]/g, "")) };
  var b64 = btoa(unescape(encodeURIComponent(JSON.stringify(p)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  window.open("https://app.jsuite.dev/?tab=buy&buy=" + b64, "_blank");
}
function buyBookmarkletHref() { return "javascript:(" + buyBookmarkletFn.toString().replace(/\s+/g, " ") + ")()"; }
var BUY_INBOX = null;
if (typeof window !== "undefined") { try { var _bp = new URLSearchParams(location.search).get("buy"); if (_bp) { BUY_INBOX = buyInboxDecode(_bp); try { sessionStorage.setItem("jra_buy_inbox", _bp); } catch (e) {} } else { var _bs = sessionStorage.getItem("jra_buy_inbox"); if (_bs) BUY_INBOX = buyInboxDecode(_bs); } } catch (e) {} }

/* ---- render ---- */
function buyImg(it) { var c = buyChosen(it), co = c ? buyOffer(it, c.v) : null; if (co && co.img) return co.img; var o = ((it && it.offers) || []).filter(function (x) { return x && x.img; })[0]; return o ? o.img : ""; }
function buyMoney(n) { return (typeof money2 === "function") ? money2(n) : "$" + (Math.round(n * 100) / 100).toFixed(2); }
function buyCell(it, v) {
  var o = buyOffer(it, v), l = buyLanded(o, it.qty);
  if (!o || l == null) return '<td class="buy-c buy-none">' + (o && o.url ? '<a href="' + esc(o.url) + '" target="_blank" rel="noopener" class="muted">link</a>' : '<span class="muted">—</span>') + '</td>';
  var b = buyBest(it), c = buyChosen(it), isBest = b && b.v === v, isPick = c && c.picked && c.v === v, d = buyDelta(it, v), prev = buyPrev(o);
  var sub = [];
  if (o.pickup) sub.push("pickup"); else if (+o.ship > 0) sub.push("+" + buyMoney(+o.ship) + " ship"); else sub.push("free ship");
  if (o.eta) sub.push(esc(o.eta));
  if (prev && Math.abs(prev.price - (+o.price || 0)) > 0.004) sub.push((+o.price > prev.price ? "↑" : "↓") + " was " + buyMoney(prev.price));
  var rv = buyReviewText(o), rf = buyReviewFlag(o);
  return '<td class="buy-c buy-tap' + (isBest ? ' buy-best' : '') + (isPick ? ' buy-pick' : '') + '" onclick="event.stopPropagation();buyPick(\'' + it.id + '\',\'' + v + '\')" title="tap to buy this one here"><span class="buy-price">' + (o.url ? '<a href="' + esc(o.url) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' : '') + (o.src === "snippet" ? "≈" : "") + buyMoney(l) + (o.url ? '</a>' : '') + '</span>'
    + (isPick ? ' <span class="buy-pickmark" title="your pick">✓</span>' : '')
    + (isBest || d == null || d === 0 ? '' : ' <span class="muted buy-delta">+' + buyMoney(d) + '</span>')
    + '<div class="muted buy-sub">' + sub.join(" · ") + '</div>'
    + (rv || rf ? '<div class="buy-sub buy-rev">' + rv + (rf ? ' <span class="' + (/^no review/.test(rf) ? "buy-noflag" : "buy-flag") + '">' + esc(rf) + '</span>' : '') + '</div>' : '') + '</td>';
}
/* PHONE: one card per item (Ray, 2026-10-28: "a lot of small text and tiny little area"). Name and the status
   chip on the first line, one muted line of brand · pack · job, the quantity stepper, then the four stores as
   tiles with the landed price large; the Differences fold is a native <details>, so it opens and closes. */
function buyTile(it, v) {
  var vd = buyVendor(v), o = buyOffer(it, v), l = buyLanded(o, it.qty);
  if (!o || l == null) return '<div class="buy-tile buy-tile-none"><div class="buy-tile-v">' + esc(vd.l) + '</div><div class="buy-tile-p muted">' + (o && o.url ? '<a href="' + esc(o.url) + '" target="_blank" rel="noopener">link</a>' : '—') + '</div></div>';
  var b = buyBest(it), c = buyChosen(it), isBest = b && b.v === v, isPick = c && c.picked && c.v === v, d = buyDelta(it, v), prev = buyPrev(o);
  var sub = o.pickup ? "pickup" : (+o.ship > 0 ? "+" + buyMoney(+o.ship) + " ship" : "free ship");
  if (o.eta) sub += " · " + esc(o.eta);
  var was = (prev && Math.abs(prev.price - (+o.price || 0)) > 0.004) ? '<div class="buy-tile-s">' + (+o.price > prev.price ? "↑" : "↓") + " was " + buyMoney(prev.price) + '</div>' : "";
  var rv = buyReviewText(o), rf = buyReviewFlag(o);
  return '<div class="buy-tile buy-tap' + (isBest ? " buy-best" : "") + (isPick ? " buy-pick" : "") + '" onclick="buyPick(\'' + it.id + '\',\'' + v + '\')"><div class="buy-tile-v">' + esc(vd.l) + (isPick ? ' <span class="buy-pickmark">✓ buying here</span>' : "") + '</div>'
    + '<div class="buy-tile-p">' + (o.url ? '<a href="' + esc(o.url) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' : "") + (o.src === "snippet" ? "≈" : "") + buyMoney(l) + (o.url ? "</a>" : "") + '</div>'
    + '<div class="buy-tile-s">' + sub + (isBest || d == null || d === 0 ? "" : ' · <span class="buy-delta">+' + buyMoney(d) + "</span>") + '</div>' + was
    + (rv || rf ? '<div class="buy-tile-s buy-rev">' + rv + (rf ? ' <span class="' + (/^no review/.test(rf) ? "buy-noflag" : "buy-flag") + '">' + esc(rf) + '</span>' : '') + '</div>' : '') + '</div>';
}
function buyCard(it) {
  var dim = it.status === "own" || it.status === "skip" || it.status === "received";
  var c = buyChosen(it), co = c ? buyOffer(it, c.v) : null;
  var brand = (co && co.brand) || ((it.offers || []).filter(function (o) { return o && o.brand; })[0] || {}).brand || "";
  var pack = (co && co.pack) || ((it.offers || []).filter(function (o) { return o && o.pack; })[0] || {}).pack || "";
  var line = [brand, pack ? "pack of " + esc(pack) : "", it.forJob ? "for " + esc(it.forJob) : "", it.spec ? esc(it.spec) : ""].filter(Boolean).join(" · ");
  var diffs = buyDiffs(it), q = '\'' + it.id + '\'';
  return '<div class="card buy-card' + (dim ? " buy-dim" : "") + '">'
    + '<div class="buy-card-hd" onclick="openBuyItem(' + q + ')">' + (buyImg(it) ? '<img class="buy-img buy-img-lg" src="' + esc(buyImg(it)) + '" alt="" loading="lazy">' : "") + '<div class="buy-card-name">' + esc(it.name) + '</div><span class="badge">' + esc(it.status || "need") + '</span></div>'
    + '<div class="buy-card-row"><div class="muted buy-card-line" onclick="openBuyItem(' + q + ')">' + (line || "&nbsp;") + '</div>'
    + '<div class="buy-qty"><button class="buy-step" onclick="buyQty(' + q + ',-1)" aria-label="one fewer">−</button><b>' + (it.qty || 1) + '</b><button class="buy-step" onclick="buyQty(' + q + ',1)" aria-label="one more">+</button></div></div>'
    + '<div class="buy-tiles">' + BUY_VENDORS.map(function (v) { return buyTile(it, v.k); }).join("") + '</div>'
    + (diffs.length || (it.pick && it.pickWhy) ? '<details class="buy-fold"><summary>Differences</summary>'
        + diffs.map(function (d) { return '<div><b>' + esc(buyVendor(d.v).l) + ':</b> ' + esc(d.text) + '</div>'; }).join("")
        + (it.pick && it.pickWhy ? '<div><b>Your pick, ' + esc(buyVendor(it.pick).l) + ':</b> ' + esc(it.pickWhy) + '</div>' : "") + '</details>' : "")
    + '</div>';
}
function rBuy() { view.innerHTML = buyHTML(); }
function buyHTML() {
  var all = actBuy(), lists = buyLists();
  var items = all.filter(function (x) { return !BUY_LIST || (x.list || "Unfiled") === BUY_LIST; });
  var open = items.filter(buyIsOpen);
  var t = buyTotals(items);
  var h = '<div class="secthd"><h2>🛒 Price tool</h2>'
    + '<button class="btn ghost sm" style="margin-left:auto" onclick="openBuyItem(null)">＋ Item</button>'
    + '<button class="btn ghost sm" onclick="buyPasteList()">📋 Paste list</button>'
    + '<button class="btn ghost sm" onclick="buyPasteLink()">🔗 Paste link</button></div>';
  if (lists.length > 1) {
    h += '<div class="subnav" style="margin-bottom:10px"><button class="subbtn ' + (!BUY_LIST ? "on" : "") + '" onclick="buySetList(null)">All</button>'
      + lists.map(function (l) { return '<button class="subbtn ' + (BUY_LIST === l ? "on" : "") + '" onclick="buySetList(' + JSON.stringify(l).replace(/"/g, "&quot;") + ')">' + esc(l) + '</button>'; }).join("") + '</div>';
  }
  if (BUY_INBOX) {
    var ib = BUY_INBOX, iu = buyParseUrl(ib.url), iv = iu ? buyVendor(iu.v) : null;
    var iopts = all.filter(buyIsOpen).sort(function (a, c2) { return String(a.name).localeCompare(String(c2.name)); }).map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join("");
    h += '<div class="card buy-inbox"><div class="buy-card-hd">' + (ib.img ? '<img class="buy-img buy-img-lg" src="' + esc(ib.img) + '" alt="">' : "") + '<div style="flex:1"><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em">From your browser · ' + (iv ? esc(iv.l) : "unknown store") + '</div><div class="buy-card-name">' + esc(ib.title || ib.url) + '</div><div class="buy-card-line">' + (ib.price ? '<b class="buy-price">' + esc(ib.price) + '</b> ' : '<span class="muted">no price read, type it</span> ') + esc([ib.brand, ib.pickup, ib.eta].filter(Boolean).join(" · ")) + '</div></div></div>'
      + '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px;align-items:flex-end"><div style="flex:1 1 180px"><label style="margin-top:0">Which item</label><select id="bx_item"><option value="">New item…</option>' + iopts + '</select></div><div style="flex:0 0 110px"><label style="margin-top:0">Price</label><input id="bx_price" type="number" step="0.01" inputmode="decimal" value="' + esc(String(ib.price || "").replace(/[^0-9.]/g, "")) + '"></div>'
      + '<button class="btn acc" onclick="buyInboxSave()">Save to Price tool</button><button class="btn ghost sm" onclick="buyInboxDrop()">Dismiss</button></div></div>';
  }
  if (!items.length) return h + '<div class="card"><div class="muted">Nothing on the list. Paste the list you were given, or add one item.</div></div>';
  var order = { need: 0, cart: 1, ordered: 2, received: 3, later: 4, own: 5, skip: 6 };
  /* totals: what it costs to buy what is left, at Amazon alone vs the chosen store for each line */
  var saving = Math.round((t.amazon - t.best) * 100) / 100, cl = buyCartLinks(items);
  var lastCheck = ""; items.forEach(function (it) { (it.offers || []).forEach(function (o) { if (o && o.checkedAt && o.checkedAt > lastCheck) lastCheck = o.checkedAt; }); });
  var pendingRecheck = items.filter(function (it) { return buyIsOpen(it) && it.recheckAt && (!lastCheck || it.recheckAt > lastCheck); }).length;
  h += '<div class="card" style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline">'
    + '<div><div class="muted" style="font-size:11px">Still to buy</div><b>' + open.length + '</b> items</div>'
    + '<div><div class="muted" style="font-size:11px">' + (t.picked ? "Your mix" : "Best mix") + '</div><b>' + buyMoney(t.best) + '</b></div>'
    + '<div><div class="muted" style="font-size:11px">All at Amazon</div>' + buyMoney(t.amazon) + (t.amazonN < t.bestN ? ' <span class="muted" style="font-size:11px">(' + t.amazonN + ' of ' + t.bestN + ' priced)</span>' : '') + '</div>'
    + (saving > 0.5 ? '<div><div class="muted" style="font-size:11px">Saved by splitting</div><b class="buy-good">' + buyMoney(saving) + '</b></div>' : '')
    + (t.unpriced ? '<div><div class="muted" style="font-size:11px">No price yet</div>' + t.unpriced + '</div>' : '')
    + (lastCheck ? '<div><div class="muted" style="font-size:11px">Prices checked</div>' + esc(typeof fmtDate === "function" ? fmtDate(lastCheck) : lastCheck) + (pendingRecheck ? ' <span class="muted" style="font-size:11px">· recheck asked</span>' : '') + '</div>' : '')
    + '<div style="flex-basis:100%;display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"><button class="btn ghost sm" onclick="buyRecheck()">🔄 Recheck prices</button>'
    + (cl.amazon.n ? '<a class="btn acc sm" href="' + esc(cl.amazon.url) + '" target="_blank" rel="noopener" onclick="buyNoteCart(\'amazon\')">🛒 Amazon cart · ' + cl.amazon.n + '</a>' : "")
    + (cl.walmart.n ? '<a class="btn acc sm" href="' + esc(cl.walmart.url) + '" target="_blank" rel="noopener">🛒 Walmart cart · ' + cl.walmart.n + '</a>' : "")
    + (cl.hd.n ? '<button class="btn ghost sm" onclick="buyShowStoreRun(\'hd\')">🏬 Home Depot list · ' + cl.hd.n + '</button>' : "")
    + (cl.lowes.n ? '<button class="btn ghost sm" onclick="buyShowStoreRun(\'lowes\')">🏬 Lowe\'s list · ' + cl.lowes.n + '</button>' : "")
    + '<button class="btn ghost sm" onclick="buyCopyAmazonPlan()">📦 Amazon plan</button></div>'
    + '</div>';
  var sorted = items.slice().sort(function (a, b) { return (order[a.status] || 0) - (order[b.status] || 0) || String(a.name).localeCompare(String(b.name)); });
  h += '<div class="buy-cards">' + sorted.map(buyCard).join("") + '</div>';
  h += '<div class="card buy-tablewrap" style="padding:0;overflow:auto"><table class="otable buy-t"><thead><tr><th>Item</th><th class="buy-wide">Brand</th><th class="buy-wide c">Pack</th><th class="c">Qty</th><th class="buy-wide">For</th>'
    + BUY_VENDORS.map(function (v) { return '<th>' + esc(v.l) + '</th>'; }).join("") + '<th>Status</th></tr></thead><tbody>';
  sorted.forEach(function (it) {
    var dim = it.status === "own" || it.status === "skip" || it.status === "received";
    var c = buyChosen(it), co = c ? buyOffer(it, c.v) : null;
    var brand = (co && co.brand) || ((it.offers || []).filter(function (o) { return o && o.brand; })[0] || {}).brand || "";
    var pack = (co && co.pack) || ((it.offers || []).filter(function (o) { return o && o.pack; })[0] || {}).pack || "";
    var diffs = buyDiffs(it);
    h += '<tr' + (dim ? ' style="opacity:.55"' : '') + ' onclick="openBuyItem(\'' + it.id + '\')" style="cursor:pointer">'
      + '<td><div class="buy-name">' + (buyImg(it) ? '<img class="buy-img" src="' + esc(buyImg(it)) + '" alt="" loading="lazy">' : "") + '<span>' + esc(it.name) + '</span></div>'
      + (it.spec ? '<div class="muted buy-sub" style="white-space:normal">' + esc(it.spec) + '</div>' : '')
      + '<div class="muted buy-sub buy-narrow" style="white-space:normal">' + [brand, pack ? "pack of " + esc(pack) : "", it.forJob ? "for " + esc(it.forJob) : ""].filter(Boolean).join(" · ") + '</div>'
      + (diffs.length ? '<div class="buy-sub buy-diffs" style="white-space:normal">' + diffs.map(function (d) { return '<b>' + d.s + ':</b> ' + esc(d.text); }).join(' · ') + '</div>' : '')
      + (it.pick && it.pickWhy ? '<div class="buy-sub buy-diffs" style="white-space:normal"><b>Pick:</b> ' + esc(buyVendor(it.pick).l) + ' — ' + esc(it.pickWhy) + '</div>' : '')
      + '</td>'
      + '<td class="buy-wide buy-brand">' + esc(brand) + '</td><td class="buy-wide c">' + esc(pack) + '</td>'
      + '<td class="c buy-qtycell" onclick="event.stopPropagation()"><div class="buy-qty"><button class="buy-step" onclick="buyQty(\'' + it.id + '\',-1)" aria-label="one fewer">−</button><b>' + (it.qty || 1) + '</b><button class="buy-step" onclick="buyQty(\'' + it.id + '\',1)" aria-label="one more">+</button></div></td><td class="buy-wide buy-for">' + esc(it.forJob || "") + '</td>'
      + BUY_VENDORS.map(function (v) { return buyCell(it, v.k); }).join("")
      + '<td><span class="badge">' + esc(it.status || "need") + '</span></td></tr>';
  });
  h += '</tbody></table></div>';
  h += '<details class="card buy-fold" style="margin-top:10px"><summary>🔖 Get the browser button</summary><div style="font-size:13px;line-height:1.45;margin-top:6px">Drag this link to your bookmarks bar, or on the phone: bookmark any page, then edit the bookmark and paste the code below as its address. On a Home Depot, Walmart, Lowe\'s or Amazon product page, tap it and the price, brand, picture and pickup line land here as a verified offer.</div>'
    + '<div style="margin:8px 0"><a class="btn ghost sm" href="' + esc(buyBookmarkletHref()) + '" onclick="event.preventDefault();alert(\'Drag me to the bookmarks bar instead of clicking.\')">🛒 Send to Price tool</a> <button class="btn ghost sm" onclick="buyCopyBookmarklet()">Copy the code</button></div>'
    + '<textarea id="buy_bm" rows="2" readonly style="font-size:11px">' + esc(buyBookmarkletHref()) + '</textarea></details>';
  h += '<div class="muted buy-foot">Landed = price × qty + shipping. Bold is the cheapest; ✓ is your pick when you chose something else on purpose. ≈ means the price came from a web search, not the store page: check it in the store app before you drive. "was" shows the last price we had. Tap a store\'s price to buy that one there; tap again to go back to cheapest. Review counts under ' + BUY_REVIEW_FEW + ' are flagged.</div>';
  return h;
}

/* ---- actions ---- */
if (typeof window !== "undefined") {
  window.buySetList = function (l) { BUY_LIST = l; render(); };
  window.buyPick = function (id, v) {
    var x = (D().buyItems || []).filter(function (y) { return y && y.id === id; })[0]; if (!x) return;
    if (!buyOffer(x, v) || buyLanded(buyOffer(x, v), x.qty) == null) return;   /* nothing to pick without a price */
    x.pick = buyTogglePick(x, v); if (!x.pick) x.pickWhy = "";
    if (typeof touch === "function") touch(x); if (typeof save === "function") save(); render();
  };
  window.buyInboxDrop = function () { BUY_INBOX = null; try { sessionStorage.removeItem("jra_buy_inbox"); history.replaceState(null, "", location.pathname); } catch (e) {} render(); };
  window.buyInboxSave = function () {
    if (!BUY_INBOX) return; var d = D(); if (!d.buyItems) d.buyItems = [];
    var tday = typeof today === "function" ? today() : "", p = {}; for (var k in BUY_INBOX) p[k] = BUY_INBOX[k]; p.price = val("bx_price") || p.price;
    var off = buyInboxOffer(p, tday); if (!off) { alert("That link is not from a store I know."); return; }
    var id = val("bx_item"), x = id ? d.buyItems.filter(function (y) { return y && y.id === id; })[0] : null;
    if (!x) { x = { id: "buy_" + uid(), list: BUY_LIST || "Unfiled", name: String(p.title || "").slice(0, 80) || "New item", qty: 1, spec: "", forJob: "", status: "need", note: "", pick: "", pickWhy: "", offers: [], deleted: false }; d.buyItems.push(x); }
    var prev = (x.offers || []).filter(function (o) { return o && o.v === off.v; })[0] || null;
    x.offers = (x.offers || []).filter(function (o) { return o && o.v !== off.v; });
    if (prev && !off.img) off.img = prev.img || ""; if (prev && !off.brand) off.brand = prev.brand || ""; if (prev) off.pack = prev.pack || "";
    x.offers.push(buyWithHistory(prev, off, tday));
    if (typeof touch === "function") touch(x); if (typeof save === "function") save();
    window.buyInboxDrop();
  };
  window.buyCopyBookmarklet = function () { var t = document.getElementById("buy_bm"); if (!t) return; t.select(); try { document.execCommand("copy"); } catch (e) {} if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t.value); alert("Copied. Make a bookmark and paste it as the address."); };
  /* quantity is adjusted on the row itself (Ray, 2026-10-28: "quantity should be something I want to be able to adjust") */
  window.buyQty = function (id, delta) {
    var x = (D().buyItems || []).filter(function (y) { return y && y.id === id; })[0]; if (!x) return;
    x.qty = buyClampQty((+x.qty || 1) + delta);
    if (typeof touch === "function") touch(x); if (typeof save === "function") save(); render();
  };
  window.openBuyItem = function (id) {
    var isNew = !id;
    var x = isNew ? { id: "buy_" + uid(), list: BUY_LIST || "", name: "", qty: 1, spec: "", forJob: "", status: "need", note: "", pick: "", pickWhy: "", offers: [] } : actBuy().filter(function (y) { return y.id === id; })[0];
    if (!x) return;
    var opt = function (list, cur, labels) { return list.map(function (s, i) { return '<option value="' + s + '"' + (s === cur ? " selected" : "") + '>' + (labels ? labels[i] : s) + '</option>'; }).join(""); };
    var jobs = []; try { jobs = ((D().jobs || []).concat(D().quotes || [])).filter(function (j) { return j && !j.deleted; }).map(function (j) { return (j.title || j.cust || j.customerName || "") + (j.num ? " #" + j.num : ""); }).filter(Boolean); } catch (e) {}
    var vend = BUY_VENDORS.map(function (v) {
      var o = buyOffer(x, v.k) || {}, hist = (o.hist || []);
      return '<div class="card" style="padding:8px;margin-top:8px"><b>' + esc(v.l) + '</b>' + (o.checkedAt ? ' <span class="muted" style="font-size:11px">checked ' + esc(o.checkedAt) + '</span>' : '')
        + '<div class="row" style="gap:6px;flex-wrap:wrap"><div style="flex:1 1 80px"><label>Price</label><input id="bo_' + v.k + '_price" type="number" step="0.01" inputmode="decimal" value="' + esc(o.price || "") + '"></div>'
        + '<div style="flex:1 1 80px"><label>Shipping</label><input id="bo_' + v.k + '_ship" type="number" step="0.01" inputmode="decimal" value="' + esc(o.ship || "") + '"></div>'
        + '<div style="flex:1 1 90px"><label>Delivery / pickup date</label><input id="bo_' + v.k + '_eta" value="' + esc(o.eta || "") + '" placeholder="Nov 2"></div></div>'
        + '<label><input type="checkbox" id="bo_' + v.k + '_pickup"' + (o.pickup ? " checked" : "") + '> Store pickup (no shipping)</label>'
        + '<label>Link</label><input id="bo_' + v.k + '_url" value="' + esc(o.url || "") + '" placeholder="paste the product link">'
        + '<div class="row" style="gap:6px;flex-wrap:wrap"><div style="flex:1 1 100px"><label>Brand</label><input id="bo_' + v.k + '_brand" value="' + esc(o.brand || "") + '" placeholder="QEP"></div>'
        + '<div style="flex:0 0 80px"><label>Pack of</label><input id="bo_' + v.k + '_pack" value="' + esc(o.pack || "") + '" placeholder="1"></div>'
        + '<div style="flex:1 1 110px"><label>Seller</label><input id="bo_' + v.k + '_seller" value="' + esc(o.seller || "") + '" placeholder="Amazon · marketplace · store"></div>'
        + '<div style="flex:0 0 120px"><label>Price source</label><select id="bo_' + v.k + '_src">' + opt(["verified", "snippet", "manual"], o.src || "manual", ["verified on page", "web search ≈", "typed in"]) + '</select></div></div>'
        + '<label>How this one differs <span class="muted" style="font-weight:400">(size, build, brand, seller)</span></label><input id="bo_' + v.k + '_diff" value="' + esc(o.diff || "") + '" placeholder="e.g. 4 in not 5 in, plastic handle">'
        + (hist.length ? '<div class="muted" style="font-size:11px;margin-top:4px">History: ' + hist.map(function (p) { return buyMoney(p.price) + (p.ship ? "+" + buyMoney(p.ship) : "") + (p.at ? " (" + esc(p.at) + ")" : ""); }).join(" → ") + ' → now</div>' : '')
        + '</div>';
    }).join("");
    modal(isNew ? "Add to the price tool" : "Price tool item",
      '<label style="margin-top:0">Item</label><input id="bi_name" value="' + esc(x.name) + '" autocomplete="off">'
      + '<div class="row" style="gap:8px;flex-wrap:wrap"><div style="flex:0 0 70px"><label>Qty</label><input id="bi_qty" type="number" inputmode="numeric" value="' + esc(x.qty || 1) + '"></div>'
      + '<div class="grow"><label>List</label><input id="bi_list" value="' + esc(x.list || "") + '" list="bi_lists" placeholder="e.g. Stone course"><datalist id="bi_lists">' + buyLists().map(function (l) { return '<option value="' + esc(l) + '">'; }).join("") + '</datalist></div>'
      + '<div style="flex:0 0 110px"><label>Status</label><select id="bi_status">' + opt(BUY_STATUS, x.status || "need") + '</select></div></div>'
      + '<label>For which job</label><input id="bi_for" value="' + esc(x.forJob || "") + '" list="bi_jobs" placeholder="e.g. Christina waterfall"><datalist id="bi_jobs">' + jobs.map(function (j) { return '<option value="' + esc(j) + '">'; }).join("") + '</datalist>'
      + '<label>Spec / size</label><input id="bi_spec" value="' + esc(x.spec || "") + '">'
      + '<label>Note</label><textarea id="bi_note" rows="2">' + esc(x.note || "") + '</textarea>'
      + '<div class="row" style="gap:8px;flex-wrap:wrap"><div style="flex:0 0 150px"><label>Buy it from</label><select id="bi_pick">' + opt([""].concat(BUY_VENDORS.map(function (v) { return v.k; })), x.pick || "", ["cheapest wins"].concat(BUY_VENDORS.map(function (v) { return v.l; }))) + '</select></div>'
      + '<div class="grow"><label>Why that one <span class="muted" style="font-weight:400">(when not the cheapest)</span></label><input id="bi_pickwhy" value="' + esc(x.pickWhy || "") + '" placeholder="e.g. the cheap one is 4 in, I need 5"></div></div>'
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
    var tday = typeof today === "function" ? today() : "";
    x.name = name; x.qty = Math.max(1, parseInt(val("bi_qty"), 10) || 1); x.list = val("bi_list") || "Unfiled";
    x.status = val("bi_status") || "need"; x.spec = val("bi_spec"); x.note = val("bi_note"); x.forJob = val("bi_for");
    x.pick = val("bi_pick"); x.pickWhy = val("bi_pickwhy");
    var prevOffers = x.offers || [];
    x.offers = prevOffers.filter(function (o) { return o && BUY_VENDORS.every(function (v) { return v.k !== o.v; }); });   /* keep any "other" offers */
    BUY_VENDORS.forEach(function (v) {
      var price = parseFloat(val("bo_" + v.k + "_price")) || 0, url = val("bo_" + v.k + "_url");
      if (!(price > 0) && !url) return;
      var p = buyParseUrl(url), prev = prevOffers.filter(function (o) { return o && o.v === v.k; })[0] || null;
      var next = { v: v.k, sku: (p && p.v === v.k) ? p.sku : (prev && prev.sku) || "", url: url, price: price, ship: parseFloat(val("bo_" + v.k + "_ship")) || 0,
        pickup: (document.getElementById("bo_" + v.k + "_pickup") || {}).checked === true, eta: val("bo_" + v.k + "_eta"), seller: val("bo_" + v.k + "_seller"),
        brand: val("bo_" + v.k + "_brand"), pack: val("bo_" + v.k + "_pack"), diff: val("bo_" + v.k + "_diff"), src: val("bo_" + v.k + "_src") || "manual", checkedAt: tday };
      var changed = !prev || Math.abs((+prev.price || 0) - price) > 0.004 || Math.abs((+prev.ship || 0) - next.ship) > 0.004;
      x.offers.push(buyWithHistory(prev, next, changed ? tday : (prev.checkedAt || tday)));
    });
    x.deleted = false; if (typeof touch === "function") touch(x);
    if (isNew) d.buyItems.push(x);
    if (typeof save === "function") save(); if (typeof closeModal === "function") closeModal(); render();
  };
  window.delBuyItem = function (id) {
    if (!confirm("Remove this item from the price tool?")) return;
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
      var c = buyChosen(x), co = c ? buyOffer(x, c.v) : null;
      inv = { id: "inv_buy_" + x.id, name: x.name, cat: "tool", have: true, qty: String(x.qty || 1), price: "", brand: (co && co.brand) || "", tags: [], section: x.list || "", notes: "Marked owned on the price tool " + (typeof today === "function" ? today() : "") + (x.spec ? ". " + x.spec : "") };
      d.inventory.push(inv); x.invId = inv.id;
    }
    inv.have = true; inv.deleted = false; if (typeof touch === "function") touch(inv);
    x.status = "own"; if (typeof touch === "function") touch(x);
    if (typeof save === "function") save(); if (typeof closeModal === "function") closeModal(); render();
  };
  /* RECHECK: nothing is scraped from here (the stores block it). The open items get a recheck stamp and a to-do
     goes on this org's list for me to run the Amazon cart read + a web check and write the new offers back,
     each with today's checkedAt, so the price history grows. */
  window.buyRecheck = function () {
    var d = D(), items = actBuy().filter(function (x) { return buyIsOpen(x) && (!BUY_LIST || (x.list || "Unfiled") === BUY_LIST); });
    if (!items.length) { modal("Recheck prices", '<div class="muted">Nothing open to recheck on this list.</div>'); return; }
    if (!confirm("Ask for a fresh price check on " + items.length + " item" + (items.length === 1 ? "" : "s") + "? The new prices land in the table with today's date and the old ones stay as history.")) return;
    var tday = typeof today === "function" ? today() : "", stamp = typeof now === "function" ? now() : Date.now();
    items.forEach(function (x) { x.recheckAt = tday; if (typeof touch === "function") touch(x); });
    if (!d.todos) d.todos = [];
    var td = { id: "td_buy_recheck_" + stamp.toString(36), title: "Price tool: recheck prices on " + items.length + " item" + (items.length === 1 ? "" : "s") + (BUY_LIST ? " (" + BUY_LIST + ")" : "") + " at Amazon, Home Depot, Walmart" + (items.some(function (x) { return buyLanded(buyOffer(x, "amazon"), x.qty) > 100; }) ? ", Lowe's" : "") + " — Ray tapped Recheck", due: tday, done: false, deleted: false, source: "buy-list" };
    if (typeof touch === "function") touch(td); d.todos.push(td);
    if (typeof save === "function") save(); render();
    modal("Recheck asked", '<div class="muted" style="font-size:13px">' + items.length + ' items stamped and a to-do written. I run the check and write the prices back; the table shows "was $…" on anything that moved.</div>');
  };
  window.buyPasteList = function () {
    modal("Paste a list", '<div class="muted" style="font-size:12px">One item per line. "- Name, qty 2, $18.70" with the link on the next line works, so does "Name x2 $18.70 https://…".</div>'
      + '<label>List name</label><input id="bp_list" value="' + esc(BUY_LIST || "") + '" placeholder="e.g. Stone course">'
      + '<label>For which job</label><input id="bp_for" placeholder="optional">'
      + '<textarea id="bp_text" rows="10" style="margin-top:8px" placeholder="paste here"></textarea>'
      + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="buyImportPasted()">Add them</button>');
  };
  window.buyImportPasted = function () {
    var rows = buyParseList((document.getElementById("bp_text") || {}).value || ""), list = val("bp_list") || "Unfiled", forJob = val("bp_for");
    if (!rows.length) { alert("Nothing I could read on those lines."); return; }
    var d = D(); if (!d.buyItems) d.buyItems = [];
    var tday = typeof today === "function" ? today() : "";
    rows.forEach(function (r) {
      var p = buyParseUrl(r.url), x = { id: "buy_" + uid(), list: list, name: r.name, qty: r.qty, spec: "", forJob: forJob, status: "need", note: "", pick: "", pickWhy: "", offers: [], deleted: false };
      if (p || r.price) x.offers.push({ v: p ? p.v : "amazon", sku: p ? p.sku : "", url: r.url || "", price: r.price || 0, ship: 0, pickup: false, eta: "", seller: "", brand: "", pack: "", diff: "", src: "manual", checkedAt: tday, hist: [] });
      if (typeof touch === "function") touch(x); d.buyItems.push(x);
    });
    BUY_LIST = list; if (typeof save === "function") save(); if (typeof closeModal === "function") closeModal(); render();
  };
  /* a link from a store app: file it under the vendor on an existing item, or start a new item with it */
  window.buyPasteLink = function () {
    var opts = actBuy().filter(buyIsOpen).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); })
      .map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join("");
    modal("Paste a product link", '<label style="margin-top:0">Link</label><input id="bl_url" placeholder="https://www.homedepot.com/p/…">'
      + '<div class="row" style="gap:8px"><div class="grow"><label>Price</label><input id="bl_price" type="number" step="0.01" inputmode="decimal"></div><div style="flex:0 0 110px"><label>Shipping</label><input id="bl_ship" type="number" step="0.01" inputmode="decimal" placeholder="0"></div></div>'
      + '<label><input type="checkbox" id="bl_pickup" checked> Store pickup</label>'
      + '<div class="row" style="gap:8px"><div class="grow"><label>Brand</label><input id="bl_brand"></div><div style="flex:0 0 90px"><label>Pack of</label><input id="bl_pack" placeholder="1"></div></div>'
      + '<label>How it differs from the others</label><input id="bl_diff" placeholder="optional">'
      + '<label>For which item</label><select id="bl_item"><option value="">New item…</option>' + opts + '</select>'
      + '<label>New item name (if new)</label><input id="bl_name">'
      + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="buySaveLink()">Save</button>');
  };
  window.buySaveLink = function () {
    var p = buyParseUrl(val("bl_url")); if (!p) { alert("That is not a store link I recognise."); return; }
    var d = D(); if (!d.buyItems) d.buyItems = [];
    var id = val("bl_item"), x = id ? d.buyItems.filter(function (y) { return y && y.id === id; })[0] : null;
    if (!x) { var nm = val("bl_name"); if (!nm) { alert("Name the new item."); return; } x = { id: "buy_" + uid(), list: BUY_LIST || "Unfiled", name: nm, qty: 1, spec: "", forJob: "", status: "need", note: "", pick: "", pickWhy: "", offers: [], deleted: false }; d.buyItems.push(x); }
    var tday = typeof today === "function" ? today() : "", prev = (x.offers || []).filter(function (o) { return o && o.v === p.v; })[0] || null;
    x.offers = (x.offers || []).filter(function (o) { return o && o.v !== p.v; });
    x.offers.push(buyWithHistory(prev, { v: p.v, sku: p.sku, url: p.url, price: parseFloat(val("bl_price")) || 0, ship: parseFloat(val("bl_ship")) || 0, pickup: (document.getElementById("bl_pickup") || {}).checked === true, eta: "", seller: "", brand: val("bl_brand"), pack: val("bl_pack"), diff: val("bl_diff"), src: "verified", checkedAt: tday }, tday));
    if (typeof touch === "function") touch(x); if (typeof save === "function") save(); if (typeof closeModal === "function") closeModal(); render();
  };
  window.buyCopyAmazonPlan = function () {
    var items = actBuy().filter(function (x) { return !BUY_LIST || (x.list || "Unfiled") === BUY_LIST; }), plan = buyAmazonPlan(items), txt = JSON.stringify(plan);
    var done = function () { modal("Amazon plan", '<div class="muted" style="font-size:12px">' + plan.length + ' items we are buying at Amazon. This is what the cart scripts read; nothing is ordered from here.</div><textarea rows="6" style="margin-top:8px" readonly>' + esc(txt) + '</textarea>'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, done); else done();
  };
  window.buyNoteCart = function (v) { /* the cart link opened in a new tab; nothing to record yet (ordering stays Ray's) */ };
  window.buyShowStoreRun = function (only) {
    var items = actBuy().filter(function (x) { return !BUY_LIST || (x.list || "Unfiled") === BUY_LIST; }), g = buyStoreRun(items), keys = Object.keys(g).filter(function (k) { return !only || k === only; });
    if (!keys.length) { modal("Store run", '<div class="muted">Everything open is an Amazon buy right now, so there is no store run.</div>'); return; }
    modal("Store run", keys.map(function (k) {
      var rows = g[k], sum = rows.reduce(function (s, r) { return s + r.landed; }, 0);
      return '<h3 style="margin:8px 0 4px">' + esc(buyVendor(k).l) + ' <span class="muted" style="font-weight:400">' + buyMoney(sum) + '</span></h3>'
        + rows.map(function (r) { return '<div class="row" style="gap:8px;padding:4px 0;border-bottom:1px solid var(--line)"><div class="grow">' + (r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' : '') + esc(r.name) + (r.url ? '</a>' : '') + (r.qty > 1 ? ' ×' + r.qty : '') + (r.picked ? ' <span class="muted">✓ your pick</span>' : '') + (r.src === "snippet" ? ' <span class="muted">≈ check in app</span>' : '') + '</div><div>' + buyMoney(r.landed) + '</div></div>'; }).join("");
    }).join(""));
  };
  window.rBuy = rBuy; window.buyHTML = buyHTML; window.actBuy = actBuy;
}
if (typeof module !== "undefined") module.exports = { BUY_VENDORS: BUY_VENDORS, BUY_STATUS: BUY_STATUS, buyParseUrl: buyParseUrl, buyLanded: buyLanded, buyBest: buyBest, buyChosen: buyChosen, buyDelta: buyDelta, buyWithHistory: buyWithHistory, buyPrev: buyPrev, buyTotals: buyTotals, buyParseList: buyParseList, buyAmazonPlan: buyAmazonPlan, buyStoreRun: buyStoreRun, buyOffer: buyOffer, buyDiffs: buyDiffs, buyIsOpen: buyIsOpen, buyClampQty: buyClampQty, buyCard: buyCard, buyTile: buyTile, buyImg: buyImg, buyReviewFlag: buyReviewFlag, buyReviewText: buyReviewText, buyTogglePick: buyTogglePick, buyCartLinks: buyCartLinks, buyInboxDecode: buyInboxDecode, buyInboxOffer: buyInboxOffer, buyBookmarkletHref: buyBookmarkletHref, buyHTML: buyHTML };
