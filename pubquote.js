/* PUBLIC QUOTE DEPOSITS (Ray, 2026-11-09): the lights quote pages (/p/<slug>) take a 50% card deposit. The
   customer's picks are priced HERE from assets/quotes/<slug>/quote.json (written by tools/lights-render/pageconfig.js
   from the page's own tables), never from the browser's total. Paying records the picks on a quote in the org,
   locks the install date and emails a confirmation. Pure functions; sync-server.js does the I/O. */
const fs = require("fs"), path = require("path");
const SLUG_RE = /^[a-z0-9-]{3,80}$/;
function pqLoad(root, slug) {
  if (!SLUG_RE.test(String(slug || ""))) return null;
  try { return JSON.parse(fs.readFileSync(path.join(root, "assets", "quotes", slug, "quote.json"), "utf8")); } catch (e) { return null; }
}
function pqLeadOf(cfg, it, sizeIdx, color) {
  const L = cfg.lead || {};
  let k = it.lead;
  if (it.sizes) k = parseInt(it.sizes[sizeIdx][0], 10);
  if (typeof k === "number") return (L.wreath && (L.wreath[k] || L.wreath[60])) || 0;
  return (L[k] || 0) + (k === "garland" ? 0 : ((L.color && L.color[color]) || 0));
}
function pqYmd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
/* picks = { on:[ids], sz:{id:idx}, color } -> priced lines, bundle savings, total, deposit, install date */
function pqPrice(cfg, picks, nowMs) {
  if (!cfg || !Array.isArray(cfg.items)) return { error: "no quote" };
  picks = picks || {}; const on = new Set((Array.isArray(picks.on) ? picks.on : []).map(String)); const sz = picks.sz || {};
  const color = (cfg.colors || []).some(c => c.id === picks.color) ? picks.color : ((cfg.colors && cfg.colors[0] && cfg.colors[0].id) || "");
  /* mixed colors (Ray, 2026-11-12): optional second color for railings, columns, shrubs and trees; roofline keeps color */
  const mini = (cfg.mixColors && (cfg.colors || []).some(c => c.id === picks.mini)) ? picks.mini : color;
  const lines = []; let sub = 0, addons = 0, lead = 0;
  cfg.items.forEach(it => {
    if (!(it.base || on.has(it.id))) return;
    let idx = 0, price = it.price, label = it.label;
    if (it.sizes) { idx = Math.max(0, Math.min(it.sizes.length - 1, parseInt(sz[it.id], 10) || 0)); price = it.sizes[idx][1]; label += " (" + it.sizes[idx][0] + ")"; }
    price = +price || 0; sub += price; if (!it.base && !it.decor) addons += price;
    lead = Math.max(lead, pqLeadOf(cfg, it, idx, it.lead === "roof" ? color : mini));
    lines.push({ id: it.id, label: label, amt: Math.round(price * 100) / 100, size: it.sizes ? idx : null });
  });
  let rate = 0; (cfg.bundle || []).forEach(t => { if (addons >= t[0]) rate = t[1]; });
  const save = Math.round(addons * rate);
  const total = lines.length ? Math.round(Math.max(sub - save, cfg.min || 0)) : 0;
  const deposit = Math.round(total * (cfg.depPct || 0.5));   // whole dollars, same as the page shows
  const d = new Date(+nowMs || Date.now()); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + lead + (cfg.buffer || 0));
  const nameOf = (id) => ((cfg.colors || []).find(c => c.id === id) || {}).name || id;
  const colorName = mini === color ? nameOf(color) : "roofline " + nameOf(color).toLowerCase() + ", railings, shrubs and trees " + nameOf(mini).toLowerCase();
  return { lines, sub, save, rate, total, deposit, color, mini, colorName, installDate: pqYmd(d) };
}
function pqDateLabel(ymd) { const m = String(ymd || "").split("-"); if (m.length < 3) return ymd || ""; return new Date(+m[0], m[1] - 1, +m[2], 12).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" }); }
/* the quote record the deposit attaches to (one per page; re-pricing before payment overwrites it) */
function pqRecord(cfg, priced, buyer, existing, nowMs) {
  const now = +nowMs || Date.now(), id = "q_pub_" + cfg.slug;
  const items = priced.lines.map(l => ({ serviceId: "", name: l.label, unit: "job", price: l.amt, qty: 1, cost: 0, notes: [] }));
  if (priced.save) items.push({ serviceId: "", name: "Bundle savings (" + Math.round(priced.rate * 100) + "% off lights add-ons)", unit: "job", price: -priced.save, qty: 1, cost: 0, notes: [] });
  if (priced.total > priced.sub - priced.save) items.push({ serviceId: "", name: "Job minimum", unit: "job", price: Math.round((priced.total - (priced.sub - priced.save)) * 100) / 100, qty: 1, cost: 0, notes: [] });
  const ex = existing || {};
  return Object.assign({}, ex, {
    id, num: ex.num || 0, customerId: cfg.customerId, cust: buyer.name || ex.cust || "", customerName: buyer.name || ex.customerName || "",
    address: cfg.title, date: pqYmd(new Date(now)), kind: "lights", items, recurring: false, itemized: true,
    subtotal: priced.total, discount: 0, manualDisc: 0, discPct: 0, total: priced.total, cost: 0, taxable: false,
    notes: "Picked on the quote page " + cfg.slug + ". Color: " + priced.colorName + ". Install " + pqDateLabel(priced.installDate) + ".",
    pubSlug: cfg.slug, pubPicks: { on: priced.lines.map(l => l.id), sz: priced.lines.reduce((o, l) => { if (l.size != null) o[l.id] = l.size; return o; }, {}), color: priced.color, mini: priced.mini || priced.color },
    pubEmail: buyer.email || "", pubPhone: buyer.phone || "", installDate: priced.installDate, depositPct: cfg.depPct || 0.5, depositAmount: priced.deposit,
    status: ex.depositPaid ? ex.status : "Sent", deleted: false, createdAt: ex.createdAt || now, updatedAt: now, editedBy: "__pub__", editedAt: now
  });
}
function pqValidBuyer(b) {
  b = b || {}; const name = String(b.name || "").trim().slice(0, 80), email = String(b.email || "").trim().slice(0, 120), phone = String(b.phone || "").trim().slice(0, 30);
  if (!name) return { error: "Please add your name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Please add a valid email." };
  return { name, email, phone };
}
/* booking status the page shows once the deposit is in */
function pqStatus(rec) {
  if (!rec || rec.deleted || !rec.depositPaid) return { booked: false };
  return { booked: true, installDate: rec.installDate || "", picks: rec.pubPicks || null, total: rec.total, deposit: rec.depositAmount };
}
function pqEmail(cfg, rec, bizName) {
  const E = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const M = (n) => "$" + (+n).toLocaleString("en-US", { minimumFractionDigits: Math.round(n) === +n ? 0 : 2, maximumFractionDigits: 2 });
  const first = String(rec.cust || "").trim().split(/\s+/)[0];
  const rows = (rec.items || []).map(i => "<tr><td style=\"padding:4px 0\">" + E(i.name) + "</td><td style=\"padding:4px 0;text-align:right\">" + M(i.price) + "</td></tr>").join("");
  const subject = "You're booked: " + cfg.title + ", install " + pqDateLabel(rec.installDate);
  const html = "<div style=\"font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1b2330;max-width:560px\">"
    + "<p>" + (first ? "Hi " + E(first) + "," : "Hi,") + "</p>"
    + "<p>Thanks, your deposit is in and your install is booked for <b>" + E(pqDateLabel(rec.installDate)) + "</b>.</p>"
    + "<table style=\"width:100%;border-collapse:collapse;font-size:15px\">" + rows
    + "<tr><td style=\"padding:8px 0;border-top:1px solid #ddd\"><b>Total</b></td><td style=\"padding:8px 0;border-top:1px solid #ddd;text-align:right\"><b>" + M(rec.total) + "</b></td></tr>"
    + "<tr><td>Deposit paid</td><td style=\"text-align:right\">" + M(rec.depositAmount) + "</td></tr>"
    + "<tr><td>Balance on install day</td><td style=\"text-align:right\">" + M(Math.round((rec.total - rec.depositAmount) * 100) / 100) + "</td></tr></table>"
    + "<p>Color: " + E(((rec.notes || "").match(/Color: ([^.]+)/) || [])[1] || "") + "</p>"
    + "<p>Our lights, installed, serviced all season, taken down in January and stored. The lights stay ours.</p>"
    + "<p>Questions? Call or text (252) 207-5985.</p><p>" + E(bizName || "OBX Holiday Lights") + "</p></div>";
  return { subject, html };
}
module.exports = { pqLoad, pqPrice, pqRecord, pqValidBuyer, pqStatus, pqEmail, pqDateLabel, SLUG_RE };
