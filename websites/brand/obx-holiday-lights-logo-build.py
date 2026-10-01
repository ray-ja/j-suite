#!/usr/bin/env python3
"""OBX Holiday Lights seasonal logo files for Google Ads. The family mark never changes; the ground and the
accent do, per season. Usage: python3 obx-holiday-lights-logo-build.py christmas   (or parties / halloween)
Writes obx-holiday-lights-<season>-square.svg/.png (1200x1200) and -landscape.svg/.png (1200x300)."""
import re, sys, subprocess, os
SEASONS = {
  # ground, mark, wordmark ink, tagline ink, tagline text, optional ring of little lights (colour or None)
  "christmas": dict(bg="#153b2c", mark="#e6b85a", ink="#f6efe2", tag="#e6b85a", tagline="CHRISTMAS LIGHTING", lights=["#e8463c", "#5fd67f", "#4f8cff", "#f2c14e", "#fff3d1"]),   # classic C9 colours, glowing
  "parties":   dict(bg="#101725", mark="#d99420", ink="#ffffff", tag="#d99420", tagline="PARTY LIGHTING", lights=["#ffe9b3"]),
  "halloween": dict(bg="#120d14", mark="#f08a24", ink="#f6efe2", tag="#c9a0ff", tagline="HALLOWEEN LIGHTING", lights=["#f08a24", "#a86cff"]),
  "plain":     dict(bg="#faf8f5", mark="#d99420", ink="#101725", tag="#a06a09", tagline="CHRISTMAS LIGHTING", lights=None),
}
season = (sys.argv[1] if len(sys.argv) > 1 else "christmas").lower()
P = SEASONS[season]
inner = re.search(r'<g fill="#14161a">(.*)</g>', open("dyad-mark.svg", encoding="utf8").read(), re.S).group(1)
GLOW = '<defs><filter id="glow" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="{sd}"/></filter></defs>'
def ring(cx, cy, r, n, cols, dot):
    """a string of C9 bulbs around the mark: each bulb is a soft glow halo + a bright core, colours cycling"""
    import math
    out = GLOW.format(sd=dot * 1.1)
    for i in range(n):
        a = 2 * math.pi * i / n - math.pi / 2
        x, y, c = cx + r * math.cos(a), cy + r * math.sin(a), cols[i % len(cols)]
        out += '<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s" opacity=".55" filter="url(#glow)"/>' % (x, y, dot * 2.2, c)
        out += '<circle cx="%.1f" cy="%.1f" r="%d" fill="%s"/>' % (x, y, dot, c)
        out += '<circle cx="%.1f" cy="%.1f" r="%.1f" fill="#ffffff" opacity=".85"/>' % (x - dot * .3, y - dot * .3, dot * .3)
    return out
sq = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" width="1200" height="1200">\n<rect width="1200" height="1200" fill="%s"/>\n' % P["bg"]
if P["lights"]: sq += ring(600, 600, 470, 24, P["lights"], 11) + "\n"
sq += '<svg x="200" y="200" width="800" height="800" viewBox="199 199 627 627"><g fill="%s">%s</g></svg>\n</svg>\n' % (P["mark"], inner)
ls = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 300" width="1200" height="300">\n<rect width="1200" height="300" fill="%s"/>\n' % P["bg"]
if P["lights"]: ls += ring(180, 150, 128, 16, P["lights"], 6) + "\n"
ls += ('<svg x="70" y="40" width="220" height="220" viewBox="199 199 627 627"><g fill="%s">%s</g></svg>\n'
       '<text x="340" y="140" font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" font-size="74" font-weight="800" fill="%s">OBX Holiday Lights</text>\n'
       '<text x="344" y="208" font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" font-size="36" font-weight="600" letter-spacing="6" fill="%s">%s</text>\n</svg>\n') % (P["mark"], inner, P["ink"], P["tag"], P["tagline"])
base = "obx-holiday-lights-%s" % season
open(base + "-square.svg", "w", encoding="utf8").write(sq); open(base + "-landscape.svg", "w", encoding="utf8").write(ls)
C = os.path.expanduser("~/.cache/puppeteer/chrome-headless-shell/linux-148.0.7778.97/chrome-headless-shell-linux64/chrome-headless-shell")
for kind, w, h in (("square", 1200, 1200), ("landscape", 1200, 300)):
    html = "/tmp/hl-logo-%s.html" % kind
    open(html, "w").write('<!doctype html><html><head><style>html,body{margin:0;padding:0;background:%s}img{display:block}</style></head><body><img src="file://%s/%s-%s.svg" width="%d" height="%d"></body></html>' % (P["bg"], os.getcwd(), base, kind, w, h))
    subprocess.run([C, "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--user-data-dir=/tmp/jsuite-ux-prof", "--allow-file-access-from-files", "--hide-scrollbars", "--virtual-time-budget=2000", "--window-size=%d,%d" % (w, h), "--screenshot=%s-%s-%s.png" % (base, kind, "1200" if kind == "square" else "1200x300"), "file://" + html], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
print("built", season)
