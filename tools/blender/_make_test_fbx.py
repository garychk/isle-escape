# -*- coding: utf-8 -*-
"""生成一组假的 Mixamo 风格 FBX（骨架+蒙皮+动作），用于验证 merge_mixamo.py 的合并链路。"""
import bpy, os, sys, math
from mathutils import Vector

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1]) if '--' in sys.argv else 'tests/fbx'
os.makedirs(OUT, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_rig():
    arm_data = bpy.data.armatures.new('Armature')
    arm = bpy.data.objects.new('Armature', arm_data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    prev = None
    for name, head in (('Hips', (0, 0, 1.0)), ('Spine', (0, 0, 1.3)), ('Head', (0, 0, 1.6))):
        b = arm_data.edit_bones.new('mixamorig:' + name)
        b.head = head
        b.tail = (head[0], head[1], head[2] + 0.2)
        if prev:
            b.parent = prev
        prev = b
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


def make_mesh(arm, height=1.8):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, height / 2))
    ob = bpy.context.object
    ob.name = 'Body'
    ob.scale = (0.22, 0.14, height / 2)
    bpy.ops.object.transform_apply(scale=True)
    vg = ob.vertex_groups.new(name='mixamorig:Hips')
    vg.add(range(len(ob.data.vertices)), 1.0, 'REPLACE')
    m = ob.modifiers.new('Armature', 'ARMATURE')
    m.object = arm
    ob.parent = arm
    return ob


def add_action(arm, name, frames=20, amp=0.5):
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    arm.pose.bones['mixamorig:Spine'].rotation_mode = 'XYZ'
    for f, ang in ((1, -amp), (frames // 2, amp), (frames, -amp)):
        pb = arm.pose.bones['mixamorig:Spine']
        pb.rotation_euler = (0, math.radians(30 * ang), 0)
        pb.keyframe_insert('rotation_euler', frame=f)
    return act


def export(path):
    bpy.ops.export_scene.fbx(filepath=path, use_selection=False,
                             add_leaf_bones=False, bake_anim=True,
                             bake_anim_use_all_actions=True)


# base：T-pose（无动作）
reset()
arm = make_rig()
make_mesh(arm)
export(os.path.join(OUT, 'base.fbx'))

# 三段动作
for name in ('idle', 'walk', 'run'):
    reset()
    arm = make_rig()
    make_mesh(arm)
    add_action(arm, name)
    export(os.path.join(OUT, name + '.fbx'))

print('[test] 已生成', OUT)
