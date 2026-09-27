/* ---------- MONEY SECTION ON TODAY (js/200) ----------
   Ray, 2026-09-27: "a money section with all the money cards in it… one that shows the business's bank account
   total, how much cash we have on hand; one that shows the expected recurring expenses for the month; and one
   that shows the delta between how much cash the business has and how much it needs to pay between expenses and
   payouts."
   Three sections rendered into Today (js/05 calls moneyTilesHTML) which js/199 turns into tiles:
     🏦 Cash on hand   = the balances of the bank accounts this business owns, read from the personal org's
                         synced accounts (Plaid, js/150). Which accounts count is a per-business pick, stored in
                         this org's docs as `cashAccounts` {ids}. Nothing in the app says which account is OBX's,
                         so the default is a name match and the pane lets Ray tick the right ones.
     🔁 Fixed costs    = a hand-kept monthly list (docs `fixedCosts` {items:[{id,label,amount,note}]}). Ray,
                         2026-09-27: "our only fixed cost is insurance". Guessing from repeat charges was wrong
                         (materials runs, per-transaction card fees). Paybacks to partners (js/116) are NOT monthly:
                         "we just need to pay him back eventually" — they are listed under Left, never subtracted.
     ⚖️ Left after     = cash − fixed costs − what the crew is owed (js/86, all time, on completion).
   Pure helpers tested in money-tiles-tests.js. */
function mtMedian(a) { a = (a || []).slice().sort(function (x, y) { return x - y; }); if (!a.length) return 0; var m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
/* vendors charged in ≥2 of the last 3 months (this month and the two before) → {vendor, monthly (median of the
   monthly totals), months}. Pure. today = "YYYY-MM-DD". Installment postings are excluded (the plans list on
   their own). */
function mtRecurringVendors(expenses, today) {
  var y = +String(today).slice(0, 4), m = +String(today).slice(5, 7), months = [];
  for (var i = 0; i <= 2; i++) { var mm = m - i, yy = y; if (mm < 1) { mm += 12; yy--; } months.push(yy + "-" + String(mm).padStart(2, "0")); }
  var by = {};
  (expenses || []).forEach(function (e) {
    if (!e || e.deleted || !e.date || e.source === "installment") return;
    var ym = String(e.date).slice(0, 7); if (months.indexOf(ym) < 0) return;
    var v = String(e.vendor || e.desc || "").trim(); if (!v) return;
    by[v] = by[v] || {}; by[v][ym] = (by[v][ym] || 0) + (+e.amount || 0);
  });
  return Object.keys(by).map(function (v) { var ms = Object.keys(by[v]); return { vendor: v, months: ms.length, monthly: Math.round(mtMedian(ms.map(function (k) { return by[v][k]; })) * 100) / 100 }; })
    .filter(function (r) { return r.months >= 2 && r.monthly > 0; }).sort(function (a, b) { return b.monthly - a.monthly; });
}
/* the installments due this month: plan payments not yet logged whose due month is this month or earlier. Pure. */
function mtInstallmentsDue(plans, ym) {
  var out = [];
  (plans || []).forEach(function (p) {
    if (!p || p.deleted || !p.count) return;
    var per = Math.round((+p.total || 0) / p.count * 100) / 100, paid = p.paidNs || [];
    var sy = +String(p.start || "").slice(0, 4), sm = +String(p.start || "").slice(5, 7); if (!sy || !sm) return;
    for (var n = 1; n <= p.count; n++) {
      if (paid.indexOf(n) >= 0) continue;
      var mo = sm + n - 1, yr = sy + Math.floor((mo - 1) / 12); mo = ((mo - 1) % 12) + 1;
      var due = yr + "-" + String(mo).padStart(2, "0");
      if (due <= ym) { out.push({ plan: p.id, label: p.label || "payback", payee: p.payeeName || "", amount: n >= p.count ? Math.round(((+p.total || 0) - per * (p.count - 1)) * 100) / 100 : per, due: due, n: n, paidBy: p.paidBy || "" }); break; }   // one payment per plan per month
    }
  });
  return out;
}
/* which of the personal org's accounts count as this business's cash. Pure. */
function mtCashPick(accounts, saved, orgName) {
  var live = (accounts || []).filter(function (a) { return a && !a.deleted && /checking|savings|cash/i.test(String(a.type || "checking")); });
  if (saved && saved.length) return live.filter(function (a) { return saved.indexOf(a.id) >= 0; });
  var re = new RegExp(String(orgName || "").split(/\s+/)[0] || "$^", "i");
  return live.filter(function (a) { return re.test(a.name || ""); });
}
/* what is still owed back to partners for things they fronted (Ray, 2026-09-27: "Chase bought the trailer cash,
   we just need to pay him back eventually; same as how I bought the skid steer"). No due date, so it is shown,
   never subtracted from this month. Pure. */
function mtPartnerDebt(plans) {
  return (plans || []).filter(function (p) { return p && !p.deleted && p.count; }).map(function (p) {
    var per = Math.round((+p.total || 0) / p.count * 100) / 100, paid = (p.paidNs || []).reduce(function (s, n) { return s + (n >= p.count ? Math.round(((+p.total || 0) - per * (p.count - 1)) * 100) / 100 : per); }, 0);
    return { plan: p.id, label: p.label || "payback", payee: p.payeeName || "", remaining: Math.round(((+p.total || 0) - paid) * 100) / 100 };
  }).filter(function (r) { return r.remaining > 0; });
}
function mtDelta(cashCents, fixedCents, owedCents) { return Math.round((+cashCents || 0) - (+fixedCents || 0) - (+owedCents || 0)); }
if (typeof window !== "undefined") {
  var mtE = function (s) { return (typeof esc === "function") ? esc(String(s == null ? "" : s)) : String(s == null ? "" : s); };
  var mtM = function (c) { return (typeof money === "function") ? money((c || 0) / 100) : "$" + ((c || 0) / 100).toFixed(2); };
  function mtDoc(id) { var d = D(); d.docs = d.docs || []; var x = d.docs.find(function (r) { return r && r.id === id && !r.deleted; }); return x || null; }
  function mtDocSet(id, fields) { var d = D(); d.docs = d.docs || []; var x = d.docs.find(function (r) { return r && r.id === id; }); if (!x) { x = { id: id, deleted: false }; d.docs.push(x); } Object.assign(x, fields, { deleted: false, updatedAt: Date.now() }); if (typeof touch === "function") touch(x); if (typeof save === "function") save(); if (typeof render === "function") render(); }
  function mtPersonalAccounts() { try { var hit = (S.registry || []).find(function (r) { return r && !r.deleted && S[r.id] && Array.isArray(S[r.id].budgetAccounts) && S[r.id].budgetAccounts.length; }); return hit ? S[hit.id].budgetAccounts : []; } catch (e) { return []; } }
  function mtOrgName() { try { var r = (S.registry || []).find(function (x) { return x && x.id === S.biz; }); return (r && (r.name || r.label)) || S.biz || ""; } catch (e) { return ""; } }
  window.mtCashToggle = function (id) { var doc = mtDoc("cashAccounts"), ids = (doc && doc.ids) ? doc.ids.slice() : mtCashPick(mtPersonalAccounts(), null, mtOrgName()).map(function (a) { return a.id; }); var i = ids.indexOf(id); if (i >= 0) ids.splice(i, 1); else ids.push(id); mtDocSet("cashAccounts", { ids: ids }); };
  window.mtFixedAdd = function () { var label = prompt("What is it? (e.g. Next Insurance)"); if (!label) return; var amt = parseFloat(String(prompt("Monthly amount ($)") || "").replace(/[^0-9.]/g, "")); if (!(amt > 0)) return; var doc = mtDoc("fixedCosts"), items = (doc && doc.items) ? doc.items.slice() : []; items.push({ id: "fc_" + Date.now().toString(36), label: label.trim(), amount: Math.round(amt * 100) / 100 }); mtDocSet("fixedCosts", { items: items }); };
  window.mtFixedDel = function (id) { var doc = mtDoc("fixedCosts"), items = (doc && doc.items) ? doc.items.filter(function (x) { return x && x.id !== id; }) : []; mtDocSet("fixedCosts", { items: items }); };
  /* the three sections; also publishes window.MT_STATS for the tiles */
  window.moneyTilesHTML = function () {
    try {
      var t = (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10), ym = t.slice(0, 7);
      var owner = (typeof finCanView === "function") ? finCanView() : false; if (!owner) return "";
      /* cash */
      var accts = mtPersonalAccounts(), doc = mtDoc("cashAccounts"), picked = mtCashPick(accts, doc && doc.ids, mtOrgName());
      var cashCents = picked.reduce(function (s, a) { return s + Math.round((+a.balance || 0) * 100); }, 0), booksCents = null;
      try { if (typeof finAccountBalances === "function") booksCents = finAccountBalances().cash; } catch (e) {}
      var newest = picked.reduce(function (m, a) { return Math.max(m, +a.balanceAt || +a.updatedAt || 0); }, 0);
      var h = '<div class="secthd"><h2>🏦 Cash on hand</h2><span class="ct">' + picked.length + (picked.length === 1 ? " account" : " accounts") + '</span></div><div class="card">';
      if (!accts.length) h += '<div class="sub" style="white-space:normal">No bank accounts are linked on this device. The personal org holds the Plaid link; sign in there once and the balances show here.</div>';
      else {
        h += picked.length ? picked.map(function (a) { return '<div class="li"><div class="grow"><div class="nm" style="font-size:15px">' + mtE(a.name) + '</div><div class="sub">' + mtE(a.type || "") + (a.balanceAt || a.updatedAt ? ' · as of ' + mtE(new Date(+a.balanceAt || +a.updatedAt).toLocaleDateString()) : '') + '</div></div><div class="nm" style="color:var(--brand-text)">' + mtM(Math.round((+a.balance || 0) * 100)) + '</div></div>'; }).join("") : '<div class="sub" style="white-space:normal">No account is marked as this business\'s. Tick the ones that are:</div>';
        h += '<details style="margin-top:8px"><summary class="sub" style="cursor:pointer">Which accounts count as ' + mtE(mtOrgName()) + '\'s cash</summary>' + accts.filter(function (a) { return a && !a.deleted && /checking|savings|cash/i.test(String(a.type || "checking")); }).map(function (a) { var on = picked.some(function (p) { return p.id === a.id; }); return '<label class="toggle" style="display:block;margin-top:6px"><input type="checkbox" ' + (on ? "checked" : "") + ' onchange="mtCashToggle(\'' + mtE(a.id) + '\')"> ' + mtE(a.name) + ' · ' + mtM(Math.round((+a.balance || 0) * 100)) + '</label>'; }).join("") + '</details>';
        if (booksCents != null) h += '<div class="sub" style="margin-top:8px;white-space:normal">Books say ' + mtM(booksCents) + ' (collected − spent − paid out). A gap means money moved that the app has not seen.</div>';
      }
      h += '</div>';
      /* fixed costs */
      /* a hand-kept list only (Ray, 2026-09-27: "Home Depot is not a fixed cost… we are on the Square free plan.
         Our only fixed cost is insurance"). Guessing from repeat charges put materials runs and card fees here.
         Paybacks to partners are not monthly obligations either: they are listed under Left, not here. */
      var fdoc = mtDoc("fixedCosts"), manual = (fdoc && fdoc.items) || [];
      var fixedCents = 0;
      var rows = manual.map(function (m) { fixedCents += Math.round((+m.amount || 0) * 100); return { l: m.label, s: m.note || "monthly", c: Math.round((+m.amount || 0) * 100), del: m.id }; });
      h += '<div class="secthd"><h2>🔁 Fixed costs this month</h2><span class="ct">' + mtM(fixedCents) + '</span></div><div class="card">'
        + (rows.length ? rows.map(function (r) { return '<div class="li"><div class="grow"><div class="nm" style="font-size:15px">' + mtE(r.l) + '</div><div class="sub">' + mtE(r.s) + '</div></div><div class="nm" style="color:var(--brand-text)">' + mtM(r.c) + '</div>' + (r.del ? '<button class="btn ghost sm" onclick="mtFixedDel(\'' + mtE(r.del) + '\')">✕</button>' : '') + '</div>'; }).join("") : '<div class="sub" style="white-space:normal">Nothing listed. Add what bills every month no matter what: insurance, software, a lease.</div>')
        + '<button class="btn ghost sm" style="margin-top:8px" onclick="mtFixedAdd()">+ Add a monthly cost</button></div>';
      /* left after obligations */
      var owedCents = 0; try { if (typeof finOwedPerPersonTotal === "function") owedCents = finOwedPerPersonTotal() || 0; } catch (e) {}
      var delta = mtDelta(cashCents, fixedCents, owedCents);
      h += '<div class="secthd"><h2>⚖️ Left after obligations</h2><span class="ct">' + mtM(delta) + '</span></div><div class="card">'
        + '<div class="li"><div class="grow"><div class="nm" style="font-size:15px">Cash on hand</div></div><div class="nm">' + mtM(cashCents) + '</div></div>'
        + '<div class="li"><div class="grow"><div class="nm" style="font-size:15px">− Fixed costs this month</div></div><div class="nm">' + mtM(fixedCents) + '</div></div>'
        + '<div class="li"><div class="grow"><div class="nm" style="font-size:15px">− Owed to the crew</div><div class="sub">all time, from job completion, incl. expenses fronted</div></div><div class="nm">' + mtM(owedCents) + '</div></div>'
        + '<div class="li"><div class="grow"><div class="nm" style="font-weight:800">= Left</div></div><div class="nm" style="font-weight:800;color:' + (delta < 0 ? "var(--danger)" : "var(--accent-ink)") + '">' + mtM(delta) + '</div></div>';
      var debt = mtPartnerDebt(D().installments || []);
      if (debt.length) h += '<div class="sub" style="white-space:normal;margin-top:10px"><b>Owed back to partners, no due date</b> (not counted above): ' + debt.map(function (r) { return mtE(r.payee) + " " + mtM(Math.round(r.remaining * 100)) + " (" + mtE(r.label) + ")"; }).join(" · ") + '. Paid whenever there is room; each payment is logged under Finance → Paybacks.</div>';
      h += '</div>';
      window.MT_STATS = { cashCents: cashCents, fixedCents: fixedCents, owedCents: owedCents, deltaCents: delta, accounts: picked.length, asOf: newest };
      return h;
    } catch (e) { try { console.warn("money tiles skipped:", e); } catch (_) {} return ""; }
  };
  /* ---- LEADS: ad clicks yesterday + ad spend this month (Ray, 2026-09-27) ----
     Fetched from /api/ads/stats (owner, cached 30 min server-side); rendered as two sections js/199 tiles under
     "Leads". While the answer is in flight the tiles read "…"; on arrival the tiles and cards update in place. */
  window.ADS_STATS = window.ADS_STATS || { data: null, at: 0, busy: false, err: "" };
  function adsOwner() { try { var u = (typeof curUser === "function") ? curUser() : null; return !!(u && u.superAdmin) || ((typeof isOwner === "function") && isOwner()); } catch (e) { return false; } }
  function adsMoney(c) { return mtM(c); }
  function adsPaint() {
    var st = window.ADS_STATS, d = st.data;
    var clicksTile = document.querySelector('.db-tile[data-tile="clicks"]'), spendTile = document.querySelector('.db-tile[data-tile="spend"]');
    var y = d && d.yesterday, m = d && d.month;
    var yDate = y && y.dates && y.dates.length ? y.dates[0] : "";
    var dead = !d && /expired|reconnect|not connected/i.test(st.err || "");
    var errLbl = dead ? "reconnect Google · Settings → Keys" : (st.err ? st.err : "");
    if (clicksTile) { clicksTile.querySelector(".val").textContent = d ? String(y.clicks) : (st.err ? "—" : "…"); clicksTile.querySelector(".lbl").textContent = d ? ("clicks yesterday" + (yDate ? " · " + yDate.slice(5).replace("-", "/") : "")) : (errLbl || "clicks yesterday"); clicksTile.classList.toggle("tone-danger", dead); }
    if (spendTile) { spendTile.querySelector(".val").textContent = d ? adsMoney(m.costCents) : (st.err ? "—" : "…"); spendTile.querySelector(".lbl").textContent = d ? ("ads this month · " + adsMoney((m.byType["Local Services"] || {}).costCents || 0) + " LSA · " + adsMoney((m.byType["Google Ads"] || {}).costCents || 0) + " search") : (errLbl || "ads this month"); spendTile.classList.toggle("tone-danger", dead); }
    var adsTile = document.querySelector('.db-tile[data-tile="ads"]'); if (adsTile && dead) { adsTile.querySelector(".val").textContent = "—"; adsTile.querySelector(".lbl").textContent = "reconnect Google"; }
    var rows = function (agg) { if (!agg) return '<div class="sub" style="white-space:normal">' + (dead ? "The Google sign-in the app holds has expired. Reconnect it under Settings → Keys → Google Ads (Connect Google, then paste the address of the page it lands on). Google expires these every seven days while the app is in testing mode." : mtE(st.err || "Loading…")) + '</div>'; var t = agg.byType || {}; return ["Local Services", "Google Ads"].map(function (k) { var v = t[k] || { clicks: 0, costCents: 0 }; return '<div class="li"><div class="grow"><div class="nm" style="font-size:15px">' + mtE(k) + '</div><div class="sub">' + v.clicks + (v.clicks === 1 ? " click" : " clicks") + '</div></div><div class="nm" style="color:var(--brand-text)">' + adsMoney(v.costCents) + '</div></div>'; }).join(""); };
    var c1 = document.getElementById("ads_clicks_body"); if (c1) c1.innerHTML = rows(y) + (y ? '<div class="sub" style="margin-top:6px">' + (yDate ? "Midnight to midnight, " + mtE(yDate) : "Yesterday") + ' in the account\'s time zone.</div>' : "");
    var c2 = document.getElementById("ads_spend_body"); if (c2) c2.innerHTML = rows(m) + (m ? '<div class="sub" style="margin-top:6px">First of the month to today' + (d.at ? " · as of " + mtE(new Date(d.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) : "") + '. Local Services bills per lead; Google Ads per click.</div>' : "");
  }
  window.adsPaint = adsPaint;
  window.adsStatsFetch = function (force) {
    var st = window.ADS_STATS; if (st.busy) return; if (!force && st.data && Date.now() - st.at < 30 * 60e3) { adsPaint(); return; }
    st.busy = true;
    var org = (typeof S !== "undefined" && S.biz) || "obx";
    fetch("./api/ads/stats?org=" + encodeURIComponent(org), { headers: { "Authorization": "Bearer " + ((typeof S !== "undefined" && S.sync && S.sync.token) || "") } }).then(function (r) { return r.json(); }).then(function (j) {
      st.busy = false; if (j && j.ok) { st.data = j; st.at = Date.now(); st.err = ""; } else st.err = (j && j.error) || "no answer";
      adsPaint();
    }).catch(function () { st.busy = false; st.err = "offline"; adsPaint(); });
  };
  window.adsSectionsHTML = function () {
    if (!adsOwner()) return "";
    setTimeout(function () { try { window.adsStatsFetch(false); } catch (e) {} }, 30);
    return '<div class="secthd"><h2>🖱 Clicks yesterday</h2></div><div class="card"><div id="ads_clicks_body"><div class="sub">Loading…</div></div></div>'
      + '<div class="secthd"><h2>💸 Ad spend this month</h2></div><div class="card"><div id="ads_spend_body"><div class="sub">Loading…</div></div></div>';
  };
  window.mtRecurringVendors = mtRecurringVendors; window.mtInstallmentsDue = mtInstallmentsDue; window.mtPartnerDebt = mtPartnerDebt; window.mtCashPick = mtCashPick; window.mtDelta = mtDelta;
}
if (typeof module !== "undefined" && module.exports) { module.exports = { mtMedian: mtMedian, mtPartnerDebt: mtPartnerDebt, mtRecurringVendors: mtRecurringVendors, mtInstallmentsDue: mtInstallmentsDue, mtCashPick: mtCashPick, mtDelta: mtDelta }; }
