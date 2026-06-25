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
  var _hadCtrl=!!navigator.serviceWorker.controller, _refreshing=false;
  navigator.serviceWorker.register("sw.js").then(function(reg){
    /* an open tab (esp. iOS Safari) never notices a new build on its own — actively poll for one */
    setInterval(function(){ try{ reg.update(); }catch(e){} }, 60000);
    window.addEventListener("focus", function(){ try{ reg.update(); }catch(e){} });
  }).catch(function(){});
  /* when the new SW takes control, reload to the fresh build — but never yank the page out from under
     active typing or an open modal; defer until they refocus / finish */
  function _safeReload(){ var ae=document.activeElement; if(ae&&(ae.tagName==="INPUT"||ae.tagName==="TEXTAREA"||ae.isContentEditable))return false; var ov=document.getElementById("overlay"); return !(ov&&ov.classList.contains("show")); }
  function _applyUpdate(){ if(_refreshing)return; if(_safeReload()){ _refreshing=true; location.reload(); } }
  navigator.serviceWorker.addEventListener("controllerchange", function(){
    if(!_hadCtrl)return;   // first control on a brand-new visit isn't an update — don't spuriously reload
    _applyUpdate();
    window.addEventListener("focus", _applyUpdate);
    document.addEventListener("visibilitychange", function(){ if(!document.hidden)_applyUpdate(); });
  });
  /* the SW posts {type:"navigate",tab} when a notification is clicked while the app is already open */
  navigator.serviceWorker.addEventListener("message",function(e){
    if(e.data && e.data.type==="navigate" && e.data.tab){
      TAB=e.data.tab; if(TAB==="messages"&&typeof msgResetOpen==="function")msgResetOpen();
      if(typeof render==="function")render();
    }
  });
}
/* Manual "get the latest" escape hatch — unregister the SW + clear its caches + reload. For iOS PWAs
   that won't auto-update. Touches ONLY the SW cache (Cache Storage); never your data (localStorage). */
window.forceUpdate=function(){
  if(!confirm("Reload with the latest version? This clears the app cache only — your data is safe (it syncs to the server)."))return;
  (async function(){
    try{ if("serviceWorker" in navigator){ var regs=await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(function(r){return r.unregister();})); } }catch(e){}
    try{ if(window.caches){ var ks=await caches.keys(); await Promise.all(ks.map(function(k){return caches.delete(k);})); } }catch(e){}
    location.reload();
  })();
};
/* v2 */
