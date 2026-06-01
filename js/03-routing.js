/* ---------- routing ---------- */
let TAB="today";
const view=document.getElementById("view");
function setBiz(b){S.biz=b;save();document.body.dataset.biz=b;
  document.getElementById("logo").innerHTML='<img src="'+BIZ[b].logo+'" alt="'+BIZ[b].name+'" style="max-height:40px;width:auto;max-width:220px;object-fit:contain;display:block">';
  document.getElementById("bizsel").value=b;render()}
function render(){
  if(TAB!=="training")TRMOD=null;
  document.body.classList.toggle("wizon",!!WZON);
  document.querySelectorAll("nav button").forEach(btn=>btn.classList.toggle("on",btn.dataset.tab===TAB));
  ({today:rToday,accounts:rAccounts,quotes:rQuotes,schedule:rSchedule,map:rMap,sales:rSales,todo:rTodos,plan:rPlan,training:rTraining,market:rMarket,opps:rOpps,sites:rSites,buildplan:rBuildPlan,data:rData}[TAB])();
  renderSyncPill();
}
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{TAB=b.dataset.tab;render()});
document.getElementById("bizsel").onchange=e=>setBiz(e.target.value);
document.getElementById("fab").onclick=()=>{
  if(TAB==="quotes")openQuote();else if(TAB==="schedule")openJob();else if(TAB==="todo")openTodo();else if(TAB==="plan"){if(PLANSUB==="marketing")openMkt();}else if(TAB==="accounts"){ACCTSUB==="properties"?openProperty():openCustomer();}else if(TAB==="map"||TAB==="data"||TAB==="sales"||TAB==="training"||TAB==="market"||TAB==="opps"||TAB==="sites")return;else openCustomer();
};

