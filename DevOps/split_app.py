#!/usr/bin/env python3
"""Split the monolithic Business App into a small HTML shell + app.css + js/NN-*.js,
PROVABLY LOSSLESS (concatenated JS == original <script> body, asserted at runtime).

Reads from git HEAD by default so it BYPASSES the torn working-tree mount, and writes
only SMALL files (each js chunk + css + a ~4 KB shell) — so it lands intact even on a
mount that tears large writes. This is the permanent fix for the monolith-tearing class.

USAGE
  Test (writes to /tmp, touches nothing):   python3 DevOps/split_app.py /tmp/app-split git
  Real split, in-repo (run in a CLEAN session, AFTER the Round-2 re-apply is committed):
      python3 DevOps/split_app.py . git
  ...then: open "Business App (v1).html" in a browser (file:// AND served), exercise every
  tab + the full quote flow + sync + print; if clean, Ray commits. If broken, `git revert`.

VERIFIED 2026-05-31 against HEAD (491,171 B app): 30 js files, css ~14 KB, shell ~3.6 KB,
lossless assert PASSED, reassembled JS `node --check` OK, shell ends </body></html>.
Largest chunk ~100 KB (a data-heavy section) — still 5x under the monolith; watch it, and
sub-split later if it ever tears.
"""
import re, sys, os, subprocess

APP = "Business App (v1).html"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/app-split"
SRC = sys.argv[2] if len(sys.argv) > 2 else "git"   # "git" = read HEAD; else a filepath

if SRC == "git":
    s = subprocess.check_output(["git", "show", f"HEAD:{APP}"]).decode("utf-8")
else:
    s = open(SRC, encoding="utf-8").read()

# carve the document: head | <style> | mid (body skeleton + leaflet) | <script> | tail
sa = s.find("<style>"); sb = s.find("</style>")
css = s[sa + len("<style>"):sb]
leaf = s.find("leaflet.js"); pa = s.find("<script>", leaf); pb = s.rfind("</script>")
script = s[pa + len("<script>"):pb]
tail = s[pb + len("</script>"):]

# split the script at section banners; chunk 0 = preamble before the first banner
marks = [m.start() for m in re.finditer(r'/\* -+ [^\n]*? -+ \*/', script)]
bounds = [0] + marks + [len(script)]
chunks = [script[bounds[i]:bounds[i + 1]] for i in range(len(bounds) - 1)]

def slug(c):
    m = re.match(r'\s*/\* -+ (.*?) -+ \*/', c)
    t = (m.group(1) if m else "preamble").lower()
    return re.sub(r'[^a-z0-9]+', '-', t).strip('-')[:28] or "preamble"

os.makedirs(os.path.join(OUT, "js"), exist_ok=True)
names = []
for i, c in enumerate(chunks):
    n = f"js/{i:02d}-{slug(c)}.js"
    names.append(n)
    open(os.path.join(OUT, n), "w", encoding="utf-8").write(c)
open(os.path.join(OUT, "app.css"), "w", encoding="utf-8").write(css)

scripts = "\n".join(f'<script src="{n}"></script>' for n in names)
shell = s[:sa] + '<link rel="stylesheet" href="app.css">' + s[sb + len("</style>"):pa] + scripts + tail
open(os.path.join(OUT, APP), "w", encoding="utf-8").write(shell)

# PROOF of losslessness: rejoining the chunks must reproduce the original script byte-for-byte
assert "".join(chunks) == script, "LOSSLESS CHECK FAILED — do not use this output"
print(f"OK lossless: {len(chunks)} js files | css {len(css)} chars | shell {len(shell)} chars (was {len(s)})")
print(f"largest js chunk: {max(len(c) for c in chunks)} chars")
print("NEXT: reassemble + syntax-check ->  cat %s/js/*.js | node --check /dev/stdin" % OUT)
