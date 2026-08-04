/* org-portability-tests.js — export / import / delete a whole organization.
   Ray, 2026-08-04: "so are all the organizations separate folders i can move / delete? thats how it should be,
   totally self contained and portable."

   This touches the one unrecoverable surface in the system, so the assertions below are mostly about what must
   NOT happen: an import must never touch a sibling org, a delete must never remove an account or a photo that
   another org still uses, and a round trip must be lossless to the record.
   Pure node. Run: node org-portability-tests.js */
const sv = require("./sync-server.js");
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (x ? "  -> " + x : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }
const clone = o => JSON.parse(JSON.stringify(o));

/* two orgs that SHARE a person (Chase) — the case that makes literal per-org folders wrong */
function store() {
  return {
    registry: [{ id: "obx", name: "OBX Lot Solutions", updatedAt: 10 }, { id: "per", name: "RBJVL", updatedAt: 10 }],
    users: [
      { id: "u_ray", username: "Rj", superAdmin: true, updatedAt: 1 },
      { id: "u_chase", username: "Chase", updatedAt: 1 },
      { id: "u_only", username: "OnlyPersonal", updatedAt: 1 },
      { id: "m1", kind: "membership", accountId: "u_ray", orgId: "obx", role: "owner", updatedAt: 1 },
      { id: "m2", kind: "membership", accountId: "u_chase", orgId: "obx", role: "crew", updatedAt: 1 },
      { id: "m3", kind: "membership", accountId: "u_ray", orgId: "per", role: "owner", updatedAt: 1 },
      { id: "m4", kind: "membership", accountId: "u_only", orgId: "per", role: "crew", updatedAt: 1 }
    ],
    obx: {
      customers: [{ id: "c1", name: "Mike Green", updatedAt: 5 }],
      quotes: [{ id: "q1", cust: "Mike Green", total: 2324, updatedAt: 5 }],
      receipts: [{ id: "r1", receiptId: "shared.jpg", updatedAt: 5 }, { id: "r2", receiptId: "obxonly.jpg", updatedAt: 5 }],
      messages: [{ id: "msg1", attachments: [{ id: "att-obx.png" }], updatedAt: 5 }]
    },
    per: {
      lifeNotes: [{ id: "n1", body: "a private entry", updatedAt: 5 }],
      shelfItems: [{ id: "shf_1", title: "The Great Transformation", updatedAt: 5 }],
      budgetTx: [{ id: "t1", amount: 40, receiptId: "shared.jpg", updatedAt: 5 }],
      siteSurveys: [{ id: "s1", photoIds: ["per-photo.jpg"], updatedAt: 5 }]
    }
  };
}

console.log("\n--- blob ids are DERIVED from the records (nothing on disk says which org owns a photo) ---");
{
  const s = store();
  const obx = sv.orgBlobIds(s.obx).sort();
  eq("obx blobs found", JSON.stringify(obx), JSON.stringify(["att-obx.png", "obxonly.jpg", "shared.jpg"]));
  ok("...including one inside attachments[]", obx.indexOf("att-obx.png") >= 0);
  const per = sv.orgBlobIds(s.per).sort();
  eq("personal blobs found", JSON.stringify(per), JSON.stringify(["per-photo.jpg", "shared.jpg"]));
  ok("...including one inside photoIds[]", per.indexOf("per-photo.jpg") >= 0);
  eq("an empty slab yields nothing", sv.orgBlobIds({}).length, 0);
  eq("a path-looking value is rejected", sv.orgBlobIds({ a: [{ receiptId: "../../etc/passwd" }] }).length, 0);
}

console.log("\n--- EXPORT is self-contained ---");
{
  const b = sv.orgExportBundle(store(), "per");
  eq("it names the org", b.orgId, "per");
  ok("it carries the registry entry", !!b.registry && b.registry.name === "RBJVL");
  ok("it carries the slab", b.slab.lifeNotes.length === 1 && b.slab.shelfItems.length === 1);
  ok("it carries the people in that org", b.accounts.map(a => a.id).sort().join(",") === "u_only,u_ray");
  ok("it does NOT carry a person who isn't in it", !b.accounts.some(a => a.id === "u_chase"));
  eq("memberships are scoped to this org only", b.memberships.length, 2);
  ok("...and none of them point elsewhere", b.memberships.every(m => m.orgId === "per"));
  ok("it lists its photos", b.blobIds.indexOf("per-photo.jpg") >= 0);
  ok("NO other org's data is present", JSON.stringify(b).indexOf("Mike Green") < 0);
  eq("an unknown org exports nothing", sv.orgExportBundle(store(), "nope"), null);
}

console.log("\n--- ROUND TRIP is lossless ---");
{
  const b = sv.orgExportBundle(store(), "per");
  const empty = { registry: [], users: [], obx: clone(store().obx) };
  const r = sv.orgImportApply(empty, clone(b), {});
  ok("import succeeds", r.report.ok, r.report.error);
  eq("the org is back", r.store.per.lifeNotes.length, 1);
  eq("...with its journal text intact", r.store.per.lifeNotes[0].body, "a private entry");
  eq("...and its shelf", r.store.per.shelfItems[0].title, "The Great Transformation");
  eq("...and its survey photos", JSON.stringify(r.store.per.siteSurveys[0].photoIds), JSON.stringify(["per-photo.jpg"]));
  eq("the registry entry is restored", (r.store.registry.find(x => x.id === "per") || {}).name, "RBJVL");
  eq("the accounts came with it", r.store.users.filter(u => !u.kind).length, 2);
  eq("the memberships came with it", r.store.users.filter(u => u.kind === "membership").length, 2);
  ok("THE SIBLING ORG IS UNTOUCHED", r.store.obx.customers[0].name === "Mike Green" && r.store.obx.quotes.length === 1);
}

console.log("\n--- IMPORT can never quietly destroy ---");
{
  const s = store();
  s.per.lifeNotes.push({ id: "n2", body: "written AFTER the export", updatedAt: 99 });
  const b = sv.orgExportBundle(store(), "per");        // an OLDER bundle, without n2
  const r = sv.orgImportApply(s, clone(b), {});
  eq("a newer record present locally survives an older import", r.store.per.lifeNotes.length, 2);
  ok("...and keeps its newer text", r.store.per.lifeNotes.some(n => n.body === "written AFTER the export"));

  const skip = sv.orgImportApply(store(), clone(b), { mode: "skip" });
  ok("mode:skip refuses to touch an existing org", !skip.report.ok && /already exists/.test(skip.report.error));
  ok("...and reports that it existed", skip.report.existed);

  const junk = sv.orgImportApply(store(), { hello: "world" }, {});
  ok("a non-export file is rejected", !junk.report.ok && /not a j-Suite org export/.test(junk.report.error));
  ok("...leaving the store alone", junk.store.obx.customers.length === 1);

  /* a doctored bundle must not be able to grant access to a different org */
  const evil = clone(b);
  evil.memberships.push({ id: "evil", kind: "membership", accountId: "u_only", orgId: "obx", role: "owner", updatedAt: 999 });
  const er = sv.orgImportApply(store(), evil, {});
  ok("a membership for ANOTHER org is stripped from an import",
    !er.store.users.some(u => u && u.kind === "membership" && u.id === "evil"));
}

console.log("\n--- DELETE removes the org and nothing else ---");
{
  const r = sv.orgDeleteApply(store(), "per");
  ok("it succeeds", r.report.ok, r.report.error);
  ok("the org slab is gone", !r.store.per);
  ok("its registry entry is gone", !r.store.registry.some(x => x.id === "per"));
  eq("its memberships are gone", r.store.users.filter(u => u.kind === "membership" && u.orgId === "per").length, 0);
  ok("the OTHER org's memberships survive", r.store.users.some(u => u.kind === "membership" && u.orgId === "obx"));

  /* the rule that matters most: a person is not a possession of one org */
  ok("NO account record is deleted — Ray is in both orgs", r.store.users.some(u => u.id === "u_ray" && !u.kind));
  ok("...not even an account that was ONLY in the deleted org", r.store.users.some(u => u.id === "u_only" && !u.kind));

  eq("only photos nobody else uses are listed for deletion", JSON.stringify(r.blobsToDelete), JSON.stringify(["per-photo.jpg"]));
  ok("the SHARED photo is NOT deleted (obx still references it)", r.blobsToDelete.indexOf("shared.jpg") < 0);
  eq("the count matches", r.report.blobs, 1);

  ok("the sibling org is completely intact", r.store.obx.customers[0].name === "Mike Green");
}

console.log("\n--- DELETE refuses the dangerous cases ---");
{
  const one = { registry: [{ id: "solo", name: "Only" }], users: [], solo: { customers: [] } };
  const r = sv.orgDeleteApply(one, "solo");
  ok("it will not delete the last organization", !r.report.ok && /only organization/.test(r.report.error));
  ok("...and the store is unchanged", !!r.store.solo);
  const missing = sv.orgDeleteApply(store(), "nope");
  ok("an unknown org is refused", !missing.report.ok && /no such organization/.test(missing.report.error));
}

console.log("\n--- the endpoints are locked down ---");
{
  const SRC = require("fs").readFileSync(require("path").join(__dirname, "sync-server.js"), "utf8");
  ["/api/org/export", "/api/org/import", "/api/org/delete", "/api/org/exports"].forEach(r => {
    const i = SRC.indexOf('"' + r + '"');
    ok("route " + r + " exists", i > 0);
    ok("...and is super-admin gated", SRC.slice(i, i + 700).indexOf("sc.superAdmin") > 0);
  });
  ok("delete ALWAYS exports first", /let backup = null;[\s\S]{0,220}orgExportToDisk\(store, org, true\)/.test(SRC));
  ok("...and refuses if that backup fails", /refused: could not take a backup first/.test(SRC));
  ok("delete requires the org NAME typed to confirm", /type the organization name exactly to confirm/.test(SRC));
  ok("import resolves paths inside the export dir only", /dir\.startsWith\(path\.resolve\(ORG_EXPORT_DIR\) \+ path\.sep\)/.test(SRC));
  ok("blob deletion is confined to uploads/", /full\.startsWith\(path\.join\(__dirname, "uploads"\) \+ path\.sep\)/.test(SRC));
  ok("import never overwrites an existing photo", /if \(!fs\.existsSync\(dest\)\)/.test(SRC));
}

console.log("\n--- the UI is gated and wired ---");
{
  const fs2 = require("fs"), path2 = require("path");
  const UI = fs2.readFileSync(path2.join(__dirname, "js", "124-org-portability.js"), "utf8");
  ok("registered in the shell",
    fs2.readFileSync(path2.join(__dirname, "Business App (v1).html"), "utf8").indexOf('src="js/124-org-portability.js"') > 0);
  ok("the card renders on Settings",
    fs2.readFileSync(path2.join(__dirname, "js", "26-deep-quote-rate-editor-every.js"), "utf8").indexOf("orgpCardHTML()") > 0);
  ok("it is super-admin gated client-side too", /isSuperAdmin\(\)/.test(UI));
  ok("...and renders NOTHING when not permitted", /if \(!orgpCan\(\)\) return "";/.test(UI));
  ok("delete asks for the NAME, not just an OK", /Type the organization's name exactly to confirm/.test(UI));
  ok("...and checks it locally before even calling", /String\(typed\)\.trim\(\) !== String\(name\)\.trim\(\)/.test(UI));
  ok("delete tells him a backup was taken", /A full copy was saved first/.test(UI));
  ok("import warns that it merges, never removes", /never removes any/.test(UI));
}

console.log("\n--- exports must never reach git ---");
ok("org-exports/ is gitignored",
  /^org-exports\/$/m.test(require("fs").readFileSync(require("path").join(__dirname, ".gitignore"), "utf8")));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
