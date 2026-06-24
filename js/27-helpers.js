/* ---------- helpers ---------- */
function val(id){const e=document.getElementById(id);return e?e.value.trim():""}
function esc(s){return (s==null?"":String(s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]))}
let _acT=null;
window.addrSuggest=function(inpId,boxId){clearTimeout(_acT);const inp=document.getElementById(inpId),box=document.getElementById(boxId);if(!inp||!box)return;const q=inp.value.trim();if(q.length<4){box.innerHTML="";return;}_acT=setTimeout(function(){fetch("https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=us&q="+encodeURIComponent(q)).then(function(r){return r.json();}).then(function(d){box.innerHTML=(d||[]).map(function(x){return '<div class="acitem" data-a="'+esc(x.display_name)+'" onclick="addrPick(\''+inpId+'\',\''+boxId+'\',this)">'+esc(x.display_name)+'</div>';}).join("");}).catch(function(){});},350);};
window.addrPick=function(inpId,boxId,el){const inp=document.getElementById(inpId);inp.value=el.getAttribute("data-a");document.getElementById(boxId).innerHTML="";try{inp.dispatchEvent(new Event("change"));}catch(e){}};
/* Settings are per-user: stored on the signed-in account (u.settings, synced via S.users).
   When signed out we fall back to this device's localStorage so the toggle still works. */
function curUserSettings(){try{const u=(typeof curUser==="function")?curUser():null;return (u&&u.settings)||null;}catch(e){return null;}}
function themePref(){const s=curUserSettings();if(s&&s.theme)return s.theme;return localStorage.getItem("jra_theme")||"light";}
function applyTheme(){document.body.classList.toggle("dark",themePref()==="dark");}
window.toggleTheme=function(){
  const next=themePref()==="dark"?"light":"dark";
  localStorage.setItem("jra_theme",next);   // device fallback + fast pre-login boot
  const u=(typeof curUser==="function")?curUser():null;
  if(u){u.settings=u.settings||{};u.settings.theme=next;u.updatedAt=now();save();
    if(S.sync&&S.sync.url&&S.sync.token&&S.sync.auto&&typeof syncNow==="function")syncNow();}
  applyTheme();
};
/* upload an image file → resolves the stored blob id. The bytes live as a server file (uploads/<id>),
   the record only keeps the small id — so the synced JSON store never bloats. */
window.jsUpload=function(file){
  return new Promise(function(resolve,reject){
    if(!file||!/^image\//.test(file.type||"")){reject(new Error("Pick an image"));return;}
    const fr=new FileReader();
    fr.onload=function(){
      const base=((S.sync&&S.sync.url)||location.origin).replace(/\/+$/,""),tok=(S.sync&&S.sync.token)||"";
      fetch(base+"/api/upload",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+tok},body:JSON.stringify({dataUrl:fr.result})})
        .then(function(r){return r.json();}).then(function(d){if(d&&d.ok)resolve(d.id);else reject(new Error((d&&d.error)||"upload failed"));}).catch(reject);
    };
    fr.onerror=function(){reject(new Error("couldn't read the file"));};
    fr.readAsDataURL(file);
  });
};
window.jsUploadUrl=function(id){if(!id)return"";const base=((S.sync&&S.sync.url)||location.origin).replace(/\/+$/,"");return base+"/uploads/"+encodeURIComponent(id);};

