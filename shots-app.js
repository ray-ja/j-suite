/* shots-app.js — render a screen of "Business App (v1).html" in headless Chrome and SAVE A SCREENSHOT (PNG)
   at phone dimensions, so the app can be VISUALLY reviewed (cut-off cards, duplicate buttons, overlap, etc.)
   — the class of bug that only shows up on a real narrow mobile render.

   Usage: node shots-app.js <outName> "<setup JS>" [heightPx]
     <outName>  → shots/<outName>.png (sanitized)
     <setup JS> → runs on load AFTER the app boots (js/29-boot is the last script). Log in + navigate to the
                  screen to capture. A shared login+seed helper is prepended automatically (see SHOT_PRELUDE).
     heightPx   → viewport height (default 1600; taller captures more of a long page — the shell maps
                  device-width straight to CSS px so width stays 390 = phone).

   Prints "SHOT: <path> (<bytes>)" on success. The temp html is cleaned up. */
"use strict";
const fs = require("fs"), cp = require("child_process"), os = require("os"), path = require("path");
const outName = (process.argv[2] || "shot").replace(/[^a-zA-Z0-9_-]/g, "");
const setup = process.argv[3] || "";
const height = Math.max(600, Math.min(6000, parseInt(process.argv[4], 10) || 1600));

/* a reusable login+seed prelude so every shot starts signed-in as an owner on obx with sample data present,
   so screens have realistic content (jobs, customers, a clock-in card) rather than empty states. */
const SHOT_PRELUDE = `
  try{
    S.users = S.users || [];
    if(!S.users.find(u=>u&&u.id==="shotowner")) S.users.push({id:"shotowner",username:"Rj",name:"Ray Jamieson",role:"owner",superAdmin:true,active:true});
    if(typeof orgSetRole==="function"){ try{ orgSetRole("shotowner","obx","owner"); }catch(e){} }
    localStorage.setItem("jra_session","shotowner");
    localStorage.setItem("jra_offline_ok","1");
    if(typeof S!=="undefined") S.biz="obx";
    if(typeof seedSampleData==="function"){ try{ seedSampleData(); }catch(e){} }
    else if(typeof seedSample==="function"){ try{ seedSample(); }catch(e){} }
  }catch(e){}
`;

let h = fs.readFileSync("Business App (v1).html", "utf8");
// swallow non-app errors so a shot never aborts on a leaflet/tile 404
const boot = `<script>window.addEventListener("error",function(){},true);window.addEventListener("unhandledrejection",function(){});<\/script>`;
h = h.replace("</head>", boot + "\n</head>");
const setupScript = `<script>(async function(){ ${SHOT_PRELUDE} try{ ${setup} }catch(e){} try{ if(typeof render==="function") render(); }catch(e){} })();<\/script>`;
h = h.replace("</body>", setupScript + "\n</body>");
fs.writeFileSync("__shot_tmp.html", h);

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const home = os.homedir();
  // PREFER chrome-headless-shell (renders reliably on a headless server; full Chrome hangs in startup)
  try { const pw = path.join(home, ".cache/ms-playwright");
    for (const d of fs.readdirSync(pw)) if (/headless[_-]shell/i.test(d)) { const p = path.join(pw, d, "chrome-headless-shell-linux64", "chrome-headless-shell"); if (fs.existsSync(p)) return p; } } catch (e) {}
  return "chrome-headless-shell";   // on PATH
}
const chrome = findChrome();
fs.mkdirSync("shots", { recursive: true });
const outPath = "shots/" + outName + ".png";
try { fs.unlinkSync(outPath); } catch (e) {}
const prof = os.tmpdir() + "/jsuite-shot-" + process.pid;
const chromeClean = require("./test-chrome-cleanup"); chromeClean.sweepOrphans(); chromeClean.register(prof);  // teardown on every exit path + self-heal stragglers
try {
  cp.execSync(
    `"${chrome}" --headless --no-sandbox --disable-gpu --disable-dev-shm-usage --hide-scrollbars --force-device-scale-factor=1 --window-size=390,${height} --virtual-time-budget=4000 --no-first-run --no-default-browser-check --user-data-dir="${prof}" --screenshot="${outPath}" "file://${process.cwd()}/__shot_tmp.html"`,
    { stdio: ["ignore", "ignore", "ignore"], timeout: 60000, killSignal: "SIGKILL" });
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) console.log("SHOT: " + outPath + " (" + fs.statSync(outPath).size + " bytes, " + height + "px tall)");
  else console.log("FAIL: no screenshot produced (check the setup JS / chrome binary)");
} catch (e) { console.log("FAIL: " + (e.message || e)); }
try { fs.unlinkSync("__shot_tmp.html"); } catch (e) {}
try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
