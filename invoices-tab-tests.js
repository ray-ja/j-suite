window.alert=function(){};
S.users=S.users||[]; if(!S.users.some(x=>x&&x.id==="u_rj"))S.users.push({id:"u_rj",username:"Rj",name:"Rj",active:true});
if(typeof orgSetRole==="function")orgSetRole("u_rj","obx","owner");
localStorage.setItem("jra_session","u_rj");localStorage.setItem("jra_offline_ok","1");S.biz="obx";
var d=D();
d.customers=[{id:"c1",name:"Mike Green"}];
d.quotes=[
 {id:"qR",customerId:"c1",title:"Patio",total:1000,accepted:true,jobId:"jR",items:[{name:"Patio",price:1000,qty:1}]},          // done job, not invoiced → READY
 {id:"qP",customerId:"c1",title:"Cleanup",total:500,accepted:true,jobId:"jP",items:[{name:"Cleanup",price:500,qty:1}]},         // in progress
 {id:"qA",customerId:"c1",title:"Tree",total:800,invoiced:true,jobId:"jA",paymentLink:"https://buy.stripe.com/x",items:[{name:"Tree",price:800,qty:1}]},  // awaiting
 {id:"qD",customerId:"c1",title:"Shed",total:600,paid:true,paidDate:"2026-07-01",jobId:"jD",items:[{name:"Shed",price:600,qty:1}]}                        // paid
];
d.jobs=[{id:"jR",quoteId:"qR",done:true},{id:"jP",quoteId:"qP",done:false},{id:"jA",quoteId:"qA",done:true},{id:"jD",quoteId:"qD",done:true}];
TAB="invoices"; render();
var v=document.getElementById("view").innerHTML;
function T(n,c){ if(c)diag("✓ "+n); else __errs.push("INV FAIL: "+n); }
T("Invoices tab renders", v.indexOf("🧾 Invoices")>=0);
T("Ready-to-invoice shows the DONE job (Patio) with Create button", v.indexOf("Ready to invoice")>=0 && v.indexOf("Patio")>=0 && v.indexOf("invMark('qR')")>=0);
T("In-progress shows the not-done job (Cleanup)", v.indexOf("In progress")>=0 && v.indexOf("Cleanup")>=0);
T("Awaiting payment shows invoiced-unpaid (Tree) + A/R", v.indexOf("Awaiting payment")>=0 && v.indexOf("Tree")>=0);
T("A/R total = $800 owed", v.indexOf("$800 owed")>=0);
T("Paid section shows the paid job (Shed)", v.indexOf("Shed")>=0);
T("payment-link flag shown on Tree row", v.indexOf("💳 pay link")>=0);
// open the invoice with a stripe link → pay-online button present
openInvoice("qA");
var mv=document.getElementById("view").innerHTML + (document.querySelector(".modal")?document.querySelector(".modal").innerHTML:"");
T("invoice modal shows Pay-online link", (document.body.innerHTML.indexOf("Pay online")>=0));
diag("inv done");
