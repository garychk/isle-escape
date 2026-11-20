# -*- coding: utf-8 -*-
# 材质定位渲染：0=品红(疑似主漆) 1=青(?) 3=黄(疑似玻璃) 其余保持
import bpy, os
from mathutils import Vector
GLB = os.path.abspath('assets/heli.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

colors = {0: (1, 0, 1, 1), 1: (0, 1, 1, 1), 3: (1, 1, 0, 1), 2: (1, 0, 0, 1)}
nody = bpy.data.objects['Nody']
for mi, col in colors.items():
    mat = nody.material_slots[mi].material
    for n in mat.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            mat.diffuse_color = col

sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'MATERIAL'
sc.render.resolution_x = 900; sc.render.resolution_y = 600
c = Vector((0, 0.5, 1.4))
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam); sc.camera = cam
R = 14
for name, d in [('front', (0, -1, 0.25)), ('iso', (1, -1, 0.7)), ('top', (0, 0.001, 1))]:
    v = Vector(d).normalized()
    cam.location = c + v * R
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(r"E:/WorkBuddy/2026-11-12-16-39-59/isle-escape/tools/blender", f'heli_mat_{name}.png')
    bpy.ops.render.render(write_still=True)
    print('rendered', name)
