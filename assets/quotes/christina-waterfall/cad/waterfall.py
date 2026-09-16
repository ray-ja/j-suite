#!/usr/bin/env python3
"""Christina Jamieson · waterfall opening · parametric CAD (CadQuery).
Every number below is one of Ray's field measurements (2026-09-16), in cm. Change a number, rerun, and the
model, the drawings and the STEP file rebuild. Run:  ~/cadenv/bin/python waterfall.py
Axes: X = across the opening (left/right from the living room), Y = depth (front = living room at Y=0, rear =
dining room at Y=COL_D), Z = up from the floor."""
import cadquery as cq
from cadquery import exporters
import os

# ---- MEASURED (cm) ----
W_OPEN, H_OPEN = 104.0, 245.0          # drywall ID to ID · floor to ceiling
GAP_TOP = 16.0                          # top of waterfall frame to ceiling
H_WF = 228.5                            # waterfall overall height (assumed floor to top of frame, basin included)
W_WF = 80.5                             # frame edge to frame edge
T_SIDE, T_TOP = 5.0, 5.5                # frame member thickness
BASIN_D, BASIN_W, BASIN_H = 46.0, 81.0, 28.5
BASIN_FR = 4.75                         # basin frame width, all around
GLASS_GAP = 18.0                        # inside basin frame to glass, front and rear
OUT_BOT, OUT_TOP = 32.0, 45.5           # outlet cover, bottom / top off the floor
OUT_W = 3.25 * 2.54                     # outlet cover width
COL_FRONT, COL_REAR = 10 * 2.54, 12.5 * 2.54   # outlet cover to the column's front / rear edge
COL_D = COL_FRONT + OUT_W + COL_REAR    # column (wall) depth ≈ 65.4
# ---- ASSUMED (flagged for Ray) ----
OUTLET_SIDE = "right"                   # confirmed from Ray's photo 2026-09-16: right column, low, cord plugged in
BASIN_Y = 1.0                           # basin front sits about flush with the column front (photo); was drawn centered before
# ---- THE NEW SURROUND (the build) ----
STUD = 3.8                              # 2x4 on the flat behind the stone (cm)
BOARD = 1.2                             # cement board
STONE = 2.5                             # thin veneer / tile thickness
SURROUND_T = STUD + BOARD + STONE       # 7.5 cm total build-out
REVEAL = 2.0                            # stone set back from the drywall face (the inset look she liked)

glass_w = W_WF - 2 * T_SIDE
basin_inner_d = BASIN_D - 2 * BASIN_FR
glass_t = max(0.5, basin_inner_d - 2 * GLASS_GAP)
side_gap = (W_OPEN - W_WF) / 2
basin_x = (W_OPEN - BASIN_W) / 2
glass_y = BASIN_Y + BASIN_FR + GLASS_GAP          # front face of the glass

BOXES = []   # (w,d,h,x,y,z,color,name) mirror for the matplotlib render (render3d.py)
def box(w, d, h, x, y, z, color=None, name=""):
    if color: BOXES.append((w, d, h, x, y, z, color, name))
    return cq.Workplane("XY").box(w, d, h, centered=False).translate((x, y, z))

# the wall pocket: two columns + the header, as the drywall that exists today
col_left = box(20, COL_D, H_OPEN, -20, 0, 0, "#efebe4", "drywall")
col_right = box(20, COL_D, H_OPEN, W_OPEN, 0, 0, "#efebe4", "drywall")
header = box(W_OPEN + 40, COL_D, 20, -20, 0, H_OPEN, "#efebe4", "drywall")
walls = col_left.union(col_right).union(header)

# the waterfall as it is: basin, side frames, top frame, glass
basin = box(BASIN_W, BASIN_D, BASIN_H, basin_x, BASIN_Y, 0, "#262626", "basin")
basin_cut = box(BASIN_W - 2 * BASIN_FR, basin_inner_d, BASIN_H - BASIN_FR, basin_x + BASIN_FR, BASIN_Y + BASIN_FR, BASIN_FR)
basin = basin.cut(basin_cut)
frame_h = H_WF - BASIN_H
fx = side_gap
frame_l = box(T_SIDE, T_SIDE, frame_h, fx, glass_y - (T_SIDE - glass_t) / 2, BASIN_H, "#1a1a1a", "frame")
frame_r = box(T_SIDE, T_SIDE, frame_h, fx + W_WF - T_SIDE, glass_y - (T_SIDE - glass_t) / 2, BASIN_H, "#1a1a1a", "frame")
frame_t = box(W_WF, T_SIDE, T_TOP, fx, glass_y - (T_SIDE - glass_t) / 2, H_WF - T_TOP, "#1a1a1a", "frame")
glass = box(glass_w, glass_t, frame_h - T_TOP, fx + T_SIDE, glass_y, BASIN_H, "#9ccbe6", "glass")
outlet_x = W_OPEN if OUTLET_SIDE == "right" else -1.0
outlet = box(1.0, OUT_W, OUT_TOP - OUT_BOT, outlet_x, COL_FRONT, OUT_BOT, "#e0a800", "outlet")

# THE NEW SURROUND, revised from Ray's photo (2026-09-16): the basin is an open trough at the FRONT of the column
# (front wall ~1 cm behind the drywall face) with side walls that hold the water, and the outlet on the right column
# powers the pump that lives in that basin. So:
#  · the plinth is cement board + stone fixed straight onto the basin's front wall (no stud), which puts its face
#    about 2.7 cm proud of the drywall — a natural step, not a problem;
#  · the basin stays OPEN above: no sill over it, the water falls into it and the pump is reached from the trough;
#  · the wall faces above the plinth are stud + board + stone, set REVEAL back from the drywall (her inset look),
#    and each side RETURNS from the face back to the glass;
#  · the outlet ends up in the cavity BEHIND the right return, above the basin wall. The pump cord passes from the
#    basin over its end wall through a notch at the foot of the right return; one loose stone panel at the foot of
#    that return (magnets) is the hand-hole to reach the plug.
PLINTH_T = BOARD + STONE                                   # 3.7 cm on the basin's front wall
PLINTH_Y = BASIN_Y - PLINTH_T                              # ≈ -2.7: proud of the drywall face
sur_front = REVEAL
ret_t = BOARD + STONE
ret_d = glass_y - (sur_front + SURROUND_T)                 # face to glass ≈ 23 cm
face_z0 = BASIN_H + 1.0                                    # wall faces start just above the basin top
plinth = box(W_OPEN, PLINTH_T, face_z0, 0, PLINTH_Y, 0, "#c9ad80", "stone")
side_l = box(side_gap + T_SIDE, SURROUND_T, H_OPEN - face_z0, 0, sur_front, face_z0, "#c9ad80", "stone")
side_r = box(side_gap + T_SIDE, SURROUND_T, H_OPEN - face_z0, W_OPEN - side_gap - T_SIDE, sur_front, face_z0, "#c9ad80", "stone")
top = box(W_OPEN, SURROUND_T, GAP_TOP + T_TOP, 0, sur_front, H_OPEN - GAP_TOP - T_TOP, "#c9ad80", "stone")
ret_h = H_OPEN - GAP_TOP - T_TOP - face_z0
ACCESS_H = 30.0                                            # the loose panel at the foot of the right return
ret_l = box(ret_t, ret_d, ret_h, side_gap + T_SIDE - ret_t, sur_front + SURROUND_T, face_z0, "#c9ad80", "stone")
ret_r_fixed = box(ret_t, ret_d, ret_h - ACCESS_H, W_OPEN - side_gap - T_SIDE, sur_front + SURROUND_T, face_z0 + ACCESS_H, "#c9ad80", "stone")
ret_r_panel = box(ret_t, ret_d, ACCESS_H, W_OPEN - side_gap - T_SIDE, sur_front + SURROUND_T, face_z0, "#a8895a", "access panel (loose)")
ret_top = box(glass_w + 2 * ret_t, ret_d, ret_t, side_gap + T_SIDE - ret_t, sur_front + SURROUND_T, H_OPEN - GAP_TOP - T_TOP - ret_t, "#c9ad80", "stone")
surround = plinth.union(side_l).union(side_r).union(top).union(ret_l).union(ret_r_fixed).union(ret_top)
access_panel = ret_r_panel
assy = cq.Assembly()
assy.add(walls, name="drywall", color=cq.Color(0.93, 0.91, 0.87))
assy.add(basin, name="basin", color=cq.Color(0.15, 0.15, 0.15))
assy.add(frame_l.union(frame_r).union(frame_t), name="frame", color=cq.Color(0.1, 0.1, 0.1))
assy.add(glass, name="glass", color=cq.Color(0.6, 0.8, 0.95, 0.5))
assy.add(outlet, name="outlet", color=cq.Color(0.9, 0.7, 0.1))
assy.add(surround, name="stone surround", color=cq.Color(0.78, 0.68, 0.5))
assy.add(access_panel, name="access panel (loose stone, magnets)", color=cq.Color(0.66, 0.54, 0.35))

out = os.path.dirname(os.path.abspath(__file__))
assy.save(os.path.join(out, "waterfall.step"))
assy.save(os.path.join(out, "waterfall.glb"), exportType="GLTF")
everything = walls.union(basin).union(frame_l).union(frame_r).union(frame_t).union(glass).union(outlet).union(surround).union(access_panel)
views = {"iso": (1, -1, 0.6), "front": (0, -1, 0), "side": (1, 0, 0), "plan": (0, 0, 1)}
for name, d in views.items():
    exporters.export(everything, os.path.join(out, f"view-{name}.svg"), opt={"projectionDir": d, "width": 900, "height": 900, "showAxes": False, "strokeWidth": 0.6, "showHidden": False})
F = ((side_gap + T_SIDE) * (H_OPEN - face_z0) * 2 + W_OPEN * (GAP_TOP + T_TOP) + W_OPEN * face_z0) / 1e4
R = (2 * ret_d * ret_h + ret_d * (glass_w + 2 * ret_t)) / 1e4
print("built: glass %.1f x %.1f cm · returns %.1f cm deep · plinth %.1f cm proud of the drywall · stone face %.2f + returns %.2f = %.2f m2 (%.0f sq ft)" % (glass_w, frame_h - T_TOP, ret_d, -PLINTH_Y, F, R, F + R, (F + R) * 10.764))
import json; json.dump(BOXES, open(os.path.join(out, "boxes.json"), "w"))
