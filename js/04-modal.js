/* ---------- modal ---------- */
const overlay=document.getElementById("overlay"),sheet=document.getElementById("sheet");
function modal(title,html){
  sheet.innerHTML=`<div class="shead"><h3>${title}</h3><button class="cl" onclick="closeModal()">×</button></div>`+html;
  overlay.classList.add("show");
}
function closeModal(){overlay.classList.remove("show");if(typeof lockReleaseOnModalClose==="function")lockReleaseOnModalClose();}
// Close on a BACKDROP click — but ONLY when the press STARTED on the backdrop. Dragging to select text inside a
// field and releasing outside the popup fires a click whose target is the overlay (the common ancestor of the
// mousedown+mouseup); without this guard that drag-select would slam the modal shut (Ray hit this constantly).
let _mdOnOverlay=false;
overlay.addEventListener("pointerdown",e=>{_mdOnOverlay=(e.target===overlay);});
overlay.onclick=e=>{if(e.target===overlay&&_mdOnOverlay)closeModal();};
window.closeModal=closeModal;

