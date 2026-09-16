#!/usr/bin/env python3
"""Shaded views of the same boxes waterfall.py builds (no GPU needed). Run after waterfall.py."""
import json, os, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
here = os.path.dirname(os.path.abspath(__file__))
BOXES = json.load(open(os.path.join(here, "boxes.json")))
def faces(w, d, h, x, y, z):
    p = [(x,y,z),(x+w,y,z),(x+w,y+d,z),(x,y+d,z),(x,y,z+h),(x+w,y,z+h),(x+w,y+d,z+h),(x,y+d,z+h)]
    return [[p[0],p[1],p[5],p[4]],[p[2],p[3],p[7],p[6]],[p[1],p[2],p[6],p[5]],[p[0],p[3],p[7],p[4]],[p[4],p[5],p[6],p[7]],[p[0],p[1],p[2],p[3]]]
for name, (elev, azim) in {"iso": (22, -55), "front": (0, -90), "side": (0, 0), "plan": (90, -90)}.items():
    fig = plt.figure(figsize=(9, 9), dpi=110); ax = fig.add_subplot(111, projection="3d")
    for w, d, h, x, y, z, color, nm in BOXES:
        alpha = 0.45 if nm == "glass" else 1.0
        ax.add_collection3d(Poly3DCollection(faces(w, d, h, x, y, z), facecolors=color, edgecolors="#333", linewidths=0.4, alpha=alpha))
    ax.set_xlim(-20, 124); ax.set_ylim(-40, 104); ax.set_zlim(0, 265)
    ax.set_box_aspect((144, 144, 265)); ax.view_init(elev=elev, azim=azim); ax.set_axis_off()
    fig.text(0.02, 0.97, "Christina Jamieson · waterfall opening · " + name + " · tan = new stone surround, blue = glass, black = frame + basin, yellow = outlet (drawn right)", fontsize=9, color="#1B2A4E")
    fig.savefig(os.path.join(here, "3d-" + name + ".png"), bbox_inches="tight", facecolor="white"); plt.close(fig)
print("rendered iso/front/side/plan")
