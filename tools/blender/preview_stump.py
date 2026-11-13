# 渲染 stump.glb 预览图（Workbench，三视角）
import bpy, sys, os, math

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = argv[0] if argv else 'assets/stump.glb'
outdir = argv[1] if len(argv) > 1 else 'tools/blender'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

lo = [1e9]*3; hi = [-1e9]*3
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        for c in o.bound_box:
            w = o.matrix_world @ __import__('mathutils').Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
print('[pv] bounds lo', ['%.2f'%v for v in lo], 'hi', ['%.2f'%v for v in hi])

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x = 640
scene.render.resolution_y = 480
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new('w')

cx = (lo[0]+hi[0])/2; cy = (lo[1]+hi[1])/2; cz = (lo[2]+hi[2])/2
r = max(hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2]) * 1.6

cam_data = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(30))

views = {'front': (0, -r, 0), 'side': (r, 0, 0), 'iso': (r*0.7, -r*0.7, r*0.55)}
from mathutils import Vector
for name, off in views.items():
    cam.location = (cx+off[0], cy+off[1], cz+off[2])
    d = Vector((cx, cy, cz)) - cam.location
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = d.to_track_quat('-Z', 'Y')
    scene.render.filepath = os.path.join(outdir, 'stump_pv_%s.png' % name)
    bpy.ops.render.render(write_still=True)
    print('[pv] wrote', scene.render.filepath)
