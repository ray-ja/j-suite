/* ---------- BUSINESS TRANSACTIONS (js/175) — the card feed, tagged into the books ----------
   Ray, 2026-09-15: "we should just have a transactions area that routinely pulls transactions and i have to
   tag them. thats easiest. tags should autofill logically but need approval and tags should be persistent and
   selectable like YNAB"

   WHAT ALREADY EXISTED: the Square card is a Plaid item on the PERSONAL org; plaid-pull.js runs 3×/day and
   lands every charge in that org's budgetTx (pending) through js/143 ledgerIngest. Nothing on the BUSINESS side
   ever saw those rows, and there was no path from a bank row to an OBX expense — Ray was re-typing them.

   WHAT THIS IS: Money → Finance → Transactions, in the business org. It reads the bank rows of every account
   whose budget book is linked to this org (book.linkedOrgId), offers a tag per row, and on approval writes ONE
   expense into this org (or onto a job as a hard cost) and stamps the bank row matchedTo it — the same link js/152
   uses, so the personal budget never double-counts the money and the account balance still does.

   TAGS: the fixed expense categories the P&L already understands (RCPT_CATS) plus custom tags Ray adds, each
   rolling up to one of those categories so margins/tool-overhead/fuel rules keep working. Custom tags persist on
   the org's registry record (expenseTags) — synced, no new collection. Three non-expense tags: transfer between
   accounts, Square payout (the deposit of money income already recorded), personal.

   AUTOFILL: a business-side vendor memory (this org's budgetMemo, keyed by js/143 ledgerMerchantKey), taught
   ONLY by approvals here and by a one-time backfill from expenses already on file. Exact key = high, fuzzy
   payee = medium, else "new payee". Every suggestion carries its reason. Nothing posts without a tap.

   Owner/admin only (Finance is gated by finCanView). Cross-org writes go through uniInOrg (js/151), the one
   sanctioned door, exactly like matchLink. */
let BTX_VIEW = "inbox";   // inbox | done | all
const BTX_SPECIAL = [
  { id: "__transfer", label: "↔ Transfer between accounts" },
  { id: "__payout",   label: "💳 Square payout (already counted as income)" },
  { id: "__personal", label: "🙍 Personal, not the business" }
];

/* ===================== pure helpers (node-testable) ===================== */
function btxBaseCats() { return (typeof RCPT_CATS !== "undefined") ? RCPT_CATS.slice() : ["materials", "tools/equipment", "disposal", "fuel", "rentals", "subscription/software", "marketing/ads", "uniforms", "meals", "crew supplies", "office/admin", "other"]; }
/* the tag vocabulary: base categories + custom tags [{name, cat}] */
function btxTagList(custom) {
  const base = btxBaseCats().map(c => ({ name: c, cat: c, custom: false }));
  const extra = (custom || []).filter(t => t && t.name && !t.deleted).map(t => ({ name: t.name, cat: btxBaseCats().indexOf(t.cat) >= 0 ? t.cat : "other", custom: true }));
  return base.concat(extra);
}
function btxTagCat(tag, custom) { const t = btxTagList(custom).find(x => x.name === tag); return t ? t.cat : "other"; }
function btxKey(desc) { return (typeof ledgerMerchantKey === "function") ? ledgerMerchantKey(desc) : String(desc || "").toLowerCase().replace(/[^a-z ]+/g, " ").trim().split(/\s+/).slice(0, 3).join(" "); }
function btxSame(a, b) { return (typeof ledgerMerchantSame === "function") ? ledgerMerchantSame(a, b) : String(a || "").toLowerCase() === String(b || "").toLowerCase(); }
function btxDisplay(desc) { return (typeof ledgerDisplayName === "function") ? ledgerDisplayName(desc) : String(desc || ""); }

/* THE SUGGESTION. memo = this org's budgetMemo rows {key, catId(tag), jobId, hits, lastDesc}. Returns
   { tag, confidence: "high"|"medium"|"none", why, jobId }. */
function btxSuggest(row, memo) {
  memo = (memo || []).filter(m => m && !m.deleted && m.key);
  const note = String(row.note || row.desc || "");
  if ((row.dir || "out") === "in" && /card payment|square|sq \*|deposit|payout/i.test(note)) return { tag: "__payout", confidence: "high", why: "money coming in from card sales — the income is already on the books", jobId: "" };
  const key = btxKey(note);
  const exact = memo.filter(m => m.key === key).sort((a, b) => (b.hits || 0) - (a.hits || 0))[0];
  const refund = (row.dir || "out") === "in" ? "money back from a payee you tag " : "";   // a refund from a known merchant → the tag it refunds
  if (exact) return { tag: exact.catId, confidence: "high", why: refund ? refund + exact.catId + " — a refund?" : "you tagged " + btxDisplay(exact.lastDesc || note) + " as " + exact.catId + (exact.hits > 1 ? " " + exact.hits + " times" : " before"), jobId: exact.jobId || "" };
  const fuzzy = memo.filter(m => m.lastDesc && btxSame(m.lastDesc, note)).sort((a, b) => (b.hits || 0) - (a.hits || 0))[0];
  if (fuzzy) return { tag: fuzzy.catId, confidence: "medium", why: refund ? refund + fuzzy.catId + " — a refund?" : "looks like " + btxDisplay(fuzzy.lastDesc) + ", which you tagged " + fuzzy.catId, jobId: "" };
  if ((row.dir || "out") === "in") return { tag: "", confidence: "none", why: "money in from a new payee — a refund? pick the tag it refunds", jobId: "" };
  return { tag: "", confidence: "none", why: "new payee — I haven't seen this one before", jobId: "" };
}
/* learn ONLY from an approval (or the one-time backfill). Re-tagging a payee resets its count to 1. */
function btxLearn(memo, desc, tag, jobId) {
  const key = btxKey(desc); if (!key || !tag) return memo;
  let m = memo.find(x => x && !x.deleted && x.key === key);
  if (!m) { m = { id: "bgt-memo-" + key.replace(/\s+/g, "-"), key: key, catId: tag, hits: 0, deleted: false }; memo.push(m); }
  if (m.catId !== tag) { m.catId = tag; m.hits = 0; }
  m.hits = (m.hits || 0) + 1; m.lastDesc = String(desc || "").slice(0, 120); m.lastUsed = Date.now(); m.jobId = jobId || "";
  m.updatedAt = Date.now();
  return memo;
}
/* the expense record an approved row becomes — the same shape saveExpense / rcptBuildRecord write */
function btxExpenseRecord(row, tag, cat, opts) {
  opts = opts || {};
  const out = (row.dir || "out") === "out";
  const name = btxDisplay(row.note || row.desc || "");
  return {
    id: "ex_" + (opts.id || (typeof uid === "function" ? uid() : Date.now().toString(36))),
    amount: Math.round((+row.amount || 0) * 100) / 100 * (out ? 1 : -1),      // a refund lands as a negative expense (already how returns are filed)
    desc: name + (out ? "" : " (refund)"), vendor: name, category: cat, tag: tag,
    date: row.date, note: opts.note || "", paidBy: "", memberId: null, attributedTo: "",
    cardLast4: opts.cardLast4 || "", source: "bank", txId: row.id, txOrg: opts.txOrg || "",
    by: opts.by || "", ts: Date.now(), deleted: false
  };
}
/* the rows for this business: every non-deleted bank row on an account whose book links to this org.
   status: "inbox" until tagged here (a personal-side category or approval does NOT count — it was never
   a business decision), "done" once it carries a btxTag. */
function btxRowsFrom(budgetTx, accountIds) {
  const ids = new Set(accountIds || []);
  return (budgetTx || []).filter(t => t && !t.deleted && ids.has(t.accountId)).map(t => Object.assign({}, t, { status: t.btxTag ? "done" : "inbox" }))
    .sort((a, b) => (b.date + "|" + b.id) < (a.date + "|" + a.id) ? -1 : 1);
}
/* MIGRATION FIXUP: js/143 used to file every ingested row under the DEFAULT book instead of the paired
   account's book, so the Square rows sat in the Personal book. Pure: returns the number of rows refiled. */
function btxRefileBooks(store) {
  if (!store || !Array.isArray(store.budgetTx)) return 0;
  const acct = {}; (store.budgetAccounts || []).forEach(a => { if (a && !a.deleted && a.id) acct[a.id] = a; });
  const books = {}; (store.budgetBooks || []).forEach(b => { if (b && !b.deleted && b.id) books[b.id] = b; });
  let n = 0;
  store.budgetTx.forEach(t => {
    if (!t || t.deleted) return;
    const a = acct[t.accountId]; if (!a || !a.bookId || !books[a.bookId]) return;
    if (t.bookId === a.bookId) return;
    t.bookId = a.bookId; t.updatedAt = Date.now(); n++;
  });
  return n;
}

/* ===================== live data ===================== */
/* which personal org + book + accounts feed THIS business */
function btxSource() {
  if (typeof S === "undefined" || !S.biz) return null;
  const orgs = (typeof uniOrgs === "function") ? uniOrgs() : Object.keys(S).filter(k => S[k] && typeof S[k] === "object" && Array.isArray(S[k].budgetBooks)).map(k => ({ id: k }));
  for (const o of orgs) {
    const st = S[o.id]; if (!st || !Array.isArray(st.budgetBooks)) continue;
    const books = st.budgetBooks.filter(b => b && !b.deleted && b.linkedOrgId === S.biz);
    if (!books.length) continue;
    const bookIds = new Set(books.map(b => b.id));
    const accounts = (st.budgetAccounts || []).filter(a => a && !a.deleted && bookIds.has(a.bookId));
    return { orgId: o.id, books: books, accounts: accounts, accountIds: accounts.map(a => a.id) };
  }
  return null;
}
function btxCustomTags() { const rec = ((typeof S !== "undefined" && S.registry) || []).find(r => r && r.id === S.biz); return (rec && Array.isArray(rec.expenseTags)) ? rec.expenseTags : []; }
function btxMemo() { const d = D(); if (!Array.isArray(d.budgetMemo)) d.budgetMemo = []; return d.budgetMemo; }
/* one-time: teach the memo from expenses already on file (vendor/desc → category), newest wins */
function btxBackfill() {
  const d = D(); const memo = btxMemo();
  if (memo.some(m => m && m.backfilled)) return 0;
  let n = 0;
  (d.expenses || []).filter(e => e && !e.deleted && e.category && (e.vendor || e.desc)).sort((a, b) => (a.date || "") < (b.date || "") ? -1 : 1)
    .forEach(e => { btxLearn(memo, e.vendor || e.desc, e.tag || e.category, ""); n++; });
  memo.forEach(m => { if (m && !m.deleted) { m.backfilled = true; if (typeof touch === "function") touch(m); } });
  if (!memo.length) memo.push({ id: "bgt-memo-__backfilled", key: "", catId: "", backfilled: true, deleted: false, updatedAt: Date.now() });
  return n;
}
function btxRows() {
  const src = btxSource(); if (!src) return [];
  /* one-time refile of rows js/143 filed under the wrong book (see btxRefileBooks); idempotent, synced by updatedAt */
  try { if (btxRefileBooks(S[src.orgId]) > 0) { save(); if (typeof scheduleAutoPush === "function") scheduleAutoPush(); } } catch (e) {}
  const tx = uniInOrg(src.orgId, () => (D().budgetTx || []).slice()) || [];
  return btxRowsFrom(tx, src.accountIds);
}
function btxInboxCount() { try { return btxRows().filter(r => r.status === "inbox").length; } catch (e) { return 0; } }
function btxJobs() {
  const cutoff = (typeof plAddDays === "function") ? plAddDays(today(), -90) : "";
  return (typeof actJ === "function" ? actJ() : []).filter(j => j && !Array.isArray(j.sharedJobIds) && (!j.done || !cutoff || (j.date || "") >= cutoff)).sort((a, b) => (b.date || "") < (a.date || "") ? -1 : 1);
}

/* ===================== actions ===================== */
if (typeof window !== "undefined") {
  window.btxSetView = function (v) { BTX_VIEW = v || "inbox"; render(); };
  window.btxTagChange = function (txId, sel) {
    if (sel.value !== "__new") return;
    const name = (prompt("New tag name (e.g. Gravel, Trailer parts):") || "").trim();
    if (!name) { sel.value = ""; return; }
    const cats = btxBaseCats();
    const catIn = (prompt("Which expense category does \"" + name + "\" count as for the books?\n" + cats.map((c, i) => (i + 1) + ". " + c).join("\n")) || "").trim();
    const cat = cats[(+catIn) - 1] || cats.find(c => c === catIn.toLowerCase()) || "other";
    const rec = (S.registry || []).find(r => r && r.id === S.biz); if (!rec) { alert("No org record to save the tag on."); return; }
    rec.expenseTags = (rec.expenseTags || []).filter(t => t && t.name !== name).concat([{ name: name, cat: cat }]);
    if (typeof touch === "function") touch(rec); save();
    window.__btxPick = { txId: txId, tag: name }; render();
  };
  /* APPROVE: tag → expense (this org, or the job) + the bank row stamped matchedTo + the memo learns */
  window.btxApprove = function (txId) {
    const src = btxSource(); if (!src) return;
    const tagSel = document.getElementById("btx_tag_" + txId), jobSel = document.getElementById("btx_job_" + txId), noteEl = document.getElementById("btx_note_" + txId);
    const tag = tagSel ? tagSel.value : ""; if (!tag || tag === "__new") { alert("Pick a tag first."); return; }
    const jobId = jobSel ? jobSel.value : "", note = noteEl ? noteEl.value.trim() : "";
    const row = uniInOrg(src.orgId, () => (D().budgetTx || []).find(t => t && t.id === txId)); if (!row) return;
    const me = (typeof curUser === "function") ? curUser() : null;
    const d = D();
    let rec = null;
    if (tag[0] !== "_") {
      const cat = btxTagCat(tag, btxCustomTags());
      rec = btxExpenseRecord(row, tag, cat, { note: note, txOrg: src.orgId, by: me ? me.username : "" });
      if (jobId && typeof jobLIAdd === "function") { rec.jobId = jobId; jobLIAdd("jobexp", jobId, rec); }
      else { if (!Array.isArray(d.expenses)) d.expenses = []; d.expenses.push(rec); if (typeof touch === "function") touch(rec); }
      rec.matchedByTxId = txId;
      if (typeof logChange === "function") logChange("create", "expense", rec.id, "Tagged bank charge " + tag + " " + (typeof money === "function" ? money(Math.abs(rec.amount)) : rec.amount));
      btxLearn(btxMemo(), row.note, tag, jobId); btxMemo().forEach(m => { if (m && m.key === btxKey(row.note) && typeof touch === "function") touch(m); });
    }
    const biz = S.biz;   // captured BEFORE the swap: matchedTo.org is the expense's home, this business
    uniInOrg(src.orgId, () => {
      const t = (D().budgetTx || []).find(x => x && x.id === txId); if (!t) return null;
      t.btxTag = tag; t.pending = false; t.approvedAt = Date.now(); t.catId = "";
      if (tag === "__transfer") t.isTransfer = true;
      else if (tag === "__personal") { /* hand it back to the personal Review queue: default book, pending again */ t.btxTag = ""; t.btxSkipped = "personal"; t.pending = true; t.approvedAt = null; if (typeof budgetDefaultBookId === "function") t.bookId = budgetDefaultBookId(); }
      else if (rec) t.matchedTo = { org: biz, kind: jobId ? "jobExpense" : "expense", id: rec.id };
      if (typeof touch === "function") touch(t);
      return null;
    });
    save(); if (typeof scheduleAutoPush === "function") scheduleAutoPush();
    render();
  };
  /* LINK instead of create: the charge is already on the books (typed in by hand earlier) */
  window.btxLink = function (txId, org, kind, id) {
    const src = btxSource(); if (!src || typeof matchLink !== "function") return;
    const row = uniInOrg(src.orgId, () => (D().budgetTx || []).find(t => t && t.id === txId)); if (!row) return;
    const cand = { orgId: org, kind: kind, id: id };
    uniInOrg(src.orgId, () => matchLink(txId, cand));
    let tag = "";
    uniInOrg(org, () => { const dd = D(); let e = (dd.expenses || []).find(x => x && x.id === id); if (!e) (dd.jobExpenses || []).some(x => { if (x && x.id === id) { e = x; return true; } return false; }); if (e) tag = e.tag || e.category || ""; return null; });
    uniInOrg(src.orgId, () => { const t = (D().budgetTx || []).find(x => x && x.id === txId); if (t) { t.btxTag = tag || "linked"; t.pending = false; t.approvedAt = Date.now(); if (typeof touch === "function") touch(t); } return null; });
    if (tag) btxLearn(btxMemo(), row.note, tag, "");
    save(); if (typeof scheduleAutoPush === "function") scheduleAutoPush(); render();
  };
  /* UNDO: put the row back in the inbox; the expense it created is archived (active:false style soft delete) */
  window.btxUndo = function (txId) {
    const src = btxSource(); if (!src) return;
    const d = D();
    uniInOrg(src.orgId, () => {
      const t = (D().budgetTx || []).find(x => x && x.id === txId); if (!t) return null;
      if (t.matchedTo && t.matchedTo.id) {
        const id = t.matchedTo.id;
        [d.expenses, d.jobExpenses].forEach(list => (list || []).forEach(e => { if (e && e.id === id && e.txId === txId) { e.deleted = true; if (typeof touch === "function") touch(e); } }));
        if (typeof matchUnlink === "function") matchUnlink(txId); else t.matchedTo = null;
      }
      t.btxTag = ""; t.isTransfer = false; t.pending = true; t.approvedAt = null; if (typeof touch === "function") touch(t);
      return null;
    });
    save(); if (typeof scheduleAutoPush === "function") scheduleAutoPush(); render();
  };
}

/* ===================== the screen ===================== */
function rBizTransactions() {
  if (typeof finCanView === "function" && !finCanView()) return `<div class="card"><div class="nm">Owner / Admin only</div></div>`;
  const src = btxSource();
  if (!src) return `<div class="card"><div class="nm">No bank feed linked to this business yet</div><div class="sub" style="white-space:normal">Link the card in Budget → Settings → Bank connections, then set the account's book to this business.</div></div>`;
  btxBackfill();
  const memo = btxMemo(), custom = btxCustomTags(), tags = btxTagList(custom);
  const all = btxRows();
  const inbox = all.filter(r => r.status === "inbox"), done = all.filter(r => r.status === "done");
  const rows = BTX_VIEW === "inbox" ? inbox : BTX_VIEW === "done" ? done : all;
  const fd = d => (typeof fmtDate === "function") ? fmtDate(d) : d;
  const $ = n => "$" + (Math.round(Math.abs(+n || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const acctName = id => { const a = src.accounts.find(x => x.id === id); return a ? a.name : ""; };
  const newest = all.length ? all.map(r => r.date || "").sort().pop() : "";
  const jobs = btxJobs();
  const pick = (typeof window !== "undefined" && window.__btxPick) || null; if (typeof window !== "undefined") window.__btxPick = null;

  let h = `<div class="card"><div class="row" style="gap:6px;flex-wrap:wrap;align-items:center">
      <button class="subbtn ${BTX_VIEW === "inbox" ? "on" : ""}" onclick="btxSetView('inbox')">To tag <b>${inbox.length}</b></button>
      <button class="subbtn ${BTX_VIEW === "done" ? "on" : ""}" onclick="btxSetView('done')">Tagged ${done.length}</button>
      <button class="subbtn ${BTX_VIEW === "all" ? "on" : ""}" onclick="btxSetView('all')">All</button></div>
    <div class="sub" style="margin-top:8px;white-space:normal">${src.accounts.map(a => esc(a.name)).join(", ")} · pulls automatically three times a day${newest ? " · newest charge " + esc(fd(newest)) : ""}. Tap a tag, approve, and it is on the books. Tags you make up are kept.</div></div>`;

  if (!rows.length) return h + `<div class="empty"><div class="big">🏦</div>${BTX_VIEW === "inbox" ? "Nothing to tag. Every charge is on the books." : "No transactions here yet."}</div>`;

  h += `<div class="card" style="padding:0">` + rows.map(r => {
    const out = (r.dir || "out") === "out";
    const name = btxDisplay(r.note || ""), raw = String(r.note || "");
    if (r.status === "done") {
      const sp = BTX_SPECIAL.find(x => x.id === r.btxTag);
      const where = r.matchedTo && r.matchedTo.id ? (r.matchedTo.kind === "jobExpense" ? "on the job" : "expense on the books") : (sp ? "" : "linked to an expense on file");
      return `<div class="li" style="align-items:flex-start;padding:10px 12px;border-bottom:1px solid var(--line)"><div class="grow" style="min-width:0">
          <div class="nm" style="font-size:15px">${esc(name)}</div>
          <div class="sub" style="white-space:normal">${esc(fd(r.date))} · <b>${esc(sp ? sp.label : r.btxTag)}</b>${where ? " · " + where : ""}</div></div>
        <div style="text-align:right;flex:0 0 auto;margin-left:8px"><b style="font-size:15px;color:${out ? "inherit" : "#1a7f37"}">${out ? "−" : "+"}${$(r.amount)}</b>
          <div style="margin-top:4px"><button class="btn ghost sm" onclick="btxUndo('${r.id}')">Undo</button></div></div></div>`;
    }
    const s = btxSuggest(r, memo);
    const chosen = (pick && pick.txId === r.id) ? pick.tag : s.tag;
    const cands = (typeof matchCandidates === "function") ? matchCandidates(r).filter(c => c.orgId === S.biz && c.kind !== "income") : [];
    const badge = s.confidence === "high" ? `<span style="font-size:11px;font-weight:700;color:#1a7f37">recognized</span>` : s.confidence === "medium" ? `<span style="font-size:11px;font-weight:700;color:#b8860b">probably</span>` : `<span style="font-size:11px;font-weight:700;color:var(--muted)">new</span>`;
    const opts = `<option value="">— pick a tag —</option>` +
      `<optgroup label="Expense">` + tags.map(t => `<option value="${esc(t.name)}" ${chosen === t.name ? "selected" : ""}>${esc(t.name)}${t.custom ? " (" + esc(t.cat) + ")" : ""}</option>`).join("") + `</optgroup>` +
      `<optgroup label="Not an expense">` + BTX_SPECIAL.map(t => `<option value="${t.id}" ${chosen === t.id ? "selected" : ""}>${esc(t.label)}</option>`).join("") + `</optgroup>` +
      `<option value="__new">＋ New tag…</option>`;
    const jobOpts = `<option value="">no job (business overhead)</option>` + jobs.map(j => `<option value="${j.id}" ${s.jobId === j.id ? "selected" : ""}>${esc((j.title || "Job").slice(0, 44))}${j.date ? " · " + esc(fd(j.date)) : ""}</option>`).join("");
    return `<div style="padding:10px 12px;border-bottom:1px solid var(--line)">
      <div class="row" style="align-items:flex-start"><div class="grow" style="min-width:0">
          <div class="nm" style="font-size:15px">${esc(name)} ${badge}</div>
          <div class="sub" style="white-space:normal">${esc(fd(r.date))} · ${esc(acctName(r.accountId))}${raw && raw !== name ? ` · <span title="${esc(raw)}">${esc(raw.slice(0, 60))}</span>` : ""}</div>
          <div class="sub" style="white-space:normal;margin-top:2px">${esc(s.why)}</div></div>
        <b style="font-size:15px;flex:0 0 auto;margin-left:8px;color:${out ? "inherit" : "#1a7f37"}">${out ? "−" : "+"}${$(r.amount)}</b></div>
      ${cands.length ? `<div style="margin-top:6px;padding:6px 8px;background:var(--soft);border-radius:8px;font-size:13px;white-space:normal">Already on the books? ${cands.map(c => `<button class="btn ghost sm" onclick="btxLink('${r.id}','${c.orgId}','${c.kind}','${c.id}')">Link to ${esc((c.label || "expense").slice(0, 36))} · ${esc(fd(c.date))}</button>`).join(" ")}</div>` : ""}
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">
        <select id="btx_tag_${r.id}" onchange="btxTagChange('${r.id}',this)" style="flex:1 1 170px;min-width:0">${opts}</select>
        <select id="btx_job_${r.id}" style="flex:1 1 170px;min-width:0">${jobOpts}</select>
        <input id="btx_note_${r.id}" placeholder="note (optional)" style="flex:1 1 140px;min-width:0">
        <button class="btn acc sm" style="flex:0 0 auto" onclick="btxApprove('${r.id}')">✓ Approve</button></div></div>`;
  }).join("") + `</div>`;
  h += `<div class="card" style="background:var(--soft)"><div class="sub" style="white-space:normal">Approving writes one expense here (or a hard cost on the job you pick) and marks the bank row so the personal budget doesn't count it too. Refunds land as negative expenses. Undo puts a row back.</div></div>`;
  return h;
}
if (typeof window !== "undefined") { window.rBizTransactions = rBizTransactions; window.btxInboxCount = btxInboxCount; if (window.NAV_BADGES) window.NAV_BADGES["finance/bank"] = function () { const n = btxInboxCount(); return n ? String(n) : ""; }; }

if (typeof module !== "undefined" && module.exports) {
  module.exports = { btxTagList: btxTagList, btxTagCat: btxTagCat, btxSuggest: btxSuggest, btxLearn: btxLearn, btxExpenseRecord: btxExpenseRecord, btxRowsFrom: btxRowsFrom, btxRefileBooks: btxRefileBooks, BTX_SPECIAL: BTX_SPECIAL };
}
