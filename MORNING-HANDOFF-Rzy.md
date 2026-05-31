# Morning handoff — Ray

Overnight the COGS + payment layer got built, tested (**33/33**), and staged. Repo was left untouched on purpose. Here's the short version.

## 👀 See it on your phone right now (zero risk, no setup)
Open either file straight from the project folder — they're self-contained, touch nothing live:
- **`monday-quote-rehearsal.html`** — practice Monday's exact realtor cleanout quote: rooms → loads → dumpster vs. self-haul → live margin + price vs. the market band.
- **`cogs-payment-preview.html`** — the new margin strip, dump-fee helper, sub-35% floor warning, and Pay-now button.

## ✅ What's staged (the batch)
`cogs-payment-layer.js` (the patch) · `verify-cogs-math.js` + `cogs-payment-tests.js` (33/33) · `cogs-payment-preview.html` · `monday-quote-rehearsal.html` · `COGS-APPLY-RUNBOOK.md` + `MORNING-INTEGRATION-INDEX.md` · `Stripe Payment Links — Setup Guide.md`.

## 🚧 The one blocker
The app file couldn't be committed overnight: the git working copy was a **stale 32KB cache** of the real ~465KB app, and another session was holding **`.git/index.lock`**. Committing in that state would have wiped a lot of in-progress work. Both clear once you **resync the folder** (reopen/restart) and confirm no other session is mid-commit.

## ▶ First 3 steps to apply the patch
Open **`COGS-APPLY-RUNBOOK.md`** and follow it — the first three moves are:
1. **Resync + pre-flight (Step 0).** Reopen the folder so the tree is the real ~465KB app, then run the Step 0 checks: app size, engine present, sentinel `COGS_LAYER_V1` = 0, `.git/index.lock` gone, and every anchor greps to exactly 1. If anything's off, stop there.
2. **Snapshot (Step 1).** `cp "Business App (v1).html" "Business App (v1).html.bak"` — your instant rollback.
3. **Apply + test (Steps 2–3).** Paste Parts 1–3 from `cogs-payment-layer.js`, apply anchors [A]→[I], then `node "verify-cogs-math.js"` → expect **33 passed**. Browser smoke-test, then the scoped commit in Step 5.

In parallel, whenever you have a few minutes: **`Stripe Payment Links — Setup Guide.md`** walks you through creating the account so you can paste a pay link into a quote. You do all the Stripe/credential steps yourself.

*No deploy. Nothing pushed. The morning apply is one clean pass.*
