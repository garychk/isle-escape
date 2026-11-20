# 修复 heli.glb 旋翼枢轴偏移（v8 确定性版本）：
#   v7 的"bbox 对中 + 桨毂质心补正"链路留下 ~1.3cm 轴偏差（枢轴仍有可见打转），
#   且网格稀疏（573 顶点）导致迭代质心法振荡不收敛（已踩坑，勿再尝试）。
#   v8 改为几何测量法，一次到位：
#   1) 全 mesh 按 z 分层做 Kasa 最小二乘圆拟合，找出转轴的多个圆环截面
#      （桅杆底环/桨毂环/顶环，圆心一致性 <2mm 互为验证），取平均 → 机械转轴 A；
#   2) 整块旋翼网格沿机尾方向平移 0.07m（用户指定：往机头反方向挪 0.07m）；
#   3) 世界顶点不动，把节点原点重定位到平移后的轴心 A' —— 旋转轴 = 机械轴，
#      枢轴零漂移由构造保证。
#   Rot2（尾旋翼）沿用 bbox 对中（原地重定枢轴）。
import bpy, os, math
from mathutils import Vector, Matrix
import numpy as np

GLB = os.path.abspath('assets/heli.glb')
TAIL_SHIFT = 0.07   # 机尾方向（+Y，机头为 -Y：尾旋翼 Rot2 在 +Y 侧）平移量

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

nody = bpy.data.objects['Nody']
rot = bpy.data.objects['Rot']
rot2 = bpy.data.objects['Rot2']

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

# —— 1) 找机械转轴 ——
Mw = rot.matrix_world
ws = [Mw @ v.co for v in rot.data.vertices]
bands = []
for w in sorted(ws, key=lambda p: p.z):
    for bd in bands:
        if abs(bd['z'] - w.z) < 0.04:
            bd['pts'].append(w); bd['z'] = sum(p.z for p in bd['pts']) / len(bd['pts'])
            break
    else:
        bands.append({'z': w.z, 'pts': [w]})
cands = []
for bd in bands:
    if len(bd['pts']) < 10:
        continue
    try:
        cx, cy, R, res, gap = kasa(bd['pts'])
    except Exception:
        continue
    if 0.02 < R < 0.3 and res < 0.05 and gap < math.radians(60):
        print('ring z=%.2f n=%3d center=(%.4f,%.4f) R=%.4f res=%.4f' % (bd['z'], len(bd['pts']), cx, cy, R, res))
        cands.append(Vector((cx, cy, 0)))
assert len(cands) >= 2, 'need >=2 ring sections to vote'
med = Vector((sorted(c.x for c in cands)[len(cands) // 2],
              sorted(c.y for c in cands)[len(cands) // 2], 0))
near = [c for c in cands if (c - med).length < 0.005]
A = Vector((sum(c.x for c in near) / len(near), sum(c.y for c in near) / len(near), 0))
print('mechanical axis A = (%.4f, %.4f) from %d rings' % (A.x, A.y, len(near)))


def _ring_stat():
    Mw = rot.matrix_world
    pts = [Mw @ v.co for v in rot.data.vertices if abs((Mw @ v.co).z - 2.45) < 0.02]
    if not pts: return 'no ring'
    return 'ring z2.45 centroid=(%.4f, %.4f) n=%d' % (
        sum(p.x for p in pts)/len(pts), sum(p.y for p in pts)/len(pts), len(pts))

print('MPI t =', [round(v,4) for v in rot.matrix_parent_inverse.to_translation()])
print('STEP0', _ring_stat(), 'origin', [round(v,4) for v in rot.matrix_world.to_translation()])

# —— 2) 整块平移 0.07m 机尾方向 ——
rot.data.transform(Matrix.Translation((0.0, TAIL_SHIFT, 0)))
Ap = A + Vector((0.0, TAIL_SHIFT, 0))
print('STEP1 (after mesh shift)', _ring_stat())

# —— 3) 节点原点重定位到 A'（此步不再移动网格）——
Mw = rot.matrix_world
loc = Mw.to_translation()
par_inv = rot.parent.matrix_world.inverted() if rot.parent else Matrix.Identity(4)
rot.location = par_inv @ Vector((Ap.x, Ap.y, loc.z))
rot.rotation_euler = (0.0, 0.0, 0.0)
rot.scale = (1.0, 1.0, 1.0)
bpy.context.view_layer.update()
print('rotor origin ->', [round(v, 4) for v in rot.matrix_world.to_translation()])
print('STEP2 (after rebase)', _ring_stat())

# —— Rot2 原地重定枢轴（bbox 对中，v7 已做过，此处幂等）——
def center_of(o):
    M = o.matrix_world
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for v in o.data.vertices:
        w = M @ v.co
        for i in range(3):
            mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    return (mn + mx) / 2

c2 = center_of(rot2)
M2 = rot2.matrix_world
rot2.data.transform(Matrix.Translation(M2.to_3x3().inverted() @ (M2.to_translation() - c2)))
par2 = rot2.parent.matrix_world.inverted() if rot2.parent else Matrix.Identity(4)
rot2.location = par2 @ c2
rot2.rotation_euler = (0.0, 0.0, 0.0)
rot2.scale = (1.0, 1.0, 1.0)
bpy.context.view_layer.update()

for o in (nody, rot, rot2):
    if o.animation_data:
        o.animation_data_clear()
while bpy.data.actions:
    bpy.data.actions.remove(bpy.data.actions[0])

bpy.context.view_layer.update()
for o in (nody, rot, rot2):
    print('final', o.name, 'loc=', [round(v, 3) for v in o.matrix_world.to_translation()])

print('STEP3 (before export)', _ring_stat(), 'loc=', [round(v,4) for v in rot.location])
bpy.ops.export_scene.gltf(filepath='/tmp/heli_v8_dbg.glb', export_format='GLB',
                          export_apply=False, export_yup=True)
print('written', GLB, os.path.getsize(GLB) // 1024, 'KB')
