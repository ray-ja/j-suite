# Stripe Payment Links — Setup Guide (OBX Lot Solutions)

Plain-language steps to take card payments on your quotes. **You do every account and credential step yourself** — Claude never touches your keys, your bank, or your money. The app just stores a link you paste in; Stripe handles the actual payment.

**Why Stripe Payment Links:** no monthly fee, no website needed, no code. You make one link per quote amount and text or email it to the customer. US pricing is **2.9% + 30¢ per card payment** — so a $1,750 cleanout costs you about **$51** in fees, money in your account in ~2 business days. ([Stripe pricing](https://stripe.com/pricing))

Set aside ~20 minutes for the one-time account, then each link takes under a minute.

---

## Part 1 — Create your Stripe account (one time, ~10 min)

1. Go to **stripe.com** and click **Start now / Sign up**. Use your business email and a strong password.
2. Confirm your email (Stripe sends a verification link).
3. When it asks what you want to do, pick the **no-code / Payment Links** path — you do **not** need a developer or a website.

That's enough to get into the Dashboard. You can create links in **test mode** right away to practice; you must finish Part 2 before you can take **real** money.

---

## Part 2 — Activate the account (verification / KYC, ~10 min + 1–3 day review)

Stripe is legally required to confirm who you are before releasing funds (standard KYC/AML). Have these ready — it goes faster if you do it in one sitting: ([required info](https://support.stripe.com/questions/business-information-requirements-to-use-stripe), [verification](https://support.stripe.com/topics/verification))

**About the business**
- Business type — for now you're almost certainly **Individual / Sole proprietor** (you can change to an LLC later if you form one).
- **Tax ID** — your **SSN** as a sole proprietor (or an **EIN** if you have one for OBX Lot Solutions).
- **Business name & a short description** — e.g. "OBX Lot Solutions — junk removal, pressure washing, property cleanups."
- **Physical address** — a real street address where you operate. **No PO boxes.**
- **Phone** and the **business website or profile** — your Google Business Profile URL or obxlotsolutions.com works if the site's live; otherwise a Facebook/Nextdoor business page is accepted.

**About you (the account representative)**
- Full legal name, date of birth, home address, email, phone.
- Stripe may ask for a **photo of your driver's license** and sometimes a **proof of address** (a utility bill or bank statement). Have your phone camera handy.

**Where the money lands**
- Your **US bank account** — routing + account number. The name on the bank must match the name/Tax ID you gave Stripe. This is your payout account; Stripe deposits here automatically.

Submit, then Stripe reviews — **usually 1–3 business days**. You'll get an email when you're live. *(Do this well before June 17 so the realtor can pay on completion.)*

> Heads-up: everything in Part 2 is **your** personal/business info entered by **you** on Stripe's site. Don't share these details in chat — Claude doesn't need them and won't store them.

---

## Part 3 — Make a payment link for a quote (under a minute each)

You make **one link per quote amount**, so the customer pays the exact number on their written quote.

1. In the Stripe Dashboard, open **Payment Links** (left menu) → **+ New** (or **+ Add a new product**). ([create a link](https://docs.stripe.com/payment-links/create))
2. Fill in the product:
   - **Name** — what they're paying for, e.g. `House cleanout — 123 Sandpiper Ln (June 17)`.
   - **Price** — the **exact quote total**, e.g. `1750.00`, one-time.
   - (Optional) a line of description so the receipt is clear.
3. Click **Create link**. Stripe shows a URL like `https://buy.stripe.com/xxxxxxxx`.
4. Click **Copy link.**

Tips:
- Make the link **after the customer accepts the quote**, named to the job, so your Stripe history reads like a job list.
- Each link is reusable but tied to that one amount — for a different job, make a new link.
- You can also turn the link into a **QR code** from the same screen if you ever want them to scan it on-site.

---

## Part 4 — Paste it into the app (the new `paymentLink` field)

Once the COGS + payment update is applied to the Business App, every saved quote has a **payment-link slot**:

1. Open the **quote** in the app (Quotes tab → tap the quote, or the wizard's final screen).
2. You'll see **"Add payment link"** with a box that reads `https://buy.stripe.com/...`.
3. **Paste** the link you copied from Stripe and tap **Save link**.
4. The box turns into a **💳 Pay now** button. Tapping it opens that Stripe page — that's the page you can show or send the customer.
5. To send it: print/share the quote (the link rides along), or just text/email the `buy.stripe.com` URL.

When the customer pays, the money goes **straight from Stripe to your bank** — the app only ever holds the link. Mark the quote **Paid** in the app once Stripe emails you the confirmation, so your records stay clean.

*(Until the update is applied, the field isn't in the live app yet — you can practice the whole flow now in `monday-quote-rehearsal.html`: paste any link and watch the Pay-now button appear.)*

---

## Quick reference

| Thing | Where | Note |
|---|---|---|
| Sign up | stripe.com → Start now | business email |
| Tax ID | Part 2 verification | SSN (sole prop) or EIN |
| Payout bank | Part 2 verification | name must match Tax ID |
| New link | Dashboard → Payment Links → + New | one per quote amount |
| Paste link | App → quote → Add payment link | becomes "Pay now" |
| Fee | per payment | 2.9% + 30¢, ~2-day payout |

**Hard lines:** you create the account, pass verification, and generate every link. Claude/the app never holds your keys and never moves money — it only stores the link you paste.

---

## Sources
[Stripe pricing & fees](https://stripe.com/pricing) · [Create a payment link](https://docs.stripe.com/payment-links/create) · [Payment Links overview](https://docs.stripe.com/payment-links) · [Business information requirements](https://support.stripe.com/questions/business-information-requirements-to-use-stripe) · [Verification](https://support.stripe.com/topics/verification) · [Required verification information](https://docs.stripe.com/connect/required-verification-information)
