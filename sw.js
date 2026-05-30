/* J-Suite service worker — network-first so live edits always show; cache is the offline fallback.
   Only active on secure contexts (https / localhost). */
const CACHE = "jsuite-v2";
self.addEventListener("install", e => { self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.pathname === "/sync" || e.request.method !== "GET") return; // never touch sync/writes
  e.respondWith(
    fetch(e.request).then(resp => {
      if (resp && resp.ok) { const cp = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
      return resp;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match("/")))
  );
});
