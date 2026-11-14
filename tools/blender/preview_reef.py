# 预览 drone-island.fbx 的三维形态（Workbench 贴图模式，多角度）
# 用途：确认礁石地形的起伏、水线位置、以及哪块区域适合裁成近景礁石
import bpy, os, math
from mathutils import Vector

SRC = r"D:/Downloads/ocean_rocky_island/source/drone-island.fbx"
OUT = r"E:/WorkBuddy/2026-11-12-16-39-59/qa"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name != 'Model':
        bpy.data.objects.remove(o, do_unlink=True)
obj = bpy.data.objects['Model']
print('MESH', obj.name, len(obj.data.polygons))

# 8K 贴图在预览里没必要，先降采样省内存
for img in bpy.data.images:
    if img.size[0] > 2048:
        print('SCALE IMG', img.name, list(img.size))
        img.scale(2048, 2048)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
sh = scene.display.shading
sh.light = 'STUDIO'
sh.color_type = 'TEXTURE'
sh.show_shadows = True
sh.show_cavity = True
sh.cavity_type = 'BOTH'
sh.background_type = 'WORLD'
if scene.world is None:
    scene.world = bpy.data.worlds.new('PreviewWorld')
scene.world.color = (0.16, 0.19, 0.22)
scene.render.resolution_x = 900
scene.render.resolution_y = 620
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'

cam_data = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 430
cam_data.clip_end = 3000

target = Vector((0, 0, 8))
views = [
    ('top', (0, 0, 600)),
    ('iso_s', (330, -360, 250)),
    ('iso_n', (-300, 350, 230)),
    ('side', (0, -620, 60)),
]
for name, pos in views:
    cam.location = pos
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(OUT, 'reef_prev_' + name + '.png')
    bpy.ops.render.render(write_still=True)
    print('RENDER', name, scene.render.filepath)
print('PREVIEW_OK')
