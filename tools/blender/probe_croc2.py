# 探测 crocodile.fbx（ASCII）：解析网格 + 渲染顶/前视图确认头部朝向
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from croc_fbx_lib import parse_ascii_fbx, find_all, import_ascii_fbx, bbox

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = argv[0] if argv else 'assets_src/mixamo/crocodile.fbx'
outdir = argv[1] if len(argv) > 1 else os.path.dirname(os.path.abspath(__file__))

bpy.ops.wm.read_factory_settings(use_empty=True)
made = import_ascii_fbx(src)
lo, hi = bbox(made)
size = hi - lo
print('[croc] 包围盒: 尺寸=(%.2f, %.2f, %.2f)' % (size.x, size.y, size.z))
print('[croc] x[%.2f,%.2f] y[%.2f,%.2f] z[%.2f,%.2f]' % (lo.x, hi.x, lo.y, hi.y, lo.z, hi.z))

# 顶视图渲染（确认头朝哪根轴哪个方向）
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
span = max(size.x, size.y) * 1.15

cam_data = bpy.data.cameras.new('top'); cam_data.type = 'ORTHO'; cam_data.ortho_scale = span
cam = bpy.data.objects.new('top', cam_data); scene.collection.objects.link(cam)
cam.location = (cx, cy, hi.z + 30); cam.rotation_euler = (0, 0, 0)  # 看向 -Z
scene.camera = cam
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.filepath = os.path.join(outdir, 'croc_top.png')
bpy.ops.render.render(write_still=True)

cam_data2 = bpy.data.cameras.new('front'); cam_data2.type = 'ORTHO'; cam_data2.ortho_scale = span
cam2 = bpy.data.objects.new('front', cam_data2); scene.collection.objects.link(cam2)
cam2.location = (cx, lo.y - 30, (lo.z + hi.z) / 2); cam2.rotation_euler = (math.pi / 2, 0, 0)
scene.camera = cam2
scene.render.filepath = os.path.join(outdir, 'croc_front.png')
bpy.ops.render.render(write_still=True)
print('[croc] 已渲染 croc_top.png / croc_front.png ->', outdir)
