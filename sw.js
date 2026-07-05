/* J-Suite service worker — network-first so live edits always show; the cache is the offline
   fallback. On install it precaches a minimal app shell so a cold offline launch still renders.
   Only registers on secure contexts (https / localhost) — see js/29-boot.js. Over a raw http
   Tailscale IP there is no secure context, so this never runs and nothing breaks. */
const CACHE = "jsuite-v172";   // bump on every ship: activate purges every non-matching cache, so a stale shell/JS skew can't persist as a blank screen
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

/* ---- Web Push (tickle + fetch-on-wake) ---- the push is contentless; on wake we fetch the REAL
   message body from /api/push/peek (identifying this device by its own subscription endpoint — no
   token in the SW) and show it. ANY failure (offline, timeout, push off) falls back to the generic
   line, so every push still results in a showNotification — iOS requires that, and this always does. */
self.addEventListener("push", e => {
  e.waitUntil((async () => {
    let title = "Cap", body = "New message — tap to open";
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub && sub.endpoint) {
        const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), 3000);
        const r = await fetch("./api/push/peek", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }), signal: ctrl.signal });
        clearTimeout(to);
        if (r && r.ok) { const j = await r.json(); if (j && j.ok) { if (j.title) title = j.title; if (j.body) body = j.body; } }
      }
    } catch (_) { /* keep the generic fallback */ }
    return self.registration.showNotification(title, {
      body: body,
      icon: "assets/icon-192.png", badge: "assets/icon-192.png",
      tag: "jsuite-" + Date.now(), data: { url: "./?tab=messages", tab: "messages" }   // UNIQUE tag per push: rapid messages each alert (a static tag collapsed them silently on iOS)
    });
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const tab = (e.notification.data && e.notification.data.tab) || "messages";
  const target = (e.notification.data && e.notification.data.url) || ("./?tab=" + tab);
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ("focus" in c) { try { c.postMessage({ type: "navigate", tab: tab }); } catch (_) {} return c.focus(); } }   // tell an open tab to switch, then focus it
    if (self.clients.openWindow) return self.clients.openWindow(target);             // else open the app at that tab
  }));
});
