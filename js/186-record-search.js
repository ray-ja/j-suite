/* ---------- FIND ANYTHING (js/186) ----------
   Ray, 2026-09-22, UX audit: nothing searched for a customer, a job or a quote from anywhere; the menu search
   was desktop-only and found screens, not records. And one project can live in three orgs (the waterfall:
   stone job, Jamieson quote, OBX customer), so the search covers every org the signed-in user belongs to.

   A 🔍 in the header (phone and desktop) opens a sheet with one box. Type a name, an address, a phone number,
   a quote number or a job title; results are grouped (customers, properties, jobs, quotes/invoices) and tagged
   with the org when it is not the one you are in. Tap → switch org if needed → open the record through the
   module that owns it (openCustomer / openProperty / openJobPage / openQuote / openInvoice). The index is built
   on each keystroke from the in-memory store (a few thousand rows; fast) so nothing is cached stale.
   Pure helpers (index + ranking) are node-testable: record-search-tests.js. */
const RS_KIND_ORDER = ["customer", "property", "job", "quote", "file"];
const RS_LIMIT = 30;
function rsNorm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9@. ]+/g, " ").replace(/\s+/g, " ").trim(); }
function rsDigits(s) { return String(s == null ? "" : s).replace(/\D+/g, ""); }
/* build search rows for the given org ids from a store shaped {orgId:{customers,properties,jobs,quotes}} */
function recordSearchIndex(store, orgIds) {
  const out = [];
  (orgIds || []).forEach(org => {
    const s = store && store[org]; if (!s || typeof s !== "object") return;
    const custs = (s.customers || []).filter(c => c && !c.deleted);
    const cname = id => { const c = custs.find(x => x.id === id); return c ? (c.name || "") : ""; };
    custs.forEach(c => out.push({ kind: "customer", org, id: c.id, title: c.name || "(no name)", sub: [c.company, c.phone, c.email].filter(Boolean).join(" · "),
      hay: rsNorm([c.name, c.company, c.email, c.town].join(" ")), digits: rsDigits(c.phone) + " " + (c.phones || []).map(p => rsDigits(p && (p.number || p))).join(" ") }));
    (s.properties || []).filter(p => p && !p.deleted).forEach(p => out.push({ kind: "property", org, id: p.id, title: (p.address || "(no address)") + (p.unit ? " · " + p.unit : ""),
      sub: [(p.label && p.label !== "Main") ? p.label : "", (p.customerIds || []).map(cname).filter(Boolean).join(", ")].filter(Boolean).join(" · "),
      hay: rsNorm([p.address, p.unit, p.label, (p.customerIds || []).map(cname).join(" ")].join(" ")), digits: "" }));
    (s.jobs || []).filter(j => j && !j.deleted).forEach(j => out.push({ kind: "job", org, id: j.id, title: j.title || "Job", sub: [cname(j.customerId) || j.cust, j.date, j.done ? "done" : ""].filter(Boolean).join(" · "),
      hay: rsNorm([j.title, j.address, cname(j.customerId), j.cust, j.date, j.poNum ? "po " + j.poNum : ""].join(" ")), digits: rsDigits(j.poNum) }));
    (s.quotes || []).filter(q => q && !q.deleted).forEach(q => {
      const first = (q.items && q.items[0] && q.items[0].name) || "";
      const state = q.paid ? "paid" : q.invoiced ? "invoice" : "quote";
      out.push({ kind: "quote", org, id: q.id, jobId: q.jobId || "", invoiced: !!q.invoiced, title: (q.num ? "#" + q.num + " · " : "") + (cname(q.customerId) || q.cust || first || "Quote"),
        sub: [first.slice(0, 60), q.total != null ? "$" + Number(q.total).toLocaleString() : "", state, q.date].filter(Boolean).join(" · "),
        hay: rsNorm([q.num ? "#" + q.num + " " + q.num : "", cname(q.customerId), q.cust, first, q.address, state, q.date].join(" ")), digits: q.num ? String(q.num) : "" });
    });
    (s.personalFiles || []).filter(f => f && !f.deleted).forEach(f => out.push({ kind: "file", org, id: f.id, title: f.note || f.name || "file", sub: [f.note ? f.name : "", f.ts ? new Date(f.ts).toLocaleDateString() : ""].filter(Boolean).join(" · "),
      hay: rsNorm([f.note, f.name, f.type].join(" ")), digits: "" }));
  });
  return out;
}
/* rank rows for a query: every word must match (in hay or as digits); score prefers title-start and word-start hits. */
function recordSearchRun(rows, q, limit) {
  limit = limit || RS_LIMIT;
  const nq = rsNorm(q); const dq = rsDigits(q);
  if (!nq && !dq) return [];
  const words = nq.split(" ").filter(Boolean);
  const scored = [];
  (rows || []).forEach(r => {
    let score = 0;
    const digitHit = dq.length >= 3 && r.digits && r.digits.indexOf(dq) >= 0;
    const titleN = rsNorm(r.title);
    /* every word must match at a WORD START (prefix), so "5" finds "#5" but not "1115" */
    const allWords = words.every(w => r.hay.indexOf(w) === 0 || r.hay.indexOf(" " + w) >= 0);
    if (!allWords && !digitHit) return;
    if (digitHit) score += 40;
    words.forEach(w => { if (titleN.indexOf(w) === 0) score += 30; else if (titleN.indexOf(" " + w) >= 0) score += 20; else if (r.hay.indexOf(" " + w) >= 0 || r.hay.indexOf(w) === 0) score += 10; else score += 3; });
    score -= RS_KIND_ORDER.indexOf(r.kind);   // stable tie-break: customers before properties before jobs before quotes
    scored.push({ r, score });
  });
  scored.sort((a, b) => b.score - a.score || RS_KIND_ORDER.indexOf(a.r.kind) - RS_KIND_ORDER.indexOf(b.r.kind) || a.r.title.localeCompare(b.r.title));
  return scored.slice(0, limit).map(x => x.r);
}
if (typeof window !== "undefined") {
  const E = s => (typeof esc === "function") ? esc(String(s == null ? "" : s)) : String(s == null ? "" : s);
  const KIND_LABEL = { customer: "👤 Customers", property: "🏠 Properties", job: "🔨 Jobs", quote: "🧾 Quotes & invoices", file: "📎 Files" };
  let _rsTimer = null;
  function rsOrgIds() { try { const o = (typeof myOrgs === "function") ? myOrgs() : []; const ids = o.map(x => x.id).filter(Boolean); return ids.length ? ids : [S.biz]; } catch (e) { return [S.biz]; } }
  function rsRecent() { try { return JSON.parse(localStorage.getItem("jra_rs_recent") || "[]"); } catch (e) { return []; } }
  function rsRemember(row) { try { const list = rsRecent().filter(x => !(x.kind === row.kind && x.id === row.id && x.org === row.org)); list.unshift({ kind: row.kind, id: row.id, org: row.org, title: row.title, sub: row.sub }); localStorage.setItem("jra_rs_recent", JSON.stringify(list.slice(0, 8))); } catch (e) {} }
  function rsRowsHTML(rows, label) {
    if (!rows.length) return "";
    const groups = {}; rows.forEach(r => (groups[r.kind] = groups[r.kind] || []).push(r));
    return (label ? `<div class="pmhead">${E(label)}</div>` : "") + RS_KIND_ORDER.filter(k => groups[k]).map(k => `<div class="pmhead">${KIND_LABEL[k]}</div>` + groups[k].map(r =>
      `<button class="rsrow" onclick="recordSearchGo('${E(r.org)}','${E(r.kind)}','${E(r.id)}')"><div class="grow"><div class="nm">${E(r.title)}${r.org !== S.biz ? ` <span class="badge rsorg">${E((typeof orgName === "function") ? orgName(r.org) : r.org)}</span>` : ""}</div>${r.sub ? `<div class="sub">${E(r.sub)}</div>` : ""}</div><span class="rsgo">›</span></button>`).join("")).join("");
  }
  window.recordSearchType = function (q) {
    clearTimeout(_rsTimer);
    _rsTimer = setTimeout(() => {
      const out = document.getElementById("rs_out"); if (!out) return;
      if (!String(q || "").trim()) { const rec = rsRecent(); out.innerHTML = rec.length ? rsRowsHTML(rec, "Recent") : `<div class="sub" style="padding:8px 2px">Customers, properties, jobs, quotes and invoices, in every organization you belong to.</div>`; return; }
      const rows = recordSearchRun(recordSearchIndex(S, rsOrgIds()), q, RS_LIMIT);
      out.innerHTML = rows.length ? rsRowsHTML(rows, "") : `<div class="sub" style="padding:8px 2px">Nothing matches "${E(q)}".</div>`;
    }, 120);
  };
  window.recordSearchGo = function (org, kind, id) {
    if (typeof closeModal === "function") closeModal();
    try {
      const slab = S[org] || {};
      const row = { kind, id, org, title: "", sub: "" };
      if (kind === "customer") { const c = (slab.customers || []).find(x => x && x.id === id); row.title = c ? c.name : ""; }
      else if (kind === "property") { const p = (slab.properties || []).find(x => x && x.id === id); row.title = p ? p.address : ""; }
      else if (kind === "job") { const j = (slab.jobs || []).find(x => x && x.id === id); row.title = j ? j.title : ""; }
      else if (kind === "quote") { const q = (slab.quotes || []).find(x => x && x.id === id); row.title = q ? ("#" + q.num + " · " + (q.cust || "")) : ""; }
      if (row.title) rsRemember(row);
    } catch (e) {}
    if (org && org !== S.biz && typeof setBiz === "function") setBiz(org);
    const slab = S[S.biz] || {};
    if (kind === "customer" && typeof openCustomer === "function") return openCustomer(id);
    if (kind === "property" && typeof openProperty === "function") return openProperty(id);
    if (kind === "job" && typeof openJobPage === "function") return openJobPage(id);
    if (kind === "quote") {
      const q = (slab.quotes || []).find(x => x && x.id === id);
      if (q && q.invoiced && typeof openInvoice === "function") return openInvoice(id);
      if (q && q.jobId && typeof openJobPage === "function") return openJobPage(q.jobId);
      if (typeof openQuote === "function") return openQuote(id);
    }
    if (kind === "file" && typeof navSub === "function") { navSub("files"); window.PF_FOCUS = id; }
  };
  window.recordSearchOpen = function () {
    if (typeof modal !== "function") return;
    modal("Find", `<input id="rs_q" class="rsq" type="search" placeholder="Name, address, phone, quote #, job…" autocomplete="off" oninput="recordSearchType(this.value)" onkeydown="if(event.key==='Enter'){const b=document.querySelector('#rs_out .rsrow');if(b)b.click();}"><div id="rs_out"></div>`);
    recordSearchType("");
    setTimeout(() => { const i = document.getElementById("rs_q"); if (i) i.focus(); }, 30);
  };
  /* the header 🔍 (once) + "/" on a keyboard when not typing */
  (function () {
    function mount() {
      const hdr = document.querySelector("header"); if (!hdr || document.getElementById("srchbtn")) return;
      const b = document.createElement("button"); b.className = "hdrbtn"; b.id = "srchbtn"; b.title = "Find a customer, job, quote…"; b.setAttribute("aria-label", "Find"); b.textContent = "🔍"; b.onclick = window.recordSearchOpen;
      const prof = document.getElementById("profilebtn"); if (prof) hdr.insertBefore(b, prof); else hdr.appendChild(b);
    }
    if (document.querySelector("header")) mount(); else document.addEventListener("DOMContentLoaded", mount);
    document.addEventListener("keydown", e => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target; const tag = t && t.tagName; if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
      if (document.body.classList.contains("signedout")) return;
      e.preventDefault(); window.recordSearchOpen();
    });
  })();
  window.recordSearchIndex = recordSearchIndex; window.recordSearchRun = recordSearchRun;
}
if (typeof module !== "undefined" && module.exports) { module.exports = { recordSearchIndex, recordSearchRun, rsNorm, rsDigits, RS_KIND_ORDER }; }
