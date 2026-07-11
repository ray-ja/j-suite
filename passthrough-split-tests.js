window.alert=function(){};window.confirm=function(){return true;};
S.users=S.users||[]; if(!S.users.some(x=>x&&x.id==="u_rj"))S.users.push({id:"u_rj",username:"Rj",name:"Rj",active:true});
if(typeof orgSetRole==="function")orgSetRole("u_rj","obx","owner");
localStorage.setItem("jra_session","u_rj");localStorage.setItem("jra_offline_ok","1");S.biz="obx";
var d=D();
// Job with $400 pass-through materials (job.materials), billed customer $1000 total.
d.jobs=[{id:"jP",title:"Paver patio",crew:["u_rj"],materials:[{id:"m1",amount:250,receiptId:"r1"},{id:"m2",amount:150,receiptId:"r2"}],expenses:[],updatedAt:1}];
d.customers=[]; d.receipts=[]; d.timeclock=[]; d.income=[];
function T(n,c){ if(c)diag("✓ "+n); else __errs.push("PT FAIL: "+n); }
function approx(a,b){ return Math.abs(a-b)<=1; }

// pass-through helper reads the job's materials
T("finPassThroughForIncome = $400 (40000 cents)", finPassThroughForIncome({jobId:"jP"})===40000);
T("no-job income → 0 pass-through", finPassThroughForIncome({})===0);

// $1000 income linked to jP → split base should be $600 (1000-400)
var inc={id:"i1",jobId:"jP",amount:1000,crew:["u_rj"],date:"2026-06-01"};
var js=finJobSplit(inc);
T("gross recorded = 100000c", js.gross===100000);
T("passThrough recorded = 40000c", js.passThrough===40000);
T("split base amount = 60000c (net of materials)", js.amount===60000);
T("tax = 25% of 600 = 15000c", js.tax===15000);
T("business = 15% of 600 = 9000c", js.business===9000);
T("labor = 60% of 600 = 36000c", js.labor===36000);
T("tax+business+labor reconciles to base", js.tax+js.business+js.labor===js.amount);

// compare to the OLD behavior (gross split) via _noPT opt-out
var jsGross=finJobSplit(Object.assign({_noPT:true},inc));
T("_noPT opt-out splits on full 100000c", jsGross.amount===100000 && jsGross.labor===60000);
T("fix moved $24000c (40k×60%) OUT of the labor pool", jsGross.labor - js.labor === 24000);

// job with no materials → unchanged (splits on gross)
d.jobs.push({id:"jL",title:"Labor only",crew:["u_rj"],materials:[],updatedAt:1});
var jsL=finJobSplit({id:"i2",jobId:"jL",amount:500,crew:["u_rj"],date:"2026-06-01"});
T("no-materials job splits on full amount (50000c base)", jsL.amount===50000 && jsL.passThrough===0);

// rollup totals: gross vs net vs passThrough
d.income=[inc];
var roll=finRollup(incomeWithWeights ? incomeWithWeights(d.income) : d.income, {});
T("rollup totals.gross = 100000c", roll.totals.gross===100000);
T("rollup totals.passThrough = 40000c", roll.totals.passThrough===40000);
T("rollup totals.amount (split base) = 60000c", roll.totals.amount===60000);
T("rollup tax+business+labor = base", roll.totals.tax+roll.totals.business+roll.totals.labor===roll.totals.amount);

// materials cost MORE than the invoice → base floors at 0, never negative
var jsHuge=finJobSplit({id:"i3",jobId:"jP",amount:300,crew:["u_rj"],date:"2026-06-01"});  // $300 invoice, $400 materials
T("materials > invoice → base floors at 0", jsHuge.amount===0 && jsHuge.passThrough===30000);
diag("pt done");
