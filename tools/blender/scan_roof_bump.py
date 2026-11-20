# 找座舱顶 (y -0.6..1.2) 上高于屋顶面(≈2.0)的凸起簇
import bpy, os
GLB = os.path.abspath('assets/heli.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
nody = bpy.data.objects['Nody']
M = nody.matrix_world
pts = [M @ v.co for v in nody.data.vertices]
sel = [p for p in pts if -0.6 <= p.y <= 1.2 and p.z > 1.6]
print('== verts in roof window:', len(sel))
# 0.1m 网格聚类
import collections
cell = collections.defaultdict(list)
for p in sel:
    cell[(round(p.y*10)/10, round(p.x*10)/10)].append(p.z)
for k in sorted(cell):
    zs = cell[k]
    print('  y %.1f x %.1f | z %.2f..%.2f n=%d' % (k[0], k[1], min(zs), max(zs), len(zs)))
