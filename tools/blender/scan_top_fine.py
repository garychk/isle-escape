import bpy, os
GLB = os.path.abspath('assets/heli.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
nody = bpy.data.objects['Nody']
M = nody.matrix_world
pts = [M @ v.co for v in nody.data.vertices]
print('== fine scan y in [0.8, 3.2], bin 0.2:')
for i in range(int((3.2-0.8)/0.2)):
    y0 = 0.8 + i*0.2; y1 = y0 + 0.2
    sel = [p for p in pts if y0 <= p.y < y1 and p.z > 1.3]
    if not sel:
        print('y', round((y0+y1)/2, 2), 'top -'); continue
    top = max(p.z for p in sel)
    tops = [p for p in sel if p.z > top - 0.12]
    xs = [p.x for p in tops]
    print('y', round((y0+y1)/2, 2), 'top', round(top, 2),
          'x', round(min(xs), 2), '..', round(max(xs), 2), 'n', len(tops))
