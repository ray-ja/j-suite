# CEO Read Path — Authenticated Read-Only Pod Data Access (PLAN for Strategy)

Author: J-Suite Dev lane · 2026-06-17 · branch `feat/availability-overrides` (canonical)
Status: **draft for Strategy review. Not built.** This plan GATES the rest of the CEO role — approve the access mechanism + token model before building.

## Intent (Strategy's ask)
A **read-only** API exposing live J-Suite state so a Strategy/CEO pod session can sweep:
- **Crew statuses** — who's clocked in, who's on a job right now vs idle.
- **Availability / schedule** — today + the week ahead, per crew member.
- **Open jobs / open quotes** — what's in flight.

Hard rules (non-negotiable): a **proper API + existing token auth**; **never read/poke `data.json` directly**; **never touch production**; **read-only — the endpoint can never mutate state.**

## What already exists (the patterns this rides)
The server (`sync-server.js`) is a flat `if`-chain of routes in one request handler. Relevant precedents:
- **`GET /health`** (line 195) — a trivial GET returning JSON. Shows the add-a-route shape.
- **`GET /calendar/<token>.ics`** (line 201) — **the exact precedent**: a *read-only, token-authenticated GET capability*. It resolves an unguessable per-user `calToken` (`userByCalToken`), calls **`loadStore()` only** (never `saveStore`), and emits a projection. The CEO read path is the same shape with a richer JSON projection and a service token.
- **`POST /sync`** (line 229) — write path, guarded by `if (TOKEN && payload.token !== TOKEN)`. This is the **write** token; the CEO read path must use a **different** credential so a read key can never write.
- **Tailscale posture** (line 282 comment): the port is bound to the host interfaces and reached over the tailnet, **not publicly forwarded**. Auth/token is a second layer, not the first. `loadStore()` is pure-read (`JSON.parse(readFileSync)`); `saveStore()` is the only writer and the read path will never call it.

So the endpoint itself is ~1 route block + a pure projection function. **The genuinely hard part is the access mechanism** (below) — solved concretely, not assumed.

## THE ACCESS MECHANISM (the crux — how a pod session actually reaches + authenticates)
Reality we can rely on:
- The server runs on **this host** (Ray's machine), Tailscale IP **`100.76.172.30:4000`**, bound `0.0.0.0`, **not** publicly forwarded. It only exists while a Code session is running (Ray approved that lifetime).
- The **J-Suite Dev (Code) lane is ON this host** and can already reach the server locally (`curl http://127.0.0.1:4000/...` — proven; we hit it every cutover).
- What we do **not** know and must not assume: whether a *Strategy/Dispatch* session is a node on Ray's tailnet (egress to `100.76.172.30`) or an isolated sandbox with no route to it.

Therefore the plan provides **one endpoint, two ways to consume it**:

- **Mechanism A — on-host Code-lane bridge (PRIMARY; works today, zero new networking).**
  Strategy requests a sweep via Dispatch → the J-Suite Dev lane (on-host) issues the authenticated `GET` to the **local** endpoint (`http://127.0.0.1:4000/api/ceo`) → returns the JSON projection up the pod relay. This needs nothing new — it's the same local reachability we already use — and keeps the credential on-host. **Recommend this as the v1 path.**

- **Mechanism B — direct tailnet GET (ENABLE IF egress confirmed).**
  Any consuming session that **is** a tailnet node hits `http://100.76.172.30:4000/api/ceo` directly with the CEO token (`Authorization: Bearer <token>` or `?token=`). Identical endpoint; only the caller differs. Build once; switch on B when/if Strategy's session is confirmed to have tailnet access.

> **Open question #1 for Strategy (blocking the "direct" mode only):** does the Strategy/Dispatch session have network egress to `100.76.172.30` on the tailnet? If **yes**, B is available immediately. If **no/unknown**, ship A (bridge) now — it works regardless — and treat B as a later toggle. A requires no answer to proceed.

## Endpoint design
**`GET /api/ceo`** (read-only). Optional sub-views via query: `?view=crew|jobs|quotes|all` (default `all`), `?biz=obx|jam|all` (default `all`).
- **Auth:** `Authorization: Bearer <CEO_READ_TOKEN>` (also accept `?token=` for easy curl, like `/calendar/`). Constant-time-ish compare; on mismatch → `401`. Reuse `rateCheck` (already used by `/login`) to speed-bump guessing.
- **Method jail:** only `GET` is wired; any other method falls through to `404`. The handler calls **`loadStore()` only** and **never** `saveStore()` — structurally read-only.
- **Field whitelist (no leakage):** the projection is *built field-by-field*, never a raw store dump. It MUST NOT emit `passhash`, `calToken`, `CEO_READ_TOKEN`, the sync `TOKEN`, or full customer PII beyond operational need (customer **name** + job address are in; phone/email **out** of the sweep unless Strategy asks). This is enforced by the projection function + a test (below).

### Auth/token model — RECOMMENDATION: a dedicated service token, NOT in synced data
- Store **`CEO_READ_TOKEN`** as an **env var or a gitignored config file** (`ceo-config.json`, alongside `qb-config.json`/`qb-tokens.json` in `.gitignore`). Rationale: the read-API credential must **not** live inside `data.json` (the very data it guards) and must be **separate from the write `TOKEN`** so a read key can never write. Rotatable by editing the file/env + restart.
- **Alternative considered:** a per-owner-account capability (`u.ceoToken`, minted like `calToken`, rides account LWW, revoke by rotating). Cleaner UX for multi-consumer, but puts an API credential into synced customer data and couples auth to an account record. **Recommend the service token for v1**; revisit the capability model if multiple distinct CEO consumers need independent revocation.

## Data projection (the JSON the sweep returns)
Computed server-side from `loadStore()`, across `BIZES` (or the requested `biz`). Shape:
```jsonc
{
  "ok": true,
  "asOf": 1718600000000,            // server time of the read
  "biz": "all",
  "crew": [
    { "id":"u1", "name":"Ray", "role":"owner",
      "onJob": { "jobId":"j1", "title":"Soft wash", "since":1718596400000 } | null,  // from open timeclock entry
      "clockedIn": true,
      "todayStatus": "on" | "partial" | "off" | "timeoff" | "unset"   // resolved server-side (see note)
    }
  ],
  "availabilityWeek": [             // next 7 days, per crew, resolved status — for the schedule glance
    { "date":"2026-06-17", "available":["u1","u2"], "partial":[], "off":["u3"], "timeoff":[] }
  ],
  "openJobs": [
    { "id":"j1","biz":"obx","title":"Soft wash","date":"2026-06-18","time":"09:00",
      "customer":"Seaside Mgmt","address":"100 Ocean Blvd","crew":["u1"],"done":false }
  ],
  "openQuotes": [
    { "id":"q2","biz":"obx","customer":"Duck Realty","total":1250,"date":"2026-06-12","accepted":false,"invoiced":false,"paid":false }
  ],
  "counts": { "crewOnJob":1, "crewIdle":2, "openJobs":3, "openQuotes":4 }
}
```
- **"On a job" source:** open `timeclock` records (`clockOut == null`) carry `jobId` + `userId` → join to the job title. (Confirmed: timeclock is a synced per-business collection; see the timeclock test block.)
- **Availability resolution note:** `availOn()` lives client-side in `js/33`. The server needs the same 3-step resolution (timeoff > per-day `overrides[date]` > weekday baseline). **Recommend extracting the pure resolver** into a tiny shared helper the server can `require` (e.g. `js/availability-resolve.js` or a function exported from `sync-server.js`), so client and API agree and we don't fork the logic. Small, pure, unit-testable — and it eliminates drift.
- **Open jobs** = `jobs` where `!done && !deleted` (optionally `date >= today` for "upcoming"). **Open quotes** = `quotes` where `!deleted && !accepted` (and/or `!paid`). Filters are cheap and explicit.

## Files touched (and build order — plan-first; build after approval)
1. `.gitignore` — add `ceo-config.json` (the read token; never committed).
2. `js/availability-resolve.js` (NEW, tiny) — extract the pure `availOn`-style resolver; `js/33` `require`-free-includes it via the shell, server `require`s it. *(Or export a resolver from `sync-server.js` to avoid a shared file — decide at build; recommend the shared file so the client uses the identical code.)*
3. `sync-server.js` — (a) load `CEO_READ_TOKEN` from env/`ceo-config.json`; (b) add the `GET /api/ceo` route block (auth + `loadStore()` + projection); (c) a pure `ceoProjection(store, opts)` function (whitelisted, never mutates).
4. `sync-server-tests.js` — read-path tests (below). **No new synced collection → no migration fixture needed**, but the read-only + whitelist guarantees ARE tested.
   → Verification bar: `node --check`, `node sync-server-tests.js` (0 failed), `node verify-app.js` (the app shell is unaffected, but confirm zero regressions).

### Tests (gating the build)
- **Read-only invariant:** call `ceoProjection()` on a fixture store, then assert the store object is **deeply unchanged** (no mutation) and `saveStore` is never invoked (the route never calls it — assert by construction + a projection-purity check).
- **Whitelist:** projection JSON contains **no** `passhash`, `calToken`, sync `TOKEN`, or `CEO_READ_TOKEN`, and no customer phone/email (per the v1 scope).
- **Auth:** wrong/empty token → unauthorized; correct token → `200` (unit-test the token check helper; reuse the `verifyLogin`-style pattern).
- **Projection correctness:** seed a fixture with an open timeclock entry → that crew shows `onJob`; a `done` job is excluded from `openJobs`; an `accepted` quote is excluded from `openQuotes`; availability resolution matches `availOn` for timeoff/override/baseline cases (reuse `fixtures/data-pre-scheduler.json` + a small timeclock/overrides add).

## Security / data-safety posture
- **Read-only by construction** — the route only `loadStore()`s and projects; it has no path to `saveStore`. Production data is never touched (this is the dev server; production is the separate pull-only Ubuntu box — out of scope, never contacted).
- **Never `data.json` directly** — always through `loadStore()` (the same accessor the rest of the server uses), so the file format/locking stays single-sourced.
- **Token hygiene** — read token separate from write token, out of synced data, gitignored, rotatable. Tailnet-private transport (not publicly forwarded) is the first layer; the token is the second.
- **Least disclosure** — whitelisted projection; expand fields only on explicit Strategy request.

## Risks / caveats / open questions
1. **Egress (Open question #1 above)** — A (bridge) needs no answer and ships now; B (direct) needs confirmed tailnet egress for the Strategy session.
2. **Availability logic duplication** — resolve by extracting one shared pure function (recommended) rather than re-implementing in the server (which would drift from `js/33`).
3. **Token transport when open** — the dev server currently runs with the write `TOKEN` **unset (open)**. The CEO token check still applies to `/api/ceo` regardless, but Strategy should decide whether to also set the write `TOKEN` now (defense in depth) or keep dev open. *(Recommend setting `CEO_READ_TOKEN` even though dev is otherwise open — it's the credential that gates the sweep.)*
4. **Scope creep** — keep the projection to the four operational signals Strategy named; resist dumping the store. Each added field is a disclosure decision.
5. **PII** — v1 excludes customer phone/email from the sweep; confirm that's acceptable for the CEO view, or name exactly which contact fields are in-scope.

> Build on canonical `C:\dev\j-suite` with the verification bar + scoped commits. Read path = a tokened GET that only `loadStore()`s and projects whitelisted fields. Approve the access mechanism (A now, B if egress) + token model, and I'll build it.
