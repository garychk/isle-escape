# 候选姿态对比： bake 指定动作帧 → Rz(180°) 归一 → 侧视渲染（图像右=+Y，上=+Z）
import bpy, os, math, sys
from mathutils import Vector, Matrix

BASE = 'E:/WorkBuddy/2026-11-12-16-39-59/isle-escape'
CANDS = [('Walk', 61)]
ROT = Matrix.Rotation(math.radians(180), 4, 'Y')

for act_name, fr in CANDS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=BASE + '/assets_src/mixamo/wolf.fbx')
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    act = next(a for a in bpy.data.actions if a.name == 'Armature|Hyenas_A15_%s' % act_name)
    arm.animation_data.action = act
    arm.animation_data.action_slot = act.slots[0]
    bpy.context.scene.frame_set(fr)
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    for o in meshes:
        ob_eval = o.evaluated_get(deps)
        baked = bpy.data.meshes.new_from_object(ob_eval)
        old = o.data; o.data = baked; o.modifiers.clear()
        if old.users == 0:
            bpy.data.meshes.remove(old)
    for a2 in [o for o in bpy.data.objects if o.type == 'ARMATURE']:
        bpy.data.objects.remove(a2, do_unlink=True)
    bpy.context.view_layer.update()
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in meshes:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            for k in range(3):
                lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
    s = 1.9 / max(hi - lo)
    M = ROT @ Matrix.Scale(s, 4) @ Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
    for o in meshes:
        o.matrix_world = M @ o.matrix_world
    bpy.context.view_layer.update()
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in meshes:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            for k in range(3):
                lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    cy, cz = (lo.y + hi.y) / 2, (lo.z + hi.z) / 2
    cd = bpy.data.cameras.new('c'); cd.type = 'ORTHO'; cd.ortho_scale = 2.4
    cam = bpy.data.objects.new('c', cd); scene.collection.objects.link(cam)
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (0.5, 0.5, 0.5, 0.5)  # 视线 -X，图像右=+Y，图像上=+Z
    cam.location = (hi.x + 5, cy, cz)
    scene.camera = cam
    scene.render.resolution_x = scene.render.resolution_y = 320
    fp = BASE + '/tools/blender/wolf_t_%s_%d.png' % (act_name, fr)
    scene.render.filepath = fp
    bpy.ops.render.render(write_still=True)
    print('[t] done %s %d' % (act_name, fr))
print('[t] ALL DONE')
