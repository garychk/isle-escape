# -*- coding: utf-8 -*-
# 回读 heli.glb 排查机身丢失
import bpy, os
from mathutils import Vector
GLB = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "assets", "heli.glb")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
print("== objects:")
for o in bpy.data.objects:
    print("   ", o.name, o.type, "parent=", o.parent.name if o.parent else None,
          "loc=", [round(v,2) for v in o.location], "scale=", [round(v,3) for v in o.scale],
          "hide_render=", o.hide_render)
print("== materials:")
for m in bpy.data.materials:
    b = m.node_tree.nodes.get("Principled BSDF") if m.node_tree else None
    alpha = b.inputs["Alpha"].default_value if b else None
    blend = m.blend_method
    linked_alpha = b and b.inputs["Alpha"].links
    print("   ", m.name, "alpha=", alpha, "blend=", blend, "alpha_linked=", bool(linked_alpha))
print("== images:")
for im in bpy.data.images:
    print("   ", im.name, tuple(im.size), im.source)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
for o in meshes:
    o.data.calc_loop_triangles()
    print("   mesh", o.name, "tris", len(o.data.loop_triangles), "verts", len(o.data.vertices))
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3):
            mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
print("== bbox", [round(v,2) for v in mn], [round(v,2) for v in mx])

# —— 附加：Workbench 渲染隔离几何/材质问题 ——
import math
from mathutils import Vector as V2
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = 800; sc.render.resolution_y = 800
nody = bpy.data.objects.get('Nody')
if nody:
    lmn = nody.data.vertices[0].co.copy(); lmx = lmn.copy()
    for v in nody.data.vertices:
        for i in range(3):
            lmn[i] = min(lmn[i], v.co[i]); lmx[i] = max(lmx[i], v.co[i])
    print("== nody local bbox", [round(v,1) for v in lmn], [round(v,1) for v in lmx])
    print("== nody polys", len(nody.data.polygons), "hidden_faces?", nody.data.vertices[0])
c = V2((0, 1, 1.2)); R = 8
cam = bpy.data.objects.get('cam') or bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam); sc.camera = cam
for name, d in [("iso", (1.0, -1.0, 0.6)), ("front", (0, -1, 0.15))]:
    v = V2(d).normalized()
    cam.location = c + v * R * 2.0
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(os.path.dirname(GLB), '..', 'tools', 'blender', f"heli_chk_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("chk preview", name)
