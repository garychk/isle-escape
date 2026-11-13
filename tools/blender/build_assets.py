"""
isle-escape 资产工厂 —— 用 Blender headless 生成游戏可用 GLB 道具
=================================================================
用法：
  blender --background --python tools/blender/build_assets.py

产物（输出到 isle-escape/assets/）：
  jeep.glb        越野车残骸  ~4.3m 长 / 1.95m 宽
  motorbike.glb   越野摩托    ~2.1m 长
  cabin.glb       木屋        ~5.2m × 4.4m，含门廊与烟囱

约定（重要，改模型时别破）：
  * 单位：米；Z 轴向上（glTF 导出后自动转 Y-up）
  * 原点：模型正下方的地面中心（x=0, y=0, z=0），方便直接贴 groundHeight()
  * 朝向：车头 / 木屋门朝向 Blender 的 -Y，导出后对应 three.js 的 +Z
  * 所有对象最后 join 成单个 mesh，每种材质是一个 material slot
"""

import bpy
import math
import os
import random
from mathutils import Euler, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(ROOT, "assets")
os.makedirs(OUT_DIR, exist_ok=True)

random.seed(20261112)


# ---------------------------------------------------------------- 基础工具
def srgb(hexv):
    """sRGB 十六进制 → 线性色（Blender 的 Base Color 是线性空间）"""
    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(((hexv >> 16) & 255) / 255),
            lin(((hexv >> 8) & 255) / 255),
            lin((hexv & 255) / 255))


_MATS = {}


def mat(name, hexv, rough=0.7, metal=0.0, emit=None, emit_i=0.0, alpha=1.0):
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*srgb(hexv), 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        if hasattr(m, "blend_method"):
            try:
                m.blend_method = "BLEND"
            except Exception:
                pass
        if hasattr(m, "surface_render_method"):
            try:
                m.surface_render_method = "BLENDED"
            except Exception:
                pass
    if emit is not None:
        for key in ("Emission Color", "Emission"):
            if key in b.inputs:
                b.inputs[key].default_value = (*srgb(emit), 1.0)
                break
        if "Emission Strength" in b.inputs:
            b.inputs["Emission Strength"].default_value = emit_i
    m.use_backface_culling = False
    _MATS[name] = m
    return m


def _active():
    o = bpy.context.object
    bpy.context.view_layer.objects.active = o
    return o


def box(dims, loc=(0, 0, 0), rot=(0, 0, 0), m=None, bevel=0.02, segs=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = _active()
    o.scale = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.rotation_euler = Euler(rot)
    if bevel > 0:
        bv = o.modifiers.new("bev", "BEVEL")
        bv.width = bevel
        bv.segments = segs
        bv.limit_method = "ANGLE"
        bv.angle_limit = math.radians(35)
        bpy.ops.object.modifier_apply(modifier=bv.name)
    if m:
        o.data.materials.append(m)
    return o


def cyl(r, h, loc=(0, 0, 0), rot=(0, 0, 0), verts=16, m=None, cap="NGON", r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts,
                                            location=loc, rotation=rot, end_fill_type=cap)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=h, vertices=verts,
                                        location=loc, rotation=rot, end_fill_type=cap)
    o = _active()
    if m:
        o.data.materials.append(m)
    return o


def sphere(r, loc=(0, 0, 0), scale=(1, 1, 1), seg=16, ring=8, m=None):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=ring, location=loc)
    o = _active()
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if m:
        o.data.materials.append(m)
    return o


def torus(major, minor, loc=(0, 0, 0), rot=(0, 0, 0), m=None, maj_seg=20, min_seg=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     location=loc, rotation=rot,
                                     major_segments=maj_seg, minor_segments=min_seg)
    o = _active()
    if m:
        o.data.materials.append(m)
    return o


def tube(p0, p1, r, m, verts=12):
    """两点之间的圆管（焊管、车架、绳子都用它）"""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    L = d.length
    if L < 1e-6:
        return None
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=L, vertices=verts,
                                        location=(a + b) / 2)
    o = _active()
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = d.to_track_quat("Z", "Y")
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    if m:
        o.data.materials.append(m)
    return o


def join(objs, name):
    objs = [o for o in objs if o]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    o.location = (0, 0, 0)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(42))
    except Exception:
        bpy.ops.object.shade_flat()
    return o


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _MATS.clear()          # 场景重置后旧 material 已失效，必须清缓存


def export(obj, filename):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    path = os.path.join(OUT_DIR, filename)
    kw = dict(filepath=path, export_format="GLB", use_selection=True,
              export_apply=True, export_yup=True, export_normals=True,
              export_materials="EXPORT", export_cameras=False, export_lights=False)
    for attempt in range(4):
        try:
            bpy.ops.export_scene.gltf(**kw)
            break
        except TypeError as e:
            msg = str(e)
            for k in ("export_cameras", "export_lights", "export_materials",
                      "export_apply", "export_normals", "export_yup"):
                if k in msg and k in kw:
                    kw.pop(k)
                    break
            else:
                raise
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f"[asset] {filename:16s} {os.path.getsize(path)/1024:7.1f} kB  ~{tris} tris")


# ================================================================ 材质表
M_PAINT = lambda: mat("paint_olive", 0x4A5340, 0.58, 0.32)
M_PAINT2 = lambda: mat("paint_faded", 0x757A62, 0.66, 0.25)
M_RUST = lambda: mat("rust", 0x7A3F22, 0.9, 0.2)
M_RUST_D = lambda: mat("rust_dark", 0x452615, 0.95, 0.1)
M_STEEL = lambda: mat("steel", 0x2C3033, 0.42, 0.92)
M_CHROME = lambda: mat("chrome", 0xAEB4B8, 0.2, 1.0)
M_RUBBER = lambda: mat("rubber", 0x15171A, 0.95, 0.0)
M_GLASS = lambda: mat("glass", 0x0D1418, 0.08, 0.0, alpha=0.5)
M_CANVAS = lambda: mat("canvas", 0x6C6653, 0.95, 0.0)
M_LAMP = lambda: mat("lamp", 0xFFEFC8, 0.25, 0.0, emit=0xFFD08A, emit_i=2.5)
M_TAIL = lambda: mat("taillight", 0x7A1408, 0.3, 0.0, emit=0xC02008, emit_i=1.2)
M_LOG = lambda: mat("wood_log", 0x7A5738, 0.92, 0.0)
M_LOG2 = lambda: mat("wood_log_dark", 0x60422A, 0.95, 0.0)
M_PLANK = lambda: mat("wood_plank", 0x8C6B45, 0.9, 0.0)
M_PLANK_D = lambda: mat("wood_plank_dark", 0x6B4E31, 0.94, 0.0)
M_STONE = lambda: mat("stone", 0x77736B, 0.96, 0.0)
M_MOSS = lambda: mat("moss", 0x3F4B2C, 1.0, 0.0)
M_SEAT = lambda: mat("leather", 0x35281C, 0.85, 0.0)
M_BRASS = lambda: mat("brass", 0xB08A3E, 0.35, 1.0)


# ================================================================ 越野车
def build_jeep():
    p = []
    paint, paint2 = M_PAINT(), M_PAINT2()
    rust, rustd = M_RUST(), M_RUST_D()
    steel, chrome, rubber = M_STEEL(), M_CHROME(), M_RUBBER()

    # —— 底盘大梁 ——
    for sx in (-0.44, 0.44):
        p.append(box((0.12, 3.55, 0.18), (sx, 0.02, 0.62), m=steel, bevel=0.015))

    # —— 车身（下部浴盆 + 上部机舱）——
    p.append(box((1.86, 3.30, 0.60), (0, 0.00, 0.92), m=paint, bevel=0.05))
    p.append(box((1.74, 1.02, 0.34), (0, -1.42, 1.16), m=paint, bevel=0.04))          # 引擎盖
    p.append(box((1.66, 0.10, 0.46), (0, -1.94, 1.02), m=rustd, bevel=0.02))          # 前格栅
    p.append(box((1.98, 0.14, 0.18), (0, -2.03, 0.80), m=steel, bevel=0.02))          # 前保险杠
    p.append(box((1.92, 0.14, 0.18), (0, 1.72, 0.86), m=steel, bevel=0.02))           # 后保险杠

    # 轮眉（四角，与车身同色，贴着轮子上方）
    for sx in (-0.95, 0.95):
        for sy in (-1.32, 1.28):
            p.append(box((0.26, 1.10, 0.12), (sx, sy, 0.99), m=paint, bevel=0.05))

    # 侧板 / 门（左右各两段，留出门缝）
    for sx in (-0.95, 0.95):
        p.append(box((0.06, 0.86, 0.52), (sx, -0.38, 0.96), m=paint2, bevel=0.02))
        p.append(box((0.06, 0.86, 0.52), (sx, 0.48, 0.96), m=paint2, bevel=0.02))
        # 门把手 + 铰链
        p.append(box((0.05, 0.14, 0.035), (sx * 1.02, -0.06, 1.12), m=rustd, bevel=0.01))
        for hy in (-0.78, -0.02):
            p.append(box((0.05, 0.05, 0.09), (sx * 1.03, hy, 1.16), m=rustd, bevel=0.008))

    # —— 挡风框 + 玻璃（后倾 14°，落在引擎盖后缘）——
    ang = math.radians(-14)
    for sx in (-0.74, 0.74):
        p.append(box((0.07, 0.07, 0.62), (sx, -0.86, 1.58), (ang, 0, 0), m=rustd, bevel=0.012))
    p.append(box((1.52, 0.07, 0.07), (0, -0.86, 1.87), (ang, 0, 0), m=rustd, bevel=0.012))
    p.append(box((1.42, 0.025, 0.50), (0, -0.86, 1.56), (ang, 0, 0), m=M_GLASS(), bevel=0))

    # 后视镜
    for sx in (-1.0, 1.0):
        p.append(tube((sx * 0.74, -0.88, 1.62), (sx * 0.95, -0.88, 1.68), 0.02, steel, 8))
        p.append(box((0.05, 0.15, 0.11), (sx * 0.97, -0.88, 1.70), (0, 0, sx * 0.2), m=rustd, bevel=0.01))

    # —— 防滚架（哑光深钢，避免读成白色 PVC 管）——
    for sx in (-0.78, 0.78):
        p.append(tube((sx, 0.52, 1.22), (sx, 0.52, 2.02), 0.045, steel, 10))
        p.append(tube((sx, 0.52, 2.02), (sx, -0.72, 2.02), 0.045, steel, 10))
        p.append(tube((sx, -0.72, 2.02), (sx, -0.80, 1.48), 0.045, steel, 10))
        p.append(tube((sx, 0.52, 2.02), (sx * 1.14, 1.30, 1.72), 0.04, steel, 8))      # 后撑
    p.append(tube((-0.99, 0.52, 2.04), (0.99, 0.52, 2.04), 0.042, steel, 10))
    p.append(tube((-0.78, -0.72, 2.02), (0.78, -0.72, 2.02), 0.042, steel, 10))

    # 帆布顶（微拱）
    p.append(box((1.84, 1.72, 0.05), (0, -0.08, 2.10), m=M_CANVAS(), bevel=0.02))
    p.append(box((1.86, 0.06, 0.16), (0, 0.80, 2.06), m=M_CANVAS(), bevel=0.02))

    # —— 车轮：胎 + 轮毂 + 轮辐 ——
    for sx in (-0.95, 0.95):
        for sy in (-1.32, 1.28):
            p.append(cyl(0.40, 0.28, (sx, sy, 0.42), (0, math.pi / 2, 0), 22, rubber))
            p.append(torus(0.235, 0.055, (sx * 1.02, sy, 0.42), (0, math.pi / 2, 0), rustd, 18, 6))
            p.append(cyl(0.20, 0.30, (sx, sy, 0.42), (0, math.pi / 2, 0), 14, rustd))
            for k in range(5):
                a = k * math.tau / 5
                p.append(box((0.055, 0.035, 0.20), (sx * 1.06, sy + math.cos(a) * 0.12,
                                                  0.42 + math.sin(a) * 0.12),
                             (a, 0, 0), steel, bevel=0.006))
            # 挡泥皮 / 悬挂
            p.append(tube((sx * 0.86, sy, 0.62), (sx * 0.70, sy, 0.72), 0.035, steel, 8))

    # 备胎（后门）
    p.append(cyl(0.36, 0.22, (0, 1.86, 1.22), (math.pi / 2, 0, 0), 20, rubber))
    p.append(torus(0.22, 0.05, (0, 1.98, 1.22), (math.pi / 2, 0, 0), rustd, 16, 6))

    # —— 灯 ——
    for sx in (-0.62, 0.62):
        p.append(cyl(0.15, 0.10, (sx, -1.99, 1.06), (math.pi / 2, 0, 0), 16, M_LAMP()))
        p.append(torus(0.15, 0.028, (sx, -1.96, 1.06), (math.pi / 2, 0, 0), rustd, 16, 6))
    for sx in (-0.72, 0.72):
        p.append(box((0.16, 0.06, 0.20), (sx, 1.72, 1.06), m=M_TAIL(), bevel=0.015))

    # 涉水管 / 排气管 / 油箱盖 / 拖车钩
    p.append(tube((0.74, -0.86, 1.30), (0.74, -0.86, 1.94), 0.05, rustd, 10))
    p.append(tube((0.74, -0.86, 1.94), (0.60, -1.10, 2.00), 0.05, rustd, 10))
    p.append(tube((-0.55, 1.10, 0.52), (-0.55, 1.86, 0.46), 0.05, rust, 10))
    p.append(cyl(0.07, 0.03, (0.80, -0.30, 1.24), (0, 0, 0), 10, rustd))
    p.append(torus(0.09, 0.026, (0, 2.02, 0.62), (0, math.pi / 2, 0), steel, 12, 6))
    p.append(box((1.70, 0.06, 0.26), (0, 1.63, 1.33), m=paint, bevel=0.02))           # 后货箱尾门

    # —— 车内：座椅 + 方向盘 ——
    for sx in (-0.42, 0.42):
        p.append(box((0.52, 0.44, 0.14), (sx, -0.20, 1.30), m=M_SEAT(), bevel=0.04))
        p.append(box((0.52, 0.13, 0.52), (sx, 0.02, 1.58), (-0.12, 0, 0), m=M_SEAT(), bevel=0.04))
    p.append(torus(0.17, 0.028, (-0.42, -0.62, 1.56), (math.radians(62), 0, 0), steel, 16, 6))
    p.append(tube((-0.42, -0.58, 1.54), (-0.42, -0.40, 1.44), 0.03, steel, 8))

    # 锈斑：贴着车身贴一层薄锈板，破坏纯色感（低调、深色）
    for i in range(6):
        sx = random.choice([-1, 1]) * 0.965
        p.append(box((0.008, random.uniform(0.16, 0.4), random.uniform(0.08, 0.2)),
                     (sx, random.uniform(-1.5, 1.5), random.uniform(0.70, 1.05)),
                     (0, 0, 0), rustd, bevel=0))

    return join(p, "jeep")


# ================================================================ 越野摩托
def build_motorbike():
    p = []
    paint, rust = M_PAINT2(), M_RUST()
    steel, chrome, rubber = M_STEEL(), M_CHROME(), M_RUBBER()

    # 车轮
    for sy in (-0.66, 0.64):
        p.append(cyl(0.33, 0.11, (0, sy, 0.34), (0, math.pi / 2, 0), 22, rubber))
        p.append(cyl(0.17, 0.13, (0, sy, 0.34), (0, math.pi / 2, 0), 14, chrome))
        p.append(torus(0.255, 0.028, (0, sy, 0.34), (0, math.pi / 2, 0), rust, 18, 5))
        for k in range(6):     # 辐条
            a = k * math.tau / 6
            p.append(tube((math.sin(a) * 0.15, sy, 0.34 + math.cos(a) * 0.15),
                          (math.sin(a) * 0.31, sy, 0.34 + math.cos(a) * 0.31), 0.008, chrome, 5))

    # 前叉 + 车把
    for sx in (-0.10, 0.10):
        p.append(tube((sx, -0.60, 0.36), (sx, -0.30, 1.16), 0.032, chrome, 10))
        p.append(tube((sx, -0.34, 0.72), (sx, -0.30, 1.16), 0.045, rust, 10))
    p.append(box((0.26, 0.10, 0.10), (0, -0.30, 1.18), m=rust, bevel=0.02))
    p.append(tube((-0.34, -0.26, 1.24), (0.34, -0.26, 1.24), 0.018, steel, 10))
    for sx in (-1, 1):
        p.append(tube((sx * 0.30, -0.26, 1.24), (sx * 0.38, -0.26, 1.24), 0.026, rubber, 8))
        p.append(tube((sx * 0.24, -0.26, 1.24), (sx * 0.30, -0.20, 1.28), 0.012, steel, 6))
    # 大灯 + 挡泥板（贴着轮子，不再是大悬空板）
    p.append(cyl(0.11, 0.09, (0, -0.42, 1.02), (math.radians(80), 0, 0), 16, M_LAMP()))
    p.append(torus(0.11, 0.018, (0, -0.40, 1.02), (math.radians(80), 0, 0), steel, 14, 5))
    p.append(box((0.20, 0.38, 0.035), (0, -0.68, 0.76), (0.55, 0, 0), paint, bevel=0.012))
    p.append(box((0.20, 0.32, 0.035), (0, 0.68, 0.80), (-0.35, 0, 0), paint, bevel=0.012))

    # 车架
    p.append(tube((-0.09, -0.30, 1.10), (-0.09, 0.10, 0.90), 0.028, steel, 8))
    p.append(tube((0.09, -0.30, 1.10), (0.09, 0.10, 0.90), 0.028, steel, 8))
    p.append(tube((-0.09, 0.10, 0.90), (-0.09, 0.52, 0.86), 0.028, steel, 8))
    p.append(tube((0.09, 0.10, 0.90), (0.09, 0.52, 0.86), 0.028, steel, 8))
    p.append(tube((-0.09, 0.10, 0.90), (-0.09, 0.12, 0.40), 0.026, steel, 8))
    p.append(tube((0.09, 0.10, 0.90), (0.09, 0.12, 0.40), 0.026, steel, 8))
    p.append(tube((-0.09, 0.52, 0.86), (0, 0.64, 0.36), 0.024, steel, 8))
    p.append(tube((0.09, 0.52, 0.86), (0, 0.64, 0.36), 0.024, steel, 8))

    # 发动机 + 排气
    p.append(box((0.30, 0.34, 0.34), (0, 0.06, 0.56), m=steel, bevel=0.03))
    p.append(box((0.26, 0.16, 0.20), (0, -0.14, 0.62), m=steel, bevel=0.02))
    for i in range(4):     # 散热片
        p.append(box((0.34, 0.20, 0.012), (0, 0.06, 0.44 + i * 0.055), m=steel, bevel=0))
    p.append(tube((0.13, -0.02, 0.46), (0.17, 0.62, 0.52), 0.034, steel, 8))
    p.append(cyl(0.05, 0.30, (0.17, 0.72, 0.55), (math.pi / 2 - 0.15, 0, 0), 12, chrome))

    # 油箱 + 座垫（油箱收小、后移，不再顶住大灯）
    p.append(sphere(0.24, (0, -0.02, 0.90), (0.85, 1.15, 0.72), 16, 10, paint))
    p.append(box((0.28, 0.50, 0.12), (0, 0.34, 0.94), m=M_SEAT(), bevel=0.05))
    p.append(box((0.24, 0.12, 0.16), (0, 0.62, 0.96), m=paint, bevel=0.03))
    # 后减震 + 脚踏 + 链条
    p.append(tube((0, 0.30, 0.30), (0, 0.16, 0.86), 0.03, chrome, 8))
    for sx in (-0.16, 0.16):
        p.append(box((0.14, 0.05, 0.03), (sx, 0.06, 0.36), m=steel, bevel=0.008))
    p.append(box((0.02, 0.62, 0.05), (0.15, 0.36, 0.36), m=rust, bevel=0.008))

    return join(p, "motorbike")


# ================================================================ 木屋
def build_cabin():
    p = []
    log, log2 = M_LOG(), M_LOG2()
    plank, plankD = M_PLANK(), M_PLANK_D()
    stone, moss = M_STONE(), M_MOSS()
    steel = M_STEEL()
    glass, lamp = M_GLASS(), M_LAMP()

    W, D = 4.6, 3.9          # 宽(X) × 深(Y)
    hw, hd = W / 2, D / 2
    n_layer, step = 9, 0.27
    r = 0.135
    door_w, door_h = 1.05, 2.05
    win_y, win_w, win_h = -0.95, 0.85, 0.72

    def logs(axis, fixed, length, layers, skip=None, jitter=0.0):
        """沿 axis 铺原木墙；skip = [(中心坐标, 开口宽, 起始层, 层数)]"""
        out = []
        for i in range(layers):
            z = 0.16 + i * step
            if skip:
                for (c, w, lo, cnt) in skip:
                    if lo <= i < lo + cnt:
                        # 开口处：拆成两段
                        a0, a1 = -length / 2, c - w / 2
                        b0, b1 = c + w / 2, length / 2
                        for (s0, s1) in ((a0, a1), (b0, b1)):
                            if s1 - s0 > 0.12:
                                out.append(_log(axis, fixed, (s0 + s1) / 2, s1 - s0, z, i))
                        break
                else:
                    out.append(_log(axis, fixed, 0, length, z, i))
            else:
                out.append(_log(axis, fixed, 0, length, z, i))
        return out

    def _log(axis, fixed, center, length, z, i):
        jz = random.uniform(-0.008, 0.008)
        m = log if i % 2 == 0 else log2
        if axis == "x":
            o = cyl(r, length, (center, fixed, z + jz), (0, math.pi / 2, 0), 12, m)
        else:
            o = cyl(r, length, (fixed, center, z + jz), (math.pi / 2, 0, 0), 12, m)
        return o

    # 南墙（+Y，正面，含门和窗）
    p += logs("x", hd, W + 0.5, n_layer,
              skip=[(0.0, door_w, 0, 8), (win_y * 0 + 1.35, win_w, 3, 3)])
    # 北墙（-Y，背面，含小窗）
    p += logs("x", -hd, W + 0.5, n_layer, skip=[(-1.1, 0.7, 4, 2)])
    # 东/西墙
    p += logs("y", hw, D + 0.5, n_layer)
    p += logs("y", -hw, D + 0.5, n_layer)

    # 门窗框
    p.append(box((door_w + 0.22, 0.16, 0.12), (0, hd + 0.06, door_h + 0.10), m=plankD, bevel=0.02))
    for sx in (-1, 1):
        p.append(box((0.13, 0.16, door_h), (sx * (door_w / 2 + 0.07), hd + 0.06, door_h / 2), m=plankD, bevel=0.02))
    # 门扇（虚掩，开 26°）—— 以铰链为局部原点（x 全为负），便于绕 z 旋转
    door = []
    for k in range(4):
        door.append(box((0.26, 0.06, door_h - 0.08), (-(k + 0.5) * 0.265, 0, (door_h - 0.08) / 2), m=plank, bevel=0.008))
    for k in range(2):
        door.append(box((door_w - 0.1, 0.03, 0.12), (-door_w / 2, -0.05, 0.42 + k * 1.05), m=plankD, bevel=0.006))
    dg = join(door, "doorleaf")
    dg.location = (door_w / 2 - 0.04, hd + 0.10, 0.0)
    dg.rotation_euler = Euler((0, 0, math.radians(-26)))
    p.append(dg)

    # 窗：玻璃 + 十字窗棂
    wx = 1.35
    p.append(box((win_w, 0.03, win_h), (wx, hd + 0.02, 1.32), m=glass, bevel=0))
    p.append(box((0.05, 0.06, win_h), (wx, hd + 0.04, 1.32), m=plankD, bevel=0.008))
    p.append(box((win_w, 0.06, 0.05), (wx, hd + 0.04, 1.32), m=plankD, bevel=0.008))
    p.append(box((win_w + 0.16, 0.10, 0.09), (wx, hd + 0.06, 1.32 + win_h / 2 + 0.06), m=plankD, bevel=0.015))
    p.append(box((win_w + 0.16, 0.10, 0.09), (wx, hd + 0.06, 1.32 - win_h / 2 - 0.06), m=plankD, bevel=0.015))
    # 北墙小窗
    p.append(box((0.7, 0.03, 0.5), (-1.1, -hd - 0.02, 1.24), m=glass, bevel=0))
    p.append(box((0.78, 0.09, 0.08), (-1.1, -hd - 0.06, 1.52), m=plankD, bevel=0.012))

    # —— 山墙（三角）——
    wall_top = 0.16 + n_layer * step + 0.13      # ≈ 2.72
    peak = 1.35
    for sy in (-hd, hd):
        rows = 9
        for i in range(rows):
            z = wall_top + 0.10 + i * 0.16
            t = i / (rows - 1)
            w = W * (1 - t * 0.94)
            if w < 0.3:
                break
            p.append(box((w, 0.10, 0.155), (0, sy, z), m=plank if i % 2 else plankD, bevel=0.008))

    # —— 屋顶：两坡（整板，不再贴条）+ 屋脊 + 顺坡封檐 ——
    roof_len = D / 2 + 0.55
    slope = math.radians(34)
    for sgn in (-1, 1):
        cy = sgn * (roof_len / 2) * math.cos(slope)
        cz = wall_top + peak - (roof_len / 2) * math.sin(slope)
        p.append(box((W + 0.9, roof_len, 0.10), (0, cy, cz - 0.06), (sgn * -slope, 0, 0), plankD, bevel=0.015))
        # 顺坡封檐板（贴着屋面边沿，随坡旋转）
        for sx in (-1, 1):
            p.append(box((0.07, roof_len, 0.22), (sx * (W / 2 + 0.45), cy, cz + 0.02),
                         (sgn * -slope, 0, 0), plank, bevel=0.01))
    p.append(cyl(0.10, W + 1.0, (0, 0, wall_top + peak + 0.02), (0, math.pi / 2, 0), 10, log2))

    # —— 门廊：地台 + 立柱 + 栏杆 + 台阶 ——
    porch_y0, porch_y1 = hd + 0.08, hd + 1.35
    p.append(box((W + 0.5, porch_y1 - porch_y0, 0.14), (0, (porch_y0 + porch_y1) / 2, 0.20), m=plank, bevel=0.015))
    for k in range(7):
        p.append(box((W + 0.46, 0.20, 0.02), (0, porch_y0 + 0.12 + k * 0.19, 0.28), m=plank if k % 2 else plankD, bevel=0.004))
    for sx in (-1, 1):
        p.append(cyl(0.09, 2.55, (sx * (W / 2 + 0.18), porch_y1 - 0.16, 1.42), (0, 0, 0), 10, log2))
    p.append(cyl(0.085, W + 0.55, (0, porch_y1 - 0.16, 2.62), (0, math.pi / 2, 0), 10, log2))     # 前梁
    for sx in (-1, 1):     # 斜撑：从墙顶拉到前梁，消除悬空感
        p.append(tube((sx * (W / 2 + 0.18), hd - 0.05, wall_top + 0.15),
                      (sx * (W / 2 + 0.18), porch_y1 - 0.16, 2.58), 0.05, log2, 8))
    p.append(box((W + 0.7, 1.55, 0.07), (0, porch_y1 - 0.55, 2.70), (math.radians(-9), 0, 0), plankD, bevel=0.012))
    for sx in (-1, 1):     # 栏杆
        for k in range(4):
            p.append(cyl(0.035, 0.95, (sx * (W / 2 + 0.18), porch_y1 - 0.30 - k * 0.28, 0.72), (0, 0, 0), 7, log2))
        p.append(cyl(0.045, 1.05, (sx * (W / 2 + 0.18), porch_y1 - 0.68, 1.20), (math.pi / 2, 0, 0), 7, plankD))
    for k in range(2):     # 台阶
        p.append(box((1.7, 0.32, 0.10), (0, porch_y1 + 0.20 + k * 0.30, 0.12 - k * 0.11), m=plankD, bevel=0.012))

    # —— 烟囱（毛石堆砌）——
    cx, cy = -W / 2 + 0.55, -0.55
    for k in range(13):
        z = wall_top - 0.45 + k * 0.19
        for j in range(3):
            p.append(box((0.42 + random.uniform(-0.04, 0.04), 0.20, 0.17),
                         (cx + (j - 1) * 0.02, cy + (j - 1) * 0.21 + random.uniform(-0.01, 0.01), z),
                         (0, 0, random.uniform(-0.06, 0.06)), stone, bevel=0.02))
    p.append(box((0.62, 0.42, 0.08), (cx, cy, wall_top + 2.24), m=stone, bevel=0.02))

    # —— 细节：屋檐下的柴堆 / 墙上挂的灯 / 苔藓 ——
    for k in range(5):
        p.append(cyl(0.07, 1.0, (-W / 2 - 0.35, 0.25 + (k % 2) * 0.15, 0.20 + k * 0.13),
                     (0, math.pi / 2, 0), 7, log2))
    p.append(box((0.14, 0.10, 0.22), (door_w / 2 + 0.42, hd + 0.14, 2.02), m=steel, bevel=0.01))
    p.append(sphere(0.07, (door_w / 2 + 0.42, hd + 0.22, 1.96), (1, 1, 1.2), 10, 6, lamp))
    for i in range(14):    # 苔藓斑
        sx = random.choice([-1, 1])
        p.append(box((0.10, random.uniform(0.2, 0.7), random.uniform(0.08, 0.2)),
                     (sx * (hw + 0.02), random.uniform(-1.6, 1.6), random.uniform(0.18, 0.55)),
                     (0, 0, 0), moss, bevel=0.01))

    return join(p, "cabin")


# ================================================================ 主流程
def main():
    for name, fn in (("jeep", build_jeep), ("motorbike", build_motorbike), ("cabin", build_cabin)):
        clear()
        obj = fn()
        export(obj, f"{name}.glb")
    print("[asset] done →", OUT_DIR)


if __name__ == "__main__":
    main()
