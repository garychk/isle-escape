# dino.fbx（二进制，单网格 15k 面，无骨骼）→ dino.glb
# 源：头 +X、背 +Z（Blender Z-up 趴伏）；导出器自动 Z-up→Y-up 后头需落在 glTF +Z
# 目标：体长 2.6m 的迅猛龙，原点=底部中心，材质暗橄榄棕
# 用法: blender --background --python tools/blender/build_dino.py -- <in.fbx> <out.glb>
import bpy, sys, os, math
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = argv[0] if argv else 'assets_src/mixamo/dino.fbx'
dst = argv[1] if len(argv) > 1 else 'assets/dino.glb'
TARGET_LEN = 2.6

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
assert meshes, '没有网格'
bpy.context.view_layer.update()
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in meshes:
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        for k in range(3):
            lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
size = hi - lo
s = TARGET_LEN / max(size.x, size.y, size.z)
print('[dino] 原始尺寸 (%.2f, %.2f, %.2f) -> 缩放 %.4f (体长 %.1fm)' % (size.x, size.y, size.z, s, TARGET_LEN))

# 头 +X -> 头 -Y（Rz(-90°)），导出转换 (x,y,z)→(x,z,-y) 后头即 glTF +Z；底部中心=原点
cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
M = Matrix.Rotation(math.radians(-90), 4, 'Z') \
  @ Matrix.Scale(s, 4) \
  @ Matrix.Translation((-cx, -cy, -lo.z))
for o in meshes:
    o.matrix_world = M @ o.matrix_world

# 源材质为 phong（导入常丢色），统一设成丛林迅猛龙配色
mat = bpy.data.materials.new('dino_skin')
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value = (0.23, 0.21, 0.10, 1.0)
bsdf.inputs['Roughness'].default_value = 0.85
bsdf.inputs['Metallic'].default_value = 0.0
for o in meshes:
    o.data.materials.clear()
    o.data.materials.append(mat)
print('[dino] 材质已设为暗橄榄棕')

# 15k 面偏多，减到 ~40% 控制单文件体积
for o in meshes:
    mod = o.modifiers.new('dec', 'DECIMATE')
    mod.ratio = 0.4
bpy.context.view_layer.update()
for o in meshes:
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.modifier_apply(modifier='dec')
    o.select_set(False)
print('[dino] 已减面 40%%: %d 面' % sum(len(o.data.polygons) for o in meshes))

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB',
                          export_image_format='WEBP',
                          export_animations=False)
print('[dino] 已导出:', dst)
