/* ---------- routing ---------- */
let TAB="today";
const view=document.getElementById("view");
/* ---------- RETURN-TO-ORIGIN (nav-return) — the generalized JOB_RETURN_TAB pattern ----------
   Most detail views FLOAT in a modal, so closeModal()+render() naturally lands you back on the tab you were on.
   But a few TAKE OVER a whole tab: the crew job page (js/61, hosted inside the Schedule tab) and the quote
   wizard (js/23, hosted inside the Quotes tab). When you reach one of those from a DIFFERENT list — a job
   closeout tapped from Receipts, or a quote tapped from the Jobs table — a delete / close / save-complete used
   to dump you on the HOST tab (Schedule / Quotes) instead of the list you came from. navRecordOrigin(host)
   snapshots the current TAB the moment such a view opens (keyed by the host tab it takes over); navReturn(host,
   fallback) restores that origin (falling back to a safe default, never crashing or blanking). This is the same
   idea the job page has shipped as JOB_RETURN_TAB since aaebcd5 — generalized so every take-over subpage reuses
   one mechanism instead of each re-hardcoding a default destination. */
window.NAV_ORIGIN = window.NAV_ORIGIN || {};
window.navRecordOrigin = function(host){
  try{ var cur = (typeof TAB!=="undefined") ? TAB : null; window.NAV_ORIGIN[host] = (cur && cur!==host) ? cur : null; }
  catch(_e){ window.NAV_ORIGIN[host] = null; }
  return window.NAV_ORIGIN[host];   // opening from WITHIN the host tab records null → navReturn uses the fallback
};
window.navOriginFor = function(host){ try{ return (window.NAV_ORIGIN && window.NAV_ORIGIN[host]) || null; }catch(_e){ return null; } };
window.navClearOrigin = function(host){ try{ if(window.NAV_ORIGIN) window.NAV_ORIGIN[host] = null; }catch(_e){} };
window.navReturn = function(host, fallback){
  var dest = window.navOriginFor(host);
  window.navClearOrigin(host);
  try{ if(typeof TAB!=="undefined") TAB = dest || fallback || TAB; }catch(_e){}
  if(typeof render==="function") render();
};
// Authoritative set of routable screen keys — the SAME keys render() dispatches on (below). Any deep-link or
// notification-driven tab MUST be validated against this so a bad/old value can't route into nothing. Kept next
// to the dispatch so the two can't drift.
const ROUTE_TABS=["today","accounts","quotes","jobs","leads","recurring","schedule","messages","map","route","routes","todo","plan","training","market","opps","sites","buildplan","inventory","resale","time","pay","nextcheck","finance","invoices","receipts","data","approvals","admin","playbook","research","escape","booking","life","journal","shelf","budget","team"];
/* Is `t` a real, currently-accessible screen? Used to sanitize tabs that arrive from OUTSIDE the app (a ?tab=
   deep link, or the SW's {type:"navigate"} postMessage on a notification click). A notification sent on an OLD
   build can carry a tab that no longer exists — routing to it must never blank the app. Returns true only when
   the tab is a known route AND (if access-gating is loaded) visible to this user/org. */
function validTab(t){
  if(!t || ROUTE_TABS.indexOf(t)<0) return false;
  if(typeof canSee==="function"){ try{ return !!canSee(t); }catch(e){ return true; } }
  return true;
}
window.validTab=validTab;
function setBiz(b){S.biz=b;save();document.body.dataset.biz=b;
  var logo=(typeof BIZ!=="undefined"&&BIZ[b])?BIZ[b].logo:"";
  var el=document.getElementById("logo");
  // The ORG NAME now lives in the header org switcher (renderOrgSwitcher); the logo shows the image only
  // (or a small generic mark when there's no logo image), so the name isn't printed twice.
  if(el)el.innerHTML=logo?('<img src="'+logo+'" alt="" style="max-height:54px;width:auto;max-width:200px;object-fit:contain;display:block">'):'<div style="font-weight:800;font-size:20px;padding:6px 0">◆</div>';
  if(typeof renderOrgSwitcher==="function")renderOrgSwitcher();
  render()}
/* HEADER org switcher — the active org's NAME next to the logo. A real switcher only when the signed-in
   user belongs to ≥2 orgs (then click → setBiz); a single-org user sees the name as plain text. Owners get
   a "➕ New organization…" choice (the affordance the old profile menu had). */
function renderOrgSwitcher(){
  var box=document.getElementById("orgsw"); if(!box) return;
  var orgs=(typeof myOrgs==="function")?myOrgs():[];
  var canCreate=(typeof isOwner==="function"&&isOwner());
  var b=S.biz, nm=(typeof orgName==="function")?orgName(b):b;
  // single org and no create option → plain text, no dropdown
  if(orgs.length<2 && !canCreate){ box.innerHTML='<span class="orgname">'+esc(nm)+'</span>'; return; }
  box.innerHTML='<select aria-label="Organization" onchange="orgSwitchPick(this.value)">'
    +orgs.map(function(o){return '<option value="'+esc(o.id)+'"'+(b===o.id?" selected":"")+'>'+esc(o.name)+'</option>';}).join("")
    +(canCreate?'<option value="__new__">➕ New organization…</option>':'')
    +'</select>';
}
window.renderOrgSwitcher=renderOrgSwitcher;
window.orgSwitchPick=function(v){
  if(v==="__new__"){ var sel=document.querySelector("#orgsw select"); if(sel)sel.value=S.biz; if(typeof createOrgPrompt==="function")createOrgPrompt(); return; }
  setBiz(v);
};
function render(){
  if(typeof jsResetToken==="function"&&jsResetToken()&&typeof renderResetPw==="function"){   // an emailed ?reset= link always wins, even if already logged in
    document.body.classList.add("signedout");renderResetPw();return;
  }
  var _out=(typeof needLogin==="function"&&needLogin());
  document.body.classList.toggle("signedout",_out);   // CSS hides nav / sync pill / biz selector / FAB / logout → clean login page
  if(_out){renderLogin();return;}
  if(typeof applyAccess==="function")applyAccess();   // role-gate: hide nav + coerce TAB to an allowed page
  if(TAB!=="training")TRMOD=null;
  document.body.classList.toggle("wizon",!!WZON);
  renderNav(); renderSubnav();
  // BLANK-SCREEN GUARD — a blank #view is the cardinal sin (it blanks the tool the owner runs his business on).
  // A screen's render fn can throw on a stale-build device (old cached JS meets new data shape — e.g. the app
  // opened from a push notification that was sent on an OLD build) and, unguarded, leave #view empty → white
  // screen. So: (1) an unknown TAB still falls back to rToday (the || below), and (2) ANY thrown render is caught
  // and retried on Today; if even Today throws we write a minimal, actionable recovery card — the app NEVER
  // shows a white void.
  var _screen=({today:rToday,accounts:rAccounts,quotes:rQuotes,jobs:rQuotes,leads:(typeof rLeads==="function"?rLeads:rToday),recurring:(typeof rRecurring==="function"?rRecurring:rToday),schedule:rSchedule,messages:rMessages,map:rMap,route:rSales,todo:rTodos,plan:rPlan,training:rTraining,market:rMarket,opps:rOpps,sites:rSites,buildplan:rBuildPlan,inventory:rInventory,resale:rResale,time:rTime,pay:(typeof rPay==="function"?rPay:rToday),nextcheck:(typeof rNextCheck==="function"?rNextCheck:rToday),finance:rFinance,invoices:(typeof rInvoices==="function"?rInvoices:rToday),receipts:rReceipts,data:rData,approvals:rApprovals,admin:rAdmin,playbook:rPlaybook,research:(typeof rResearch==="function"?rResearch:rToday),escape:(typeof rEscape==="function"?rEscape:rToday),booking:(typeof rBooking==="function"?rBooking:rToday),life:(typeof rLife==="function"?rLife:rToday),journal:(typeof rJournal==="function"?rJournal:rToday),shelf:(typeof rShelf==="function"?rShelf:rToday),budget:(typeof rBudget==="function"?rBudget:rToday),team:(typeof rTeam==="function"?rTeam:rToday),routes:(typeof rRoutes==="function"?rRoutes:rToday)}[TAB])||rToday;
  try{ _screen(); }
  catch(_e1){
    try{ if(typeof console!=="undefined"&&console.error)console.error("render("+TAB+") threw:",_e1); }catch(_){}
    if(_screen!==rToday){ try{ TAB="today"; rToday(); } catch(_e2){ renderRecovery(_e2); } }   // fall back to Today
    else renderRecovery(_e1);                                                                    // even Today failed
  }
  if(typeof lockCheckAlive==="function")lockCheckAlive();   // release a held lock once its editor stops being shown (navigate-away)
  renderSyncPill();
  if(typeof renderClockPill==="function")renderClockPill();
  if(typeof renderOdoBanner==="function")renderOdoBanner();   // header "enter your odometer" reminder (js/85)
  if(typeof renderOrgSwitcher==="function")renderOrgSwitcher();   // keep the header org name/dropdown in sync with the active org + role
  if(typeof renderViewAsBanner==="function")renderViewAsBanner();   // "Viewing as <role>" tester banner (js/28)
}
/* LAST-RESORT recovery card — the app must ALWAYS show something actionable, never a white void. Written into
   #view when even the Today fallback throws (a badly stale/skewed build). The primary button reuses the existing
   manual SW-clear escape hatch (window.forceUpdate in js/29-boot: unregister SW + purge caches + reload → fresh
   build). No dependency on any other render helper — this must work even when much of the app is broken. */
function renderRecovery(err){
  try{
    var v=document.getElementById("view")||view; if(!v)return;
    var msg=(err&&(err.message||String(err)))||"";
    v.innerHTML=
      '<div style="max-width:520px;margin:40px auto;padding:20px;border:1px solid var(--line,#ddd);border-radius:12px;'
        +'background:var(--card,#fff);color:var(--ink,#111);font:15px system-ui;text-align:center">'
      +'<div style="font-size:34px;line-height:1">🧰</div>'
      +'<div style="font-weight:800;font-size:19px;margin:10px 0 6px">This screen needs a quick refresh</div>'
      +'<div style="opacity:.8;margin-bottom:16px">Your app is running an older version. Tap below to get the latest — your data is safe (this only clears the app cache, never your saved records).</div>'
      +'<button onclick="if(window.forceUpdate){forceUpdate()}else{location.reload()}" '
        +'style="display:block;width:100%;padding:14px;border:0;border-radius:10px;background:#1B2A4E;color:#fff;font:700 16px system-ui;margin-bottom:10px">Get the latest</button>'
      +'<button onclick="try{TAB=\'today\';render()}catch(e){location.reload()}" '
        +'style="display:block;width:100%;padding:12px;border:1px solid var(--line,#ccc);border-radius:10px;background:transparent;color:var(--ink,#111);font:600 15px system-ui">Back to Today</button>'
      +(msg?'<div style="opacity:.5;font-size:11px;margin-top:14px;word-break:break-word">'+((typeof esc==="function")?esc(msg):msg)+'</div>':'')
      +'</div>';
  }catch(_){
    /* Absolute floor: even DOM helpers unavailable → write raw so it's never a white void. */
    try{ (document.getElementById("view")||document.body).innerHTML='<div style="padding:24px;font:16px system-ui">App needs a refresh. <a href="./" onclick="if(window.forceUpdate)forceUpdate()">Tap to get the latest</a>.</div>'; }catch(__){}
  }
}
window.renderRecovery=renderRecovery;
/* ---------- grouped navigation: ~7 top-level groups + a per-group subnav ---------- */
const NAV_GROUPS = [
  { key:"today",     label:"Today",     icon:"🧭", tabs:["today"] },
  { key:"messages",  label:"Messages",  icon:"💬", tabs:["messages"] },
  // People & Places — the crew directory ("team") + the accounts screen (Customers / Properties / 📍 Places /
  // 📞 Call Lead). The GROUP KEY stays "team" so NAV_LAST state + CREW_PAGES ("team"/"accounts") keep working;
  // only the label + tab set changed. renderSubnav() special-cases this group into ONE merged sub-tab row.
  { key:"team",      label:"People & Places", icon:"🧑‍🤝‍🧑", tabs:["team","accounts"] },
  { key:"booking",   label:"Booking",   icon:"🎟️", tabs:["booking"] },
  // WORK — the day-to-day field bucket: 🧾 Jobs table + 📅 Schedule (calendar, hosts the crew job page) + ⏱️ Time
  // (clock-in/out + hours/miles). Ray OK'd folding Jobs in here (2026-07-16) instead of its own top-level menu;
  // this collapses three separate menus (schedule/time/jobsview) into one.
  { key:"work",      label:"Work",      icon:"🔨", tabs:["jobs","schedule","time"] },
  { key:"receipts",  label:"Receipts",  icon:"📸", tabs:["receipts"] },   // OWN top-level tab (crew-visible entry point to snap/upload receipts; page self-gates finance to owner/admin)
  { key:"escape",    label:"Rooms",     icon:"🚪", tabs:["escape"] },
  // Inventory now also carries ♻️ Resale (both are gear/stuff — folded in to trim a top-level menu)
  { key:"inventory", label:"Inventory", icon:"🧰", tabs:["inventory","resale"] },
  { key:"sales",     label:"Sales",     icon:"💼", tabs:["leads","quotes","recurring"] },
  { key:"life",      label:"Life",      icon:"🌱", tabs:["life"] },
  // JOURNAL — its own top-level tab (Ray, 2026-08-02: "journal needs to be its own tab"). It was a sub-tab buried
  // inside Life; the entries are the SAME lifeNotes collection (no new collection, no migration), just promoted so
  // it's one tap away and Cap can be pointed at it.
  { key:"journal",   label:"Journal",   icon:"📓", tabs:["journal"] },
  // SHELF — a personal reference library (books + the ideas that go with them). Reference material he
  // returns to, deliberately NOT a reading to-do list; see js/123.
  { key:"shelf",     label:"Shelf",     icon:"📚", tabs:["shelf"] },
  { key:"budget",    label:"Budget",    icon:"💵", tabs:["budget"] },
  { key:"invoices",  label:"Invoices",  icon:"💳", tabs:["invoices"] },   // OWN top-level menu (Ray: invoices is its own tab, not folded under Money)
  { key:"money",     label:"Money",     icon:"💰", tabs:["nextcheck","finance","pay","routes"] },
  { key:"ref",       label:"Data",      icon:"🗂️", tabs:["playbook","todo","research"] },
  { key:"grow",      label:"Misc",      icon:"🧩", tabs:["plan","market","opps","sites","buildplan","training","map","route"] },
  { key:"admin",     label:"Admin",     icon:"🛡️", tabs:["admin"] },
  { key:"more",      label:"Settings",  icon:"⚙️", tabs:["data"] }
];
const TAB_META = {
  today:{l:"Today",i:"🧭"}, leads:{l:"Leads",i:"📞"}, quotes:{l:"Quotes",i:"🧾"}, recurring:{l:"Recurring",i:"🔁"}, jobs:{l:"Jobs",i:"🧾"}, booking:{l:"Booking",i:"🎟️"}, schedule:{l:"Schedule",i:"📅"}, time:{l:"Time",i:"⏱️"}, map:{l:"Map",i:"🗺️"},
  accounts:{l:"Customers",i:"👥"}, route:{l:"Route",i:"🚗"}, messages:{l:"Messages",i:"💬"},
  pay:{l:"My Pay",i:"💵"}, nextcheck:{l:"Next Check",i:"🧾"}, finance:{l:"Finance",i:"💰"}, receipts:{l:"Receipts",i:"📸"}, invoices:{l:"Invoices",i:"💳"}, approvals:{l:"Approvals",i:"📥"},
  plan:{l:"Plan",i:"📈"}, market:{l:"Market",i:"📊"}, opps:{l:"Opps",i:"💡"}, sites:{l:"Sites",i:"💻"}, buildplan:{l:"Build Plan",i:"🏗️"}, training:{l:"Train",i:"🎓"},
  todo:{l:"To-Do",i:"✅"}, inventory:{l:"Inventory",i:"🧰"}, resale:{l:"Resale",i:"♻️"}, data:{l:"Data",i:"⚙️"}, admin:{l:"Admin",i:"🛡️"}, playbook:{l:"Playbook",i:"📒"}, research:{l:"Research",i:"📚"}, escape:{l:"Rooms",i:"🚪"}, life:{l:"Life",i:"🌱"}, journal:{l:"Journal",i:"📓"}, shelf:{l:"Shelf",i:"📚"}, budget:{l:"Budget",i:"💵"}, team:{l:"Team",i:"🧑‍🤝‍🧑"}, routes:{l:"Routes",i:"🗺️"}
};
let NAV_LAST = {};   // remember the last sub-tab visited per group
// MULTI-ORG (Phase 5): per-org TOOL VISIBILITY. registry[org].tabs = the enabled tab set (null/absent = all → obx/jam unchanged). Core tabs are always on so an org is never left without home/admin/settings.
// `team` (People & Places) is NO LONGER core — a solo personal org has nobody to reach, and forcing the crew
// directory onto it was pure business noise (Ray, 2026-08-02). It stays visible everywhere it was before: orgs on
// the null/"full" default (jam, escaperoom) get it implicitly, and OBX — the one org with an explicit tab list —
// now names it. Only an org that deliberately omits it (personal) loses it.
const ORG_CORE_TABS = ["today","admin","data"];
// OPT-IN tabs: org-specific tools that must be EXPLICITLY enabled per org. They are NEVER part of the
// implicit "all the standard tools" (null tabs → field-services default), so niche tools — the escape-room
// Rooms board + Booking page, and the personal Life tracker — stay out of OBX / Jamieson (which run on the
// null/"full" default) and appear ONLY when an org's registry.tabs explicitly lists them.
const ORG_OPTIN_TABS = ["escape","booking","life","journal","shelf","budget"];
const ORG_TEMPLATES = {
  full: null,                                                                 // field services (OBX / Jamieson) — every standard tool (not the opt-in niche ones)
  bookings: ["escape","booking","messages","schedule","accounts","finance","invoices","receipts","time","playbook"],   // e.g. an escape room — the room board + booking page + customers, calendar, money, comms
  // PERSONAL — a life-management app, not a shrunken business one. Life (habits/trackers) · Journal (its own tab)
  // · Budget · To-Do · Messages (Cap's check-in DMs land here). Deliberately NO jobs/leads/quotes/pay/approvals/
  // recurring/accounts — Ray, 2026-08-02: "none of it belongs on a personal page."
  personal: ["life","journal","shelf","budget","todo","messages"]
};
function orgTabs(){ const r=(S.registry||[]).find(x=>x&&x.id===S.biz); return (r&&Array.isArray(r.tabs))?r.tabs:null; }
// A personal/life org: an explicit tab list WITH life and WITHOUT jobs. Mirrors orgIsPersonal() in sync-server.js
// — keep the two in step. Orgs on the null/"full" default (OBX, Jamieson) are never personal.
function orgIsPersonalOrg(){ const t=orgTabs(); return !!t && t.indexOf("jobs")<0 && t.indexOf("life")>=0; }
// PER-ORG NAV ORDER (admin-controlled): registry[org].navOrder = [groupKey,…]. renderNav applies it; any
// listed-but-unknown key is ignored, and any group NOT listed (incl. a NEW group added later) is appended
// in the default NAV_GROUPS order — so an org with an old/partial navOrder never loses a menu. Unset → default.
function orgNavOrder(){ const r=(S.registry||[]).find(x=>x&&x.id===S.biz); return (r&&Array.isArray(r.navOrder))?r.navOrder:null; }
function navGroupsOrdered(){
  const order=orgNavOrder(); if(!order||!order.length) return NAV_GROUPS;
  const byKey={}; NAV_GROUPS.forEach(g=>byKey[g.key]=g);
  const seen={}, out=[];
  order.forEach(k=>{ if(byKey[k]&&!seen[k]){ seen[k]=1; out.push(byKey[k]); } });   // saved order first (dedup, ignore unknown keys)
  NAV_GROUPS.forEach(g=>{ if(!seen[g.key]) out.push(g); });                          // then any group not listed, in default order (append new groups)
  return out;
}
function orgHasTab(tab){ const t=orgTabs(); if(ORG_CORE_TABS.indexOf(tab)>=0) return true; if(ORG_OPTIN_TABS.indexOf(tab)>=0) return !!t && t.indexOf(tab)>=0; return !t || t.indexOf(tab)>=0; }
function navCanSee(t){ if(t==="messages" && (typeof msgEnabled==="function" ? !msgEnabled() : true)) return false; return (typeof canSee==="function") ? canSee(t) : true; }
function tabGroup(t){ return NAV_GROUPS.find(g=>g.tabs.indexOf(t)>=0) || NAV_GROUPS[0]; }
function groupTabs(g){ return g.tabs.filter(navCanSee); }
function renderNav(){
  const nav=document.querySelector("nav"); if(!nav) return;
  const curKey=tabGroup(TAB).key;
  nav.innerHTML = navGroupsOrdered().map(g=>{
    const tabs=groupTabs(g); if(!tabs.length) return "";
    const badge = g.key==="messages" ? `<span id="msgbadge" style="display:none;background:var(--danger);color:#fff;border-radius:10px;padding:1px 6px;font-size:11px;margin-left:4px"></span>` : "";
    return `<button data-group="${g.key}" class="${g.key===curKey?"on":""}"><span class="ic">${g.icon}</span>${g.label}${badge}</button>`;
  }).join("");
  nav.querySelectorAll("button").forEach(b=>b.onclick=()=>navGroup(b.dataset.group));
  if(typeof updateMsgBadge==="function") updateMsgBadge();
}
function renderSubnav(){
  const el=document.getElementById("subnav"); if(!el) return;
  const g=tabGroup(TAB); NAV_LAST[g.key]=TAB; const tabs=groupTabs(g);
  // People & Places: ONE merged sub-tab row — 👥 People (the crew directory / "team" tab) + the accounts screen's
  // four sub-views (Customers · Properties · 📍 Places · 📞 Call Lead), so Places is a top-level sub-tab here
  // instead of a second, buried subnav. ppSubnav (js/06) emits it and the accounts tab's own acctSubnav() yields
  // to it (returns "" inside this group), so there's exactly one row. Respects role gating via `tabs`.
  if(g.key==="team" && typeof ppSubnav==="function"){ el.innerHTML=ppSubnav(tabs); return; }
  el.innerHTML = (tabs.length>1)
    ? `<div class="subnav">`+tabs.map(t=>`<button class="subbtn ${t===TAB?"on":""}" onclick="navSub('${t}')">${(TAB_META[t]||{}).i||""} ${(TAB_META[t]||{}).l||t}</button>`).join("")+`</div>`
    : "";
}
window.navGroup=function(key){ const g=NAV_GROUPS.find(x=>x.key===key); if(!g) return; const tabs=groupTabs(g); if(!tabs.length) return; TAB=(NAV_LAST[key]&&tabs.indexOf(NAV_LAST[key])>=0)?NAV_LAST[key]:tabs[0]; window.JOB_OPEN=null; if(TAB==="messages"&&typeof msgResetOpen==="function")msgResetOpen(); render(); };
window.navSub=function(t){ NAV_LAST[tabGroup(t).key]=t; TAB=t; window.JOB_OPEN=null; if(t==="messages"&&typeof msgResetOpen==="function")msgResetOpen(); render(); };
document.getElementById("fab").onclick=()=>{
  if(TAB==="quotes"||TAB==="jobs")openQuote();else if(TAB==="schedule")openJob();else if(TAB==="todo")openTodo();else if(TAB==="plan"){if(PLANSUB==="marketing")openMkt();}else if(TAB==="accounts"){ACCTSUB==="properties"?openProperty():openCustomer();}else if(TAB==="inventory")openInvItem();else if(TAB==="resale"){if(typeof openResale==="function")openResale();}else if(TAB==="admin"){if(typeof adminOpenCreate==="function")adminOpenCreate();}else if(TAB==="finance"){if(typeof openIncome==="function")openIncome();}else if(TAB==="escape"){if(typeof escAddOffSlot==="function")escAddOffSlot();}else if(TAB==="life"){if(typeof lifeFabAdd==="function")lifeFabAdd();}else if(TAB==="budget"){if(typeof budgetFabAdd==="function")budgetFabAdd();}else if(TAB==="receipts"){if(typeof rcptPickFiles==="function")rcptPickFiles();}else if(TAB==="team"){if(typeof teamEditMine==="function")teamEditMine();}else if(TAB==="recurring"){if(typeof recurPlanOpen==="function")recurPlanOpen();}else if(TAB==="map"||TAB==="data"||TAB==="route"||TAB==="leads"||TAB==="training"||TAB==="market"||TAB==="opps"||TAB==="sites"||TAB==="time"||TAB==="messages")return;else openCustomer();
};

