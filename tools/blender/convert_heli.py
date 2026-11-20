# -*- coding: utf-8 -*-
# Helicopter.fbx → heli.glb（v3，两阶段：处理 → 存 .blend → 重开 → 导出）
#   Blender 5.4-alpha 的 glTF 导出器会读到直接改 matrix_basis 后的陈旧矩阵快照，
#   所以改完全用操作符（transform_apply / parent_set），存盘重开后再导出。
#   - 贴图断链 → 按 basename 到 textures/ 重新接线
#   - 保留 Nody + Rot（主旋翼）+ Rot2（尾旋翼）层级 → three.js 逐节点自转
#   - transform_apply 旋转/缩放（location 不动，旋翼枢轴保留），Cylinder001 并入机身
#   - Decimate 61万 → ~10万；负缩放烘焙后重算外向法线
#   - FBX 导入器给材质设的 HASHED 透明 + 断链 alpha → 无 alpha 链接的全改 OPAQUE
#   - 根空节点 HeliRoot = 全机包围盒底部中心（anchor:'origin' 原样使用）
#   - 机头朝 Blender -Y（顶视图确认）→ glTF +Z → 游戏 MANIFEST yaw=180
# 用法: blender -b --python tools/blender/convert_heli.py
import bpy, os, math, re
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = r"D:/Downloads/直升机2/source/Helicopter.fbx"
TEXDIR = r"D:/Downloads/直升机2/textures"
OUT_GLB = os.path.join(ROOT, "assets", "heli.glb")
STAGE_BLEND = os.path.join(ROOT, "tools", "blender", "heli_stage.blend")
PREVIEW_DIR = os.path.dirname(os.path.abspath(__file__))
DECIMATE_RATIO = 0.16

# ---------- 阶段 1：处理 ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

# 关键修复：FBX 导入给物体带了变换动画（fcurve 关键帧锁死导入时的矩阵），
# 不清掉的话 transform_apply 的结果会在依赖图求值时被关键帧回写覆盖，
# 导出器永远拿到导入时的 loc/rot/scale（机身在 GLB 里缩成 8cm 的元凶）。
_anim_n = 0
for o in bpy.data.objects:
    if o.animation_data:
        o.animation_data_clear()
        _anim_n += 1
for act in list(bpy.data.actions):
    bpy.data.actions.remove(act)
print("== anim cleared on", _anim_n, "objects; actions:", len(bpy.data.actions))

ALIAS = {'round-metal-texture-1024x1024': 'round-metal-dif.jpeg'}
def find_tex(basename):
    stem = os.path.splitext(basename)[0]
    stem2 = re.sub(r'-\d{3}$', '', stem)
    for s in (stem, stem2):
        for ext in ('.jpg', '.jpeg', '.png', '.gif', '.tga'):
            p = os.path.join(TEXDIR, s + ext)
            if os.path.exists(p):
                return p
    if stem in ALIAS:
        p = os.path.join(TEXDIR, ALIAS[stem])
        if os.path.exists(p):
            return p
    return None

fixed, missing = [], []
for im in bpy.data.images:
    if im.name in ('', 'Render Result') or im.source != 'FILE':
        continue
    hit = find_tex(os.path.basename(im.filepath) or im.name)
    if hit:
        im.filepath = hit
        try:
            im.reload()
        except Exception:
            pass
        fixed.append(os.path.basename(hit))
        if im.size[0] == 0:
            missing.append((im.name, hit, 'reload 后仍读不到'))
    else:
        missing.append((im.name, im.filepath, '找不到源文件'))
print("== tex fixed:", len(fixed))
print("== tex missing:", missing)

# Cylinder001 并入 Nody
cyl = bpy.data.objects.get('Cylinder001')
nody = bpy.data.objects.get('Nody')
rot = bpy.data.objects.get('Rot')
rot2 = bpy.data.objects.get('Rot2')
if cyl and nody:
    bpy.ops.object.select_all(action='DESELECT')
    cyl.select_set(True)
    bpy.context.view_layer.objects.active = cyl
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    nody.select_set(True)
    bpy.context.view_layer.objects.active = nody
    bpy.ops.object.join()
    bpy.context.view_layer.update()

# 清父级 → 逐个 transform_apply（官方测试对负缩放 FINISHED；location 不动保住旋翼枢轴）
bpy.ops.object.select_all(action='DESELECT')
for o in (nody, rot, rot2):
    o.select_set(True)
bpy.context.view_layer.objects.active = nody
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.context.view_layer.update()
for o in (nody, rot, rot2):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    r = bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    print("== apply", o.name, r,
          "loc=", [round(v, 2) for v in o.location], "scale=", [round(v, 4) for v in o.scale])
    bpy.context.view_layer.update()

# 减面（只机身）+ 重算外向法线（负缩放烘焙翻转了绕向）
md = nody.modifiers.new('dec', 'DECIMATE')
md.ratio = DECIMATE_RATIO
bpy.ops.object.select_all(action='DESELECT')
nody.select_set(True)
bpy.context.view_layer.objects.active = nody
bpy.ops.object.modifier_apply(modifier='dec')
nody.data.calc_loop_triangles()
print("== nody tris after decimate:", len(nody.data.loop_triangles))
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')

# 材质透明清理：无 alpha 链接的全 OPAQUE（防 three.js alphaTest 裁掉机身）
for m in bpy.data.materials:
    if not m.node_tree:
        continue
    b = m.node_tree.nodes.get('Principled BSDF')
    linked = bool(b and b.inputs['Alpha'].links)
    if not linked:
        m.blend_method = 'OPAQUE'
print("== blend cleaned")

# 根空节点 = 全机包围盒底部中心；操作符方式 keep_transform 挂父级
def bbox(objs):
    mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    return mn, mx

parts = [o for o in (nody, rot, rot2) if o]
mn, mx = bbox(parts)
print("== bbox min", [round(v, 2) for v in mn], "max", [round(v, 2) for v in mx])
root = bpy.data.objects.new('HeliRoot', None)
root.location = ((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z)
bpy.context.scene.collection.objects.link(root)
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True)
root.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.object.parent_set(type='OBJECT', keep_transform=True)
bpy.context.view_layer.update()

bpy.ops.wm.save_as_mainfile(filepath=STAGE_BLEND)
print("== stage saved", STAGE_BLEND)

# ---------- 阶段 2：重开（刷新依赖图）→ 导出 ----------
bpy.ops.wm.open_mainfile(filepath=STAGE_BLEND)
bpy.context.view_layer.update()
root = bpy.data.objects.get('HeliRoot')
for ch in root.children:
    print("== reopen", ch.name, "loc=", [round(v, 2) for v in ch.location],
          "scale=", [round(v, 4) for v in ch.scale])

bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format='GLB',
    export_apply=False,
    export_image_format='AUTO',
    export_jpeg_quality=85,
    export_normals=True,
    export_texcoords=True,
    export_materials='EXPORT',
)
print("written", OUT_GLB, round(os.path.getsize(OUT_GLB) / 1024 / 1024, 2), "MB")

# ---------- 阶段 3：预览 ----------
world = bpy.data.worlds.new("W")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.62, 0.7, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.2
sc = bpy.context.scene
try:
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
except Exception:
    sc.render.engine = 'BLENDER_WORKBENCH'
sc.render.resolution_x = 800
sc.render.resolution_y = 800
all_mesh = [o for o in bpy.data.objects if o.type == 'MESH']
mn2, mx2 = bbox(all_mesh)
c = (mn2 + mx2) / 2
R = max(mx2 - mn2) * 1.45
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam); sc.camera = cam
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(40))
sc.collection.objects.link(sun)
for name, d in [("iso", (1.0, -1.0, 0.6)), ("front", (0, -1, 0.15)), ("side", (1, 0, 0.15))]:
    v = Vector(d).normalized()
    cam.location = c + v * R * 2.0
    cam.rotation_euler = (Vector(c) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(PREVIEW_DIR, f"heli_glb_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("preview", name)
