/* ---------- HOURS REPORT: DATE RANGE + EXPORT (js/128) ----------------------------------------------
   Ray, 2026-08-13, replacing QuickBooks Time: "I should be able to review and export a report of my hours…
   gps data shown on a map is a plus for the report export."

   The Time tab already had an Hours & miles rollup (js/38 tcReportHTML) — totals, by job, by person. Two things
   made it unusable as a QuickBooks Time replacement: it showed ALL time ever with no period, and there was no
   way to get the numbers out. This adds both, plus the shift notes (js/127) and the GPS.

   PERIOD PRESETS are payroll-shaped (this/last week, this/last month, this year) because that is what you
   actually export for. The range is inclusive of both dates, in LOCAL time — a shift is counted on the day it
   STARTED, which is what every timesheet does and what avoids a night shift landing in two periods.

   THE EXPORT is a CSV with one row per shift: date, person, job, customer, in/out, hours, miles, vehicle,
   whether mileage was confirmed, the notes joined together, and the GPS start/end coordinates + a Google Maps
   link. A spreadsheet opens it; the map link opens the route. That is the "GPS on a map" ask without shipping a
   tile renderer into a no-build-step app. */

var HX = { from: "", to: "", who: "", preset: "month" };

/* ---- period helpers (local dates, YYYY-MM-DD) ---- */
function hxISO(d) {
  var p = function (n) { return String(n).padStart(2, "0"); };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function hxPreset(k) {
  var now = new Date(), y = now.getFullYear(), m = now.getMonth();
  var startOfWeek = function (d) { var x = new Date(d); var day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; };   // Monday
  if (k === "week")      { var a = startOfWeek(now); return { from: hxISO(a), to: hxISO(now) }; }
  if (k === "lastweek")  { var b = startOfWeek(now); b.setDate(b.getDate() - 7); var e = new Date(b); e.setDate(e.getDate() + 6); return { from: hxISO(b), to: hxISO(e) }; }
  if (k === "month")     { return { from: hxISO(new Date(y, m, 1)), to: hxISO(now) }; }
  if (k === "lastmonth") { return { from: hxISO(new Date(y, m - 1, 1)), to: hxISO(new Date(y, m, 0)) }; }
  if (k === "year")      { return { from: hxISO(new Date(y, 0, 1)), to: hxISO(now) }; }
  return { from: "", to: "" };   // "all"
}
function hxRange() {
  if (HX.preset && HX.preset !== "custom") return hxPreset(HX.preset);
  return { from: HX.from, to: HX.to };
}

/* ---- THE FILTER. Pure, node-testable: entries whose shift STARTED inside the range. ---- */
function hxFilter(entries, range, who) {
  range = range || {};
  return (entries || []).filter(function (e) {
    if (!e || e.deleted) return false;
    if (who && e.userId !== who) return false;
    var d = hxISO(new Date(e.clockIn));
    if (range.from && d < range.from) return false;
    if (range.to && d > range.to) return false;
    return true;
  });
}

/* ---- CSV ---- */
function hxCsvCell(v) {
  var s = (v == null) ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function hxMapLink(e) {
  var a = e && e.startLat != null && e.startLng != null ? e.startLat + "," + e.startLng : "";
  var b = e && e.endLat != null && e.endLng != null ? e.endLat + "," + e.endLng : "";
  if (a && b && a !== b) return "https://www.google.com/maps/dir/" + a + "/" + b;
  if (a) return "https://www.google.com/maps/search/?api=1&query=" + a;
  if (b) return "https://www.google.com/maps/search/?api=1&query=" + b;
  return "";
}
/* pure: rows in, CSV text out */
function hxBuildCSV(rows) {
  var head = ["Date", "Person", "Job", "Customer", "Clock in", "Clock out", "Hours", "Miles",
              "Mileage $", "Miles confirmed", "Vehicle", "Notes", "GPS start", "GPS end", "Map"];
  var out = [head.join(",")];
  rows.forEach(function (r) { out.push(head.map(function (k) { return hxCsvCell(r[k]); }).join(",")); });
  return out.join("\n");
}

/* build the export rows from timeclock entries (browser-side helpers are optional so this stays testable) */
function hxRows(entries) {
  var rate = (typeof TC_RATE !== "undefined") ? TC_RATE : 0.725;
  return (entries || []).slice().sort(function (a, b) { return (a.clockIn || 0) - (b.clockIn || 0); }).map(function (e) {
    var hrs = e.clockOut ? (e.clockOut - e.clockIn) / 3600000 : 0;
    var mi = (typeof tcMiles === "function") ? tcMiles(e) : (+e.computedMiles || 0);
    var notes = (typeof shiftNotesFor === "function")
      ? shiftNotesFor(e.id).map(function (n) {
          var t = ""; try { t = new Date(n.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (x) {}
          return (t ? t + " " : "") + (n.text || "");
        }).join(" · ")
      : "";
    var fmt = function (ms) { if (!ms) return ""; try { return new Date(ms).toLocaleString(); } catch (x) { return ""; } };
    return {
      "Date": hxISO(new Date(e.clockIn)),
      "Person": e.userName || ((typeof userName === "function") ? userName(e.userId) : "") || "",
      "Job": e.jobId ? ((typeof tcJobTitle === "function") ? tcJobTitle(e.jobId) : e.jobId) : "(no job — time only)",
      "Customer": (e.jobId && typeof tcJob === "function" && typeof custName === "function")
                    ? (function () { var j = tcJob(e.jobId); return (j && j.customerId) ? custName(j.customerId) : ""; })() : "",
      "Clock in": fmt(e.clockIn),
      "Clock out": e.clockOut ? fmt(e.clockOut) : "(still open)",
      "Hours": hrs ? hrs.toFixed(2) : "",
      "Miles": mi ? (Math.round(mi * 10) / 10) : "",
      "Mileage $": mi ? (Math.round(mi * rate * 100) / 100).toFixed(2) : "",
      "Miles confirmed": e.milesConfirmed ? "yes" : (mi ? "estimate" : ""),
      "Vehicle": e.vehicle || "",
      "Notes": notes,
      "GPS start": (e.startLat != null && e.startLng != null) ? e.startLat + ", " + e.startLng : "",
      "GPS end": (e.endLat != null && e.endLng != null) ? e.endLat + ", " + e.endLng : "",
      "Map": hxMapLink(e)
    };
  });
}

/* ---- the filter bar rendered above the report ---- */
function hxBarHTML() {
  var r = hxRange();
  var P = [["week", "This week"], ["lastweek", "Last week"], ["month", "This month"], ["lastmonth", "Last month"], ["year", "This year"], ["all", "All time"]];
  var mem = (typeof schedMembers === "function") ? schedMembers() : [];
  return '<div class="card">'
    + '<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">'
    + P.map(function (p) { return '<button class="btn ' + (HX.preset === p[0] ? "acc" : "ghost") + ' sm" onclick="hxSetPreset(\'' + p[0] + '\')">' + p[1] + '</button>'; }).join("")
    + '<button class="btn ' + (HX.preset === "custom" ? "acc" : "ghost") + ' sm" onclick="hxSetPreset(\'custom\')">Custom</button></div>'
    + (HX.preset === "custom"
        ? '<div class="row" style="gap:8px"><div class="grow"><label style="margin-top:0">From</label><input type="date" value="' + esc(HX.from) + '" onchange="hxSetFrom(this.value)"></div>'
          + '<div class="grow"><label style="margin-top:0">To</label><input type="date" value="' + esc(HX.to) + '" onchange="hxSetTo(this.value)"></div></div>'
        : '<div class="sub">' + (r.from ? esc(r.from) + " → " + esc(r.to) : "everything logged") + '</div>')
    + (mem.length > 1
        ? '<label style="margin-top:10px">Person</label><select onchange="hxSetWho(this.value)"><option value="">Everyone</option>'
          + mem.map(function (u) { return '<option value="' + esc(u.id) + '"' + (HX.who === u.id ? " selected" : "") + '>' + esc(u.username) + '</option>'; }).join("") + '</select>'
        : '')
    + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="hxExport()">⤓ Export CSV</button>'
    + '<div class="sub" style="margin-top:6px;white-space:normal">One row per shift — hours, miles, your notes, and a Google Maps link to the GPS route.</div>'
    + '</div>';
}
if (typeof window !== "undefined") {
  window.hxSetPreset = function (k) { HX.preset = k; if (k === "custom" && !HX.from) { var d = hxPreset("month"); HX.from = d.from; HX.to = d.to; } if (typeof render === "function") render(); };
  window.hxSetFrom = function (v) { HX.from = v; if (typeof render === "function") render(); };
  window.hxSetTo = function (v) { HX.to = v; if (typeof render === "function") render(); };
  window.hxSetWho = function (v) { HX.who = v; if (typeof render === "function") render(); };
  window.hxExport = function () {
    var all = (typeof actTC === "function") ? actTC() : [];
    var rows = hxRows(hxFilter(all, hxRange(), HX.who));
    if (!rows.length) { alert("No shifts in that period."); return; }
    var r = hxRange();
    var name = "hours-" + (r.from || "all") + (r.to ? "_to_" + r.to : "") + ".csv";
    if (typeof rcptDownload === "function") rcptDownload(name, hxBuildCSV(rows), "text/csv");
    else alert("Export helper unavailable.");
  };
  window.hxBarHTML = hxBarHTML;
  window.hxFilter = hxFilter;
  window.hxRange = hxRange;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { hxFilter: hxFilter, hxBuildCSV: hxBuildCSV, hxRows: hxRows, hxPreset: hxPreset, hxISO: hxISO, hxMapLink: hxMapLink, hxCsvCell: hxCsvCell };
}
