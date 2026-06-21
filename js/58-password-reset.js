/* ---------- self-service password reset: "Forgot password?" + emailed one-time link ----------
   Pairs with the server /forgot + /reset endpoints. The login screen (js/28) routes to renderResetPw
   when the URL carries a ?reset=<token>; otherwise it shows the "Forgot password?" link. */
function jsResetToken(){
  try{
    var m=(location.search||"").match(/[?&]reset=([a-f0-9]{16,})/i);
    if(m) return m[1];
    var h=(location.hash||"").match(/reset=([a-f0-9]{16,})/i);
    return h?h[1]:"";
  }catch(e){return "";}
}
window.jsResetToken=jsResetToken;
function jsResetBase(){
  return (typeof defaultServerUrl==="function"?defaultServerUrl():(location.origin||"")).replace(/\/+$/,"");
}
window.appForgotPw=function(){
  view.innerHTML=`<div class="card" style="max-width:420px;margin:40px auto;border-top:4px solid var(--accent)">
    <h2 style="margin-top:0">Reset password</h2>
    <p class="muted">Enter your username or email. If an account exists, we'll email a reset link.</p>
    <label>Username or email</label><input id="fp_user" autocomplete="username">
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="appSendReset()">Send reset link</button>
    <p class="muted" id="fp_msg" style="margin-top:8px;min-height:16px"></p>
    <p style="margin-top:6px;text-align:center"><a href="#" onclick="render();return false" class="muted">Back to sign in</a></p>
  </div>`;
};
window.appSendReset=async function(){
  var un=val("fp_user"),msg=document.getElementById("fp_msg");
  if(!un){if(msg)msg.textContent="Enter your username.";return;}
  if(msg)msg.textContent="Sending…";
  try{ await fetch(jsResetBase()+"/forgot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:un})}); }catch(e){}
  if(msg)msg.textContent="If that account exists, a reset link is on its way — check your email.";   // generic: no enumeration
};
window.renderResetPw=function(){
  view.innerHTML=`<div class="card" style="max-width:420px;margin:40px auto;border-top:4px solid var(--accent)">
    <h2 style="margin-top:0">Set a new password</h2>
    <label>New password</label><input id="rp_pw" type="password" autocomplete="new-password">
    <label>Confirm new password</label><input id="rp_pw2" type="password" autocomplete="new-password">
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="appDoReset()">Update password</button>
    <p class="muted" id="rp_msg" style="margin-top:8px;min-height:16px"></p>
  </div>`;
};
window.appDoReset=async function(){
  var pw=val("rp_pw"),pw2=val("rp_pw2"),msg=document.getElementById("rp_msg");
  if(!pw||pw.length<8){if(msg)msg.textContent="Use at least 8 characters.";return;}
  if(pw!==pw2){if(msg)msg.textContent="Passwords don't match.";return;}
  if(msg)msg.textContent="Updating…";
  try{
    var r=await fetch(jsResetBase()+"/reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:jsResetToken(),password:pw})});
    if(r.ok){
      try{history.replaceState(null,"",location.pathname);}catch(e){}   // strip ?reset= so refresh/back shows the login
      if(msg)msg.textContent="Password updated — you can sign in now.";
      setTimeout(function(){ if(typeof render==="function")render(); },1400);
    }else{
      var d={};try{d=await r.json();}catch(e){}
      if(msg)msg.textContent=(d&&d.error)?d.error:"This reset link is invalid or expired — request a new one.";
    }
  }catch(e){ if(msg)msg.textContent="Network error — try again."; }
};
