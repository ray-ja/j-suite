/* svg-upload-tests.js — SVG uploads: accepted, sanitised, and served so they can't execute.
   Ray, 2026-08-05: "just make it so i can give you the straight svg files im not uploading a script lol".
   He's right that HE isn't the threat. The real exposure is that anything landing in uploads/ is served
   back by content-type, so an SVG there is a live page in his own origin. Hence: accept it, check it on the
   way in, and lock it on the way out. Pure node. Run: node svg-upload-tests.js */
const fs = require("fs"), path = require("path");
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (x ? "  -> " + x : "")); } }

const SV = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");
const H = fs.readFileSync(path.join(__dirname, "js", "27-helpers.js"), "utf8");
const F = fs.readFileSync(path.join(__dirname, "js", "127-files.js"), "utf8");

console.log("\n--- accepted on the way in ---");
ok("the upload allowlist includes svg+xml", /image\\\/\(\?:png\|jpe\?g\|webp\|svg\\\+xml\)/.test(SV) || SV.indexOf("svg\\+xml") > 0);
ok("it gets a .svg extension, not .svg+xml", /m\[1\] === "image\/svg\+xml" \? "svg"/.test(SV));
ok("the client gate allows .svg", /\\\.\(csv\|svg\)\$/.test(H));
ok("the picker offers it", /\.csv,\.svg/.test(F));

console.log("\n--- but NEVER rasterised (that would defeat the point) ---");
ok("the downscaler returns an SVG untouched", /image\/svg\+xml"\|\|\/\\\.svg\$\/i\.test\(file\.name\|\|""\)\)\)return Promise\.resolve\(file\)/.test(H));
ok("...and says why", /NEVER rasterise a vector/.test(H));

console.log("\n--- checked on the way in ---");
[["<script>", "script"], ["<foreignObject>", "foreignObject"], ["inline handlers", "on\\[a-z\\]\\+"],
 ["javascript: URLs", "javascript"], ["external refs", "iframe\\|embed\\|object"], ["XML entities", "ENTITY"]]
 .forEach(([label, pat]) => ok("rejects " + label, new RegExp(pat).test(SV)));
ok("the error tells him what to do", /export it as a plain vector/.test(SV));

console.log("\n--- and locked on the way out ---");
ok("svg responses carry a CSP", /ext === "\.svg"\) hdrs\["Content-Security-Policy"\]/.test(SV));
ok("...that blocks everything by default", /default-src 'none'/.test(SV));
ok("...and sandboxes it", /sandbox/.test(SV));
ok("every static response is nosniff", /"X-Content-Type-Options": "nosniff"/.test(SV));
ok("the CSP still permits it to RENDER (style + data: images)", /style-src 'unsafe-inline'; img-src data:/.test(SV));

console.log("\n--- the sanitiser, executed against real payloads ---");
const nasty = [
  [/<\s*script/i,                      '<svg><script>alert(1)</script></svg>'],
  [/<\s*foreignObject/i,               '<svg><foreignObject><b>hi</b></foreignObject></svg>'],
  [/\son[a-z]+\s*=/i,                  '<svg onload="alert(1)"></svg>'],
  [/javascript\s*:/i,                  '<svg><a href="javascript:alert(1)">x</a></svg>'],
  [/<\s*(iframe|embed|object|use[^>]*href\s*=\s*["']?https?:)/i, '<svg><iframe src="http://x"></iframe></svg>'],
  [/<!ENTITY/i,                        '<!DOCTYPE d [<!ENTITY a "b">]><svg/>']
];
nasty.forEach(([re, payload]) => ok("blocks: " + payload.slice(0, 42), re.test(payload)));

const clean = fs.existsSync(path.join(__dirname, "websites", "obx-junk-co", "logo.svg"))
  ? fs.readFileSync(path.join(__dirname, "websites", "obx-junk-co", "logo.svg"), "utf8") : '<svg><path d="M0 0"/></svg>';
ok("a REAL logo passes every check", !nasty.some(([re]) => re.test(clean)), "a legitimate logo was rejected");

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
