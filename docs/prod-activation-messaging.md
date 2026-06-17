# Prod activation — Crew Messaging + CEO channel (RAY'S HAND)

The deployed build ships **gated OFF** and the CEO endpoints **inert** (no tokens). Nothing below is
needed to deploy; do it only when you're ready to turn the channel on. All steps run on the **prod box**,
in the app dir (next to `sync-server.js`). Secrets are **gitignored — never commit** (`ceo-config.json`).

## 0. Deploy first
Run your normal deploy (`~/deploy.sh` → snapshots `data.json`, `git pull main`, restart). Confirm the
FF landed: `git -C <app> log --oneline -1` shows the messaging/CEO commits. Migrations are zero-loss
(scheduler availability + `messages` collection) — proven by the fixtures (`sync-server-tests.js`).

## 1. Mint two tokens (read-only sweep + scoped write) — keep them long & private
```
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"   # run TWICE → token, writeToken
```

## 2. Write the secret config (gitignored) next to sync-server.js
```
cat > ceo-config.json <<'EOF'
{
  "token":       "<paste READ token>",
  "writeToken":  "<paste WRITE token>",
  "messagingOn": true
}
EOF
```
- `token` = CEO **read-only** sweep (`GET /api/ceo`). `writeToken` = **scoped** message write (`POST /api/ceo/message`, messages-collection-only). `messagingOn:true` = flips the crew Messages gate.
- (Env-var alternative, if you prefer: `MESSAGING_ON=1 CEO_READ_TOKEN=… CEO_WRITE_TOKEN=… node sync-server.js`.)

## 3. Restart the sync server
So it reads `ceo-config.json`. (`deploy.sh` restarts it; or restart your service/process manually.)

## 4. Grant crew + admin the Messages page (one-time, owner UI)
In the app: **Admin → Roles & page access** → tick **Messages** for **Crew** and **Admin**.
(Owner sees it automatically. Existing role records were created before this page existed, so they
need the one tick; new installs already default it on.)

## 5. Verify (≈30s)
```
curl -s localhost:4000/ | grep -c JSUITE_MESSAGING                 # → 1  (gate injected)
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:4000/api/ceo/message \
  -H "Authorization: Bearer <READ token>" -d '{"body":"x"}'         # → 401 (read key can't write — good)
```
- Crew **reload** their app → the **Messages** tab appears.
- Production login stays **real accounts** (no dev bypass in main).

## 6. Hand the WRITE token to the bridge
Give `writeToken` (+ `token`) to the pod bridge so Strategy can post the **crew handshake** (already
finalized) via the Node/UTF-8 path and read replies via `GET /api/ceo?view=messages`.

## To DISABLE again
Set `messagingOn:false` (or remove `ceo-config.json`) + restart → gate OFF, endpoints inert. No redeploy.
