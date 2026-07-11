window.alert=function(){};window.confirm=function(){return true;};
var us=[{id:"u_rj",username:"Rj",name:"Rj",active:true},{id:"u_drv",username:"Drv",name:"Drv",active:true}];
S.users=S.users||[]; us.forEach(u=>{if(!S.users.some(x=>x&&x.id===u.id))S.users.push(u);});
if(typeof orgSetRole==="function"){orgSetRole("u_rj","obx","owner");orgSetRole("u_drv","obx","crew");}
localStorage.setItem("jra_session","u_rj");localStorage.setItem("jra_offline_ok","1");S.biz="obx";
var d=D();
d.inventory=[{id:"veh1",cat:"vehicle",clockIn:true,active:true,ownerId:"u_rj",name:"F-150",plate:"LCW-4430",updatedAt:1}];
// a confirmed drive crediting owner Rj: 100 mi * 0.725 = $72.50
d.timeclock=[{id:"tc1",userId:"u_drv",vehicleOwnerId:"u_rj",miles:100,rate:0.725,clockIn:"2026-06-10T08:00:00",clockOut:"2026-06-10T16:00:00",milesConfirmed:true,jobId:"jX",updatedAt:1}];
d.receipts=[]; d.expenses=[]; d.jobs=[{id:"jX",title:"Job X",crew:["u_drv"],updatedAt:1}];
var RATE=0.725;
function T(n,c){ if(c)diag("✓ "+n); else __errs.push("FUEL FAIL: "+n); }

// baseline: no fuel → full mileage
var m0=finMileage(d.timeclock,{confirmedOnly:true});
T("baseline mileage = full $72.50 for Rj", m0.perMember["u_rj"]===7250);

// business-card fuel $40 tagged to veh1 → offsets Rj
d.receipts.push({id:"f1",status:"review",receiptId:"f1",category:"fuel",vehicleId:"veh1",paidBy:"",amount:40,date:"2026-06-11",updatedAt:1});
var off=rcptFuelOffsetByOwner({});
T("offset helper: Rj owes 4000 cents business fuel", off["u_rj"]===4000);
var m1=finMileage(d.timeclock,{confirmedOnly:true});
T("mileage net of business fuel: 7250-4000=3250", m1.perMember["u_rj"]===3250);
T("fuelOffset detail reported (4000)", m1.fuelOffset && m1.fuelOffset["u_rj"]===4000);

// personal-card fuel (paidBy set) → NOT offset
d.receipts.push({id:"f2",status:"review",receiptId:"f2",category:"fuel",vehicleId:"veh1",paidBy:"u_drv",amount:25,date:"2026-06-11",updatedAt:1});
T("personal-card fuel NOT counted (still 4000)", rcptFuelOffsetByOwner({})["u_rj"]===4000);

// fuel with NO vehicle tag → NOT offset
d.receipts.push({id:"f3",status:"review",receiptId:"f3",category:"fuel",paidBy:"",amount:15,date:"2026-06-11",updatedAt:1});
T("untagged fuel NOT counted (still 4000)", rcptFuelOffsetByOwner({})["u_rj"]===4000);

// non-fuel business receipt tagged → NOT offset
d.receipts.push({id:"f4",status:"review",receiptId:"f4",category:"materials",vehicleId:"veh1",paidBy:"",amount:99,date:"2026-06-11",updatedAt:1});
T("non-fuel NOT counted (still 4000)", rcptFuelOffsetByOwner({})["u_rj"]===4000);

// date range respected
T("offset respects from/to (June only)", rcptFuelOffsetByOwner({from:"2026-06-01",to:"2026-06-30"})["u_rj"]===4000);
T("offset excludes out-of-range fuel", (rcptFuelOffsetByOwner({from:"2026-07-01",to:"2026-07-31"})["u_rj"]||0)===0);

// FLOOR at 0: bump business fuel to $100 (> $72.50 mileage) → net 0, never negative
d.receipts.push({id:"f5",status:"review",receiptId:"f5",category:"fuel",vehicleId:"veh1",paidBy:"",amount:60,date:"2026-06-12",updatedAt:1});
var m2=finMileage(d.timeclock,{confirmedOnly:true});
T("business fuel > mileage → floors at 0 (not negative)", m2.perMember["u_rj"]===0);
T("floor applied only the $72.50, not the full $100", m2.fuelOffset["u_rj"]===7250);

// opt-out returns raw
var mRaw=finMileage(d.timeclock,{confirmedOnly:true,fuelOffset:false});
T("fuelOffset:false → raw mileage 7250", mRaw.perMember["u_rj"]===7250);

// vehicleId persists through the pure edit op
var loc={store:"review",jobId:null,recId:"f1"};
var res=rcptApplyEdit(loc,{type:"business",category:"fuel",amount:40,vendor:"Shell",vehicleId:"veh1",paidBy:null,receiptId:"f1"});
var filed=(d.expenses||[]).find(x=>x&&x.receiptId==="f1");
T("vehicleId persists onto the filed business fuel record", filed && filed.vehicleId==="veh1");
diag("fuel done");
