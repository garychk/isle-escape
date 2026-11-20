# -*- coding: utf-8 -*-
# bird.fbx → bird.glb
# 源模型含 5 只同款小鸟（黑身黄喙，各 162 面）+ 55 骨骼 + 40 帧拍翅动画。
# 取其中一只，把「翅膀平展」帧的蒙皮结果烘焙成静态网格（丢掉骨骼），
# 黑/黄材质写成顶点色，翼展归一到 0.85m（与原程序化鸟相当），头朝 glTF +Z。
# JS 侧沿用 wildlifeMaterial 的 aWing 顶点拍翅，保持 InstancedMesh 单 drawcall。
# 用法: blender -b --python tools/blender/convert_bird.py
import bpy, os, math
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = r"D:/Downloads/bird.fbx"
OUT_GLB = os.path.join(ROOT, "assets", "bird.glb")
PREVIEW_DIR = os.path.join(ROOT, "tools", "blender")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

KEEP = 'Bird_01'
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name != KEEP:
        bpy.data.objects.remove(o, do_unlink=True)
arm = bpy.data.objects.get('Armature_Birds')
obj = bpy.data.objects[KEEP]
print("kept", KEEP, "verts", len(obj.data.vertices), "faces", len(obj.data.polygons))

# ---- 1) 选翅膀最水平的帧：量翼尖顶点（局部 x 离中轴最远）的 z 绝对值 ----
def wingtip_z(frame):
    bpy.context.scene.frame_set(frame)
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    pts = [ev.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    xs = [p.x for p in pts]
    cx = (min(xs) + max(xs)) / 2
    tips = [p for p in pts if abs(p.x - cx) > 0.85 * max(abs(min(xs) - cx), abs(max(xs) - cx))]
    return sum(abs(p.z) for p in tips) / max(1, len(tips)), (max(xs) - min(xs))

rank = []
for f in range(2, 43, 2):
    z_avg, span = wingtip_z(f)
    rank.append((z_avg, f, span))
    print("frame", f, "wingtip |z| avg", round(z_avg, 4), "span", round(span, 4))
best = min(rank)
FRAME = best[1]
print("=> bake frame", FRAME, "wingtip |z|", round(best[0], 4))
bpy.context.scene.frame_set(FRAME)

# ---- 2) 应用骨骼蒙皮（烘焙当前姿态），再删骨架 ----
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
for mod in list(obj.modifiers):
    if mod.type == 'ARMATURE':
        bpy.ops.object.modifier_apply(modifier=mod.name)
        print("applied", mod.name)
if arm:
    bpy.data.objects.remove(arm, do_unlink=True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---- 3) 顶点色：Black→近黑，Yellow→喙黄（sRGB→linear，glTF 顶点色是线性） ----
def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

PALETTE = {'Black': (0.045, 0.05, 0.04), 'Yellow': (0.88, 0.80, 0.12)}
mesh = obj.data
col_attr = mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
for poly in mesh.polygons:
    mat_name = mesh.materials[poly.material_index].name if poly.material_index < len(mesh.materials) else 'Black'
    rgb = PALETTE.get(mat_name, PALETTE['Black'])
    linear = tuple(srgb_to_linear(c) for c in rgb) + (1.0,)
    for li in poly.loop_indices:
        col_attr.data[li].color = linear

# 清掉原材质，挂一个顶点色材质（glTF 导出器要求节点树里显式引用 Color Attribute，
# 否则 COLOR_0 会被丢弃——踩过一次坑：警告 "active Vertex Color will not be exported"）
mesh.materials.clear()
mat = bpy.data.materials.new('BirdVC')
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()
out_node = nt.nodes.new('ShaderNodeOutputMaterial')
bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
nt.links.new(bsdf.outputs['BSDF'], out_node.inputs['Surface'])
try:
    vcol = nt.nodes.new('ShaderNodeVertexColor')
    vcol.layer_name = 'Col'
except Exception:
    vcol = nt.nodes.new('ShaderNodeAttribute')
    vcol.attribute_name = 'Col'
nt.links.new(vcol.outputs['Color'], bsdf.inputs['Base Color'])
mesh.materials.append(mat)

# ---- 4) 归一化：翼展 0.85m，包围盒中心归零，头朝 glTF +Z ----
# Blender (x,y,z) → glTF (x,z,-y)：源模型头朝 -Y，导出后正好 +Z。
obj.data.update()
pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
span_x = max(xs) - min(xs)
scale = 0.85 / span_x
print("bbox before x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f] scale=%.3f" % (
    min(xs), max(xs), min(ys), max(ys), min(zs), max(zs), scale))
obj.scale *= scale
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
cz = (min(p.z for p in pts) + max(p.z for p in pts)) / 2
obj.location -= Vector((cx, cy, cz))
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
print("bbox after  x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f] tris=%d" % (
    min(p.x for p in pts), max(p.x for p in pts),
    min(p.y for p in pts), max(p.y for p in pts),
    min(p.z for p in pts), max(p.z for p in pts),
    sum(len(p.vertices) - 2 for p in obj.data.polygons)))

# 朝向修正：Blender 导出 glTF 的映射是 (x,y,z)_blender → (x,z,-y)_gltf，
# 源 FBX 的鸟头在 Blender -Y → 导出后落在 glTF -Z，而游戏约定鸟头朝 +Z
# （yaw=-ang 的切线方向按 +Z 前进）。绕 Blender Z 轴（= glTF Y 轴）转 180° 归正，
# 否则所有鸟倒着飞。翅膀左右对称，转 180° 无副作用。
obj.rotation_euler.z += math.pi
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
print("yaw +180 to face glTF +Z")

# ---- 5) 导出 GLB ----
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
color_kw = {}
if 'export_vertex_color' in props:
    color_kw['export_vertex_color'] = 'MATERIAL'
elif 'export_colors' in props:
    color_kw['export_colors'] = True
print("color kw", color_kw)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB, export_format='GLB', export_apply=True,
    export_normals=True, export_texcoords=True, export_materials='EXPORT',
    export_yup=True, **color_kw)
print("written", OUT_GLB, round(os.path.getsize(OUT_GLB) / 1024, 1), "KB")

# ---- 6) 预览（顶视 + 侧视，workbench 顶点色） ----
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'VERTEX'
sc.render.resolution_x = 700
sc.render.resolution_y = 700
sc.render.film_transparent = False
world = bpy.data.worlds.new('W')
sc.world = world
world.color = (0.55, 0.62, 0.72)

bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
c = sum(bb, Vector()) / len(bb)
R = max(max(p.x for p in bb) - min(p.x for p in bb),
        max(p.y for p in bb) - min(p.y for p in bb),
        max(p.z for p in bb) - min(p.z for p in bb)) * 1.4
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
for name, d in [('bird_prev_top', (0, 0, 1)), ('bird_prev_iso', (1, -0.9, 0.45)), ('bird_prev_side', (1, 0, 0.12))]:
    v = Vector(d).normalized()
    cam.location = c + v * R * 2.2
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(PREVIEW_DIR, name + '.png')
    bpy.ops.render.render(write_still=True)
    print("preview", name)
