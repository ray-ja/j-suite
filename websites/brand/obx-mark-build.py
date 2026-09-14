import json, math, sys, os
S=os.path.dirname(os.path.abspath(__file__))
land=json.load(open(S+"/obx-land.json"))
def geo_rings(fname):
    d=json.load(open(fname)); g=d[0]["geojson"]
    return [g["coordinates"][0]] if g["type"]=="Polygon" else [poly[0] for poly in g["coordinates"]]
water=geo_rings(S+"/water-Currituck_Sound.json")+geo_rings(S+"/water-Coinjock_Bay.json")
water.append([(-75.99,36.40),(-75.884,36.40),(-75.878,36.555),(-75.99,36.555),(-75.99,36.40)])   # meets the clip edge exactly: no sliver
water.append([(-75.99,36.10),(-75.795,36.10),(-75.795,36.265),(-75.99,36.265),(-75.99,36.10)])   # southern Currituck Sound / Kitty Hawk Bay, missing from the OSM water polygon
CX=math.cos(math.radians(35.85)); LNG0,LNG1,LAT0,LAT1=-75.92,-75.40,35.06,36.555
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
def path(r,eps):
    pts=simplify([proj(p) for p in r],eps); return "M"+"L".join(f"{x:.1f} {y:.1f}" for x,y in pts)+"Z"
big=sorted(land,key=lambda p:-abs(p["area"])); north=big[1]
cen=lambda p:(sum(q[0] for q in p["pts"])/len(p["pts"]), sum(q[1] for q in p["pts"])/len(p["pts"]))
islands=[p for p in big[2:] if abs(p["area"])>0.0004 and not (cen(p)[1]>36.2 and cen(p)[0]<-75.85) and cen(p)[0]>-75.80]   # only the real islands: Roanoke, Hatteras, Ocracoke, Bodie bits; no sound marsh
def rectp(lng0,lng1,lat0,lat1):
    x0,y0=proj((lng0,lat1)); x1,y1=proj((lng1,lat0)); return f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{x1-x0:.1f}" height="{y1-y0:.1f}"/>'
banks=rectp(-75.884,-75.40,36.40,36.555)+rectp(-75.85,-75.40,36.26,36.40)+rectp(-75.80,-75.40,36.115,36.26)+rectp(-75.745,-75.40,35.06,36.115)   # hugs the sound side of the banks; mainland tips and uncovered sound water cut out
def build(pre,eps,stroke):
    st=f' stroke="currentColor" stroke-width="{stroke}" stroke-linejoin="round" stroke-linecap="round"' if stroke else ''
    body=f'<g clip-path="url(#{pre}-banks)"><path d="{path(north["pts"],eps)}"/></g>'+"".join(f'<path d="{path(p["pts"],eps)}"/>' for p in islands)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} 1000" role="img" aria-label="The Outer Banks"><defs>'
            f'<clipPath id="{pre}-banks">{banks}</clipPath>'
            f'<mask id="{pre}-land"><rect width="100%" height="100%" fill="#fff"/>'+"".join(f'<path d="{path(r,eps)}" fill="#000"/>' for r in water)+'</mask></defs>'
            f'<g mask="url(#{pre}-land)"><g fill="currentColor"{st}>{body}</g></g></svg>')
open(S+"/obx-mark.svg","w").write(build("obxm",0.6,0))
open(S+"/obx-mark-bold.svg","w").write(build("obxb",1.2,6))
print("fine KB",os.path.getsize(S+"/obx-mark.svg")//1024,"bold KB",os.path.getsize(S+"/obx-mark-bold.svg")//1024)
