/* ---------- SALES: route planners (OSRM-optimized) ---------- */
let SALESSUB="prospect",SMAP=null,SLAYER=null,SORDERED=[],SADDED=[],JOBDATE="";
function rSales(){
  if(!JOBDATE)JOBDATE=today();
  const subs=[["prospect","Prospecting route"],["jobs","Job route"]];
  let h=`<div class="secthd"><h2>Sales · route planner</h2></div>
    <div class="subnav">`+subs.map(s=>`<button class="subbtn ${SALESSUB===s[0]?"on":""}" onclick="salesSub('${s[0]}')">${s[1]}</button>`).join("")+`</div>`;
  if(SALESSUB==="prospect"){
    const places=(D().places||[]).filter(p=>!p.deleted&&p.lat!=null);
    h+=`<div class="card"><div class="muted" style="margin-bottom:6px">Check the target accounts to visit (pins saved on the Map tab), or add a stop by address. Then optimize the loop.</div>
      ${places.length?places.map(p=>`<label class="toggle" style="margin-top:6px"><input type="checkbox" class="sstop" data-lat="${p.lat}" data-lng="${p.lng}" data-name="${esc(p.name)}"> ${esc(p.name)}${p.owner?" · "+esc(p.owner):""}</label>`).join(""):`<div class="muted">No saved pins yet — drop some on the Map tab, or add an address below.</div>`}
      <div class="acwrap" style="margin-top:10px"><input id="s_addr" placeholder="Add a stop by address…" oninput="addrSuggest('s_addr','s_abox')"><div class="acbox" id="s_abox"></div></div>
      <button class="btn ghost sm" style="margin-top:6px" onclick="salesAddAddr()">+ Add this address</button>
      <div id="s_added"></div></div>`;
  } else {
    const jobs=actJ().filter(j=>!j.done&&j.date===JOBDATE);
    h+=`<div class="card"><label>Route date</label><input type="date" id="s_jobdate" value="${JOBDATE}" onchange="JOBDATE=this.value;render()">
      <div style="margin-top:8px" class="muted">${jobs.length} job(s) on ${fmtDate(JOBDATE)}. A job needs a property with a saved location (set the property's address to map it).</div>
      ${jobs.map(j=>{const p=j.propertyId?(D().properties||[]).find(x=>x.id===j.propertyId):null;const ok=p&&p.lat!=null;return `<div class="li"><div class="grow"><div class="nm" style="font-size:15px">${esc(j.title)}</div><div class="sub">${p?esc(p.label||p.address||""):"no property linked"}${ok?"":' · <span style="color:var(--danger)">⚠ no location</span>'}</div></div></div>`;}).join("")}</div>`;
  }
  h+=`<div class="card"><label>Start / home base (optional — defaults to first stop)</label><div class="acwrap"><input id="s_home" value="${esc(localStorage.getItem("jra_home")||"")}" placeholder="Your start address" oninput="addrSuggest('s_home','s_hbox')" onchange="localStorage.setItem('jra_home',this.value)"><div class="acbox" id="s_hbox"></div></div>
    <button class="btn acc" style="margin-top:10px" onclick="salesOptimize()">⚡ Optimize route</button>
    <div id="s_result" style="margin-top:10px"><span class="muted">Build your stops, then optimize.</span></div></div>
    <div id="smap"></div>
    <p class="muted" style="margin-top:8px">Free optimized routing (OSRM). "Navigate" hands off to Google Maps for live turn-by-turn. Needs an internet connection.</p>`;
  view.innerHTML=h;SORDERED=[];
  setTimeout(function(){initSMap();renderAdded();},40);
}
window.salesSub=function(s){SALESSUB=s;SADDED=[];SORDERED=[];render();};
function initSMap(){const el=document.getElementById("smap");if(!el)return;
  if(typeof L==="undefined"){el.innerHTML='<div class="muted" style="padding:20px">Map needs an internet connection.</div>';return;}
  SMAP=L.map("smap").setView([36.07,-75.70],10);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:20,attribution:"Imagery © Esri"}).addTo(SMAP);
  SLAYER=L.layerGroup().addTo(SMAP);
}
window.salesAddAddr=function(){const v=val("s_addr");if(!v){alert("Type an address first.");return;}
  fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q="+encodeURIComponent(v)).then(r=>r.json()).then(d=>{if(!d||!d[0]){alert("Address not found.");return;}
    SADDED.push({name:v,lat:+d[0].lat,lng:+d[0].lon});renderAdded();}).catch(function(){alert("Lookup failed — need internet.");});};
function renderAdded(){const el=document.getElementById("s_added");if(!el)return;el.innerHTML=SADDED.map((s,i)=>`<div class="li"><div class="grow">📍 ${esc(s.name)}</div><button class="rm" onclick="SADDED.splice(${i},1);renderAdded()">×</button></div>`).join("");}
function collectStops(){let stops=[];
  if(SALESSUB==="prospect"){document.querySelectorAll(".sstop:checked").forEach(cb=>{const la=parseFloat(cb.getAttribute("data-lat")),ln=parseFloat(cb.getAttribute("data-lng"));if(!isNaN(la)&&!isNaN(ln))stops.push({name:cb.getAttribute("data-name"),lat:la,lng:ln});});SADDED.forEach(s=>stops.push(s));}
  else{actJ().filter(j=>!j.done&&j.date===JOBDATE).forEach(j=>{const p=j.propertyId?(D().properties||[]).find(x=>x.id===j.propertyId):null;if(p&&p.lat!=null)stops.push({name:j.title,lat:p.lat,lng:p.lng});});}
  return stops;}
window.salesOptimize=function(){
  const stops=collectStops();const home=val("s_home");const res=document.getElementById("s_result");
  const go=function(homePt){let all=stops.slice();if(homePt)all.unshift(homePt);
    if(all.length<2){res.innerHTML='<span style="color:var(--danger)">Add at least 2 stops with a location.</span>';return;}
    res.innerHTML='<span class="muted">Optimizing…</span>';
    const coords=all.map(s=>s.lng+","+s.lat).join(";");
    fetch("https://router.project-osrm.org/trip/v1/driving/"+coords+"?source=first&roundtrip=true&overview=full&geometries=geojson")
      .then(r=>r.json()).then(d=>{if(d.code!=="Ok"){res.innerHTML='<span style="color:var(--danger)">Routing failed: '+esc(d.message||d.code)+'</span>';return;}drawRoute(d,all);})
      .catch(function(){res.innerHTML='<span style="color:var(--danger)">Routing error — need internet.</span>';});};
  if(home){fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q="+encodeURIComponent(home)).then(r=>r.json()).then(d=>go(d&&d[0]?{name:"Start",lat:+d[0].lat,lng:+d[0].lon}:null)).catch(function(){go(null);});}
  else go(null);
};
function drawRoute(d,all){const trip=d.trips[0];const ordered=[];d.waypoints.forEach((w,i)=>{ordered[w.waypoint_index]=all[i];});SORDERED=ordered.filter(Boolean);
  if(SLAYER){SLAYER.clearLayers();L.geoJSON(trip.geometry,{style:{color:"#2A6CF0",weight:5,opacity:.8}}).addTo(SLAYER);
    SORDERED.forEach((s,i)=>L.marker([s.lat,s.lng]).addTo(SLAYER).bindPopup((i+1)+". "+esc(s.name)));
    try{SMAP.fitBounds(L.geoJSON(trip.geometry).getBounds(),{padding:[30,30]});}catch(e){}}
  const mi=(trip.distance/1609.34).toFixed(1),min=Math.round(trip.duration/60);
  document.getElementById("s_result").innerHTML=`<div class="nm">${SORDERED.length} stops · ${mi} mi · ~${min} min driving</div>
    <ol style="margin:8px 0 8px 18px;font-size:14px">${SORDERED.map(s=>`<li>${esc(s.name)}</li>`).join("")}</ol>
    <button class="btn acc sm" onclick="salesNavigate()">🧭 Navigate (Google Maps)</button>`;}
window.salesNavigate=function(){if(!SORDERED.length)return;const o=SORDERED[0];const wp=SORDERED.slice(1).map(s=>s.lat+","+s.lng).join("|");
  window.open("https://www.google.com/maps/dir/?api=1&origin="+o.lat+","+o.lng+"&destination="+o.lat+","+o.lng+(wp?"&waypoints="+encodeURIComponent(wp):""),"_blank");};

