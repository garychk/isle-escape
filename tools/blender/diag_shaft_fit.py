# -*- coding: utf-8 -*-
# 精细分析主旋翼的轴（shaft）几何：z 分层 + 圆拟合，找出真实旋转轴心
import bpy, os, math
from mathutils import Vector
GLB = os.path.abspath('assets/heli.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

rot = bpy.data.objects['Rot']; M = rot.matrix_world
O = M.to_translation()
CX, CY = O.x, O.y
print('node origin', round(CX, 4), round(CY, 4), round(O.z, 4))
ws = [M @ v.co for v in rot.data.vertices]

def kasa_fit(pts):
    # 最小二乘圆拟合 (Kasa)：min |a*x+b*y+c - (x^2+y^2)|
    n = len(pts)
    sx = sum(p.x for p in pts); sy = sum(p.y for p in pts)
    sxx = sum(p.x * p.x for p in pts); syy = sum(p.y * p.y for p in pts)
    sxy = sum(p.x * p.y for p in pts)
    sxz = sum(p.x * (p.x * p.x + p.y * p.y) for p in pts)
    syz = sum(p.y * (p.x * p.x + p.y * p.y) for p in pts)
    sz = sum(p.x * p.x + p.y * p.y for p in pts)
    import numpy as np
    A = np.array([[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], float)
    b = np.array([sxz, syz, sz], float)
    a, bb, c = np.linalg.solve(A, b)
    return a / 2, bb / 2, math.sqrt(c + a * a / 4 + bb * bb / 4)

import numpy as np  # noqa
zl = sorted(set(round(p.z, 2) for p in ws))
print('z levels (first 20):', zl[:20], '... total', len(zl))
# 只看轴区域 r<0.15
for z0 in [x * 0.03 for x in range(int(2.03 / 0.03), int(2.42 / 0.03) + 1)]:
    pts = [p for p in ws if z0 <= p.z < z0 + 0.03 and math.hypot(p.x - CX, p.y - CY) < 0.15]
    if len(pts) < 4: continue
    rr = [math.hypot(p.x - CX, p.y - CY) for p in pts]
    try:
        cx, cy, r = kasa_fit(pts)
        print('z %.2f n=%2d rmin=%.3f rmax=%.3f  fit center=(%.4f,%.4f) R=%.4f  centroid=(%.4f,%.4f)'
              % (z0, len(pts), min(rr), max(rr), cx, cy, r,
                 sum(p.x for p in pts) / len(pts), sum(p.y for p in pts) / len(pts)))
    except Exception as e:
        print('z %.2f n=%2d fit fail %s' % (z0, len(pts), e))
