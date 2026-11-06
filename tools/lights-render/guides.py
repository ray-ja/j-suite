# Make the magenta traces (one per run) and sky masks (one per view) with the image model.
# usage: python3 guides.py house.json [--only rf,fp] [--force]
# A run needs "describe": where the lights go, in plain words. Lines get traced; nets/trees get filled.
# Existing files are kept unless --force (re-run a bad one with --only <id> --force after fixing its words).
import sys, os, json, subprocess
from concurrent.futures import ThreadPoolExecutor
here = os.path.dirname(os.path.abspath(__file__))
spec_path = sys.argv[1]; root = os.path.dirname(os.path.abspath(spec_path)); S = json.load(open(spec_path))
only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else None
force = "--force" in sys.argv
rel = lambda p: p if os.path.isabs(p) else os.path.join(root, p)

LINE = ("On this photo, draw thin solid pure magenta (#FF00FF) guide lines, 3 pixels wide, exactly on the edges "
        "described below. Change nothing else in the image. Lines ONLY: %s. Nothing else.")
FILL = ("On this photo, fill the area described below with flat solid pure magenta (#FF00FF), following its real "
        "outline closely. Change nothing else in the image. Fill ONLY: %s. Nothing else.")
SKY = ("On this photo, fill the ENTIRE open sky with flat solid pure magenta (#FF00FF), edge to edge, right up to the "
       "roofline, chimneys, trees and neighboring houses. Do not color anything that is not sky: the house, roof, trees, "
       "neighbor houses, fences and ground stay exactly as they are. Change nothing else.")

jobs = []
os.makedirs(os.path.join(root, "guides", "prompts"), exist_ok=True)
for v, V in S["views"].items():
  if V.get("sky") and (only is None or "sky" in only) and (force or not os.path.exists(rel(V["sky"]))):
    jobs.append(("sky-" + v, rel(V["base"]), rel(V["sky"]), SKY))
for rid, R in S["runs"].items():
  if only and rid not in only: continue
  if not R.get("describe"): continue
  if os.path.exists(rel(R["guide"])) and not force: continue
  tpl = LINE if R.get("mode", "line") == "line" else FILL
  jobs.append((rid, rel(S["views"][R["view"]]["base"]), rel(R["guide"]), tpl % R["describe"]))

def run(job):
  name, src, out, prompt = job
  pf = os.path.join(root, "guides", "prompts", name + ".txt"); open(pf, "w").write(prompt)
  os.makedirs(os.path.dirname(out), exist_ok=True)
  r = subprocess.run(["node", os.path.join(here, "gemini.js"), src, out, pf], capture_output=True, text=True)
  return name, (r.stdout + r.stderr).strip()

with ThreadPoolExecutor(6) as ex:
  for name, msg in ex.map(run, jobs): print("%-8s %s" % (name, msg))
print("%d made. Next: python3 build.py %s, then check qa/trace-*.jpg" % (len(jobs), spec_path))
