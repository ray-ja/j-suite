/* ---------- USERS / lightweight accounts ---------- */
async function hashPw(pw){
  try{const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(pw+"::jsuite"));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
  catch(e){let h=5381;const s=pw+"::jsuite";for(let i=0;i<s.length;i++)h=((h*33)^s.charCodeAt(i))>>>0;return "f"+h.toString(16);}
}
function users(){return (S.users||[]).filter(u=>!u.deleted);}
function curUser(){const id=localStorage.getItem("jra_session");return users().find(u=>u.id===id)||null;}
function userName(id){const u=(S.users||[]).find(x=>x.id===id);return u?u.username:"";}
window.openCreateAccount=function(){modal("New account",`
  <p class="muted" style="margin-bottom:8px">No email needed — just a username and password. This is lightweight identity for your team (for assigning to-dos), not bank-grade security.</p>
  <label>Username</label><input id="u_name" autocomplete="off">
  <label>Password</label><input id="u_pw" type="password" autocomplete="new-password">
  <button class="btn acc" style="margin-top:14px" onclick="createAccount()">Create account</button>`);};
window.createAccount=async function(){
  const un=val("u_name"),pw=val("u_pw");
  if(!un||!pw){alert("Username and password required.");return;}
  if(users().some(u=>u.username.toLowerCase()===un.toLowerCase())){alert("That username is taken.");return;}
  if(!S.users)S.users=[];
  S.users.push({id:uid(),username:un,passhash:await hashPw(pw),settings:{theme:(typeof themePref==="function"?themePref():"light")},updatedAt:now()});
  const u=S.users[S.users.length-1];localStorage.setItem("jra_session",u.id);
  save();closeModal();render();
};
window.openLogin=function(){modal("Sign in",`
  <label>Username</label><input id="l_name" autocomplete="off">
  <label>Password</label><input id="l_pw" type="password" autocomplete="off">
  <button class="btn acc" style="margin-top:14px" onclick="loginUser()">Sign in</button>`);};
window.loginUser=async function(){
  const un=val("l_name"),pw=val("l_pw");
  const u=users().find(x=>x.username.toLowerCase()===un.toLowerCase());
  if(!u||u.passhash!==await hashPw(pw)){alert("Wrong username or password.");return;}
  localStorage.setItem("jra_session",u.id);closeModal();render();
};
window.logoutUser=function(){localStorage.removeItem("jra_session");render();};

/* ===== connection gate + login (login fetches the sync token from the server) ===== */
window.AUTH_401=false;   // set when the server rejects our token; forces the sign-in screen
function needLogin(){
  if(window.AUTH_401)return true;                          // server said our token is no good
  if(S.sync&&S.sync.token)return false;                    // have a token → connected
  if(localStorage.getItem("jra_offline_ok"))return false;  // user chose offline on this device
  return true;                                             // no token, not offline → must sign in
}
function loginMsg(t){const e=document.getElementById("lg_msg");if(e)e.textContent=t||"";}
function defaultServerUrl(){return (S.sync&&S.sync.url)||((location.protocol.indexOf("http")===0)?location.origin:"");}
function renderLogin(){
  const url=defaultServerUrl(),hasLocal=!!users().length;
  view.innerHTML=`<div class="card" style="max-width:420px;margin:18px auto;border-top:4px solid var(--accent)">
    <h2 style="margin-top:0">Not connected — sign in</h2>
    <p class="muted">Sign in to load your business. Your username and password fetch this device's sync access from the server.</p>
    <label>Username</label><input id="lg_user" autocomplete="username">
    <label>Password</label><input id="lg_pw" type="password" autocomplete="current-password">
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="appLogin()">Sign in</button>
    <p class="muted" id="lg_msg" style="margin-top:8px;min-height:16px"></p>
    <details style="margin-top:6px"><summary class="sub" style="cursor:pointer;font-weight:700">Advanced — server URL &amp; manual token</summary>
      <label>Sync server URL</label><input id="lg_url" value="${esc(url)}" placeholder="http://your-server:4000">
      <label>Access token (bootstrap / manual)</label><input id="lg_token" placeholder="paste the server token">
      <button class="btn ghost sm" style="margin-top:8px" onclick="appBootstrapToken()">Use token (bootstrap)</button>
      <p class="muted" style="margin-top:6px">First device on a brand-new server (no accounts yet)? Paste the token here, or open the app with <code>#token=YOURTOKEN</code> in the URL.</p>
    </details>
    ${hasLocal?`<button class="btn ghost sm" style="margin-top:10px;width:100%" onclick="useOffline()">Use this device offline</button>`:""}
  </div>`;
}
window.appLogin=async function(){
  const base=(val("lg_url")||defaultServerUrl()).replace(/\/+$/,""),un=val("lg_user"),pw=val("lg_pw");
  if(!base){loginMsg("Enter the server URL under Advanced.");return;}
  if(!un||!pw){loginMsg("Username and password required.");return;}
  loginMsg("Signing in…");
  try{
    const r=await fetch(base+"/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:un,password:pw})});
    if(r.status===429){loginMsg("Too many attempts — wait a minute, then try again.");return;}
    if(!r.ok){let d={};try{d=await r.json();}catch(e){}loginMsg(d&&d.accounts===0?"No accounts on the server yet — bootstrap with the token (Advanced).":"Wrong username or password.");return;}
    const d=await r.json();
    S.sync.url=base;if(d.token)S.sync.token=d.token;S.sync.auto=true;
    if(d.user&&d.user.id)localStorage.setItem("jra_session",d.user.id);
    window.AUTH_401=false;localStorage.removeItem("jra_offline_ok");save();
    if(typeof syncRun==="function")await syncRun("pull");   // pull their data silently (no empty-store confirm)
    if(typeof applyUserSettings==="function")applyUserSettings();
    render();
  }catch(e){loginMsg("Couldn't reach the server — check the URL / Tailscale connection.");}
};
window.appBootstrapToken=async function(){
  const base=(val("lg_url")||defaultServerUrl()).replace(/\/+$/,""),tok=val("lg_token");
  if(!tok){loginMsg("Paste a token first.");return;}
  S.sync.url=base;S.sync.token=tok;S.sync.auto=true;window.AUTH_401=false;localStorage.removeItem("jra_offline_ok");save();
  loginMsg("Connecting…");
  try{if(typeof syncRun==="function")await syncRun("pull");else await syncNow();}catch(e){}
  render();
};
window.useOffline=function(){localStorage.setItem("jra_offline_ok","1");render();};
/* apply the signed-in user's synced settings (e.g. theme) on this device */
function applyUserSettings(){const u=(typeof curUser==="function")?curUser():null;if(u&&u.settings&&u.settings.theme)localStorage.setItem("jra_theme",u.settings.theme);if(typeof applyTheme==="function")applyTheme();}
window.delUser=function(id){if(!confirm("Remove this account?"))return;
  const u=S.users.find(x=>x.id===id);u.deleted=true;u.updatedAt=now();
  if(localStorage.getItem("jra_session")===id)localStorage.removeItem("jra_session");
  save();render();};

