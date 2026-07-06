/* ---------- RECEIPT CSV IMPORT (Phase 1 — deterministic parse, NO AI) ----------
   Ray exports a store purchase-history CSV (Lowe's / Home Depot) and drops it on the Receipts page. The APP
   parses it — one REVIEW record per line item — straight into the existing `receipts[]` review queue, where the
   owner categorizes/routes each via the normal edit/split flow. Nothing here touches a billing array, so the
   P&L / invoicing / finance fingerprints stay byte-identical until the owner files each row (mirrors the photo
   upload path). The raw CSV is DISCARDED — records only carry {source:"csv", importId, csvFp} for dedup/undo.

   REUSES the dependency-free CSV toolkit in js/80-budget-csv.js (loaded before this file):
     budgetParseCSV (quotes/""/CRLF/BOM) · budgetParseDate (ISO/US/D-M-Y) · budgetParseAmount ($/parens/neg)
     · budgetDupKey (date|cents|merchant-signature). Plus modal()/uid/now/today/save/render/toast/esc.

   FLOW (mirrors js/80's 3-step import): read the file as TEXT (FileReader — never jsUpload/blob, so it works
   offline / on file://) → auto-map columns by header → PREVIEW ("Found N · $X — import?") with a per-row
   keep-checkbox (likely dups pre-unchecked) + one "Vendor for all" field → commit N review records + one save.
   Weird/unmappable layouts fall through to a manual column-map step; 0 parsed rows never crashes. */

/* ---- one import session (discarded after commit / cancel) ---- */
var RCSV = null;

/* ---- junk-row filter: subtotal / tax / payment / shipping / fees, etc. (counted, not imported) ---- */
function rcptCsvIsJunkDesc(desc) {
  return /^(sub\s*)?total$|^tax$|^sales?\s*tax|^balance|^payment|^tender|^change|^order\s*(total|summary)|^shipping$|^fee/i.test(String(desc || "").trim());
}

/* ---- pick the AMOUNT column: prefer an extended/line-total over a unit/each price ---- */
function rcptCsvAmountIdx(headers, used) {
  var best = -1, bestScore = -1e9;
  for (var i = 0; i < headers.length; i++) {
    if (used && used[i]) continue;
    var h = String(headers[i] || "").toLowerCase();
    if (!/amount|total|price|ext|subtotal|sub\s*total|cost/.test(h)) continue;
    var score = 0;
    if (/ext|line\s*total|line\s*amount|line\s*item/.test(h)) score += 5;   // extended / line total wins
    if (/\btotal\b/.test(h)) score += 3;
    if (/^amount|\bamount\b/.test(h)) score += 3;
    if (/sub\s*total|subtotal/.test(h)) score += 1;
    if (/unit|each|\bper\b|qty|quantity/.test(h)) score -= 6;               // a UNIT price is not the line amount
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}
/* ---- first unused header matching `re` ---- */
function rcptCsvHdrIdx(headers, re, used) {
  for (var i = 0; i < headers.length; i++) { if (used && used[i]) continue; if (re.test(String(headers[i] || "").toLowerCase())) return i; }
  return -1;
}

/* ---- detect header row + fuzzy-map columns. Returns {hasHeader, headers, map:{date,desc,amount,store,order}}. ---- */
function rcptCsvAutoMap(rows) {
  var out = { hasHeader: false, headers: [], map: { date: -1, desc: -1, amount: -1, store: -1, order: -1 } };
  if (!rows || !rows.length) return out;
  var first = rows[0];
  // header heuristic (js/80): the first row is a header when NO cell parses as a real number
  out.hasHeader = !first.some(function (c) { return budgetParseAmount(c) != null && /\d/.test(String(c)); });
  out.headers = out.hasHeader
    ? first.map(function (h, i) { return String(h).trim() || ("Column " + (i + 1)); })
    : first.map(function (_, i) { return "Column " + (i + 1); });
  var used = {};
  var amount = rcptCsvAmountIdx(out.headers, used); if (amount >= 0) used[amount] = 1;
  var date = rcptCsvHdrIdx(out.headers, /date|purchase|posted|transaction/, used); if (date >= 0) used[date] = 1;
  var desc = rcptCsvHdrIdx(out.headers, /desc|item|product|material|name|line/, used); if (desc >= 0) used[desc] = 1;
  var store = rcptCsvHdrIdx(out.headers, /store|location|vendor|merchant/, used); if (store >= 0) used[store] = 1;
  var order = rcptCsvHdrIdx(out.headers, /order|receipt|invoice|transaction\s*id|confirmation/, used); if (order >= 0) used[order] = 1;
  out.map = { date: date, desc: desc, amount: amount, store: store, order: order };
  return out;
}

/* ---- build ONE review record from a data row (or null to SKIP a junk/blank row). Never throws. ---- */
function rcptCsvRecord(row, map, vendor, importId) {
  if (!row) return null;
  var amt = budgetParseAmount(map.amount >= 0 ? row[map.amount] : null);   // SIGNED (budgetParseAmount already returns "-$90"→-90); null → skipped
  if (amt == null || isNaN(amt) || amt === 0) return null;   // keep the sign — a negative Order Total is a refund/credit, imported as a NEGATIVE review receipt (nets the deposit)
  var descCell = map.desc >= 0 ? String(row[map.desc] != null ? row[map.desc] : "").trim() : "";
  if (rcptCsvIsJunkDesc(descCell)) return null;
  var date = (map.date >= 0 && budgetParseDate(row[map.date])) || (typeof today === "function" ? today() : "");
  var store = (map.store >= 0 && String(row[map.store] != null ? row[map.store] : "").trim()) || "";
  var desc = descCell;
  if (map.order >= 0) { var ord = String(row[map.order] != null ? row[map.order] : "").trim(); if (ord) desc = desc ? desc + " · order #" + ord : "order #" + ord; }
  var me = (typeof rcptMe === "function") ? rcptMe() : null;
  var t = (typeof now === "function") ? now() : Date.now();
  var rec = {
    id: (typeof uid === "function") ? uid() : ("rcsv_" + t + "_" + Math.random().toString(36).slice(2)),
    receiptId: null, amount: Math.round(amt * 100) / 100, vendor: (store || vendor || "").trim(),
    date: date, type: null, jobId: null, category: "", paidBy: null, cardLast4: "", desc: desc,
    // attributedTo (whose receipt / who's reimbursed) is left BLANK on import — a bulk uploader is NOT the payer.
    // The generic parser has no card column, so it can't be resolved; uploadedBy keeps the audit trail.
    uploadedBy: me ? me.id : "", attributedTo: "", by: me ? (me.username || "") : "",
    status: "review", suggested: null, ts: t, deleted: false, updatedAt: t,
    source: "csv", importId: importId || "", csvFp: ""
  };
  if (amt < 0) rec.kind = "refund";   // a negative amount is a refund/credit (js/96) — flagged so review surfaces it
  return rec;
}

/* ---- file fingerprint (rowCount|totalCents|minDate|maxDate) — for the "already imported?" soft-warn ---- */
function rcptCsvFingerprint(recs) {
  if (!recs || !recs.length) return "0|0||";
  var cents = 0, min = null, max = null;
  recs.forEach(function (r) { cents += Math.round((+r.amount || 0) * 100); var d = r.date || ""; if (d) { if (min === null || d < min) min = d; if (max === null || d > max) max = d; } });
  return recs.length + "|" + cents + "|" + (min || "") + "|" + (max || "");
}

/* ---- guess the vendor from the file name (Lowe's default) ---- */
function rcptCsvGuessVendor(fileName) {
  var n = String(fileName || "").toLowerCase();
  if (/home\s*-?\s*depot|homedepot|\bhd\b/.test(n)) return "Home Depot";
  if (/lowe/.test(n)) return "Lowe's";
  return "";
}

/* ============================== VENDOR-SPECIFIC IMPORTERS ==============================
   Ray doesn't want to hand-map columns. A HANDFUL of stores offer a downloadable CSV of purchase history
   (Lowe's, Home Depot, Walmart, Amazon). Each has a fixed header layout, so a DEDICATED parser can convert it
   with ZERO mapping. We detect the vendor by its header signature; if one matches we skip the column-map step
   entirely and go straight to the preview. Unknown files fall back to the generic fuzzy auto-map / manual map
   (unchanged). Adding a new vendor later = ONE entry in VENDOR_PARSERS below — no other change.

   A parser is: { id, name, detect(headerCells)->bool, parseRow(cells, H)->record|null } where
     · headerCells = the raw first CSV row (array of strings)
     · H           = a normalized header→index map (built by rcptVendorH; keys are trim+lowercase header text)
     · parseRow returns a review record (rcptVendorRecord shape) or null to SKIP the row (trailer / no total). */

/* ---- normalized header→index map (trim + lowercase; first wins on a dup header) ---- */
function rcptVendorH(headerCells) {
  var H = {};
  (headerCells || []).forEach(function (h, i) { var k = String(h == null ? "" : h).trim().toLowerCase(); if (!(k in H)) H[k] = i; });
  return H;
}
/* ---- index of the first header key matching `re` (−1 if none) ---- */
function rcptHIdx(H, re) { for (var k in H) { if (Object.prototype.hasOwnProperty.call(H, k) && re.test(k)) return H[k]; } return -1; }
/* ---- trimmed value of the first column whose header matches `re` ("" if missing) ---- */
function rcptHVal(H, cells, re) { var i = rcptHIdx(H, re); return i >= 0 ? String(cells && cells[i] != null ? cells[i] : "").trim() : ""; }

/* ---- tolerant date parse for vendor files. Handles Lowe's "2-Jul-2026" (D-Mon-YYYY) DETERMINISTICALLY
        (iOS Safari won't reliably parse that string), then falls back to budgetParseDate for ISO/US.
        Local to the vendor path — budgetParseDate itself is untouched (other callers unaffected). ---- */
function rcptCsvVendorDate(s) {
  s = String(s || "").trim(); if (!s) return "";
  var m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})$/);   // D-Mon-YYYY, e.g. 2-Jul-2026
  if (m) {
    var mon = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }[m[2].slice(0, 3).toLowerCase()];
    var p2 = (typeof pad2 === "function") ? pad2 : function (n) { return String(n).padStart(2, "0"); };
    if (mon) return m[3] + "-" + p2(mon) + "-" + p2(m[1]);
  }
  return (typeof budgetParseDate === "function") ? budgetParseDate(s) : "";
}

/* ---- a customer HINT from a register-typed PO string (Ray types "mike green" / "mike g" at the register).
        Skips the not-a-customer sentinels (NA / N/A / no / blank / "multiple*"). Otherwise surfaces the PO on
        the desc AND, if it case-insensitively equals / is contained in EXACTLY ONE active customer's name, offers
        a soft {customerId,name} hint (a SUGGESTION the review UI can accept — never a hard jobId set). ---- */
function rcptCsvPoResolve(poRaw) {
  var po = String(poRaw == null ? "" : poRaw).trim(), low = po.toLowerCase();
  if (po === "" || low === "na" || low === "n/a" || low === "no" || low.indexOf("multiple") === 0) return { surface: false, po: "", custHint: null };
  var custHint = null;
  try {
    var custs = (typeof actC === "function") ? actC()
      : ((typeof D === "function" && D() && Array.isArray(D().customers)) ? D().customers.filter(function (c) { return c && !c.deleted; }) : []);
    var matches = [];
    custs.forEach(function (c) {
      var nm = String((c && (c.name || c.company)) || "").trim().toLowerCase(); if (!nm) return;
      if (nm === low || nm.indexOf(low) >= 0) { if (matches.indexOf(c) < 0) matches.push(c); }   // typed PO equals or is contained in the name
    });
    if (matches.length === 1) custHint = { customerId: matches[0].id, name: matches[0].name || matches[0].company || "" };   // exactly one → offer it
  } catch (e) { /* never let a hint lookup break an import */ }
  return { surface: true, po: po, custHint: custHint };
}

/* Resolve import attribution from a card last-4: a matched PERSONAL card → that user (paid + reimbursed); a
   company card → no reimburse; an UNMATCHED / absent card → BLANK (unknown — NEVER the bulk uploader, who just
   ran the import). The unknown ones are flagged in the list so the owner registers the card to a person. */
function rcptCardAttr(last4) {
  if (last4 && typeof cardOwner === "function") {
    var r = cardOwner(last4);
    if (r && r.resolution === "personal" && r.ownerId) return { paidBy: r.ownerId, attributedTo: r.ownerId };
    if (r && r.resolution === "business") return { paidBy: "", attributedTo: "" };
  }
  return { paidBy: null, attributedTo: "" };
}
/* ---- build a review record from parsed vendor fields (mirrors rcptCsvRecord's shape; adds optional custHint) ---- */
function rcptVendorRecord(f) {
  var me = (typeof rcptMe === "function") ? rcptMe() : null;
  var t = (typeof now === "function") ? now() : Date.now();
  var _at = rcptCardAttr(f.cardLast4 || "");   // matched card → that person; unmatched/company → blank (not the uploader)
  var rec = {
    id: (typeof uid === "function") ? uid() : ("rcsv_" + t + "_" + Math.random().toString(36).slice(2)),
    receiptId: null, amount: Math.round((+f.amount || 0) * 100) / 100, vendor: String(f.vendor || "").trim(),
    date: f.date || (typeof today === "function" ? today() : ""), type: null, jobId: null, category: "",
    paidBy: _at.paidBy, cardLast4: f.cardLast4 || "", desc: f.desc || "",
    uploadedBy: me ? me.id : "", attributedTo: _at.attributedTo, by: me ? (me.username || "") : "",
    status: "review", suggested: null, ts: t, deleted: false, updatedAt: t,
    source: "csv", importId: "", csvFp: ""
  };
  if (f.custHint) rec.custHint = f.custHint;   // additive optional hint (review UI may offer it); no migration
  return rec;
}

/* ---- THE REGISTRY. Each parser owns one vendor's CSV export. Add Home Depot / Walmart / Amazon here when a
        real sample arrives — same {id,name,detect,parseRow} shape, no other file changes. ---- */
var VENDOR_PARSERS = [
  {
    id: "lowes", name: "Lowe's",
    /* signature of Lowe's "Order History" export — three columns no other file combines */
    detect: function (headerCells) {
      var H = rcptVendorH(headerCells);
      return rcptHIdx(H, /order\s*#\s*\/\s*trans/) >= 0 && rcptHIdx(H, /cc#?\s*\(\s*last\s*4\s*\)/) >= 0 && rcptHIdx(H, /order total/) >= 0;
    },
    parseRow: function (cells, H) {
      if (!cells) return null;
      var amt = budgetParseAmount(rcptHVal(H, cells, /order total/));       // SIGNED total incl. tax (a negative = a return/refund row)
      if (amt == null || isNaN(amt) || amt === 0) return null;              // trailer / blank / note row → SKIP (0 only; keep the sign)
      var date = rcptCsvVendorDate(rcptHVal(H, cells, /^date$/));
      var order = rcptHVal(H, cells, /order\s*#\s*\/\s*trans/).replace(/^#+/, "");
      var store = rcptHVal(H, cells, /fulfillment store location/);
      var m4 = rcptHVal(H, cells, /cc#?\s*\(\s*last\s*4\s*\)/).match(/(\d{4})\s*$/);   // "************2469" → "2469"
      var desc = order ? ("Order #" + order) : "Lowe's order";
      if (store) desc += " · " + store;
      var poRaw = rcptHVal(H, cells, /^po number$/);
      var poR = rcptCsvPoResolve(poRaw);
      if (poR.surface) desc += " · PO: " + poR.po;                          // surface the register-typed note
      // PER-JOB PO CODE (js/95) EXACT-match: if the typed PO is our own P#### and resolves to exactly one job,
      // hard-assign the receipt to it (jobId + customerId + a badge). This WINS + supersedes the fuzzy
      // PO→customer-name hint (custHint is only passed as the fallback when there's no exact job match).
      var poJob = (typeof jobByPO === "function") ? jobByPO(poRaw) : null;
      var rec = rcptVendorRecord({ amount: amt, vendor: "Lowe's", date: date, desc: desc, cardLast4: m4 ? m4[1] : "", custHint: poJob ? null : poR.custHint });   // SIGNED — a negative Order Total imports as a refund/credit
      if (amt < 0) rec.kind = "refund";
      if (poJob) {
        rec.jobId = poJob.id;
        rec.customerId = poJob.customerId || null;
        rec._poMatch = { po: (typeof jobPO === "function") ? jobPO(poJob) : "", label: poJob.title || "Job" };
      }
      return rec;
    }
  }
  /* ,{ id:"homedepot", name:"Home Depot", detect(headerCells){…}, parseRow(cells,H){…} }   // add when a sample arrives
     ,{ id:"walmart",   name:"Walmart",    detect(headerCells){…}, parseRow(cells,H){…} }
     ,{ id:"amazon",    name:"Amazon",     detect(headerCells){…}, parseRow(cells,H){…} } */
];

/* ---- pick the first vendor parser whose signature matches this file's header row (null = unknown → generic) ---- */
function rcptCsvDetectVendor(headerCells) {
  for (var i = 0; i < VENDOR_PARSERS.length; i++) { try { if (VENDOR_PARSERS[i].detect(headerCells)) return VENDOR_PARSERS[i]; } catch (e) {} }
  return null;
}

/* ============================== ENTRY POINTS ============================== */
/* the dedicated "📄 Import a purchase CSV" button (owner) + its hidden input */
window.rcptCsvPickOpen = function () { var el = document.getElementById("rcpt_csv"); if (el) el.click(); };
window.rcptCsvPick = function (input) {
  var f = input && input.files && input.files[0];
  if (f) rcptCsvHandle(f);
  if (input) input.value = "";   // clear so re-picking the same file re-fires onchange
};
/* read the CSV as TEXT (offline / file:// safe — NEVER blob-uploaded) then start the import */
window.rcptCsvHandle = function (file) {
  if (!file) return;
  var rdr = new FileReader();
  rdr.onload = function () { rcptCsvStart(String(rdr.result || ""), file.name || ""); };
  rdr.onerror = function () { if (typeof toast === "function") toast("Could not read that CSV file."); else if (typeof alert === "function") alert("Could not read that CSV file."); };
  try { rdr.readAsText(file); } catch (e) { if (typeof alert === "function") alert("Could not read that CSV file."); }
};

/* parse the text, auto-map, and route to the right step (map if columns are missing, else preview) */
function rcptCsvStart(text, fileName) {
  var vendor = rcptCsvGuessVendor(fileName) || "Lowe's";
  RCSV = { text: text || "", fileName: fileName || "", rows: null, headers: [], hasHeader: true,
           map: { date: -1, desc: -1, amount: -1, store: -1, order: -1 }, vendor: vendor, vendorId: "", vendorName: "", detStore: "", parsed: [], skipped: 0, fp: "" };
  var rows = budgetParseCSV(text);
  if (!rows.length) { rcptCsvSourceStep(); return; }   // nothing parsed → offer a paste fallback
  RCSV.rows = rows;
  // auto-map first — populates headers/map so the manual-map escape hatch stays valid even on a vendor file
  var am = rcptCsvAutoMap(rows);
  RCSV.hasHeader = am.hasHeader; RCSV.headers = am.headers; RCSV.map = am.map;
  // ── VENDOR DETECTION ── a dedicated parser matching this file's header signature → ZERO-map straight to preview
  var parser = rcptCsvDetectVendor(rows[0]);
  if (parser) {
    RCSV.vendorId = parser.id; RCSV.vendorName = parser.name; RCSV.vendor = parser.name; RCSV.hasHeader = true;
    rcptCsvBuildVendorPreview(parser);
    return;
  }
  // ── GENERIC FALLBACK ── unknown file → fuzzy auto-map (or manual map if a required column is missing)
  if (am.map.date < 0 || am.map.desc < 0 || am.map.amount < 0) { rcptCsvMapStep(); return; }   // weird layout → manual map
  rcptCsvBuildPreview();
}

/* ---------- SOURCE step — a paste-CSV fallback when a file can't be read ---------- */
function rcptCsvSourceStep() {
  if (typeof modal !== "function") return;
  modal("Import purchase CSV — paste",
    '<p class="muted" style="margin:0 0 8px;font-size:13px">Couldn\'t read line items from that file. Paste the CSV text here instead — it\'s parsed on your phone, nothing is uploaded.</p>'
    + '<textarea id="rcsv_text" rows="8" placeholder="Date,Item,Amount\n2026-07-01,Quikrete 60lb,6.98\n..." style="width:100%;font-family:monospace;font-size:12px">' + esc(RCSV ? RCSV.text : "") + '</textarea>'
    + '<button class="btn acc" style="width:100%;margin-top:12px" onclick="rcptCsvParsePasted()">Next →</button>'
  );
}
window.rcptCsvParsePasted = function () {
  var t = (document.getElementById("rcsv_text") || {}).value || "";
  rcptCsvStart(t, RCSV ? RCSV.fileName : "");
};

/* ---------- MAP step — shown only when auto-map missed a required column (the escape hatch) ---------- */
function rcptCsvMapStep(note) {
  if (typeof modal !== "function") return;
  var cols = RCSV.headers || [];
  var sel = function (id, cur, allowNone) {
    return '<select id="' + id + '" style="width:100%">'
      + (allowNone ? '<option value="-1"' + (cur < 0 ? " selected" : "") + '>— none —</option>' : '')
      + cols.map(function (h, i) { return '<option value="' + i + '"' + (cur === i ? " selected" : "") + '>' + esc(h) + '</option>'; }).join("")
      + '</select>';
  };
  var nRows = RCSV.rows.length - (RCSV.hasHeader ? 1 : 0);
  var h = (note ? '<div class="card" style="border-left:4px solid var(--danger);margin-bottom:8px"><b>' + esc(note) + '</b></div>' : '')
    + '<p class="muted" style="margin:0 0 8px;font-size:13px">' + nRows + ' data row' + (nRows === 1 ? "" : "s") + '. Tell us which column is which.</p>'
    + '<label>Date column</label>' + sel("rcsv_date", RCSV.map.date, false)
    + '<label>Item / description column</label>' + sel("rcsv_desc", RCSV.map.desc, false)
    + '<label>Amount column</label>' + sel("rcsv_amount", RCSV.map.amount, false)
    + '<div class="sub" style="margin:4px 0">Prefer the line/extended total over a unit price.</div>'
    + '<label style="margin-top:8px">Store / vendor column (optional)</label>' + sel("rcsv_store", RCSV.map.store, true)
    + '<label>Order # column (optional)</label>' + sel("rcsv_order", RCSV.map.order, true)
    + '<label class="row" style="gap:6px;align-items:center;margin-top:8px"><input type="checkbox" id="rcsv_hdr" ' + (RCSV.hasHeader ? "checked" : "") + ' style="width:auto"> First row is a header</label>'
    + '<button class="btn acc" style="width:100%;margin-top:12px" onclick="rcptCsvMapApply()">Preview →</button>';
  modal("Import purchase CSV — map columns", h);
}
window.rcptCsvMapApply = function () {
  var gv = function (id) { var e = document.getElementById(id); return e ? parseInt(e.value, 10) : -1; };
  RCSV.map = { date: gv("rcsv_date"), desc: gv("rcsv_desc"), amount: gv("rcsv_amount"), store: gv("rcsv_store"), order: gv("rcsv_order") };
  var hdr = document.getElementById("rcsv_hdr"); if (hdr) RCSV.hasHeader = hdr.checked;
  if (RCSV.map.date < 0 || RCSV.map.desc < 0 || RCSV.map.amount < 0) { rcptCsvMapStep("Pick a date, item, and amount column to continue."); return; }
  rcptCsvBuildPreview();
};

/* ---------- GENERIC path: build parsed rows from the fuzzy column map, then present ---------- */
function rcptCsvBuildPreview() {
  var rows = RCSV.rows.slice(RCSV.hasHeader ? 1 : 0);
  var items = [], skipped = 0;
  rows.forEach(function (row) {
    var storeCell = RCSV.map.store >= 0 ? String(row[RCSV.map.store] != null ? row[RCSV.map.store] : "").trim() : "";
    var rec = rcptCsvRecord(row, RCSV.map, RCSV.vendor, "");   // importId assigned at commit
    if (!rec) { skipped++; return; }
    items.push({ rec: rec, store: storeCell });
  });
  rcptCsvPresentPreview(items, skipped);
}

/* ---------- VENDOR path: run a dedicated parser over every data row (no column map), then present ---------- */
function rcptCsvBuildVendorPreview(parser) {
  var H = rcptVendorH(RCSV.rows[0]);            // vendor files always carry a header row
  var rows = RCSV.rows.slice(1);
  var items = [], skipped = 0;
  rows.forEach(function (row) {
    var rec = null; try { rec = parser.parseRow(row, H); } catch (e) { rec = null; }
    if (!rec) { skipped++; return; }            // trailer / blank / no-total → skipped + counted
    items.push({ rec: rec, store: rec.vendor || "" });
  });
  rcptCsvPresentPreview(items, skipped);
}

/* ---------- shared finish: soft dedup, fingerprint, vendor-default, already-imported warn, then PREVIEW ---------- */
function rcptCsvPresentPreview(items, skipped) {
  var parsed = [], seen = {}, storeCounts = {};
  // existing receipts (review + filed) for cross-import soft dedup
  var existing = {};
  ((typeof rcptAllRows === "function") ? rcptAllRows() : []).forEach(function (r) {
    if (!(+r.amount)) return;
    var rd = (typeof rcptDate === "function") ? rcptDate(r) : (r.date || "");
    existing[budgetDupKey(rd, r.amount, r.desc || r.note || "")] = true;
  });
  items.forEach(function (it) {
    var rec = it.rec, storeCell = it.store || "";
    if (storeCell) storeCounts[storeCell] = (storeCounts[storeCell] || 0) + 1;
    var dk = budgetDupKey(rec.date, rec.amount, rec.desc);
    var dup = !!(existing[dk] || seen[dk]); seen[dk] = true;
    parsed.push({ rec: rec, store: storeCell, dup: dup, keep: !dup });   // dups pre-unchecked
  });
  RCSV.parsed = parsed; RCSV.skipped = skipped;
  RCSV.fp = rcptCsvFingerprint(parsed.map(function (p) { return p.rec; }));
  // "Vendor for all" default = the most common detected store, else the file-name guess
  var det = "", detN = -1; Object.keys(storeCounts).forEach(function (k) { if (storeCounts[k] > detN) { detN = storeCounts[k]; det = k; } });
  RCSV.detStore = det;
  if (!parsed.length) { rcptCsvMapStep("No line items parsed — check the amount/item choice."); return; }
  // soft-warn (never block) if this same file looks already-imported
  var already = ((typeof rcptColl === "function") ? rcptColl() : []).some(function (r) { return r && !r.deleted && r.csvFp && r.csvFp === RCSV.fp; });
  if (already && typeof confirm === "function" && !confirm("Looks like you already imported this file (same rows/total/dates). Import it again anyway?")) { if (typeof closeModal === "function") closeModal(); RCSV = null; return; }
  rcptCsvPreviewStep();
}

/* ---------- PREVIEW step — "Found N · $X — import?" + keep-checkboxes + one Vendor-for-all ---------- */
function rcptCsvPreviewStep() {
  if (typeof modal !== "function") return;
  var p = RCSV.parsed;
  var keepCount = p.filter(function (x) { return x.keep; }).length;
  var total = p.filter(function (x) { return x.keep; }).reduce(function (s, x) { return s + (+x.rec.amount || 0); }, 0);
  var dupN = p.filter(function (x) { return x.dup; }).length;
  var vendorDefault = RCSV.detStore || RCSV.vendor || "Lowe's";
  var m = (typeof money === "function") ? money : function (n) { return "$" + (Math.round(n * 100) / 100).toFixed(2); };
  var h = (RCSV.vendorId ? '<div class="card" style="border-left:4px solid var(--accent);margin:0 0 8px;padding:6px 10px"><b>Detected: ' + esc(RCSV.vendorName || RCSV.vendor) + '</b> — ' + p.length + ' line item' + (p.length === 1 ? "" : "s") + ' <span class="sub">· auto-parsed, no column mapping needed</span></div>' : '');
  h += '<p class="muted" style="margin:0 0 6px;font-size:13px"><b>Found ' + p.length + ' line item' + (p.length === 1 ? "" : "s") + ' · ' + m(total) + ' total</b> — import?'
    + (RCSV.skipped ? ' <span class="sub">(skipped ' + RCSV.skipped + ' non-item row' + (RCSV.skipped === 1 ? "" : "s") + ')</span>' : '')
    + (dupN ? ' · <span style="color:var(--danger)">' + dupN + ' likely duplicate' + (dupN === 1 ? "" : "s") + ' unchecked</span>' : '') + '</p>';
  h += '<label>Vendor for all</label><input id="rcsv_vendor" value="' + esc(vendorDefault) + '" placeholder="Lowe\'s" style="width:100%;margin-bottom:8px"><div class="sub" style="margin:-4px 0 8px">Rows with their own store keep it; the rest use this. Each lands in <b>Needs review</b>.</div>';
  h += '<div style="max-height:44vh;overflow:auto;border:1px solid var(--line,#eee);border-radius:8px">';
  h += p.map(function (row, i) {
    var r = row.rec;
    return '<div class="li" style="align-items:flex-start;gap:6px;' + (row.dup ? "opacity:.7;" : "") + 'border-bottom:1px solid var(--line,#f0f0f0);padding:6px 8px">'
      + '<input type="checkbox" id="rcsv_keep_' + i + '" ' + (row.keep ? "checked" : "") + ' onchange="rcptCsvToggle(' + i + ')" style="width:auto;margin-top:4px">'
      + '<div class="grow" style="min-width:0">'
      + '<div class="nm" style="white-space:normal">' + esc(r.desc || "(no description)") + (row.dup ? ' <span class="sub" style="color:var(--danger)">dup</span>' : '') + '</div>'
      + (r._poMatch ? '<div class="sub" style="color:var(--accent);font-weight:700">→ ' + esc(r._poMatch.po) + (r.customerId && typeof custName === "function" ? ' · ' + esc(custName(r.customerId)) : (' · ' + esc(r._poMatch.label))) + ' (auto)</div>' : '')
      + '<div class="sub">' + esc((typeof fmtDate === "function" ? fmtDate(r.date) : r.date) || "—") + ' · <b>' + m(r.amount) + '</b>' + (row.store ? ' · ' + esc(row.store) : '') + '</div>'
      + '</div></div>';
  }).join("");
  h += '</div>';
  h += '<button class="btn acc" style="width:100%;margin-top:12px" onclick="rcptCsvCommit()">Import ' + keepCount + ' receipt' + (keepCount === 1 ? "" : "s") + ' to review</button>';
  modal("Import purchase CSV — review", h);
}
window.rcptCsvToggle = function (i) {
  var cb = document.getElementById("rcsv_keep_" + i); if (cb && RCSV && RCSV.parsed[i]) RCSV.parsed[i].keep = cb.checked;
  // live-refresh the count/total in the button + header without rebuilding the (focused) list
  if (RCSV) { var btn = document.querySelector('button[onclick="rcptCsvCommit()"]'); if (btn) { var k = RCSV.parsed.filter(function (x) { return x.keep; }).length; btn.textContent = "Import " + k + " receipt" + (k === 1 ? "" : "s") + " to review"; } }
};

/* ---------- COMMIT — push N review records (shared importId + csvFp) + ONE save ---------- */
window.rcptCsvCommit = function () {
  if (!RCSV || !RCSV.parsed) return;
  RCSV.parsed.forEach(function (row, i) { var cb = document.getElementById("rcsv_keep_" + i); if (cb) row.keep = cb.checked; });
  var vAll = String((document.getElementById("rcsv_vendor") || {}).value || "").trim() || RCSV.vendor || "Lowe's";
  var keep = RCSV.parsed.filter(function (row) { return row.keep; });
  if (!keep.length) { if (typeof toast === "function") toast("Nothing selected to import."); else if (typeof alert === "function") alert("Nothing selected to import."); return; }
  var importId = (typeof uid === "function") ? uid() : ("imp_" + Date.now());
  var t = (typeof now === "function") ? now() : Date.now();
  var recs = keep.map(function (row) {
    var r = row.rec;
    r.vendor = row.store || vAll;   // a row's own store wins; else the one Vendor-for-all
    r.importId = importId;
    r.csvFp = RCSV.fp;
    r.updatedAt = t;
    return r;
  });
  var coll = (typeof rcptColl === "function") ? rcptColl() : ((D().receipts = D().receipts || []));
  recs.forEach(function (r) { coll.push(r); });
  if (typeof save === "function") save();
  var n = recs.length;
  RCSV = null;
  if (typeof closeModal === "function") closeModal();
  if (typeof toast === "function") toast("Imported " + n + " line item" + (n === 1 ? "" : "s") + " — categorize them in the review queue");
  if (typeof render === "function") render();
};
