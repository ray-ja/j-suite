# Crew Reply Watcher — Design (DRAFT for Strategy review · DO NOT BUILD YET)

Author: J-Suite Dev lane · branch `feat/availability-overrides`
Status: **design only.** Strategy reviews + picks the architecture before any build.

## Goal (full chain)
1. **Detect** new non-CEO messages on **prod** — cheap poll, **no LLM**.
2. **Relay up** to Strategy when (and only when) a real new crew message lands — content-gated, **separate from the 5-min Dispatch build timer** (per Ray: cost tracks real traffic, not the clock).
3. **Respond back** — post Strategy's reply into the prod messages collection (scoped write path).

## What already exists (reuse, don't reinvent)
- **Read:** `GET /api/ceo?view=messages` (read token `CEO_READ_TOKEN`) → threads + messages, read-only, whitelisted (no passhash/PII).
- **Write:** `POST /api/ceo/message` (write token `CEO_WRITE_TOKEN`) → appends to the messages collection ONLY (mergeState-scoped; can't touch other records).
- **Prod-local commands** (verified): the handshake post + the reply read-check both run on the prod box reading tokens from `~/j-suite/ceo-config.json` — the token never leaves prod.
- Detecting "new" is **dumb diffing**: compare message ids (or a high-water `ts`) against a saved cursor. No model needed for steps 1–2; the LLM (Strategy) only engages on a real new message.

## The deciding question — is prod reachable from the dev lane over Tailscale?  ✅ MEASURED: YES
Tested from the dev box (`100.76.172.30 rzywdt`) → prod (`100.103.109.41 rzy-ubuntu-workstation-1`):
`curl http://100.103.109.41:4000/health` → **200 in ~2ms** (`{"ok":true,"store":"/home/rzy/j-suite/data.json"}`), `/` → 200.
So a **dev-lane poller is viable** (Architecture A / C), not just prod-local (B). Below kept for the record.

## Hands-off verdict (explicit, per Cap's ask)
- **Inbound (crew → Cap): genuinely hands-off** with the **read token on dev** — dev-lane dumb-polls prod over Tailscale, relays new crew messages to Cap in-pod. Read token = low risk (read-only, whitelisted). Zero Ray steps.
- **Outbound (Cap → crew): the crux.** Posting Cap's reply needs the **write token** at `/api/ceo/message`. Plainly:
  - **TRUE fully-hands-off + ZERO new infra ⇒ the write token must live on the dev box.** Dev-lane posts directly to prod over Tailscale. No Ray, no new code. Cost: write token leaves prod — **bounded risk** (messages-collection-only; a leaked write token can post-as-Cap but **cannot** touch customers/quotes/jobs/accounts).
  - **Write token stays prod-local AND fully hands-off ⇒ requires NEW prod infra:** a second inbound "relay-inbox" endpoint (auth by read token or a 3rd relay token) + a prod-local drainer process that posts locally with the prod-resident write token. Buildable, but net-new code + credential + a running prod process.
  - **Write token prod-local + NO new infra ⇒ NOT hands-off** (Ray/cron runs the post). = the current interim.
- **Bottom line:** "fully hands-off, both directions, zero new infra" = **write token on the dev box.** No way around it without the relay-inbox+drainer.
- **Recommendation (given reachability + Cap's "small acceptable risk" on the messages-only write path): Architecture A** — read+write tokens on dev (provided once by Ray, gitignored on dev), dev-lane polls + posts over Tailscale. If Cap wants write-token-never-leaves-prod with full automation instead, I build the relay-inbox+drainer.

---
*(original architecture options retained below for reference)*

## The original options
Ray ran the handshake **prod-local** ("not the Tailscale pipe"), so we did NOT assume reachability. That single fact picks the architecture:

### Architecture A — Dev-lane poller (IF dev↔prod Tailscale is available)
- A dumb poller in the dev lane GETs `http://<prod-tailscale>:4000/api/ceo?view=messages` with the **read token**, every ~60–120s, diffs against a cursor file, and on a new non-CEO message **relays it up to Strategy in-pod** (the dev lane is already in the pod).
- Respond-back: see the write-side options below.
- **Token location:** read token on the **dev box**. (Write token: see split below.)

### Architecture B — Prod-local watcher (IF dev can't reach prod)
- A dumb watcher process runs **on the prod box**, polling `localhost:4000/api/ceo?view=messages` (read token, local), diffing a cursor file.
- Relay-up problem: prod must get the message **out** to the pod. Options: (b1) append to a file Ray/the pod retrieves; (b2) the prod box hits an outbound webhook the pod consumes; (b3) Ray stays the courier (manual, current interim). **This is the open gap for B** — there's no confirmed inbound path to Strategy from prod today.
- **Token location:** both tokens stay **on prod** (most secure), but relay-up needs an outbound transport that doesn't exist yet.

### Architecture C — Hybrid, split by token sensitivity (RECOMMENDED if dev↔prod works)
- **Read side on dev:** dev-lane dumb-poll of prod's read endpoint over Tailscale (read token on dev). Relays new crew messages up to Strategy.
- **Write side stays prod-local:** Strategy's response is posted by the **prod-local writer** — the write token **never leaves prod**. Either Ray runs the one-line post command, or a tiny prod-local agent drains a small "outbound" queue the dev lane writes (over Tailscale to a benign endpoint) — design that only if full automation is wanted.

## Security tradeoff (stated plainly)
- **Read token = low risk.** Read-only, returns only the curated/whitelisted projection (no passhash, calToken, phone, email). Putting it on the dev box to poll prod is acceptable.
- **Write token = sensitive.** It can inject messages **as Strategy** into the live store. If it leaks, someone could impersonate the CEO channel. **Keep it prod-local** unless Strategy explicitly accepts the convenience-for-risk trade.
- **Net recommendation:** read token may live on dev (polling); **write token stays on prod**. That's Architecture C. Full hands-off both-directions (write token on dev, Architecture A) is possible but strictly less safe — only if Strategy opts in.

## Detect logic (cheap, no LLM)
- State: a small cursor file (e.g. `reply-watcher-cursor.json`, gitignored) holding the set of already-relayed message ids (or a per-thread high-water `ts`).
- Each poll: GET `?view=messages` → flatten messages where `senderId !== "__ceo__" && !deleted` → emit any whose id isn't in the cursor → add to cursor. Emitting = relay up. Idempotent; survives restart.
- **Cadence:** poll every ~60–120s (a free curl; the *model* never wakes on an empty poll). Event-gated: Strategy is woken only when a new message is emitted. Completely separate from the 5-min build-loop timer.

## Respond-back
- Strategy hands its reply text to the writer; the writer posts via `POST /api/ceo/message` (write token), `threadId` = the crew member's thread (so it threads correctly), `senderLabel:"Strategy (CEO)"`, UTF-8-safe (heredoc/Node pattern, never a shell var — see [[jsuite-bridge-utf8-posting]]).
- Per the token rule: in C, this runs prod-local (Ray or a prod agent); in A, the dev lane does it.

## Files (only when built — not now)
- `tools/reply-watcher.js` (NEW) — dumb poller + cursor; env/config for endpoint + read token; emits new messages.
- Cursor file gitignored (add to `.gitignore`).
- (If automated write-back) a prod-local drainer + a benign dev→prod outbound queue endpoint — design separately.
- No app/data-layer change; no migration fixture (read-only poll + existing scoped write).

## Open questions for Strategy
1. **Can the dev lane reach prod over Tailscale?** (Decides A/C vs B.) If unknown, confirm with Ray.
2. **Write token: prod-local only (safer, C/B) or on dev for full auto (A)?** Recommend prod-local.
3. **Acceptable relay latency / poll interval?** (60–120s suggested.)
4. **Where does Strategy "receive" the relayed message** — into the Dispatch stream as a content-gated wake, or a dedicated channel?
5. **Until built, interim relay stays manual-via-Ray** (run the read command, paste) — confirmed.
