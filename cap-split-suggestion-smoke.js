/* CLIENT ASSERT (run: node verify-app.js "$(cat cap-split-suggestion-smoke.js)") —
 * Cap SPLIT SUGGESTION apply path (js/87 rcptApplySuggestion + js/92 rcptSplitStartFromSuggestion):
 *   (a) a suggestion with ≥2 balanced splits OPENS the split editor pre-filled with N balanced rows (owner then Saves);
 *   (b) a suggestion with NO splits leaves the single-categorization path (split editor stays closed).
 * Cap proposes, the owner confirms — the apply NEVER commits (no save/record write here). */
window.alert = function () {}; window.confirm = function () { return true; };

// sign in an OWNER so rcptFinFull() (finance-full) is true
var u = { id: "u_capsplit_test", username: "CapSplit", active: true };
S.users = S.users || []; S.users.push(u);
if (typeof orgSetRole === "function") orgSetRole("u_capsplit_test", "obx", "owner");
localStorage.setItem("jra_session", "u_capsplit_test");
localStorage.setItem("jra_offline_ok", "1");
S.biz = "obx";

var d = D();
d.jobs = d.jobs || []; d.jobs.push({ id: "j_capsplit", title: "Split Job", date: today(), crew: ["u_capsplit_test"], done: false, updatedAt: now() });

function seedReceipt(suggested) {
  var d = D(); d.receipts = d.receipts || [];
  d.receipts = d.receipts.filter(function (r) { return r && r.id !== "rc_capsplit"; });
  d.receipts.push({ id: "rc_capsplit", receiptId: null, amount: 200, vendor: "Home Depot", date: today(),
    type: null, status: "review", suggested: suggested, uploadedBy: "u_capsplit_test", ts: now(), deleted: false, updatedAt: now() });
}

// ---- (a) a 2-bucket balanced split → editor opens with 2 pre-filled balanced rows ----
seedReceipt({ vendor: "Home Depot", amount: 200, type: "pass-through", category: "materials", jobId: "j_capsplit",
  last4: null, refund: false, deposit: false, confidence: 0.9,
  splits: [{ amount: 120, type: "pass-through", category: "materials", note: "pavers" },
           { amount: 80, type: "business", category: "tools/equipment", note: "tamper" }] });
RCPT_SPLIT = null;
rcptEditOpen("review", "", "rc_capsplit");
rcptApplySuggestion();
if (!RCPT_SPLIT) throw new Error("split suggestion did NOT open the split editor");
if (RCPT_SPLIT.rows.length !== 2) throw new Error("expected 2 pre-filled split rows, got " + RCPT_SPLIT.rows.length);
var sum = RCPT_SPLIT.rows.reduce(function (s, r) { return s + (parseFloat(r.amount) || 0); }, 0);
if (Math.abs(sum - RCPT_SPLIT.total) > 0.01) throw new Error("pre-filled rows not balanced: " + sum + " vs " + RCPT_SPLIT.total);
if (RCPT_SPLIT.rows[0].bucket !== "pass-through" || RCPT_SPLIT.rows[1].bucket !== "business") throw new Error("bucket mapping wrong: " + JSON.stringify(RCPT_SPLIT.rows.map(function (r) { return r.bucket; })));
if (RCPT_SPLIT.rows[0].jobId !== "j_capsplit") throw new Error("🧱 row not pre-seeded with suggested job");
if (!document.getElementById("rcpt_split_ind")) throw new Error("split editor DOM (indicator) not rendered");
diag("split-apply: editor opened with 2 balanced rows (" + sum + " of " + RCPT_SPLIT.total + "), buckets pass-through+business, job pre-seeded");

// ---- (b) a no-split suggestion → single-categorization, editor stays closed ----
seedReceipt({ vendor: "Lowe's", amount: 60, type: "pass-through", category: "materials", jobId: "j_capsplit",
  last4: null, refund: false, deposit: false, confidence: 0.8, splits: [] });
RCPT_SPLIT = null;
rcptEditOpen("review", "", "rc_capsplit");
rcptApplySuggestion();
if (RCPT_SPLIT) throw new Error("a no-split suggestion wrongly opened the split editor");
if ((val("rcpt_type") || "") !== "pass-through") throw new Error("single-categorization type not applied");
diag("no-split suggestion: single-categorization applied (type=pass-through), split editor stayed closed");
