/* ---------- CUSTOMER MATERIALS REPORT (per-job, customer-facing PASS-THROUGH document) ----------
   Ray hands the customer a clean, branded doc of every PASS-THROUGH charge (materials + any pass-through
   rentals) on a job, WITH the actual receipt images as proof — Print / Save-as-PDF from a standalone window.

   Read-only / display-only. It reads j.materials[] (+ any j.expenses item explicitly type "pass-through")
   and NEVER writes, sums, or changes how anything is billed — so it is fingerprint-neutral (no data layer).
   Reuses the invPrint (js/46) print-window + window.print() pattern, BIZ branding, and the shared helpers
   (custName / jsUploadUrl / rcptDate / money2 / fmtDate / esc). Owner/admin gated (finCanView) at the button.

   ONLY customer-billed pass-through is exposed here — internal job-expenses (🚚) and business/tool costs (🔧)
   are NEVER included, so the customer only ever sees what they were actually charged for materials. */

/* the active org's branding, obx as the safe default */
function jmrBiz() {
  try { return (typeof BIZ === "object" && BIZ && (BIZ[S.biz] || BIZ.obx)) || { name: "OBX Lot Solutions", phone: "" }; }
  catch (e) { return { name: "OBX Lot Solutions", phone: "" }; }
}

/* the pass-through (customer-billed) line items on a job. j.materials[] IS the pass-through bucket
   (js/100: 🧱 → job.materials — "billed to the customer at cost"); we also fold in any j.expenses item
   EXPLICITLY tagged type "pass-through" (belt-and-suspenders — never a bare job-expense/business cost).
   Sorted by date. Read-only — returns the live records, callers must not mutate. */
function jobPassThroughItems(j) {
  if (!j) return [];
  const out = [];
  ((typeof plMaterials === "function") ? plMaterials(j) : (j.materials || [])).forEach(function (m) {
    if (m && !m.deleted && (!m.type || m.type === "pass-through")) out.push(m);   // materials default = pass-through
  });
  ((typeof plExpenses === "function") ? plExpenses(j) : (j.expenses || [])).forEach(function (e) {
    if (e && !e.deleted && e.type === "pass-through") out.push(e);                 // a pass-through-tagged expense (rare)
  });
  return out.sort(function (a, b) { return String(jmrItemDate(a)).localeCompare(String(jmrItemDate(b))); });
}
/* the report's total = the sum of the pass-through charges (what's billed as pass-through) */
function jobPassThroughTotal(j) { return jobPassThroughItems(j).reduce(function (s, x) { return s + (+x.amount || 0); }, 0); }
/* does the job have anything customer-billed to report? drives the button's visibility */
function jobHasPassThrough(j) { return jobPassThroughItems(j).length > 0; }

/* ISO date for an item — reuse the shared receipt-date resolver (capRead.date → date → ts), else "" */
function jmrItemDate(it) {
  try { if (typeof rcptDate === "function") return rcptDate(it) || ""; } catch (e) {}
  if (it && it.date) return it.date;
  if (it && it.ts) { try { return new Date(it.ts).toISOString().slice(0, 10); } catch (x) {} }
  return "";
}
function jmrMoney(n) { return (typeof money2 === "function") ? money2(n) : (typeof money === "function") ? money(n) : "$" + (+n || 0).toFixed(2); }
function jmrFmt(d) { return (d && typeof fmtDate === "function") ? fmtDate(d) : (d || ""); }
function jmrUrl(id) { return (id && typeof jsUploadUrl === "function") ? jsUploadUrl(id) : ""; }

/* build the full, print-optimized HTML document for a job's materials report (pure — testable) */
function jobMaterialsReportHTML(j) {
  const biz = jmrBiz();
  const d = (typeof D === "function") ? D() : {};
  const cust = (j && j.customerId && (d.customers || [])) ? (d.customers || []).find(function (x) { return x && x.id === j.customerId; }) : null;
  const custLabel = (j && j.customerId && typeof custName === "function") ? custName(j.customerId) : "";
  const custAddr = (cust && cust.address) ? cust.address : "";
  const items = jobPassThroughItems(j || {});
  const total = jobPassThroughTotal(j || {});
  const base = (function () { try { return ((S.sync && S.sync.url) || location.origin).replace(/\/+$/, ""); } catch (e) { return ""; } })();
  const logoUrl = biz.logo ? (base + "/" + biz.logo) : "";
  const genDate = (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10);

  const rows = items.length ? items.map(function (it) {
    return "<tr>" +
      '<td class="dt">' + esc(jmrFmt(jmrItemDate(it))) + "</td>" +
      "<td>" + esc(it.vendor || "") + "</td>" +
      "<td>" + esc(it.desc || it.note || "Material") + "</td>" +
      '<td class="amt">' + jmrMoney(it.amount) + "</td>" +
      "</tr>";
  }).join("") : '<tr><td colspan="4" class="muted">No pass-through materials on this job.</td></tr>';

  /* receipt gallery — every item that has a photo, labeled by vendor + amount, as proof */
  const withPhoto = items.filter(function (it) { return it.receiptId; });
  const gallery = withPhoto.length ? (
    '<h2>Receipts</h2><div class="rcpts">' + withPhoto.map(function (it) {
      const u = jmrUrl(it.receiptId);
      const cap = esc([it.vendor, jmrMoney(it.amount)].filter(Boolean).join(" · "));
      return '<figure><img src="' + esc(u) + '" alt="receipt" onerror="this.parentNode.classList.add(\'broken\');this.style.display=\'none\'">' +
        '<figcaption>' + cap + '<span class="ph">(receipt image unavailable)</span></figcaption></figure>';
    }).join("") + "</div>"
  ) : "";

  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>Materials Report" + (custLabel ? " — " + esc(custLabel) : "") + "</title><style>" +
    "*{box-sizing:border-box}" +
    "body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;margin:0;padding:24px;max-width:720px;margin:0 auto}" +
    ".head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;border-bottom:2px solid #111;padding-bottom:12px}" +
    ".head img{max-height:56px;max-width:200px}" +
    ".head h1{font-size:19px;margin:0}.muted{color:#666;font-size:13px}" +
    ".doc{text-align:right}.doc .t{font-size:16px;font-weight:800}" +
    ".meta{display:flex;flex-wrap:wrap;gap:18px;margin:14px 0}.meta .b{font-weight:700;font-size:12px;text-transform:uppercase;color:#666}" +
    "table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}" +
    "th,td{padding:8px 6px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}" +
    "th{font-size:11px;text-transform:uppercase;color:#666;border-bottom:2px solid #111}" +
    "td.dt{white-space:nowrap}td.amt,th.amt{text-align:right;white-space:nowrap}" +
    "tfoot td{border-bottom:none;border-top:2px solid #111;font-weight:800;font-size:16px;padding-top:10px}" +
    "h2{font-size:14px;text-transform:uppercase;color:#666;margin:26px 0 10px;border-bottom:1px solid #ddd;padding-bottom:4px}" +
    ".rcpts{display:flex;flex-wrap:wrap;gap:14px}" +
    "figure{margin:0;width:220px;border:1px solid #ddd;border-radius:8px;padding:8px;page-break-inside:avoid}" +
    "figure img{width:100%;height:auto;border-radius:4px;display:block}" +
    "figcaption{font-size:12px;color:#444;margin-top:6px}.ph{display:none;color:#999}figure.broken .ph{display:inline}" +
    ".foot{margin-top:28px;border-top:1px solid #ddd;padding-top:12px;color:#666;font-size:13px}" +
    "button{margin-top:20px;padding:11px 18px;font-size:15px;border:0;border-radius:8px;background:#111;color:#fff;cursor:pointer}" +
    "@page{margin:14mm}@media print{button{display:none}body{padding:0}}" +
    "</style></head><body>" +
    '<div class="head"><div>' +
    (logoUrl ? '<img src="' + esc(logoUrl) + '" alt="" onerror="this.style.display=\'none\'">' : "") +
    "<h1>" + esc(biz.name || "") + "</h1>" + (biz.phone ? '<div class="muted">' + esc(biz.phone) + "</div>" : "") +
    '</div><div class="doc"><div class="t">Materials &amp; Pass-Through Charges</div>' +
    '<div class="muted">Generated ' + esc(jmrFmt(genDate)) + "</div></div></div>" +
    '<div class="meta">' +
    (custLabel ? '<div><div class="b">Customer</div>' + esc(custLabel) + (custAddr ? '<div class="muted">' + esc(custAddr) + "</div>" : "") + "</div>" : "") +
    '<div><div class="b">Job</div>' + esc((j && j.title) || "Job") + (j && j.date ? '<div class="muted">' + esc(jmrFmt(j.date)) + "</div>" : "") + "</div>" +
    "</div>" +
    "<table><thead><tr><th>Date</th><th>Vendor</th><th>Description</th><th class=\"amt\">Amount</th></tr></thead>" +
    "<tbody>" + rows + "</tbody>" +
    '<tfoot><tr><td colspan="3" style="text-align:right">Total pass-through charges</td><td class="amt">' + jmrMoney(total) + "</td></tr></tfoot></table>" +
    gallery +
    '<div class="foot">Every charge above is a material or pass-through cost billed to you at cost, with the original receipt attached as proof.<br>' +
    esc(biz.name || "") + (biz.phone ? " · " + esc(biz.phone) : "") + "<br><b>Thank you for your business!</b></div>" +
    '<button onclick="window.print()">🖨 Print / Save as PDF</button>' +
    "</body></html>";
}

/* open the report in a standalone print window (invPrint pattern) and auto-print after load */
window.jobMaterialsReport = function (jobId) {
  const j = ((typeof actJ === "function") ? actJ() : ((D() || {}).jobs || [])).find(function (x) { return x && x.id === jobId; });
  if (!j) { alert("Job not found."); return; }
  if (!jobHasPassThrough(j)) { alert("No pass-through materials on this job to report."); return; }
  const html = jobMaterialsReportHTML(j);
  const w = window.open("", "_blank");
  if (!w) { alert("Pop-up blocked — allow pop-ups to open the report."); return; }
  w.document.open(); w.document.write(html); w.document.close();
  try { w.onload = function () { try { w.focus(); w.print(); } catch (e) {} }; } catch (e) {}
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { jobPassThroughItems: jobPassThroughItems, jobPassThroughTotal: jobPassThroughTotal, jobHasPassThrough: jobHasPassThrough, jobMaterialsReportHTML: jobMaterialsReportHTML };
}
