/* ---------- SCHEDULE SANITY-AID (Cap #7) — a heads-up on tough days ----------
   Non-blocking nudge in the day view when a day's jobs (a) mix many service types — more gear to
   pack + context-switching — or (b) spread across several towns — heavy driving. Pure read off the
   existing jobs/customers/properties; no data change. Shown in the calendar day modal (openDay). */

const SANITY_TYPE_MIN = 3;   // distinct service types on a day → "mixed"
const SANITY_TOWN_MIN = 3;   // distinct towns on a day → "heavy driving"
/* coarse service classifier from the job title (order matters — first hit wins) */
const JOBTYPE_MAP = [
  ["pressure", "Pressure washing"], ["soft wash", "Soft washing"], ["house wash", "House washing"], ["wash", "Washing"],
  ["window", "Windows"], ["junk", "Junk removal"], ["haul", "Junk removal"], ["demo", "Demolition"],
  ["mow", "Mowing"], ["yard", "Yard"], ["brush", "Brush/yard"], ["gutter", "Gutters"], ["light", "Lighting"],
  ["starlink", "Tech"], ["mount", "Tech"], ["lock", "Tech"], ["wifi", "Tech"], ["camera", "Tech"], ["clean", "Cleanup"]
];
function sanityJobType(j) { const t = String((j && j.title) || "").toLowerCase(); for (const kv of JOBTYPE_MAP) if (t.indexOf(kv[0]) >= 0) return kv[1]; return "Other"; }
function sanityJobTown(j) {
  const d = D(); const c = j.customerId ? (d.customers || []).find(x => x.id === j.customerId) : null;
  if (c && c.town) return String(c.town).trim();
  const p = (j.propertyId && typeof actProps === "function") ? actProps().find(x => x.id === j.propertyId) : null;
  const addr = (p && p.address) || j.address || (c && c.address) || "";
  if (!addr) return "";
  const parts = String(addr).replace(/,?\s*NC\s*\d{0,5}\s*$/i, "").split(",").map(s => s.trim()).filter(Boolean);   // drop trailing ", NC 27949"
  return parts.length ? parts[parts.length - 1] : "";
}
/* the day's warnings (deterministic) — only open (not-done) jobs, and only when there's real overlap */
function daySanity(ds) {
  const jobs = (typeof actJ === "function" ? actJ() : []).filter(j => j.date === ds && !j.done);
  if (jobs.length < 2) return [];
  const out = [];
  const types = Array.from(new Set(jobs.map(sanityJobType).filter(x => x && x !== "Other")));
  if (types.length >= SANITY_TYPE_MIN) out.push({ k: "mixed", msg: "Mixed job types (" + types.join(", ") + ") — pack for all of it and expect context-switching." });
  const towns = Array.from(new Set(jobs.map(sanityJobTown).filter(Boolean)));
  if (towns.length >= SANITY_TOWN_MIN) out.push({ k: "driving", msg: "Spread across " + towns.length + " towns (" + towns.join(", ") + ") — heavy driving; sequence the route to cut miles." });
  return out;
}
function daySanityBanner(ds) {
  const w = (typeof daySanity === "function") ? daySanity(ds) : [];
  if (!w.length) return "";
  return `<div class="card" style="border-left:4px solid #b26a00"><div class="nm" style="color:#b26a00">⚠ Heads-up for this day</div>${w.map(x => `<div class="sub" style="white-space:normal;margin-top:4px">• ${esc(x.msg)}</div>`).join("")}</div>`;
}
window.daySanity = daySanity; window.daySanityBanner = daySanityBanner;
