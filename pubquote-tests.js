// node pubquote-tests.js — public quote deposit pricing (pubquote.js)
const p = require("./pubquote.js"); let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n); } };
const cfg = { slug: "test-house", org: "lights", customerId: "c1", title: "1 Test St", min: 800, depPct: 0.5, buffer: 2,
  lead: { roof: 6, mini: 6, net: 6, garland: 6, wreath: { 24: 5, 36: 6, 48: 8, 60: 10 }, color: { warm: 0 } },
  bundle: [[500, .05], [1000, .10], [1500, .15]], colors: [{ id: "warm", name: "Warm white" }, { id: "multi", name: "Multicolor" }],
  items: [{ id: "rf", label: "Roofline", price: 1000, base: true, lead: "roof" }, { id: "rail", label: "Railing", price: 600, lead: "mini" },
    { id: "cols", label: "Columns", price: 500, lead: "mini" }, { id: "gar", label: "Garland", price: 400, decor: true, lead: "garland" },
    { id: "wr", label: "Wreath", sizes: [["36 in", 110], ["60 in", 325]], decor: true }] };
const now = Date.parse("2026-11-09T15:00:00");
let r = p.pqPrice(cfg, { on: [] }, now);
ok("base roofline is always included", r.lines.length === 1 && r.total === 1000);
ok("deposit is half", r.deposit === 500);
ok("install = today + slowest lead + buffer", r.installDate === "2026-11-17");
r = p.pqPrice(cfg, { on: ["rail", "cols", "gar"] }, now);
ok("bundle 10% on lights add-ons only (garland excluded)", r.save === 110 && r.total === 1000 + 600 + 500 + 400 - 110);
r = p.pqPrice(cfg, { on: ["wr"], sz: { wr: 1 } }, now);
ok("sized item takes the chosen size and its lead time", r.lines[1].amt === 325 && r.installDate === "2026-11-21");
r = p.pqPrice(cfg, { on: ["wr"], sz: { wr: 9 } }, now);
ok("out-of-range size is clamped", r.lines[1].amt === 325);
r = p.pqPrice(cfg, { on: ["nope", "rail"], color: "evil" }, now);
ok("unknown ids and colors are ignored", r.lines.length === 2 && r.color === "warm");
const small = Object.assign({}, cfg, { items: [{ id: "rf", label: "Roofline", price: 300, base: true, lead: "roof" }] });
ok("job minimum applies", p.pqPrice(small, {}, now).total === 800);
const rec = p.pqRecord(cfg, p.pqPrice(cfg, { on: ["rail", "cols"], color: "multi" }, now), { name: "Pat Doe", email: "pat@x.com" }, null, now);
ok("record carries picks, color, date, deposit and a savings line", rec.id === "q_pub_test-house" && rec.pubPicks.on.join() === "rf,rail,cols" && rec.pubPicks.color === "multi" && rec.depositAmount === Math.round(rec.total / 2) && rec.items.some(i => i.price < 0));
ok("record total equals the sum of its lines", Math.abs(rec.items.reduce((a, i) => a + i.price, 0) - rec.total) < 0.01);
ok("buyer needs a name and a real email", !!p.pqValidBuyer({ name: "", email: "a@b.co" }).error && !!p.pqValidBuyer({ name: "A", email: "nope" }).error && !p.pqValidBuyer({ name: "A", email: "a@b.co" }).error);
ok("status hides everything until the deposit is paid", p.pqStatus(rec).booked === false && p.pqStatus(Object.assign({}, rec, { depositPaid: true })).installDate === rec.installDate);
ok("bad slugs are refused", p.pqLoad(__dirname, "../etc") === null && p.pqLoad(__dirname, "a/b") === null);
const em = p.pqEmail(cfg, Object.assign({}, rec, { depositPaid: true }), "OBX Holiday Lights");
ok("confirmation email has the date, total and 'the lights stay ours'", /booked/.test(em.subject) && em.html.includes("The lights stay ours") && em.html.includes("Balance on install day"));
const real = p.pqLoad(__dirname, "mikey-bay-lights-7c4e");
ok("Mikey's page config prices his defaults at $2,269", real && p.pqPrice(real, { on: ["fp"] }, now).total === 2269);
const mixCfg = Object.assign({}, cfg, { mixColors: true });
r = p.pqPrice(mixCfg, { on: ["rail"], color: "warm", mini: "multi" }, now);
ok("mixed colors: roofline and railings each keep their color", r.color === "warm" && r.mini === "multi" && /roofline warm white, railings, shrubs and trees multicolor/.test(r.colorName));
ok("mixed colors are ignored on a page without the mix option", p.pqPrice(cfg, { on: ["rail"], color: "warm", mini: "multi" }, now).mini === "warm");
ok("one color reads as before", p.pqPrice(mixCfg, { on: ["rail"], color: "multi", mini: "multi" }, now).colorName === "Multicolor");
const mrec = p.pqRecord(mixCfg, r, { name: "Pat Doe", email: "pat@x.com" }, null, now);
ok("mixed record keeps both colors and the email shows them", mrec.pubPicks.mini === "multi" && p.pqEmail(mixCfg, mrec, "X").html.includes("railings, shrubs and trees multicolor"));
const kim = p.pqLoad(__dirname, "kim-voyager-lights-e72f");
ok("Kim's live page still prices one color", kim && !kim.mixColors && p.pqPrice(kim, { on: ["fu"], color: "warm" }, now).colorName === "Warm white");
console.log("\n=========  " + pass + " passed, " + fail + " failed  ========="); process.exit(fail ? 1 : 0);
