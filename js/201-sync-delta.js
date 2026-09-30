/* js/201-sync-delta.js — delta sync helpers (pure; the sync engine in js/26 calls them).
   WHY (2026-09-30, Ray: "is the app down? trouble syncing?"): every sync the phone POSTed its ENTIRE store
   (2.4 MB, uncompressed upload) and got the entire store back, once a minute and on every focus. On a weak
   LTE signal the upload alone blew the 20 s watchdog → "Offline — changes saved" while the server was fine.
   The server has always merged per record (LWW by id, never drops), so a push only needs the records that
   changed since the last successful push, and a pull only needs the records stamped since the last pull.
   Both helpers here are pure so they can be unit-tested in node (sync-delta-tests.js).
   Safety net: js/26 still does a FULL round trip every SYNC_FULL_EVERY_MS, on "Sync now", on an empty
   store, and whenever a partial pull reveals an org slab this device does not have yet. */
var SYNC_DELTA_WINDOW_MS = 10 * 60 * 1000;   // re-send / re-fetch 10 minutes of overlap: covers honest phone clock drift + a failed round trip
var SYNC_FULL_EVERY_MS = 15 * 60 * 1000;     // one full round trip every 15 min reconciles anything a delta could miss (an edit that never bumped updatedAt, a hard-removed record)

/* records to PUSH: per org slab, only records stamped at/after `floor` (client clock). floor<=0 → whole slabs.
   A record with NO updatedAt is always sent (it can't be dated, so it's never left behind). Non-array keys are
   skipped — every server collection is an array. */
function syncDeltaOf(S, orgIds, floor) {
  var out = {};
  (orgIds || []).forEach(function (id) {
    var slab = S && S[id];
    if (!slab || typeof slab !== "object" || Array.isArray(slab)) return;
    if (!(floor > 0)) { out[id] = slab; return; }
    var o = {};
    Object.keys(slab).forEach(function (c) {
      var a = slab[c]; if (!Array.isArray(a)) return;
      var picked = a.filter(function (r) { return r && (!r.updatedAt || (+r.updatedAt || 0) >= floor); });
      if (picked.length) o[c] = picked;
    });
    out[id] = o;
  });
  return out;
}

/* apply a server response to the local store. partial=false → each returned slab REPLACES the local one
   (today's behaviour). partial=true → per-record LWW merge INTO the local slab (a returned record lands only
   if its stamp is >= the local one; unknown ids are appended; nothing local is ever removed).
   Returns {changed, needFull}: changed → re-render; needFull → the response named an org slab this device
   doesn't have (a partial can't seed a whole org), so the caller schedules a full pull. users/registry are
   the caller's business (small, always whole). */
function syncMergeInto(S, state, partial) {
  var changed = false, needFull = false;
  Object.keys(state || {}).forEach(function (k) {
    var v = state[k];
    if (k === "users" || k === "registry" || !v || typeof v !== "object" || Array.isArray(v)) return;
    if (!partial) { if (JSON.stringify(S[k]) !== JSON.stringify(v)) changed = true; S[k] = v; return; }
    if (!S[k] || typeof S[k] !== "object" || Array.isArray(S[k])) { S[k] = v; changed = true; needFull = true; return; }
    Object.keys(v).forEach(function (c) {
      var inc = v[c]; if (!Array.isArray(inc)) return;
      if (!Array.isArray(S[k][c])) { S[k][c] = inc; if (inc.length) changed = true; return; }
      var cur = S[k][c], idx = new Map();
      cur.forEach(function (r, i) { if (r && r.id != null) idx.set(r.id, i); });
      inc.forEach(function (r) {
        if (!r || r.id == null) return;
        var i = idx.get(r.id);
        if (i == null) { cur.push(r); idx.set(r.id, cur.length - 1); changed = true; return; }
        var mine = cur[i];
        if ((+r.updatedAt || 0) >= (+mine.updatedAt || 0) && JSON.stringify(mine) !== JSON.stringify(r)) { cur[i] = r; changed = true; }
      });
    });
  });
  return { changed: changed, needFull: needFull };
}

/* should this tick be a FULL round trip? */
function syncWantFull(sync, mode, storeEmpty, nowMs) {
  if (mode === "manual" || storeEmpty) return true;
  if (!sync || !(sync.since > 0) || !(sync.fullAt > 0)) return true;
  return (nowMs - sync.fullAt) > SYNC_FULL_EVERY_MS;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { syncDeltaOf: syncDeltaOf, syncMergeInto: syncMergeInto, syncWantFull: syncWantFull, SYNC_DELTA_WINDOW_MS: SYNC_DELTA_WINDOW_MS, SYNC_FULL_EVERY_MS: SYNC_FULL_EVERY_MS };
}
