# Overnight build — morning brief for Ray (2026-06-18)

**Everything is on `dev` (tip `9a6edc2`). `main` untouched (`1556efa`). No prod deploys.**
You approve the deploy when you've reviewed; I'll FF `dev`→`main` on your word, then the SSH bridge runs `deploy.sh`.

**Verification on every commit:** `node --check` · `sync-server-tests.js` **160/0** · `verify-app.js` zero console/runtime errors · migration fixtures for every data-layer change. Many features also dogfooded in a headless browser (links/render/lifecycle).

---

## What shipped (Cap's ranked list #1–#7, + ergonomic fill-ins)

**Revenue first (Cap's call: revenue leads polish):**
1. **💸 "Who owes me money"** (Finance › Owed) — ready-to-bill (never-invoiced) + overdue (invoiced-unpaid, >14d flagged) with one-tap chase (📞/💬), Bill, ✓ Paid. *Surfaces the Mike Green / Michelle unbilled gap so you collect.* `284e040`
2. **Review-on-completion prompt** — marking a job done pops a one-tap "ask for a Google review" (reuses your saved review link; SMS prefilled; OBX-only). `63757b1`
3. **Per-job P&L + expense logging** (Finance › 💹 P&L) — log job hard costs inline (disposal·mileage·materials·equipment·misc, **no labor line**, mileage ×72.5¢); weekly P&L reusing the split engine, **worst-margin-first**, 🔴 under-35%-floor flag. `a0eb0f0`
4. **Ops-brain Phase C — autonomous voice** — the sweep composes a **Ray-only gap-report** ("sweep caught: X" + Cap's read on each). Crew-facing path built but **GATED OFF** (one flag). Dry-run by default. `be9b8ad`
5. **♻️ Resale tracker** — junk-pulled items pulled→to-list→posted→sold; new nav tab + inline capture on the job; **ops-sweep now auto-flags "unposted resale aging"** (the "furniture never got posted" failure, caught automatically). `de4c94b`
6. **Push content** — notifications now show the **real sender + message body** (SW fetch-on-wake; no token in the SW; iOS-safe fallback). `a2d41ed`
7. **Scheduling sanity-aid** — the day view warns on **mixed job types** or **heavy-driving (multi-town)** days. `9a6edc2`

**Ergonomic fill-ins (crew-on-phones):** tap-to-Call/Text/Directions on the customer card `5ca6e9c` and on the job `0e32f2d`; search on the Quotes `954b465` and Schedule `9436505` lists (+ hardened a quote-render null-guard).

**Docs:** `backlog.md` (single source of truth), `recurring-routes-plan.md`, `per-job-pl-plan.md`, ops-brain plan updated.

---

## Decisions waiting on you
- **Deploy `dev`→`main`?** Review the above; I FF + bridge-deploy on your word.
- **Resale data model** — I built it as a first-class `resale[]` collection (long lifecycle + cross-job aging flag). Say if you'd prefer on-job.
- **Crew-facing autonomous voice** — built, flag OFF. Flip it on only after the crew meeting (your call / the crossroads).
- **Recurring routes** — Cap held it for a Ray-supervised build (revenue spine, LARGE — not gambled unsupervised overnight). Plan is ready (`docs/recurring-routes-plan.md`).

## Not done (runtime / needs you)
- Live ops-brief **posting** + the 07:00/12:00/17:00 **cron** (the "Schedule the ops-sweep" item) — needs the dev box / scheduler; the brief itself is built + dry-run-proven.
- Bigger asks still `❓scope` in the backlog: photo upload, Stripe, native wrapper — your morning calls.
