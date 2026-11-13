# -*- coding: utf-8 -*-
"""棚屋几何探查：门洞 / 地板 / 门廊 / 楼梯坡线（供游戏内碰撞布置）"""
import bpy, os
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(ROOT, "assets_src", "cabin", "cabin.fbx")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
for o in list(bpy.data.objects):
    if o.type != "MESH":
        bpy.data.objects.remove(o, do_unlink=True)

dg = bpy.context.evaluated_depsgraph_get()
sc = bpy.context.scene


def cast(origin, direction, dist=30):
    hit, loc, nrm, idx, obj, mat = sc.ray_cast(dg, Vector(origin), Vector(direction).normalized(), distance=dist)
    if hit:
        return obj.name, tuple(round(v, 2) for v in loc)
    return None, None


# ---- 门洞扫描：从 +X 外侧向 -X 打水平射线（z=1.2m 高） ----
print("=== door sweep (x=9 -> -X at z=1.2) ===")
runs = []
cur = None
y = -3.6
while y <= 3.3:
    obj, loc = cast((9, y, 1.2), (-1, 0, 0))
    opened = obj is None or (loc and loc[0] < 5)  # 打穿了第一堵墙 => 洞口
    if opened and cur is None:
        cur = y
    elif not opened and cur is not None:
        runs.append((cur, y))
        cur = None
    y += 0.08
if cur is not None:
    runs.append((cur, y))
print("openings(y0,y1):", [(round(a, 2), round(b, 2)) for a, b in runs])

# 同法扫 z=4.2（二层门洞）
print("=== upper door sweep (z=4.4) ===")
runs2 = []
cur = None
y = -3.6
while y <= 3.3:
    obj, loc = cast((9, y, 4.4), (-1, 0, 0))
    opened = obj is None or (loc and loc[0] < 5)
    if opened and cur is None:
        cur = y
    elif not opened and cur is not None:
        runs2.append((cur, y))
        cur = None
    y += 0.08
print("openings:", [(round(a, 2), round(b, 2)) for a, b in runs2])

# ---- 屋内地板高度 ----
print("=== floor heights (ray down) ===")
for px, py in [(0, 0), (3, 0), (-3, 0), (5.5, 0), (0, 2), (0, -2)]:
    obj, loc = cast((px, py, 5.0), (0, 0, -1))
    print(f"inside({px},{py}) -> {obj} z={loc[2] if loc else None}")

# ---- 屋顶/上部高度 ----
obj, loc = cast((0, 0, 30), (0, 0, -1))
print("top at center:", obj, loc)

# ---- 高度场网格：x -12..9, y -7.5..4.5，记录最高命中 ----
print("=== height map (rows=y from -7.0 to 4.0 step 0.5; cols=x -12..9 step 1; value=top z or '.') ===")
xs = [i for i in range(-12, 10)]
for y in [ -7.0 + 0.5 * i for i in range(23)]:
    row = []
    for x in xs:
        obj, loc = cast((x, y, 13), (0, 0, -1))
        row.append(f"{loc[2]:4.1f}" if loc else "   .")
    print(f"y={y:5.1f} " + " ".join(row))
