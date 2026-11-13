# 把 player.glb 每段动画的"脚底离地/入地"恒定偏差归零。
# 背景：fix_hips_offset.js 按髋骨中位对齐 rest 高度，但蹲/挥刀/驾驶等姿势髋骨本来就低，
# 被抬回去后脚会悬空。这里用 Blender 真实 FK（蒙皮网格顶点世界 Z）测脚底中位高度，
# 再通过数值雅可比把世界 Z 校正量换算成髋骨局部修正，逐关键帧写入 fcurve。
#
# 用法（在 isle-escape 目录下）：
#   "D:/Programs/blender-5.4.0-alpha/blender.exe" --background --python tools/blender/ground_clips.py -- assets/player.glb
#
# 管线顺序：merge_mixamo.py → fix_hips_offset.js → ground_clips.py（最后一步，脚底必须贴地）

import bpy, sys, re, statistics
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
GLB = argv[0] if argv else 'assets/player.glb'
THRESH = 0.03      # 脚底中位偏差小于 3cm 视为贴地
SAMPLE = 9         # 每段采样帧数

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
# 顺手清掉混进来的静态杂物（如 Icosphere 标记球），避免污染测量与导出
for o in list(bpy.data.objects):
    if o.type == 'MESH' and not o.vertex_groups:
        print(f"[ground] 删除无骨骼网格: {o.name}")
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print(f"[ground] armature={arm.name}, meshes={[m.name for m in meshes]}")

def fcurves_of(act):
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out.extend(cb.fcurves)
    return out

def bind_action(obj, act):
    ad = obj.animation_data
    ad.action = act
    ad.action_slot = act.slots[0]

def foot_median_z(act):
    """逐帧采样所有蒙皮网格的世界最低点，返回中位值"""
    st, fr = int(act.frame_range[0]), int(act.frame_range[1])
    step = max(1, (fr - st) // (SAMPLE - 1) or 1)
    dg = bpy.context.evaluated_depsgraph_get()
    mins = []
    for f in range(st, fr + 1, step):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        dg.update()
        z = 1e9
        for ob in meshes:
            ev = ob.evaluated_get(dg)
            mw = ev.matrix_world
            for v in ev.data.vertices:
                wz = (mw @ v.co).z
                if wz < z:
                    z = wz
        mins.append(z)
    return statistics.median(mins)

# 髋骨 = 骨架根（Mixamo 根骨），带 location 动画的最高层骨骼
def find_hips(arm):
    for pb in arm.pose.bones:
        if pb.parent is None:
            return pb
    return None

scene = bpy.context.scene
total_fixed = 0
for act in bpy.data.actions:
    bind_action(arm, act)
    med = foot_median_z(act)
    if abs(med) <= THRESH:
        print(f"[ground] {act.name:14s} 脚底 {med:+.3f} m → 已贴地，跳过")
        continue

    # 髋骨 location fcurves（3 分量）
    hips = find_hips(arm)
    if hips is None:
        print(f"[ground] {act.name:14s} 找不到根骨，跳过")
        continue
    fcs = {}
    for fc in fcurves_of(act):
        m = re.search(r'pose\.bones\["(.+?)"\]\.location', fc.data_path)
        if m and m.group(1) == hips.name:
            fcs[fc.array_index] = fc
    if len(fcs) < 3:
        print(f"[ground] {act.name:14s} 根骨无完整位移曲线，跳过")
        continue

    frames = sorted({round(k.co[0], 3) for fc in fcs.values() for k in fc.keyframe_points})
    want = -med                      # 世界 Z 需要的整体平移量
    eps = 0.02
    applied = 0.0

    def foot_min_z():
        z = 1e9
        for ob in meshes:
            ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
            mw = ev.matrix_world
            for v in ev.data.vertices:
                wz = (mw @ v.co).z
                if wz < z:
                    z = wz
        return z

    for f in frames:
        scene.frame_set(int(round(f)))
        bpy.context.view_layer.update()
        loc = Vector([fcs[i].evaluate(f) for i in range(3)])
        hips.location = loc
        bpy.context.view_layer.update()
        z0 = foot_min_z()
        # 数值雅可比：d(脚底世界Z)/d(髋骨局部分量)
        J = []
        for k in range(3):
            hips.location[k] = loc[k] + eps
            bpy.context.view_layer.update()
            J.append((foot_min_z() - z0) / eps)
            hips.location[k] = loc[k]
        n2 = sum(j * j for j in J)
        if n2 < 1e-9:
            continue
        # 最小范数局部增量：Δloc = J * want / |J|²
        dloc = [j * want / n2 for j in J]
        for k in range(3):
            fc = fcs[k]
            for kp in fc.keyframe_points:
                if abs(kp.co[0] - f) < 1e-4:
                    kp.co[1] += dloc[k]
                    kp.interpolation = 'LINEAR'
                    applied += abs(dloc[k])
        for fc in fcs.values():
            fc.update()
    total_fixed += 1
    # 复测
    bind_action(arm, act)
    med2 = foot_median_z(act)
    print(f"[ground] {act.name:14s} 脚底 {med:+.3f} → {med2:+.3f} m（髋骨局部修正 ~{applied/ max(1,len(frames)):.4f}/帧）")

print(f"[ground] 完成：校正 {total_fixed} 段 / 共 {len(bpy.data.actions)} 段")

# —— 导出覆盖 ——
for o in bpy.data.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=GLB,
        export_format='GLB', use_selection=False, export_apply=False,
        export_yup=True, export_animations=True, export_animation_mode='ACTIONS',
        export_force_sampling=True, export_frame_range=False,
        export_bake_animation=False, export_optimize_animation_size=False,
        export_anim_single_armature=True, export_reset_pose_bones=True,
        export_skins=True, export_morph=True, export_cameras=False,
        export_lights=False, export_extras=False,
        export_image_format='WEBP', export_image_quality=80)
print(f"[ground] 已导出: {GLB}")
