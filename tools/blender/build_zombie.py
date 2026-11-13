# -*- coding: utf-8 -*-
# zombie.glb 构建：僵尸平民（common_all_in_one.fbx，单动作 2..1323 帧拼段）
# 分段（30fps）：idle=440..610 站立 / walk=1002..1322 丧尸踱步循环 / swipe=690..830 举棒挥击
# 输出 assets/zombie.glb，三段 NLA 轨动画
import bpy, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = r"D:\Downloads\zombie-commoner\source\zomb_commoner\common_all_in_one.fbx"
OUT = os.path.join(ROOT, 'assets', 'zombie.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
act = arm.animation_data.action
act.name = 'zsrc'
act.use_fake_user = True
print('SRC action', act.name, tuple(round(v, 1) for v in act.frame_range), flush=True)
print('MESHES', [o.name for o in bpy.data.objects if o.type == 'MESH'], flush=True)

# ---- 贴图降采样 + 打包 ----
seen = set()
for im in bpy.data.images:
    if im.size[0] == 0:
        continue
    if max(im.size) > 1024:
        im.scale(1024, 1024)
    im.pack()
    print('IMG', im.name, im.size[0], im.source, flush=True)

# ---- 材质：粗糙不反光 ----
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = 0.62
        print('MAT', m.name, 'fixed', flush=True)

# ---- 单动作拆三段：同一 action 挂三条 NLA 轨，各用 action_frame_* 截取帧段 ----
arm.animation_data.action = None
for tr in list(arm.animation_data.nla_tracks):
    arm.animation_data.nla_tracks.remove(tr)

CLIPS = (('idle', 440, 610), ('walk', 1002, 1322), ('swipe', 690, 830))
slot = None
try:
    slots = [s for s in act.slots]
    if slots:
        slot = slots[0]
except Exception as e:
    print('slot err', e, flush=True)

for nm, f0, f1 in CLIPS:
    tr = arm.animation_data.nla_tracks.new()
    tr.name = nm
    strip = tr.strips.new(nm, 0, act)   # 时间轴都从 0 摆，互不重叠
    strip.name = nm
    strip.action_frame_start = f0
    strip.action_frame_end = f1
    strip.frame_start = 0
    strip.frame_end = (f1 - f0) / bpy.context.scene.render.fps * bpy.context.scene.render.fps  # 等帧长摆放
    if slot:
        strip.action_slot = slot
    tr.mute = False
    print('NLA', nm, 'frames', f0, '..', f1, flush=True)
print('NLA tracks', [t.name for t in arm.animation_data.nla_tracks], flush=True)

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB',
    export_image_format='AUTO', export_jpeg_quality=85,  # AUTO：透明材质自动用 PNG 保 alpha
    export_animation_mode='NLA_TRACKS',
    export_animations=True, export_anim_single_armature=True,
    export_yup=True,
)
print('EXPORTED', OUT, os.path.getsize(OUT) // 1024, 'KB', flush=True)
