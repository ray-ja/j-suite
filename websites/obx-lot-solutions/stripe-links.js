/* OBX Lot Solutions — Stripe Payment Links (PASTE-IN SLOTS)
 * ----------------------------------------------------------------------
 * HOW TO USE (Ray):
 *   1. In Stripe → Payment Links, create a link for each flat-rate service
 *      (set it to a Subscription for the recurring/home-watch ones to get the
 *      automatic 20%-off recurring billing).
 *   2. Paste each link URL between the quotes below, next to the matching key.
 *   3. Save. Any button whose slot is filled becomes a live "Book & pay"
 *      checkout; any slot left "" stays a "Get a quote" link to the form.
 *
 * SAFE TO COMMIT: Stripe Payment Link URLs are public (like buy.stripe.com/...).
 * There are NO secret keys in this file. Never put a Stripe secret key here.
 * Nothing goes live until Ray fills these in AND the site is deployed.
 * ---------------------------------------------------------------------- */
window.STRIPE_LINKS = {
  "driveway-small":        "",   // Driveway / flat concrete, small (~300 sq ft) — $89
  "house-softwash-1story": "",   // House soft wash, 1-story up to 1,500 sq ft — $349
  "deck-wash":             "",   // Deck / patio wash — from $119
  "homewatch-monthly":     "",   // Home-watch monthly visit — $59 (Stripe SUBSCRIPTION)
  "yard-mow":              "",   // Lawn mow, trim & edge, standard lot — $45 (sub for recurring)
  "junk-single":           ""    // Single item / appliance pickup — from $99
};

/* Loader — turns <a data-stripe="key"> into a live pay button when its slot is
   filled, otherwise routes it to the free-estimate form. No build step. */
(function () {
  function wire() {
    var links = window.STRIPE_LINKS || {};
    document.querySelectorAll("a[data-stripe]").forEach(function (a) {
      var url = links[a.getAttribute("data-stripe")];
      if (url) {
        a.href = url; a.target = "_blank"; a.rel = "noopener";
        a.setAttribute("data-live", "1");
      } else {
        a.href = "estimate.html#estimate-form";
        // keep the displayed price label; the click just goes to the quote form
      }
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else { wire(); }
})();
