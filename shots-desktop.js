/* shots-desktop.js — like shots-app.js but at a DESKTOP viewport width, to review the ≥900px layout
   (sidebar nav, centering, wide cards). Usage: node shots-desktop.js <outName> "<setup JS>" [widthPx] [heightPx] */
"use strict";
const fs = require("fs"), cp = require("child_process"), os = require("os"), path = require("path");
const outName = (process.argv[2] || "shot").replace(/[^a-zA-Z0-9_-]/g, "");
const setup = process.argv[3] || "";
const width = Math.max(320, Math.min(2560, parseInt(process.argv[4], 10) || 1440));
const height = Math.max(600, Math.min(6000, parseInt(process.argv[5], 10) || 1000));

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
const boot = `<script>window.addEventListener("error",function(){},true);window.addEventListener("unhandledrejection",function(){});<\/script>`;
h = h.replace("</head>", boot + "\n</head>");
const setupScript = `<script>(async function(){ ${SHOT_PRELUDE} try{ ${setup} }catch(e){} try{ if(typeof render==="function") render(); }catch(e){} })();<\/script>`;
h = h.replace("</body>", setupScript + "\n</body>");
fs.writeFileSync("__shot_tmp_d.html", h);

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const home = os.homedir();
  try { const pw = path.join(home, ".cache/ms-playwright");
    for (const d of fs.readdirSync(pw)) if (/headless[_-]shell/i.test(d)) { const p = path.join(pw, d, "chrome-headless-shell-linux64", "chrome-headless-shell"); if (fs.existsSync(p)) return p; } } catch (e) {}
  return "chrome-headless-shell";
}
const chrome = findChrome();
fs.mkdirSync("shots", { recursive: true });
const outPath = "shots/" + outName + ".png";
try { fs.unlinkSync(outPath); } catch (e) {}
const prof = os.tmpdir() + "/jsuite-shotd-" + process.pid;
try {
  cp.execSync(
    `"${chrome}" --headless --no-sandbox --disable-gpu --disable-dev-shm-usage --hide-scrollbars --force-device-scale-factor=1 --window-size=${width},${height} --virtual-time-budget=4000 --no-first-run --no-default-browser-check --user-data-dir="${prof}" --screenshot="${outPath}" "file://${process.cwd()}/__shot_tmp_d.html"`,
    { stdio: ["ignore", "ignore", "ignore"], timeout: 60000 });
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) console.log("SHOT: " + outPath + " (" + fs.statSync(outPath).size + " bytes, " + width + "x" + height + ")");
  else console.log("FAIL: no screenshot produced");
} catch (e) { console.log("FAIL: " + (e.message || e)); }
try { fs.unlinkSync("__shot_tmp_d.html"); } catch (e) {}
try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
