#!/usr/bin/env node
/* ---------- OPS-SWEEP (ops-scanning brain, Layer 2) ----------
   Dumb, no-LLM scheduled scanner. Reads the read-only CEO `view=ops` over Tailscale, applies
   deterministic gap rules, dedupes against a cursor (only NEW findings wake Cap), and prints a
   prioritized list. Scheduled separately from the reply-watcher AND the Dispatch timer
   (run at 07:00 / 12:00 / 17:00 local via cron/scheduler — see ops/README or the scheduler).
   Usage: node tools/ops-sweep.js        # one sweep; prints findings JSON; event:true iff new findings */
const fs = require("fs"), http = require("http"), https = require("https"), path = require("path"), os = require("os");
const CFG_PATH = path.join(__dirname, "..", "watcher-config.json");      // reuse {prodUrl, readToken}
const CURSOR = path.join(__dirname, ".ops-sweep-cursor.json");
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, "")); }
function loadCfg() { let c; try { c = readJson(CFG_PATH); } catch (e) { die("no watcher-config.json (need prodUrl + readToken)"); } if (!c.prodUrl || !c.readToken) die("watcher-config needs prodUrl + readToken"); return c; }
function loadCursor() { try { return readJson(CURSOR); } catch (e) { return { seen: {} }; } }
function saveCursor(c) { try { fs.writeFileSync(CURSOR, JSON.stringify(c)); } catch (e) {} }
function die(m) { console.error("ops-sweep: " + m); process.exit(1); }

function fetchOps(cfg) {
  return new Promise((resolve, reject) => {
    const u = new URL(cfg.prodUrl.replace(/\/+$/, "") + "/api/ceo?view=ops"), lib = u.protocol === "https:" ? https : http;
    const r = lib.request({ method: "GET", hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + u.search, headers: { Authorization: "Bearer " + cfg.readToken } },
      res => { let d = ""; res.on("data", c => d += c); res.on("end", () => { if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode + " " + d.slice(0, 80))); try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); });
    r.on("error", reject); r.setTimeout(15000, () => r.destroy(new Error("timeout"))); r.end();
  });
}

/* PURE: view=ops snapshot → prioritized findings [{key, sev, summary}] (deterministic, no network) */
function opsFindings(ops) {
  ops = ops || {}; const out = [];
  const today = ops.today || "", now = ops.asOf || Date.now();
  const DAY = 86400000, HOUR = 3600000, STALE_DAYS = 5, CLOCK_HOURS = 10, QUIET_HOURS = 26;
  const openByJob = {}; (ops.openShifts || []).forEach(s => { if (s.jobId) openByJob[s.jobId] = true; });
  const crewToday = {}; (ops.crew || []).forEach(c => { crewToday[c.id] = c.today; });
  (ops.jobs || []).forEach(j => {
    if (!j.done && j.date && j.date <= today && !openByJob[j.id])
      out.push({ key: "missedjob:" + j.id, sev: j.date < today ? "high" : "med", summary: (j.date < today ? "OVERDUE job" : "Today's job") + " — not done, no clock-in: \"" + j.title + "\"" + (j.crew && j.crew.length ? " [" + j.crew.length + " crew]" : "") + " · " + j.date + (j.customer ? " · " + j.customer : "") });
    if (!j.done && j.date === today && (j.crew || []).length && j.crew.every(id => crewToday[id] === "off" || crewToday[id] === "timeoff"))
      out.push({ key: "coverage:" + j.id, sev: "high", summary: "Coverage gap — today's job \"" + j.title + "\" but all assigned crew are off/timeoff" });
  });
  (ops.todos || []).forEach(td => {
    if (td.done) return;
    if (td.due && td.due < today) out.push({ key: "overduetask:" + td.id, sev: td.priority === "High" ? "high" : "med", summary: "Overdue task (" + (td.priority || "") + "): \"" + td.title + "\" due " + td.due });
    else if (td.updatedAt && (now - td.updatedAt) > STALE_DAYS * DAY) out.push({ key: "staletask:" + td.id, sev: "low", summary: "Stale task (" + Math.round((now - td.updatedAt) / DAY) + "d untouched): \"" + td.title + "\"" });
  });
  (ops.openShifts || []).forEach(s => { if (s.clockIn && (now - s.clockIn) > CLOCK_HOURS * HOUR) out.push({ key: "openshift:" + s.id, sev: "med", summary: "Open time entry " + Math.round((now - s.clockIn) / HOUR) + "h — forgot to clock out? (user " + s.userId + ")" }); });
  (ops.unscheduledQuotes || []).forEach(q => out.push({ key: "unschedquote:" + q.id, sev: "med", summary: "Accepted quote not scheduled: " + (q.customer || "") + " $" + (q.total || 0) + (q.acceptedDate ? " (since " + q.acceptedDate + ")" : "") }));
  const eqDay = {}; (ops.jobs || []).forEach(j => { if (j.done || !j.date) return; (j.equipment || []).forEach(it => { const k = j.date + "|" + it; (eqDay[k] = eqDay[k] || []).push(j.id); }); });
  Object.keys(eqDay).forEach(k => { if (eqDay[k].length > 1) out.push({ key: "eqconflict:" + k, sev: "med", summary: "Equipment double-booked " + k.replace("|", " · ") + " across " + eqDay[k].length + " jobs" }); });
  (ops.crew || []).forEach(c => { if (c.lastActive && (now - c.lastActive) > QUIET_HOURS * HOUR) out.push({ key: "quiet:" + c.id, sev: "low", summary: c.name + " not active in " + Math.round((now - c.lastActive) / HOUR) + "h" }); });
  const rank = { high: 0, med: 1, low: 2 };
  out.sort((a, b) => (rank[a.sev] - rank[b.sev]));
  return out;
}

async function main() {
  const cfg = loadCfg();
  let ops; try { ops = await fetchOps(cfg); } catch (e) { die("read view=ops failed: " + e.message); }
  const findings = opsFindings(ops);
  const cursor = loadCursor();
  const fresh = findings.filter(f => !cursor.seen[f.key]);
  saveCursor({ seen: findings.reduce((m, f) => { m[f.key] = 1; return m; }, {}) });   // only NEW fire next time; resolved ones drop
  console.log(JSON.stringify({ event: fresh.length > 0, at: Date.now(), sweep: ops.today, openFindings: findings.length, newFindings: fresh, allFindings: findings }, null, 1));
}
if (require.main === module) main();
module.exports = { opsFindings };
