#!/usr/bin/env python3
"""
Generate the per-job-type inventory lenses from master-inventory.md.

The MASTER is the single source of truth for Have?/Qty. These per-job sheets
are read-only filtered views that INHERIT that status, so they can never drift:
just re-run this script after editing the master.

    python3 build-inventory-sheets.py
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
MASTER = os.environ.get("INV_MASTER", os.path.join(HERE, "master-inventory.md"))
OUTDIR = os.path.join(HERE, "by-job-type")
NL = "\n"

# (tag, filename, title) - the 13 job types
JOBS = [
    ("junk",          "junk-clear-out",     "Junk / Clear-Out"),
    ("house-wash",    "house-soft-wash",    "House Soft Wash"),
    ("roof-wash",     "roof-soft-wash",     "Roof Soft Wash"),
    ("driveway",      "driveway-concrete",  "Driveway / Concrete"),
    ("deck",          "deck-patio",         "Deck / Patio"),
    ("windows",       "windows",            "Windows"),
    ("gutters",       "gutters",            "Gutters"),
    ("land-clearing", "lot-land-clearing",  "Lot / Land Clearing"),
    ("yard",          "yard-work",          "Yard Work"),
    ("brush",         "brush-debris",       "Brush / Debris"),
    ("storm",         "storm-cleanup",      "Storm Cleanup"),
    ("parking-lot",   "parking-lot",        "Parking Lot"),
    ("home-watch",    "home-watch",         "Home-Watch"),
]
VALID_TAGS = {t for t, _, _ in JOBS} | {"all"}
MATERIAL_CATS = {"consumable", "chemical"}


def parse_master():
    rows, warnings = [], []
    with open(MASTER, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s.startswith("|"):
                continue
            cells = [c.strip() for c in s.strip("|").split("|")]
            if len(cells) != 8:
                continue
            if cells[0] in ("Item", ""):
                continue
            if set(cells[0]) <= set("-: "):
                continue
            item, cat, have, qty, cost, brand, usedby, notes = cells
            tags = [t.strip() for t in usedby.split(",") if t.strip()]
            bad = [t for t in tags if t not in VALID_TAGS]
            if bad:
                warnings.append("  ! %s: unknown tag(s) %s" % (item, bad))
            rows.append(dict(item=item, cat=cat.lower(), have=have, qty=qty,
                             cost=cost, brand=brand, tags=tags, notes=notes))
    return rows, warnings


def mirror(have):
    h = have.lower()
    return "✅" if any(m in h for m in ("☑", "☒", "✓", "x", "yes")) else "⬜"


def render_table(rows):
    if not rows:
        return "_None tagged for this job._" + NL
    out = ["| Have? | Item | Category | Qty | Est. cost | Brand/model (e.g.) | Notes |",
           "|:--:|---|---|:--:|---|---|---|"]
    for r in rows:
        out.append("| %s | %s | %s | %s | %s | %s | %s |" % (
            mirror(r["have"]), r["item"], r["cat"], r["qty"],
            r["cost"], r["brand"], r["notes"]))
    return NL.join(out) + NL


def build():
    rows, warnings = parse_master()
    os.makedirs(OUTDIR, exist_ok=True)
    index = ["# Per-Job-Type Inventory Lenses",
             "",
             "Read-only views generated from `../master-inventory.md` "
             "(the single source of truth). **Mark Have?/Qty in the master, "
             "then re-run `build-inventory-sheets.py`** - never edit these by hand.",
             "",
             "| Job type | Sheet | Items | Material lines |",
             "|---|---|--:|--:|"]
    for tag, fname, title in JOBS:
        sel = [r for r in rows if tag in r["tags"] or "all" in r["tags"]]
        gear = [r for r in sel if r["cat"] not in MATERIAL_CATS]
        mats = [r for r in sel if r["cat"] in MATERIAL_CATS]
        body = [
            "# Inventory - %s" % title,
            "",
            "Generated from `../master-inventory.md`. **Read-only** - the "
            "`Have?`/`Qty` here mirror the master. Mark status in the master, "
            "then regenerate.",
            "_Selection: items tagged `%s` (plus `all`). %d gear/PPE + %d "
            "material lines._" % (tag, len(gear), len(mats)),
            "",
            "## Gear, tools, equipment & PPE",
            "",
            render_table(gear),
            "",
            "## Materials - feed per-job quote cost  *(consumables & chemicals)*",
            "",
            render_table(mats),
        ]
        with open(os.path.join(OUTDIR, fname + ".md"), "w", encoding="utf-8") as f:
            f.write(NL.join(body))
        index.append("| %s | [%s.md](%s.md) | %d | %d |" % (
            title, fname, fname, len(gear), len(mats)))
    with open(os.path.join(OUTDIR, "_index.md"), "w", encoding="utf-8") as f:
        f.write(NL.join(index) + NL)
    return rows, warnings


if __name__ == "__main__":
    rows, warnings = build()
    print("Parsed %d master items -> %d job sheets + _index.md" % (len(rows), len(JOBS)))
    if warnings:
        print("WARNINGS:")
        print(NL.join(warnings))
    else:
        print("All items carry valid tags. No drift risk: re-run anytime.")
