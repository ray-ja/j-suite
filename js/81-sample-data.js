/* ---------- SAMPLE DATA — owner-only "play with the org tools before real data" ----------
   The new org tools (escape scheduler, life tracker, budget, booking) are OPT-IN per org. Once an owner
   enables them on an org, this module lets them LOAD obvious SAMPLE records into the enabled tools so they
   can see how each works — then CLEAR them surgically, removing ONLY sample records, never real data.

   SAFETY MODEL
   - Every sample record carries `sample:true` and obvious "SAMPLE —" naming.
   - Records are written into the ACTIVE org's slab only (D() = S[S.biz]) → never bleeds across orgs.
   - LOAD is idempotent: it uses STABLE per-org ids, so re-loading resurrects/refreshes the same records
     (dedupe via LWW) instead of piling up duplicates.
   - CLEAR is a soft-delete (deleted:true + touch) of exactly the records where sample===true — it rides the
     existing per-record last-write-wins sync path, so a clear propagates safely to every device and can
     never drop a real record.
   - Only tools the org has ENABLED get sample data (orgHasTab) — loading into a bookings org won't touch
     the life/budget collections, and vice-versa. Booking (js/77) is stateless scaffolding → nothing to seed.

   Visibility: the Load/Clear controls live on an Admin → "Sample data" card (owner-only). The discoverability
   hint (orgOptinHint) is owner-facing and points to Admin → Tools when an org has opt-in tools available but
   none enabled — that's why Ray "couldn't see the stuff". */

/* ---- which opt-in tools, with the collections each owns ---- */
var SAMPLE_TOOLS = [
  { tab:"escape", label:"Room scheduler", icon:"🚪", cols:["escapeRooms","escapeBookings"] },
  { tab:"life",   label:"Life tracker",   icon:"🌱", cols:["lifeTrackers","lifeNotes","lifeLogs"] },
  { tab:"budget", label:"Budget",         icon:"💵", cols:["budgetCats","budgetTx","budgetAccounts","budgetBudgets"] },
  { tab:"booking",label:"Booking",        icon:"🎟️", cols:[] }   // stateless scaffold — nothing to seed
];

/* a tool is seedable here if the active org has it ENABLED *and* it owns at least one synced collection */
function sampleSeedableTools(){
  return SAMPLE_TOOLS.filter(function(t){
    return t.cols.length && (typeof orgHasTab!=="function" || orgHasTab(t.tab));
  });
}
/* every record this module would write/clear carries sample:true; ids are stable + org-scoped */
function sampleId(kind,suffix){ return "sample-"+kind+"-"+S.biz+"-"+suffix; }
function sampleMark(rec){ rec.sample=true; rec.deleted=false; if(typeof touch==="function")touch(rec); else rec.updatedAt=now(); return rec; }
/* upsert a sample record into d[col] by stable id (resurrects a previously-cleared one instead of duplicating) */
function sampleUpsert(d,col,rec){
  if(!Array.isArray(d[col]))d[col]=[];
  var ex=d[col].find(function(x){return x&&x.id===rec.id;});
  if(ex){ Object.keys(rec).forEach(function(k){ ex[k]=rec[k]; }); sampleMark(ex); }
  else { sampleMark(rec); d[col].push(rec); }
}
/* count of live (non-deleted) sample records across this org's seedable tools */
function sampleCount(){
  var d=D(), n=0;
  sampleSeedableTools().forEach(function(t){ t.cols.forEach(function(col){
    (d[col]||[]).forEach(function(r){ if(r&&r.sample&&!r.deleted)n++; });
  }); });
  return n;
}

/* ---- date helpers (local sample data centered on "today"/"this month") ---- */
function sampleDayShift(n){
  var d=new Date((typeof today==="function"?today():new Date().toISOString().slice(0,10))+"T12:00:00");
  d.setDate(d.getDate()+n);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function sampleThisMonth(){ return (typeof today==="function"?today():new Date().toISOString().slice(0,10)).slice(0,7); }

/* ---------- LOAD ---------- */
window.sampleLoadOrgData=function(){
  if(typeof isOwner==="function" && !isOwner()){ alert("Loading sample data is owner-only."); return; }
  var tools=sampleSeedableTools();
  if(!tools.length){ alert("No sample-able tools are enabled for this organization yet.\n\nEnable one in Admin → Tools (e.g. the Room scheduler, Life tracker, or Budget) first, then load sample data."); return; }
  var names=tools.map(function(t){return t.icon+" "+t.label;}).join(", ");
  if(!confirm("Load clearly-marked SAMPLE data into: "+names+"?\n\nEvery record is tagged “SAMPLE —” and can be removed with one tap (Clear sample data). Your real data is untouched.")) return;
  var d=D();
  tools.forEach(function(t){
    if(t.tab==="escape")sampleSeedEscape(d);
    else if(t.tab==="life")sampleSeedLife(d);
    else if(t.tab==="budget")sampleSeedBudget(d);
  });
  save();
  if(typeof scheduleAutoPush==="function")scheduleAutoPush();
  if(typeof closeModal==="function")closeModal();
  if(typeof render==="function")render();
  alert("Loaded sample data into "+tools.length+" tool"+(tools.length===1?"":"s")+". Open them from the nav to look around — then Clear sample data when you're done.");
};

/* room scheduler: 2 sample rooms + a day of bookings (today) across a few slots */
function sampleSeedEscape(d){
  var slots=(typeof escSlots==="function")?escSlots():["10:00","11:30","13:00","14:30","16:00"];
  var date=(typeof today==="function")?today():sampleDayShift(0);
  var rooms=[
    { id:sampleId("erm","heist"),  name:"SAMPLE — The Heist",     color:"#1B2A4E", order:0 },
    { id:sampleId("erm","cabin"),  name:"SAMPLE — Cabin Mystery", color:"#0099e5", order:1 }
  ];
  rooms.forEach(function(r){ sampleUpsert(d,"escapeRooms",r); });
  /* a handful of bookings on today's board — varied statuses so the board looks alive */
  var seeds=[
    { room:rooms[0].id, si:0, status:"done",        party:"SAMPLE — Miller party",  players:"6" },
    { room:rooms[0].id, si:1, status:"in-progress", party:"SAMPLE — Office team",    players:"8" },
    { room:rooms[0].id, si:2, status:"booked",      party:"SAMPLE — Walk-in",        players:"4" },
    { room:rooms[1].id, si:1, status:"booked",      party:"SAMPLE — Birthday group", players:"10" },
    { room:rooms[1].id, si:3, status:"blocked",     party:"SAMPLE — Maintenance",    players:"" }
  ];
  seeds.forEach(function(s,i){
    var slot=slots[s.si]||slots[slots.length-1]||"10:00";
    sampleUpsert(d,"escapeBookings",{
      id:sampleId("ebk",i+1), roomId:s.room, date:date, slot:slot, offSlot:false,
      status:s.status, party:s.party, players:s.players, guideId:"", note:"sample booking"
    });
  });
}

/* life tracker: 2 trackers (a habit + a number) with a few days of logs, plus a couple journal notes */
function sampleSeedLife(d){
  var trackers=[
    { id:sampleId("trk","workout"), name:"SAMPLE — Workout",  type:"check",  unit:"",   order:0 },
    { id:sampleId("trk","water"),   name:"SAMPLE — Water",    type:"number", unit:"oz", order:1 }
  ];
  trackers.forEach(function(t){ sampleUpsert(d,"lifeTrackers",t); });
  /* last 5 days of logs: habit ticked, water logged */
  for(var k=0;k<5;k++){
    var ds=sampleDayShift(-k);
    sampleUpsert(d,"lifeLogs",{ id:sampleId("log","workout-"+k), trackerId:trackers[0].id, date:ds, value:true });
    sampleUpsert(d,"lifeLogs",{ id:sampleId("log","water-"+k),   trackerId:trackers[1].id, date:ds, value:48+k*8 });
  }
  sampleUpsert(d,"lifeNotes",{ id:sampleId("note","1"), date:sampleDayShift(0),  title:"SAMPLE — Good day",   body:"This is a sample journal entry. Felt productive — wrote the plan, took a walk. (Sample data — clear it anytime.)" });
  sampleUpsert(d,"lifeNotes",{ id:sampleId("note","2"), date:sampleDayShift(-2), title:"SAMPLE — Slow start", body:"Another sample entry from a couple days ago. Slept in, caught up later." });
}

/* budget: income + spending categories with monthly targets, and a month of transactions — all in the
   default Personal book (created on load by migrateBudgetBooks; we tag the sample cats/tx with its id) */
function sampleSeedBudget(d){
  var bookId="bgt-book-default-"+S.biz;
  if(typeof migrateBudgetBooks==="function")migrateBudgetBooks(d,S.biz);   // ensure the default Personal book exists
  var cats=[
    { id:sampleId("cat","pay"),    name:"SAMPLE — Paycheck",  kind:"in",  target:3200, order:0 },
    { id:sampleId("cat","side"),   name:"SAMPLE — Side work", kind:"in",  target:400,  order:1 },
    { id:sampleId("cat","rent"),   name:"SAMPLE — Rent",      kind:"out", target:1200, order:2 },
    { id:sampleId("cat","food"),   name:"SAMPLE — Groceries", kind:"out", target:500,  order:3 },
    { id:sampleId("cat","gas"),    name:"SAMPLE — Gas",       kind:"out", target:160,  order:4 }
  ];
  cats.forEach(function(c){ c.bookId=bookId; sampleUpsert(d,"budgetCats",c); });
  var m=sampleThisMonth();
  function dm(day){ return m+"-"+String(day).padStart(2,"0"); }
  var txs=[
    { cat:cats[0].id, dir:"in",  amount:3200, date:dm(1),  note:"SAMPLE — monthly pay" },
    { cat:cats[1].id, dir:"in",  amount:225,  date:dm(12), note:"SAMPLE — odd job" },
    { cat:cats[2].id, dir:"out", amount:1200, date:dm(1),  note:"SAMPLE — rent" },
    { cat:cats[3].id, dir:"out", amount:96.4, date:dm(4),  note:"SAMPLE — groceries" },
    { cat:cats[3].id, dir:"out", amount:71.2, date:dm(14), note:"SAMPLE — groceries" },
    { cat:cats[4].id, dir:"out", amount:52.3, date:dm(7),  note:"SAMPLE — fill-up" },
    { cat:cats[4].id, dir:"out", amount:48.1, date:dm(20), note:"SAMPLE — fill-up" }
  ];
  txs.forEach(function(t,i){
    sampleUpsert(d,"budgetTx",{ id:sampleId("tx",i+1), date:t.date, amount:t.amount, catId:t.cat, dir:t.dir, note:t.note, bookId:bookId });
  });
  /* P1: a sample CHECKING account (real cash) + a couple envelope allocations so the YNAB Month view
     demos out of the box — cash present, a few envelopes funded, TBB shows money still to assign */
  sampleUpsert(d,"budgetAccounts",{ id:sampleId("acct","chk"), bookId:bookId, name:"SAMPLE — Checking", type:"checking", balance:2600, mask:"0000", order:0 });
  var allocs=[
    { cat:cats[2].id, amount:1200 },   // Rent — funded to goal
    { cat:cats[3].id, amount:500  },   // Groceries — funded to goal
    { cat:cats[4].id, amount:160  }    // Gas — funded to goal
  ];
  allocs.forEach(function(a,i){
    sampleUpsert(d,"budgetBudgets",{ id:sampleId("alloc",i+1), bookId:bookId, catId:a.cat, month:m, allocated:a.amount });
  });
  /* budget v2 (credit + debt): a CARD HE USES (Visa) with a charge on it, its auto Payment envelope, plus a
     DEBT-ONLY card so the Debts tab + snowball/avalanche demo out of the box. */
  var visaId=sampleId("acct","visa");
  sampleUpsert(d,"budgetAccounts",{ id:visaId, bookId:bookId, name:"SAMPLE — Visa", type:"credit", balance:-120, apr:22.99, minPayment:35, creditLimit:5000, debtOnly:false, mask:"4242", order:3 });
  sampleUpsert(d,"budgetAccounts",{ id:sampleId("acct","store"), bookId:bookId, name:"SAMPLE — Store Card", type:"credit", balance:-1450, apr:27.99, minPayment:45, creditLimit:2000, debtOnly:true, order:4 });
  /* the active card's auto-managed Payment envelope (stable id keyed off the card account id) */
  sampleUpsert(d,"budgetCats",{ id:"bgt-cat-cardpay-"+visaId, name:"Payment: SAMPLE — Visa", kind:"out", rollover:true, paymentEnvelope:true, creditAccountId:visaId, bookId:bookId, order:-2 });
  /* a $64 grocery charge ON the Visa (Groceries envelope is funded → it funds the Payment: Visa envelope) */
  sampleUpsert(d,"budgetTx",{ id:sampleId("tx","cc1"), date:dm(16), amount:64, catId:cats[3].id, dir:"out", accountId:visaId, note:"SAMPLE — groceries on Visa", bookId:bookId });
  /* P2 (tax): a sample BUSINESS book with a month of 1099 income + heavy expenses so the Tax tab demos a
     real (low) effective reserve rate out of the box. One taxpayer → this net drives the tax estimate. */
  var bizBook=sampleId("book","biz");
  sampleUpsert(d,"budgetBooks",{ id:bizBook, name:"SAMPLE — Side business", kind:"business", color:"#0099e5", order:1 });
  var bcats=[
    { id:sampleId("cat","bizinc"), name:"SAMPLE — Contract income", kind:"in",  bookId:bizBook, order:0 },
    { id:sampleId("cat","bizexp"), name:"SAMPLE — Business expenses",kind:"out", bookId:bizBook, order:1 }
  ];
  bcats.forEach(function(c){ sampleUpsert(d,"budgetCats",c); });
  var btx=[
    { cat:bcats[0].id, dir:"in",  amount:6000, date:dm(2),  note:"SAMPLE — 1099 job" },
    { cat:bcats[1].id, dir:"out", amount:3300, date:dm(5),  note:"SAMPLE — materials/fuel/disposal" }
  ];
  btx.forEach(function(t,i){
    sampleUpsert(d,"budgetTx",{ id:sampleId("biztx",i+1), date:t.date, amount:t.amount, catId:t.cat, dir:t.dir, note:t.note, bookId:bizBook });
  });
}

/* ---------- CLEAR — soft-delete ONLY sample:true records (never real data) ---------- */
window.sampleClearOrgData=function(){
  if(typeof isOwner==="function" && !isOwner()){ alert("Clearing sample data is owner-only."); return; }
  var n=sampleCount();
  if(!n){ alert("No sample records to clear in this organization."); return; }
  if(!confirm("Remove all "+n+" SAMPLE record"+(n===1?"":"s")+" from this organization?\n\nOnly records tagged sample are removed — your real data is untouched.")) return;
  var d=D(), removed=0;
  /* sweep EVERY sample-owning collection (not just currently-enabled tools), so disabling a tool then
     clearing still cleans up its sample records. */
  var allCols={};
  SAMPLE_TOOLS.forEach(function(t){ t.cols.forEach(function(c){ allCols[c]=1; }); });
  Object.keys(allCols).forEach(function(col){
    (d[col]||[]).forEach(function(r){
      if(r && r.sample && !r.deleted){ r.deleted=true; if(typeof touch==="function")touch(r); else r.updatedAt=now(); removed++; }
    });
  });
  save();
  if(typeof scheduleAutoPush==="function")scheduleAutoPush();
  if(typeof closeModal==="function")closeModal();
  if(typeof render==="function")render();
  alert("Cleared "+removed+" sample record"+(removed===1?"":"s")+".");
};

/* ---------- Admin → "Sample data" card (owner-only) ---------- */
function sampleDataCard(){
  if(typeof isOwner==="function" && !isOwner()) return "";
  var tools=sampleSeedableTools();
  var live=sampleCount();
  var here=(typeof orgName==="function")?orgName(S.biz):S.biz;
  var h='<div class="card" style="margin-top:8px;border-left:3px solid #d98a00" id="sampledata-card">'
    +'<div class="nm" style="font-size:15px">🧪 Sample data</div>'
    +'<div class="sub" style="margin-bottom:8px">Play with the enabled tools using obvious, clearly-marked “SAMPLE —” records before you enter anything real. Loads into <b>'+esc(here)+'</b> only; clearing removes only the sample records — never your real data.</div>';
  if(!tools.length){
    h+='<div class="sub" style="margin-bottom:8px">No sample-able tools are enabled here yet. Turn one on in <b>Tools</b> above (Room scheduler, Life tracker, or Budget), then come back.</div>';
  }else{
    h+='<div class="sub" style="margin-bottom:8px">Enabled tools that get sample data: '+tools.map(function(t){return t.icon+" "+esc(t.label);}).join(" · ")+'.</div>';
  }
  if(live)h+='<div class="sub" style="margin-bottom:8px;color:#d98a00;font-weight:600">'+live+' sample record'+(live===1?"":"s")+' currently loaded.</div>';
  h+='<div class="row" style="gap:8px">'
    +'<button class="btn acc" style="flex:1"'+(tools.length?"":" disabled")+' onclick="sampleLoadOrgData()">Load sample data</button>'
    +'<button class="btn ghost" style="flex:1"'+(live?"":" disabled")+' onclick="sampleClearOrgData()">Clear sample data</button>'
    +'</div></div>';
  return h;
}

/* ---------- DISCOVERABILITY HINT (owner-facing) ----------
   Shown on Today when the active org has opt-in tools AVAILABLE but none enabled — the reason Ray
   "couldn't see the stuff". Points him at Admin → Tools. Dismissible per browser. Never weakens the
   opt-in isolation: it only nudges; the owner still has to enable tools in Admin → Tools. */
function orgOptinAvailable(){
  /* opt-in tools that are NOT currently enabled for this org */
  if(typeof ORG_OPTIN_TABS==="undefined") return [];
  return ORG_OPTIN_TABS.filter(function(tab){ return (typeof orgHasTab!=="function") ? false : !orgHasTab(tab); });
}
function orgAnyOptinEnabled(){
  if(typeof ORG_OPTIN_TABS==="undefined") return false;
  return ORG_OPTIN_TABS.some(function(tab){ return (typeof orgHasTab==="function") && orgHasTab(tab); });
}
function orgOptinHintDismissed(){
  try{ return sessionStorage.getItem("jra_optin_hint_"+S.biz)==="1"; }catch(e){ return false; }
}
window.orgOptinHintDismiss=function(){
  try{ sessionStorage.setItem("jra_optin_hint_"+S.biz,"1"); }catch(e){}
  if(typeof render==="function")render();
};
window.orgOptinGoTools=function(){
  if(typeof navSub==="function" && (typeof canSee!=="function" || canSee("admin"))){ navSub("admin"); }
  else if(typeof alert==="function"){ alert("Open Admin → Tools to enable the opt-in tools."); }
};
/* returns the hint HTML (or "") — called from rToday for an owner */
function orgOptinHint(){
  if(typeof isOwner!=="function" || !isOwner()) return "";
  /* only nudge when there's something to turn on AND nothing opt-in is enabled yet (don't nag once they've started) */
  var avail=orgOptinAvailable();
  if(!avail.length || orgAnyOptinEnabled() || orgOptinHintDismissed()) return "";
  var meta=(typeof TAB_META!=="undefined")?TAB_META:{};
  var names=avail.map(function(t){ var m=meta[t]||{}; return (m.i||"")+" "+esc(m.l||t); }).join(", ");
  return '<div class="card" style="border-left:4px solid var(--acc);background:var(--soft)">'
    +'<div class="row" style="align-items:flex-start"><div class="grow">'
    +'<div class="nm" style="font-size:15px">🧩 More tools available for this org</div>'
    +'<div class="sub" style="white-space:normal;margin-top:2px">This organization can turn on opt-in tools that are hidden by default: '+names+'. '
    +'They stay off until you enable them in <b>Admin → Tools</b> — then use <b>Admin → Sample data</b> to try them with example records.</div>'
    +'</div><button class="btn ghost sm" style="flex:0 0 auto" onclick="orgOptinHintDismiss()" title="Dismiss">✕</button></div>'
    +'<button class="btn acc" style="width:100%;margin-top:8px" onclick="orgOptinGoTools()">Open Admin → Tools</button>'
    +'</div>';
}
