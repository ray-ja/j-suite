/* ---------- JOB HISTORY (js/174) — one organized list of every paid job ----------
   Ray, 2026-09-15: "is there a way for me to view job history? i just want to see a list of jobs showing
   who worked it, what their pay split was, the date(s) the job was, the type of job, the customer, how
   much the business took, etc. is a nice organized list"

   Until now that answer lived in four places: Payouts (one month, per member, no jobs), Job P&L (one week,
   margins, no crew), Income (bare entries) and My Pay (one person at a time). This is the join.

   ONE SOURCE OF TRUTH: rows come from the same pooled engine the Payouts page and My Pay already use
   (payPerPerson → finRollup.perJob, js/86 + js/39), so a person's share here is byte-identical to what
   My Pay shows them and the business figures reconcile to the Cash page. Nothing is recomputed here — this
   module only LOOKS UP names, dates, types and customers for each per-job split and lays them out.

   Owner/admin only — it lives under Finance, which rFinance already gates (finCanView). Crew keep My Pay.
   Read-only: no writes, no new collection, no sync surface. */
let JH_YEAR = "all", JH_TYPE = "", JH_WHO = "";

/* the work day(s) for a row: the job's work days (multi-day aware), else the income's paid date */
function jhDaysOf(job, inc, workDaysFn) {
  const days = (job && typeof workDaysFn === "function") ? workDaysFn(job) : ((job && job.date) ? [job.date] : []);
  return days.length ? days : ((inc && inc.date) ? [inc.date] : []);
}
function jhDaysLabel(days, fmt) {
  fmt = fmt || (d => d);
  if (!days || !days.length) return "";
  if (days.length === 1) return fmt(days[0]);
  if (days.length === 2) return fmt(days[0]) + " + " + fmt(days[1]);
  return fmt(days[0]) + " → " + fmt(days[days.length - 1]) + " (" + days.length + " days)";
}

/* PURE row builder (node-testable). perJob = finRollup().perJob; hoursByJob = finHoursByJob(); adminId = the
   Admin Member; L = lookups { income(id), job(id), quote(id), custName(id), name(id), type(q), workDays(j) }.
   Every money field is CENTS. */
function jhBuildRows(perJob, hoursByJob, adminId, L) {
  hoursByJob = hoursByJob || {}; L = L || {};
  const get = (fn, a) => (typeof fn === "function") ? fn(a) : null;
  return (perJob || []).map(pj => {
    const inc = get(L.income, pj.id) || {};
    const ids = (Array.isArray(inc.jobIds) && inc.jobIds.length) ? inc.jobIds : (inc.jobId ? [inc.jobId] : (pj.jobId ? [pj.jobId] : []));
    const job = ids.map(id => get(L.job, id)).find(Boolean) || null;
    const q = get(L.quote, inc.quoteId || (job && job.quoteId)) || null;
    const s = pj.split || {};
    const crewIds = Object.keys(pj.field || {});
    const weights = pj.weights || null;
    const crew = crewIds.map(id => ({
      id: id, name: get(L.name, id) || id, cents: pj.field[id] || 0,
      weight: (weights && weights[id] != null) ? +weights[id] : null,
      hours: (hoursByJob[ids[0]] && hoursByJob[ids[0]][id]) || (hoursByJob[pj.jobId] && hoursByJob[pj.jobId][id]) || 0
    })).sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
    const type = (q && get(L.type, q)) || (job && job.title) || (inc.source === "square" ? "Square invoice" : "Other");
    const title = (job && job.title) || (q && q.title) || (inc.note || inc.memo) || type;
    const cust = (q && q.cust) || (job && job.customerId && get(L.custName, job.customerId)) || inc.customer || "";
    const salesTo = s.salesToOriginator > 0 ? { id: s.originator, name: get(L.name, s.originator) || s.originator, cents: s.salesToOriginator } : null;
    const adminTo = pj.adminToMember > 0 ? { id: adminId, name: get(L.name, adminId) || adminId, cents: pj.adminToMember } : null;
    return {
      id: pj.id, jobId: (job && job.id) || ids[0] || "", quoteId: (q && q.id) || inc.quoteId || "",
      paidDate: pj.date, days: jhDaysOf(job, inc, L.workDays),
      title: title, type: type, cust: cust || "—",
      gross: pj.gross || 0, hard: pj.passThrough || 0, base: pj.amount || 0,
      tax: s.tax || 0, business: (s.business || 0) + (s.salesToBusiness || 0), bizSales: s.salesToBusiness || 0,
      fieldPool: pj.fieldPool || 0, crew: crew, unallocated: pj.unallocated || 0,
      salesTo: salesTo, adminTo: adminTo, model: s.hardCostMode || "v1",
      crewTotal: crew.reduce((t, c) => t + c.cents, 0) + (salesTo ? salesTo.cents : 0) + (adminTo ? adminTo.cents : 0)
    };
  }).sort((a, b) => (b.paidDate + "|" + b.id) < (a.paidDate + "|" + a.id) ? -1 : 1);
}

/* filters: year on the paid date, type, person (anyone paid on the row) */
function jhFilter(rows, f) {
  f = f || {};
  return (rows || []).filter(r =>
    (!f.year || f.year === "all" || String(r.paidDate || "").slice(0, 4) === f.year) &&
    (!f.type || r.type === f.type) &&
    (!f.who || r.crew.some(c => c.id === f.who) || (r.salesTo && r.salesTo.id === f.who) || (r.adminTo && r.adminTo.id === f.who)));
}
function jhTotals(rows) {
  const t = { n: 0, gross: 0, hard: 0, tax: 0, business: 0, crew: 0, unallocated: 0, byPerson: {} };
  (rows || []).forEach(r => {
    t.n++; t.gross += r.gross; t.hard += r.hard; t.tax += r.tax; t.business += r.business; t.crew += r.crewTotal; t.unallocated += r.unallocated;
    r.crew.forEach(c => { t.byPerson[c.name] = (t.byPerson[c.name] || 0) + c.cents; });
    if (r.salesTo) t.byPerson[r.salesTo.name] = (t.byPerson[r.salesTo.name] || 0) + r.salesTo.cents;
    if (r.adminTo) t.byPerson[r.adminTo.name] = (t.byPerson[r.adminTo.name] || 0) + r.adminTo.cents;
  });
  return t;
}

/* CSV — one row per paid job, money in dollars, crew as "Name $x (60%)" pairs */
function jhCsvCell(v) { v = (v == null) ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function jhBuildCSV(rows) {
  const $ = c => (Math.round(c || 0) / 100).toFixed(2);
  const head = ["Paid", "Work days", "Job", "Type", "Customer", "Billed", "Hard costs", "Tax reserve", "Business fund", "Crew pool", "Crew shares", "Sales credit", "Admin", "Unassigned"];
  const lines = [head.join(",")];
  (rows || []).forEach(r => lines.push([
    r.paidDate, r.days.join(" "), r.title, r.type, r.cust, $(r.gross), $(r.hard), $(r.tax), $(r.business), $(r.fieldPool),
    r.crew.map(c => c.name + " $" + $(c.cents) + (c.weight != null && c.weight !== 100 ? " (" + c.weight + "%)" : "")).join("; "),
    r.salesTo ? r.salesTo.name + " $" + $(r.salesTo.cents) : "",
    r.adminTo ? r.adminTo.name + " $" + $(r.adminTo.cents) : "",
    r.unallocated ? $(r.unallocated) : ""
  ].map(jhCsvCell).join(",")));
  return lines.join("\n");
}

/* ===================== live data ===================== */
function jhLookups() {
  const d = (typeof D === "function") ? D() : {};
  const find = (coll, id) => id ? ((d[coll] || []).find(x => x && x.id === id) || null) : null;
  return {
    income: id => find("income", id), job: id => find("jobs", id), quote: id => find("quotes", id),
    custName: id => (typeof custName === "function") ? custName(id) : "",
    name: id => (typeof finName === "function") ? finName(id) : id,
    type: q => (typeof quoteType === "function") ? quoteType(q) : (q && q.title) || "",
    workDays: j => (typeof jobWorkDays === "function") ? jobWorkDays(j) : ((j && j.date) ? [j.date] : [])
  };
}
function jhRows() {
  if (typeof payPerPerson !== "function") return [];
  const pp = payPerPerson();   // all-time, the same engine as Payouts + My Pay
  return jhBuildRows(pp.roll.perJob, pp.hoursByJob, pp.adminId, jhLookups());
}
/* finished jobs nobody has recorded a payment for — they belong in the history too, flagged */
function jhUnpaidDone(rows) {
  const d = (typeof D === "function") ? D() : {};
  const paidIds = {};
  (d.income || []).forEach(i => { if (!i || i.deleted) return; if (i.jobId) paidIds[i.jobId] = 1; (i.jobIds || []).forEach(id => { paidIds[id] = 1; }); });
  return (d.jobs || []).filter(j => j && !j.deleted && j.done && !paidIds[j.id] && !Array.isArray(j.sharedJobIds))
    .map(j => {
      const q = j.quoteId ? (d.quotes || []).find(x => x && x.id === j.quoteId) : null;
      return { j: j, q: q, days: jhDaysOf(j, null, jhLookups().workDays), cust: (q && q.cust) || (j.customerId ? custName(j.customerId) : "") || "—",
        price: q ? Math.round((+(q.finalPrice || q.total) || 0) * 100) : 0, crew: (j.crew || []).map(id => finName(id)) };
    }).sort((a, b) => (b.days[0] || "") < (a.days[0] || "") ? -1 : 1);
}

if (typeof window !== "undefined") window.jhSet = function (k, v) { if (k === "year") JH_YEAR = v || "all"; else if (k === "type") JH_TYPE = v || ""; else if (k === "who") JH_WHO = v || ""; render(); };
if (typeof window !== "undefined") window.jhExport = function () {
  const rows = jhFilter(jhRows(), { year: JH_YEAR, type: JH_TYPE, who: JH_WHO });
  if (!rows.length) { alert("Nothing to export for this filter."); return; }
  if (typeof rcptDownload === "function") rcptDownload("job-history" + (JH_YEAR !== "all" ? "-" + JH_YEAR : "") + ".csv", jhBuildCSV(rows), "text/csv");
};

function rJobHistory() {
  if (typeof finCanView === "function" && !finCanView()) return `<div class="card"><div class="nm">Owner / Admin only</div></div>`;
  const all = jhRows();
  const years = Array.from(new Set(all.map(r => String(r.paidDate || "").slice(0, 4)).filter(Boolean))).sort().reverse();
  const types = Array.from(new Set(all.map(r => r.type).filter(Boolean))).sort();
  const people = {}; all.forEach(r => { r.crew.forEach(c => { people[c.id] = c.name; }); if (r.salesTo) people[r.salesTo.id] = r.salesTo.name; if (r.adminTo) people[r.adminTo.id] = r.adminTo.name; });
  const rows = jhFilter(all, { year: JH_YEAR, type: JH_TYPE, who: JH_WHO });
  const t = jhTotals(rows);
  const fd = d => (typeof fmtDate === "function") ? fmtDate(d) : d;
  const sel = (k, cur, opts, allLabel) => `<select onchange="jhSet('${k}',this.value)" style="flex:1 1 120px;min-width:0">` +
    `<option value="${k === "year" ? "all" : ""}">${allLabel}</option>` + opts.map(o => `<option value="${esc(o.v)}" ${cur === o.v ? "selected" : ""}>${esc(o.l)}</option>`).join("") + `</select>`;

  let h = `<div class="card"><div class="row" style="gap:6px;flex-wrap:wrap">
      ${sel("year", JH_YEAR, years.map(y => ({ v: y, l: y })), "All years")}
      ${sel("type", JH_TYPE, types.map(x => ({ v: x, l: x })), "All job types")}
      ${sel("who", JH_WHO, Object.keys(people).sort((a, b) => people[a].localeCompare(people[b])).map(id => ({ v: id, l: people[id] })), "Everyone")}
      <button class="btn ghost sm" style="flex:0 0 auto" onclick="jhExport()">⤓ CSV</button></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px 6px;margin-top:10px;text-align:center">
      <div><div class="sub">Jobs</div><div class="nm" style="font-size:17px;white-space:nowrap">${t.n}</div></div>
      <div><div class="sub">Billed</div><div class="nm" style="font-size:17px;white-space:nowrap">${fm(t.gross)}</div></div>
      <div><div class="sub">Crew paid</div><div class="nm" style="font-size:17px;white-space:nowrap">${fm(t.crew)}</div></div>
      <div><div class="sub">Business kept</div><div class="nm" style="font-size:17px;white-space:nowrap">${fm(t.business)}</div></div>
      <div><div class="sub">Tax reserve</div><div class="nm" style="font-size:17px;white-space:nowrap">${fm(t.tax)}</div></div>
    </div>
    ${t.hard ? `<div class="sub" style="margin-top:6px;white-space:normal;text-align:center">Hard costs paid back off the top: ${fm(t.hard)} (disposal, materials, mileage, rental)</div>` : ""}
    ${t.unallocated ? `<div class="sub" style="margin-top:4px;white-space:normal;text-align:center;color:var(--danger)">${fm(t.unallocated)} of crew pay is unassigned. Open the income entry and add the crew.</div>` : ""}</div>`;

  if (!rows.length) h += `<div class="empty"><div class="big">📜</div>No paid jobs match.<br>A job shows here once its payment is recorded as income.</div>`;
  else h += `<div class="secthd"><h2>Paid jobs</h2><span class="ct">${rows.length}</span></div><div class="card" style="padding:0">` + rows.map(r => {
    const open = r.jobId ? `onclick="if(typeof closeModal==='function')closeModal();openJobPage('${r.jobId}')"` : "";
    const crewLine = r.crew.length
      ? r.crew.map(c => `<span style="white-space:nowrap"><b>${esc(c.name)}</b> ${fm(c.cents)}${c.weight != null && c.weight !== 100 ? ` <span class="sub">(${c.weight}%)</span>` : ""}${Math.round(c.hours * 10) / 10 > 0 ? ` <span class="sub">· ${Math.round(c.hours * 10) / 10}h</span>` : ""}</span>`).join('<span class="sub"> · </span>')
      : `<span style="color:var(--danger)">no crew assigned</span>`;
    const extras = [];
    if (r.salesTo) extras.push(`sales credit <b>${esc(r.salesTo.name)}</b> ${fm(r.salesTo.cents)}`);
    if (r.adminTo) extras.push(`admin <b>${esc(r.adminTo.name)}</b> ${fm(r.adminTo.cents)}`);
    if (r.unallocated) extras.push(`<span style="color:var(--danger)">${fm(r.unallocated)} unassigned</span>`);
    return `<div class="li" ${open} style="align-items:flex-start;padding:10px 12px;border-bottom:1px solid var(--line)${r.jobId ? ";cursor:pointer" : ""}"><div class="grow" style="min-width:0">
        <div class="nm" style="font-size:15px">${esc(r.title)}</div>
        <div class="sub" style="white-space:normal">${r.type !== r.title ? esc(r.type) + " · " : ""}${esc(r.cust)} · ${esc(jhDaysLabel(r.days, fd))}${r.paidDate && r.days.indexOf(r.paidDate) < 0 ? ` · paid ${esc(fd(r.paidDate))}` : ""}</div>
        <div style="display:flex;gap:6px;font-size:13px;margin-top:5px;line-height:1.5"><span style="flex:0 0 auto">👷</span><div style="flex:1;min-width:0;white-space:normal">${crewLine}</div></div>
        ${extras.length ? `<div class="sub" style="white-space:normal;margin-top:2px">${extras.join(" · ")}</div>` : ""}
        <div class="sub" style="white-space:normal;margin-top:4px">${r.hard ? `hard costs ${fm(r.hard)} → ` : ""}tax ${fm(r.tax)} → business ${fm(r.business)}${r.bizSales ? ` <span title="unclaimed sales share, funds the ads">(incl. ${fm(r.bizSales)} sales)</span>` : ""} → crew pool ${fm(r.fieldPool)}</div></div>
      <div style="text-align:right;flex:0 0 auto;margin-left:8px"><b style="font-size:15px">${fm(r.gross)}</b><div class="sub" style="font-size:11px">billed</div>
        <div style="font-size:13px;margin-top:4px;font-weight:700;color:var(--accent)">${fm(r.business)}</div><div class="sub" style="font-size:11px">business</div></div></div>`;
  }).join("") + `</div>`;

  const unpaid = (JH_WHO || JH_TYPE) ? [] : jhUnpaidDone(rows).filter(u => JH_YEAR === "all" || (u.days[0] || "").slice(0, 4) === JH_YEAR);
  if (unpaid.length) {
    h += `<div class="secthd"><h2>Finished, no payment recorded</h2><span class="ct">${unpaid.length}</span></div><div class="card" style="padding:0">` + unpaid.map(u => `
      <div class="li" onclick="if(typeof closeModal==='function')closeModal();openJobPage('${u.j.id}')" style="cursor:pointer;align-items:flex-start;padding:10px 12px;border-bottom:1px solid var(--line)"><div class="grow" style="min-width:0">
        <div class="nm" style="font-size:15px">${esc(u.j.title || "Job")}</div>
        <div class="sub" style="white-space:normal">${esc(u.cust)} · ${esc(jhDaysLabel(u.days, fd))}${u.crew.length ? " · 👷 " + esc(u.crew.join(", ")) : ""}</div></div>
      <div style="text-align:right;flex:0 0 auto;margin-left:8px"><b>${u.price ? fm(u.price) : "—"}</b><div class="sub" style="font-size:11px">${u.price ? "quoted" : "no quote"}</div></div></div>`).join("") + `</div>
      <div class="sub" style="margin:4px 8px 10px;white-space:normal">These are marked done but have no income entry, so nobody has been paid on them yet. Mark the quote paid (or record the income) and they move up.</div>`;
  }
  h += `<div class="card" style="background:var(--soft)"><div class="sub" style="white-space:normal">Same math as Payouts and My Pay: hard costs come off the top, then 25% tax reserve, 15% business fund, 60% labor (80% split among the crew, 15% sales credit, 5% admin). Gas reimbursement is per person per month, so it is not shown per job.</div></div>`;
  return h;
}
if (typeof window !== "undefined") window.rJobHistory = rJobHistory;

if (typeof module !== "undefined" && module.exports) {
  module.exports = { jhBuildRows: jhBuildRows, jhFilter: jhFilter, jhTotals: jhTotals, jhBuildCSV: jhBuildCSV, jhDaysOf: jhDaysOf, jhDaysLabel: jhDaysLabel };
}
