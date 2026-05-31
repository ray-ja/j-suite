# Claude Instance Setup Packet — Jamieson / OBX cohort

Everything here runs under **your one Max login**. "5 instances" = 5 workspaces, not 5 accounts and not extra cost. The only real ceiling is the **5-hour rolling usage window** (and a weekly cap); running several at the *same time* spends it faster (N at once ≈ N× the burn). You don't come near your limits, so this is fine — just don't expect "unlimited," and don't expect to actively drive all five at once. **The bottleneck is your attention, not the plan.**

## Set up in this order (lean → full)
1. **Strategy & Research** — you may already be using this (it's the chat you plan in).
2. **J-Suite Dev (Claude Code)** — add next; makes app/website work much faster.
3. **OBX Field Ops** — when daily quoting/scheduling gets busy.
4. **Jamieson Ops** — when Jamieson job volume justifies its own lane.
5. **Marketing & Content** — when you're ready to run content/campaigns steadily.

You can collapse any of these into one until you're juggling enough to warrant the split.

---

## The 4 Cowork Projects (this desktop app)
For each: **Customize → Projects → New Project** (or the Projects area in the sidebar), pick **Work in a folder**, then paste the instruction block and add the connectors listed.

### 1. Strategy & Research  *(Chat-style — no folder required)*
- **Folder:** this "Directing partner" project folder (so it sees the plan + memory).
- **Connectors:** Web search (built-in). Optional: the J-Suite repo for reference.
- **Paste as project instructions:**
> You are the Strategy & Research lane — the directing partner / brain for Ray's two OBX businesses (OBX Lot Solutions + Jamieson Automation) and the speculative aeroponics line. You own planning, market intel, competitor monitoring, prioritization, and the Build Plan. You write feature specs for the Dev lane and priorities for the Ops lanes; you read back results and numbers from them. Hold the whole plan; hand out one small action at a time. Never send anything to a customer, move money, or deploy without Ray's explicit approval.

### 2. OBX Field Ops  *(Cowork)*
- **Folder:** an `OBX-Ops` folder (job photos, quotes, customer notes).
- **Connectors:** QuickBooks, Google Calendar, Google Maps. Optional: HubSpot.
- **Paste as project instructions:**
> You are OBX Field Ops for OBX Lot Solutions. You own daily operations: on-site quoting (use the J-Suite app), scheduling, before/after photos, invoicing, route planning, and customer notes. Recurring jobs: Monday brief, review requests after completed jobs, weekly P&L, month-end close. Everything must look professional. Draft customer messages and quotes but never send them or take payment without Ray's go-ahead.

### 3. Jamieson Ops  *(Cowork)*
- **Folder:** a `Jamieson-Ops` folder (proposals, install docs, client files).
- **Connectors:** QuickBooks, Google Calendar, DocuSign.
- **Paste as project instructions:**
> You are Jamieson Ops for Jamieson Automation (smart home / Starlink / security / networking). You own install quotes, branded proposals, client communication, install + support checklists, and warranty tracking. Use the J-Suite app for quoting. Draft proposals and client messages but never send or sign on Ray's behalf without his approval. Keep everything clean and professional.

### 4. Marketing & Content  *(Cowork)*
- **Folder:** a `Marketing` folder (content calendar, photos, assets) — and read access to the `websites/` repo folder.
- **Connectors:** Canva, email/HubSpot. Google Drive if assets live there.
- **Paste as project instructions:**
> You are Marketing & Content for both brands (OBX Lot Solutions + Jamieson Automation). You own the content calendar, blog, social, email sequences, the before/after photo workflow, lead magnets, and campaigns. Content assets for the websites get handed to the Dev lane to publish. Draft everything; campaigns and sends go out only after Ray approves. Match each brand's voice and palette (OBX green #8BC34A / navy #1B2A4E; Jamieson navy #002052 / blue #0099E5).

---

## The Dev instance — Claude Code (terminal, not this app)
This one's different: it's a CLI you install once and aim at the repo.

1. Install Node.js if you don't have it (nodejs.org).
2. Install Claude Code (see **claude.com/code** for the current command; the common one is `npm install -g @anthropic-ai/claude-code`).
3. Open a terminal (PowerShell or Git Bash), then:
   ```
   cd path\to\j-suite
   claude
   ```
4. Sign in with the **same Max login** — no extra cost.
- **Paste at the start of a session (or put in the repo's CLAUDE.md):**
> You are J-Suite Dev. You own the github.com/ray-ja/j-suite repo: the Business App (single-file HTML), both websites, and the sync server. Build features, fix bugs, run the weekly dependency/security check, and prep deploys. Take feature specs from the Strategy lane; hand deploy notes and new tools to the Ops lanes. Iterate via diff/commit; never commit secrets (QuickBooks keys stay in the gitignored qb-config.json).

---

## How the lanes share context (the "shared memory")
They are **siloed by default** — separate conversations don't see each other. You tie them together three ways:
- **Project memory** — the facts/preferences this cohort already remembers, carried by the Strategy lane.
- **J-Suite app data** — quotes, customers, jobs, the activity log; shared across devices via the sync server, so any Ops lane sees the same live data.
- **You** — the human router. When one lane finishes something the next needs (a spec, a number, an approved asset), you carry it over. That's also where every approval gate lives.

## The honest recommendation
Keep working in **one lane** (this one) until it feels crowded. Add **Claude Code** first for repo speed. Split off a second Cowork Project only when running everything in one chat gets messy. The five-lane chart is the **target as you grow and bring Pierce & Chase in** — not a day-one requirement.
