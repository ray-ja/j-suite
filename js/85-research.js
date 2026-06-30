/* ---------- RESEARCH LIBRARY (Data → Research) ----------
   A living library of research notes / reference docs the owner keeps (crew-comp now; mileage, pricing, etc.
   later). Backed by the per-org synced `research` collection (js/02 blank/load + server COLLECTIONS), riding
   per-record LWW + org isolation like every other collection. Record shape:
     { id, title, body, tags?, createdBy, updatedAt, deleted }
   ACCESS: this is reference/admin content (the seeded crew-comp note discusses pay + equity), so the tab is
   gated owner/admin in the role map (js/32 ADMIN_PAGES / CREW_PAGES — crew never sees it). Add/edit/delete are
   further restricted to owner/admin via researchCanEdit(). The reader is mobile-first — the owner may hand it
   to a friend or an attorney. body is longform text (headings / bullets / paragraphs); we preserve line breaks
   and basic structure, escaping all HTML. */

let RESEARCH_OPEN = null;   // id of the note being READ (null = the list)

function actResearch(){ return (D().research||[]).filter(r=>r&&!r.deleted); }
function researchCanEdit(){
  // owner/admin only — gate via the existing role helpers (owner = all; admin = its page set includes research)
  if(typeof isOwner==="function" && isOwner()) return true;
  if(typeof curRoleKey==="function" && typeof roleActionAllows==="function"){
    // a manager-tier role (admin/manager) that can manage members is treated as admin here
    if(roleActionAllows(curRoleKey(),"manage-members")) return true;
  }
  if(typeof canSee==="function") return canSee("research");   // fallback: visibility implies edit for this admin-only page
  return false;
}

/* render the longform body readably: escape HTML first, then keep paragraph + line-break structure and lightly
   emphasize ALL-CAPS heading lines so it reads cleanly on a phone. No HTML from the data is ever trusted. */
function researchRenderBody(body){
  const safe = esc(body||"");
  return safe.split(/\n{2,}/).map(function(block){
    const lines = block.split("\n").map(function(ln){
      const t = ln.trim();
      // a short ALL-CAPS line with no lowercase letters reads as a heading
      if(t && t.length<=80 && !/[a-z]/.test(t) && /[A-Z]/.test(t)) return '<b>'+ln+'</b>';
      return ln;
    });
    return '<p style="margin:0 0 12px;white-space:pre-wrap;line-height:1.5">'+lines.join("\n")+'</p>';
  }).join("");
}

function researchSnippet(body){
  const t = (body||"").replace(/\s+/g," ").trim();
  return t.length>140 ? t.slice(0,140)+"…" : t;
}

function rResearch(){
  const canEdit = researchCanEdit();
  // READ view — a single note rendered for reading
  if(RESEARCH_OPEN){
    const note = (D().research||[]).find(r=>r&&r.id===RESEARCH_OPEN && !r.deleted);
    if(!note){ RESEARCH_OPEN=null; return rResearch(); }
    let h = `<div class="secthd"><button class="btn ghost sm" onclick="researchBack()">← Back</button>`
      + (canEdit?`<button class="btn acc sm" style="margin-left:auto" onclick="researchEdit('${note.id}')">Edit</button>`:``)
      + `</div>`;
    h += `<div class="card">`
      + `<h2 style="margin:0 0 6px;white-space:normal;font-size:20px">${esc(note.title||"(untitled)")}</h2>`
      + (note.tags?`<div class="sub" style="color:var(--brand-text);white-space:normal;margin-bottom:10px">${esc(note.tags)}</div>`:``)
      + `<div class="sub" style="margin-bottom:12px">${typeof relTime==="function"?("Updated "+relTime(note.updatedAt)):""}</div>`
      + `<div class="readbody" style="font-size:15px">${researchRenderBody(note.body)}</div>`
      + `</div>`;
    view.innerHTML = h;
    return;
  }
  // LIST view — newest first, title + snippet
  let list = actResearch().slice().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  let h = `<div class="secthd"><h2>📚 Research</h2>`
    + (canEdit?`<button class="btn acc sm" style="margin-left:auto" onclick="researchAdd()">+ Note</button>`:``)
    + `</div>`;
  h += `<div class="card" style="background:var(--soft)"><div class="sub">Research notes &amp; reference docs — the living library. Tap a note to read it. Reference only, not legal or tax advice.</div></div>`;
  h += list.length
    ? `<div class="card">`+list.map(function(r){
        return `<div class="li" onclick="researchOpen('${r.id}')"><div class="grow">`
          + `<div class="nm" style="font-size:16px;white-space:normal">${esc(r.title||"(untitled)")}</div>`
          + `<div class="sub" style="white-space:normal">${esc(researchSnippet(r.body))}</div>`
          + (r.tags?`<div class="sub" style="color:var(--brand-text);white-space:normal">${esc(r.tags)}</div>`:``)
          + `</div></div>`;
      }).join("")+`</div>`
    : `<div class="empty">No research notes yet.${canEdit?` Tap <b>+ Note</b> to add one.`:``}</div>`;
  view.innerHTML = h;
}

window.researchOpen = function(id){ RESEARCH_OPEN=id; if(typeof render==="function")render(); window.scrollTo&&window.scrollTo(0,0); };
window.researchBack = function(){ RESEARCH_OPEN=null; if(typeof render==="function")render(); };
window.researchAdd  = function(){ if(!researchCanEdit())return; researchForm(null); };
window.researchEdit = function(id){ if(!researchCanEdit())return; researchForm((D().research||[]).find(r=>r&&r.id===id)); };

function researchForm(note){
  modal(note?"Edit note":"Add a note",`
    <label>Title</label><input id="rs_title" value="${note?esc(note.title||""):""}" placeholder="e.g. Adding crew — comp & legal options" autocomplete="off">
    <label>Body</label><textarea id="rs_body" style="min-height:240px" placeholder="Longform notes — headings, bullets, paragraphs. Line breaks are preserved.">${note?esc(note.body||""):""}</textarea>
    <label>Tags (optional, comma-separated)</label><input id="rs_tags" value="${note?esc(note.tags||""):""}" placeholder="crew, comp, legal" autocomplete="off">
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="researchSave('${note?note.id:""}')">Save</button>
    ${note?`<button class="btn ghost sm" style="margin-top:8px;width:100%;color:var(--danger)" onclick="researchDel('${note.id}')">Delete</button>`:""}`);
}

window.researchSave = function(id){
  if(!researchCanEdit()){ alert("Only an owner or admin can edit research notes."); return; }
  const title=val("rs_title"), tags=val("rs_tags");
  const bodyEl=document.getElementById("rs_body"); const body=bodyEl?bodyEl.value.trim():"";
  if(!title){ alert("Give the note a title."); return; }
  if(!body){ alert("Type the note body."); return; }
  const d=D(); if(!Array.isArray(d.research))d.research=[];
  let r=id?d.research.find(x=>x&&x.id===id):null;
  if(!r){ r={id:uid(),createdBy:(typeof curUser==="function"&&curUser())?curUser().id:""}; d.research.push(r); }
  r.title=title; r.body=body; r.tags=tags; r.deleted=false; r.updatedAt=now();
  if(typeof touch==="function")touch(r); save();
  RESEARCH_OPEN=r.id;
  if(typeof closeModal==="function")closeModal(); if(typeof render==="function")render();
};

window.researchDel = function(id){
  if(!researchCanEdit()){ alert("Only an owner or admin can delete research notes."); return; }
  const d=D(); const r=(d.research||[]).find(x=>x&&x.id===id); if(!r)return;
  if(!confirm("Delete this research note?"))return;
  r.deleted=true; r.updatedAt=now(); if(typeof touch==="function")touch(r); save();
  RESEARCH_OPEN=null;
  if(typeof closeModal==="function")closeModal(); if(typeof render==="function")render();
};
