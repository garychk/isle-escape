# -*- coding: utf-8 -*-
# 校验 assets/dino.glb：列出动画、检查朝向（走/挥爪姿态各渲一张侧视图）
import bpy, os, math
from mathutils import Vector

ROOT = 'E:/WorkBuddy/2026-11-12-16-39-59/isle-escape'
GLB = os.path.join(ROOT, 'assets', 'dino.glb')
OUTDIR = os.path.join(ROOT, 'tools', 'blender')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
print('[v] meshes', [o.name for o in objs], 'bones', len(arm.data.bones), flush=True)
print('[v] actions', [(a.name, tuple(round(v) for v in a.frame_range)) for a in bpy.data.actions], flush=True)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x = scene.render.resolution_y = 480


def bbox():
    bpy.context.view_layer.update()
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            for k in range(3):
                lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
    return lo, hi


def shoot(tag, loc, quat, scale):
    cd = bpy.data.cameras.new('c' + tag); cd.type = 'ORTHO'; cd.ortho_scale = scale
    cam = bpy.data.objects.new('c' + tag, cd); scene.collection.objects.link(cam)
    cam.rotation_mode = 'QUATERNION'; cam.rotation_quaternion = quat; cam.location = loc
    scene.camera = cam
    scene.render.filepath = os.path.join(OUTDIR, 'dino2_%s.png' % tag)
    bpy.ops.render.render(write_still=True)
    print('[v] shot', tag, flush=True)
    bpy.data.objects.remove(cam, do_unlink=True)


for act_name, frame, tag in (('walk', 12, 'walk12'), ('walk', 30, 'walk30'), ('swipe', 40, 'swipe40')):
    act = next((a for a in bpy.data.actions if a.name == act_name), None)
    if not act:
        continue
    arm.animation_data.action = act
    if getattr(act, 'slots', None) and hasattr(arm.animation_data, 'action_slot'):
        arm.animation_data.action_slot = act.slots[0]
    scene.frame_set(frame)
    lo, hi = bbox()
    print('[v] %s@%d bbox y[%.2f,%.2f] z[%.2f,%.2f]' % (tag, frame, lo.y, hi.y, lo.z, hi.z), flush=True)
    cy, cz = (lo.y + hi.y) / 2, (lo.z + hi.z) / 2
    # 侧视：相机在 +X，看向 -X；图像右 = +Y，上 = +Z
    shoot(tag + '_side', (hi.x + 4, cy, cz), (0.5, 0.5, 0.5, 0.5), max(hi.y - lo.y, hi.z - lo.z) * 1.5)
print('[v] DONE', flush=True)
