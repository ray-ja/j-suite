/* ---------- MAP — a reference view of where everything is ------------------------------------------------
   ⭐ THE LOT ESTIMATOR MOVED OUT (js/158). Ray, 2026-08-26: "can you separate the draw lot / count spaces
   tool? that goes in a parking lot cleaning quote tool not on the map."

   Drawing a lot and counting spaces were never map features — they were the first step of QUOTING a lot,
   parked on the wrong screen. The wizard's 🅿️ Parking lot option even did `TAB="map"` and abandoned the
   quote you were building. Both now live inside openParkingLotEst(), which has somewhere to put the number.

   What is left is what a map is for: search an address, see every place and property, drop a lead pin.
   ⛔ And a plain click no longer does anything — "Drop pin" is an explicit toggle now. It used to default to
   draw-mode, so every stray tap on a phone silently added a polygon vertex. */
let MAP=null,MAP_PIN=false,MPINL=null;
function rMap(){
  view.innerHTML=`<div class="secthd"><h2>Map · every place &amp; property</h2></div>
    <div class="maptop"><input id="map_search" placeholder="Search an address…" style="flex:1;min-width:140px" onkeydown="if(event.key==='Enter')mapSearch()"><button class="btn ghost sm" onclick="mapSearch()">Go</button></div>
    <div class="maptop">
      <button class="subbtn" id="mb_pin" onclick="setMapPin()">📍 Drop pin</button>
      <span class="muted" style="font-size:12.5px">turn this on, then tap the map to add a lead</span>
    </div>
    <div id="map"></div>
    <div id="map_legend" class="sub" style="margin-top:6px"></div>
    <p class="muted" style="margin-top:8px">Measuring a parking lot? That's in the quote — <b>Quotes → 🅿️ Parking lot → 🛰️ Measure it</b>.</p>
    <p class="muted" style="margin-top:6px">Ownership lookup: <a href="https://gis.darenc.com/" target="_blank" rel="noopener">Dare County GIS</a> · <a href="https://www.maps.arcgis.com/" target="_blank" rel="noopener">Currituck GIS</a>. The map needs an internet connection.</p>`;
  setTimeout(initMap,40);
}
function initMap(){
  const el=document.getElementById("map");if(!el)return;
  if(typeof L==="undefined"){el.innerHTML='<div class="muted" style="padding:24px">Map library didn\'t load — you need an internet connection for the map.</div>';return;}
  MAP=L.map("map").setView([36.07,-75.70],11);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:20,attribution:"Imagery © Esri"}).addTo(MAP);
  MPINL=L.layerGroup().addTo(MAP);
  MAP_PIN=false; setMapPin(false);
  renderPlaces();
  MAP.on("click",e=>{ if(MAP_PIN) addPlacePrompt(e.latlng); });
}
/* toggle — called with no argument from the button, with `false` to force it off on (re)init */
window.setMapPin=function(v){
  MAP_PIN = (v===undefined) ? !MAP_PIN : !!v;
  const b=document.getElementById("mb_pin"); if(b) b.classList.toggle("on",MAP_PIN);
};
window.mapSearch=function(){
  const q=(document.getElementById("map_search")||{}).value;if(!q)return;
  fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q="+encodeURIComponent(q))
    .then(r=>r.json()).then(d=>{if(d&&d[0])MAP.setView([+d[0].lat,+d[0].lon],19);else alert("Address not found.");})
    .catch(()=>alert("Search failed — need an internet connection."));
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

