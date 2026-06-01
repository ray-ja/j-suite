/* ---------- modal ---------- */
const overlay=document.getElementById("overlay"),sheet=document.getElementById("sheet");
function modal(title,html){
  sheet.innerHTML=`<div class="shead"><h3>${title}</h3><button class="cl" onclick="closeModal()">×</button></div>`+html;
  overlay.classList.add("show");
}
function closeModal(){overlay.classList.remove("show")}
overlay.onclick=e=>{if(e.target===overlay)closeModal()};
window.closeModal=closeModal;

