/* ---------- MESSAGE TEMPLATES (customer comms — copy / share / text / email) ----------
   Canned, mobile-first messages the crew can fire off in one tap. Pure UI: templates are a
   static catalog (no synced collection / no data-layer change). Placeholders auto-fill from the
   customer + business + signed-in user; the message stays fully editable before sending.
   Reachable from the customer card ("Message"). Rides the review-request copy pattern (js/18). */

const MSG_TEMPLATES = [
  { id: "otw",     label: "On our way",            body: "Hi [name], this is [you] with [biz] — we're on our way and should be there shortly. See you soon!" },
  { id: "remind",  label: "Appointment reminder",  body: "Hi [name], a quick reminder from [biz]: we're scheduled to take care of your job on [date]. Reply here if anything's changed — thanks!" },
  { id: "qfollow", label: "Quote follow-up",       body: "Hi [name], [you] here with [biz] — just following up on your quote for [total]. Happy to answer any questions or get you on the schedule whenever you're ready. Thank you!" },
  { id: "done",    label: "Job complete",          body: "Hi [name], all finished at your property today — thank you for choosing [biz]! Let us know if anything needs a second look." },
  { id: "invrem",  label: "Invoice / payment reminder", body: "Hi [name], a friendly reminder from [biz]: your invoice for [total] is ready. You can pay at your convenience — reply here if you have any questions. Thank you!" },
  { id: "thanks",  label: "Thank you + review ask", body: "Hi [name], thank you for trusting [biz]! If you were happy with the work, a quick Google review is the biggest help for our small local business: [link]\n\nThank you so much! — [you]" }
];

/* fill [placeholders] from a context object; unknown/empty tokens are left as a clear bracket hint */
function msgFill(body, v) {
  return body
    .replace(/\[name\]/g, v.name || "there")
    .replace(/\[you\]/g, v.you || "[your name]")
    .replace(/\[biz\]/g, v.biz || "")
    .replace(/\[bizphone\]/g, v.bizphone || "")
    .replace(/\[total\]/g, v.total || "[amount]")
    .replace(/\[date\]/g, v.date || "[date]")
    .replace(/\[link\]/g, v.link || "[your review link]");
}

/* context for the composer, gathered from a customer (+ optional quote/job extras) */
function msgCtx(cust, extra) {
  const u = (typeof curUser === "function") ? curUser() : null;
  const rl = (typeof S !== "undefined" && S.obx && S.obx.docs) ? S.obx.docs.find(x => x.id === "reviewlink" && !x.deleted) : null;
  return Object.assign({
    name: (cust && (cust.name || cust.company)) || "",
    phone: (cust && cust.phone) || "",
    email: (cust && cust.email) || "",
    you: (u && u.username) || "",
    biz: BIZ[S.biz] ? BIZ[S.biz].name : "",
    bizphone: BIZ[S.biz] ? (BIZ[S.biz].phone || "") : "",
    link: rl ? rl.text : ""
  }, extra || {});
}

window.openMessageComposer = function (custId, extra) {
  const d = D();
  const cust = custId ? d.customers.find(x => x.id === custId) : null;
  const ctx = msgCtx(cust, extra);
  const first = MSG_TEMPLATES[0];
  const opts = MSG_TEMPLATES.map(t => `<option value="${t.id}">${esc(t.label)}</option>`).join("");
  modal("Message" + (ctx.name ? " — " + esc(ctx.name) : ""), `
    <p class="muted" style="margin:0 0 8px">Pick a template, tweak it, then copy or send. Names auto-fill from the customer.</p>
    <label>Template</label>
    <select id="mt_pick" onchange="msgApplyTemplate()">${opts}</select>
    <label style="margin-top:10px">Message</label>
    <textarea id="mt_body" style="min-height:150px">${esc(msgFill(first.body, ctx))}</textarea>
    <div class="row" style="gap:8px;margin-top:10px">
      <button class="btn acc grow" onclick="msgCopy()">Copy</button>
      ${navigator.share ? `<button class="btn ghost grow" onclick="msgShare()">Share…</button>` : ``}
    </div>
    <div class="row" style="gap:8px;margin-top:8px">
      ${ctx.phone ? `<button class="btn ghost sm grow" onclick="msgText()">💬 Text</button>` : ``}
      ${ctx.email ? `<button class="btn ghost sm grow" onclick="msgEmail()">✉️ Email</button>` : ``}
    </div>
    ${(!ctx.phone && !ctx.email) ? `<p class="sub" style="margin-top:8px">No phone or email on file — copy the message and paste it into your texting app.</p>` : ``}`);
  // stash context for the action buttons
  window._MT = ctx;
};

window.msgApplyTemplate = function () {
  const t = MSG_TEMPLATES.find(x => x.id === val("mt_pick")) || MSG_TEMPLATES[0];
  const el = document.getElementById("mt_body");
  if (el) el.value = msgFill(t.body, window._MT || {});
};
function msgText_() { const e = document.getElementById("mt_body"); return e ? e.value : ""; }
window.msgCopy = function () {
  const t = document.getElementById("mt_body"); if (!t) return;
  t.select();
  try { document.execCommand("copy"); alert("Copied — paste it into a text or email to your customer."); }
  catch (e) { alert("Select the message text and copy it manually."); }
};
window.msgShare = function () {
  if (!navigator.share) { return msgCopy(); }
  navigator.share({ text: msgText_() }).catch(function () {});
};
window.msgText = function () {
  const ctx = window._MT || {};
  const body = encodeURIComponent(msgText_());
  // sms: with a body — iOS wants "&body", most Androids accept "?body"; "?&body" works broadly.
  window.location.href = "sms:" + (ctx.phone || "").replace(/[^0-9+]/g, "") + "?&body=" + body;
};
window.msgEmail = function () {
  const ctx = window._MT || {};
  const subj = encodeURIComponent((ctx.biz || "") + " — a quick note");
  window.location.href = "mailto:" + encodeURIComponent(ctx.email || "") + "?subject=" + subj + "&body=" + encodeURIComponent(msgText_());
};
