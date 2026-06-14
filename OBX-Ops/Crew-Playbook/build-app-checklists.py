#!/usr/bin/env python3
"""
Build app-ready crew checklists (JSON) from the SOP markdown.

DevOps surfaces these as in-app, crew-facing job checklists. The SOP markdown
in SOPs/ is the SINGLE SOURCE OF TRUTH; this JSON is a generated view — edit
the SOPs, then re-run:  python3 build-app-checklists.py

Output: devops-handoff/crew-checklists.json
Each item carries check=true (a tickable step, from "- [ ]" lines) or
check=false (an informational bullet, e.g. scope caps). "Guards" become a
separate stop/escalate list.
"""
import os, re, json, glob

HERE = os.path.dirname(os.path.abspath(__file__))
SOPDIR = os.path.join(HERE, "SOPs")
OUTDIR = os.path.join(HERE, "devops-handoff")
OUT = os.path.join(OUTDIR, "crew-checklists.json")

# filename id -> service line key
LINE = {"01": "home-watch", "02": "washing", "03": "yard-mowing", "04": "junk",
        "05": "cleanup", "06": "brush", "07": "shed-demo", "08": "gutters"}

CHECK = "☐"   # ballot box (the on-site checkbox glyph used in the SOPs)


def clean(text):
    # light markdown strip for app display
    text = text.replace(CHECK, "").strip()
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)   # bold
    text = re.sub(r"\*(.+?)\*", r"\1", text)        # italic
    text = re.sub(r"`(.+?)`", r"\1", text)          # code
    return text.strip()


def parse(path):
    lines = open(path, encoding="utf-8").read().splitlines()
    sop = {"sections": [], "guards": []}
    cur = None
    for ln in lines:
        m = re.match(r"^# SOP (\d+)\s*[—-]\s*(.+)$", ln)
        if m:
            sop["id"] = m.group(1)
            title = m.group(2)
            tier = "SECONDARY" if "SECONDARY" in title else (
                   "SPINE" if "SPINE" in title else "")
            sop["tier"] = tier
            sop["title"] = re.sub(r"\s*\*\(.*?\)\*.*$", "", title).strip()
            continue
        m = re.match(r"^\*\*Guardrail pricing:\*\*\s*(.+)$", ln)
        if m:
            sop["pricing_guardrail"] = clean(m.group(1))
            continue
        m = re.match(r"^##+\s*(.+)$", ln)
        if m:
            name = re.sub(r"\s*\*\(.*?\)\*.*$", "", m.group(1)).strip()
            if re.search(r"guard", name, re.I):
                cur = ("guards", None)
            else:
                cur = ("section", {"name": name, "items": []})
                sop["sections"].append(cur[1])
            continue
        m = re.match(r"^-\s+(.*)$", ln)
        if m and cur:
            raw = m.group(1)
            item_text = clean(raw)
            if not item_text:
                continue
            if cur[0] == "guards":
                sop["guards"].append(item_text)
            else:
                cur[1]["items"].append(
                    {"text": item_text, "check": CHECK in raw})
    return sop


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    checklists = []
    for path in sorted(glob.glob(os.path.join(SOPDIR, "*.md"))):
        sop = parse(path)
        if "id" not in sop:
            continue
        sop["line"] = LINE.get(sop["id"], "")
        sop["source"] = "OBX-Ops/Crew-Playbook/SOPs/" + os.path.basename(path)
        checklists.append(sop)
    doc = {"schema": "obxls.crew-checklist.v1",
           "source_of_truth": "OBX-Ops/Crew-Playbook/SOPs/*.md",
           "note": "Generated view. Edit the SOP markdown, then re-run "
                   "build-app-checklists.py. check=true items are tickable; "
                   "check=false are informational (e.g. scope caps).",
           "count": len(checklists),
           "checklists": checklists}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
    print("Wrote %s" % os.path.relpath(OUT, HERE))
    for c in checklists:
        tick = sum(1 for s in c["sections"] for i in s["items"] if i["check"])
        print("  SOP %s %-14s tier=%-9s sections=%d tick-items=%d guards=%d"
              % (c["id"], c["line"], c["tier"], len(c["sections"]), tick,
                 len(c["guards"])))


if __name__ == "__main__":
    main()
