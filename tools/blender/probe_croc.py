# 探测 crocodile.fbx：网格列表 / 包围盒 / 前端(头部)在哪根轴
import bpy, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = argv[0] if argv else 'assets_src/mixamo/crocodile.fbx'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print('[probe] 网格:', [(o.name, len(o.data.polygons)) for o in meshes])
print('[probe] 材质:', [m.name for m in bpy.data.materials])

lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in meshes:
    bpy.context.view_layer.update()
    mw = o.matrix_world
    for v in o.data.vertices:
        w = mw @ v.co
        for k in range(3):
            lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
size = hi - lo
print('[probe] 尺寸: x=%.3f y=%.3f z=%.3f' % (size.x, size.y, size.z))
print('[probe] 范围: x[%.2f,%.2f] y[%.2f,%.2f] z[%.2f,%.2f]' % (lo.x, hi.x, lo.y, hi.y, lo.z, hi.z))

# 每个网格的包围盒（判断头/尾分块）
for o in meshes:
    bpy.context.view_layer.update()
    blo = Vector((1e9,) * 3); bhi = Vector((-1e9,) * 3)
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        for k in range(3):
            blo[k] = min(blo[k], w[k]); bhi[k] = max(bhi[k], w[k])
    c = (blo + bhi) / 2
    print('[probe] %-22s 中心=(%.2f, %.2f, %.2f) 尺寸=(%.2f, %.2f, %.2f)' %
          (o.name, c.x, c.y, c.z, bhi.x - blo.x, bhi.y - blo.y, bhi.z - blo.z))
