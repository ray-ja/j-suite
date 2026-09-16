/* standup-tests.js — the stand-up agenda + broadcast text (js/177). Pure node. Run: node standup-tests.js */
const su = require("./js/177-standup");
let pass = 0, fail = 0; const ok = (n, c, got) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL: " + n + (got !== undefined ? "  got " + JSON.stringify(got) : "")); } };
const jobs = [
  { id: "j1", title: "Junk / move-out", date: "2026-09-16", time: "15:00", crew: ["ray", "chase"], cust: "Teri Layden", address: "97 Station 1 Ln" },
  { id: "j2", title: "Pond fill", date: "2026-09-02", workDays: ["2026-09-02", "2026-09-16"], crew: [], cust: "Christina Jamieson" },
  { id: "j3", title: "Tomorrow", date: "2026-09-17", crew: ["ray"] },
  { id: "j4", title: "Done already", date: "2026-09-16", done: true },
  { id: "j5", title: "Dump run", date: "2026-09-16", sharedJobIds: ["j1"] }
];
const todos = [
  { id: "t1", title: "Order the stone", due: "2026-09-18" }, { id: "t2", title: "Truck registration", due: "2026-08-31" },
  { id: "t3", title: "Planned for today", planDate: "2026-09-16" }, { id: "t4", title: "Done", due: "2026-09-16", done: true }, { id: "t5", title: "No date" }
];
const qs = [{ id: "q1", q: "Who is Jason in the app?" }, { id: "q2", q: "Answered one", answer: "yes" }];
const a = su.standupAgenda("2026-09-16", jobs, todos, qs, { ray: "Rj", chase: "Chase" });
ok("jobs on the day: the 3pm job and the multi-day pond, sorted by time, no done jobs, no stop-jobs, no tomorrow", a.jobs.map(j => j.id).join() === "j1,j2", a.jobs.map(j => j.id));
ok("crew names resolve; an unassigned job carries an empty crew", a.jobs[0].crew.join("+") === "Rj+Chase" && a.jobs[1].crew.length === 0);
ok("due: overdue + planned-today, not the future one, not the done one, not the undated one", a.due.map(t => t.id).join() === "t2,t3" && a.due[0].overdue === true && a.due[1].overdue === false, a.due);
ok("only unanswered questions", a.questions.length === 1 && a.questions[0].id === "q1");
const txt = su.standupText(a, { toTag: 3, arOpen: "2 · $2,085.00" });
ok("broadcast text carries the job line with time, customer and crew", /15:00 Junk \/ move-out · Teri Layden · Rj \+ Chase/.test(txt), txt);
ok("flags the unassigned job, the overdue item, the charges to tag, open invoices and the question", /nobody assigned/.test(txt) && /Truck registration \(overdue\)/.test(txt) && /3 card charges/.test(txt) && /Open invoices: 2/.test(txt) && /\? Who is Jason/.test(txt), txt);
const b = su.standupAgenda("2026-09-20", jobs, [], [], {});
ok("a quiet day says so", su.standupText(b).indexOf("No jobs on the schedule today.") > 0);
console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
