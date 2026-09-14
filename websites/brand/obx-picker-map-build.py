"""Builds the tappable service-area map (inline SVG) for the Milepost plans page from the cached OSM
shoreline data (obx-land.json + water polygons in the scratchpad). Single color, no text; nine areas
matching the plans-page pills; generous invisible hit zones so thin islands are tappable on a phone."""
import json, math, sys, os
S=sys.argv[1]
land=json.load(open(S+"/obx-land.json"))
def geo_rings(fname):
    d=json.load(open(fname)); g=d[0]["geojson"]
    return [g["coordinates"][0]] if g["type"]=="Polygon" else [poly[0] for poly in g["coordinates"]]
water=geo_rings(S+"/water-Currituck_Sound.json")+geo_rings(S+"/water-Coinjock_Bay.json")
water.append([(-75.99,36.40),(-75.884,36.40),(-75.878,36.60),(-75.99,36.60),(-75.99,36.40)])
water.append([(-75.83,36.10),(-75.79,36.10),(-75.79,36.265),(-75.83,36.265),(-75.83,36.10)])   # only the sliver of sound east of Powells Point that OSM leaves uncovered
CX=math.cos(math.radians(35.85)); LNG0,LNG1,LAT0,LAT1=-76.24,-75.38,35.05,36.58
K=1000/(LAT1-LAT0); W=(LNG1-LNG0)*CX*K
proj=lambda p:((p[0]-LNG0)*CX*K,(LAT1-p[1])*K)
def simplify(pts,eps):
    if len(pts)<3: return pts
    def d(p,a,b):
        if a==b: return math.hypot(p[0]-a[0],p[1]-a[1])
        t=max(0,min(1,((p[0]-a[0])*(b[0]-a[0])+(p[1]-a[1])*(b[1]-a[1]))/((b[0]-a[0])**2+(b[1]-a[1])**2)))
        return math.hypot(p[0]-(a[0]+t*(b[0]-a[0])),p[1]-(a[1]+t*(b[1]-a[1])))
    dmax,idx=0,0
    for i in range(1,len(pts)-1):
        dd=d(pts[i],pts[0],pts[-1])
        if dd>dmax: dmax,idx=dd,i
    return simplify(pts[:idx+1],eps)[:-1]+simplify(pts[idx:],eps) if dmax>eps else [pts[0],pts[-1]]
def path(r,eps=0.8):
    pts=simplify([proj(p) for p in r],eps); return "M"+"L".join(f"{x:.0f} {y:.0f}" for x,y in pts)+"Z"
big=sorted(land,key=lambda p:-abs(p["area"])); north=big[1]; dare=big[0]
cen=lambda p:(sum(q[0] for q in p["pts"])/len(p["pts"]), sum(q[1] for q in p["pts"])/len(p["pts"]))
islands=[p for p in big[2:] if abs(p["area"])>0.0004 and not (cen(p)[1]>36.2 and cen(p)[0]<-75.85) and cen(p)[0]>-75.80]
def POLY(pts):
    return '<polygon points="'+" ".join(f"{proj(p)[0]:.0f},{proj(p)[1]:.0f}" for p in pts)+'"/>'
def R(lng0,lng1,lat0,lat1):
    x0,y0=proj((lng0,lat1)); x1,y1=proj((lng1,lat0)); return f'<rect x="{x0:.0f}" y="{y0:.0f}" width="{x1-x0:.0f}" height="{y1-y0:.0f}"/>'
LAND=f'<path d="{path(north["pts"])}"/>'+"".join(f'<path d="{path(p["pts"])}"/>' for p in islands)
# the nine pill areas: (loc key, clip rects over the land, generous hit rect(s))
AREAS=[
 ("mainland",  POLY([(-75.77,36.02),(-75.99,36.04),(-76.05,36.13),(-76.09,36.27),(-76.14,36.40),(-76.19,36.58),(-75.884,36.58),(-75.884,36.385),(-75.85,36.385),(-75.85,36.26),(-75.80,36.26),(-75.80,36.115),(-75.77,36.115)]),   R(-76.26,-75.90,36.02,36.58)),   # west edge follows the North River / Northwest River (the county line), not a rectangle
 ("carova",    R(-75.884,-75.36,36.385,36.58),                                  R(-75.90,-75.36,36.385,36.58)),
 ("duck",      R(-75.85,-75.36,36.26,36.385)+R(-75.80,-75.36,36.16,36.26),                                  R(-75.88,-75.36,36.16,36.385)),
 ("kittyhawk", R(-75.77,-75.36,36.05,36.16),                                   R(-75.86,-75.36,36.05,36.16)),
 ("kdh",       R(-75.77,-75.36,35.98,36.05),                                   R(-75.80,-75.36,35.98,36.05)),
 ("nagshead",  R(-75.63,-75.36,35.78,35.98),                                   R(-75.63,-75.36,35.78,35.98)),
 ("manteo",    R(-75.80,-75.63,35.78,35.98),                                   R(-75.80,-75.63,35.78,35.98)),
 ("hatteras",  R(-75.80,-75.36,35.195,35.78),                                  R(-75.80,-75.36,35.195,35.78)),
 ("ocracoke",  R(-76.26,-75.72,35.05,35.195)+R(-75.80,-75.72,35.05,35.20),     R(-76.26,-75.70,35.05,35.195)),
]
out=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} 1000" class="pickmap" role="group" aria-label="Tap your area on the map">',
     '<defs><mask id="pm-water"><rect width="100%" height="100%" fill="#fff"/>'+"".join(f'<path d="{path(r)}" fill="#000"/>' for r in water)+'</mask>']
for k,clip,hit in AREAS: out.append(f'<clipPath id="pm-c-{k}">{clip}</clipPath>')
out.append('</defs>')
# Dare mainland: context only, dim, not tappable
out.append(f'<g class="pm-ctx" mask="url(#pm-water)"><g clip-path="url(#pm-ctx-clip)">{""}</g><path d="{path(dare["pts"])}"/></g>')
out.append('<g mask="url(#pm-water)">')
for k,clip,hit in AREAS:
    out.append(f'<g class="pm-area" data-loc="{k}" clip-path="url(#pm-c-{k})">{LAND}</g>')
out.append('</g>')
# hit zones on top (transparent), thin-island ones last so they win
for k,clip,hit in AREAS: out.append(f'<g class="pm-hit" data-loc="{k}">{hit}</g>')
out.append('</svg>')
svg="".join(out).replace('<g clip-path="url(#pm-ctx-clip)"></g>','')
open(S+"/pickmap.svg","w").write(svg); print("W",round(W),"bytes",len(svg))
