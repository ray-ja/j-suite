#!/usr/bin/env python3
"""Measure page copy against the Nielsen Norman Group web-writing criteria.

NN/g measured (Morkes & Nielsen): concise +58% usability, scannable +47%, objective +27%,
all three together +124%. Plain-language thresholds: sentences <=20 words, Flesch Reading
Ease >=60, grade level <=9, active voice.

This scores the three NN/g dimensions on real page text so the edit is driven by numbers
rather than taste."""
import re, sys, glob, os

MARKETESE = [ # NN/g: "exaggeration, subjective claims, and boasting"
 r"\bexperts?\b", r"\bpremium\b", r"\bseamless", r"\bcutting.edge\b", r"\bstate.of.the.art\b",
 r"\bbest\b", r"\bleading\b", r"\bworld.class\b", r"\bunmatched\b", r"\bunparalleled\b",
 r"\bperfect(ly)?\b", r"\brock.solid\b", r"\bpassionate\b", r"\bproud(ly)?\b", r"\bamazing\b",
 r"\bincredible\b", r"\bultimate\b", r"\bpremier\b", r"\btop.notch\b", r"\bexceptional\b",
 r"\bseriously\b", r"\btruly\b", r"\bsimply\b", r"\bjust works\b", r"\bactually works\b",
 r"\bdedicated to\b", r"\bcommitted to\b", r"\bstrive\b", r"\bsolutions?\b", r"\btrusted\b",
]
PASSIVE = re.compile(r"\b(is|are|was|were|be|been|being)\s+\w+(ed|en)\b", re.I)

def strip(html):
    """PROSE ONLY. Measuring raw stripped HTML counted the <title>, the nav menu and the phone
       number as one 80-word sentence, which made the whole score meaningless. Take the text of
       real prose blocks (p / li / h2-h4) only, and treat each block as its own sentence boundary."""
    h = re.sub(r"<(script|style|svg|nav|header|footer|form|select|option)[^>]*>.*?</\1>", " ", html, flags=re.S|re.I)
    blocks = re.findall(r"<(?:p|li|h2|h3|h4)[^>]*>(.*?)</(?:p|li|h2|h3|h4)>", h, flags=re.S|re.I)
    out = []
    for b in blocks:
        t = re.sub(r"<[^>]+>", " ", b)
        t = re.sub(r"&[a-z]+;", " ", t)
        t = re.sub(r"\s+", " ", t).strip()
        if len(t.split()) < 3: continue
        if not re.search(r"[.!?]$", t): t += "."
        out.append(t)
    return " ".join(out)

def syll(w):
    w = w.lower().strip(".,!?;:")
    if not w: return 0
    v = len(re.findall(r"[aeiouy]+", w))
    if w.endswith("e") and v > 1: v -= 1
    return max(1, v)

def score(text):
    sents = [s for s in re.split(r"[.!?]+", text) if len(s.split()) > 2]
    words = re.findall(r"[A-Za-z']+", text)
    if not sents or not words: return None
    wps = len(words)/len(sents)
    spw = sum(syll(w) for w in words)/len(words)
    fre = 206.835 - 1.015*wps - 84.6*spw
    fkg = 0.39*wps + 11.8*spw - 15.59
    longs = sum(1 for s in sents if len(s.split()) > 20)
    mk = sum(len(re.findall(p, text, re.I)) for p in MARKETESE)
    return {"words":len(words),"sents":len(sents),"wps":wps,"fre":fre,"fkg":fkg,
            "long_pct":100*longs/len(sents),"marketese":mk,
            "marketese_per_1k":1000*mk/len(words),
            "passive":len(PASSIVE.findall(text))}

def scan(html):
    """NN/g scannability: headings, bullets, bold keywords"""
    return {"h":len(re.findall(r"<h[2-4][ >]", html, re.I)),
            "li":len(re.findall(r"<li[ >]", html, re.I)),
            "bold":len(re.findall(r"<(strong|b)[ >]", html, re.I))}

files = sys.argv[1:] or sorted(glob.glob("*.html"))
tot = {"words":0,"sents":0,"marketese":0,"long":0,"passive":0}
rows=[]
for f in files:
    html = open(f, encoding="utf8").read()
    s = score(strip(html)); sc = scan(html)
    if not s: continue
    tot["words"]+=s["words"]; tot["sents"]+=s["sents"]; tot["marketese"]+=s["marketese"]
    tot["long"]+=s["long_pct"]*s["sents"]/100; tot["passive"]+=s["passive"]
    rows.append((f,s,sc))
n=len(rows)
print(f"\n  {n} pages · {tot['words']:,} words · {tot['sents']:,} sentences\n")
print(f"  {'CRITERION':<34}{'MEASURED':>12}   {'NN/g TARGET':<16} ")
print("  " + "-"*66)
wps = tot["words"]/tot["sents"]
fre = sum(r[1]["fre"]*r[1]["words"] for r in rows)/tot["words"]
fkg = sum(r[1]["fkg"]*r[1]["words"] for r in rows)/tot["words"]
mk1k = 1000*tot["marketese"]/tot["words"]
lp = 100*tot["long"]/tot["sents"]
def line(k,v,t,ok): print(f"  {k:<34}{v:>12}   {t:<16}{'PASS' if ok else 'FAIL'}")
line("Avg words per sentence", f"{wps:.1f}", "<= 20", wps<=20)
line("Sentences over 20 words", f"{lp:.0f}%", "<= 20%", lp<=20)
line("Flesch Reading Ease", f"{fre:.0f}", ">= 60", fre>=60)
line("Flesch-Kincaid grade", f"{fkg:.1f}", "<= 9.0", fkg<=9)
line("Marketese per 1k words", f"{mk1k:.1f}", "-> 0 (objective)", mk1k<2)
line("Passive constructions", f"{tot['passive']}", "minimise", tot["passive"]<n)
print()
print(f"  scannability: {sum(r[2]['h'] for r in rows)/n:.1f} headings, "
      f"{sum(r[2]['li'] for r in rows)/n:.1f} list items, "
      f"{sum(r[2]['bold'] for r in rows)/n:.1f} bold runs per page")
worst = sorted(rows, key=lambda r:-r[1]["marketese_per_1k"])[:5]
print("\n  worst pages for promotional language (per 1k words):")
for f,s,_ in worst:
    print(f"    {f:<34}{s['marketese_per_1k']:>5.1f}   ({s['marketese']} instances)")
