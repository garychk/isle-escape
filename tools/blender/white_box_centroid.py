# 座舱顶前方白盒：白色顶面（贴图采样白 & 法线朝上 & z>1.9）在窗口 y[-0.3,0.7] 的质心
import bpy, os
import numpy as np
from mathutils import Vector

GLB = os.path.abspath('assets/heli.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
nody = bpy.data.objects['Nody']
M3 = nody.matrix_world.to_3x3()
T = nody.matrix_world.to_translation()

faces = []
for si, slot in enumerate(nody.material_slots):
    mat = slot.material
    if not mat or not mat.use_nodes: continue
    teximg = None
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image: teximg = n.image; break
    if teximg is None: continue
    W, H = teximg.size
    px = np.empty(W*H*4, dtype=np.float32); teximg.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    uv = nody.data.uv_layers.active
    for p in nody.data.polygons:
        if p.material_index != si: continue
        uvs = [uv.data[li].uv for li in p.loop_indices]
        u = max(0.0, min(1.0, sum(v.x for v in uvs)/len(uvs)))
        v_ = max(0.0, min(1.0, sum(v.y for v in uvs)/len(uvs)))
        r, g, b = px[min(H-1, int(v_*H))*W + min(W-1, int(u*W))][:3]
        if r > 0.5 and g > 0.5 and b > 0.5 and abs(r-g) < 0.12 and abs(g-b) < 0.12:
            c = sum((M3 @ nody.data.vertices[vi].co for vi in p.vertices), Vector())/len(p.vertices)
            w = c + T
            nrm = (M3 @ p.normal).normalized()
            if nrm.z > 0.4 and w.z > 1.75 and -0.5 <= w.y <= 1.0:
                faces.append(w)
print('== white faces (z>1.2):', len(faces))
import collections
cc = collections.Counter(round(f.y,1) for f in faces)
print('per-y histogram:', dict(sorted(cc.items())))
if faces:
    cx = sum(f.x for f in faces)/len(faces); cy = sum(f.y for f in faces)/len(faces)
    ztop = max(f.z for f in faces)
    xs = [f.x for f in faces]; ys = [f.y for f in faces]
    print('centroid x %.3f y %.3f | bbox x %.2f..%.2f y %.2f..%.2f | ztop %.3f' %
          (cx, cy, min(xs), max(xs), min(ys), max(ys), ztop))
