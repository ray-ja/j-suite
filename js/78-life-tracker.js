/* ---------- LIFE TRACKER — a calm, personal life-tracking tool (org-specific) ----------
   Built for Ray's personal organization (rbjvl). Three small synced collections, all
   per-org so they ride the existing per-record LWW sync exactly like customers/quotes:
     - lifeNotes    {id,date,title,body,updatedAt,deleted}              free-form journal / notes
     - lifeTrackers {id,name,type,unit,goal,order,updatedAt,deleted}   user-DEFINED things to track
     - lifeLogs     {id,trackerId,date,value,updatedAt,deleted}        one log per tracker per day
   Plus it reuses the existing `todos` collection for personal reminders (no new plumbing).

   Flexible by design: Ray defines what to track (a habit checkbox, a number like weight/water,
   or a 1–5 scale like mood). The history/streak view is generic over whatever he creates.

   Visibility: gated by the Phase-5 per-org tool system. The "life" tab is part of the
   `personal` template (js/03), so it only appears for an org on that template — never for
   OBX / Jamieson. */

/* ---- accessors (active = non-deleted, current org) ---- */
function actLifeNotes(){ return (D().lifeNotes||[]).filter(function(n){return !n.deleted;}); }
function actLifeTrackers(){ return (D().lifeTrackers||[]).filter(function(t){return !t.deleted;})
  .sort(function(a,b){ return (a.order||0)-(b.order||0) || (a.updatedAt||0)-(b.updatedAt||0); }); }
function actLifeLogs(){ return (D().lifeLogs||[]).filter(function(l){return !l.deleted;}); }
function lifeLog(trackerId,date){ return actLifeLogs().find(function(l){return l.trackerId===trackerId&&l.date===date;}); }

var LIFE_SUB="today";   // "today" | "journal" | "trackers"
var LIFE_DATE=null;     // the day being logged/viewed on the Today view (defaults to today())
window.lifeSetSub=function(s){ LIFE_SUB=s; render(); };
window.lifeSetDate=function(v){ LIFE_DATE=v||today(); render(); };

var LIFE_TYPES=[
  {key:"check", label:"Yes / No (habit)", hint:"a checkbox you tick each day — builds a streak"},
  {key:"number",label:"Number / amount",  hint:"log a value (weight, water, miles, $ saved…)"},
  {key:"scale", label:"1–5 scale",         hint:"rate the day (mood, energy, sleep…)"}
];
function lifeTypeLabel(k){ var t=LIFE_TYPES.find(function(x){return x.key===k;}); return t?t.label:k; }

/* the + FAB does the natural "add" for whatever sub-tab is open */
window.lifeFabAdd=function(){
  if(LIFE_SUB==="trackers")openLifeTracker(null);
  else if(LIFE_SUB==="journal")openLifeNote(null);
  else openLifeNote(null,LIFE_DATE||today());   // Today view → a note for the shown day
};

/* ---------- main render ---------- */
function rLife(){
  var sub='<div class="subnav">'
    +'<button class="subbtn '+(LIFE_SUB==="today"?"on":"")+'" onclick="lifeSetSub(\'today\')">📆 Today</button>'
    +'<button class="subbtn '+(LIFE_SUB==="journal"?"on":"")+'" onclick="lifeSetSub(\'journal\')">📓 Journal</button>'
    +'<button class="subbtn '+(LIFE_SUB==="trackers"?"on":"")+'" onclick="lifeSetSub(\'trackers\')">📈 Trackers</button>'
    +'</div>';
  view.innerHTML=sub+'<div id="life_body"></div>';
  if(LIFE_SUB==="journal")lifeRenderJournal();
  else if(LIFE_SUB==="trackers")lifeRenderTrackers();
  else lifeRenderToday();
}

/* ---------- TODAY — log the day's trackers + quick reminders ---------- */
function lifeRenderToday(){
  var body=document.getElementById("life_body"); if(!body)return;
  var ds=LIFE_DATE||today();
  var trackers=actLifeTrackers();
  var done=trackers.filter(function(t){var l=lifeLog(t.id,ds);return l&&lifeHasValue(t,l);}).length;

  var h='<div class="card"><div class="row" style="gap:8px;align-items:center">'
    +'<button class="btn ghost sm" onclick="lifeShiftDay(-1)" title="Previous day">‹</button>'
    +'<input type="date" value="'+ds+'" onchange="lifeSetDate(this.value)" style="flex:1;text-align:center">'
    +'<button class="btn ghost sm" onclick="lifeShiftDay(1)" title="Next day">›</button>'
    +'</div><div class="sub" style="text-align:center;margin-top:6px">'+(typeof DOW!=="undefined"?DOW[dowOf(ds)]+" · ":"")+fmtDate(ds)
    +(ds===today()?' · <b>today</b>':'')+'</div></div>';

  /* trackers to log */
  h+='<div class="secthd"><h2>Daily check-in</h2><span class="ct">'+done+'/'+trackers.length+'</span></div>';
  if(!trackers.length){
    h+='<div class="empty"><div class="big">📈</div>No trackers yet. Define what you want to track — a habit, a number, or a 1–5 rating — on the <b>Trackers</b> tab.</div>';
  }else{
    h+='<div class="card" style="padding:6px 10px">'+trackers.map(function(t){return lifeLogRow(t,ds);}).join("")+'</div>';
  }

  /* a free-form note for the day (quick jump into the journal) */
  var dayNote=actLifeNotes().find(function(n){return n.date===ds;});
  h+='<div class="secthd"><h2>Note for the day</h2></div>';
  if(dayNote){
    h+='<div class="card" onclick="openLifeNote(\''+dayNote.id+'\')" style="cursor:pointer">'
      +(dayNote.title?'<div class="nm">'+esc(dayNote.title)+'</div>':'')
      +'<div class="sub" style="white-space:pre-wrap">'+esc((dayNote.body||"").slice(0,240))+((dayNote.body||"").length>240?"…":"")+'</div></div>';
  }else{
    h+='<button class="btn ghost" style="width:100%" onclick="openLifeNote(null,\''+ds+'\')">＋ Add a note for '+fmtDate(ds)+'</button>';
  }

  /* personal reminders — reuse the existing todos collection (no new plumbing) */
  var todos=(typeof actTodo==="function")?actTodo():[];
  var open=todos.filter(function(x){return !x.done;});
  h+='<div class="secthd"><h2>Reminders</h2><span class="ct">'+open.length+' open</span></div>';
  if(!todos.length){
    h+='<button class="btn ghost" style="width:100%" onclick="lifeAddReminder()">＋ Add a reminder</button>';
  }else{
    h+='<div class="card" style="padding:6px 10px">'+(typeof sortTodos==="function"?sortTodos(todos):todos).slice(0,12).map(function(td){
      var overdue=td.due&&!td.done&&td.due<today();
      return '<div class="li">'
        +'<input type="checkbox" style="width:22px;height:22px" '+(td.done?"checked":"")+' onchange="toggleTodo(\''+td.id+'\')">'
        +'<div class="grow" onclick="openTodo(\''+td.id+'\')"><div class="nm" style="'+(td.done?'text-decoration:line-through;color:var(--muted)':'')+'">'+esc(td.title)+'</div>'
        +'<div class="sub" style="'+(overdue?'color:var(--danger);font-weight:600':'')+'">'+(td.due?(overdue?"⚠ overdue · ":"")+"due "+fmtDate(td.due):"no due date")+'</div></div></div>';
    }).join("")+'</div>'
    +'<button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="lifeAddReminder()">＋ Add a reminder</button>';
  }

  body.innerHTML=h;
}
window.lifeShiftDay=function(delta){
  var ds=LIFE_DATE||today();
  var d=new Date(ds+"T12:00:00"); d.setDate(d.getDate()+delta);
  LIFE_DATE=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  render();
};
window.lifeAddReminder=function(){ if(typeof openTodo==="function")openTodo(); };

/* whether a log row counts as "filled in" for the day */
function lifeHasValue(t,l){
  if(!l)return false;
  if(t.type==="check")return l.value===true||l.value==="true"||l.value===1;
  return l.value!=null&&l.value!=="";
}

/* one row in the daily check-in — the input shape depends on the tracker type */
function lifeLogRow(t,ds){
  var l=lifeLog(t.id,ds);
  var streak=t.type==="check"?lifeStreak(t.id,ds):0;
  var label='<div class="grow"><div class="nm">'+esc(t.name)
    +(t.type==="check"&&streak>0?' <span class="badge" style="background:#1b7f4d;color:#fff">🔥 '+streak+'</span>':'')+'</div>'
    +'<div class="sub">'+esc(lifeTypeLabel(t.type))+(t.unit?' · '+esc(t.unit):'')+'</div></div>';
  if(t.type==="check"){
    var on=l&&lifeHasValue(t,l);
    return '<div class="li">'
      +'<input type="checkbox" style="width:24px;height:24px" '+(on?"checked":"")+' onchange="lifeSetCheck(\''+t.id+'\',\''+ds+'\',this.checked)">'
      +label+'</div>';
  }
  if(t.type==="scale"){
    var v=l?(+l.value||0):0;
    var dots="";
    for(var i=1;i<=5;i++)dots+='<button class="btn '+(i<=v?"acc":"ghost")+' sm" style="min-width:34px;padding:6px 0" onclick="lifeSetNumber(\''+t.id+'\',\''+ds+'\','+i+')">'+i+'</button>';
    return '<div class="li" style="align-items:flex-start;flex-wrap:wrap">'+label
      +'<div class="row" style="gap:4px;flex:0 0 auto">'+dots+'</div></div>';
  }
  /* number */
  return '<div class="li" style="align-items:flex-start">'+label
    +'<input type="number" inputmode="decimal" value="'+esc(l&&l.value!=null?l.value:"")+'" placeholder="—" style="width:88px;text-align:right;padding:8px" onchange="lifeSetNumber(\''+t.id+'\',\''+ds+'\',this.value)" onclick="event.stopPropagation()">'
    +'</div>';
}
function lifeUpsertLog(trackerId,date,value){
  var d=D(); if(!d.lifeLogs)d.lifeLogs=[];
  var l=d.lifeLogs.find(function(x){return x.trackerId===trackerId&&x.date===date;});
  if(!l){ l={id:"life-log-"+uid(),trackerId:trackerId,date:date,updatedAt:now()}; d.lifeLogs.push(l); }
  l.value=value; l.deleted=false; touch(l); save();
}
window.lifeSetCheck=function(id,ds,on){ lifeUpsertLog(id,ds,!!on); render(); };
window.lifeSetNumber=function(id,ds,v){
  v=(v===""||v==null)?"":(typeof v==="number"?v:(""+v).trim());
  lifeUpsertLog(id,ds,v===""?"":(+v)); render();
};

/* consecutive-day streak for a habit ending on (and counting back from) the given date */
function lifeStreak(trackerId,endDate){
  var logs={}; actLifeLogs().forEach(function(l){ if(l.trackerId===trackerId&&(l.value===true||l.value==="true"||l.value===1))logs[l.date]=1; });
  var n=0, d=new Date((endDate||today())+"T12:00:00");
  for(var i=0;i<366;i++){
    var ds=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
    if(logs[ds]){n++; d.setDate(d.getDate()-1);} else break;
  }
  return n;
}

/* ---------- JOURNAL — free-form dated notes ---------- */
function lifeRenderJournal(){
  var body=document.getElementById("life_body"); if(!body)return;
  var notes=actLifeNotes().sort(function(a,b){ return (b.date||"")<(a.date||"")?-1:((b.date||"")>(a.date||"")?1:(b.updatedAt||0)-(a.updatedAt||0)); });
  var h='<div class="secthd"><h2>Journal</h2><span class="ct">'+notes.length+' '+(notes.length===1?"entry":"entries")+'</span></div>';
  h+='<button class="btn acc" style="width:100%;margin-bottom:10px" onclick="openLifeNote(null)">＋ New entry</button>';
  if(!notes.length){
    h+='<div class="empty"><div class="big">📓</div>Nothing written yet. Tap <b>New entry</b> for a free-form note — a thought, a plan, how the day went.</div>';
  }else{
    h+='<div class="card" style="padding:6px 10px">'+notes.map(function(n){
      var preview=(n.body||"").replace(/\s+/g," ").trim();
      return '<div class="li" style="align-items:flex-start;cursor:pointer" onclick="openLifeNote(\''+n.id+'\')">'
        +'<div class="grow"><div class="nm">'+esc(n.title||preview.slice(0,40)||"(untitled)")+'</div>'
        +'<div class="sub" style="white-space:normal">'+esc(fmtDate(n.date))+(preview?' · '+esc(preview.slice(0,80))+(preview.length>80?"…":""):"")+'</div></div></div>';
    }).join("")+'</div>';
  }
  body.innerHTML=h;
}
window.openLifeNote=function(id,presetDate){
  var isNew=!id;
  var n=isNew?{id:"life-note-"+uid(),date:presetDate||today(),title:"",body:""}:actLifeNotes().find(function(x){return x.id===id;});
  if(!n)return;
  modal(isNew?"New journal entry":"Journal entry",''
    +'<label>Date</label><input id="ln_date" type="date" value="'+(n.date||today())+'">'
    +'<label>Title (optional)</label><input id="ln_title" value="'+esc(n.title||"")+'" placeholder="A short title">'
    +'<label>Note</label><textarea id="ln_body" rows="9" placeholder="Write freely…">'+esc(n.body||"")+'</textarea>'
    +'<button class="btn acc" style="margin-top:12px" onclick="saveLifeNote(\''+n.id+'\','+isNew+')">Save</button>'
    +(isNew?"":'<button class="btn danger" style="margin-top:10px" onclick="delLifeNote(\''+n.id+'\')">Delete</button>')
  );
};
window.saveLifeNote=function(id,isNew){
  var d=D(); if(!d.lifeNotes)d.lifeNotes=[];
  var n=isNew?{id:id}:d.lifeNotes.find(function(x){return x.id===id;});
  if(!n){closeModal();return;}
  n.date=val("ln_date")||today(); n.title=val("ln_title"); n.body=(document.getElementById("ln_body")||{}).value||"";
  if(!n.title&&!n.body.trim()){alert("Write something first.");return;}
  n.deleted=false; touch(n); if(isNew)d.lifeNotes.push(n);
  save(); closeModal(); render();
};
window.delLifeNote=function(id){
  if(!confirm("Delete this entry?"))return;
  var n=actLifeNotes().find(function(x){return x.id===id;}); if(!n)return;
  n.deleted=true; touch(n); save(); closeModal(); render();
};

/* ---------- TRACKERS — define what to track + see history ---------- */
function lifeRenderTrackers(){
  var body=document.getElementById("life_body"); if(!body)return;
  var trackers=actLifeTrackers();
  var h='<div class="secthd"><h2>Your trackers</h2><span class="ct">'+trackers.length+'</span></div>';
  h+='<p class="muted" style="margin:0 4px 8px;font-size:13px">Define anything you want to keep an eye on — a daily habit (yes/no), a number (weight, water, money saved), or a 1–5 rating (mood, energy). Log them each day on <b>Today</b>.</p>';
  h+='<button class="btn acc" style="width:100%;margin-bottom:10px" onclick="openLifeTracker(null)">＋ New tracker</button>';
  if(!trackers.length){
    h+='<div class="empty"><div class="big">📈</div>No trackers yet. Add your first — it can be anything.</div>';
  }else{
    h+='<div class="card" style="padding:6px 10px">'+trackers.map(lifeTrackerRow).join("")+'</div>';
  }
  body.innerHTML=h;
}
function lifeTrackerRow(t){
  var logs=actLifeLogs().filter(function(l){return l.trackerId===t.id&&lifeHasValue(t,l);});
  var sub=esc(lifeTypeLabel(t.type))+(t.unit?' · '+esc(t.unit):'')+' · '+logs.length+' logged';
  if(t.type==="check")sub+=' · 🔥 '+lifeStreak(t.id,today())+' day streak';
  else if(logs.length){
    var nums=logs.map(function(l){return +l.value||0;});
    var avg=nums.reduce(function(a,b){return a+b;},0)/nums.length;
    sub+=' · avg '+(Math.round(avg*10)/10);
  }
  return '<div class="li" style="align-items:flex-start;cursor:pointer" onclick="openLifeTracker(\''+t.id+'\')">'
    +'<div class="grow"><div class="nm">'+esc(t.name)+'</div><div class="sub" style="white-space:normal">'+sub+'</div></div>'
    +'<button class="btn ghost sm" style="flex:0 0 auto" onclick="event.stopPropagation();lifeHistory(\''+t.id+'\')">History</button></div>';
}
window.openLifeTracker=function(id){
  var isNew=!id;
  var t=isNew?{id:"life-trk-"+uid(),type:"check",name:"",unit:""}:actLifeTrackers().find(function(x){return x.id===id;});
  if(!t)return;
  modal(isNew?"New tracker":"Edit tracker",''
    +'<label>Name</label><input id="lt_name" value="'+esc(t.name||"")+'" placeholder="e.g. Workout · Water (oz) · Mood">'
    +'<label>Type</label><select id="lt_type">'+LIFE_TYPES.map(function(x){return '<option value="'+x.key+'" '+((t.type||"check")===x.key?"selected":"")+'>'+esc(x.label)+'</option>';}).join("")+'</select>'
    +'<div class="sub" style="margin:4px 0 8px">'+LIFE_TYPES.map(function(x){return esc(x.label.split(" / ")[0])+" — "+esc(x.hint);}).join("<br>")+'</div>'
    +'<label>Unit / label (optional)</label><input id="lt_unit" value="'+esc(t.unit||"")+'" placeholder="e.g. oz, lbs, miles, $">'
    +'<button class="btn acc" style="margin-top:12px" onclick="saveLifeTracker(\''+t.id+'\','+isNew+')">Save</button>'
    +(isNew?"":'<button class="btn danger" style="margin-top:10px" onclick="delLifeTracker(\''+t.id+'\')">Delete tracker</button>')
  );
};
window.saveLifeTracker=function(id,isNew){
  var d=D(); if(!d.lifeTrackers)d.lifeTrackers=[];
  var t=isNew?{id:id,order:actLifeTrackers().length}:d.lifeTrackers.find(function(x){return x.id===id;});
  if(!t){closeModal();return;}
  t.name=val("lt_name"); if(!t.name){alert("Give the tracker a name.");return;}
  t.type=val("lt_type")||"check"; t.unit=val("lt_unit");
  t.deleted=false; touch(t); if(isNew)d.lifeTrackers.push(t);
  save(); closeModal(); LIFE_SUB="trackers"; render();
};
window.delLifeTracker=function(id){
  if(!confirm("Delete this tracker? Its logged history stays in the data but won't show."))return;
  var t=actLifeTrackers().find(function(x){return x.id===id;}); if(!t)return;
  t.deleted=true; touch(t); save(); closeModal(); render();
};

/* history — last ~30 entries for a tracker */
window.lifeHistory=function(id){
  var t=actLifeTrackers().find(function(x){return x.id===id;}); if(!t)return;
  var logs=actLifeLogs().filter(function(l){return l.trackerId===id&&lifeHasValue(t,l);})
    .sort(function(a,b){return (b.date||"")<(a.date||"")?-1:1;}).slice(0,30);
  var rows=logs.length?logs.map(function(l){
    var v=t.type==="check"?"✓":esc(""+l.value)+(t.unit?" "+esc(t.unit):"");
    return '<div class="li"><div class="grow"><div class="nm">'+esc(fmtDate(l.date))+'</div></div><div style="font-weight:700">'+v+'</div></div>';
  }).join(""):'<div class="empty">No history yet — log it on the Today tab.</div>';
  var head='';
  if(t.type==="check")head='<div class="sub" style="margin-bottom:8px">🔥 Current streak: <b>'+lifeStreak(t.id,today())+'</b> days · '+logs.length+' days logged</div>';
  modal(esc(t.name)+" — history",head+'<div class="card" style="padding:6px 10px">'+rows+'</div>'
    +'<button class="btn ghost" style="margin-top:12px;width:100%" onclick="closeModal()">Close</button>');
};
