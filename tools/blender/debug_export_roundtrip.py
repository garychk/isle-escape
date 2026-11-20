# -*- coding: utf-8 -*-
# 验证 v8 修复流程中 matrix_parent_inverse 的影响：导入 → 打印矩阵 → 平移网格+重定位 → 导出前后对照
import bpy, os, math
from mathutils import Vector, Matrix
GLB = os.path.abspath('assets/heli.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
rot = bpy.data.objects['Rot']
print('rot matrix_parent_inverse:', [round(v, 3) for v in rot.matrix_parent_inverse.to_translation()])
print('rot location:', [round(v, 4) for v in rot.location])
print('rot matrix_world t:', [round(v, 4) for v in rot.matrix_world.to_translation()])
print('parent(HeliRoot) world t:', [round(v, 4) for v in rot.parent.matrix_world.to_translation()])
Mw = rot.matrix_world
ring = [Mw @ v.co for v in rot.data.vertices if abs((Mw @ v.co).z - 2.45) < 0.02]
print('ring z2.45 centroid:', [round(sum(p[i] for p in ring) / len(ring), 4) for i in range(3)])
# 模拟 v8 操作
rot.data.transform(Matrix.Translation((0, 0.07, 0)))
bpy.context.view_layer.update()
loc = rot.matrix_world.to_translation()
par_inv = rot.parent.matrix_world.inverted()
rot.location = par_inv @ Vector((-0.1062, 0.0831, loc.z))
rot.rotation_euler = (0, 0, 0); rot.scale = (1, 1, 1)
bpy.context.view_layer.update()
Mw2 = rot.matrix_world
ring2 = [Mw2 @ v.co for v in rot.data.vertices if abs((Mw2 @ v.co).z - 2.45) < 0.02]
print('AFTER: matrix_world t:', [round(v, 4) for v in Mw2.to_translation()])
print('AFTER ring centroid:', [round(sum(p[i] for p in ring2) / len(ring2), 4) for i in range(3)])
print('AFTER location:', [round(v, 4) for v in rot.location])
bpy.ops.export_scene.gltf(filepath='/tmp/heli_test.glb', export_format='GLB', export_apply=False, export_yup=True)
print('exported')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='/tmp/heli_test.glb')
r2 = bpy.data.objects['Rot']
print('REIMPORT origin:', [round(v, 4) for v in r2.matrix_world.to_translation()])
Mw3 = r2.matrix_world
ring3 = [Mw3 @ v.co for v in r2.data.vertices if abs((Mw3 @ v.co).z - 2.45) < 0.03]
if ring3:
    print('REIMPORT ring centroid:', [round(sum(p[i] for p in ring3) / len(ring3), 4) for i in range(3)])
