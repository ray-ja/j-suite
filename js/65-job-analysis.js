/* ---------- JOB PROFITABILITY ANALYSIS — Finance › 📈 Analysis (owner/admin) ----------
   Rolls up per-job profit (js/52 jobProfit: price − expenses − mileage, NO labor line) across a chosen
   period and slices it by service type, customer, and crew, with best/worst jobs + a margin-floor count.
   Read-only over existing data. Helps Ray see which work actually makes money. */
let JA_PERIOD = "90";   // month | 90 | year | all
function jaRange() {
  const t = today();
  if (JA_PERIOD === "month") { const b = monthBounds(t.slice(0, 7)); return { from: b.from, to: b.to, label: finMonthLabel(t.slice(0, 7)) }; }
  if (JA_PERIOD === "year") { return { from: t.slice(0, 4) + "-01-01", to: t.slice(0, 4) + "-12-31", label: t.slice(0, 4) }; }
  if (JA_PERIOD === "all") { return { from: "0000-01-01", to: "9999-12-31", label: "All time" }; }
  return { from: plAddDays(t, -90), to: t, label: "Last 90 days" };
}
function jaGroup(rows, keyFn) {
  const m = {};
  rows.forEach(r => { const k = keyFn(r) || "—"; const g = m[k] || (m[k] = { key: k, rev: 0, cost: 0, profit: 0, n: 0, under: 0 }); g.rev += r.price; g.cost += r.cost; g.profit += r.profit; g.n++; if (r.price > 0 && r.margin < plFloor()) g.under++; });
  return Object.keys(m).map(k => { const g = m[k]; g.margin = g.rev > 0 ? g.profit / g.rev : 0; return g; }).sort((a, b) => b.profit - a.profit);
}
function jaGroupCard(title, groups, max) {
  if (!groups.length) return "";
  return `<div class="secthd"><h2>${title}</h2></div><div class="card">` + groups.slice(0, max || 8).map(g =>
    `<div class="li"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal">${esc(g.key)}</div><div class="sub" style="white-space:normal">${g.n} job(s) · ${plMoney(g.rev)} → ${plMoney(g.profit)} profit${g.under ? ` · 🔴 ${g.under} under floor` : ""}</div></div><b style="${g.rev > 0 && g.margin < plFloor() ? "color:var(--danger)" : ""}">${g.rev > 0 ? plPct(g.margin) : "—"}</b></div>`).join("") + `</div>`;
}
function rJobAnalysis() {
  if (!plCanView()) return `<div class="card"><div class="nm">Owner / Admin only</div></div>`;
  const r = jaRange();
  const rows = (typeof actJ === "function" ? actJ() : []).filter(j => j.date && j.date >= r.from && j.date <= r.to).map(jobProfit).filter(x => x.price > 0 || x.cost > 0);

  let h = `<div class="card"><div class="subnav" style="margin-bottom:0">` +
    [["month", "Month"], ["90", "90 days"], ["year", "Year"], ["all", "All"]].map(o => `<button class="subbtn ${JA_PERIOD === o[0] ? "on" : ""}" onclick="JA_PERIOD='${o[0]}';render()">${o[1]}</button>`).join("") + `</div></div>`;

  const tRev = rows.reduce((s, x) => s + x.price, 0), tCost = rows.reduce((s, x) => s + x.cost, 0), tProfit = tRev - tCost;
  const avg = tRev > 0 ? tProfit / tRev : 0, under = rows.filter(x => x.price > 0 && x.margin < plFloor()).length;
  h += `<div class="card"><div class="sub" style="text-align:center;margin-bottom:8px">${esc(r.label)} · ${rows.length} job(s)</div>
    <div class="row" style="gap:14px;flex-wrap:wrap">
      <div class="grow"><div class="sub">Revenue</div><div class="nm" style="font-size:19px">${plMoney(tRev)}</div></div>
      <div class="grow"><div class="sub">Costs</div><div class="nm" style="font-size:19px">${plMoney(tCost)}</div></div>
      <div class="grow"><div class="sub">Profit</div><div class="nm" style="font-size:19px;${tProfit < 0 ? "color:var(--danger)" : ""}">${plMoney(tProfit)}</div></div>
      <div class="grow"><div class="sub">Avg margin</div><div class="nm" style="font-size:19px;${avg < plFloor() ? "color:var(--danger)" : ""}">${tRev > 0 ? plPct(avg) : "—"}</div></div>
    </div>${under ? `<div class="note" style="margin-top:8px">🔴 ${under} job(s) under the ${Math.round(plFloor() * 100)}% margin floor.</div>` : ""}</div>`;

  if (!rows.length) return h + `<div class="empty"><div class="big">📈</div>No jobs with price or cost in this period.<br>Log expenses on jobs to see what makes money.</div>`;

  h += jaGroupCard("💼 By service type", jaGroup(rows, x => x.type));
  h += jaGroupCard("👥 Top customers", jaGroup(rows, x => x.cust), 6);
  const crewRows = []; rows.forEach(x => { (x.j.crew || []).forEach(id => crewRows.push(Object.assign({}, x, { _cid: id }))); });
  if (crewRows.length) h += jaGroupCard("👷 By crew (jobs worked)", jaGroup(crewRows, x => (typeof userName === "function" ? userName(x._cid) : x._cid) || "—"));

  const byProfit = rows.slice().sort((a, b) => b.profit - a.profit), best = byProfit[0], worst = byProfit[byProfit.length - 1];
  h += `<div class="secthd"><h2>🏆 Best &amp; worst job</h2></div><div class="card">`;
  [["🏆 Best", best], ["⚠️ Worst", worst]].forEach(pair => { const x = pair[1]; if (!x) return; h += `<div class="li" onclick="if(typeof closeModal==='function')closeModal();openJob('${x.j.id}')" style="cursor:pointer"><div class="grow"><div class="nm" style="font-size:15px">${pair[0]} · ${esc(x.j.title || "Job")}</div><div class="sub" style="white-space:normal">${esc(x.cust)} · ${plMoney(x.price)} → ${plMoney(x.profit)} profit</div></div><b style="${x.price > 0 && x.margin < plFloor() ? "color:var(--danger)" : ""}">${x.price > 0 ? plPct(x.margin) : "—"}</b></div>`; });
  h += `</div>`;

  // 💵 effective pay — $/hr each, for jobs with time/travel logged (the cost-effectiveness chart)
  const hourly = rows.map(x => ({ r: x, h: jobHourly(x.j) })).filter(x => x.h.perHr != null).sort((a, b) => a.h.perHr - b.h.perHr);
  if (hourly.length) h += `<div class="secthd"><h2>💵 Effective pay — $/hr each (lowest first)</h2></div><div class="card">` + hourly.slice(0, 12).map(x => `<div class="li" onclick="if(typeof closeModal==='function')closeModal();openJob('${x.r.j.id}')" style="cursor:pointer"><div class="grow"><div class="nm" style="font-size:15px;${x.h.perHr < 35 ? "color:var(--danger)" : ""}">${x.h.perHr < 35 ? "🔴 " : ""}${esc(x.r.j.title || "Job")}</div><div class="sub" style="white-space:normal">${esc(x.r.cust)} · ${plMoney(x.r.price)} · ${x.h.crew}p × ${(x.h.onsite + x.h.driveH).toFixed(1)}h${x.h.driveH ? " (incl. drive)" : ""}</div></div><b style="${x.h.perHr < 35 ? "color:var(--danger)" : x.h.perHr >= 45 ? "color:var(--accent)" : ""}">${plMoney(x.h.perHr)}/hr</b></div>`).join("") + `</div>`;
  return h;
}
