# 验证 croc.glb 最终朝向：导入 → 打印包围盒 → 渲染侧视/顶视
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = argv[0] if argv else 'assets/croc.glb'
outdir = argv[1] if len(argv) > 1 else os.path.dirname(os.path.abspath(__file__))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
bpy.context.view_layer.update()
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in objs:
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        for k in range(3):
            lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
print('[verify] GLB 尺寸: x(%.2f) y(%.2f) z(%.2f)' % (hi.x - lo.x, hi.y - lo.y, hi.z - lo.z))
print('[verify] 范围 x[%.2f,%.2f] y[%.2f,%.2f] z[%.2f,%.2f]' % (lo.x, hi.x, lo.y, hi.y, lo.z, hi.z))
print('[verify] 期望: y 薄(高度~0.5) 且 y_min≈0；z 长(3.6)；z 正端=头')

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
cx, cz = (lo.x + hi.x) / 2, (lo.z + hi.z) / 2
span = max(hi.x - lo.x, hi.z - lo.z) * 1.2
cam_d = bpy.data.cameras.new('c'); cam_d.type = 'ORTHO'; cam_d.ortho_scale = span
cam = bpy.data.objects.new('c', cam_d); scene.collection.objects.link(cam)
cam.location = (cx, (lo.y + hi.y) / 2 - 5, cz); cam.rotation_euler = (math.pi / 2, 0, 0)  # 侧视: 从-Y看
scene.camera = cam
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.filepath = os.path.join(outdir, 'croc_glb_side.png')
bpy.ops.render.render(write_still=True)
cam.rotation_euler = (0, 0, 0); cam.location = (cx, (lo.y + hi.y) / 2 + 5, cz + 30)  # 顶视
scene.render.filepath = os.path.join(outdir, 'croc_glb_top.png')
bpy.ops.render.render(write_still=True)
print('[verify] 已渲染 croc_glb_side/top.png')
