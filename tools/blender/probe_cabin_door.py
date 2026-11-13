# -*- coding: utf-8 -*-
import bpy, os
from mathutils import Vector
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.path.join(ROOT, "assets_src", "cabin", "cabin.fbx"))
for o in list(bpy.data.objects):
    if o.type != "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
dg = bpy.context.evaluated_depsgraph_get(); sc = bpy.context.scene
def cast(origin, direction, dist=30):
    hit, loc, nrm, idx, obj, mat = sc.ray_cast(dg, Vector(origin), Vector(direction).normalized(), distance=dist)
    return loc, obj.name if (hit and obj) else None
# 前墙门洞：y=-7 -> +Y 在 z=1.2 / z=2.2 高度扫 x
for z in (0.9, 1.2, 1.8, 2.2):
    runs, cur = [], None
    x = -7.0
    while x <= 7.0:
        loc, name = cast((x, -7, z), (0, 1, 0))
        opened = loc is None or loc[1] > -2.0  # 打穿前墙
        if opened and cur is None: cur = x
        elif not opened and cur is not None: runs.append((cur, x)); cur = None
        x += 0.06
    if cur is not None: runs.append((cur, x))
    print(f"front wall z={z}: openings x:", [(round(a,2), round(b,2)) for a,b in runs])
# 门洞上沿
for x in (4.5, 5.0, 5.5, 6.0):
    loc, name = cast((x, -7, 3.4), (0, 1, 0))
    print(f"lintel x={x}: first hit y={loc[1] if loc else None}")
# 门廊平台边缘精扫
xs = [round(-6.5 + 0.25*i,2) for i in range(0)]
print("porch probes:")
for y in (-5.8, -5.0, -4.3):
    row = []
    for x in [2.0,2.5,2.8,3.0,3.5,4.0,4.5,5.0,5.5,6.0,6.5,6.8,7.0]:
        loc, name = cast((x, y, 2.5), (0,0,-1))
        row.append(f"{x}:{loc[2] if loc else '-'}")
    print(f"  y={y}:", " ".join(row))
# 楼梯中线采样（y=-5.2）
print("stair profile y=-5.2:")
for x in [i*0.5 for i in range(-16, 7)]:
    loc, name = cast((x, -5.2, 12), (0,0,-1))
    if loc: print(f"  x={x:5.1f} z={loc[2]:.2f}")
# 走道平台范围
print("walkway probes:")
for x in (-10.6, -10.0, -9.0, -8.0, -7.5, -7.2):
    loc, name = cast((x, -5.0, 12), (0,0,-1))
    print(f"  x={x}: z={loc[2] if loc else '-'}")
