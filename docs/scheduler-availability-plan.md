# Scheduler / Calendar Availability — Implementation Plan (DRAFT for Strategy)

Author: J-Suite Dev lane · 2026-06-14 · branch `plan-scheduler-availability`
Status: **draft for Strategy + Ray to react to.** Not built. Requirement: [[j-suite-scheduler-availability-req]].

## Ray's ask (verbatim intent)
- Logged-in crew can **mark which days they're available / not** right in the calendar, easy **select & unselect**, with **bulk edits** across multiple days.
- A simple one-tap **"Full day available"** button when editing your own schedule.
- Team/admin glance: per day, per person — **full day = green · part of day = yellow · not at all = red.**
- **Easy to use and easy to see others' availability, especially on mobile.**

## What already exists (don't reinvent)
- `js/33-availability.js`: model + resolution. `u.avail = {days[7], start, end}` (recurring weekday pattern) + `u.timeoff[]` (dated off blocks). `availOn(u,ds)` → `{status:'on'|'off'|'timeoff'|'unset', label, cls}`. `availBadge`, `isFree`, `teamAvailOn`, `teamAvailCounts`, self-service modal `openAvailability` (self or owner). Synced on the account record (per-record LWW).
- `js/09-schedule.js`: Calendar subview with month grid (`renderCalendar`) + per-day colored crew chips (`calDayChips`: green=available, amber=time-off, red=off), tap-day → `openDay(ds)`. Plus a "Crew availability" subview (`rCrewSchedule`) with per-member badges + Edit + next-7-days free counts.

So the **team glance is ~80% there** (colored chips per person per day). The genuinely new work: (1) a **partial/yellow** state, (2) **per-specific-day tap-select + bulk editing** in the calendar (today editing is weekday-pattern only, via a modal).

## Data model — RECOMMENDATION: augment, don't replace
Keep the weekday baseline (so a "Mon–Fri 8–5" person sets it once), and add **per-day overrides** for exceptions:

```js
u.avail = {
  days:[false,true,true,true,true,true,false], start:"08:00", end:"17:00",  // existing baseline
  overrides: {                 // NEW — keyed by YYYY-MM-DD, only the exceptions
    "2026-06-20": "full",      // worked a Saturday
    "2026-06-24": "partial",   // half day
    "2026-06-25": "off"        // taking the day
  }
}
```

- `overrides[date]` value: **v1 = enum** `"full" | "partial" | "off"` → maps 1:1 to green/yellow/red and keeps the mobile UX dead-simple.
- **v2-safe**: allow the value to also be an object `{s:"partial", start:"08:00", end:"12:00"}` so "part of day" can later carry hours without a breaking change. Resolution reads `typeof v === "string" ? v : v.s`.
- Override **wins over** the weekday baseline for that date. `timeoff` blocks still win over everything (they carry notes/ranges — keep them distinct).

Rationale: minimal tapping for the common case, full per-day control when wanted (set baseline all-off + paint days), and one small field that rides the **existing account-record LWW sync** (no new collection).

## Resolution logic (js/33 `availOn`)
```
1. timeoff block covering ds?           → 'timeoff'  (red)
2. overrides[ds]?  full→'on'(green) · partial→'partial'(YELLOW) · off→'off'(red)
3. weekday baseline av.days[dow(ds)]?   → 'on' / 'off'
4. no avail set                          → 'unset' (treat as available, current behavior)
```
Add new status `'partial'` (cls `partial`). Update: `availBadge` (+yellow), `calDayChips` (+yellow), `isFree` (partial = free-but-flagged), `teamAvailOn`/`teamAvailCounts` (+partial bucket).

## UI — self-edit in the calendar (the core new interaction)
- New module **`js/44-availability-calendar.js`** (keep files small per CLAUDE.md); hook it into the Calendar subview in `js/09`.
- **Edit mode** (crew on their own; owner can pick any member via a gated "Editing: [me ▾]" selector at top):
  - Tap a day to **select** it (selection ring). Tap again to deselect. Multi-select freely. Helper chips: "Select weekdays" / "Select this week" / "Clear selection".
  - **Sticky bottom action bar — reuse the existing `.wizfoot` pattern** (already pinned above the nav, mobile-tested, FAB auto-hides): shows "N days selected" + buttons **[🟢 Full day]  [🟡 Partial]  [🔴 Off]  [↩ Default]**. Tap applies the bucket to all selected days (writes `overrides`), clears selection, repaints, `touch(u)` + `save()` (LWW sync).
  - The **"Full day available"** button Ray asked for = the 🟢 Full action (also offer it as a one-tap for "today" with no selection).
- Mobile-first: big `.calcell` tap targets, tap-to-select (no drag required for v1; long-press range = optional v2).

## Team glance (admin / everyone)
- `calDayChips` already renders per-member colored initials per day — **add yellow for partial** + a tiny legend (🟢 full · 🟡 partial · 🔴 off · grey not-set).
- `openDay(ds)` detail + `teamAvailListHTML` / `rCrewSchedule` badges → render the partial state.
- That month grid IS the "see everyone at a glance" surface; mainly needs the yellow + legend for clarity.

## Sync + data safety (CLAUDE.md — MANDATORY)
- `u.avail.overrides` lives on the account record → **rides the existing per-record account LWW sync. No new top-level collection / no `blank()`/`COLLECTIONS` change** (confirm accounts are already wired — they are).
- **Migration fixture test (required):** load a realistic pre-change `data.json` (accounts with old `u.avail` `{days,start,end}`, some with `timeoff`, **no `overrides`**) and assert:
  1. `load()` preserves every account + customer + property + quote + job (zero loss).
  2. `availOn()` handles missing `overrides` (defaults to `{}`, no throw) — backward compatible.
  3. After adding `overrides` to one account and a **sync round-trip**, all records survive and overrides persist.
  4. LWW: a newer account record with `overrides` merges without dropping `timeoff`/`role`/`passhash`/other fields.
- **Caveat to flag:** availability is account-record-level LWW — two people editing the *same* member's availability at once = last-write-wins (already true today; fine for 3 users). Finer granularity (overrides as sub-records) is a future option, not v1.

## Files touched
- `js/44-availability-calendar.js` (NEW) — edit-mode state, selection, bulk apply, save.
- `js/33-availability.js` — `overrides` model + `availOn`/`availBadge`/`isFree`/`teamAvailOn`/counts + partial status.
- `js/09-schedule.js` — calendar edit-mode hooks, `calDayChips` yellow, `openDay` partial, legend.
- `app.css` — `.partial` (yellow) class, day selection ring; reuse `.wizfoot`.
- shell — register `js/44`.
- `sync-server-tests.js` (or fixture test) — the migration fixture above.
- `sync-server.js` — **no change expected** (accounts already synced); confirm during build.

## Phasing
1. **Model + resolution + migration fixture** (js/33, tests) — data-safe foundation, all green before moving on.
2. **Self-edit calendar** (js/44 + js/09 hooks + css) — tap-select, bulk, Full-day button.
3. **Team glance** — yellow + legend + day-detail partial.

## Open questions for Strategy / Ray
1. **Hybrid (weekday baseline + per-day overrides)** vs **pure per-day** marking? (Recommend hybrid — least tapping, still fully flexible.)
2. **Partial** = simple yellow bucket (v1) vs hours like "8–12" (v2)? (Recommend enum first, object-compatible for later.)
3. Keep **time-off blocks distinct** (they carry notes + ranges) from per-day "off"? (Recommend keep distinct.)
4. **Edit permission:** self + owner (current rule) — keep? (Recommend keep.)

## Status & deferred work
- **2026-06-17 — v1 SHIPPED & APPROVED (Strategy).** Account-level LWW (per-day `overrides` on the account record) is the v1 design. Migration fixture `fixtures/data-pre-scheduler.json` + `sync-server-tests.js` prove zero record loss + override persistence + field-preserving LWW (78/0).
- **FUTURE TASK (deferred, not v1): per-`(crewId+date)` availability sub-records.** Move per-day overrides out of the account record into their own synced collection keyed by `crewId+date` (stable id), so concurrent edits dedupe per-date instead of clobbering at the account level.
  - **Why it matters:** under account-level LWW, two devices editing the *same* account's availability at once field-clobber (e.g., the owner editing a crew member's calendar while that member edits their own — last full account write wins, losing the other's per-date edits). **Acceptable at 3 users; revisit if the crew grows or this bites in practice.**
  - This is the availability analog of the messaging read-state question — same per-record-vs-per-field tradeoff.

> Build on canonical `C:\dev\j-suite` with the verification bar + scoped commits; the live served tree is a separate sandbox — see [[j-suite-two-tree-split]].
