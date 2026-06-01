# Quote-Tool Round 2 — Patch & Recovery (for a FRESH clean-mount session)

**Why this exists:** the ~490 KB monolithic `Business App (v1).html` keeps getting **torn by the sandbox mount** on write — Round-2 edits (#4/#7/#8/#9) were isolation-verified but did NOT land intact on the real disk. This doc captures the exact, verified edits so a fresh session (clean mount, after a desktop-app restart) can re-apply them in ONE pass and verify.

## Repo state at handoff (2026-05-31 PM)
- `git HEAD` = `origin/main` (**0 ahead / 0 behind — all pushed**).
- **App at HEAD is GOOD:** commit `4696fb9` "Quotes: punch-list — real COGS…base64 PDF logo…" = **491,171 B, valid, node-checks clean, ends `</script></body></html>`.** Round-1 (punch-list + logo) is committed + safe. The "pre-Round-2 flow" Ray sees IS this valid version.
- **Working-tree `Business App (v1).html` is TORN** (my Round-2 write attempts; truncated, ends mid-`.catch`). **⚠ DO NOT COMMIT IT.**

## Step 0 — restore the clean base (do FIRST, in the fresh session)
```
git checkout HEAD -- "Business App (v1).html"
wc -c "Business App (v1).html"          # expect 491171
tail -c 40 "Business App (v1).html"     # must end </script></body></html>
```
If `wc -c` ≠ ~491171 or the tail is wrong, the mount is still stale — STOP, restart again.

## Step 1 — re-apply Round 2 (#4, #7, #8, #9). All verified in isolation (`node --check` + runtime + math).

### #4 — picker stays open (3 edits)
In `wizAddItem`, `wizAddJunk`, `wizAddDeep`, the add-completion currently does `WZ.step="review";render();`. Change all three to:
```
WZ.step="pick";render();
```
(Replace the double-quoted `WZ.step="review";render();` — 3 occurrences. LEAVE the picker's single-quoted `WZ.step='review';render()` "Review N item(s)" button and the review screen's `WZ.step='pick'` "+ Add another service" button.)

### #7/#8/#9 — wizReview (discount % controls, walk-away floor, margin + take-home)

**(a) Add two handlers immediately after `window.wizRemItem=...`:**
```js
window.wizDiscPct=function(p){let s=0;(WZ.items||[]).forEach(it=>s+=it.price);WZ.discPct=p||0;WZ.disc=Math.round(s*(p||0)/100);render();};
window.wizDiscFlat=function(v){WZ.disc=parseFloat(v)||0;WZ.discPct=null;render();};
```

**(b) In `wizReview()`, after `const total=Math.max(0,sub-recDisc-(WZ.disc||0));`, insert:**
```js
  // negotiation math (items 7-9)
  const cost=itemsCost(WZ.items)+mc;
  const profit=total-cost, margin=total>0?profit/total:0;
  const floorPrice=cost>0?cost/(1-MARGIN_FLOOR):0;          // lowest price that holds the 35% margin floor
  const maxDisc=Math.max(0,sub-floorPrice);                  // room to discount off the subtotal before breaching the floor
  const maxDiscPct=sub>0?(maxDisc/sub*100):0;
  const fieldPool=total*0.60*0.80;                           // OA: 60% Labor Pool → 80% Field Work, then ÷ # working
```

**(c) Replace the old discount/miles/subtotal/cost-note block** — i.e. replace exactly:
```
    <label>Extra discount ($, optional)</label><input type="number" id="wz_disc" value="${WZ.disc||0}" onchange="WZ.disc=parseFloat(this.value)||0;render()">
    <label>Round-trip miles (drive cost @ ${MILEAGE_RATE_LABEL}/mi)</label><input type="number" id="wz_miles" value="${WZ.miles||0}" onchange="WZ.miles=parseFloat(this.value)||0;render()">
    <div style="margin-top:10px;font-size:14px">Subtotal: ${money(sub)}${recDisc?"<br>Recurring −"+money(recDisc):""}${WZ.disc?"<br>Discount −"+money(WZ.disc):""}</div>
    ${cogsStrip(total, itemsCost(WZ.items)+mc)}
    <div class="sub" style="margin-top:4px">Cost includes ${money(itemsCost(WZ.items))} job hard cost${WZ.miles?" + "+money(mc)+" drive ("+WZ.miles+" mi × "+MILEAGE_RATE_LABEL+")":""}.</div>
```
**with:**
```
    <label>Discount</label>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:6px">
      ${[5,10,15,20,25,30].map(p=>`<button class="btn ghost sm" style="${WZ.discPct===p?'background:var(--accent);color:var(--accent-ink);border-color:var(--accent)':''}" onclick="wizDiscPct(${p})">${p}%</button>`).join("")}
      <button class="btn ghost sm" onclick="WZ.disc=0;WZ.discPct=null;render()">Clear</button>
    </div>
    <div class="row" style="gap:8px">
      <div class="grow"><label style="margin-top:0">Custom %</label><input type="number" id="wz_discpct" inputmode="decimal" value="${WZ.discPct||''}" placeholder="%" oninput="wizDiscPct(parseFloat(this.value)||0)"></div>
      <div class="grow"><label style="margin-top:0">Or flat $</label><input type="number" id="wz_disc" inputmode="decimal" value="${WZ.disc||0}" onchange="wizDiscFlat(this.value)"></div>
    </div>
    <label>Round-trip miles (drive cost @ ${MILEAGE_RATE_LABEL}/mi)</label><input type="number" id="wz_miles" inputmode="decimal" value="${WZ.miles||0}" onchange="WZ.miles=parseFloat(this.value)||0;render()">
    <div style="margin-top:10px;font-size:14px">Subtotal: ${money(sub)}${recDisc?"<br>Recurring −"+money(recDisc):""}${WZ.disc?"<br>Discount −"+money(WZ.disc)+(WZ.discPct?" ("+WZ.discPct+"%)":""):""}</div>
    ${cogsStrip(total, cost)}
    <div class="sub" style="margin-top:4px">Cost includes ${money(itemsCost(WZ.items))} job hard cost${WZ.miles?" + "+money(mc)+" drive ("+WZ.miles+" mi × "+MILEAGE_RATE_LABEL+")":""}.</div>
    ${cost>0?`<div class="card" style="background:var(--soft);margin-top:8px;padding:10px"><div style="font-weight:800;font-size:13px">🛑 Walk-away floor</div><div class="sub" style="margin-top:2px">Lowest price before you drop under the ${Math.round(MARGIN_FLOOR*100)}% floor: <b>${money(floorPrice)}</b>. Room to discount: <b>${money(maxDisc)} (${maxDiscPct.toFixed(0)}%)</b> off the ${money(sub)} subtotal.</div></div>`:''}
    <details class="card" style="margin-top:8px"><summary style="font-weight:800;cursor:pointer">💰 Why this margin + your take-home (tap)</summary>
      <div style="font-size:13px;line-height:1.7;margin-top:8px">
        <b>Margin = price vs. hard cost.</b> Price ${money(total)} − cost ${money(cost)} (job ${money(itemsCost(WZ.items))}${WZ.miles?` + drive ${money(mc)}`:''}) = profit <b>${money(profit)}</b> (${pct(margin)}). This margin <b>excludes your labor</b> — that's paid from the 60% Labor Pool, so it isn't a cost here.<br><br>
        <b>Your take-home from this job</b> — OA split: 25% tax · 15% business · 60% labor → 80% Field Work, split by who works:
        <table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:13px">
          <tr><td>Solo (1 person)</td><td style="text-align:right;font-weight:800">${money(fieldPool)}</td></tr>
          <tr style="border-top:1px solid var(--line)"><td>2 people — each</td><td style="text-align:right;font-weight:800">${money(fieldPool/2)}</td></tr>
          <tr style="border-top:1px solid var(--line)"><td>3 people — each</td><td style="text-align:right;font-weight:800">${money(fieldPool/3)}</td></tr>
        </table>
        <div class="sub" style="margin-top:6px">Field-Work share only (80% of the 60% pool); Sales credit (15%) + Admin (5%) are separate. Hard out-of-pocket (dump/rental) comes from the 15% Business Fund. Industry margins for this kind of work run ~40–65% — but the take-home above is your real number.</div>
      </div>
    </details>
```
**Sanity numbers** (job of one $300 item, cost $100, 10 mi): cost $107.25, margin 64.3%, floor price $165, discount room $135 (45%), take-home $144 / $72 / $48. Confirm these render.

## Step 2 — then the still-TODO Round-2 items (design notes; build in the same clean pass)
- **#5 draft autosave/resume** (deterministic): on every `render()` while `WZON`, persist `WZ` to `localStorage` (e.g. `jra_wizdraft`); on app load, if a draft exists offer "Resume your in-progress quote?"; clear on `wizFinish`/explicit discard. Back/close must not lose it.
- **#10 auto round-trip mileage** (deterministic): compute base→job→dump→base from addresses via the EXISTING OSRM routing already in the app (`router.project-osrm.org`, used by the Sales route planner ~line 3346) + the geocoded property lat/lng; set `WZ.miles` from the result, with the manual `wz_miles` field as override. Base = Ray's HQ (110 Kordol Ln / Kitty Hawk); dump = Dare C&D (Manns Harbor) when the quote has a junk/debris item, else base→job→base.
- **#1 collapse-to-one-page, #2 labels/units + inline dump-fee, #3 sticky price+Add bar, #6 missing-nav** — these are VISUAL/architectural; verify with eyes (Ray QA or computer-use screenshots). #6 can't be diagnosed from code (nav `<nav>` is static; both account renderers call `acctSubnav()`). #2's dump-fee popup lives in `junkHelper` inside the `openQuote` modal that #1 retires — sequence #2 after the #1 decision.
- **"pickup-load model"** (Strategy mentioned) — needs a spec from Strategy/OBX-Ops before building.

## Step 3 — VERIFICATION GATE (before declaring done; Ray commits only after this passes)
1. `tail -c 40 "Business App (v1).html"` ends in `</script></body></html>` (NOT mid-statement).
2. `wc -c` is larger than 491,171 (Round-2 adds ~3–4 KB) and sane (not 32 KB stub, not frozen 477/485 KB).
3. Extract the `<script>` and `node --check` it (or open in a browser — must render, no blank screen, console clean).
4. Open the quote wizard: add 2+ services in a row (picker stays open), see the % buttons, walk-away floor, and take-home card.
5. **Only then** Ray commits + pushes. Suggested msg: `Quotes R2: discount %/custom/flat, walk-away floor, margin+take-home, picker-stays-open` (+ #5/#10 if included).

## ⚠ Standing warnings
- **Never commit the torn working-tree app.** If `git status` shows `Business App (v1).html` modified but you didn't just edit it cleanly, `git checkout HEAD -- "Business App (v1).html"` first.
- See `DevOps/App File Split — Scoping Proposal.md` — splitting the monolith is the permanent fix for the tearing.
