/* ---------- boot ---------- */
applyTheme();
load();
/* if the app is served from the sync server, default the sync URL to that origin */
if(!S.sync.url && location.protocol.indexOf("http")===0){S.sync.url=location.origin;save();}
setBiz(S.biz);
if(S.sync.url&&S.sync.token&&S.sync.auto)syncNow();
if("serviceWorker" in navigator && window.isSecureContext){navigator.serviceWorker.register("sw.js").catch(function(){});}
/* v2 */
