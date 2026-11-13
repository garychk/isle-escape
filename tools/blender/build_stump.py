# Broken_Stump_rkswd_Low.fbx（二进制，外部 PBR 贴图路径已失效）→ stump.glb
# 处理链：Blender FBX 导入 → 清父级+应用变换（fbx 带 0.01 物体缩放）→ 手动接 PBR 贴图
#        → 底部中心=原点 → 高度归一 → GLB
# 用法: blender --background --python tools/blender/build_stump.py -- <in.fbx> <out.glb>
import bpy, sys, os

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = argv[0] if argv else 'assets_src/stump/Broken_Stump_rkswd_Low.fbx'
dst = argv[1] if len(argv) > 1 else 'assets/stump.glb'
TARGET_H = 0.95  # 树桩目标高度（米）

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
assert meshes, '没有导入任何网格'
print('[stump] 网格:', [o.name for o in meshes])

# —— 清父级并应用全部变换：FBX 常挂 0.01 的物体缩放（cm→m），不应用会污染后续归一 ——
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# —— 贴图：FBX 里引用的贴图路径已失效（c:\Python37\*.jpg），按 PBR 四件套手动接入 ——
texdir = os.path.dirname(os.path.abspath(src))
def find_tex(kw):
    for f in sorted(os.listdir(texdir)):
        if kw.lower() in f.lower() and f.lower().endswith('.jpg'):
            return os.path.join(texdir, f)
    return None

def wire_pbr(mat, base, nrm, rough):
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    # 只保留 BSDF 与材质输出节点（输出节点删了导出器会丢弃贴图）
    for n in list(nt.nodes):
        if n.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'):
            nt.nodes.remove(n)
    def img_node(path, srgb):
        img = bpy.data.images.load(path)
        if hasattr(img, 'colorspace_settings'):
            img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        n.location = (-600, 0)
        return n
    n = img_node(base, True)
    nt.links.new(n.outputs['Color'], bsdf.inputs['Base Color'])
    n = img_node(rough, False)
    nt.links.new(n.outputs['Color'], bsdf.inputs['Roughness'])
    if nrm:
        n = img_node(nrm, False)
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.location = (-300, -300)
        nt.links.new(n.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Metallic'].default_value = 0.0

base = find_tex('BaseColor')
nrm = find_tex('Normal')
rough = find_tex('Roughness')
for o in meshes:
    if not o.data.materials:
        o.data.materials.append(bpy.data.materials.new('stump_bark'))
    for mat in o.data.materials:
        if mat:
            wire_pbr(mat, base, nrm, rough)
print('[stump] 材质已接 PBR: base=%s nrm=%s rough=%s' % (base, nrm, rough))

# —— 归一：底部中心 = 原点，高度 = TARGET_H（直接变换网格数据，绕开物体级矩阵陷阱） ——
from mathutils import Vector, Matrix
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in meshes:
    for v in o.data.vertices:
        w = v.co
        lo.x = min(lo.x, w.x); lo.y = min(lo.y, w.y); lo.z = min(lo.z, w.z)
        hi.x = max(hi.x, w.x); hi.y = max(hi.y, w.y); hi.z = max(hi.z, w.z)
size = hi - lo
s = TARGET_H / max(size.z, 0.001)
print('[stump] 应用变换后尺寸 (%.2f, %.2f, %.2f) -> 缩放 %.4f' % (size.x, size.y, size.z, s))
cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
M = Matrix.Scale(s, 4) @ Matrix.Translation((-cx, -cy, -lo.z))
for o in meshes:
    o.data.transform(M)

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB',
                          export_image_format='WEBP',
                          export_animations=False)
print('[stump] 已导出:', dst)
