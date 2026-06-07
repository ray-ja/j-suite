/* ---------- QUARTERLY MILESTONES + "WHAT CHANGED THIS WEEK" LOG ---------- */
const QUARTERS=["Q2 2026","Q3 2026","Q4 2026","Q1 2027"];
function mstones(){if(!D().milestones)D().milestones=[];return D().milestones;}
function chlog(){if(!D().changelog)D().changelog=[];return D().changelog;}
const CHLOG_CAP=1000;
function _logUser(){const u=(typeof curUser==="function")?curUser():null;return {user:u?u.id:"",userName:u?u.username:""};}
/* structured activity entry — the synced attribution trail (who did what, to which record) */
function logChange(action,entity,entityId,summary){const c=chlog(),who=_logUser();
  c.push({id:uid(),ts:now(),updatedAt:now(),action:action||"update",entity:entity||"",entityId:entityId||"",summary:summary||"",user:who.user,userName:who.userName});
  if(c.length>CHLOG_CAP)c.splice(0,c.length-CHLOG_CAP);}
/* free-text/system note — kept for existing callers; carries attribution + a summary so it shows in Activity */
function logEvent(text,tag){const c=chlog(),who=_logUser();
  c.push({id:uid(),ts:now(),updatedAt:now(),text:text,tag:tag||"note",action:tag||"note",entity:"note",entityId:"",summary:text,user:who.user,userName:who.userName});
  if(c.length>CHLOG_CAP)c.splice(0,c.length-CHLOG_CAP);}
const MSEED={
 obx:[["Q2 2026","Launch both websites on Netlify — real phone number + a few real reviews",""],["Q2 2026","Lock 5 recurring home-watch accounts",""],["Q2 2026","Get 10 Google reviews live",""],
  ["Q3 2026","20 active recurring accounts (wash + watch)",""],["Q3 2026","Buy a used utility trailer; add lot-clearing as a service",""],["Q3 2026","Hit $6k/mo revenue",""],
  ["Q4 2026","Hand Pierce & Chase a repeatable weekly route",""],["Q4 2026","Add dump-trailer capacity for junk & storm work",""],["Q4 2026","Storm-season emergency cleanup offer live",""],
  ["Q1 2027","35+ recurring accounts",""],["Q1 2027","$10k/mo revenue run-rate",""],["Q1 2027","Quoting + invoicing systematized — owner time under 10 hrs/wk",""]],
 jam:[["Q2 2026","Replace placeholder phone number; launch the site",""],["Q2 2026","Land 3 rental-ready installs",""],["Q2 2026","Publish 3 case studies with photos",""],
  ["Q3 2026","Sign 1 property-manager portfolio (5+ doors)",""],["Q3 2026","Get 10 clients on the 'Keep It Running' plan",""],["Q3 2026","Hit $5k/mo revenue",""],
  ["Q4 2026","Starlink + mesh package as the lead offer",""],["Q4 2026","15 doors under management",""],["Q4 2026","Add one networking-only commercial job",""],
  ["Q1 2027","2 PM portfolios under contract",""],["Q1 2027","$8k/mo revenue run-rate",""],["Q1 2027","Install playbook standardized so a helper can run jobs",""]]
};
window.seedMilestones=function(){const seed=MSEED[S.biz]||[];seed.forEach(s=>mstones().push({id:uid(),title:s[1],quarter:s[0],status:"open",notes:s[2],updatedAt:now()}));logEvent("Loaded starter quarterly milestones","plan");save();render();};
window.toggleMilestone=function(id){const m=mstones().find(x=>x.id===id);if(!m)return;m.status=m.status==="done"?"open":"done";m.updatedAt=now();if(m.status==="done")logEvent("Milestone hit — "+m.title,"win");save();render();};
window.openMilestone=function(id){const isNew=!id;const m=isNew?{id:uid(),quarter:QUARTERS[0],status:"open"}:mstones().find(x=>x.id===id);
  modal(isNew?"New milestone":"Milestone",`
    <label>Milestone</label><input id="ms_t" value="${esc(m.title||"")}" placeholder="e.g. 20 recurring accounts">
    <label>Target quarter</label><select id="ms_q">${QUARTERS.map(q=>`<option ${m.quarter===q?"selected":""}>${q}</option>`).join("")}</select>
    <label>Notes (optional)</label><textarea id="ms_n">${esc(m.notes||"")}</textarea>
    <div class="toggle" style="margin-top:8px"><input type="checkbox" id="ms_done" ${m.status==="done"?"checked":""}><label style="margin:0">Done</label></div>
    <button class="btn acc" style="margin-top:12px" onclick="saveMilestone('${m.id}',${isNew})">Save</button>
    ${!isNew?`<button class="btn danger" style="margin-top:10px" onclick="delMilestone('${m.id}')">Delete</button>`:""}`);};
window.saveMilestone=function(id,isNew){const t=val("ms_t");if(!t){alert("Give the milestone a name.");return;}
  let m=isNew?{id}:mstones().find(x=>x.id===id);const was=m.status;
  m.title=t;m.quarter=val("ms_q");m.notes=val("ms_n");m.status=document.getElementById("ms_done").checked?"done":"open";m.updatedAt=now();
  if(isNew)mstones().push(m);
  if(m.status==="done"&&was!=="done")logEvent("Milestone hit — "+m.title,"win");
  save();closeModal();render();};
window.delMilestone=function(id){if(!confirm("Delete this milestone?"))return;const m=mstones().find(x=>x.id===id);m.deleted=true;m.updatedAt=now();save();closeModal();render();};
function liMilestone(m){return `<div class="li"><input type="checkbox" style="width:20px;height:20px;flex:0 0 auto" ${m.status==="done"?"checked":""} onchange="toggleMilestone('${m.id}')"><div class="grow" onclick="openMilestone('${m.id}')" style="cursor:pointer"><div class="nm" style="${m.status==="done"?"text-decoration:line-through;opacity:.55":""}">${esc(m.title)}</div>${m.notes?`<div class="sub">${esc(m.notes)}</div>`:""}</div></div>`;}
function rPlanMilestones(){
  const ms=mstones().filter(m=>!m.deleted);
  let h=`<div class="secthd"><h2>Quarterly milestones</h2><button class="btn ghost sm" onclick="openMilestone()">+ Add</button></div>`;
  if(!ms.length){h+=`<div class="card"><div class="muted" style="margin-bottom:10px">No milestones yet. Load a starter set built from your 12-month plan, then edit freely.</div><button class="btn acc" onclick="seedMilestones()">Load starter milestones for ${esc(BIZ[S.biz].name)}</button></div>`;return h;}
  const totalDone=ms.filter(m=>m.status==="done").length;
  h+=`<div class="card"><div class="row" style="align-items:center"><div class="grow"><b>Overall</b></div><span class="sub">${totalDone}/${ms.length} complete</span></div><div style="height:10px;background:var(--soft);border-radius:6px;overflow:hidden;margin-top:6px"><div style="height:100%;width:${ms.length?Math.round(totalDone/ms.length*100):0}%;background:var(--accent)"></div></div></div>`;
  QUARTERS.forEach(q=>{const list=ms.filter(m=>m.quarter===q);if(!list.length)return;const done=list.filter(m=>m.status==="done").length;
    h+=`<div class="card"><div class="row" style="align-items:center"><div class="grow"><b>${q}</b></div><span class="sub">${done}/${list.length}</span></div><div style="height:8px;background:var(--soft);border-radius:5px;overflow:hidden;margin:6px 0 8px"><div style="height:100%;width:${Math.round(done/list.length*100)}%;background:var(--accent)"></div></div>`+list.map(liMilestone).join("")+`</div>`;});
  const other=ms.filter(m=>QUARTERS.indexOf(m.quarter)<0);
  if(other.length)h+=`<div class="card"><b>Other</b>`+other.map(liMilestone).join("")+`</div>`;
  return h;
}
function timeAgo(ts){const s=Math.floor((now()-ts)/1000);if(s<60)return"just now";const m=Math.floor(s/60);if(m<60)return m+"m ago";const hr=Math.floor(m/60);if(hr<24)return hr+"h ago";const d=Math.floor(hr/24);if(d<7)return d+"d ago";return new Date(ts).toLocaleDateString();}
function weekStats(){const wk=now()-7*864e5;const inWk=ds=>{const t=Date.parse(ds);return !isNaN(t)&&t>=wk;};
  const q=actQ().filter(x=>inWk(x.date));const qSum=q.reduce((s,x)=>s+(x.total||0),0);
  const paid=actQ().filter(x=>x.paid&&inWk(x.date));const paidSum=paid.reduce((s,x)=>s+(x.total||0),0);
  const jobsDone=actJ().filter(x=>x.done&&inWk(x.date)).length;
  const pipeline=actQ().filter(x=>!x.paid).reduce((s,x)=>s+(x.total||0),0);
  return {newQuotes:q.length,qSum:qSum,paidSum:paidSum,jobsDone:jobsDone,pipeline:pipeline};}
const LOGTAG={quote:"🧾",paid:"💵",job:"✅",win:"🏆",plan:"🗺️",note:"📝"};
const ENT_ICON={customer:"👤",quote:"🧾",job:"✅",property:"🏠",todo:"☑️",inventory:"🧰",milestone:"🏆",note:"📝"};
function liLog(e){
  const icon=ENT_ICON[e.entity]||LOGTAG[e.tag]||"•";
  const txt=e.summary||e.text||((e.action||"")+(e.entity?(" "+e.entity):""));
  const meta=[timeAgo(e.ts)];if(e.userName)meta.push(esc(e.userName));if(e.entity&&e.entity!=="note")meta.push(esc(e.entity));
  const act=(e.action&&e.action!=="note")?` <span class="badge" style="background:var(--soft);color:var(--muted)">${esc(e.action)}</span>`:"";
  const removable=(e.tag==="note"||e.entity==="note");
  return `<div class="li"><div class="grow"><div class="nm" style="font-size:14px">${icon} ${esc(txt)}${act}</div><div class="sub">${meta.join(" · ")}</div></div>${removable?`<button class="rm" onclick="delLog('${e.id}')">×</button>`:""}</div>`;}
window.delLog=function(id){const e=chlog().find(x=>x.id===id);if(e){e.deleted=true;save();render();}};
window.openLogNote=function(){modal("Add a note to the log",`<label>What happened?</label><textarea id="lg_t" placeholder="e.g. Met the Sandbridge PM — sending a quote Monday"></textarea><button class="btn acc" style="margin-top:12px" onclick="saveLogNote()">Add</button>`);};
window.saveLogNote=function(){const t=val("lg_t");if(!t){closeModal();return;}logEvent(t,"note");save();closeModal();render();};
function tile(label,val,sub){return `<div class="card" style="text-align:center"><div style="font-size:24px;font-weight:800">${val}</div><div class="sub">${label}${sub?" · "+sub:""}</div></div>`;}
function rPlanLog(){
  const s=weekStats();
  let h=`<div class="secthd"><h2>This week</h2></div><div class="grid2">`;
  h+=tile("new quotes",s.newQuotes,money(s.qSum));
  h+=tile("jobs done",s.jobsDone,"");
  h+=tile("collected",money(s.paidSum),"paid this wk");
  h+=tile("open pipeline",money(s.pipeline),"");
  h+=`</div>`;
  h+=`<div class="secthd"><h2>Activity</h2><button class="btn ghost sm" onclick="openLogNote()">+ Add note</button></div>`;
  const all=chlog().filter(x=>!x.deleted);
  const usersSet=[...new Set(all.map(e=>e.userName).filter(Boolean))].sort();
  const entsSet=[...new Set(all.map(e=>e.entity).filter(Boolean))].sort();
  // filterable by user + entity — doubles as the sales-credit attribution trail
  if(all.length){h+=`<div class="card" style="display:flex;gap:8px;flex-wrap:wrap">
    <select style="flex:1;min-width:120px" onchange="setActFilter('u',this.value)"><option value="">All users</option>${usersSet.map(u=>`<option value="${esc(u)}" ${ACT_FU===u?"selected":""}>${esc(u)}</option>`).join("")}</select>
    <select style="flex:1;min-width:120px" onchange="setActFilter('e',this.value)"><option value="">All types</option>${entsSet.map(en=>`<option value="${esc(en)}" ${ACT_FE===en?"selected":""}>${esc(en)}</option>`).join("")}</select>
    ${(ACT_FU||ACT_FE)?`<button class="btn ghost sm" onclick="setActFilter('clear')">Clear</button>`:""}</div>`;}
  const log=all.filter(e=>(!ACT_FU||e.userName===ACT_FU)&&(!ACT_FE||e.entity===ACT_FE)).sort((a,b)=>b.ts-a.ts);
  const wk=now()-7*864e5;const week=log.filter(x=>x.ts>=wk),older=log.filter(x=>x.ts<wk);
  h+= week.length?`<div class="card">`+week.map(liLog).join("")+`</div>`:`<div class="card"><div class="muted">${(ACT_FU||ACT_FE)?"No matching activity in the last 7 days.":"Nothing logged in the last 7 days yet. Creating or editing customers, quotes, jobs and to-dos shows up here automatically — with who did it — or tap “+ Add note”."}</div></div>`;
  if(older.length)h+=`<div class="secthd"><h2>Earlier</h2></div><div class="card">`+older.slice(0,80).map(liLog).join("")+`</div>`;
  return h;
}
let ACT_FU="",ACT_FE="";
window.setActFilter=function(which,v){if(which==="clear"){ACT_FU="";ACT_FE="";}else if(which==="u")ACT_FU=v;else ACT_FE=v;render();};

/* ====================== BUILD PLAN (meta dev plan) ====================== */
let BPSUB="arch",BPF={inst:"",cat:"",tier:0,status:""},BPSORT="tier";
// Layer 1 — Claude instance architecture
const BP_INST={
 strat:{name:"Strategy & Research",type:"Chat",color:"#1B2A4E",owns:"Planning, market intel, competitor monitoring, prioritization, and this Build Plan. The directing partner / brain.",mcps:"Web search · shared project memory",runs:"Quarterly review, market scans, weekly prioritization",hand:"→ feature specs to Dev · → priorities to all Ops · ← results/numbers from Ops"},
 dev:{name:"J-Suite Dev",type:"Claude Code",color:"#6C5CE7",owns:"The github.com/ray-ja/j-suite repo: the app, both websites, the sync server. All software gets built and deployed here.",mcps:"GitHub · filesystem",runs:"Feature builds, bug fixes, deploys, weekly dependency/security check",hand:"← specs from Strategy · → deploy notes + new tools to Ops · ↔ assets with Marketing"},
 obx:{name:"OBX Field Ops",type:"Cowork",color:"#8BC34A",owns:"OBX Lot Solutions daily ops: on-site quoting, scheduling, photos, invoicing, route planning, customer notes.",mcps:"QuickBooks · Google Calendar · Google Maps · (HubSpot)",runs:"Monday brief, review requests, weekly P&L, month-end close",hand:"← priorities from Strategy · → financials to Strategy · uses tools from Dev"},
 jam:{name:"Jamieson Ops",type:"Cowork",color:"#0099E5",owns:"Jamieson Automation: install quotes, proposals, client comms, install checklists, support.",mcps:"QuickBooks · Calendar · DocuSign",runs:"Proposal drafts, quote follow-ups, install + support checklists",hand:"← priorities from Strategy · → financials to Strategy · uses tools from Dev"},
 mkt:{name:"Marketing & Content",type:"Cowork",color:"#E17055",owns:"Content calendar, blog, social, email, before/after, campaigns for both brands.",mcps:"Canva · email/HubSpot · website content (to Dev)",runs:"Weekly content, post-job review automation, campaign drafts (→ approve → send)",hand:"← brand/strategy · → content assets to Dev (sites) · → campaigns after Rzy approves"}
};
const BP_INST_ORDER=["strat","dev","obx","jam","mkt"];
const BP_CATS={internal:"Internal apps & dashboards",customer:"Customer-facing",calc:"Calculators & estimators",graphics:"Graphics & visualizations",research:"Research dossiers",content:"Content & marketing",auto:"Automations",training:"Training & docs"};
// Layer 2 — the full brainstorm. {id,name,desc,cat,own,eff,val,tier,done}
const BP_ITEMS=[
 // INTERNAL
 {id:"guided-quote",name:"Guided Quote wizard",desc:"Step-by-step quoting with deep line-item estimators for every service.",cat:"internal",own:"dev",eff:"L",val:"L",tier:1,done:1},
 {id:"deep-estimators",name:"Deep line-item estimators",desc:"Junk-parity itemized builders + modifiers + sources for all 16 categories.",cat:"internal",own:"dev",eff:"L",val:"L",tier:1,done:1},
 {id:"rate-editor",name:"In-app deep-rate editor",desc:"Edit every rate, modifier, tier, and minimum — with source citations.",cat:"internal",own:"dev",eff:"M",val:"M",tier:1,done:1},
 {id:"ceo-desk",name:"CEO desk",desc:"Home dashboard: today's one move, this week, anti-overwhelm rule + live snapshot.",cat:"internal",own:"dev",eff:"M",val:"M",tier:1,done:1},
 {id:"invoicing",name:"Quotes → invoices + paid tracking",desc:"Turn a quote into an invoice, mark invoiced/paid, print/PDF.",cat:"internal",own:"dev",eff:"M",val:"L",tier:1,done:1},
 {id:"scheduling",name:"Scheduling calendar",desc:"Month-view job calendar with per-day jobs and times.",cat:"internal",own:"dev",eff:"M",val:"M",tier:1,done:1},
 {id:"route-opt",name:"Job + sales route planners",desc:"OSRM-optimized day routes and prospecting loops with map + navigate.",cat:"internal",own:"dev",eff:"M",val:"M",tier:1,done:1},
 {id:"milestones-log",name:"Milestones + This-Week log",desc:"Quarterly milestones with progress + auto activity log of wins.",cat:"internal",own:"dev",eff:"M",val:"M",tier:1,done:1},
 {id:"dispatch",name:"Crew dispatch board",desc:"Assign jobs to Pierce/Chase with status (assigned → done) and notes.",cat:"internal",own:"dev",eff:"M",val:"L",tier:2,done:0},
 {id:"crm-photos",name:"CRM with photo-attached job notes",desc:"Per-property history with before/after photos stored on the job.",cat:"internal",own:"dev",eff:"M",val:"L",tier:2,done:0},
 {id:"weekly-pl",name:"Weekly P&L dashboard",desc:"Revenue in, costs out, margin — refreshed weekly from QuickBooks.",cat:"internal",own:"obx",eff:"M",val:"L",tier:2,done:0},
 {id:"payroll-prep",name:"Payroll prep",desc:"Roll crew hours into a payroll-ready summary for the brothers.",cat:"internal",own:"dev",eff:"S",val:"M",tier:2,done:0},
 {id:"equip-maint",name:"Equipment maintenance tracker",desc:"Service intervals + reminders for truck, washer, trailer, blowers.",cat:"internal",own:"dev",eff:"S",val:"M",tier:2,done:0},
 {id:"timeclock",name:"Job timer / time clock",desc:"Start/stop timer per job to feed payroll + job-cost analysis.",cat:"internal",own:"dev",eff:"S",val:"M",tier:3,done:0},
 {id:"inventory",name:"Consumables & chemical inventory",desc:"Track bleach/soap/supplies on hand with reorder flags.",cat:"internal",own:"dev",eff:"S",val:"S",tier:3,done:0},
 // CUSTOMER-FACING
 {id:"obx-site",name:"OBX Lot Solutions website",desc:"38-page mobile-first site with town pages, blog, FAQ schema, lead magnet.",cat:"customer",own:"mkt",eff:"L",val:"L",tier:1,done:1},
 {id:"jam-site",name:"Jamieson Automation website",desc:"38-page site: Starlink/smart-home/security, town pages, blog, lead magnet.",cat:"customer",own:"mkt",eff:"L",val:"L",tier:1,done:1},
 {id:"lead-magnets",name:"Lead-magnet checklists",desc:"Free home-watch & rental-ready checklists w/ email capture.",cat:"customer",own:"mkt",eff:"S",val:"M",tier:1,done:1},
 {id:"cro-layer",name:"CRO layer (A/B, exit-intent, proof)",desc:"A/B hero, exit-intent capture, social proof, click-to-call across both sites.",cat:"customer",own:"mkt",eff:"M",val:"M",tier:1,done:1},
 {id:"gbp",name:"Google Business Profiles",desc:"Set up + post cadence for both brands — the #1 local-search lever.",cat:"customer",own:"mkt",eff:"S",val:"L",tier:1,done:0},
 {id:"selfserve-quote",name:"Self-serve quote calculator (web)",desc:"Embed the estimator on the site so visitors get an instant ballpark.",cat:"customer",own:"dev",eff:"M",val:"L",tier:2,done:0},
 {id:"booking",name:"Online booking / request-a-time",desc:"Let customers request a slot that lands in the schedule.",cat:"customer",own:"dev",eff:"M",val:"L",tier:2,done:0},
 {id:"pay-online",name:"Online invoice payment",desc:"A pay-now link on every invoice (QuickBooks/Stripe).",cat:"customer",own:"dev",eff:"M",val:"L",tier:2,done:0},
 {id:"portal",name:"Customer portal",desc:"Logged-in view of job status, photos, and invoices.",cat:"customer",own:"dev",eff:"L",val:"M",tier:3,done:0},
 {id:"referral-lp",name:"Referral landing page",desc:"Give-$20-get-$20 referral page with tracking.",cat:"customer",own:"mkt",eff:"S",val:"M",tier:3,done:0},
 // CALCULATORS
 {id:"buy-vs-rent",name:"Trailer buy-vs-rent analysis",desc:"Break-even, listings, ownership math, hidden costs, recommendation.",cat:"calc",own:"obx",eff:"M",val:"M",tier:1,done:1},
 {id:"trip-profit",name:"Trip profitability calculator",desc:"Is this job worth the drive? Revenue vs fuel, time, dump fees.",cat:"calc",own:"dev",eff:"S",val:"L",tier:2,done:0},
 {id:"capacity-planner",name:"Weekly capacity planner",desc:"Booked crew-hours vs available — am I over/under-committed?",cat:"calc",own:"dev",eff:"M",val:"M",tier:2,done:0},
 {id:"subscription-ltv",name:"Recurring-account LTV calc",desc:"What a home-watch/wash account is worth over its lifetime.",cat:"calc",own:"dev",eff:"S",val:"M",tier:2,done:0},
 {id:"job-cost",name:"Post-job actual vs quote",desc:"Did we make money on that job? Compare quote to real time/cost.",cat:"calc",own:"dev",eff:"M",val:"M",tier:3,done:0},
 {id:"weather-window",name:"Weather-window decider",desc:"Go/no-go for washing or clearing based on the forecast.",cat:"calc",own:"dev",eff:"M",val:"M",tier:3,done:0},
 {id:"fuel-est",name:"Fuel-cost estimator",desc:"Per-route fuel cost from miles + truck mpg + gas price.",cat:"calc",own:"dev",eff:"S",val:"S",tier:3,done:0},
 {id:"breakeven",name:"Service-line break-even / price floor",desc:"The lowest price each service can run at and still profit.",cat:"calc",own:"strat",eff:"S",val:"M",tier:3,done:0},
 // GRAPHICS
 {id:"rev-by-service",name:"Revenue by service line",desc:"Which services actually make the money — bar/donut over time.",cat:"graphics",own:"dev",eff:"S",val:"L",tier:2,done:0},
 {id:"cashflow-30",name:"30/60-day cash-flow outlook",desc:"Money coming in vs going out over the next month or two.",cat:"graphics",own:"dev",eff:"M",val:"L",tier:2,done:0},
 {id:"pipeline-funnel",name:"Quote → won funnel",desc:"Where leads fall out: quoted, accepted, paid.",cat:"graphics",own:"dev",eff:"S",val:"M",tier:2,done:0},
 {id:"lead-attr",name:"Lead-source attribution",desc:"Which channels bring the best customers (uses the A/B variant tag).",cat:"graphics",own:"dev",eff:"S",val:"M",tier:2,done:0},
 {id:"seasonality-chart",name:"Revenue seasonality chart",desc:"Visualize the OBX season so you staff and market ahead of it.",cat:"graphics",own:"dev",eff:"S",val:"M",tier:3,done:0},
 {id:"capacity-util",name:"Capacity utilization chart",desc:"How full the week is — spot slack and overload at a glance.",cat:"graphics",own:"dev",eff:"S",val:"M",tier:3,done:0},
 {id:"map-heat",name:"Job density heat map",desc:"Where the work clusters — tighten routes and target marketing.",cat:"graphics",own:"dev",eff:"M",val:"S",tier:4,done:0},
 // RESEARCH
 {id:"market-tab",name:"Market research tab",desc:"Per-industry size, players, local competitors, revenue paths.",cat:"research",own:"strat",eff:"L",val:"L",tier:1,done:1},
 {id:"pricing-bench",name:"Pricing benchmarks library",desc:"Defensible industry rates behind every estimator default.",cat:"research",own:"strat",eff:"M",val:"M",tier:1,done:1},
 {id:"comp-monitor",name:"Competitor monitoring",desc:"Quarterly pull of named competitors' prices, reviews, offers.",cat:"research",own:"strat",eff:"M",val:"M",tier:2,done:0},
 {id:"reg-tracker",name:"Regulation & licensing tracker",desc:"NC contractor/insurance rules, dump rules, EPA freon — kept current.",cat:"research",own:"strat",eff:"S",val:"M",tier:2,done:0},
 {id:"seasonality-cal",name:"OBX seasonality calendar",desc:"Demand by month so marketing and hiring lead the season.",cat:"research",own:"strat",eff:"S",val:"M",tier:2,done:0},
 {id:"cust-interview",name:"Customer interview log",desc:"Capture what customers say — mine it for offers and copy.",cat:"research",own:"strat",eff:"S",val:"M",tier:3,done:0},
 {id:"aero-feasibility",name:"Aeroponics feasibility + buyers",desc:"Deep go/no-go on the microgreens line with a real buyer pipeline.",cat:"research",own:"strat",eff:"M",val:"M",tier:4,done:0},
 // CONTENT
 {id:"blog-posts",name:"Blog posts (8 live)",desc:"Keyword-targeted local guides on both sites.",cat:"content",own:"mkt",eff:"M",val:"M",tier:1,done:1},
 {id:"beforeafter",name:"Before/after photo workflow",desc:"Capture → caption → gallery → social, the same way every job.",cat:"content",own:"mkt",eff:"S",val:"L",tier:2,done:0},
 {id:"email-seq",name:"Email nurture sequences",desc:"New-lead, post-quote, and seasonal email flows.",cat:"content",own:"mkt",eff:"M",val:"M",tier:2,done:0},
 {id:"blog-calendar",name:"Ongoing blog calendar",desc:"A steady pipeline of local SEO posts, planned out.",cat:"content",own:"mkt",eff:"S",val:"M",tier:2,done:0},
 {id:"social-templates",name:"Social post templates",desc:"Reusable templates + a posting cadence for both brands.",cat:"content",own:"mkt",eff:"S",val:"M",tier:3,done:0},
 {id:"video-shotlist",name:"Video shot list",desc:"What to film for service-explainer and proof videos.",cat:"content",own:"mkt",eff:"S",val:"S",tier:4,done:0},
 // AUTOMATIONS
 {id:"review-auto",name:"Auto review request",desc:"Text/email the review link the moment a job is marked done.",cat:"auto",own:"mkt",eff:"S",val:"L",tier:1,done:0},
 {id:"monday-brief-auto",name:"Automated Monday brief",desc:"Scheduled cash/sales/pipeline/to-do briefing every Monday.",cat:"auto",own:"strat",eff:"S",val:"M",tier:1,done:0},
 {id:"missed-call-text",name:"Missed-call auto-text-back",desc:"Instantly text anyone whose call you miss — recovers lost leads.",cat:"auto",own:"obx",eff:"S",val:"L",tier:2,done:0},
 {id:"quote-followup",name:"Quote follow-up (7-day)",desc:"Auto nudge if a quote isn't accepted within a week.",cat:"auto",own:"mkt",eff:"S",val:"L",tier:2,done:0},
 {id:"rebook-recurring",name:"Auto-rebook recurring visits",desc:"Keep wash/home-watch visits on the calendar without thinking.",cat:"auto",own:"dev",eff:"M",val:"L",tier:2,done:0},
 {id:"storm-alert",name:"Storm-incoming offer blast",desc:"When a storm's forecast, blast a home-watch/cleanup offer.",cat:"auto",own:"mkt",eff:"M",val:"M",tier:3,done:0},
 {id:"quarterly-checkin",name:"Quarterly past-customer check-in",desc:"Stay top-of-mind with old customers every quarter.",cat:"auto",own:"mkt",eff:"S",val:"M",tier:3,done:0},
 // TRAINING
 {id:"train-modules",name:"Training tab (modules + quiz)",desc:"Per-business academy with quizzes and sign-off.",cat:"training",own:"dev",eff:"L",val:"M",tier:1,done:1},
 {id:"safety",name:"Safety checklists",desc:"Ladders, chemicals, chainsaw, storm — the non-negotiables.",cat:"training",own:"strat",eff:"S",val:"L",tier:2,done:0},
 {id:"sops",name:"SOPs per service",desc:"Step-by-step standard for wash, watch, junk, install.",cat:"training",own:"strat",eff:"M",val:"M",tier:2,done:0},
 {id:"decision-trees",name:"Job decision trees",desc:"Which wash? Hazard tree or not? Quick branching guides.",cat:"training",own:"strat",eff:"S",val:"M",tier:3,done:0},
 {id:"onboarding",name:"New-hire onboarding packet",desc:"Get a brother or helper productive fast.",cat:"training",own:"strat",eff:"S",val:"M",tier:3,done:0},
 {id:"troubleshoot",name:"Troubleshooting playbooks",desc:"Common Jamieson install/support failure modes and fixes.",cat:"training",own:"jam",eff:"M",val:"M",tier:3,done:0},
 {id:"jam-proposals",name:"Jamieson proposal builder",desc:"Turn an install quote into a branded, send-ready proposal (DocuSign).",cat:"internal",own:"jam",eff:"M",val:"L",tier:2,done:0},
 {id:"install-checklists",name:"Install + support checklists",desc:"Per-job checklists so every Jamieson install is done the same way.",cat:"training",own:"jam",eff:"S",val:"M",tier:2,done:0},
 // ===== EXPANSION PASS — more buildable items =====
 {id:"expense-tracker",name:"Expense tracker + receipts",desc:"Log business expenses with receipt photos; feeds P&L and taxes.",cat:"internal",own:"obx",eff:"S",val:"M",tier:2,done:0,hc:"$0"},
 {id:"estimate-templates",name:"Saved quote templates",desc:"One-tap quote bundles for your most common job types.",cat:"internal",own:"dev",eff:"S",val:"M",tier:2,done:0},
 {id:"recurring-invoice",name:"Auto-generate recurring invoices",desc:"Recurring plans bill themselves on schedule — no manual re-keying.",cat:"internal",own:"dev",eff:"M",val:"L",tier:2,done:0},
 {id:"mileage-log",name:"Auto mileage log",desc:"Per-job mileage captured for the tax deduction.",cat:"internal",own:"dev",eff:"S",val:"M",tier:3,done:0},
 {id:"crew-availability",name:"Crew availability calendar",desc:"Who's free when — so dispatch doesn't double-book the brothers.",cat:"internal",own:"dev",eff:"S",val:"M",tier:3,done:0},
 {id:"multi-day-jobs",name:"Multi-day project tracking",desc:"Track big clears/installs that span several days with progress %.",cat:"internal",own:"dev",eff:"M",val:"S",tier:3,done:0},
 {id:"warranty-tracker",name:"Warranty / RMA tracker",desc:"Track Jamieson install warranties and gear returns.",cat:"internal",own:"jam",eff:"S",val:"M",tier:3,done:0},
 {id:"supplier-list",name:"Supplier / vendor directory",desc:"Where you buy what, at what price — one reference.",cat:"internal",own:"obx",eff:"S",val:"S",tier:4,done:0},
 {id:"sms-updates",name:"\"On my way\" / \"job done\" texts",desc:"Auto-text the customer at key moments — feels premium, cuts calls.",cat:"customer",own:"obx",eff:"S",val:"L",tier:2,done:0,hc:"SMS ~$10–30/mo"},
 {id:"maintenance-plans",name:"Recurring-plan signup page",desc:"A web page to sign up for annual wash / home-watch plans.",cat:"customer",own:"mkt",eff:"M",val:"L",tier:2,done:0},
 {id:"digital-receipts",name:"Digital receipts w/ photos",desc:"Emailed receipt with before/after photos after payment.",cat:"customer",own:"dev",eff:"S",val:"M",tier:3,done:0},
 {id:"nps-survey",name:"Post-job satisfaction survey",desc:"One-tap rating after each job; routes happy ones to reviews.",cat:"customer",own:"mkt",eff:"S",val:"M",tier:3,done:0},
 {id:"gift-cards",name:"Service gift cards",desc:"Sellable gift cards — wash/watch as a coastal-homeowner gift.",cat:"customer",own:"dev",eff:"S",val:"S",tier:4,done:0},
 {id:"crew-size-calc",name:"Crew-size / hours calculator",desc:"How many people and hours a job of size X needs.",cat:"calc",own:"dev",eff:"S",val:"M",tier:3,done:0},
 {id:"discount-impact",name:"Discount-impact calculator",desc:"What a 10% discount really does to the job's margin.",cat:"calc",own:"dev",eff:"S",val:"M",tier:3,done:0},
 {id:"annual-plan-pricing",name:"Annual-plan pricing builder",desc:"Price a bundled recurring plan and show the customer's savings.",cat:"calc",own:"dev",eff:"S",val:"M",tier:3,done:0},
 {id:"equipment-roi",name:"Equipment ROI calculator",desc:"Should I buy this machine? Payback vs renting/subbing.",cat:"calc",own:"dev",eff:"S",val:"M",tier:3,done:0},
 {id:"goal-thermometer",name:"Revenue-to-goal thermometer",desc:"A goal gauge on the CEO desk — are we on pace this month?",cat:"graphics",own:"dev",eff:"S",val:"M",tier:2,done:0},
 {id:"aging-receivables",name:"Aging receivables view",desc:"Who owes what and how overdue — chase the right invoices.",cat:"graphics",own:"dev",eff:"S",val:"L",tier:2,done:0},
 {id:"customer-map",name:"Customer density map",desc:"All customers plotted — tighten routes, target expansion.",cat:"graphics",own:"dev",eff:"M",val:"M",tier:3,done:0},
 {id:"win-rate-trend",name:"Quote win-rate trend",desc:"Are we closing more or fewer quotes over time?",cat:"graphics",own:"dev",eff:"S",val:"M",tier:3,done:0},
 {id:"insurance-review",name:"Annual insurance review",desc:"Confirm coverage matches the work (trailers, chainsaw, climbing).",cat:"research",own:"strat",eff:"S",val:"M",tier:3,done:0},
 {id:"demand-signals",name:"Local demand-signal tracker",desc:"New-home permits & construction data as early lead signals.",cat:"research",own:"strat",eff:"M",val:"M",tier:4,done:0},
 {id:"grant-incentive",name:"Grants & incentives tracker",desc:"NC/coastal small-biz grants, rebates, and programs worth claiming.",cat:"research",own:"strat",eff:"S",val:"M",tier:4,done:0},
 {id:"testimonial-bank",name:"Testimonial bank",desc:"Every kind word collected and ready to reuse in marketing.",cat:"content",own:"mkt",eff:"S",val:"M",tier:3,done:0},
 {id:"gmb-posts",name:"Google Business post cadence",desc:"Recurring GBP posts — cheap, steady local-search signal.",cat:"content",own:"mkt",eff:"S",val:"M",tier:2,done:0,hc:"$0"},
 {id:"seasonal-promos",name:"Seasonal promo calendar",desc:"Spring wash, pre-storm prep, fall cleanup — planned promos.",cat:"content",own:"mkt",eff:"S",val:"M",tier:3,done:0},
 {id:"abandoned-quote",name:"Abandoned web-quote re-engage",desc:"Follow up with visitors who started the web calculator but didn't book.",cat:"auto",own:"mkt",eff:"S",val:"M",tier:3,done:0,hc:"email tool ~$0–50/mo"},
 {id:"customer-service-script",name:"Phone/text handling scripts",desc:"What to say to price-shoppers, complaints, and bookings.",cat:"training",own:"strat",eff:"S",val:"M",tier:2,done:0},
 {id:"video-sops",name:"Video SOPs",desc:"Short recorded how-tos for the key field tasks.",cat:"training",own:"strat",eff:"M",val:"M",tier:3,done:0},
 {id:"equipment-training",name:"Equipment operation guides",desc:"Safe-operation guide per machine (washer, chainsaw, trailer).",cat:"training",own:"jam",eff:"S",val:"M",tier:3,done:0}
];
// Layer 3 — tiers
const BP_TIERS=[
 {n:1,name:"Tier 1 — This month",window:"Load-bearing",unlocks:"The daily operating system: quote, schedule, invoice, get found on Google, and ask for reviews. Most is already built — what's left is mostly setup (Google profiles, review automation, Monday brief)."},
 {n:2,name:"Tier 2 — This quarter",window:"High leverage",unlocks:"Self-serve revenue (web quote, booking, online pay), visibility into the numbers (weekly P&L, cash-flow, revenue-by-service), and the automations that recover lost leads (missed-call text, quote follow-up, auto-rebook)."},
 {n:3,name:"Tier 3 — This year",window:"Completing the picture",unlocks:"Customer portal, deeper analytics, the full SOP/training/decision-tree library, and the calculators that sharpen every job-level decision."},
 {n:4,name:"Tier 4 — When bored / surfaced",window:"Nice to have",unlocks:"Polish and the speculative plays — job heat-maps, video content, and the aeroponics feasibility deep-dive."}
];
const EFFW={S:1,M:2,L:3};
// Build-cost model: these are mostly Rzy's build-time (he builds with Claude), priced in working days. Hard $ only where a tool/subscription is needed (it.hc).
const BPTIME={S:"~½ day",M:"~1–2 days",L:"~3–5 days"};
const BPDAYS={S:0.5,M:1.5,L:4};
function bpBuildDays(list){return list.reduce((s,x)=>s+BPDAYS[x.eff],0);}
function bpCostStr(it){return BPTIME[it.eff]+" build"+(it.hc?" · "+it.hc:" · no hard cost");}
function bpItems(){return BP_ITEMS;}
// Dependency map: id -> prerequisite ids (must exist before this is worth building). Powers the dependency view + build-order check.
const BP_DEPS={
 "selfserve-quote":["deep-estimators"],"pay-online":["invoicing"],"recurring-invoice":["invoicing","maintenance-plans"],
 "maintenance-plans":["pay-online"],"portal":["crm-photos","invoicing"],"digital-receipts":["pay-online","crm-photos"],
 "abandoned-quote":["selfserve-quote"],"nps-survey":["review-auto"],"rebook-recurring":["scheduling"],
 "dispatch":["scheduling"],"crew-availability":["scheduling"],"weekly-pl":["expense-tracker"],
 "aging-receivables":["invoicing"],"cashflow-30":["invoicing","expense-tracker"],"rev-by-service":["invoicing"],
 "pipeline-funnel":["invoicing"],"win-rate-trend":["pipeline-funnel"],"lead-attr":["cro-layer"],
 "job-cost":["timeclock"],"customer-map":["crm-photos"],"gift-cards":["pay-online"],"restock-reminder":["inventory"],
 "low-season-fill":["capacity-planner"],"storm-alert":["crm-photos"],"quote-followup":["crm-photos"],
 "video-sops":["sops"],"onboarding":["sops"],"decision-trees":["sops"]
};
function bpItem(id){return BP_ITEMS.find(x=>x.id===id);}
function bpDeps(id){return BP_DEPS[id]||[];}
function bpUnlocks(id){return Object.keys(BP_DEPS).filter(k=>BP_DEPS[k].indexOf(id)>=0);}
const BP_VALW={L:3,M:2,S:1};
function bpLev(it){return BP_VALW[it.val]/EFFW[it.eff];}            // value per unit effort
function bpHiLev(it){return bpLev(it)>=1.5&&!it.done;}              // quick-win flag
// is every prerequisite already built? (helps spot "ready to build now")
function bpReady(it){return !it.done&&bpDeps(it.id).every(d=>{const p=bpItem(d);return p&&p.done;});}
function bpDepChip(id){const p=bpItem(id);if(!p)return"";return `<span class="badge" style="background:var(--soft);color:var(--ink);cursor:pointer" onclick="bpOpenItem('${id}')">${p.done?"✓ ":""}${esc(p.name)}</span>`;}
function bpDepCardHTML(it){const deps=bpDeps(it.id),unl=bpUnlocks(it.id);if(!deps.length&&!unl.length)return"";
 let h=`<div class="card">`;
 if(deps.length){const ready=bpReady(it);h+=`<div style="font-weight:700;margin-bottom:4px">Depends on ${it.done?"":(ready?'<span style="color:var(--accent)">· ready to build now</span>':'<span style="color:#E1A100">· prerequisites first</span>')}</div><div style="display:flex;gap:4px;flex-wrap:wrap">${deps.map(bpDepChip).join("")}</div>`;}
 if(unl.length){h+=`<div style="font-weight:700;margin:${deps.length?"8px":"0"} 0 4px">Unlocks</div><div style="display:flex;gap:4px;flex-wrap:wrap">${unl.map(bpDepChip).join("")}</div>`;}
 return h+`</div>`;}
function bpChip(v){const c=v==="L"?"var(--accent)":v==="M"?"#E1A100":"var(--muted)";return `<span class="badge" style="background:${c};color:#fff">${v}</span>`;}
function bpInstChip(id){const i=BP_INST[id];return `<span class="badge" style="background:${i.color};color:#fff;cursor:pointer" onclick="event.stopPropagation();bpGotoInst('${id}')">${esc(i.name)}</span>`;}
function rBuildPlan(){
 let h=`<div class="secthd"><h2>🏗️ Build Plan</h2></div>`;
 const done=BP_ITEMS.filter(x=>x.done).length;
 h+=`<div class="sub" style="margin:-4px 2px 8px">The meta-plan: who builds what, in what order, on which AI. <b>${done}</b> of <b>${BP_ITEMS.length}</b> items already shipped.</div>`;
 h+=`<div class="subnav">`+[["arch","Architecture"],["brain","Brainstorm"],["seq","Sequence"]].map(s=>`<button class="subbtn ${BPSUB===s[0]?"on":""}" onclick="bpSub('${s[0]}')">${s[1]}</button>`).join("")+`</div>`;
 h+= BPSUB==="arch"?bpArch():BPSUB==="brain"?bpBrain():bpSeq();
 view.innerHTML=h;
}
window.bpSub=function(s){BPSUB=s;render();};
window.bpGotoInst=function(i){BPSUB="brain";BPF.inst=i;BPF.cat="";BPF.tier=0;render();};
window.bpGotoTier=function(t){BPSUB="brain";BPF.tier=t;BPF.inst="";BPF.cat="";render();};
window.bpSetInst=function(i){BPF.inst=i;render();};
window.bpSetCat=function(c){BPF.cat=c;render();};
window.bpSetTier=function(t){BPF.tier=parseInt(t)||0;render();};
window.bpSetStatus=function(s){BPF.status=s;render();};
window.bpSetSort=function(s){BPSORT=s;render();};
window.bpOpenItem=function(id){const it=BP_ITEMS.find(x=>x.id===id);if(!it)return;const i=BP_INST[it.own];const tier=BP_TIERS.find(t=>t.n===it.tier);
 modal(it.name,`<div class="sub" style="margin-bottom:8px">${BP_CATS[it.cat]} ${it.done?'· <span style="color:var(--accent);font-weight:700">✓ already built</span>':""}</div>
  <p style="line-height:1.5">${esc(it.desc)}</p>
  <div class="card" style="margin-top:8px"><div class="row"><div class="grow">Effort</div>${bpChip(it.eff)}</div><div class="row" style="margin-top:4px"><div class="grow">Value</div>${bpChip(it.val)}</div><div class="row" style="margin-top:4px"><div class="grow">Leverage (value ÷ effort)</div><span class="sub">${bpLev(it).toFixed(2)}×${bpHiLev(it)?' <span style="color:var(--accent);font-weight:700">⚡ quick win</span>':""}</span></div><div class="row" style="margin-top:4px"><div class="grow">Est. cost</div><span class="sub">${esc(bpCostStr(it))}</span></div></div>
  ${bpDepCardHTML(it)}
  <div class="card"><div style="font-weight:700;margin-bottom:4px">Owned by</div><div class="row"><div class="grow"><span class="badge" style="background:${i.color};color:#fff">${esc(i.name)}</span> <span class="sub">${i.type}</span></div></div><button class="btn ghost sm" style="margin-top:8px" onclick="closeModal();bpSub('arch')">See it in the Architecture →</button></div>
  <div class="card"><div style="font-weight:700;margin-bottom:4px">Scheduled in</div><div>${esc(tier.name)} — <span class="sub">${tier.window}</span></div><button class="btn ghost sm" style="margin-top:8px" onclick="closeModal();bpSub('seq')">See it in the Sequence →</button></div>`);
};
function bpArch(){
 let h=`<div class="card"><p style="line-height:1.55;margin:0">Run <b>five Claude instances</b>, each owning a lane. Lean start: stand up <b>Strategy</b>, <b>Dev</b>, and <b>OBX Field Ops</b> first; add <b>Jamieson Ops</b> and <b>Marketing</b> as revenue justifies the extra seats. The thread that ties them together is <b>shared memory</b> (this project's memory + the J-Suite app data via the sync server). Every customer send, quote, payment, deploy, and hire passes through <b>you</b> — the human approval gate.</p></div>`;
 h+=bpDiagram();
 h+=`<div class="sub" style="margin:8px 2px"><span style="display:inline-block;width:22px;border-top:2px solid var(--ink)"></span> work handoff &nbsp; <span style="display:inline-block;width:22px;border-top:2px dashed var(--muted)"></span> shared-memory access &nbsp; ◆ your approval</div>`;
 BP_INST_ORDER.forEach(id=>{const i=BP_INST[id];const mine=BP_ITEMS.filter(x=>x.own===id);
  h+=`<div class="card" style="border-left:5px solid ${i.color}"><div class="row" style="align-items:center"><div class="grow"><b>${esc(i.name)}</b> <span class="badge" style="background:${i.color};color:#fff">${i.type}</span></div><span class="sub">${mine.length} items</span></div>
   <div style="font-size:13px;line-height:1.5;margin-top:6px"><b>Owns:</b> ${esc(i.owns)}</div>
   <div style="font-size:13px;line-height:1.5;margin-top:4px"><b>Connectors:</b> ${esc(i.mcps)}</div>
   <div style="font-size:13px;line-height:1.5;margin-top:4px"><b>Runs:</b> ${esc(i.runs)}</div>
   <div style="font-size:13px;line-height:1.5;margin-top:4px"><b>Handoffs:</b> ${esc(i.hand)}</div>
   <button class="btn ghost sm" style="margin-top:8px" onclick="bpGotoInst('${id}')">See its ${mine.length} items →</button></div>`;});
 return h;
}
function bpNode(x,y,w,hh,fill,name,type){return `<g><rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="11" fill="${fill}" stroke="rgba(0,0,0,.15)"/><text x="${x+w/2}" y="${y+hh/2-4}" text-anchor="middle" fill="#fff" font-size="15" font-weight="700">${name}</text><text x="${x+w/2}" y="${y+hh/2+14}" text-anchor="middle" fill="rgba(255,255,255,.85)" font-size="11">${type}</text></g>`;}
function bpDiagram(){
 const I=BP_INST;
 const ln=(x1,y1,x2,y2,dash)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${dash?'var(--muted)':'var(--ink)'}" stroke-width="2" ${dash?'stroke-dasharray="5 4"':'marker-end="url(#bpArr)"'}/>`;
 let s=`<div class="card" style="overflow-x:auto"><svg viewBox="0 0 820 580" width="100%" style="min-width:560px" font-family="inherit">
 <defs><marker id="bpArr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--ink)"/></marker></defs>`;
 // shared memory cylinder (center, under strategy)
 s+=`<g><ellipse cx="410" cy="150" rx="150" ry="16" fill="var(--soft)" stroke="var(--line)"/><rect x="260" y="150" width="300" height="52" fill="var(--soft)" stroke="var(--line)"/><ellipse cx="410" cy="202" rx="150" ry="16" fill="var(--soft)" stroke="var(--line)"/><text x="410" y="180" text-anchor="middle" fill="var(--ink)" font-size="12.5" font-weight="700">Shared memory + J-Suite app data</text></g>`;
 // dashed memory links to each instance
 s+=ln(410,150,410,104,1); // strat to memory
 s+=ln(300,202,150,300,1)+ln(520,202,670,300,1)+ln(320,202,250,430,1)+ln(500,202,590,430,1);
 // nodes
 s+=bpNode(285,40,250,64,I.strat.color,"Strategy &amp; Research","Chat · the brain");
 s+=bpNode(40,300,220,80,I.dev.color,"J-Suite Dev","Claude Code · repo");
 s+=bpNode(560,300,220,80,I.mkt.color,"Marketing &amp; Content","Cowork");
 s+=bpNode(120,430,260,80,I.obx.color,"OBX Field Ops","Cowork");
 s+=bpNode(440,430,260,80,I.jam.color,"Jamieson Ops","Cowork");
 // solid work-handoff arrows
 s+=ln(330,104,180,300)+ // strat -> dev (specs)
    ln(150,380,200,430)+ // dev -> obx (tools/deploys)
    ln(620,380,610,430)+ // mkt -> jam? actually mkt assets -> sites; draw dev<->mkt
    ln(260,340,560,340,0); // dev <-> mkt assets (horizontal)
 // labels on key arrows
 s+=`<text x="232" y="210" fill="var(--muted)" font-size="10.5" transform="rotate(58 232 210)">specs</text>`;
 s+=`<text x="405" y="332" text-anchor="middle" fill="var(--muted)" font-size="10.5">tools / assets</text>`;
 // human approval gate
 s+=`<g><polygon points="410,250 470,278 410,306 350,278" fill="#fff" stroke="var(--accent)" stroke-width="2.5"/><text x="410" y="282" text-anchor="middle" fill="var(--accent)" font-size="11" font-weight="800">◆ YOU</text></g>`;
 s+=`<text x="410" y="322" text-anchor="middle" fill="var(--muted)" font-size="10.5">approve sends · quotes · money · deploys</text>`;
 // outputs pill
 s+=`<g><rect x="250" y="525" width="320" height="44" rx="22" fill="none" stroke="var(--line)" stroke-dasharray="3 3"/><text x="410" y="551" text-anchor="middle" fill="var(--ink)" font-size="12" font-weight="700">Customers · Invoices · Live sites</text></g>`;
 s+=ln(250,510,330,525)+ln(570,510,490,525);
 s+=`</svg></div>`;
 return s;
}
function bpBrain(){
 let items=BP_ITEMS.slice();
 if(BPF.inst)items=items.filter(x=>x.own===BPF.inst);
 if(BPF.cat)items=items.filter(x=>x.cat===BPF.cat);
 if(BPF.tier)items=items.filter(x=>x.tier===BPF.tier);
 if(BPF.status==="done")items=items.filter(x=>x.done);else if(BPF.status==="todo")items=items.filter(x=>!x.done);
 const ord={L:0,M:1,S:2};
 items.sort((a,b)=>{
  if(BPSORT==="tier")return a.tier-b.tier || ord[a.val]-ord[b.val];
  if(BPSORT==="value")return (ord[a.val]-ord[b.val]) || a.tier-b.tier;
  if(BPSORT==="effort")return (EFFW[a.eff]-EFFW[b.eff]) || a.tier-b.tier;
  if(BPSORT==="lev")return (bpLev(b)-bpLev(a)) || a.tier-b.tier;
  if(BPSORT==="cat")return a.cat<b.cat?-1:a.cat>b.cat?1:a.tier-b.tier;
  return 0;
 });
 const allN=BP_ITEMS.length,doneN=BP_ITEMS.filter(x=>x.done).length,todoN=allN-doneN;
 const remDays=bpBuildDays(BP_ITEMS.filter(x=>!x.done));
 let h=`<div class="card"><div class="row" style="align-items:center"><div class="grow"><b>Progress</b></div><span class="sub">${doneN} built · ${todoN} to-do · ~${remDays} build-days left</span></div>
  <div style="height:12px;background:var(--soft);border-radius:7px;overflow:hidden;margin-top:6px"><div style="height:100%;width:${Math.round(doneN/allN*100)}%;background:var(--accent)"></div></div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px"><button class="btn ${BPF.status===""?"acc":"ghost"} sm" onclick="bpSetStatus('')">All ${allN}</button><button class="btn ${BPF.status==="done"?"acc":"ghost"} sm" onclick="bpSetStatus('done')">✓ Built ${doneN}</button><button class="btn ${BPF.status==="todo"?"acc":"ghost"} sm" onclick="bpSetStatus('todo')">◻ To-do ${todoN}</button></div></div>`;
 h+=`<div class="card"><div class="sub" style="margin-bottom:6px">Filter by instance</div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn ${BPF.inst?"ghost":"acc"} sm" onclick="bpSetInst('')">All</button>`+BP_INST_ORDER.map(id=>`<button class="btn ${BPF.inst===id?"acc":"ghost"} sm" onclick="bpSetInst('${id}')">${esc(BP_INST[id].name)}</button>`).join("")+`</div>`;
 h+=`<div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><div><div class="sub">Category</div><select onchange="bpSetCat(this.value)"><option value="">All</option>`+Object.keys(BP_CATS).map(c=>`<option value="${c}" ${BPF.cat===c?"selected":""}>${BP_CATS[c]}</option>`).join("")+`</select></div>`;
 h+=`<div><div class="sub">Tier</div><select onchange="bpSetTier(this.value)"><option value="0">All</option>`+BP_TIERS.map(t=>`<option value="${t.n}" ${BPF.tier===t.n?"selected":""}>Tier ${t.n}</option>`).join("")+`</select></div>`;
 h+=`<div><div class="sub">Sort</div><select onchange="bpSetSort(this.value)">`+[["tier","Tier"],["lev","Leverage"],["value","Value"],["effort","Effort"],["cat","Category"]].map(o=>`<option value="${o[0]}" ${BPSORT===o[0]?"selected":""}>${o[1]}</option>`).join("")+`</select></div></div></div>`;
 h+=`<div class="sub" style="margin:2px 2px 6px">${items.length} item${items.length!==1?"s":""} ${BPF.inst||BPF.cat||BPF.tier||BPF.status?'<a href="#" onclick="BPF={inst:\'\',cat:\'\',tier:0,status:\'\'};render();return false">· clear filters</a>':""}</div>`;
 h+=`<div class="card" style="padding:6px 10px">`+items.map(it=>`<div class="li" style="align-items:center;cursor:pointer${it.done?";opacity:.62":""}" onclick="bpOpenItem('${it.id}')">
   <div class="grow"><div class="nm" style="font-size:14px">${it.done?'<span style="color:var(--accent)">✓ </span>':bpHiLev(it)?'<span title="High leverage — quick win">⚡ </span>':""}${esc(it.name)}${bpReady(it)?' <span class="badge" style="background:var(--accent);color:#fff" title="All prerequisites are built">ready</span>':""}</div><div class="sub">${esc(it.desc)}</div><div class="sub" style="margin-top:2px">⏱ ${esc(bpCostStr(it))}</div></div>
   <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end">${bpInstChip(it.own)}<span class="badge" style="background:var(--soft);color:var(--muted);cursor:pointer" onclick="event.stopPropagation();bpGotoTier(${it.tier})">T${it.tier}</span> <span class="sub">E</span>${bpChip(it.eff)}<span class="sub">V</span>${bpChip(it.val)}</div></div>`).join("")+`</div>`;
 return h;
}
function bpSeq(){
 let h=`<div class="card"><p style="margin:0;line-height:1.5">Everything from the brainstorm, sequenced. Left to right = sooner to later. Tap any chip for detail. ✓ = already shipped.</p></div>`;
 h+=`<div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:6px">`;
 BP_TIERS.forEach(t=>{const list=BP_ITEMS.filter(x=>x.tier===t.n);
  const doneN=list.filter(x=>x.done).length;
  const remDays=bpBuildDays(list.filter(x=>!x.done));const totDays=bpBuildDays(list);
  h+=`<div style="flex:1 1 0;min-width:210px"><div class="card" style="border-top:4px solid var(--accent)">
   <div style="font-weight:800">${esc(t.name)}</div><div class="sub">${t.window} · ${doneN}/${list.length} shipped · ~${remDays} of ${totDays} build-days left</div>
   <div style="height:6px;background:var(--soft);border-radius:4px;overflow:hidden;margin:6px 0"><div style="height:100%;width:${list.length?Math.round(doneN/list.length*100):0}%;background:var(--accent)"></div></div>
   <div style="font-size:12px;line-height:1.45;color:var(--muted);margin-bottom:8px">${esc(t.unlocks)}</div>`+
   list.map(it=>`<div class="li" style="padding:5px 0;cursor:pointer" onclick="bpOpenItem('${it.id}')"><div class="grow" style="font-size:12.5px">${it.done?'<span style="color:var(--accent)">✓</span> ':""}${esc(it.name)}</div><span class="badge" style="background:${BP_INST[it.own].color};color:#fff;font-size:9px">${BP_INST[it.own].type.split(" ")[0]}</span></div>`).join("")+
   `</div></div>`;});
 h+=`</div>`;
 return h;
}

