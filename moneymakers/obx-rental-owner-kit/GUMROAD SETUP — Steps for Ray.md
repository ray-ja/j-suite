# Gumroad Setup — Steps for Ray

*A short, do-it-when-you're-ready guide to put the kit on sale. **You handle the account, payout, and money — this is just the click-path.** Gumroad is the suggested store (simplest for digital products, handles delivery + payment); Payhip or Stripe work too. Nothing here moves money until you publish.*

> Time to set up: ~30–45 minutes once the final PDFs are ready.

---

## Before you start (have these ready)
- The final PDFs — **already built** by Dev: `OBX-Rental-Owner-Kit.pdf` (paid master, 20pp) and `OBX-Rental-Owner-Kit-SAMPLE.pdf` (free, 5pp).
- A bank account / PayPal for payouts.
- The sales copy — Dev already built it into `index.html` with **3 Gumroad placeholders** (`REPLACE_WITH_GUMROAD_LINK`) you'll paste your links into.

---

## Step 1 — Create the account
1. Go to **gumroad.com** and sign up (use the business email).
2. Complete payout settings (bank/PayPal) and tax info. *(Gumroad handles sales-tax/VAT collection for digital goods — one less thing for you.)*

> **Delivery model (decided — launch shortcut):** all three paid tiers deliver the **same full 20-page master** (`OBX-Rental-Owner-Kit.pdf`). The only real difference is the **$49 tier adds a 20-min consult**. This is the fastest path — one file to manage. (Component-gating can come later.)

## Step 2 — Create the product (Tier 1: The Kit — $29)
1. Dashboard → **New Product** → type **Digital product**.
2. Name: **The OBX Rental Owner's Operations Kit**.
3. Price: **$29**.
4. Upload `OBX-Rental-Owner-Kit.pdf` (the 20-page master — all 7 components).
5. Description: paste from `sales/Sales Page Copy.md` (hero + what's inside + why-it's-worth-it + FAQ).
6. Cover image: the kit cover (it's page 1 of the master PDF — export it as an image).

## Step 3 — Add the higher tiers (Gumroad "Versions")
Gumroad lets one product have multiple **versions** at different prices — use this for the three tiers. **All three deliver the same 20pp master**; only the $49 adds the consult note:
1. In the product, enable **Versions**.
2. **Version A — The Kit ($29):** the master PDF.
3. **Version B — Kit + Tech-Ready Guide ($39):** the master PDF (the Tech-Ready Guide is part of it — this tier highlights it as the step-up reason).
4. **Version C — Kit + Tech Guide + Consult ($49):** the master PDF **+** the consult-booking note PDF.
*(Only Version C needs an extra file. A, B, and C otherwise upload the same master — quick to set up.)*

## Step 4 — The $19 launch promo
Two easy ways:
- **Discount code:** Checkout → create a code (e.g. `LAUNCH`) that takes the $29 Kit to $19, with an expiry date; or
- **Temporarily set the base price to $19** for the launch window, then raise to $29.
*Either is fine — a coded promo lets you keep the "$29, on sale for $19" anchor, which converts better.*

## Step 5 — The free sample (lead magnet)
*Dev already built a free-sample capture form on the sales page that delivers `OBX-Rental-Owner-Kit-SAMPLE.pdf`. You can use that, OR mirror it as a $0 Gumroad product — either works:*
1. (Gumroad option) Create a **second product**: **Free: OBX Turnover Checklist**, price **$0** ("pay what you want," min $0).
2. Upload **only** `OBX-Rental-Owner-Kit-SAMPLE.pdf`.
3. Turn on **email capture** so these feed your list/sequence.
4. On the free product's receipt/redirect, link to the paid kit (the upsell).

## Step 6 — Connect it to the site
- Dev's `index.html` has **3 `REPLACE_WITH_GUMROAD_LINK` placeholders** — one per tier. Paste each Gumroad product/version URL into the matching one.
- Gumroad supports **overlay/embed** buttons so checkout happens on your own page — cleaner than sending people away.

## Step 7 — Test, then publish
1. Use Gumroad's **preview / test purchase** to confirm the right files deliver for each tier.
2. Confirm the free sample delivers and captures the email (and that the Netlify form on the site is wired to the email sequence — see Dev notes).
3. Keep `OBX-Rental-Owner-Kit.pdf` **out of the public deploy folder** (Gumroad hosts/delivers it); only the sample is public.
4. Publish. Share the link (and run it through the launch playbook's channels).

---

## Notes
- **Money & accounts are yours** — I don't create accounts, set payouts, or publish. This is the map; you drive.
- Keep the **paid files off any public URL** — deliver them only through Gumroad's gated download (see PACKAGING).
- Once live, the kit doubles as a lead magnet: every free-checklist email is a warm lead for home-watch and tech services.
- If you'd rather not use Gumroad, **Payhip** (similar, also handles EU VAT) and **Stripe Payment Links + a delivery tool** are alternatives — the tier/file structure is identical.

*Status: ready to execute whenever you connect a store. No action taken on your behalf.*
