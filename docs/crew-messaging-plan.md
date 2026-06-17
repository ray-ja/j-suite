# Crew Messaging — Implementation Plan (DRAFT for Strategy)

Author: J-Suite Dev lane · 2026-06-17 · branch `feat/availability-overrides` (canonical)
Status: **draft for Strategy + Ray to react to. Not built.** Bring back for approval before building.

> **Module-numbering note (2026-06-17):** this plan was drafted assuming the new module would be `js/45`. Message Templates + Invoicing (the increment built ahead of messaging) took `js/45`/`js/46`, so when messaging is built it lands at the next free numbers — **`js/47-messages.js`** (+ `js/48-messages-compose.js` if split). Substitute accordingly at build time.

## Ray's ask (verbatim intent)
- **In-app messaging** so Strategy/owner can reach the crew directly, riding the accounts that already exist.
- v1 = an **inbox / thread** view in the app, an **unread badge on the nav** that pings on next app open, and **web push where the PWA already supports it** (native-wrapper push is a later phase — don't over-build).
- Senders must be **clearly attributed** (owner's name, or "the business").
- Owner/admin → crew direction is the priority. Support **1:1** and **broadcast-to-crew** threads.

## What already exists (don't reinvent)
- **Per-business synced collections** are a well-worn pattern. `sync-server.js` line 28 lists `COLLECTIONS = [...]`; `mergeState()` (line 79) scaffolds every collection on both `BIZES` (`obx`, `jam`) and merges each with `mergeColl()` — **per-record LWW by `updatedAt`, tombstone via `deleted`**. `js/35-locks.js` is the cleanest recent example to copy: a per-business collection with stable string ids, LWW, and a release tombstone (`l.deleted = true; l.updatedAt = now()`).
- **Client scaffold/migration**: `js/02-state.js` `blank()` lists every collection; `load()` backfills each collection on `obx`/`jam` and stamps missing `updatedAt`. The client sync engine lives in **`js/26-deep-quote-rate-editor-every.js`** (not `25`, which is just a header): `scheduleAutoPush()` (debounced 2.5s push on every `save()`), `syncRun()`, `storeIsEmpty()` (the empty-store-pulls-first guard), and the merge-apply. Boot (`js/29-boot.js`) pulls on open/focus/visibility/online + every 60s.
- **Accounts & roles**: `js/28-users-lightweight-accounts.js` — account shape `{id, username, passhash, role, active, settings, calToken?, updatedAt}`, `curUser()`, `users()`. `js/32-admin.js` — `curRoleKey()`, `isOwner()`, `roleAllows()`, `canSee()`, and `applyAccess()` which **hides nav buttons AND coerces `TAB` away from disallowed pages** (the "unreachable, not just hidden" rule). Crew page set = `CREW_PAGES`.
- **Nav/render**: `js/03-routing.js` — `render()` maps `TAB` → a render fn, `applyAccess()` runs first. Nav is `<nav><button data-tab="…">` in the shell; each tab needs a render fn registered in the dispatch object at `03-routing.js:13`.
- **Per-user token + server endpoint** precedent: `js/37-calendar-feed.js` mints `u.calToken` (rides account LWW) and the server matches it on a tokened GET route. This is the exact shape a web-push subscription would follow.
- **Service worker** (`sw.js`): network-first, **bypasses `/sync`, `/login`, `/health`, `/qb/`** so API/auth stay live; only registers on a secure context. It has **no `push`/`notificationclick` handler today** — that's net-new for push.
- **Fixture discipline**: `sync-server-tests.js` has per-feature LWW/tombstone blocks (locks, timeclock, finance) plus the mandatory realistic round-trip block loading `fixtures/data-pre-scheduler.json`. The census helper iterates `Object.keys(s[biz])`, so a **new collection is automatically counted** in the zero-loss assertion.

So the data plumbing is ~90% boilerplate-copy from locks/timeclock. The genuinely new work is: (1) the **read-state model** (the hard part), (2) the **inbox/thread UI**, (3) the **nav unread badge**, (4) **web push** (real but scoped).

## Data model — RECOMMENDATION: a `messages` collection + a separate per-user read marker

### The message record (per-business, like every other collection)
```js
// S[biz].messages[] — one record per message, stable id, rides per-record LWW
{
  id: "msg_" + uid(),     // stable; re-seed/multi-device dedupe by id
  threadId: "thr_…",      // groups a conversation (see threads below)
  senderId: "u1",         // account id of the author
  senderLabel: "Ray",     // attribution snapshot at send time (username, or "OBX Lot Solutions")
  body: "Crew — start at the Duck house at 8.",
  ts: 1718600000000,      // authored-at (display order; immutable)
  deleted: false,         // tombstone (sender/owner can retract)
  updatedAt: 1718600000000
}
```
Messages are **append-mostly and effectively immutable** after send (edit = allowed for the sender, bumps `updatedAt`, LWW-safe). This keeps the high-churn field — read state — **off** the message record.

### Threads — lightweight, derived, no separate collection in v1
A thread is just a `threadId` shared by its messages plus a small **thread descriptor** stored as a record *in the same `messages` collection* (discriminated by a `kind` field, the same trick `__roles__` uses in `S.users`):
```js
{ id:"thr_…", kind:"thread", threadId:"thr_…", title:"Crew", type:"broadcast"|"dm",
  members:["u1","u2","u3"], createdBy:"u1", deleted:false, updatedAt:… }
```
- `type:"broadcast"` = owner → all crew (the common case). `type:"dm"` = 1:1.
- Filtering `messages.filter(m => m.kind!=="thread")` gives messages; `kind==="thread"` gives descriptors. The locks collection already proves non-business "control" records can live happily in a per-business collection (and `storeIsEmpty()` only counts customers/quotes/jobs/properties/places/mktTracker, so messages never trip the empty-store guard — confirm and leave as-is).

### The hard question: how is unread/read state stored? (the analog of per-date-vs-per-account in availability)
This is the crux. Two options:

**Option A — read receipts ON the message record (`readBy[]`).**
`m.readBy = ["u2","u3"]`, each recipient appends their id when they open the thread, then `touch(m)`.
- ✗ **Fatal under LWW.** The message is one record. If Pierce marks read on his phone (`readBy:["u2"]`, updatedAt T+1) and Chase marks read on his (`readBy:["u3"]`, updatedAt T+2) before they sync, the **last writer clobbers the other's receipt** — Pierce's read flips back to unread. Same defect availability would have had if overrides were stored on a shared record. Rejected.

**Option B (RECOMMENDED) — a separate per-(user × thread) read marker, one record per reader.**
Store the reader's high-water mark as its **own** record so each device only ever writes its **own** marker — no cross-recipient clobber:
```js
// also in S[biz].messages[] (or a sibling collection; see tradeoff), kind-discriminated
{ id:"rd_" + threadId + "_" + userId,  // STABLE & deterministic → dedupes across devices
  kind:"read", threadId:"thr_…", userId:"u2",
  lastReadTs: 1718600000000,           // newest message ts this user has seen in this thread
  deleted:false, updatedAt:… }
```
- Unread for user U in thread T = any non-deleted message with `m.ts > marker.lastReadTs` (or no marker yet).
- **LWW is safe**: two users never write the same marker id (id embeds `userId`); one user on two devices writing the same marker id is exactly what LWW is for — newest `lastReadTs` wins, monotonic, never loses a "read". This is the direct analog of *per-account* availability beating *per-shared-record*.
- A **high-water timestamp** (not a per-message readBy set) keeps it to **one tiny record per user per thread** — cheap, and "read up to here" is all the inbox badge needs.

**Tradeoff to call out for Strategy:** read markers can live (a) **inside the `messages` collection**, kind-discriminated (zero new wiring, simplest) or (b) as a **separate `msgReads` collection** (cleaner separation, but a second `COLLECTIONS`/`blank()`/`load()` entry + its own fixture). **Recommend (a) for v1** — one collection, one fixture, and the kind-discriminator pattern is already battle-tested by `__roles__`. We lose per-message "seen by Pierce, Chase" granularity; v1 only needs unread counts + a "Seen" hint, which the high-water mark gives us. If true per-message read receipts are wanted later, add a `readBy`-style sub-collection then — not now.

## Resolution / flow
- **Send (owner/admin)**: pick a thread (or "New broadcast to crew" / "New message to [member]"), type body → push a `message` record with `senderId=curUser().id`, `senderLabel = curUser().username` (or the business name for broadcasts), `ts=now()`, `touch()`, `save()` → debounced auto-push.
- **Receive**: on pull (open/focus/60s interval), new message records arrive via the normal merge. Inbox lists threads sorted by latest message ts; **unread count** per thread = messages newer than the user's `read` marker.
- **Mark read**: opening a thread writes/updates *this user's* `rd_…` marker `lastReadTs = max(message ts in thread)`, `touch`, `save`.
- **Nav badge**: total unread across all threads in the current business → number bubble on the Messages nav button. "Pings on next app open" = boot already pulls on open; after the pull's render, the badge reflects new mail.

## UI — mobile-first
New module **`js/47-messages.js`** (next free number; see numbering note), registered in the shell `<script>` list (before `js/29-boot.js`) and as a nav button + render fn.
- **New nav tab** `data-tab="messages"` (e.g. `<button data-tab="messages"><span class="ic">💬</span>Messages<span class="ct" id="msgbadge"></span></button>`), added to `CREW_PAGES` and `ADMIN_PAGES` in `js/32-admin.js` so it's role-gated like everything else.
- **Inbox view (`rMessages`)**: card list of threads — title, last-message snippet, relative time, unread `.ct` bubble. Big tap targets (reuse `.li`/`.card`). Owner/admin see a "＋ New message" affordance via the FAB hook in `03-routing.js:19` (add a `messages` branch → `openNewMessage()`); crew's FAB does nothing on this tab (or "reply" only — see open questions).
- **Thread view**: bubbles with **sender attribution** (`senderLabel` + relative time), newest at bottom, sticky composer at the foot (reuse the `.wizfoot` sticky-bar pattern). Opening the thread marks read.
- **Attribution**: every bubble shows who sent it; broadcasts from the owner can render `senderLabel` as the business name (`BIZ[S.biz].name`) when the owner chooses "as the business".
- Keep the file small; if the composer/new-message modals push it past ~250 lines, split sending into `js/48-messages-compose.js`.

## Per-role access (enforced, not cosmetic)
- **Who can send**: gate the composer/new-message UI on `isOwner() || curRoleKey()==="admin"`. Crew **reply** vs **read-only** is an open question (below) — default v1 = crew can reply within an existing thread but cannot start broadcasts.
- **Who can see the tab**: add `messages` to `CREW_PAGES` (crew receive) and to each role via `ADMIN_PAGES`. `applyAccess()` already hides the nav button AND coerces `TAB` away if a role lacks it — so the page is **unreachable**, not merely hidden. `rMessages()` should also re-check `canSee("messages")` at the top and bail to a stub, matching `rAdmin()`'s `isOwner()` guard, so a deep link / stale `TAB` can't render it.
- A crew member must only see threads they're a `members` of (broadcast threads include all crew; DMs include the two parties). Filter threads by membership in `rMessages()`.

## Sync + data safety (CLAUDE.md — MANDATORY)
- **Wire the new collection in all three places**, exactly like locks/timeclock did:
  1. `sync-server.js` — add `"messages"` to `COLLECTIONS`. `mergeState()` then scaffolds + LWW-merges it on both businesses automatically (no other server change).
  2. `js/02-state.js` — add `messages:[]` to `blank()` **and** the per-biz backfill in `load()`, so a pre-messages store gains the collection without loss.
  3. The client sync push/merge already sends whole-`S[biz]` objects, so messages ride along with no sync-engine change. Confirm `storeIsEmpty()` is **not** extended to count messages (a device with only messages must still pull first).
- **Stable ids**: `msg_…`/`thr_…` from `uid()`; the read marker id is **deterministic** (`rd_<threadId>_<userId>`) so the same reader on multiple devices updates one record (LWW) instead of duplicating.
- **Tombstones**: retract a message = `deleted:true; updatedAt=now()` (copy `releaseLock`).

### Migration fixture — exact assertions (this gates the build)
Add a new block to `sync-server-tests.js` in the locks/timeclock style, plus extend the realistic round-trip. It MUST assert:

1. **Collection scaffolded on both businesses** after `mergeState` — `Array.isArray(m.obx.messages) && Array.isArray(m.jam.messages)`.
2. **Message LWW** — a message edited on a newer record wins (`body` updated, newer `updatedAt`); older copy does not resurrect.
3. **Read-state LWW does NOT clobber across recipients** — the core proof: seed two read markers `rd_thrX_u2` and `rd_thrX_u3` from two devices in one merge; assert **both survive** and each keeps its own `lastReadTs` (this is the test that would FAIL under the rejected `readBy[]` design — include a comment saying so).
4. **Read-marker monotonic LWW for one user across devices** — same `rd_thrX_u2` id from two devices, newer `lastReadTs` wins, older does not overwrite.
5. **Delete tombstone propagates** — a message with `deleted:true, updatedAt` newer wins.
6. **Per-business isolation** — a `jam` message/thread stays separate from `obx`.
7. **Thread descriptor survives merge** as a kind-discriminated record (`kind:"thread"`), like the `__roles__` test.
8. **Backward-compat / zero-loss with a pre-messages store** — the existing `fixtures/data-pre-scheduler.json` has **no `messages` key**, so it already doubles as a pre-messages fixture. Assert:
   - `mergeState(fx, {})` (pull round-trip) preserves **every customer, property, quote, job, todo, inventory, changelog, and account id** (the existing `census`/`sameIds` helpers already cover this — a new collection can't reduce the census).
   - After a device pushes a state that **adds** `obx.messages` (a thread + a message + a read marker), `census` shows all prior ids intact **plus** the new message ids.
   - A second pull (third device) is still zero-loss end to end.
   - *(Optional)* commit a small `fixtures/data-pre-messages.json` only if the implicit "no messages key" feels too subtle; otherwise reuse `data-pre-scheduler.json` and note it in a comment.

## Web push — honest reality check
**Current state:** `sw.js` has install/activate/fetch only — **no `push` or `notificationclick` listener**, no `manifest` push fields, no VAPID keys, no subscription storage. The SW only runs on a secure context (the Tailscale `https` hostname, not the raw IP). iOS only delivers web push to **installed** PWAs (iOS 16.4+).

**What v1 actually ships (in-app, reliable today):**
- Nav unread badge + thread unread counts, refreshed by the existing pull-on-open/focus/interval. This is the "pings on next app open" behavior and needs **zero** push infrastructure. **This is the v1 commitment.**

**What real web push requires (scope as v1.1, behind the in-app badge):**
1. **VAPID keypair** — generate once; public key shipped to the client, private key on the server (new file, gitignored alongside `qb-config.json`).
2. **SW handlers** — add `push` (show notification) + `notificationclick` (focus/open the app to the thread) to `sw.js`. Keep the existing `/sync`/`/login`/`/qb/` **BYPASS** untouched.
3. **Permission + subscribe** — client asks `Notification.requestPermission()`, calls `pushManager.subscribe({applicationServerKey})`, stores the subscription **on the account record** as `u.pushSubs[]` so it rides existing account LWW (the `calToken` precedent in `js/37`) — no new collection.
4. **Server send path + endpoint** — a new server route (token-protected like `/sync`) that, on a new message, sends Web Push to each recipient's stored subscriptions. **Zero-dep constraint:** the server is dependency-free; Web Push requires VAPID JWT signing + payload encryption (RFC 8291). Doing that without a library (`web-push`) is non-trivial — **flag for Strategy**: either accept one dependency (breaks the zero-dep posture) or hand-roll with Node's built-in `crypto` (more effort, more risk). Recommend deferring to v1.1 and shipping the in-app badge first.

**Native-wrapper push: explicitly out of scope** (later phase), per Ray.

## Files touched (and build order)
**Phase 1 — data layer + fixture (data-safe foundation; all green before any UI):**
1. `sync-server.js` — add `"messages"` to `COLLECTIONS` (one line).
2. `js/02-state.js` — `messages:[]` in `blank()` + the `load()` per-biz backfill.
3. `sync-server-tests.js` — the messaging fixture block (assertions 1–8 above) + realistic round-trip extension.
4. `fixtures/` — reuse `data-pre-scheduler.json` (no messages key) as the pre-messages fixture; add `data-pre-messages.json` only if Strategy prefers explicit.
   → Run the verification bar: `node --check` each touched JS, `node sync-server-tests.js` (0 failed), `node verify-app.js` (clean `file://` load).

**Phase 2 — in-app inbox/thread UI + badge (the v1 deliverable):**
5. `js/47-messages.js` (NEW) — `rMessages` (inbox + thread), `openThread`, `markThreadRead`, `unreadCount`, badge updater.
6. *(optional)* `js/48-messages-compose.js` (NEW) — `openNewMessage`/send if `47` grows too big.
7. `Business App (v1).html` — new `<nav>` button `data-tab="messages"` (with `id="msgbadge"` `.ct`) + `<script src="js/47-messages.js">` (and `48` if split) **before** `js/29-boot.js`. *(On a shell `<script>` merge conflict, keep ALL tags from both sides — CLAUDE.md.)*
8. `js/03-routing.js` — register `messages:rMessages` in the dispatch (line 13) + a `messages` branch in the FAB handler (line 19).
9. `js/32-admin.js` — add `{tab:"messages",label:"Messages"}` to `ADMIN_PAGES` and `"messages"` to `CREW_PAGES`.
10. `app.css` — message bubbles, unread `.ct` badge styling (reuse `.li`/`.card`/`.wizfoot`).
    → Re-run the full verification bar.

**Phase 3 (v1.1, separate branch) — web push:** `sw.js` (push/notificationclick + keep BYPASS), client subscribe (new bit in `js/47` or a `js/49-push.js`), `u.pushSubs[]` on accounts, server VAPID keys + send route + dependency decision, fixture for `pushSubs` riding account LWW.

## Risks / caveats
- **Read-state under LWW is the whole ballgame.** If anyone "simplifies" to `readBy[]` on the message, cross-recipient read state silently clobbers. The fixture (assertion 3) is the guardrail — do not weaken it.
- **`storeIsEmpty()` must not count messages** — otherwise a fresh crew device that pulled only messages could be considered "non-empty" and push-empty over the server's real business data. Leave the empty-check enumerating only business collections.
- **Broadcast volume.** Every broadcast writes one message record visible to all crew; high chatter grows the synced store. Fine for 3 users; note as a scaling caveat. A retention/auto-tombstone pass is future work.
- **No real-time.** Delivery latency = the pull cadence (open/focus/60s) until web push lands. Set expectations: v1 is near-real-time on app open, not instant.
- **Zero-dep vs Web Push crypto** (Phase 3) — genuine effort/risk fork; surfaced above for Strategy.
- **Sender attribution is a snapshot** (`senderLabel` stored at send) — if a username later changes, old messages keep the old label. Acceptable (and arguably correct); note it.
- **Shell `<script>` list is the cross-lane collision point** — coordinate if another lane is also adding a module.

## Open questions for Strategy / Ray
1. **Crew reply rights:** crew read-only, or crew may reply within a thread (not start broadcasts)? *(Recommend: crew can reply, only owner/admin start broadcasts.)*
2. **Read markers in the `messages` collection (kind-discriminated)** vs a **separate `msgReads` collection**? *(Recommend in-collection for v1 — one collection, one fixture.)*
3. **Per-message "seen by" receipts** ever needed, or is a high-water unread count enough? *(Recommend high-water only for v1.)*
4. **"As the business" sending** — broadcasts default to the business name or the owner's name as `senderLabel`? *(Recommend owner picks per-message; default to owner name.)*
5. **Cross-business inbox** — keep messages strictly per-business (obx/jam) like all other data, or a unified inbox? *(Recommend per-business to match every other collection and the sync model.)*
6. **Web push priority** — ship in-app badge alone as v1 and schedule push as v1.1, accepting the zero-dep-vs-`web-push`-library decision then? *(Recommend yes.)*

> Build on canonical `C:\dev\j-suite` with the verification bar + scoped commits; never edit production. New collection = wire `COLLECTIONS` + `blank()` + `load()` together, prove it with the fixture before any UI.
