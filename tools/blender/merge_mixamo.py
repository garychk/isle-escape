# -*- coding: utf-8 -*-
"""
把 Mixamo 批量下载的一堆 FBX 合并成一个可直接进游戏的 GLB。

用法（在 isle-escape 目录下）：
  blender --background --python tools/blender/merge_mixamo.py -- \
      --src assets_src/mixamo --out assets/player.glb

目录约定（--src 下）：
  base.fbx    （或 tpose.fbx / character.fbx）  带骨骼的 T-pose 人物
  idle.fbx  walk.fbx  run.fbx  aim.fbx  ...     其余每个文件一个动作
  文件名（去掉扩展名、转小写）就是导出的动画 clip 名，脚本不再改名。

要点：
  * 所有动作最终都挂在同一个骨架上，动作名 = 文件名 → character.js 的关键字匹配表直接命中
  * 统一身高到 1.80m、脚底压到 y=0、水平居中，进游戏不用再调
  * 自动清掉 Mixamo 自带的 "mixamo.com" 动作名、Camera/Light、未使用的空动作
  * 默认按 glTF 规范导出为 Y-up、-Z 前视（Blender 里朝 -Y），和 assets.js 的约定一致
"""

import bpy
import os
import sys
import math
import argparse
from mathutils import Vector

BASE_NAMES = ('base', 'tpose', 't-pose', 'character', 'player', 'mesh')
TARGET_HEIGHT = 1.80
FPS = 30


def log(*a):
    print('[merge]', *a)
    sys.stdout.flush()


def parse_args():
    argv = sys.argv
    argv = argv[argv.index('--') + 1:] if '--' in argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default='assets_src/mixamo')
    ap.add_argument('--out', default='assets/player.glb')
    ap.add_argument('--base', default='', help='指定基础模型的文件名（不含扩展名）')
    ap.add_argument('--height', type=float, default=TARGET_HEIGHT)
    ap.add_argument('--face', type=float, default=0.0,
                    help='整体绕 Z 旋转角度（度）。默认 0；若游戏里人物背对镜头就填 180')
    ap.add_argument('--no-strip-root', action='store_true',
                    help='保留根骨水平位移（默认清除：Mixamo 没勾 In Place 时 walk/run 会漂移）')
    ap.add_argument('--keep-names', action='store_true', help='保留原始动作名（调试用）')
    ap.add_argument('--tex-max', type=int, default=1024, help='贴图长边上限，0=不缩放（默认 1024）')
    ap.add_argument('--img-format', default='WEBP', choices=['AUTO', 'JPEG', 'WEBP'],
                    help='导出的贴图格式，WEBP 体积最小且保留 alpha（默认）')
    return ap.parse_args(argv)


def call_op(op, **kw):
    """只传当前 Blender 版本真正支持的参数，避免版本差异导致 TypeError。"""
    props = op.get_rna_type().properties.keys()
    clean = {k: v for k, v in kw.items() if k in props}
    skipped = [k for k in kw if k not in props]
    if skipped:
        log('跳过不支持的导出参数:', ', '.join(skipped))
    return op(**clean)


def fcurves_of(act):
    """兼容 Blender 4.x 的 act.fcurves 与 5.x 的分层 Action（layers/strips/channelbags）。"""
    try:
        return list(act.fcurves)
    except Exception:
        pass
    out = []
    for layer in getattr(act, 'layers', []):
        for strip in getattr(layer, 'strips', []):
            bags = getattr(strip, 'channelbags', None)
            if bags is not None:
                for cb in bags:
                    out.extend(cb.fcurves)
                continue
            for attr in ('channelbag', 'fcurves'):
                v = getattr(strip, attr, None)
                if v is None:
                    continue
                out.extend(v() if callable(v) and attr == 'channelbag' else v)
    return out


def action_frames(act):
    r = [fc.range() for fc in fcurves_of(act)]
    if not r:
        return 0
    return int(max(b for _, b in r))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0


def import_fbx(path):
    before = set(bpy.data.objects)
    before_act = set(bpy.data.actions)
    call_op(bpy.ops.import_scene.fbx,
            filepath=path,
            use_anim=True,
            ignore_leaf_bones=False,
            automatic_bone_orientation=False,
            global_scale=1.0)
    new_objs = [o for o in bpy.data.objects if o not in before]
    new_acts = [a for a in bpy.data.actions if a not in before_act]
    return new_objs, new_acts


def armatures(objs):
    return [o for o in objs if o.type == 'ARMATURE']


def mesh_objects(objs):
    return [o for o in objs if o.type == 'MESH']


def drop_objects(objs):
    for o in objs:
        if o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)


def strip_empty_actions():
    for a in list(bpy.data.actions):
        if len(fcurves_of(a)) < 2:
            bpy.data.actions.remove(a)


def pick_base(files, forced):
    if forced:
        for f in files:
            if os.path.splitext(os.path.basename(f))[0].lower() == forced.lower():
                return f
        raise SystemExit('找不到指定的 base 文件: ' + forced)
    for f in files:
        stem = os.path.splitext(os.path.basename(f))[0].lower()
        if stem in BASE_NAMES:
            return f
    # 没按约定命名：挑体积最小的（通常就是没动画的 T-pose）
    return min(files, key=os.path.getsize)


def world_height(objs):
    lo, hi = 1e9, -1e9
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            y = (o.matrix_world @ Vector(c)).y  # 注意：先按 Z-up 用 z，下面统一处理
        for v in o.data.vertices[:1]:
            pass
    # 用 Z 轴算身高（Blender 是 Z-up）
    lo, hi = 1e9, -1e9
    for o in objs:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world
        for c in o.bound_box:
            z = (mw @ Vector(c)).z
            lo = min(lo, z)
            hi = max(hi, z)
    return lo, hi


IMG_ROLE = (('diffuse', ('diffuse', 'albedo', 'basecolor', 'base_color')),
            ('normal', ('normal', 'norm', 'nrm')),
            ('opacity', ('opacity', 'alpha', 'mask')),
            ('gloss', ('gloss', 'rough', 'specular', 'metal')))


def role_of(name):
    n = name.lower()
    for role, keys in IMG_ROLE:
        if any(k in n for k in keys):
            return role
    return 'other'


def optimize_textures(max_size=1024):
    """Mixamo 每套材质带 Diffuse/Normal/Specular/Gloss 四张，后两张对观感影响很小，
    却占一半以上体积：这里摘掉它们（粗糙度改成常量），并把剩下的贴图降到 max_size。"""
    drop = set()
    for img in list(bpy.data.images):
        if img.name == 'Render Result' or not img.users:
            continue
        if role_of(img.name) in ('gloss', 'specular'):
            drop.add(img.name)

    # 从材质里摘掉节点
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        nt = mat.node_tree
        for n in list(nt.nodes):
            if n.type == 'TEX_IMAGE' and n.image and n.image.name in drop:
                nt.nodes.remove(n)
        for n in nt.nodes:
            if n.type != 'BSDF_PRINCIPLED':
                continue
            if 'Roughness' in n.inputs and not n.inputs['Roughness'].is_linked:
                n.inputs['Roughness'].default_value = 0.55
            if 'Specular IOR Level' in n.inputs and not n.inputs['Specular IOR Level'].is_linked:
                n.inputs['Specular IOR Level'].default_value = 0.30
    for name in drop:
        if name in bpy.data.images:
            bpy.data.images.remove(bpy.data.images[name])

    if max_size <= 0:
        return
    for img in bpy.data.images:
        if img.name == 'Render Result' or not img.users or img.size[0] == 0:
            continue
        w, h = img.size
        m = max(w, h)
        if m <= max_size:
            continue
        s = max_size / float(m)
        img.scale(max(1, int(round(w * s))), max(1, int(round(h * s))))
    log('贴图已降到长边 %d px' % max_size)


def normalize(arm, meshes, height):
    """统一身高 / 脚底落原点 / 水平居中。"""
    lo, hi = world_height(meshes)
    h = max(hi - lo, 1e-4)
    s = height / h
    arm.scale = (arm.scale.x * s, arm.scale.y * s, arm.scale.z * s)
    bpy.context.view_layer.update()

    # 重新量一次包围盒，做平移
    lo2, hi2 = world_height(meshes)
    xs, zs = [], []
    for o in meshes:
        mw = o.matrix_world
        for c in o.bound_box:
            p = mw @ Vector(c)
            xs.append(p.x)
            zs.append(p.y)
    cx = (min(xs) + max(xs)) / 2
    cy = (min(zs) + max(zs)) / 2
    arm.location.x -= cx
    arm.location.y -= cy
    arm.location.z -= lo2
    bpy.context.view_layer.update()
    log('身高归一化 %.2f m（原始 %.2f m）' % (height, h))


def apply_object_transform(arm, meshes):
    """把缩放/位移烘到骨架与网格上，避免 glTF 里出现奇怪的整体缩放节点。"""
    bpy.ops.object.select_all(action='DESELECT')
    for o in [arm] + meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.update()


def retarget(base_arm, acts, clip_name, strip_root=True):
    """把动作改名为 clip 名并挂到基础骨架上（Mixamo 骨架同名，可直接复用）。"""
    out = []
    for i, a in enumerate(acts):
        name = clip_name if len(acts) == 1 else '%s_%d' % (clip_name, i)
        a.name = name
        a.use_fake_user = True
        # Blender 4.4+ 的 slotted action：把槽名对齐到目标骨架，导出时才认得出
        for slot in getattr(a, 'slots', []) or []:
            try:
                slot.name_display = base_arm.name
            except Exception:
                pass
        if strip_root:
            strip_root_motion(base_arm, a)
        out.append(name)
    return out


def _remove_fcurve(action, fc):
    try:
        action.fcurves.remove(fc)
        return
    except Exception:
        pass
    for layer in getattr(action, 'layers', []):
        for strip in getattr(layer, 'strips', []):
            for cb in getattr(strip, 'channelbags', []):
                if fc in cb.fcurves:
                    cb.fcurves.remove(fc)
                    return


def _strip_horizontal(action):
    """旧版：直接删水平位移曲线（会引入与 rest 姿态的跳变，仅调试用）。"""
    for fc in list(fcurves_of(action)):
        if 'location' not in fc.data_path:
            continue
        bone = fc.data_path.split('"')[1] if '"' in fc.data_path else ''
        if bone.lower() in ('mixamorig:hips', 'hips', 'root', 'armature'):
            if fc.array_index in (0, 1):   # X / Y（Blender 水平面）
                _remove_fcurve(action, fc)


def strip_root_motion(arm, action):
    """把根骨的世界水平位移逐帧投影掉，只保留竖直起伏。
    Mixamo 未勾 In Place 时 walk/run 每循环水平漂移可达数米，这里把水平分量
    压回起始点：对每个关键帧用数值雅可比求局部补偿，比直接删曲线稳（不跳变）。"""
    import re
    from mathutils import Matrix, Vector
    per = {}
    for fc in fcurves_of(action):
        m = re.search(r'pose\.bones\["(.+?)"\]\.location', fc.data_path)
        if m:
            per.setdefault(m.group(1), {})[fc.array_index] = fc
    scene = bpy.context.scene
    cleaned = []
    for bname, fcs in sorted(per.items()):
        if len(fcs) < 3 or arm.pose.bones.get(bname) is None:
            continue
        pb = arm.pose.bones[bname]
        frames = sorted({int(round(k.co[0])) for fc in fcs.values() for k in fc.keyframe_points})
        if len(frames) < 2:
            continue
        span = max(max(fcs[i].evaluate(f) for f in frames) - min(fcs[i].evaluate(f) for f in frames)
                   for i in range(3))
        if span < 0.005:      # 位移不足 5mm，无需处理
            continue
        scene.frame_set(frames[0])
        bpy.context.view_layer.update()
        w0 = (arm.matrix_world @ pb.matrix).to_translation().copy()
        eps = 0.02
        moved = 0.0
        for f in frames:
            scene.frame_set(f)
            bpy.context.view_layer.update()
            loc = Vector([fcs[i].evaluate(f) for i in range(3)])
            pb.location = loc
            bpy.context.view_layer.update()
            w = (arm.matrix_world @ pb.matrix).to_translation()
            cols = []
            for k in range(3):     # 数值雅可比：局部位置 -> 世界位置
                pb.location[k] = loc[k] + eps
                bpy.context.view_layer.update()
                wk = (arm.matrix_world @ pb.matrix).to_translation()
                cols.append((wk - w) / eps)
                pb.location[k] = loc[k]
            R = Matrix((cols[0], cols[1], cols[2])).transposed()
            dw = Vector((w0.x - w.x, w0.y - w.y, 0.0))   # 只补偿世界水平面
            moved = max(moved, dw.length)
            dl = R.inverted() @ dw
            for k in range(3):
                fc = fcs[k]
                v = loc[k] + dl[k]
                hit = False
                for kp in fc.keyframe_points:
                    if abs(kp.co[0] - f) < 1e-3:
                        kp.co[1] = v
                        hit = True
                        break
                if not hit:
                    fc.keyframe_points.insert(f, v)
                fc.update()
        if moved > 0.01:
            cleaned.append('%s(%.2fm)' % (bname, moved))
    for c in cleaned:
        log('  根位移已清除:', c)


def main():
    a = parse_args()
    src = os.path.abspath(a.src)
    out = os.path.abspath(a.out)
    if not os.path.isdir(src):
        raise SystemExit('目录不存在: ' + src)

    files = sorted(
        [os.path.join(src, f) for f in os.listdir(src) if f.lower().endswith('.fbx')]
    )
    if not files:
        raise SystemExit('目录里没有 FBX: ' + src)

    base = pick_base(files, a.base)
    anims = [f for f in files if f != base]
    log('基础模型:', os.path.basename(base))
    log('动作文件 %d 个' % len(anims))

    reset()

    objs, _ = import_fbx(base)
    arms = armatures(objs)
    if not arms:
        raise SystemExit('基础文件里没有骨骼，检查是不是下载成了静态模型')
    arm = arms[0]
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    log('骨骼:', arm.name, '| 骨骼数:', len(arm.data.bones), '| 网格:', len(meshes))
    if len(arm.data.bones) < 20:
        log('警告：骨骼只有 %d 根，可能不是 Mixamo 的完整骨架' % len(arm.data.bones))

    drop_objects([o for o in objs if o.type in ('CAMERA', 'LIGHT')])
    for act in list(bpy.data.actions):   # base 文件自带的动作会多导出一段垃圾 clip
        bpy.data.actions.remove(act)
    strip_empty_actions()

    optimize_textures(a.tex_max)
    normalize(arm, meshes, a.height)
    if abs(a.face) > 1e-3:
        arm.rotation_euler.z += math.radians(a.face)
    # 注意：不要 transform_apply！缩放/位移留在 Armature 物体上由导出器烘焙成节点变换，
    # 否则骨骼 rest 位（米）和动画数据（Mixamo 原生单位）错位，人物会被放大几十倍。

    if arm.animation_data is None:
        arm.animation_data_create()

    clips = []
    for f in anims:
        stem = os.path.splitext(os.path.basename(f))[0].lower()
        new_objs, new_acts = import_fbx(f)
        if not new_acts:
            log('跳过（没有动画）:', os.path.basename(f))
            drop_objects(new_objs)
            continue
        names = retarget(arm, new_acts, stem if not a.keep_names else stem, not a.no_strip_root)
        clips += names
        log('  + %-16s <- %-26s (%d 帧)' % (','.join(names), os.path.basename(f),
                                            action_frames(new_acts[0])))
        # 删掉这个文件带进来的临时骨架/网格，只留动作
        drop_objects(new_objs)

    if not clips:
        log('没有任何动作被合并，检查 FBX 是否包含 Animation')

    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.data.objects:
        o.select_set(True)

    call_op(bpy.ops.export_scene.gltf,
            filepath=out,
            export_format='GLB',
            use_selection=False,
            export_apply=False,
            export_yup=True,
            export_animations=True,
            export_animation_mode='ACTIONS',
            export_force_sampling=True,
            export_frame_range=False,
            export_bake_animation=False,
            export_optimize_animation_size=False,
            export_anim_single_armature=True,
            export_reset_pose_bones=True,
            export_skins=True,
            export_morph=True,
            export_cameras=False,
            export_lights=False,
            export_extras=False,
            export_image_format=a.img_format,
            export_image_quality=80)

    KNOWN = ('idle', 'walk', 'run', 'aim', 'ads', 'shoot', 'fire', 'rifle', 'slash', 'attack',
             'swing', 'roll', 'dodge', 'jump', 'fall', 'crouch', 'reload', 'die', 'death',
             'drive', 'sit')
    unknown = [c for c in clips if not any(k in c.lower() for k in KNOWN)]
    if unknown:
        log('这些 clip 名字状态机认不出来（进游戏不会自动播放）: ' + ', '.join(unknown))
        log('  把文件重命名为 idle/walk/run/aim/shoot/slash/roll/jump/crouch_idle 等再跑一次')

    size = os.path.getsize(out) / 1024.0 / 1024.0
    log('已导出: %s (%.2f MB)' % (out, size))
    log('动画 clip:', ', '.join(clips) if clips else '(无)')
    tris = 0
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
    log('三角面合计: %d' % tris)


if __name__ == '__main__':
    main()
