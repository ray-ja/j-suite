/* ---------- DEEP QUOTE RATE EDITOR (every rate, modifier & minimum, with sources) ---------- */
function deepEditorHTML(){
  const ov=deepOverrides();
  const svcs=WZ_SVC[S.biz].filter(s=>DEEP[s[0]]);
  return svcs.map(s=>{const key=s[0];const cfg=getDeepCfg(key);const edited=!!ov[key];
    let h=`<details class="card"><summary style="font-weight:800;cursor:pointer">${esc(s[1])}${edited?` <span class="badge" style="background:var(--accent);color:var(--accent-ink)">edited</span>`:""}</summary><div style="margin-top:8px">`;
    h+=`<div class="sub" style="margin-bottom:8px;line-height:1.5">📚 <b>Source:</b> ${esc(DEEP_SRC[key]||"")}</div>`;
    h+=`<div class="row" style="align-items:center;gap:8px"><div class="grow"><b>Minimum charge</b></div><span class="sub">$</span><input type="number" style="width:90px" value="${cfg.min}" onchange="setDeepMin('${key}',this.value)"></div>`;
    cfg.groups.forEach(g=>{h+=`<div style="font-weight:700;margin-top:12px;border-top:1px solid var(--line);padding-top:8px">${esc(g[0])}</div>`;
      g[1].forEach(it=>{
        if(it.kind==="area"){h+=`<div class="sub" style="margin-top:6px">${esc(it.label)} — $/${esc(it.unit)} (sliding scale by size):</div><div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin-top:2px">`+it.tiers.map((t,ti)=>`<span class="sub">${t[0]>=1e9?"largest:":"≤"+t[0].toLocaleString()+":"}</span><input type="number" step="0.01" style="width:72px" value="${t[1]}" onchange="setDeepTier('${key}','${it.k}',${ti},this.value)">`).join("")+`</div>`;}
        else h+=`<div class="row" style="align-items:center;gap:8px;margin-top:6px"><div class="grow sub">${esc(it.label)}</div><span class="sub">$</span><input type="number" step="0.01" style="width:86px" value="${it.rate}" onchange="setDeepItemRate('${key}','${it.k}',this.value)"><span class="sub">/${esc(it.unit)}</span></div>`;
        if(it.mods)h+=it.mods.filter(m=>m[2]!==0||true).map(m=>`<div class="row" style="align-items:center;gap:8px;margin:2px 0 2px 16px"><div class="grow sub">↳ ${esc(m[1])}</div><input type="number" style="width:64px" value="${Math.round(m[2]*100)}" onchange="setDeepLmod('${key}','${it.k}','${m[0]}',this.value)"><span class="sub">%</span></div>`).join("");
      });
    });
    if(cfg.mods&&cfg.mods.length){h+=`<div style="font-weight:700;margin-top:12px;border-top:1px solid var(--line);padding-top:8px">Job conditions</div>`;
      cfg.mods.forEach(md=>{
        if(md.t==="chk"){const isFlat=md.flat!=null;h+=`<div class="row" style="align-items:center;gap:8px;margin-top:4px"><div class="grow sub">${esc(md.label)}</div><span class="sub">${isFlat?"$":""}</span><input type="number" style="width:74px" value="${isFlat?md.flat:Math.round(md.pct*100)}" onchange="setDeepJmodChk('${key}','${md.k}',this.value)"><span class="sub">${isFlat?"":"%"}</span></div>`;}
        else {h+=`<div class="sub" style="margin-top:6px">${esc(md.label)}:</div>`+md.opts.map(o=>{const e=o[2]||{};if(e.pct==null&&e.flat==null)return"";const isFlat=e.flat!=null;return `<div class="row" style="align-items:center;gap:8px;margin:2px 0 2px 16px"><div class="grow sub">↳ ${esc(o[1])}</div><span class="sub">${isFlat?"$":""}</span><input type="number" style="width:74px" value="${isFlat?e.flat:Math.round(e.pct*100)}" onchange="setDeepJmodSel('${key}','${md.k}','${o[0]}',this.value)"><span class="sub">${isFlat?"":"%"}</span></div>`;}).join("");}
      });
    }
    h+=`<button class="btn ghost sm" style="margin-top:12px" onclick="resetDeepKey('${key}')">↺ Reset this service to researched defaults</button>`;
    return h+`</div></details>`;
  }).join("");
}
window.openDeepEditor=function(){if(typeof settingsCanConfig==="function"&&!settingsCanConfig()){alert("Owner or admin only.");return;}modal("Deep quote rates",`<p class="muted" style="margin-bottom:8px">Every rate, modifier %, and minimum behind the deep estimators — edit any of them and the change flows straight into the Guided Quote. The 📚 line shows where each default came from. Percentages are whole numbers (25 = +25%, −15 = a 15% discount); flat adjustments are dollars.</p><div id="deepEditBody">`+deepEditorHTML()+`</div><button class="btn ghost" style="margin-top:10px" onclick="resetDeepAll()">↺ Reset ALL ${esc(BIZ[S.biz].name)} deep rates</button>`);};
function _ovset(key,fn){const o=deepOverrides();if(!o[key])o[key]={};fn(o[key]);setDeepOverrides(o);}
window.setDeepMin=function(key,v){_ovset(key,x=>x.min=parseFloat(v)||0);};
window.setDeepItemRate=function(key,ik,v){_ovset(key,x=>{x.items=x.items||{};x.items[ik]=x.items[ik]||{};x.items[ik].rate=parseFloat(v)||0;});};
window.setDeepTier=function(key,ik,ti,v){const it=getDeepCfg(key).groups.reduce((a,g)=>a.concat(g[1]),[]).find(z=>z.k===ik);const tiers=it.tiers.map(t=>[t[0],t[1]]);tiers[ti][1]=parseFloat(v)||0;_ovset(key,x=>{x.items=x.items||{};x.items[ik]=x.items[ik]||{};x.items[ik].tiers=tiers;});};
window.setDeepLmod=function(key,ik,mv,v){_ovset(key,x=>{x.lmods=x.lmods||{};x.lmods[ik]=x.lmods[ik]||{};x.lmods[ik][mv]=(parseFloat(v)||0)/100;});};
window.setDeepJmodChk=function(key,mk,v){_ovset(key,x=>{x.jmods=x.jmods||{};const md=DEEP[key].mods.find(m=>m.k===mk);x.jmods[mk]=(md.flat!=null)?(parseFloat(v)||0):((parseFloat(v)||0)/100);});};
window.setDeepJmodSel=function(key,mk,opt,v){_ovset(key,x=>{x.jmods=x.jmods||{};if(typeof x.jmods[mk]!=="object"||x.jmods[mk]==null)x.jmods[mk]={};const md=DEEP[key].mods.find(m=>m.k===mk);const o=md.opts.find(z=>z[0]===opt);const isFlat=o[2]&&o[2].flat!=null;x.jmods[mk][opt]=isFlat?(parseFloat(v)||0):((parseFloat(v)||0)/100);});};
window.resetDeepKey=function(key){const o=deepOverrides();delete o[key];setDeepOverrides(o);const b=document.getElementById("deepEditBody");if(b)b.innerHTML=deepEditorHTML();};
window.resetDeepAll=function(){if(!confirm("Reset ALL deep quote rates for this business to the researched defaults?"))return;setDeepOverrides({});const b=document.getElementById("deepEditBody");if(b)b.innerHTML=deepEditorHTML();};

window.openRatesEditor=function(){if(typeof settingsCanConfig==="function"&&!settingsCanConfig()){alert("Owner or admin only.");return;}modal("Pricing rates",`<p class="muted" style="margin-bottom:8px">Advanced — edit the numbers, keep the format. Tiers are [up-to-amount, price-per-unit]; multipliers like 1.25 add 25%.</p>
  <textarea id="rates_json" style="min-height:300px;font-family:monospace;font-size:12px">${esc(JSON.stringify(getRates(),null,2))}</textarea>
  <p id="rates_err" class="muted"></p>
  <div class="row" style="gap:8px;margin-top:10px"><button class="btn acc grow" onclick="saveRatesEditor()">Save</button><button class="btn ghost grow" onclick="resetRates()">Reset to defaults</button></div>`);};
window.saveRatesEditor=function(){try{const o=JSON.parse(document.getElementById("rates_json").value);setRates(o);closeModal();alert("Pricing rates saved.");}catch(e){const el=document.getElementById("rates_err");if(el)el.innerHTML='<span style="color:var(--danger)">Invalid format: '+esc(e.message)+'</span>';}};
window.openCostsEditor=function(){if(typeof settingsCanConfig==="function"&&!settingsCanConfig()){alert("Owner or admin only.");return;}modal("Job costs (COGS)",`<p class="muted" style="margin-bottom:8px">Advanced — edit the material/hardware cost defaults. Same shape as the built-in defaults; keep the format.</p>
  <textarea id="costs_json" style="min-height:300px;font-family:monospace;font-size:12px">${esc(JSON.stringify(getCosts(),null,2))}</textarea>
  <p id="costs_err" class="muted"></p>
  <div class="row" style="gap:8px;margin-top:10px"><button class="btn acc grow" onclick="saveCostsEditor()">Save</button><button class="btn ghost grow" onclick="resetCosts()">Reset to defaults</button></div>`);};
window.saveCostsEditor=function(){try{const o=JSON.parse(document.getElementById("costs_json").value);setCosts(o);closeModal();alert("Job costs saved.");}catch(e){const el=document.getElementById("costs_err");if(el)el.innerHTML='<span style="color:var(--danger)">Invalid format: '+esc(e.message)+'</span>';}};
window.resetCosts=function(){if(!confirm("Reset job costs to defaults?"))return;setCosts(JSON.parse(JSON.stringify(COST_DEFAULT)));closeModal();alert("Job costs reset to defaults.");};
window.resetRates=function(){if(!confirm("Reset pricing rates to defaults?"))return;setRates(JSON.parse(JSON.stringify(RATES_DEFAULT[S.biz])));closeModal();alert("Reset to defaults.");};
/* Owner/admin may configure the SENSITIVE Settings sections (sync URL/token, pricing rate & COGS editors, home
   base, archive, backups). A CREW member opening Settings ("data" tab) sees ONLY their own stuff — sync status,
   Update-now, dark mode, their cards, version — never the pricing/secret config. Hidden = unreachable; the
   mutating handlers below re-check too (defense-in-depth). */
function settingsCanConfig(){ return (typeof isOwner==="function"&&isOwner()) || (typeof curRoleKey==="function"&&curRoleKey()==="admin"); }
function rData(){
  const last=S.sync.last?new Date(S.sync.last).toLocaleString():"never";
  const cfg=settingsCanConfig();   // owner/admin: show the sensitive config sections; crew: hidden + unreachable
  view.innerHTML=`<h2>Sync</h2>
    <div class="card">
      <div class="nm" id="sy_state">${SYNC_LABEL[SYNC_STATE]||"✓ Synced"}</div>
      <div class="sub">Last synced: ${last}. <span id="sy_msg"></span></div>
      <p class="muted" style="margin-top:8px">Changes sync automatically — pushed a couple seconds after each edit, pulled when you open or focus the app. Nothing to press.</p>
      ${cfg?`<details style="margin-top:6px"><summary class="sub" style="cursor:pointer;font-weight:700">Advanced</summary>
        <label>Sync server URL</label><input id="sy_url" value="${esc(S.sync.url)}" placeholder="http://your-server:4000">
        <label>Access token (shared secret)</label><input id="sy_token" value="${esc(S.sync.token)}" placeholder="set this same on the server">
        <div class="toggle"><input type="checkbox" id="sy_auto" ${S.sync.auto?"checked":""}><label style="margin:0">Auto-sync</label></div>
        <div class="row" style="gap:8px;margin-top:12px"><button class="btn grow" onclick="saveSync()">Save settings</button><button class="btn ghost grow" onclick="syncNow()">Sync now</button></div>
      </details>`:""}
    </div>
    <div class="card" style="border-left:4px solid var(--accent)"><div class="row" style="align-items:center"><div class="grow"><strong>🔄 Get the latest version</strong><div class="sub" style="white-space:normal">If a fix or change isn't showing up, tap this — it force-reloads the newest build (clears the app cache; your data is safe).</div></div><button class="btn acc sm" style="flex:0 0 auto" onclick="forceUpdate()">Update now</button></div></div>
    <h2>Appearance</h2>
    <div class="card"><div class="toggle" style="margin-top:0"><input type="checkbox" id="th_dark" ${themePref()==="dark"?"checked":""} onchange="toggleTheme()"><label style="margin:0">Dark mode${curUser()?" · saved to "+esc(curUser().username):" · this device (sign in to sync)"}</label></div></div>
    ${curUser()?`<h2>💳 Cards</h2>
    <div class="card"><div class="row" style="align-items:center"><div class="grow"><strong>💳 Manage your cards on your profile</strong><div class="sub" style="white-space:normal">Your saved card last-4s now live on your <b>profile</b> in People &amp; Places — where an owner can also see whose card is whose. Only the last 4 are ever stored.</div></div><button class="btn acc sm" style="flex:0 0 auto" onclick="cardGotoMyProfile()">Open my profile</button></div></div>`:""}
    ${cfg?`<h2>Pricing rates</h2>
    <div class="card"><p class="muted" style="margin-bottom:8px">Edit every rate, modifier, and minimum behind the <b>deep line-item estimators</b> — with the source of each number shown so you know what you're changing. Flows straight into the Guided Quote.</p>
      <button class="btn acc" onclick="openDeepEditor()">⚙️ Edit deep quote rates</button>
      ${S.biz==="obx"?`<div style="border-top:1px solid var(--line);margin:10px 0"></div><p class="muted" style="margin-bottom:8px">Brush / shrub / small-tree removal — per-item price bands + rental cost defaults.</p><button class="btn ghost" onclick="openBrushEditor()">🌳 Edit brush / tree removal rates</button>` : ""}
      <div style="border-top:1px solid var(--line);margin:10px 0"></div>
      <p class="muted" style="margin-bottom:8px">Legacy quick-builder rates (raw JSON, the older simple calculators).</p>
      <button class="btn ghost" onclick="openRatesEditor()">Edit legacy rates (JSON)</button></div>
    <h2>Job costs (COGS)</h2>
    <div class="card"><p class="muted" style="margin-bottom:8px">Material/hardware cost defaults behind each service — these drive the live <b>Cost / Profit / Margin</b> strip on every quote.</p>
      <button class="btn ghost" onclick="openCostsEditor()">Edit job costs (JSON)</button></div>
    <h2>📍 Home base — ${typeof orgName==="function"?esc(orgName(S.biz)):esc(S.biz)}</h2>
    <div class="card"><p class="muted" style="margin-bottom:8px">Where this business's jobs start &amp; end — sets pickup + travel mileage. Each business keeps its <b>own</b> home base (switch organizations with the name dropdown in the header to set another one's).</p>
      <div class="row" style="align-items:center"><div class="grow"><strong>${(typeof homeBase==="function"&&homeBase())?(homeBase().lat!=null?"📍 "+esc(homeBase().resolved||homeBase().address):"⚠ "+esc(homeBase().address)+" — not located, tap Set to fix"):"Not set yet — pickup mileage needs this"}</strong></div><button class="btn acc sm" style="flex:0 0 auto" onclick="setHomeBase()">${(typeof homeBase==="function"&&homeBase()&&homeBase().address)?"Change":"Set"}</button></div></div>
    <h2>Archive</h2>
    <div class="card"><div class="row" style="align-items:center"><div class="grow"><strong>🗑 Deleted jobs &amp; quotes</strong><div class="sub">${(typeof archiveCount==="function"?archiveCount():0)} in the archive · restorable for 60 days, then auto-clears</div></div><button class="btn ghost sm" style="flex:0 0 auto" onclick="openArchive()">Open</button></div></div>
    <h2>Backups</h2>
    <div class="card">
      <div id="bk_status" class="sub" style="margin-bottom:12px">🗄️ Checking server backups…</div>
      <button class="btn acc" style="width:100%" onclick="backupNow()">💾 Back up now — save a full copy to this device</button>
      <div class="sub" id="bk_devlast" style="margin:7px 2px 0">${(function(){var t=+(localStorage.getItem("jra_lastbackup")||0);return t?"✓ Last copy to this device: "+new Date(t).toLocaleString():"⚠️ No copy saved to this device yet — tap above.";})()}</div>
      <button class="btn ghost" style="width:100%;margin-top:12px" onclick="backupServerNow(this)">☁️ Snapshot the server now</button>
      <div style="border-top:1px solid var(--line);margin:14px 0 10px"></div>
      <label style="margin:0">↩ Restore from a backup file</label>
      <input type="file" accept="application/json" id="impfile" onchange="importData(this)">
      <p class="muted" style="margin-top:8px;font-size:12px">The server auto-backs-up hourly. "Back up now" puts a full copy on this device — keep one off the server.</p>
    </div>`:""}
    ${(typeof isOwner==="function"&&isOwner())?`
    <h2>🔒 Security</h2>
    <div class="card">
      <p class="muted" style="margin-bottom:12px">Paste a secret and Save — it's written straight to the server file, never shown back and never sent anywhere else.</p>
      <label style="margin:0">Resend email key <span id="sec_resendKey" class="sub"></span></label>
      <input type="password" id="in_resendKey" placeholder="re_…" autocomplete="off" style="width:100%">
      <button class="btn ghost" style="width:100%;margin-top:6px" onclick="saveSecret('resendKey','in_resendKey')">Save Resend key</button>
    </div>`:""}
    <p class="muted" style="margin:14px 4px">App v2 · offline-first · syncs to your server</p>`;
  if(window.loadBackupStatus)setTimeout(loadBackupStatus,30);
  if(window.loadSecStatus)setTimeout(loadSecStatus,30);
}
window.saveSync=function(){if(typeof settingsCanConfig==="function"&&!settingsCanConfig()){alert("Owner or admin only.");return;}S.sync.url=val("sy_url");S.sync.token=val("sy_token");
  S.sync.auto=document.getElementById("sy_auto").checked;save();syMsg("Saved.");renderSyncPill();
  if(syncConfigured())syncRun("pull");};
function syMsg(t){const e=document.getElementById("sy_msg");if(e)e.textContent=t;}
/* ===== sync engine =====
   Auto-push every local change (debounced ~2.5s), pull on open/focus + periodically, with the
   server's per-record last-write-wins merge. Offline changes stay saved locally and retry with
   backoff. The status chip is always visible; "Sync now" is manual-only under Advanced. */
var SYNC_STATE="synced";          // 'synced' | 'syncing' | 'offline'
var SYNC_DIRTY=false;             // unsynced local edits exist
var _syncTimer=null,_retryTimer=null,_retryN=0,_syncInflight=false,_editSeq=0;
function syncConfigured(){return !!(S.sync&&S.sync.url&&S.sync.token&&S.sync.auto)&&!window.AUTH_401;}
/* "business data" only — seeded docs/inventory/todos don't count as real content */
function storeIsEmpty(){
  function n(b){const x=S[b]||{},c=k=>(x[k]||[]).filter(r=>!r.deleted).length;return c("customers")+c("quotes")+c("jobs")+c("properties")+c("places")+c("mktTracker");}
  return (n("obx")+n("jam"))===0;
}
function setSyncState(s){SYNC_STATE=s;renderSyncPill();const e=document.getElementById("sy_state");if(e)e.textContent=SYNC_LABEL[s]||"";
  /* notify any "is my record safe yet?" waiters (the upload-status ✓/⏳ banner). Never let a listener throw
     into the sync engine. */
  var ls=window.__syncListeners;if(ls&&ls.length){for(var i=ls.length-1;i>=0;i--){try{ls[i](s,SYNC_DIRTY);}catch(_e){}}}}
/* ── sync-completion hooks (UX only — read the EXISTING state, trigger the EXISTING push; no protocol change) ──
   onSyncState(fn) registers a listener called (state,dirty) on every state change; returns an unsubscribe fn.
   syncSnapshot() is a cheap read of the live state for a badge/guard.
   whenSynced() resolves "synced" ONCE the local edits have actually PUSHED to the server (the record reached the
   cloud), or "pending" if we're offline / it stalls — this is what lets an upload flow say "✓ safe to close" only
   when it's genuinely safe. It does NOT change how sync works; it just watches it and nudges the pending push to
   fire now instead of waiting out the ~2.5s debounce. file://-safe: no server → resolves "pending" immediately. */
window.__syncListeners=window.__syncListeners||[];
window.onSyncState=function(fn){if(typeof fn==="function")window.__syncListeners.push(fn);return function(){var i=window.__syncListeners.indexOf(fn);if(i>=0)window.__syncListeners.splice(i,1);};};
window.syncSnapshot=function(){return {state:SYNC_STATE,dirty:SYNC_DIRTY,configured:syncConfigured()};};
window.whenSynced=function(timeoutMs){
  timeoutMs=(typeof timeoutMs==="number"&&timeoutMs>0)?timeoutMs:20000;
  if(!syncConfigured())return Promise.resolve("pending");        // file:// / no server → saved on-device only
  if(SYNC_STATE==="synced"&&!SYNC_DIRTY)return Promise.resolve("synced");
  return new Promise(function(resolve){
    var done=false,to=null,off=null;
    function finish(v){if(done)return;done=true;if(to)clearTimeout(to);if(off)off();resolve(v);}
    off=window.onSyncState(function(st){
      if(st==="synced"&&!SYNC_DIRTY)finish("synced");
      else if(st==="offline")finish("pending");
    });
    to=setTimeout(function(){finish((SYNC_STATE==="synced"&&!SYNC_DIRTY)?"synced":"pending");},timeoutMs);
    /* fire the queued push right away rather than waiting the debounce */
    if(SYNC_DIRTY&&!_syncInflight){clearTimeout(_syncTimer);syncRun("auto");}
  });
};
const SYNC_LABEL={synced:"✓ Synced",syncing:"⟳ Syncing…",offline:"● Offline — changes saved, will sync"};
function renderSyncPill(){const b=document.getElementById("syncbtn");if(!b)return;
  if(!S.sync||!S.sync.url){b.style.display="none";return;}
  b.style.display="";b.onclick=function(){TAB="data";render();};
  const short={synced:"✓ Synced",syncing:"⟳ Syncing…",offline:"● Offline — saved"};
  const mod={synced:"ok",syncing:"busy",offline:"warn"}[SYNC_STATE]||"ok";
  b.textContent=short[SYNC_STATE]||short.synced;b.title=SYNC_LABEL[SYNC_STATE]||"";b.className="syncpill "+mod;}
function scheduleAutoPush(){
  if(!syncConfigured())return;
  SYNC_DIRTY=true;_editSeq++;setSyncState("syncing");   // optimistic: queued → will push
  clearTimeout(_syncTimer);_syncTimer=setTimeout(function(){syncRun("auto");},2500);
}
window.scheduleAutoPush=scheduleAutoPush;
function scheduleRetry(){clearTimeout(_retryTimer);const delay=Math.min(60000,3000*Math.pow(2,_retryN));_retryN++;
  _retryTimer=setTimeout(function(){syncRun(SYNC_DIRTY?"auto":"pull");},delay);}
async function syncRun(mode){
  mode=mode||"pull";
  if(!syncConfigured())return;
  // SAFETY (encode the lesson): an empty / not-yet-pulled local store must PULL first — never
  // auto-push an empty dataset over a non-empty server. Manual empty push requires confirmation.
  if(storeIsEmpty()){
    if(mode==="manual"&&!confirm("This device has no local business data yet.\n\nPull from the server (recommended)? An empty device must not overwrite server data."))return;
    mode="pull";
  }
  if(mode==="pull"&&S.sync.last&&(now()-S.sync.last<4000)&&!SYNC_DIRTY)return; // throttle redundant pulls
  if(_syncInflight)return;                                                      // coalesce; post-success reschedules if dirty
  const seq=_editSeq;_syncInflight=true;setSyncState("syncing");
  const _pushState={users:S.users,registry:S.registry||[]};(typeof clientOrgIds==="function"?clientOrgIds():["obx","jam"]).forEach(id=>{_pushState[id]=S[id];});   // push EVERY org slab (obx, jam, + any created org), not just obx/jam
  const sentSig=JSON.stringify(_pushState);
  try{
    const res=await fetch(S.sync.url.replace(/\/+$/,"")+"/sync",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({token:S.sync.token,userId:((typeof curUser==="function"&&curUser())?curUser().id:undefined),state:_pushState})});
    if(res.status===401){window.AUTH_401=true;S.sync.token="";save();_syncInflight=false;setSyncState("offline");syMsg("Not authorized — sign in again.");render();return;}
    if(!res.ok)throw new Error("HTTP "+res.status);
    const data=await res.json();
    if(!data||!data.state||typeof data.state!=="object")throw new Error("bad response");
    window.AUTH_401=false;_retryN=0;
    window.SHARED_TOKEN_MODE=!!data.shared;   // legacy shared-token device → non-locking "sign in again to add members" nudge (never logs out / clears the token)
    if(typeof renderSharedTokenNudge==="function")renderSharedTokenNudge();
    const changed=JSON.stringify(data.state)!==sentSig;
    window.__syncApplying=true;
    Object.keys(data.state).forEach(function(k){var v=data.state[k];if(k!=="users"&&k!=="registry"&&v&&typeof v==="object"&&!Array.isArray(v))S[k]=v;});if(data.state.users)S.users=data.state.users;if(data.state.registry)S.registry=data.state.registry;   // apply every org slab the server returned
    var _keep=new Set((S.registry||[]).map(function(r){return r&&r.id;}));Object.keys(S).forEach(function(k){if(k!=="users"&&k!=="registry"&&k!=="sync"&&k!=="biz"&&S[k]&&typeof S[k]==="object"&&!Array.isArray(S[k])&&!_keep.has(k))delete S[k];});   // ISOLATION: drop org slabs we're not a member of (server preserves them → loss-free)
    if(!S[S.biz]&&(S.registry||[]).length)S.biz=S.registry[0].id;   // the active org must be one we actually have
    S.sync.last=now();save();
    window.__syncApplying=false;
    if(typeof checkForcedLogout==="function"&&checkForcedLogout()){_syncInflight=false;return;}   // an owner signed this account out everywhere

    _syncInflight=false;syMsg("Synced ✓");
    if(_editSeq!==seq){scheduleAutoPush();}            // edits arrived mid-flight → push again
    else{SYNC_DIRTY=false;setSyncState("synced");}
    // RECURRING SERVICE (Phase 1): after a fresh pull/merge, roll due recurring plans into jobs. Guarded once/day
    // (S.recurLastRun) + never-throws inside; NO-OP while recurringPlans is empty (Phase 1 has no create UI yet),
    // so this is zero app-visible effect until a plan exists. If it did generate, re-render to show new jobs.
    var _recurCh=false; if(typeof recurMaterialize==="function"){try{_recurCh=recurMaterialize();}catch(e){}}
    // RESUMABLE CAP RECEIPT QUEUE: after a fresh pull/merge (this includes the boot pull → covers "app open"),
    // sweep any UNREAD needs-review receipts one at a time — a batch interrupted by an app-close, or receipts
    // that arrived via sync from another device / the server, get read without a re-upload. Owner/admin + key
    // gated, debounced, never-throws, no-op at 0 unread (js/88 capRcptSweep). Fire-and-forget.
    if(typeof capRcptSweep==="function"){try{capRcptSweep();}catch(e){}}
    if(changed||_recurCh)safeRender();
  }catch(e){_syncInflight=false;setSyncState("offline");syMsg("Offline — changes saved, will sync.");scheduleRetry();}
}
window.syncRun=syncRun;
/* re-render without blowing away an open modal or the wizard mid-edit */
function safeRender(){if(typeof WZON!=="undefined"&&WZON)return;const ov=document.getElementById("overlay");if(ov&&ov.classList.contains("show"))return;render();}
/* manual sync — Advanced only */
window.syncNow=function(){if(!S.sync||!S.sync.url){if(TAB==="data")syMsg("Set a server URL first.");else{TAB="data";render();}return;}syncRun("manual");};
window.exportData=function(){
  const blob=new Blob([JSON.stringify(S,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);
  a.download="business-app-backup-"+today()+".json";a.click();
  try{localStorage.setItem("jra_lastbackup",String(Date.now()));}catch(e){}
};
window.backupNow=function(){ exportData(); const el=document.getElementById("bk_devlast"); if(el)el.textContent="✓ Last copy to this device: "+new Date().toLocaleString(); };
window.fmtBytes=function(n){ n=+n||0; if(n<1024)return n+" B"; if(n<1048576)return Math.round(n/1024)+" KB"; return (n/1048576).toFixed(1)+" MB"; };
window.loadBackupStatus=function(){
  const el=document.getElementById("bk_status"); if(!el)return;
  const base=(S.sync&&S.sync.url)||"", tok=(S.sync&&S.sync.token)||"";
  fetch(base+"/api/backup-status",{headers:tok?{Authorization:"Bearer "+tok}:{}})
    .then(r=>r.ok?r.json():Promise.reject(r.status))
    .then(d=>{ const last=d.last?new Date(d.last).toLocaleString():"never"; el.innerHTML="🗄️ Server auto-backup: hourly · <b>"+(d.count||0)+"</b> snapshots ("+fmtBytes(d.bytes)+") · last "+last; })
    .catch(()=>{ el.innerHTML="🗄️ Server auto-backs-up hourly (live status unavailable right now)."; });
};
window.backupServerNow=function(btn){
  const base=(S.sync&&S.sync.url)||"", tok=(S.sync&&S.sync.token)||"";
  if(btn){btn.disabled=true;btn.textContent="☁️ Snapshotting…";}
  fetch(base+"/api/backup",{method:"POST",headers:tok?{Authorization:"Bearer "+tok}:{}})
    .then(r=>r.json())
    .then(d=>{ if(btn){btn.disabled=false;btn.textContent="☁️ Snapshot the server now";} if(d&&d.ok){loadBackupStatus();alert("Server snapshot saved — "+d.count+" total.");}else{alert("Snapshot failed: "+((d&&d.error)||"unknown"));} })
    .catch(()=>{ if(btn){btn.disabled=false;btn.textContent="☁️ Snapshot the server now";} alert("Snapshot failed — are you online?"); });
};
window.loadSecStatus=function(){
  const base=(S.sync&&S.sync.url)||"", tok=(S.sync&&S.sync.token)||"";
  fetch(base+"/api/config/status",{headers:tok?{Authorization:"Bearer "+tok}:{}})
    .then(r=>r.ok?r.json():Promise.reject())
    .then(d=>{ const mark=(id,set)=>{const e=document.getElementById(id); if(e)e.innerHTML=set?"— <b style='color:#1a9a5a'>set ✓</b>":"— <span style='color:#c0392b'>not set</span>";}; mark("sec_resendKey",d.resendKey); mark("sec_accessAud",d.accessAud); })
    .catch(()=>{});
};
window.saveSecret=function(key,inputId){
  const el=document.getElementById(inputId); if(!el)return; const v=(el.value||"").trim();
  if(!v){alert("Paste a value first.");return;}
  const base=(S.sync&&S.sync.url)||"", tok=(S.sync&&S.sync.token)||"";
  fetch(base+"/api/config/secret",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},tok?{Authorization:"Bearer "+tok}:{}),body:JSON.stringify({key:key,value:v})})
    .then(r=>r.json())
    .then(d=>{ if(d&&d.ok){ el.value=""; loadSecStatus(); alert("Saved ✓ — written to the server. It never passed through anyone else."); } else { alert("Save failed: "+((d&&d.error)||"unknown")); } })
    .catch(()=>alert("Save failed — are you online?"));
};
window.importData=function(inp){
  if(typeof settingsCanConfig==="function"&&!settingsCanConfig()){alert("Owner or admin only.");return;}
  const file=inp.files[0];if(!file)return;const r=new FileReader();
  r.onload=()=>{try{const o=JSON.parse(r.result);if(!o.obx||!o.jam)throw 0;
    if(!confirm("Replace all current data with this backup?"))return;
    o.sync=o.sync||S.sync;S=o;S.biz=S.biz||"obx";save();setBiz(S.biz);alert("Imported.");}
    catch(e){alert("That doesn't look like a valid backup file.")}};
  r.readAsText(file);
};

