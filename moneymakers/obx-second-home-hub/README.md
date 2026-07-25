# OBX Second-Home Care Hub

A standalone static content + lead-gen site targeting **Outer Banks second-home owners**, funneling to OBX Lot Solutions' home-watch service and monetized with affiliate gear recommendations. Built in its own folder — **not** part of the j-suite app/repo, so it deploys and commits independently with zero lock risk.

**Stack:** plain HTML5 + one CSS file. No build step, no framework, no dependencies. Mobile-first. Matches the OBX Lot Solutions brand (green `#8BC34A` / navy `#1B2A4E`).

## Pages (23 HTML + PDF)
- `index.html` — home; guide hub + lead funnel + gear teaser. *(LocalBusiness + FAQ schema)*
- `storm-prep.html` — coastal storm prep guide
- `hurricane-checklist.html` — printable do-in-order checklist *(HowTo schema)*
- `vacancy-insurance.html` — vacancy clauses & coastal coverage *(FAQ schema)*
- `off-season-care.html` — winter closing guide
- `smart-monitoring.html` — sensors/locks/cameras/connectivity *(Jamieson install cross-sell)*
- `hire-home-watch.html` — DIY vs neighbor vs pro *(FAQ schema)*
- `recommended-gear.html` — **affiliate** product recs + disclosure *(ItemList schema)*
- `get-home-watch.html` — **Netlify-Forms** lead funnel → `thanks.html`
- `cost-calculator.html` — client-side **Home-Watch Cost & Coverage calculator** with lead capture (estimate written into hidden form fields)
- `service-area.html` — index linking all 10 towns *(LocalBusiness schema)*
- **10 town landing pages** `home-watch-{corolla,duck,southern-shores,kitty-hawk,kill-devil-hills,nags-head,manteo,avon,hatteras,ocracoke}.html` — each with LocalBusiness + FAQ schema, local content, and full cross-linking
- `free-checklist.html` — lead-magnet capture page; form records the lead then delivers `OBX-Home-Watch-Checklist.pdf` (also a direct-download link). A second Netlify form, `checklist-download`.

Plus `style.css`, `robots.txt`, `sitemap.xml`, and `OBX-Home-Watch-Checklist.pdf` (Marketing's lead magnet).

## Netlify Forms (2)
`home-watch-lead` (get-home-watch + cost-calculator) and `checklist-download` (free-checklist). Both need a notification wired under Forms → Settings to route to OBX home-watch.

## ✅ Before launch — fill these in (search the files for each token)
1. **Affiliate links.** In `recommended-gear.html`, replace every `REPLACE_WITH_AFFILIATE_LINK` (11 product links) with your real affiliate URLs. Amazon Associates is the easy default (free to join). Keep `rel="sponsored nofollow"` and the disclosure block. The gear teasers on the guide pages link into this page's anchors, so you only edit links in one file.
2. **Domain.** Canonical/OG URLs use the placeholder `https://www.obxsecondhomehub.com/`. If you use a different domain (or host it as a subdomain/subfolder of obxlotsolutions.com), find-and-replace that base URL across all files and in `sitemap.xml` / `robots.txt`.
3. **Email.** Schema uses `hello@obxlotsolutions.com` — confirm or change.
4. **Phone** is set to the real OBX number `(252) 207-5985`. Confirm.

## Deploy (Netlify recommended — forms work out of the box)
1. Free account at netlify.com.
2. Drag the **`obx-second-home-hub`** folder onto the Netlify "Sites" page (or `netlify deploy --prod --dir=obx-second-home-hub`).
3. Free `*.netlify.app` URL immediately; point your domain under Site settings → Domain management.
4. **Lead routing:** submissions appear under **Forms → home-watch-lead**. Add a notification (Forms → Settings → Notifications) to **email leads to OBX home-watch**, or webhook to Zapier/Make → the J-Suite sync server to drop them straight into the Guided Quote pipeline. The form fields (name, phone, email, address, property_type, frequency, services[], details, source) already match the app's customer/quote shape.

*Other hosts (Cloudflare Pages, GitHub Pages, Vercel): forms won't work as-is — point the `<form action>` at Formspree/Basin/Web3Forms and remove `data-netlify`.*

## SEO built in
Per page: unique `<title>` + meta description, canonical, Open Graph, and JSON-LD (LocalBusiness, FAQPage, HowTo, BlogPosting, ItemList as appropriate). `robots.txt` + `sitemap.xml` included. `get-home-watch.html` and `thanks.html` are `noindex` (thin/conversion pages).

## Coordination notes (overnight pod)
- **Marketing lane:** positioning here is "the owner's playbook for an empty OBX home → local eyes on the ground." If Marketing hands refined copy/angles or a lead magnet (there's an *OBX Home-Watch Checklist* PDF in `Marketing/`), drop it in and link it from `hurricane-checklist.html` / the hero.
- **Jamieson Ops lane:** `smart-monitoring.html` cross-sells Jamieson installs (locks, PoE cameras, mesh, Starlink). If Jamieson hands deeper product specs or proposal copy, expand that page and the gear list.
- **J-Suite Dev (this lane):** wire the Netlify form → sync-server webhook when the app's lead endpoint is ready, so hub leads land in the pipeline automatically.

## Status
First-runnable. Verified locally (internal links resolve, JSON-LD parses, mobile viewport + Netlify form attributes present). **Not deployed** — awaiting Rzy + Strategy go.
