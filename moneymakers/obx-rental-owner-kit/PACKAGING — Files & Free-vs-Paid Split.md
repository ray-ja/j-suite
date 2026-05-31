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

Per `sales/Sales Page Copy.md` (pricing LOCKED):

| Tier | Price | Delivers |
|---|---|---|
| **The Kit** | **$29** (launch **$19**) | The six core templates (cover + components 1–6) |
| **Kit + Tech Guide** | **$39** | The six **+ component 7** (Tech-Ready Rental Setup Guide) |
| **Kit + Tech Guide + Consult** | **$49** | The above **+ a 20-min consult** (booking note/link in the download) |

**Delivery options for the tiers** (Dev/Ray choose at store setup):
- Simplest: sell the **20-page master** as the $39 tier (it already contains all 7), and a **6-component cut** as the $29 tier. *(If you'd rather not maintain two master PDFs, an acceptable launch shortcut is to give all paid buyers the full 20pp master and let the price tiers differ by the consult — but the cleanest split gates component 7 to $39+.)* → **flag for Ray's preference at setup.**
- $49 tier = the $39 file set + a short "how to book your 20 minutes" note (link/email).

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
- [ ] Decide the tier-delivery split (gate component 7 to $39+ vs. single master for all paid) — **Ray's call**
- [ ] Master PDF kept OUT of the public deploy folder (store delivers it)
- [ ] Sample PDF on the public/email path; form → email sequence
- [ ] 3 Gumroad links pasted into `index.html` (`REPLACE_WITH_GUMROAD_LINK` ×3)
- [ ] $49 consult-booking note created
- [ ] `Tech-Ready Rental Section (DRAFT).md` archived (superseded)
- [ ] Ray approves before publish
- [ ] County occupancy-tax/permit specifics confirmed (caveats already in the PDFs)

*Canonical copy lives in `kit-contents/`; if copy changes, re-run `build-pdfs.py` to regenerate the PDFs — no manual transcription.*
