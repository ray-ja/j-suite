/* ---------- PER-JOB P&L (Cap #3) — Finance › 💹 P&L (owner/admin) ----------
   Revenue (linked quote total) − hard costs (job.expenses[], NO labor line) = gross profit + margin%.
   Reuses the js/39 operating-agreement split engine for crew take-home; flags any job under the 35%
   margin floor; weekly window, WORST-MARGIN-FIRST so Ray acts on the bleakers. Read-only over
   existing data — no new collection. */

let PL_WEEK = null;   // null = current week; otherwise a Monday "YYYY-MM-DD"
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
/* confirmed mileage cost attributed to this job (timeclock miles × IRS rate) */
function jobMileageCost(j) { const rate = (typeof FIN !== "undefined" ? FIN.MILEAGE_RATE : 0.725); return (D().timeclock || []).filter(e => e && !e.deleted && e.jobId === j.id && e.clockOut && e.milesConfirmed).reduce((s, e) => s + (+e.miles || 0) * rate, 0); }
/* canonical per-job profitability — price (charged) − hard costs (expenses + mileage); NO labor line */
function jobProfit(j) {
  const q = plQuoteFor(j);
  const price = q ? (+(q.finalPrice || q.total) || 0) : 0;
  const expCost = plExpenses(j).filter(x => x && !x.deleted).reduce((s, e) => s + (+e.amount || 0), 0);
  const milCost = jobMileageCost(j), cost = expCost + milCost, profit = price - cost;
  const margin = price > 0 ? profit / price : (cost > 0 ? -1 : 0);
  const type = (q && typeof quoteType === "function" && quoteType(q)) || (j.title || "Other");
  const cust = (q && q.cust) || (j.customerId && typeof custName === "function" ? custName(j.customerId) : "") || "—";
  return { j: j, q: q, price: price, expCost: expCost, milCost: milCost, cost: cost, profit: profit, margin: margin, type: type, cust: cust };
}
/* effective field-work pay $/hr each — the number that says if a job was worth it.
   person-hours = crew × (on-site hrs + round-trip drive hrs). Uses the job's manual time/travel fields
   (j.crewN/onSiteHrs/driveMin/driveMiles) for reconstruction; mileage cost prefers confirmed time-clock. */
function jobHourly(j) {
  const p = jobProfit(j), rate = (typeof FIN !== "undefined" ? FIN.MILEAGE_RATE : 0.725);
  const milCost = p.milCost > 0 ? p.milCost : (+j.driveMiles || 0) * rate;
  const cost = p.expCost + milCost, profit = p.price - cost, fieldPool = p.price * 0.48;
  const crew = (+j.crewN || (j.crew || []).length || 1);
  const onsite = +j.onSiteHrs || 0, driveH = (+j.driveMin || 0) / 60, personHrs = crew * (onsite + driveH);
  return { price: p.price, cost: cost, milCost: milCost, expCost: p.expCost, profit: profit, fieldPool: fieldPool, crew: crew, onsite: onsite, driveH: driveH, personHrs: personHrs, perHr: personHrs > 0 ? fieldPool / personHrs : null, margin: p.price > 0 ? profit / p.price : 0 };
}
function plJobRow(j) {
  const p = jobProfit(j);
  const split = (typeof finSplitAmount === "function") ? finSplitAmount(finCents(p.price)) : null;
  return { j: j, q: p.q, revenue: p.price, hard: p.cost, gross: p.profit, margin: p.margin, field: split ? finDollars(split.field) : 0, under: p.price > 0 && p.margin < plFloor() };
}
function plRows() {
  const ws = plWeek(), we = plAddDays(ws, 6);
  return (typeof actJ === "function" ? actJ() : []).filter(j => j.date && j.date >= ws && j.date <= we)
    .map(plJobRow).filter(r => r.revenue > 0 || r.hard > 0)
    .sort((a, b) => a.margin - b.margin);   // worst margin first
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
