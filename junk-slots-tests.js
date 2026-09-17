/* junk-slots-tests.js — Tue/Thu 9·12·3 junk slots (js/179). Pure node. */
const S = require("./js/179-junk-slots"); let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL: " + n + (got !== undefined ? "  got " + JSON.stringify(got) : "")); } };
const jobs = [{ id: "a", title: "Junk haul", date: "2026-09-22", time: "09:00" }, { id: "b", title: "Done one", date: "2026-09-22", time: "12:00", done: true }, { id: "c", title: "Pond", date: "2026-09-24", workDays: ["2026-09-24"], time: "15:00" }];
const s = S.junkSlotsNext("2026-09-17", jobs, 9);   // Thu Sep 17
ok("first slot is today's Thursday 9 am, then noon and 3, then next Tuesday", s[0].date === "2026-09-17" && s[0].time === "09:00" && s[2].time === "15:00" && s[3].date === "2026-09-22" && s[3].day === "Tue", s.slice(0, 4));
ok("only Tuesdays and Thursdays ever appear", s.every(x => x.day === "Tue" || x.day === "Thu"));
ok("a live job takes its slot; a done job does not; a multi-day job's work day counts", s.find(x => x.date === "2026-09-22" && x.time === "09:00").taken === true && s.find(x => x.date === "2026-09-22" && x.time === "12:00").taken === false && s.find(x => x.date === "2026-09-24" && x.time === "15:00").taken === true, s);
ok("valid: Tue 9 / Thu 3 / Tue no time · invalid: Wed 9, Tue 10:30, Sat", S.junkSlotIsValid("2026-09-22", "09:00") && S.junkSlotIsValid("2026-09-24", "15:00") && S.junkSlotIsValid("2026-09-22", "") && !S.junkSlotIsValid("2026-09-23", "09:00") && !S.junkSlotIsValid("2026-09-22", "10:30") && !S.junkSlotIsValid("2026-09-19", "09:00"));
ok("labels read like a text message", S.junkSlotLabel(s[0]) === "Thu 9/17 9 am" && S.junkSlotLabel(s[1]) === "Thu 9/17 noon" && S.junkSlotLabel(s[2]) === "Thu 9/17 3 pm", [S.junkSlotLabel(s[0]), S.junkSlotLabel(s[1]), S.junkSlotLabel(s[2])]);
ok("junk detection: title fallback and non-junk", S.junkSlotJobIsJunk({ title: "Junk / move-out — 12 items" }) && S.junkSlotJobIsJunk({ title: "Garage cleanout" }) && !S.junkSlotJobIsJunk({ title: "Pond removal & fill-in" }));
console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
