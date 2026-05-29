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
| `Brand assets/` | Logos (SVG) for both businesses. |

## Running the sync server

```bash
TOKEN=pick-a-long-secret node sync-server.js      # listens on :4000, stores data.json
PORT=4000 TOKEN=... node sync-server.js            # custom port
```

In the app's **Data** tab, set the same server URL and token on each device. `data.json` (the live database) is gitignored on purpose — it holds customer data and should never be committed.

## Brand colors

- **OBX Lot Solutions:** green `#8BC34A` · navy `#1B2A4E` · white
- **Jamieson Automation:** navy `#002052` · blue `#0099E5` · white

## Roadmap

- v3: scheduling calendar view, invoicing, online booking/payments
- Jamieson Automation website
