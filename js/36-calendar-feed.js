/* ---------- CALENDAR FEED (per-user .ics subscription) ----------
   A one-way mirror of the signed-in user's upcoming assigned jobs into their own Apple/Google
   calendar. Subscribe once and every future job auto-flows with reminders (1 day + 1 hour before) —
   zero per-job action. The link carries an unguessable per-account token (u.calToken); the server
   (sync-server.js → GET /calendar/<token>.ics) matches it to the account and returns a VCALENDAR.
   The token rides the existing per-record account sync (LWW), so it's available to the server once
   the user is connected. One-way only — a subscribed calendar never writes back to j-Suite. */

/* mint an unguessable 24-byte token (hex); falls back when WebCrypto is unavailable (file:// etc.) */
function calMintToken() {
  try {
    const b = new Uint8Array(24); crypto.getRandomValues(b);
    return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    let s = ""; for (let i = 0; i < 48; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s + now().toString(36);
  }
}
/* ensure the signed-in user has a feed token — minted + synced on first use */
function ensureCalToken(u) {
  if (!u) return null;
  if (!u.calToken) { u.calToken = calMintToken(); touch(u); save(); }
  return u.calToken;
}
/* the subscribe URL points at the sync server (where the calendar app will fetch it), not this device */
function calFeedUrl(u) {
  const tok = u && u.calToken; if (!tok) return "";
  const base = ((S.sync && S.sync.url) || (location.protocol.indexOf("http") === 0 ? location.origin : "")).replace(/\/+$/, "");
  return base ? base + "/calendar/" + tok + ".ics" : "";
}

/* compact card for the Schedule page (current user only) */
function calFeedCard() {
  const u = (typeof curUser === "function") ? curUser() : null;
  if (!u) return "";
  return `<div class="card" style="padding:10px 12px">
    <div class="row"><div class="grow"><div class="nm">📆 Subscribe in your calendar</div>
      <div class="sub" style="white-space:normal">Your assigned jobs flow into Apple/Google Calendar automatically, with reminders. One-way — subscribing never changes j-Suite.</div></div>
      <button class="btn ghost sm" onclick="openCalSubscribe()">${u.calToken ? "Show link" : "Set up"}</button></div>
  </div>`;
}

window.openCalSubscribe = function () {
  const u = (typeof curUser === "function") ? curUser() : null;
  if (!u) { alert("Sign in to get your personal calendar link."); return; }
  ensureCalToken(u);
  const url = calFeedUrl(u);
  modal("Subscribe in your calendar", `
    <p class="muted" style="margin-bottom:8px">A one-time setup. Subscribe to this private link once and every future job you're assigned auto-appears with reminders (1 day + 1 hour before). One-way only — your calendar never writes back to j-Suite.</p>
    ${url ? `
    <label>Your personal calendar link</label>
    <div class="row" style="gap:6px;align-items:stretch"><input id="cal_url" value="${esc(url)}" readonly onclick="this.select()" style="flex:1"><button class="btn acc sm" onclick="calCopy()">Copy</button></div>
    <p class="sub" id="cal_copied" style="min-height:16px;margin:4px 0 0"></p>
    <div class="card" style="background:var(--soft);padding:10px;margin-top:8px">
      <div class="nm" style="font-size:14px"> Apple Calendar (iPhone / iPad / Mac)</div>
      <div class="sub" style="white-space:normal">Settings → Calendar → Accounts → Add Account → Other → <b>Add Subscribed Calendar</b> — paste the link.</div>
      <div class="nm" style="font-size:14px;margin-top:10px"> Google Calendar</div>
      <div class="sub" style="white-space:normal">Google Calendar on the web → <b>Other calendars</b> → <b>＋</b> → <b>From URL</b> — paste the link, then <b>Add calendar</b>.</div>
    </div>
    <p class="sub" style="margin-top:10px;white-space:normal">Keep this link private — anyone with it can see your job schedule. <button class="btn ghost sm" style="margin-left:4px" onclick="calRotate()">Reset link</button></p>
    ` : `
    <div class="card" style="border-left:4px solid var(--accent)"><b>Connect to your server first.</b><div class="sub" style="white-space:normal">Your calendar link is served by the sync server. Sign in (or set the server URL) on the Data tab, then come back here to copy your link.</div></div>
    `}`);
};
window.calCopy = function () {
  const el = document.getElementById("cal_url"); if (!el) return;
  el.select(); let msg = "Copied ✓";
  try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(el.value); else if (!document.execCommand("copy")) msg = "Press Ctrl/Cmd+C to copy"; }
  catch (e) { try { if (!document.execCommand("copy")) msg = "Press Ctrl/Cmd+C to copy"; } catch (e2) { msg = "Press Ctrl/Cmd+C to copy"; } }
  const m = document.getElementById("cal_copied"); if (m) m.textContent = msg;
};
window.calRotate = function () {
  const u = (typeof curUser === "function") ? curUser() : null; if (!u) return;
  if (!confirm("Reset your calendar link? Your current subscription will stop updating and you'll need to re-subscribe with the new link.")) return;
  u.calToken = calMintToken(); touch(u); save(); openCalSubscribe();
};
