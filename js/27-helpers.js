/* ---------- helpers ---------- */
function val(id){const e=document.getElementById(id);return e?e.value.trim():""}
function esc(s){return (s==null?"":String(s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]))}
/* Per-record audit line — "✎ edited by Ray · 2h ago" from the editedBy/editedAt stamp touch() writes. */
function editedByLine(r){try{if(!r||!r.editedBy)return "";const u=((typeof S!=="undefined"&&S.users)||[]).find(x=>x&&x.id===r.editedBy);const nm=u?(u.name||u.username):"someone";const ago=(typeof agoTxt==="function"&&r.editedAt)?(" · "+agoTxt(r.editedAt)):"";return `<div class="sub" style="opacity:.6;margin-top:4px">✎ edited by ${esc(nm)}${ago}</div>`;}catch(e){return "";}}
let _acT=null;
/* SAVED-LOCATIONS autocomplete source — up to ~5 case-insensitive substring matches over the user's SAVED
   records, fully offline (no fetch): saved PROPERTIES (actProps, on label/address, only where lat!=null so we
   have real coords to reuse) + active PLACES (D().places, on name/address, non-deleted + lat!=null). Each match
   is {kind:"property"|"place", ref:id, label, address, lat, lng, manualMiles?} — the caller threads ref via a
   data-place/data-prop attr so a picked suggestion reuses the stored coords instead of re-geocoding the text
   (the js/69 "Lowe's geocoded 400mi off" fix, generalized). Never throws; empty query → []. */
function savedLocMatches(q){
  q=(q==null?"":String(q)).trim().toLowerCase();
  if(!q)return [];
  const out=[];
  try{
    const props=(typeof actProps==="function")?actProps():[];
    for(let i=0;i<props.length&&out.length<5;i++){const p=props[i];
      if(!p||p.lat==null)continue;
      const label=p.label||"",addr=p.address||"";
      if((label+" "+addr).toLowerCase().indexOf(q)<0)continue;
      out.push({kind:"property",ref:p.id,label:label||addr||"Property",address:addr,lat:p.lat,lng:p.lng});
    }
    const places=((typeof D==="function"&&D()&&D().places)||[]).filter(function(p){return p&&!p.deleted&&p.lat!=null;});
    for(let i=0;i<places.length&&out.length<5;i++){const p=places[i];
      const name=p.name||"",addr=p.address||"";
      if((name+" "+addr).toLowerCase().indexOf(q)<0)continue;
      const m={kind:"place",ref:p.id,label:name||addr||"Place",address:addr,lat:p.lat,lng:p.lng};
      if(typeof p.manualMiles==="number"&&isFinite(p.manualMiles)&&p.manualMiles>0)m.manualMiles=p.manualMiles;
      out.push(m);
    }
  }catch(e){}
  return out.slice(0,5);
}
if(typeof window!=="undefined")window.savedLocMatches=savedLocMatches;
/* address autocomplete — SAVED matches first (synchronous, offline, 2-char threshold), then OSM Nominatim
   APPENDED below (4-char threshold). OSM never clobbers the saved rows. */
window.addrSuggest=function(inpId,boxId){clearTimeout(_acT);const inp=document.getElementById(inpId),box=document.getElementById(boxId);if(!inp||!box)return;const q=inp.value.trim();
  const saved=(q.length>=2&&typeof savedLocMatches==="function")?savedLocMatches(q):[];
  const savedHTML=saved.map(function(s){const icon=s.kind==="place"?"📍":"🏠";
    const ref=s.kind==="place"?(' data-place="'+esc(s.ref)+'"'):(' data-prop="'+esc(s.ref)+'"');
    const mm=(s.manualMiles!=null)?(' data-manmi="'+esc(s.manualMiles)+'"'):"";
    const sub=(s.address&&s.address!==s.label)?(' <span class="acsub">'+esc(s.address)+'</span>'):"";
    return '<div class="acitem saved" data-a="'+esc(s.address||s.label)+'" data-lat="'+esc(s.lat)+'" data-lng="'+esc(s.lng)+'"'+ref+mm+' onclick="addrPick(\''+inpId+'\',\''+boxId+'\',this)">'+icon+' '+esc(s.label)+sub+' <span class="acsrc">📍 · saved</span></div>';}).join("");
  box.innerHTML=savedHTML;
  if(q.length<4){return;}
  _acT=setTimeout(function(){fetch("https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=us&q="+encodeURIComponent(q)).then(function(r){return r.json();}).then(function(d){const osmHTML=(d||[]).map(function(x){return '<div class="acitem" data-a="'+esc(x.display_name)+'" data-lat="'+esc(x.lat)+'" data-lng="'+esc(x.lon)+'" onclick="addrPick(\''+inpId+'\',\''+boxId+'\',this)">'+esc(x.display_name)+'</div>';}).join("");box.innerHTML=savedHTML+osmHTML;}).catch(function(){});},350);};
window.addrPick=function(inpId,boxId,el){const inp=document.getElementById(inpId);inp.value=el.getAttribute("data-a");
  /* clear any stale saved-ref from a PRIOR pick first, so re-picking a plain OSM result after a saved one can't leak a placeId/propId */
  delete inp.dataset.pickPlaceId;delete inp.dataset.pickPropId;delete inp.dataset.pickManualMiles;
  const la=el.getAttribute("data-lat"),lo=el.getAttribute("data-lng");if(la&&lo&&la!=="undefined"&&lo!=="undefined"){inp.dataset.pickLat=la;inp.dataset.pickLng=lo;}
  const pid=el.getAttribute("data-place");if(pid)inp.dataset.pickPlaceId=pid;
  const prp=el.getAttribute("data-prop");if(prp)inp.dataset.pickPropId=prp;
  const mm=el.getAttribute("data-manmi");if(mm)inp.dataset.pickManualMiles=mm;
  document.getElementById(boxId).innerHTML="";try{inp.dispatchEvent(new Event("change"));}catch(e){}};
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
/* upload an image OR PDF file → resolves the stored blob id. The bytes live as a server file (uploads/<id>),
   the record only keeps the small id — so the synced JSON store never bloats. */
window.jsUpload=function(file){
  return new Promise(function(resolve,reject){
    if(!file||!(/^image\//.test(file.type||"")||file.type==="application/pdf"||/\.pdf$/i.test(file.name||""))){reject(new Error("Pick an image or PDF"));return;}
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
/* ---------- submit guard — the "5 RJs on one job" / rapid-tap duplicate-submit fix ----------
   On weak jobsite signal a save looks like a no-op, so the crew jams the button 5-20 times and every tap
   mints its own record. This guard is called at the TOP of each create/save handler (AFTER validation passes,
   so a "enter an amount" no-op tap doesn't burn the window). It covers BOTH cases:
     (a) DEBOUNCE — a repeat of the same action within `ms` (~1.2s) of the last accepted one is dropped. A human
         can't fill a fresh form + resubmit in <1.2s, so this only ever blocks accidental rapid re-taps.
     (b) BUSY-FLAG — for any handler that awaits (upload), the flag stays true across the await.
   Returns true if this submit should proceed, false if it's a dup to ignore. Unique `key` per handler. */
window.submitGuard=function(key,ms){
  ms=ms||1200; var t=Date.now();
  window.__subAt=window.__subAt||{}; window.__subBusy=window.__subBusy||{};
  if(window.__subBusy[key])return false;            // an await-based save is still in flight
  if(t-(window.__subAt[key]||0)<ms)return false;    // rapid re-tap of the same action — drop it
  window.__subAt[key]=t; window.__subBusy[key]=true;
  setTimeout(function(){window.__subBusy[key]=false;},ms);
  return true;
};

