# crocodile.fbx（ASCII，Unity 导出，外部贴图缺失）→ croc.glb
# 处理链：自研 ASCII 解析 → Blender 网格 → 头朝 -Z → 总长 3.6m → 底部中心=原点 → GLB
# 用法: blender --background --python tools/blender/build_croc.py -- <in.fbx> <out.glb>
import bpy, sys, os, math
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from croc_fbx_lib import import_ascii_fbx, bbox

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = argv[0] if argv else 'assets_src/mixamo/crocodile.fbx'
dst = argv[1] if len(argv) > 1 else 'assets/croc.glb'
TARGET_LEN = 3.6  # 目标体长（米），与程序化鳄鱼体型相当

bpy.ops.wm.read_factory_settings(use_empty=True)
made = import_ascii_fbx(src)
assert made, '没有导入任何网格'
lo, hi = bbox(made)
size = hi - lo
s = TARGET_LEN / max(size.x, size.y, size.z)
print('[croc] 原始尺寸 (%.2f, %.2f, %.2f) -> 缩放 %.4f (体长 %.2fm)' % (size.x, size.y, size.z, s, TARGET_LEN))

# 源模型 Blender 空间：头 +Y、背 +Z（已趴伏）。
# glTF 导出器自动做 Z-up→Y-up 转换 (x,y,z)→(x,z,-y)，只需 Rz(180°) 把头转到 -Y，
# 转换后即 glTF 的头 +Z（野兽 AI 前进方向）、背 +Y。不要再叠 Rx，否则模型会立起来。
cx, cz = (lo.x + hi.x) / 2, (lo.z + hi.z) / 2
M = Matrix.Rotation(math.radians(180), 4, 'Z') \
  @ Matrix.Scale(s, 4) \
  @ Matrix.Translation((-cx, -lo.y, -cz))
for o in made:
    o.matrix_world = M @ o.matrix_world

# 贴图为外部引用（crocodile.png 缺失）——显式设沼泽鳄暗橄榄绿
mat = bpy.data.materials.new('croc_skin')
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value = (0.145, 0.165, 0.09, 1.0)
bsdf.inputs['Roughness'].default_value = 0.85
bsdf.inputs['Metallic'].default_value = 0.0
for o in made:
    o.data.materials.clear()
    o.data.materials.append(mat)
print('[croc] 材质已设为暗橄榄绿')

# 1772 面本身是低模，不再减面
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB',
                          export_image_format='WEBP',
                          export_animations=False)
print('[croc] 已导出:', dst)
