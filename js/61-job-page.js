/* ---------- CREW JOB PAGE ----------
   The one screen a crew member opens for the job they're on: customer + address (maps link),
   start time, clock in/out for THIS job, assigned crew, equipment, change orders, notes.
   Reached by tapping a job on the schedule (openJobPage); renders inside the Schedule tab via
   window.JOB_OPEN (mirrors the messages MSG_OPEN pattern). A nav tap clears it (see js/03). */
window.JOB_OPEN = window.JOB_OPEN || null;
window.openJobPage = function (id) { window.JOB_OPEN = id; TAB = "schedule"; if (typeof render === "function") render(); };
window.jobPageBack = function () { window.JOB_OPEN = null; if (typeof render === "function") render(); };
window.jobResetOpen = function () { window.JOB_OPEN = null; };

function jobAddr(j) {
  const _p = (j.propertyId && typeof actProps === "function") ? actProps().find(p => p.id === j.propertyId) : null;
  const _c = (typeof actC === "function") ? actC().find(c => c.id === j.customerId) : null;
  return (_p && _p.address) || j.address || (_c && _c.address) || (_c && typeof propsForCust === "function" && (propsForCust(_c.id)[0] || {}).address) || "";
}

function rJobPage(j) {
  const cust = (typeof custName === "function") ? custName(j.customerId) : "";
  const addr = jobAddr(j);
  const _ll = (typeof jobLatLng === "function") ? jobLatLng(j) : null, _drive = (_ll && typeof driveBadge === "function") ? driveBadge(_ll.lat, _ll.lng) : "";
  const crewNames = (j.crew || []).map(id => (typeof userName === "function" ? userName(id) : "") || "").filter(Boolean).join(", ");
  const me = (typeof tcWho === "function") ? tcWho() : null;
  const tc = (typeof actTC === "function") ? actTC() : [];
  const openThis = me ? tc.find(e => e.userId === me.userId && e.jobId === j.id && !e.clockOut) : null;
  const openOther = me ? tc.find(e => e.userId === me.userId && e.jobId !== j.id && !e.clockOut) : null;
  const equip = (j.equipment || []).map(e => { const it = (typeof eqItemById === "function") ? eqItemById(e.itemId) : null; return { name: it ? (it.name || e.itemId) : e.itemId, qty: e.qty || 1 }; });
  const cos = (j.changeOrders || []).filter(x => x && !x.deleted);
  const coTotal = cos.reduce((s, c) => s + (+c.amount || 0), 0);
  const hhmm = ms => { try { return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };

  let h = `<div class="secthd"><h2 style="margin:0">${esc(j.title || "Job")}</h2><button class="btn ghost sm" onclick="jobPageBack()">← Schedule</button></div>`;

  h += `<div class="card"><div class="nm" style="font-size:17px">${esc(cust || "—")}</div>`;
  h += addr
    ? `<div class="sub" style="white-space:normal;margin-top:4px">${esc(addr)}</div>${_drive ? `<div class="sub" style="margin-top:4px;font-weight:600;color:var(--brand-text)">${_drive}</div>` : ""}<a class="btn ghost sm" style="margin-top:8px;display:inline-block" href="https://maps.google.com/?q=${encodeURIComponent(addr)}" target="_blank" rel="noopener">🗺️ Directions</a>`
    : `<div class="muted" style="margin-top:4px">No address on file.</div>`;
  h += `</div>`;

  h += `<div class="card"><div class="row" style="align-items:flex-start"><div class="grow"><div class="sub">When</div><div class="nm" style="font-size:15px">${j.date ? fmtDate(j.date) : "—"}${j.time ? " · " + esc(j.time) : ""}</div></div><div class="grow"><div class="sub">Crew</div><div class="nm" style="font-size:15px;white-space:normal">${esc(crewNames || "—")}</div></div></div>${j.done ? `<div class="sub" style="margin-top:6px;color:var(--accent);font-weight:700">✓ Completed</div>` : ""}</div>`;

  h += `<div class="card"><div style="font-weight:800;margin-bottom:8px">⏱️ Time clock</div>`;
  if (openThis) {
    h += `<div class="sub">Clocked in since <b>${hhmm(openThis.clockIn)}</b></div><button class="btn danger" style="margin-top:8px;width:100%" onclick="tcClockOut('${openThis.id}')">Clock out</button>`;
  } else if (openOther) {
    const oj = (typeof actJ === "function") ? actJ().find(x => x.id === openOther.jobId) : null;
    h += `<div class="note">You're clocked into <b>${esc(oj ? (oj.title || "another job") : "another job")}</b> — clock out of it first.</div><button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="tcClockOut('${openOther.id}')">Clock out of that job</button>`;
  } else {
    h += `<input type="hidden" id="tc_job" value="${esc(j.id)}"><label style="margin-top:0">Vehicle (required)</label><input id="tc_vehicle" placeholder="e.g. Ray's truck" autocomplete="off"><label>Odometer — start (required)</label><input id="tc_odo_start" type="number" inputmode="decimal" placeholder="miles showing now"><button class="btn acc" style="margin-top:8px;width:100%" onclick="tcClockIn()">Clock in to this job</button>`;
  }
  h += `</div>`;

  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">🧰 Equipment</div>`;
  h += equip.length ? equip.map(e => `<div class="li"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal">${esc(e.name)}</div></div><div class="sub">×${e.qty}</div></div>`).join("") : `<div class="muted">None assigned to this job.</div>`;
  h += `</div>`;

  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">📝 Change orders${coTotal ? ` · <span style="color:var(--accent)">${money(coTotal)}</span>` : ""}</div>`;
  h += cos.length ? cos.map(c => `<div class="li"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal">${esc(c.desc || "")}</div><div class="sub">${c.by ? esc(c.by) + " · " : ""}${c.ts && typeof relTime === "function" ? relTime(c.ts) : ""}</div></div><div class="row" style="gap:8px">${c.amount ? `<div class="nm" style="font-size:15px">${money(c.amount)}</div>` : ""}<button class="btn ghost sm" onclick="jobDelChangeOrder('${j.id}','${c.id}')">✕</button></div></div>`).join("") : `<div class="muted">Nothing changed yet.</div>`;
  h += `<div class="row" style="gap:8px;margin-top:10px"><input id="co_desc" placeholder="What changed on-site…" style="flex:2"><input id="co_amt" type="number" inputmode="decimal" placeholder="$ +/-" style="flex:0 0 92px"></div><button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="jobAddChangeOrder('${j.id}')">+ Add change order</button>`;
  if (j.quoteId && coTotal) h += `<div class="note" style="margin-top:8px">Update the <b>Final price</b> on the quote to bill these.</div>`;
  h += `</div>`;

  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">📝 Job notes <span class="sub" style="font-weight:400">· Cap reads these to learn from the job</span></div>
    <textarea id="job_notes" style="min-height:72px" placeholder="What happened, access notes, gotchas, what to do differently next time…">${esc(j.notes || "")}</textarea>
    <button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="jobSaveNotes('${j.id}')">Save notes</button></div>`;
  if (typeof reviewAsk === "function") h += `<button class="btn ghost" style="width:100%;margin:4px 0 0" onclick="reviewAsk()">⭐ Ask for a Google review</button>`;
  if (typeof isOwner === "function" && isOwner()) h += `<button class="btn ghost" style="width:100%;margin:4px 0 10px" onclick="openJob('${j.id}')">✏️ Edit job details</button>`;
  return h;
}

window.jobAddChangeOrder = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const desc = val("co_desc"); if (!desc) { alert("Describe what changed first."); return; }
  const amt = parseFloat(val("co_amt")) || 0;
  const who = (typeof tcWho === "function" && tcWho()) ? tcWho().name : ((typeof curUser === "function" && curUser()) ? curUser().username : "");
  if (!Array.isArray(j.changeOrders)) j.changeOrders = [];
  j.changeOrders.push({ id: uid(), desc: desc, amount: amt, ts: now(), by: who });
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
window.jobDelChangeOrder = function (jobId, coId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j || !Array.isArray(j.changeOrders)) return;
  const c = j.changeOrders.find(x => x && x.id === coId); if (!c) return;
  c.deleted = true; if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
window.jobSaveNotes = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  j.notes = val("job_notes") || "";
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
