# QR-to-Google-Review Setup Guide
*Get one review link, turn it into a QR, and put it everywhere. OBX Lot Solutions. Draft.*

## Step 1 — Make sure you have a Google Business Profile
Reviews live on a **Google Business Profile** (free). If you don't have one yet:
- Go to **google.com/business**, create/claim "OBX Lot Solutions," and verify it (Google mails a code or verifies by phone/video).
- Fill it out fully: service area (Corolla→Manteo), categories (Pressure Washing, Junk Removal, Property Maintenance), hours, photos, phone (252) 564-8717, website. A complete profile ranks better and earns more reviews.
- *Until this exists, there's nothing for a review link to point to — this is step one.*

## Step 2 — Get your direct "write a review" link
Once the profile is live, get the **short review link**:
- In your Google Business Profile, open **"Ask for reviews"** (or *Get more reviews*) → Google gives you a short link like **`https://g.page/r/XXXXXXXX/review`**. Copy it.
- (Alternate: the format `https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID` also opens the review box directly.)
- This link drops the customer **straight into the 5-star review screen** — that's what you paste into every text/email template.

## Step 3 — Set up a branded redirect *(recommended — do this once)*
Point a clean URL on your own site to the Google link:
- Create **`obxlotsolutions.com/review`** as a redirect to your `g.page/r/.../review` link.
- **Why:** it's easy to say/print, it looks professional, and **if your Google link ever changes you only update the redirect — the QR and all printed cards keep working.**
- The **QR code and review card in this folder already point to `obxlotsolutions.com/review`**, so once you set that redirect, every printed card works instantly.

## Step 4 — Use the QR + card (already made)
In this folder:
- **`Review Card — Scan to Review (print)`** — a branded, print-ready card. Use it as a leave-behind, a sticker by the door on home-watch homes, a sign at the job, or a thank-you card.
- **`Review QR (standalone)`** — just the QR, to drop onto invoices, flyers, the truck, email signatures, etc.
- To **regenerate** the QR for a different link later, change the `URL` line in `build_review_card.py` and re-run it.

## Step 5 — Put it everywhere (the more touchpoints, the more reviews)
- 📱 **Text link** after every job (primary — see Review Request Kit).
- 🪪 **Leave-behind card** handed over at job completion.
- 🧾 **Invoice / receipt** — add the QR + "Scan to review us."
- ✉️ **Email signature** — "Happy with our work? Leave a review →" + link.
- 🚚 **Truck / yard sign / flyer** — QR in a corner.
- 🏠 **Home-watch homes** — small QR sticker inside the door for the owner.

## Quick rules (Google policy — stay clean)
- ✅ You may **ask** any customer for an honest review.
- 🚫 **Don't pay, discount, or incentivize** reviews — Google removes them and can penalize the profile.
- 🚫 Don't review-gate (don't filter out unhappy customers with a survey first); just don't send the link to someone you know is unhappy — fix it instead.
- ✅ **Reply to every review.** Thank the good ones; respond calmly and constructively to any critical one.

## What's left for Ray
1. Create/verify the Google Business Profile (Step 1).
2. Grab the review link (Step 2) and set the `obxlotsolutions.com/review` redirect (Step 3).
3. Paste the link into the text/email templates; start printing the card.

> **❓ASK FOR STRATEGY:** I can't create or verify the Google Business Profile or set the website redirect from here (both need Ray's Google login and DNS/site access). Want me to write Ray a 5-minute click-by-click checklist for the Google Business Profile setup, or leave that to him?
