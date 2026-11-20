# 修复 heli.glb 旋翼枢轴偏移：
#   FBX 原始数据的旋翼网格顶点中心偏离物体枢轴（主旋翼水平偏 ~1.6m、尾旋翼偏 ~5.4m），
#   游戏里绕枢轴自转时叶片会"绕圈飞"。这里把网格中心重新对到枢轴：
#   - Rot（主旋翼）：网格中心保持水平位置不动，垂直抬到机身 bbox 顶 + 0.08，枢轴 = 网格中心
#   - Rot2（尾旋翼）：枢轴直接移到网格中心（原地不动，只是把旋转中心放对）
# 公式：要保持世界顶点 = 原顶点 + (target - 中心)，且新枢轴 = target，
#   顶点平移量 d = R⁻¹ @ (原 location - 中心)（R 为物体旋转，本模型恒为 identity）。
import bpy, os
from mathutils import Vector, Matrix

GLB = os.path.abspath('assets/heli.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

nody = bpy.data.objects['Nody']
body_top = max((nody.matrix_world @ v.co).z for v in nody.data.vertices)
print('body top Z =', round(body_top, 3))

def refit(o, target):
    M = o.matrix_world.copy()
    loc = M.to_translation()
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for v in o.data.vertices:
        w = M @ v.co
        for i in range(3):
            mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    c = (mn + mx) / 2
    d_local = M.to_3x3().inverted() @ (loc - c)
    o.data.transform(Matrix.Translation(d_local))
    # target 是世界坐标；o.location 是父级局部坐标，必须经父矩阵逆变换，否则整体偏移 HeliRoot 的 T
    par_inv = o.parent.matrix_world.inverted() if o.parent else Matrix.Identity(4)
    o.location = par_inv @ target
    o.rotation_euler = (0.0, 0.0, 0.0)
    o.scale = (1.0, 1.0, 1.0)
    print(o.name, 'center', [round(v, 3) for v in c], '-> target', [round(v, 3) for v in target],
          'd_world', [round(v, 3) for v in (loc - c)])

def center_of(o):
    M = o.matrix_world
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for v in o.data.vertices:
        w = M @ v.co
        for i in range(3):
            mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    return (mn + mx) / 2

rot = bpy.data.objects['Rot']
c_rot = center_of(rot)
# 目标水平位置 = 座舱后的白色舱罩小盒（用户红箭头指定）：细扫描锁定凸起在
# y≈1.95~2.45（顶面 1.87），不能用宽窗口——尾鳍（z 2.93）会污染质心
Y0, Y1 = 1.95, 2.45
win = [p for p in (nody.matrix_world @ v.co for v in nody.data.vertices) if Y0 <= p.y <= Y1]
win_top = max(p.z for p in win)
top_pts = [p for p in win if p.z > win_top - 0.35]
hx = sum(p.x for p in top_pts) / len(top_pts)
hy = sum(p.y for p in top_pts) / len(top_pts)
rot_min = min((rot.matrix_world @ v.co).z for v in rot.data.vertices)
rot_h = max((rot.matrix_world @ v.co).z for v in rot.data.vertices) - rot_min
# 桅杆下端埋进舱罩顶 0.18m
target_z = win_top - 0.18 + rot_h / 2
print('body top Z =', round(body_top, 3), '| cowling top =', round(win_top, 3),
      '| centroid =', round(hx, 3), round(hy, 3), '(', len(top_pts), 'verts )',
      '| rotor h =', round(rot_h, 3), '| target Z =', round(target_z, 3))
refit(rot, Vector((hx, hy, target_z)))   # 水平对准舱罩，垂直压进舱罩顶

rot2 = bpy.data.objects['Rot2']
refit(rot2, center_of(rot2))                               # 原地重定枢轴

for o in (nody, rot, rot2):
    if o.animation_data:
        o.animation_data_clear()
while bpy.data.actions:
    bpy.data.actions.remove(bpy.data.actions[0])

bpy.context.view_layer.update()
for o in (nody, rot, rot2):
    print('final', o.name, 'loc=', [round(v, 3) for v in o.matrix_world.to_translation()])

bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB',
                          export_apply=False, export_yup=True)
print('written', GLB, os.path.getsize(GLB) // 1024, 'KB')
