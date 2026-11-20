# -*- coding: utf-8 -*-
# 分阶段渲染定位机身丢失：import → join → bake → decimate → normals
import bpy, os, math
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = r"D:/Downloads/直升机2/source/Helicopter.fbx"
PV = os.path.dirname(os.path.abspath(__file__))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = 480; sc.render.resolution_y = 480
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam); sc.camera = cam

def snap(tag):
    all_mesh = [o for o in bpy.data.objects if o.type == 'MESH']
    mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
    for o in all_mesh:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    c = (mn + mx) / 2
    R = max(mx - mn) * 1.5
    v = Vector((1.0, -1.0, 0.6)).normalized()
    cam.location = c + v * R * 2.0
    cam.rotation_euler = (Vector(c) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(PV, f"heli_stage_{tag}.png")
    bpy.ops.render.render(write_still=True)
    print("STAGE", tag, "bbox", [round(x,1) for x in mn], [round(x,1) for x in mx],
          "meshes", [(o.name, len(o.data.polygons)) for o in all_mesh])

snap("1_import")

# join
cyl = bpy.data.objects.get('Cylinder001'); nody = bpy.data.objects.get('Nody')
bpy.ops.object.select_all(action='DESELECT')
cyl.select_set(True); bpy.context.view_layer.objects.active = cyl
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
nody.select_set(True); bpy.context.view_layer.objects.active = nody
bpy.ops.object.join()
snap("2_join")

# bake
rot = bpy.data.objects.get('Rot'); rot2 = bpy.data.objects.get('Rot2')
bpy.ops.object.select_all(action='DESELECT')
for o in (nody, rot, rot2): o.select_set(True)
bpy.context.view_layer.objects.active = nody
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
def bake(o):
    M = o.matrix_world.copy(); loc = M.to_translation()
    delta = Matrix.Translation(loc).inverted() @ M
    o.data.transform(delta)
    o.location = loc; o.rotation_euler = (0,0,0); o.scale = (1,1,1)
    o.matrix_world = Matrix.Translation(loc)
for o in (nody, rot, rot2): bake(o)
snap("3_bake")

# decimate
md = nody.modifiers.new('dec', 'DECIMATE'); md.ratio = 0.16
bpy.ops.object.select_all(action='DESELECT'); nody.select_set(True)
bpy.context.view_layer.objects.active = nody
bpy.ops.object.modifier_apply(modifier='dec')
snap("4_decimate")

bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')
snap("5_normals")
