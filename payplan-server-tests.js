/* payplan-server-tests.js — the server side of pay over time: email builder, sweep selection, webhook apply. Pure node. */
const S = require("./sync-server"); const P = require("./js/192-pay-plans.js"); let n = 0, f = 0;
const eq = (a, b, m) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { f++; console.log("FAIL", m, JSON.stringify(a), "want", JSON.stringify(b)); } };
const ok = (c, m) => eq(!!c, true, m);
const inst = P.ppSchedule(120000, { n: 3, unit: "month", start: "2026-10-01" });
const q = { id: "q1", invoiceToken: "tok", date: "2026-09-26", cust: "Christina Jamieson", customerId: "c1", total: 1200, plan: { status: "active", autoSend: true, installments: inst } };
const biz = { name: "OBX Lot Solutions", phone: "(252) 207-5985" };
let m = S.ppEmailBuild(q, Object.assign({}, inst[0], { link: "https://buy.stripe.com/x" }), { name: "Christina Jamieson", email: "c@x.y" }, biz, { name: "Ray" }, "https://app.jsuite.dev", "due");
ok(/^Payment 1 of 3 · \$400\.00 due 10\/01\/26 · OBX Lot Solutions$/.test(m.subject), "due subject: " + m.subject);
ok(/Hi Christina,/.test(m.html) && /buy\.stripe\.com\/x/.test(m.html) && /\/i\/tok/.test(m.html), "due body has name, pay link, hosted link");
ok(/Cash or Venmo/.test(m.text), "text version mentions cash or Venmo");
eq(m.from, "OBX Lot Solutions <invoices@mail.jsuite.dev>", "from is the brand on the verified domain");
m = S.ppEmailBuild(q, inst[0], null, biz, null, "https://app.jsuite.dev", "reminder");
ok(/^Reminder: payment 1 of 3/.test(m.subject) && /was due/.test(m.subject), "reminder subject: " + m.subject);
ok(!/Pay \$400\.00 online/.test(m.html), "no pay button when the installment has no link yet");
/* sweep selection across a store, honouring per-org config */
const store = { registry: [], users: [],
  obx: { docs: [{ id: "payPlanConfig", text: '{"daysBefore":5}' }], quotes: [q, { id: "q2", plan: { status: "active", autoSend: true, installments: P.ppSchedule(50000, { n: 2, unit: "week", start: "2026-10-20" }) } }, { id: "q3", paid: true, plan: { status: "active", installments: inst } }] },
  jam: { quotes: [{ id: "j1", plan: { status: "active", autoSend: true, installments: P.ppSchedule(30000, { n: 1, unit: "month", start: "2026-09-27" }) } }] } };
let due = S.ppDueAcross(store, "2026-09-26");
eq(due, [{ org: "obx", quoteId: "q1", n: 1, kind: "due" }, { org: "jam", quoteId: "j1", n: 1, kind: "due" }], "obx uses its 5-day lead (Oct 1 is 5 days out); jam uses the default 3 (Sep 27 is 1 day out); paid quote skipped; q2 not yet");
store.obx.quotes[0].plan.installments[0].sentAt = 1;
due = S.ppDueAcross(store, "2026-10-05");
eq(due.filter(d => d.quoteId === "q1"), [{ org: "obx", quoteId: "q1", n: 1, kind: "reminder", day: 3 }], "four days late → the 3-day reminder");
/* webhook apply */
let r = S.ppInstallmentPaidApply(store, "obx", store.obx.quotes[0], 1, 40000, "cs_1");
const q1 = r.store.obx.quotes.find(x => x.id === "q1");
eq(q1.plan.installments[0].paidCents, 40000, "installment 1 paid");
eq(q1.plan.installments[0].ref, "cs_1", "ref stored");
eq(q1.payments.length, 1, "one payment recorded");
eq(q1.payments[0].installment, 1, "payment carries the installment number");
eq(!!q1.paid, false, "invoice not paid yet");
ok(r.threadId && r.store.obx.messages.some(x => /Paid: Christina Jamieson, payment 1 of 3/.test(x.text || x.body || "")), "owner message posted");
r = S.ppInstallmentPaidApply(r.store, "obx", q1, 1, 40000, "cs_1");
eq(!!r.already, true, "same checkout id twice is idempotent");
let s2 = r.store; s2 = S.ppInstallmentPaidApply(s2, "obx", s2.obx.quotes.find(x => x.id === "q1"), 2, 40000, "cs_2").store;
r = S.ppInstallmentPaidApply(s2, "obx", s2.obx.quotes.find(x => x.id === "q1"), 3, 40000, "cs_3");
const q1b = r.store.obx.quotes.find(x => x.id === "q1");
eq(q1b.paid, true, "last installment marks the invoice paid");
eq(q1b.plan.status, "done", "plan done");
eq(q1b.payments.length, 3, "three payments on the invoice");
eq(S.ppInstallmentPaidApply(store, "obx", store.obx.quotes[0], 9, 100, "x").unmatched, true, "unknown installment → unmatched");
/* hosted page block */
const html = S.ppPageHTML({ plan: { status: "active", autoSend: true, unit: "month", installments: [Object.assign({}, inst[0], { link: "https://buy.stripe.com/a" }), inst[1], inst[2]] } }, biz);
ok(/Your payment plan/.test(html) && /Pay \$400\.00/.test(html) && /link comes by email/.test(html), "schedule shows a pay button for the linked installment and a note for the rest");
ok(/\$1,200\.00 remaining/.test(html), "remaining shown");
console.log("=========  " + (n - f) + " passed, " + f + " failed  ========="); process.exit(f ? 1 : 0);
