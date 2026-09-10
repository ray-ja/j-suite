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
  view.innerHTML=`<div class="card" style="border-left:4px solid var(--danger)"><div class="row" style="align-items:center"><div class="grow"><div class="nm" style="font-size:15px">🐞 Error log</div><div class="sub" style="white-space:normal">Recent app errors on this device (also sent to the server). Reproduce a glitch, then open this.</div></div><button class="btn ghost sm" onclick="showErrorLog()">Open</button></div></div>
    <h2>Sync</h2>
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
    ${(typeof orgpCardHTML==="function")?orgpCardHTML():""}
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
    ${(typeof isOwner==="function"&&isOwner())?(function(){
      /* ── 🔑 KEYS & CONNECTIONS (Ray 2026-09-10: "really poorly organized… tiny text… it should have a
         tiny description… what exactly this key is, how to make it, very very shortly").
         One row per key: bold name + status, a one-line WHAT, a one-line GET IT, then the input. Grouped
         into collapsible sections — per-ORG groups say whose keys they are; platform groups say "all orgs". */
      const ORG=esc((BIZ[S.biz]||{}).name||S.biz);
      const row=(title,statusId,what,get,body)=>`
        <div style="padding:12px 0;border-top:1px solid var(--line)">
          <div style="font-size:15.5px;font-weight:800;color:var(--ink)">${title}${statusId?` <span id="${statusId}" class="sub" style="font-size:12.5px"></span>`:""}</div>
          <div style="font-size:13.5px;color:var(--muted);white-space:normal;line-height:1.5;margin:3px 0 1px">${what}</div>
          <div style="font-size:13.5px;color:var(--muted);white-space:normal;line-height:1.5;margin:0 0 7px"><b style="color:var(--ink)">Get it:</b> ${get}</div>
          ${body}</div>`;
      const grp=(title,inner,open)=>`<details class="card" ${open?"open":""} style="padding:14px 16px"><summary style="font-size:16px;font-weight:800;cursor:pointer">${title}</summary>${inner}</details>`;
      return `
    <h2>🔑 Keys &amp; connections</h2>
    <p class="muted" style="margin:0 4px 10px;font-size:13.5px">Secrets are written straight to the server and never shown back. Sections marked <b>${ORG}</b> hold ONLY this org's keys — switch org tabs for another org's.</p>
    ${grp(`🌐 Websites — ${ORG}`,
      row(`Sites / deploy token`,`ok_cfSites`,
        `Deploys ${ORG}'s websites.`,
        `Cloudflare (the account hosting the sites) → My Profile → API Tokens → Create → permission <b>Pages: Edit</b>. Copy the value shown once.`,
        `<input type="password" id="in_cfSites" placeholder="40-character API token" autocomplete="off" style="width:100%">
         <button class="btn ghost" style="width:100%;margin-top:6px" onclick="saveOrgKey('cfSites','in_cfSites')">Save &amp; verify</button>`)
      +row(`DNS token`,`ok_cfDns`,
        `Edits ${ORG}'s domain records (pointing a domain at a site).`,
        `Cloudflare (the account holding the DOMAINS — can be a different one) → API Tokens → Create → permission <b>Zone · DNS · Edit</b>.`,
        `<input type="password" id="in_cfDns" placeholder="40-character API token" autocomplete="off" style="width:100%">
         <button class="btn ghost" style="width:100%;margin-top:6px" onclick="saveOrgKey('cfDns','in_cfDns')">Save &amp; verify</button>`),true)}
    ${grp(`📣 Google Ads — ${ORG} <span id="gads_status" class="sub" style="font-size:12.5px"></span>`,
      row(`1 · OAuth client (JSON file)`,``,
        `Lets the app talk to ${ORG}'s ads account.`,
        `console.cloud.google.com → APIs &amp; Services → Credentials → Create → OAuth client ID → <b>Desktop app</b> → Download JSON.`,
        `<input type="file" id="in_gadsFile" accept=".json,application/json" style="width:100%" onchange="gadsReadFile(this)">
         <textarea id="in_gadsJson" placeholder="…or paste the JSON here" style="width:100%;height:50px;font-size:12px" autocomplete="off"></textarea>`)
      +row(`2 · Customer ID &amp; developer token`,``,
        `Which ads account to read, and Google's API pass.`,
        `Customer ID: the 10-digit number top-right in Google Ads. Dev token: the Ads <b>manager</b> account → API Center.`,
        `<div class="row" style="gap:8px"><input id="in_gadsCust" placeholder="Customer ID 123-456-7890" autocomplete="off" style="flex:1">
         <input type="password" id="in_gadsDev" placeholder="Developer token" autocomplete="off" style="flex:1"></div>
         <button class="btn ghost" style="width:100%;margin-top:6px" onclick="gadsSaveCfg()">Save keys</button>`)
      +row(`3 · Connect &amp; authorize`,``,
        `The one-time Google sign-in that grants access.`,
        `Tap Connect, approve as this org's Google account. You'll land on a <b>broken page — that's expected</b>; copy that page's address here.`,
        `<button class="btn ghost" style="width:100%" onclick="gadsConnect()">Connect Google (opens sign-in)</button>
         <input id="in_gadsCode" placeholder="Paste the broken page's address (?code=…)" autocomplete="off" style="width:100%;margin-top:6px">
         <button class="btn ghost" style="width:100%;margin-top:6px" onclick="gadsExchange()">Finish connection</button>`)
      +row(`Nightly monitor key`,``,
        `Lets the read-only Ads Script push nightly stats here — works even before step 3.`,
        `Mint it here (shown once), paste into the script's INGEST_KEY line (Google Ads → Tools → Bulk actions → Scripts).`,
        `<button class="btn ghost" style="width:100%" onclick="gadsScriptKey()">Mint script key</button>`))}
    ${grp(`⭐ Reviews — ${ORG}`,
      row(`Review link`,``,
        `The page a customer lands on to leave a review; powers the ⭐ button on finished jobs.`,
        `Google LSA → lead inbox → Ask for reviews → copy link (or the Business Profile review short-link).`,
        `<input id="in_reviewLink" placeholder="https://…" autocomplete="off" style="width:100%" value="${esc(((S.registry||[]).find(r=>r&&r.id===S.biz)||{}).reviewLink||"")}">
         <button class="btn ghost" style="width:100%;margin-top:6px" onclick="saveReviewLink()">Save review link</button>`))}
    ${grp(`💳 Payments — all orgs`,
      row(`Stripe key`,`sec_stripeKey`,
        `Makes the card-payment links on invoices.`,
        `Stripe → Developers → API keys → <b>Create restricted key</b> → Prices, Products &amp; Payment Links set to Write (<code>rk_live_…</code>).`,
        `<input type="password" id="in_stripeKey" placeholder="rk_live_…" autocomplete="off" style="width:100%">
         <button class="btn ghost" style="width:100%;margin-top:6px" onclick="saveSecret('stripeKey','in_stripeKey')">Save</button>`)
      +row(`Stripe webhook secret`,`sec_stripeWebhookSecret`,
        `Flips an invoice to PAID the moment the customer pays.`,
        `Stripe → Developers → Webhooks → endpoint <code>/api/stripe/webhook</code>, event <b>checkout.session.completed</b> → signing secret (<code>whsec_…</code>).`,
        `<input type="password" id="in_stripeWebhookSecret" placeholder="whsec_…" autocomplete="off" style="width:100%">
         <button class="btn ghost" style="width:100%;margin-top:6px" onclick="saveSecret('stripeWebhookSecret','in_stripeWebhookSecret')">Save</button>`))}
    ${grp(`📧 Email — all orgs`,
      row(`Resend key`,`sec_resendKey`,
        `Lets the app send email (account invites, password resets).`,
        `resend.com → API Keys → Create (<code>re_…</code>).`,
        `<input type="password" id="in_resendKey" placeholder="re_…" autocomplete="off" style="width:100%">
         <button class="btn ghost" style="width:100%;margin-top:6px" onclick="saveSecret('resendKey','in_resendKey')">Save</button>`))}`;
    })():""}
    <p class="muted" style="margin:14px 4px">App v2 · offline-first · syncs to your server</p>`;
  if(window.loadBackupStatus)setTimeout(loadBackupStatus,30);
  if(window.orgpRefresh&&typeof orgpCan==="function"&&orgpCan())setTimeout(orgpRefresh,40);
  if(window.loadSecStatus)setTimeout(loadSecStatus,30);
  if(window.gadsRefreshStatus&&typeof settingsCanConfig==="function"&&settingsCanConfig())setTimeout(gadsRefreshStatus,40);
  if(window.orgKeysRefresh&&typeof settingsCanConfig==="function"&&settingsCanConfig())setTimeout(orgKeysRefresh,50);
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
  // WATCHDOG: a hung request (Cloudflare holding the connection, a stalled mobile/Firefox network) would otherwise
  // leave _syncInflight=true and the badge stuck on "⟳ Syncing…" FOREVER — no error, no recovery. Abort after 20s so
  // it falls into the catch → "offline" + exponential retry, exactly like any other network failure. (The version
  // checker in js/83 already does this; the sync fetch was the one request with no timeout.)
  var _syncAC=null,_syncTO=null;
  try{if(typeof AbortController!=="undefined"){_syncAC=new AbortController();_syncTO=setTimeout(function(){try{_syncAC.abort();}catch(e){}},20000);}}catch(e){}
  try{
    const res=await fetch(S.sync.url.replace(/\/+$/,"")+"/sync",{method:"POST",headers:{"Content-Type":"application/json"},signal:_syncAC?_syncAC.signal:undefined,
      body:JSON.stringify({token:S.sync.token,userId:((typeof curUser==="function"&&curUser())?curUser().id:undefined),state:_pushState})});
    if(_syncTO){clearTimeout(_syncTO);_syncTO=null;}
    if(res.status===401){window.AUTH_401=true;S.sync.token="";save();_syncInflight=false;setSyncState("offline");syMsg("Not authorized — sign in again.");render();return;}
    if(!res.ok)throw new Error("HTTP "+res.status);
    const data=await res.json();
    if(!data||!data.state||typeof data.state!=="object")throw new Error("bad response");
    window.AUTH_401=false;_retryN=0;
    window.SHARED_TOKEN_MODE=!!data.shared;   // legacy shared-token device → non-locking "sign in again to add members" nudge (never logs out / clears the token)
    if(typeof renderSharedTokenNudge==="function")renderSharedTokenNudge();
    const changed=JSON.stringify(data.state)!==sentSig;
    // IN-FLIGHT EDIT GUARD (fixes "odometer not saving"): this server response was computed from _pushState, the
    // snapshot taken BEFORE the request. If the user saved an edit AFTER that snapshot (_editSeq advanced), applying
    // the response would WHOLESALE-CLOBBER that edit (S[org]=response[org] overwrites the just-saved record). So do
    // NOT apply a stale response over a fresh local edit — keep local, re-push immediately. The next round returns a
    // merged response that INCLUDES the edit (server LWW resolves it); remote changes arrive one round later, never
    // lost. (Local edits already carry a newer updatedAt via touch(), so the server keeps them.)
    if(_editSeq!==seq){ _syncInflight=false; SYNC_DIRTY=true; setSyncState("synced"); scheduleAutoPush(); return; }
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
  }catch(e){if(_syncTO){clearTimeout(_syncTO);_syncTO=null;}_syncInflight=false;setSyncState("offline");syMsg("Offline — changes saved, will sync.");scheduleRetry();}
}
window.syncRun=syncRun;
/* re-render without blowing away an open modal or the wizard mid-edit */
/* THE "kicked out of a text field" FIX: the 60s sync pull (js/29) calls safeRender() whenever server data changed
   — and while clocked in (GPS ping every 2min) or editing (lock heartbeat every 30s) that's almost every pull, all
   day. It guarded the wizard + modals but NOT a focused input, so it rebuilt the DOM under the cursor and wiped
   what you were typing (admin PIN, address, key entry...). Now: if ANY text field is focused, defer — never
   re-render mid-type — and flush the moment focus leaves. */
var _renderPending=false;
function _editingField(){try{var ae=document.activeElement;return !!(ae&&(ae.tagName==="INPUT"||ae.tagName==="TEXTAREA"||ae.tagName==="SELECT"||ae.isContentEditable));}catch(e){return false;}}
function safeRender(){
  if(typeof WZON!=="undefined"&&WZON)return;
  const ov=document.getElementById("overlay");if(ov&&ov.classList.contains("show"))return;
  if(_editingField()){_renderPending=true;return;}
  _renderPending=false;render();
}
try{ if(typeof window!=="undefined"&&window.addEventListener){ window.addEventListener("focusout",function(){ if(_renderPending) setTimeout(function(){ if(_renderPending&&!_editingField()) safeRender(); },150); },true); } }catch(e){}
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
    .then(d=>{ const mark=(id,set)=>{const e=document.getElementById(id); if(e)e.innerHTML=set?"— <b style='color:#1a9a5a'>set ✓</b>":"— <span style='color:#c0392b'>not set</span>";}; mark("sec_resendKey",d.resendKey); mark("sec_accessAud",d.accessAud); mark("sec_stripeKey",d.stripeKey); mark("sec_stripeWebhookSecret",d.stripeWebhookSecret); })
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
/* like saveSecret, but for the Cloudflare deploy-key FILES — and the server verifies the pasted value
   against Cloudflare itself before answering, so a bad paste is caught here, not at the next deploy. */
/* review link — a plain synced field on THIS org's registry record (owner/admin writes pass the server's
   registry sanitizer). Not a secret: it's the public link customers tap. */
window.saveReviewLink=function(){
  if(typeof settingsCanConfig==="function"&&!settingsCanConfig()){alert("Owner or admin only.");return;}
  const v=(val("in_reviewLink")||"").trim();
  if(v&&!/^https:\/\/\S+$/.test(v)){alert("That doesn't look like a link (should start with https://).");return;}
  const rec=(S.registry||[]).find(r=>r&&r.id===S.biz);
  if(!rec){alert("No org record found.");return;}
  rec.reviewLink=v; if(typeof touch==="function")touch(rec); save();
  alert(v?"Saved ✓ — the ⭐ button now shows on finished jobs.":"Cleared.");
};

/* ── Google Ads key management (Ray: keys managed IN THE APP, no terminal) ─────────────────────────────
   Mirrors saveDeployKey's trust model; the server never echoes secrets back, the UI only shows booleans. */
function gadsApi(pathSuffix,opts){
  const base=(S.sync&&S.sync.url)||"", tok=(S.sync&&S.sync.token)||"";
  return fetch(base+"/api/config/googleads"+(pathSuffix||"")+"?org="+encodeURIComponent(S.biz),Object.assign({headers:Object.assign({"Content-Type":"application/json"},tok?{Authorization:"Bearer "+tok}:{})},opts||{})).then(r=>r.json());
}
window.gadsRefreshStatus=function(){
  const el=document.getElementById("gads_status"); if(!el)return;
  gadsApi("",{method:"GET"}).then(d=>{
    if(!d||!d.ok){el.textContent="";return;}
    el.textContent=d.connected?"· connected ✓":d.hasClient?"· keys saved, not connected yet":"· not set up";
  }).catch(()=>{});
};
window.gadsReadFile=function(inp){
  const f=inp&&inp.files&&inp.files[0]; if(!f)return;
  const r=new FileReader();
  r.onload=function(){const t=document.getElementById("in_gadsJson");if(t)t.value=String(r.result||"");};
  r.readAsText(f);
};
window.gadsSaveCfg=function(){
  const j=(val("in_gadsJson")||"").trim(), cid=(val("in_gadsCust")||"").trim(), dev=(val("in_gadsDev")||"").trim();
  const body={}; if(j)body.oauthJson=j; if(cid)body.customerId=cid; if(dev)body.developerToken=dev;
  if(!Object.keys(body).length){alert("Nothing to save — add the JSON, the customer ID, or the developer token.");return;}
  gadsApi("",{method:"POST",body:JSON.stringify(body)}).then(d=>{
    if(!(d&&d.ok)){alert("Save failed: "+((d&&d.error)||"unknown"));return;}
    ["in_gadsJson","in_gadsCust","in_gadsDev"].forEach(id=>{const e=document.getElementById(id);if(e)e.value="";});
    alert("Saved ✓"+(d.client?" — client keys stored":"")+". Now hit Connect Google.");
    gadsRefreshStatus();
  }).catch(()=>alert("Save failed — are you online?"));
};
window.gadsConnect=function(){
  gadsApi("/connect",{method:"POST",body:"{}"}).then(d=>{
    if(!(d&&d.ok&&d.url)){alert("Can't connect yet: "+((d&&d.error)||"unknown"));return;}
    window.open(d.url,"_blank");
  }).catch(()=>alert("Couldn't reach the server."));
};
window.gadsExchange=function(){
  const input=(val("in_gadsCode")||"").trim();
  if(!input){alert("Paste the broken page's address first.");return;}
  gadsApi("/exchange",{method:"POST",body:JSON.stringify({input:input})}).then(d=>{
    if(!(d&&d.ok)){alert("Didn't work: "+((d&&d.error)||"unknown"));return;}
    const e=document.getElementById("in_gadsCode");if(e)e.value="";
    if(d.verified===true)alert("Connected ✓ and the Ads API answered — it can see "+d.accounts+" account"+(d.accounts===1?"":"s")+". Done.");
    else if(d.verified===false)alert("Connected ✓ but the Ads API refused the first call"+(d.apiError?" ("+d.apiError+")":"")+" — the grant is stored; we'll debug the API side separately.");
    else alert("Connected ✓ — "+(d.note||"verify skipped."));
    gadsRefreshStatus();
  }).catch(()=>alert("Couldn't reach the server."));
};

window.gadsScriptKey=function(){
  if(!confirm("Mint a new script key? Any previously minted key stops working."))return;
  gadsApi("/scriptkey",{method:"POST",body:"{}"}).then(d=>{
    if(!(d&&d.ok&&d.ingestKey)){alert("Failed: "+((d&&d.error)||"unknown"));return;}
    prompt("Copy this key into the INGEST_KEY line of the Ads Script (shown only once):",d.ingestKey);
  }).catch(()=>alert("Couldn't reach the server."));
};

/* per-org Cloudflare keys — every org has its own accounts (Ray 2026-09-10) */
window.saveOrgKey=function(name,inputId){
  const el=document.getElementById(inputId); if(!el)return; const v=(el.value||"").trim();
  if(!v){alert("Paste the token first.");return;}
  const base=(S.sync&&S.sync.url)||"", tok=(S.sync&&S.sync.token)||"";
  fetch(base+"/api/config/orgkeys?org="+encodeURIComponent(S.biz),{method:"POST",headers:Object.assign({"Content-Type":"application/json"},tok?{Authorization:"Bearer "+tok}:{}),body:JSON.stringify({name:name,value:v})})
    .then(r=>r.json()).then(d=>{
      if(!(d&&d.ok)){alert("Save failed: "+((d&&d.error)||"unknown"));return;}
      el.value="";
      if(d.cfValid===true)alert("Saved ✓ for "+((BIZ[S.biz]||{}).name||S.biz)+" — Cloudflare confirms the token is VALID.");
      else if(d.cfValid===false)alert("Saved — but Cloudflare REJECTED it. Copy the token VALUE (shown once at create/roll), from the right account.");
      else alert("Saved ✓ — couldn't reach Cloudflare to verify just now.");
      orgKeysRefresh();
    }).catch(()=>alert("Save failed — are you online?"));
};
window.orgKeysRefresh=function(){
  const base=(S.sync&&S.sync.url)||"", tok=(S.sync&&S.sync.token)||"";
  fetch(base+"/api/config/orgkeys?org="+encodeURIComponent(S.biz),{headers:tok?{Authorization:"Bearer "+tok}:{}}).then(r=>r.json()).then(d=>{
    if(!d||!d.ok)return;
    const set=(id,on)=>{const e=document.getElementById(id);if(e)e.textContent=on?"· saved ✓":"· not set";};
    set("ok_cfSites",d.cfSites); set("ok_cfDns",d.cfDns);
  }).catch(()=>{});
};

window.saveDeployKey=function(key,inputId){
  const el=document.getElementById(inputId); if(!el)return; const v=(el.value||"").trim();
  if(!v){alert("Paste the token first.");return;}
  const base=(S.sync&&S.sync.url)||"", tok=(S.sync&&S.sync.token)||"";
  fetch(base+"/api/config/deploykey",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},tok?{Authorization:"Bearer "+tok}:{}),body:JSON.stringify({key:key,value:v})})
    .then(r=>r.json())
    .then(d=>{
      if(!(d&&d.ok)){alert("Save failed: "+((d&&d.error)||"unknown"));return;}
      el.value="";
      if(d.cfValid===true)alert("Saved ✓ and Cloudflare confirms the token is VALID. Deploys are unblocked.");
      else if(d.cfValid===false)alert("Saved — but Cloudflare REJECTED it as invalid. Double-check you copied the token VALUE (shown once at create/roll), not the token ID, and that it's from the right account.");
      else alert("Saved ✓ — couldn't reach Cloudflare to verify just now; it'll be tested at the next deploy.");
    })
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

