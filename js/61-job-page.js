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
/* ===== Google Maps link builders — labels at the call site must always say WHERE the link goes (never bare
   "Google Maps" — that's how a one-way job-site link and a round-trip-from-base link both got tapped by
   mistake looking for the materials supplier: neither was labeled, neither WAS the supplier). No API key
   needed: the standard /maps/dir/?api=1 deep link opens turn-by-turn from wherever the phone already is. */
function gmapsDirUrl(destination, waypoints) {
  let u = "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination || "");
  if (waypoints && waypoints.length) u += "&waypoints=" + waypoints.map(w => encodeURIComponent(w)).join("|");
  return u;
}
/* ADMIN-PLANNED route for a job — ordered [{id,label,address,lat,lng}] set on the job editor (js/09), e.g.
   "Stoneworks — pick up base" before the job site itself. Distinct from js/38's crew-added ad hoc timeclock
   stops[] (logged as-driven, after the fact) — this is the route planned in ADVANCE by the owner/admin. */
function jobPlannedStops(j) { return (Array.isArray(j && j.plannedStops) ? j.plannedStops : []).filter(s => s && s.address); }

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
  h += editedByLine(j);

  // 1) Where & when — directions + call
  h += `<div class="card"><div class="nm" style="font-size:18px">${esc(cust || "—")}</div>`;
  h += addr ? `<div class="sub" style="white-space:normal;margin-top:3px">${esc(addr)}</div>` : `<div class="muted" style="margin-top:3px">No address on file.</div>`;
  if (_drive) h += `<div class="sub" style="margin-top:3px;font-weight:600;color:var(--brand-text)">${_drive}</div>`;
  h += `<div class="sub" style="margin-top:8px;white-space:normal">📅 ${j.date ? fmtDate(j.date) : "—"}${j.time ? " · " + esc(j.time) : ""}${crewNames ? " · 👥 " + esc(crewNames) : ""}</div>`;
  if (j.done) h += `<div class="sub" style="margin-top:6px;color:var(--accent);font-weight:800">✓ Completed</div>`;
  const _stops = jobPlannedStops(j);
  if (_stops.length) {
    // ADMIN-PLANNED ROUTE: each stop gets its OWN correctly-labeled link (e.g. "Stoneworks — pick up base"),
    // the job site is always the final stop, and ≥2 total stops also get ONE combined multi-stop link
    // (waypoints chained in order) so the crew can tap once and get turn-by-turn through the whole run.
    h += `<div class="sub" style="margin-top:10px;font-weight:700">🧭 Planned route <span class="sub" style="font-weight:400">· ${_stops.length} stop${_stops.length > 1 ? "s" : ""}${addr ? " + job site" : ""}</span></div>`;
    h += _stops.map((s, i) => `<div class="li" style="padding:6px 0"><div class="grow"><div class="nm" style="font-size:14px">${i + 1}. ${esc(s.label || "Stop")}</div><div class="sub" style="white-space:normal">${esc(s.address)}</div></div><a class="btn ghost sm" href="${gmapsDirUrl(s.address)}" target="_blank" rel="noopener">🧭 Directions</a></div>`).join("");
    if (addr) h += `<div class="li" style="padding:6px 0"><div class="grow"><div class="nm" style="font-size:14px">${_stops.length + 1}. 🏁 Job site</div><div class="sub" style="white-space:normal">${esc(addr)}</div></div><a class="btn ghost sm" href="${gmapsDirUrl(addr)}" target="_blank" rel="noopener">🧭 Directions</a></div>`;
    const _allDest = _stops.map(s => s.address).concat(addr ? [addr] : []);
    if (_allDest.length >= 2) {
      const _dest = _allDest[_allDest.length - 1], _wps = _allDest.slice(0, -1);
      h += `<a class="btn acc" style="width:100%;margin-top:8px;text-align:center" href="${gmapsDirUrl(_dest, _wps)}" target="_blank" rel="noopener">🗺 Full route — ${_allDest.length} stops</a>`;
    }
    if (phone) h += `<div class="row" style="gap:8px;margin-top:8px"><a class="btn ghost grow" href="tel:${tel(phone)}">📞 Call</a></div>`;
  } else if (addr || phone) {
    h += `<div class="row" style="gap:8px;margin-top:10px">`;
    if (addr) h += `<a class="btn ghost grow" href="${gmapsDirUrl(addr)}" target="_blank" rel="noopener">📍 Job site — Directions</a>`;
    if (phone) h += `<a class="btn ghost grow" href="tel:${tel(phone)}">📞 Call</a>`;
    h += `</div>`;
  }
  h += `</div>`;

  // 1a) Work days — fast, low-friction multi-day editing from the field, without opening the full job editor.
  // Compact chip list of the job's work days (jobWorkDays), today's chip marked, start-day un-removable;
  // "+ Add today" is a one-tap no-modal add; "+ Add another day" opens a small mini-calendar-only picker.
  h += jobPageWorkDaysCard(j);

  // 1b) Part of a bigger job? — file this under a parent (e.g. a dump run under a tree job); its costs roll up.
  // sharedJobIds[] generalizes the old scalar parentJobId (0/1/N jobs); this single-select stays the UNCHANGED
  // common-case UI (1 parent) and writes sharedJobIds=[oneId] under the hood — the multi-job case is the new
  // "🔀 Split across other jobs" picker below, on the OTHER job's page (the one the stop-job is created from).
  const _subs = (typeof subJobsOf === "function") ? subJobsOf(j.id) : [];
  const _opts = (typeof actJ === "function" ? actJ() : []).filter(x => x && x.id !== j.id && !Array.isArray(x.sharedJobIds));
  h += `<div class="card"><label style="margin-top:0">↳ Part of a bigger job?</label><select onchange="jobSetParent('${j.id}',this.value)"><option value="">— standalone job —</option>` + _opts.map(x => `<option value="${x.id}" ${(Array.isArray(j.sharedJobIds) && j.sharedJobIds.length === 1 && j.sharedJobIds[0] === x.id) ? "selected" : ""}>${esc(x.title || "Job")}${x.customerId && typeof custName === "function" ? " · " + esc(custName(x.customerId)) : ""}${x.date ? " · " + fmtDate(x.date) : ""}</option>`).join("") + `</select>`;
  if (Array.isArray(j.sharedJobIds) && j.sharedJobIds.length === 1) h += `<div class="sub" style="margin-top:6px;white-space:normal">Its mileage, dump fees &amp; time roll up into that job's cost.</div>`;
  else if (Array.isArray(j.sharedJobIds) && j.sharedJobIds.length > 1) {
    const _names = j.sharedJobIds.map(id => { const oj = (typeof actJ === "function" ? actJ() : []).find(x => x.id === id); return oj ? (oj.title || "Job") : null; }).filter(Boolean);
    h += `<div class="sub" style="margin-top:6px;white-space:normal">Split evenly across ${j.sharedJobIds.length} jobs: ${_names.map(esc).join(", ")}.</div>`;
  } else if (Array.isArray(j.sharedJobIds) && j.sharedJobIds.length === 0) {
    h += `<div class="sub" style="margin-top:6px;white-space:normal">Marked as general business overhead — not charged to any job.</div>`;
  }
  if (_subs.length) h += `<div class="sub" style="margin-top:8px;font-weight:700">Stops rolled into this job:</div>` + _subs.map(sj => {
    const n = Math.max(1, (sj.sharedJobIds || []).length);
    const _total = (typeof plExpenses === "function" ? plExpenses(sj).filter(x => x && !x.deleted).reduce((s, e) => s + (+e.amount || 0), 0) : 0) + (typeof plMaterials === "function" ? plMaterials(sj).filter(x => x && !x.deleted).reduce((s, e) => s + (+e.amount || 0), 0) : 0);
    const _share = _total / n;
    const _assignee = (sj.crew && sj.crew[0] && typeof userName === "function") ? (userName(sj.crew[0]) || "") : "";
    const _others = (sj.sharedJobIds || []).filter(id => id !== j.id).map(id => { const oj = (typeof actJ === "function" ? actJ() : []).find(x => x.id === id); return oj ? (oj.title || "Job") : null; }).filter(Boolean);
    return `<div class="li" onclick="openJobPage('${sj.id}')" style="cursor:pointer"><div class="grow"><div class="nm" style="font-size:14px;white-space:normal">${(typeof stopEmoji === "function" ? stopEmoji(sj.stopKind) : "🔀")} ${esc(sj.title || "Job")}${_assignee ? " · " + esc(_assignee) : ""}${sj.date ? " · " + fmtDate(sj.date) : ""}</div><div class="sub" style="white-space:normal">${money(_total)} total${n > 1 ? ` · split ${n} ways${_others.length ? " with " + _others.map(esc).join(", ") : ""} · this job's share ${money(_share)}` : ""}</div></div><span class="sub">open →</span></div>`;
  }).join("");
  h += `</div>`;

  // 2) Load checklist — load the truck before you drive. Prominent progress count (N/M loaded) + a
  // needs-cleaning badge on any flagged item (ties Part A + B: "grab the chainsaw — it needs cleaning first").
  const _eq = (j.equipment || []).filter(e => e && e.itemId);
  const _loadedN = _eq.filter(e => e.loaded).length;
  const _allLoaded = _eq.length && _loadedN === _eq.length;
  const _prog = _eq.length ? ` <span class="badge" style="background:${_allLoaded ? "var(--accent)" : "var(--soft)"};color:${_allLoaded ? "#fff" : "var(--muted)"};margin-left:2px">${_loadedN}/${_eq.length} loaded</span>` : "";
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">🧰 Load checklist${_prog} <span class="sub" style="font-weight:400">· check off as you load</span></div>`;
  h += _eq.length ? _eq.map(e => { const it = (typeof eqItemById === "function") ? eqItemById(e.itemId) : null; const nm = it ? (it.name || e.itemId) : e.itemId; const dirty = (it && it.needsCleaning) ? ` <span class="badge" style="background:#b8860b;color:#fff">🧽 needs cleaning</span>` : ""; return `<label class="li" style="cursor:pointer"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal;${e.loaded ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(nm)}${dirty}</div></div><div class="row" style="gap:10px;align-items:center"><span class="sub">×${e.qty || 1}</span><input type="checkbox" style="width:22px;height:22px" ${e.loaded ? "checked" : ""} onchange="jobToggleLoaded('${j.id}','${esc(e.itemId)}')"></div></label>`; }).join("") : `<div class="muted">No equipment assigned to this job.</div>`;
  h += `</div>`;

  // 3) Time clock — each person clocks in with their own vehicle + odometer
  h += `<div class="card" style="border-left:5px solid var(--accent)"><div style="font-weight:800;margin-bottom:8px">⏱️ Time clock</div>`;
  const _estEach = (typeof jobEstHrsEach === "function") ? jobEstHrsEach(j) : 0, _estCrew = (typeof jobEstCrew === "function") ? jobEstCrew(j) : 1, _estCH = (typeof jobEstCrewHrs === "function") ? jobEstCrewHrs(j) : 0, _actCH = (typeof jobClockedHrs === "function") ? jobClockedHrs(j) : 0;
  if (_estCH > 0 || _actCH > 0) {
    let _cmp = "";
    if (_estCH > 0 && _actCH > 0) { const _p = Math.round(_actCH / _estCH * 100); _cmp = ` · logged <b>${_actCH}</b> (${_p}% of est${j.done ? (_actCH > _estCH ? ` · ${(_actCH - _estCH).toFixed(1)}h over` : ` · ${(_estCH - _actCH).toFixed(1)}h under`) : ""})`; }
    else if (_actCH > 0) _cmp = ` · logged <b>${_actCH}</b> crew-hrs so far`;
    h += `<div class="sub" style="margin-bottom:8px;white-space:normal">📐 Estimated <b>${_estCH || "—"} crew-hrs</b>${_estEach ? ` (~${_estEach} hr each · ${_estCrew} ${_estCrew === 1 ? "person" : "people"})` : ""}${_cmp}. <span style="color:var(--muted)">Breaks don't count — clock out for lunch, back in after.</span></div>`;
  }
  if (onJob.length) h += `<div class="sub" style="margin-bottom:8px">On this job now: ${onJob.map(e => `<b>${esc((typeof userName === "function" ? userName(e.userId) : "") || "crew")}</b>${e.vehicle ? " · " + esc(e.vehicle) : ""}`).join(" · ")}</div>`;
  if (openThis) h += `<div class="sub">You're clocked in since <b>${hhmm(openThis.clockIn)}</b>${openThis.vehicle ? " · " + esc(openThis.vehicle) : ""}</div>${_estEach ? `<div class="sub" style="margin-top:2px;color:var(--brand-text);font-weight:600">⏱ Likely finish ~${hhmm(openThis.clockIn + _estEach * 3600000)} (your ~${_estEach} hr share, excl. breaks)</div>` : ""}<button class="btn danger" style="margin-top:8px;width:100%;padding:13px" onclick="tcClockOut('${openThis.id}')">Clock out</button>`;
  else if (openOther) { const oj = (typeof actJ === "function") ? actJ().find(x => x.id === openOther.jobId) : null; h += `<div class="note">You're clocked into <b>${esc(oj ? (oj.title || "another job") : "another job")}</b> — clock out of it first.</div><button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="tcClockOut('${openOther.id}')">Clock out of that job</button>`; }
  else h += `<input type="hidden" id="tc_job" value="${esc(j.id)}"><label style="margin-top:0">Your vehicle</label><input id="tc_vehicle" list="veh_list" placeholder="pick a truck — or type your own car" autocomplete="off"><datalist id="veh_list">${vehs.map(v => `<option value="${esc(v.name)}">`).join("")}</datalist><label>Odometer — start</label><input id="tc_odo_start" type="number" inputmode="decimal" placeholder="miles showing now"><div class="sub" style="margin-top:8px;white-space:normal">🚗 <b>Clock in when you leave for the job</b> (not when you arrive) — keeps the time estimate honest.</div><button class="btn acc" style="margin-top:10px;width:100%;padding:13px" onclick="tcClockIn()">⏱️ Clock in</button>`;
  h += `</div>`;

  // 4) Job photos — documentation gallery, inline so anyone who opens the job sees them
  const atts = (j.attachments || []).filter(a => a && !a.deleted);
  h += `<div class="card"><div style="font-weight:800;margin-bottom:8px">🖼 Job photos <span class="sub" style="font-weight:400">· documentation</span></div>`;
  if (atts.length) h += `<div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:8px">` + atts.map(a => `<a href="${upUrl(a.id)}" target="_blank" rel="noopener"><img src="${upUrl(a.id)}" style="width:100px;height:100px;object-fit:cover;border-radius:8px;border:1px solid var(--line)" loading="lazy"></a>`).join("") + `</div>`;
  else h += `<div class="muted" style="margin-bottom:8px">No photos yet.</div>`;
  h += `<input type="file" id="job_photo" accept="image/*" style="display:none" onchange="jobAddPhoto('${j.id}',this)"><button class="btn acc" style="width:100%" onclick="document.getElementById('job_photo').click()">📷 Add photo</button></div>`;

  // 5) Expenses & receipts — amount + what for (required), receipt photo optional + collapsed, optional fault attribution
  const _members = (typeof schedMembers === "function") ? schedMembers() : [];
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">💵 Expenses &amp; receipts${expTotal ? ` · <span style="color:var(--accent)">${money(expTotal)}</span>` : ""}</div>`;
  h += exps.length ? exps.map(e => { const _fm = e.faultMemberId ? ((typeof userName === "function" ? userName(e.faultMemberId) : "") || "someone") : ""; return `<div class="li"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal">${money(e.amount)}${e.vendor ? " <b>" + esc(e.vendor) + "</b>" : ""} <span class="sub" style="font-weight:400">${esc(e.desc || "")}</span></div><div class="sub">${e.by ? esc(e.by) + " · " : ""}${e.ts && typeof relTime === "function" ? relTime(e.ts) : ""}${_fm ? ` · <span style="color:var(--danger);font-weight:700">⚠ ${esc(_fm)}'s mistake — docks their payout</span>` : ""}</div></div><div class="row" style="gap:8px;align-items:center">${e.receiptId ? `<a class="btn ghost sm" href="${upUrl(e.receiptId)}" target="_blank" rel="noopener">📎 receipt</a>` : `<span class="sub" style="color:var(--muted)">no receipt</span>`}<button class="btn ghost sm" onclick="jobDelExpense('${j.id}','${e.id}')">✕</button></div></div>`; }).join("") : `<div class="muted">No expenses logged. Enter the amount + what it was for; a receipt photo is optional.</div>`;
  const _faults = {}; exps.forEach(e => { if (e.faultMemberId) _faults[e.faultMemberId] = (_faults[e.faultMemberId] || 0) + (+e.amount || 0); });
  const _fkeys = Object.keys(_faults);
  if (_fkeys.length) h += `<div class="note" style="margin-top:8px;border-left:3px solid var(--danger);white-space:normal">⚠ <b>Fault docks on this job:</b> ${_fkeys.map(id => `${esc((typeof userName === "function" ? userName(id) : "") || "?")} <b>${money(_faults[id])}</b>`).join(" · ")} — comes out of their payout, not the crew's.</div>`;
  h += `<div class="row" style="gap:8px;margin-top:10px"><input id="exp_amt" type="number" inputmode="decimal" placeholder="$" style="flex:0 0 80px"><input id="exp_vendor" placeholder="Vendor / store" style="flex:2"></div>`;
  h += `<input id="exp_desc" placeholder="What for — dump fee, materials… (required)" style="margin-top:6px">`;
  h += `<label style="margin-top:8px">Whose mistake caused this? <span class="sub">(optional — docks <i>their</i> payout, not the whole crew's)</span></label><select id="exp_fault"><option value="">— nobody's fault / shared job cost —</option>${_members.map(u => `<option value="${esc(u.id)}">${esc(u.username)}</option>`).join("")}</select>`;
  h += `<input type="file" id="exp_receipt" accept="image/*" style="display:none" onchange="var l=document.getElementById('exp_receipt_lbl');if(l)l.textContent='✓ Receipt ready'"><div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost grow" onclick="document.getElementById('exp_receipt').click()"><span id="exp_receipt_lbl">📎 Receipt (optional)</span></button><button class="btn acc grow" id="exp_add_btn" onclick="jobAddExpense('${j.id}')">+ Add expense</button></div><button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="jobOpenSplitPicker('${j.id}','expense')">🔀 Split across other jobs / mark as generic</button></div>`;

  // 5a) Pass-through materials — billed to the customer at cost (reimbursed), tracked SEPARATELY from real expenses + their own receipt pile
  const mats = (j.materials || []).filter(x => x && !x.deleted);
  const matTotal = mats.reduce((s, e) => s + (+e.amount || 0), 0);
  h += `<div class="card" style="border-left:5px solid #b8860b"><div style="font-weight:800;margin-bottom:4px">🧱 Pass-through materials${matTotal ? ` · <span style="color:#b8860b">${money(matTotal)}</span>` : ""}</div>`;
  h += `<div class="sub" style="margin-bottom:6px;white-space:normal">Materials billed to the customer at cost (pavers, rock, sand, edging…). Reimbursed — not your expense; kept off the real-expense pile but counted as job cost so margin stays honest.</div>`;
  h += mats.length ? mats.map(e => `<div class="li"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal">${money(e.amount)}${e.vendor ? " <b>" + esc(e.vendor) + "</b>" : ""} <span class="sub" style="font-weight:400">${esc(e.desc || "")}</span></div><div class="sub">${e.by ? esc(e.by) + " · " : ""}${e.ts && typeof relTime === "function" ? relTime(e.ts) : ""}</div></div><div class="row" style="gap:8px;align-items:center">${e.receiptId ? `<a class="btn ghost sm" href="${upUrl(e.receiptId)}" target="_blank" rel="noopener">📎 receipt</a>` : `<span class="sub" style="color:var(--muted)">no receipt</span>`}<button class="btn ghost sm" onclick="jobDelMaterial('${j.id}','${e.id}')">✕</button></div></div>`).join("") : `<div class="muted">No materials logged. Enter the amount + what it was; the receipt photo is optional.</div>`;
  h += `<div class="row" style="gap:8px;margin-top:10px"><input id="mat_amt" type="number" inputmode="decimal" placeholder="$" style="flex:0 0 80px"><input id="mat_vendor" placeholder="Vendor / store" style="flex:2"></div>`;
  h += `<input id="mat_desc" placeholder="What — pavers, base rock, edging… (required)" style="margin-top:6px">`;
  h += `<input type="file" id="mat_receipt" accept="image/*" style="display:none" onchange="var l=document.getElementById('mat_receipt_lbl');if(l)l.textContent='✓ Receipt ready'"><div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost grow" onclick="document.getElementById('mat_receipt').click()"><span id="mat_receipt_lbl">📎 Receipt (optional)</span></button><button class="btn acc grow" id="mat_add_btn" onclick="jobAddMaterial('${j.id}')">+ Add material</button></div><button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="jobOpenSplitPicker('${j.id}','material')">🔀 Split across other jobs / mark as generic</button></div>`;

  // 5b) Time & travel — reconstruct/log for the real effective $/hr (drive time is the silent cost)
  const hh = (typeof jobHourly === "function") ? jobHourly(j) : null;
  const _hb = (typeof homeBase === "function") ? homeBase() : null;
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">⏱ Time &amp; travel <span class="sub" style="font-weight:400">· drives the real $/hr</span></div>
    <div class="row" style="gap:8px"><div class="grow"><label style="margin-top:0">Crew</label><input id="jt_crew" type="number" inputmode="numeric" min="1" value="${(+j.crewN || (j.crew || []).length || 1)}"></div>
      <div class="grow"><label style="margin-top:0">On-site hrs each</label><input id="jt_onsite" type="number" inputmode="decimal" step="0.25" value="${j.onSiteHrs || ""}" placeholder="0"></div></div>
    <div class="row" style="gap:8px"><div class="grow"><label style="margin-top:0">Drive min (round trip)</label><input id="jt_drivemin" type="number" inputmode="numeric" value="${j.driveMin || ""}" placeholder="0"></div>
      <div class="grow"><label style="margin-top:0">Drive miles (round trip)</label><input id="jt_drivemiles" type="number" inputmode="decimal" value="${j.driveMiles || ""}" placeholder="0"></div></div>
    <div class="row" style="gap:8px;margin-top:8px">${_ll ? `<button class="btn ghost grow" onclick="jobEstimateDrive('${j.id}')">📍 Estimate from base</button>` : ""}${(addr && _hb && _hb.address) ? `<a class="btn ghost grow" href="https://www.google.com/maps/dir/${encodeURIComponent(_hb.address)}/${encodeURIComponent(addr)}/${encodeURIComponent(_hb.address)}" target="_blank" rel="noopener">🔄 Round trip: base → job → base</a>` : ""}</div>
    <button class="btn acc sm" style="margin-top:8px;width:100%" onclick="jobSaveTravel('${j.id}')">Save time &amp; travel</button>`;
  if (hh && hh.perHr != null) h += `<div class="card" style="background:var(--soft);margin-top:8px;padding:10px"><div class="row" style="align-items:center"><div class="grow"><div class="sub" style="white-space:normal">${hh.crew}p × ${(hh.onsite + hh.driveH).toFixed(1)}h = ${hh.personHrs.toFixed(1)} crew-hrs · cost ${money(hh.cost)} · profit ${money(hh.profit)}</div></div><b style="font-size:17px;${hh.perHr < 35 ? "color:var(--danger)" : hh.perHr >= 45 ? "color:var(--accent)" : ""}">${money(hh.perHr)}/hr ea</b></div></div>`;
  h += `</div>`;

  // 6) Notes
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">📝 Notes <span class="sub" style="font-weight:400">· Cap learns from these</span></div>
    <textarea id="job_notes" style="min-height:64px" placeholder="What happened, access notes, gotchas…">${esc(j.notes || "")}</textarea>
    <button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="jobSaveNotes('${j.id}')">Save notes</button></div>`;

  // 6b) Ask Cap about THIS job — context-aware (Cap pulls the job's customer/address/notes/equipment)
  const me2 = (typeof curUser === "function") ? curUser() : null;
  const capTid = "thr_job_" + j.id;   // ONE shared thread per job — the whole crew + Cap share it
  const _legacyPrefix = capTid + "_";  // tolerate un-migrated per-user threads (thr_job_<id>_<uid>) so no message is lost
  const capMsgs = (D().messages || []).filter(m => m && !m.kind && !m.deleted && (m.threadId === capTid || (m.threadId || "").indexOf(_legacyPrefix) === 0)).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">💬 Ask Cap <span class="sub" style="font-weight:400">· attach a photo</span></div>`;
  h += capMsgs.length
    ? capMsgs.slice(-6).map(m => { const isCap = m.senderId === "__ceo__" || m.senderId === "__cap__"; const _ma = (m.attachments || []).filter(a => a && a.id && !a.deleted); return `<div class="li" style="${isCap ? "background:var(--soft)" : ""}"><div class="grow"><div class="sub" style="font-weight:700">${isCap ? "🤖 Cap" : esc(m.senderLabel || "You")} <span style="font-weight:400">· ${typeof relTime === "function" ? relTime(m.ts) : ""}</span></div><div style="white-space:pre-wrap">${esc(m.body)}</div>${_ma.map(a => `<a href="${upUrl(a.id)}" target="_blank" rel="noopener"><img src="${upUrl(a.id)}" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid var(--line);margin-top:6px" loading="lazy"></a>`).join("")}</div></div>`; }).join("")
    : `<div class="muted">Ask Cap anything about this job — he knows the customer, address, notes &amp; equipment. e.g. "Are we providing the pavers, or is it client-provided?"</div>`;
  h += `<textarea id="jobcap_q" style="min-height:48px;margin-top:8px" placeholder="Ask Cap… (e.g. send a photo of the spot and ask what base it needs)"></textarea><input type="file" id="jobcap_photo" accept="image/*" style="display:none" onchange="var l=document.getElementById('jobcap_photo_lbl');if(l)l.textContent='✓ Photo ready'"><div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost grow" onclick="document.getElementById('jobcap_photo').click()"><span id="jobcap_photo_lbl">📷 Attach photo</span></button><button class="btn acc grow" onclick="jobAskCap('${j.id}')">💬 Ask Cap</button></div></div>`;

  // 7) Change orders
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">🧾 Change orders${coTotal ? ` · <span style="color:var(--accent)">${money(coTotal)}</span>` : ""}</div>`;
  h += cos.length ? cos.map(c => `<div class="li"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal">${esc(c.desc || "")}</div><div class="sub">${c.by ? esc(c.by) + " · " : ""}${c.ts && typeof relTime === "function" ? relTime(c.ts) : ""}</div></div><div class="row" style="gap:8px">${c.amount ? `<div class="nm" style="font-size:15px">${money(c.amount)}</div>` : ""}<button class="btn ghost sm" onclick="jobDelChangeOrder('${j.id}','${c.id}')">✕</button></div></div>`).join("") : `<div class="muted">Nothing changed yet.</div>`;
  h += `<div class="row" style="gap:8px;margin-top:10px"><input id="co_desc" placeholder="What changed on-site…" style="flex:2"><input id="co_amt" type="number" inputmode="decimal" placeholder="$ +/-" style="flex:0 0 92px"></div><button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="jobAddChangeOrder('${j.id}')">+ Add change order</button>`;
  if (j.quoteId) h += `<button class="btn ghost sm" style="margin-top:8px;width:100%;text-align:left" onclick="openQuote('${j.quoteId}')">✎ Edit the full quote — size · materials · price (change order)</button>`;
  if (j.quoteId && coTotal) h += `<div class="note" style="margin-top:8px">Update the <b>Final price</b> on the quote to bill these.</div>`;
  h += `</div>`;

  // 8) Done + actions
  h += `<button class="btn ${j.done ? "ghost" : "acc"}" style="width:100%;margin-top:4px" onclick="toggleJob('${j.id}')">${j.done ? "↩ Reopen job" : "✓ Mark job done"}</button>`;
  if (typeof jobTemplates === "function") h += `<button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="jobSaveAsTemplate('${j.id}')">⭐ Save as a common job (reuse this)</button>`;
  if (typeof reviewAsk === "function") h += `<button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="reviewAsk()">⭐ Ask for a Google review</button>`;
  if (typeof isOwner === "function" && isOwner()) h += `<button class="btn ghost sm" style="width:100%;margin:8px 0 6px" onclick="openJob('${j.id}')">✏️ Edit job details</button>`;
  if (typeof isOwner === "function" && isOwner()) h += `<button class="btn ghost sm" style="width:100%;margin:0 0 14px;color:var(--danger)" onclick="delJob('${j.id}')">🗑 Delete job (to Archive, 60-day undo)</button>`;
  return h;
}

window.jobSetParent = function (jobId, parentId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  j.parentJobId = parentId || "";   // kept for back-compat/audit trail — unread by new code
  j.sharedJobIds = parentId ? [parentId] : null;   // the model going forward: membership match, not equality
  if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
window.jobToggleLoaded = function (jobId, itemId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const e = (j.equipment || []).find(x => x.itemId === itemId); if (!e) return;
  e.loaded = !e.loaded; if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
/* Submit-in-flight guards for "+ Add expense" / "+ Add material": a slow save over a weak jobsite
   connection used to look like a no-op, so a tap-happy user would fire the handler a dozen times —
   each one independently reading the SAME amount/vendor/desc/receipt-file off the DOM and creating its
   OWN duplicate record (the June 2026 dupe-material incident: ~20 taps → 20 records, no photo on any of
   them because 20 concurrent uploads of the same file mostly failed under contention). The guard below
   makes every repeat tap while a save is in flight a silent no-op (button also disables + shows
   "Adding…" → "✓ Added" so a slow save is visibly NOT stuck), so at most one record — carrying the one
   photo actually selected — gets created per tap. */
let _jobExpAddBusy = false, _jobExpAddWatchdog = null;
window.jobAddExpense = function (jobId) {
  if (_jobExpAddBusy) return;   // ignore rapid re-taps while a save is already in flight
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const amt = parseFloat(val("exp_amt")); if (!(amt > 0)) { alert("Enter the expense amount."); return; }
  const desc = (val("exp_desc") || "").trim(); if (!desc) { alert("Enter what the expense was for."); return; }
  const vendor = (val("exp_vendor") || "").trim();
  const fault = val("exp_fault") || "";
  const input = document.getElementById("exp_receipt");
  const file = input && input.files && input.files[0];   // captured NOW, before the lock's async gate — nothing else can read/clear this input until we're done
  const btn = document.getElementById("exp_add_btn");
  _jobExpAddBusy = true; if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
  clearTimeout(_jobExpAddWatchdog); _jobExpAddWatchdog = setTimeout(function () { _jobExpAddBusy = false; }, 20000); // safety: never permanently soft-lock the button if a save hangs
  const finish = function (receiptId) {
    clearTimeout(_jobExpAddWatchdog);
    if (!Array.isArray(j.expenses)) j.expenses = [];
    j.expenses.push({ id: uid(), amount: amt, vendor: vendor, desc: desc, receiptId: receiptId || null, faultMemberId: fault || null, by: ((typeof curUser === "function" && curUser()) ? curUser().username : ""), ts: now() });
    if (typeof touch === "function") touch(j); if (typeof save === "function") save();
    if (btn) btn.textContent = "✓ Added";
    setTimeout(function () { _jobExpAddBusy = false; if (typeof render === "function") render(); }, 450);
  };
  if (file && typeof jsUpload === "function") jsUpload(file).then(finish).catch(function (e) { alert("Receipt upload failed: " + (e.message || e)); finish(null); });
  else finish(null);
};
window.jobDelExpense = function (jobId, expId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j || !Array.isArray(j.expenses)) return;
  const e = j.expenses.find(x => x && x.id === expId); if (!e) return;
  e.deleted = true; if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};
let _jobMatAddBusy = false, _jobMatAddWatchdog = null;
window.jobAddMaterial = function (jobId) {
  if (_jobMatAddBusy) return;   // ignore rapid re-taps while a save is already in flight — this is the June 2026 dupe-material bug
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const amt = parseFloat(val("mat_amt")); if (!(amt > 0)) { alert("Enter the material amount."); return; }
  const desc = (val("mat_desc") || "").trim(); if (!desc) { alert("Enter what the material was."); return; }
  const vendor = (val("mat_vendor") || "").trim();
  const input = document.getElementById("mat_receipt");
  const file = input && input.files && input.files[0];   // captured NOW, before the lock's async gate — nothing else can read/clear this input until we're done
  const btn = document.getElementById("mat_add_btn");
  _jobMatAddBusy = true; if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
  clearTimeout(_jobMatAddWatchdog); _jobMatAddWatchdog = setTimeout(function () { _jobMatAddBusy = false; }, 20000); // safety: never permanently soft-lock the button if a save hangs
  const finish = function (receiptId) {
    clearTimeout(_jobMatAddWatchdog);
    if (!Array.isArray(j.materials)) j.materials = [];
    j.materials.push({ id: uid(), amount: amt, vendor: vendor, desc: desc, receiptId: receiptId || null, by: ((typeof curUser === "function" && curUser()) ? curUser().username : ""), ts: now() });
    if (typeof touch === "function") touch(j); if (typeof save === "function") save();
    if (btn) btn.textContent = "✓ Added";
    setTimeout(function () { _jobMatAddBusy = false; if (typeof render === "function") render(); }, 450);
  };
  if (file && typeof jsUpload === "function") jsUpload(file).then(finish).catch(function (e) { alert("Receipt upload failed: " + (e.message || e)); finish(null); });
  else finish(null);
};
window.jobDelMaterial = function (jobId, mId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j || !Array.isArray(j.materials)) return;
  const e = j.materials.find(x => x && x.id === mId); if (!e) return;
  e.deleted = true; if (typeof touch === "function") touch(j); if (typeof save === "function") save(); if (typeof render === "function") render();
};

window.jobAddChangeOrder = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const desc = val("co_desc"); if (!desc) { alert("Describe what changed first."); return; }
  if (typeof submitGuard === "function" && !submitGuard("jobAddChangeOrder:" + jobId)) return;   // rapid-tap dupe guard
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
/* Ask Cap a question scoped to this job — posts to the ONE shared per-job Cap thread (thr_job_<jobId>):
   the whole crew on the job + Cap share it, so everyone sees the same conversation. members carries the
   job crew (drives server push / Cap-reply fan-out); js/47 threadVisible also widens to the live job crew.
   toStrategy marks it a Cap channel; the server tags the projection with jobId so Cap pulls the job's
   customer/address/notes/equipment as context. His reply syncs back here. */
window.jobAskCap = function (jobId) {
  const q = (val("jobcap_q") || "").trim();
  const pinput = document.getElementById("jobcap_photo"); const pfile = pinput && pinput.files && pinput.files[0];
  if (!q && !pfile) return;
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const me = (typeof curUser === "function") ? curUser() : null; if (!me) { alert("Sign in first."); return; }
  const tid = "thr_job_" + jobId;
  const coll = D().messages || (D().messages = []);
  let thr = coll.find(m => m && m.kind === "thread" && m.threadId === tid && !m.deleted);
  const _cust = (j.customerId && typeof custName === "function") ? custName(j.customerId) : "";
  const _jtTitle = "📋 Job: " + (j.title || "Job") + ((_cust && _cust !== "—") ? " · " + _cust : "");   // clear job-scoped title on the Messages page (threadTitle renders this live too)
  const _crew = (Array.isArray(j.crew) ? j.crew.filter(Boolean) : []).slice(); if (_crew.indexOf(me.id) < 0) _crew.push(me.id);   // job crew + me share this thread
  if (!thr) { thr = { id: tid, kind: "thread", threadId: tid, title: _jtTitle, type: "dm", toStrategy: true, jobId: jobId, members: _crew, createdBy: me.id, deleted: false, updatedAt: now() }; coll.push(thr); }
  else { if (!thr.jobId) thr.jobId = jobId; _crew.forEach(id => { if ((thr.members || (thr.members = [])).indexOf(id) < 0) thr.members.push(id); }); thr.updatedAt = now(); }
  const post = function (atts) {
    coll.push({ id: "msg_" + uid(), threadId: tid, senderId: me.id, senderLabel: me.username || "—", body: q || "(photo)", ts: now(), attachments: (atts && atts.length) ? atts : undefined, deleted: false, updatedAt: now() });
    if (typeof save === "function") save(); if (typeof render === "function") render();
  };
  if (pfile && typeof jsUpload === "function") jsUpload(pfile).then(function (id) { post([{ id: id }]); }).catch(function (e) { alert("Photo upload failed: " + (e.message || e)); post([]); });
  else post([]);
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

/* ===== "🔀 Split across other jobs / mark as generic" — multi-job (0/1/N) attribution for a dump run /
   material pickup, next to +Add expense / +Add material. Picks which job(s) a stop's cost belongs to —
   any active job, not just ones the current user is crewed on — plus an assignee (defaults to you, editable
   → becomes the stop-job's crew). THE IDENTICAL-BEHAVIOR GUARANTEE: if exactly ONE job is checked and it IS
   the job whose page you opened this from, this writes straight into THAT job's expenses[]/materials[] —
   byte-identical to the plain +Add flow, zero new records. Any other case (0, ≥2, or a different single job)
   creates-or-reuses a stop-job (job.sharedJobIds=selection, job.stopKind) and logs into ITS array instead;
   its cost then rolls up (or, if 0 jobs, surfaces as overhead) via js/52's subJobsOf/overheadStops. */
let SPLIT_JOB = null, SPLIT_KIND = null, SPLIT_SEL = new Set();
window.jobOpenSplitPicker = function (jobId, kind) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  SPLIT_JOB = jobId; SPLIT_KIND = kind; SPLIT_SEL = new Set([jobId]);   // default: just this job — matches today's behavior until the crew changes the selection
  const me = (typeof curUser === "function") ? curUser() : null;
  const members = (typeof schedMembers === "function") ? schedMembers() : [];
  modal("🔀 Split across other jobs / mark as generic", `
    <p class="muted" style="margin-bottom:8px">For a dump run, a shared materials pickup, or any cost that isn't just this job — pick every job it applies to (or none, for a general business cost). The amount splits evenly across whatever's checked.</p>
    <label style="margin-top:0">Category</label>
    <select id="split_cat"><option value="dump">🚛 Dump run</option><option value="pickup">📦 Materials pickup</option><option value="other" selected>🔀 Other</option></select>
    <label>Which job(s)? <span class="sub">(search ALL active jobs — leave none checked for a generic/overhead cost)</span></label>
    <input id="split_search" placeholder="Search jobs by title or customer…" autocomplete="off" oninput="splitRenderJobs()">
    <div id="split_joblist" style="max-height:240px;overflow:auto;margin-top:4px"></div>
    <label>Assignee <span class="sub">(who did the run — defaults to you; becomes the stop's crew)</span></label>
    <select id="split_assignee">${members.map(u => `<option value="${esc(u.id)}" ${me && me.id === u.id ? "selected" : ""}>${esc(u.username)}</option>`).join("")}</select>
    <div class="row" style="gap:8px;margin-top:8px"><input id="split_amt" type="number" inputmode="decimal" placeholder="$" style="flex:0 0 80px"><input id="split_vendor" placeholder="Vendor / store" style="flex:2"></div>
    <input id="split_desc" placeholder="What for… (required)" style="margin-top:6px">
    <input type="file" id="split_receipt" accept="image/*" style="display:none" onchange="var l=document.getElementById('split_receipt_lbl');if(l)l.textContent='✓ Receipt ready'">
    <div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost grow" onclick="document.getElementById('split_receipt').click()"><span id="split_receipt_lbl">📎 Receipt (optional)</span></button><button class="btn acc grow" id="split_add_btn" onclick="jobSplitSubmit('${kind}')">+ Add ${kind === "material" ? "material" : "expense"}</button></div>`);
  splitRenderJobs();
};
/* the searchable multi-select list — excludes stop-jobs themselves (only ordinary jobs are valid attribution targets) */
function splitRenderJobs() {
  const box = document.getElementById("split_joblist"); if (!box) return;
  const q = (val("split_search") || "").trim().toLowerCase();
  const jobs = (typeof actJ === "function" ? actJ() : []).filter(x => x && !Array.isArray(x.sharedJobIds));
  const list = jobs.filter(x => {
    if (!q) return true;
    const cust = (x.customerId && typeof custName === "function") ? custName(x.customerId) : "";
    return (x.title || "").toLowerCase().indexOf(q) >= 0 || cust.toLowerCase().indexOf(q) >= 0;
  }).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  box.innerHTML = list.length ? list.map(x => {
    const cust = (x.customerId && typeof custName === "function") ? custName(x.customerId) : "";
    const on = SPLIT_SEL.has(x.id);
    return `<label class="li" style="cursor:pointer"><input type="checkbox" style="width:20px;height:20px;flex:0 0 auto" ${on ? "checked" : ""} onchange="splitToggleJob('${x.id}')"><div class="grow"><div class="nm" style="font-size:14px;white-space:normal">${esc(x.title || "Job")}</div><div class="sub">${cust ? esc(cust) + " · " : ""}${x.date ? fmtDate(x.date) : ""}</div></div></label>`;
  }).join("") : `<div class="muted">No jobs match.</div>`;
}
window.splitToggleJob = function (id) { if (SPLIT_SEL.has(id)) SPLIT_SEL.delete(id); else SPLIT_SEL.add(id); splitRenderJobs(); };
/* create-or-reuse a stop-job for a given job-selection + category, logged today. Reuse key: same day + same
   category + the exact same set of linked jobs — so several costs logged on one visit (e.g. dump fee + gas)
   land on ONE stop-job instead of one each. sharedJobIds carries the split; parentJobId mirrors it ONLY when
   there's a single linked job (audit trail — unread by new code). */
function jobFindOrCreateStop(selectedIds, stopKind, assigneeId) {
  const ids = (selectedIds || []).slice().sort(), d = today();
  const existing = (typeof actJ === "function" ? actJ() : []).find(x => x && Array.isArray(x.sharedJobIds) && x.date === d && (x.stopKind || "other") === stopKind && x.sharedJobIds.slice().sort().join(",") === ids.join(","));
  if (existing) return existing;
  const titles = { dump: "Dump run", pickup: "Materials pickup", other: "Stop" };
  const sj = { id: uid(), title: titles[stopKind] || "Stop", date: d, done: false, sharedJobIds: (selectedIds || []).slice(), stopKind: stopKind, parentJobId: selectedIds.length === 1 ? selectedIds[0] : "", crew: assigneeId ? [assigneeId] : [], expenses: [], materials: [] };
  D().jobs.push(sj); if (typeof touch === "function") touch(sj);
  return sj;
}
let _splitAddBusy = false, _splitAddWatchdog = null;
window.jobSplitSubmit = function (kind) {
  if (_splitAddBusy) return;   // same anti-dupe guard as jobAddExpense/jobAddMaterial (June 2026 dupe incident)
  const jobId = SPLIT_JOB; if (!jobId) return;
  const amt = parseFloat(val("split_amt")); if (!(amt > 0)) { alert("Enter the amount."); return; }
  const desc = (val("split_desc") || "").trim(); if (!desc) { alert("Enter what it was for."); return; }
  const vendor = (val("split_vendor") || "").trim();
  const cat = val("split_cat") || "other";
  const assignee = val("split_assignee") || "";
  const selected = Array.from(SPLIT_SEL);
  const input = document.getElementById("split_receipt");
  const file = input && input.files && input.files[0];
  const btn = document.getElementById("split_add_btn");
  _splitAddBusy = true; if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
  clearTimeout(_splitAddWatchdog); _splitAddWatchdog = setTimeout(function () { _splitAddBusy = false; }, 20000);
  const finish = function (receiptId) {
    clearTimeout(_splitAddWatchdog);
    const by = ((typeof curUser === "function" && curUser()) ? curUser().username : "");
    const entry = { id: uid(), amount: amt, vendor: vendor, desc: desc, receiptId: receiptId || null, by: by, ts: now() };
    if (kind === "expense") entry.faultMemberId = null;
    let target;
    if (selected.length === 1 && selected[0] === jobId) target = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null;   // the common case: identical to today's plain +Add — no new record
    else target = jobFindOrCreateStop(selected, cat, assignee);
    if (target) {
      const arrKey = kind === "material" ? "materials" : "expenses";
      if (!Array.isArray(target[arrKey])) target[arrKey] = [];
      target[arrKey].push(entry);
      if (typeof touch === "function") touch(target);
    }
    if (typeof save === "function") save();
    if (btn) btn.textContent = "✓ Added";
    setTimeout(function () { _splitAddBusy = false; if (typeof closeModal === "function") closeModal(); if (typeof render === "function") render(); }, 450);
  };
  if (file && typeof jsUpload === "function") jsUpload(file).then(finish).catch(function (e) { alert("Receipt upload failed: " + (e.message || e)); finish(null); });
  else finish(null);
};

/* ===== FAST WORK-DAYS EDITING (crew job page) — add/remove the days a multi-day job is worked WITHOUT opening
   the full job editor + scrolling. Writes straight to j.workDays (touch + save), so it stays in sync with the
   full editor (js/09), which reads/writes the same field on its own Save. "+ Add today" is one tap, no modal;
   "+ Add another day" opens a SMALL modal that contains ONLY the mini tap-on/off month grid (the SAME grid +
   chip HTML the full editor draws — via the shared wdpkGridHtml/wdpkChipsHtml helpers in js/09 — so the two
   can't visually drift). The start day (j.date) is always a work day and can't be removed here. */
function jobPageWorkDays(j) { return (typeof jobWorkDays === "function") ? jobWorkDays(j) : ((Array.isArray(j && j.workDays) ? j.workDays : (j && j.date ? [j.date] : [])).slice().sort()); }
/* the compact card that sits near the top of the crew job page */
function jobPageWorkDaysCard(j) {
  const days = jobPageWorkDays(j);
  const start = j.date || (days[0] || "");
  const t = (typeof today === "function") ? today() : "";
  const hasToday = days.indexOf(t) >= 0;
  const chips = days.map(ds => {
    const isStart = ds === start, isToday = ds === t;
    return `<span class="wdpk-chip${isStart ? " start" : ""}"${isToday ? ' style="outline:2px solid var(--accent);outline-offset:1px"' : ""}>${isToday ? "📍 " : ""}${esc((typeof fmtDate === "function") ? fmtDate(ds) : ds)}${isStart ? "" : ` <span onclick="jobPageRemoveDay('${j.id}','${ds}')" style="cursor:pointer;font-weight:800">✕</span>`}</span>`;
  }).join("");
  let h = `<div class="card"><div style="font-weight:800;margin-bottom:6px">📅 Work days${days.length > 1 ? ` · <span class="sub" style="font-weight:400">${days.length} days</span>` : ""}</div>`;
  h += `<div class="wdpk-chips">${chips}</div>`;
  h += `<div class="row" style="gap:8px;margin-top:10px">`;
  h += hasToday
    ? `<button class="btn ghost grow" disabled style="opacity:.7">✓ Today's already a work day</button>`
    : `<button class="btn acc grow" onclick="jobPageAddToday('${j.id}')">+ Add today</button>`;
  h += `<button class="btn ghost grow" onclick="jobPageAddDay('${j.id}')">+ Add another day</button>`;
  h += `</div></div>`;
  return h;
}
/* commit helper: dedupe + keep the start day + sort, write to j.workDays, then touch/save */
function jobPageCommitDays(j, days) {
  const wd = new Set((days || []).filter(Boolean));
  if (j.date) wd.add(j.date);   // start day is always a work day
  j.workDays = [...wd].sort();
  if (typeof touch === "function") touch(j);
  if (typeof logChange === "function") logChange("update", "job", j.id, "Work days → " + j.workDays.length + " day" + (j.workDays.length === 1 ? "" : "s") + " · " + (j.title || "job"));
  if (typeof save === "function") save();
}
/* "+ Add today" — one tap, no modal. Guarded no-op if today is already a work day. */
window.jobPageAddToday = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  const t = (typeof today === "function") ? today() : "";
  const days = jobPageWorkDays(j);
  if (days.indexOf(t) >= 0) return;   // already a work day — stray re-tap is a no-op
  jobPageCommitDays(j, days.concat([t]));
  if (typeof render === "function") render();
};
/* remove a day from both the compact card and the picker — never the start day */
window.jobPageRemoveDay = function (jobId, ds) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  if (ds === (j.date || "")) return;   // can't remove the start day
  jobPageCommitDays(j, jobPageWorkDays(j).filter(d => d !== ds));
  if (typeof render === "function") render();
  if (JP_WD_JOB === jobId && document.getElementById("jpwd_box")) jobPageWdRender();   // keep an open picker in step
};
/* ---- "+ Add another day" — a SMALL modal with ONLY the mini tap-on/off month grid (no full-editor fields).
   Each day-tap commits instantly (availability-calendar feel). Reuses the SAME shared grid/chip HTML the full
   editor uses (js/09 wdpkGridHtml/wdpkChipsHtml) so they can't drift. ‹ › step the shown month. */
let JP_WD_JOB = null, JP_WD_ANCHOR = null;
window.jobPageAddDay = function (jobId) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === jobId) : null; if (!j) return;
  JP_WD_JOB = jobId;
  const days = jobPageWorkDays(j);
  JP_WD_ANCHOR = (j.date || days[0] || ((typeof today === "function") ? today() : ""));
  modal("📅 Add work days", `<div id="jpwd_box"></div><button class="btn acc" style="margin-top:12px;width:100%" onclick="closeModal()">Done</button>`);
  jobPageWdRender();
};
function jobPageWdRender() {
  const box = document.getElementById("jpwd_box"); if (!box) return;
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === JP_WD_JOB) : null; if (!j) return;
  const days = jobPageWorkDays(j);
  const start = j.date || (days[0] || "");
  const sel = new Set(days);
  const anc = new Date((JP_WD_ANCHOR || start || ((typeof today === "function") ? today() : "")) + "T00:00:00");
  const y = anc.getFullYear(), m = anc.getMonth();
  const title = new Date(y, m, 1).toLocaleString(undefined, { month: "long" }) + " " + y;
  const cells = (typeof wdpkGridHtml === "function") ? wdpkGridHtml(sel, start, y, m, "jobPageWdToggle") : "";
  const chips = (typeof wdpkChipsHtml === "function") ? wdpkChipsHtml(days, start, "jobPageWdToggle") : "";
  box.innerHTML = `<div class="wdpk">
    <div class="wdpk-head"><button type="button" class="calnav" onclick="jobPageWdMonth(-1)">‹</button><div class="wdpk-title">${esc(title)}</div><button type="button" class="calnav" onclick="jobPageWdMonth(1)">›</button></div>
    <div class="wdpk-grid">${cells}</div>
    <div class="wdpk-chips">${chips}</div>
    <div class="sub" style="margin-top:4px">${days.length > 1 ? `Worked across <b>${days.length} days</b> — shows on each on the schedule.` : "Single day. Tap a day above to add it."}</div></div>`;
}
/* tap a day → toggle it in j.workDays instantly (start day is a no-op), re-render the grid + the page behind */
window.jobPageWdToggle = function (ds) {
  const j = (typeof actJ === "function") ? actJ().find(x => x.id === JP_WD_JOB) : null; if (!j) return;
  if (ds === (j.date || "")) return;   // can't toggle the start day off
  const days = jobPageWorkDays(j);
  jobPageCommitDays(j, days.indexOf(ds) >= 0 ? days.filter(d => d !== ds) : days.concat([ds]));
  jobPageWdRender();
};
window.jobPageWdMonth = function (n) {
  const a = new Date((JP_WD_ANCHOR || ((typeof today === "function") ? today() : "")) + "T00:00:00");
  a.setDate(1); a.setMonth(a.getMonth() + n);
  JP_WD_ANCHOR = a.getFullYear() + "-" + String(a.getMonth() + 1).padStart(2, "0") + "-01";
  jobPageWdRender();
};
