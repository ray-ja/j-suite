/* ---------- WORKSHOP — user-defined scheduled AI tasks (custom cron jobs) ----------
   An Admin-page card to build your own Sentinel: pick which data to read, write a free-text task, set a
   schedule + delivery, and (preview-first) run it. Jobs are a per-org synced collection (customJobs) — org
   isolation is free (it lives in the org slab). CRUD rides the normal save()+autopush sync; there is NO
   special CRUD route. The SERVER backs every gate (sanitizeCustomJobWrites): only owner/admin may write jobs;
   finance-scope / broadcast / propose jobs require owner. This file owns ONLY the customJobs collection + this
   card; it does not touch shared plumbing. The ~/sentinel RUNNER (separate) executes due, active, non-example
   jobs. Owner/admin-gated; finance scope is role-gated + owner-only and locks delivery to a private owner DM. */

const WORKSHOP_MAX_ACTIVE = 10;   // ≤10 active jobs per org (cost cap)
// the offerable data-scope allowlist (mirrors the server's WORKSHOP_SCOPES); `fin` marks finance (owner-only + role-gated)
const WORKSHOP_SCOPE_DEFS = [
  { k: "customers", l: "Customers" }, { k: "properties", l: "Properties" }, { k: "quotes", l: "Quotes" },
  { k: "jobs", l: "Jobs" }, { k: "income", l: "Income", fin: true }, { k: "expenses", l: "Expenses", fin: true },
  { k: "timeclock", l: "Time clock" }, { k: "inventory", l: "Inventory" }, { k: "resale", l: "Resale" }
];
const WORKSHOP_FINANCE = ["income", "expenses"];   // mirrors server WORKSHOP_FINANCE_SCOPE
const WORKSHOP_EXAMPLES = [
  "List every open quote and which ones are over 7 days old.",
  "Summarize this week's jobs: what's scheduled, what's still open.",
  "Flag any inventory item marked as needed so we restock before the next job.",
  "Compare income vs expenses this month and tell me the net."
];

function workshopCanManage() { return (typeof isOwner === "function" && isOwner()) || ((typeof canManageMembers === "function") && canManageMembers()); }
function workshopIsOwner() { return (typeof isOwner === "function") ? isOwner() : false; }
// finance checkboxes are role-gated: hidden from a non-owner OR a manager who can't even see Finance
function workshopCanFinance() { return workshopIsOwner() && (typeof canSee !== "function" || canSee("finance")); }
function workshopBase() { return (((typeof S !== "undefined" && S.sync && S.sync.url) || "")).replace(/\/+$/, ""); }
function workshopHeaders() { return { "Content-Type": "application/json", "Authorization": "Bearer " + ((S.sync && S.sync.token) || "") }; }

function workshopJobs() { return ((D().customJobs) || []).filter(j => j && !j.deleted); }
function workshopJobIsFinance(j) { return !!(j && Array.isArray(j.dataScope) && j.dataScope.some(s => WORKSHOP_FINANCE.indexOf(s) >= 0)); }
function workshopJobNeedsOwner(j) { return workshopJobIsFinance(j) || (j && j.deliverTo && j.deliverTo.mode === "broadcast") || (j && j.action && j.action.mode === "propose"); }
function workshopActiveCount() { return workshopJobs().filter(j => j.active).length; }

function workshopSchedSummary(s) {
  s = s || {};
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hh = (s.hour == null ? 0 : s.hour), mm = String(s.min == null ? 0 : s.min).padStart(2, "0");
  const t = ((hh % 12) || 12) + ":" + mm + (hh < 12 ? "am" : "pm");
  if (s.kind === "hourly") return "Hourly";
  if (s.kind === "daily") return "Daily at " + t;
  if (s.kind === "weekly") return (DOW[s.dow == null ? 1 : s.dow] || "Mon") + " at " + t;
  if (s.kind === "monthly") return "Monthly (day 1) at " + t;
  return "—";
}
function workshopDeliverBadge(j) {
  const m = (j.deliverTo && j.deliverTo.mode) || "private";
  if (m === "broadcast") return `<span class="badge" style="background:var(--acc);color:#fff">📣 Whole crew</span>`;
  if (m === "thread") return `<span class="badge">🧵 Named thread</span>`;
  return `<span class="badge">🔒 Just me</span>`;
}

function workshopCard() {
  if (!workshopCanManage()) return "";
  setTimeout(() => { const el = document.getElementById("workshop-card"); if (el) el.innerHTML = workshopCardInner(); }, 20);
  return `<div class="card" id="workshop-card" style="margin-top:8px;border-left:3px solid var(--acc)">${workshopCardInner()}</div>`;
}
function workshopCardInner() {
  const jobs = workshopJobs().slice().sort((a, b) => (a.example ? 1 : 0) - (b.example ? 1 : 0) || (a.createdAt || 0) - (b.createdAt || 0));
  let h = `<div class="nm" style="font-size:15px">🛠 Workshop</div>
    <div class="sub" style="margin-bottom:8px">Build your own scheduled AI tasks — pick what data to read, write the task, set how often, and where it lands. Runs on this org's assistant key. ${workshopActiveCount()}/${WORKSHOP_MAX_ACTIVE} active.</div>`;
  if (!jobs.length) h += `<div class="sub" style="margin-bottom:8px">No tasks yet.</div>`;
  jobs.forEach(j => {
    const dot = j.active ? (j.lastRun ? "#1b7f4d" : "#e0a800") : "var(--line)";
    const last = j.lastRun ? ("ran " + (typeof relTime === "function" ? relTime(j.lastRun) : "")) : (j.active ? "never run" : "off");
    h += `<div class="row" style="align-items:flex-start;gap:8px;padding:8px 0;border-top:1px solid var(--line)">
      <span title="${j.active ? "active" : "off"}" style="flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:${dot};margin-top:6px"></span>
      <div class="grow" style="cursor:pointer" onclick="workshopEdit('${esc(j.id)}')">
        <div class="nm" style="font-size:14px">${esc(j.name || "(untitled)")}${j.example ? ` <span class="badge">example</span>` : ""}</div>
        <div class="sub">${esc(workshopSchedSummary(j.schedule))} · ${workshopDeliverBadge(j)} ${j.action && j.action.mode === "propose" ? `<span class="badge">⚑ proposes</span>` : ""} <span style="color:var(--muted)">· ${esc(last)}</span></div>
      </div>
      ${j.example
        ? `<button class="btn ghost sm" onclick="workshopClone('${esc(j.id)}')" style="flex:0 0 auto">Clone</button>`
        : `<input type="checkbox" style="width:auto;flex:0 0 auto;margin-top:4px" ${j.active ? "checked" : ""} onchange="workshopToggle('${esc(j.id)}',this.checked)">`}
    </div>`;
  });
  h += `<div style="margin-top:10px"><button class="btn acc sm" onclick="workshopEdit('')">+ New task</button></div>`;
  if (!workshopBase()) h += `<div class="sub" style="margin-top:8px;font-size:12px">Preview needs an online connection + this org's assistant key (set in the Assistant card above).</div>`;
  return h;
}

/* ---- create / edit modal ---- */
let WORKSHOP_DRAFT = null;   // the job being edited (a working copy)
function workshopBlankDraft() {
  return { id: "", org: S.biz, name: "", dataScope: [], prompt: "",
    schedule: { kind: "daily", dow: 1, hour: 7, min: 0, tz: "America/New_York" },
    deliverTo: { mode: "private", threadId: null }, action: { mode: "report" },
    model: null, maxRows: null, active: false, createdBy: ((typeof curUser === "function" && curUser()) || {}).id || null };
}
window.workshopEdit = function (id) {
  if (!workshopCanManage()) { alert("Owner or admin only."); return; }
  const existing = id ? workshopJobs().find(j => j.id === id) : null;
  WORKSHOP_DRAFT = existing ? JSON.parse(JSON.stringify(existing)) : workshopBlankDraft();
  WORKSHOP_DRAFT._isNew = !existing;
  modal(existing ? "Edit task" : "New task", workshopFormHtml());
  setTimeout(workshopSyncLocks, 20);
};
window.workshopClone = function (id) {
  if (!workshopCanManage()) { alert("Owner or admin only."); return; }
  const src = workshopJobs().find(j => j.id === id); if (!src) return;
  WORKSHOP_DRAFT = JSON.parse(JSON.stringify(src));
  WORKSHOP_DRAFT.id = ""; WORKSHOP_DRAFT._isNew = true; WORKSHOP_DRAFT.example = false; WORKSHOP_DRAFT.active = false; WORKSHOP_DRAFT.lastRun = null;
  WORKSHOP_DRAFT.name = (src.name || "Task").replace(/\s*\(example\)\s*$/i, "") + " (copy)";
  WORKSHOP_DRAFT.createdBy = ((typeof curUser === "function" && curUser()) || {}).id || null;
  modal("New task (from example)", workshopFormHtml());
  setTimeout(workshopSyncLocks, 20);
};

function workshopFormHtml() {
  const d = WORKSHOP_DRAFT, owner = workshopIsOwner(), canFin = workshopCanFinance();
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const sc = d.schedule || {};
  let scopeH = WORKSHOP_SCOPE_DEFS.filter(s => !s.fin || canFin).map(s => {
    const on = (d.dataScope || []).indexOf(s.k) >= 0;
    return `<label style="display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:14px;font-size:13px;background:${on ? "var(--acc)" : "var(--line)"};color:${on ? "#fff" : "inherit"};cursor:pointer">
      <input type="checkbox" style="width:auto;margin:0" ${on ? "checked" : ""} onchange="workshopScopeToggle('${s.k}',this.checked)">${esc(s.l)}${s.fin ? " 💲" : ""}</label>`;
  }).join("");
  const chips = WORKSHOP_EXAMPLES.map(x => `<button type="button" class="btn ghost sm" style="font-size:12px" onclick="workshopUseExample(${JSON.stringify(x).replace(/"/g, "&quot;")})">${esc(x.slice(0, 32))}…</button>`).join(" ");
  const delMode = (d.deliverTo && d.deliverTo.mode) || "private";
  const actMode = (d.action && d.action.mode) || "report";
  return `
    <label>Name</label>
    <input id="ws_name" value="${esc(d.name || "")}" placeholder="e.g. Daily open-quotes check" maxlength="80">

    <label style="margin-top:10px">What data can this task read?</label>
    <div class="sub" style="margin-bottom:6px">Only the boxes you check are visible to the task.${canFin ? " 💲 = finance (owner-only, stays private)." : ""}</div>
    <div class="row" style="flex-wrap:wrap;gap:6px">${scopeH}</div>

    <label style="margin-top:12px">The task (what should it do?)</label>
    <textarea id="ws_prompt" rows="4" placeholder="Plain English. e.g. List every open quote older than 7 days with the customer name and amount.">${esc(d.prompt || "")}</textarea>
    <div class="row" style="flex-wrap:wrap;gap:5px;margin-top:5px">${chips}</div>

    <label style="margin-top:12px">How often?</label>
    <select id="ws_kind" onchange="workshopKindChange(this.value)">
      <option value="hourly" ${sc.kind === "hourly" ? "selected" : ""}>Hourly</option>
      <option value="daily" ${sc.kind === "daily" ? "selected" : ""}>Daily</option>
      <option value="weekly" ${sc.kind === "weekly" ? "selected" : ""}>Weekly</option>
      <option value="monthly" ${sc.kind === "monthly" ? "selected" : ""}>Monthly</option>
    </select>
    <div id="ws_sched_detail" style="margin-top:8px">${workshopSchedDetailHtml(sc)}</div>

    <label style="margin-top:12px">Where does it land?</label>
    <div id="ws_deliver">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="radio" name="ws_del" value="private" style="width:auto" ${delMode === "private" ? "checked" : ""} onchange="workshopDelChange('private')"> 🔒 Just me (private)</label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;${owner ? "" : "opacity:.5"}"><input type="radio" name="ws_del" value="broadcast" style="width:auto" ${delMode === "broadcast" ? "checked" : ""} ${owner ? "" : "disabled"} onchange="workshopDelChange('broadcast')"> 📣 Whole crew${owner ? "" : " (owner only)"}</label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="radio" name="ws_del" value="thread" style="width:auto" ${delMode === "thread" ? "checked" : ""} onchange="workshopDelChange('thread')"> 🧵 A named thread</label>
    </div>
    <div id="ws_finance_lock" class="sub" style="color:var(--danger);margin-top:4px;display:none">Finance tasks are owner-only and always private — they can't be broadcast to the crew.</div>

    <label style="margin-top:12px">When it's done</label>
    <div id="ws_action">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="radio" name="ws_act" value="report" style="width:auto" ${actMode === "report" ? "checked" : ""} onchange="workshopActChange('report')"> 📝 Report (just tell us)</label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;${owner ? "" : "opacity:.5"}"><input type="radio" name="ws_act" value="propose" style="width:auto" ${actMode === "propose" ? "checked" : ""} ${owner ? "" : "disabled"} onchange="workshopActChange('propose')"> ⚑ Propose a change for approval${owner ? "" : " (owner only)"}</label>
    </div>

    <div id="ws_preview" class="sub" style="white-space:pre-wrap;margin-top:12px;background:var(--line);padding:8px;border-radius:6px;display:none"></div>

    <div class="row" style="gap:8px;margin-top:14px;flex-wrap:wrap">
      <button class="btn ghost" onclick="workshopPreview()">▶ Run now / Preview</button>
      <button class="btn acc grow" onclick="workshopSave()">Save task</button>
      ${d.id ? `<button class="btn danger" onclick="workshopDelete('${esc(d.id)}')">Delete</button>` : ""}
    </div>`;
}
function workshopSchedDetailHtml(sc) {
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (sc.kind === "hourly") return `<div class="sub">Runs once an hour (1-hour minimum).</div>`;
  const time = `<label>Time of day</label>
    <div class="row" style="gap:6px">
      <select id="ws_hour" onchange="workshopTimeChange()">${Array.from({ length: 24 }, (_, i) => `<option value="${i}" ${(sc.hour == null ? 7 : sc.hour) === i ? "selected" : ""}>${((i % 12) || 12)}${i < 12 ? "am" : "pm"}</option>`).join("")}</select>
      <select id="ws_min" onchange="workshopTimeChange()">${[0, 15, 30, 45].map(m => `<option value="${m}" ${(sc.min == null ? 0 : sc.min) === m ? "selected" : ""}>:${String(m).padStart(2, "0")}</option>`).join("")}</select>
    </div>`;
  if (sc.kind === "weekly") return `<label>Day of week</label>
    <select id="ws_dow" onchange="workshopDowChange()">${DOW.map((d, i) => `<option value="${i}" ${(sc.dow == null ? 1 : sc.dow) === i ? "selected" : ""}>${d}</option>`).join("")}</select>` + time;
  if (sc.kind === "monthly") return `<div class="sub">Runs on the 1st of each month.</div>` + time;
  return time;   // daily
}

/* ---- form wiring (mutates WORKSHOP_DRAFT, never the live record until Save) ---- */
window.workshopScopeToggle = function (k, on) {
  const d = WORKSHOP_DRAFT; if (!d) return;
  d.dataScope = (d.dataScope || []).filter(x => x !== k);
  if (on) d.dataScope.push(k);
  workshopSyncLocks();
};
window.workshopKindChange = function (kind) {
  const d = WORKSHOP_DRAFT; if (!d) return;
  d.schedule = d.schedule || {}; d.schedule.kind = kind;
  if (kind === "weekly" && d.schedule.dow == null) d.schedule.dow = 1;
  const el = document.getElementById("ws_sched_detail"); if (el) el.innerHTML = workshopSchedDetailHtml(d.schedule);
};
window.workshopTimeChange = function () {
  const d = WORKSHOP_DRAFT; if (!d) return; d.schedule = d.schedule || {};
  const h = document.getElementById("ws_hour"), m = document.getElementById("ws_min");
  if (h) d.schedule.hour = +h.value; if (m) d.schedule.min = +m.value;
};
window.workshopDowChange = function () { const d = WORKSHOP_DRAFT, e = document.getElementById("ws_dow"); if (d && e) { d.schedule = d.schedule || {}; d.schedule.dow = +e.value; } };
window.workshopDelChange = function (mode) { const d = WORKSHOP_DRAFT; if (!d) return; d.deliverTo = d.deliverTo || {}; d.deliverTo.mode = mode; if (mode !== "thread") d.deliverTo.threadId = null; };
window.workshopActChange = function (mode) { const d = WORKSHOP_DRAFT; if (!d) return; d.action = d.action || {}; d.action.mode = mode; };
window.workshopUseExample = function (txt) { const d = WORKSHOP_DRAFT, e = document.getElementById("ws_prompt"); if (d) d.prompt = txt; if (e) e.value = txt; };

// FINANCE LOCK: if any finance scope is checked, force delivery → private + disable broadcast, and show why.
function workshopSyncLocks() {
  const d = WORKSHOP_DRAFT; if (!d) return;
  const fin = workshopJobIsFinance(d);
  const lock = document.getElementById("ws_finance_lock"); if (lock) lock.style.display = fin ? "block" : "none";
  const radios = document.querySelectorAll('input[name="ws_del"]');
  radios.forEach(r => {
    if (r.value === "broadcast") {
      r.disabled = fin || !workshopIsOwner();
      if (fin && r.checked) r.checked = false;
    }
  });
  if (fin && d.deliverTo && d.deliverTo.mode === "broadcast") {
    d.deliverTo.mode = "private"; d.deliverTo.threadId = null;
    const pv = document.querySelector('input[name="ws_del"][value="private"]'); if (pv) pv.checked = true;
  }
}

/* ---- save / toggle / delete (rides save() + autopush; server re-validates) ---- */
function workshopReadForm() {
  const d = WORKSHOP_DRAFT; if (!d) return null;
  const nm = (document.getElementById("ws_name") || {}).value || "";
  const pr = (document.getElementById("ws_prompt") || {}).value || "";
  d.name = nm.trim().slice(0, 80); d.prompt = pr.trim().slice(0, 4000);
  // capture any uncommitted selects (time/dow may not have fired onchange yet)
  workshopTimeChange(); workshopDowChange();
  return d;
}
function workshopValidate(d) {
  if (!d.name) return "Give the task a name.";
  if (!(d.dataScope || []).length) return "Pick at least one kind of data for the task to read.";
  if (!d.prompt) return "Write what the task should do.";
  if (workshopJobNeedsOwner(d) && !workshopIsOwner()) return "Finance, broadcast, and propose tasks are owner-only.";
  return null;
}
window.workshopSave = function () {
  if (!workshopCanManage()) { alert("Owner or admin only."); return; }
  const d = workshopReadForm(); if (!d) return;
  // finance lock (defense in depth — the GUI also disables broadcast)
  if (workshopJobIsFinance(d) && d.deliverTo && d.deliverTo.mode === "broadcast") { d.deliverTo.mode = "private"; d.deliverTo.threadId = null; }
  const err = workshopValidate(d); if (err) { alert(err); return; }
  const arr = (D().customJobs = D().customJobs || []);
  let rec;
  if (d.id) { rec = arr.find(j => j && j.id === d.id); if (!rec) { alert("Task not found."); return; } }
  else {
    if (workshopActiveCount() >= WORKSHOP_MAX_ACTIVE && d.active) { alert("You already have " + WORKSHOP_MAX_ACTIVE + " active tasks. Turn one off first."); return; }
    rec = { id: "cjob_" + uid(), org: S.biz, createdBy: d.createdBy || (((typeof curUser === "function" && curUser()) || {}).id || null), lastRun: null, createdAt: now(), deleted: false };
    arr.push(rec);
  }
  rec.org = S.biz;
  rec.name = d.name; rec.dataScope = d.dataScope.slice(); rec.prompt = d.prompt;
  rec.schedule = d.schedule; rec.deliverTo = d.deliverTo; rec.action = d.action;
  rec.model = d.model || null; rec.maxRows = d.maxRows || null;
  if (d._isNew) rec.active = !!d.active; // new jobs default off; toggled from the list
  rec.example = false;
  if (typeof touch === "function") touch(rec); else rec.updatedAt = now();
  save();
  closeModal();
  if (typeof render === "function") render();
};
window.workshopToggle = function (id, on) {
  if (!workshopCanManage()) { if (typeof render === "function") render(); return; }
  const rec = ((D().customJobs) || []).find(j => j && j.id === id); if (!rec || rec.example) return;
  if (on && !rec.active && workshopActiveCount() >= WORKSHOP_MAX_ACTIVE) { alert("You already have " + WORKSHOP_MAX_ACTIVE + " active tasks. Turn one off first."); const el = document.getElementById("workshop-card"); if (el) el.innerHTML = workshopCardInner(); return; }
  rec.active = !!on;
  if (typeof touch === "function") touch(rec); else rec.updatedAt = now();
  save();
  const el = document.getElementById("workshop-card"); if (el) el.innerHTML = workshopCardInner();
};
window.workshopDelete = function (id) {
  if (!workshopCanManage()) { alert("Owner or admin only."); return; }
  if (!confirm("Delete this task?")) return;
  const rec = ((D().customJobs) || []).find(j => j && j.id === id); if (!rec) return;
  rec.deleted = true; rec.active = false;
  if (typeof touch === "function") touch(rec); else rec.updatedAt = now();
  save();
  closeModal();
  if (typeof render === "function") render();
};

/* ---- preview: server-side dry-run, read-only, key stays on the server ---- */
window.workshopPreview = function () {
  const d = workshopReadForm(); if (!d) return;
  const err = workshopValidate(d); if (err) { alert(err); return; }
  const out = document.getElementById("ws_preview"); if (!out) return;
  out.style.display = "block";
  if (!workshopBase()) { out.textContent = "Preview needs an online connection."; return; }
  out.textContent = "Running…";
  const job = { name: d.name, dataScope: d.dataScope, prompt: d.prompt, schedule: d.schedule, deliverTo: d.deliverTo, action: d.action, model: d.model, maxRows: d.maxRows };
  fetch(workshopBase() + "/api/workshop/preview", { method: "POST", headers: workshopHeaders(), body: JSON.stringify({ org: S.biz, job: job }) })
    .then(r => r.json().then(j => ({ ok: r.ok, j: j })))
    .then(x => { out.textContent = x.ok ? (x.j.answer || "(no output)") : (x.j.error || "Preview failed."); })
    .catch(() => { out.textContent = "Couldn't reach the server."; });
};
