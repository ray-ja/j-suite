/* standup-post.js — the 9:00 weekday stand-up agenda, posted to the crew Broadcast thread.
   Ray, 2026-09-16: he and Jason meet at the warehouse at nine every weekday. This puts the day on their phones
   before they sit down: today's jobs, what's due, charges to tag, open invoices, and any questions Claude/Cap
   left in docs:standup_questions. READ-ONLY on the store (reads data.json), writes ONE message through the
   token-gated /api/ceo/message route, same as Sentinel. Same text the Today card shows (js/177 standupText).
   crontab: 0 9 * * 1-5  node standup-post.js --org=obx --live   (no --live = print, don't post) */
const fs = require("fs"), path = require("path"), http = require("http");
const DIR = __dirname;
const args = process.argv.slice(2);
const ORG = (args.find(a => a.startsWith("--org=")) || "--org=obx").slice(6);
const LIVE = args.indexOf("--live") >= 0;
const su = require(path.join(DIR, "js", "177-standup.js"));

function localToday() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
const store = JSON.parse(fs.readFileSync(path.join(DIR, "data.json"), "utf8"));
const slab = store[ORG]; if (!slab) { console.log("no org " + ORG); process.exit(1); }
const day = localToday();
const names = {}; (store.users || []).forEach(u => { if (u && u.username && !u.kind) names[u.id] = u.username; });
const cust = {}; (slab.customers || []).forEach(c => { if (c) cust[c.id] = c.name || c.company || ""; });
const jobs = (slab.jobs || []).map(j => Object.assign({}, j, { cust: cust[j.customerId] || "" }));
const qdoc = (slab.docs || []).find(x => x && x.id === "standup_questions" && !x.deleted);
const agenda = su.standupAgenda(day, jobs, slab.todos || [], (qdoc && qdoc.items) || [], names);
/* extras: charges waiting to be tagged (Square feed rows on this org's book, untagged) + open invoices */
let toTag = 0;
try {
  for (const oid of Object.keys(store)) {
    const st = store[oid]; if (!st || !Array.isArray(st.budgetBooks)) continue;
    const books = new Set(st.budgetBooks.filter(b => b && !b.deleted && b.linkedOrgId === ORG).map(b => b.id)); if (!books.size) continue;
    const accts = new Set((st.budgetAccounts || []).filter(a => a && !a.deleted && books.has(a.bookId)).map(a => a.id));
    toTag += (st.budgetTx || []).filter(t => t && !t.deleted && accts.has(t.accountId) && !t.btxTag).length;
  }
} catch (e) {}
const openInv = (slab.quotes || []).filter(q => q && !q.deleted && q.invoiced && !q.paid);
const arOpen = openInv.length ? openInv.length + " · $" + openInv.reduce((s, q) => s + (+(q.finalPrice || q.total) || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
const text = su.standupText(agenda, { toTag: toTag, arOpen: arOpen });
console.log("[" + new Date().toISOString().slice(0, 16).replace("T", " ") + "] " + ORG + " stand-up: " + agenda.jobs.length + " job(s), " + agenda.due.length + " due, " + agenda.questions.length + " question(s), " + toTag + " to tag");
if (!LIVE) { console.log(text); process.exit(0); }
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(DIR, "ceo-config.json"), "utf8")); } catch (e) {}
if (!cfg.writeToken) { console.log("no writeToken"); process.exit(1); }
const payload = JSON.stringify({ biz: ORG, threadId: "thr_crew_broadcast", title: "Broadcast", senderLabel: "Stand-up", to: "__crew__", members: [], body: text });
const req = http.request({ host: "127.0.0.1", port: 4000, path: "/api/ceo/message", method: "POST", headers: { "content-type": "application/json", "authorization": "Bearer " + cfg.writeToken, "content-length": Buffer.byteLength(payload) } }, res => {
  let b = ""; res.on("data", c => b += c); res.on("end", () => { console.log("posted " + res.statusCode + " " + b.slice(0, 80)); process.exit(res.statusCode === 200 ? 0 : 1); });
});
req.on("error", e => { console.log("post failed: " + e.message); process.exit(1); });
req.write(payload); req.end();
