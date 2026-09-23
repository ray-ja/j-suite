/* record-search-tests.js — find anything (js/186). Pure node. */
const R = require("./js/186-record-search.js"); let n = 0, f = 0;
const eq = (a, b, m) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { f++; console.log("FAIL", m, JSON.stringify(a), "want", JSON.stringify(b)); } };
const store = {
  obx: {
    customers: [{ id: "c1", name: "Christina Jamieson", email: "cj@x.com", phone: "" }, { id: "c2", name: "Mike Renken", phone: "" }, { id: "c3", name: "Mike Green", phone: "(757) 647-2543", deleted: false }, { id: "c9", name: "Gone", deleted: true }],
    properties: [{ id: "p1", address: "1203 Swordfish Way, Kitty Hawk, NC 27949", label: "Main", customerIds: ["c2"] }, { id: "p2", address: "1115 Ocean Trail, Corolla", unit: "2A", customerIds: [] }],
    jobs: [{ id: "j1", title: "Junk / curbside pickup — hospital bed + recliner", customerId: "c2", date: "2026-09-22", poNum: 1039 }, { id: "j2", title: "Old", deleted: true }],
    quotes: [{ id: "q1", num: 40, customerId: "c2", items: [{ name: "Junk / curbside pickup" }], total: 175, paid: true, invoiced: true, date: "2026-09-22", jobId: "j1" }]
  },
  jam: { customers: [{ id: "c1", name: "Christina Jamieson" }], quotes: [{ id: "qf", num: 5, customerId: "c1", items: [{ name: "Living-room side" }], total: 6544, date: "2026-09-22" }] },
  stone: { jobs: [{ id: "js", title: "Christina — waterfall wall", customerId: "c1", customerIdX: 1 }], customers: [{ id: "c1", name: "Christina Jamieson" }], personalFiles: [{ id: "pf1", name: "RV740D-engine-service-manual.pdf", note: "skid steer engine manual", type: "application/pdf", ts: 1 }, { id: "pf2", name: "old.pdf", deleted: true }] }
};
const idx = R.recordSearchIndex(store, ["obx", "jam", "stone"]);
eq(idx.length, 3 + 2 + 1 + 1 + 1 + 1 + 1 + 1 + 1, "index counts every live row across three orgs, skips deleted");
const t = (q, orgs) => R.recordSearchRun(R.recordSearchIndex(store, orgs || ["obx", "jam", "stone"]), q).map(r => r.kind + ":" + r.org + ":" + r.id);
eq(t("manual"), ["file:stone:pf1"], "a file is found by its label");
eq(t("rv740d"), ["file:stone:pf1"], "…and by its file name");
eq(t("renken")[0], "customer:obx:c2", "a surname finds the customer first");
eq(t("renken").slice(1).sort(), ["job:obx:j1", "property:obx:p1", "quote:obx:q1"], "…then that customer's property, job and quote");
eq(t("ren"), t("renken"), "a prefix matches the same rows");
eq(t("nken"), [], "a fragment inside a word does not match");
eq(t("mike")[0], "customer:obx:c3", "title-start hits rank above later words (Mike Green before Mike Renken? no: alphabetical tie-break)");
eq(t("mike").slice(0, 2).sort(), ["customer:obx:c2", "customer:obx:c3"], "both Mikes come first");
eq(t("swordfish"), ["property:obx:p1"], "an address word finds the property");
eq(t("647-2543"), ["customer:obx:c3"], "a phone number finds the customer (digits only, punctuation ignored)");
eq(t("#5"), ["quote:jam:qf"], "a quote number finds the quote in another org");
eq(t("christina").map(x => x.split(":")[0]), ["customer", "customer", "customer", "job", "quote"], "one name across three orgs: customers, then the stone job, then the Jamieson quote");
eq(t("christina", ["obx"]), ["customer:obx:c1"], "orgs the user is not in are not searched");
eq(t("2a"), ["property:obx:p2"], "a unit number finds the property");
eq(t("hospital recliner"), ["job:obx:j1"], "every word must match");
eq(t(""), [], "empty query → nothing");
eq(t("zzz"), [], "no match → nothing");
eq(R.recordSearchRun(idx, "christina", 2).length, 2, "limit is respected");
eq(R.rsDigits("(252) 207-5985"), "2522075985", "digits helper");
console.log("=========  " + (n - f) + " passed, " + f + " failed  ========="); process.exit(f ? 1 : 0);
