/* ---------- MAP (satellite lot estimator + lead pins) ---------- */
let MAP=null,MAP_MODE="draw",MPOLY=[],MCOUNT=[],MSQFT=325,MPOLYL=null,MCOUNTL=null,MPINL=null;
function rMap(){
  view.innerHTML=`<div class="secthd"><h2>Map · every place &amp; property</h2></div>
    <div class="maptop"><input id="map_search" placeholder="Search an address…" style="flex:1;min-width:140px" onkeydown="if(event.key==='Enter')mapSearch()"><button class="btn ghost sm" onclick="mapSearch()">Go</button></div>
    <div class="maptop">
      <button class="subbtn on" id="mb_draw" onclick="setMapMode('draw')">▱ Draw lot</button>
      <button class="subbtn" id="mb_count" onclick="setMapMode('count')">• Count spaces</button>
      <button class="subbtn" id="mb_pin" onclick="setMapMode('pin')">📍 Drop pin</button>
      <button class="btn ghost sm" onclick="mapClear()">Clear</button>
    </div>
    <div class="maptop"><label style="margin:0">Sq ft / space</label><input id="map_sqft" type="number" value="${MSQFT}" style="width:80px" onchange="MSQFT=parseFloat(this.value)||325;mapRecalc()"><span class="muted">~325 incl. drive aisles</span></div>
    <div id="map"></div>
    <div id="map_legend" class="sub" style="margin-top:6px"></div>
    <div class="card" id="map_res" style="margin-top:10px"><span class="muted">Pick "Draw lot", then tap the corners of a parking lot on the satellite view — it estimates the number of spaces and quotes it. Or drop pins to map leads.</span></div>
    <p class="muted" style="margin-top:8px">Ownership lookup: <a href="https://gis.darenc.com/" target="_blank" rel="noopener">Dare County GIS</a> · <a href="https://www.maps.arcgis.com/" target="_blank" rel="noopener">Currituck GIS</a>. The map needs an internet connection.</p>`;
  setTimeout(initMap,40);
}
function initMap(){
  const el=document.getElementById("map");if(!el)return;
  if(typeof L==="undefined"){el.innerHTML='<div class="muted" style="padding:24px">Map library didn\'t load — you need an internet connection for the map.</div>';return;}
  MAP=L.map("map").setView([36.07,-75.70],11);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:20,attribution:"Imagery © Esri"}).addTo(MAP);
  MPINL=L.layerGroup().addTo(MAP);MPOLYL=L.layerGroup().addTo(MAP);MCOUNTL=L.layerGroup().addTo(MAP);
  MPOLY=[];MCOUNT=[];
  renderPlaces();setMapMode(MAP_MODE);
  MAP.on("click",mapClick);
}
window.setMapMode=function(m){MAP_MODE=m;["draw","count","pin"].forEach(x=>{const b=document.getElementById("mb_"+x);if(b)b.classList.toggle("on",x===m);});};
function mapClick(e){
  if(MAP_MODE==="draw"){MPOLY.push(e.latlng);drawPoly();mapRecalc();}
  else if(MAP_MODE==="count"){MCOUNT.push(e.latlng);drawCount();mapRecalc();}
  else if(MAP_MODE==="pin"){addPlacePrompt(e.latlng);}
}
function drawPoly(){MPOLYL.clearLayers();
  MPOLY.forEach(p=>L.circleMarker(p,{radius:4,color:"#8BC34A",fillColor:"#8BC34A",fillOpacity:1}).addTo(MPOLYL));
  if(MPOLY.length>=2)L.polygon(MPOLY,{color:"#8BC34A",weight:2,fillOpacity:0.15}).addTo(MPOLYL);}
function drawCount(){MCOUNTL.clearLayers();
  MCOUNT.forEach((p,i)=>L.marker(p,{icon:L.divIcon({className:"",iconSize:[20,20],html:'<div style="background:#1B2A4E;color:#fff;border-radius:50%;width:20px;height:20px;font-size:11px;font-weight:700;text-align:center;line-height:20px">'+(i+1)+'</div>'})}).addTo(MCOUNTL));}
function polyAreaSqft(){
  if(MPOLY.length<3)return 0;
  const lat0=MPOLY[0].lat*Math.PI/180, mx=p=>p.lng*111320*Math.cos(lat0), my=p=>p.lat*110540;
  let a=0;for(let i=0;i<MPOLY.length;i++){const j=(i+1)%MPOLY.length;a+=mx(MPOLY[i])*my(MPOLY[j])-mx(MPOLY[j])*my(MPOLY[i]);}
  return Math.abs(a/2)*10.7639;
}
window.mapRecalc=function(){
  const res=document.getElementById("map_res");if(!res)return;
  if(MAP_MODE==="count"||MCOUNT.length){res.innerHTML=`<div class="nm">${MCOUNT.length} spaces counted</div><div class="sub">Tap each space to count; tap "Quote" when done.</div><button class="btn acc sm" style="margin-top:8px" onclick="quoteLot(${MCOUNT.length})">Quote parking-lot cleanup</button>`;return;}
  const sqft=polyAreaSqft();
  if(sqft<50){res.innerHTML=`<span class="muted">Tap the corners of the lot to estimate spaces.</span>`;return;}
  const spaces=Math.round(sqft/MSQFT);
  res.innerHTML=`<div class="nm">~${Math.round(sqft).toLocaleString()} sq ft → ~${spaces} parking spaces</div><div class="sub">at ${MSQFT} sq ft/space (incl. drive aisles)</div><button class="btn acc sm" style="margin-top:8px" onclick="quoteLot(${spaces})">Quote parking-lot cleanup (${spaces} spaces)</button>`;
};
window.mapClear=function(){MPOLY=[];MCOUNT=[];if(MPOLYL)MPOLYL.clearLayers();if(MCOUNTL)MCOUNTL.clearLayers();mapRecalc();};
window.mapSearch=function(){
  const q=(document.getElementById("map_search")||{}).value;if(!q)return;
  fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q="+encodeURIComponent(q))
    .then(r=>r.json()).then(d=>{if(d&&d[0])MAP.setView([+d[0].lat,+d[0].lon],19);else alert("Address not found.");})
    .catch(()=>alert("Search failed — need an internet connection."));
};
window.quoteLot=function(spaces){
  const price=spaces<=25?79:spaces<=50?129:spaces<=100?199:spaces<=200?349:spaces<=300?499:spaces<=500?799:Math.round(spaces*1.6);
  TAB="quotes";render();
  openQuote(null,"",[{serviceId:"",name:"Parking-lot cleanup — "+spaces+" spaces",unit:"quote",price:price,qty:1}]);
};
/* ⭐ EVERYTHING ON ONE MAP. Ray, 2026-08-26: "the map page should be under reference and it should show
   the location of every place and property." It only ever drew `places` — his customers' properties, which
   are the addresses he actually drives to, were not on it at all.

   ⚠️ AND IT DIDN'T CHECK COORDINATES. His "Transfer Station - Currituck" has lat:null; L.marker([null,null])
   throws "Invalid LatLng", and one bad record would take the whole marker layer down with it — every pin
   gone, no error he'd ever see. Three of his records have no coordinates today. They are now counted and
   reported under the map rather than silently dropped or allowed to break it. */
function mapHasLL(x){ return x && isFinite(+x.lat) && isFinite(+x.lng) && !(+x.lat===0 && +x.lng===0); }
function mapMissing(){
  var a=(D().places||[]).filter(p=>p&&!p.deleted&&!mapHasLL(p)).length;
  var b=(D().properties||[]).filter(p=>p&&!p.deleted&&!mapHasLL(p)).length;
  return a+b;
}
function renderPlaces(){
  if(!MPINL)return; MPINL.clearLayers();
  var pts=[];
  (D().places||[]).filter(p=>p&&!p.deleted&&mapHasLL(p)).forEach(function(p){ addPlaceMarker(p); pts.push([+p.lat,+p.lng]); });
  (D().properties||[]).filter(p=>p&&!p.deleted&&mapHasLL(p)).forEach(function(p){ addPropMarker(p); pts.push([+p.lat,+p.lng]); });
  /* ⭐ frame everything he owns rather than a hardcoded view of the Outer Banks */
  try{ if(pts.length>1&&MAP) MAP.fitBounds(pts,{padding:[40,40],maxZoom:15});
       else if(pts.length===1&&MAP) MAP.setView(pts[0],14); }catch(e){}
  var note=document.getElementById("map_legend");
  if(note){
    var miss=mapMissing();
    note.innerHTML='<span style="color:#4da3ff">●</span> places &nbsp; <span style="color:#ffd24d">●</span> customer properties'
      + (miss? ' &nbsp;·&nbsp; <span class="muted">'+miss+' without coordinates '+(miss===1?"isn't":"aren't")+' shown</span>' : '');
  }
}
function addPlaceMarker(p){
  L.circleMarker([+p.lat,+p.lng],{radius:7,color:"#4da3ff",fillColor:"#4da3ff",fillOpacity:.85,weight:2})
   .addTo(MPINL).bindPopup("<b>"+esc(p.name||"Place")+"</b>"+(p.category?"<br>"+esc(p.category):"")+(p.address?"<br>"+esc(p.address):"")+'<br><a href="#" onclick="delPlace(\''+p.id+'\');return false">remove</a>');
}
/* a customer's property — the addresses he actually drives to */
function addPropMarker(p){
  var who="";
  try{
    var ids=(p.customerIds||[]).filter(Boolean);
    who=ids.map(function(id){ return (typeof custName==="function")?custName(id):""; }).filter(Boolean).join(", ");
  }catch(e){}
  L.circleMarker([+p.lat,+p.lng],{radius:7,color:"#ffd24d",fillColor:"#ffd24d",fillOpacity:.85,weight:2})
   .addTo(MPINL).bindPopup("<b>"+esc(p.label||"Property")+"</b>"+(who?"<br>"+esc(who):"")+(p.address?"<br>"+esc(p.address):""));
}
function addPlacePrompt(latlng){
  const name=prompt("Property / lead name:");if(!name)return;
  const owner=prompt("Owner or property manager (optional):")||"";
  const p={id:uid(),name:name,type:"lead",owner:owner,notes:"",lat:latlng.lat,lng:latlng.lng,updatedAt:now()};
  D().places=D().places||[];D().places.push(p);save();addPlaceMarker(p);
}
window.delPlace=function(id){const p=D().places.find(x=>x.id===id);if(p){p.deleted=true;p.updatedAt=now();save();renderPlaces();if(MAP)MAP.closePopup();}};

