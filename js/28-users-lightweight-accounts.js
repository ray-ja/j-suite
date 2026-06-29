/* ---------- USERS / lightweight accounts ---------- */
async function hashPw(pw){
  try{const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(pw+"::jsuite"));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
  catch(e){let h=5381;const s=pw+"::jsuite";for(let i=0;i<s.length;i++)h=((h*33)^s.charCodeAt(i))>>>0;return "f"+h.toString(16);}
}
function users(){return (S.users||[]).filter(u=>!u.deleted&&!u.kind);}
function curUser(){const id=localStorage.getItem("jra_session");return users().find(u=>u.id===id)||null;}
/* "Log out everywhere": an owner stamps the account's logoutAt; any device whose login predates it signs out.
   Works for shared-token devices too (it's a synced field), and the server also 401s a per-user token issued before it. */
function checkForcedLogout(){try{const me=curUser();if(!me)return false;const myLogin=+localStorage.getItem("jra_login_at")||0;if(me.logoutAt&&me.logoutAt>myLogin){window.AUTH_401=true;if(S.sync)S.sync.token="";localStorage.removeItem("jra_session");save();if(typeof syMsg==="function")syMsg("Signed out by an owner — sign in again.");if(typeof render==="function")render();return true;}}catch(e){}return false;}
function userName(id){const u=(S.users||[]).find(x=>x.id===id);return u?u.username:"";}
window.openCreateAccount=function(){modal("New account",`
  <p class="muted" style="margin-bottom:8px">Username + password. Add the person's email to enable one-tap sign-in through Cloudflare Access (optional).</p>
  <label>Username</label><input id="u_name" autocomplete="off">
  <label>Email (optional — for Access SSO)</label><input id="u_email" autocomplete="off" placeholder="name@obxlotsolutions.com">
  <label>Password</label><input id="u_pw" type="password" autocomplete="new-password">
  <button class="btn acc" style="margin-top:14px" onclick="createAccount()">Create account</button>`);};
window.createAccount=async function(){
  const un=val("u_name"),pw=val("u_pw");
  if(!un||!pw){alert("Username and password required.");return;}
  if(users().some(u=>u.username.toLowerCase()===un.toLowerCase())){alert("That username is taken.");return;}
  if(!S.users)S.users=[];
  const isFirst=users().length===0;   // first account on a fresh setup is the owner; others default to crew
  S.users.push({id:uid(),username:un,email:(val("u_email")||"").trim().toLowerCase(),passhash:await hashPw(pw),role:isFirst?"owner":"crew",active:true,settings:{theme:(typeof themePref==="function"?themePref():"light")},updatedAt:now()});
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
  if(u.active===false){alert("This account is deactivated. Ask an owner to reactivate it.");return;}
  localStorage.setItem("jra_session",u.id);closeModal();render();
};
window.profileMenu=function(){
  var u=curUser(), dk=(typeof themePref==="function"&&themePref()==="dark");
  modal("Account", `
    <div class="card"><div class="sub">Signed in as</div><div style="font-weight:800;font-size:17px">${u?esc(u.username):"—"}</div></div>
    <div class="card"><label style="margin-top:0">Organization</label>
      <select onchange="if(this.value==='__new__'){this.value=S.biz;createOrgPrompt();}else{setBiz(this.value);closeModal();}">
        ${(typeof myOrgs==="function"?myOrgs():[]).map(o=>`<option value="${esc(o.id)}" ${S.biz===o.id?"selected":""}>${esc(o.name)}</option>`).join("")}
        ${(typeof isOwner==="function"&&isOwner())?`<option value="__new__">➕ New organization…</option>`:""}
      </select></div>
    <div class="card"><div class="row" style="align-items:center"><div class="grow"><strong>Dark mode</strong></div><input type="checkbox" style="width:auto;flex:0 0 auto" ${dk?"checked":""} onchange="toggleTheme()"></div></div>
    <div class="card"><div class="row" style="align-items:center"><div class="grow"><strong>🏠 Home base — ${typeof orgName==="function"?esc(orgName(S.biz)):esc(S.biz)}</strong><div class="sub" style="white-space:normal">${(typeof homeBase==="function"&&homeBase())?(homeBase().lat!=null?"📍 "+esc(homeBase().resolved||homeBase().address):"⚠ "+esc(homeBase().address)+" — not located, tap Set"):"Not set — pickup/drive mileage needs this"}</div></div><button class="btn ghost sm" onclick="closeModal();setHomeBase()">Set</button></div></div>
    <button class="btn" style="width:100%;margin-top:6px;background:var(--danger);color:#fff" onclick="closeModal();logoutUser()">Sign out</button>
  `);
};
window.logoutUser=function(){
  if(!confirm("Sign out?"))return;
  localStorage.removeItem("jra_session");localStorage.removeItem("jra_offline_ok");
  try{sessionStorage.removeItem("jra_admin_ok");}catch(e){}   // re-lock the Admin PIN on next sign-in
  if(S.sync)S.sync.token="";save();
  render();   // back to the app's own username/password login (the Cloudflare Access gate is retired)
};

/* ===== connection gate + login (login fetches the sync token from the server) ===== */
window.AUTH_401=false;   // set when the server rejects our token; forces the sign-in screen
function needLogin(){
  if(window.AUTH_401)return true;                          // server said our token is no good
  if(S.sync&&S.sync.token)return false;                    // have a token → connected (also the genuine #token= first-run bootstrap, before any account exists)
  // user chose offline on this device — but only honor it for a device that is genuinely SIGNED IN
  // (a session resolving to a real account). A cleared store leaves no token AND no resolvable user, so the
  // stale offline flag alone must NOT keep an account-less, sessionless device "in" — that's the
  // browse-while-signed-out hole. Offline-after-login (a real session, no network) still passes here.
  if(localStorage.getItem("jra_offline_ok")&&(typeof curUser==="function"?curUser():null))return false;
  return true;                                             // no token, no signed-in offline session → must sign in
}
function loginMsg(t){const e=document.getElementById("lg_msg");if(e)e.textContent=t||"";}
function defaultServerUrl(){return (S.sync&&S.sync.url)||((location.protocol.indexOf("http")===0)?location.origin:"");}
function renderLogin(){
  if(typeof jsResetToken==="function"&&jsResetToken()&&typeof renderResetPw==="function"){return renderResetPw();}   // arrived via an emailed reset link
  const hasLocal=!!users().length;
  view.innerHTML=`<div class="card" style="max-width:420px;margin:40px auto;border-top:4px solid var(--accent)">
    <h2 style="margin-top:0">Sign in</h2>
    <form onsubmit="appLogin();return false">
    <label>Username or email</label><input id="lg_user" name="username" autocomplete="username">
    <label>Password</label><input id="lg_pw" name="password" type="password" autocomplete="current-password">
    <button type="submit" class="btn acc" style="margin-top:12px;width:100%">Sign in</button>
    </form>
    <p class="muted" id="lg_msg" style="margin-top:8px;min-height:16px"></p>
    <p style="margin-top:2px;text-align:center"><a href="#" onclick="appForgotPw();return false" class="muted" style="text-decoration:underline">Forgot password?</a></p>
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
    window.AUTH_401=false;localStorage.setItem("jra_login_at",String(now()));localStorage.removeItem("jra_offline_ok");save();
    // SPA login doesn't navigate, so explicitly ask the browser to save the credential (Credential Mgmt API; Chromium). Safari/extensions use the <form> instead.
    try{ if(window.PasswordCredential && navigator.credentials && navigator.credentials.store){ await navigator.credentials.store(new PasswordCredential({id:un,password:pw,name:un})); } }catch(e){}
    if(typeof syncRun==="function")await syncRun("pull");   // pull their data silently (no empty-store confirm)
    if(typeof applyUserSettings==="function")applyUserSettings();
    render();
  }catch(e){loginMsg("Couldn't reach the server — check the URL / Tailscale connection.");}
};
window.appBootstrapToken=async function(){
  const base=(val("lg_url")||defaultServerUrl()).replace(/\/+$/,""),tok=val("lg_token");
  if(!tok){loginMsg("Paste a token first.");return;}
  S.sync.url=base;S.sync.token=tok;S.sync.auto=true;window.AUTH_401=false;localStorage.setItem("jra_login_at",String(now()));localStorage.removeItem("jra_offline_ok");save();
  loginMsg("Connecting…");
  try{if(typeof syncRun==="function")await syncRun("pull");else await syncNow();}catch(e){}
  render();
};
window.useOffline=function(){localStorage.setItem("jra_offline_ok","1");render();};
/* Cloudflare Access SSO — when served behind Access, fetch the sync token by VERIFIED email (no password).
   Falls through on file:// / local (no Access JWT) or an unmatched email, so password login still works. */
async function attemptAccessLogin(){
  if(!needLogin())return false;                              // already connected
  if(location.protocol.indexOf("http")!==0)return false;     // file:// — no Access in front
  const base=defaultServerUrl().replace(/\/+$/,"");if(!base)return false;
  try{
    const r=await fetch(base+"/login/access",{headers:{"Accept":"application/json"},credentials:"include"});
    if(!r.ok)return false;
    const d=await r.json();if(!d||!d.token||!d.user)return false;
    S.sync.url=defaultServerUrl();S.sync.token=d.token;S.sync.auto=true;
    localStorage.setItem("jra_session",d.user.id);
    window.AUTH_401=false;localStorage.setItem("jra_login_at",String(now()));localStorage.removeItem("jra_offline_ok");save();
    if(typeof syncRun==="function")await syncRun("pull");
    if(typeof applyUserSettings==="function")applyUserSettings();
    return true;
  }catch(e){return false;}
}
/* apply the signed-in user's synced settings (e.g. theme) on this device */
function applyUserSettings(){const u=(typeof curUser==="function")?curUser():null;if(u&&u.settings&&u.settings.theme)localStorage.setItem("jra_theme",u.settings.theme);if(typeof applyTheme==="function")applyTheme();}
window.delUser=function(id){
  const u=S.users.find(x=>x.id===id);if(!u)return;
  if(u.role==="owner"&&typeof activeOwners==="function"&&activeOwners().length<=1){alert("Can't remove the last owner.");return;}
  if(!confirm("Remove this account?"))return;
  u.deleted=true;u.updatedAt=now();
  if(localStorage.getItem("jra_session")===id)localStorage.removeItem("jra_session");
  save();render();};

