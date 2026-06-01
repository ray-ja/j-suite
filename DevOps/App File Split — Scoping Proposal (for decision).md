# App File Split — Scoping Proposal (for Strategy/Ray decision)

**Problem (recurring root cause):** `Business App (v1).html` is a **single ~491 KB file** with ~467 KB of JS in one `<script>`. The sandbox mount **tears large-file writes** — edits pass isolation `node --check` but land truncated on the real disk (Round-2 lost this way; multiple sessions burned). Small files sync fine; only this monolith tears. **Splitting it into small files ends the tearing permanently.**

## Recommended approach — mechanical split into plain `<script src>` files (LOWEST risk)
The JS is all **global-scope** (hoisted `function`s + `window.fn=…` onclick handlers + shared globals `S/WZ/TAB/…` + a boot block at the end). So we do NOT need ES modules or a bundler. Just **cut the one big `<script>` into ~10 topical `.js` files and load them in order** with `<script src>`. Behavior is byte-identical; only the packaging changes.

### Why this is safe + ends the problem
- Each output file is **10–50 KB → the mount syncs it reliably**; all future edits land intact.
- **Zero logic change** — pure relocation of code between `<script>` tags. Globals stay shared because classic (non-module) scripts share one global scope.
- Works in **both runtimes** the app uses: the Ubuntu sync-server AND Ray opening the local `file://` (classic `<script src>` with relative paths works from `file://`; ES modules would NOT — another reason to avoid modules).
- **The split itself dodges the tearing:** read the clean monolith from `git show HEAD` (object store, untorn), write the N small files. We never depend on a large working-tree write.

### Proposed file layout (~10 files, cut at the existing `/* ---------- … ---------- */` banners)
- `index.html` — shell only: `<head>` + body skeleton (`header`, `nav`, `#view`, `#fab`, `#overlay/#sheet`) + `<link rel=stylesheet href=app.css>` + ordered `<script src>` list. (~6–8 KB)
- `app.css` — the current `<style>` block. (~12 KB)
- `js/00-core.js` — globals/state, `S`, `load/save`, `uid/money/esc`, `render()` dispatcher, `modal`. (load FIRST)
- `js/data.js` — sync server client, import/export, backup.
- `js/today.js`, `js/accounts.js` (customers+properties), `js/schedule.js`, `js/sales.js` (OSRM routing), `js/plan.js` (plan/market/opps/training/sites/buildplan can share or split), `js/users.js`.
- `js/quotes.js` — the big one: COGS layer, `calcQuote/calcJunk/calcDeep`, the wizard (`wiz*`), `openQuote` builder, `printQuote`. (still the largest, but ~80–100 KB, well under the tear threshold)
- `js/99-boot.js` — the boot block (`applyTheme(); load(); setBiz(); …`). (load LAST)

Load order only matters for top-level `const`/`let` and the boot block — keep core first, boot last; hoisted functions are order-independent.

### Effort / risk
- **~1 focused clean-mount session.** Mechanical cut + fix load order + verify.
- **Verification:** open in a browser (file:// AND served), exercise every tab, full quote flow, sync, print. Diff behavior against the current HEAD build.
- **Risk:** low-moderate. Main pitfalls: (a) a top-level `const` referenced before its file loads → fix by ordering; (b) the inline print-window `<script>` in `printQuote` stays inline (it's written into a popup, not a file). (c) keep the PWA `sw.js`/manifest paths working.
- **Reversible:** if anything regresses, `git revert` to the monolith.

### Alternatives (not recommended now)
- **ES modules** — breaks `file://` use + needs export/import refactor of ~200 functions. High risk, no upside here.
- **Bundler/build step** — adds tooling to a zero-build app; reintroduces a "large generated file." Defeats the purpose.

## ✅ Status: GREENLIT + tooling built & verified (2026-05-31)
Strategy greenlit Option 1. The split is now **mechanical** — `DevOps/split_app.py` does it deterministically and **proves it lossless**:
- Reads the clean monolith from `git show HEAD` (bypasses the torn mount); writes only small files.
- Tested against HEAD (491,171 B): **30 js files + `app.css` (~14 KB) + a ~3.6 KB shell**; the lossless assert (`"".join(chunks)==original script`) **PASSED**, and the reassembled JS passes `node --check`. The shell ends `</body></html>`. Largest chunk ~100 KB (a data-heavy section, 5× under the monolith — watch it).
- **To execute (clean session, AFTER the Round-2 re-apply is committed so HEAD includes it):** `python3 DevOps/split_app.py . git` → then browser-verify (`file://` + served): every tab, full quote flow, sync, print → Ray commits. `git revert` if anything regresses.
- Load order is source order (boot chunk stays last), so dependencies are preserved. Classic `<script src>` keeps `file://` working.

## Ask
Greenlight the **mechanical `<script src>` split** (Option 1) as a dedicated clean-session task. — DONE (greenlit); script built + verified, ready to run. Sequencing suggestion: **do the Round-2 re-apply FIRST** (small, Ray's waiting on it — see `Quote-Tool Round 2 — Patch & Recovery.md`), **then the split**, so we're not re-applying Round-2 against a moving structure. After the split, all future quote-tool work (the rest of Round 2: #1/#2/#3/#5/#6/#10 + pickup-load model) lands reliably.
