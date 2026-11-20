# -*- coding: utf-8 -*-
# EEVEE 预览：迷彩机身 + 透明玻璃
import bpy, os, math
from mathutils import Vector
GLB = os.path.abspath('assets/heli.glb')
OUT = r'E:/WorkBuddy/2026-11-12-16-39-59/isle-escape/tools/blender'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = 900; sc.render.resolution_y = 600
w = bpy.data.worlds.new('W'); sc.world = w
w.use_nodes = True
bg = w.node_tree.nodes.get('Background')
bg.inputs[0].default_value = (0.55, 0.62, 0.7, 1)   # 天空色背景，能透出玻璃
bg.inputs[1].default_value = 1.2

c = Vector((0, 0.5, 1.4))
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam); sc.camera = cam
R = 13
for name, d in [('iso', (1, -1, 0.7)), ('front', (0, -1, 0.2))]:
    v = Vector(d).normalized()
    cam.location = c + v * R
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(OUT, f'heli_camo_{name}.png')
    bpy.ops.render.render(write_still=True)
    print('rendered', name)
