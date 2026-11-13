# -*- coding: utf-8 -*-
# fishing boat "boat model.fbx" -> assets/boat.glb（替换旧军用快艇）
# 84 网格 join 成单对象；PBR 贴图降采样重绑；原点=船中水线（Blender z=-0.5 归零）、船头 +Y(=glTF -Z)
import bpy, os, mathutils, sys

SRC = r"D:\Downloads\fishing_boat\source\boat model.fbx"
TEX = r"E:\WorkBuddy\2026-11-12-16-39-59\isle-escape\assets_src\fishing_boat_tex"
OUT = r"E:\WorkBuddy\2026-11-12-16-39-59\isle-escape\assets\boat.glb"
WATERLINE_Z = -0.5   # 实测：龙骨 -1.958，主甲板 1.32，取吃水 ~1.46m 处为水线

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

# ---------- 1. 重绑降采样贴图 ----------
# FBX 内贴图路径失效（尺寸 0），按"去 .00x 后缀"映射到 assets_src/fishing_boat_tex
MAP = {
    'lambert1_BaseColor': 'boat_a_bc.jpg', 'lambert1_Normal': 'boat_a_n.jpg',
    'lambert1_Roughness': 'boat_a_r.jpg', 'lambert1_Metallic': 'boat_a_m.jpg',
    'Material_BaseColor': 'boat_b_bc.jpg', 'Material_Normal': 'boat_b_n.jpg',
    'Material_Roughness': 'boat_b_r.jpg', 'Material_Metallic': 'boat_b_m.jpg',
}
rebound = 0
for m in bpy.data.materials:
    if not m.use_nodes: continue
    for n in m.node_tree.nodes:
        if n.type != 'TEX_IMAGE' or not n.image: continue
        base = n.image.name.split('.png')[0]
        if base not in MAP: continue
        fp = os.path.join(TEX, MAP[base])
        if not os.path.exists(fp):
            print("MISS", base, flush=True); continue
        img = bpy.data.images.load(fp, check_existing=True)
        n.image = img
        rebound += 1
print("REBOUND", rebound, flush=True)

# ---------- 2. 修复玻璃材质（原模型把金属度图接到了 BaseColor） ----------
for m in bpy.data.materials:
    if m.name != 'glass': continue
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (0.62, 0.77, 0.85, 1)
    bsdf.inputs['Roughness'].default_value = 0.12
    bsdf.inputs['Metallic'].default_value = 0
    bsdf.inputs['Alpha'].default_value = 0.35
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    m.blend_method = 'BLEND'
    print("GLASS fixed", flush=True)

# ---------- 3. join + 烘焙世界变换 ----------
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
print("MESHES", len(meshes), flush=True)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
mw = obj.matrix_world.copy()
obj.data.transform(mw)                      # 世界变换烘进顶点（教训：不要用 transform_apply）
obj.matrix_world = mathutils.Matrix.Identity(4)
print("UV", len(obj.data.uv_layers), "verts", len(obj.data.vertices), "polys", len(obj.data.polygons), flush=True)

# ---------- 4. 原点=船中水线 ----------
vs = obj.data.vertices
xs = [v.co.x for v in vs]; ys = [v.co.y for v in vs]; zs = [v.co.z for v in vs]
cy = (min(ys) + max(ys)) / 2
for v in vs:
    v.co.y -= cy
    v.co.z -= WATERLINE_Z
obj.location = (0, 0, 0)
print("SIZE w=%.2f l=%.2f h=%.2f  keel=%.2f deck=%.2f top=%.2f" % (
    max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs),
    min(zs) - WATERLINE_Z, 1.32 - WATERLINE_Z, max(zs) - WATERLINE_Z), flush=True)

# ---------- 5. 材质兜底：金属度别太高、粗糙度合理 ----------
for m in bpy.data.materials:
    if not m.use_nodes or m.name == 'glass': continue
    for n in m.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            n.inputs['Emission Strength'].default_value = 0

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True,
                          export_image_format='AUTO')
print("EXPORTED", os.path.getsize(OUT), "bytes", flush=True)
