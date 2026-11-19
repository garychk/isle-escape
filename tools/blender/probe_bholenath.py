# -*- coding: utf-8 -*-
# bholenath.fbx 探测：网格数 / 三角面 / 包围盒 / 材质 / 贴图
# 用法: blender -b --python tools/blender/probe_bholenath.py
import bpy, os

SRC = r"D:/Downloads/bholenath.fbx"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print("== objects:", [(o.name, o.type) for o in bpy.data.objects][:20])
tris = 0
for o in meshes:
    me = o.data
    me.calc_loop_triangles()
    tris += len(me.loop_triangles)
print("== meshes:", len(meshes), "tris:", tris)
print("== materials:", [m.name for m in bpy.data.materials])
print("== images:", [(im.name, tuple(im.size), im.filepath) for im in bpy.data.images])

# 世界包围盒
import mathutils
mn = mathutils.Vector((1e9, 1e9, 1e9))
mx = mathutils.Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        for i in range(3):
            mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
print("== bbox min", [round(v, 2) for v in mn], "max", [round(v, 2) for v in mx])
print("== size", [round(mx[i] - mn[i], 2) for i in range(3)])
