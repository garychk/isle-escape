# -*- coding: utf-8 -*-
# 深挖 bird.fbx：5 只鸟是否同网格 / 材质颜色 / 骨骼动画幅度 / 单鸟朝向。
import bpy, hashlib
from mathutils import Vector

SRC = r"D:/Downloads/bird.fbx"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print("=== MESH HASH (local coords) ===")
for o in meshes:
    data = b"".join(("%.5f,%.5f,%.5f;" % tuple(v.co)).encode() for v in o.data.vertices)
    print(o.name, hashlib.md5(data).hexdigest(), "scale", tuple(round(v, 3) for v in o.scale))

print("=== MATERIAL COLORS ===")
for m in bpy.data.materials:
    print("mat", m.name)
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                print("  base", tuple(round(v, 3) for v in n.inputs['Base Color'].default_value))

print("=== VERTEX GROUP WEIGHTS (Bird_01) ===")
o = bpy.data.objects['Bird_01']
for v in o.data.vertices:
    if v.groups:
        print("  v%d co=%s groups=%s" % (v.index, tuple(round(x, 3) for x in v.co),
              [(o.vertex_groups[g.group].name, round(g.weight, 2)) for g in v.groups]))

print("=== SINGLE BIRD LOCAL BBOX / YELLOW PART ===")
o = bpy.data.objects['Bird_01']
pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
print("Bird_01 world bbox x[%.2f,%.2f] y[%.2f,%.2f] z[%.2f,%.2f]" % (
    min(p.x for p in pts), max(p.x for p in pts),
    min(p.y for p in pts), max(p.y for p in pts),
    min(p.z for p in pts), max(p.z for p in pts)))
yellow = [p for p in o.data.polygons if o.data.materials[p.material_index].name == 'Yellow']
if yellow:
    vs = [o.data.vertices[i].co for p in yellow for i in p.vertices]
    c = sum(vs, Vector()) / len(vs)
    print("yellow center local", tuple(round(x, 3) for x in c), "nfaces", len(yellow))

print("=== ANIMATION: bone motion range ===")
act = bpy.data.actions[0]
slots = act.slots
arm = bpy.data.objects['Armature_Birds']
# 用 scene frame_set 采样各骨骼矩阵，量出位移幅度
samples = {}
for f in [2, 7, 12, 17, 22, 27, 32, 37, 42]:
    bpy.context.scene.frame_set(f)
    for b in arm.pose.bones:
        m = b.matrix.translation.copy()
        samples.setdefault(b.name, []).append((f, tuple(round(v, 2) for v in m),
                                               tuple(round(v, 3) for v in b.rotation_quaternion)))
for name, seq in samples.items():
    ts = [s[1] for s in seq]
    span = max(max(t[i] for t in ts) - min(t[i] for t in ts) for i in range(3))
    if span > 0.01:
        print(name, "translation span", round(span, 3), "samples", seq[:5])
