# 🧰 Your Tools & Stack — what each does, and what to do about it

*A plain reference for the services we run on, each one's job, and where to consolidate. Headline: **own your operations, rent money + books.***

## The map

- **j-Suite (yours)** — the operational hub. Quoting, customers, scheduling, crew + equipment, **time-clock + mileage**, the **operating-agreement payout split**, income/expense tracking. The system the company runs on — and it now replaces several paid tools.
- **Stripe** — online payments: website checkout, recurring **subscriptions** (your 20%-off recurring plan), and **discounts/coupons**. Pay-per-transaction, no monthly base. Can also do **in-person** (Tap to Pay) if you ever want a single processor.
- **Square** — in-person card payments (the tap reader on a job) + a checking account through Sutton Bank. The reader's handy; the bank account you don't need.
- **QuickBooks Time** — time tracking (Jamieson). **j-Suite's time-clock now does this.**
- **QuickBooks Invoicing** — sending invoices. Overlaps with free Square Invoices + j-Suite's income tracking.
- **QuickBooks (accounting)** — the real books: P&L, expense categories, tax prep, partnership K-1s. The one with genuine value you should *not* rebuild.

## The recommendation

| Tool | Verdict | Why |
|---|---|---|
| **j-Suite** | **Keep building** | Your operations hub |
| **Stripe** | **Keep** | Online engine — you can't self-host payment processing |
| **Square (reader)** | **Keep for now** | In-person tap (fold into Stripe later if you want one processor) |
| **Square checking (Sutton)** | **Drop** | Use a real business bank; you said you don't need it |
| **QuickBooks Time** | **DROP** | j-Suite time-clock replaces it — direct monthly savings |
| **QuickBooks Invoicing** | **Drop / downgrade** | Square Invoices is free + j-Suite tracks the income |
| **QuickBooks (accounting)** | **KEEP** (or cheaper: Wave = free, or Xero) | Real books + taxes/K-1s — don't DIY this part |

## The honest "can we just build it ourselves?" line

- **Payments** — no, and you don't want to. You legally can't self-host money movement (PCI/compliance) — that's what Stripe *is*. But it's pay-per-transaction, not a monthly bill.
- **Time tracking** — already built. ✅
- **Invoicing** — trivial to self-build, or use Square's free version.
- **Accounting + taxes** — **keep a real tool.** This is the one place DIY gets you audited or costs you deductions. A bookkeeping tool earns its fee.

**Net:** dropping QuickBooks Time, dropping/downgrading QB Invoicing, and dropping Square's bank likely cuts a big slice of the $100s/month — while keeping the two things actually worth paying for: a **payment processor** and **real books**.
