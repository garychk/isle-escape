# -*- coding: utf-8 -*-
# mutant.glb 构建：Mixamo mutant 模型（mutant.fbx）+ 挥爪攻击动作（mutant_swiping.fbx）合并为一个 GLB
# 输出 assets/mutant.glb，含两段动画：idle / swipe
# 用法：blender --background --python build_mutant.py
import bpy, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))          # isle-escape/
SRC_IDLE = os.path.join(ROOT, 'assets_src', 'mixamo', 'mutant.fbx')
SRC_SWIPE = os.path.join(ROOT, 'assets_src', 'mixamo', 'mutant_swiping.fbx')
OUT = os.path.join(ROOT, 'assets', 'mutant.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---- 1. 导入待机模型 ----
bpy.ops.import_scene.fbx(filepath=SRC_IDLE)
arm1 = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
mesh1 = next(o for o in bpy.data.objects if o.type == 'MESH')
act_idle = arm1.animation_data.action
act_idle.name = 'idle'
act_idle.use_fake_user = True
print('IDLE action', act_idle.name, tuple(round(v, 1) for v in act_idle.frame_range), flush=True)

# ---- 2. 导入挥爪动作，只留 action ----
bpy.ops.import_scene.fbx(filepath=SRC_SWIPE)
objs2 = [o for o in bpy.data.objects if o not in (arm1, mesh1)]
arm2 = next((o for o in objs2 if o.type == 'ARMATURE'), None)
act_swipe = arm2.animation_data.action if arm2 and arm2.animation_data else None
assert act_swipe is not None, 'swipe action not found'
act_swipe.name = 'swipe'
act_swipe.use_fake_user = True
print('SWIPE action', act_swipe.name, tuple(round(v, 1) for v in act_swipe.frame_range), flush=True)

# 删掉第二套骨架/网格（保留 action）
bpy.ops.object.select_all(action='DESELECT')
for o in objs2:
    o.select_set(True)
bpy.ops.object.delete()
for m in list(bpy.data.meshes):
    if m.users == 0:
        bpy.data.meshes.remove(m)
for a in list(bpy.data.armatures):
    if a.users == 0:
        bpy.data.armatures.remove(a)

# ---- 3. 贴图降采样 ----
for im in bpy.data.images:
    if im.size[0] == 0:
        continue
    if max(im.size) > 1024:
        im.scale(1024, 1024)
    im.pack()
    print('IMG', im.name, im.size[0], flush=True)

# ---- 4. 材质修正：生物粗糙不反光 ----
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = 0.78
        print('MAT', m.name, 'fixed', flush=True)

# ---- 5. 两段动作挂到同一骨架的 NLA 轨（导出每轨一个动画） ----
arm1.animation_data.action = None
for tr in list(arm1.animation_data.nla_tracks):
    arm1.animation_data.nla_tracks.remove(tr)
for act, nm in ((act_idle, 'idle'), (act_swipe, 'swipe')):
    tr = arm1.animation_data.nla_tracks.new()
    tr.name = nm
    strip = tr.strips.new(nm, int(act.frame_range[0]), act)
    strip.name = nm
    # 动作槽（Blender 4.4+ slotted actions）：尽可能绑到当前骨架
    try:
        slots = [s for s in act.slots]
        if slots:
            strip.action_slot = slots[0]
    except Exception as e:
        print('slot skip', e, flush=True)
    tr.mute = False
print('NLA tracks', [t.name for t in arm1.animation_data.nla_tracks], flush=True)

# ---- 6. 导出 ----
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB',
    export_image_format='JPEG', export_jpeg_quality=85,
    export_animation_mode='NLA_TRACKS',
    export_animations=True, export_anim_single_armature=True,
    export_yup=True,
)
print('EXPORTED', OUT, os.path.getsize(OUT) // 1024, 'KB', flush=True)
