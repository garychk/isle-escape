# -*- coding: utf-8 -*-
# dino.glb 构建：双足变异暴徒（PumpkinHulk）三合一
#   dino_walk.fbx   -> 模型本体 + walk 动画（1-44 帧）
#   dino_swipe.fbx  -> swipe 攻击动画（1-81 帧）
#   mutant.fbx      -> idle 待机动画（1-43 帧，同 mixamorig 骨架，按骨骼名重定向）
# 输出 assets/dino.glb，含三段动画：idle / walk / swipe
# 用法：blender --background --python build_dino2.py
import bpy, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))          # isle-escape/
SRC_WALK = os.path.join(ROOT, 'assets_src', 'mixamo', 'dino_walk.fbx')
SRC_SWIPE = os.path.join(ROOT, 'assets_src', 'mixamo', 'dino_swipe.fbx')
SRC_IDLE = os.path.join(ROOT, 'assets_src', 'mixamo', 'mutant.fbx')
OUT = os.path.join(ROOT, 'assets', 'dino.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    act = arm.animation_data.action if arm.animation_data else None
    return new, arm, act


# ---- 1. 行走素材：作为模型本体（骨架 + 蒙皮网格） ----
objs1, arm1, act_walk = import_fbx(SRC_WALK)
mesh1 = next(o for o in objs1 if o.type == 'MESH')
act_walk.name = 'walk'
act_walk.use_fake_user = True
print('WALK', act_walk.name, tuple(round(v) for v in act_walk.frame_range), 'verts', len(mesh1.data.vertices), flush=True)

# ---- 2. 挥爪动作：只要 action ----
objs2, _, act_swipe = import_fbx(SRC_SWIPE)
act_swipe.name = 'swipe'
act_swipe.use_fake_user = True
print('SWIPE', act_swipe.name, tuple(round(v) for v in act_swipe.frame_range), flush=True)

# ---- 3. 待机动作：复用 mutant 的 idle（同 mixamorig 命名，按骨骼名重定向） ----
objs3, _, act_idle = import_fbx(SRC_IDLE)
act_idle.name = 'idle'
act_idle.use_fake_user = True
print('IDLE', act_idle.name, tuple(round(v) for v in act_idle.frame_range), flush=True)

# 删掉 2、3 的骨架与网格，只留 action
bpy.ops.object.select_all(action='DESELECT')
for o in objs2 + objs3:
    o.select_set(True)
bpy.ops.object.delete()
for coll, keep in ((bpy.data.meshes, set()), (bpy.data.armatures, set())):
    for d in list(coll):
        if d.users == 0:
            coll.remove(d)

# ---- 4. 贴图降采样 + 打包 ----
for im in bpy.data.images:
    if im.size[0] == 0:
        continue
    if max(im.size) > 1024:
        im.scale(1024, 1024)
    im.pack()
    print('IMG', im.name, im.size[0], flush=True)

# ---- 5. 材质修正：生物粗糙不反光 ----
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = 0.8
        print('MAT', m.name, 'fixed', flush=True)

# ---- 6. 三段动作挂 NLA 轨（导出每轨一个动画） ----
arm1.animation_data.action = None
for tr in list(arm1.animation_data.nla_tracks):
    arm1.animation_data.nla_tracks.remove(tr)
for act, nm in ((act_idle, 'idle'), (act_walk, 'walk'), (act_swipe, 'swipe')):
    tr = arm1.animation_data.nla_tracks.new()
    tr.name = nm
    strip = tr.strips.new(nm, int(act.frame_range[0]), act)
    strip.name = nm
    try:
        slices = [s for s in act.slots]
        if slices:
            strip.action_slot = slices[0]
    except Exception as e:
        print('slot skip', e, flush=True)
    tr.mute = False
print('NLA', [t.name for t in arm1.animation_data.nla_tracks], flush=True)

# ---- 7. 导出 ----
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB',
    export_image_format='JPEG', export_jpeg_quality=85,
    export_animation_mode='NLA_TRACKS',
    export_animations=True, export_anim_single_armature=True,
    export_yup=True,
)
print('EXPORTED', OUT, os.path.getsize(OUT) // 1024, 'KB', flush=True)
