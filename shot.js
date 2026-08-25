#!/usr/bin/env node
"use strict";
/*
 * shot.js — render a piece of the app with the REAL stylesheet and take a picture of it.
 *
 * Ray, 2026-08-25, with a screenshot of a card whose text was running one character per line down the
 * page: "Make sure you use the screenshot tool to check your work because this is how it looks right now.
 * It's a mess."
 *
 * He was right, and I had no way to look. Chrome and Firefox both hang on this box (a known, recorded
 * intermittent fault), so every visual check so far has been me reading markup and hoping. ⭐ The thing
 * that actually works here is `chrome-headless-shell` out of the Playwright cache — not `chrome`, which
 * still hangs. That distinction is the whole reason this file exists.
 *
 * Loading the real app needs a login, and a component bug doesn't. So this renders a FRAGMENT against the
 * live app.css, at a phone width by default, which is where his layout actually has to work.
 *
 *   node shot.js --html '<div class="card">…</div>' [--out shot.png] [--w 390] [--dark]
 *   node shot.js --file card.html
 *
 * Exits non-zero if the shot fails, so it can gate a commit.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

/* ⭐ chrome-headless-shell, NOT chrome. The full chrome binary hangs indefinitely on --screenshot here;
   the headless shell returns in a couple of seconds. Verified 2026-08-25. */
function findShell() {
  const root = path.join(process.env.HOME || "/home/rzy", ".cache", "ms-playwright");
  let best = "";
  try {
    fs.readdirSync(root).filter(d => /^chromium_headless_shell/.test(d)).sort().forEach(d => {
      const p = path.join(root, d, "chrome-headless-shell-linux64", "chrome-headless-shell");
      if (fs.existsSync(p)) best = p;
    });
  } catch (e) {}
  return best;
}

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return (v && v.indexOf("--") !== 0) ? v : true;
}

const width = parseInt(arg("w", "390"), 10) || 390;      // iPhone-ish; his actual device
const height = parseInt(arg("h", "1400"), 10) || 1400;
const dark = process.argv.indexOf("--dark") >= 0;
const out = path.resolve(String(arg("out", "shot.png")));

let body = arg("html", "");
const file = arg("file", "");
if (file && file !== true) body = fs.readFileSync(String(file), "utf8");
if (!body || body === true) { console.error("usage: shot.js --html '<div…>' | --file page.html [--out f.png] [--w 390] [--dark]"); process.exit(2); }

const css = fs.readFileSync(path.join(__dirname, "app.css"), "utf8");
const page = '<!doctype html><html' + (dark ? ' data-theme="dark"' : '') + '><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<style>' + css + '</style>'
  /* the app renders inside .wrap; without it every card is full-bleed and the shot lies about widths */
  + '</head><body' + (dark ? ' class="dark"' : '') + '><div class="wrap">' + body + '</div></body></html>';

const tmp = path.join(require("os").tmpdir(), "shot-" + Date.now() + ".html");
fs.writeFileSync(tmp, page);

const shell = findShell();
if (!shell) { console.error("no chrome-headless-shell found under ~/.cache/ms-playwright"); process.exit(3); }

try {
  execFileSync(shell, [
    "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars",
    "--virtual-time-budget=4000",
    "--window-size=" + width + "," + height,
    "--screenshot=" + out,
    "file://" + tmp
  ], { stdio: "ignore", timeout: 45000 });
} catch (e) {
  console.error("screenshot failed: " + (e.message || e));
  process.exit(4);
}
try { fs.unlinkSync(tmp); } catch (e) {}

if (!fs.existsSync(out)) { console.error("no image produced"); process.exit(5); }
console.log(out + "  (" + fs.statSync(out).size + " bytes, " + width + "×" + height + (dark ? ", dark" : "") + ")");
