# -*- coding: utf-8 -*-
"""打印脚趾相对髋部的前后轨迹（Y=前后，Z=上下），用于判读支撑相斜率＝原生步速。
用法：blender --background --python tools/blender/probe_curve.py -- walk.fbx
"""
import bpy, os, sys

argv = sys.argv
argv = argv[argv.index('--') + 1:] if '--' in argv else []

for path in argv:
    name = os.path.basename(path)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = 30
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True, ignore_leaf_bones=False,
                             automatic_bone_orientation=False, global_scale=1.0)
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    if not arms or not bpy.data.actions:
        print('[curve] %s: 无骨骼/动画' % name)
        continue
    arm = arms[0]
    act = bpy.data.actions[0]
    arm.animation_data_create()
    arm.animation_data.action = act
    for slot in getattr(act, 'slots', []) or []:
        try:
            arm.animation_data.action_slot = slot
        except Exception:
            pass
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
    f0, f1 = min(fr), max(fr)
    hips = arm.pose.bones.get('mixamorig:Hips')
    L = arm.pose.bones.get('mixamorig:LeftToeBase')
    R = arm.pose.bones.get('mixamorig:RightToeBase')
    print('[curve] %s  frames %d-%d  dur %.3fs' % (name, f0, f1, (f1 - f0) / 30.0))
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        bpy.context.view_layer.update()
        h = (arm.matrix_world @ hips.matrix).to_translation()
        dl = (arm.matrix_world @ L.matrix).to_translation() - h
        dr = (arm.matrix_world @ R.matrix).to_translation() - h
        print('[curve] f%03d  L y=%+.3f z=%+.3f | R y=%+.3f z=%+.3f' % (f, dl.y, dl.z, dr.y, dr.z))
    sys.stdout.flush()
