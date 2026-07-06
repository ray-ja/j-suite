/* ---------- CARD LAST-4 AUTO-ATTRIBUTION (Phases 0-3, no Cap-vision) ----------
   Each user saves the last 4 digits of their card(s); a company card list lives on the org. When a receipt
   captures a card's last-4 (receipt.cardLast4), cardOwner() matches it → the edit modal PRE-SELECTS the
   "Who paid?" dropdown to that person (personal card = reimburse them) or leaves it on Business (company card =
   no reimburse). It is a DEFAULT ONLY — the owner can always override, and Save routes through the UNCHANGED
   js/87 rcptApplyEdit path (no new money math). We store the LAST 4 DIGITS ONLY — never a full card number, CVV,
   or expiry.

   MODEL (all additive — old records/accounts behave byte-identically):
     · per-user   u.cards = [{id,last4,label,kind:"personal"|"business",addedAt}]   (rides S.users self-write LWW;
       the server's sanitizeUserWrites already passes non-sensitive u.* for the caller's OWN account — zero
       server change needed for personal cards)
     · per-org    registry[org].businessCards = [{id,last4,label,active,addedAt}]   (mirrors registry.vehicles;
       the server protects it via REG_ADMIN_FIELDS so only an owner/admin can set it)
     · per-receipt receipt.cardLast4 = "1234"                                       (optional 4-digit string)

   cardOwner() is PURE / offline / never-throws — unit-tested via card-attribution-tests.js. */

/* ===== last-4 validation — store ONLY 4 digits (strip everything else; a pasted full PAN keeps its last 4) ===== */
function cardClean4(raw) { return String(raw == null ? "" : raw).replace(/\D/g, ""); }
function cardNorm4(raw) {
  const d = cardClean4(raw);
  if (d.length > 4) return { last4: d.slice(-4), truncated: true };   // a full number was pasted — keep only the last 4
  if (d.length === 4) return { last4: d, truncated: false };
  return { last4: "", truncated: false };                             // <4 digits = not a valid last-4
}
function cardIsValid4(raw) { const d = cardClean4(raw); return d.length === 4 && /^\d{4}$/.test(d); }

/* ===== THE PURE MATCH (Phase 0) — who does a last-4 belong to? =====
   Scans EVERY user's u.cards[] (personal) + the current org's registry.businessCards[] (company). Precedence:
   personal wins. Returns {resolution, ownerId, matches[]}:
     · exactly ONE distinct personal owner → "personal", ownerId = that user   (reimburse them)
     · 2+ distinct personal owners         → "ambiguous", ownerId = null       (owner must pick)
     · no personal, ≥1 (active) company     → "business",  ownerId = null       (no reimburse)
     · nothing matched                      → "none",      ownerId = null       (leave manual)
   Never throws; a bad/empty last-4 → "none". */
function cardOwner(last4) {
  const none = { resolution: "none", ownerId: null, matches: [] };
  try {
    const l = cardClean4(last4);
    if (!/^\d{4}$/.test(l)) return none;
    const matches = [];
    const users = (typeof S !== "undefined" && S && Array.isArray(S.users)) ? S.users : [];
    users.forEach(u => {
      if (!u || u.kind || u.deleted || !Array.isArray(u.cards)) return;
      u.cards.forEach(c => {
        if (c && !c.deleted && cardClean4(c.last4) === l) matches.push({ kind: "personal", ownerId: u.id, cardId: c.id, label: c.label || "", username: u.username || "" });
      });
    });
    const reg = (typeof S !== "undefined" && S && Array.isArray(S.registry)) ? S.registry.find(r => r && r.id === S.biz) : null;
    const biz = (reg && Array.isArray(reg.businessCards)) ? reg.businessCards : [];
    biz.forEach(c => {
      if (c && !c.deleted && c.active !== false && cardClean4(c.last4) === l) matches.push({ kind: "business", ownerId: null, cardId: c.id, label: c.label || "" });
    });
    if (!matches.length) return none;
    const owners = [];
    matches.forEach(m => { if (m.kind === "personal" && owners.indexOf(m.ownerId) < 0) owners.push(m.ownerId); });
    if (owners.length === 1) return { resolution: "personal", ownerId: owners[0], matches: matches };
    if (owners.length >= 2) return { resolution: "ambiguous", ownerId: null, matches: matches };
    return { resolution: "business", ownerId: null, matches: matches };   // only company card(s) matched
  } catch (e) { return none; }
}
/* List badge for a receipt whose card last-4 isn't linked to anyone yet — "⚠ card ••••2469?" — so the owner
   knows to register it (Settings → My cards, or assign it from the receipt). Empty when there's no card, or the
   card resolves to a person/company (then it's already attributed). Ambiguous also flags (needs disambiguation). */
function cardUnknownBadge(rec) {
  try {
    var l4 = rec && rec.cardLast4; if (!l4) return "";
    if (rec.attributedTo || rec.paidBy) return "";                 // already attributed → no flag
    var o = (typeof cardOwner === "function") ? cardOwner(l4) : null;
    if (o && (o.resolution === "personal" || o.resolution === "business")) return "";
    return ' <span class="badge" style="background:#e0a800;color:#fff" title="This card isn\'t linked to a person yet — add it in Settings → My cards, or open the receipt to assign it.">⚠ card ••••' + esc(String(l4)) + '?</span>';
  } catch (e) { return ""; }
}
if (typeof window !== "undefined") window.cardUnknownBadge = cardUnknownBadge;

/* ============================== PHASE 1a — "💳 My cards" (per-user Settings, self-write) ==============================
   Rendered into js/26's Settings page. The SIGNED-IN user manages THEIR OWN cards only — it writes curUser().cards,
   a self-write that rides S.users LWW (the server passes non-sensitive own-account fields). */
function cardMyList() { const u = (typeof curUser === "function") ? curUser() : null; return (u && Array.isArray(u.cards)) ? u.cards.filter(c => c && !c.deleted) : []; }
function cardKindLabel(k) { return k === "business" ? "🏢 company" : "👤 personal"; }
function myCardsCard() {
  const u = (typeof curUser === "function") ? curUser() : null;
  if (!u) return "";   // signed out → device-only, nowhere to save
  const cards = cardMyList();
  const row = c => `<div class="row" style="align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:10px">
      <span class="grow">💳 <b>••••${esc(cardClean4(c.last4))}</b>${c.label ? ` <span class="sub">· ${esc(c.label)}</span>` : ""} <span class="sub">· ${cardKindLabel(c.kind)}</span></span>
      <button class="btn ghost sm" onclick="cardMyEdit('${esc(c.id)}')">Edit</button>
      <button class="btn danger sm" onclick="cardMyRemove('${esc(c.id)}')">✕</button>
    </div>`;
  let h = `<h2>💳 My cards</h2>
    <div class="card"><div class="sub" style="margin-bottom:8px;white-space:normal">Save the <b>last 4 digits</b> of the card(s) you buy with. When a receipt shows those 4 digits, the app knows it was <b>you</b> who paid and marks it to reimburse you — no more picking "Who paid?" by hand. <b>Only the last 4 are stored</b> — never the full number, CVV, or expiry.</div>`;
  if (!cards.length) h += `<div class="muted" style="margin:0 0 8px">No cards saved yet — add one so your receipts auto-attribute to you.</div>`;
  else h += `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px">` + cards.map(row).join("") + `</div>`;
  h += `<button class="btn acc sm" onclick="cardMyAdd()">+ Add a card</button></div>`;
  return h;
}
function cardSelfSave() { const u = (typeof curUser === "function") ? curUser() : null; if (!u) return; if (typeof touch === "function") touch(u); if (typeof save === "function") save(); if (typeof render === "function") render(); }
window.cardMyAdd = function () {
  const u = (typeof curUser === "function") ? curUser() : null; if (!u) { alert("Sign in to save your cards."); return; }
  const raw = prompt("Last 4 digits of the card:"); if (raw == null) return;
  const n = cardNorm4(raw);
  if (!n.last4) { alert("Enter the last 4 digits (numbers only)."); return; }
  if (n.truncated) alert("We store only the last 4 digits — saved ••••" + n.last4 + ".");
  const label = (prompt("A label for this card (optional, e.g. “my Visa”):") || "").trim().slice(0, 40);
  if (!Array.isArray(u.cards)) u.cards = [];
  u.cards.push({ id: "card_" + (typeof uid === "function" ? uid() : Date.now()), last4: n.last4, label: label, kind: "personal", addedAt: (typeof now === "function" ? now() : Date.now()) });
  if (typeof logChange === "function") logChange("update", "account", u.id, "Added a card ••••" + n.last4);
  cardSelfSave();
};
window.cardMyEdit = function (id) {
  const u = (typeof curUser === "function") ? curUser() : null; if (!u) return;
  const c = (u.cards || []).find(x => x && x.id === id); if (!c) return;
  const raw = prompt("Last 4 digits:", cardClean4(c.last4)); if (raw == null) return;
  const n = cardNorm4(raw);
  if (!n.last4) { alert("Enter the last 4 digits (numbers only)."); return; }
  if (n.truncated) alert("We store only the last 4 digits — saved ••••" + n.last4 + ".");
  const label = prompt("Label (optional):", c.label || ""); if (label == null) return;
  c.last4 = n.last4; c.label = label.trim().slice(0, 40);
  if (typeof logChange === "function") logChange("update", "account", u.id, "Edited a card ••••" + n.last4);
  cardSelfSave();
};
window.cardMyRemove = function (id) {
  const u = (typeof curUser === "function") ? curUser() : null; if (!u) return;
  const c = (u.cards || []).find(x => x && x.id === id); if (!c) return;
  if (!confirm("Remove card ••••" + cardClean4(c.last4) + "? Receipts already filed keep who they were attributed to.")) return;
  c.deleted = true;   // soft-delete: the cards sub-array rides account LWW (replaced wholesale) so a tombstone is the safe signal
  if (typeof logChange === "function") logChange("delete", "account", u.id, "Removed a card ••••" + cardClean4(c.last4));
  cardSelfSave();
};

/* ============================== PHASE 1b — "💳 Company cards" (org Admin) ==============================
   Mirrors js/32's managed-vehicle list: registry[org].businessCards, gated by canManageVehicles() (owner /
   settings-manager). The server protects it server-side via REG_ADMIN_FIELDS (a crew write is reverted). */
function cardCanManageBiz() { return (typeof canManageVehicles === "function") ? canManageVehicles() : ((typeof isOwner === "function") && isOwner()); }
function orgBizCardsReg() { return (typeof orgVehiclesReg === "function") ? orgVehiclesReg() : ((typeof S !== "undefined" && S && Array.isArray(S.registry)) ? S.registry.find(r => r && r.id === S.biz) : null); }
function orgBusinessCards() { const r = orgBizCardsReg(); return (r && Array.isArray(r.businessCards)) ? r.businessCards : []; }
function bizCardCard() {
  const cards = orgBusinessCards().filter(c => c && !c.deleted);
  const row = c => `<div class="row" style="align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:10px">
      <span class="grow">💳 <b>••••${esc(cardClean4(c.last4))}</b>${c.label ? ` <span class="sub">· ${esc(c.label)}</span>` : ""}${c.active === false ? ` <span class="badge" style="background:var(--soft);color:var(--muted)">retired</span>` : ""}</span>
      <button class="btn ghost sm" onclick="bizCardEdit('${esc(c.id)}')">Edit</button>
      <button class="btn ghost sm" onclick="bizCardToggleActive('${esc(c.id)}')">${c.active === false ? "Reactivate" : "Retire"}</button>
      <button class="btn danger sm" onclick="bizCardRemove('${esc(c.id)}')">✕</button>
    </div>`;
  let h = `<div class="card"><div class="nm" style="font-size:15px">💳 Company cards for ${esc(typeof orgName === "function" ? orgName(S.biz) : S.biz)}</div>
    <div class="sub" style="margin-bottom:8px;white-space:normal">The shared business card(s) — last 4 digits only. A receipt on a company card is tracked but <b>not</b> reimbursed to whoever swiped it (it's the business's money). <b>Only the last 4 are stored.</b></div>`;
  if (!cards.length) h += `<div class="muted" style="margin:0 0 6px">No company cards yet — add one below.</div>`;
  else h += `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:6px">` + cards.map(row).join("") + `</div>`;
  h += `<button class="btn acc sm" onclick="bizCardAdd()">+ Add company card</button></div>`;
  return h;
}
function bizCardSave() { const r = orgBizCardsReg(); if (!r) return; if (typeof touch === "function") touch(r); else r.updatedAt = (typeof now === "function" ? now() : Date.now()); if (typeof save === "function") save(); if (typeof scheduleAutoPush === "function") scheduleAutoPush(); if (typeof render === "function") render(); }
window.bizCardAdd = function () {
  if (!cardCanManageBiz()) { alert("Owner or settings-manager only."); return; }
  const raw = prompt("Last 4 digits of the company card:"); if (raw == null) return;
  const n = cardNorm4(raw);
  if (!n.last4) { alert("Enter the last 4 digits (numbers only)."); return; }
  if (n.truncated) alert("We store only the last 4 digits — saved ••••" + n.last4 + ".");
  const label = (prompt("A label for this card (optional, e.g. “business Amex”):") || "").trim().slice(0, 40);
  const r = orgBizCardsReg(); if (!r) return; if (!Array.isArray(r.businessCards)) r.businessCards = [];
  r.businessCards.push({ id: "bcard_" + (typeof uid === "function" ? uid() : Date.now()), last4: n.last4, label: label, active: true, addedAt: (typeof now === "function" ? now() : Date.now()) });
  if (typeof logChange === "function") logChange("update", "account", S.biz, "Added company card ••••" + n.last4);
  bizCardSave();
};
window.bizCardEdit = function (id) {
  if (!cardCanManageBiz()) { alert("Owner or settings-manager only."); return; }
  const c = orgBusinessCards().find(x => x && x.id === id); if (!c) return;
  const raw = prompt("Last 4 digits:", cardClean4(c.last4)); if (raw == null) return;
  const n = cardNorm4(raw);
  if (!n.last4) { alert("Enter the last 4 digits (numbers only)."); return; }
  if (n.truncated) alert("We store only the last 4 digits — saved ••••" + n.last4 + ".");
  const label = prompt("Label (optional):", c.label || ""); if (label == null) return;
  c.last4 = n.last4; c.label = label.trim().slice(0, 40);
  if (typeof logChange === "function") logChange("update", "account", S.biz, "Edited company card ••••" + n.last4);
  bizCardSave();
};
window.bizCardToggleActive = function (id) {
  if (!cardCanManageBiz()) { alert("Owner or settings-manager only."); return; }
  const c = orgBusinessCards().find(x => x && x.id === id); if (!c) return;
  c.active = c.active === false ? true : false;
  if (typeof logChange === "function") logChange("update", "account", S.biz, (c.active ? "Reactivated" : "Retired") + " company card ••••" + cardClean4(c.last4));
  bizCardSave();
};
window.bizCardRemove = function (id) {
  if (!cardCanManageBiz()) { alert("Owner or settings-manager only."); return; }
  const c = orgBusinessCards().find(x => x && x.id === id); if (!c) return;
  if (!confirm("Remove company card ••••" + cardClean4(c.last4) + "? Receipts already filed keep their attribution.")) return;
  c.deleted = true;   // soft-delete rides registry LWW (the sub-array is replaced wholesale)
  if (typeof logChange === "function") logChange("delete", "account", S.biz, "Removed company card ••••" + cardClean4(c.last4));
  bizCardSave();
};

/* ============================== PHASE 3 — match → PRE-SELECT "Who paid?" (edit modal add-on) ==============================
   Called by js/87 rcptEditOpen after the modal mounts (into #rcpt_card_slot) and again on every keystroke of the
   card field (rcptCardInput → cardMatchRefresh). PURELY a default: it sets the dropdown value + shows a note; it
   NEVER writes. Save reads whatever the dropdown shows and routes via the UNCHANGED rcptApplyEdit — so a manual
   choice always wins. Only pre-selects while the dropdown is still on Business ("" = untouched), never clobbering
   a choice the owner has made. */
window.cardMatchInit = function (rec) {
  cardMatchRender((rec && rec.cardLast4) || "", true);   // initial pass: allowed to pre-select the empty dropdown
};
window.cardMatchRefresh = function () {
  const v = (typeof val === "function") ? val("rcpt_card4") : "";
  cardMatchRender(v, true);
};
function cardMatchRender(rawLast4, mayPreselect) {
  const slot = document.getElementById("rcpt_card_slot"); if (!slot) return;
  const sel = document.getElementById("rcpt_paidby");
  const n = cardNorm4(rawLast4);
  if (!n.last4) { slot.innerHTML = ""; return; }
  const res = cardOwner(n.last4);
  const dots = "••••" + n.last4;
  let h = "";
  if (res.resolution === "personal") {
    const un = (typeof userName === "function") ? userName(res.ownerId) : res.ownerId;
    if (mayPreselect && sel && (sel.value || "") === "") sel.value = res.ownerId;   // pre-select — untouched only
    h = `<div class="sub" style="margin:6px 0 0;color:var(--accent);white-space:normal">✓ auto-matched ${esc(dots)} → <b>${esc(un)}</b>'s personal card — set to reimburse them (change "Who paid?" to override).</div>`;
  } else if (res.resolution === "business") {
    if (mayPreselect && sel && (sel.value || "") === "") sel.value = "";   // company card → Business (no reimburse)
    const lbl = (res.matches[0] && res.matches[0].label) ? " (" + esc(res.matches[0].label) + ")" : "";
    h = `<div class="sub" style="margin:6px 0 0;color:var(--accent);white-space:normal">✓ auto-matched ${esc(dots)} → company card${lbl} — kept on <b>Business card</b> (no reimburse).</div>`;
  } else if (res.resolution === "ambiguous") {
    const cands = [];
    res.matches.forEach(m => { if (m.kind === "personal" && cands.indexOf(m.ownerId) < 0) cands.push(m.ownerId); });
    h = `<div class="sub" style="margin:6px 0 0;white-space:normal">More than one person saved ${esc(dots)} — pick who paid:</div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px">` +
      cands.map(id => `<button class="btn ghost sm" onclick="cardMatchPick('${esc(id)}')">${esc((typeof userName === "function") ? userName(id) : id)}</button>`).join("") + `</div>`;
  } else {
    h = `<div class="sub" style="margin:6px 0 0;white-space:normal">Unknown card ${esc(dots)} — whose is this?</div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px">
        <button class="btn ghost sm" onclick="cardMatchSaveTo('__me__')">Save ${esc(dots)} to me</button>
        <button class="btn ghost sm" onclick="cardMatchSaveTo('__pick__')">Save to a user…</button>
      </div>`;
  }
  slot.innerHTML = h;
}
window.cardMatchPick = function (ownerId) {
  const sel = document.getElementById("rcpt_paidby"); if (sel) sel.value = ownerId;   // owner's manual pick — no write
  const slot = document.getElementById("rcpt_card_slot");
  if (slot) slot.innerHTML = `<div class="sub" style="margin:6px 0 0;color:var(--accent)">✓ set to reimburse <b>${esc((typeof userName === "function") ? userName(ownerId) : ownerId)}</b> — Save to confirm.</div>`;
};
/* one-tap "save this unknown card to a user", then re-run the match. Saving to ME is a self-write (always sticks).
   Saving to ANOTHER user writes their u.cards — that persists server-side for a verified OWNER (owner bypasses
   sanitizeUserWrites); an admin's cross-user write would be reverted by the server, so a non-owner is told to have
   that person add it in their own Settings. */
window.cardMatchSaveTo = function (whoRaw) {
  const n = cardNorm4((typeof val === "function") ? val("rcpt_card4") : "");
  if (!n.last4) { alert("Enter the card's last 4 first."); return; }
  let target = null;
  if (whoRaw === "__me__") { target = (typeof curUser === "function") ? curUser() : null; }
  else if (whoRaw === "__pick__") {
    const members = (typeof rcptMembers === "function") ? rcptMembers() : ((typeof schedMembers === "function") ? schedMembers() : []);
    const list = members.filter(u => u && u.id);
    if (!list.length) { alert("No teammates to assign to."); return; }
    const who = prompt("Save ••••" + n.last4 + " to which user? Type their name:\n" + list.map(u => "· " + (u.username || u.id)).join("\n"));
    if (who == null) return;
    const q = String(who).trim().toLowerCase();
    target = list.find(u => String(u.username || "").toLowerCase() === q) || list.find(u => String(u.username || "").toLowerCase().indexOf(q) >= 0) || null;
    if (!target) { alert("No user matched “" + who + "”."); return; }
    const me = (typeof curUser === "function") ? curUser() : null;
    if (target.id !== (me && me.id) && !(me && me.superAdmin) && !(typeof isOwner === "function" && isOwner())) {
      alert("Only an owner can save a card to someone else's account. Ask " + (target.username || "them") + " to add it in their own Settings → My cards.");
      return;
    }
  } else { target = null; }
  if (!target) { alert("Couldn't find that account."); return; }
  if (!Array.isArray(target.cards)) target.cards = [];
  if (!target.cards.some(c => c && !c.deleted && cardClean4(c.last4) === n.last4)) {
    target.cards.push({ id: "card_" + (typeof uid === "function" ? uid() : Date.now()), last4: n.last4, label: "", kind: "personal", addedAt: (typeof now === "function" ? now() : Date.now()) });
    if (typeof touch === "function") touch(target);
    if (typeof logChange === "function") logChange("update", "account", target.id, "Saved a card ••••" + n.last4);
    if (typeof save === "function") save();
  }
  cardMatchRefresh();   // re-run the match now that the card is known → pre-selects the owner
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { cardOwner: cardOwner, cardNorm4: cardNorm4, cardClean4: cardClean4, cardIsValid4: cardIsValid4 };
}
