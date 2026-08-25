/* ---------- TO-DO PROPOSALS (js/137) — what the nightly reconciler noticed ---------------------------
   Ray, 2026-08-24: "is there a subagent that reads my journal entries and manages my to do list?"

   Sentinel's reconcile checker reads his journal against his open to-dos each night and PROPOSES: close
   what the journal says is finished, flag what has gone stale, add what he committed to but never wrote
   down. Proposals land in `pendingChanges` via /api/ceo/propose, which is whitelist-enforced server-side
   and cannot apply anything by itself.

   ⚠️ WHY THIS MODULE EXISTS AT ALL. The existing approvals screen (js/57) lists proposals from
   `APPR_BIZES = ["obx", "jam"]` — a hardcoded legacy pair — and the personal org deliberately has no
   Approvals tab. So a proposal aimed at the personal org would be written to the server and then be
   completely invisible: the reconciler would run nightly into a void. Rather than bolt an Approvals tab
   onto his life app (the minimalism there is deliberate), the proposals surface where they belong — on the
   To-Do list they are about.

   ⭐ IT REUSES js/57's apprApprove/apprReject VERBATIM. Those take (biz, id) and are org-agnostic; only the
   LISTING was hardcoded. So the proven apply path — idempotent create, target-checked update, status
   stamping, logChange, save — is not duplicated here. This file is a listing and a card, nothing more. */

/* pending to-do proposals in the CURRENT org, newest first */
function tpPending() {
  try {
    const org = (typeof S !== "undefined" && S.biz) ? S.biz : "";
    const list = ((S[org] || {}).pendingChanges) || [];
    const live = list.filter(function (p) {
      return p && !p.deleted && p.status === "pending" && p.collection === "todos";
    }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

    /* ⚠️ DEDUPE BY WHAT IS BEING PROPOSED, not by proposal id. Before the reconciler learned to suppress
       what it had already asked (2026-08-25), it queued the same items on consecutive runs — and accepting
       both copies would have created two identical to-dos, which is the mess this whole feature exists to
       prevent. Showing one and clearing its twins on accept fixes the queue he already has without anyone
       hand-editing his data. */
    const seen = Object.create(null), out = [];
    live.forEach(function (p) {
      const k = tpDedupeKey(p);
      if (seen[k]) { seen[k].push(p); return; }
      seen[k] = [];
      p.__twins = seen[k];
      out.push(p);
    });
    return out;
  } catch (e) { return []; }
}
/* what a proposal is really about — the same job proposed twice shares a key */
function tpDedupeKey(p) {
  if (!p) return "";
  if (p.type === "create") return "add:" + String((p.after && p.after.title) || "").toLowerCase().trim();
  return String(p.type) + ":" + String(p.targetId || "");
}
function tpCount() { return tpPending().length; }

/* the card. Absent entirely when there is nothing pending — most nights there won't be. */
function tpCardHTML() {
  const list = tpPending();
  if (!list.length) return "";
  const KIND = {
    create: ["＋", "Add"],
    update: ["✓", "Close"],
    softDelete: ["✕", "Remove"]
  };
  let h = '<div class="card" style="border-left:4px solid var(--accent)">'
    + '<div class="row" style="align-items:center;gap:8px"><div class="grow" style="font-weight:800">From your journal</div>'
    + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="tpDismissAll()">Not now</button></div>'
    + '<div class="sub" style="white-space:normal;margin:4px 0 8px">Nothing changes unless you tap it.</div>';
  list.forEach(function (p) {
    const k = KIND[p.type] || ["•", "Change"];
    /* the summary already carries the evidence the reconciler quoted — show it, that's the whole point */
    h += '<div class="li" style="align-items:flex-start">'
      + '<div class="grow"><div class="nm">' + k[0] + ' ' + esc(tpTitleOf(p)) + '</div>'
      + '<div class="sub" style="white-space:normal">' + esc(tpWhyOf(p)) + '</div></div>'
      + '<button class="btn acc sm" style="flex:0 0 auto" onclick="tpAccept(\'' + p.id + '\')">' + k[1] + '</button>'
      + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="tpReject(\'' + p.id + '\')">✕</button>'
      + '</div>';
  });
  return h + '</div>';
}

/* the thing being proposed, without the reasoning tail */
function tpTitleOf(p) {
  if (p.type === "create") return (p.after && p.after.title) || "New to-do";
  const org = (typeof S !== "undefined" && S.biz) ? S.biz : "";
  const t = (((S[org] || {}).todos) || []).find(function (x) { return x && x.id === p.targetId; });
  return (t && t.title) || "(that to-do)";
}
/* the evidence — everything after the first em dash in the summary the reconciler wrote */
function tpWhyOf(p) {
  const s = String(p.summary || "");
  const i = s.indexOf(" — ");
  return (i > 0) ? s.slice(i + 3) : s;
}

if (typeof window !== "undefined") {
  window.tpPending = tpPending;
  window.tpCount = tpCount;
  window.tpCardHTML = tpCardHTML;

  /* delegate to the SAME apply path the business approvals screen uses — no second implementation */
  window.tpAccept = function (id) {
    const org = (typeof S !== "undefined" && S.biz) ? S.biz : "";
    /* clear any duplicate proposals for the same job FIRST, so accepting can't leave a twin behind that
       would add the identical to-do a second time */
    const p = tpPending().find(function (x) { return x.id === id; });
    if (p && p.__twins && typeof apprReject === "function") {
      p.__twins.forEach(function (t) { try { apprReject(org, t.id); } catch (e) {} });
    }
    if (typeof apprApprove === "function") apprApprove(org, id);
    else if (typeof render === "function") render();
  };
  window.tpReject = function (id) {
    const org = (typeof S !== "undefined" && S.biz) ? S.biz : "";
    const p = tpPending().find(function (x) { return x.id === id; });
    if (p && p.__twins && typeof apprReject === "function") {
      p.__twins.forEach(function (t) { try { apprReject(org, t.id); } catch (e) {} });   // dismiss the twins too
    }
    if (typeof apprReject === "function") apprReject(org, id);
    else if (typeof render === "function") render();
  };
  window.tpDismissAll = function () {
    if (!confirm("Dismiss all of these? They won't come back.")) return;
    const org = (typeof S !== "undefined" && S.biz) ? S.biz : "";
    tpPending().forEach(function (p) {
      if (typeof apprReject !== "function") return;
      (p.__twins || []).forEach(function (t) { try { apprReject(org, t.id); } catch (e) {} });   // twins too
      apprReject(org, p.id);
    });
    if (typeof render === "function") render();
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { tpTitleOf: tpTitleOf, tpWhyOf: tpWhyOf, tpDedupeKey: tpDedupeKey };
}
