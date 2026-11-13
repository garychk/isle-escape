# -*- coding: utf-8 -*-
"""棚屋 FBX → 游戏用 cabin.glb
用法：blender --background --python tools/blender/build_cabin.py [--preview]

处理内容：
  * 贴图路径重映射（FBX 内部指向不存在的子文件夹）→ assets_src/cabin/*.png
  * 删除灯光；贴图降采样已由外部 PIL 完成（1024px）
  * 世界包围盒探查 + 预览渲染（--preview）
"""
import bpy, os, math, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC_DIR = os.path.join(ROOT, "assets_src", "cabin")
SRC = os.path.join(SRC_DIR, "cabin.fbx")
OUT = os.path.join(ROOT, "assets", "cabin.glb")

PREVIEW = "--preview" in sys.argv

# 贴图名 → 本地实际文件
TEX_MAP = {
    "Cube__pbr_diffuse": os.path.join(SRC_DIR, "Cube__pbr_diffuse.png"),
    "2ND Building__pbr_diffuse": os.path.join(SRC_DIR, "2ND_Building__pbr_diffuse.png"),
    "3 Sets__pbr_diffuse": os.path.join(SRC_DIR, "3_Sets__pbr_diffuse.png"),
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

# ---- 清理：灯光 / 相机 ----
for o in list(bpy.data.objects):
    if o.type in {"LIGHT", "CAMERA"}:
        bpy.data.objects.remove(o, do_unlink=True)

# ---- 贴图重映射：丢掉解析失败的图，换成本地文件 ----
for img in list(bpy.data.images):
    if img.source != "FILE":
        continue
    real = TEX_MAP.get(img.name)
    if real and os.path.exists(real):
        img.filepath = real
        try:
            img.reload()
        except Exception:
            pass
    elif img.size[0] == 0:
        # 解析失败且没有本地对应（法线贴图等）→ 从所有材质节点摘除
        for m in bpy.data.materials:
            if not getattr(m, "use_nodes", False):
                continue
            nt = m.node_tree
            for n in list(nt.nodes):
                if n.type == "TEX_IMAGE" and n.image == img:
                    for out in n.outputs:
                        for link in list(out.links):
                            nt.links.remove(link)
                    nt.nodes.remove(n)
        bpy.data.images.remove(img)

print("=== world bbox per mesh ===")
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    print(f"{o.name}: x[{min(xs):.2f},{max(xs):.2f}] y[{min(ys):.2f},{max(ys):.2f}] "
          f"z[{min(zs):.2f},{max(zs):.2f}] tris={sum(len(p.vertices) for p in o.data.polygons)}")

all_pts = []
for o in bpy.data.objects:
    if o.type == "MESH":
        all_pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
if all_pts:
    xs = [p.x for p in all_pts]; ys = [p.y for p in all_pts]; zs = [p.z for p in all_pts]
    print(f"TOTAL: x[{min(xs):.2f},{max(xs):.2f}] y[{min(ys):.2f},{max(ys):.2f}] z[{min(zs):.2f},{max(zs):.2f}]")

# ---- 材质修正：FBX 只带 diffuse，金属度归零、粗糙度提高，避免塑料/镜面感 ----
for m in bpy.data.materials:
    if not getattr(m, "use_nodes", False):
        continue
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = 0.88

# ---- 导出 GLB ----
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_image_format="JPEG",
                          export_yup=True, export_animations=False)
print("exported:", OUT, os.path.getsize(OUT) // 1024, "KB")

# ---- 打印"游戏本地坐标"关键几何（assets.js normalize 居中落地后的坐标） ----
# glTF 映射: (bx,by,bz) -> (bx, bz, -by)；normalize: x/z 减包围盒中心，y 抬到 min=0
if all_pts:
    cx = (min(xs) + max(xs)) / 2          # blender x 中心
    cy = (min(ys) + max(ys)) / 2          # blender y 中心
    minz = min(zs)
    LX = lambda bx: bx - cx
    LY = lambda bz: bz - minz
    LZ = lambda by: -by - cy
    print("=== game-local geometry (LX=blender_x, LY=blender_z, LZ=-blender_y) ===")
    print(f"house walls: LX[{LX(-7.15):.2f},{LX(7.15):.2f}]  LZ[{LZ(3.15):.2f},{LZ(-3.51):.2f}]")
    print(f"door gap on front wall: LX[{LX(3.02):.2f},{LX(5.36):.2f}]  (front wall LZ={LZ(-3.51):.2f})")
    print(f"floor LY={LY(0.72):.2f}  ground LY={LY(0):.2f}")
    print(f"porch: LX[{LX(2.8):.2f},{LX(7.0):.2f}] LZ[{LZ(-3.5):.2f},{LZ(-6.0):.2f}] LY={LY(0.34):.2f}")
    print(f"step deck: LX[{LX(2.0):.2f},{LX(2.8):.2f}] LZ[{LZ(-4.0):.2f},{LZ(-6.0):.2f}] LY={LY(0.69):.2f}")
    print(f"stairs: bottom LX={LX(2.5):.2f} LY={LY(0.38):.2f}  top LX={LX(-7.0):.2f} LY={LY(5.51):.2f}  (LZ~{LZ(-5.2):.2f})")
    print(f"walkway: LX[{LX(-10.6):.2f},{LX(-7.2):.2f}] LZ[{LZ(-3.6):.2f},{LZ(-6.5):.2f}] LY={LY(5.63):.2f}")
    print(f"roof top LY={LY(11.67):.2f}")

if PREVIEW:
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            continue
    if sc.render.engine == "CYCLES":
        sc.cycles.samples = 32
    sc.render.resolution_x = 1000
    sc.render.resolution_y = 700
    sc.view_settings.view_transform = "AgX"
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.62, 0.72, 1)
    bpy.ops.object.light_add(type="SUN", location=(6, -8, 10))
    bpy.context.object.data.energy = 4.0
    bpy.context.object.rotation_euler = (math.radians(50), 0, math.radians(30))

    cx = (min(xs) + max(xs)) / 2; cy = (min(ys) + max(ys)) / 2
    span = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    for i, (az, el) in enumerate([(0, 8), (90, 8), (180, 8), (270, 8), (0, 55)]):
        a = math.radians(az); e = math.radians(el)
        r = span * 1.15
        cam = bpy.data.cameras.new("c"); co = bpy.data.objects.new("c", cam)
        bpy.context.collection.objects.link(co)
        co.location = (cx + r * math.cos(e) * math.sin(a), cy - r * math.cos(e) * math.cos(a),
                       max(zs) * 0.4 + r * math.sin(e))
        d = Vector((cx, cy, max(zs) * 0.35)) - Vector(co.location)
        co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        cam.lens = 32
        sc.camera = co
        sc.render.filepath = os.path.join(HERE, f"preview_cabin_fbx_{i}.png")
        bpy.ops.render.render(write_still=True)
    print("preview saved")
