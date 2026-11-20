# -*- coding: utf-8 -*-
# 检查 heli.glb 机身各材质的面积/位置，定位"机身绿漆"与"机头玻璃"，并导出贴图供查看
import bpy, os, math
from mathutils import Vector
GLB = os.path.abspath('assets/heli.glb')
OUT = os.path.abspath('tools/blender/heli_tex')
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

nody = bpy.data.objects['Nody']
M = nody.matrix_world
me = nody.data
me.calc_loop_triangles()

info = {}
for poly in me.polygons:
    mi = poly.material_index
    d = info.setdefault(mi, {'n': 0, 'area': 0.0, 'mn': Vector((1e9,)*3), 'mx': Vector((-1e9,)*3)})
    d['n'] += 1
    d['area'] += poly.area
    for vi in poly.vertices:
        w = M @ me.vertices[vi].co
        for i in range(3):
            d['mn'][i] = min(d['mn'][i], w[i]); d['mx'][i] = max(d['mx'][i], w[i])

print('%-4s %-22s %6s %8s  bbox center / size' % ('idx', 'material', 'faces', 'area'))
for mi, d in sorted(info.items(), key=lambda kv: -kv[1]['area']):
    mat = nody.material_slots[mi].material
    c = (d['mn'] + d['mx']) / 2
    s = d['mx'] - d['mn']
    print('%-4d %-22s %6d %8.2f  c=(%6.2f,%6.2f,%6.2f) size=(%5.2f,%5.2f,%5.2f)'
          % (mi, mat.name if mat else 'None', d['n'], d['area'], c.x, c.y, c.z, s.x, s.y, s.z))

# 导出该 glb 内所有图片
for im in bpy.data.images:
    if im.size[0] == 0:
        continue
    name = (im.name or 'img').replace('/', '_').replace(' ', '_')
    if not name.lower().endswith(('.png', '.jpg')):
        name += '.png'
    p = os.path.join(OUT, name)
    im.filepath_raw = p
    im.file_format = 'PNG'
    try:
        im.save()
        print('saved', p, tuple(im.size))
    except Exception as e:
        print('save fail', name, e)
