# -*- coding: utf-8 -*-
# 探查 D:/Downloads/bird.fbx 的结构：网格 / 骨骼 / 动画 / 贴图 / 包围盒 / 单位。
# 用法: blender -b --python tools/blender/probe_bird.py
import bpy
from mathutils import Vector

SRC = r"D:/Downloads/bird.fbx"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

print("=== OBJECTS ===")
for o in bpy.data.objects:
    info = "name=%s type=%s loc=%s rot=%s scale=%s" % (
        o.name, o.type,
        tuple(round(v, 3) for v in o.location),
        tuple(round(v, 3) for v in o.rotation_euler),
        tuple(round(v, 3) for v in o.scale))
    if o.type == 'MESH':
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        info += " verts=%d faces=%d tris=%d mats=%s uv=%s" % (
            len(o.data.vertices), len(o.data.polygons), tris,
            [m.name if m else None for m in o.data.materials],
            list(o.data.uv_layers.keys()))
        vg = [g.name for g in o.vertex_groups]
        info += " vgroups=%d %s" % (len(vg), vg[:24])
    if o.type == 'ARMATURE':
        info += " bones=%d %s" % (len(o.data.bones), [b.name for b in o.data.bones][:40])
    print(info)

print("=== ACTIONS ===")
for a in bpy.data.actions:
    print("action", a.name, "frame_range", tuple(a.frame_range))
    try:
        print("  fcurves", len(a.fcurves), "paths", list(set(f.data_path for f in a.fcurves))[:24])
    except Exception as e:
        print("  fcurves legacy err", e)
    try:
        print("  slots", [(s.identifier, s.target_id_type) for s in a.slots], "layers", len(a.layers))
    except Exception as e:
        print("  slots err", e)

print("=== MATERIALS ===")
for m in bpy.data.materials:
    print("mat", m.name, "nodes", m.use_nodes)
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE':
                im = n.image
                print("  tex", n.name, im.name if im else None,
                      im.filepath if im else None,
                      tuple(im.size) if im else None,
                      "packed", bool(im.packed_file) if im else None)

print("=== IMAGES ===")
for im in bpy.data.images:
    print("image", im.name, tuple(im.size), im.filepath, "packed", bool(im.packed_file))

print("=== BBOX (world) ===")
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if meshes:
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    print("x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]" % (
        min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))
    print("size xyz = %.3f %.3f %.3f" % (
        max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)))

print("=== SCENE ===")
print("unit scale", bpy.context.scene.unit_settings.scale_length,
      "fps", bpy.context.scene.render.fps,
      "frame_start", bpy.context.scene.frame_start,
      "frame_end", bpy.context.scene.frame_end)
