/* ---------- ADDRESS LINE 2 (js/180) — unit / apt / suite on a property ----------
   Ray, 2026-09-18: "Libby White called… she's unit 2A. We don't have a second line address area."
   The street address stays the geocodable line (Nominatim chokes on "Unit 2A"); the unit is its own field
   (`unit`) on the property (and on a guided-call capture), and fullAddr() joins them for display, quotes,
   invoices and map links. Records without a unit render exactly as before. */
function addrUnit(rec) { return String((rec && rec.unit) || "").trim(); }
function fullAddr(rec) {
  const a = String((rec && rec.address) || "").trim(), u = addrUnit(rec);
  if (!a) return u;
  if (!u) return a;
  /* "4 Ginguite Trail, Southern Shores, NC" + "2A" → "4 Ginguite Trail, Unit 2A, Southern Shores, NC" (unit right after the street) */
  const parts = a.split(",").map(s => s.trim()).filter(Boolean);
  const label = /^(unit|apt|apartment|suite|ste|#|bldg|building|lot)\b/i.test(u) || /^#/.test(u) ? u : "Unit " + u;
  /* Nominatim writes "1115, Ocean Trail, Corolla, …" (house number as its own part) — the unit goes after the STREET part,
     i.e. after the first part that has letters in it */
  let at = parts.findIndex(s => /[a-z]/i.test(s)); if (at < 0) at = parts.length - 1;
  return parts.slice(0, at + 1).concat([label], parts.slice(at + 1)).join(", ");
}
/* the display line for a job: property (with unit) → job address → customer address → customer's first property */
function jobAddrFull(j, props, custs, propsForCustFn) {
  const p = (j && j.propertyId) ? (props || []).find(x => x && x.id === j.propertyId) : null;
  const c = j ? (custs || []).find(x => x && x.id === j.customerId) : null;
  if (p && p.address) return fullAddr(p);
  if (j && j.address) return j.address;
  if (c && c.address) return fullAddr(c);
  if (c && typeof propsForCustFn === "function") { const fp = (propsForCustFn(c.id) || [])[0]; if (fp && fp.address) return fullAddr(fp); }
  return "";
}
if (typeof window !== "undefined") { window.fullAddr = fullAddr; window.addrUnit = addrUnit; window.jobAddrFull = jobAddrFull; }
if (typeof module !== "undefined" && module.exports) { module.exports = { addrUnit, fullAddr, jobAddrFull }; }
