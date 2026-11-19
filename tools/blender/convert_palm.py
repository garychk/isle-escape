# -*- coding: utf-8 -*-
# Palm.fbx → palm.glb：外置贴图接线 + 底部中心归零 + 预览
# 模型很轻（树干 800 面 + 64 片叶各 14 面 ≈ 1.7k 面），无需减面；
# 自带高度 ~41m（游戏里按目标高缩放），也无需缩放。
# 用法: blender -b --python tools/blender/convert_palm.py
import bpy, os, math
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = r"D:/Downloads/free-game-ready-palm/source/Palm.fbx"
TEXDIR = r"D:/Downloads/free-game-ready-palm/textures"
OUT_GLB = os.path.join(ROOT, "assets", "palm.glb")
PREVIEW_DIR = os.path.join(ROOT, "tools", "blender")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

# 0) 外置贴图接线（FBX 只存引用，Blender 导入器接不上 → 手动重建节点）
def wire(mat_name, col_png, nrm_png=None, rough_png=None, alpha_clip=False):
    m = bpy.data.materials.get(mat_name)
    if not m:
        print("!! material missing", mat_name)
        return
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(os.path.join(TEXDIR, col_png))
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if alpha_clip:
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        try:
            m.blend_method = 'CLIP'          # glTF alphaMode MASK → three alphaTest
        except Exception:
            pass
        try:
            m.surface_render_method = 'DITHERED'
        except Exception:
            pass
    if nrm_png:
        nrm = nt.nodes.new("ShaderNodeTexImage")
        nrm.image = bpy.data.images.load(os.path.join(TEXDIR, nrm_png))
        nrm.image.colorspace_settings.name = 'Non-Color'
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(nrm.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    if rough_png:
        rg = nt.nodes.new("ShaderNodeTexImage")
        rg.image = bpy.data.images.load(os.path.join(TEXDIR, rough_png))
        rg.image.colorspace_settings.name = 'Non-Color'
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(rg.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])  # glTF: roughness 在 G 通道
    print("wired", mat_name, "<-", col_png, nrm_png or "")

wire("PalmBark", "PalmBark_BaseColor.png", "PalmBark_Normal.png", "PalmBark_Roughness.png")
wire("PalmLeaf", "PalmLeaf_BaseColor.png", None, None, alpha_clip=True)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print("meshes:", len(meshes))

# 1) 合并 + 应用变换
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
print(f"tris {tris}")

# 2) 底部中心归零（GLB 原点 = 底面中心，JS 里直接贴地摆放）
obj.data.update()
bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
xs = [p.x for p in bb]; ys = [p.y for p in bb]; zs = [p.z for p in bb]
cx = (min(xs) + max(xs)) / 2; cy = (min(ys) + max(ys)) / 2; z0 = min(zs)
print(f"bbox x[{min(xs):.2f},{max(xs):.2f}] y[{min(ys):.2f},{max(ys):.2f}] z[{min(zs):.2f},{max(zs):.2f}]")
obj.location.x -= cx
obj.location.y -= cy
obj.location.z -= z0
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

# 3) 导出 GLB（AUTO：不透明贴图走 JPEG、带 alpha 的走 PNG；编码瘦身交给 reencode 脚本）
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format='GLB',
    export_apply=True,
    export_image_format='AUTO',
    export_jpeg_quality=85,
    export_normals=True,
    export_texcoords=True,
    export_materials='EXPORT',
)
print("written", OUT_GLB, round(os.path.getsize(OUT_GLB) / 1024 / 1024, 2), "MB")

# 4) 预览图
sc = bpy.context.scene
try:
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
except Exception:
    sc.render.engine = 'BLENDER_WORKBENCH'
sc.render.resolution_x = 800
sc.render.resolution_y = 800
world = bpy.data.worlds.new("W")
sc.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.62, 0.7, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.2

bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
c = Vector(((min(p.x for p in bb) + max(p.x for p in bb)) / 2,
            (min(p.y for p in bb) + max(p.y for p in bb)) / 2,
            (min(p.z for p in bb) + max(p.z for p in bb)) / 2))
R = max(max(p.x for p in bb) - min(p.x for p in bb),
        max(p.y for p in bb) - min(p.y for p in bb),
        max(p.z for p in bb) - min(p.z for p in bb)) * 1.35

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(40))
sc.collection.objects.link(sun)

for name, d in [("iso", (1.0, -1.0, 0.55)), ("side", (1, 0, 0.12))]:
    v = Vector(d).normalized()
    cam.location = c + v * R * 1.9
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(PREVIEW_DIR, f"palm_prev_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("preview", name)
