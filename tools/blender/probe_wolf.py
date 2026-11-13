# 探测 wolf.fbx（二进制）：网格/尺寸/朝向 + 顶视图渲染
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = argv[0] if argv else 'assets_src/mixamo/wolf.fbx'
outdir = argv[1] if len(argv) > 1 else os.path.dirname(os.path.abspath(__file__))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print('[wolf] 网格:', [(o.name, len(o.data.polygons)) for o in meshes][:10])
print('[wolf] 材质:', [m.name for m in bpy.data.materials][:10])
print('[wolf] 骨架:', [o.name for o in bpy.data.objects if o.type == 'ARMATURE'][:5])
print('[wolf] 动画:', [a.name for a in bpy.data.actions][:8])

lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
bpy.context.view_layer.update()
for o in meshes:
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        for k in range(3):
            lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
size = hi - lo
print('[wolf] 尺寸: (%.2f, %.2f, %.2f)' % (size.x, size.y, size.z))
print('[wolf] 范围 x[%.2f,%.2f] y[%.2f,%.2f] z[%.2f,%.2f]' % (lo.x, hi.x, lo.y, hi.y, lo.z, hi.z))

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
span = max(size.x, size.y, size.z) * 1.2
cd = bpy.data.cameras.new('top'); cd.type = 'ORTHO'; cd.ortho_scale = span
cam = bpy.data.objects.new('top', cd); scene.collection.objects.link(cam)
cam.location = (cx, cy, hi.z + 30); cam.rotation_euler = (0, 0, 0)
scene.camera = cam
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.filepath = os.path.join(outdir, 'wolf_top.png')
bpy.ops.render.render(write_still=True)
print('[wolf] 已渲染 wolf_top.png')
