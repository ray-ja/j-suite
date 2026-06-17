/* ---------- SHARED AVAILABILITY RESOLVER ----------
   Single source of truth for "what's a member's availability status on a date", used by BOTH the
   client (js/33 availOn delegates here) and the server (CEO read path projection). Pure, DOM-free,
   no app globals — so it loads via <script src> (file:// + served) AND require() in Node with the
   identical logic. Resolution order: timeoff block > per-day override > weekday baseline > unset. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.AvailResolve = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function dow(ds) { return new Date(ds + "T00:00:00").getDay(); }

  /* full resolution → { status, label, cls } (status: "timeoff"|"off"|"partial"|"on"|"unset") */
  function resolve(u, ds) {
    u = u || {};
    var to = (u.timeoff || []).find(function (b) { return b && !b.deleted && ds >= b.start && ds <= (b.end || b.start); });
    if (to) return { status: "timeoff", label: "Time off" + (to.note ? " · " + to.note : ""), cls: "off" };
    var av = u.avail;
    // per-day override (scheduler calendar edit) wins over the weekday baseline for that date.
    // value is "full" | "partial" | "off" (v1) or {s, start, end} (v2-safe, carries hours).
    var ov = av && av.overrides && av.overrides[ds];
    if (ov) {
      var s = (typeof ov === "string") ? ov : ov.s;
      var hrs = (ov && typeof ov === "object" && ov.start && ov.end) ? " " + ov.start + "–" + ov.end : "";
      if (s === "off") return { status: "off", label: "Off (set for this day)", cls: "off" };
      if (s === "partial") return { status: "partial", label: "Part of day" + hrs, cls: "partial" };
      if (s === "full") return { status: "on", label: "Available all day" + hrs, cls: "on" };
    }
    if (!av || !av.days) return { status: "unset", label: "Available · not set", cls: "unset" };
    if (av.days[dow(ds)]) return { status: "on", label: "Available" + (av.start && av.end ? " " + av.start + "–" + av.end : ""), cls: "on" };
    return { status: "off", label: "Off (" + DOW[dow(ds)] + ")", cls: "off" };
  }
  /* convenience: just the canonical status string */
  function status(u, ds) { return resolve(u, ds).status; }

  return { resolve: resolve, status: status, dow: dow, DOW: DOW };
});
