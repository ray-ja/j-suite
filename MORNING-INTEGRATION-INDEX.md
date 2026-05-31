# Morning integration index — COGS + payment layer

Everything for the COGS + payment work is staged and self-contained. The repo was **not** touched overnight (the git tree was a stale 32KB cache of the real ~465KB app and another session held `.git/index.lock` — committing would have regressed the app and clobbered other lanes' uncommitted work). This index is the **one-pass running order** once Rzy resyncs the working tree.

**Status:** built, anchor-verified, **33/33 tests green**. Nothing here has been deployed or committed.

---

## The staged files (8)

| # | File | What it is | Role in the morning |
|---|------|-----------|---------------------|
| 1 | `COGS-APPLY-RUNBOOK.md` | The apply procedure | **Start here.** Drives the whole integration. |
| 2 | `cogs-payment-layer.js` | The patch: pure logic (Part 1) + overlay/render snippets (Parts 2–3) + exact find/replace anchors [A]–[I] (Part 4) | Source of everything you paste into the app. |
| 3 | `verify-cogs-math.js` | **Dependency-free** 33-test verifier (no `require`, no DOM) | Primary green-check — run before and after apply. |
| 4 | `cogs-payment-tests.js` | Same 33 tests via `require("./cogs-payment-layer.js")` | Secondary check; also proves the layer file parses. |
| 5 | `cogs-payment-preview.html` | Desktop sandbox of the margin strip / disposal / floor / Pay-now | Reference for **expected behavior** during the browser smoke-test. |
| 6 | `monday-quote-rehearsal.html` | Phone rehearsal of Monday's realtor cleanout quote | Rzy-facing; no repo dependency — usable now. |
| 7 | `Stripe Payment Links — Setup Guide.md` | Plain-language Stripe account + link steps for Rzy | Rzy-facing; runs **in parallel**, gated only on Rzy, not on the merge. |
| 8 | `MORNING-INTEGRATION-INDEX.md` | This file | Map + running order. |

---

## Apply order (one clean pass)

1. **Pre-flight — `COGS-APPLY-RUNBOOK.md` Step 0.** Confirm the tree is the real ~465KB app (not 32KB), the engine is present (`wizReview`, `RATES_DEFAULT`), the **idempotency sentinel** `COGS_LAYER_V1` is **absent** (=0; if ≥1 it's already applied → skip to step 4), `.git/index.lock` is gone, and **every anchor [A]–[I] greps to exactly 1**. If any check fails, stop and reconcile — do not edit.
2. **Baseline tests.** `node "verify-cogs-math.js"` → expect **33 passed, 0 failed**.
3. **Snapshot + apply — Runbook Steps 1–2.** `cp` the app to `.bak` (rollback), then paste from `cogs-payment-layer.js`: Part 1 (after `calcQuote()`, sentinel included), Part 2 (after `setRates()`), Part 3 (near `money()`), then anchors **[A]→[I]** in order.
4. **Re-test — Runbook Step 3.** `node "verify-cogs-math.js"` **and** `node "cogs-payment-tests.js"` → both **33/33**. (The second also confirms the edited layer parses.)
5. **Browser smoke-test — Runbook Step 4.** Open the edited app; verify the margin strip, sub-35% floor warning, junk dump-fee line, and Pay-now scaffold against `cogs-payment-preview.html`. Check the console for zero JS errors (a single-file app blanks entirely on a syntax slip).
6. **Commit — Runbook Step 5.** Stage **only** the five COGS/app paths (never `git add -A`); commit with the message in the runbook; remove the `.bak`. **No push / no live deploy** without explicit Strategy + Rzy sign-off.

**In parallel (no repo dependency):** hand Rzy `Stripe Payment Links — Setup Guide.md`; he creates the account and pastes a link into the new field once the app is updated. He can rehearse the whole flow now in `monday-quote-rehearsal.html`.

---

## Safety properties (already built in)

- **Idempotent.** The `COGS_LAYER_V1` sentinel (first comment of Part 1) lets Step 0 detect a prior apply and skip — re-running won't double-insert.
- **Anchor-precise.** All 13 find-strings ([A]–[I] + the `getRates`/`setRates`/`money`/`rData` insert points) were verified **verbatim and unique (count = 1)** against the committed engine; Step 0's preflight re-checks count = 1 in the actual tree before any edit, catching drift.
- **Rollback-safe.** Step 1 makes `Business App (v1).html.bak`; if the smoke-test fails, `mv` it back and the app is exactly as before.
- **Scope-safe.** Commit stages only the COGS/app paths, so other overnight lanes' uncommitted work is never swept in.
- **Verifiable without dependencies.** `verify-cogs-math.js` proves the math standalone, even if the require path is unavailable.

## Hard lines (unchanged)
No customer sends · no money moved · no live deploy without explicit Strategy + Rzy sign-off · Rzy does every Stripe/credential step himself · QuickBooks keys stay in the gitignored `qb-config.json`.
