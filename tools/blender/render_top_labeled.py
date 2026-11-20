# 顶视图渲染（带 y 刻度线）：肉眼确认白色舱罩盒位置
import bpy, os, math
from mathutils import Vector

GLB = os.path.abspath('assets/heli.glb')
OUT = os.path.abspath('tools/blender/heli_top_labeled.png')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = 900
sc.render.resolution_y = 1400

# y 刻度线：细长立方体放在地面上方（不遮机身），每 0.5m 一条
mat = bpy.data.materials.new('mark')
mat.diffuse_color = (1, 0, 0, 1)
for y in [x * 0.5 for x in range(-4, 10)]:
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0.95, y, 1.0))
    o = bpy.context.object
    o.scale = (0.02, 0.004, 0.004)
    o.data.materials.append(mat)

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam); sc.camera = cam
cam.location = (0, 1.3, 14)
cam.rotation_euler = (0, 0, 0)   # 垂直向下，+Y 朝上
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 4.5
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('written', OUT)
