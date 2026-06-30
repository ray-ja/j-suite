/* ---------- MILEAGE ODOMETER REMINDER BANNER (Cap: mileage = cost + tax → accuracy matters) ----------
   A persistent HEADER bar that shows whenever the signed-in user is clocked in WITH a vehicle but hasn't
   recorded a starting odometer reading. The odometer NEVER blocks clock-in (you may not be in the truck yet,
   and driving changes the reading) — instead this nags until it's entered. Tapping it opens the
   GPS-anchored late-entry prompt (tcEnterStartOdo, js/38), which back-dates the start by the miles already
   driven since clock-in so a late reading stays accurate + auditable.

   Clones the env-banner / view-as-banner pattern (js/55, js/28): a fixed top bar + a body class
   (has-odo-banner) so app.css shifts the sticky header + fixed desktop sidebar + body down to make room.
   Wired into render() (js/03) and the 30s clock-pill interval (js/38) so it appears/clears on its own. */
function renderOdoBanner() {
  if (typeof document === "undefined" || !document.body) return;
  const e = (typeof tcReminderEntry === "function") ? tcReminderEntry() : null;   // open shift, has vehicle, no odoStart
  let bar = document.getElementById("odobanner");
  if (!e) {                                                        // nothing to remind → remove + un-shift
    if (bar) bar.remove();
    document.body.classList.remove("has-odo-banner");
    return;
  }
  if (!bar) {
    bar = document.createElement("button");
    bar.id = "odobanner";
    bar.type = "button";
    bar.onclick = function () { if (typeof tcEnterStartOdo === "function") tcEnterStartOdo(); };
    document.body.insertBefore(bar, document.body.firstChild);
  }
  bar.textContent = "🚚 Enter your odometer reading — tap";
  document.body.classList.add("has-odo-banner");
}
window.renderOdoBanner = renderOdoBanner;

/* first paint (render() drives it after that; cover the file:// / late-load cases) */
if (typeof document !== "undefined") {
  if (document.readyState !== "loading") setTimeout(function () { try { renderOdoBanner(); } catch (e) {} }, 0);
  else document.addEventListener("DOMContentLoaded", function () { try { renderOdoBanner(); } catch (e) {} });
}
