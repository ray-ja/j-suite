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
**PRIME DIRECTIVE (the single rule that covers most edge cases): on ANY uncertainty, Haiku acks + escalates — it never improvises.** Every other bound below is a refinement of this. If Haiku is not near-certain a message is a pure allowlisted intent, it does not answer — it sends a warm holding ack and hands to Cap-Opus.

Haiku may ONLY act inside an allowlist; everything else escalates. Two-gate decision per inbound message: (1) a **classifier** labels intent; (2) an **allowlist** maps safe intents to safe actions.

**Haiku CAN (handle directly):**
- **Warm acks** — "Got it, one sec." / "On it — let me check." (buys time while escalating if needed).
- **Simple factual Q&A** — schedule lookups, job location/time, "who's on the Duck job tomorrow?" — read-only from `view=ops` / the data layer. Facts only, no judgment.
- **Availability intake** — "I'm free Tuesday" → **write the availability override DIRECTLY** to the data layer (same model js/33 + `availability-resolve.js` use), **confirm it in the reply** ("Got it — marked you free Tue"), and **audit it** (Cap decision Q3). Low-stakes + self-correcting (the person flags it if wrong) and speed is the point — a pre-confirm step would kill the value. Tighten to propose-then-confirm ONLY if the audit shows mis-parsing.
- **Routing / holds** — "Let me look into that, I'll get right back to you" then escalate.

**Haiku CANNOT (must escalate, never improvise):**
- Strategic calls, prioritization, business decisions.
- **Accountability / management / performance** anything.
- Commitments, promises, scheduling that affects pay or customers, money, pricing.
- Hard/sensitive conversations, conflict, anything with stakes or that needs judgment.
- Anything it isn't ≥95% sure is a pure allowlisted intent → **default to escalate.**

## Escalation bridge — DIRECT, on-box (Cap decision Q1 + Q2)
- On any non-allowlisted (or low-confidence) message, Haiku: (1) posts a brief warm holding ack as Cap ("Good question — let me get you a solid answer, give me a few."), (2) **escalates to Cap-Opus**.
- **Transport: a DIRECT Agent-SDK Opus call from the prod service — NOT the Dispatch relay.** A 24/7 channel can't depend on the fragile desktop relay; the prod service is self-contained. The service calls an Opus model itself, in-process.
- **Deep layer runs ON-BOX:** the escalation Opus call executes from the prod service, fed **shared memory (Cap's brain) + the thread context** — Cap-quality answers without phoning home to the pod.
- **Same Cap, two runtimes:** pod-Cap (interactive) and on-box-Cap (the prod service) are the SAME Cap — one brain, two runtimes. The crew never perceive a difference; the voice + memory are shared (see Shared memory below).
- Cap-Opus posts the substantive reply (as Cap) seconds later. The holding ack means the crew never sit in silence.

## Shared memory — Cap's brain, readable from prod (NEW requirement, Cap Q2)
On-box-Cap must read the **same durable memory** pod-Cap uses, or the two runtimes drift into different "Caps." Requirement: **Cap's memory becomes a shared/synced resource the prod Agent-SDK runtime can read** — not locked to the desktop session.
- **What stores it today:** the desktop session's memory directory (per-fact markdown files + an index). That is desktop-local right now — the gap to close.
- **Sketch (options, pick at build):**
  - **(a) Ride the existing sync layer (recommend):** store Cap's memory as a synced collection / records in the same per-record-LWW store the app already replicates to prod (a `capmemory` collection, or a dedicated doc set). Prod already HAS the data via the sync-server; the service reads it locally. No new transport, no new trust surface — reuses what's proven.
  - **(b) A small synced file/store** (e.g., memory dir mirrored to prod over the existing SSH bridge / a pull on a timer) — simpler to start, but a second mechanism to keep honest.
  - Writes (pod-Cap learning new facts) propagate to prod via the same sync; on-box-Cap reads the merged state. Last-write-wins per memory record, same discipline as the rest of the data layer.
- **Principle:** one brain. Whatever path, both runtimes must end up reading the same merged memory, or we get identity drift (a named failure mode below).

## Meeting gate (preserved exactly)
Haiku is under the **same gate as Cap**: **no accountability, no management, no crew-facing initiation pre-meeting.** Pre-meeting, Haiku is limited to acks + factual Q&A + availability intake + routing — and even those only in response to a crew message, never proactive management. The crew-facing initiation switch is the same one in `tools/ops-brief.js` (`CREW_FACING_ENABLED`) — Haiku reads it; OFF = it does not initiate, only responds. Flipping the gate is a post-crossroads decision, not a code default.

## How it replaces the watcher
- The watcher's only job was "notice a new crew message and wake a human." The agent notices AND responds. Once the agent is live + proven, retire `reply-watcher.js` + the daemon/monitor (keep them until then as the fallback).
- Net: latency drops from ≤90s-poll-then-human to instant-ack + fast/deep reply.

## Infrastructure
- **Agent SDK setup:** Node service on prod; `@anthropic-ai/claude-agent-sdk` (or the API directly for a tighter bound). Pin Haiku 4.5 (`claude-haiku-4-5-20251001`) for front-line, an Opus 4.x id for the deep layer.
- **systemd unit** (`j-suite-frontline.service`): `Restart=always`, `RestartSec=2`, `WantedBy=multi-user.target`, runs as the deploy user, `EnvironmentFile=` for secrets, journald logging. Mirrors the existing `j-suite-sync` service pattern.
- **Secrets:** `ANTHROPIC_API_KEY` + the CEO read/write tokens in a gitignored env file (like `ceo-config.json` / `sync.env`) — never committed. Reuse the scoped write token (messages-only) so the agent structurally cannot touch customers/jobs/finance.
- **Tailscale:** none new required — the agent runs on-box (reads/writes the localhost sync-server) and both layers (Haiku + the escalation Opus call) run in the same prod service. Outbound HTTPS to the Anthropic API only; no new inbound exposure, no pod dependency.
- **Cost guardrail (Cap decision Q5 — watch ESCALATIONS, not Haiku):** Haiku at 3-person volume is nearly free, so it gets a **generous ceiling purely as a runaway-catch** (alert at 80%, throttle at 100%). **The real cost lever is escalation frequency** — every escalation is an Opus call. So **budget + alert on escalations-per-day** (reuse the watcher-monitor alert path), and tune the threshold from real usage. That's the bill to watch.

## Bound rules as code
- **Classifier prompt:** a tight system prompt returning a structured label `{intent: ack|faq|availability|route|ESCALATE, confidence}`. Anything < a high confidence threshold → ESCALATE. Adversarially worded examples in the prompt (a management/accountability message disguised as a simple question → must classify ESCALATE).
- **Allowlist enforcement in code, not prompt:** the SDK tool layer exposes ONLY: `read_ops` (read-only projection), `log_availability` (writes an availability override, the single mutation it's allowed), `post_ack` (post a bounded ack as Cap), `escalate` (hand to Opus). No general "post arbitrary message" tool — Haiku literally cannot send a substantive message; only `post_ack` (short, templated/bounded) and `escalate` exist. This makes oversharing structurally hard, not just prompt-discouraged.
- **Ack templates:** a small set of approved ack phrasings; Haiku selects, lightly fills, never free-forms a substantive claim.

## Audit trail (Cap-Opus oversight — mandatory)
**Cap-Opus keeps a full audit trail of every message Haiku posts.** Each Haiku action is logged with: the inbound message, the classifier's label + confidence, the action taken (`post_ack` text / `log_availability` write / `escalate`), and a timestamp. Cap-Opus reviews this stream to catch **identity drift** (Haiku sounding off-voice) and **gate leaks** (Haiku acting outside bounds or pre-meeting). The audit is the safety backstop behind the structural tool-layer bounds — if anything slips through the allowlist, the trail surfaces it for correction (tighten the classifier / templates / allowlist). Retain the log; surface anomalies to Ray via the existing alert path.

**Cadence (Cap decision Q4): DAILY at first → WEEKLY after ~2 clean weeks.** Cap reviews the **exceptions** (anything flagged uncertain, longer-than-expected posts) **+ a daily sample** — not every post. **Any surfaced mistake → immediate review.** **Bounds expand only after a clean audit period — never on faith.** The exception flagging is **automated** (the classifier confidence + a post-length/voice heuristic auto-tag entries for Cap), so review is cheap and targeted.

## Failure modes + mitigations
- **Misclassify → overshares / answers something with stakes.** Mitigation: the PRIME DIRECTIVE (uncertainty → ack + escalate, never improvise) + structural bounds — no arbitrary-post tool; `post_ack` is bounded; substantive replies physically require `escalate`→Opus. Plus confidence-floor → ESCALATE on doubt. Plus the full audit trail (above): Cap-Opus reviews every post.
- **Escalation lag (Opus call slow).** Mitigation: on-box direct call (no relay/pod hop) keeps it fast; Haiku's holding ack sets expectation; a watchdog re-tries / flags via the watcher-monitor alert path if the Opus call hasn't returned in N seconds.
- **Identity drift (Haiku "sounds different" than Cap, OR on-box-Cap diverges from pod-Cap).** Mitigation: **shared memory (one brain, two runtimes — see Shared memory)** so both Caps reason from the same facts; shared voice spec in both layers' prompts; bounded ack templates; the deep layer always owns substance so tone-on-substance is always Opus; the daily audit catches drift early.
- **Agent down (service crash).** Mitigation: `Restart=always`; **keep the reply-watcher + daemon as the fallback listener until the agent is proven**, then retire.
- **Runaway cost / loop.** Mitigation: per-hour message cap + daily token ceiling + dedupe (never answer the same message twice) + alert on breach.
- **Gate leak (Haiku initiates management pre-meeting).** Mitigation: no proactive trigger — Haiku only acts on inbound crew messages; the `CREW_FACING_ENABLED` gate read in code; management intents are non-allowlisted → escalate, and Opus is itself gated.

## Build order (AFTER Cap approves)
1. Service skeleton (systemd unit + SDK + secrets) reading new messages on prod, **logging only** (no posts) — observe classification accuracy against real traffic.
2. Add `post_ack` + `read_ops` (acks + factual Q&A) behind the gate; shadow-review every action.
3. Add `log_availability` (the one mutation) with confirms.
4. Make Cap's memory readable on prod (shared/synced — see Shared memory), so on-box-Cap == pod-Cap.
5. Wire `escalate` → **direct on-box Opus call** (fed shared memory + thread context); prove end-to-end with holding-ack + deep reply.
6. Run alongside the watcher; once classification + escalation are proven, retire the watcher/daemon/monitor.

## Decisions (Cap — resolved; plan is fully scoped)
1. **Escalation transport → DIRECT Agent-SDK Opus call from the prod service, NOT the Dispatch relay.** A 24/7 channel can't depend on the fragile desktop relay; the prod service is self-contained. (See Escalation bridge.)
2. **Deep layer → ON-BOX.** The escalation Opus call runs from the prod service, fed shared memory + thread context — Cap-quality without phoning home. **New requirement: Cap's durable memory must be a shared/synced resource the prod runtime can read** (see Shared memory). One brain, two runtimes.
3. **Availability write → DIRECT + confirm-in-reply + audited.** Low-stakes, self-correcting, speed is the point; pre-confirm would kill the value. Tighten only if audit shows mis-parsing. (See CAN → Availability intake.)
4. **Audit cadence → DAILY → WEEKLY after ~2 clean weeks.** Exceptions + daily sample (not every post); immediate review on any mistake; bounds expand only after a clean period, never on faith; exception flagging automated. (See Audit trail.)
5. **Cost → watch ESCALATIONS, not Haiku.** Generous Haiku ceiling as runaway-catch (alert 80% / throttle 100%); budget + alert on escalations-per-day, tuned from real usage. (See Cost guardrail.)

> **Status: fully scoped. Build queued for after the meeting + recurring-routes clear.**
