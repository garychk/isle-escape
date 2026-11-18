# -*- coding: utf-8 -*-
# 预览 assets/marble.glb：4 角度
import bpy, os, math
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GLB = os.path.join(ROOT, "assets", "marble.glb")
PREVIEW_DIR = os.path.join(ROOT, "tools", "blender")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
print("imported meshes", [o.name for o in objs])

sc = bpy.context.scene
try:
    sc.render.engine = 'BLENDER_EEVEE'
except Exception:
    sc.render.engine = 'BLENDER_WORKBENCH'
print("engine", sc.render.engine)
sc.render.resolution_x = 800
sc.render.resolution_y = 600

world = bpy.data.worlds.new("W")
sc.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.62, 0.7, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.4

bb = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
mn = Vector((min(p.x for p in bb), min(p.y for p in bb), min(p.z for p in bb)))
mx = Vector((max(p.x for p in bb), max(p.y for p in bb), max(p.z for p in bb)))
c = (mn + mx) / 2
R = max(mx.x - mn.x, mx.y - mn.y, mx.z - mn.z)
print("bbox", tuple(round(v, 2) for v in mn), tuple(round(v, 2) for v in mx))

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam); sc.camera = cam
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", 'SUN'))
sun.data.energy = 3.2
sun.rotation_euler = (math.radians(52), 0, math.radians(35))
sc.collection.objects.link(sun)

for name, d in [("iso", (1.0, -1.0, 0.6)), ("front", (0, -1, 0.18)), ("side", (1, 0, 0.18)), ("top", (0.01, -0.01, 1))]:
    v = Vector(d).normalized()
    cam.location = c + v * R * 1.7
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(PREVIEW_DIR, f"marble_prev_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("preview", name)
