# J-Suite — Jamieson Automation & OBX Lot Solutions

Working repo for two businesses: **Jamieson Automation** (skilled automation / A/V / networking, 100% owned) and **OBX Lot Solutions** (commercial property cleanup + power/window washing). Includes the field app, its sync server, and the growth toolkit.

## Contents

| File | What it is |
|---|---|
| `Business App (v1).html` | Offline-first field app (PWA-style). Runs in any browser on Android + Windows/Linux. Business toggle (separate data per business), customers/notes/status, on-site quote builder with baked-in pricing, today/call list, scheduling. Local storage + optional sync. |
| `sync-server.js` | Zero-dependency Node sync server. Per-record last-write-wins with deletion tombstones, token auth, JSON persistence. |
| `Service Menu & Pricing Plan.md` | Service catalog and pricing for both brands (market-based). |
| `OBX Lot Solutions - Commercial Call List.xlsx` | Prioritized cold-call target list (property managers, HOAs, retail, landscaper partners). |
| `OBX Lot Solutions - Cold Call Playbook.md` | Call scripts + objection handling. |
| `OBX Lot Solutions - Quote Sheet.xlsx` | On-the-spot quote calculator. |
| `OBX Lot Solutions - Flyer (leave-behind).pdf` | Branded leave-behind flyer. |
| `Jamieson Automation - website.html` | One-page marketing site for Jamieson Automation (navy/blue brand, JA logo, two service tiers, request-a-quote). |
| `Brand assets/` | Logos (SVG) for both businesses. |
| `assets/` | App-optimized logos + PWA icons. |
| `manifest.webmanifest`, `sw.js` | PWA manifest + offline service worker (served by sync-server.js). |
| `qb-bridge.js` | QuickBooks Online OAuth + API bridge (zero-dependency). Inactive until `qb-config.json` exists. |
| `qb-config.example.json` | Template for your Intuit keys — copy to `qb-config.json` (gitignored) and fill in. |

## Running the sync server

```bash
# Linux / macOS:
TOKEN=pick-a-long-secret node sync-server.js       # listens on :4000, stores data.json
```
```powershell
# Windows PowerShell:
$env:TOKEN="pick-a-long-secret"; node sync-server.js
```

In the app's **Data** tab, set the same server URL and token on each device. `data.json` (the live database) is gitignored on purpose — it holds customer data and should never be committed.

**The server also serves the app.** Browse to `http://<server-ip>:4000` from any device on your network (phone, tablet, another PC) to load J-Suite — no file copying. When loaded this way, the sync URL pre-fills to that server automatically; you just enter the token once.

## QuickBooks Online (optional)

The app's invoicing is meant to hand off to QuickBooks, not replace it: the app owns the upstream (leads → quotes → pipeline); QuickBooks owns the downstream (invoices, payments, income). The bridge lets the app push invoices into QBO and pull unpaid/income back.

To turn it on:

1. Create a free account at developer.intuit.com and make an app (enable the **Accounting** scope).
2. Copy `qb-config.example.json` → `qb-config.json` and paste your **Client ID**, **Client Secret**, and redirect URI `http://localhost:4000/qb/callback`.
3. Start the server, then visit `http://localhost:4000/qb/connect` to authorize. Tokens save to `qb-tokens.json` (gitignored).
4. Endpoints: `GET /qb/summary` (unpaid + open invoices), `POST /qb/create-invoice`. (`createInvoice` line mapping gets finalized when we test live against your company file.)

`qb-config.json` and `qb-tokens.json` are gitignored — your keys never leave your machine.

## Brand colors

- **OBX Lot Solutions:** green `#8BC34A` · navy `#1B2A4E` · white
- **Jamieson Automation:** navy `#002052` · blue `#0099E5` · white

## Roadmap

- **Done:** desktop scaling, multi-device sync, month calendar, quote Print/Save-PDF, server-served app + auto-filled sync URL, real logos in-app, installable PWA, invoicing, Today dashboard, customer history, Jamieson Automation website, per-business To-Do page, QuickBooks Online bridge scaffold, **dark theme**, **user accounts (username/password, no email) + to-do assignment**, **Plan tab (business one-pager, marketing strategy + campaign tracker, market research) — prefilled & editable per business**
- Next: get Intuit keys → wire QuickBooks live (push invoices / pull AR); online booking + card payments; HTTPS for phone PWA install; business phone line; publish the Jamieson site to a domain

### Notes on accounts
Accounts are lightweight identity for to-do assignment, **not** hardened security — data lives in your local/synced store. Passwords are hashed (SHA-256) but a determined person with device access can read the data. Fine for a trusted 2–3 person crew; don't treat it as a security wall. Users sync across devices; the signed-in user is per-device.
