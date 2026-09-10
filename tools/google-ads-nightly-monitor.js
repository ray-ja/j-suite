/**
 * OBX Junk Co — nightly ads monitor (Google Ads Script)
 * ──────────────────────────────────────────────────────
 * Runs INSIDE the Google Ads account (Tools → Bulk actions → Scripts) — no OAuth, no API keys,
 * which is why it works while the account's security freeze blocks the real API (2026-09-10).
 * Every night it pushes yesterday's campaign stats + search terms to the j-suite server, where
 * they feed the digest and the day-30 cost-per-booked-job math.
 *
 * SETUP (once):
 *   1. In j-suite: Settings → Google Ads → "Mint script key" → copy the key.
 *   2. In Google Ads: Tools → Bulk actions → Scripts → + → paste this whole file.
 *   3. Fill in the two lines below, Authorize (it asks once — that's Google's own script consent,
 *      unaffected by the freeze), Preview to test, then schedule DAILY ~6:00 AM.
 *
 * It READS only. Nothing in this script can change a campaign, a bid, or a budget.
 */

var SERVER_URL = "PASTE_APP_URL_HERE";   // the app's base URL (same one in Settings → Sync), no trailing slash
var INGEST_KEY = "PASTE_SCRIPT_KEY_HERE";

function main() {
  var tz = AdsApp.currentAccount().getTimeZone();
  var y = new Date(Date.now() - 24 * 3600 * 1000);
  var date = Utilities.formatDate(y, tz, "yyyy-MM-dd");

  // ── campaign stats for yesterday ──
  var campaigns = [];
  var rows = AdsApp.report(
    "SELECT campaign.name, metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions " +
    "FROM campaign WHERE segments.date = '" + date + "'"
  ).rows();
  while (rows.hasNext()) {
    var r = rows.next();
    campaigns.push({
      name: String(r["campaign.name"] || ""),
      clicks: Number(r["metrics.clicks"] || 0),
      impressions: Number(r["metrics.impressions"] || 0),
      costMicros: Number(r["metrics.cost_micros"] || 0),
      conversions: Number(r["metrics.conversions"] || 0)
    });
  }
  if (!campaigns.length) campaigns.push({ name: "(no activity)", clicks: 0, impressions: 0, costMicros: 0, conversions: 0 });

  // ── search terms that actually cost money yesterday — the negative-keyword hunting ground ──
  var searchTerms = [];
  try {
    var st = AdsApp.report(
      "SELECT search_term_view.search_term, metrics.clicks, metrics.cost_micros " +
      "FROM search_term_view WHERE segments.date = '" + date + "' AND metrics.clicks > 0"
    ).rows();
    while (st.hasNext() && searchTerms.length < 400) {
      var t = st.next();
      searchTerms.push({
        term: String(t["search_term_view.search_term"] || "").slice(0, 200),
        clicks: Number(t["metrics.clicks"] || 0),
        costMicros: Number(t["metrics.cost_micros"] || 0)
      });
    }
  } catch (e) { /* search_term_view can be empty/unavailable early on — stats still ship */ }

  var payload = { key: INGEST_KEY, date: date, campaigns: campaigns, searchTerms: searchTerms };
  var resp = UrlFetchApp.fetch(SERVER_URL + "/api/gads/ingest", {
    method: "post", contentType: "application/json",
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code !== 200) throw new Error("ingest failed HTTP " + code + ": " + resp.getContentText().slice(0, 200));
  Logger.log("Pushed " + date + ": " + campaigns.length + " campaign rows, " + searchTerms.length + " search terms.");
}
