/* review-fixes-tests.js — regression tests for the pipeline/finance review fixes (#2..#7).
   Run: node verify-app.js "$(cat review-fixes-tests.js)"  (#1 lives in square-invoice-tests.js) */
window.alert=function(){};window.confirm=function(){return true;};
S.users=S.users||[]; if(!S.users.some(x=>x&&x.id==="u_rj"))S.users.push({id:"u_rj",username:"Rj",name:"Rj",active:true});
if(typeof orgSetRole==="function")orgSetRole("u_rj","obx","owner");
localStorage.setItem("jra_session","u_rj");localStorage.setItem("jra_offline_ok","1");S.biz="obx";
function T(n,c){ if(c)diag("✓ "+n); else __errs.push("REVFIX FAIL: "+n); }
var d=D();

// ================= #2 — income statement subtracts pass-through materials =================
["income","jobs","expenses","timeclock","quotes","customers"].forEach(k=>d[k]=[]);
d.income.push({id:"i1",amount:1000,date:"2026-06-15",jobId:"jm",crew:["u_rj"]});
d.jobs.push({id:"jm",title:"Patio",date:"2026-06-15",crew:["u_rj"],materials:[{id:"m1",amount:300},{id:"m2",amount:100}],expenses:[{id:"e1",amount:100,category:"disposal"}]});
var pl=finPeriodPL("2026-06");
T("#2 pl.materials = $400 (40000c)", pl.materials===40000);
T("#2 jobCosts = $100 disposal (10000c), materials NOT in jobCosts", pl.jobCosts===10000);
T("#2 net subtracts materials: 100000 - 10000 jobCost - 40000 materials = 50000 (minus 0 mileage/opex)", pl.net===50000);
T("#2 totalCosts includes materials", pl.totalCosts===50000);
// pass-through billed AT COST is net-neutral: add a second job billed==cost, profit unchanged by the material
var before=finPeriodPL("2026-06").net;
d.income.push({id:"i2",amount:200,date:"2026-06-16",jobId:"jm2",crew:["u_rj"]});
d.jobs.push({id:"jm2",title:"Walk",date:"2026-06-16",crew:["u_rj"],materials:[{id:"m3",amount:200}],expenses:[]});
var after=finPeriodPL("2026-06").net;
T("#2 pass-through at cost is net-neutral to profit (net unchanged by +$200 rev / +$200 material)", after===before);

diag("review-fixes: #2 done");
