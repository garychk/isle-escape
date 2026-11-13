# -*- coding: utf-8 -*-
"""探查棚屋 FBX：对象/材质/贴图路径/尺寸/朝向"""
import bpy, os, sys

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                   "assets_src", "cabin", "cabin.fbx")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

print("=== objects ===")
for o in bpy.data.objects:
    print(o.name, o.type, "dim=", [round(v, 2) for v in o.dimensions],
          "loc=", [round(v, 2) for v in o.location],
          "rot=", [round(v, 3) for v in o.rotation_euler] if o.type == 'MESH' else '')

print("=== materials ===")
for m in bpy.data.materials:
    imgs = []
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                imgs.append((n.image.name, n.image.filepath, tuple(n.image.size)))
    print(m.name, "images=", imgs)

print("=== images ===")
for im in bpy.data.images:
    if im.source == 'FILE':
        print(im.name, im.filepath, im.source, im.packed_file is not None)
print("=== done ===")
