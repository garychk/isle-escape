# 战术刀 FBX → GLB（knife.glb）
# 约定（与 rifle 一致）：原点=握把中心，刀尖朝 -Z，刀身竖直平面内
# 源模型：刀尖 -Y、握把 +Y 端（Pipe 网格 y 1.63~3.29），总长 8.27 → 缩放到 0.72m
# 用法: blender --background --python tools/blender/build_knife.py -- <in.fbx> <out.glb>
import bpy, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = argv[0] if argv else 'assets_src/mixamo/weapon.fbx'
dst = argv[1] if len(argv) > 1 else 'assets/knife.glb'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print('[knife] 网格:', [o.name for o in meshes])

lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in meshes:
    bpy.context.view_layer.update()
    mw = o.matrix_world
    for v in o.data.vertices:
        w = mw @ v.co
        for k in range(3):
            lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
size = hi - lo
print('[knife] 原始尺寸: %.3f x %.3f x %.3f' % (size.x, size.y, size.z))

# 握把中心：取 Pipe（握把段）网格的 y 中点，x/z 用整体包围盒中心
pipe = next((o for o in meshes if o.name.lower().startswith('pipe')), None)
gripY = None
if pipe:
    bpy.context.view_layer.update()
    ys = [(pipe.matrix_world @ v.co).y for v in pipe.data.vertices]
    gripY = (min(ys) + max(ys)) / 2
    print('[knife] 握把段 y 中心: %.3f' % gripY)
else:
    gripY = hi.y - size.y * 0.12   # 兜底：高端往里 12%

cx, cz = (lo.x + hi.x) / 2, (lo.z + hi.z) / 2
s = 0.30 / max(size.x, size.y, size.z)
print('[knife] 缩放: %.4f (总长 -> 0.30m)' % s)

# M = 旋转(刀尖 -Y -> -Z) × 缩放 × 平移(握把中心->原点)
M = Matrix.Rotation(math.radians(90), 4, 'X') \
  @ Matrix.Scale(s, 4) \
  @ Matrix.Translation((-cx, -gripY, -cz))
for o in meshes:
    o.matrix_world = M @ o.matrix_world

# 清理空对象
for o in list(bpy.data.objects):
    if o.type == 'EMPTY':
        bpy.data.objects.remove(o, do_unlink=True)

# FBX 材质导入常丢失颜色（游戏里变白）——显式设为战术刀暗金属
for m in bpy.data.materials:
    if not m.use_nodes: continue
    for n in m.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            n.inputs['Base Color'].default_value = (0.045, 0.047, 0.05, 1.0)
            n.inputs['Metallic'].default_value = 0.4
            n.inputs['Roughness'].default_value = 0.45
print('[knife] 材质已设为暗金属')

# 减面：94k 三角面对一把小刀太浪费（dist 单文件体积会膨胀），保留 40%
for o in meshes:
    mod = o.modifiers.new('dec', 'DECIMATE')
    mod.ratio = 0.4
bpy.context.view_layer.update()
for o in meshes:
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.modifier_apply(modifier='dec')
    o.select_set(False)
print('[knife] 已减面 40%')

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB',
                          export_image_format='WEBP',
                          export_animations=False)
print('[knife] 已导出:', dst)
