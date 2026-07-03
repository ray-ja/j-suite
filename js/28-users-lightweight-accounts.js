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
/* NOTE: the legacy local-only account-create + login helpers (openCreateAccount/createAccount/openLogin/
   loginUser) were REMOVED — dead code (no callers) and a foot-gun: a local-only "create account" silently
   drops server-side (verifiedOwner=false → sanitizeUserWrites), and a local-only "login" never fetches a
   per-user token. The LIVE paths are appLogin/renderLogin (below, server-authoritative) and the invite-by-
   email flow (js/32 adminInviteMember → server POST /invite). */
/* ===== ROLE-VIEW TESTER (admin/owner-only) — see the app AS another role, for testing =====
   This is a CLIENT-SIDE VIEW OVERRIDE for an ALREADY-AUTHENTICATED admin, NOT a login. It writes
   window.VIEW_AS, which curRoleKey() (js/32) reads to DOWNGRADE the role used by canSee()/nav gating —
   and ONLY when the real signed-in user is an owner (js/32 enforces "real === 'owner'"), so it can never
   escalate, never creates a real account, never grants real access, and never touches the sync token or
   auth. A FAKE/template role view, fully reversible with one tap (Restore). It does NOT change what the
   SERVER authorizes — every write still carries the real user's real token; this only changes what THIS
   device chooses to SHOW. */
window.VIEW_AS = window.VIEW_AS || null;   // null = real role · a role key = previewing that role (read by curRoleKey, js/32)
// realRoleKey(): the real signed-in role, ignoring any VIEW_AS override (mirrors curRoleKey's base logic).
function realRoleKey(){
  var u=(typeof curUser==="function")?curUser():null;
  if(u&&u.superAdmin)return "owner";
  if(u)return ((typeof roleInOrg==="function"&&S.biz)?roleInOrg(u.id,S.biz):null)||u.role||"crew";
  return (typeof bootstrapContext==="function"&&bootstrapContext())?"owner":"crew";
}
// Only a REAL owner/super-admin can drive the tester — and only their override actually takes effect in
// js/32 (which gates VIEW_AS to real owners). This keeps the entry point honest about what works.
function canRoleView(){ return realRoleKey()==="owner"; }
// previewable roles: every non-owner role from the roles config (owner = "back to my real self" = restore)
function roleViewList(){
  var keys=(typeof allRoles==="function")?allRoles().map(function(r){return r.key;}):["admin","crew"];
  return keys.filter(function(k){return k&&k!=="owner";});
}
function roleLabel(key){ var r=(typeof roleByKey==="function")?roleByKey(key):null; return (r&&r.label)?r.label:(key?key.charAt(0).toUpperCase()+key.slice(1):key); }
window.setRoleView=function(role){
  if(!canRoleView())return;                       // never let a non-owner engage the override
  window.VIEW_AS=(!role||role==="owner")?null:role;
  closeModal();render();
};
window.clearRoleView=function(){ window.VIEW_AS=null; render(); };
window.roleViewMenu=function(){
  if(!canRoleView()){ alert("Role-view testing is owner-only."); return; }
  var roles=roleViewList();
  modal("View the app as…", `
    <p class="muted" style="margin-bottom:10px">Preview how j-Suite looks to each role — a <b>fake view override</b> for testing only. It does <b>not</b> sign you in as anyone, create an account, or grant access; you stay you. One tap on the banner restores your real view.</p>
    ${roles.map(function(r){return `<button class="btn ghost" style="width:100%;margin-bottom:8px;text-align:left" onclick="setRoleView('${r}')">👁 View as ${esc(roleLabel(r))}</button>`;}).join("")||`<p class="muted">No other roles configured.</p>`}
    <button class="btn" style="width:100%;margin-top:4px" onclick="setRoleView('owner')">↩ Stay as myself</button>
  `);
};
/* "Viewing as <role>" banner — a fixed top bar with a one-tap RESTORE, visible whenever a view override is
   active. Reuses the env-banner's body shift (has-dev-banner) so the sticky header stays aligned. */
function renderViewAsBanner(){
  var on=!!window.VIEW_AS && canRoleView();
  var b=document.getElementById("viewasbanner");
  if(!on){ if(b)b.remove(); document.body.classList.remove("has-viewas-banner"); if(window.VIEW_AS&&!canRoleView())window.VIEW_AS=null; return; }
  if(!b){ b=document.createElement("button"); b.id="viewasbanner"; b.type="button"; b.onclick=window.clearRoleView; document.body.insertBefore(b,document.body.firstChild); }
  b.innerHTML="👁 Viewing as <b>"+esc(roleLabel(window.VIEW_AS))+"</b> — tap to restore your view";
  document.body.classList.add("has-viewas-banner");
}
window.renderViewAsBanner=renderViewAsBanner;

/* SHARED-TOKEN UPGRADE NUDGE — the server tags a /sync response `shared:true` when this device authenticated
   with the LEGACY shared token (no per-user id). Such a device can't add members and can't be attributed
   server-side (that's the account-creation-drop bug). This shows a DISMISSIBLE, NON-LOCKING banner inviting a
   fresh per-user sign-in. It NEVER logs anyone out and NEVER clears the shared token — the shared token stays a
   valid sync authenticator; this is a gentle upgrade prompt only. Dismiss is remembered for the session. */
window.SHARED_TOKEN_MODE=window.SHARED_TOKEN_MODE||false;
function dismissSharedNudge(e){ if(e&&e.stopPropagation)e.stopPropagation(); try{sessionStorage.setItem("jra_shared_nudge_off","1");}catch(x){} var b=document.getElementById("sharednudge"); if(b)b.remove(); document.body.classList.remove("has-shared-nudge"); }
window.dismissSharedNudge=dismissSharedNudge;
function renderSharedTokenNudge(){
  var on=!!window.SHARED_TOKEN_MODE;
  try{ if(sessionStorage.getItem("jra_shared_nudge_off")==="1") on=false; }catch(x){}
  var b=document.getElementById("sharednudge");
  if(!on){ if(b)b.remove(); document.body.classList.remove("has-shared-nudge"); return; }
  if(!b){
    b=document.createElement("div"); b.id="sharednudge";
    b.style.cssText="position:fixed;left:0;right:0;bottom:0;z-index:9998;background:var(--accent,#2563eb);color:#fff;padding:9px 12px;font-size:13px;display:flex;align-items:center;gap:8px;box-shadow:0 -2px 8px rgba(0,0,0,.15)";
    document.body.appendChild(b);
  }
  b.innerHTML='<span style="flex:1;cursor:pointer" onclick="renderLogin()">This device uses legacy sign-in — <b>tap to sign in again</b> to add members &amp; enable per-user security.</span>'+
    '<button type="button" onclick="dismissSharedNudge(event)" style="background:rgba(255,255,255,.2);border:0;color:#fff;border-radius:6px;padding:4px 10px;font-size:13px;cursor:pointer">Dismiss</button>';
  document.body.classList.add("has-shared-nudge");
}
window.renderSharedTokenNudge=renderSharedTokenNudge;

/* PROFILE — stripped to almost nothing (per owner). Tap the 👤 → a small confirm: Sign out (default) or,
   for an admin/owner, Switch user (the role-view tester). Org switcher → header; dark mode/home base → Settings. */
window.profileMenu=function(){
  var u=curUser();
  modal("Account", `
    <div class="card"><div class="sub">Signed in as</div><div style="font-weight:800;font-size:17px">${u?esc(u.username):"—"}</div></div>
    <p class="muted" style="margin:2px 4px 12px">Sign out, or switch the app into another role's view to test it.</p>
    <button class="btn" style="width:100%;background:var(--danger);color:#fff" onclick="closeModal();logoutUser()">Sign out</button>
    ${canRoleView()?`<button class="btn ghost" style="width:100%;margin-top:8px" onclick="roleViewMenu()">👁 Switch user — preview another role</button>`:""}
    <button class="btn ghost" style="width:100%;margin-top:8px" onclick="closeModal()">Cancel</button>
  `);
};
window.logoutUser=function(){
  if(!confirm("Sign out?"))return;
  window.VIEW_AS=null;   // drop any role-view override on sign-out (never carries across a session)
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
  view.innerHTML=`<div style="display:flex;align-items:center;justify-content:center;min-height:70vh;padding:20px 0">
    <div class="card" style="width:100%;max-width:420px;margin:0 auto;border-top:4px solid var(--accent)">
    <h2 style="margin-top:0">Sign in</h2>
    <form onsubmit="appLogin();return false">
    <label>Username or email</label><input id="lg_user" name="username" autocomplete="username">
    <label>Password</label><input id="lg_pw" name="password" type="password" autocomplete="current-password">
    <button type="submit" class="btn acc" style="margin-top:12px;width:100%">Sign in</button>
    </form>
    <p class="muted" id="lg_msg" style="margin-top:8px;min-height:16px"></p>
    <p style="margin-top:2px;text-align:center"><a href="#" onclick="appForgotPw();return false" class="muted" style="text-decoration:underline">Forgot password?</a></p>
    </div>
  </div>`;
}
window.appLogin=async function(){
  const base=(val("lg_url")||defaultServerUrl()).replace(/\/+$/,""),un=val("lg_user"),pw=val("lg_pw");
  if(!un||!pw){loginMsg("Username and password required.");return;}
  if(!base){return appLoginOffline(un,pw);}   // no server reachable (file:// / unconfigured) → verify locally only
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
  }catch(e){ if(!(await appLoginOffline(un,pw,true))) loginMsg("Couldn't reach the server — check the URL / Tailscale connection."); }
};
/* OFFLINE / file:// login fallback — used ONLY when no server is reachable (empty base, or a fetch that threw
   because the network is down). Verifies the password against the LOCALLY-synced account records and grants
   LOCAL-ONLY access. It DELIBERATELY does NOT touch S.sync.token: whatever token is present (shared / prior /
   empty) is left exactly as-is, so this path can never mint sync authority — any account write still drops
   server-side (safe), and this does NOT reopen the "browse while signed out" hole because it sets jra_session
   to a REAL account and needLogin() only honors jra_offline_ok when curUser() resolves to one.
   LIMITATION: on a non-secure context (file:// / plain-http) crypto.subtle is unavailable, so hashPw() uses
   the djb2 "f…" fallback. An account whose stored passhash is SHA-256/scrypt (set while ONLINE) therefore may
   NOT verify offline here. That's accepted: offline login is a convenience for a previously-online device, not
   a security boundary — it grants local access only, never server writes. Returns true on success. */
async function appLoginOffline(un,pw,fromNetworkFail){
  const list=(typeof users==="function")?users():[];
  const lc=String(un||"").toLowerCase();
  const u=list.find(x=>x&&((String(x.username||"").toLowerCase()===lc)||(String(x.email||"").toLowerCase()===lc)));
  if(!u||u.active===false||u.passhash!==await hashPw(pw)){ loginMsg("Wrong username or password (offline)."); return false; }
  localStorage.setItem("jra_session",u.id);
  localStorage.setItem("jra_offline_ok","1");
  localStorage.setItem("jra_login_at",String(now()));
  window.AUTH_401=false;   // let this device browse its LOCAL data offline (any sync attempt would re-verify the token)
  save();                  // NOTE: S.sync.token is intentionally left untouched
  if(typeof applyUserSettings==="function")applyUserSettings();
  loginMsg(fromNetworkFail?"Signed in offline — local access only until you reconnect.":"");
  render();
  return true;
}
window.appLoginOffline=appLoginOffline;
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

