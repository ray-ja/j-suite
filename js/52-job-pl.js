/* ---------- PER-JOB P&L (Cap #3) — Finance › 💹 P&L (owner/admin) ----------
   Revenue (linked quote total) − hard costs (job.expenses[], NO labor line) = gross profit + margin%.
   Reuses the js/39 operating-agreement split engine for crew take-home; flags any job under the 35%
   margin floor; weekly window, WORST-MARGIN-FIRST so Ray acts on the bleakers. Read-only over
   existing data — no new collection. */

let PL_WEEK = null;   // null = current week; otherwise a Monday "YYYY-MM-DD"
let PL_OH_OPEN = false;   // expand/collapse the "general business overhead" stop list on the P&L header
window.plOhToggle = function () { PL_OH_OPEN = !PL_OH_OPEN; render(); };
function plCanView() { return (typeof finCanView === "function") ? finCanView() : true; }
function plMoney(n) { n = Math.round((+n || 0) * 100) / 100; return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function plPct(x) { return Math.round((x || 0) * 100) + "%"; }
function plFloor() { return (typeof MARGIN_FLOOR !== "undefined") ? MARGIN_FLOOR : 0.35; }
function plYmd(dt) { return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0"); }
function plAddDays(ds, n) { const dt = new Date(ds + "T00:00:00"); dt.setDate(dt.getDate() + n); return plYmd(dt); }
function plWeekStart(ds) { const dt = new Date(ds + "T00:00:00"); const off = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - off); return plYmd(dt); }  // Monday
function plWeek() { return PL_WEEK || plWeekStart(today()); }
window.plWeekShift = function (n) { PL_WEEK = plAddDays(plWeek(), n * 7); render(); };

function plQuoteFor(j) {
  const d = D();
  if (j.quoteId) { const q = (d.quotes || []).find(x => x.id === j.quoteId && !x.deleted); if (q) return q; }
  return (d.quotes || []).find(q => q && !q.deleted && q.jobId === j.id) || null;
}
function plExpenses(j) { return Array.isArray(j.expenses) ? j.expenses : []; }
function plMaterials(j) { return Array.isArray(j.materials) ? j.materials : []; }   // pass-through materials (billed at cost) — a cost in the P&L since the quote price includes them
/* confirmed mileage cost attributed to this job (timeclock miles × IRS rate) */
function jobMileageCost(j) { const rate = (typeof FIN !== "undefined" ? FIN.MILEAGE_RATE : 0.725); return (D().timeclock || []).filter(e => e && !e.deleted && e.jobId === j.id && e.clockOut && e.milesConfirmed).reduce((s, e) => s + (+e.miles || 0) * rate, 0); }
/* sub-jobs / STOPS (e.g. a dump run filed under a bigger job, or split across several) — their costs + hours
   roll up into every job they're linked to, EVENLY SPLIT across however many. Membership match (not equality)
   so a stop can be linked to 0/1/N jobs: job.sharedJobIds[] generalizes the old scalar job.parentJobId. */
function subJobsOf(jobId) { return jobId ? (typeof actJ === "function" ? actJ() : []).filter(x => x && Array.isArray(x.sharedJobIds) && x.sharedJobIds.indexOf(jobId) >= 0) : []; }
/* how many ways a stop-job's cost splits — never divide by zero (0-linked stops don't roll up into anything anyway) */
function stopSplitN(sj) { return Math.max(1, (sj && Array.isArray(sj.sharedJobIds)) ? sj.sharedJobIds.length : 1); }
function stopEmoji(kind) { return kind === "dump" ? "🚛" : kind === "pickup" ? "📦" : "🔀"; }
/* one job's mileage cost: confirmed time-clock miles if any, else the manual driveMiles estimate */
function jobMilesCost(j) { const tc = jobMileageCost(j); if (tc > 0) return tc; const rate = (typeof FIN !== "undefined" ? FIN.MILEAGE_RATE : 0.725); return (+j.driveMiles || 0) * rate; }
/* canonical per-job profitability — price (charged) − hard costs (expenses + mileage); NO labor line */
function jobProfit(j) {
  const q = plQuoteFor(j);
  const price = q ? (+(q.finalPrice || q.total) || 0) : 0;
  let expCost = plExpenses(j).filter(x => x && !x.deleted).reduce((s, e) => s + (+e.amount || 0), 0);
  let matCost = plMaterials(j).filter(x => x && !x.deleted).reduce((s, e) => s + (+e.amount || 0), 0);
  let milCost = jobMileageCost(j);
  // a stop-job linked to N jobs contributes 1/N of its cost to each — a 1-element split (today's sub-jobs) is a no-op divide
  subJobsOf(j.id).forEach(sj => { const n = stopSplitN(sj); expCost += plExpenses(sj).filter(x => x && !x.deleted).reduce((s, e) => s + (+e.amount || 0), 0) / n; matCost += plMaterials(sj).filter(x => x && !x.deleted).reduce((s, e) => s + (+e.amount || 0), 0) / n; milCost += jobMileageCost(sj) / n; });
  const cost = expCost + matCost + milCost, profit = price - cost;
  const margin = price > 0 ? profit / price : (cost > 0 ? -1 : 0);
  const type = (q && typeof quoteType === "function" && quoteType(q)) || (j.title || "Other");
  const cust = (q && q.cust) || (j.customerId && typeof custName === "function" ? custName(j.customerId) : "") || "—";
  return { j: j, q: q, price: price, expCost: expCost, matCost: matCost, milCost: milCost, cost: cost, profit: profit, margin: margin, type: type, cust: cust };
}
/* effective field-work pay $/hr each — the number that says if a job was worth it.
   person-hours = crew × (on-site hrs + round-trip drive hrs). Uses the job's manual time/travel fields
   (j.crewN/onSiteHrs/driveMin/driveMiles) for reconstruction; mileage cost prefers confirmed time-clock. */
function jobHourly(j) {
  const p = jobProfit(j), subs = subJobsOf(j.id);
  let milCost = jobMilesCost(j); subs.forEach(sj => { milCost += jobMilesCost(sj) / stopSplitN(sj); });
  const cost = p.expCost + milCost, profit = p.price - cost, fieldPool = p.price * 0.48;
  const crew = (+j.crewN || (j.crew || []).length || 1);
  const onsite = +j.onSiteHrs || 0, driveH = (+j.driveMin || 0) / 60;
  let personHrs = crew * (onsite + driveH);
  subs.forEach(sj => { const sc = (+sj.crewN || (sj.crew || []).length || 1); personHrs += (sc * ((+sj.onSiteHrs || 0) + (+sj.driveMin || 0) / 60)) / stopSplitN(sj); });
  return { price: p.price, cost: cost, milCost: milCost, expCost: p.expCost, profit: profit, fieldPool: fieldPool, crew: crew, onsite: onsite, driveH: driveH, personHrs: personHrs, perHr: personHrs > 0 ? fieldPool / personHrs : null, margin: p.price > 0 ? profit / p.price : 0 };
}
function plJobRow(j) {
  const p = jobProfit(j);
  const split = (typeof finSplitAmount === "function") ? finSplitAmount(finCents(p.price)) : null;
  return { j: j, q: p.q, revenue: p.price, hard: p.cost, gross: p.profit, margin: p.margin, field: split ? finDollars(split.field) : 0, under: p.price > 0 && p.margin < plFloor() };
}
function plRows() {
  const ws = plWeek(), we = plAddDays(ws, 6);
  // exclude ANY stop-job (sharedJobIds is an array — [] generic/overhead or [id,...] linked) from its own fake row;
  // its cost already rolled up into every job it's linked to (or, if [], surfaces separately as overhead below)
  return (typeof actJ === "function" ? actJ() : []).filter(j => j.date && !Array.isArray(j.sharedJobIds) && j.date >= ws && j.date <= we)
    .map(plJobRow).filter(r => r.revenue > 0 || r.hard > 0)
    .sort((a, b) => a.margin - b.margin);   // worst margin first
}
/* GENERIC/OVERHEAD stops — sharedJobIds=[] (linked to no job): a dump run or pickup nobody attributed to a
   specific job. Same weekly window as plRows(). Charged to no job's P&L; surfaced instead as a business-wide
   overhead line so it never shows up as its own fake -100%-margin "job". */
function overheadStops() {
  const ws = plWeek(), we = plAddDays(ws, 6);
  return (typeof actJ === "function" ? actJ() : []).filter(j => j.date && Array.isArray(j.sharedJobIds) && j.sharedJobIds.length === 0 && j.date >= ws && j.date <= we);
}
function overheadStopCost(j) {
  const exp = plExpenses(j).filter(x => x && !x.deleted).reduce((s, e) => s + (+e.amount || 0), 0);
  const mat = plMaterials(j).filter(x => x && !x.deleted).reduce((s, e) => s + (+e.amount || 0), 0);
  return exp + mat + jobMileageCost(j);
}

function rJobPL() {
  if (!plCanView()) return `<div class="card"><div class="nm">Owner / Admin only</div></div>`;
  const ws = plWeek(), we = plAddDays(ws, 6), rows = plRows();
  const tR = rows.reduce((s, r) => s + r.revenue, 0), tH = rows.reduce((s, r) => s + r.hard, 0), tG = tR - tH;
  const avg = tR > 0 ? tG / tR : 0, tField = rows.reduce((s, r) => s + r.field, 0);
  let h = `<div class="card"><div class="row" style="align-items:center">
      <button class="btn ghost sm" onclick="plWeekShift(-1)">‹</button>
      <div class="grow" style="text-align:center"><b>Week of ${esc(fmtDate(ws))}</b><div class="sub">${esc(fmtDate(ws))} – ${esc(fmtDate(we))} · ${rows.length} job(s)</div></div>
      <button class="btn ghost sm" onclick="plWeekShift(1)">›</button></div>
    <div class="row" style="gap:14px;flex-wrap:wrap;margin-top:10px">
      <div class="grow"><div class="sub">Revenue</div><div class="nm" style="font-size:20px">${plMoney(tR)}</div></div>
      <div class="grow"><div class="sub">Hard costs</div><div class="nm" style="font-size:20px">${plMoney(tH)}</div></div>
      <div class="grow"><div class="sub">Gross profit</div><div class="nm" style="font-size:20px;${tG < 0 ? "color:var(--danger)" : ""}">${plMoney(tG)}</div></div>
      <div class="grow"><div class="sub">Avg margin</div><div class="nm" style="font-size:20px;${avg < plFloor() ? "color:var(--danger)" : ""}">${tR > 0 ? plPct(avg) : "—"}</div></div>
    </div>
    <div class="sub" style="margin-top:6px;white-space:normal">Crew take-home (field pool via the OA split): ${plMoney(tField)} — no labor cost line; owners are paid from the revenue split, not wages.</div></div>`;
  // GENERAL BUSINESS OVERHEAD — dump runs / pickups logged with no job attached (sharedJobIds=[]); expandable
  const stops = overheadStops(), stopsTotal = stops.reduce((s, x) => s + overheadStopCost(x), 0);
  if (stops.length) {
    h += `<div class="card"><div class="row" style="align-items:center;cursor:pointer" onclick="plOhToggle()"><div class="grow"><b>General business overhead this week: ${plMoney(stopsTotal)}</b><span class="sub"> · ${stops.length} stop${stops.length === 1 ? "" : "s"}</span></div><span class="sub">${PL_OH_OPEN ? "▲" : "▼"}</span></div>`;
    if (PL_OH_OPEN) h += stops.map(sj => {
      const assignee = (sj.crew && sj.crew[0] && typeof userName === "function") ? (userName(sj.crew[0]) || "") : "";
      return `<div class="li" onclick="if(typeof closeModal==='function')closeModal();openJobPage('${sj.id}')" style="cursor:pointer"><div class="grow"><div class="nm" style="font-size:14px">${stopEmoji(sj.stopKind)} ${esc(sj.title || "Stop")}${assignee ? " · " + esc(assignee) : ""}</div><div class="sub">${fmtDate(sj.date)}</div></div><b>${plMoney(overheadStopCost(sj))}</b></div>`;
    }).join("");
    h += `</div>`;
  }
  if (!rows.length) return h + `<div class="empty"><div class="big">💹</div>No jobs with revenue or costs this week.<br>Log expenses on a job to see its margin here.</div>`;
  h += `<div class="secthd"><h2>Worst margin first</h2><span class="ct">${rows.filter(r => r.under).length} under ${Math.round(plFloor() * 100)}%</span></div><div class="card">` + rows.map(r => {
    const j = r.j, who = (r.q && r.q.cust) || (j.customerId && typeof custName === "function" ? custName(j.customerId) : "") || "";
    return `<div class="li" style="align-items:flex-start" onclick="if(typeof closeModal==='function')closeModal();openJob('${j.id}')"><div class="grow">
      <div class="nm" style="${r.under ? "color:var(--danger)" : ""}">${r.under ? "🔴 " : ""}${esc(j.title || "Job")}${r.margin < 0 ? " · LOSS" : ""}</div>
      <div class="sub" style="white-space:normal">${who ? esc(who) + " · " : ""}${esc(fmtDate(j.date))} · Price ${plMoney(r.revenue)} · Cost ${plMoney(r.hard)} · Profit ${plMoney(r.gross)}</div></div>
      <div style="text-align:right;flex:0 0 auto"><b style="${r.under ? "color:var(--danger)" : ""}">${r.revenue > 0 ? plPct(r.margin) : "—"}</b></div></div>`;
  }).join("") + `</div>`;
  return h;
}
