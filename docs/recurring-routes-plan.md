# Recurring-Route Revenue Engine — Scoping PLAN (for Cap's review · plan-first, NOT built)

Author: J-Suite Dev lane · `dev` branch (overnight). **Plan only — Cap reviews the data model before any build.** This is Cap's pipeline #4 + a Q4 milestone ("hand Pierce & Chase a repeatable weekly route").

## Why (it's strategically central, not a side feature)
Market research baked into the app says it plainly: ~60% absentee owners → **house-watch is the wedge + recurring money**; **mowing routes** + recurring washing are the SPINE; the model is "recurring contracts (20% off) for predictable revenue." Crew SOPs already list **Home-Watch** and **Mowing/Yard Routes** as SPINE services. So recurring isn't a nice-to-have — it's the revenue thesis.

## What exists today (don't reinvent)
- **No generation engine.** "Recurring" today = a display-only `q.recurring` flag on quotes + recurring-priced catalog items (`hw1–hw5` house-watch monthly/bi-weekly/weekly; mow "recurring 20% off"). `BIZ.obx.recurring=true`. A standing todo: *"Build a recurring-route schedule template."*
- **Jobs** are one-off: `{date,time,crew[],done,completedAt,equipment,customerId,propertyId,quoteId,notes}`. No `routeId`, no recurrence.
- **Finance** (js/39): income records carry `crew[]`, `originator` + `bookedAt` (sales credit, 3-mo window), `houseAccount`; the revenue-split engine is unit-tested.
- **Customers/properties** exist (a route attaches to a property).

So the gap = a **route** entity + **job generation** from it + **recurring billing** tie-in.

## Data model — RECOMMENDATION: a new synced `routes` collection + deterministic job generation
```js
// S[biz].routes[] — one record per recurring service agreement (per-record LWW, stable id)
{
  id: "rt_" + uid(),
  customerId, propertyId,            // who/where
  service: "housewatch" | "mow" | "softwash" | …,   // CREW_BANDS key
  title: "Weekly home-watch — 55 Duck Rd",
  cadence: "weekly" | "biweekly" | "monthly" | "everyN",
  intervalDays: 7,                   // for "everyN"; derived for weekly/biweekly/monthly
  anchorDate: "2026-06-23",          // first/seed occurrence; cadence counts from here
  pricePerVisit: 40, recurringDiscountPct: 20,
  defaultCrew: ["u2"],
  active: true,
  lastGeneratedDate: "2026-06-23",   // generation high-water mark (idempotency)
  notes, createdBy, originator,      // originator = recurring sales credit (see open Q)
  createdAt, updatedAt
}
```
- **Generation (idempotent, multi-device-safe):** for each active route, materialize upcoming jobs up to a **horizon** (e.g. next 2 occurrences) with a **deterministic job id** = `"job_" + route.id + "_" + date`. Because the id is deterministic, every device generates the *same* job id → the sync merge **dedupes** (no duplicate jobs), exactly the "stable ids" rule in CLAUDE.md. Each generated job: `routeId, recurring:true, service, price, crew=defaultCrew, customerId, propertyId, date, title`.
- **Where generation runs:** RECOMMEND client-side in `load()` (a guarded migration-style pass, like the existing seeds) + on the schedule view — cheap, no server change, rides the existing sync. *(Alt: a scheduled server/bridge step. Client-in-load is simplest + offline-friendly; open Q.)*
- **Cadence math:** weekly=+7, biweekly=+14, monthly=+1mo, everyN=+intervalDays from `anchorDate`/`lastGeneratedDate`. Generate while `nextDate <= today + horizon`; bump `lastGeneratedDate`.

## Billing / revenue tie-in
- Each occurrence is a normal job → on **completion** (`job.done`, now stamped `completedAt`), create/prompt an **income** record linked to `routeId`+`jobId`, `amount = pricePerVisit*(1-discount)`, routed through the existing split engine (js/39). Recurring = predictable monthly revenue the Finance page can total.
- **Recurring sales credit (open Q):** the originator/3-mo-window model is per-deal; for an ongoing route, does sales credit apply to every visit, only the first N months, or convert to house? Needs Cap's call (don't guess — it touches the payout split).

## Sync + data safety (CLAUDE.md MANDATORY)
- New synced collection: wire **`"routes"`** into server `COLLECTIONS` + client `blank()`/`load()` backfill (per-record LWW, stable ids) — same pattern as `messages`.
- **Migration fixture (gates the build):** load a realistic pre-routes store → every customer/property/quote/job/account survives `load()` + round-trip zero-loss; a route rides LWW; **generated jobs dedupe by deterministic id across two devices** (no doubles); backward-compatible (no `routes` key → scaffolds empty). Generation must NEVER duplicate or drop a real one-off job.

## UI (mobile-first)
- **Routes** section (owner): list active routes; add/edit (customer → property → service → cadence → price → crew → active). Small module `js/NN-routes.js` + nav (role-gated) + shell `<script>`.
- Generated jobs appear on the **Schedule** like any job, with a "🔁 route" badge; editing a single occurrence doesn't break the series (it's a real job).
- Ops-brain tie-in (Phase B): a gap rule — **"route occurrence due, no job generated / scheduled"** and "recurring visit missed" → feeds the sweep.

## Files (when built, after approval) + phasing
1. **Data layer + fixture:** `sync-server.js` COLLECTIONS `+routes`; `js/02-state.js` blank/load; fixture in `sync-server-tests.js`. Verify green.
2. **Generation engine:** deterministic job generation in `load()` (+ helpers), idempotent + dedupe-tested.
3. **Routes UI** (`js/NN-routes.js`) + nav + schedule badge.
4. **Billing tie-in** + ops-brain route gap rule.

## Open questions for Cap
1. **Generation location** — client `load()` (recommend) vs a scheduled server/bridge job?
2. **Horizon** — how many occurrences ahead to materialize (2? to month-end? a rolling 30 days)?
3. **Recurring sales credit** — every visit / first-N-months / house after window? (touches the split — Cap's call.)
4. **Billing automation** — auto-create the income record on completion, or owner confirms each?
5. **Quote → route** — should accepting a "recurring" quote auto-create the route (closes the existing `q.recurring` loop)?
6. Routes OBX-only, or also Jamieson (jam)? (jam is mostly one-off/project work.)

> Build on `main` (post-overnight) with the verify bar + migration fixture; new collection = wire COLLECTIONS + blank + load together and prove zero-loss + dedupe before any UI.
