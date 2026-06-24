/* ---------- CREW JOB PAGE ----------
   The one screen a crew member opens for the job they're on. Flow: where & when (directions + call) →
   load checklist (load the truck first) → time clock (your own vehicle + odometer; shows who's on the
   job) → photos (inline, visible to all) → expenses (amount + receipt as proof) → notes → change orders.
   Reached by tapping a job (openJobPage); renders inside the Schedule tab via window.JOB_OPEN. */
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
  const _cust = (typeof actC === "function") ? actC().find(c => c.id === j.customerId) : null;
  const phone = (_cust && _cust.phone) ? _cust.phone : "";
  const addr = jobAddr(j);
  const _ll = (typeof jobLatLng === "function") ? jobLatLng(j) : null, _drive = (_ll && typeof driveBadge === "function") ? driveBadge(_ll.lat, _ll.lng) : "";
  const crewNames = (j.crew || []).map(id => (typeof userName === "function" ? userName(id) : "") || "").filter(Boolean).join(", ");
  const me = (typeof tcWho === "function") ? tcWho() : null;
  const tc = (typeof actTC === "function") ? actTC() : [];
  const openThis = me ? tc.find(e => e.userId === me.userId && e.jobId === j.id && !e.clockOut) : null;
  const openOther = me ? tc.find(e => e.userId === me.userId && e.jobId !== j.id && !e.clockOut) : null;
  const onJob = tc.filter(e => e.jobId === j.id && !e.clockOut);
  const vehs = (typeof actInv === "function") ? actInv().filter(x => x && x.cat === "vehicle" && !x.deleted) : [];
  const cos = (j.changeOrders || []).filter(x => x && !x.deleted);
  const coTotal = cos.reduce((s, c) => s + (+c.amount || 0), 0);
  const exps = (j.expenses || []).filter(x => x && !x.deleted);
  const expTotal = exps.reduce((s, e) => s + (+e.amount || 0), 0);
  const tel = ph => String(ph || "").replace(/[^0-9+]/g, "");
  const upUrl = id => (typeof jsUploadUrl === "function") ? jsUploadUrl(id) : "";
  const hhmm = ms => { try { return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };

  let h = `<div class="secthd"><h2 style="margin:0">${esc(j.title || "Job")}</h2><button class="btn ghost sm" onclick="jobPageBack()">← Back</button></div>`;

  // 1) Where & when — directions + call
  h += `<div class="card"><div class="nm" style="font-size:18px">${esc(cust || "—")}</div>`;
  h += addr ? `<div class="sub" style="white-space:normal;margin-top:3px">${esc(addr)}</div>` : `<div class="muted" style="margin-top:3px">No address on file.</div>`;
  if (_drive) h += `<div class="sub" style="margin-top:3px;font-weight:600;color:var(--brand-text)">${_drive}</div>`;
  h += `<div class="sub" style="margin-top:8px;white-space:normal">📅 ${j.date ? fmtDate(j.date) : "—"}${j.time ? " · " + esc(j.time) : ""}${crewNames ? " · 👥 " + esc(crewNames) : ""}</div>`;
  if (j.done) h += `<div class="sub" style="margin-top:6px;color:var(--accent);font-weight:800">✓ Completed</div>`;
  if (addr || phone) {
    h += `<div class="row" style="gap:8px;margin-top:10px">`;
    if (addr) h += `<a class="btn ghost grow" href="https://maps.google.com/?q=${encodeURIComponent(addr)}" target="_blank" rel="noopener">🗺️ Directions</a>`;
    if (phone) h += `<a class="btn ghost grow" href="tel:${tel(phone)}">📞 Call</a>`;
    h += `</div>`;
  }
  h += `</div>`;

  // 1b) Part of a bigger job? — file this under a parent (e.g. a dump run under a tree job); its costs roll up
  const _subs = (typeof subJobsOf === "function") ? subJobsOf(j.id) : [];
  const _opts = (typeof actJ === "function" ? actJ() : []).filter(x => x && x.id !== j.id && x.parentJobId !== j.id && !x.parentJobId);
  h += `<div class="card"><label style="margin-top:0">↳ Part of a bigger job?</label><select onchange="jobSetParent('${j.id}',this.value)"><option value="">— standalone job —</option>` + _opts.map(x => `<option value="${x.id}" ${j.parentJobId === x.id ? "selected" : ""}>${esc(x.title || "Job")}${x.customerId && typeof custName === "function" ? " · " + esc(custName(x.customerId)) : ""}${x.date ? " · " + fmtDate(x.date) : ""}</option>`).join("") + `</select>`;
  if (j.parentJobId) h += `<div class="sub" style="margin-top:6px;white-space:normal">Its mileage, dump fees &amp; time roll up into that job's cost.</div>`;
  if (_subs.length) h += `<div class="sub" style="margin-top:8px;font-weight:700">Sub-jobs rolled into this one:</div>` + _subs.map(sj => `<div class="li" onclick="openJobPage('${sj.id}')" style="cursor:pointer"><div class="grow"><div class="nm" style="font-size:14px;white-space:normal">↳ ${esc(sj.title || "Job")}${sj.date ? " · " + fmtDate(sj.date) : ""}</div></div><span class="sub">open →</span></div>`).join("");
  h += `</div>`;

  // 2) Load checklist — load the truck before you drive
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">🧰 Load checklist <span class="sub" style="font-weight:400">· check off as you load</span></div>`;
  h += (j.equipment && j.equipment.length) ? j.equipment.map(e => { const it = (typeof eqItemById === "function") ? eqItemById(e.itemId) : null; const nm = it ? (it.name || e.itemId) : e.itemId; return `<label class="li" style="cursor:pointer"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal;${e.loaded ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(nm)}</div></div><div class="row" style="gap:10px;align-items:center"><span class="sub">×${e.qty || 1}</span><input type="checkbox" style="width:22px;height:22px" ${e.loaded ? "checked" : ""} onchange="jobToggleLoaded('${j.id}','${esc(e.itemId)}')"></div></label>`; }).join("") : `<div class="muted">No equipment assigned to this job.</div>`;
  h += `</div>`;

  // 3) Time clock — each person clocks in with their own vehicle + odometer
  h += `<div class="card" style="border-left:5px solid var(--accent)"><div style="font-weight:800;margin-bottom:8px">⏱️ Time clock</div>`;
  if (onJob.length) h += `<div class="sub" style="margin-bottom:8px">On this job now: ${onJob.map(e => `<b>${esc((typeof userName === "function" ? userName(e.userId) : "") || "crew")}</b>${e.vehicle ? " · " + esc(e.vehicle) : ""}`).join(" · ")}</div>`;
  if (openThis) h += `<div class="sub">You're clocked in since <b>${hhmm(openThis.clockIn)}</b>${openThis.vehicle ? " · " + esc(openThis.vehicle) : ""}</div><button class="btn danger" style="margin-top:8px;width:100%;padding:13px" onclick="tcClockOut('${openThis.id}')">Clock out</button>`;
  else if (openOther) { const oj = (typeof actJ === "function") ? actJ().find(x => x.id === openOther.jobId) : null; h += `<div class="note">You're clocked into <b>${esc(oj ? (oj.title || "another job") : "another job")}</b> — clock out of it first.</div><button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="tcClockOut('${openOther.id}')">Clock out of that job</button>`; }
  else h += `<input type="hidden" id="tc_job" value="${esc(j.id)}"><label style="margin-top:0">Your vehicle</label><input id="tc_vehicle" list="veh_list" placeholder="pick a truck — or type your own car" autocomplete="off"><datalist id="veh_list">${vehs.map(v => `<option value="${esc(v.name)}">`).join("")}</datalist><label>Odometer — start</label><input id="tc_odo_start" type="number" inputmode="decimal" placeholder="miles showing now"><button class="btn acc" style="margin-top:10px;width:100%;padding:13px" onclick="tcClockIn()">⏱️ Clock in</button>`;
  h += `</div>`;

  // 4) Photos — inline, so anyone who opens the job sees them
  const atts = (j.attachments || []).filter(a => a && !a.deleted);
  h += `<div class="card"><div style="font-weight:800;margin-bottom:8px">📸 Photos</div>`;
  if (atts.length) h += `<div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:8px">` + atts.map(a => `<a href="${upUrl(a.id)}" target="_blank" rel="noopener"><img src="${upUrl(a.id)}" style="width:100px;height:100px;object-fit:cover;border-radius:8px;border:1px solid var(--line)" loading="lazy"></a>`).join("") + `</div>`;
  else h += `<div class="muted" style="margin-bottom:8px">No photos yet.</div>`;
  h += `<input type="file" id="job_photo" accept="image/*" capture="environment" style="display:none" onchange="jobAddPhoto('${j.id}',this)"><button class="btn acc" style="width:100%" onclick="document.getElementById('job_photo').click()">📷 Add photo</button></div>`;

  // 5) Expenses — log the amount, attach the receipt as proof
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">💵 Expenses${expTotal ? ` · <span style="color:var(--accent)">${money(expTotal)}</span>` : ""}</div>`;
  h += exps.length ? exps.map(e => `<div class="li"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal">${money(e.amount)} <span class="sub" style="font-weight:400">${esc(e.desc || "")}</span></div><div class="sub">${e.by ? esc(e.by) + " · " : ""}${e.ts && typeof relTime === "function" ? relTime(e.ts) : ""}</div></div><div class="row" style="gap:8px;align-items:center">${e.receiptId ? `<a href="${upUrl(e.receiptId)}" target="_blank" rel="noopener"><img src="${upUrl(e.receiptId)}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--line)" title="receipt"></a>` : `<span class="sub" style="color:var(--danger)">no receipt</span>`}<button class="btn ghost sm" onclick="jobDelExpense('${j.id}','${e.id}')">✕</button></div></div>`).join("") : `<div class="muted">No expenses logged.</div>`;
  h += `<div class="row" style="gap:8px;margin-top:10px"><input id="exp_amt" type="number" inputmode="decimal" placeholder="$" style="flex:0 0 80px"><input id="exp_desc" placeholder="What for — dump fee, materials…" style="flex:2"></div>`;
  h += `<input type="file" id="exp_receipt" accept="image/*" capture="environment" style="display:none" onchange="var l=document.getElementById('exp_receipt_lbl');if(l)l.textContent='✓ Receipt ready'"><div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost grow" onclick="document.getElementById('exp_receipt').click()"><span id="exp_receipt_lbl">📎 Receipt</span></button><button class="btn acc grow" onclick="jobAddExpense('${j.id}')">+ Add expense</button></div></div>`;

  // 5b) Time & travel — reconstruct/log for the real effective $/hr (drive time is the silent cost)
  const hh = (typeof jobHourly === "function") ? jobHourly(j) : null;
  const _hb = (typeof homeBase === "function") ? homeBase() : null;
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">⏱ Time &amp; travel <span class="sub" style="font-weight:400">· drives the real $/hr</span></div>
    <div class="row" style="gap:8px"><div class="grow"><label style="margin-top:0">Crew</label><input id="jt_crew" type="number" inputmode="numeric" min="1" value="${(+j.crewN || (j.crew || []).length || 1)}"></div>
      <div class="grow"><label style="margin-top:0">On-site hrs each</label><input id="jt_onsite" type="number" inputmode="decimal" step="0.25" value="${j.onSiteHrs || ""}" placeholder="0"></div></div>
    <div class="row" style="gap:8px"><div class="grow"><label style="margin-top:0">Drive min (round trip)</label><input id="jt_drivemin" type="number" inputmode="numeric" value="${j.driveMin || ""}" placeholder="0"></div>
      <div class="grow"><label style="margin-top:0">Drive miles (round trip)</label><input id="jt_drivemiles" type="number" inputmode="decimal" value="${j.driveMiles || ""}" placeholder="0"></div></div>
    <div class="row" style="gap:8px;margin-top:8px">${_ll ? `<button class="btn ghost grow" onclick="jobEstimateDrive('${j.id}')">📍 Estimate from base</button>` : ""}${(addr && _hb && _hb.address) ? `<a class="btn ghost grow" href="https://www.google.com/maps/dir/${encodeURIComponent(_hb.address)}/${encodeURIComponent(addr)}/${encodeURIComponent(_hb.address)}" target="_blank" rel="noopener">🗺️ Google Maps</a>` : ""}</div>
    <button class="btn acc sm" style="margin-top:8px;width:100%" onclick="jobSaveTravel('${j.id}')">Save time &amp; travel</button>`;
  if (hh && hh.perHr != null) h += `<div class="card" style="background:var(--soft);margin-top:8px;padding:10px"><div class="row" style="align-items:center"><div class="grow"><div class="sub" style="white-space:normal">${hh.crew}p × ${(hh.onsite + hh.driveH).toFixed(1)}h = ${hh.personHrs.toFixed(1)} crew-hrs · cost ${money(hh.cost)} · profit ${money(hh.profit)}</div></div><b style="font-size:17px;${hh.perHr < 35 ? "color:var(--danger)" : hh.perHr >= 45 ? "color:var(--accent)" : ""}">${money(hh.perHr)}/hr ea</b></div></div>`;
  h += `</div>`;

  // 6) Notes
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">📝 Notes <span class="sub" style="font-weight:400">· Cap learns from these</span></div>
    <textarea id="job_notes" style="min-height:64px" placeholder="What happened, access notes, gotchas…">${esc(j.notes || "")}</textarea>
    <button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="jobSaveNotes('${j.id}')">Save notes</button></div>`;

  // 6b) Ask Cap about THIS job — context-aware (Cap pulls the job's customer/address/notes/equipment)
  const me2 = (typeof curUser === "function") ? curUser() : null;
  const capTid = "thr_job_" + j.id + "_" + (me2 ? me2.id : "x");
  const capMsgs = (D().messages || []).filter(m => m && !m.kind && !m.deleted && m.threadId === capTid).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">💬 Ask Cap about this job</div>`;
  h += capMsgs.length
    ? capMsgs.slice(-6).map(m => { const isCap = m.senderId === "__ceo__" || m.senderId === "__cap__"; return `<div class="li" style="${isCap ? "background:var(--soft)" : ""}"><div class="grow"><div class="sub" style="font-weight:700">${isCap ? "🤖 Cap" : esc(m.senderLabel || "You")} <span style="font-weight:400">· ${typeof relTime === "function" ? relTime(m.ts) : ""}</span></div><div style="white-space:pre-wrap">${esc(m.body)}</div></div></div>`; }).join("")
    : `<div class="muted">Ask Cap anything about this job — he knows the customer, address, notes &amp; equipment. e.g. "Are we providing the pavers, or is it client-provided?"</div>`;
  h += `<textarea id="jobcap_q" style="min-height:48px;margin-top:8px" placeholder="Ask Cap…"></textarea><button class="btn acc sm" style="margin-top:8px;width:100%" onclick="jobAskCap('${j.id}')">💬 Ask Cap</button></div>`;

  // 7) Change orders
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">🧾 Change orders${coTotal ? ` · <span style="color:var(--accent)">${money(coTotal)}</span>` : ""}</div>`;
  h += cos.length ? cos.map(c => `<div class="li"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal">${esc(c.desc || "")}</div><div class="sub">${c.by ? esc(c.by) + " · " : ""}${c.ts && typeof relTime === "function" ? relTime(c.ts) : ""}</div></div><div class="row" style="gap:8px">${c.amount ? `<div class="nm" style="font-size:15px">${money(c.amount)}</div>` : ""}<button class="btn ghost sm" onclick="jobDelChangeOrder('${j.id}','${c.id}')">✕</button></div></div>`).join("") : `<div class="muted">Nothing changed yet.</div>`;
  h += `<div class="row" style="gap:8px;margin-top:10px"><input id="co_desc" placeholder="What changed on-site…" style="flex:2"><input id="co_amt" type="number" inputmode="decimal" placeholder="$ +/-" style="flex:0 0 92px"></div><button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="jobAddChangeOrder('${j.id}')">+ Add change order</button>`;
  if (j.quoteId && coTotal) h += `<div class="note" style="margin-top:8px">Update the <b>Final price</b> on the quote to bill these.</div>`;
  h += `</div>`;

  // 8) Done + actions
  h += `<button class="btn ${j.done ? "ghost" : "acc"}" style="width:100%;margin-top:4px" onclick="toggleJob('${j.id}')">${j.done ? "↩ Reopen job" : "✓ Mark job done"}</button>`;
  if (typeof jobTemplates === "function") h += `<button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="jobSaveAsTemplate('${j.id}')">⭐ Save as a common job (reuse this)</button>`;
  if (typeof reviewAsk === "function") h += `<button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="reviewAsk()">⭐ Ask for a Google review</button>`;
  if (typeof isOwner === "function" && isOwner()) h += `<button class="btn ghost sm" style="width:100%;margin:8px 0 10px" onclick="openJob('${j.id}')">✏️ Edit job details</button>`;
  return h;
}

window.jobSetParent = function (jobId, parentId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  j.parentJobId = parentId || ""; if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
window.jobToggleLoaded = function (jobId, itemId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const e = (j.equipment || []).find(x => x.itemId === itemId); if (!e) return;
  e.loaded = !e.loaded; if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
window.jobAddExpense = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const amt = parseFloat(val("exp_amt")); if (!(amt > 0)) { alert("Enter the expense amount."); return; }
  const desc = val("exp_desc");
  const input = document.getElementById("exp_receipt"); const file = input && input.files && input.files[0];
  const add = function (receiptId) {
    if (!Array.isArray(j.expenses)) j.expenses = [];
    j.expenses.push({ id: uid(), amount: amt, desc: desc, receiptId: receiptId || null, by: ((typeof curUser === "function" && curUser()) ? curUser().username : ""), ts: now() });
    if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
  };
  if (file && typeof jsUpload === "function") jsUpload(file).then(add).catch(function (e) { alert("Receipt upload failed: " + (e.message || e)); add(null); });
  else add(null);
};
window.jobDelExpense = function (jobId, expId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j || !Array.isArray(j.expenses)) return;
  const e = j.expenses.find(x => x && x.id === expId); if (!e) return;
  e.deleted = true; if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};

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
window.jobAddPhoto = function (jobId, input) {
  const file = input && input.files && input.files[0]; if (!file) return;
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (typeof jsUpload !== "function") { alert("Photo upload needs a connection."); return; }
  jsUpload(file).then(function (id) {
    if (!Array.isArray(j.attachments)) j.attachments = [];
    j.attachments.push({ id: id, name: file.name || "photo", ts: now() });
    if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
  }).catch(function (e) { alert("Upload failed: " + (e.message || e)); });
};
/* Ask Cap a question scoped to this job — posts to a per-user, jobId-tagged Cap thread (1 member so Cap
   converses; toStrategy so it's a Cap channel). The server tags the projection with jobId → Cap pulls
   the job's customer/address/notes/equipment as context when he answers. His reply syncs back here. */
window.jobAskCap = function (jobId) {
  const q = val("jobcap_q"); if (!q) return;
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const me = (typeof curUser === "function") ? curUser() : null; if (!me) { alert("Sign in first."); return; }
  const tid = "thr_job_" + jobId + "_" + me.id;
  const coll = D().messages || (D().messages = []);
  let thr = coll.find(m => m && m.kind === "thread" && m.threadId === tid && !m.deleted);
  if (!thr) { thr = { id: tid, kind: "thread", threadId: tid, title: "Cap · " + (j.title || "Job"), type: "dm", toStrategy: true, jobId: jobId, members: [me.id], createdBy: me.id, deleted: false, updatedAt: now() }; coll.push(thr); }
  else if (!thr.jobId) { thr.jobId = jobId; thr.updatedAt = now(); }
  coll.push({ id: "msg_" + uid(), threadId: tid, senderId: me.id, senderLabel: me.username || "—", body: q, ts: now(), deleted: false, updatedAt: now() });
  if (typeof save === "function") save(); if (typeof render === "function") render();
};
window.jobSaveTravel = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  j.crewN = Math.max(1, parseInt(val("jt_crew")) || 1);
  j.onSiteHrs = parseFloat(val("jt_onsite")) || 0;
  j.driveMin = parseFloat(val("jt_drivemin")) || 0;
  j.driveMiles = parseFloat(val("jt_drivemiles")) || 0;
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
window.jobEstimateDrive = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const ll = (typeof jobLatLng === "function") ? jobLatLng(j) : null;
  const d = (ll && typeof driveFromBase === "function") ? driveFromBase(ll.lat, ll.lng) : null;
  if (!d) { alert("Need the job's location + a home base set to estimate."); return; }
  const dm = document.getElementById("jt_drivemin"); if (dm) dm.value = Math.round(d.min * 2);   // round trip
  const mi = document.getElementById("jt_drivemiles"); if (mi) mi.value = d.roundMiles;
};
window.jobSaveAsTemplate = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j || typeof jobTemplates !== "function") return;
  const addr = (typeof jobAddr === "function") ? jobAddr(j) : (j.address || "");
  const tdoc = jobTemplates();
  const item = { id: uid(), label: String(j.title || "Common job").slice(0, 30), title: j.title || "Job", address: addr, crewN: (+j.crewN || (j.crew || []).length || 1), onSiteHrs: +j.onSiteHrs || 0, driveMin: +j.driveMin || 0, driveMiles: +j.driveMiles || 0, deleted: false };
  tdoc.list.push(item); tdoc.updatedAt = now(); if (typeof touch === "function") touch(tdoc); save();
  alert('Saved "' + item.label + '" as a common job — tap "+ Add" on Today to reuse it in one tap.');
};
