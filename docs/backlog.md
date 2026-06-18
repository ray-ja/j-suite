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
- **One-tap Directions + tap-to-Call/Text the customer from a JOB** (job detail; best address property→job→customer). `(Dev-noticed)` `✅ shipped to dev` `S` — extends the customer win to the schedule (the crew-driving case).
- **Search on more lists** — Quotes search `✅` + Schedule/Jobs search `✅ shipped to dev` (flat filtered list by name/customer/date; calendar hides while searching). Gap closed. `(Dev-noticed)` `S`.
- **"On my way" one-tap from a job** — Message Templates has the copy, but it lives in the customer modal; a one-tap from the job itself would be slicker for the crew. `(Dev-noticed)` `⏳` `S`.

## 🎯 CAP'S RANKED LIST (revenue leads polish — work top-down, ergonomics are fill-ins between)
**Round 2 (#5–#7):**
- **#5 Resale tracker** `[Cap #5]` `✅ shipped to dev` `M` — first-class `resale[]` collection (junk-pulled items: pulled→to-list→posted→sold), ♻️ nav tab + inline capture on the job + ops-sweep "unposted resale aging" flag. *Data-model call: collection (not on-job array) — independent multi-week lifecycle + cross-job aggregation + clean ops projection; flagged for Cap.*
- **#6 Push content** `[Cap #6]` `✅ shipped to dev` `M` — SW fetches `/api/push/peek` on wake (device id'd by its own sub endpoint, no token in SW) → shows the real sender + body; always falls back to generic so every push fires (iOS-safe). Returns only the owner's latest inbound preview (no cross-user leak).
- **#7 Scheduling sanity-aid** `[Cap #7]` `✅ shipped to dev` `S` — `js/54`: day modal shows a ⚠ heads-up when a day mixes ≥3 service types (gear/context-switching) or spans ≥3 towns (heavy driving). Non-blocking, pure read.
- **Recurring routes** — MORNING item (Ray supervises the build; revenue spine, LARGE — not unsupervised overnight).


1. **"Who owes me money" — overdue/unbilled view** `[Cap #1]` `✅ shipped to dev` `S` — Finance › 💸 Owed. *Mike Green & Michelle were unbilled; this surfaces them so Ray sends + collects.*
2. **Review-on-completion prompt** `[Cap #2]` `✅ shipped to dev` `S` — done-transition fires a one-tap "ask for a Google review" (reuses the saved review link; OBX-only; SMS prefilled).
3. **Per-job P&L + expense logging** `[Cap #3]` `✅ shipped to dev` `M` — `job.expenses[]` (additive, migration fixture + load() backfill); inline "+ Expense" on the job (disposal·mileage·materials·equipment·misc, **NO labor line**, mileage ×72.5¢); Finance › 💹 P&L weekly view reusing js/39, **worst-margin first**, 🔴 35% floor flag. (plan: `docs/per-job-pl-plan.md`)
4. **Phase C autonomous voice** `[Cap #4]` `✅ shipped to dev` `M` — `tools/ops-brief.js`: sweep findings → Ray-only gap-report digest (each gap + **Cap's read**), crew-facing path built but **GATED OFF** (`CREW_FACING_ENABLED=false`), **dry-run by default** (no 3am buzz). Live `--post` + 07/12/17 cron = the "Schedule the ops-sweep" item.

## 🔨 NOW (in flight, on `dev`)
- **Ops-scanning brain Phase A** — `last-active` + `job.completedAt/By` capture. `[Cap]` `✅` on **main** `1556efa` (deployed to prod).
- **Ops-brain Phase B** — `view=ops` + `ops-sweep.js` gap-rule scanner (overdue/at-risk job, coverage gap, overdue/stale task, forgot-to-clock-out, unscheduled accepted quote, equipment double-book, crew-quiet), cursor-deduped, severity-ranked. `[Cap]` `🔨` on **dev** `e82d948` (live after Ray deploys; fixture-tested 136/0).
- **Ops-brain Phase C** — autonomous voice SHIPPED on **dev**: `tools/ops-brief.js` composes the Ray-only gap-report (gap + Cap's read), crew-facing path **gated OFF**, dry-run-safe. `[Cap]` `✅ dev`. Remaining: live `--post` + 07/12/17 cron (= "Schedule the ops-sweep").

## ⏳ NEXT (queued, near-term)
- **Recurring-route revenue engine** — home-watch / washing / mowing routes; recurring jobs + scheduling + billing cadence. `[Cap #4]` `❓plan-first` `L` — Cap reviews data-model before build.
- **Daily morning brief** ("here's your day") — per-crew/owner 06:30–07:00 dispatch off the ops-sweep. `[Cap]` `⏳` `M` (depends on Phase C + a deploy).
- **Schedule the ops-sweep** — 07:00/12:00/17:00 local, separate from reply-watcher + Dispatch timer (cron on dev box, or pod scheduler). `[Cap]` `⏳` `S`.
- **Push content** — `✅ shipped to dev` (Cap #6): SW fetch-on-wake `/api/push/peek` shows the real body; no token in SW (sub endpoint = capability); generic fallback keeps it iOS-safe.
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
