# -*- coding: utf-8 -*-
# marble-q.fbx → marble.glb：减面 + 贴图降到 2K + 底部中心归零 + 4 角度预览
# 用法: blender -b --python tools/blender/convert_marble.py
import bpy, os, math
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = r"D:/Downloads/carrara-marble-quarry/source/marble-q.fbx"
OUT_GLB = os.path.join(ROOT, "assets", "marble.glb")
PREVIEW_DIR = os.path.join(ROOT, "tools", "blender")
TARGET_TRIS = 90000
TEX_SIZE = 2048

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print("meshes:", [o.name for o in meshes])

# 1) 合并成一个对象（如果多块）
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active

# 2) 应用旋转/缩放，让几何在局部坐标下就是最终尺寸
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# 3) 贴图降到 2K，减少 GLB 体积
for im in bpy.data.images:
    if im.size[0] > TEX_SIZE:
        print(f"resize {im.name} {tuple(im.size)} -> {TEX_SIZE}")
        im.scale(TEX_SIZE, TEX_SIZE)

# 3.5) 删除四周"封闭裙边"（低模垂边会以大灰面挡住采石场崖壁）
#      判定：面中心位于 bbox 边界带内 且 面法线接近水平（顶面地形保留）
import bmesh
me = obj.data
bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
bb = obj.bound_box
xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]; zs = [v.co.z for v in bm.verts]
x0, x1 = min(xs) + 1.0, max(xs) - 1.0
y0, y1 = min(ys) + 1.0, max(ys) - 1.0
drop = []
for f in bm.faces:
    n = f.normal
    if n.z > 0.55:
        continue  # 顶面/崖壁平台保留
    cx = sum(v.co.x for v in f.verts) / len(f.verts)
    cy = sum(v.co.y for v in f.verts) / len(f.verts)
    if cx < x0 or cx > x1 or cy < y0 or cy > y1:
        drop.append(f)
print(f"skirt faces to drop: {len(drop)} / {len(bm.faces)}")
bmesh.ops.delete(bm, geom=drop, context='FACES_ONLY')
bm.to_mesh(me)
bm.free()
me.update()

# 4) 减面：Decimate collapse，保留 UV 边界
tris0 = sum(len(p.vertices) - 2 for p in obj.data.polygons)
ratio = min(1.0, TARGET_TRIS / max(1, tris0))
print(f"tris before {tris0}, ratio {ratio:.4f}")
mod = obj.modifiers.new("dec", 'DECIMATE')
mod.decimate_type = 'COLLAPSE'
mod.ratio = ratio
mod.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier=mod.name)
tris1 = sum(len(p.vertices) - 2 for p in obj.data.polygons)
print(f"tris after {tris1}")

# 5) 底部中心归零（GLB 原点 = 底面中心，方便 JS 里贴地摆放）
obj.data.update()
bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
xs = [p.x for p in bb]; ys = [p.y for p in bb]; zs = [p.z for p in bb]
cx = (min(xs) + max(xs)) / 2; cy = (min(ys) + max(ys)) / 2; z0 = min(zs)
print(f"bbox x[{min(xs):.2f},{max(xs):.2f}] y[{min(ys):.2f},{max(ys):.2f}] z[{min(zs):.2f},{max(zs):.2f}]")
obj.location.x -= cx
obj.location.y -= cy
obj.location.z -= z0
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
print("final bbox", [round(min(p[i] for p in bb), 2) for i in range(3)], [round(max(p[i] for p in bb), 2) for i in range(3)])

# 6) 导出 GLB（贴图走 JPEG 内嵌）
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format='GLB',
    export_apply=True,
    export_image_format='JPEG',
    export_jpeg_quality=85,
    export_normals=True,
    export_texcoords=True,
    export_materials='EXPORT',
)
print("written", OUT_GLB, round(os.path.getsize(OUT_GLB) / 1024 / 1024, 2), "MB")

# 7) 4 角度预览（看朝向/形态）
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.bl_idname for e in bpy.types.RenderEngine.__subclasses__()] else 'BLENDER_WORKBENCH'
try:
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
except Exception:
    sc.render.engine = 'BLENDER_WORKBENCH'
sc.render.resolution_x = 800
sc.render.resolution_y = 600
sc.render.film_transparent = False
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

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
sc.collection.objects.link(cam)
sc.camera = cam

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(40))
sc.collection.objects.link(sun)

views = [("iso", (1.0, -1.0, 0.62)), ("front", (0, -1, 0.16)), ("side", (1, 0, 0.16)), ("top", (0.01, -0.01, 1))]
for name, d in views:
    v = Vector(d).normalized()
    cam.location = c + v * R * 1.9
    direction = c - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(PREVIEW_DIR, f"marble_prev_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("preview", name)
