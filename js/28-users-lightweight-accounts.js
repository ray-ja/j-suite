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
  S.users.push({id:uid(),username:un,passhash:await hashPw(pw),updatedAt:now()});
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
window.delUser=function(id){if(!confirm("Remove this account?"))return;
  const u=S.users.find(x=>x.id===id);u.deleted=true;u.updatedAt=now();
  if(localStorage.getItem("jra_session")===id)localStorage.removeItem("jra_session");
  save();render();};

