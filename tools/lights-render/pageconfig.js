// Writes assets/quotes/<slug>/quote.json from the page's own price tables, so the server prices a deposit
// exactly like the page does (the browser total is never trusted).
// usage: node pageconfig.js <slug> <org> <customerId> "<title>"
const fs = require("fs"), path = require("path"), vm = require("vm");
const [slug, org, customerId, title] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(slug || "") || !org || !customerId) { console.log("usage: node pageconfig.js <slug> <org> <customerId> <title>"); process.exit(1); }
const dir = path.join(__dirname, "..", "..", "assets", "quotes", slug);
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const js = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
const a = js.indexOf("var MIN="), b = js.indexOf("var ALL=");
if (a < 0 || b < 0) { console.log("page tables not found"); process.exit(1); }
const m = js.match(/var BUNDLE=(\[[^;]*\]);/);
const ctx = {}; vm.createContext(ctx);
vm.runInContext(js.slice(a, b) + (m ? "\nvar BUNDLE=" + m[1] + ";" : "\nvar BUNDLE=null;"), ctx);
const items = [];
ctx.GROUPS.forEach(g => g.items.forEach(i => items.push({ id: i.id, label: i.label, price: i.sizes ? null : Math.round(i.price * 100) / 100,
  sizes: i.sizes ? i.sizes.map(s => [s[0], s[1]]) : null, base: !!i.base, decor: i.kind === "decor", lead: ctx.LEADKEY[i.id] == null ? null : ctx.LEADKEY[i.id] })));
const cfg = { slug, org, customerId, title: title || slug, min: ctx.MIN, depPct: ctx.DEP, buffer: ctx.BUFFER, lead: ctx.LEAD, bundle: ctx.BUNDLE || null,
  colors: ctx.COLORS.map(c => ({ id: c.id, name: c.name })), items };
fs.writeFileSync(path.join(dir, "quote.json"), JSON.stringify(cfg, null, 1));
console.log("wrote", path.join("assets/quotes", slug, "quote.json"), items.length, "items");
