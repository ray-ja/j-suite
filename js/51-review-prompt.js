/* ---------- REVIEW-ON-COMPLETION PROMPT (Cap #2) ----------
   The highest-ROI moment to ask for a Google review is the instant a job is marked done, while the
   customer is happy. toggleJob (js/09) calls reviewPrompt(jobId) on the done-transition. We reuse
   the existing saved review link (S.obx.docs "reviewlink", set via reviewAsk in js/18) — no new
   data, no new collection. Mobile-first: one-tap 💬 to text the request with the link prefilled. */

function reviewLink() { const dc = ((S.obx && S.obx.docs) || []).find(x => x.id === "reviewlink" && !x.deleted); return dc ? dc.text : ""; }
function reviewMsg(custName) {
  const first = (custName || "").trim().split(/\s+/)[0] || "there";
  const me = (typeof curUser === "function" && curUser()) ? curUser().username : "";
  const link = reviewLink() || "[your review link]";
  return "Hi " + first + ", thank you for trusting OBX Lot Solutions today! If you were happy with the work, "
    + "the biggest help for our small local business is a quick Google review — it takes about 20 seconds: " + link
    + (me ? "\n\nThank you so much! — " + me : "\n\nThank you so much!");
}

/* Fired on the job→done transition. OBX is the review-driven brand; jam has no review setup (yet). */
window.reviewPrompt = function (jobId) {
  if (S.biz !== "obx") return;
  const j = (D().jobs || []).find(x => x.id === jobId); if (!j) return;
  const c = (D().customers || []).find(x => x.id === j.customerId) || null;
  const who = (c && (c.name || c.company)) || j.cust || "";
  const tel = ((c && c.phone) || "").replace(/[^0-9+]/g, "");
  const link = reviewLink(), msg = reviewMsg(who);
  modal("✅ Job done — ask for a review?", `
    <p class="muted" style="margin:0 0 10px">Right now, while ${who ? esc(who.split(/\s+/)[0]) : "the customer"} is happy, is the best time. Google reviews are OBX Lot Solutions' #1 free growth.</p>
    ${!link ? `<div class="card" style="margin:0 0 10px"><div class="sub" style="white-space:normal">No review link saved yet — <a onclick="closeModal();reviewAsk()" style="color:var(--accent);cursor:pointer;font-weight:700">set it once</a> and every prompt auto-fills it.</div></div>` : ``}
    <label>Message</label><textarea id="rp_msg" style="min-height:120px">${esc(msg)}</textarea>
    <div class="row" style="gap:8px;margin-top:10px">
      ${tel ? `<button class="btn acc grow" onclick="rpText('${tel}')">💬 Text the request</button>` : ``}
      <button class="btn ghost grow" onclick="rpCopy()">📋 Copy</button>
    </div>
    <button class="btn ghost sm" style="margin-top:8px" onclick="closeModal()">Not now</button>`);
};

/* read the (possibly edited) message live, open the SMS composer prefilled */
window.rpText = function (tel) {
  const t = document.getElementById("rp_msg"); const body = encodeURIComponent(t ? t.value : reviewMsg(""));
  closeModal();
  location.href = "sms:" + tel + "?&body=" + body;
};
window.rpCopy = function () {
  const t = document.getElementById("rp_msg"); if (!t) return; t.select();
  try { document.execCommand("copy"); alert("Copied — paste into a text or email to your customer."); }
  catch (e) { alert("Select the message text and copy it manually."); }
};
