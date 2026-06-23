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
/* deep-link: a notification (or a ?tab= link) opens straight to that tab */
(function(){try{
  var t=new URLSearchParams(location.search).get("tab");
  if(t && ["today","messages","schedule","quotes","accounts","time","todo"].indexOf(t)>=0){
    TAB=t; if(t==="messages"&&typeof msgResetOpen==="function")msgResetOpen();
    try{history.replaceState(null,"",location.pathname);}catch(e){}   // strip the param so a refresh doesn't re-pin it
  }
}catch(e){}})();
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
if("serviceWorker" in navigator && window.isSecureContext){
  navigator.serviceWorker.register("sw.js").catch(function(){});
  /* the SW posts {type:"navigate",tab} when a notification is clicked while the app is already open */
  navigator.serviceWorker.addEventListener("message",function(e){
    if(e.data && e.data.type==="navigate" && e.data.tab){
      TAB=e.data.tab; if(TAB==="messages"&&typeof msgResetOpen==="function")msgResetOpen();
      if(typeof render==="function")render();
    }
  });
}
/* v2 */
