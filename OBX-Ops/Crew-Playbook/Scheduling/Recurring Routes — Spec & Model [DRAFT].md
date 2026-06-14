# Spine Recurring-Route Scheduling — Spec & Model  *(DRAFT)*
**Goal:** turn the SPINE (home-watch · washing · mowing) from "jobs we *can* do" into **revenue that runs on a schedule** — Chase + Pierce drive a predictable weekly route without Ray dispatching each day. Ray sets the plan + price once; the schedule runs itself.

This doc is the model + the DevOps data spec. A working generator (`build-route-schedule.py`) + a stops template (`recurring-stops.template.csv`) sit beside it so the routes can run now, before the in-app version exists.

---

## 1 · The unit: a Recurring Plan
Every recurring relationship is one record:

`customer · property/address · zone · line · cadence · anchor_day · anchor_week · est_min · price · notes`

- **line:** `home-watch` | `wash` | `mow`
- **cadence:** `weekly` · `biweekly` · `monthly` · `seasonal` (washing campaigns)
- **anchor_day:** fixed weekday (Mon–Fri) — keeps the stop predictable and routes dense
- **anchor_week:** for biweekly = `A`/`B`; for monthly = `1`–`4` (which week of the month)
- **est_min:** on-site + local drive estimate (home-watch ~30–45, mow ~30–60, wash batch varies)
- **price:** the guardrail plan price (recurring = 20% off)

## 2 · Zones (batch by geography — windshield time is the hidden cost)
North → south, group every route day by zone so the crew isn't crisscrossing the OBX:

`Carova · Corolla · Duck · Southern Shores · Kitty Hawk · Kill Devil Hills · Nags Head · Manteo/Roanoke Is. · South (Rodanthe→Hatteras) · Ocracoke`

**Rule:** a route day = one zone (or two adjacent). Remote north (Carova/Corolla) and the south villages are **bundled days only** — never a single stop (ties to the travel/zone pricing in the menu: remote = higher minimum + travel line).

## 3 · Cadence by line (how each spine line actually recurs)
- **Home-watch** — the metronome. Weekly / bi-weekly / monthly per the owner's plan. ~30–45 min incl. drive. This is what fills the recurring calendar.
- **Mowing** — weekly or bi-weekly **in season (≈Apr–Oct)**, dialed back or paused off-season. Same zone-day as home-watch where possible (one drive, two services on the same street).
- **Washing** — does **not** recur weekly. Each home is annual or semi-annual. So washing runs as **zone campaigns**: batch a zone's due washes into a scheduled block (e.g., "Duck annual washes — May"), not a weekly stop. The plan still books the next occurrence so it never gets forgotten.

## 4 · The weekly route grid (template — Ray tunes to the real book + crew availability)
Assign zones to weekdays so recurring stops cluster:

| Day | Zone focus (example) |
|---|---|
| Mon | North — Corolla / Duck |
| Tue | Southern Shores / Kitty Hawk |
| Wed | Kill Devil Hills / Nags Head |
| Thu | Manteo / flex / overflow |
| Fri | One-offs + washing campaigns + catch-up |

Each recurring plan's `anchor_day` is set to its zone's day. Bi-weekly stops alternate A/B weeks; monthly stops land on their `anchor_week`.

## 5 · Capacity guardrail (2-person crew, limited availability)
The crew is a **smaller lever than hoped** — availability is limited. So the schedule must show **load vs. capacity** so Ray never overbooks the book.
- Set a realistic **field-minutes-per-route-day** ceiling (Ray's number; the generator defaults to 360 min = ~6 hrs, tune it).
- The generator sums each day's `est_min` and **flags any day over capacity** → that's the signal to push a stop to another day, raise price/cadence, or (if the book outgrows two people) it's a **hire/sub decision for Ray**, not a Ray-does-it decision.
- Recurring revenue target falls straight out: Σ(price ÷ cadence-weeks) across the book = predictable weekly run-rate.

## 6 · DevOps data model (what to build in-app)
1. **`RecurringPlan`** table with the fields in §1, attached to the existing customer/property records.
2. **Schedule generator:** expand plans into dated visits (respecting anchor_day/week + cadence), render the crew's **"Today's Route"** ordered by zone/address (Google Calendar connector can mirror it).
3. **Visit close-out** writes the photo report (home-watch SOP) and **auto-books the next occurrence** — the loop that makes it recurring.
4. **Capacity view:** week load vs. the field-minutes ceiling, with overbook flags (mirror of the generator here).
5. **Run-rate readout:** recurring $ booked / week, by line and zone — the "spine is running" metric.
6. Honor Ray-set guardrails: crew schedules within them, never re-prices.

## 7 · Interim tool (use now, pre-app)
- **`recurring-stops.template.csv`** — the book. Ray/crew fill one row per recurring plan.
- **`build-route-schedule.py`** — reads the CSV, prints a 4-week dated route schedule grouped by day+zone, with per-day load vs. capacity and a weekly recurring run-rate. Re-run whenever the book changes. (Same logic DevOps mirrors in-app.)
