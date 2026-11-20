# -*- coding: utf-8 -*-
# 直升机各部件细节 + 预览（定朝向）
# 用法: blender -b --python tools/blender/probe_heli2.py
import bpy, os, math
from mathutils import Vector

SRC = r"D:/Downloads/直升机2/source/Helicopter.fbx"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

def bbox(o):
    mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3):
            mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    return mn, mx

for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    mn, mx = bbox(o)
    mats = [p.material.name if p.material else None for p in o.material_slots]
    me = o.data; me.calc_loop_triangles()
    print("OBJ", o.name, "tris", len(me.loop_triangles), "mats", mats[:6],
          "min", [round(v,2) for v in mn], "max", [round(v,2) for v in mx],
          "size", [round(mx[i]-mn[i],2) for i in range(3)])

# 预览：顶视图定机头方向（Workbench 材质快速）
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = 800
sc.render.resolution_y = 800

all_mesh = [o for o in bpy.data.objects if o.type == 'MESH']
bb = [bbox(o) for o in all_mesh]
c = Vector(( (min(b[0].x for b in bb)+max(b[1].x for b in bb))/2,
             (min(b[0].y for b in bb)+max(b[1].y for b in bb))/2,
             (min(b[0].z for b in bb)+max(b[1].z for b in bb))/2 ))
R = max(max(b[1][i] - b[0][i] for b in bb) for i in range(3)) * 1.4
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam); sc.camera = cam
for name, d in [("top", (0, 0, 1)), ("front", (0, -1, 0.12)), ("side", (1, 0, 0.12))]:
    v = Vector(d).normalized()
    cam.location = c + v * R * 2.2
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"heli_prev_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("preview", name)
