# magenta guide renders -> bulb points. usage: python3 bulbs.py <dir> <out.json>
import numpy as np,json,sys,math,random
from PIL import Image
W,H=1195,896
def mask(path,ymin=0,ymax=H,mn=25):
  a=np.asarray(Image.open(path).convert('RGB').resize((W,H))).astype(int)
  m=(a[...,0]>170)&(a[...,2]>170)&(a[...,1]<110)
  m[:ymin]=False;m[ymax:]=False
  keep=np.zeros_like(m);seen=np.zeros_like(m)
  for y0,x0 in zip(*np.nonzero(m)):
    if seen[y0,x0]:continue
    st=[(y0,x0)];seen[y0,x0]=True;comp=[]
    while st:
      y,x=st.pop();comp.append((y,x))
      for a in (-1,0,1):
        for b in (-1,0,1):
          yy,xx=y+a,x+b
          if 0<=yy<H and 0<=xx<W and m[yy,xx] and not seen[yy,xx]:seen[yy,xx]=True;st.append((yy,xx))
    if len(comp)>=mn:
      for q in comp:keep[q]=True
  return keep
def thin(m):  # Zhang-Suen
  m=m.copy().astype(np.uint8)
  while True:
    ch=False
    for step in (0,1):
      p=np.pad(m,1);P=[p[1:-1,1:-1],p[:-2,1:-1],p[:-2,2:],p[1:-1,2:],p[2:,2:],p[2:,1:-1],p[2:,:-2],p[1:-1,:-2],p[:-2,:-2]]
      B=sum(P[1:]);seq=P[1:]+[P[1]];A=sum(((seq[i]==0)&(seq[i+1]==1)).astype(int) for i in range(8))
      if step==0:c=(P[1]*P[3]*P[5]==0)&(P[3]*P[5]*P[7]==0)
      else:c=(P[1]*P[3]*P[7]==0)&(P[1]*P[5]*P[7]==0)
      d=(m==1)&(B>=2)&(B<=6)&(A==1)&c
      if d.any():m[d]=0;ch=True
    if not ch:return m.astype(bool)
def along(m,d):
  sk=thin(m);pts=set(zip(*np.nonzero(sk)));out=[]
  N=[(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
  deg=lambda q:sum((q[0]+a,q[1]+b) in pts for a,b in N)
  while pts:
    ends=[q for q in pts if deg(q)<=1];cur=min(ends) if ends else min(pts)
    acc=d;prev=None
    while cur:
      pts.discard(cur)
      if prev:acc+=math.hypot(cur[0]-prev[0],cur[1]-prev[1])
      if acc>=d:out.append((cur[1],cur[0]));acc=0
      nb=[(cur[0]+a,cur[1]+b) for a,b in N if (cur[0]+a,cur[1]+b) in pts]
      prev=cur;cur=min(nb,key=lambda q:abs(q[0]-cur[0])+abs(q[1]-cur[1])) if nb else None
  # drop near-duplicates where separate walks meet
  res=[]
  for p in out:
    if all((p[0]-q[0])**2+(p[1]-q[1])**2>=(0.6*d)**2 for q in res[-60:]):res.append(p)
  return res
def fill(m,d,seed=7):
  random.seed(seed);ys,xs=np.nonzero(m);idx=list(range(len(xs)));random.shuffle(idx)
  cell={};res=[]
  for i in idx:
    x,y=xs[i],ys[i];cx,cy=int(x//d),int(y//d);ok=True
    for a in (-1,0,1):
      for b in (-1,0,1):
        for q in cell.get((cx+a,cy+b),()):
          if (q[0]-x)**2+(q[1]-y)**2<d*d:ok=False;break
        if not ok:break
      if not ok:break
    if ok:cell.setdefault((cx,cy),[]).append((x,y));res.append((int(x),int(y)))
  return res
