/* ---------- ENV GUARDRAIL BANNER ----------
   Renders a 🟡 DEV bar on any non-prod host so a dev instance can't be mistaken for prod (Ray hit
   exactly that). The env is decided in js/00-preamble (single source of truth); this just renders.
   Adds body.has-dev-banner so app.css shifts the sticky header + fixed desktop sidebar + body down
   to make room — keeping them aligned (the earlier in-flow banner decoupled them). Committed (not the
   gitignored bypass): a safety guardrail that must show even on a normal login. */
(function () {
  if (typeof window === "undefined" || typeof window.jsIsDevHost !== "function" || !window.jsIsDevHost()) return;
  try { document.title = "🟡 J-Suite (dev)"; } catch (e) {}   // distinguish the dev tab from prod at a glance
  var host = (typeof location !== "undefined" && location.hostname) || "local";
  function show() {
    if (!document.body) return;
    document.body.classList.add("has-dev-banner");
    if (document.getElementById("envbanner")) return;
    var b = document.createElement("div");
    b.id = "envbanner";
    b.textContent = "🟡 DEV — " + host + " · not production";
    document.body.insertBefore(b, document.body.firstChild);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show); else show();
})();
