/* ---------- HOME BASE + drive-time estimates ----------
   Jobs start/end at one base address (Ray's home), so a single geocoded base gives a no-API drive
   estimate (straight-line × road factor / avg speed) on jobs + properties, and feeds job-cost thinking.
   Stored as a sentinel doc {id:"homeBase", address, lat, lng} on the synced docs collection. */
function homeBase(){ const d=D(); if(!Array.isArray(d.docs))d.docs=[]; return d.docs.find(x=>x&&x.id==="homeBase"&&!x.deleted)||null; }
function haversineMi(a1,o1,a2,o2){ if([a1,o1,a2,o2].some(v=>v==null))return null; const R=3958.8,toR=x=>x*Math.PI/180,dLat=toR(a2-a1),dLng=toR(o2-o1); const x=Math.sin(dLat/2)**2+Math.cos(toR(a1))*Math.cos(toR(a2))*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.sqrt(x)); }
/* ===== REAL ROAD DISTANCE (OSRM) — the shared road-mileage helper for drive/route ESTIMATES =====
   roadRouteMiles(waypoints, cb): ordered [[lat,lng],…] (≥2) → the OSRM driving distance in MILES via cb(miles),
   or cb(null) on ANY failure (offline, non-Ok, HTTP/parse error, ~6s timeout, <2 points, no fetch layer). It
   NEVER throws or blocks. Results are memoised in ROAD_CACHE keyed by the rounded (4-dp) waypoint string (a
   number on success, "none" on failure) and an in-flight Set dedupes so each distinct route hits OSRM AT MOST
   ONCE per session. This REPLACES the old haversine ×1.3 straight-line guess: when the map can't route, callers
   fall back to their OWN default / a MANUAL entry — never a ×1.3 guess (Ray: "never use the 1.3x guess"). */
const ROAD_CACHE = {};            // 4-dp waypoint key -> miles(number) | "none"
const ROAD_INFLIGHT = new Set();  // keys currently being fetched — fetch each distinct route at most once/session
function roadKey(wp){ return wp.map(p=>(+p[0]).toFixed(4)+","+(+p[1]).toFixed(4)).join(";"); }
/* SYNC cache lookup — number(miles) | "none"(tried+failed) | undefined(not tried). Lets callers check before firing. */
function roadRouteCached(waypoints){ if(!Array.isArray(waypoints)||waypoints.length<2)return undefined; return ROAD_CACHE[roadKey(waypoints)]; }
function roadRouteMiles(waypoints, cb){
  let key=null;
  try{
    if(typeof cb!=="function") cb=function(){};
    if(!Array.isArray(waypoints)||waypoints.length<2) return cb(null);   // bad input — don't cache
    key=roadKey(waypoints);
    const hit=ROAD_CACHE[key];
    if(hit!==undefined) return cb(hit==="none"?null:hit);                 // already known this session
    if(typeof fetch!=="function"){ ROAD_CACHE[key]="none"; return cb(null); }  // no network layer → terminal fail, memoise it
    if(ROAD_INFLIGHT.has(key)) return;   // already fetching this exact route — DON'T call cb (avoids sync-cb recursion) or double-hit
    ROAD_INFLIGHT.add(key);
    const coords=waypoints.map(p=>(+p[1])+","+(+p[0])).join(";");   // OSRM wants lng,lat
    const url="https://router.project-osrm.org/route/v1/driving/"+coords+"?overview=false&annotations=distance";
    let settled=false;
    const finish=function(mi){
      if(settled)return; settled=true; ROAD_INFLIGHT.delete(key);
      ROAD_CACHE[key]=(mi!=null&&isFinite(mi)&&mi>=0)?mi:"none";
      try{ cb(ROAD_CACHE[key]==="none"?null:ROAD_CACHE[key]); }catch(e){}
    };
    const timer=setTimeout(function(){ finish(null); },6000);
    fetch(url).then(function(r){return r.json();}).then(function(j){
      clearTimeout(timer);
      if(!j||j.code!=="Ok"||!j.routes||!j.routes[0]||j.routes[0].distance==null) return finish(null);
      finish((+j.routes[0].distance||0)/1609.34);
    }).catch(function(){ clearTimeout(timer); finish(null); });
  }catch(e){ if(key){ ROAD_CACHE[key]="none"; ROAD_INFLIGHT.delete(key); } try{cb(null);}catch(_){} }   // memoise the failure so a synchronous-cb caller can't re-fetch/recurse
}
if(typeof window!=="undefined"){ window.roadRouteMiles=roadRouteMiles; window.roadRouteCached=roadRouteCached; }
/* one-way ROAD miles from base to a point — OSRM real roads, NEVER the ×1.3 guess. Returns the estimate ONLY
   when the road route is already cached this session; otherwise it fires the OSRM lookup (gentle re-render on
   success) and returns null NOW, so the caller uses ITS OWN fallback (e.g. wizSiteDriveRT's 20 mi) — not a guess.
   A cached "none" (offline / can't route) also returns null → caller default. Shape unchanged {miles,min,roundMiles}. */
function driveFromBase(lat,lng){
  const hb=homeBase(); if(!hb||hb.lat==null||lat==null)return null;
  const wp=[[hb.lat,hb.lng],[lat,lng]];
  const cached=roadRouteCached(wp);
  if(typeof cached==="number"){ const road=cached; return { miles:Math.round(road*10)/10, min:Math.max(1,Math.round(road/35*60)), roundMiles:Math.round(road*2*10)/10 }; }
  if(cached==="none") return null;   // the map couldn't route — caller falls back to its own default (NO ×1.3)
  roadRouteMiles(wp,function(mi){ if(mi!=null&&typeof render==="function"){ try{render();}catch(e){} } });   // not tried yet → kick it off, surface on land
  return null;
}
function driveBadge(lat,lng){ const d=driveFromBase(lat,lng); return d?`🚗 ~${d.min} min · ${d.miles} mi from base`:""; }
/* coords for a job via its linked property */
function jobLatLng(j){ if(!j)return null; const p=(j.propertyId&&typeof actProps==="function")?actProps().find(x=>x.id===j.propertyId):null; return (p&&p.lat!=null)?{lat:p.lat,lng:p.lng}:null; }

function bizName(){ return (typeof S!=="undefined"&&S.biz==="jam")?"Jamieson Automation":"OBX Lot Solutions"; }
function hbGeocode(hb){
  if(!hb||!hb.address)return;
  const g1=q=>fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q="+encodeURIComponent(q)).then(r=>r.json());
  const coarse=hb.address.split(",").slice(1).join(",").trim();   // drop the street line → "town, ST zip" when an exact street isn't in OSM
  const done=ok=>{ if(typeof touch==="function")touch(hb); save(); const st=document.getElementById("hb_status");
    if(st){ st.innerHTML = ok
      ? `<span style="color:var(--accent)">📍 Found: ${esc(hb.resolved||"")}</span><br><span class="sub">If that's the wrong place, fix the address and re-save.</span>`
      : `<span style="color:var(--danger)">Couldn't locate that — add the town + ZIP (e.g. "Kill Devil Hills, NC 27948").</span>`; }
    else if(typeof render==="function")render(); };
  g1(hb.address).then(g=>(g&&g[0])?g:(coarse&&coarse!==hb.address?g1(coarse):null))
    .then(g=>{ if(g&&g[0]){ hb.lat=+g[0].lat; hb.lng=+g[0].lon; hb.resolved=g[0].display_name||""; done(true); } else { hb.lat=null; hb.lng=null; hb.resolved=""; done(false); } })
    .catch(function(){ done(false); });
}
window.setHomeBase=function(){
  const hb=homeBase(), bn=bizName();
  const stat = hb ? (hb.lat!=null
      ? `<span style="color:var(--accent)">📍 Found: ${esc(hb.resolved||hb.address||"")}</span><br><span class="sub">If that's the wrong place, fix the address and re-save.</span>`
      : `<span style="color:var(--danger)">Not located yet — check the address (add town + ZIP).</span>`) : "";
  modal("Home base — "+bn,`<p class="muted" style="margin-bottom:8px"><b>${bn}</b> jobs start &amp; end here — drive-time + pickup mileage use it. Each business keeps its <b>own</b> home base; switch the Business in Settings to set the other one.</p>
    <label>Address</label><div class="acwrap"><input id="hb_addr" value="${esc(hb?hb.address:"")}" placeholder="street, town, ST zip" oninput="addrSuggest('hb_addr','hb_addr_ac')" autocomplete="off"><div class="acbox" id="hb_addr_ac"></div></div>
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="saveHomeBase()">Save &amp; locate</button>
    <div id="hb_status" style="margin-top:8px">${stat}</div>`);
};
window.saveHomeBase=function(){
  const addr=(val("hb_addr")||"").trim(); if(!addr){ alert("Enter an address."); return; }
  const d=D(); if(!Array.isArray(d.docs))d.docs=[];
  let hb=d.docs.find(x=>x&&x.id==="homeBase");
  if(!hb){ hb={id:"homeBase",address:addr,lat:null,lng:null,resolved:"",updatedAt:now()}; d.docs.push(hb); } else { hb.address=addr; hb.lat=null; hb.lng=null; hb.resolved=""; }
  // saved-location pre-read (js/69 pattern): if the address was PICKED from a saved place/property, reuse its exact
  // coords + SKIP the OSM geocode (re-geocoding the typed text is what landed Lowe's 400mi off).
  const _hi=(typeof document!=="undefined")?document.getElementById("hb_addr"):null;
  if(_hi&&_hi.dataset&&_hi.dataset.pickLat){
    hb.lat=+_hi.dataset.pickLat; hb.lng=+_hi.dataset.pickLng; hb.resolved=addr;
    delete _hi.dataset.pickLat;delete _hi.dataset.pickLng;delete _hi.dataset.pickPlaceId;delete _hi.dataset.pickPropId;delete _hi.dataset.pickManualMiles;
    if(typeof touch==="function")touch(hb); save();
    const st2=document.getElementById("hb_status"); if(st2)st2.innerHTML=`<span style="color:var(--accent)">📍 Using the saved location's coordinates.</span>`;
    return;
  }
  if(typeof touch==="function")touch(hb); save();
  const st=document.getElementById("hb_status"); if(st)st.innerHTML='<span class="sub">Locating…</span>';   // keep the modal open so you SEE where it landed
  hbGeocode(hb);
};
