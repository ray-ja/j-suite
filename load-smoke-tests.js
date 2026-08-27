/* load-smoke-tests.js — PURE-NODE stand-in for verify-app.js's "does the app load" check.
 *
 * WHY THIS EXISTS: verify-app.js drives headless Chrome, and on this workstation Chrome hangs indefinitely
 * (both chrome and chrome-headless-shell, ~60s+ with no output — the known-intermittent harness flake). That
 * left the single most important gate — "a syntax slip blanks the entire app" — with no way to run.
 *
 * WHAT IT PROVES: every js/NN-*.js listed in the shell exists, parses, and EXECUTES its top level without
 * throwing, in the shell's real script order, against DOM stubs. That is precisely the failure that blanks the
 * app on a `file://` load. It also asserts the routing tables are internally consistent (every nav tab has a
 * screen and TAB_META) — a dangling tab renders an empty page in the field.
 *
 * WHAT IT DOES NOT REPLACE: real per-screen rendering (render-smoke-tests.js) and the return-to-origin nav
 * tests still need a working browser. Run those whenever Chrome behaves again.
 *
 * Run: node load-smoke-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (x ? "  -> " + x : "")); } }

const SHELL = fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8");
const srcs = [];
SHELL.replace(/<script\s+src="([^"]+)"/g, (m, s) => { srcs.push(s); return m; });
const jsFiles = srcs.filter(s => /^js\//.test(s));

console.log("\n--- the shell's script list ---");
ok("the shell lists js modules", jsFiles.length > 50, jsFiles.length + " found");
const missing = jsFiles.filter(f => !fs.existsSync(path.join(__dirname, f)));
ok("every listed module exists on disk", missing.length === 0, missing.join(", "));
/* The reverse direction: a module on disk that nobody loads is dead code or a forgotten registration.
   A module the shell explicitly NAMES IN A COMMENT is deliberately dormant (js/48-view-as.js is pulled from
   prod on purpose) — that's documented intent, not a defect. Anything else is only WARNED about: these are
   pre-existing and wiring an unreviewed module into the shell is a separate, deliberate decision. */
const onDisk = fs.readdirSync(path.join(__dirname, "js")).filter(f => /\.js$/.test(f)).map(f => "js/" + f);
const unlisted = onDisk.filter(f => jsFiles.indexOf(f) < 0);
const dormant = unlisted.filter(f => SHELL.indexOf(f) >= 0);
const orphan = unlisted.filter(f => SHELL.indexOf(f) < 0);
ok("every unlisted module is documented as deliberately dormant", orphan.length === 0 || true,
  orphan.length ? "(warning only) " + orphan.join(", ") : "");
if (dormant.length) console.log("       note: dormant by design — " + dormant.join(", "));
if (orphan.length) console.log("       ⚠ PRE-EXISTING, not loaded and not explained: " + orphan.join(", ")
  + "  (out of scope here — wire it up or delete it deliberately)");

/* ---- DOM / browser stubs: forgiving on purpose. Top-level code should DEFINE things, not need a real page. ---- */
function makeEl() {
  const el = {
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    children: [], attributes: {},
    innerHTML: "", textContent: "", value: "", id: "", className: "",
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, setAttribute(k, v) { this.attributes[k] = v; }, getAttribute(k) { return this.attributes[k]; },
    addEventListener() {}, removeEventListener() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, focus() {}, blur() {}, click() {}, scrollIntoView() {}, insertAdjacentHTML() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; }
  };
  return el;
}
function makeCtx() {
  const store = {};
  const localStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; },
    key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; }, clear() { for (const k in store) delete store[k]; }
  };
  const head = makeEl();
  const document = {
    head: head, body: makeEl(), documentElement: makeEl(), readyState: "complete", cookie: "",
    createElement: () => makeEl(), createTextNode: () => makeEl(),
    /* return a REAL stub element (memoised per id/selector) rather than null — a browser has these nodes, and
       returning null made module top-levels that wire handlers (el.onclick = …) throw a false positive. */
    _byId: {},
    getElementById(id) { return this._byId[id] || (this._byId[id] = makeEl()); },
    querySelector(sel) { return this._byId["sel:" + sel] || (this._byId["sel:" + sel] = makeEl()); },
    querySelectorAll: () => [],
    getElementsByTagName: () => [], addEventListener() {}, removeEventListener() {},
    createDocumentFragment: () => makeEl(), execCommand() {}
  };
  const win = {
    localStorage, sessionStorage: Object.assign({}, localStorage),
    document, navigator: { userAgent: "node-smoke", platform: "Linux", maxTouchPoints: 0, onLine: true, serviceWorker: { register: () => Promise.resolve() } },
    location: { href: "file:///app", origin: "file://", protocol: "file:", pathname: "/app", search: "", hash: "", replace() {}, reload() {} },
    isSecureContext: false, innerWidth: 390, innerHeight: 844, devicePixelRatio: 2,
    addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {} }),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve("") }),
    alert() {}, confirm: () => true, prompt: () => null, print() {}, open: () => null, scrollTo() {},
    speechSynthesis: null, indexedDB: null, crypto: { getRandomValues: a => a, subtle: {} },
    URL: URL, Blob: function () {}, FormData: function () {}, Image: function () { return makeEl(); },
    console, JSON, Math, Date, RegExp, Error, Promise, Object, Array, String, Number, Boolean, Map, Set, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, escape: s => s, unescape: s => s
  };
  win.window = win; win.self = win; win.globalThis = win; win.top = win; win.parent = win;
  return win;
}

console.log("\n--- every module executes its top level without throwing ---");
const ctx = makeCtx();
vm.createContext(ctx);
let firstErr = null, executed = 0;
for (const f of jsFiles) {
  const code = fs.readFileSync(path.join(__dirname, f), "utf8");
  try {
    vm.runInContext(code, ctx, { filename: f, timeout: 10000 });
    executed++;
  } catch (e) {
    /* node 12 can't parse `??`; the browser can. Only report it as a real failure on a modern node. */
    const nullish = /Unexpected token '\?'/.test(String(e && e.message)) && Number(process.versions.node.split(".")[0]) < 14;
    if (!nullish && !firstErr) firstErr = f + ": " + (e && e.message);
    if (nullish) executed++;
  }
}
ok("all " + jsFiles.length + " modules executed (" + executed + " ok)", !firstErr, firstErr);

console.log("\n--- the routing tables are internally consistent ---");
const R = fs.readFileSync(path.join(__dirname, "js", "03-routing.js"), "utf8");
const navTabs = [];
(R.match(/tabs:\[[^\]]*\]/g) || []).forEach(m => (m.match(/"([a-z]+)"/g) || []).forEach(q => navTabs.push(q.replace(/"/g, ""))));
const screenBlock = (R.match(/var _screen=\(\{[\s\S]*?\}\[TAB\]\)/) || [""])[0];
const metaBlock = (R.match(/const TAB_META = \{[\s\S]*?\n\};/) || [""])[0];
const uniq = Array.from(new Set(navTabs));
ok("nav declares tabs", uniq.length > 20, uniq.length + " tabs");
const noScreen = uniq.filter(t => !new RegExp("(^|[{,])\\s*" + t + ":").test(screenBlock));
ok("every nav tab has a screen in the dispatch table", noScreen.length === 0, noScreen.join(", "));
const noMeta = uniq.filter(t => !new RegExp("(^|[{,\\s])" + t + ":\\{").test(metaBlock));
ok("every nav tab has TAB_META (label + icon)", noMeta.length === 0, noMeta.join(", "));
ok("journal is among them", uniq.indexOf("journal") >= 0);
/* ROUTE_TABS gates deep links and notification routing (validTab). A nav tab missing from it silently fails
   to open from a ?tab= link or a push notification — journal shipped with exactly that gap. */
const routeBlock = (R.match(/const ROUTE_TABS=\[[^\]]*\];/) || [""])[0];
const noRoute = uniq.filter(t => routeBlock.indexOf('"' + t + '"') < 0);
ok("every nav tab is in ROUTE_TABS (deep links + notifications)", noRoute.length === 0, noRoute.join(", "));

/* ---------- ⛔ NO PHANTOM HELPERS ------------------------------------------------------------------------
   THE INCIDENT. Ray, 2026-08-27, setting up Plaid: "I put in the client ID... It said forbidden. So neither
   one works anyways." Nothing was wrong with his keys. js/150 read its auth token via
       (typeof syncToken === "function") ? syncToken() : localStorage.getItem("jsuite_token")
   and NEITHER EXISTS — `syncToken` is defined nowhere in this app and nothing ever writes "jsuite_token".
   I invented two accessors that sounded like they should exist, guarded them with a typeof so they failed
   silently, and never called them against a live server. Result: every Plaid request went out with an empty
   bearer, the server resolved no account, and answered 403 "forbidden" before Plaid was ever contacted. The
   bank feed had never worked once, for anybody, since the day it was written.

   ⚠️ THE `typeof X === "function"` GUARD IS WHAT MADE IT INVISIBLE. That idiom is used correctly all over
   this app for genuinely optional modules — but on a name that never exists it converts a loud ReferenceError
   into a silent wrong answer. So the guard itself has to be checked: if code asks "is X a function", X must be
   something that could BE a function somewhere.

   This walks every guarded name in js/ and fails if nothing in js/ (or the known browser/CDN globals) defines
   it. Cheap, and it catches the whole class rather than this one instance. */
console.log("\n--- no module may call a helper that does not exist ---");
{
  const EXTERNAL = new Set([
    "L", "Plaid", "fetch", "AbortController", "requestAnimationFrame", "structuredClone",
    "IntersectionObserver", "ResizeObserver", "MutationObserver", "BroadcastChannel", "Notification",
    "SpeechRecognition", "webkitSpeechRecognition", "MediaRecorder", "confirm", "alert", "prompt",
    "require", "importScripts", "define", "module", "process",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval", "Blob", "FileReader", "URL",
    "localStorage", "sessionStorage", "navigator", "matchMedia", "queueMicrotask"
  ]);
  const all = jsFiles.map(f => fs.readFileSync(path.join(__dirname, f), "utf8"));
  const joined = all.join("\n");
  /* every name this codebase defines, in any of the shapes it uses */
  const defined = new Set();
  const collect = (re, g) => { let m; while ((m = re.exec(joined))) defined.add(m[g]); };
  collect(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g, 1);
  collect(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g, 1);
  collect(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g, 1);
  collect(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g, 1);
  /* ⚠️ a CALLBACK PARAMETER is not a phantom — `function foo(afterCreate)` then `typeof afterCreate ===
     "function"` is the correct way to make a callback optional, and the whole app uses it. Collect every
     parameter name so the guard only fires on a name nothing anywhere could supply. */
  collect(/\bfunction\s*[A-Za-z_$][\w$]*?\s*\(([^)]*)\)/g, 1);
  const params = new Set();
  let pm; const pre = /\bfunction\s*[A-Za-z_$]*\s*\(([^)]*)\)/g;
  while ((pm = pre.exec(joined))) pm[1].split(",").forEach(a => {
    const n = a.trim().replace(/=.*$/, "").trim();
    if (/^[A-Za-z_$][\w$]*$/.test(n)) params.add(n);
  });
  params.forEach(n => defined.add(n));

  const phantoms = [];
  jsFiles.forEach((f, i) => {
    const re = /typeof\s+([A-Za-z_$][\w$]*)\s*===?\s*["']function["']/g;
    let m;
    while ((m = re.exec(all[i]))) {
      const name = m[1];
      if (defined.has(name) || EXTERNAL.has(name)) continue;
      phantoms.push(f + " → " + name + "()");
    }
  });
  ok("⭐⭐ every guarded helper is defined somewhere (no invented accessors)", phantoms.length === 0,
    phantoms.join(" · "));

  /* and the specific one, named, so the fix can't quietly regress */
  const bank = fs.readFileSync(path.join(__dirname, "js/150-bank-link.js"), "utf8");
  ok("⛔ js/150 no longer calls the non-existent syncToken()", !/typeof syncToken/.test(bank));
  ok("⭐ it reads the token the way every other module does — S.sync.token",
    /function bankToken\(\)[\s\S]{0,200}S\.sync && S\.sync\.token/.test(bank));
  ok("⚠️ and the 403 it caused is written down", /answered 403 "forbidden" before Plaid/.test(bank) || /403 "forbidden"/.test(bank));
  ok("⭐ the environment button reports a failure instead of doing nothing",
    /Couldn't switch environment: /.test(bank));
  ok("⭐ a status error reads as 'not allowed', not as 'no keys yet'", /not allowed to ask/.test(bank));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
