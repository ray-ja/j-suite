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

/* banner shown atop the Messages inbox until push is enabled (js/47 includes it) */
function pushPromptHTML() {
  if (typeof Notification === "undefined" && !(isIOS() && !isStandalone())) return "";
  if (pushGrantedForMe()) return "";
  const card = (title, sub, btn) => `<div class="card" style="border-left:4px solid var(--accent);margin-bottom:10px">
    <div class="nm" style="font-size:15px">🔔 ${title}</div><div class="sub" style="white-space:normal;margin-top:2px">${sub}</div>
    ${btn ? `<button class="btn acc sm" style="margin-top:8px" onclick="enablePush()">Turn on notifications</button>` : ``}</div>`;
  if (isIOS() && !isStandalone()) return card("Get notified when Cap messages", "On iPhone: tap Share → <b>Add to Home Screen</b>, open J-Suite from your home screen, then turn on notifications.", false);
  if (Notification.permission === "denied") return card("Notifications are blocked", "Turn them on for this app in your phone's settings to get message alerts.", false);
  return card("Get notified when Cap messages", "Real-time alerts so you don't have to keep checking.", true);
}
