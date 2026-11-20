# 沿机身纵轴(Y)分箱扫描顶面高度，找发动机舱罩位置
import bpy, os
from mathutils import Vector
GLB = os.path.abspath('assets/heli.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
nody = bpy.data.objects['Nody']
M = nody.matrix_world
pts = [M @ v.co for v in nody.data.vertices]
ys = [p.y for p in pts]
print('bbox y', round(min(ys),2), round(max(ys),2), '| x', round(min(p.x for p in pts),2), round(max(p.x for p in pts),2))
bins = {}
for p in pts:
    k = round(p.y * 2) / 2   # 0.5m 箱
    bins[k] = max(bins.get(k, -9), p.z)
for k in sorted(bins):
    print('y', k, 'top', round(bins[k], 2))
for name in ('Rot', 'Rot2'):
    o = bpy.data.objects.get(name)
    if not o: continue
    M2 = o.matrix_world
    ps = [M2 @ v.co for v in o.data.vertices]
    print(name, 'bbox x', round(min(p.x for p in ps),2), round(max(p.x for p in ps),2),
          '| y', round(min(p.y for p in ps),2), round(max(p.y for p in ps),2),
          '| z', round(min(p.z for p in ps),2), round(max(p.z for p in ps),2))
