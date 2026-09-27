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
/* urgency */
eq(T.t3Urgency("📥 Approvals", "Learned from a job note · Cap wants your okay"), 0, "approvals first: Cap is waiting");
eq(T.t3Urgency("✅ Top to-dos", "Skid steer … ⚠ overdue · due 09/19/26"), 1, "overdue next");
eq(T.t3Urgency("🛠 Equipment service", "Engine oil change 2 h overdue"), 1, "service overdue is overdue");
eq(T.t3Urgency("📞 Follow-ups", "Maria · follow up today"), 2, "due today");
eq(T.t3Urgency("📞 Follow-ups", "CarlosHeiff · no date"), 4, "undated sinks");
eq(T.t3Urgency("🛠 Equipment service", "0 h on the meter · set the hour meter"), 4, "housekeeping sinks");
eq(T.t3Urgency("✅ Top to-dos", "Waterfall tile decision · due 10/02/26"), 3, "dated, not yet due");
/* the row menu */
eq(T.t3Actions("✅ Top to-dos"), ["tomorrow", "week", "low", "delete"], "a to-do can be pushed, downgraded or deleted");
eq(T.t3Actions("📞 Follow-ups"), ["tomorrow", "week", "delete"], "a lead can be pushed or deleted (spam)");
eq(T.t3Actions("📥 Approvals"), [], "approvals keep their own ✓ ✕");
eq(T.t3Actions("🛠 Equipment service"), [], "service rows keep Done ✓");
eq(T.t3Shift("2026-09-27", 1), "2026-09-28", "tomorrow");
eq(T.t3Shift("2026-09-27", 7), "2026-10-04", "next week crosses the month");
eq(T.t3Shift("", 1).length, 10, "no date → from today");
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
eq(T.t3Chips({ needs: 3, owed: 4570, owedN: 7, jobs: 0 }).map(c => c.text), ["3 need you", "$4,570 owed · 7 invoices"], "a normal morning: the day's numbers live on the day row, not here");
eq(T.t3Chips({ needs: 1, owed: 15, owedN: 1, jobs: 2 }).map(c => c.text), ["1 needs you", "$15 owed · 1 invoice"], "singulars");
eq(T.t3Chips({ needs: 0, owedN: 0, jobs: 0 }).map(c => c.text), ["Nothing needs you"], "quiet: no money chip when nothing is owed");
/* succinct titles */
eq(T.t3Split("Skid steer arrives this week: finish Christina Jamieson pond fill (quote #31), then invoice the pond + junk haul #2 ($375) together"), { head: "Skid steer arrives this week", rest: "finish Christina Jamieson pond fill (quote #31), then invoice the pond + junk haul #2 ($375) together" }, "cut at the colon");
eq(T.t3Split("Follow up Maria Schiavello (KDH fridge) if no reply: \"Still want that fridge gone Tuesday? I can hold the 9am.\""), { head: "Follow up Maria Schiavello (KDH fridge) if no reply", rest: "\"Still want that fridge gone Tuesday? I can hold the 9am.\"" }, "cut at the colon, keeps the quote");
eq(T.t3Split("Google Local Services: in the Leads inbox, fill the Feedback Survey on the Mexican-restaurant dumpster call").head, "Google Local Services", "a short head before the colon");
eq(T.t3Split("Fix the lawnmower and mow"), { head: "Fix the lawnmower and mow", rest: "" }, "short titles stay whole");
eq(T.t3Split("Waterfall #33, tile decision, tile as its own line at cost versus leave the price and ask Sally").head.length <= 57, true, "no break → word boundary with an ellipsis");
eq(T.t3Strip("📞 Text 9/19 9:50am: one refrigerator"), "Text 9/19 9:50am: one refrigerator", "leading phone stripped");
eq(T.t3Strip("⚠️ Engine oil change"), "Engine oil change", "leading warning stripped");
eq(T.t3Strip("Engine oil change"), "Engine oil change", "nothing to strip");
/* who's working */
eq(T.t3Working(["Not confirmed", "Not confirmed", "Not confirmed"]), 0, "nobody confirmed = 0 working");
eq(T.t3Working(["Available all day", "Off", "Part of day", "Not confirmed"]), 2, "available + part of day count; off and unconfirmed do not");
eq(T.t3Working([]), 0, "empty");
eq(T.t3Chips({ needs: 2 })[0].hot, true, "needs is hot when there is something");
eq(T.t3Chips({ needs: 0 })[0].hot, false, "…and not when quiet");
console.log("=========  " + (n - f) + " passed, " + f + " failed  ========="); process.exit(f ? 1 : 0);
