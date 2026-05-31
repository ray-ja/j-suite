# Jamieson Site Update — Handoff to JS Dev Ops

**From:** JS JA Ops · **Date:** 2026-05-31 · **Status:** edits complete in working tree, verified, **awaiting Dev Ops git commit** (JA Ops does not run git).

All changes are in `websites/jamieson-automation/`.

## 1. Phone swap — DONE (757-903-8899)

Placeholder `555-0143` → real line **757-903-8899** across all 39 pages, in all three string forms:
- Display `(757) 903-8899` — 134
- `tel:+17579038899` (E.164) — 185
- JSON-LD `+1-757-903-8899` — 3 (index, smart-home, starlink schema)

Verified: **0 placeholder remnants**, all pages end in `</html>`, every page keeps its call links + sticky call-bar. Reminder label on contact.html removed.

## 2. Value pricing — DONE (flat labor + hardware pass-through, no insurance claim)

Reframed pricing site-wide to the directed model: **flat published install labor + equipment billed at cost (no markup, buy-direct welcome)**. Numbers used are all from the approved `Jamieson — Product & Install Guide.md`; no new prices invented.

- Added a **"How our pricing works"** card on services.html and a matching line on the homepage + a new FAQ Q&A (visible + JSON-LD).
- Reframed price lines on services.html and smart-home.html (locks, cameras, networking, thermostat, Starlink) from bundled "supply + install" to "flat install $X + hardware at cost (typical $Y) — turnkey from ~$Z." Turnkey ballparks retained for conversion.
- **No "insured/insurance/bonded" claim anywhere** — confirmed clean. The only "licensed" references are to a third-party *licensed electrician partner* (honest scoping, left as-is). Jamieson stays silent on insurance per Strategy.

❓ASK FOR RZY / Strategy (pricing judgment call, low-stakes): camera & mesh **systems** are now shown as "install from $149 + equipment at cost (turnkey ~$1,299 / ~$499)" rather than a single flat system-labor number, because the Guide doesn't define a labor-only figure for a full multi-camera/mesh job. Default if no change requested: leave as-is (honest, conversion-safe). If you want a published flat system-labor rate, give me the number and I'll set it.

## 3. ⚠️ Tooling gotcha for Dev Ops (important)

The file **Edit/Write tools truncated these long single-line HTML files** mid-content when I first edited them (lost the footer/call-bar/scripts tail). I caught it in verification and rebuilt the 4 affected files cleanly via shell (`sed`/Python), which handles them fine. **Recommendation: edit these minified-style pages with `sed`/scripts, not line-based file editors.** All 4 files are now confirmed complete.

Files changed: `index.html`, `services.html`, `smart-home.html`, `faq.html` (content) + all 39 pages (phone). Ready to commit.
