# Packaging — File Manifest & Free-vs-Paid Split

*Asset hygiene so the kit ships clean the moment a store is connected. **Reflects what Dev actually built** (`DEV-BUILD-NOTES.md`) — Dev's generated files are the real deliverables; this doc just documents the split and what's customer-facing vs. internal. Draft.*

---

## What Dev shipped (the real deliverables)

| File | What it is | Pages | Audience |
|---|---|---|---|
| `OBX-Rental-Owner-Kit.pdf` | **Combined master** — cover + all 7 components, branded, checkboxes/★/fill-ins | 20 | **PAID** (gated) |
| `OBX-Rental-Owner-Kit-SAMPLE.pdf` | **Free "lite"** — Turnover Checklist + "what's in the full kit" + tier CTA | 5 | **FREE** (lead magnet) |
| `index.html` | Sales page (built from `sales/Sales Page Copy.md`) — SEO meta, Product+FAQ JSON-LD, 3 tiers, free-sample form | — | public |
| `build-pdfs.py` | Generator — re-parses `kit-contents/` markdown; re-run after copy edits | — | internal |
| `style.css` | Sales-page styles | — | public (with index.html) |

*Filenames are Dev's and are fine as-is — clean, no spaces. No rename needed; the canonical source markdown stays in `kit-contents/`.*

---

## The free-vs-paid split (clean)

- **FREE — `OBX-Rental-Owner-Kit-SAMPLE.pdf`** (5pp): the complete **Turnover Checklist** plus a "what's in the full kit" page and a tier CTA. Delivered via the sales-page email-capture form → enters the email sequence → upsells the paid kit. It's a real, useful template, not a watered-down teaser.
- **PAID — `OBX-Rental-Owner-Kit.pdf`** (20pp): the full bundle (all 7 components). Delivered **only** through the gated store download.
- **The one hosting rule:** the **master PDF must stay out of any public/deploy folder** — Gumroad (or the store) hosts and delivers it. Only the **sample** is publicly reachable. (Dev's notes already flag this — keep it true at deploy.)

> Distinct from the **Hub's** free Home-Watch Checklist — two different freebies for two audiences (rental operators vs. absentee owners). Don't cross the wires.

---

## The three paid tiers → what each delivers

Per `sales/Sales Page Copy.md` (pricing LOCKED). **DELIVERY MODEL DECIDED (launch shortcut, per Strategy):** all three paid tiers deliver the **full 20-page master** (`OBX-Rental-Owner-Kit.pdf`, all 7 components). Tiers differ only by the consult — **no component gating at launch.**

| Tier | Price | Delivers |
|---|---|---|
| **The Kit** | **$29** (launch **$19**) | Full 20pp master (all 7 components) |
| **Kit + Tech Guide** | **$39** | Same full 20pp master *(the Tech-Ready Guide is highlighted as the reason to step up, but the file is identical)* |
| **Kit + Tech Guide + Consult** | **$49** | Full 20pp master **+ a 20-min consult** (booking note/link in the download) |

**Why this way:** fastest to launch — one master PDF for all paid tiers, only the $49 needs an extra consult-booking note. The $29→$39 step is framed by the *value* (the tech guide) on the sales page even though the file is the same. **Component-gating ($29 = components 1–6, $39 = +7) can be added later if sales justify it** — `build-pdfs.py` can generate a 6-component cut on demand.

> Sales-page note: since both $29 and $39 deliver the same file at launch, keep the tier copy honest — the $39 "adds the Tech-Ready Guide" framing works because a $29 buyer who later wants it is told it's included when they upgrade. (If we ever want strict truth-in-listing, gate it — but for launch this is standard bundle practice and fine.)

---

## Customer-facing vs. internal (don't ship the internal docs)

**Ship (customer-facing):** `OBX-Rental-Owner-Kit.pdf` (gated), `OBX-Rental-Owner-Kit-SAMPLE.pdf` (free), `index.html` + `style.css`.

**Internal only — never in the customer download or public deploy:**
- `README — Kit Overview & Production Notes.md`
- `DEV HANDOFF — PDF Reskin Spec.md`
- `DEV-BUILD-NOTES.md`
- `PACKAGING — Files & Free-vs-Paid Split.md` (this file)
- `GUMROAD SETUP — Steps for Ray.md`
- `build-pdfs.py`, `kit-contents/`, `sales/`, `research/`
- `Tech-Ready Rental Section (DRAFT).md` — Jamieson Ops's source outline, **superseded** by `kit-contents/7`; safe to archive.

---

## Pre-ship checklist
- [x] Tier-delivery model DECIDED — launch shortcut: full master for all paid tiers, $49 differs by consult only (per Strategy)
- [ ] Master PDF kept OUT of the public deploy folder (store delivers it)
- [ ] Sample PDF on the public/email path; form → email sequence
- [ ] 3 Gumroad links pasted into `index.html` (`REPLACE_WITH_GUMROAD_LINK` ×3)
- [ ] $49 consult-booking note created
- [ ] `Tech-Ready Rental Section (DRAFT).md` archived (superseded)
- [ ] Ray approves before publish
- [ ] County occupancy-tax/permit specifics confirmed (caveats already in the PDFs)

*Canonical copy lives in `kit-contents/`; if copy changes, re-run `build-pdfs.py` to regenerate the PDFs — no manual transcription.*
