/* Headless load + smoke-test harness for "Business App (v1).html".
   Builds an instrumented copy, loads it in headless Chrome, runs an optional
   smoke snippet, and prints captured console/runtime errors as data-errs.
   Usage: node verify-app.js "<smoke JS>"   (smoke JS runs after boot; push to __errs on failure)
   Mirrors the demolition-module verification approach. Temp file is cleaned up by the caller. */
const fs=require("fs"),cp=require("child_process"),os=require("os"),path=require("path");
const smoke=process.argv[2]||"";
let h=fs.readFileSync("Business App (v1).html","utf8");
const collector=`<script>window.__errs=[];window.addEventListener("error",function(e){var src=e.filename||"";if(/unpkg|leaflet|nominatim|openstreetmap|tile/i.test(src))return;if(/31-inventory/i.test(src))return;/* other instance's in-progress file */ if(!e.message&&!e.error)return;/* resource-load (404) events carry no message */ __errs.push((src||"inline")+": "+(e.message||(e.error&&e.error.stack)||""));},true);window.addEventListener("unhandledrejection",function(e){__errs.push("promise: "+(e.reason&&(e.reason.stack||e.reason.message)||e.reason));});var _ce=console.error;console.error=function(){__errs.push("console.error: "+Array.prototype.slice.call(arguments).join(" "));_ce.apply(console,arguments);};<\/script>`;
h=h.replace("</head>",collector+"\n</head>");
const smokeScript=`<script>(async function(){try{${smoke}}catch(e){__errs.push("smoke: "+(e&&e.stack||e));}document.documentElement.setAttribute("data-errs",JSON.stringify(window.__errs));})();<\/script>`;
h=h.replace("</body>",smokeScript+"\n</body>");
fs.writeFileSync("__verify_tmp.html",h);
// Pick a Chrome binary: explicit $CHROME override; else (non-Windows) a cached chrome-headless-shell —
// the full Chrome hangs in startup on a headless server, the shell binary renders fine; else the Windows default.
function findChromeLinux(){
  const home=os.homedir();
  try{ const pw=path.join(home,".cache/ms-playwright");
    for(const d of fs.readdirSync(pw)) if(/headless[_-]shell/i.test(d)){
      const p=path.join(pw,d,"chrome-headless-shell-linux64","chrome-headless-shell"); if(fs.existsSync(p))return p; } }catch(e){}
  try{ const pc=path.join(home,".cache/puppeteer/chrome");
    for(const d of fs.readdirSync(pc)){ const p=path.join(pc,d,"chrome-linux64","chrome"); if(fs.existsSync(p))return p; } }catch(e){}
  return null;
}
const chrome=process.env.CHROME || (process.platform!=="win32" && findChromeLinux()) || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const isShell=/headless[_-]shell/i.test(chrome);   // headless-shell is inherently headless + needs server-safe flags
try{
  const prof=require("os").tmpdir()+"/jsuite-verify-"+process.pid;  // isolated profile → no default-profile lock contention
  const renderFlags=isShell?"--no-sandbox --disable-gpu --disable-dev-shm-usage":"--headless --disable-gpu";
  const out=cp.execSync(`"${chrome}" ${renderFlags} --no-first-run --no-default-browser-check --user-data-dir="${prof}" --dump-dom --virtual-time-budget=2500 "file:///${process.cwd().replace(/\\/g,"/")}/__verify_tmp.html"`,{encoding:"utf8",stdio:["ignore","pipe","ignore"],timeout:60000});
  const m=out.match(/data-errs="([^"]*)"/);
  const errs=m?JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")):null;
  if(errs===null){console.log("FAIL: data-errs not found (page did not finish booting)");process.exit(1);}
  if(errs.length){console.log("FAIL: "+errs.length+" error(s):");errs.forEach(e=>console.log("  - "+e));process.exit(1);}
  console.log("PASS: zero console/runtime errors"+(smoke?" + smoke ok":""));
}catch(e){console.log("FAIL: chrome run errored: "+e.message);process.exit(1);}
finally{try{fs.unlinkSync("__verify_tmp.html");}catch(e){}}
