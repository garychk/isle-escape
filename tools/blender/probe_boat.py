# -*- coding: utf-8 -*-
import bpy, os, math
from mathutils import Vector
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.path.join(ROOT, "assets_src", "mixamo", "swift_boat.fbx"))
print("=== objects")
for o in bpy.data.objects:
    if o.type == "MESH":
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        xs=[p.x for p in bb]; ys=[p.y for p in bb]; zs=[p.z for p in bb]
        mats = [m.name for m in o.data.materials if m] if o.data.materials else []
        print(f"MESH {o.name!r} x[{min(xs):.2f},{max(xs):.2f}] y[{min(ys):.2f},{max(ys):.2f}] z[{min(zs):.2f},{max(zs):.2f}] mats={mats} tris={sum(len(p.vertices)-2 for p in o.data.polygons)}")
    elif o.type == "ARMATURE":
        print("ARMATURE", o.name)
    else:
        print("OTHER", o.type, o.name)
print("=== materials")
for m in bpy.data.materials:
    imgs = [n.image.name + ":" + (n.image.filepath or "(packed)") for n in m.node_tree.nodes if n.type=="TEX_IMAGE" and n.image] if m.use_nodes else []
    print(f"MAT {m.name!r} imgs={imgs}")
print("=== images")
for im in bpy.data.images:
    print(f"IMG {im.name!r} size={tuple(im.size)} packed={im.packed_file is not None} path={im.filepath!r}")
