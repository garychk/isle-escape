import bpy, os
from mathutils import Vector

GLB = os.path.abspath('assets/heli.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

for name in ('Nody', 'Rot', 'Rot2'):
    o = bpy.data.objects.get(name)
    if not o:
        print(name, 'MISSING'); continue
    mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        for i in range(3):
            mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    c = (mn + mx) / 2
    print(name, 'bbox min', [round(v,3) for v in mn], 'max', [round(v,3) for v in mx], 'center', [round(v,3) for v in c])

print('== pivots vs centers (world):')
for name in ('Nody', 'Rot', 'Rot2'):
    o = bpy.data.objects.get(name)
    if not o: continue
    loc = o.matrix_world.to_translation()
    print('   ', name, 'pivot', [round(v, 3) for v in loc])
