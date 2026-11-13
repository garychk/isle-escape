# -*- coding: utf-8 -*-
"""军用快艇 FBX → 游戏用 boat.glb
用法：blender --background --python tools/blender/build_boat.py [--preview]

处理内容：
  * 533 个小网格按材质合并 → 单对象（材质保留为槽位）
  * 清理空物体/灯光（先烘焙世界变换再删父级）
  * 归一：船头朝 Blender +Y（glTF 导出后 = 游戏 -Z 前向），原点=船中水线
  * Decimate 减面；预览渲染（--preview）
"""
import bpy, os, math, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(ROOT, "assets_src", "mixamo", "swift_boat.fbx")
OUT = os.path.join(ROOT, "assets", "boat.glb")
PREVIEW = "--preview" in sys.argv

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

# ---- 清理：灯光 / 相机 / 空物体（先烘焙世界变换再删父级，防止子网格跳位） ----
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.parent:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
bpy.context.view_layer.update()
for o in list(bpy.data.objects):
    if o.type in {"LIGHT", "CAMERA", "EMPTY"}:
        bpy.data.objects.remove(o, do_unlink=True)

# ---- 包围盒（合并前） ----
pts = []
for o in bpy.data.objects:
    if o.type == "MESH":
        pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
print(f"1ST: x[{min(xs):.2f},{max(xs):.2f}] y[{min(ys):.2f},{max(ys):.2f}] z[{min(zs):.2f},{max(zs):.2f}] "
      f"dx={max(xs)-min(xs):.1f} dy={max(ys)-min(ys):.1f} dz={max(zs)-min(zs):.1f}")

# ---- 全部合并成单对象（材质保留为槽位） ----
bpy.ops.object.select_all(action="DESELECT")
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
boat = bpy.context.view_layer.objects.active
boat.name = "boat"
print(f"merged -> 1 object, {len(boat.data.materials)} material slots")

# ---- 材质微调：船体金属感 / 玻璃透明 ----
for m in boat.data.materials:
    if not m or not m.use_nodes:
        continue
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        continue
    name = m.name.lower()
    if "glasses" in name:
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = 0.12
        bsdf.inputs["Alpha"].default_value = 0.45
        m.blend_method = "BLEND"
    elif "gun" in name or "pipes" in name:
        bsdf.inputs["Metallic"].default_value = 0.75
        bsdf.inputs["Roughness"].default_value = 0.45
    else:
        bsdf.inputs["Metallic"].default_value = 0.15
        bsdf.inputs["Roughness"].default_value = 0.72

# ---- 烘焙对象自身变换（保证后续 matrix 操作都作用在干净的 mesh 数据上） ----
bpy.ops.object.select_all(action="DESELECT")
boat.select_set(True)
bpy.context.view_layer.objects.active = boat
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def wbb(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    return min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)

x0, x1, y0, y1, z0, z1 = wbb(boat)
print(f"2ND (baked): x[{x0:.2f},{x1:.2f}] y[{y0:.2f},{y1:.2f}] z[{z0:.2f},{z1:.2f}]")

# ---- 归一（在 mesh 数据层面平移/旋转，用 transform_apply 落实） ----
# FBX: X=船长（船头在 -X 端，预览确认）、Y=船宽、Z=高度
# 目标：船头朝 Blender +Y（glTF 导出后 = 游戏 -Z 前向）→ 绕 Z 轴 270°
boat.rotation_euler = (0, 0, math.radians(270))
bpy.ops.object.transform_apply(rotation=True)

x0, x1, y0, y1, z0, z1 = wbb(boat)
print(f"3RD (rotated): x[{x0:.2f},{x1:.2f}] y[{y0:.2f},{y1:.2f}] z[{z0:.2f},{z1:.2f}] tris={sum(len(p.vertices)-2 for p in boat.data.polygons)}")

# 旋转后：X=船宽、Y=船长（船头 +Y）、Z=高度。原点=船中水线
boat.location = (-(x0 + x1) / 2, -(y0 + y1) / 2, -z0)
bpy.ops.object.transform_apply(location=True)

x0, x1, y0, y1, z0, z1 = wbb(boat)
print(f"4TH (normalized): x[{x0:.2f},{x1:.2f}] y[{y0:.2f},{y1:.2f}] z[{z0:.2f},{z1:.2f}]")

# ---- 减面：Decimate ----
mod = boat.modifiers.new("dec", "DECIMATE")
mod.ratio = 0.22
bpy.context.view_layer.objects.active = boat
bpy.ops.object.modifier_apply(modifier="dec")
print(f"decimated tris: {sum(len(p.vertices) - 2 for p in boat.data.polygons)}")

# ---- 预览渲染 ----
if PREVIEW:
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = 900
    sc.render.resolution_y = 600
    sc.world = bpy.data.worlds.new("w")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.42, 0.55, 0.62, 1)
    bg.inputs[1].default_value = 1.2
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.5
    so = bpy.data.objects.new("sun", sun)
    bpy.context.collection.objects.link(so)
    so.rotation_euler = (math.radians(55), 0, math.radians(35))
    cx = (x0 + x1) / 2
    cz = (y0 + y1) / 2
    ztop = z1
    span = max(x1 - x0, y1 - y0)
    for i, (az, el) in enumerate([(90, 14), (30, 30), (270, 12), (90, 88)]):
        a = math.radians(az); e = math.radians(el)
        r = span * 1.15
        cam = bpy.data.cameras.new("c"); co = bpy.data.objects.new("c", cam)
        bpy.context.collection.objects.link(co)
        co.location = (cx + r * math.cos(e) * math.sin(a), cz - r * math.cos(e) * math.cos(a),
                       ztop * 0.4 + r * math.sin(e))
        d = Vector((cx, cz, ztop * 0.3)) - Vector(co.location)
        co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        cam.lens = 40
        sc.camera = co
        sc.render.filepath = os.path.join(HERE, f"preview_boat_{i}.png")
        bpy.ops.render.render(write_still=True)
    print("preview saved")

# ---- 导出 GLB ----
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB",
                          export_image_format="JPEG", export_yup=True)
print("exported", OUT, os.path.getsize(OUT) // 1024, "KB")
