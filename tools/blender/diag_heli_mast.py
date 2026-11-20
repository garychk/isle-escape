# -*- coding: utf-8 -*-
# 找出机身（Nody）上支撑主旋翼的桅杆圆柱轴线，并对照旋翼网格的对称轴
import bpy, os, math
from mathutils import Vector
GLB = os.path.abspath('assets/heli.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

nody = bpy.data.objects['Nody']; Mn = nody.matrix_world
rot = bpy.data.objects['Rot']; Mr = rot.matrix_world
O = Mr.to_translation()
CX, CY = O.x, O.y
print('rotor origin', round(O.x, 4), round(O.y, 4), round(O.z, 4))

# Nody 顶点按 z 分层的 xy 范围（找桅杆圆柱）
ws = [Mn @ v.co for v in nody.data.vertices]
print('nody vcount', len(ws))
zmin = min(p.z for p in ws); zmax = max(p.z for p in ws)
print('nody z range', round(zmin, 2), round(zmax, 2))

for z0 in [x * 0.05 for x in range(int(2.00 / 0.05), int(2.60 / 0.05) + 1)]:
    pts = [p for p in ws if z0 <= p.z < z0 + 0.05 and math.hypot(p.x - CX, p.y - CY) < 0.6]
    if not pts: continue
    mnx = min(p.x for p in pts); mxx = max(p.x for p in pts)
    mny = min(p.y for p in pts); mxy = max(p.y for p in pts)
    print('z %.2f..%.2f n=%2d  x[%.3f,%.3f] y[%.3f,%.3f] mid=(%.3f,%.3f)'
          % (z0, z0 + 0.05, len(pts), mnx, mxx, mny, mxy, (mnx + mxx) / 2, (mny + mxy) / 2))

# 旋翼网格顶点（局部，绕原点旋转）：统计径向对称性 —— 修正后真正绕轴旋转的偏差
print('--- rotor radial profile ---')
for r0 in [0.05, 0.1, 0.15, 0.2, 0.3, 0.45]:
    pts = [(Mr @ v.co) for v in rot.data.vertices]
    pts = [p for p in pts if math.hypot(p.x - CX, p.y - CY) < r0]
    if not pts: continue
    print(' r<%.2f n=%d centroid=(%.4f,%.4f)' % (r0, len(pts),
          sum(p.x for p in pts) / len(pts), sum(p.y for p in pts) / len(pts)))
