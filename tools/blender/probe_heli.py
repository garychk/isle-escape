# -*- coding: utf-8 -*-
# Helicopter.fbx 探测：网格数 / 三角面 / 包围盒 / 材质 / 贴图 / 转子节点
# 用法: blender -b --python tools/blender/probe_heli.py
import bpy, os, mathutils

SRC = r"D:/Downloads/直升机2/source/Helicopter.fbx"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

print("== objects:")
for o in bpy.data.objects:
    rot = [round(a, 2) for a in o.rotation_euler] if o.rotation_mode == 'XYZ' else o.rotation_mode
    print("   ", o.name, o.type, "parent=", o.parent.name if o.parent else None,
          "loc=", [round(v, 2) for v in o.location], "rot=", rot, "scale=", [round(v, 3) for v in o.scale])

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
tris = 0
for o in meshes:
    me = o.data
    me.calc_loop_triangles()
    tris += len(me.loop_triangles)
print("== meshes:", len(meshes), "tris:", tris)
print("== materials:", [m.name for m in bpy.data.materials])
print("== images:")
for im in bpy.data.images:
    print("   ", im.name, tuple(im.size), im.filepath, "packed=", im.packed_file is not None)

mn = mathutils.Vector((1e9, 1e9, 1e9)); mx = mathutils.Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        for i in range(3):
            mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
print("== bbox min", [round(v, 2) for v in mn], "max", [round(v, 2) for v in mx])
print("== size", [round(mx[i] - mn[i], 2) for i in range(3)])
