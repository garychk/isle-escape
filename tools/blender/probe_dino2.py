# -*- coding: utf-8 -*-
# 探测新恐龙素材：骨骼、动画、尺寸、贴图，并渲染顶视/侧视确认朝向与姿态
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SRC = argv[0] if argv else 'assets_src/mixamo/dino_probe.fbx'
OUTDIR = 'E:/WorkBuddy/2026-11-12-16-39-59/isle-escape/tools/blender'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print('[p2] armatures=%d meshes=%d' % (len(arms), len(meshes)), flush=True)
for o in meshes:
    print('[p2] mesh %s verts=%d polys=%d mats=%s' % (
        o.name, len(o.data.vertices), len(o.data.polygons), [m.name if m else None for m in o.data.materials]), flush=True)
print('[p2] actions:', [(a.name, tuple(round(v) for v in a.frame_range)) for a in bpy.data.actions], flush=True)
for im in bpy.data.images:
    print('[p2] image', im.name, im.size[0], im.size[1], 'packed' if im.packed_file else 'external', flush=True)
if arms:
    a = arms[0]
    print('[p2] bones=%d' % len(a.data.bones), flush=True)
    print('[p2] 骨骼名前12:', [b.name for b in a.data.bones][:12], flush=True)
    if a.animation_data:
        print('[p2] active action:', a.animation_data.action.name if a.animation_data.action else None,
              'nla:', [t.name for t in a.animation_data.nla_tracks], flush=True)

bpy.context.view_layer.update()
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in meshes:
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        for k in range(3):
            lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
print('[p2] 绑定范围 x[%.2f,%.2f] y[%.2f,%.2f] z[%.2f,%.2f] 尺寸 %.2f x %.2f x %.2f' % (
    lo.x, hi.x, lo.y, hi.y, lo.z, hi.z, hi.x - lo.x, hi.y - lo.y, hi.z - lo.z), flush=True)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x = scene.render.resolution_y = 480
cx, cy, cz = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2
span = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)


def shoot(name, loc, quat, scale):
    cd = bpy.data.cameras.new('c_' + name)
    cd.type = 'ORTHO'; cd.ortho_scale = scale
    cam = bpy.data.objects.new('c_' + name, cd)
    scene.collection.objects.link(cam)
    cam.rotation_mode = 'QUATERNION'; cam.rotation_quaternion = quat
    cam.location = loc
    scene.camera = cam
    scene.render.filepath = os.path.join(OUTDIR, 'dino2_%s.png' % name)
    bpy.ops.render.render(write_still=True)
    print('[p2] shot', name, flush=True)


# 顶视：从 +Z 往下看，图像上 = +Y，右 = +X
shoot('top', (cx, cy, hi.z + span * 1.5), (0.7071, 0.7071, 0, 0), span * 1.4)
# 侧视：从 +X 看，图像上 = +Z，右 = +Y
shoot('side', (hi.x + span * 2, cy, cz), (0.5, 0.5, 0.5, 0.5), span * 1.3)
print('[p2] OK', flush=True)
