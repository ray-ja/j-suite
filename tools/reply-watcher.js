#!/usr/bin/env node
/* ---------- CREW REPLY WATCHER (Architecture A — dev-lane bridge over Tailscale) ----------
   Dumb, no-LLM poller of prod's CEO read endpoint + scoped writer. Content-gated: `watch` only
   prints + exits on a NEW non-CEO message (a reply/question — when Cap needs to act). Read-marker
   changes are PASSIVE (someone merely opening a thread) — tracked + surfaced in the wake payload and
   via `status`, but never a wake trigger. Empty polls are silent.
   When it exits, the dev lane is woken (harness notifies on background-task completion), relays the
   surfaced payload to Cap, posts Cap's reply with `post`, then re-arms `watch`. Separate process from
   the 5-min Dispatch build timer.

   Config (gitignored — THE SWITCH): watcher-config.json next to this repo root:
     { "prodUrl":"http://100.103.109.41:4000", "readToken":"<CEO_READ_TOKEN>", "writeToken":"<CEO_WRITE_TOKEN>", "pollMs":90000 }
   Read token = low risk (read-only). Write token = bounded (messages-only). Both gitignored on dev.

   Usage:
     node tools/reply-watcher.js watch          # poll until an event, print JSON, exit (re-arm after)
     node tools/reply-watcher.js status         # one-shot: per-user read/reply state, exit
     node tools/reply-watcher.js post <threadId>  # body on STDIN → post to prod as Cap (UTF-8 safe)
*/
const fs = require("fs"), path = require("path"), http = require("http"), https = require("https");
const ROOT = path.join(__dirname, "..");
const CFG_PATH = path.join(ROOT, "watcher-config.json");
const CURSOR_PATH = path.join(__dirname, ".reply-watcher-cursor.json");

function loadCfg() {
  let c; try { c = JSON.parse(fs.readFileSync(CFG_PATH, "utf8")); } catch (e) { die("No watcher-config.json at " + CFG_PATH + " — drop { prodUrl, readToken, writeToken } there (gitignored)."); }
  if (!c.prodUrl || !c.readToken) die("watcher-config.json needs prodUrl + readToken.");
  c.pollMs = c.pollMs || 90000;
  return c;
}
function die(m) { console.error("reply-watcher: " + m); process.exit(1); }
function loadCursor() { try { return JSON.parse(fs.readFileSync(CURSOR_PATH, "utf8")); } catch (e) { return null; } }
function saveCursor(c) { try { fs.writeFileSync(CURSOR_PATH, JSON.stringify(c)); } catch (e) {} }

function req(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), lib = u.protocol === "https:" ? https : http;
    const opts = { method, hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + u.search, headers: headers || {} };
    const r = lib.request(opts, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); });
    r.on("error", reject); r.setTimeout(15000, () => r.destroy(new Error("timeout")));
    if (body) r.write(body); r.end();
  });
}
async function fetchThreads(cfg) {
  const r = await req("GET", cfg.prodUrl.replace(/\/+$/, "") + "/api/ceo?view=messages", { Authorization: "Bearer " + cfg.readToken });
  if (r.status !== 200) throw new Error("read endpoint HTTP " + r.status + " " + r.body.slice(0, 120));
  return (JSON.parse(r.body).threads) || [];
}
/* per-user state in a thread: replied | read-no-reply | unread  (relative to Cap's last message) */
function readState(t) {
  const msgs = (t.messages || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const capLast = msgs.filter(m => m.senderId === "__ceo__").slice(-1)[0];
  const capTs = capLast ? capLast.ts : 0;
  const out = [];
  (t.members || []).forEach(uid => {
    const reads = (t.reads || []).find(x => x.userId === uid);
    const lastRead = reads ? reads.lastReadTs : 0;
    const name = (reads && reads.name) || uid;
    const repliedAfter = msgs.some(m => m.senderId === uid && (m.ts || 0) > capTs);
    let status = "unread";
    if (repliedAfter) status = "replied";
    else if (capTs && lastRead >= capTs) status = "read-no-reply";
    else if (!capTs) status = "—";
    out.push({ userId: uid, name, status, lastReadTs: lastRead });
  });
  return out;
}
function snapshot(threads) {
  const seen = {}, states = {};
  threads.forEach(t => {
    (t.messages || []).forEach(m => { if (m.senderId !== "__ceo__") seen[m.id] = 1; });
    readState(t).forEach(s => { states[t.threadId + ":" + s.userId] = s.status; });
  });
  return { seen, states };
}
function detect(prev, threads) {
  prev = prev || { seen: {}, states: {} };
  const newMsgs = [], readChanges = [];
  threads.forEach(t => {
    (t.messages || []).forEach(m => {
      if (m.senderId !== "__ceo__" && !prev.seen[m.id]) newMsgs.push({ thread: t.title, threadId: t.threadId, by: m.senderLabel, body: m.body, ts: m.ts });
    });
    readState(t).forEach(s => {
      const k = t.threadId + ":" + s.userId, was = prev.states[k];
      if (was !== undefined && was !== s.status) readChanges.push({ thread: t.title, name: s.name, from: was, to: s.status });
    });
  });
  return { newMsgs, readChanges };
}

async function cmdWatch() {
  const cfg = loadCfg();
  const maxPolls = cfg.maxPolls || 160;   // ~4h at 90s, then exit "idle" (re-armable)
  for (let i = 0; i < maxPolls; i++) {
    let threads;
    try { threads = await fetchThreads(cfg); } catch (e) { await sleep(cfg.pollMs); continue; }   // network blip → keep looping
    const cursor = loadCursor();
    const ev = detect(cursor, threads);
    if (ev.newMsgs.length) {   // wake ONLY on new non-CEO messages; read-marker changes are surfaced (below) but never wake Cap
      saveCursor(snapshot(threads));
      console.log(JSON.stringify({ event: true, at: Date.now(), newMessages: ev.newMsgs, state: threads.map(t => ({ thread: t.title, threadId: t.threadId, reads: readState(t) })) }, null, 1));
      return;   // wake the dev lane
    }
    saveCursor(snapshot(threads));   // baseline + track read-state (for status / future read-no-reply alert); stay silent on passive opens
    await sleep(cfg.pollMs);
  }
  console.log(JSON.stringify({ event: false, idle: true, at: Date.now() }));
}
async function cmdStatus() {
  const cfg = loadCfg(); const threads = await fetchThreads(cfg);
  console.log(JSON.stringify(threads.map(t => ({ thread: t.title, threadId: t.threadId, reads: readState(t), lastMsgs: (t.messages || []).slice(-3).map(m => (m.senderLabel || "?") + ": " + (m.body || "").slice(0, 60)) })), null, 1));
}
async function cmdPost(threadId) {
  const cfg = loadCfg();
  if (!cfg.writeToken) die("watcher-config.json needs writeToken to post.");
  let body = ""; process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) body += chunk;
  body = body.replace(/\n+$/, "");
  if (!body) die("empty body on stdin.");
  const payload = JSON.stringify(threadId ? { threadId, senderLabel: "Cap", body } : { title: "Cap", senderLabel: "Cap", body });
  const r = await req("POST", cfg.prodUrl.replace(/\/+$/, "") + "/api/ceo/message", { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), Authorization: "Bearer " + cfg.writeToken }, payload);
  console.log("POST " + r.status + " " + r.body);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const [cmd, arg] = process.argv.slice(2);
if (cmd === "watch") cmdWatch();
else if (cmd === "status") cmdStatus().catch(e => die(e.message));
else if (cmd === "post") cmdPost(arg).catch(e => die(e.message));
else die("usage: reply-watcher.js watch|status|post <threadId>");
