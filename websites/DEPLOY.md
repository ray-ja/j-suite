# Websites — deploy guide & launch checklist

Two complete, multi-page static websites live in this folder:

- `obx-lot-solutions/` — OBX Lot Solutions (washing, home watch, junk, cleanup)
- `jamieson-automation/` — Jamieson Automation (smart home, Starlink, security, networking)

Both are **plain HTML + one CSS file each — no build step, no framework, no dependencies.** They load instantly, are cheap/free to host, and are hard to break.

## Tech stack
- Static HTML5, mobile-first responsive CSS, a few lines of vanilla JS (year stamp + mobile menu via a CSS checkbox — works even with JS off).
- SEO built in per page: unique `<title>` + meta description, canonical URL, Open Graph tags, **LocalBusiness/Service JSON-LD structured data**, plus `robots.txt` and `sitemap.xml`.
- Lead forms use **Netlify Forms** (no backend to run): the `<form>` has `data-netlify="true"`, a hidden `form-name`, and a honeypot field. On Netlify, submissions show up in the dashboard and can email/Zapier/webhook to your lead system automatically.

## Deploy (pick one — all free tiers work)

### Option A — Netlify (recommended; forms work out of the box)
1. Create a free account at netlify.com.
2. Drag the **`obx-lot-solutions`** folder onto the Netlify "Sites" page (or `netlify deploy --prod --dir=obx-lot-solutions`).
3. Repeat with **`jamieson-automation`** as a second site.
4. Netlify gives each a free `*.netlify.app` URL immediately. Point your real domain (obxlotsolutions.com / jamiesonautomation.com) at it under Site settings → Domain management.
5. Form submissions appear under Forms in the dashboard. Add a notification (email or webhook to your lead pipeline) under Forms → Settings.

### Option B — Cloudflare Pages
`npx wrangler pages deploy obx-lot-solutions` (and again for jamieson-automation). Note: Cloudflare doesn't host forms — wire the form `action` to Formspree, a Cloudflare Worker, or your own endpoint (see below).

### Option C — any static host (GitHub Pages, Vercel, S3)
Upload each folder. For forms off Netlify, set each `<form action="...">` to a form service (Formspree, Basin, Web3Forms) or your own POST endpoint, and remove the `data-netlify` attribute.

## Wiring forms to your lead system later
The form fields already match your Guided Quote wizard (name, phone, email, address, services[], details, recurring/source). To drop leads straight into the app's pipeline, point the form at a small endpoint that writes a `customers` + `quotes` record to your sync server, or use a Netlify → Zapier/Make → your-server webhook.

## ✅ Pre-launch checklist (fill these in before sending traffic)
**Both sites**
- [ ] Confirm the real **phone number** (OBX is set to (252) 207-5985; **Jamieson is a placeholder (252) 555-0143 — replace it**).
- [ ] Confirm the real **email** (placeholders: hello@obxlotsolutions.com / hello@jamiesonautomation.com).
- [ ] Confirm **business hours** in the top bar.
- [ ] Replace the **placeholder reviews** with real Google reviews (reviews.html + homepage).
- [ ] Add real **photos** (before/after for OBX; clean install shots for Jamieson) — drop into each folder and reference them, or leave the clean color/SVG look.
- [ ] Set the real **domain** and update the `canonical`, `og:`, and sitemap URLs if the domain differs.
- [ ] Create the **Google Business Profile** for each and link it (`sameAs` in the JSON-LD).
- [ ] Test the **quote form** end to end after deploy (submit one, confirm it arrives).
- [ ] Add a favicon/logo image (`logo.png`) if you want richer link previews.

**OBX Lot Solutions**
- [ ] Confirm pricing shown (house washes from $299, home watch from $55/visit, etc.) matches your app's rate card.

**Jamieson Automation**
- [ ] Confirm package prices (Starlink $299, Wi-Fi deadbolt $379, 4-cam kit $1,299) and the $29/mo support-plan price.
