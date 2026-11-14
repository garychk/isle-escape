# -*- coding: utf-8 -*-
"""用「支撑相脚掌相对髋部的后移速度」量测动画的原生步速（适用于原地动画）。
用法：
  blender --background --python tools/blender/probe_foot.py -- walk.fbx run_unarmed.fbx
"""
import bpy, os, sys
from mathutils import Vector

argv = sys.argv
argv = argv[argv.index('--') + 1:] if '--' in argv else []


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30


def frames_of(act):
    fr = []
    try:
        for fc in act.fcurves:
            fr += [int(round(kp.co[0])) for kp in fc.keyframe_points]
    except Exception:
        pass
    for layer in getattr(act, 'layers', []):
        for strip in getattr(layer, 'strips', []):
            for cb in getattr(strip, 'channelbags', []):
                for fc in cb.fcurves:
                    fr += [int(round(kp.co[0])) for kp in fc.keyframe_points]
    return fr


for path in argv:
    name = os.path.basename(path)
    reset()
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True, ignore_leaf_bones=False,
                             automatic_bone_orientation=False, global_scale=1.0)
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    if not arms:
        print('[foot] %s: 无骨骼' % name)
        continue
    arm = arms[0]
    act = bpy.data.actions[0] if bpy.data.actions else None
    if not act:
        print('[foot] %s: 无动画' % name)
        continue
    arm.animation_data_create()
    arm.animation_data.action = act
    for slot in getattr(act, 'slots', []) or []:
        try:
            arm.animation_data.action_slot = slot
        except Exception:
            pass

    fr = frames_of(act)
    f0, f1 = min(fr), max(fr)
    dur = (f1 - f0) / 30.0
    hips = arm.pose.bones.get('mixamorig:Hips')
    toes = [b for b in (arm.pose.bones.get('mixamorig:LeftToeBase'),
                        arm.pose.bones.get('mixamorig:RightToeBase')) if b]

    def sample(f):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        h = (arm.matrix_world @ hips.matrix).to_translation()
        out = []
        for t in toes:
            w = (arm.matrix_world @ t.matrix).to_translation()
            out.append((w - h))
        return out

    N = 60
    data = []
    for i in range(N + 1):
        f = f0 + (f1 - f0) * i / N
        data.append(sample(int(round(f))))

    speeds = []
    for ti in range(len(toes)):
        ys = [d[ti].z for d in data]
        lo, hi = min(ys), max(ys)
        thr = lo + (hi - lo) * 0.30
        vs = []
        for i in range(1, len(data)):
            if ys[i] <= thr and ys[i - 1] <= thr:
                a, b = data[i - 1][ti], data[i][ti]
                vs.append(((b - a).length) / (dur / N))
        vs.sort()
        if vs:
            speeds.append(vs[len(vs) // 2])
    native = sum(speeds) / len(speeds) if speeds else 0
    stride = 0
    for ti in range(len(toes)):
        zs = [d[ti].y for d in data]
        stride = max(stride, max(zs) - min(zs))
    print('[foot] %-20s dur %.3fs | 支撑相脚速 %.2f m/s | 前后摆幅 %.2f m' % (name, dur, native, stride))
    sys.stdout.flush()
