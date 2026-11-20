# -*- coding: utf-8 -*-
# 全 mesh 扫描旋翼（Rot）的圆环结构：找白色转轴环的真实轴心（不依赖节点原点）
import bpy, os, math
import numpy as np
from mathutils import Vector
GLB = os.path.abspath('assets/heli.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

rot = bpy.data.objects['Rot']; M = rot.matrix_world
print('node origin', [round(v, 4) for v in M.to_translation()])
ws = [M @ v.co for v in rot.data.vertices]
print('verts', len(ws), 'z range', round(min(p.z for p in ws), 2), round(max(p.z for p in ws), 2))

def kasa(pts):
    n = len(pts)
    sx = sum(p.x for p in pts); sy = sum(p.y for p in pts)
    sxx = sum(p.x * p.x for p in pts); syy = sum(p.y * p.y for p in pts)
    sxy = sum(p.x * p.y for p in pts)
    sxz = sum(p.x * (p.x * p.x + p.y * p.y) for p in pts)
    syz = sum(p.y * (p.x * p.x + p.y * p.y) for p in pts)
    sz = sum(p.x * p.x + p.y * p.y for p in pts)
    A = np.array([[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], float)
    b = np.array([sxz, syz, sz], float)
    a, bb, c = np.linalg.solve(A, b)
    cx, cy = a / 2, bb / 2
    R = math.sqrt(max(c + a * a / 4 + bb * bb / 4, 1e-12))
    res = max(math.hypot(p.x - cx, p.y - cy) - R for p in pts)
    angs = sorted(math.atan2(p.y - cy, p.x - cx) % (2 * math.pi) for p in pts)
    gap = max(angs[i + 1] - angs[i] for i in range(len(angs) - 1))
    gap = max(gap, angs[0] + 2 * math.pi - angs[-1])
    return cx, cy, R, res, gap

# z 聚类（0.04 容差）
bands = []
for w in sorted(ws, key=lambda p: p.z):
    for bd in bands:
        if abs(bd['z'] - w.z) < 0.04:
            bd['pts'].append(w); bd['z'] = sum(p.z for p in bd['pts']) / len(bd['pts'])
            break
    else:
        bands.append({'z': w.z, 'pts': [w]})

print('--- rings (n>=10, R 0.02..0.25, max residual <0.03, angular gap <60deg) ---')
for bd in bands:
    pts = bd['pts']
    if len(pts) < 10: continue
    try:
        cx, cy, R, res, gap = kasa(pts)
    except Exception as e:
        print('z=%.2f n=%d fit fail %s' % (bd['z'], len(pts), e)); continue
    tag = ''
    if 0.02 < R < 0.25 and res < 0.03 and gap < math.radians(60):
        tag = '  <== RING'
    print('z=%.2f n=%3d center=(%.4f,%.4f) R=%.4f maxres=%.4f gap=%.0fdeg%s'
          % (bd['z'], len(pts), cx, cy, R, res, math.degrees(gap), tag))
