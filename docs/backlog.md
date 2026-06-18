# j-Suite Backlog — single source of truth

Everything anyone has ever asked for, in one place. Cap ranks; Ray triages. Add freely — better to
over-capture. **Source tags:** [Ray]=Ray asked · [Cap]=Strategy/Cap · [Dev]=J-Suite Dev noticed.
**Status:** 🆕 just-asked · ⏳ queued · 🔨 in-flight · ✅ shipped · ⏸ deferred · ❓ needs-scope.
**Size:** S (hours) · M (a day-ish) · L (multi-day / data-model).

> Convention: keep items one line. When something ships, move it to **Shipped** with the commit.

---

## 🆕 JUST-ASKED (Ray, this session — triage first)
- **Picture / photo upload to J-Suite** — crew job photos (before/after), owner reference pics. `[Ray]` `❓scope` `L` — where attached (job? quote? customer?), storage (the modular-monolith has no blob store; needs a plan — file-mount? base64-in-record is dangerous for the data layer). **Overlaps "photo-attachment QA" below.**
- **Stripe integration** — real payment processing, likely to close the invoicing loop (invoicing UI already live; mark-paid is manual). `[Ray]` `❓scope` `L` — Stripe Checkout/Payment Links vs Payment Element; webhooks; secrets like qb-config. (Stripe MCP/plugin is connected in this workspace — usable for scoping.)
- **Native wrapper** — iOS app shell wrapping the PWA for **reliable push / lock-screen / background** (addresses the web-push limits + iOS Scheduled-Summary batching we hit). `[Ray]` `❓scope` `L` — Capacitor/WKWebView shell + APNs; biggest reliability win for crew notifications.
- **This backlog doc** — `[Ray]` `✅` (you're reading it).

### Ergonomic gaps (Dev-noticed brainstorm — overnight)
- **Tappable contact + one-tap Directions on the customer card** — phone → `tel:`/`sms:`, address → Google Maps. `(Dev-noticed)` `✅ shipped to dev` `S` — crew on phones couldn't tap to call/text/navigate before.
- **One-tap Directions from a JOB** (crew driving to a scheduled job; job has customer/property address). `(Dev-noticed)` `⏳` `S` — extends the customer win to the schedule.
- **Tap-to-call the customer from a job card** (Today/Schedule). `(Dev-noticed)` `⏳` `S`.
- **Search on more lists** — only Customers + Inventory have a search box; Jobs/Schedule + Quotes don't. `(Dev-noticed)` `⏳` `S`.
- **"On my way" one-tap from a job** — Message Templates has the copy, but it lives in the customer modal; a one-tap from the job itself would be slicker for the crew. `(Dev-noticed)` `⏳` `S`.

## 🔨 NOW (in flight, on `dev`)
- **Ops-scanning brain Phase A** — `last-active` + `job.completedAt/By` capture. `[Cap]` `✅` on **main** `1556efa` (deployed to prod).
- **Ops-brain Phase B** — `view=ops` + `ops-sweep.js` gap-rule scanner (overdue/at-risk job, coverage gap, overdue/stale task, forgot-to-clock-out, unscheduled accepted quote, equipment double-book, crew-quiet), cursor-deduped, severity-ranked. `[Cap]` `🔨` on **dev** `e82d948` (live after Ray deploys; fixture-tested 136/0).
- **Ops-brain Phase C** — autonomous voice: `formatBrief()` digest started; wake→relay pipeline + 07/12/17 scheduling next. Pre-meeting = Ray-only; crew-facing gated post-meeting. `[Cap]` `🔨` on **dev** `9ee7e54`.

## ⏳ NEXT (queued, near-term)
- **Recurring-route revenue engine** — home-watch / washing / mowing routes; recurring jobs + scheduling + billing cadence. `[Cap #4]` `❓plan-first` `L` — Cap reviews data-model before build.
- **Daily morning brief** ("here's your day") — per-crew/owner 06:30–07:00 dispatch off the ops-sweep. `[Cap]` `⏳` `M` (depends on Phase C + a deploy).
- **Schedule the ops-sweep** — 07:00/12:00/17:00 local, separate from reply-watcher + Dispatch timer (cron on dev box, or pod scheduler). `[Cap]` `⏳` `S`.
- **Push content** — SW shows the actual message text (not "Cap: new message"). `[Cap/Ray]` `❓scope` `M` — needs a token-in-SW design (security); tickle stays the safe fallback.
- **Last-seen surfacing in UI** — show "active Xm ago" per crew in-app (Schedule/Admin). `[Cap]` `❓scope` `M` — `lastActive` is currently CEO-read-path/server-only (not synced to the client); needs a delivery path to the app.
- **Crew→crew / crew→Cap push** — push currently fires only on the CEO message route; crew sends don't notify. `[Dev]` `⏳` `S–M`.
- **In-field SOP troubleshooting flows** — guided "what to do when X" for the crew on-site. `[Cap]` `❓scope` `M`.

## 🗓 SOMEDAY (bigger / later)
- **Full Web Push payload encryption** (RFC-8291) — replace the tickle if richer/instant content is needed (currently tickle + SW fetch is the plan). `[Dev]` `⏸` `M`.
- **Per-`(crewId+date)` availability sub-records** — finer granularity than today's account-level LWW overrides (avoids same-account concurrent-edit clobber). `[Dev]` `⏸ deferred` `M` — fine at 3 users; revisit if crew grows. (see `docs/scheduler-availability-plan.md`).
- **Equipment checkout/return ledger** — explicit out/in events (today return is inferred from `job.done`). `[Cap]` `⏸ deferred` `M` — unlocks "took it, not returned" detection.
- **Per-message read receipts** ("seen by Pierce, Chase") — today it's a high-water unread marker only. `[Dev]` `⏸` `M`.
- **Job status states** (in-progress / blocked) beyond the `done` boolean (in-progress currently inferred from open timeclock). `[Dev]` `⏸` `S`.
- **Message retention / auto-tombstone** — broadcast volume grows the synced store over time. `[Dev]` `⏸` `S`.
- **Meeting / crew-comms rollout** — introduce the messaging + autonomous voice to the crew (activation gate for crew-facing posts). `[Cap]` `⏳ gated` — event, not a build.

## 💡 IDEAS-BIN (unscoped / nice-to-have)
- Quote → invoice → **Stripe payment** closed loop (auto mark-paid via webhook). `[Dev]` (folds into Stripe).
- **CI** — run the verify bar (`node --check`, sync-server-tests, verify-app, finance, cogs) on push. `[Dev]` `S`.
- **Completion proof** — notes/photos on job completion (folds into photo upload). `[Dev]`.
- Drop the stale `docs` git remote (points at the retired Documents tree) for a fully clean slate. `[Dev]` `S`.
- Jamieson (jam) business — most new features are OBX-first; jam is secondary/warm. Decide which features extend to jam. `[Dev]`.
- Quote follow-up automation (the ops-brain already flags accepted-but-unscheduled; could auto-nudge). `[Dev]`.

## ✅ SHIPPED (recent, this session — for reference)
Scheduler availability P1/P2 · Message Templates (js/45) · Invoicing (js/46) · View-as owner preview (js/48) · Crew messaging P1 (collection) + P2 (inbox/thread/badge, availability quick-replies) · CEO read path (`/api/ceo`, read-only, tokened) · scoped CEO write path (`/api/ceo/message`, messages-only) · reply-watcher (`tools/reply-watcher.js`) · Push notifications (VAPID tickle + SW handlers + iOS enable-flow) · app-wide notifications banner · SSH-Claude prod bridge (`ops/prod-run.sh` + `prod-bridge.js`, dogfooded a real deploy) · case-insensitive usernames + whitespace-trim · CEO-desk note refresh · branch/worktree consolidation to single `main` · dev-only bypass → gitignored `dev-overrides/` · ops-brain Phase A (capture).

---
*Overnight (`dev` branch) build session — Cap directs, Dev builds, no FF-to-main, no prod deploys until Ray's hand. This doc is bookkeeping; the build keeps moving.*
