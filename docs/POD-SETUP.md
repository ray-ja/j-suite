# The AI Pod: How to Run a One-Person Business with a Team of AI Agents

*A practical setup guide. This describes a working model where a single owner runs a "pod" of specialized Claude (Cowork) sessions — a directing brain, a relay, and several execution lanes — to operate a small business. Copy it, adapt the lane names to your business, and you can stand up the same thing.*

---

## The model, in one paragraph

You (one human) sit at the top. Below you is a **pod** of separate AI sessions, each given a defined role and a standing set of rules. One session is the **directing brain** ("Strategy") that holds the whole plan and decides priorities. Several **lane sessions** ("squads") each own a slice of the work and actually build/draft things. A **relay** ("Dispatch") shuttles status up to Strategy and directives back down, on a timer, so the pod keeps moving without you babysitting it. Everything important is written to a shared **memory** so context survives even when individual sessions are restarted. You stay in the loop only for the decisions and actions that genuinely require a human. The result: one person operating with the coverage of a small team, running day and night.

---

## The roles

**You (the Owner).** Final authority. You make the calls only a human should make (money, sending things to customers, going live, credentials), and you're the one who physically ships. Everything below drafts and builds; you approve and release.

**Strategy — the directing brain.** Holds the entire plan, ranks priorities, reads status from the lanes, and issues focused directives. Strategy does *not* build things itself or talk to customers — it thinks, decides, and hands out work. It also owns the shared memory (keeps the project's durable facts current).

**Dispatch — the relay/orchestrator.** The nervous system. It collects each lane's status on an interval, forwards it to Strategy, and relays Strategy's directives back to the right lane. It's also your channel: it surfaces anything that needs *you* as a one-line ask. When Dispatch is off, you relay manually (paste a lane's update to Strategy, paste the directive back).

**The lanes/squads — the executors.** Each is a session that owns one domain and does the hands-on work. Adapt these to your business. In a services + software business they might be:
- **Dev/Ops** — builds and maintains your software/tools; the only session allowed to touch code and version control.
- **Marketing** — content, social, reviews, campaigns, website copy.
- **Operations (one or more lanes)** — field/service ops, pricing models, call lists, inventory, logistics. Split into two lanes if you run two business lines.

Generic principle: **one lane per area of responsibility**, each with a clear "you own X, you never touch Y" boundary.

---

## How information flows

Status flows up, directives flow down, on a loop:

```
lanes  →  Dispatch (relay)  →  Strategy  →  Dispatch (relay)  →  lanes
```

Two formats keep it clean:

- **Directives use an arrow:** `→ DEV: fix the cost bug first, then the sticky footer.` Short, addressed, unambiguous.
- **Owner decisions use an escalation tag:** `❓ASK FOR OWNER: [the question] + [the default I'll take if you don't answer].` The "+ default" is the trick — it means the pod never *stalls* waiting on you. If you don't reply, it proceeds on the safe default and you can correct later.

Strategy's job each cycle: read the lane reports, decide the next move, issue arrow directives, and escalate only the genuine human-only forks. Lanes report what they shipped and what they're blocked on. Dispatch keeps the loop turning.

---

## The infrastructure

What you actually need to stand this up:

- **The Cowork app** (Claude desktop) — runs each session, gives them file access to a shared working folder and a sandbox shell.
- **A shared project folder** that all sessions read/write — ideally a **git repository** (see "source of truth" below).
- **A scheduled task** that fires the relay on an interval (e.g. every 20 minutes): it pings each lane for status and routes it to Strategy. This is what makes the pod run on its own.
- **Session visibility** — the ability for Strategy to read other sessions' transcripts/state (so it can verify what a lane actually did, not just what it claimed).
- **Persistent memory** — a folder of small fact-files that every session loads at startup. This is the most important piece: it's how the pod keeps its knowledge when a session is restarted. Write down decisions, business facts, gotchas, and current state — not the chatter.
- **A standing-rules document** — the hard lines + each lane's boundaries, loaded into every session so the rules don't drift.

---

## Hard lines (the owner-only actions)

These are absolute. No session crosses them without your explicit go:

- **No messages or emails sent to customers** — the pod drafts; you send.
- **No money moved** — no payments, refunds, or transfers.
- **No going live** — no deploys, no publishing, no DNS cutover.
- **No credentials entered, no accounts created** — you do every login/signup yourself.
- **One committer.** Pick a single source that runs version control (in our case, the owner runs all git from their own machine). Sessions edit files; they do **not** run git. This prevents the lock-fights and corruption that come from multiple sessions touching the repo at once.
- **Scoped commits only** — never blindly stage everything; commit specific paths so you never sweep in secrets or half-finished work. Keep secrets (live data, API tokens, config) out of the repo entirely.

The point of hard lines isn't distrust — it's that these are the few actions where a mistake is expensive and irreversible, so a human owns them.

---

## Gotchas we actually hit (learn from our scars)

- **Big single files corrupt on the sandbox mount.** A large file (ours was a ~490 KB single-file app) gets *torn* — the shell reads/writes a truncated copy while the real disk is fine, and edits silently fail to land. **Fix: keep files small.** Split monoliths into many small files; each small write lands intact. If you must edit a big file, do it fast in a fresh session and commit immediately.
- **Restart the whole app, not just the chat.** When the file-mount goes stale, starting a new chat doesn't fix it — the new session inherits the same frozen state. Fully quitting and relaunching the desktop app clears it.
- **A second sync agent fights you.** If your repo lives in a cloud-synced folder (OneDrive, Dropbox) or under heavy antivirus, that second sync races the app's mount and tears files. Keep the repo on a **plain, local, non-synced path.**
- **GitHub is the source of truth.** Commit and *push* often. The pushed repo is the canonical copy — any fresh session or new machine pulls current state from it. This is also your backup: if a working copy corrupts, you restore from the last good commit.
- **Sessions cycle; memory persists.** A session can get stuck or stale. Restarting it loses that chat's context but not your work — because the work is on disk/in git and the knowledge is in shared memory. Treat sessions as disposable and memory as permanent.
- **Use the right tool for heavy code.** The Cowork sandbox is great for general file/business work, but for serious software development on a large local repo, a CLI coding tool that runs *directly* on your machine (no sandbox mount) avoids the whole tearing problem. Use Cowork for the business/ops/strategy pod; use the local coding tool for the heavy code.
- **Multi-device data needs a shared server + a matching key.** If your app stores data per-device, set up a small sync server and give every device the *same* access token. A blank or mismatched token means nothing ever syncs and each device quietly keeps its own island of data.

---

## Minimum setup checklist

The shortest path to standing up your own pod:

1. **Install the Cowork app** and create one shared working folder.
2. **Make it a git repo and push it to GitHub** (private). This is your source of truth + backup.
3. **Write your standing-rules doc** — the hard lines above, plus a one-line "you own X" boundary for each lane. Save it in the repo.
4. **Set up shared memory** — a folder of small fact-files (who you are, your business facts, current goals, gotchas) with a one-line index. Every session reads it first.
5. **Open your sessions:** one **Strategy** session + one session per **lane** (start with 3–4). Give each its role + the standing rules at startup.
6. **Create a scheduled relay task** — every ~20 minutes, collect each lane's status and route it to Strategy, with Strategy's directives going back out. (Or relay manually until you're comfortable.)
7. **Run the loop.** Lanes build/draft, Strategy directs, you approve and ship. Keep memory current, commit + push often, and keep individual files small.

---

*Adapt the lane names and the business specifics to your own operation; the structure — one owner, a directing brain, a relay, disposable execution lanes, persistent memory, and a short list of human-only hard lines — is what makes it work.*
