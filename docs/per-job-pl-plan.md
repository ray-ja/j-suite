# Per-Job P&L + Expense Logging — execution checklist (Cap #3)

Spec locked from Cap's brief. **Holding the wire for Cap's confirm** (per gate). On "go" this is one pass: data + fixture → capture UI → P&L view. `dev` branch, full verify bar + migration fixture mandatory.

## Hard rules (from Cap / the cost model)
- **NO labor line. Ever.** Owners paid from the revenue split, not wages → labor is never a per-job cost. Categories are exactly: **disposal · mileage · materials · equipment rental · misc**.
- **Mileage:** enter miles → amount = `miles × $0.725` (IRS rate, already `MILE_RATE`-ish in cost model). Store the dollar amount (and miles for display). Pull from the job's travel-zone data if present.
- **Don't rebuild the disposal calculator** — the quote tool owns it. v1 captures the dollar amount per expense line only.
- **Reuse js/39 finance-core split engine** — do not reinvent. **Worst-margin jobs first** in the weekly view. **35% margin-floor flag** on any under-floor job.

## Data model (additive, NOT a new collection)
`job.expenses[]` on the existing job record (rides per-record LWW with the job):
```js
{ id:"ex_"+uid(), cat:"disposal|mileage|materials|equipment|misc",
  amount: <number, dollars>, miles: <number, optional, mileage only>,
  note:"", addedAt: now(), addedBy: <userId> }
```
- **load() backfill** (js/02-state.js): every job → `job.expenses = Array.isArray(job.expenses)?job.expenses:[]`. Backward-compatible (absent → []).
- **Edge flagged:** concurrent same-job expense edits clobber via whole-record LWW. Acceptable at 3 users. *If Cap prefers isolation → promote to a synced `expenses` collection keyed by jobId (more plumbing: COLLECTIONS + blank + load + dedupe).* Default = on-job array.

## Migration fixture (gates the build — CLAUDE.md MANDATORY)
In sync-server-tests.js: load a realistic pre-change `data.json` (jobs with no `expenses`) →
1. every customer/property/quote/job/account survives `load()` zero-loss;
2. jobs backfill `expenses:[]`;
3. a job carrying `expenses` round-trips through a sync merge with zero loss;
4. LWW: a newer job record (with an added expense) wins over older; older never resurrects a deleted expense.

## Capture UI (mobile-first, in-context)
Inline **"+ Expense"** on the job detail (`openJob`, existing job only): category dropdown · amount · (mileage → miles field auto-×0.725) · optional note → push line, `touch(job);save()`. Each line editable/deletable. Small renderer like `renderJobEquip`.

## P&L compute (pure, reuses js/39)
Per job: `revenue` = linked quote total (`q.jobId===job.id`) else job price/0 · `hardCost` = Σ expense.amount · `gross = revenue − hardCost` · `margin = gross/revenue` · OA split via js/39 → field/labor take-home on the gross · **flag margin < 0.35**.

## P&L view (new Finance sub-view, next to 💸 Owed)
`js/52-job-pl.js` → `rJobPL()`, registered as a 💹 P&L sub-tab in js/40 (owner/admin). Weekly window (reuse finMonth/bounds pattern): totals row (revenue / hard costs / gross / avg margin) + per-job list **sorted worst-margin first**, each row Cost/Price/Profit/Margin with the 🔴 floor flag.

## Files
js/02-state.js (load backfill) · sync-server-tests.js (fixture) · js/09-schedule.js (inline +Expense in openJob) · **js/52-job-pl.js** (compute + view) · js/40-finance.js (sub-tab) · shell `<script>`.

## Verify before commit
node --check each touched file · `node sync-server-tests.js` (136 + new fixture, 0 failed) · `node verify-app.js` zero errors · migration fixture green.
