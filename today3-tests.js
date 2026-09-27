/* today3-tests.js — Today, one question (js/199): column classification, type marks, money sums, the strip. Pure node. */
const T = require("./js/199-today.js"); let n = 0, f = 0;
const eq = (a, b, m) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { f++; console.log("FAIL", m, JSON.stringify(a), "want", JSON.stringify(b)); } };
/* columns */
eq(T.t3Col("📥 Approvals"), "needs", "approvals need you");
eq(T.t3Col("📞 Follow-ups"), "needs", "follow-ups need you");
eq(T.t3Col("✅ Top to-dos"), "needs", "to-dos need you");
eq(T.t3Col("🛠 Equipment service"), "needs", "service needs you");
eq(T.t3Col("⏳ Payment plans"), "needs", "a plan due needs you");
eq(T.t3Col("🧽 2 items need cleaning"), "needs", "the cleaning nudge needs you");
eq(T.t3Col("⏳ Awaiting payment"), "money", "money");
eq(T.t3Col("📝 Open quotes"), "money", "money");
eq(T.t3Col("🔧 Confirmed jobs"), "money", "the booked pipeline is money");
eq(T.t3Col("💵 Payouts"), "money", "money");
eq(T.t3Col("📅 Today's jobs"), "day", "the day");
eq(T.t3Col("👥 Who's working today"), "day", "the day");
eq(T.t3Col("⏱️ Clock in"), "day", "the day");
eq(T.t3Col("🧭 Stand-up · 9:00"), "day", "the day");
eq(T.t3Col("🧭 Cap"), "day", "the day");
eq(T.t3Col("📣 Ads"), "day", "the day");
eq(T.t3Col(""), "day", "unknown → the day");
/* money order */
eq(["💵 Payouts", "📝 Open quotes", "⏳ Awaiting payment", "🔧 Confirmed jobs", "📤 Invoices to send"].sort((a, b) => T.t3MoneyRank(a) - T.t3MoneyRank(b)), ["⏳ Awaiting payment", "📤 Invoices to send", "🔧 Confirmed jobs", "📝 Open quotes", "💵 Payouts"], "owed first, paid out last");
eq(T.t3MoneyRank("something else"), 5, "unknown sinks to the end");
/* marks */
eq(T.t3Icon("📥 Approvals"), "📥", "leading emoji");
eq(T.t3Icon("🛠 Equipment service"), "🛠", "a one-codepoint emoji");
eq(T.t3Icon("⏱️ Clock in"), "⏱️", "keeps the variation selector");
eq(T.t3Icon("Approvals"), "•", "no emoji → a dot");
eq(T.t3Icon(""), "•", "empty → a dot");
/* money */
eq(T.t3Money(["$15", "$1,770", "$375", "$175", "$2,235"]), 4570, "sums the rows");
eq(T.t3Money(["$538.00 due", "nothing"]), 538, "reads the first dollar figure in a string");
eq(T.t3Money([]), 0, "empty");
eq(T.t3Fmt(4570), "$4,570", "whole dollars");
eq(T.t3Fmt(538.5), "$538.50", "cents when there are any");
/* the strip */
eq(T.t3Chips({ needs: 3, owed: 4570, owedN: 7, jobs: 0 }).map(c => c.text), ["3 need you", "$4,570 owed · 7 invoices", "No jobs today"], "a normal morning");
eq(T.t3Chips({ needs: 1, owed: 15, owedN: 1, jobs: 2 }).map(c => c.text), ["1 needs you", "$15 owed · 1 invoice", "2 jobs today"], "singulars");
eq(T.t3Chips({ needs: 0, owedN: 0, jobs: 0 }).map(c => c.text), ["Nothing needs you", "No jobs today"], "quiet: no money chip when nothing is owed");
eq(T.t3Chips({ needs: 0, owedN: 0, jobs: 1, clockedIn: "since 9:12 AM" }).map(c => c.text), ["Nothing needs you", "Clocked in · since 9:12 AM"], "clocked in replaces the jobs chip");
eq(T.t3Chips({ needs: 2 })[0].hot, true, "needs is hot when there is something");
eq(T.t3Chips({ needs: 0 })[0].hot, false, "…and not when quiet");
console.log("=========  " + (n - f) + " passed, " + f + " failed  ========="); process.exit(f ? 1 : 0);
