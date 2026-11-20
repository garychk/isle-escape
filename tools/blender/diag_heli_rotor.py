# -*- coding: utf-8 -*-
# 诊断 heli.glb 主旋翼：节点原点 / 网格水平质心 / 桨毂质心 / 各材质分组中心
import bpy, os, math
from mathutils import Vector
GLB = os.path.abspath('assets/heli.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

for o in bpy.data.objects:
    print('OBJ', o.name, o.type, 'parent=', o.parent.name if o.parent else None,
          'loc=', [round(v, 4) for v in o.location],
          'rot=', [round(math.degrees(v), 2) for v in o.rotation_euler],
          'scale=', [round(v, 3) for v in o.scale])

rot = bpy.data.objects['Rot']
M = rot.matrix_world
print('Rot world origin =', [round(v, 4) for v in M.to_translation()])
print('Rot world rot deg =', [round(math.degrees(v), 3) for v in M.to_euler()])

def stats(name, pts):
    if not pts:
        print(name, 'EMPTY'); return
    n = len(pts)
    cx = sum(p[0] for p in pts) / n; cy = sum(p[1] for p in pts) / n; cz = sum(p[2] for p in pts) / n
    print(name, 'n=%d center=(%.4f, %.4f, %.4f)' % (n, cx, cy, cz))

ws = [M @ v.co for v in rot.data.vertices]
stats('all verts', ws)
stats('hub |xy - origin| < 0.45', [p for p in ws if (p.x - M.to_translation().x) ** 2 + (p.y - M.to_translation().y) ** 2 < 0.45 ** 2])
stats('hub |xy - origin| < 0.25', [p for p in ws if (p.x - M.to_translation().x) ** 2 + (p.y - M.to_translation().y) ** 2 < 0.25 ** 2])
stats('hub |xy - origin| < 0.12', [p for p in ws if (p.x - M.to_translation().x) ** 2 + (p.y - M.to_translation().y) ** 2 < 0.12 ** 2])

# 每个材质槽分组的中心（白色桨毂/轴应该是单独材质）
mats = [ms.material.name if ms.material else 'None' for ms in rot.material_slots]
print('Rot material slots:', mats)
groups = {i: [] for i in range(max(1, len(rot.data.materials)))}
for poly in rot.data.polygons:
    g = poly.material_index
    for vi in poly.vertices:
        groups.setdefault(g, []).append(M @ rot.data.vertices[vi].co)
for g, pts in sorted(groups.items()):
    nm = rot.data.materials[g].name if g < len(rot.data.materials) and rot.data.materials[g] else 'None'
    stats('mat[%d] %s' % (g, nm), pts)

# 叶片尖端：水平半径最大的一圈，看它们是否关于原点对称
if ws:
    rmax = max(math.hypot(p.x - M.to_translation().x, p.y - M.to_translation().y) for p in ws)
    tips = [p for p in ws if math.hypot(p.x - M.to_translation().x, p.y - M.to_translation().y) > rmax * 0.95]
    stats('tips r>%.2f' % (rmax * 0.95), tips)
    print('tip max radius =', round(rmax, 3))
    # 极角直方图（看两叶相位）
    angs = sorted(math.degrees(math.atan2(p.y - M.to_translation().y, p.x - M.to_translation().x)) % 180 for p in tips)
    print('tip angles (mod 180) min/max/mean =', round(angs[0], 1), round(angs[-1], 1), round(sum(angs) / len(angs), 1))
