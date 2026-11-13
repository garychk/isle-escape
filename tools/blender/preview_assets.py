"""
把 assets/*.glb 渲染成预览图，用于快速判断模型观感（不进游戏也能看）
  blender --background --python tools/blender/preview_assets.py
输出：tools/blender/preview_<name>.png
"""
import bpy
import os
import math
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(ROOT, "assets")
OUT = os.path.dirname(os.path.abspath(__file__))

VIEWS = {"jeep": 1.0, "motorbike": 1.0, "cabin": 1.35}


def setup_render():
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            continue
    if sc.render.engine == "CYCLES":
        sc.cycles.samples = 32
        sc.cycles.use_denoising = True
    sc.render.resolution_x = 900
    sc.render.resolution_y = 640
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"


def world(color=0.35):
    w = bpy.data.worlds.new("w")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.55, 0.62, 0.72, 1)
    bg.inputs[1].default_value = 1.0


def sun():
    bpy.ops.object.light_add(type="SUN", location=(4, -6, 8))
    l = bpy.context.object
    l.data.energy = 4.0
    l.data.angle = math.radians(6)
    l.rotation_euler = (math.radians(52), 0, math.radians(28))
    bpy.ops.object.light_add(type="AREA", location=(-5, 4, 4))
    f = bpy.context.object
    f.data.energy = 220
    f.data.size = 6
    f.rotation_euler = (math.radians(70), 0, math.radians(200))


def ground():
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.005))
    m = bpy.data.materials.new("g")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.13, 0.15, 0.1, 1)
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
    bpy.context.object.data.materials.append(m)


def frame(objs, scale=1.0):
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector((min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)))
            mx = Vector((max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)))
    ctr = (mn + mx) / 2
    size = max((mx - mn).x, (mx - mn).y, (mx - mn).z)
    dist = size * 2.15 * scale
    bpy.ops.object.camera_add(location=(ctr.x + dist * 0.72, ctr.y - dist * 0.78, ctr.z + dist * 0.42))
    cam = bpy.context.object
    cam.data.lens = 58
    d = ctr - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam


def main():
    for name, sc in VIEWS.items():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        setup_render()
        world()
        sun()
        ground()
        path = os.path.join(ASSETS, f"{name}.glb")
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        objs = [o for o in bpy.data.objects if o not in before]
        frame(objs, sc)
        out = os.path.join(OUT, f"preview_{name}.png")
        bpy.context.scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        print("[preview]", out)


main()
