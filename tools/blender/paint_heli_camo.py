# -*- coding: utf-8 -*-
# heli.glb 涂装改造：
#   1) 机身蒙皮（MilitaryGreen 贴图）→ 丛林迷彩：在原贴图分辨率上生成 4 色斑块
#      （军绿底 + 深棕 + 黑绿 + 卡其），保留原图的噪点细节做明度调制；
#      MilitaryGreen2（小零件）同步换迷彩保持一致。
#   2) 机头玻璃（材质 "14 - Default"，BLEND 黑色不透明）→ alpha 0.32 的透明玻璃，
#      低粗糙度高光泽，改名为 HeliGlass（heli.js 运行时按名优化 depthWrite/单面渲染）。
# 生成后导出 GLB，assets.js 需 bump v。
import bpy, os
import numpy as np
from mathutils import Vector

GLB = os.path.abspath('assets/heli.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

# —— 1) 迷彩贴图生成 ——
PALETTE = [  # 丛林迷彩 4 色（贴图色调匹配原 MilitaryGreen，R/G/B 0-1）
    (0.345, 0.412, 0.216),  # 军绿（底色，占大头）
    (0.239, 0.204, 0.110),  # 深棕
    (0.122, 0.153, 0.086),  # 黑绿
    (0.545, 0.510, 0.318),  # 卡其
]
WEIGHTS = [0.42, 0.22, 0.20, 0.16]
RES = 1024
rng = np.random.default_rng(20261120)

def voronoi_camo(res, n_seed, seed):
    r = np.random.default_rng(seed)
    ids = r.choice(len(PALETTE), size=n_seed,
                   p=[w / sum(WEIGHTS) for w in WEIGHTS])
    xs = r.random(n_seed) * res
    ys = r.random(n_seed) * res
    # 网格采样点
    gy, gx = np.mgrid[0:res, 0:res]
    gx = gx.ravel().astype(np.float32); gy = gy.ravel().astype(np.float32)
    dist = np.empty((n_seed, gx.size), np.float32)
    for i in range(n_seed):
        dist[i] = (gx - xs[i]) ** 2 + (gy - ys[i]) ** 2
    near = np.argmin(dist, axis=0)
    img = np.zeros((gx.size, 3), np.float32)
    for ci, col in enumerate(PALETTE):
        m = ids[near] == ci
        img[m] = col
    # 边缘柔和一点：距离第二近与最近的差值小的像素向底色插值
    d2 = np.partition(dist, 1, axis=0)[1] - np.min(dist, axis=0)
    soft = np.clip((np.sqrt(d2) - 2.0) / 26.0, 0, 1)[:, None]
    base = np.array(PALETTE[0], np.float32)
    img = img * soft + base * (1 - soft)
    # 细噪点（模拟原贴图的布纹质感）
    img += (np.random.rand(gx.size, 1).astype(np.float32) - 0.5) * 0.045
    return img.reshape(res, res, 3).clip(0, 1)

def make_image(name, pixels, w, h):
    im = bpy.data.images.get(name)
    if im:
        bpy.data.images.remove(im)
    im = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[:, :, :3] = pixels
    im.pixels.foreach_set(rgba.ravel())
    im.pack()
    return im

camo1 = make_image('HeliCamo', voronoi_camo(RES, 90, 11), RES, RES)
camo2 = make_image('HeliCamo2', voronoi_camo(RES, 70, 23), RES, RES)

nody = bpy.data.objects['Nody']
replaced = []
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and 'MilitaryGreen' in n.image.name:
            n.image = camo1 if n.image.name == 'MilitaryGreen' else camo2
            replaced.append((mat.name, n.image.name))
print('camo applied to:', replaced)

# —— 2) 玻璃透明化 ——
glass = bpy.data.materials.get('14 - Default')
assert glass, 'glass material not found'
glass.name = 'HeliGlass'
nt = glass.node_tree
for n in nt.nodes:
    if n.type == 'BSDF_PRINCIPLED':
        # 淡青灰玻璃色，alpha 0.32；低粗糙度 + 微金属感 → 反光
        n.inputs['Base Color'].default_value = (0.06, 0.09, 0.11, 1.0)
        n.inputs['Alpha'].default_value = 0.32
        n.inputs['Roughness'].default_value = 0.08
        n.inputs['Metallic'].default_value = 0.15
        for l in list(nt.links):
            if l.to_node == n and l.to_socket.name in ('Base Color', 'Alpha'):
                nt.links.remove(l)
glass.blend_method = 'BLEND'
glass.use_backface_culling = False
print('glass done:', glass.name)

# 其余材质保持不变；导出
bpy.context.view_layer.update()
bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB',
                          export_apply=False, export_yup=True)
print('written', GLB, os.path.getsize(GLB) // 1024, 'KB')
