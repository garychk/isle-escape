# 找机身顶部的白色小方盒：先看材质名，再用细箱扫描顶面凸起
import bpy, os
GLB = os.path.abspath('assets/heli.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
nody = bpy.data.objects['Nody']
M = nody.matrix_world
print('== materials:')
for ms in nody.material_slots:
    m = ms.material
    print('  ', m.name, '| base_color', [round(c, 2) for c in list(m.diffuse_color)[:3]] if hasattr(m, 'diffuse_color') else '?')
# 按材质分面统计世界包围盒
from collections import defaultdict
per = defaultdict(lambda: [1e9, 1e9, 1e9, -1e9, -1e9, -1e9, 0])
for p in nody.data.polygons:
    mat = nody.data.materials[p.material_index].name if nody.data.materials else '?'
    d = per[mat]
    for v in p.vertices:
        w = M @ nody.data.vertices[v].co
        for i, c in enumerate((w.x, w.y, w.z)):
            d[i] = min(d[i], c); d[i+3] = max(d[i+3], c)
        d[6] += 1
print('== per-material bbox (x y z min/max, faces):')
for k, d in per.items():
    print('  ', k, [round(v, 2) for v in d[:6]], 'faces', d[6])
