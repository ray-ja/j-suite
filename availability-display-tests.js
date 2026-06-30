/* Availability-DISPLAY regression — proves a member's availability SURFACES in every Schedule view.
   Background: the owner reported "everybody lost all their availability" though the DATA was intact.
   Root cause: the Schedule view choice persists (localStorage jra_calview); the WEEK view rendered
   ONLY jobs — no availability — so anyone left on Week saw nothing. Month chips, the shared resolver,
   and the "My shifts" calendar were all fine; Week was the sole gap.

   This guards the gap with a Pierce-shaped account: an ALL-FALSE weekly base whose availability lives
   ENTIRELY in per-day overrides. If a render path or the resolver ever drops overrides (or Week loses
   its availability line again), the member shows as never-available and this fails.

   Runs inside the real app via verify-app.js (the render fns + resolver are browser-defined):
       node verify-app.js "$(cat availability-display-tests.js)"
   Pushes to __errs to FAIL; diag() prints non-failing context lines. */

// ---- a future "full" day + a future "partial" day, in YYYY-MM-DD ----
function _ds(off){ var d=new Date(); d.setDate(d.getDate()+off); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
var DFULL=_ds(3), DPART=_ds(4);

// ---- Pierce-shape: weekly base ALL false; availability is overrides-only ----
var pierce={ id:"u_pierce_test", username:"PierceTest", active:true,
  avail:{ days:[false,false,false,false,false,false,false], start:"08:00", end:"17:00", overrides:{} } };
pierce.avail.overrides[DFULL]="full";
pierce.avail.overrides[DPART]={ s:"partial", start:"08:00", end:"12:00" };
var ray={ id:"u_ray_test", username:"RayTest", active:true,
  avail:{ days:[false,true,true,true,true,true,false], start:"08:00", end:"17:00", overrides:{} } };
ray.avail.overrides[DFULL]="full";

S.users=S.users||[];
S.users.push(ray,pierce);
if(typeof orgSetRole==="function"){ orgSetRole("u_ray_test","obx","owner"); orgSetRole("u_pierce_test","obx","crew"); }
S.biz="obx";

// ---- 1) RESOLVER: overrides win over the all-false base ----
var rF=AvailResolve.resolve(pierce,DFULL), rP=AvailResolve.resolve(pierce,DPART);
diag("resolver full -> "+rF.status+" | partial -> "+rP.status);
if(rF.status!=="on") __errs.push("resolver dropped 'full' override (got "+rF.status+", want on)");
if(rP.status!=="partial") __errs.push("resolver dropped 'partial' override (got "+rP.status+", want partial)");

// ---- members present ----
var mem=(typeof schedMembers==="function")?schedMembers():[];
if(!mem.some(function(u){return u.id==="u_pierce_test";})) __errs.push("schedMembers() does not include the overrides-only member");

// ---- 2) MONTH: the day-cell chips mark the member AVAILABLE on his marked-full date ----
var chips=(typeof calDayChips==="function")?calDayChips(DFULL):"";
if(!/available/i.test(chips)) __errs.push("MONTH: no 'available' chip on a marked-full date");
if(!/var\(--accent\)/.test(chips)) __errs.push("MONTH: available chip missing the accent (green) color");
diag("MONTH chips on "+DFULL+" -> available="+/available/i.test(chips));

// ---- 3) WEEK: the week MUST surface availability (the regression) ----
if(typeof CAL_SEL!=="undefined") CAL_SEL=DFULL; if(typeof calSyncMonth==="function") calSyncMonth();
var jobs=(typeof actJ==="function")?actJ():[];
var wk=(typeof renderWeekView==="function")?renderWeekView(jobs):"";
var weekAvail=/weekdayavail/.test(wk)&&(/free/i.test(wk)||/available/i.test(wk));
if(!weekAvail) __errs.push("WEEK view shows NO availability though the data exists");
// and specifically: an available (green) chip lands on the week-row for the marked date
if(!/var\(--accent\)/.test(wk)) __errs.push("WEEK view has no 'available' (accent) chip for a marked-full member");
diag("WEEK surfaces availability="+weekAvail);

// ---- 4) MY SHIFTS: the member sees his own override ----
try{
  localStorage.setItem("jra_session","u_pierce_test");
  if(typeof AVCAL_TARGET!=="undefined") AVCAL_TARGET=null;
  var d=new Date(DFULL+"T00:00:00");
  if(typeof AVCAL_Y!=="undefined"){ AVCAL_Y=d.getFullYear(); AVCAL_M=d.getMonth(); }
  var my=(typeof renderMyAvailCalendar==="function")?renderMyAvailCalendar():"";
  if(!/rgba\(26,127,55/.test(my)) __errs.push("MY SHIFTS does not show the member's own 'full' override");
  diag("MY SHIFTS shows own override="+/rgba\(26,127,55/.test(my));
}catch(e){ __errs.push("my-shifts threw: "+(e&&e.message)); }
