# 按贴图颜色找机身顶部的"白色面片"聚类，精确定位白色舱罩小盒
import bpy, os
import numpy as np

GLB = os.path.abspath('assets/heli.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

nody = bpy.data.objects['Nody']
M = nody.matrix_world.to_3x3()
T = nody.matrix_world.to_translation()

def white_faces(o):
    """返回 (世界坐标面中心列表)——贴图采样为白色且法线朝上的面"""
    out = []
    for slot in o.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        teximg = None
        for n in mat.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                teximg = n.image
                break
        if teximg is None:
            continue
        W, H = teximg.size
        px = np.empty(W * H * 4, dtype=np.float32)
        teximg.pixels.foreach_get(px)
        px = px.reshape(-1, 4)
        uvlay = o.data.uv_layers.active
        for p in o.data.polygons:
            # 面中心 UV
            uvs = [uvlay.data[li].uv for li in p.loop_indices]
            u = max(0.0, min(1.0, sum(v.x for v in uvs) / len(uvs)))
            v_ = max(0.0, min(1.0, sum(v.y for v in uvs) / len(uvs)))
            xi = min(W - 1, int(u * W)); yi = min(H - 1, int(v_ * H))
            r, g, b = px[yi * W + xi][:3]
            if r > 0.72 and g > 0.72 and b > 0.72:
                c = sum((M @ o.data.vertices[vi].co for vi in p.vertices), __import__('mathutils').Vector()) / len(p.vertices)
                w = c + T
                nrm = (M @ p.normal).normalized()
                if nrm.z > 0.4 and w.z > 1.2:
                    out.append(w)
    return out

faces = white_faces(nody)
print('== white top faces:', len(faces))
if faces:
    ys = sorted(f.y for f in faces)
    # 按y聚类（间隔>0.25断开）
    clusters = []
    cur = [ys[0]]
    for y in ys[1:]:
        if y - cur[-1] > 0.25:
            clusters.append(cur); cur = [y]
        else:
            cur.append(y)
    clusters.append(cur)
    for cl in clusters:
        sel = [f for f in faces if cl[0] <= f.y <= cl[-1]]
        xs = [f.x for f in sel]; zs = [f.z for f in sel]
        print('   cluster y %.2f..%.2f | x %.2f..%.2f | z %.2f..%.2f | n=%d' %
              (cl[0], cl[-1], min(xs), max(xs), min(zs), max(zs), len(sel)))

# 细分大聚类：0.2m y 箱，看每段白面片的最高 z 与顶面（z>1.85）顶点分布
print('== big cluster fine bins:')
big = [f for f in faces if -1.3 <= f.y <= 2.0]
for i in range(int((2.0 - (-1.3)) / 0.2)):
    y0 = -1.3 + i * 0.2; y1 = y0 + 0.2
    sel = [f for f in big if y0 <= f.y < y1]
    if not sel:
        continue
    ztop = max(f.z for f in sel)
    tops = [f for f in sel if f.z > ztop - 0.1]
    xs = [f.x for f in tops]
    print('   y %.1f..%.1f ztop %.2f | top verts x %.2f..%.2f n=%d' %
          (y0, y1, ztop, min(xs), max(xs), len(tops)))
