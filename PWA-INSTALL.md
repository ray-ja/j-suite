# Installing J-Suite as an app (Add to Home Screen)

J-Suite is a **Progressive Web App (PWA)**: install it once per device and it gets its own
home-screen icon, opens full-screen (no browser chrome), and keeps working offline after the
first load. There's nothing to download from a store — you install it straight from the running
sync server.

This is a **one-time setup on each device** (each phone, tablet, or laptop). After that it
auto-updates whenever the device is online (the app is network-first; the cache is only the
offline fallback).

---

## Prerequisite: open J-Suite over HTTPS (the Tailscale hostname)

Browsers will only install a PWA — and only register its service worker — over a **secure
context**: `https://…` or `localhost`. The raw Tailscale IP (`http://100.x.y.z:4000`) is **not**
a secure context, so over that address J-Suite still runs as a normal web page, but the browser
**won't offer to install it**.

The fix is to expose the server over your tailnet's HTTPS, then open *that* URL on each device.

1. **Enable HTTPS for your tailnet** once, in the Tailscale admin console:
   *DNS → enable **MagicDNS**, then **HTTPS Certificates**.*
2. **Put the sync server behind Tailscale HTTPS** on the machine running it:
   ```bash
   # Run the sync server (as usual):
   TOKEN=pick-a-long-secret node sync-server.js        # listens on :4000

   # In another terminal, front it with Tailscale HTTPS (background):
   tailscale serve --bg 4000
   # (older Tailscale: `tailscale serve https / http://localhost:4000`)
   ```
3. `tailscale serve status` prints the public-on-your-tailnet URL, e.g.
   **`https://<machine>.<your-tailnet>.ts.net`**. Open **that** URL on each device to install.

> Plain `http://<server-ip>:4000` keeps working for everyday use and sync — you only need the
> HTTPS hostname for the one-time **install**.

---

## Android (Chrome / Edge / Brave)

1. Open the **`https://<machine>.<tailnet>.ts.net`** URL in Chrome.
2. Either:
   - tap the **Install** button on J-Suite's **Data → Install** card, **or**
   - open the browser **⋮** menu → **Install app** / **Add to Home screen**.
3. Confirm. J-Suite lands on your home screen and opens full-screen.

## iPhone / iPad (Safari)

iOS only installs from **Safari**, and only via the Share sheet (no in-app button — Apple gives
web apps no install prompt).

1. Open the **`https://…ts.net`** URL in **Safari**.
2. Tap the **Share** icon (the square with an up-arrow).
3. Scroll down and tap **Add to Home Screen** → **Add**.
4. Launch it from the new home-screen icon — it opens full-screen.

## Desktop (Chrome / Edge)

Open the URL, then click the **install icon** in the address bar (a monitor/＋ glyph), or
**⋮ → Install J-Suite**. It opens in its own window and can be pinned to the taskbar/dock.

---

## After installing

- **Sign in once.** Loaded from the server, the sync URL pre-fills; enter your account
  username/password (the token is fetched for you). Per-user roles, availability, and data sync
  across every installed device.
- **Offline.** Once you've opened it online at least once, the app shell and your last-synced
  data are cached, so it still launches and runs with no signal. Edits made offline queue and
  push automatically when you're back online.
- **Updates.** No reinstalling — the app pulls the latest code whenever the device is online.

## Notes / troubleshooting

- **No Install option on Android?** You're almost certainly on the `http://…` IP. Re-open via the
  `https://…ts.net` hostname (see prerequisite above), then try again.
- **iOS shows no "Add to Home Screen"?** You're not in Safari (Chrome/Firefox on iOS can't
  install), or you're on `http://` — use Safari + the HTTPS hostname.
- **Opening the raw `.html` file (`file://`) directly** still works for quick local use, but PWA
  install and the service worker are intentionally disabled there (no secure context) — this is
  expected and doesn't affect the served app.
