# Morning apply runbook — COGS + payment layer

One clean pass to get the COGS + payment layer into the live **Business App (v1).html** and committed. Built and unit-tested overnight (33/33); held out of the repo because the git working tree was a stale 32KB cache of the 465KB live app and another session held `.git/index.lock`. Do this once the tree is healthy.

**Files involved (already in the project folder):**
- `cogs-payment-layer.js` — the drop-in code + the exact find/replace anchors ([A]–[I])
- `cogs-payment-tests.js` — 33 standalone tests (node)
- `cogs-payment-preview.html` — visual sandbox (no repo/app risk; for eyeballing only)

---

## Step 0 — Pre-flight: confirm the tree is real, not the stale cache

The overnight blocker was a desynced mount. Verify the working copy is the **real ~465KB** app and HEAD/lock are clean before touching anything.

```bash
cd "<repo>/Directing partner"
wc -c "Business App (v1).html"          # expect ~465KB, NOT 32KB
grep -c "function wizReview"            # expect 1  (engine present)
grep -c "RATES_DEFAULT"                 # expect >=1
grep -c "COGS_LAYER_V1" "Business App (v1).html"   # IDEMPOTENCY: expect 0 (not yet applied)
ls -la .git/index.lock 2>/dev/null      # expect: No such file (lock cleared)
git status --short                       # review what's already staged/modified by other lanes
```

- **Idempotency gate:** if `COGS_LAYER_V1` returns **≥1**, the patch is already in the file — **skip Part 1–[I], go straight to Step 3 (tests)**. Re-pasting would double-define the functions. (The sentinel is the first comment in the layer's Part-1 block.)
- **Anchor preflight (run before editing):** every find-string must exist **exactly once** in this specific tree. Anchors were verified verbatim+unique against the committed engine; this catches any drift in the working copy. If any line below is not `1`, **stop** and reconcile that anchor before touching the file:

```bash
F="Business App (v1).html"
grep -Fc 'return {name:name,price:rnd5(price),notes:notes};' "$F"                 # [A] =1
grep -Fc '<div class="totbar"><span class="lab">Total to present</span>' "$F"     # [C] =1
grep -Fc 'items:WZ.items.map(it=>({serviceId:"",name:it.name,unit:"quote",price:it.price,qty:1}))' "$F"  # [D] =1
grep -Fc '<input class="pr" type="number" value="${it.price}"' "$F"               # [E] =1
grep -Fc 'items:JSON.parse(JSON.stringify(QITEMS)),recurring:t.rec,subtotal:t.sub,discount:t.disc,total:t.total};' "$F"  # [G] =1
grep -Fc 'function getRates(){' "$F"; grep -Fc 'function setRates(obj){' "$F"     # Part 2 anchor =1 each
grep -Fc 'function money(n){return "$"+(Math.round(n)).toLocaleString()}' "$F"    # Part 3 anchor =1
grep -Fc 'function rData(' "$F"                                                    # [I] =1
```

- If size shows **32KB** or `wizReview`/`RATES_DEFAULT` are missing → the mount is still stale. **Stop.** Reopen/resync the folder (or restart the session) and re-run Step 0. Do **not** commit against a 32KB tree — it regresses the app and wipes other lanes' uncommitted work.
- If `.git/index.lock` still exists → confirm no sibling session is mid-commit, then remove it: `rm -f .git/index.lock`.
- Note the other modified files in `git status`; you'll stage **only** the app file + the three COGS files so you don't sweep up unrelated work.

## Step 1 — Snapshot for instant rollback

```bash
cp "Business App (v1).html" "Business App (v1).html.bak"
```

## Step 2 — Apply the patch (anchors [A]–[I] from cogs-payment-layer.js)

Open `cogs-payment-layer.js` and apply its sections in order. Each is a precise find → insert/replace; the anchor strings are taken verbatim from the engine.

1. **[Part 1] Pure logic** — paste the whole Part-1 block (constants, `disposalCost`, `lineFigures`, `quoteCogs`, `belowMarginFloor`, `pct`, `COST_DEFAULT`, `calcCost`, `disposalLine`) **immediately after `calcQuote()`** in the `<script>`. *(Drop the `module.exports` tail — browser only.)*
2. **[Part 2] Overlay** — paste `getCosts()` / `setCosts()` **after `setRates()`**.
3. **[Part 3] Render helpers** — paste `cogsStrip()` / `itemsCost()` **near `money()`**.
4. **[A]** `calcQuote()` return → add `cost:calcCost(key,inp)`.
5. **[C]** `wizReview()` → insert `${cogsStrip(total, itemsCost(WZ.items))}` just above the `totbar`.
6. **[D]** `wizFinish()` → persist `cost:it.cost||0` per line, `cost:itemsCost(WZ.items)`, `paymentLink:""` on the quote.
7. **[E]/[F]** `renderLines()` / quick builder → add the editable cost input, `lineCost()`, the junk `junkHelper()` (auto-adds `disposalLine`), and a `cogsStrip` under the total.
8. **[G]** `saveQuote()` → mirror [D]; preserve `paymentLink: CURQ?CURQ.paymentLink:""` on edit.
9. **[H]** saved-quote modal + `wizDone()` → the Pay-now button / add-link field + `setPayLink()`. **Scaffold only — no keys, no API, no money.**
10. **[I]** `rData()` (Settings) → a "Job costs" editor backed by `getCosts()/setCosts()` + "Reset costs to defaults".

> Reference behavior while editing: open `cogs-payment-preview.html` in a browser to see exactly how the strip, floor warning, dump-fee helper, and Pay-now should look/behave.

## Step 3 — Verify the math (must stay 33/33)

```bash
node "cogs-payment-tests.js"            # expect: 33 passed, 0 failed
```

If you tweaked any `COST_DEFAULT` figure during review, update the matching assertion and keep it green.

## Step 4 — Smoke-test the live app in a browser

Open the edited `Business App (v1).html` and confirm, before committing:
- Guided Quote → review screen shows the **Cost / Price / Profit / Margin** strip.
- Push the discount until margin drops under 35% → the **red floor warning** appears.
- Quick builder → a junk line → **dump-fee helper** adds a disposal cost line; margin updates.
- Saved quote with no link → "Add payment link" field; paste a link → **Pay now** button appears (opens the link, moves no money).
- Open the browser **console** → no JS errors. (A syntax slip in a single-file app blanks the whole thing — this catch is why we smoke-test before commit.)

If anything's broken: `mv "Business App (v1).html.bak" "Business App (v1).html"` and re-apply.

## Step 5 — Commit (scoped — don't sweep other lanes' work)

```bash
git add "Business App (v1).html" cogs-payment-layer.js cogs-payment-tests.js cogs-payment-preview.html
git commit -m "Quotes: COGS layer (per-line cost from rate overlay, live Cost/Price/Profit/Margin), junk tonnage->disposal helper (\$73.16/ton, 500 lbs free), sub-35% margin floor warning, provider-agnostic paymentLink + Pay-now scaffold (Stripe default, no keys/no money). 33/33 unit tests."
rm "Business App (v1).html.bak"
```

**Do not** `git add -A` / `git add .` — other overnight lanes have uncommitted work in this shared repo; stage only the five paths above. **No push / no live deploy** unless Strategy + Rzy both clear it.

## Hard lines (unchanged)
No customer sends · no money moved · no live deploy without explicit Strategy + Rzy sign-off · Rzy connects Stripe himself · QuickBooks keys stay in the gitignored `qb-config.json`.
