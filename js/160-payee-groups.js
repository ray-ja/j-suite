/* ---------- PAYEE GROUPS (js/160) — 332 rows are not 332 decisions ---------------------------------------
   Ray, 2026-08-27, after connecting seven banks: "now that you have data, make sure the app is built to
   handle it."

   ⚠️ THE FIRST PULL BROUGHT 332 ROWS AND THE REVIEW SCREEN OFFERED HIM 276 SEPARATE DECISIONS. Bulk approval
   existed, but only for rows the ledger already RECOGNISED — a transfer, a card payment, a payee it had seen
   before. On a first sync it has seen nothing, so the memo table is empty and the bulk path is empty with it.
   The screen was built for the steady state and met him on day one.

   ⭐ BUT THE ROWS ARE NOT 276 DIFFERENT THINGS. Measured on his actual pull: Amazon ×27 · Target ×20 ·
   The Home Depot ×18 · Lowe's ×11 · Vulcan Mideast ×10. Grouping by payee turns the pile into roughly forty
   decisions, and each one is a BETTER decision than the row-at-a-time version because he is looking at the
   whole relationship — every Amazon charge, the count, the total — instead of one $23.13 line in isolation.

   ⭐⭐ AND ONE DECISION PER PAYEE TEACHES ONE RULE. The group key is ledgerKey() — the exact same key the
   learning table (budgetMemo) is written under and looked up by. That is deliberate: categorise a group
   today and the NEXT sync recognises those rows before he ever sees them, so this screen shrinks every time
   it is used. A grouping keyed on anything else would look identical and teach nothing.

   ⛔ NO "APPROVE EVERYTHING". The point is one considered decision per payee, not a single button that
   buries 276 unexamined rows in the books. A group can also be opened and individual rows excluded, because
   "Amazon" is genuinely three different things and he is the one who knows which. */

var PG_OPEN = {};        // payee key -> expanded?
var PG_PICK = {};        // payee key -> chosen category (before approving)
var PG_SKIP = {};        // tx id -> excluded from its group

function pgKey(t) {
  try { return (typeof ledgerKey === "function") ? ledgerKey(t.note || "") : String(t.note || "").toLowerCase(); }
  catch (e) { return String(t.note || "").toLowerCase(); }
}
function pgLabel(t) {
  try { return (typeof lrName === "function") ? lrName(t) : (t.note || "Payee"); }
  catch (e) { return t.note || "Payee"; }
}
function pgMoney(n) { try { return (typeof money === "function") ? money(n) : "$" + (+n || 0).toFixed(2); } catch (e) { return "$" + n; } }

/* ⛔ ONLY the rows the ledger could not place. Transfers, card payments and already-known payees have their
   own group upstairs with its own reason for being safe — pulling them in here would mix "I recognise this"
   with "you tell me", which is the distinction the whole review screen is built on. */
function pgUnknownRows() {
  var inbox = (typeof ledgerInbox === "function") ? ledgerInbox() : [];
  return inbox.filter(function (t) {
    return !(typeof lrRecognized === "function" ? lrRecognized(t) : (t.suggestTransfer || t.suggestCardPayment));
  });
}

/* payee -> {key, label, rows, out, in, n, first, last, mixed}. Sorted by MONEY, not by count: a single
   $3,750 ACH deserves his attention before twenty-seven $57 Amazon orders. */
function pgGroups() {
  var by = {};
  pgUnknownRows().forEach(function (t) {
    var k = pgKey(t);
    if (!k) k = "(blank)";
    var g = by[k] || (by[k] = { key: k, label: pgLabel(t), rows: [], out: 0, in: 0, first: "", last: "" });
    g.rows.push(t);
    if ((t.dir || "out") === "out") g.out += (+t.amount || 0); else g.in += (+t.amount || 0);
    var d = String(t.date || "");
    if (d && (!g.first || d < g.first)) g.first = d;
    if (d && (!g.last || d > g.last)) g.last = d;
  });
  return Object.keys(by).map(function (k) {
    var g = by[k];
    g.n = g.rows.length;
    g.total = g.out + g.in;
    g.mixed = g.out > 0 && g.in > 0;    // refunds sit alongside purchases — worth saying out loud
    return g;
  }).sort(function (a, b) { return b.total - a.total; });
}

function pgCatOptions(key) {
  var cats = [];
  try { cats = (D().budgetCats || []).filter(function (c) { return c && !c.deleted; }); } catch (e) {}
  var sel = PG_PICK[key] || "";
  return '<option value="">— pick a category —</option>'
    + cats.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (sel === c.id ? " selected" : "") + '>' + esc(c.name) + '</option>';
      }).join("");
}

function pgGroupHTML(g) {
  var open = !!PG_OPEN[g.key];
  var picked = PG_PICK[g.key] || "";
  var live = g.rows.filter(function (t) { return !PG_SKIP[t.id]; });
  var h = '<div class="card" style="margin-bottom:8px">'
    + '<div class="row" style="gap:8px;align-items:baseline">'
    +   '<div class="grow" style="min-width:0">'
    +     '<div class="nm" style="font-size:15px">' + esc(g.label) + '</div>'
    +     '<div class="sub" style="font-variant-numeric:tabular-nums">' + g.n + ' transaction' + (g.n === 1 ? '' : 's')
    +       ' · ' + (g.out ? pgMoney(g.out) + ' out' : '') + (g.mixed ? ' · ' : '') + (g.in ? pgMoney(g.in) + ' in' : '')
    +       (g.first ? ' · ' + esc(g.first) + (g.last !== g.first ? ' → ' + esc(g.last) : '') : '')
    +     '</div>'
    +   '</div>'
    + '</div>';

  /* ⚠️ a payee with money going BOTH ways is usually purchases plus a refund. Both are the same category,
     so the group still works — but he should be told, not left to notice. */
  if (g.mixed) {
    h += '<div class="sub" style="white-space:normal;margin-top:4px;color:#b8860b">Money moves both ways here — '
      + 'purchases and refunds together. Same category either way; open it if you want to check.</div>';
  }

  h += '<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">'
    + '<select style="flex:1 1 160px;min-width:0" onchange="pgPick(\'' + esc(g.key) + '\',this.value)">' + pgCatOptions(g.key) + '</select>'
    + '<button class="btn acc" style="flex:1 1 140px' + (picked ? '' : ';opacity:.5') + '"'
    +   (picked ? '' : ' disabled')
    +   ' onclick="pgApprove(\'' + esc(g.key) + '\')">Approve ' + live.length + '</button>'
    + '</div>'
    + '<button class="btn ghost sm" style="width:100%;margin-top:6px" onclick="pgToggle(\'' + esc(g.key) + '\')">'
    +   (open ? '▲ Hide the ' + g.n + '' : '▼ Show the ' + g.n + '') + '</button>';

  if (open) {
    h += '<div style="margin-top:6px">' + g.rows.map(function (t) {
      var skipped = !!PG_SKIP[t.id];
      return '<div class="row" style="gap:8px;align-items:center;padding:4px 0;border-top:1px solid var(--line);'
        + (skipped ? 'opacity:.4' : '') + '">'
        + '<input type="checkbox" style="width:auto;flex:0 0 auto" ' + (skipped ? '' : 'checked')
        +   ' onclick="pgSkip(\'' + esc(t.id) + '\',!this.checked)" title="Include in this group">'
        + '<div class="grow" style="min-width:0"><div class="sub">' + esc(t.date || '') + ' · ' + esc((t.note || '').slice(0, 46))
        +   (t.detail ? '<div style="color:var(--accent);white-space:normal">' + esc(String(t.detail).slice(0, 70)) + '</div>' : '')
        + '</div></div>'
        + '<div class="nm" style="font-variant-numeric:tabular-nums;flex:0 0 auto">'
        +   ((t.dir || 'out') === 'in' ? '+' : '−') + pgMoney(t.amount) + '</div>'
        + '</div>';
    }).join("") + '</div>';
  }
  return h + '</div>';
}

/* the whole section, for the Review screen to drop in */
function pgSectionHTML() {
  var groups = pgGroups();
  if (!groups.length) return "";
  var rows = groups.reduce(function (a, g) { return a + g.n; }, 0);
  var h = '<div class="secthd"><h2 style="font-size:13px">By payee — decide once, apply to all</h2>'
    + '<div class="grow"></div><span class="ct">' + groups.length + '</span></div>'
    + '<div class="sub" style="white-space:normal;margin:0 4px 8px">'
    + rows + ' transactions the ledger couldn\'t place, from <b>' + groups.length + '</b> payees. '
    + 'Categorising a payee here also teaches it — next time these arrive already recognised. '
    + 'Biggest amounts first.</div>';
  return h + groups.map(pgGroupHTML).join("");
}

if (typeof window !== "undefined") {
  window.pgSectionHTML = pgSectionHTML; window.pgGroups = pgGroups; window.pgUnknownRows = pgUnknownRows;
  window.pgToggle = function (k) { PG_OPEN[k] = !PG_OPEN[k]; if (typeof render === "function") render(); };
  window.pgPick = function (k, v) { PG_PICK[k] = v; if (typeof render === "function") render(); };
  window.pgSkip = function (id, skip) { if (skip) PG_SKIP[id] = true; else delete PG_SKIP[id]; if (typeof render === "function") render(); };

  /* ⭐ approve a whole payee at the chosen category. Goes through ledgerApprove per row — the same single
     door everything else uses — so transfer partner-flagging, the learning write and the pending gate all
     behave identically to approving one row by hand. ⛔ Never bypasses it for speed. */
  window.pgApprove = function (key) {
    var g = pgGroups().filter(function (x) { return x.key === key; })[0];
    if (!g) return;
    var catId = PG_PICK[key] || "";
    if (!catId) { alert("Pick a category first."); return; }
    var live = g.rows.filter(function (t) { return !PG_SKIP[t.id]; });
    if (!live.length) { alert("Every row in this group is unticked."); return; }
    var n = 0;
    live.forEach(function (t) { if (typeof ledgerApprove === "function" && ledgerApprove(t.id, { catId: catId })) n++; });
    delete PG_PICK[key]; delete PG_OPEN[key];
    if (typeof toast === "function") {
      toast("Filed " + n + " × " + g.label + (n > 1 ? " — and I'll recognise them next time" : ""));
    }
    if (typeof render === "function") render();
  };
}
if (typeof module !== "undefined" && module.exports) module.exports = { pgGroups: pgGroups };
