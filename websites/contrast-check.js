/* contrast-check.js — catch invisible text WITHOUT a browser.
 *
 * Ray, 2026-08-13, on a pricing page I shipped: "This pricing page is literally unreadable and horrendously
 * ugly… It's actually white on white text. Are you not looking at these?"
 *
 * He was right, and the root cause was specific: I used `<section class="band">` as a generic content wrapper.
 * On this stylesheet `.band` means "amber call-to-action block with WHITE text", so a white `.card` nested
 * inside it rendered white-on-white. I read the HTML and never rendered it.
 *
 * Chrome and Firefox are both broken on this box (Chrome hangs indefinitely; Firefox is a snap with mount-
 * namespace errors), so a screenshot is not available. This is the deterministic substitute — it would have
 * caught that exact bug:
 *   1. UNKNOWN CLASS — a class used in HTML that the stylesheet never defines (how `narrow` slipped in).
 *   2. INVISIBLE TEXT — an element whose inherited text colour equals its own/ancestor background colour.
 *
 * It is deliberately simple: a real cascade needs a browser. It resolves the colour and background actually
 * declared on the class chain, which is enough to catch the failure that matters.
 *
 * Usage: node contrast-check.js <site-dir>          e.g. node contrast-check.js obx-holiday-lights
 */
"use strict";
const fs = require("fs"), path = require("path");

const dir = process.argv[2];
if (!dir) { console.error("usage: node contrast-check.js <site-dir>"); process.exit(2); }
const root = path.resolve(__dirname, dir);
const cssFile = path.join(root, "style.css");
if (!fs.existsSync(cssFile)) { console.error("no style.css in " + root); process.exit(2); }

/* ---- parse the stylesheet into { selector: {color, background} } ---- */
const css = fs.readFileSync(cssFile, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const RULES = {};                       // ".band" -> {color:"#fff", bg:"var(--orange)"}
const VARS = {};                        // "--orange" -> "#d99420"
(css.match(/--[a-z0-9-]+\s*:\s*[^;]+/gi) || []).forEach(d => {
  const m = /(--[a-z0-9-]+)\s*:\s*([^;]+)/i.exec(d); if (m) VARS[m[1]] = m[2].trim();
});
function resolve(v) {
  if (!v) return v;
  let out = String(v).trim(), guard = 0;
  while (/var\(\s*(--[a-z0-9-]+)/i.test(out) && guard++ < 6) {
    out = out.replace(/var\(\s*(--[a-z0-9-]+)[^)]*\)/i, (_, name) => VARS[name] || "");
  }
  return out.trim().toLowerCase();
}
function norm(c) {
  c = resolve(c);
  if (!c) return "";
  if (c === "#fff" || c === "#ffffff" || c === "white") return "#ffffff";
  if (c === "#000" || c === "#000000" || c === "black") return "#000000";
  const m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return "#" + m[1].split("").map(x => x + x).join("");
  return c;
}
(css.match(/[^{}]+\{[^}]*\}/g) || []).forEach(block => {
  const i = block.indexOf("{");
  const sels = block.slice(0, i).split(",").map(s => s.trim());
  const body = block.slice(i + 1, -1);
  const color = (/(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(body) || [])[1];
  const bg = (/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i.exec(body) || [])[1];
  if (!color && !bg) return;
  sels.forEach(sel => {
    if (!/^[.a-z][a-z0-9 .:_-]*$/i.test(sel)) return;
    const r = RULES[sel] = RULES[sel] || {};
    if (color) r.color = norm(color.split(" ")[0]);
    if (bg) { const first = bg.trim().split(/\s+/)[0]; if (!/^(url|linear|radial)/i.test(first)) r.bg = norm(first); }
  });
});
const KNOWN = new Set(Object.keys(RULES).filter(s => s.startsWith(".")).map(s => s.slice(1).split(/[ .:]/)[0]));
(css.match(/\.[a-z0-9_-]+/gi) || []).forEach(c => KNOWN.add(c.slice(1)));

/* ---- walk each page ---- */
let problems = 0, checked = 0;
const IGNORE = new Set(["ic", "sep", "grow", "sub", "nm", "wrap"]);   // utility classes, no colour of their own

fs.readdirSync(root).filter(f => /\.html$/.test(f)).sort().forEach(file => {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  checked++;

  /* 1. classes the stylesheet never defines */
  const used = new Set();
  (html.match(/class="([^"]+)"/g) || []).forEach(a => {
    a.replace(/class="([^"]+)"/, "$1").split(/\s+/).forEach(c => { if (c) used.add(c); });
  });
  const unknown = [...used].filter(c => !KNOWN.has(c) && !IGNORE.has(c));
  if (unknown.length) { problems++; console.log("  ⚠ " + file + " — class not in the stylesheet: " + unknown.join(", ")); }

  /* 2. invisible text: an element whose background equals the text colour it inherits */
  const stack = [];
  const tagRe = /<(\/?)(section|div|article|main|footer|header)\b([^>]*)>/gi;
  let m;
  while ((m = tagRe.exec(html))) {
    if (m[1]) { stack.pop(); continue; }
    const cls = ((/class="([^"]+)"/.exec(m[3]) || [])[1] || "").split(/\s+/).filter(Boolean);
    let color = "", bg = "";
    cls.forEach(c => { const r = RULES["." + c]; if (r) { if (r.color) color = r.color; if (r.bg) bg = r.bg; } });
    const inheritedColor = color || (stack.slice().reverse().find(f => f.color) || {}).color || "";
    const ownBg = bg || (stack.slice().reverse().find(f => f.bg) || {}).bg || "";
    if (inheritedColor && ownBg && inheritedColor === ownBg) {
      problems++;
      console.log("  ✗ " + file + " — INVISIBLE TEXT: ." + cls.join(".") + " has background " + ownBg
        + " and inherits colour " + inheritedColor);
    }
    stack.push({ color: color, bg: bg, cls: cls });
  }
});

console.log("\n" + (problems ? "✗ " + problems + " problem(s) across " + checked + " pages"
                              : "✓ no invisible text and no unknown classes across " + checked + " pages"));
process.exit(problems ? 1 : 0);
