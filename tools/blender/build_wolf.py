# wolf.fbx（二进制，鬣狗 Hyenas_A15，带骨架+动画）→ wolf.glb 静态模型
# 绑定位姿腿是张开的：先取 Idle 动画中间帧烤进网格，再删骨架。
# 源：头 +Y、背 +Z（Blender Z-up）；导出器 Z-up→Y-up 后头需在 glTF +Z → 烘焙 Rz(180°)
# 用法: blender --background --python tools/blender/build_wolf.py -- <in.fbx> <out.glb>
import bpy, sys, os, math
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = argv[0] if argv else 'assets_src/mixamo/wolf.fbx'
dst = argv[1] if len(argv) > 1 else 'assets/wolf.glb'
TARGET_LEN = 1.9  # 烘焙体长（SCALES.wolf=1.14 放大后约 2.2m，与程序化狼相当）

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
armatures = [o for o in bpy.data.objects if o.type == 'ARMATURE']
assert meshes, '没有网格'

# —— 扫描全部动作的所有采样帧，选 z 向跨度最大（最挺立）的一帧烤进网格 ——
# （绑定位姿腿呈星形张开不可用；该素材动画轨能正常驱动骨架）
arm = armatures[0] if armatures else None
if arm and arm.animation_data:
    import mathutils

    def set_pose(act, f):
        """换动作 + 清零根骨骼链旋转 + 跳帧。
        动画轨带逐帧根旋转（整只狼会翻转/立起），锁死根链后身体保持绑定朝向，
        四肢摆动由各自骨骼驱动不受影响。"""
        arm.animation_data.action = act
        if getattr(act, 'slots', None) and hasattr(arm.animation_data, 'action_slot'):
            arm.animation_data.action_slot = act.slots[0]
        for pb in arm.pose.bones[:4]:
            pb.rotation_quaternion = mathutils.Quaternion((1, 0, 0, 0))
            pb.rotation_euler = (0, 0, 0)
        bpy.context.scene.frame_set(int(f))
        bpy.context.view_layer.update()

    def spans():
        """用【评估后】网格测三轴跨度——o.data 是绑定网格，不含骨架形变"""
        deps = bpy.context.evaluated_depsgraph_get()
        lo3 = Vector((1e9,) * 3); hi3 = Vector((-1e9,) * 3)
        for o in meshes:
            ob_eval = o.evaluated_get(deps)
            for v in ob_eval.data.vertices:
                w = ob_eval.matrix_world @ v.co
                for k in range(3):
                    lo3[k] = min(lo3[k], w[k]); hi3[k] = max(hi3[k], w[k])
        return hi3 - lo3

    best_act, best_f, best_s = None, 0, -1
    # 行走动作必然四腿站立；评分=水平投影跨度（x+y），身体放平的迈步帧得分最高
    for a in bpy.data.actions:
        if 'Walk' not in a.name:
            continue
        fr0, fr1 = a.frame_range
        f = int(fr0)
        while f <= fr1:
            set_pose(a, f)
            sp = spans()
            score = sp.x + sp.y
            if score > best_s: best_act, best_f, best_s = a, f, score
            f += 5
    set_pose(best_act, best_f)
    print('[wolf] 全动作扫描：选 %s @ 帧 %d (水平跨度 %.1f)' % (best_act.name, best_f, best_s))

# 烤蒙皮：evaluated 网格替换原网格，然后删骨架
deps = bpy.context.evaluated_depsgraph_get()
for o in meshes:
    ob_eval = o.evaluated_get(deps)
    baked = bpy.data.meshes.new_from_object(ob_eval)
    old = o.data
    o.data = baked
    o.modifiers.clear()
    if old.users == 0:
        bpy.data.meshes.remove(old)
for a in armatures:
    bpy.data.objects.remove(a, do_unlink=True)
print('[wolf] 蒙皮已烤死，骨架已删')

bpy.context.view_layer.update()
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in meshes:
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        for k in range(3):
            lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
size = hi - lo

# 该素材动画轨自带 ~90° 根旋转：若体长（最长轴）落在 Z（竖直），先扶正到 Y（水平）
if size.z > size.y and size.z > size.x:
    R = Matrix.Rotation(math.radians(-90), 4, 'X')  # +Z(头端) -> +Y
    for o in meshes:
        o.matrix_world = R @ o.matrix_world
    bpy.context.view_layer.update()
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in meshes:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            for k in range(3):
                lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
    size = hi - lo
    print('[wolf] 已扶正：长度轴 Z -> Y')

s = TARGET_LEN / max(size.x, size.y, size.z)
print('[wolf] 原始尺寸 (%.2f, %.2f, %.2f) -> 缩放 %.4f (体长 %.1fm)' % (size.x, size.y, size.z, s, TARGET_LEN))

cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
# 动画评估空间相对绑定空间绕体轴翻转了 180°（动画帧头在 +Y、背朝 -Z）：
# Ry(180°) 翻回背朝 +Z，再 Rz(180°) 把头从 +Y 转到 -Y（导出转换后 = glTF +Z 前进方向）
M = Matrix.Rotation(math.radians(180), 4, 'Z') \
  @ Matrix.Rotation(math.radians(180), 4, 'Y') \
  @ Matrix.Scale(s, 4) \
  @ Matrix.Translation((-cx, -cy, -lo.z))
for o in meshes:
    o.matrix_world = M @ o.matrix_world

# 源材质为 phong 贴图外部引用（丢失），显式设林狼灰褐毛色
mat = bpy.data.materials.new('wolf_fur')
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value = (0.40, 0.37, 0.32, 1.0)
bsdf.inputs['Roughness'].default_value = 0.9
bsdf.inputs['Metallic'].default_value = 0.0
for o in meshes:
    o.data.materials.clear()
    o.data.materials.append(mat)
print('[wolf] 材质已设为灰褐毛色')

for o in meshes:
    mod = o.modifiers.new('dec', 'DECIMATE')
    mod.ratio = 0.4
bpy.context.view_layer.update()
for o in meshes:
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.modifier_apply(modifier='dec')
    o.select_set(False)
print('[wolf] 已减面 40%%: %d 面' % sum(len(o.data.polygons) for o in meshes))

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB',
                          export_image_format='WEBP',
                          export_animations=False)
print('[wolf] 已导出:', dst)
