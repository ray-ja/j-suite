# CLAUDE.md — j-Suite

j-Suite is the operating app for a small Outer Banks services company (DYAD Holdings LLC, dba OBX Lot Solutions): quoting, customers/properties, scheduling, inventory, time-tracking, invoicing — used by 3 owner-operators on their phones. Treat it as production software people run their business on.

## Architecture — modular monolith (do NOT break this)

- One deployable app: a tiny HTML shell (`Business App (v1).html`, ~4KB) that loads many small modules from `js/` (one feature per file, `js/NN-name.js`) + `app.css`, served by `sync-server.js` (Node) over Tailscale.
- Never reintroduce a monolith. A single ~490KB file used to corrupt on the file-mount; the app was deliberately split into small files. A new feature = a NEW small module registered in the shell + nav. Keep files small.
- No build step. No ES modules. Plain `<script src>` so the app also loads via `file://`. Do not add bundlers or `import`/`export`.
- Mobile-first always — the crew works from phones.

## Topology & deploy (never edit production)

- Dev = this clone (`C:\dev\j-suite`). All building happens here.
- GitHub = source of truth (`origin/main`).
- Production = the Ubuntu workstation, pull-only: `~/deploy.sh` snapshots data, git pulls main, restarts. Never edit production directly — a half-finished edit blanks the live tool the owner quotes with in the field.
- The owner (Ray) runs all deploys.

## Git rules

- Scoped commits only — stage explicit paths; NEVER `git add -A` / `git add .`.
- Secrets stay out of git (gitignored — never commit): `data.json`, `qb-config.json`, `qb-tokens.json`, anything under `sync.env`.
- Parallel work = one git worktree + branch per instance (`git worktree add -b <branch> ..\<dir> main`). Don't have two instances editing the same file in a cycle. The shell's `<script>` list is the common touchpoint — on a conflict there, keep ALL `<script>` tags from both sides.
- Merge feature branches to main one at a time.

## Data & sync (the one unrecoverable failure — handle with extreme care)

- Data = many small records, each with its own `updatedAt`. Sync = per-record last-write-wins: merges keep/update records, never drop them. An empty/blank store must PULL first and must never push-empty over a populated server.
- MANDATORY: any change touching the data layer, schema, accounts, or sync MUST add + pass a migration fixture test — load a realistic pre-change `data.json` fixture and assert every customer, property, quote, job, and account survives `load()` + a sync round-trip with zero loss.

## The verification bar — run BEFORE every commit (all green, no exceptions)

- `node --check` on every touched JS file.
- `node sync-server-tests.js` → 0 failed.
- `node verify-app.js` → headless `file://` load with zero console/runtime errors (a single syntax slip blanks the entire app).
- Data-layer changes: the migration fixture passes.

Never commit red. Verify → commit → move on.

## Shared plumbing — touch only if your task explicitly owns it

- In-use lock (`js/04`, `js/35`): soft-lock with heartbeat + auto-expiry on open-and-edit records (quotes/jobs/customers/properties). Collision hotspot — only modify if assigned.
- Sync layer (`sync-server.js` `COLLECTIONS` + the client sync module): new synced data = a new collection wired into `blank()`, the `load()` migration, and server `COLLECTIONS`, with stable record ids (so re-seed/multi-device dedupe instead of duplicating).
- Reuse shared helpers (`cogsStrip()`, the lock helper, the sync layer) — don't reinvent them.

## Domain rules that affect code

- Cost model = hard costs only. Disposal (mixed C&D $73.16/ton, first 500 lb free; clean veg free), mileage at the IRS rate $0.725/mi, materials, equipment rental. No hourly-labor cost line — the owners are paid from a revenue split, not wages, so labor isn't a per-job cost. Show Cost / Price / Profit / Margin with a 35% margin-floor warning.
- Revenue split (for payout/attribution features): 25% tax reserve · 15% business fund · 60% labor pool → 80% field work (split by who worked) / 15% sales credit (originator, logged at booking, 3-month window) / 5% admin (capped $500/mo).
- Pricing = undercut / value, never premium.

## Auth & access

Accounts are SHA-256 (with a djb2 fallback for non-secure contexts). Login fetches the sync token from the server. Roles: Owner / Admin / Crew (extensible), with per-role page access enforced in `render()`/nav — hidden pages must be unreachable, not just hidden. Signed-out defaults to Crew, not Owner; bootstrap grants Owner only when no accounts exist yet.

## PWA

Installable (manifest + service worker). Install requires the HTTPS Tailscale hostname (`tailscale serve`), not the raw IP. The service worker is network-first and bypasses API/auth routes. Don't break `file://` or the served paths.

## When in doubt

Keep files small, verify before commit, never risk the data, and don't touch shared plumbing you weren't assigned. Ask rather than guess on anything that could lose customer data or blank the app.
