/* J-Suite service worker — network-first so live edits always show; the cache is the offline
   fallback. On install it precaches a minimal app shell so a cold offline launch still renders.
   Only registers on secure contexts (https / localhost) — see js/29-boot.js. Over a raw http
   Tailscale IP there is no secure context, so this never runs and nothing breaks. */
const CACHE = "jsuite-v3";
/* shell = the navigation document + styles + manifest/icons; relative URLs resolve against the
   SW scope (served root). JS modules are picked up by the network-first runtime cache on first load. */
const SHELL = ["./", "app.css", "manifest.webmanifest", "assets/icon-192.png", "assets/icon-512.png"];
const BYPASS = ["/sync", "/login", "/health"];   // always hit the network — never cache API/auth

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))   // tolerant: one 404 won't fail install
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;                                          // never touch writes (sync/login POST)
  if (BYPASS.indexOf(url.pathname) >= 0 || url.pathname.indexOf("/qb/") === 0 || url.pathname.indexOf("/api/") === 0) return;  // API stays live
  e.respondWith(
    fetch(e.request).then(resp => {
      if (resp && resp.ok && /^https?:$/.test(url.protocol)) { const cp = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
      return resp;
    }).catch(() => caches.match(e.request).then(hit => hit || (e.request.mode === "navigate" ? caches.match("./") : undefined)))
  );
});

/* ---- Web Push (tickle pattern) ---- contentless push wakes us; show a generic notification.
   iOS requires every push to result in showNotification; this always does. */
self.addEventListener("push", e => {
  e.waitUntil(self.registration.showNotification("Cap", {
    body: "New message — tap to open",
    icon: "assets/icon-192.png", badge: "assets/icon-192.png",
    tag: "jsuite-" + Date.now(), data: { url: "./" }   // UNIQUE tag per push: rapid messages each alert (a static tag collapsed them silently on iOS)
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ("focus" in c) return c.focus(); }                      // focus an open tab if there is one
    if (self.clients.openWindow) return self.clients.openWindow("./");               // else open the app
  }));
});
