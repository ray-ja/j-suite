#!/usr/bin/env python3
"""
Inventory gap report - reads master-inventory.md and answers, per job type:
"Am I equipped, and if not, what would it cost to buy or rent the gaps?"

  HAVE      = Have? checked in the master
  MISSING   = not checked; split into:
      BUY-GEAR  durable gear we'd own once   -> summed low-high (the capital number)
      STOCK     consumables / chemicals      -> recurring material cost
      RENTAL    rent per job                 -> rate flows into the job quote

Writes  Inventory Gap Report.md  and prints a summary.
Reads master-inventory.md by default; override with INV_MASTER=<file>.

  python3 gap-report.py
"""
import os, re, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
MASTER = os.environ.get("INV_MASTER", os.path.join(HERE, "master-inventory.md"))
OUT = os.path.join(HERE, "Inventory Gap Report.md")
NL = "\n"
STOCK_CATS = {"consumable", "chemical"}

JOBS = [
    ("junk",          "Junk / Clear-Out"),
    ("house-wash",    "House Soft Wash"),
    ("roof-wash",     "Roof Soft Wash"),
    ("driveway",      "Driveway / Concrete"),
    ("deck",          "Deck / Patio"),
    ("windows",       "Windows"),
    ("gutters",       "Gutters"),
    ("land-clearing", "Lot / Land Clearing"),
    ("yard",          "Yard Work"),
    ("brush",         "Brush / Debris"),
    ("storm",         "Storm Cleanup"),
    ("parking-lot",   "Parking Lot"),
    ("home-watch",    "Home-Watch"),
]


def have(cell):
    h = cell.lower()
    return any(m in h for m in ("☑", "☒", "✓", "x", "yes"))


def is_rental(cost, notes):
    return "rental" in (cost + " " + notes).lower()


def money(cost):
    nums = [int(n.replace(",", "")) for n in re.findall(r"([\d,]+)", cost)
            if n.replace(",", "").isdigit()]
    nums = [n for n in nums if n >= 5]
    if not nums:
        return (0, 0)
    return (min(nums), max(nums))


def parse():
    rows = []
    with open(MASTER, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s.startswith("|"):
                continue
            c = [x.strip() for x in s.strip("|").split("|")]
            if len(c) != 8 or c[0] in ("Item", "") or set(c[0]) <= set("-: "):
                continue
            item, cat, hv, qty, cost, brand, usedby, notes = c
            tags = [t.strip() for t in usedby.split(",") if t.strip()]
            rows.append(dict(item=item, cat=cat.lower(), have=have(hv),
                             cost=cost, notes=notes, tags=tags,
                             rental=is_rental(cost, notes), money=money(cost)))
    return rows


def buckets(sel):
    missing = [r for r in sel if not r["have"]]
    rent = [r for r in missing if r["rental"]]
    stock = [r for r in missing if not r["rental"] and r["cat"] in STOCK_CATS]
    gear = [r for r in missing if not r["rental"] and r["cat"] not in STOCK_CATS]
    return missing, gear, stock, rent


def main():
    rows = parse()
    today = datetime.date.today().isoformat()
    out = ["# OBX Lot Solutions - Inventory Gap Report",
           "",
           "_Generated %s from `master-inventory.md`. Re-run after Ray updates "
           "Have? in the master: `python3 gap-report.py`._" % today,
           "",
           "**HAVE** = checked in master | **BUY-GEAR** = missing durable gear "
           "we'd own once (the capital number) | **STOCK** = missing consumables/"
           "chemicals (recurring material) | **RENTAL** = rent per job (rate flows "
           "into the quote).",
           "",
           "## Summary",
           "",
           "| Job type | Items | Have | Missing | Buy-gear (est.) | Stock | Rentals |",
           "|---|--:|--:|--:|---|--:|--:|"]
    details = []
    for tag, title in JOBS:
        sel = [r for r in rows if tag in r["tags"] or "all" in r["tags"]]
        hv = [r for r in sel if r["have"]]
        missing, gear, stock, rent = buckets(sel)
        lo = sum(r["money"][0] for r in gear)
        hi = sum(r["money"][1] for r in gear)
        gear_str = "-" if not gear else "$%s-%s" % (format(lo, ","), format(hi, ","))
        out.append("| %s | %d | %d | %d | %s | %d | %d |" % (
            title, len(sel), len(hv), len(missing), gear_str, len(stock), len(rent)))

        d = ["### %s" % title, "_%d of %d on hand._" % (len(hv), len(sel))]
        if not missing:
            d.append("OK - **fully equipped** - nothing to buy or rent.")
        else:
            if gear:
                d.append("")
                d.append("**BUY-GEAR (own once) - est. %s:**" % gear_str)
                for r in sorted(gear, key=lambda x: -x["money"][1]):
                    d.append("- %s - %s _(%s)_" % (r["item"], r["cost"], r["cat"]))
            if rent:
                d.append("")
                d.append("**RENTAL (per job - flows into the quote):**")
                for r in rent:
                    d.append("- %s - %s" % (r["item"], r["cost"]))
            if stock:
                d.append("")
                d.append("**STOCK (consumables/chemicals - recurring material):**")
                for r in stock:
                    d.append("- %s - %s" % (r["item"], r["cost"]))
        details.append(NL.join(d))

    report = NL.join(out) + NL + NL + "---" + NL + NL + (NL + NL).join(details) + NL
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(report)

    print("Gap report written: Inventory Gap Report.md")
    print("%-22s %5s %5s %10s" % ("JOB", "HAVE", "MISS", "GEAR-HI"))
    for tag, title in JOBS:
        sel = [r for r in rows if tag in r["tags"] or "all" in r["tags"]]
        missing, gear, stock, rent = buckets(sel)
        hi = sum(r["money"][1] for r in gear)
        print("%-22s %5d %5d %10s" % (title[:22], len(sel) - len(missing),
                                      len(missing), format(hi, ",")))


if __name__ == "__main__":
    main()
