# Push Notifications (v1.1, #1) + Last-Seen (small follow-up) — PLAN for Cap

Author: J-Suite Dev lane · branch `main`. Status: **plan only, not built.** Push is #1; last-seen builds *after/alongside* but never before.

## A. PUSH NOTIFICATIONS — current status: NOT STARTED (greenfield)
Verified on `main`: `sw.js` has **no** `push`/`notificationclick` handler; **no** VAPID keys; **no** `pushManager`/subscribe; **no** subscription storage; server is **zero-dep** (no `node_modules`). So everything below is net-new.

### Why it matters (Cap's framing)
Today delivery = watcher-side polling + crew remembering to open the app. Push = real-time; Cap doesn't have to time around app-opens.

### The build (4 pieces)
1. **Service worker** (`sw.js`): add `push` (show notification from payload) + `notificationclick` (focus/open the app to the thread). **Keep** the existing network-first + `/sync`,`/login`,`/health`,`/qb` BYPASS untouched. SW only runs on the **secure** Tailscale `https` hostname (not raw IP) — already the case for installed PWA.
2. **Client subscribe** (new bit in `js/47` or `js/49-push.js`): on a logged-in secure context, `Notification.requestPermission()` → `pushManager.subscribe({applicationServerKey: <VAPID public>})` → store the subscription **on the account record** as `u.pushSubs[]` (rides existing account LWW — the `calToken` precedent; no new collection). Re-subscribe handling + unsubscribe on logout.
3. **Server send route**: on a new message (CEO write path + crew sends), look up recipients' `u.pushSubs[]` and send a Web Push to each. Token-protected like `/sync`.
4. **VAPID keys**: keypair minted once; **public** key shipped to the client, **private** key server-only + gitignored (alongside `ceo-config.json`).

### THE decision Cap must make — zero-dep vs `web-push` lib
Web Push requires VAPID **JWT (ES256)** signing + payload **encryption (RFC 8291: ECDH P-256 + HKDF + AES128GCM)**.
- **Option 1 — hand-roll with Node's built-in `crypto`** (ECDH, `crypto.hkdf`, AES-GCM, ES256 all supported). Keeps the **zero-dep / no-build** posture (CLAUDE.md ethos). Cost: ~150–200 lines of careful crypto; more to get exactly right.
- **Option 2 — add the `web-push` npm dependency.** Much simpler/safer (battle-tested), but it's the project's **first-ever npm dep** → introduces `node_modules` + breaks the zero-dep stance. Server-only (not the file:// client), so it doesn't touch the no-bundler client rule.
- **Recommendation:** lean **Option 1 (hand-roll, zero-dep)** to preserve the posture, *unless* Cap/Ray would rather accept one server dep for speed/robustness. **This is the gating call — please pick before I build.**

### Reality caveats
- **iOS:** web push only to a **home-screen-installed** PWA (iOS 16.4+) + permission granted. Chase/Pierce must install + allow notifications. Android/desktop more forgiving.
- **No silent failures:** if a sub is stale (410/404 from the push service), prune it from `u.pushSubs[]`.
- In-app unread badge stays as the fallback when push is unavailable/denied.

### What I need from Ray (his hand — it's a secret)
- **Generate the VAPID keypair** and place it server-side, gitignored. Command (Option 1, Node-only):
  ```
  node -e "const c=require('crypto');const {publicKey,privateKey}=c.generateKeyPairSync('ec',{namedCurve:'prime256v1'});console.log(JSON.stringify({pub:publicKey.export({type:'spki',format:'der'}).toString('base64url'),priv:privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')}))"
  ```
  → drop into a gitignored `vapid-config.json` on prod (I'll wire the server to read it). *(Exact format finalized once Option 1/2 is chosen.)*

### Phasing (after Cap picks the dep option)
1. SW handlers + client subscribe + `u.pushSubs[]` (+ migration fixture: pushSubs rides account LWW, zero loss) — **gated/inert without VAPID config**.
2. Server VAPID + send route; wire to the message send paths.
3. Verify end-to-end on an installed PWA (your phone), prune-stale-subs.

---

## B. LAST-SEEN / LAST-ACTIVE — small follow-up (build alongside, push stays #1)
Cap's spec: server records each user's last-sync time (lightweight + **throttled**, no sync-layer churn); expose read-only on the CEO read path + watcher `status`/relay as "active Xm ago." Helps Cap *time* messages.

### Design (keeps it OUT of the sync layer — that's the key)
- **Storage = a separate server-side map, NOT `data.json`.** `const lastActive = {}` (in-memory, `userId → ts`). This is the whole trick: it never touches `data.json`/`mergeState`, so it can't churn the sync layer or trigger LWW propagation.
- **Stamping:** `/sync` already fires on every client poll/push. Add `userId` to the `/sync` payload (one field in `js/26`'s POST body — does **not** change the merge; server reads it separately). Server: `if (p.userId && now - (lastActive[p.userId]||0) > 60000) lastActive[p.userId] = now;` — **throttled to ~60s/user** (matches the "Xm ago" granularity; "don't write on every request").
- **Persistence:** in-memory is enough for a long-running server; optionally **debounced** write to a gitignored `last-active.json` (~every 5 min) so it survives restarts. No per-request disk writes.
- **Exposure (read-only):** add `lastActive` (ms) to `ceoProjection` `crew[]`; the watcher/`status` renders **"active 3m ago" / "active just now" / "—"**. The **CEO read token stays read-only** — it only *reads* this map; the only writer is the existing `/sync` path (not the read token).
- **Where it slots in:** after Push Phase 1, as a ~1-evening add (server map + 1 client field + projection field + watcher formatter + a tiny test that the map updates and the read path surfaces it without touching `data.json`).

### Safety floor (both)
Bypass-free + `node --check` + sync-server-tests green + migration fixture for `pushSubs` (data-layer) before any commit to `main`. Push the change set, then ask Ray to `deploy.sh`.

## Open questions for Cap
1. **Push crypto: Option 1 (hand-roll, zero-dep) or Option 2 (`web-push` dep)?** — gates the build.
2. OK that **push needs Chase/Pierce to install the PWA + allow notifications** (esp. iOS)? Want a short in-app "enable notifications" prompt as part of Phase 1?
3. Last-seen confirmed as the post-Push-Phase-1 follow-up (not parallel)?
