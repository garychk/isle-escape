# -*- coding: utf-8 -*-
# mutant.glb 预览：四个视角 + 挥爪动作姿势，检查朝向/贴图/姿态
import bpy, os, math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(ROOT, 'assets', 'mutant.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = 640
sc.render.resolution_y = 640
sc.view_settings.view_transform = 'AgX'

# 灯光 + 世界
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 4.0
so = bpy.data.objects.new('sun', sun); bpy.context.collection.objects.link(so)
so.rotation_euler = (math.radians(52), 0, math.radians(28))

bpy.ops.import_scene.gltf(filepath=SRC)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
print('ACTIONS', [a.name for a in bpy.data.actions], flush=True)

pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
ctr = (mn + mx) / 2
span = max((mx - mn).x, (mx - mn).y, (mx - mn).z)
print('BBOX', tuple(round(v, 2) for v in mn), tuple(round(v, 2) for v in mx), flush=True)

cam_data = bpy.data.cameras.new('c'); cam = bpy.data.objects.new('c', cam_data)
bpy.context.collection.objects.link(cam); sc.camera = cam
cam_data.lens = 60

def shoot(name, az, el, frame):
    sc.frame_set(frame)
    a = math.radians(az); e = math.radians(el)
    r = span * 2.0
    cam.location = (ctr.x + r * math.cos(e) * math.sin(a), ctr.y - r * math.cos(e) * math.cos(a), ctr.z + r * math.sin(e))
    d = ctr - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(HERE, f'preview_mutant_{name}.png')
    bpy.ops.render.render(write_still=True)
    print('shot', name, flush=True)

# 先让 idle 生效：把 NLA 里 idle 轨解静音，其余静音
tracks = arm.animation_data.nla_tracks if arm.animation_data else []
print('TRACKS', [t.name for t in tracks], flush=True)

def solo(name):
    for t in tracks:
        t.mute = (t.name != name)
    sc.frame_set(1)

solo('idle')
shoot('front', 0, 10, 12)     # 相机在 -Y 侧（模型应朝 -Y = glTF +Z）
shoot('back', 180, 10, 12)
shoot('side', 90, 10, 12)
solo('swipe')
shoot('swipe', 20, 12, 40)
