# 急救箱 FBX → GLB（medkit.glb）
# 约定：原点在箱子底部中心，+Y 上方（红十字盖朝上），符合"地面拾取物"摆放
# 用法: blender --background --python tools/blender/build_medkit.py -- <in.fbx> <out.glb>
import bpy, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = argv[0] if argv else 'assets_src/mixamo/medkit_son.fbx'
dst = argv[1] if len(argv) > 1 else 'assets/medkit.glb'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print('[medkit] 导入网格:', [o.name for o in meshes])
print('[medkit] 动作数:', len(bpy.data.actions))  # 应为 0，纯模型

# 世界包围盒
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in meshes:
    bpy.context.view_layer.update()
    mw = o.matrix_world
    for v in o.data.vertices:
        w = mw @ v.co
        for k in range(3):
            lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
size = hi - lo
print('[medkit] 原始尺寸: %.3f x %.3f x %.3f' % (size.x, size.y, size.z))

# 目标：最长边归一到 0.45m（拾取物要显眼）；先平移"底部中心"到原点，再统一缩放
s = 0.45 / max(size.x, size.y, size.z)
M = Matrix.Scale(s, 4) @ Matrix.Translation((-(lo.x + hi.x) / 2, -lo.y, -(lo.z + hi.z) / 2))
print('[medkit] 缩放: %.3f' % s)
for o in meshes:
    o.matrix_world = M @ o.matrix_world

# 清理空对象（纯模型无骨架，防污染导出）
for o in list(bpy.data.objects):
    if o.type == 'EMPTY':
        bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB',
                          export_image_format='WEBP',
                          export_animations=False)
print('[medkit] 已导出:', dst)
