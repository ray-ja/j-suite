/* ---------- ADMIN → 💳 CARDS (consolidated all-cards table) ----------
   Ray: "we should just [have] a table of all the cards under Admin." ONE place under the Admin panel that shows
   EVERY card across everyone — each member's personal last-4s + the org's company cards — viewable/manageable by
   an admin, complementing the per-profile 💳 Cards section already shipped (js/94 Phase 4).

   This is a UI ROLL-UP ONLY — it REUSES the js/94 card ops + authz verbatim; it invents NO card logic and NO new
   storage/schema. Personal-card writes ride the SAME S.users self-write / verified-owner-cross-user path already
   proven safe (a manager's cross-user write would sanitize-revert, so cross-user Edit/Reassign/Remove stay
   owner/super-admin only — cardCanCross); company-card writes ride registry LWW (cardCanManageBiz). Only the
   LAST 4 is ever stored (the js/94 truncate guarantee). Mounted by rAdmin (js/32), which is already owner/
   manager-gated; this section adds its own defence-in-depth guard and never throws (returns "" on any error). */

/* PURE / offline / never-throws — aggregate the org's cards for the table + tests.
   Returns { people:[{userId,name,role,cards:[…]}], company:[…], count, peopleCount } where `count` is the total
   PERSONAL cards across every active member and `peopleCount` is how many members hold ≥1 card. */
function adminCardsData() {
  const out = { people: [], company: [], count: 0, peopleCount: 0 };
  try {
    const members = (typeof teamMembers === "function")
      ? teamMembers()
      : ((typeof S !== "undefined" && S && Array.isArray(S.users)) ? S.users.filter(u => u && !u.kind && !u.deleted && u.active !== false) : []);
    members.forEach(u => {
      if (!u || !u.id) return;
      const cards = (typeof cardListFor === "function")
        ? cardListFor(u.id)
        : (Array.isArray(u.cards) ? u.cards.filter(c => c && !c.deleted) : []);
      if (!cards.length) return;
      const role = (typeof teamRoleKey === "function") ? teamRoleKey(u) : (u.role || "crew");
      out.people.push({ userId: u.id, name: u.name || u.username || u.id, role: role, cards: cards });
      out.count += cards.length;
    });
    out.peopleCount = out.people.length;
    out.company = (typeof orgBusinessCards === "function") ? orgBusinessCards().filter(c => c && !c.deleted) : [];
  } catch (e) {}
  return out;
}
if (typeof window !== "undefined") window.adminCardsData = adminCardsData;

/* THE CONSOLIDATED SECTION — mounted from js/32 rAdmin. Owner/manager-gated (rAdmin already is; this adds a
   defence-in-depth check so the function is safe to call anywhere). Groups PERSONAL cards by member, then the
   COMPANY cards (🏢), then any unassigned-on-receipts cards (js/94 unassignedCards, when that helper exists).
   Row actions call the EXISTING js/94 / js/32 handlers, each of which re-checks its own authz. */
function adminAllCardsCard() {
  try {
    const gate = ((typeof isOwner === "function") && isOwner()) || ((typeof canManageMembers === "function") && canManageMembers());
    if (!gate) return "";   // defence-in-depth: only owner/manager tier (rAdmin already enforces this)

    const data = adminCardsData();
    const cross = (typeof cardCanCross === "function") ? cardCanCross() : false;
    const canBiz = (typeof cardCanManageBiz === "function") ? cardCanManageBiz() : false;
    const kindTag = c => (c && c.kind === "business" ? "business" : "personal");

    const totalCompany = data.company.length;
    const countLine = `${data.count} personal card${data.count === 1 ? "" : "s"} across ${data.peopleCount} ${data.peopleCount === 1 ? "person" : "people"}`
      + (totalCompany ? ` · ${totalCompany} company card${totalCompany === 1 ? "" : "s"}` : "");

    let h = `<div class="card"><div class="nm" style="font-size:15px">💳 Cards</div>
      <div class="sub" style="margin-bottom:6px;white-space:normal">Every card across the team in one place — each person's saved last-4s plus the shared company card(s). <b>${esc(countLine)}.</b> Only the <b>last 4 digits</b> are ever stored.${cross ? "" : " Editing someone else's card is owner-only — ask an owner, or the person can edit it on their own profile."}</div>`;

    // ---- PERSONAL cards, grouped by member ----
    if (!data.people.length) {
      h += `<div class="muted" style="margin:2px 0 8px">No personal cards saved yet. Add one below, or from a member's profile in People &amp; Places.</div>`;
    } else {
      data.people.forEach(p => {
        const canEdit = (typeof cardCanEditFor === "function") ? cardCanEditFor(p.userId) : false;
        const badge = (typeof roleBadge === "function") ? roleBadge(p.role) : "";
        h += `<div class="sub" style="font-weight:700;margin:10px 0 4px">${esc(p.name)} ${badge}</div>
          <div style="display:flex;flex-direction:column;gap:6px">`;
        p.cards.forEach(c => {
          const last4 = (typeof cardClean4 === "function") ? cardClean4(c.last4) : c.last4;
          h += `<div class="row" style="align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;flex-wrap:wrap">
            <span class="grow" style="min-width:130px">💳 <b>••••${esc(last4)}</b>${c.label ? ` <span class="sub">· ${esc(c.label)}</span>` : ""} <span class="sub">· ${kindTag(c)}</span></span>`
            + (canEdit
                ? `<button class="btn ghost sm" onclick="cardEditForPrompt('${esc(p.userId)}','${esc(c.id)}')">Edit</button>`
                  + (cross ? `<button class="btn ghost sm" onclick="cardReassignPrompt('${esc(p.userId)}','${esc(c.id)}')">Reassign</button>` : "")
                  + `<button class="btn danger sm" onclick="cardRemoveForPrompt('${esc(p.userId)}','${esc(c.id)}')">✕</button>`
                : `<span class="sub" title="Only an owner can edit another person's card">🔒 owner-only</span>`)
            + `</div>`;
        });
        h += `</div>`;
      });
    }
    h += `<div class="row" style="margin-top:8px"><button class="btn acc sm" onclick="adminCardAddPick()">+ Add a card</button></div>`;

    // ---- COMPANY cards (🏢) ----
    h += `<div class="sub" style="font-weight:700;margin:14px 0 4px">🏢 Company${data.company.length ? "" : ` <span class="sub" style="font-weight:400">· none yet</span>`}</div>`;
    if (data.company.length) {
      h += `<div style="display:flex;flex-direction:column;gap:6px">`;
      data.company.forEach(c => {
        const last4 = (typeof cardClean4 === "function") ? cardClean4(c.last4) : c.last4;
        h += `<div class="row" style="align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;flex-wrap:wrap">
          <span class="grow" style="min-width:130px">💳 <b>••••${esc(last4)}</b>${c.label ? ` <span class="sub">· ${esc(c.label)}</span>` : ""}${c.active === false ? ` <span class="badge" style="background:var(--soft);color:var(--muted)">retired</span>` : ""}</span>`
          + (canBiz
              ? `<button class="btn ghost sm" onclick="bizCardEdit('${esc(c.id)}')">Edit</button>
                 <button class="btn ghost sm" onclick="bizCardToggleActive('${esc(c.id)}')">${c.active === false ? "Reactivate" : "Retire"}</button>
                 <button class="btn danger sm" onclick="bizCardRemove('${esc(c.id)}')">✕</button>`
              : `<span class="sub" title="Owner or settings-manager only">🔒 admin-only</span>`)
          + `</div>`;
      });
      h += `</div>`;
    }
    if (canBiz) h += `<div class="row" style="margin-top:8px"><button class="btn acc sm" onclick="bizCardAdd()">+ Add company card</button></div>`;

    // ---- UNASSIGNED (seen on receipts, not linked to anyone) — reuse js/94 unassignedCards / cardDbAssign ----
    if (typeof unassignedCards === "function") {
      const un = unassignedCards();
      if (un && un.length) {
        h += `<div class="sub" style="font-weight:700;margin:14px 0 4px">🧾 Seen on receipts, not assigned <span class="badge" style="background:#e0a800;color:#fff">${un.length}</span></div>
          <div class="sub" style="margin-bottom:6px;white-space:normal">These last-4s appear on receipts but aren't linked to anyone. Assign each to the person who paid (to reimburse them) or mark it a company card — every matching receipt then attributes automatically.</div>
          <div style="display:flex;flex-direction:column;gap:6px">`;
        un.forEach(c => {
          const vend = (c.vendors && c.vendors.length) ? c.vendors.join(", ") : "";
          const dt = c.lastDate ? ((typeof fmtDate === "function") ? fmtDate(c.lastDate) : c.lastDate) : "";
          const meta = [c.count + " receipt" + (c.count === 1 ? "" : "s"), vend, dt ? "last " + dt : ""].filter(Boolean).join(" · ");
          h += `<div class="row" style="align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;flex-wrap:wrap">
            <span class="grow" style="min-width:150px">💳 <b>••••${esc(c.last4)}</b> <span class="sub">· ${esc(meta)}</span></span>
            <button class="btn acc sm" onclick="cardDbAssignPrompt('${esc(c.last4)}')">Assign to…</button>
            <button class="btn ghost sm" onclick="cardDbAssignBusiness('${esc(c.last4)}')">Company card</button>
          </div>`;
        });
        h += `</div>`;
      }
    }

    h += `</div>`;
    return h;
  } catch (e) { return ""; }
}
if (typeof window !== "undefined") window.adminAllCardsCard = adminAllCardsCard;

/* "+ Add a card" from the Admin table — pick a member, then hand off to js/94's cardAddForPrompt (which prompts
   last-4/label and re-checks authz). Owner/super-admin may add for anyone (cross-user survives sync); everyone
   else may add for themselves only (a manager's cross-user write would sanitize-revert — so we keep it self-only,
   exactly like cardCanCross). Reuses the same name-picker shape as cardReassignPrompt. */
window.adminCardAddPick = function () {
  const me = (typeof curUser === "function") ? curUser() : null;
  const cross = (typeof cardCanCross === "function") ? cardCanCross() : false;
  if (!cross) {   // self-only — add to my own profile (self-write always sticks)
    if (!me) { alert("Sign in to add a card."); return; }
    if (typeof cardAddForPrompt === "function") cardAddForPrompt(me.id);
    return;
  }
  const members = (typeof teamMembers === "function")
    ? teamMembers()
    : ((typeof S !== "undefined" && S && Array.isArray(S.users)) ? S.users.filter(u => u && !u.kind && !u.deleted) : []);
  const list = members.filter(u => u && u.id);
  if (!list.length) { alert("No members to add a card for."); return; }
  const who = prompt("Add a card for which person? Type their name:\n" + list.map(u => "· " + (u.name || u.username || u.id)).join("\n"));
  if (who == null) return;
  const q = String(who).trim().toLowerCase();
  const target = list.find(u => String(u.name || u.username || "").toLowerCase() === q)
    || list.find(u => String(u.name || u.username || "").toLowerCase().indexOf(q) >= 0)
    || null;
  if (!target) { alert("No member matched “" + who + "”."); return; }
  if (typeof cardAddForPrompt === "function") cardAddForPrompt(target.id);
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { adminCardsData: adminCardsData, adminAllCardsCard: adminAllCardsCard };
}
