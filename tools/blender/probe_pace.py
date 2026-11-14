# -*- coding: utf-8 -*-
"""量测行走/奔跑动画的原生步速：根骨（Hips）一个循环内的世界水平位移 ÷ 时长。
用法：
  blender --background --python tools/blender/probe_pace.py -- walk.fbx run.fbx
"""
import bpy, os, sys
from mathutils import Vector

argv = sys.argv
argv = argv[argv.index('--') + 1:] if '--' in argv else []


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30


for path in argv:
    name = os.path.basename(path)
    reset()
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True, ignore_leaf_bones=False,
                             automatic_bone_orientation=False, global_scale=1.0)
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    if not arms:
        print('[pace] %s: 无骨骼' % name)
        continue
    arm = arms[0]
    acts = [a for a in bpy.data.actions if len(getattr(a, 'fcurves', [])) or getattr(a, 'layers', None)]
    act = acts[0] if acts else None
    if not act:
        print('[pace] %s: 无动画' % name)
        continue
    arm.animation_data_create()
    arm.animation_data.action = act
    for slot in getattr(act, 'slots', []) or []:
        try:
            arm.animation_data.action_slot = slot
        except Exception:
            pass

    fr = [int(round(kp.co[0])) for fc in act.fcurves for kp in fc.keyframe_points] if getattr(act, 'fcurves', None) else []
    if not fr:
        for layer in getattr(act, 'layers', []):
            for strip in getattr(layer, 'strips', []):
                for cb in getattr(strip, 'channelbags', []):
                    for fc in cb.fcurves:
                        fr += [int(round(kp.co[0])) for kp in fc.keyframe_points]
    f0, f1 = min(fr), max(fr)
    dur = (f1 - f0) / 30.0

    hips = arm.pose.bones.get('mixamorig:Hips') or arm.pose.bones.get('Hips')
    if not hips:
        print('[pace] %s: 找不到 Hips' % name)
        continue

    pts = []
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        w = (arm.matrix_world @ hips.matrix).to_translation()
        pts.append((f, w.copy()))

    # 逐步位移累加，能避开 hips 上下起伏/回摆的影响
    horiz = sum(((pts[i][1] - pts[i - 1][1]).xy).length for i in range(1, len(pts)))
    net = (pts[-1][1] - pts[0][1]).xy.length
    # 高度尺度（判断单位是否 cm）
    top = max((arm.matrix_world @ b.head).z for b in arm.data.bones)
    print('[pace] %-20s frames %d-%d dur %.3fs | net %.3f horiz %.3f | 骨骼高 %.2f | 原生步速 %.2f m/s'
          % (name, f0, f1, dur, net, horiz, top, horiz / dur))
    sys.stdout.flush()
