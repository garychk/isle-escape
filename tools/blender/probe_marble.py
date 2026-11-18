# -*- coding: utf-8 -*-
# 探测外部 FBX：对象/包围盒/材质/贴图/面数
import bpy, os, sys
from mathutils import Vector

path = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=path)
print("=== objects")
gmin = [1e9] * 3
gmax = [-1e9] * 3
tot_tris = 0
for o in bpy.data.objects:
    if o.type == "MESH":
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        xs = [p.x for p in bb]; ys = [p.y for p in bb]; zs = [p.z for p in bb]
        for i, v in enumerate([min(xs), min(ys), min(zs)]): gmin[i] = min(gmin[i], v)
        for i, v in enumerate([max(xs), max(ys), max(zs)]): gmax[i] = max(gmax[i], v)
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        tot_tris += tris
        mats = [m.name for m in o.data.materials if m] if o.data.materials else []
        print(f"MESH {o.name!r} x[{min(xs):.2f},{max(xs):.2f}] y[{min(ys):.2f},{max(ys):.2f}] z[{min(zs):.2f},{max(zs):.2f}] mats={mats} tris={tris}")
    else:
        print("OTHER", o.type, o.name, "scale", tuple(round(v, 4) for v in o.scale))
print(f"=== TOTAL bbox x[{gmin[0]:.2f},{gmax[0]:.2f}] y[{gmin[1]:.2f},{gmax[1]:.2f}] z[{gmin[2]:.2f},{gmax[2]:.2f}] tris={tot_tris}")
print("=== materials")
for m in bpy.data.materials:
    imgs = []
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                imgs.append(n.image.name + ":" + (n.image.filepath or "(packed)"))
    print(f"MAT {m.name!r} imgs={imgs}")
print("=== images")
for im in bpy.data.images:
    print(f"IMG {im.name!r} size={tuple(im.size)} packed={im.packed_file is not None} path={im.filepath!r}")
