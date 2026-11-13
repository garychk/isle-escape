# -*- coding: utf-8 -*-
# spider.glb 构建：贴图降采样 + 材质修正 + 头朝 +Z（游戏野兽移动方向=局部 +Z）+ 原点=脚底中心
# 用法：blender --background --python build_spider.py [-- --preview]
import bpy, os, sys, math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))          # isle-escape/
SRC = os.path.join(ROOT, 'assets_src', 'mixamo', 'spider.glb')
OUT = os.path.join(ROOT, 'assets', 'spider.glb')
PREVIEW = '--preview' in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

objs = [o for o in bpy.data.objects if o.type == 'MESH']
print(f"1ST meshes={len(objs)} tris={sum(len(p.vertices)-2 for o in objs for p in o.data.polygons)}")

# ---- 贴图降采样 + 打包 ----
for im in bpy.data.images:
    if im.size[0] == 0:
        continue
    w, h = im.size
    if max(w, h) > 1024:
        im.scale(1024, 1024)
    im.pack()
    print(f"IMG {im.name!r} -> {im.size[0]}x{im.size[1]}")

# ---- 材质修正：生物应粗糙不反光 ----
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = 0.82
        # 发光贴图（眼斑/腹纹）保留——洞穴里当"红眼"识别点
        if 'Emission Strength' in bsdf.inputs:
            bsdf.inputs['Emission Strength'].default_value = 1.0
        print(f"MAT {m.name!r} fixed")

# ---- 预览渲染（定头部朝向） ----
if PREVIEW:
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 720
    sc.render.resolution_y = 540
    # 灯光 + 环境（空场景默认全黑）
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.5
    so = bpy.data.objects.new('sun', sun)
    bpy.context.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(30))
    world = bpy.data.worlds.new('w'); bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.8, 0.9, 1)
    pts = []
    for o in objs:
        pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    cx = (min(xs) + max(xs)) / 2; cy = (min(ys) + max(ys)) / 2; cz = (min(zs) + max(zs)) / 2
    span = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    print(f"2ND bbox x[{min(xs):.2f},{max(xs):.2f}] y[{min(ys):.2f},{max(ys):.2f}] z[{min(zs):.2f},{max(zs):.2f}]")
    for i, (az, el) in enumerate([(0, 12), (180, 12), (90, 62)]):
        a = math.radians(az); e = math.radians(el)
        r = span * 1.15
        cam = bpy.data.cameras.new('c'); co = bpy.data.objects.new('c', cam)
        bpy.context.collection.objects.link(co)
        co.location = (cx + r * math.cos(e) * math.sin(a), cy - r * math.cos(e) * math.cos(a), cz + r * math.sin(e))
        d = Vector((cx, cy, cz)) - Vector(co.location)
        co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        sc.camera = co
        sc.render.filepath = os.path.join(HERE, f'preview_spider_{i}.png')
        bpy.ops.render.render(write_still=True)
    print('preview saved')

# ---- 归一：头朝 Blender -Y（glTF 导出后=+z → three.js +Z = 野兽前进方向），原点=脚底中心 ----
# 预览确认：原模型头已在 Blender -Y 端，无需旋转
bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.join()
body = bpy.context.active_object

pts = [body.matrix_world @ Vector(c) for c in body.bound_box]
xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
print(f"3RD after-norm x[{min(xs):.2f},{max(xs):.2f}] y[{min(ys):.2f},{max(ys):.2f}] z[{min(zs):.2f},{max(zs):.2f}]")
body.location = (-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -min(zs))
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
pts = [body.matrix_world @ Vector(c) for c in body.bound_box]
print(f"4TH final y[{min(p.y for p in pts):.3f},{max(p.y for p in pts):.3f}] z[{min(p.z for p in pts):.2f},{max(p.z for p in pts):.2f}]")

# ---- 导出 ----
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='JPEG',
                          export_jpeg_quality=85, export_yup=True)
print(f"exported {OUT} {os.path.getsize(OUT) // 1024}KB")
