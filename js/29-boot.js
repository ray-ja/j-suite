/* ---------- boot ---------- */
load();
/* #token= bootstrap — first-ever device / brand-new server with no accounts yet */
(function(){var m=(location.hash||"").match(/token=([^&]+)/);if(!m)return;
  try{S.sync.token=decodeURIComponent(m[1]);}catch(e){S.sync.token=m[1];}
  if(!S.sync.url&&location.protocol.indexOf("http")===0)S.sync.url=location.origin;
  S.sync.auto=true;if(typeof window!=="undefined")window.AUTH_401=false;save();
  try{history.replaceState(null,"",location.pathname+location.search);}catch(e){}})();
/* if the app is served from the sync server, default the sync URL to that origin */
if(!S.sync.url && location.protocol.indexOf("http")===0){S.sync.url=location.origin;save();}
/* Cloudflare Access SSO — silently sign in via the verified email when served behind Access */
if(typeof attemptAccessLogin==="function" && needLogin()){attemptAccessLogin().then(function(ok){if(ok)render();});}
applyTheme();
setBiz(S.biz);
if(typeof applyUserSettings==="function")applyUserSettings();
/* auto-sync: pull on open, on focus/visibility, on reconnect, and on a slow interval */
if(typeof syncRun==="function"){
  if(S.sync.url&&S.sync.token&&S.sync.auto)syncRun("pull");
  window.addEventListener("focus",function(){syncRun("pull");});
  document.addEventListener("visibilitychange",function(){if(!document.hidden)syncRun("pull");});
  window.addEventListener("online",function(){_retryN=0;syncRun(SYNC_DIRTY?"auto":"pull");});
  setInterval(function(){syncRun("pull");},60000);
}
if("serviceWorker" in navigator && window.isSecureContext){navigator.serviceWorker.register("sw.js").catch(function(){});}
/* v2 */
