/* shot-url.js — screenshot any URL or local HTML file, so a page is never shipped unseen.
   Usage: node shot-url.js <url-or-path> <out.png> [widthPx] [fullPage:0|1]
   Ray, 2026-08-13: "are you not looking at these? You need to be using the screenshot tool to look at these
   before you send them me. It's actually white on white text." He was right — a pricing page went out with
   white text on a white card because I read the HTML and never rendered it. */
"use strict";
const fs = require("fs"), cp = require("child_process"), os = require("os"), path = require("path");
const target = process.argv[2], out = process.argv[3] || "shot.png";
const width = parseInt(process.argv[4], 10) || 1280;
const full = process.argv[5] === "0" ? false : true;
if (!target) { console.error("usage: node shot-url.js <url-or-path> <out.png> [width] [fullPage]"); process.exit(2); }

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const home = os.homedir();
  for (const base of [path.join(home, ".cache/puppeteer/chrome"), path.join(home, ".cache/puppeteer/chrome-headless-shell")]) {
    try {
      for (const d of fs.readdirSync(base)) {
        for (const p of [path.join(base, d, "chrome-linux64", "chrome"), path.join(base, d, "chrome-headless-shell-linux64", "chrome-headless-shell")]) {
          if (fs.existsSync(p)) return p;
        }
      }
    } catch (e) {}
  }
  return "google-chrome";
}
const chrome = findChrome();
const url = /^https?:\/\//.test(target) ? target : "file://" + path.resolve(target);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "shot-"));
const args = ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
  "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  "--user-data-dir=" + prof, "--window-size=" + width + ",1200",
  "--virtual-time-budget=6000", "--screenshot=" + path.resolve(out)];
if (full) args.push("--full-page-screenshot");
args.push(url);
try {
  cp.execFileSync(chrome, args, { stdio: ["ignore", "ignore", "pipe"], timeout: 90000 });
  const sz = fs.statSync(out).size;
  console.log("OK " + out + " (" + Math.round(sz / 1024) + " KB) via " + path.basename(chrome));
} catch (e) {
  console.error("FAILED: " + (e.message || e).toString().slice(0, 300));
  process.exit(1);
} finally { try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} }
