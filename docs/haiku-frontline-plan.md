# Haiku Front-Line Architecture — PLAN (for Cap's review · plan-first, NOT built)

Author: J-Suite Dev lane · `dev` branch. **Plan only — Cap reviews before any implementation.** Replaces the polling reply-watcher (a dumb listener) with a real-time, bounded AI front-line that speaks **as Cap**, handles the light stuff instantly, and escalates everything with stakes to Cap-Opus.

## Why
The watcher is a 90s poller that just *wakes* a human lane — laggy, and it silently stalled once (now hardened, see `tools/watcher-daemon.js`). The crew want a voice that answers *now*. A Haiku 4.5 front-line on the always-on prod box gives instant warm acknowledgement + simple answers, while the deep layer (Cap-Opus) handles substance. To the crew it's **one CEO ("Cap")** — they never see the two layers.

## Architecture
- **Runtime:** Claude Agent SDK running as a **systemd service on prod** (the 24/7 Ubuntu box, `rzy-ubuntu-workstation-1` / `100.103.109.41`) — same box as the sync-server, no new infra. `Restart=always`, journald logs.
- **Model split:**
  - **Haiku 4.5 = front-line.** Watches the message store (reads new crew messages), classifies each, and either answers within bounds or escalates.
  - **Cap-Opus = deep layer.** Receives escalations, composes substantive replies. Same identity ("Cap") on the wire.
- **Identity:** every outbound message is `senderLabel:"Cap"` via the existing scoped write path (`POST /api/ceo/message`). The crew see a single voice. Haiku is told, in its system prompt, that it IS Cap's fast reflex — not a separate persona.
- **Listener:** the agent subscribes to new messages (tails the store via the read path / a local hook on the sync-server's message-append), so there is **no separate polling loop — the agent IS the listener.** The reply-watcher + daemon are retired once this is live and proven.

## Bounded scope (the core safety surface)
Haiku may ONLY act inside an allowlist; everything else escalates. Two-gate decision per inbound message: (1) a **classifier** labels intent; (2) an **allowlist** maps safe intents to safe actions.

**Haiku CAN (handle directly):**
- **Warm acks** — "Got it, one sec." / "On it — let me check." (buys time while escalating if needed).
- **Simple factual Q&A** — schedule lookups, job location/time, "who's on the Duck job tomorrow?" — read-only from `view=ops` / the data layer. Facts only, no judgment.
- **Availability intake** — "I'm free Tuesday" → log a structured availability override to the data layer (the same model js/33 + `availability-resolve.js` use), then confirm.
- **Routing / holds** — "Let me look into that, I'll get right back to you" then escalate.

**Haiku CANNOT (must escalate, never improvise):**
- Strategic calls, prioritization, business decisions.
- **Accountability / management / performance** anything.
- Commitments, promises, scheduling that affects pay or customers, money, pricing.
- Hard/sensitive conversations, conflict, anything with stakes or that needs judgment.
- Anything it isn't ≥95% sure is a pure allowlisted intent → **default to escalate.**

## Escalation bridge
- On any non-allowlisted (or low-confidence) message, Haiku: (1) posts a brief warm holding ack as Cap ("Good question — let me get you a solid answer, give me a few."), (2) **escalates to Cap-Opus** with the thread context.
- Bridge transport options (Cap's call): **(a)** Dispatch relay (Haiku writes an escalation record the Cap-Opus lane consumes — reuses today's pod plumbing), or **(b)** direct Agent-SDK sub-agent / API call to an Opus model from the service. Recommend (a) first (no new trust surface; reuses the relay we already run), migrate to (b) if latency matters.
- Cap-Opus posts the substantive reply (as Cap) seconds-to-minutes later. The holding ack means the crew never sit in silence.

## Meeting gate (preserved exactly)
Haiku is under the **same gate as Cap**: **no accountability, no management, no crew-facing initiation pre-meeting.** Pre-meeting, Haiku is limited to acks + factual Q&A + availability intake + routing — and even those only in response to a crew message, never proactive management. The crew-facing initiation switch is the same one in `tools/ops-brief.js` (`CREW_FACING_ENABLED`) — Haiku reads it; OFF = it does not initiate, only responds. Flipping the gate is a post-crossroads decision, not a code default.

## How it replaces the watcher
- The watcher's only job was "notice a new crew message and wake a human." The agent notices AND responds. Once the agent is live + proven, retire `reply-watcher.js` + the daemon/monitor (keep them until then as the fallback).
- Net: latency drops from ≤90s-poll-then-human to instant-ack + fast/deep reply.

## Infrastructure
- **Agent SDK setup:** Node service on prod; `@anthropic-ai/claude-agent-sdk` (or the API directly for a tighter bound). Pin Haiku 4.5 (`claude-haiku-4-5-20251001`) for front-line, an Opus 4.x id for the deep layer.
- **systemd unit** (`j-suite-frontline.service`): `Restart=always`, `RestartSec=2`, `WantedBy=multi-user.target`, runs as the deploy user, `EnvironmentFile=` for secrets, journald logging. Mirrors the existing `j-suite-sync` service pattern.
- **Secrets:** `ANTHROPIC_API_KEY` + the CEO read/write tokens in a gitignored env file (like `ceo-config.json` / `sync.env`) — never committed. Reuse the scoped write token (messages-only) so the agent structurally cannot touch customers/jobs/finance.
- **Tailscale:** none new required if the agent runs on-box (reads/writes localhost sync-server). Outbound HTTPS to the Anthropic API only. If the Opus deep layer runs in the pod (not on-box), the escalation bridge rides the existing relay — no new inbound exposure.
- **Cost guardrail:** Haiku is cheap; cap with a per-hour message budget + a hard daily token ceiling in the service, alerting (reuse the watcher-monitor alert path) if exceeded.

## Bound rules as code
- **Classifier prompt:** a tight system prompt returning a structured label `{intent: ack|faq|availability|route|ESCALATE, confidence}`. Anything < a high confidence threshold → ESCALATE. Adversarially worded examples in the prompt (a management/accountability message disguised as a simple question → must classify ESCALATE).
- **Allowlist enforcement in code, not prompt:** the SDK tool layer exposes ONLY: `read_ops` (read-only projection), `log_availability` (writes an availability override, the single mutation it's allowed), `post_ack` (post a bounded ack as Cap), `escalate` (hand to Opus). No general "post arbitrary message" tool — Haiku literally cannot send a substantive message; only `post_ack` (short, templated/bounded) and `escalate` exist. This makes oversharing structurally hard, not just prompt-discouraged.
- **Ack templates:** a small set of approved ack phrasings; Haiku selects, lightly fills, never free-forms a substantive claim.

## Failure modes + mitigations
- **Misclassify → overshares / answers something with stakes.** Mitigation: structural — no arbitrary-post tool; `post_ack` is bounded; substantive replies physically require `escalate`→Opus. Plus confidence-floor → ESCALATE on doubt. Plus a post-hoc audit: log every Haiku action; Cap reviews.
- **Escalation lag (Opus slow / pod asleep).** Mitigation: Haiku's holding ack sets expectation; a watchdog re-pings if Opus hasn't answered in N minutes; the watcher-monitor alert path reused to flag a stuck escalation to Ray.
- **Identity drift (Haiku "sounds different" than Cap / breaks the single-voice).** Mitigation: shared voice spec in both layers' prompts; bounded ack templates; periodic transcript review; the deep layer always owns substance so tone-on-substance is always Opus.
- **Agent down (service crash).** Mitigation: `Restart=always`; **keep the reply-watcher + daemon as the fallback listener until the agent is proven**, then retire.
- **Runaway cost / loop.** Mitigation: per-hour message cap + daily token ceiling + dedupe (never answer the same message twice) + alert on breach.
- **Gate leak (Haiku initiates management pre-meeting).** Mitigation: no proactive trigger — Haiku only acts on inbound crew messages; the `CREW_FACING_ENABLED` gate read in code; management intents are non-allowlisted → escalate, and Opus is itself gated.

## Build order (AFTER Cap approves)
1. Service skeleton (systemd unit + SDK + secrets) reading new messages on prod, **logging only** (no posts) — observe classification accuracy against real traffic.
2. Add `post_ack` + `read_ops` (acks + factual Q&A) behind the gate; shadow-review every action.
3. Add `log_availability` (the one mutation) with confirms.
4. Wire `escalate` → Cap-Opus bridge; prove end-to-end with holding-ack + deep reply.
5. Run alongside the watcher; once classification + escalation are proven, retire the watcher/daemon/monitor.

## Open questions for Cap
1. **Escalation transport:** Dispatch relay (recommend, reuses plumbing) vs direct Agent-SDK Opus sub-agent? 
2. **Deep layer location:** Cap-Opus in the pod (relay) or an on-box Opus call from the service?
3. **Availability write:** let Haiku write the availability override directly, or have it only *propose* and Ray/Cap confirm until trust is established?
4. **Audit cadence:** how often does Cap review Haiku's action log before we loosen bounds?
5. **Cost ceiling:** per-day token budget for the front-line?
