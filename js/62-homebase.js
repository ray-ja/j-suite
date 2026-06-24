/* ---------- HOME BASE + drive-time estimates ----------
   Jobs start/end at one base address (Ray's home), so a single geocoded base gives a no-API drive
   estimate (straight-line × road factor / avg speed) on jobs + properties, and feeds job-cost thinking.
   Stored as a sentinel doc {id:"homeBase", address, lat, lng} on the synced docs collection. */
function homeBase(){ const d=D(); if(!Array.isArray(d.docs))d.docs=[]; return d.docs.find(x=>x&&x.id==="homeBase"&&!x.deleted)||null; }
function haversineMi(a1,o1,a2,o2){ if([a1,o1,a2,o2].some(v=>v==null))return null; const R=3958.8,toR=x=>x*Math.PI/180,dLat=toR(a2-a1),dLng=toR(o2-o1); const x=Math.sin(dLat/2)**2+Math.cos(toR(a1))*Math.cos(toR(a2))*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.sqrt(x)); }
/* one-way road estimate from base to a point (straight-line × 1.3 road factor, ~35 mph). */
function driveFromBase(lat,lng){ const hb=homeBase(); if(!hb||hb.lat==null||lat==null)return null; const straight=haversineMi(hb.lat,hb.lng,lat,lng); if(straight==null)return null; const roadMi=straight*1.3; return { miles:Math.round(roadMi*10)/10, min:Math.max(1,Math.round(roadMi/35*60)), roundMiles:Math.round(roadMi*2*10)/10 }; }
function driveBadge(lat,lng){ const d=driveFromBase(lat,lng); return d?`🚗 ~${d.min} min · ${d.miles} mi from base`:""; }
/* coords for a job via its linked property */
function jobLatLng(j){ if(!j)return null; const p=(j.propertyId&&typeof actProps==="function")?actProps().find(x=>x.id===j.propertyId):null; return (p&&p.lat!=null)?{lat:p.lat,lng:p.lng}:null; }

function hbGeocode(hb){
  if(!hb||!hb.address)return;
  fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q="+encodeURIComponent(hb.address))
    .then(r=>r.json()).then(g=>{ if(g&&g[0]){ hb.lat=+g[0].lat; hb.lng=+g[0].lon; if(typeof touch==="function")touch(hb); save(); if(typeof render==="function")render(); } }).catch(function(){});
}
window.setHomeBase=function(){
  const hb=homeBase();
  modal("Home base address",`<p class="muted" style="margin-bottom:8px">Jobs start &amp; end here — used for drive-time + cost estimates.</p>
    <label>Address</label><input id="hb_addr" value="${esc(hb?hb.address:"")}" placeholder="street, town, ST zip" autocomplete="off">
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="saveHomeBase()">Save &amp; locate</button>
    ${hb?(hb.lat!=null?`<div class="sub" style="margin-top:8px">📍 Located.</div>`:`<div class="sub" style="margin-top:8px;color:var(--danger)">Not located yet — check the address.</div>`):""}`);
};
window.saveHomeBase=function(){
  const addr=(val("hb_addr")||"").trim(); if(!addr){ alert("Enter an address."); return; }
  const d=D(); if(!Array.isArray(d.docs))d.docs=[];
  let hb=d.docs.find(x=>x&&x.id==="homeBase");
  if(!hb){ hb={id:"homeBase",address:addr,lat:null,lng:null,updatedAt:now()}; d.docs.push(hb); } else { hb.address=addr; hb.lat=null; hb.lng=null; }
  if(typeof touch==="function")touch(hb); save(); if(typeof closeModal==="function")closeModal(); if(typeof render==="function")render();
  hbGeocode(hb);
};
