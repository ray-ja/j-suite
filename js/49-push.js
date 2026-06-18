/* ---------- WEB PUSH (client subscribe + iOS enable-notifications prompt) ----------
   Subscribes the device to push and stores the subscription on the account record (u.pushSubs[]),
   so it rides the existing per-record account LWW sync — no new collection. v1 = tickle: the server
   sends a contentless push, the SW shows "Cap: new message — tap to open". iOS needs the app INSTALLED
   to the home screen + notifications granted, so the prompt guides Chase/Pierce through it. Inert
   unless the server has VAPID keys (GET /api/push/pubkey 404s) and messaging is on. */

function pushSupported() { return ("serviceWorker" in navigator) && ("PushManager" in window) && (typeof Notification !== "undefined"); }
function isIOS() { return /iP(hone|ad|od)/.test(navigator.userAgent || ""); }
function isStandalone() { return (navigator.standalone === true) || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches); }
function pushGrantedForMe() {
  const u = (typeof curUser === "function") ? curUser() : null;
  return !!(u && Array.isArray(u.pushSubs) && u.pushSubs.length) && (typeof Notification !== "undefined" && Notification.permission === "granted");
}
function urlB64ToUint8(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s), arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

window.enablePush = async function () {
  try {
    if (isIOS() && !isStandalone()) { alert("To get alerts on iPhone:\n1) Tap the Share button (□↑)\n2) Add to Home Screen\n3) Open J-Suite from your home screen\n4) Come back here and tap Turn on notifications"); return; }
    if (!pushSupported() || !window.isSecureContext) { alert("Notifications need the installed app over its secure (https) address."); return; }
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") { alert("Notifications are blocked. Turn them on for this app in your phone's settings, then try again."); return; }
    const base = ((S.sync && S.sync.url) || location.origin).replace(/\/+$/, "");
    const r = await fetch(base + "/api/push/pubkey");
    if (!r.ok) { alert("Push isn't set up on the server yet — check back soon."); return; }
    const key = (await r.json()).key;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(key) });
    const u = (typeof curUser === "function") ? curUser() : null;
    if (!u) { alert("Sign in first."); return; }
    const j = JSON.parse(JSON.stringify(sub));   // {endpoint, keys:{p256dh,auth}}
    u.pushSubs = (u.pushSubs || []).filter(s => s && s.endpoint !== j.endpoint);
    u.pushSubs.push(j);
    touch(u); save();
    alert("Notifications are on — you'll get a ping when Cap messages.");
    if (typeof render === "function") render();
  } catch (e) { alert("Couldn't turn on notifications: " + (e && e.message ? e.message : e)); }
};

/* ===== APP-WIDE enable-notifications banner =====
   Surfaces on every tab (sibling of #view, so it survives tab re-renders), prominent + dismissable.
   State 1 (iOS, not installed) → "Install for full features" (Add-to-Home-Screen help).
   State 2 (installed/desktop, permission ungranted) → "Turn on notifications" CTA.
   State 3 (granted) → hidden. Dismiss (×) hides it for THIS session; it returns on next app open.
   Only enables push via an explicit tap — never auto-prompts mid-task. */
let _pushBannerDismissed = false;
window.dismissPushBanner = function () { _pushBannerDismissed = true; const b = document.getElementById("pushbanner"); if (b) b.style.display = "none"; };
window.pushInstallHelp = function () { alert("To get message alerts on iPhone:\n1) Tap the Share button (the box with an up-arrow)\n2) Add to Home Screen\n3) Open J-Suite from your home screen\n4) Tap “Turn on” here"); };
function pushBannerState() {
  if (typeof msgEnabled === "function" && !msgEnabled()) return null;   // messaging off → no point nagging
  if (pushGrantedForMe()) return null;                                  // already on → hide
  if (isIOS() && !isStandalone()) return "install";                    // must add to home screen first
  if (typeof Notification !== "undefined" && window.isSecureContext && Notification.permission !== "granted") return "grant";
  return null;                                                          // unsupported (non-iOS) / not secure → nothing to offer
}
function renderPushBanner() {
  const st = _pushBannerDismissed ? null : pushBannerState();
  let b = document.getElementById("pushbanner");
  if (!st) { if (b) b.style.display = "none"; return; }
  if (!b) {
    b = document.createElement("div"); b.id = "pushbanner";
    const v = document.getElementById("view");
    if (v && v.parentNode) v.parentNode.insertBefore(b, v); else document.body.appendChild(b);
  }
  b.style.display = "";
  b.setAttribute("style", "display:flex;align-items:center;gap:8px;background:var(--accent,#1B2A4E);color:#fff;padding:9px 12px;font:600 13px system-ui,-apple-system,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.22)");
  const install = st === "install";
  const msg = install ? "📲 Install J-Suite to get message alerts" : "🔔 Turn on notifications for messages";
  const cta = install ? "How" : "Turn on";
  const act = install ? "pushInstallHelp()" : "enablePush()";
  b.innerHTML = `<span style="flex:1;line-height:1.3">${msg}</span>`
    + `<button onclick="${act}" style="background:#fff;color:var(--accent,#1B2A4E);border:none;border-radius:6px;padding:6px 12px;font-weight:700;cursor:pointer;white-space:nowrap">${cta}</button>`
    + `<button onclick="dismissPushBanner()" aria-label="Dismiss" style="background:transparent;border:none;color:#fff;font-size:20px;line-height:1;cursor:pointer;padding:0 4px">×</button>`;
}
/* refresh the banner after every render (wrap render once, like js/48) so it shows on every tab */
(function () {
  if (typeof window.render === "function" && !window.__pushBannerWrapped) {
    const _r = window.render;
    window.render = function () { const o = _r.apply(this, arguments); try { renderPushBanner(); } catch (e) {} return o; };
    window.__pushBannerWrapped = true;
  }
})();
if (typeof document !== "undefined") {
  if (document.readyState !== "loading") setTimeout(function () { try { renderPushBanner(); } catch (e) {} }, 0);
  else document.addEventListener("DOMContentLoaded", function () { try { renderPushBanner(); } catch (e) {} });
}
