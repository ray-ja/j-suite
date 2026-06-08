/* ---------- PWA INSTALL ----------
   Capture Android/Chrome's install prompt so we can offer an in-app "Install" button, and give
   platform-aware guidance for iOS (Safari has no prompt event). Surfaced as a card in the Data
   tab (pwaInstallCard). Install requires a secure context — over Tailscale that means the https
   hostname (tailscale serve), not the raw http IP — see PWA-INSTALL.md. */
window.__deferredInstall = null;
window.addEventListener("beforeinstallprompt", function (e) {
  e.preventDefault();                       // stash it; we surface our own button instead
  window.__deferredInstall = e;
  if (typeof TAB !== "undefined" && TAB === "data" && typeof safeRender === "function") safeRender();
});
window.addEventListener("appinstalled", function () {
  window.__deferredInstall = null;
  if (typeof render === "function") { try { render(); } catch (e) {} }
});
function isStandalone() { return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true; }
function isIOSDevice() { return /iphone|ipad|ipod/i.test(navigator.userAgent || "") || (/Macintosh/.test(navigator.userAgent || "") && "ontouchend" in document); }
window.installApp = async function () {
  const d = window.__deferredInstall;
  if (!d) { alert("Add J-Suite from your browser menu — see the install guide (PWA-INSTALL.md)."); return; }
  d.prompt();
  try { await d.userChoice; } catch (e) {}
  window.__deferredInstall = null;
  if (typeof render === "function") render();
};
/* reusable card for the Data tab (and anywhere a settings surface wants it) */
function pwaInstallCard() {
  if (isStandalone()) return `<div class="card"><div class="nm">📱 Installed</div><div class="sub" style="white-space:normal">J-Suite is running as an installed app on this device.</div></div>`;
  const canPrompt = !!window.__deferredInstall;
  let how;
  if (isIOSDevice()) how = `On iPhone/iPad: open this app in <b>Safari</b>, tap the <b>Share</b> icon, then <b>Add to Home Screen</b>.`;
  else if (canPrompt) how = `Tap <b>Install</b> to add J-Suite to your home screen — it opens full-screen and works offline after the first load.`;
  else how = `In Chrome/Edge: open the <b>⋮</b> menu → <b>Install app</b> / <b>Add to Home screen</b>. Install needs the app opened over your Tailscale <b>https</b> address (not the raw http IP).`;
  return `<div class="card" style="border-left:4px solid var(--accent)"><div class="nm">📱 Install J-Suite</div>
    <div class="sub" style="white-space:normal">${how}</div>
    ${canPrompt ? `<button class="btn acc sm" style="margin-top:10px" onclick="installApp()">Install</button>` : ""}
    <div class="muted" style="margin-top:8px">One-time per device. Full setup steps: PWA-INSTALL.md.</div></div>`;
}
