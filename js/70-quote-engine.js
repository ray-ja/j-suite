/* ---------- SHARED QUOTE ENGINE — one set of rules every job tool prices through ----------
   Backbone (Ray's rule): each crew member must net $45/hr TAKE-HOME. The field crew is paid 48% of
   NET revenue (60% labor pool × 80% field), AFTER hard costs come off the top. So to pay $45/hr each
   we must bill $45 / 0.48 = $93.75 per PERSON-HOUR after hard costs.

   Person-hours = crew × (on-site + drive-to-site hours)  +  dump-run hours counted as ONE person.

   Disposal has TWO modes (the warehouse insight):
     • STASH  — junk goes to our warehouse; NO per-job dump run, just the tip fee for its weight.
     • DUMP   — C&D/trees must go straight to the dump; full dump run (drive + 1-person time + tip fee).

   Every per-job tool calls these qe* functions, so the math + the price readout feel identical. */
const QE = { TAKE_HOME: 45, CREW_FLOOR: 30, FIELD_SPLIT: 0.48, MILEAGE: 0.725, CD_TON: 73.16, VEG_TON: 58.46, FILL_TON: 45, MIN_JOB: 175, MARGIN_FLOOR: 0.35 };
// TAKE_HOME ($45/hr) = Ray's floor (leaving a $55/hr day job). CREW_FLOOR ($30/hr) = the worth-it line for Chase/Pierce (off $15-18/hr day jobs). A job between the two = "send the crew, not yourself."
function qeLoadedRate() { return QE.TAKE_HOME / QE.FIELD_SPLIT; }   // 93.75 — billed per person-hour
/* ⛔ NO FREE ALLOWANCE. Ray, 2026-08-26: "the station only waives some trash once per year its irrelevant
   and shouldn't be in any quote tool."
   The 500 lb waiver is an ANNUAL RESIDENTIAL allowance — a household's once-a-year cleanout, not something a
   contractor gets on every load. Subtracting it from a job quote under-costed EVERY C&D dump line by
   500/2000 × $73.16 = $18.29, silently and in the customer's favour, on every job that hauled.
   ⚠️ THIS IS THE THIRD TIME THE SAME MISTAKE HAS BEEN CAUGHT (see VEG_FREE below, corrected 2026-07-25, and
   Dare's free residential yard site that excludes contractor debris). The pattern: a rate sheet written for
   households gets read as if it applied to the business. If a disposal number is described as free, assume it
   is free for a RESIDENT and check what the commercial line says before it reaches a quote. */
function qeTipFee(lbs, type) { const rate = type === "veg" ? QE.VEG_TON : type === "fill" ? QE.FILL_TON : QE.CD_TON; return Math.round(Math.max(0, +lbs || 0) / 2000 * rate * 100) / 100; }
function qePersonHours(o) { const crew = Math.max(1, +o.crew || 1), onsite = +o.onsiteHrs || 0, siteDrive = +o.siteDriveHrs || 0, dumpH = (o.mode === "dump") ? (+o.dumpHrs || 0) : 0; return Math.round((crew * (onsite + siteDrive) + dumpH) * 100) / 100; }
function qeHardCosts(o) { const tip = qeTipFee(o.lbs, o.dtype); const mat = +o.materials || 0; const siteMi = (+o.siteMiles || 0) * QE.MILEAGE; const dumpMi = (o.mode === "dump") ? (+o.dumpMiles || 0) * QE.MILEAGE : 0; return Math.round((tip + mat + siteMi + dumpMi) * 100) / 100; }
/* the floor: lowest price that still pays $45/hr each (never below the job minimum) */
function qeQuote(o) { const PH = qePersonHours(o), hard = qeHardCosts(o); const raw = hard + qeLoadedRate() * PH; const floor = Math.max(QE.MIN_JOB, Math.ceil(raw / 5) * 5); return { PH: PH, hard: hard, floor: floor, rawFloor: Math.round(raw) }; }
/* given a price, what does each person actually take home per hour */
function qeEval(price, o) { const PH = qePersonHours(o), hard = qeHardCosts(o); const net = (+price || 0) - hard; const takeHome = PH > 0 ? (net * QE.FIELD_SPLIT) / PH : 0; const margin = price > 0 ? net / price : 0; return { PH: PH, hard: hard, net: net, takeHome: takeHome, margin: margin, ok: takeHome >= QE.TAKE_HOME }; }
/* the live readout — the same on every tool: take-home/hr (the number that matters) + floor + market */
function qeStrip(price, o, bandKey) {
  const ev = qeEval(price, o), q = qeQuote(o);
  const ok = ev.takeHome >= QE.TAKE_HOME, col = ok ? "#1a7f37" : "#c1121f";
  let h = `<div class="card" style="text-align:center;border:2px solid ${col}"><div style="font-size:12px;font-weight:700;color:var(--muted)">EACH PERSON TAKES HOME</div><div style="font-size:30px;font-weight:800;line-height:1.1;color:${col}">${money(ev.takeHome)}/hr</div><div style="font-size:12px;color:${col};font-weight:700">${ok ? "✓ clears your $" + QE.TAKE_HOME + "/hr floor" : "⚠ under your $" + QE.TAKE_HOME + "/hr floor — raise the price"}</div></div>`;
  h += `<div class="sub" style="margin:6px 2px;line-height:1.7">${q.PH.toFixed(1)} person-hours · hard costs ${money(ev.hard)} · margin ${Math.round(ev.margin * 100)}%${ev.margin < QE.MARGIN_FLOOR ? ' <span style="color:#c1121f">⚠ under 35%</span>' : ""}<br>Floor to hit $${QE.TAKE_HOME}/hr each: <b>${money(q.floor)}</b></div>`;
  if (bandKey && typeof MARKET_BANDS !== "undefined" && MARKET_BANDS[bandKey]) { const b = MARKET_BANDS[bandKey]; const st = price < b.lo ? "below" : price > b.hi ? "above" : "inside"; const sc = st === "inside" ? "#1a7f37" : st === "below" ? "#c1121f" : "var(--muted)"; h += `<div class="sub" style="margin:2px 2px">📊 Local ${esc(b.label)} range ${money(b.lo)}–${money(b.hi)} — you're <b style="color:${sc}">${st}</b></div>`; }
  return h;
}
