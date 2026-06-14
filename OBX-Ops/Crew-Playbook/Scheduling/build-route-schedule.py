#!/usr/bin/env python3
"""
Spine recurring-route scheduler (interim, pre-app).

Reads recurring-stops.csv (one row per recurring plan) and prints a 4-week
dated route schedule grouped by day + zone, with per-day load vs. capacity
and a weekly recurring run-rate. Re-run whenever the book changes.

  python3 build-route-schedule.py [stops.csv]

Env: ROUTE_CAP_MIN = field-minutes-per-route-day ceiling (default 360 = ~6 hrs).
"""
import os, sys, csv, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
STOPS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "recurring-stops.csv")
if not os.path.exists(STOPS):
    STOPS = os.path.join(HERE, "recurring-stops.template.csv")
OUT = os.path.join(HERE, "route-schedule.md")
CAP = int(os.environ.get("ROUTE_CAP_MIN", "360"))
NL = "\n"
WEEKS = 4

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
ZONE_ORDER = ["Carova", "Corolla", "Duck", "Southern Shores", "Kitty Hawk",
              "Kill Devil Hills", "Nags Head", "Manteo", "South", "Ocracoke"]
CADENCE_WEEKS = {"weekly": 1, "biweekly": 2, "monthly": 4}


def zkey(z):
    z = z.strip()
    for i, name in enumerate(ZONE_ORDER):
        if name.lower() in z.lower():
            return i
    return len(ZONE_ORDER)


def occurs(stop, wk):
    c = stop["cadence"].lower()
    if c == "weekly":
        return True
    if c == "biweekly":
        aw = (stop["anchor_week"] or "A").strip().upper()
        return (wk % 2 == 0) if aw == "A" else (wk % 2 == 1)
    if c == "monthly":
        try:
            return int(stop["anchor_week"]) - 1 == wk
        except ValueError:
            return wk == 0
    return False  # seasonal handled separately


def load():
    stops, seasonal = [], []
    with open(STOPS, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if not (r.get("customer") or "").strip():
                continue
            r["est_min"] = int((r.get("est_min") or "0").strip() or 0)
            try:
                r["price"] = float((r.get("price") or "0").strip() or 0)
            except ValueError:
                r["price"] = 0.0
            (seasonal if r["cadence"].lower() == "seasonal" else stops).append(r)
    return stops, seasonal


def main():
    stops, seasonal = load()
    monday = datetime.date.today()
    monday -= datetime.timedelta(days=monday.weekday())  # this week's Monday
    out = ["# Spine Route Schedule — next 4 weeks",
           "",
           "_Generated %s from `%s`. Capacity ceiling = %d field-min/day "
           "(set ROUTE_CAP_MIN). Re-run when the book changes._"
           % (datetime.date.today().isoformat(), os.path.basename(STOPS), CAP),
           ""]

    # weekly recurring run-rate
    rate = sum(s["price"] / CADENCE_WEEKS.get(s["cadence"].lower(), 1) for s in stops)
    out.append("**Recurring run-rate: ~$%s / week** (%d recurring plans; "
               "%d seasonal wash campaigns tracked separately)."
               % (format(int(round(rate)), ","), len(stops), len(seasonal)))
    out.append("")

    for wk in range(WEEKS):
        wk_monday = monday + datetime.timedelta(weeks=wk)
        out.append("## Week of %s" % wk_monday.isoformat())
        for di, day in enumerate(DAYS):
            date = wk_monday + datetime.timedelta(days=di)
            today_stops = [s for s in stops
                           if s["anchor_day"].strip()[:3].title() == day
                           and occurs(s, wk)]
            today_stops.sort(key=lambda s: (zkey(s["zone"]), s["customer"]))
            mins = sum(s["est_min"] for s in today_stops)
            if not today_stops:
                continue
            flag = "  ⚠ OVER CAP" if mins > CAP else ""
            out.append("**%s %s — %d min / %d cap%s**"
                       % (day, date.isoformat(), mins, CAP, flag))
            for s in today_stops:
                out.append("- [%s] %s — %s · %s · %d min · $%.0f"
                           % (s["zone"], s["customer"], s["line"],
                              s["cadence"], s["est_min"], s["price"]))
            out.append("")

    if seasonal:
        out.append("## Washing campaigns (seasonal — schedule by zone-month)")
        for s in sorted(seasonal, key=lambda s: zkey(s["zone"])):
            out.append("- [%s] %s — %s · $%.0f · %s"
                       % (s["zone"], s["customer"], s["line"], s["price"],
                          s.get("notes", "")))
        out.append("")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(NL.join(out) + NL)
    print("Route schedule written: route-schedule.md")
    print("Recurring run-rate ~$%.0f/wk | %d plans | %d wash campaigns"
          % (rate, len(stops), len(seasonal)))


if __name__ == "__main__":
    main()
