/* ---------- state ---------- */
const KEY="jra_app_v1";
let S;
function blank(){return {customers:[],quotes:[],jobs:[],todos:[],mktTracker:[],docs:[],places:[],properties:[],milestones:[],changelog:[],inventory:[],locks:[],timeclock:[],income:[],expenses:[],messages:[],resale:[],pendingChanges:[],knowledge:[],disbursements:[],escapeRooms:[],escapeBookings:[],lifeNotes:[],lifeTrackers:[],lifeLogs:[],budgetBooks:[],budgetCats:[],budgetTx:[],budgetMemo:[],budgetAccounts:[],budgetBudgets:[],budgetTax:[],budgetBills:[],customJobs:[],research:[]}}
function now(){return Date.now()}
function load(){
  try{S=JSON.parse(localStorage.getItem(KEY))||null}catch(e){S=null}
  if(!S||!S.obx)S={biz:"obx",obx:blank(),jam:blank()};
  if(!S.jam)S.jam=blank();
  if(!S.sync)S.sync={url:"",token:"",last:0,auto:true};
  if(!S.users)S.users=[];
  if(!Array.isArray(S.registry))S.registry=[];   // MULTI-ORG: org metadata (id,name,…); orgs are top-level keys (obx, jam, + future). Scaffold obx/jam idempotently.
  {const ON={obx:"OBX Lot Solutions",jam:"Jamieson Automation"};["obx","jam"].forEach(oid=>{if(S[oid]&&!S.registry.find(r=>r&&r.id===oid))S.registry.push({id:oid,slug:oid,name:ON[oid]||oid,settings:{},aiConfig:null,createdAt:1,updatedAt:1,deleted:false});});}
  ["obx","jam"].forEach(b=>{
    if(!S[b].todos)S[b].todos=[];
    if(!S[b].mktTracker)S[b].mktTracker=[];
    if(!S[b].docs)S[b].docs=[];
    if(!S[b].places)S[b].places=[];
    if(!S[b].properties)S[b].properties=[];
    if(!S[b].inventory)S[b].inventory=[];
    if(!S[b].locks)S[b].locks=[];
    if(!S[b].timeclock)S[b].timeclock=[];
    if(!S[b].income)S[b].income=[];
    if(!S[b].expenses)S[b].expenses=[];
    if(!S[b].messages)S[b].messages=[];
    if(!S[b].resale)S[b].resale=[];   // resale tracker: first-class collection (junk-pulled items, own lifecycle)
    if(!S[b].pendingChanges)S[b].pendingChanges=[];   // Step 2: approval queue — Cap PROPOSES here; Ray approves; code applies (synced, per-biz)
    if(!S[b].knowledge)S[b].knowledge=[];   // Cap's Playbook — synced facts Cap references when answering
    if(!S[b].disbursements)S[b].disbursements=[];   // money paid OUT of accounts (payouts/taxes/draws) → running balances
    (S[b].jobs||[]).forEach(j=>{if(!Array.isArray(j.expenses))j.expenses=[];});   // per-job P&L: expenses[] additive on-job array (rides job LWW)
    // MULTI-DAY jobs: workDays[] = the set of YYYY-MM-DD the job is actually worked (non-contiguous OK).
    // j.date stays the START/primary day. Legacy jobs (no workDays) default to [j.date] so they're unchanged.
    // Additive, rides the job record's LWW — no new collection. Loss-free + idempotent.
    (S[b].jobs||[]).forEach(j=>{if(!Array.isArray(j.workDays)||!j.workDays.length){j.workDays=j.date?[j.date]:[];}});
    ["customers","quotes","jobs","todos","mktTracker","docs","places","properties","inventory"].forEach(col=>{
      (S[b][col]||[]).forEach(r=>{if(!r.updatedAt)r.updatedAt=now()});
    });
    // stable per-biz job numbers: number any quote lacking one, deterministically (by date+id) so every device agrees without syncing
    (function(){ const ql=(S[b].quotes||[]).filter(q=>!q.num); if(ql.length){ let mx=(S[b].quotes||[]).reduce((m,q)=>Math.max(m,+q.num||0),0); ql.sort((x,y)=>(((x.date||"")+(x.id||""))<((y.date||"")+(y.id||""))?-1:1)).forEach(q=>{q.num=++mx;}); } })();
  });
  // ESCAPE SCHEDULER (org-specific tool): backfill its two collections on EVERY org slab (obx/jam + any created org),
  // so an org that predates this feature still has the arrays the sync layer / module expect.
  (typeof clientOrgIds==="function"?clientOrgIds():["obx","jam"]).forEach(b=>{
    if(!S[b])return;
    if(!Array.isArray(S[b].escapeRooms))S[b].escapeRooms=[];
    if(!Array.isArray(S[b].escapeBookings))S[b].escapeBookings=[];
  });
  // life-tracker collections — backfill on EVERY org slab (obx/jam + any personal org like rbjvl) so the new synced arrays always exist
  (S.registry||[]).forEach(r=>{const b=r&&r.id;if(!b||!S[b]||typeof S[b]!=="object"||Array.isArray(S[b]))return;
    if(!S[b].lifeNotes)S[b].lifeNotes=[];
    if(!S[b].lifeTrackers)S[b].lifeTrackers=[];
    if(!S[b].lifeLogs)S[b].lifeLogs=[];
    if(!S[b].budgetBooks)S[b].budgetBooks=[];  // budget BOOKS (P0): each business/personal entity = one book; bookId tags cats+tx
    if(!S[b].budgetCats)S[b].budgetCats=[];   // budget tool (personal orgs): categories + monthly targets
    if(!S[b].budgetTx)S[b].budgetTx=[];       // budget tool: transactions (in/out)
    if(!S[b].budgetMemo)S[b].budgetMemo=[];   // budget CSV import: merchant-keyword → category memory
    if(!S[b].budgetAccounts)S[b].budgetAccounts=[];  // budget P1 (YNAB): real cash accounts per book — balances are truth for available cash
    if(!S[b].budgetBudgets)S[b].budgetBudgets=[];    // budget P1 (YNAB): monthly envelope allocations {bookId,catId,month,allocated}
    if(!S[b].budgetTax)S[b].budgetTax=[];            // budget P2 (tax): ONE taxProfile settings record per org {id,filing,state,spouseIncome,dependents,overrideRate}
    if(!S[b].budgetBills)S[b].budgetBills=[];        // budget v2 (recurring bills): scheduled/recurring bills {id,bookId,catId,name,amount,frequency,dueDay,nextDue,autoEstimate,active}
    if(!S[b].customJobs)S[b].customJobs=[];          // WORKSHOP: user-defined scheduled AI tasks (custom cron jobs) — per-org, synced
    seedCustomJobsExample(S[b],b);                   // seed the Sentinel EXAMPLE job into obx once (inactive, clonable; runner skips it)
    migrateBudgetBooks(S[b],b);});            // ensure a default Personal book + tag untagged cats/tx (loss-free, idempotent)
  // RESEARCH library (Data → Research): backfill the synced `research` array on EVERY org slab (obx/jam + any
  // created org) so an org predating this feature still has the array the sync layer / module expect. Then seed
  // the crew-comp note into obx exactly once (idempotent on a stable id; only if absent). Loss-free.
  (typeof clientOrgIds==="function"?clientOrgIds():["obx","jam"]).forEach(b=>{
    if(!S[b]||typeof S[b]!=="object"||Array.isArray(S[b]))return;
    if(!Array.isArray(S[b].research))S[b].research=[];
    if(typeof seedResearchNotes==="function")seedResearchNotes(S[b],b);
  });
  if(!S.propsV2){["obx","jam"].forEach(b=>{(S[b].customers||[]).forEach(c=>{
    const emb=(c.properties&&c.properties.length)?c.properties:(c.address?[{label:"Main",address:c.address}]:[]);
    emb.forEach(ep=>{S[b].properties.push({id:ep.id||uid(),label:ep.label||"Main",address:ep.address||"",accessNotes:"",lat:null,lng:null,customerIds:[c.id],updatedAt:now()});});
    if(c.properties)delete c.properties;});});S.propsV2=true;save();}
  if(!S.seeded){seedTodos();seedDocs();S.seeded=true;save();}
  if(!S.researchV2){setResearchDocs();S.researchV2=true;save();}
  if(!S.researchV3){appendOpportunity();S.researchV3=true;save();}
  if(!S.marketingV2){appendMarketing();S.marketingV2=true;save();}
  if(!S.ceoV1){seedCeo();S.ceoV1=true;save();}
  if(!S.ceoV3){seedCeo();S.ceoV3=true;save();}   // refresh the CEO-desk note to current reality (crew-run, real customers) + Cap rename — overwrites the stale first-jobs/uniforms text and any prior sign-off
  if(!S.msgIAv1&&typeof migrateThreadIA==="function"){migrateThreadIA();S.msgIAv1=true;save();}   // Messages IA cleanup: clear labels, per-crew availability channels, no system noise in crew view
  /* inventory master — seeded/refreshed from js/31-inventory.js (its INV_SEED is the import of OBX-Ops/Inventory/master-inventory.md); preserves the user's Have?/Qty marks. Runs at boot after all modules parse. */
  if(typeof seedInventory==="function")seedInventory();
  /* admin/roles — backfill roles + the synced access-map record on accounts (js/32-admin.js) */
  if(typeof adminMigrate==="function")adminMigrate();
  if(typeof membershipMigrate==="function")membershipMigrate();   // MULTI-ORG: existing crew → obx/jam memberships, owner → super-admin (one-time)
  if(!S.todoGbp){if(!(S.obx.todos||[]).some(t=>!t.deleted&&(t.title||"").indexOf("Google Business Profile")>=0))S.obx.todos.push({id:uid(),title:"Set up Google Business Profile (free, ~30 min)",priority:"High",due:today(),done:false,notes:"Name: OBX Lot Solutions · Category: Pressure washing service (+ Cleaning, Junk removal) · Phone (252) 564-8717 · Site obxlotsolutions.com · Area Corolla–Manteo. Then request verification.",updatedAt:now()});S.todoGbp=true;save();}
}
// WORKSHOP — seed the Sentinel EXAMPLE custom-job into obx exactly once (idempotent on a deterministic id).
// active:false + example:true so the future ~/sentinel runner SKIPS it (no double-run with the real Sentinel
// cron); it exists purely so admins can VIEW and CLONE it to learn the feature. Mirrors the server seed shape.
function seedCustomJobsExample(slab,oid){
  if(!slab||typeof slab!=="object"||Array.isArray(slab))return;
  if(!Array.isArray(slab.customJobs))slab.customJobs=[];
  if(oid!=="obx")return;
  if(slab.customJobs.some(j=>j&&j.id==="cjob_sentinel_example"))return;
  slab.customJobs.push({
    id:"cjob_sentinel_example",org:oid,name:"Sentinel — daily OBX brief (example)",
    dataScope:["income","expenses","jobs","quotes","timeclock"],
    prompt:"You are Sentinel, the daily operations brief for this company. From the org data below, write a short morning brief for the crew: cash in vs out this week, jobs scheduled or still open, any quotes awaiting a decision, and ONE thing to watch today. Keep it under 8 lines, plain and practical.",
    schedule:{kind:"daily",dow:null,hour:6,min:30,tz:"America/New_York"},
    deliverTo:{mode:"broadcast",threadId:null},
    action:{mode:"report"},
    model:null,maxRows:null,active:false,example:true,
    createdBy:"__system__",lastRun:null,createdAt:1,updatedAt:1,deleted:false
  });
}
// RESEARCH library seed — the crew-comp research note. Seeded into obx ONLY, exactly once (idempotent on the
// stable id "research_crewcomp"; only added if absent). Stable id + updatedAt:1 so a re-seed on a fresh device
// dedupes via sync LWW instead of duplicating, and never overrides the owner's later edit/delete. Other orgs
// just get the empty array (no seed). This is reference content, not legal advice.
const RESEARCH_CREWCOMP_BODY =
"Research (2026-06-30) on bringing 2 friends onto the OBX crew — DYAD Holdings LLC, North Carolina.\n"+
"This is RESEARCH, not legal or tax advice. Confirm everything with a NC attorney + a CPA before acting.\n\n"+
"THE QUESTION\nRay wants to add two friends to the crew. They want \"in on the startup,\" not just a paycheck. "+
"What's the cleanest, cheapest, lowest-risk way to pay and structure them?\n\n"+
"RECOMMENDATION\nAdmit them as PROFITS-INTEREST LLC MEMBERS, paid through the existing revenue split (a % of "+
"each completed job via the 80% field-work slice), with VESTING. It fits \"friends who want a piece of the "+
"startup,\" it avoids the workers'-comp / payroll / insurance burden Ray can't afford yet, and it is simply "+
"the revenue-split model the company already runs — extended to two more people.\n\n"+
"THE FOUR OPTIONS\n\n"+
"1) W-2 HOURLY EMPLOYEES\n"+
"  Pros: simplest to explain; total control/direction; familiar.\n"+
"  Cons: payroll + employer FICA + unemployment; a 3rd non-member W-2 worker TRIGGERS mandatory NC workers' "+
"comp (~$3,100–7,700/yr depending on class code); piece-rate still owes minimum-wage true-up + overtime "+
"regardless of whether the customer has paid; doesn't give them the \"ownership\" they want.\n\n"+
"2) 1099 INDEPENDENT CONTRACTORS\n"+
"  Pros: looks cheap and easy on paper.\n"+
"  Cons: UNSAFE for a daily crew. They'd use your truck and tools, work daily, be owner-directed, and work "+
"only for you — that fails the IRS, FLSA, and NC (the Hayes test) tests for contractor status. "+
"Misclassification exposes you to back taxes across four NC agencies (Revenue, DES, Industrial Commission, "+
"DOL), the §97-19 statutory-employer workers'-comp trap if someone is hurt, and personal liability that can "+
"reach the members. Do not do this.\n\n"+
"3) LLC MEMBERS (recommended structure)\n"+
"  Pros: members are NOT counted as employees, so headcount stays at 0 and no workers' comp is required "+
"(NC requires it at 3+ EMPLOYEES; Ray's 3 owner-operators count as 0). No payroll, no W-2, no employer FICA. "+
"Income flows via a K-1 distributive share + guaranteed payments; they self-pay the 15.3% self-employment "+
"tax through quarterly estimates. It gives them real ownership — the thing they actually want.\n"+
"  Cons: members are hard to remove and gain governance + fiduciary rights; they must handle their own "+
"quarterly taxes; phantom income on a K-1 can surprise them (handled with a mandatory tax-distribution "+
"clause — see the path below).\n\n"+
"4) % OF EACH COMPLETED JOB\n"+
"  This is HOW members get paid, not a separate legal status. Pros: pay-as-paid and seasonally fair — it "+
"matches the revenue-split startup model. Cons: \"pay only when the customer pays\" is ONLY lawful for "+
"owners/members. For a W-2 employee, piece-rate still requires the minimum-wage true-up + overtime no matter "+
"when the customer pays — so this clean model only works if they're members.\n\n"+
"WHAT \"PROFITS INTEREST\" MEANS (and why it's the tax-efficient kind)\n"+
"A profits interest (Rev. Proc. 93-27 / 2001-43) is sweat equity done the smart way: it's a share of FUTURE "+
"profits and growth, worth $0 if the company were liquidated today — so it is NOT taxable when granted, and "+
"future upside is often taxed at capital-gains rates. The alternative, a CAPITAL interest granted for "+
"services, IS taxable as ordinary income right now — avoid it. File a protective 83(b) election within 30 "+
"days of the grant to lock in the favorable treatment.\n\n"+
"WHAT \"GRANT\" AND \"VESTING\" MEAN (plain language)\n"+
"GRANT = the act of issuing the ownership stake — \"here is your X% profits interest.\"\n"+
"VESTING = earning that grant over time instead of owning it all on day one. A common shape is a 1-YEAR "+
"CLIFF and a 4-YEAR VEST: nothing is earned until they've stuck it out one full year (the cliff), then the "+
"rest is earned gradually over four years. If they leave early, the unvested portion is FORFEITED (bought "+
"back per the agreement). Vesting is the \"prove themselves first\" mechanism — they get real ownership, but "+
"they have to stay and earn it, and a friend who walks after two months doesn't keep a permanent stake.\n\n"+
"EMPLOYEES vs MEMBERS — the tradeoff\n"+
"Employees are simple and easy to remove, but cost payroll/comp/overtime and give no ownership. Members cost "+
"none of that and give the ownership the friends want, but they are co-owners — harder to remove, with "+
"governance and fiduciary rights, and they must self-manage their taxes. For two trusted friends who want "+
"in on the startup, members win; for a hired hand you might fire next month, an employee is cleaner.\n\n"+
"THE PATH (step by step)\n"+
"1) Attorney drafts an Operating-Agreement amendment that includes: the profits interest; the vesting "+
"schedule (e.g. 1-yr cliff / 4-yr vest); a buy-back / forfeiture clause on departure; and a MANDATORY "+
"tax-distribution clause so K-1 phantom income never surprises them.\n"+
"2) Each new member files an 83(b) election within 30 days of the grant.\n"+
"3) Pay them through the field-work split (their % of each completed job).\n"+
"4) Issue K-1s at year end.\n"+
"5) They self-manage their estimated quarterly taxes (the 15.3% SE tax).\n\n"+
"DECISIONS FOR RAY\n"+
"• How much equity each friend gets, and how fast it vests.\n"+
"• Whether he truly wants these two as long-term CO-OWNERS (members are hard to remove and gain real "+
"governance / fiduciary rights).\n"+
"• Whether they're ready and able to self-pay quarterly taxes.\n"+
"• Watch the line: a 3rd NON-member W-2 worker makes workers' comp mandatory (~$3,100–7,700/yr).\n\n"+
"THE CAVEAT\nThis is research, not legal or tax advice. Confirm the whole plan with a NC attorney and a CPA "+
"before acting. Citations behind the findings: ic.nc.gov, IRS, NC DES / NC DOL.";
function seedResearchNotes(slab,oid){
  if(!slab||typeof slab!=="object"||Array.isArray(slab))return;
  if(!Array.isArray(slab.research))slab.research=[];
  if(oid!=="obx")return;
  if(slab.research.some(r=>r&&r.id==="research_crewcomp"))return;
  slab.research.push({
    id:"research_crewcomp",
    title:"Adding crew — comp & legal options (research)",
    body:RESEARCH_CREWCOMP_BODY,
    tags:"crew, comp, legal, LLC, equity",
    createdBy:"__system__",
    updatedAt:1,
    deleted:false
  });
}
function seedCeo(){
  const set=(biz,text)=>{let dc=S[biz].docs.find(x=>x.id==="ceo");if(dc){dc.text=text;dc.updatedAt=now();}else S[biz].docs.push({id:"ceo",text:text,updatedAt:now()});};
  set("obx","FROM THE CEO'S DESK — OBX Lot Solutions\n\nYou're past the startup scramble — OBX is a running operation now: real customers, jobs on the calendar, and a crew (Chase + Pierce) who scope and price on-site within the guardrails. The job shifts from 'get found' to 'run it well.'\n\nWHERE YOUR ATTENTION GOES NOW:\n1. Keep the crew moving — jobs scheduled, availability current, the right gear loaded. Schedule + Messages keep everyone in sync without you micromanaging.\n2. Protect the margin — quote within the guardrails, respect the 35% floor, log the real costs (disposal, mileage, materials) so Finance stays honest. Undercut on value, never below what the job costs.\n3. Keep customers happy — fast quotes, show up when you said, ask for the Google review after a good job. Repeat + referral is your cheapest growth.\n4. Use the channel — I can reach the crew directly now; loop me in on anything you want pushed to them.\n\nTHE RULE STILL HOLDS: one move at a time. Do the top thing, tell me it's done, I'll hand you the next. You run the field; I keep the back office straight. — Cap");
  set("jam","FROM THE CEO'S DESK — Jamieson Automation\n\nNow that the crew runs OBX day-to-day, Jamieson — your high-margin engine — can take more of your attention. It still runs on YOUR hours, so grow it deliberately, not frantically:\n\nWHEN YOU HAVE FOCUSED TIME:\n1. Keep the Jamieson site live and its Google Business Profile current so you rank for 'OBX Starlink installer.'\n2. Hold the Starlink install as one flat-rate package you can quote in 30 seconds.\n3. Take the high-value installs that fit your calendar; let OBX carry the steady cash.\n\nOBX funds the lights; Jamieson grows the ceiling. Lean in as your hours free up. — Cap");
}
function appendMarketing(){
  const add=(biz,text)=>{let dc=S[biz].docs.find(x=>x.id==="marketing");if(dc&&dc.text.indexOf("CHANNEL PLAN")<0){dc.text=dc.text+"\n\n"+text;dc.updatedAt=now();}};
  add("obx","CHANNEL PLAN (cost · eyes · leads) — broke-friendly order\nRULE: spend sweat before dollars; spend first dollars only where you pay per RESULT (a lead), not per impression.\n\nTIER 0 — FREE, do now:\n- Google Business Profile + reviews — $0, the #1 free asset; ranks you for 'pressure washing near me'. Ask every customer for a review.\n- Direct PM outreach (the call list) — $0, your #1 channel; one PM = many doors.\n- Referrals + review asks — $0, highest close rate.\n- Nextdoor + local FB groups — $0, post before/after photos.\n- Door hangers — ~$0.12 each, brothers distribute free; 1-3% response = 5-15 calls per 500.\n- Truck magnets + shirts + yard signs — ~$100-200 once, cheap rolling visibility.\n\nTIER 1 — first ~$250/mo:\n- Google Local Services Ads (LSA) — $12-30/lead, pay-per-lead, 'Google Guaranteed'. $250/mo ~ 12 leads, 30-40% close = 4-5 jobs/mo. BEST first paid dollar. Move the $10/day Google Search into LSA.\n\nTIER 2 — ~$300-1,500/mo when cash flows:\n- Meta ads (before/after) — $300-800/mo, CPL ~$18-22 = ~18-22 leads/mo.\n- Vehicle wrap — $2,500-5,000 once, 30-70k impressions/day, $0.36 CPM (cheapest ad there is), recoup 3-6 mo.\n- EDDM direct mail — $0.30-0.60/piece, target second-home/rental zips for house-watch.\n\nTIER 3 — later: full local SEO (durable, compounding), retargeting, sponsorships.\n\nAVOID: Angi/Thumbtack — shared leads, ~$100-2,500 CAC, bad ROI. Skip while broke.\nFull detail: 'Marketing Channel Plan.md'.");
  add("jam","CHANNEL PLAN (cost · eyes · leads) — premium/relationship-driven\nJamieson wins on trust + search-intent, not impressions.\n\nTIER 0 — FREE, do now:\n- Google Business Profile + reviews — $0; rank for 'OBX Starlink installer', 'home automation OBX'.\n- Publish the website (already built) — your SEO foundation.\n- Outreach to vacation-rental managers — $0; sell Starlink/wifi/locks per door (cross-sell from OBX Lot Solutions PM relationships).\n- Referrals — $0; every clean install = a referral, so ask.\n- Nextdoor + local FB groups — $0, portfolio photos.\n\nTIER 1 — first ~$200/mo:\n- Small Google Search budget on high-intent terms ('OBX Starlink install', 'smart lock installer OBX') — buyers there are ready to hire. Use LSA where home-tech/security categories apply.\n\nTIER 2 — ~$300-1,000/mo when cash flows:\n- Targeted Meta ads for high-ticket installs (Starlink, permanent lighting) with strong before/after creative.\n- Vehicle wrap (shared with the work truck) — cheap impressions.\n\nTIER 3 — later: local SEO build-out, retargeting.\n\nAVOID: Angi/Thumbtack (bad ROI, shared leads).\nFull detail: 'Marketing Channel Plan.md'.");
}
function appendOpportunity(){
  const add=(biz,text)=>{let dc=S[biz].docs.find(x=>x.id==="research");if(dc&&dc.text.indexOf("MONEY ON THE TABLE")<0){dc.text=dc.text+"\n\n"+text;dc.updatedAt=now();}};
  add("obx","MONEY ON THE TABLE (vs Pierce $15/hr, Chase $18/hr)\nThe point isn't a great hourly wage — it's that you keep the OWNER MARGIN above labor, which scales with the crew. Paying the brothers $18/hr, each job still nets the business: soft wash ~$248 ($71/clock-hr), pressure wash ~$126, house-watch ~$35 ($46/hr, recurring), junk ~$268 ($134/hr), windows ~$168, holiday lighting ~$856 ($214/hr). Every line beats the brothers' current wage AFTER paying them — so they get a raise and the business still profits.\n\nSCENARIOS (Ray owns 1/3): conservative ~$52k/yr business margin (Ray ~$17k), moderate ~$115k (Ray ~$38k), aggressive yr-2 two-crew ~$253k (Ray ~$84k).\n\nONE-STOP FRONT DOOR: OBX Lot Solutions is the single number a property manager calls for anything; Jamieson is the tech subcontractor; add more trades over time. MONEY RULE: when a job includes tech, Jamieson invoices that portion (Ray owns 100% of Jamieson vs 1/3 of OBX) — keep cleanup money in OBX, tech money in Jamieson.\n\nMORE SERVICES TO ADD: dryer vent ($100-187), deck/fence staining, trash-bin cleaning (subscription), pool/hot-tub service, dock/boat-bottom washing, HVAC coil cleaning, handyman/property maintenance, storm prep, golf-cart repair.\n\nFull detail: 'Opportunity Analysis — Is It Worth It.md' + 'Opportunity & Pricing Model.xlsx'.");
  add("jam","MONEY ON THE TABLE (vs Ray's $55/hr, ~$40k last year)\nEvery Jamieson hour is worth multiples of the escape room: Starlink install ~$135/Ray-hr (2.4x), rental tech package ~$175 (3.2x), permanent lighting ~$150 (2.7x), commercial AV/Q-Sys ~$206 (3.7x). Ray owns 100% of this.\n\nSCENARIOS (to Ray directly): part-time ~$63k/yr, half-time ~$115k, lean-in ~$200k.\n\nCOMBINED PATH: today ~$40k -> conservative OBX + part-time Jamieson ~$81k (2x) -> moderate + half-time ~$154k (3.8x) -> aggressive + lean-in $250k+.\n\nTHE PLAY: run OBX on the brothers (earns without you) so your scarce hours go to high-margin Jamieson work. Start with Starlink packages.\n\nFull detail: 'Opportunity Analysis — Is It Worth It.md' + 'Opportunity & Pricing Model.xlsx'.");
}
function setResearchDocs(){
  const set=(biz,text)=>{let dc=S[biz].docs.find(x=>x.id==="research");if(dc){dc.text=text;dc.deleted=false;dc.updatedAt=now();}else S[biz].docs.push({id:"research",text:text,updatedAt:now()});};
  set("obx","OBX LOT SOLUTIONS — Market Research (updated overnight)\n\nTHE BIG PICTURE\nThe Outer Banks runs on absentee owners and rentals. ~60% of homes here are second homes, ~52% sit vacant at any time, and there are 8,000-10,000+ vacation rentals in Dare County alone. Dare saw $2.1B in visitor spending in 2024 and ~45% of local jobs are tourism. NC also has a real skilled-trades labor shortage. Translation: thousands of pricey properties owned by people who aren't here, who need a reliable local to clean, wash, watch, and fix them — in a market short on reliable help. That gap is the whole opportunity.\n\nWHAT TO PUSH FIRST\n1) Pressure & soft washing — the engine.\n2) House-watch / property checks — the sleeper + the wedge.\n3) Keep junk removal (get the trailer).\n4) Bundle window + gutter cleaning onto wash visits.\n5) Queue holiday lighting for Q4.\n\nPRESSURE & SOFT WASHING (start now)\nSalt + humidity grow algae/mildew fast on the coast, so exteriors need washing on a recurring (often annual) basis — recurring demand is the point. US industry is $1.2B across ~32,000 businesses; gross margins commonly 40-65%. House exterior $192-400; pricing $0.30-0.80/sq ft; roof soft-wash ~$700. Lead with SOFT washing (houses, roofs, siding) for recurring money + concrete pressure washing. Sell annual plans. You already own a commercial unit and the brothers can run it.\n\nHOUSE-WATCH / PROPERTY CHECKS (start now)\nWith 60% absentee ownership, there's a huge base needing property checks — and insurers often require checks on vacant homes. Per-visit recurring, near-zero equipment, delivered with a photo/text report = high trust, high margin, sticky. It's also the WEDGE: once you're the trusted person at the property, you get the washing, junk, repairs, and Jamieson tech too. Offer tiered monthly/bi-weekly plans with a branded report.\n\nJUNK REMOVAL (keep)\n$350-850/job, solo margins 40-72%; tipping ~$62/ton. Trailer is the gating item. Good cash; pairs with clean-outs for the same PM/absentee customers.\n\nWINDOW + GUTTER (bundle, don't lead)\nWindows $150-370/visit, gutters $0.95-2.50/linear ft, both ~twice-yearly, 20-50% margin. Saturated as standalone — ATTACH them to wash/house-watch accounts as recurring add-ons.\n\nHOLIDAY LIGHTING (queue for Q4)\nLands when the OBX is dead = off-season cash. 30%+ net, materials only 10-12%, $8-35/linear ft; a 3-person crew nets $1,000-1,700/day; $100k+/season is doable. Decide by late summer, pre-sell Sept/Oct. Bridges into Jamieson's permanent lighting.\n\nTURNOVER CLEANING (defer)\nCleanliness is the #1 guest complaint and managers can't staff turnover days — huge market, but same-day weekend turns are risky with a part-time crew. Revisit once the crew is proven.\n\nHOW IT CONNECTS TO JAMIESON\nSame customers (property managers + second-home owners). House-watch opens the door; washing/junk are the recurring revenue; then Jamieson sells Starlink/wifi/smart locks/cameras/AV/lighting into the same door. One PM = dozens of doors for both businesses.\n\n(Full report with all numbers + sources: see 'Market Research & Strategy.md' in the project folder.)");
  set("jam","JAMIESON AUTOMATION — Market Research (updated overnight)\n\nTHE BIG PICTURE\nThe OBX is absentee-owner and rental-heavy: ~60% second homes, 8,000-10,000+ vacation rentals in Dare alone, a ~$100B US vacation-rental market, and a US smart-home market of ~$28-36B growing 17-27%/yr (41% of US households already have smart-home tech). These owners want reliable guest wifi, keyless entry, cameras, and systems that just work — and there are few skilled, reliable local integrators. Premium, relationship-sold work is wide open.\n\nWHAT TO PUSH FIRST\n1) Starlink + vacation-rental tech packages.\n2) Commercial AV / Q-Sys for restaurants & bars (your deepest edge).\n3) Permanent outdoor LED lighting (high-ticket bet).\nPlus: security cameras/smart home as cross-sell; EV/generators with a license workaround; boat fiberglass as a wildcard.\n\nSTARLINK + RENTAL-TECH PACKAGES (push now)\n71% of travelers prefer keyless entry; rentals need reliable wifi; Starlink's own installs carry $100-1,500 demand surcharges in busy areas (supply gap). You've done 3 installs already. Bundle Starlink + mesh wifi + smart lock + thermostat + cameras into a flat-rate 'rental-ready' package sold per door to PMs and owners. One PM = many doors.\n\nCOMMERCIAL AV / Q-SYS (your edge)\nThe OBX is dense with restaurants/bars, and you have real Q-Sys/QSC expertise — the exact platform for multi-zone hospitality audio, paging, and control. Few true pros compete locally. High-ticket installs + recurring support/programming. Relationship-sold: walk into venues, lead with Q-Sys. Hard for others to copy.\n\nPERMANENT OUTDOOR LED LIGHTING (high-ticket bet)\nTrimlight/Jellyfish/Gemstone-style systems are year-round (holiday + accent + security in one app), sold to affluent homes — the OBX is full of them, with likely little local competition. $1,800-2,500+ per home, $18-35/linear ft, ~$650 controller; margins like holiday lighting. It's technical (LED channels, controllers, app/network) = your wheelhouse, and it bridges OBX Lot Solutions' seasonal lighting into a premium product. Become a dealer this summer; sell in the fall.\n\nSECURITY CAMERAS + SMART HOME (cross-sell)\nSmart-home market ~$28-36B, growing fast, 41% household adoption. Cameras/locks/thermostats attach naturally to the rental package and any home you're already in.\n\nEV CHARGERS & GENERATORS (demand yes, license constraint)\nStrong demand (NC EV charging +39% YoY; coastal NC wants Generac standby generators, which book up before hurricane season). BUT both hardwire into the panel = NC licensed electrician required, which you're not yet. Options: partner with a licensed electrician (own mounting/config/automation + the customer), do plug-in EV chargers only (no license needed), or pursue a Limited electrical license later (2 yrs experience, up to $60k jobs). Secondary until you pick a path.\n\nWILDCARD: MOBILE BOAT FIBERGLASS/GELCOAT REPAIR\nYou have rare structural fiberglass skill; the OBX is boat-dense; NC sun cracks/fades gelcoat (recurring). Shops charge ~$110/hr, $450-500 for small repairs. A mobile service is a high-margin niche with thin competition. Worth a low-cost test (marina drop-bys).\n\nHOW IT CONNECTS TO OBX LOT SOLUTIONS\nSame customers. OBX Lot Solutions' house-watch/washing relationships become warm leads for Jamieson's high-margin Starlink/AV/lighting work. Keep brands separate (you own 100% of Jamieson) but work one shared PM list.\n\n(Full report with all numbers + sources: see 'Market Research & Strategy.md' in the project folder.)");
}
function seedTodos(){
  // STABLE ids + low updatedAt: re-seeds (every fresh device) dedupe via sync LWW instead of duplicating,
  // and never override a user's later edit/delete. (Was random uid()+now() → 32× duplication across devices.)
  const mk=(id,title,priority,due)=>({id:id,title,priority,due,done:false,notes:"",updatedAt:1});
  const up=(arr,seeds)=>{const have=new Set((arr||[]).map(t=>t&&t.id));seeds.forEach(t=>{if(!have.has(t.id))arr.push(t);});};
  up(S.obx.todos,[
    mk("seed_obx_trailer","Sort out a trailer (buy or rent) for hauling","High","2026-06-09"),
    mk("seed_obx_replacesite","Replace the Squarespace site with the new sites","High","2026-06-23"),
    mk("seed_obx_feedersites","Build per-service feeder sites (parking-lot cleaning, junk hauling) under the OBX umbrella","High","2026-06-23"),
    mk("seed_obx_yardsigns","Order yard signs (ask Mike Green about one for his yard)","Medium","2026-06-16"),
    mk("seed_obx_seo","Set up Google Business Profile for local SEO","Medium","2026-06-20"),
    mk("seed_obx_pms","Call the top 5 property managers on the call list","Low","2026-06-02")
  ]);
  up(S.jam.todos,[
    mk("seed_jam_qbo","Create Intuit Developer app + get QuickBooks OAuth keys (Client ID/Secret; redirect http://localhost:4000/qb/callback)","High","2026-06-03"),
    mk("seed_jam_phone","Get a business phone line (Google Voice / Nextiva) to replace personal cell","High","2026-06-06"),
    mk("seed_jam_site","Register a domain + publish the Jamieson website","High","2026-06-09"),
    mk("seed_jam_starlink","Finalize Starlink flat-rate install package + pricing","Medium","2026-06-10"),
    mk("seed_jam_linecard","Make a one-page Jamieson line card / leave-behind","Medium","2026-06-12"),
    mk("seed_jam_booking","Add an online booking link for flat-rate installs","Medium","2026-06-20"),
    mk("seed_jam_pmreach","Reach out to 3 property managers re: rental tech (wifi/Starlink/smart locks)","Low","2026-06-16"),
    mk("seed_jam_gbp","List on Google Business Profile + local directories","Low","2026-06-23")
  ]);
}
function seedDocs(){
  const d=(id,text)=>({id,text,updatedAt:now()});
  S.obx.docs.push(
    d("onepage","OBX LOT SOLUTIONS — One-Page\n\nWHAT WE DO\nCommercial property cleanup on the Outer Banks: parking-lot litter, storefront & walkway, dumpster areas, roadside, junk removal — plus power washing and window washing.\n\nWHO WE SERVE\nProperty managers, HOAs/POAs, shopping centers, and retail/commercial owners from Corolla to Manteo (and lower Currituck to Jarvisburg). Start with commercial recurring work; vacation-rental turnovers later, once the crew is reliable.\n\nOUR EDGE\nReliable, local, uniformed — we show up. In a service-starved tourist economy, dependability is the differentiator.\n\nMODEL\nRecurring contracts (20% off) for predictable revenue, run by a small crew. Low-skill, labor-leveraged. Online booking + on-the-spot quotes remove friction.\n\nOWNERSHIP\nRay + two partners (equal thirds). Ray leads ops/sales and trains the crew.\n\n90-DAY GOALS\n- Land 3-5 recurring commercial accounts\n- Add power washing & window washing revenue\n- Build a dependable 2-person crew rhythm\n- Reach consistent weekly cash flow"),
    d("marketing","OBX LOT SOLUTIONS — Marketing Strategy\n\nPOSITIONING\n\"The cleanup crew that actually shows up.\" Reliability first.\n\nCHANNELS (priority order)\n1. Direct B2B outreach — cold calls + in-person drop-bys to property managers, HOAs, shopping centers (see the call list). Highest ROI.\n2. Landscaper partnerships — be their cleanup subcontractor; one yes = several properties.\n3. Google Search ads — small budget on local-intent terms (already ~$10/day).\n4. Facebook/Instagram — local awareness with before/after photos.\n5. Google Business Profile + local SEO.\n\nTACTICS\n- Before/after photos on every job for social proof.\n- 20% recurring discount as the close.\n- Leave-behind flyer + business card on every visit.\n- Ask happy clients for a Google review.\n\nTRACK\nUse the tracker below. Watch cost-per-lead and which channels produce recurring accounts (not just one-offs)."),
    d("research","OBX LOT SOLUTIONS — Market Research\n\nMARKET\nOuter Banks: tourist-driven, rental-heavy, transient, expensive, service-based economy. Reliable skilled/semi-skilled labor is scarce — the core opportunity.\n\nDEMAND\nCommercial property managers, HOAs, shopping centers, and retail need recurring exterior cleanup. Vacation-rental turnovers are a large but time-critical market (defer until crew is reliable).\n\nPRICING (market-based — see Service Menu)\nLot cleanup from $79; power washing $99-549 by size; windows $12-18/window. Recurring = 20% off.\n\nKEY TARGETS (see call list)\nSeaside Management, Signature Touch, Harrell & Associates, Joe Lamb Jr., Outlets Nags Head — plus landscaper partners (Four Seasons, Kim Franks).\n\nRESEARCH TOOLS\n- Google Maps — scout properties & find managers\n- OBX Association of Realtors / property-mgmt directories\n- Google Business Profile — competitors & reviews\n- County GIS / parcel data — identify commercial owners\n- Facebook local groups — demand signals")
  );
  S.jam.docs.push(
    d("onepage","JAMIESON AUTOMATION — One-Page\n\nWHAT WE DO\nAutomation, A/V, networking, and smart-home installation on the Outer Banks. Two tiers: flat-rate installs (Starlink, mesh wifi, smart locks/cameras/thermostats, TV/soundbar) and custom integration (home/business automation, whole-house A/V, control systems/PLC, commercial networks).\n\nWHO WE SERVE\nHomeowners, vacation-rental owners/managers, and local businesses that need reliable, expert installs and systems that just work.\n\nOUR EDGE\nA first-principles technician with deep ride-tech background (PLCs, high-voltage, networks, A/V) who builds bulletproof, easy-to-use systems — and shows up. Premium, relationship-sold, 100% Ray-owned.\n\nMODEL\nFlat-rate installs bookable online (high margin, repeatable) + quoted custom work. QuickBooks owns the books; the app owns quoting/scheduling/CRM.\n\n90-DAY GOALS\n- Publish the website + add a business phone line\n- Productize & promote Starlink installs\n- Land first paid installs beyond the escape room\n- Wire QuickBooks for clean invoicing"),
    d("marketing","JAMIESON AUTOMATION — Marketing Strategy\n\nPOSITIONING\n\"Expert automation, A/V & networking — done right, shows up.\" Premium and dependable.\n\nCHANNELS (priority order)\n1. Website + Google Business Profile — capture \"OBX Starlink installer\", \"home automation\", \"network install\" searches.\n2. Productized Starlink installs — clear flat-rate offer + online booking; the wedge service.\n3. Vacation-rental property managers — wifi, smart locks, Starlink, cameras across units (cross-sell from OBX Lot Solutions relationships).\n4. Referrals — every clean install becomes a referral; ask for it.\n5. Local Facebook groups + targeted ads for high-ticket installs.\n\nTACTICS\n- Photograph clean installs; build a portfolio.\n- Lead with Starlink (high demand, repeatable); upsell networking/smart-home.\n- Publish flat pricing = trust + fewer tire-kickers.\n\nTRACK\nTracker below: which services and channels actually book. Protect Ray's time for high-margin work."),
    d("research","JAMIESON AUTOMATION — Market Research\n\nMARKET\nOBX has heavy vacation-rental and second-home density — strong demand for Starlink (spotty rural internet), wifi/networking, smart locks (remote rental access), cameras, and A/V. Few skilled, reliable local integrators.\n\nDEMAND DRIVERS\n- Starlink: rural/island connectivity gaps; rentals want reliable guest wifi.\n- Smart locks/thermostats/cameras: rental turnover & remote management.\n- A/V & automation: second-home owners with budget.\n\nPRICING (market-based — see Service Menu)\nStarlink install $299-599; mesh wifi from $249; TV mount $149-279; smart lock $129. Custom = quoted.\n\nCOMPETITION\nMostly generalist handymen and out-of-area integrators. Edge = local + expert + reliable + flat pricing.\n\nRESEARCH TOOLS\n- Google Trends / Keyword Planner — \"OBX Starlink\", \"home automation OBX\"\n- Starlink installer directories & forums\n- Property-management company sites — see their tech needs\n- Reddit r/Starlink, r/homeautomation — real install pain points\n- Competitor Google Business Profiles & reviews")
  );
}
function save(){localStorage.setItem(KEY,JSON.stringify(S));
  /* auto-sync: any local write queues a debounced push (skipped while applying a pulled merge) */
  if(!window.__syncApplying&&typeof scheduleAutoPush==="function")scheduleAutoPush();}
function D(){return S[S.biz]}
function cat(){return CATALOG[S.biz]}
function uid(){return now().toString(36)+Math.random().toString(36).slice(2,7)}
// MULTI-ORG (Phase 2): the registry lists the organizations; S.biz is the ACTIVE org id; D()=S[S.biz].
function myOrgs(){ const ids=(typeof myOrgIds==="function")?myOrgIds():null; return (S.registry||[]).filter(r=>r&&!r.deleted&&(!ids||!ids.length||ids.indexOf(r.id)>=0)); }   // the signed-in user's orgs (all for super-admin; all as a safe fallback if not-yet-migrated)
function curOrg(){ return (S.registry||[]).find(r=>r&&r.id===S.biz) || {id:S.biz,name:S.biz}; }
function orgName(id){ const r=(S.registry||[]).find(x=>x&&x.id===id); return r?r.name:id; }
function clientOrgIds(){ return (S.registry||[]).filter(r=>r&&r.id&&S[r.id]&&typeof S[r.id]==="object"&&!Array.isArray(S[r.id])).map(r=>r.id); }   // org keys that have a local data slab (for the sync push)
function createOrg(name){
  name=(name||"").trim(); if(!name) return null;
  const id=uid(); if(!S[id]) S[id]=blank();
  S.registry=S.registry||[];
  S.registry.push({id, slug:name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,""), name, settings:{}, aiConfig:null, createdAt:now(), updatedAt:now(), deleted:false});
  const me=(typeof curUser==="function")?curUser():null;   // the creator becomes owner of the new org
  if(me) S.users.push({id:"mem_"+id+"_"+me.id, kind:"membership", orgId:id, accountId:me.id, role:"owner", active:true, updatedAt:now()});
  save(); return id;
}
window.createOrgPrompt=function(){
  if(typeof isOwner==="function" && !isOwner()){ alert("Only an owner can create organizations."); return; }
  const name=prompt("Name the new organization:"); if(name==null) return;
  if(!name.trim()){ alert("Give it a name."); return; }
  const id=createOrg(name);
  if(id){ if(typeof closeModal==="function")closeModal(); if(typeof setBiz==="function")setBiz(id); if(typeof scheduleAutoPush==="function")scheduleAutoPush(); alert("Created “"+orgName(id)+"”. You're now working in it."); }
};
function money(n){return "$"+(Math.round(n)).toLocaleString()}
/* COGS layer — Part 3: render helpers (Cost/Price/Profit/Margin strip + floor warning). */
function cogsStrip(price, cost){
  const profit = price - cost, margin = price>0 ? profit/price : 0;
  const warn = belowMarginFloor(margin);
  return `<div class="cogs" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
    <div class="kp"><b>${money(cost)}</b><span class="kl">Cost</span></div>
    <div class="kp"><b>${money(price)}</b><span class="kl">Price</span></div>
    <div class="kp"><b>${money(profit)}</b><span class="kl">Profit</span></div>
    <div class="kp" style="${warn?'color:#c0392b':''}"><b>${pct(margin)}</b><span class="kl">Margin</span></div>
  </div>${warn?`<div class="note" style="border-left:4px solid var(--danger);background:var(--danger-soft);color:var(--ink);padding:8px;border-radius:6px">
    ⚠ Margin ${pct(margin)} is under the ${Math.round(MARGIN_FLOOR*100)}% floor — this discount is eating your profit. Hold the price or trim scope.</div>`:""}`;
}
function itemsCost(items){let c=0;(items||[]).forEach(it=>c+=(+it.cost||0)*(it.qty||1));return c;}
function today(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function fmtDate(d){if(!d)return"";const p=d.split("-");return `${p[1]}/${p[2]}/${p[0].slice(2)}`}
function relTime(ts){
  if(!ts)return"";
  let s=Math.floor((Date.now()-ts)/1000); if(s<0)s=0;
  if(s<45)return"just now";
  const m=Math.floor(s/60); if(m<60)return m+" minute"+(m===1?"":"s")+" ago";
  const h=Math.floor(m/60); if(h<24)return h+" hour"+(h===1?"":"s")+" ago";
  const d=Math.floor(h/24); if(d===1)return"yesterday"; if(d<7)return d+" days ago";
  if(d<14)return"1 week ago"; if(d<30)return Math.floor(d/7)+" weeks ago";
  const mo=Math.floor(d/30); if(mo<12)return mo+" month"+(mo===1?"":"s")+" ago";
  const y=Math.floor(d/365); return y+" year"+(y===1?"":"s")+" ago";
}
/* active (non-deleted) accessors */
function actC(){return D().customers.filter(c=>!c.deleted)}
function actQ(){return D().quotes.filter(q=>!q.deleted)}
function actJ(){return D().jobs.filter(j=>!j.deleted)}
function actTodo(){return D().todos.filter(t=>!t.deleted)}
function actKnow(){return (D().knowledge||[]).filter(k=>!k.deleted)}
function actDisb(){return (D().disbursements||[]).filter(x=>!x.deleted)}
function actProps(){return (D().properties||[]).filter(p=>!p.deleted)}
function propsForCust(cid){return actProps().filter(p=>(p.customerIds||[]).indexOf(cid)>=0)}
function custsForProp(p){return (p.customerIds||[]).map(id=>D().customers.find(c=>c.id===id&&!c.deleted)).filter(Boolean)}
function propLabel(id){const p=(D().properties||[]).find(x=>x.id===id);return p?((p.label?p.label+" — ":"")+(p.address||"")):""}
function custName(id){const c=D().customers.find(x=>x.id===id);return c?(c.name||c.company||"—"):"—"}
function touch(r){r.updatedAt=now();try{const u=(typeof curUser==="function")?curUser():null;if(u){r.editedBy=u.id;r.editedAt=r.updatedAt;}}catch(e){}return r}

