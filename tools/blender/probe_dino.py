# 探测 dino.fbx（二进制）：网格/尺寸/朝向 + 顶/侧视图渲染
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = argv[0] if argv else 'assets_src/mixamo/dino.fbx'
outdir = argv[1] if len(argv) > 1 else os.path.dirname(os.path.abspath(__file__))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print('[dino] 网格:', [(o.name, len(o.data.polygons)) for o in meshes])
print('[dino] 材质:', [m.name for m in bpy.data.materials])
print('[dino] 骨架:', [o.name for o in bpy.data.objects if o.type == 'ARMATURE'])
print('[dino] 动画:', [a.name for a in bpy.data.actions])

lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
bpy.context.view_layer.update()
for o in meshes:
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        for k in range(3):
            lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
size = hi - lo
print('[dino] 尺寸: (%.2f, %.2f, %.2f)' % (size.x, size.y, size.z))
print('[dino] 范围 x[%.2f,%.2f] y[%.2f,%.2f] z[%.2f,%.2f]' % (lo.x, hi.x, lo.y, hi.y, lo.z, hi.z))

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
span = max(size.x, size.y) * 1.2
for name, loc, rot in [('top', (cx, cy, hi.z + 30), (0, 0, 0)),
                       ('front', (cx, lo.y - 30, (lo.z + hi.z) / 2), (math.pi / 2, 0, 0))]:
    cd = bpy.data.cameras.new(name); cd.type = 'ORTHO'; cd.ortho_scale = span
    cam = bpy.data.objects.new(name, cd); scene.collection.objects.link(cam)
    cam.location = loc; cam.rotation_euler = rot
    scene.camera = cam
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.filepath = os.path.join(outdir, 'dino_%s.png' % name)
    bpy.ops.render.render(write_still=True)
print('[dino] 已渲染 dino_top/front.png ->', outdir)
