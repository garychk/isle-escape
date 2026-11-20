# -*- coding: utf-8 -*-
# 单独测试 transform_apply 对负缩放对象的行为
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=r"D:/Downloads/直升机2/source/Helicopter.fbx")
nody = bpy.data.objects.get('Nody')
print("before:", nody.location[:], nody.scale[:], nody.rotation_euler[:])
bpy.ops.object.select_all(action='DESELECT')
nody.select_set(True)
bpy.context.view_layer.objects.active = nody
try:
    r = bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    print("apply result:", r, "| HAD_ERROR" if r != {'FINISHED'} else "| OK")
except Exception as e:
    print("apply exception:", e)
bpy.context.view_layer.update()
print("after: loc", nody.location[:], "scale", nody.scale[:], "rot", nody.rotation_euler[:])
bb = nody.data.vertices[0].co.copy(); 
import mathutils
mn = mathutils.Vector(bb); mx = mathutils.Vector(bb)
for v in nody.data.vertices:
    for i in range(3):
        mn[i] = min(mn[i], v.co[i]); mx[i] = max(mx[i], v.co[i])
print("mesh local bbox:", [round(x,1) for x in mn], [round(x,1) for x in mx])
