/* ---------- OFF DUTY (js/182) — one tap pauses every ad; one tap turns them back on ----------
   Ray, 2026-09-20 (a Sunday, heading to the beach): "I won't be able to answer the phone so I don't want us listed as
   open, and we shouldn't pay for ads right now either. How fast can we flip that switch?"
   This card sits at the top of Today for the owner. It reads the live campaign state from Google Ads through the
   server (GET /api/ads/duty) and flips ALL campaigns on the org's account (search + Local Services) with one POST.
   The Google Business Profile "open now" label has no API hookup here; the card links to the GBP app instead. */
if (typeof window !== "undefined") {
  window.DUTY = window.DUTY || { state: null, busy: false, err: "" };
  function dutyHdr() { return { "Content-Type": "application/json", "Authorization": "Bearer " + ((typeof S !== "undefined" && S.sync && S.sync.token) || "") }; }
  function dutyOrg() { return (typeof S !== "undefined" && S.biz) || "obx"; }
  function dutyIsOwner() { try { const u = (typeof curUser === "function") ? curUser() : null; return !!(u && (u.superAdmin || u.role === "owner")); } catch (e) { return false; } }
  window.dutyRefresh = function () {
    if (!dutyIsOwner()) return;
    fetch("./api/ads/duty?org=" + encodeURIComponent(dutyOrg()), { headers: dutyHdr() }).then(r => r.json()).then(j => {
      if (j && j.ok) { DUTY.state = j; DUTY.err = ""; } else { DUTY.err = (j && j.error) || "no answer"; }
      const el = document.getElementById("duty_card"); if (el) el.outerHTML = window.offDutyCardHTML();
    }).catch(() => { DUTY.err = "offline"; const el = document.getElementById("duty_card"); if (el) el.outerHTML = window.offDutyCardHTML(); });
  };
  window.dutySet = function (on) {
    if (DUTY.busy) return;
    DUTY.busy = true; const el = document.getElementById("duty_card"); if (el) el.outerHTML = window.offDutyCardHTML();
    fetch("./api/ads/duty", { method: "POST", headers: dutyHdr(), body: JSON.stringify({ org: dutyOrg(), on: !!on }) }).then(r => r.json()).then(j => {
      DUTY.busy = false;
      if (j && j.ok) { DUTY.state = j; DUTY.err = ""; if (typeof toast === "function") toast(on ? "Ads are back on" : "Ads paused. Nothing is spending."); }
      else { DUTY.err = (j && j.error) || "no answer"; if (typeof toast === "function") toast("Couldn't reach Google Ads: " + DUTY.err); }
      const el2 = document.getElementById("duty_card"); if (el2) el2.outerHTML = window.offDutyCardHTML();
    }).catch(() => { DUTY.busy = false; DUTY.err = "offline"; const el2 = document.getElementById("duty_card"); if (el2) el2.outerHTML = window.offDutyCardHTML(); });
  };
  window.offDutyCardHTML = function () {
    if (!dutyIsOwner()) return "";
    const st = DUTY.state;
    if (!st && !DUTY.err) { setTimeout(window.dutyRefresh, 50); }
    const on = st ? !!st.on : null;
    const names = st ? (st.campaigns || []).map(c => (c.name.indexOf("LocalServices") === 0 ? "Local Services" : c.name) + " " + (c.status === "ENABLED" ? "on" : "paused")).join(" · ") : "";
    const line = DUTY.busy ? "Flipping…" : (on === null ? (DUTY.err ? "Google Ads: " + esc(DUTY.err) : "Checking Google Ads…") : (on ? "Ads are <b>running</b>. " : "Ads are <b>paused</b>. Nothing is spending. ") + "<span class=\"sub\">" + esc(names) + "</span>");
    const btn = on === null ? "" : (on
      ? `<button class="btn" style="flex:0 0 auto;background:var(--danger);color:#fff" onclick="dutySet(false)" ${DUTY.busy ? "disabled" : ""}>⏸ Off duty</button>`
      : `<button class="btn acc" style="flex:0 0 auto" onclick="dutySet(true)" ${DUTY.busy ? "disabled" : ""}>▶ Back on</button>`);
    return `<div class="card" id="duty_card" style="border-left:4px solid ${on === false ? "var(--danger)" : "var(--accent)"}"><div class="row" style="gap:10px;align-items:center"><div class="grow"><div class="nm" style="font-size:15px">${on === false ? "🏖 Off duty" : "📣 Ads"}</div><div class="sub" style="white-space:normal">${line}</div><div class="sub" style="white-space:normal;margin-top:4px">Google's "Open now" label is set in the <a href="https://business.google.com/" target="_blank" rel="noopener">Business Profile app</a>: Hours → special hours for today → Closed.</div></div>${btn}</div></div>`;
  };
}
