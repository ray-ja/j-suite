# Jamieson Automation — Phone-Swap Manifest (one-pass)

**Purpose:** the moment Ray gives the real number, the placeholder swap is a single fast pass — no hunting. This doc lists every file, every line, and the exact replacement commands.

**Prepared:** 2026-05-31 by JS JA Ops · **Status:** READY — waiting only on Ray's real number.

---

## The placeholder appears in THREE string forms

A swap that only fixes the visible number will leave **185 dead "click-to-call" links and 3 broken Google schema entries** still dialing the fake number. All three forms must be replaced together. That is the whole point of this manifest.

| # | Form | Where it lives | Count | Replace with (example: real number = `(252) 480-1234`) |
|---|------|----------------|-------|--------------------------------------------------------|
| 1 | `(252) 555-0143` | Visible text on buttons, headers, footers | **134** | `(252) 480-1234` |
| 2 | `+12525550143` | `tel:` click-to-call links (E.164) | **185** | `+12524801234` |
| 3 | `+1-252-555-0143` | `telephone` field in JSON-LD / Google schema | **3** | `+1-252-480-1234` |
| | | **GRAND TOTAL replacements** | **322** | across **39 files** |

Form 3 lives only in the schema blocks of `index.html` (line 14), `smart-home.html` (line 11), and `starlink.html` (line 11). These feed Google's business listing — wrong number here = wrong number in search results.

> **Cross-check before swapping:** every file that has a `tel:` link also carries the visible number, so nothing is orphaned (verified). One file, `thanks.html`, has only the footer tel-link/number; `cro.js` holds the site-wide config that injects the number into pop-ups — both are in the table below.

---

## Files + line references (all forms, per file)

39 files · 322 total occurrences. Line numbers are where at least one form appears; a single line often holds two forms (e.g. `<a href="tel:+12525550143">(252) 555-0143</a>`), which is why per-file counts exceed the line count.

| File | Occurrences | Lines |
|------|:-----------:|-------|
| about.html | 7 | 12, 43, 45, 46 |
| avon.html | 10 | 4, 5, 7, 9, 10, 11 |
| best-smart-locks-obx-vacation-rentals.html | 7 | 5, 9, 11, 12 |
| blog.html | 5 | 6, 10, 11 |
| buxton.html | 10 | 4, 5, 7, 9, 10, 11 |
| case-studies.html | 7 | 6, 10, 11, 12 |
| contact.html | 9 | 12, 15, 18, 25, 26 |
| corolla.html | 10 | 4, 5, 7, 9, 10, 11 |
| cro.js | 2 | 3 |
| do-you-need-mesh-network-obx.html | 7 | 5, 9, 11, 12 |
| duck.html | 10 | 4, 5, 7, 9, 10, 11 |
| faq.html | 9 | 26, 31, 51, 54, 56, 57 |
| frisco.html | 10 | 4, 5, 7, 9, 10, 11 |
| hatteras.html | 10 | 4, 5, 7, 9, 10, 11 |
| index.html | 10 | 14*, 18, 42, 104, 107, 113 |
| kill-devil-hills.html | 10 | 4, 5, 7, 9, 10, 11 |
| kitty-hawk.html | 10 | 4, 5, 7, 9, 10, 11 |
| manteo.html | 10 | 4, 5, 7, 9, 10, 11 |
| nags-head.html | 10 | 4, 5, 7, 9, 10, 11 |
| ocracoke.html | 10 | 4, 5, 7, 9, 10, 11 |
| poe-vs-wifi-cameras-obx.html | 7 | 5, 9, 11, 12 |
| quote.html | 7 | 12, 15, 47, 48 |
| rental-ready-checklist.html | 7 | 4, 17, 18, 19 |
| rental-ready-tech-obx.html | 7 | 5, 9, 11, 12 |
| reviews.html | 7 | 12, 26, 28, 29 |
| rodanthe.html | 10 | 4, 5, 7, 9, 10, 11 |
| security-cameras-nags-head.html | 10 | 4, 5, 7, 9, 10, 11 |
| service-area.html | 7 | 12, 23, 25, 26 |
| services.html | 7 | 12, 15, 35, 36 |
| smart-home-duck.html | 10 | 4, 5, 7, 9, 10, 11 |
| smart-home.html | 10 | 11*, 16, 19, 34, 36, 37 |
| smart-thermostats-coastal-rentals.html | 7 | 5, 9, 11, 12 |
| southern-shores.html | 10 | 4, 5, 7, 9, 10, 11 |
| starlink-corolla.html | 10 | 4, 5, 7, 9, 10, 11 |
| starlink-for-obx-vacation-rentals.html | 7 | 5, 9, 11, 12 |
| starlink-install-standard-vs-roof-mount.html | 7 | 5, 9, 11, 12 |
| starlink.html | 10 | 11*, 16, 19, 43, 45, 46 |
| thanks.html | 2 | 12 |
| why-smart-lock-keeps-going-offline.html | 7 | 5, 9, 11, 12 |

`*` = line containing the JSON-LD schema `telephone` (Form 3).

There is also a stray label in `contact.html` line 18 — `"Replace with your real line"` — meant to be removed on swap. Flagged in the swap step below.

---

## One-pass swap (run when Ray provides the number)

All files are in `websites/jamieson-automation/`. This is a JA Ops asset folder — JA Ops performs the edit; **JS Dev Ops runs the git commit afterward** (JA Ops never runs git).

**Step 0 — set the real number once** (fill in all three forms from Ray's number):

```bash
cd "websites/jamieson-automation"
DISP="(252) XXX-XXXX"      # visible form,    e.g. (252) 480-1234
E164="+1252XXXXXXX"        # tel: form,        e.g. +12524801234
SCHEMA="+1-252-XXX-XXXX"   # JSON-LD form,     e.g. +1-252-480-1234
```

**Step 1 — replace all three forms across every file** (order matters: do the longest/most-specific JSON-LD form first so it isn't partially eaten by the E.164 pass):

```bash
# Form 3 first (JSON-LD dashed) — only 3 files, but most specific
sed -i "s|+1-252-555-0143|${SCHEMA}|g" index.html smart-home.html starlink.html

# Form 2 (E.164 tel: links) — site-wide
sed -i "s|+12525550143|${E164}|g" *.html cro.js

# Form 1 (visible display) — site-wide
sed -i "s|(252) 555-0143|${DISP}|g" *.html cro.js
```

**Step 2 — remove the placeholder reminder label** in `contact.html`:

```bash
sed -i 's|<p class="meta" style="color:var(--muted)">Replace with your real line</p>||' contact.html
```

**Step 3 — VERIFY (must return 0):**

```bash
grep -rcE '\(252\) 555-0143|\+12525550143|252-555-0143' . | grep -v ':0$' || echo "CLEAN — no placeholder remains"
grep -rn "Replace with your real line" . || echo "reminder label removed"
```

If Step 3 prints `CLEAN`, the swap is complete and correct. Hand off to JS Dev Ops for the git commit.

---

## Notes / guardrails

- **No edits made yet.** This manifest is read-only prep; the `sed` block above is staged, not run.
- The same placeholder also appears **outside** the Jamieson site (Business App, OBX-Ops checklist, websites/DEPLOY.md, moneymakers/QA-REPORT). Those are **out of JA Ops lane** and intentionally excluded — flag to Strategy if a global swap is wanted.
- Counts verified by `grep -oE` against the live tree on 2026-05-31. Re-run Step 3's grep before the swap in case files changed.
- ❓ASK FOR RZY: real phone number for Jamieson Automation (one number → I derive all 3 forms). Default if unanswered: hold — no swap runs without it.
