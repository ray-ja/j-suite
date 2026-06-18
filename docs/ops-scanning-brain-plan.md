# Autonomous Ops-Scanning Brain — PLAN (for Cap's review · capture-audit first · NOT built)

Author: J-Suite Dev lane · branch `main`. **Plan only — no implementation.** Three layers: (1) capture audit, (2) ops-sweep + gap rules, (3) autonomous voice trigger.

---

## Layer 1 — CAPTURE AUDIT (what ops-state exists today vs. needs new capture)

Walked the synced collections (`COLLECTIONS`), the account records, and the UI write paths. Reference shapes:
- **jobs[]**: `title, date, time, customerId, propertyId, crew[], done(bool), equipment[{itemId,qty}], quoteId, notes`. Completion = `done` toggled by `toggleJob` → writes a **changelog** entry ("Completed …", with `ts` + `user`). **No `completedAt`/`completedBy` on the job itself.**
- **todos[]**: `title, priority, due, done, assignee, notes, updatedAt`.
- **timeclock[]**: `jobId, userId, clockIn, clockOut(null=open), miles, …`.
- **changelog[]**: `action, entity, entityId, user, summary, ts` — activity log (creates/updates/completions), attributed + timestamped.
- **inventory[]** (master) + **jobs.equipment[]** (required list). Return is **inferred from `job.done`** — no explicit checkout/return events.
- **accounts**: `role, avail{days,start,end,overrides}, timeoff[], pushSubs[], calToken`.
- **messages[]** (+ kind:thread / kind:read markers). **last-active**: NOT captured (the planned per-(user) throttled marker — not built).

| Ops-state | Captured today | Complete enough for gap-detection? | Gap / smallest addition |
|---|---|---|---|
| Job scheduled (date/time) | ✅ `job.date`/`time` | ✅ | — |
| Job assignment | ✅ `job.crew[]` | ✅ | — |
| Job completion | ⚠️ `job.done` bool + changelog line | Mostly — "overdue uncompleted" = `date<today && !done` works; *when/who completed* only via changelog cross-ref | **+`job.completedAt`+`completedBy`** (set in `toggleJob`) → direct, cheap completion timing/attribution |
| Job in-progress | ⚠️ inferred (open timeclock for the job) | OK | optional explicit status later |
| Task list + ages | ✅ `todo.due/done/priority/updatedAt` | ✅ overdue = `due<today && !done`; stale = old `updatedAt` | — |
| Time / mileage | ✅ timeclock | ✅ (also: open entry >Xh = forgot-to-clock-out) | — |
| Availability | ✅ `avail`+`overrides`+`timeoff` (shared resolver) | ✅ | — |
| Equipment **required** per job | ✅ `job.equipment[]` | ✅ for "needed but not on hand" | — |
| Equipment **checkout/return** | ❌ inferred from `job.done` only | ❌ can't detect "took it, not returned" | **+ return events** (`{itemId,jobId,userId,out,in}`) — bigger capture; defer |
| Crew engagement / last-active | ❌ not captured | ❌ "crew gone quiet / hasn't opened app" undetectable | **last-active** (already planned: throttled in-memory map, read-only on read path) |
| Completion proof (notes/photos) | ❌ | ❌ | future; not needed for v1 gaps |
| Quote → job follow-through | ✅ `quote.accepted/jobId` | ✅ "accepted quote, no job scheduled" detectable | — |

**Highest-leverage smallest additions (do these two; they unlock most rules):**
1. **`last-active`** per crew (already planned) → crew-engagement gaps.
2. **`job.completedAt` + `completedBy`** (2 fields set on the existing `toggleJob` write; account-LWW, migration-fixture-trivial) → direct completion gap-detection without changelog spelunking.
Everything else needed for v1 gap rules is **already captured** — most of the brain can run on today's data.

**Read-path note:** the CEO read path currently exposes crew (on-job/availability/pushSubs-count) + open jobs/quotes. The sweep needs a richer **`view=ops`** projection (read-only): jobs with `date/done/crew/completedAt`, todos with `due/done`, open timeclock entries, accepted-but-unscheduled quotes, per-crew last-active. Small additive read view; no new collection.

---

## Layer 2 — OPS-SWEEP (scheduled gap-detection → prioritized list)

A **dumb, scheduled scanner** (no LLM) that reads `view=ops`, applies gap rules, emits a **prioritized findings list**, and wakes Cap **only when there are findings**. **Separate process** from the reply-watcher (event-driven on messages) and the Dispatch build timer.

**Cadence:** a few times daily — e.g., **07:00 / 12:00 / 17:00 local** (morning plan, midday check, end-of-day). Runs on the dev box over Tailscale (read token), same transport as the reply-watcher; or as a cron. No LLM on empty sweeps (cost tracks findings).

**Gap-detection rule shapes** (read-only, deterministic):
- **Missed/at-risk job:** `job.date ≤ today && !done && no open timeclock && no message in its thread` → ⚑ "Job '{title}' for {crew} on {date} — no completion, no clock-in, no word."
- **Overdue task:** `todo.due < today && !done` → ⚑ by age (priority-weighted).
- **Stale task:** `!done && updatedAt > N days ago` → ⚑ "untouched {N}d."
- **Forgot to clock out:** open timeclock entry `clockIn > X hours ago, clockOut null` → ⚑.
- **Accepted quote not scheduled:** `quote.accepted && !quote.jobId && accepted > X days` → ⚑ revenue at risk.
- **Coverage gap:** a scheduled job whose `crew` are all `off/timeoff` that day (availability resolver) → ⚑.
- **Crew quiet:** (needs last-active) `last-active > Xh on a workday` → ⚑.
- **Equipment conflict:** required item double-booked across same-day jobs (reuse `eqJobsOverlap`) → ⚑.

**Output:** a ranked list (severity × recency × revenue), deduped against a cursor (don't re-flag the same open item every sweep — only new/changed, like the reply-watcher's seen-set). Each finding carries the IDs + a one-line human summary.

---

## Layer 3 — AUTONOMOUS VOICE (how Cap gets woken + acts)

**Trigger (same pattern as the reply-watcher):** the sweep, on ≥1 *new* finding, **wakes Cap's session** with the prioritized list (a background process that exits/notifies, or a scheduled cron that pings Cap). Empty sweep = silent. Separate from reply-watcher + Dispatch timer.

**Cap reviews → acts** (off the **scoped write path**, messages-only, gated):
- **Crew-facing nudges** (post-meeting, gated): e.g., "Pierce — your Duck house job today, all set? Tap if anything's off." Posted via `POST /api/ceo/message` (the messages-only write path already built). Same rollout gate posture as messaging.
- **Proactive morning dispatch** ("here's your day"): the 07:00 sweep produces each crew member's day (their jobs, times, availability, open tasks) → Cap posts a per-person or broadcast morning brief. Opt-in / gated.
- All autonomous posts are **Cap-authored from the findings**, attributed "Cap", and **stay OFF until the meeting introduces the crew-facing voice** (mirrors the messaging rollout gate).

**Safety/discipline:** read side stays read-only (read token); write side is the existing messages-only scoped path (write token, prod-local or dev per the bridge decision); no new mutation surface. The sweep is deterministic (no LLM) — the LLM (Cap) only engages on real findings.

---

## Build order (AFTER Cap approves this plan)
1. **Capture additions** (small, data-safe, migration fixtures): `last-active` (planned) + `job.completedAt/completedBy`.
2. **`view=ops`** read projection (read-only, additive).
3. **Ops-sweep scanner** (`tools/ops-sweep.js`) — dumb rules + cursor + wake-on-findings; scheduled (cron/loop). Dev re-test the rules on fixture data before live.
4. **Autonomous voice** — wire findings → Cap wake → (gated) crew-facing posts + morning dispatch.

## Open questions for Cap
1. Sweep cadence — 07/12/17 local, or different? Morning brief at ~06:30?
2. Crew-facing autonomous posts: hold behind the same meeting gate as messaging (recommend yes)?
3. Build the two capture additions (`last-active`, `completedAt`) first, or scope the sweep on today's data only and add capture as rules demand it?
4. Equipment return ledger — worth the extra capture, or live with "return inferred from done" for v1?
