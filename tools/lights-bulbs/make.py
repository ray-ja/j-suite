# Bulb points for a lights quote page.
# usage: python3 make.py spec.json out/bulbs.json   (paths in spec are relative to the spec file)
# spec: {"runs":{"rf":["mg/rf.png","line",14], "sh":["mg/sh.png","fill",8], "fp":["mg/fp.png","line",6,480,896]},
#        "extra":{"fp":[[447,530],[453,530]]}}
# Each guide is the base photo with the run traced in pure magenta (#FF00FF) by the image model.
# line = bulbs every N px along the traced line (C9 roofline ~14, mini lights ~6). fill = net of bulbs N px apart (shrubs, trees).
import sys,os,json
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from bulbs import mask,along,fill
spec=json.load(open(sys.argv[1]));base=os.path.dirname(os.path.abspath(sys.argv[1]));P={}
for k,r in spec["runs"].items():
  f,mode,d=r[0],r[1],r[2];y0=r[3] if len(r)>3 else 0;y1=r[4] if len(r)>4 else 896
  m=mask(os.path.join(base,f),y0,y1,r[5] if len(r)>5 else 25)
  P[k]=along(m,d) if mode=="line" else fill(m,d)
  P[k]+= [tuple(p) for p in spec.get("extra",{}).get(k,[])]
  print(k,len(P[k]))
json.dump({k:[int(c) for p in v for c in p] for k,v in P.items()},open(sys.argv[2],"w"),separators=(",",":"))
