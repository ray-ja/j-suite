/* ---------- ESCAPE-ROOM GAME SCHEDULER — glanceable room-status board ----------
   An org-specific tool (gated by the Phase-5 per-org tool system → only shows where enabled, on the
   "Bookings" template). Built for an escape-room business: ONE GAME PER ROOM (each physical room = one
   fixed game), shown as a ROOMS × SESSION-SLOTS grid for a chosen day, big enough to sit open on a
   tablet/computer at the front desk and auto-update via the sync layer so every screen reflects a change
   the moment it lands ("this room just got booked — you're running it").

   DATA (two new synced collections, per-record last-write-wins like everything else):
     escapeRooms    {id, name, color, order, deleted, updatedAt}                       — room config (= the game)
     escapeBookings {id, roomId, date:"YYYY-MM-DD", slot:"HH:MM", status, party,       — one booked/blocked slot
                     players, guideId, offSlot:bool, note, deleted, updatedAt}
   A booking is keyed by (roomId,date,slot); an off-slot one-off carries offSlot:true and its own slot time.
   Session START-TIMES are a small org-settings array (registry[org].settings.escapeSlots = ["HH:MM",…]),
   which already rides the registry's LWW sync — no third collection needed.

   MANUAL entry for now, but the booking record is modeled so a future booking feed could upsert by
   (roomId,date,slot) with a stable id and let LWW reconcile. */

/* status vocabulary — keep these glanceable + color-coded */
var ESC_STATUSES = [
  {key:"open",        label:"Open",        emoji:"⚪", col:"#9aa6b2"},
  {key:"booked",      label:"Booked",      emoji:"🔵", col:"#2563eb"},
  {key:"in-progress", label:"In progress", emoji:"🟢", col:"#16a34a"},
  {key:"done",        label:"Done",        emoji:"⚫", col:"#6b7280"},
  {key:"blocked",     label:"Blocked",     emoji:"⛔", col:"#c0392b"}
];
function escStatus(key){ return ESC_STATUSES.find(function(s){return s.key===key;}) || ESC_STATUSES[0]; }
var ESC_DEFAULT_SLOTS = ["10:00","11:30","13:00","14:30","16:00","17:30","19:00","20:30"];

/* ---- accessors ---- */
function escRooms(){ return (D().escapeRooms||[]).filter(function(r){return !r.deleted;})
  .sort(function(a,b){ return (a.order||0)-(b.order||0) || (a.name||"").localeCompare(b.name||""); }); }
function escBookings(){ return (D().escapeBookings||[]).filter(function(b){return !b.deleted;}); }
function escSlots(){
  var r=(S.registry||[]).find(function(x){return x&&x.id===S.biz;});
  var s=r&&r.settings&&Array.isArray(r.settings.escapeSlots)?r.settings.escapeSlots:null;
  return (s&&s.length?s.slice():ESC_DEFAULT_SLOTS.slice()).sort();
}
function escSetSlots(arr){
  var r=(S.registry||[]).find(function(x){return x&&x.id===S.biz;});
  if(!r){ alert("This org has no registry record yet."); return; }
  r.settings=r.settings||{}; r.settings.escapeSlots=arr.slice(); r.updatedAt=now();
  save(); if(typeof scheduleAutoPush==="function")scheduleAutoPush();
}
/* the booking for a room+date+slot (regular grid cell), if any */
function escBookingAt(roomId,date,slot){ return escBookings().find(function(b){
  return !b.offSlot && b.roomId===roomId && b.date===date && b.slot===slot; }); }
/* off-slot one-offs for a room on a date */
function escOffSlotsFor(roomId,date){ return escBookings().filter(function(b){
  return b.offSlot && b.roomId===roomId && b.date===date; })
  .sort(function(a,b){return (a.slot||"").localeCompare(b.slot||"");}); }

/* crew of the active org = the assignable guides (active members of this org) */
function escGuides(){
  if(typeof orgMembers==="function" && S.biz) {
    var m=orgMembers(S.biz).filter(function(u){return u.active!==false;});
    if(m.length) return m;
  }
  return (typeof users==="function"?users():[]).filter(function(u){return u.active!==false;});
}
function escGuideName(id){ if(!id)return ""; var u=(S.users||[]).find(function(x){return x&&x.id===id;}); return u?(u.username||""):""; }

/* ---- tab state ---- */
var ESC_DATE=null;     // YYYY-MM-DD board date
var ESC_VIEW="board";  // "board" | "rooms" | "times"
window.escSetView=function(v){ ESC_VIEW=v; render(); };
window.escSetDate=function(v){ ESC_DATE=v||today(); render(); };
window.escDateShift=function(n){ var d=new Date((ESC_DATE||today())+"T00:00:00"); d.setDate(d.getDate()+n);
  ESC_DATE=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); render(); };

function escCanEdit(){ return (typeof canSee==="function")?canSee("escape"):true; }   // any role that can see the tab can run the board
function escIsOwner(){ return (typeof isOwner==="function")?isOwner():true; }          // config (rooms/times) is owner-only

/* ---------- main render ---------- */
function rEscape(){
  var owner=escIsOwner();
  var sub='<div class="subnav">'
    +'<button class="subbtn '+(ESC_VIEW==="board"?"on":"")+'" onclick="escSetView(\'board\')">🚪 Board</button>'
    +(owner?'<button class="subbtn '+(ESC_VIEW==="rooms"?"on":"")+'" onclick="escSetView(\'rooms\')">Rooms</button>'
      +'<button class="subbtn '+(ESC_VIEW==="times"?"on":"")+'" onclick="escSetView(\'times\')">Session times</button>':"")
    +'</div>';
  if(ESC_VIEW==="rooms"&&owner){ view.innerHTML=sub+'<div id="esc_body"></div>'; escRenderRooms(); return; }
  if(ESC_VIEW==="times"&&owner){ view.innerHTML=sub+'<div id="esc_body"></div>'; escRenderTimes(); return; }
  view.innerHTML=sub+'<div id="esc_body"></div>'; escRenderBoard();
}

/* ---------- the BOARD — rooms × slots for the chosen day ---------- */
function escRenderBoard(){
  var body=document.getElementById("esc_body"); if(!body)return;
  var date=ESC_DATE||(ESC_DATE=today());
  var rooms=escRooms(), slots=escSlots();

  var head='<div class="card" style="padding:10px 12px">'
    +'<div class="row" style="align-items:center;gap:8px">'
      +'<button class="btn ghost sm" onclick="escDateShift(-1)" style="flex:0 0 auto">‹</button>'
      +'<input type="date" value="'+esc(date)+'" onchange="escSetDate(this.value)" style="flex:1;min-width:120px">'
      +'<button class="btn ghost sm" onclick="escDateShift(1)" style="flex:0 0 auto">›</button>'
      +'<button class="btn ghost sm" onclick="escSetDate(\''+today()+'\')" style="flex:0 0 auto">Today</button>'
    +'</div>'
    +'<div class="sub" style="margin-top:6px">'+(typeof DOW!=="undefined"?DOW[dowOf(date)]+" · ":"")+fmtDate(date)+' — '+rooms.length+' room'+(rooms.length===1?"":"s")+' · tap a slot to set it</div>'
    +'</div>';

  if(!rooms.length){
    body.innerHTML=head+'<div class="empty"><div class="big">🚪</div>No rooms yet.'
      +(escIsOwner()?' Use <b>Rooms</b> above to add your escape rooms.':' Ask an owner to add rooms.')+'</div>';
    return;
  }

  // legend
  var legend='<div style="display:flex;flex-wrap:wrap;gap:8px;margin:8px 4px 10px">'
    +ESC_STATUSES.map(function(s){return '<span style="font-size:12px;color:var(--muted)"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+s.col+';margin-right:4px;vertical-align:middle"></span>'+esc(s.label)+'</span>';}).join("")
    +'</div>';

  // one column-block per room (stacks naturally on a phone, sits side-by-side wide on a tablet/desktop)
  var html='<div class="esc-grid" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start">';
  rooms.forEach(function(room){
    var col=room.color||"var(--brand)";
    html+='<div class="card" style="flex:1 1 280px;min-width:260px;padding:0;overflow:hidden;border-top:5px solid '+esc(col)+'">'
      +'<div style="padding:10px 12px;font-weight:800;font-size:16px;display:flex;justify-content:space-between;align-items:center">'
        +'<span>'+esc(room.name||"(room)")+'</span>'
        +'<button class="btn ghost sm" onclick="escAddOffSlot(\''+room.id+'\')" title="Add a one-off game outside the fixed slots">+ off-slot</button>'
      +'</div>';
    slots.forEach(function(slot){
      html+=escCellHtml(room,date,slot,escBookingAt(room.id,date,slot),false);
    });
    var offs=escOffSlotsFor(room.id,date);
    if(offs.length){
      html+='<div class="sub" style="padding:6px 12px 2px;font-weight:700;color:var(--ink)">Off-slot</div>';
      offs.forEach(function(b){ html+=escCellHtml(room,date,b.slot,b,true); });
    }
    html+='</div>';
  });
  html+='</div>';
  body.innerHTML=head+legend+html;
}

function escCellHtml(room,date,slot,b,isOff){
  var st=escStatus(b?b.status:"open");
  var me=(typeof curUser==="function")?curUser():null;
  var guide=b&&b.guideId?escGuideName(b.guideId):"";
  var party=b&&b.party?b.party:"";
  var players=b&&b.players?b.players:"";
  // a glanceable row: time chip · status dot · party/players · guide
  var bg = b && b.status && b.status!=="open" ? "background:linear-gradient(90deg,"+st.col+"14,transparent)" : "";
  var click="escOpenSlot('"+room.id+"','"+date+"','"+esc(slot)+"',"+(b?"'"+b.id+"'":"null")+")";
  var unassigned = b && (b.status==="booked"||b.status==="in-progress") && !b.guideId;
  var h='<div class="esc-cell" style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-top:1px solid var(--line);cursor:pointer;'+bg+'" onclick="'+click+'">'
    +'<span style="flex:0 0 auto;font-weight:800;font-size:13px;min-width:48px">'+esc(slot)+(isOff?' <span style="font-weight:600;color:var(--muted)">•</span>':"")+'</span>'
    +'<span style="flex:0 0 auto;width:11px;height:11px;border-radius:50%;background:'+st.col+'" title="'+esc(st.label)+'"></span>'
    +'<div style="flex:1;min-width:0">';
  if(party||players){
    h+='<div class="nm" style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(party||"—")
      +(players?' <span style="color:var(--muted);font-weight:600">· '+esc(players)+'p</span>':"")+'</div>';
  }else{
    h+='<div class="nm" style="font-size:14px;color:var(--muted);font-weight:600">'+esc(st.label)+'</div>';
  }
  h+='<div class="sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'
    +(guide?'👤 '+esc(guide):(unassigned?'<span style="color:var(--danger);font-weight:700">⚠ no guide</span>':'<span style="color:var(--muted)">unassigned</span>'))
    +'</div></div>';
  // quick self-assign chip when there's a real booking, no guide, and I'm a known user
  if(me && b && !b.guideId && b.status!=="done" && b.status!=="open"){
    h+='<button class="btn acc sm" style="flex:0 0 auto" onclick="event.stopPropagation();escSelfAssign(\''+b.id+'\')">I\'ve got it</button>';
  }
  h+='</div>';
  return h;
}

/* ---------- tap a slot → set status / party / players / guide ---------- */
window.escOpenSlot=function(roomId,date,slot,bid){
  if(!escCanEdit())return;
  var room=escRooms().find(function(r){return r.id===roomId;});
  var b=bid?escBookings().find(function(x){return x.id===bid;}):null;
  var isOff=!!(b&&b.offSlot);
  var cur=b?b.status:"open";
  var statusBtns=ESC_STATUSES.map(function(s){
    return '<label style="cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:7px 11px;border-radius:16px;font-size:13px;font-weight:700;background:'+(s.key===cur?s.col:"var(--soft)")+';color:'+(s.key===cur?"#fff":"var(--ink)")+';border:1px solid var(--line)">'
      +'<input type="radio" name="esc_status" value="'+s.key+'" '+(s.key===cur?"checked":"")+' style="width:auto;margin:0">'+s.emoji+' '+esc(s.label)+'</label>';
  }).join(" ");
  var guideOpts='<option value="">— unassigned —</option>'+escGuides().map(function(u){
    return '<option value="'+u.id+'" '+(b&&b.guideId===u.id?"selected":"")+'>'+esc(u.username||"")+'</option>';
  }).join("");
  var me=(typeof curUser==="function")?curUser():null;
  modal((room?esc(room.name):"Slot")+" · "+esc(slot),''
    +'<div class="sub" style="margin-bottom:8px">'+fmtDate(date)+(isOff?" · off-slot one-off":"")+'</div>'
    +(isOff?'<label>Start time</label><input id="esc_slot" type="time" value="'+esc(slot)+'">':"")
    +'<label>Status</label><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">'+statusBtns+'</div>'
    +'<label>Party name</label><input id="esc_party" value="'+(b?esc(b.party||""):"")+'" placeholder="e.g. Miller birthday">'
    +'<div class="row" style="gap:8px"><div class="grow"><label># Players</label><input id="esc_players" inputmode="numeric" value="'+(b?esc(b.players||""):"")+'" placeholder="e.g. 6"></div>'
      +'<div class="grow"><label>Game guide</label><select id="esc_guide">'+guideOpts+'</select></div></div>'
    +'<label>Note (optional)</label><input id="esc_note" value="'+(b?esc(b.note||""):"")+'" placeholder="waiver done, late, etc.">'
    +(me?'<button class="btn ghost" style="margin-top:10px" onclick="escAssignSelfInModal()">👤 Assign me as guide</button>':"")
    +'<button class="btn acc" style="margin-top:12px" onclick="escSaveSlot(\''+roomId+'\',\''+date+'\',\''+esc(slot)+'\','+(b?"'"+b.id+"'":"null")+','+isOff+')">Save</button>'
    +(b?'<button class="btn ghost" style="margin-top:10px" onclick="escClearSlot(\''+b.id+'\','+isOff+')">'+(isOff?"Delete this off-slot game":"Clear back to open")+'</button>':"")
  );
};
window.escAssignSelfInModal=function(){ var me=(typeof curUser==="function")?curUser():null; if(!me)return;
  var sel=document.getElementById("esc_guide"); if(sel)sel.value=me.id; };

window.escSaveSlot=function(roomId,date,slot,bid,isOff){
  var d=D(); if(!d.escapeBookings)d.escapeBookings=[];
  var status=(document.querySelector('input[name="esc_status"]:checked')||{}).value||"open";
  var party=val("esc_party"), players=val("esc_players"), note=val("esc_note");
  var guideId=(document.getElementById("esc_guide")||{}).value||"";
  if(isOff){ var t=val("esc_slot"); if(t)slot=t; }
  var b=bid?d.escapeBookings.find(function(x){return x.id===bid;}):null;
  // an "open" regular slot with nothing on it doesn't need a record — clear it instead of storing an empty
  if(!b && !isOff && status==="open" && !party && !players && !guideId && !note){ closeModal(); render(); return; }
  if(!b){
    // STABLE id for regular slots (room|date|slot) so two devices booking the same cell dedupe via LWW;
    // off-slot one-offs get a unique id (multiple per slot are allowed).
    var id=isOff?("ebk-off-"+uid()):("ebk-"+roomId+"-"+date+"-"+slot);
    b=d.escapeBookings.find(function(x){return x.id===id;});   // resurrect a previously-cleared regular slot
    if(!b){ b={id:id,roomId:roomId,date:date,slot:slot,offSlot:!!isOff,updatedAt:now()}; d.escapeBookings.push(b); }
    else { b.deleted=false; }
  }
  b.roomId=roomId; b.date=date; b.slot=slot; b.status=status;
  b.party=party; b.players=players; b.guideId=guideId; b.note=note; b.offSlot=!!isOff;
  touch(b); save(); closeModal();
  if(typeof logEvent==="function"){ var rm=escRooms().find(function(r){return r.id===roomId;}); logEvent((escStatus(status).label)+" — "+(rm?rm.name:"room")+" "+slot+(party?" ("+party+")":""),"escape"); }
  render();
};
window.escClearSlot=function(bid,isOff){
  var b=escBookings().find(function(x){return x.id===bid;}); if(!b)return;
  if(isOff){ if(!confirm("Delete this off-slot game?"))return; b.deleted=true; }
  else { b.status="open"; b.party=""; b.players=""; b.guideId=""; b.note=""; }
  touch(b); save(); closeModal(); render();
};
/* one-tap "I've got it" from the board */
window.escSelfAssign=function(bid){
  var me=(typeof curUser==="function")?curUser():null; if(!me){ alert("Sign in to self-assign."); return; }
  var b=escBookings().find(function(x){return x.id===bid;}); if(!b)return;
  b.guideId=me.id; if(b.status==="open")b.status="booked"; touch(b); save();
  if(typeof logEvent==="function")logEvent((me.username||"Someone")+" took "+b.slot,"escape");
  render();
};
/* off-slot one-off — opens a fresh slot editor for a room (room optional → prompt to pick) */
window.escAddOffSlot=function(roomId){
  if(!escCanEdit())return;
  var rooms=escRooms();
  if(!rooms.length){ alert("Add a room first (Rooms tab)."); return; }
  var date=ESC_DATE||today();
  if(!roomId){
    if(rooms.length===1){ roomId=rooms[0].id; }
    else {
      var opts=rooms.map(function(r){return '<button class="btn ghost" style="margin-top:8px;width:100%" onclick="closeModal();escAddOffSlot(\''+r.id+'\')">'+esc(r.name)+'</button>';}).join("");
      modal("Off-slot game — pick a room",'<div class="sub" style="margin-bottom:4px">Add a one-off game outside the fixed session times.</div>'+opts);
      return;
    }
  }
  // open the off-slot editor pre-set to "now" rounded down to the half hour
  var d=new Date(); var hh=String(d.getHours()).padStart(2,"0"), mm=d.getMinutes()<30?"00":"30";
  escOpenOffSlot(roomId,date,hh+":"+mm);
};
/* dedicated off-slot editor (isOff=true path of escOpenSlot, but with no existing booking) */
window.escOpenOffSlot=function(roomId,date,slot){
  var room=escRooms().find(function(r){return r.id===roomId;});
  var statusBtns=ESC_STATUSES.map(function(s){
    return '<label style="cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:7px 11px;border-radius:16px;font-size:13px;font-weight:700;background:'+(s.key==="booked"?s.col:"var(--soft)")+';color:'+(s.key==="booked"?"#fff":"var(--ink)")+';border:1px solid var(--line)">'
      +'<input type="radio" name="esc_status" value="'+s.key+'" '+(s.key==="booked"?"checked":"")+' style="width:auto;margin:0">'+s.emoji+' '+esc(s.label)+'</label>';
  }).join(" ");
  var guideOpts='<option value="">— unassigned —</option>'+escGuides().map(function(u){
    return '<option value="'+u.id+'">'+esc(u.username||"")+'</option>';
  }).join("");
  var me=(typeof curUser==="function")?curUser():null;
  modal((room?esc(room.name):"Room")+" · off-slot game",''
    +'<div class="sub" style="margin-bottom:8px">'+fmtDate(date)+' · a one-off game outside the fixed session times</div>'
    +'<label>Start time</label><input id="esc_slot" type="time" value="'+esc(slot)+'">'
    +'<label>Status</label><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">'+statusBtns+'</div>'
    +'<label>Party name</label><input id="esc_party" placeholder="e.g. Walk-in group">'
    +'<div class="row" style="gap:8px"><div class="grow"><label># Players</label><input id="esc_players" inputmode="numeric" placeholder="e.g. 4"></div>'
      +'<div class="grow"><label>Game guide</label><select id="esc_guide">'+guideOpts+'</select></div></div>'
    +'<label>Note (optional)</label><input id="esc_note" placeholder="walk-in, etc.">'
    +(me?'<button class="btn ghost" style="margin-top:10px" onclick="escAssignSelfInModal()">👤 Assign me as guide</button>':"")
    +'<button class="btn acc" style="margin-top:12px" onclick="escSaveSlot(\''+roomId+'\',\''+date+'\',\''+esc(slot)+'\',null,true)">Add game</button>'
  );
};

/* ---------- ROOMS config (owner) ---------- */
var ESC_COLORS=["#1B2A4E","#0099e5","#16a34a","#c0392b","#b8860b","#8e44ad","#0070b8","#5d4037"];
function escRenderRooms(){
  var body=document.getElementById("esc_body"); if(!body)return;
  var rooms=escRooms();
  var h='<div class="secthd"><h2>Rooms</h2><span class="ct">'+rooms.length+'</span></div>'
    +'<p class="muted" style="margin:0 4px 8px;font-size:13px">Each room = one fixed game. These are the rows on the board.</p>'
    +'<button class="btn acc" style="margin-bottom:10px" onclick="escOpenRoom(null)">+ Add room</button>';
  if(!rooms.length){ body.innerHTML=h+'<div class="empty">No rooms yet.</div>'; return; }
  h+='<div class="card" style="padding:6px 10px">'+rooms.map(function(r){
    return '<div class="li" onclick="escOpenRoom(\''+r.id+'\')">'
      +'<span style="flex:0 0 auto;width:14px;height:14px;border-radius:4px;background:'+esc(r.color||"var(--brand)")+'"></span>'
      +'<div class="grow"><div class="nm">'+esc(r.name||"(room)")+'</div></div>'
      +'<span class="sub" style="flex:0 0 auto">edit ›</span></div>';
  }).join("")+'</div>';
  body.innerHTML=h;
}
window.escOpenRoom=function(id){
  if(!escIsOwner())return;
  var isNew=!id;
  var r=isNew?{id:"erm-"+uid(),name:"",color:ESC_COLORS[escRooms().length%ESC_COLORS.length],order:escRooms().length}:escRooms().find(function(x){return x.id===id;});
  if(!r)return;
  var swatches=ESC_COLORS.map(function(c){
    return '<label style="cursor:pointer"><input type="radio" name="esc_rcolor" value="'+c+'" '+((r.color||ESC_COLORS[0])===c?"checked":"")+' style="display:none">'
      +'<span style="display:inline-block;width:30px;height:30px;border-radius:8px;background:'+c+';border:3px solid '+((r.color||ESC_COLORS[0])===c?"var(--ink)":"transparent")+'" onclick="this.previousElementSibling.checked=true;Array.prototype.forEach.call(this.parentNode.parentNode.querySelectorAll(\'span\'),function(s){s.style.borderColor=\'transparent\'});this.style.borderColor=\'var(--ink)\'"></span></label>';
  }).join(" ");
  modal(isNew?"Add room":"Edit room",''
    +'<label>Room / game name</label><input id="esc_rname" value="'+esc(r.name||"")+'" placeholder="e.g. The Heist">'
    +'<label>Color</label><div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">'+swatches+'</div>'
    +'<label>Order (lower = first)</label><input id="esc_rorder" inputmode="numeric" value="'+esc(r.order!=null?r.order:0)+'">'
    +'<button class="btn acc" style="margin-top:12px" onclick="escSaveRoom(\''+r.id+'\','+isNew+')">Save</button>'
    +(isNew?"":'<button class="btn danger" style="margin-top:10px" onclick="escDelRoom(\''+r.id+'\')">Delete room</button>')
  );
};
window.escSaveRoom=function(id,isNew){
  var d=D(); if(!d.escapeRooms)d.escapeRooms=[];
  var r=isNew?{id:id,updatedAt:now()}:d.escapeRooms.find(function(x){return x.id===id;});
  if(!r){closeModal();return;}
  r.name=val("esc_rname"); if(!r.name){alert("Name the room.");return;}
  r.color=(document.querySelector('input[name="esc_rcolor"]:checked')||{}).value||ESC_COLORS[0];
  r.order=parseInt(val("esc_rorder"),10)||0;
  touch(r); if(isNew)d.escapeRooms.push(r);
  save(); closeModal(); render();
};
window.escDelRoom=function(id){
  if(!confirm("Delete this room? Its bookings stay in history but it leaves the board."))return;
  var r=escRooms().find(function(x){return x.id===id;}); if(!r)return;
  r.deleted=true; touch(r); save(); closeModal(); render();
};

/* ---------- SESSION TIMES config (owner) ---------- */
function escRenderTimes(){
  var body=document.getElementById("esc_body"); if(!body)return;
  var slots=escSlots();
  var h='<div class="secthd"><h2>Session start times</h2><span class="ct">'+slots.length+'</span></div>'
    +'<p class="muted" style="margin:0 4px 8px;font-size:13px">The fixed session slots shown for every room, every day. (One-off games outside these are added per-room from the board.)</p>'
    +'<div class="card" style="padding:6px 10px">'+slots.map(function(s){
      return '<div class="li"><div class="grow"><div class="nm">'+esc(s)+'</div></div>'
        +'<button class="btn ghost sm" style="flex:0 0 auto" onclick="escDelTime(\''+esc(s)+'\')">remove</button></div>';
    }).join("")+'</div>'
    +'<div class="card"><label>Add a start time</label>'
      +'<div class="row" style="gap:8px"><input id="esc_newtime" type="time" style="flex:1"><button class="btn acc" style="flex:0 0 auto" onclick="escAddTime()">Add</button></div></div>'
    +'<button class="btn ghost" onclick="escResetTimes()">Reset to defaults</button>';
  body.innerHTML=h;
}
window.escAddTime=function(){ var t=val("esc_newtime"); if(!t)return;
  var s=escSlots(); if(s.indexOf(t)<0)s.push(t); escSetSlots(s); render(); };
window.escDelTime=function(t){ escSetSlots(escSlots().filter(function(s){return s!==t;})); render(); };
window.escResetTimes=function(){ if(!confirm("Reset session times to the defaults?"))return; escSetSlots(ESC_DEFAULT_SLOTS.slice()); render(); };
