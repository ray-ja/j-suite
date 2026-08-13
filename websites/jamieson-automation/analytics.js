/* ---------- ANALYTICS + EVENT TRACKING ---------------------------------------------------------------
   Ray, 2026-08-06: "set up the site to be very easily trackable with Google Analytics, Meta Analytics or
   whatever marketing stuff we go with — probably just all of them. And I'll probably set up Stripe payment
   links. We should be able to track pretty much every interaction."

   THE DESIGN DECISION: nothing is hard-wired to one vendor. Every meaningful interaction is pushed to a
   single dataLayer queue and ALSO handed to whichever tags happen to be loaded (gtag, fbq, Plausible).
   Add a provider later by pasting its snippet in — the events already exist and start reporting
   immediately, with no edit to 38 pages.

   NO IDS ARE SET YET, deliberately. Loading a tag with a placeholder ID does nothing but slow the page and
   leak data to an account nobody owns. Fill in CFG below when Ray has the real IDs.

   WHAT IS TRACKED — chosen because each one maps to money, not vanity:
     call_click        tapped the phone number          <- the highest-intent action on a trades site
     email_click       tapped the email
     form_submit       sent the quote/contact form
     lead_magnet       asked for the checklist
     purchase_click    clicked a Stripe payment link    <- ready before Stripe exists
     scroll_depth      25/50/75/100%                    <- did they actually read it
     time_on_page      15s / 60s / 180s
     outbound_click    left to another site
     page_view         once, with the page group        (starlink / town / resource / …)
*/
(function () {
  var CFG = {
    ga4: "",          // "G-XXXXXXXXXX"
    metaPixel: "",    // "1234567890"
    plausible: "",    // "jamiesonautomation.com"
    debug: false      // true -> console.log every event
  };

  window.dataLayer = window.dataLayer || [];

  /* ---- load whichever tags actually have an ID ---- */
  function inject(src, attrs) {
    var s = document.createElement("script"); s.async = true; s.src = src;
    if (attrs) Object.keys(attrs).forEach(function (k) { s.setAttribute(k, attrs[k]); });
    document.head.appendChild(s); return s;
  }
  if (CFG.ga4) {
    inject("https://www.googletagmanager.com/gtag/js?id=" + CFG.ga4);
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    gtag("js", new Date()); gtag("config", CFG.ga4);
  }
  if (CFG.metaPixel) {
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    fbq("init", CFG.metaPixel); fbq("track", "PageView");
  }
  if (CFG.plausible) inject("https://plausible.io/js/script.outbound-links.js", { "data-domain": CFG.plausible });

  /* ---- one function every event goes through ---- */
  function track(name, props) {
    props = props || {};
    props.page = location.pathname;
    window.dataLayer.push(Object.assign({ event: name }, props));
    try { if (window.gtag) gtag("event", name, props); } catch (e) {}
    try { if (window.fbq) fbq("trackCustom", name, props); } catch (e) {}
    try { if (window.plausible) plausible(name, { props: props }); } catch (e) {}
    if (CFG.debug) console.log("[track]", name, props);
  }
  window.jaTrack = track;   // so any page can fire its own

  /* ---- what kind of page is this? lets us compare town pages vs resources ---- */
  function pageGroup() {
    var p = location.pathname.replace(/^\/|\.html$/g, "") || "home";
    if (/^(avon|buxton|corolla|duck|frisco|hatteras|kill-devil-hills|kitty-hawk|manteo|nags-head|ocracoke|rodanthe|salvo|southern-shores|waves|wanchese)/.test(p)) return "town";
    if (/^(starlink|led-lighting|lighting|networking|services)/.test(p)) return "service";
    if (/quote|contact/.test(p)) return "conversion";
    if (p === "home") return "home";
    return "resource";
  }

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    track("page_view", { group: pageGroup(), referrer: document.referrer || "direct" });

    /* clicks that mean something */
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a");
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (/^tel:/i.test(href))        return track("call_click",  { number: href.replace(/^tel:/i, ""), where: a.className || "link" });
      if (/^mailto:/i.test(href))     return track("email_click", { where: a.className || "link" });
      if (/stripe\.com|buy\.stripe/i.test(href))
                                      return track("purchase_click", { url: href, label: (a.textContent || "").trim().slice(0, 60) });
      if (/^https?:/i.test(href) && href.indexOf(location.host) < 0)
                                      return track("outbound_click", { url: href.slice(0, 200) });
    }, true);

    /* forms */
    document.addEventListener("submit", function (e) {
      var f = e.target;
      if (!f || f.tagName !== "FORM") return;
      var n = f.getAttribute("name") || f.className || "form";
      track(/magnet|checklist/i.test(n) ? "lead_magnet" : "form_submit", { form: n, group: pageGroup() });
    }, true);

    /* scroll depth — fires each threshold once */
    var hit = {};
    window.addEventListener("scroll", function () {
      var h = document.documentElement;
      var pct = Math.round((h.scrollTop + window.innerHeight) / h.scrollHeight * 100);
      [25, 50, 75, 100].forEach(function (m) {
        if (pct >= m && !hit[m]) { hit[m] = 1; track("scroll_depth", { depth: m, group: pageGroup() }); }
      });
    }, { passive: true });

    /* dwell time — a property manager reading for 3 minutes is a different person to a 5-second bounce */
    [15, 60, 180].forEach(function (s) {
      setTimeout(function () { track("time_on_page", { seconds: s, group: pageGroup() }); }, s * 1000);
    });
  });
})();
