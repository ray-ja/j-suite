# Login Gate + Roles + Document Vault — Test Checklist

Test everything in the **browser first**. Don't commit until these pass.

## Setup
- Start the server with a token, the same as always:
  `TOKEN=your-long-secret node sync-server.js`
- Open the app (served from the server, or the local file). On a phone too if you can.

## 1. Login gate (nothing shows until you sign in)
- [ ] On first load you see **only** the J·Suite login box — no header, no tabs, no data behind it.
- [ ] **Fresh device / no accounts yet:** the box says "Create the owner account." Make it → you land in the app as **owner**.
- [ ] Sign out (Data → Team → Sign out). The gate comes back immediately.
- [ ] Wrong password shows an error and does **not** let you in. Enter key submits.
- [ ] Reload the page while signed in → it remembers you (no re-login).

## 2. Roles (owner vs crew)
- [ ] As **owner** you see every tab, including **Documents** and in-dev tools.
- [ ] Data → **Team**: each person shows an `owner`/`crew` tag. You (owner) get a role dropdown + Remove on each.
- [ ] Data → **Crew access**: tick which tabs crew can see; tick **in-dev** to hide a tab from crew while you build it.
- [ ] Create a **crew** account (Team → + Add account → role = crew). Sign in as them on another device/browser.
- [ ] Crew sees **only** the allowlisted tabs. **Documents** and **Data** are never visible to crew.
- [ ] Flag a tab **in-dev** as owner → confirm it disappears for crew but stays visible for you.
- [ ] Try to demote the last owner → it blocks you ("Keep at least one owner").

## 3. Document vault (owner-only, server-stored)
- [ ] Documents tab loads (set Sync URL + token in Data first if prompted).
- [ ] Upload a PDF (e.g. EIN letter). It appears in the list, marked **private**.
- [ ] Download it back — file opens correctly.
- [ ] Upload a COI, tick **share** → confirm the warning, it flips to **shareable**.
- [ ] Delete a doc → it's gone from the list and from the server's `company-docs/` folder.
- [ ] Files live in `company-docs/` on the Ubuntu box and are **git-ignored** (see "Before you commit").

## 4. Security sanity (lightweight, as expected)
- [ ] With the server token set, hitting `/docs/list` without the token returns `unauthorized`.
- [ ] You can't grab a vault file by guessing a static URL — only the token-gated `/docs/download` works.
- [ ] This is token + Tailscale-only, same lightweight bar as the rest of the app — not bank-grade. Don't expose the port to the public internet.

## Before you commit
Confirm these are **not** staged (they're git-ignored):
```
git status            # company-docs/, data.json, qb-config.json, qb-tokens.json must NOT appear
```
Files changed in this build: `Business App (v1).html`, `sync-server.js`, `.gitignore`.

Then: commit + push → on the Ubuntu host `git pull` and restart the service.
