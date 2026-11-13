# 验证 wolf.glb：尺寸 + 侧视渲染（从 -Y 看，+Z 朝右 = 头应在右侧）
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = argv[0] if argv else 'assets/wolf.glb'
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
print('[verify] GLB 尺寸: x(%.2f) y(%.2f) z(%.2f)，z 正端应为头' % (hi.x - lo.x, hi.y - lo.y, hi.z - lo.z))

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
cx, cz = (lo.x + hi.x) / 2, (lo.z + hi.z) / 2
span = max(hi.x - lo.x, hi.z - lo.z) * 1.3
cd = bpy.data.cameras.new('c'); cd.type = 'ORTHO'; cd.ortho_scale = span
cam = bpy.data.objects.new('c', cd); scene.collection.objects.link(cam)
cam.location = (cx, lo.y - 5, cz); cam.rotation_euler = (math.pi / 2, 0, 0)
scene.camera = cam
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.filepath = os.path.join(outdir, 'wolf_glb_side.png')
bpy.ops.render.render(write_still=True)
print('[verify] 已渲染 wolf_glb_side.png')
