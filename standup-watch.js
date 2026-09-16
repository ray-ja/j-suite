/* standup-watch.js — wake Claude ONLY when the crew has answered every open stand-up question.
   Ray, 2026-09-16: "It should just notify you when I answer the questions, like, in a batch… not on a regular
   scheduled timer." Watches data.json (the sync server rewrites it on every /sync). Emits ONE line on stdout when
   the open set of questions (docs:standup_questions, not deleted, askAfter <= today) is fully answered and at
   least one answer has not been acked yet; then stays quiet until a NEW batch appears. Also emits one line if a
   new question is posted while the session sleeps, so nothing gets stuck. Each stdout line = one wake-up. */
const fs = require("fs"), path = require("path");
const FILE = path.join(__dirname, "data.json"), ORG = process.env.STANDUP_ORG || "obx";
function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
let lastMtime = 0, lastKey = "";
function check() {
  let st; try { st = fs.statSync(FILE); } catch (e) { return; }
  if (+st.mtimeMs === lastMtime) return; lastMtime = +st.mtimeMs;
  let d; try { d = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return; }   // mid-write → try again next tick
  const doc = (((d[ORG] || {}).docs) || []).find(x => x && x.id === "standup_questions" && !x.deleted);
  const items = (doc && Array.isArray(doc.items) ? doc.items : []).filter(q => q && q.q && !q.deleted && (!q.askAfter || q.askAfter <= today()));
  const open = items.filter(q => !q.answer), pending = items.filter(q => q.answer && !q.acked);
  const key = items.length + "|" + open.length + "|" + pending.map(q => q.id).sort().join(",");
  if (key === lastKey) return; lastKey = key;
  if (items.length && !open.length && pending.length) console.log("STANDUP ANSWERED: all " + items.length + " question(s) answered, " + pending.length + " waiting on Claude — " + pending.map(q => q.id + " → " + String(q.answer).slice(0, 80).replace(/\s+/g, " ")).join(" | "));
}
setInterval(check, 5000); check();
