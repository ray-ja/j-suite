# Owner Go-Live Checklist — do these in order
*Ray's account/deploy actions, sequenced so nothing blocks you mid-task. ~2–3 hours. Each step lists what it unblocks. Draft.*

**Before you start — have these tabs/logins open:** Netlify, Google (for GBP), Stripe, Amazon Associates, Gumroad. Have your domains (obxlotsolutions.com, jamiesonautomation.com) and the real phone/email handy.

---

### ① Deploy the sites on Netlify  *(do first — almost everything links to a live URL)*
- [ ] Create a free Netlify account.
- [ ] Deploy each site folder (drag-and-drop or `netlify deploy --prod --dir=<folder>`). Mechanics + pre-launch fixes are in **`websites/DEPLOY.md`**.
- [ ] **Fix placeholders before traffic:** Jamieson phone `(252) 555-0143` → real; confirm emails; swap placeholder reviews once Google reviews exist.
- [ ] Point real domains (Site settings → Domain management) and update canonical/OG/sitemap URLs if the domain differs.
- [ ] Set the **`obxlotsolutions.com/review` redirect** now that the OBX site is live (target gets filled in Step ②).
- [ ] Test each quote form end-to-end (submit one, confirm it lands).

> **The four properties to deploy:** **OBX Lot Solutions** (`websites/obx-lot-solutions/`), **Jamieson Automation** (`websites/jamieson-automation/`), **Second-Home Care Hub**, and **Rental Owner's Kit** landing (`moneymakers/obx-rental-owner-kit/`). → *unblocks ②, ③, ④, ⑤.*

### ② Create the Google Business Profiles  *(needs the live site/domain from ①)*
- [ ] Create + verify a GBP for **OBX Lot Solutions** (and **Jamieson Automation**) — full steps in **`Marketing/Launch-Day Playbook.md`**; owner-action summary in **`OBX-Ops/Ray — Google Setup Checklist`**.
- [ ] Grab the **review link** (`g.page/r/…/review`) and point the `/review` redirect from ① at it.
- [ ] Add the GBP URL to each site's JSON-LD `sameAs`.
- [ ] **Wire the QR:** the printed **Review Card / QR** (in `OBX-Ops/`) already point to `/review` — now live. → *unblocks the review-request cadence.*

### ③ Connect Stripe + paste payment links  *(needs sites live from ① to embed)*
- [ ] Create the Stripe account; complete business verification.
- [ ] Create **payment links / products** (house-watch plans, washing, deposits, the $95 storm check, etc.).
- [ ] Paste links into: the sites' "Pay / Book" buttons, invoices, and the home-watch completion flow.
- [ ] Send yourself one test payment. → *unblocks taking money on completed jobs.*

### ④ Affiliate signups  *(needs the Hub live from ① — Amazon requires a real, content-filled site)*
- [ ] Apply to **Amazon Associates**; once approved, get your tracking ID.
- [ ] Add affiliate links to the Hub's product cards per **`OBX-Ops/research/Hub — Affiliate Product Plan`** (leak/freeze sensors, dehumidifiers, etc.).
- [ ] Add the required **FTC affiliate disclosure** to each page.
- [ ] (Later) apply to higher-paying retailer/brand programs (Home Depot/Lowe's, SimpliSafe, Ring, Moen). → *unblocks affiliate revenue.*

### ⑤ Set up the Gumroad store  *(last — it's the storefront the sites link to)*
- [ ] Create the Gumroad account.
- [ ] Add products (the **Rental Owner's Operations Kit**, etc.), set prices, descriptions, cover.
- [ ] Paste the Gumroad product/store links into the Hub and into email/marketing. → *unblocks selling the Kits.*

---
**Done when:** all four sites resolve on their domains, GBP live + review link wired to the QR, Stripe taking test payments, affiliate links live with disclosure, and Gumroad products purchasable.

*Note: OBX Lot Solutions and Jamieson Automation are ready in `/websites`; the Second-Home Care Hub and the Rental Owner's Kit landing (`moneymakers/obx-rental-owner-kit/`) deploy the same way once Dev finalizes them.*
