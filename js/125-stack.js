/* ---------- THE STACK (js/125) — what he takes, and why ---------------------------------------------
   Ray, 2026-08-04: "you can add this info to my personal app section. So I take supplements…"

   REFERENCE, NOT AN ADHERENCE TRACKER. He said of his vitamin D: "I take it most days, but not every day."
   Building a daily checkbox out of that turns an honest remark into a visible failure every time he opens the
   app — the same guilt machine that had to come out of his check-in thread, and the same reason the Shelf has
   no unread count. So: no streaks, no "taken today", no compliance percentage, nothing aggregated. Just a clear
   record of the stack, its doses, and what each item is for, that he can read and edit.

   Stored on a `docs` record (personalStack) — an existing synced collection, so no new collection and no
   migration. Shown on the Life tab; fed to the companion so it can talk about it without chasing him. */

function stackDoc() {
  var d = D(); d.docs = d.docs || [];
  var t = d.docs.find(function (x) { return x && x.id === "personalStack"; });
  if (!t) { t = { id: "personalStack", list: [], updatedAt: (typeof now === "function") ? now() : Date.now() }; d.docs.push(t); }
  if (!Array.isArray(t.list)) t.list = [];
  return t;
}
function actStack() { return stackDoc().list.filter(function (x) { return x && !x.deleted; }); }

function stackLine(x) {
  return [x.name, x.dose].filter(Boolean).join(" · ");
}
function stackListHTML() {
  var list = actStack();
  if (!list.length) return '<div class="muted" style="font-size:13px">Nothing listed.</div>';
  return list.map(function (x) {
    return '<div class="row" style="gap:6px;align-items:flex-start;margin-top:6px">'
      + '<div class="grow"><div style="font-size:13.5px;font-weight:700">' + esc(stackLine(x)) + '</div>'
      + (x.brand ? '<div class="sub" style="font-size:11px">' + esc(x.brand) + '</div>' : '')
      + (x.when ? '<div class="sub" style="font-size:11px">' + esc(x.when) + '</div>' : '')
      + (x.why ? '<div class="sub" style="white-space:normal;margin-top:2px">' + esc(x.why) + '</div>' : '')
      + '</div><button class="btn ghost sm" onclick="stackDel(\'' + x.id + '\')">✕</button></div>';
  }).join("");
}
function stackRefresh() { var el = document.getElementById("stack_list"); if (el) el.innerHTML = stackListHTML(); }

/* the card on the Life tab */
function stackCardHTML() {
  var list = actStack();
  return '<div class="card"><div class="row" style="gap:8px;align-items:flex-start">'
    + '<div class="grow"><div class="nm">💊 What you take</div>'
    + (list.length
        ? '<div class="sub" style="white-space:normal;margin-top:2px">' + list.map(function (x) { return esc(stackLine(x)); }).join(" · ") + '</div>'
        : '<div class="sub" style="white-space:normal">Supplements, doses, what each is for. A record, not a checklist.</div>')
    + '</div><button class="btn ghost sm" style="flex:0 0 auto" onclick="openStack()">' + (list.length ? "Open" : "Add") + '</button></div></div>';
}

/* Enter adds and keeps focus — the same fix the interests field needed. */
if (typeof window !== "undefined") window.openStack = function () {
  modal("What you take",
    '<div class="sub" style="white-space:normal;margin-bottom:8px">A reference, not a checklist — nothing here tracks whether you took it.</div>'
    + '<label style="margin-top:0">Name</label><input id="stk_name" placeholder="e.g. Creatine monohydrate" autocomplete="off" '
    + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();stackSave();}">'
    + '<div class="row" style="gap:8px"><div class="grow"><label>Dose</label><input id="stk_dose" placeholder="5 g" autocomplete="off" '
    + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();stackSave();}"></div>'
    + '<div class="grow"><label>When</label><input id="stk_when" placeholder="every morning" autocomplete="off" '
    + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();stackSave();}"></div></div>'
    + '<label>Brand / form</label><input id="stk_brand" placeholder="optional" autocomplete="off" '
    + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();stackSave();}">'
    + '<label>What it\'s for</label><input id="stk_why" placeholder="optional" autocomplete="off" '
    + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();stackSave();}">'
    + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="stackSave()">Add</button>'
    + '<div id="stack_list" style="border-top:1px solid var(--line);margin-top:12px;padding-top:8px">' + stackListHTML() + '</div>');
  setTimeout(function () { var el = document.getElementById("stk_name"); if (el) el.focus(); }, 60);
};
if (typeof window !== "undefined") window.stackSave = function () {
  var nameEl = document.getElementById("stk_name"); if (!nameEl) return;
  var name = (nameEl.value || "").trim(); if (!name) return;
  var g = function (id) { var e = document.getElementById(id); return e ? (e.value || "").trim() : ""; };
  var t = stackDoc();
  t.list.push({ id: "stk-" + (typeof uid === "function" ? uid() : String(Date.now())),
                name: name.slice(0, 80), dose: g("stk_dose").slice(0, 40), when: g("stk_when").slice(0, 40),
                brand: g("stk_brand").slice(0, 60), why: g("stk_why").slice(0, 120) });
  t.updatedAt = (typeof now === "function") ? now() : Date.now();
  if (typeof touch === "function") touch(t);
  if (typeof save === "function") save();
  ["stk_name", "stk_dose", "stk_when", "stk_brand", "stk_why"].forEach(function (id) { var e = document.getElementById(id); if (e) e.value = ""; });
  stackRefresh();
  nameEl.focus();
};
if (typeof window !== "undefined") window.stackDel = function (id) {
  var t = stackDoc(); var x = t.list.find(function (y) { return y && y.id === id; }); if (x) x.deleted = true;
  t.updatedAt = (typeof now === "function") ? now() : Date.now();
  if (typeof touch === "function") touch(t);
  if (typeof save === "function") save();
  stackRefresh();
  var e = document.getElementById("stk_name"); if (e) e.focus();
};

if (typeof window !== "undefined") { window.stackCardHTML = stackCardHTML; window.actStack = actStack; }
