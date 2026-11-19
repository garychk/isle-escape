# -*- coding: utf-8 -*-
# bholenath.fbx (SHIVA 23) → bholenath.glb：减面 + 居中归零 + 3 角度预览
# 用法: blender -b --python tools/blender/convert_bholenath.py
import bpy, os, math
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = r"D:/Downloads/bholenath.fbx"
OUT_GLB = os.path.join(ROOT, "assets", "bholenath.glb")
PREVIEW_DIR = os.path.join(ROOT, "tools", "blender")
TARGET_TRIS = 90000

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print("meshes:", [o.name for o in meshes])

# 1) 合并
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active

# 2) 应用旋转/缩放
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# 3) 减面：100 万 → 9 万（雕像细节靠体块，9 万足够；游戏里重复实例也不卡）
obj.data.calc_loop_triangles()
tris = len(obj.data.loop_triangles)
ratio = min(1.0, TARGET_TRIS / max(1, tris))
print("decimate tris", tris, "->", int(tris * ratio), "ratio", round(ratio, 4))
mod = obj.modifiers.new("dec", "DECIMATE")
mod.decimate_type = 'COLLAPSE'
mod.ratio = ratio
bpy.ops.object.modifier_apply(modifier=mod.name)

# 4) 平滑着色（雕塑表面不希望看到三角面棱）
bpy.ops.object.shade_smooth()

# 5) 材质：源文件是程序化 rock（导出 glTF 只带 base color factor），
#    这里显式设成深灰石材，避免导出后变成纯白/纯黑
for m in bpy.data.materials:
    if not m.use_nodes:
        m.use_nodes = True
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.30, 0.28, 0.25, 1.0)
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = 0.92
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = 0.0
    print("material:", m.name)

# 6) 底部中心归零（游戏里按脚底摆放）
bpy.context.view_layer.update()
mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
for c in obj.bound_box:
    w = obj.matrix_world @ Vector(c)
    for i in range(3):
        mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
size = mx - mn
print("bbox size", [round(v, 2) for v in size])
# 统一到米：Z 高 209 → 约 2.09m（源为厘米）
SH = 0.01
obj.scale = (SH, SH, SH)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bpy.context.view_layer.update()
mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
for c in obj.bound_box:
    w = obj.matrix_world @ Vector(c)
    for i in range(3):
        mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
obj.location.x -= (mn.x + mx.x) / 2
obj.location.y -= (mn.y + mx.y) / 2
obj.location.z -= mn.z
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
print("final size", [round(v, 3) for v in (mx - mn)])

# 7) 导出 GLB
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=False,
                          export_apply=True, export_yup=True)
print("written", OUT_GLB, os.path.getsize(OUT_GLB) // 1024, "KB")

# 8) 预览（Workbench，快）
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.render.resolution_x = 640
sc.render.resolution_y = 640
sc.render.film_transparent = False
disp = sc.display.shading
disp.light = 'STUDIO'
disp.color_type = 'MATERIAL'
bpy.ops.object.camera_add(location=(0, -6.5, 1.4))
cam = bpy.context.object
sc.camera = cam
def look_at(o, target):
    d = target - o.location
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = 50
H = (mx.z - mn.z)
tgt = Vector((0, 0, H * 0.5))
for name, ang in (("front", 0), ("q34", math.radians(40)), ("side", math.radians(90))):
    r = H * 1.5
    cam.location = Vector((math.sin(ang) * r, -math.cos(ang) * r, H * 0.6))
    look_at(cam, tgt)
    sc.render.filepath = os.path.join(PREVIEW_DIR, "bholenath_%s.png" % name)
    bpy.ops.render.render(write_still=True)
    print("preview", sc.render.filepath)
