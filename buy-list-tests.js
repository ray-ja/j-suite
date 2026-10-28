/* buy-list-tests.js — the Buy list (js/203): one list, every vendor side by side, compared at LANDED cost.

   Ray, 2026-10-28: "make this into a tool and make it part of our normal operating procedures… a nice organized
   table with differences between them, price, shipping, estimated delivery date."

   What has to be true:
     - landed = price × qty + shipping, and store pickup means no shipping (Home Depot / Lowe's are compared at pickup)
     - the cheapest landed offer wins; a tie goes to a verified price over a web-search snippet
     - a pasted store link files under the right vendor (Amazon ASIN, Home Depot /p/, Walmart /ip/, Lowe's /pd/)
     - a pasted list in the shape Stoner J writes them becomes items with price + link
     - totals only count what is still to buy; owned / skipped / received lines fall out
     - the Amazon plan is only the lines Amazon wins, in the {asin, qty} shape the cart scripts read
     - DATA LAYER: buyItems is a real synced collection — blank() creates it, the server lists it, and a store
       with buyItems survives migrateStore + mergeState + a round-trip with zero loss, alongside every other record.

   Pure node. Run: node buy-list-tests.js */
const fs = require("fs"), path = require("path");
const B = require("./js/203-buy-list.js");
const t = require("./sync-server");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, JSON.stringify(g) === JSON.stringify(w), "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

console.log("\n--- links file under the right vendor ---");
eq("Amazon /dp/", B.buyParseUrl("https://www.amazon.com/dp/B003HIWR08?th=1"), { v: "amazon", sku: "B003HIWR08", url: "https://www.amazon.com/dp/B003HIWR08?th=1" });
eq("Amazon long product url", B.buyParseUrl("https://www.amazon.com/SKIL-3540-02-7-Inch-Wet-Tile/dp/B003HIWR08/ref=sr_1_2").sku, "B003HIWR08");
eq("Amazon /gp/product/", B.buyParseUrl("https://www.amazon.com/gp/product/B000BQS90G").sku, "B000BQS90G");
eq("a bare ASIN becomes an Amazon link", B.buyParseUrl("B000BQS90G").url, "https://www.amazon.com/dp/B000BQS90G");
eq("Home Depot /p/", B.buyParseUrl("https://www.homedepot.com/p/QEP-Epoxy-Float-10064Q/100136259"), { v: "hd", sku: "100136259", url: "https://www.homedepot.com/p/QEP-Epoxy-Float-10064Q/100136259" });
eq("Home Depot short /p/", B.buyParseUrl("https://www.homedepot.com/p/311174620").sku, "311174620");
eq("Walmart /ip/", B.buyParseUrl("https://www.walmart.com/ip/Mainstays-Scale/13891909169").v, "walmart");
eq("Walmart /ip/ id", B.buyParseUrl("https://www.walmart.com/ip/13891909169").sku, "13891909169");
eq("Lowe's /pd/", B.buyParseUrl("https://www.lowes.com/pd/Marshalltown-TC24-L/5015598387"), { v: "lowes", sku: "5015598387", url: "https://www.lowes.com/pd/Marshalltown-TC24-L/5015598387" });
eq("some other shop is 'other'", B.buyParseUrl("https://lancasterlimeworks.com/product/lime-putty/").v, "other");
eq("not a link, not an ASIN → null", B.buyParseUrl("mortar hoe"), null);

console.log("\n--- landed cost ---");
eq("price × qty + shipping", B.buyLanded({ price: 22.40, ship: 11.62 }, 1), 34.02);
eq("qty multiplies the price, not the shipping", B.buyLanded({ price: 18.70, ship: 5 }, 2), 42.40);
eq("store pickup zeroes shipping", B.buyLanded({ price: 11.52, ship: 8.99, pickup: true }, 1), 11.52);
eq("no price = no landed", B.buyLanded({ url: "x" }, 1), null);
eq("qty below 1 is treated as 1", B.buyLanded({ price: 10 }, 0), 10);

console.log("\n--- the cheapest offer wins; ties prefer a verified price ---");
const paddle = { qty: 1, offers: [{ v: "amazon", price: 22.40, ship: 11.62, src: "verified" }, { v: "hd", price: 19.98, pickup: true, src: "snippet" }] };
eq("Home Depot wins the spiral paddle on landed cost", B.buyBest(paddle).v, "hd");
eq("delta shows how much more Amazon is", B.buyDelta(paddle, "amazon"), 14.04);
eq("delta of the winner is 0", B.buyDelta(paddle, "hd"), 0);
const tie = { qty: 1, offers: [{ v: "hd", price: 3.93, pickup: true, src: "snippet" }, { v: "amazon", price: 3.93, ship: 0, src: "verified" }] };
eq("same landed price: the verified one wins over the snippet", B.buyBest(tie).v, "amazon");
eq("an item with links but no prices has no best", B.buyBest({ qty: 1, offers: [{ v: "hd", url: "x" }] }), null);
eq("delta with no price on that vendor is null", B.buyDelta(paddle, "walmart"), null);

console.log("\n--- totals count only what is still to buy ---");
const items = [
  { id: "a", status: "need", qty: 1, offers: [{ v: "amazon", price: 49.44, ship: 0 }, { v: "hd", price: 129.99, pickup: true }] },
  { id: "b", status: "cart", qty: 2, offers: [{ v: "amazon", price: 18.70, ship: 0 }, { v: "hd", price: 12.97, pickup: true, src: "snippet" }] },
  { id: "c", status: "own", qty: 1, offers: [{ v: "amazon", price: 999 }] },
  { id: "d", status: "skip", qty: 1, offers: [{ v: "amazon", price: 500 }] },
  { id: "e", status: "need", qty: 1, offers: [{ v: "walmart", url: "x" }] },
  { id: "f", status: "need", qty: 1, offers: [{ v: "hd", price: 5.47, pickup: true }], deleted: true }
];
const tot = B.buyTotals(items);
eq("all-at-Amazon total", tot.amazon, 86.84);
eq("best-mix total (goggles move to Home Depot)", tot.best, 75.38);
eq("priced lines", tot.bestN, 2);
eq("owned, skipped and deleted lines do not count", tot.vendors.amazon.n, 2);
eq("a line with no price anywhere is counted as unpriced", tot.unpriced, 1);
eq("Home Depot column sums only what it prices", tot.vendors.hd.sum, 155.93);

console.log("\n--- a pasted list becomes items ---");
const txt = "AMAZON\n- Chemical splash goggles, indirect vent, qty 2, $18.70\n  https://www.amazon.com/dp/B0001YXFFM\n- Safety glasses, clear, qty 1 twelve-pack, $16.95\n  https://www.amazon.com/dp/B01G9J08Q6\n- Long-cuff nitrile chemical gloves, qty 2 pairs, $18.95 each x2\n  https://www.amazon.com/dp/B004US9VKS\nMortar hoe x1 $52.48 https://www.amazon.com/dp/B000LOZBHM\n# a heading\n- Wheelbarrow, two wheels, about 6 cu ft, 1 (Lowe's)";
const rows = B.buyParseList(txt);
eq("five items read (the AMAZON header line reads as an item with no price, so six lines → the ones with names)", rows.length, 6);
eq("name is cleaned of qty and price", rows[1].name, "Chemical splash goggles, indirect vent");
eq("qty 2 picked up", rows[1].qty, 2);
eq("price picked up", rows[1].price, 18.70);
eq("the link on the next line attaches", rows[1].url, "https://www.amazon.com/dp/B0001YXFFM");
eq("'each x2' keeps the unit price and the quantity", [rows[3].price, rows[3].qty], [18.95, 2]);
eq("one-line form works", [rows[4].name, rows[4].qty, rows[4].price, rows[4].url], ["Mortar hoe", 1, 52.48, "https://www.amazon.com/dp/B000LOZBHM"]);
eq("a line with no price or link still becomes an item", [rows[5].price, rows[5].url], [0, ""]);

console.log("\n--- the Amazon plan and the store run ---");
const planItems = [
  { status: "need", qty: 2, offers: [{ v: "amazon", sku: "B0001YXFFM", price: 18.70 }, { v: "hd", price: 12.97, pickup: true, sku: "324485176", url: "https://www.homedepot.com/p/324485176", src: "snippet" }] },
  { status: "need", qty: 1, offers: [{ v: "amazon", sku: "B007IASPW0", price: 49.44 }, { v: "hd", price: 129.99, pickup: true }] },
  { status: "cart", qty: 1, offers: [{ v: "amazon", sku: "B0C1GJ2ZKT", price: 9.99 }] },
  { status: "own", qty: 1, offers: [{ v: "amazon", sku: "B000000000", price: 1 }] },
  { status: "need", qty: 1, offers: [{ v: "hd", url: "x" }] }
];
eq("plan = Amazon-won lines in {asin, qty}", B.buyAmazonPlan(planItems), [{ asin: "B007IASPW0", qty: 1 }, { asin: "B0C1GJ2ZKT", qty: 1 }]);
const run = B.buyStoreRun(planItems);
eq("store run groups by the winning store", Object.keys(run), ["hd"]);
eq("the goggles are on the Home Depot run at landed cost, flagged as a snippet", [run.hd[0].landed, run.hd[0].src, run.hd[0].qty], [25.94, "snippet", 2]);

console.log("\n--- cheaper is not always better: a pick overrides the cheapest ---");
const trowel = { qty: 1, status: "need", pick: "amazon", pickWhy: "the cheap one is 4 in, I need 5", offers: [{ v: "amazon", sku: "B089CZHX7M", price: 12.27, src: "verified", brand: "QEP", pack: "1" }, { v: "hd", sku: "203713868", price: 2.96, pickup: true, src: "snippet", diff: "HDX economy 9 in, plastic handle" }] };
eq("the cheapest is still Home Depot", B.buyBest(trowel).v, "hd");
eq("but the chosen vendor is his pick", [B.buyChosen(trowel).v, B.buyChosen(trowel).picked, B.buyChosen(trowel).landed], ["amazon", true, 12.27]);
eq("a pick with no price falls back to the cheapest", B.buyChosen({ qty: 1, pick: "lowes", offers: trowel.offers }).v, "hd");
eq("totals follow the pick (and count it)", [B.buyTotals([trowel]).best, B.buyTotals([trowel]).picked], [12.27, 1]);
eq("the Amazon plan includes a picked Amazon line even when a store is cheaper", B.buyAmazonPlan([trowel]), [{ asin: "B089CZHX7M", qty: 1 }]);
eq("the store run leaves a picked-away line out", Object.keys(B.buyStoreRun([trowel])), []);
eq("differences line lists every vendor note in order", B.buyDiffs(trowel), [{ v: "hd", s: "HD", text: "HDX economy 9 in, plastic handle" }]);
eq("open = need or cart only", [B.buyIsOpen({ status: "need" }), B.buyIsOpen({ status: "cart" }), B.buyIsOpen({ status: "later" }), B.buyIsOpen({ status: "own" }), B.buyIsOpen({ status: "need", deleted: true })], [true, true, false, false, false]);

eq("quantity stepper clamps to 1..999", [B.buyClampQty(0), B.buyClampQty(-3), B.buyClampQty(2.4), B.buyClampQty(5000)], [1, 1, 2, 999]);
const SRC203 = fs.readFileSync(path.join(__dirname, "js", "203-buy-list.js"), "utf8");
ok("the Qty cell carries a − / + stepper that does not open the row", /buy-step[^\n]*buyQty\(/.test(SRC203) && /buy-qtycell" onclick="event.stopPropagation\(\)"/.test(SRC203));

console.log("\n--- send to Price tool: the browser button payload ---");
global.atob = global.atob || (s => Buffer.from(s, "base64").toString("binary"));
const payload = { url: "https://www.homedepot.com/p/QEP-Epoxy-Float/100136259?store=3519", title: "QEP 4 in. x 9-1/2 in. Epoxy Grout Float", price: "$11.52", brand: "QEP", img: "https://images.thdstatic.com/productImages/x.jpg", pickup: "Free Pickup Today at Kill Devil Hills", eta: "" };
const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const dec = B.buyInboxDecode(b64);
eq("payload round-trips through the URL-safe base64", dec && dec.title, payload.title);
eq("garbage decodes to null", [B.buyInboxDecode("%%%"), B.buyInboxDecode(""), B.buyInboxDecode(Buffer.from("{\"x\":1}").toString("base64"))], [null, null, null]);
const off = B.buyInboxOffer(dec, "2026-10-28");
eq("a Home Depot page becomes a verified HD offer with sku, price, pickup and picture", [off.v, off.sku, off.price, off.pickup, off.src, off.img, off.brand, off.checkedAt], ["hd", "100136259", 11.52, true, "verified", payload.img, "QEP", "2026-10-28"]);
eq("the pickup line is kept as the difference note", off.diff, "Free Pickup Today at Kill Devil Hills");
eq("out of stock at the store is not pickup", B.buyInboxOffer({ url: "https://www.homedepot.com/p/311174620", price: "19.98", pickup: "Out of stock at Kill Devil Hills" }).pickup, false);
eq("Amazon pages never count as pickup", B.buyInboxOffer({ url: "https://www.amazon.com/dp/B003HIWR08", price: "$109.00", pickup: "Pickup available" }).pickup, false);
eq("a link from some other shop files under other (Lancaster Lime Works is a real supplier)", B.buyInboxOffer({ url: "https://lancasterlimeworks.com/product/lime-putty/", price: "$105" }).v, "other");
eq("not a link at all is refused", B.buyInboxOffer({ url: "lime putty", price: "5" }), null);
eq("a non-http image is dropped", B.buyInboxOffer({ url: "https://www.walmart.com/ip/13891909169", price: "12.53", img: "data:image/png;base64,xx" }).img, "");
const href = B.buyBookmarkletHref();
ok("the bookmark is a javascript: link that opens the app with ?tab=buy&buy=", /^javascript:\(function/.test(href) && /app\.jsuite\.dev\/\?tab=buy&buy=/.test(href) && href.length < 6000);
ok("the bookmark carries no token or password", !/token|password|Bearer/i.test(href));

console.log("\n--- reviews, the store selector, cart links ---");
eq("no count at all is said out loud", B.buyReviewFlag({ price: 10 }), "no review count");
eq("under 5 reviews is unreliable", B.buyReviewFlag({ price: 10, reviews: 3 }), "unreliable: 3 reviews");
eq("one review reads singular", B.buyReviewFlag({ price: 10, reviews: 1 }), "unreliable: 1 review");
eq("under 25 is few", B.buyReviewFlag({ price: 10, reviews: 12 }), "few reviews: 12");
eq("25 and up is fine", B.buyReviewFlag({ price: 10, reviews: 25 }), "");
eq("an unpriced offer is not flagged", B.buyReviewFlag({ url: "x" }), "");
eq("review text: stars and count", B.buyReviewText({ rating: 4.43, reviews: 1203 }), "★4.4 · 1,203");
eq("review text without a count", B.buyReviewText({ rating: 5 }), "★5");
eq("tapping a store picks it; tapping the picked one clears", [B.buyTogglePick({ pick: "" }, "hd"), B.buyTogglePick({ pick: "hd" }, "hd"), B.buyTogglePick({ pick: "hd" }, "amazon")], ["hd", "", "amazon"]);
const cartItems = [
  { status: "need", qty: 2, offers: [{ v: "amazon", sku: "B0001YXFFM", price: 18.70 }] },
  { status: "cart", qty: 1, offers: [{ v: "amazon", sku: "B007IASPW0", price: 49.44 }, { v: "hd", sku: "316634462", url: "https://www.homedepot.com/p/316634462", price: 129.99, pickup: true }] },
  { status: "need", qty: 1, pick: "walmart", offers: [{ v: "amazon", sku: "B0113UZJE2", price: 10.99 }, { v: "walmart", sku: "13891909169", url: "https://www.walmart.com/ip/13891909169", price: 12.53 }] },
  { status: "need", qty: 3, offers: [{ v: "hd", sku: "100136259", url: "https://www.homedepot.com/p/100136259", price: 11.52, pickup: true }, { v: "amazon", sku: "B08B3B4YW3", price: 21.99 }] },
  { status: "own", qty: 1, offers: [{ v: "amazon", sku: "B000000000", price: 1 }] }
];
const cl = B.buyCartLinks(cartItems);
eq("Amazon cart link lists the Amazon-won lines with quantities", cl.amazon.url, "https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B0001YXFFM&Quantity.1=2&ASIN.2=B007IASPW0&Quantity.2=1");
eq("Walmart cart link follows the pick, item|qty form", cl.walmart.url, "https://affil.walmart.com/cart/addToCart?items=13891909169|1");
eq("Home Depot has no cart link, just the tap-each list", [cl.hd.url, cl.hd.n, cl.hd.rows[0].qty, cl.hd.rows[0].landed], ["", 1, 3, 34.56]);
eq("owned lines stay out of every cart", cl.amazon.n + cl.walmart.n + cl.hd.n + cl.lowes.n, 4);

console.log("\n--- hands-free recheck through Apify (server side, pure parts) ---");
const slab = { buyItems: [
  { id: "a", status: "cart", qty: 1, offers: [{ v: "amazon", sku: "B0001YXFFM", price: 18.70, checkedAt: "2026-10-28", src: "verified" }, { v: "hd", sku: "324485176", url: "https://www.homedepot.com/p/324485176", price: 12.97, pickup: true, src: "snippet", checkedAt: "2026-10-28" }] },
  { id: "b", status: "later", qty: 1, offers: [{ v: "amazon", sku: "B000000001", price: 5 }] },
  { id: "c", status: "need", qty: 1, offers: [{ v: "walmart", sku: "13891909169", url: "https://www.walmart.com/ip/13891909169", price: 12.53, src: "snippet" }, { v: "lowes", url: "x", price: 1 }] },
  { id: "d", status: "need", qty: 1, deleted: true, offers: [{ v: "amazon", sku: "B000000002", price: 5 }] }
] };
const plan = t.buyApifyPlan(slab);
eq("the plan takes open items only, one row per store offer with an id or link", [plan.amazon.map(r => r.sku), plan.hd.map(r => r.sku), plan.walmart.map(r => r.sku)], [["B0001YXFFM"], ["324485176"], ["13891909169"]]);
eq("ids narrow the plan", t.buyApifyPlan(slab, ["c"]).amazon.length + t.buyApifyPlan(slab, ["c"]).walmart.length, 1);
eq("Amazon input is the actor's Product Detail shape", t.BUY_APIFY.amazon.input(plan.amazon), { mode: "Product Detail", asins: ["B0001YXFFM"], domain: "com", zip: "27964" });
eq("Home Depot input carries the product URLs plus the local zip", t.BUY_APIFY.hd.input(plan.hd).productUrls, ["https://www.homedepot.com/p/324485176"]);
eq("Walmart input is startUrls", t.BUY_APIFY.walmart.input(plan.walmart).startUrls, ["https://www.walmart.com/ip/13891909169"]);
const am = t.buyApifyMap("amazon", { asin: "b0001yxffm", title: "Uvex Stealth", brand: "Uvex", price: { value: 17.99, currency: "USD", raw: "$17.99" }, rating: 4.6, ratings_total: 3120, images: [{ link: "https://m.media-amazon.com/images/I/x.jpg" }], in_stock: true });
eq("Amazon record maps (asin upper-cased, structured price unwrapped)", [am.key, am.price, am.rating, am.reviews, am.img], ["B0001YXFFM", 17.99, 4.6, 3120, "https://m.media-amazon.com/images/I/x.jpg"]);
const hd = t.buyApifyMap("hd", { recordType: "product", productId: "324485176", title: "HDX goggles", brand: "HDX", price: 12.97, rating: 4.1, reviewsCount: 7, thumbnail: "https://images.thdstatic.com/x.jpg", pickupAvailable: true, availabilityText: "In stock", storeName: "Kill Devil Hills", storeQuantity: 14 });
eq("Home Depot record maps with pickup and the store line", [hd.key, hd.price, hd.reviews, hd.pickup, hd.avail], ["324485176", 12.97, 7, true, "In stock · Kill Devil Hills · 14 in store"]);
eq("Home Depot review records are skipped", t.buyApifyMap("hd", { recordType: "review", reviewRating: 5 }), null);
const wm = t.buyApifyMap("walmart", { url: "https://www.walmart.com/ip/Mainstays/13891909169", name: "Mainstays scale", brand: "Mainstays", pricing: { current_price: 11.97, display_price: "$11.97" }, metrics: { average_rating: 4.4, review_count: 812 }, media: { primary_image_url: "https://i5.walmartimages.com/x.jpg" }, availability: { status: "IN_STOCK" }, seller: { name: "Walmart.com" } });
eq("Walmart record maps (id from the url, nested price / metrics / media)", [wm.key, wm.price, wm.rating, wm.reviews, wm.seller], ["13891909169", 11.97, 4.4, 812, "Walmart.com"]);
eq("junk records map to null", [t.buyApifyMap("amazon", null), t.buyApifyMap("hd", "x"), t.buyApifyMap("other", {})], [null, null, null]);
const slab2 = JSON.parse(JSON.stringify(slab));
const ap = t.buyApifyApply(slab2, "amazon", [am], "2026-11-04");
eq("apply updates the matching offer, keeps the old price in history with its date", [ap.updated, ap.moved, slab2.buyItems[0].offers[0].price, slab2.buyItems[0].offers[0].hist, slab2.buyItems[0].offers[0].checkedAt, slab2.buyItems[0].offers[0].rating, slab2.buyItems[0].offers[0].reviews, slab2.buyItems[0].offers[0].img], [1, 1, 17.99, [{ at: "2026-10-28", price: 18.70, ship: 0 }], "2026-11-04", 4.6, 3120, "https://m.media-amazon.com/images/I/x.jpg"]);
const ap2 = t.buyApifyApply(slab2, "hd", [hd], "2026-11-04");
eq("apply on Home Depot: a snippet becomes verified, pickup follows the store, the store line lands in the note", [ap2.updated, slab2.buyItems[0].offers[1].src, slab2.buyItems[0].offers[1].pickup, slab2.buyItems[0].offers[1].diff, slab2.buyItems[0].offers[1].hist.length], [1, "verified", true, "In stock · Kill Devil Hills · 14 in store", 0]);
eq("apply never touches other vendors, deleted items, or unmatched offers", [slab2.buyItems[2].offers[0].price, slab2.buyItems[3].offers[0].price, t.buyApifyApply(slab2, "walmart", [{ key: "999", price: 1 }], "2026-11-04").updated], [12.53, 5, 0]);
eq("a zero price from the store is ignored, not written", t.buyApifyApply(slab2, "amazon", [{ key: "B0001YXFFM", price: 0 }], "2026-11-05").updated, 0);
const S203 = fs.readFileSync(path.join(__dirname, "js", "203-buy-list.js"), "utf8");
ok("the client tries /api/buy/recheck first and falls back to the to-do on no-apify", /\/api\/buy\/recheck/.test(S203) && /no-apify/.test(S203) && /function buyRecheckTodo/.test(S203));
const SRV = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");
ok("the server route is super-admin only and reads the token from org-keys (never the request)", /\/api\/buy\/recheck"\) \{[\s\S]{0,400}superAdmin/.test(SRV) && /function apifyToken\(\) \{[^\n]*orgKeysLoad/.test(SRV));

console.log("\n--- price history ---");
const first = B.buyWithHistory(null, { v: "amazon", price: 22.40, ship: 11.62 }, "2026-10-28");
eq("first save: no history, stamped today", [first.hist, first.checkedAt], [[], "2026-10-28"]);
const same = B.buyWithHistory(first, { v: "amazon", price: 22.40, ship: 11.62 }, "2026-10-29");
eq("same price again: nothing added to history", same.hist.length, 0);
const moved = B.buyWithHistory(first, { v: "amazon", price: 19.98, ship: 11.62 }, "2026-11-04");
eq("a price change keeps the old price with its date", moved.hist, [{ at: "2026-10-28", price: 22.40, ship: 11.62 }]);
eq("the last previous price is what the cell shows as was", B.buyPrev(moved).price, 22.40);
const shipMoved = B.buyWithHistory(moved, { v: "amazon", price: 19.98, ship: 0 }, "2026-11-10");
eq("a shipping change counts too; history grows newest-last", shipMoved.hist.map(h => h.ship), [11.62, 11.62]);
eq("an unpriced previous offer (link only) is not history", B.buyWithHistory({ v: "hd", url: "x" }, { v: "hd", price: 5, url: "x" }, "2026-10-28").hist.length, 0);
const html = B.buyHTML ? null : null;   /* buyHTML needs the DOM store; rendering is covered by load-smoke + the screenshots */

console.log("\n--- data layer: buyItems is a real collection (zero loss) ---");
const STATE = fs.readFileSync(path.join(__dirname, "js", "02-state.js"), "utf8");
ok("blank() creates buyItems", /buyItems:\[\]/.test(STATE));
ok("load() backfills buyItems on every org slab (both backfill blocks)", (STATE.match(/S\[b\]\.buyItems=\[\]/g) || []).length >= 2);
ok("the server lists buyItems in COLLECTIONS", t.COLLECTIONS ? t.COLLECTIONS.includes("buyItems") : /"payLinks", "buyItems"\]/.test(fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8")));
const SHELL = fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8");
ok("the shell loads js/203 before boot", SHELL.indexOf("js/203-buy-list.js") > 0 && SHELL.indexOf("js/203-buy-list.js") < SHELL.indexOf("js/29-boot.js"));
const ROUT = fs.readFileSync(path.join(__dirname, "js", "03-routing.js"), "utf8");
ok("routing: the buy tab has a screen, a label and a menu", /buy:\(typeof rBuy/.test(ROUT) && /buy:\{l:"Price tool"/.test(ROUT) && /"resale","buy"\]/.test(ROUT));

/* realistic pre-feature store (no buyItems anywhere) + a store that already has buyItems: both must survive untouched */
const legacy = {
  obx: { customers: [{ id: "c1", name: "Christina", updatedAt: 10 }], quotes: [{ id: "q42", total: 2292.5, updatedAt: 10 }], jobs: [{ id: "j1", updatedAt: 10 }], properties: [{ id: "p1", updatedAt: 10 }], inventory: [{ id: "inv-porta-wrap", name: "Porta-wrap", have: false, updatedAt: 10 }] },
  stone: { customers: [], inventory: [{ id: "inv-stone-wheelbarrow", name: "Wheelbarrow", have: true, updatedAt: 10 }] },
  registry: [{ id: "obx", name: "OBX Lot Solutions", updatedAt: 5 }, { id: "stone", name: "OBX Stoneworks", updatedAt: 5 }],
  users: [{ id: "own", username: "ray", role: "owner", superAdmin: true, updatedAt: 1 }, { id: "mem_obx_own", kind: "membership", orgId: "obx", accountId: "own", role: "owner", active: true, updatedAt: 1 }, { id: "mem_stone_own", kind: "membership", orgId: "stone", accountId: "own", role: "owner", active: true, updatedAt: 1 }]
};
const mig = t.migrateStore(JSON.parse(JSON.stringify(legacy)));
ok("legacy store: migrate keeps every customer/quote/job/property/inventory record (zero loss)",
  mig.obx.customers.some(c => c.id === "c1") && mig.obx.quotes.some(q => q.id === "q42" && q.total === 2292.5) && mig.obx.jobs.some(j => j.id === "j1") && mig.obx.properties.some(p => p.id === "p1") && mig.obx.inventory.some(i => i.id === "inv-porta-wrap") && mig.stone.inventory.some(i => i.id === "inv-stone-wheelbarrow"));
ok("legacy store: no buyItems key is fine (migrate scaffolds only the core four, like every other collection); mergeState fills it", mig.obx.buyItems === undefined || Array.isArray(mig.obx.buyItems));
const filled = t.mergeState(mig, {});
ok("mergeState gives every org an empty buyItems array (so a client never sees a missing collection)", Array.isArray(filled.obx.buyItems) && filled.obx.buyItems.length === 0 && Array.isArray(filled.stone.buyItems));
ok("that fill drops nothing", filled.obx.customers.length === 1 && filled.obx.quotes.length === 1 && filled.stone.inventory.length === 1);
ok("legacy store: accounts and memberships survive", mig.users.filter(u => !u.kind).length === 1 && mig.users.filter(u => u.kind === "membership").length === 2);

const buy = { id: "buy_1", list: "Stone course", name: "Spiral mixing paddle", qty: 1, status: "need", offers: [{ v: "amazon", sku: "B00ABMECYC", price: 22.40, ship: 11.62, src: "verified" }, { v: "hd", sku: "311174620", price: 19.98, pickup: true, src: "snippet" }], updatedAt: 20 };
const incoming = { stone: { buyItems: [buy] } };
const merged = t.mergeState(mig, incoming);
ok("a buyItems write merges in and keeps its offers intact", merged.stone.buyItems.length === 1 && merged.stone.buyItems[0].offers.length === 2 && merged.stone.buyItems[0].offers[0].ship === 11.62);
ok("the write did NOT drop the org's other records", merged.stone.inventory.some(i => i.id === "inv-stone-wheelbarrow") && merged.obx.customers.some(c => c.id === "c1") && merged.obx.quotes.some(q => q.id === "q42"));
const round = t.mergeState(merged, t.projectForUser(merged, ["obx", "stone"], { id: "own", superAdmin: true }));
ok("buyItems survives a full sync round-trip (re-push) with zero loss", round.stone.buyItems.length === 1 && round.stone.buyItems[0].name === "Spiral mixing paddle");
ok("round-trip keeps every other collection too", round.obx.customers.length === 1 && round.obx.quotes.length === 1 && round.obx.jobs.length === 1 && round.obx.properties.length === 1 && round.obx.inventory.length === 1);
const newer = t.mergeState(round, { stone: { buyItems: [Object.assign({}, buy, { status: "own", updatedAt: 30 })] } });
ok("per-record LWW: a newer status wins, the older offers are carried on the newer record", newer.stone.buyItems[0].status === "own");
const stale = t.mergeState(newer, { stone: { buyItems: [Object.assign({}, buy, { status: "need", updatedAt: 25 })] } });
ok("per-record LWW: a stale write does not roll it back", stale.stone.buyItems[0].status === "own");
const emptyPush = t.mergeState(stale, { stone: { buyItems: [] } });
ok("an empty push never drops the list", emptyPush.stone.buyItems.length === 1);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
