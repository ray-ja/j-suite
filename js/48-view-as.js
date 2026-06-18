/* ---------- VIEW-AS (owner preview of the crew / admin experience) ----------
   Lets an owner see EXACTLY what a Crew or Admin sees — nav, page access, everything — without
   logging out. Safe by construction: the role override only DOWNGRADES, and only when the REAL
   signed-in user is an owner (enforced in curRoleKey, js/32). It can never escalate access, so a
   crew device can't use it to reach owner pages. A floating pill stays visible to the real owner
   in any preview so they can always switch back. */

window.VIEW_AS = window.VIEW_AS || null;   // null = real role · "crew"/"admin" = previewing that role

/* the real signed-in role, ignoring any preview override (mirrors curRoleKey's base logic) */
function realRoleKey(){
  const u = (typeof curUser === "function") ? curUser() : null;
  if (u && u.role) return u.role;
  return (typeof hasAnyAccount === "function" && hasAnyAccount()) ? "__nosession__" : "owner";
}
/* previewable roles: real owner view + every non-owner role from the roles config */
function viewAsRoleList(){
  const keys = (typeof allRoles === "function") ? allRoles().map(r => r.key) : ["owner","admin","crew"];
  return ["owner", ...keys.filter(k => k && k !== "owner")];
}
function viewAsLabel(){
  const cur = window.VIEW_AS || "owner";
  const r = (typeof roleByKey === "function") ? roleByKey(cur) : null;
  return (r && r.label) ? r.label : cur.charAt(0).toUpperCase() + cur.slice(1);
}
window.setViewAs = function(role){ window.VIEW_AS = (!role || role === "owner") ? null : role; if (typeof render === "function") render(); };
window.cycleViewAs = function(){ const m = viewAsRoleList(), cur = window.VIEW_AS || "owner", i = m.indexOf(cur); window.setViewAs(m[(i + 1) % m.length]); };

function renderViewAsPill(){
  const ownerReal = realRoleKey() === "owner";
  let pill = document.getElementById("viewaspill");
  if (!ownerReal){ if (pill) pill.remove(); if (window.VIEW_AS) window.VIEW_AS = null; return; }   // only real owners get the toggle; never leave a non-owner stuck in preview
  const wizOpen = document.body.classList.contains("wizon");
  if (wizOpen){ if (pill) pill.style.display = "none"; return; }                                   // stay out of the way of the wizard's sticky footer
  if (!pill){ pill = document.createElement("button"); pill.id = "viewaspill"; pill.type = "button"; pill.onclick = window.cycleViewAs; document.body.appendChild(pill); }
  pill.style.display = "";
  const previewing = !!window.VIEW_AS;
  pill.textContent = previewing ? ("👁 Viewing as " + viewAsLabel() + " — tap to switch") : "👁 Owner view — tap to preview crew";
  pill.setAttribute("style", "position:fixed;left:50%;transform:translateX(-50%);bottom:72px;z-index:40;border:none;border-radius:18px;padding:8px 15px;font:700 12px system-ui,-apple-system,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.28);max-width:92vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" + (previewing ? "background:#e0a800;color:#1a1a1a" : "background:var(--accent,#1B2A4E);color:#fff"));
}

/* refresh the pill after every render, without editing routing: wrap the global render once */
(function(){
  if (typeof window.render === "function" && !window.__viewAsWrapped){
    const _render = window.render;
    window.render = function(){ const out = _render.apply(this, arguments); try{ renderViewAsPill(); }catch(e){} return out; };
    window.__viewAsWrapped = true;
  }
})();
/* first paint (boot calls render() too, but cover the file:// / late-load cases) */
if (typeof document !== "undefined"){
  if (document.readyState !== "loading") setTimeout(function(){ try{ renderViewAsPill(); }catch(e){} }, 0);
  else document.addEventListener("DOMContentLoaded", function(){ try{ renderViewAsPill(); }catch(e){} });
}
