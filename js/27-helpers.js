/* ---------- helpers ---------- */
function val(id){const e=document.getElementById(id);return e?e.value.trim():""}
function esc(s){return (s==null?"":String(s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]))}
let _acT=null;
window.addrSuggest=function(inpId,boxId){clearTimeout(_acT);const inp=document.getElementById(inpId),box=document.getElementById(boxId);if(!inp||!box)return;const q=inp.value.trim();if(q.length<4){box.innerHTML="";return;}_acT=setTimeout(function(){fetch("https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=us&q="+encodeURIComponent(q)).then(function(r){return r.json();}).then(function(d){box.innerHTML=(d||[]).map(function(x){return '<div class="acitem" data-a="'+esc(x.display_name)+'" onclick="addrPick(\''+inpId+'\',\''+boxId+'\',this)">'+esc(x.display_name)+'</div>';}).join("");}).catch(function(){});},350);};
window.addrPick=function(inpId,boxId,el){const inp=document.getElementById(inpId);inp.value=el.getAttribute("data-a");document.getElementById(boxId).innerHTML="";try{inp.dispatchEvent(new Event("change"));}catch(e){}};
function applyTheme(){document.body.classList.toggle("dark",localStorage.getItem("jra_theme")==="dark");}
window.toggleTheme=function(){const dark=localStorage.getItem("jra_theme")!=="dark";localStorage.setItem("jra_theme",dark?"dark":"light");applyTheme();};

