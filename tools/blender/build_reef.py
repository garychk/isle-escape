# drone-island.fbx -> assets/reef.glb（真实航拍礁石小岛）
#
# 源模型：305x272 单位、125.7 万三角面、2 张 8192² 正射贴图（material0/1 各一张）
# 处理：删 FBX 自带的 Cube -> 重绑 2K 贴图 -> 减面到 ~9 万三角 -> 居中 + 水线归零
# 坐标：FBX 导入 Blender 后 Z 为高度轴；glTF 导出自动转 Y-up。
#       水线 z=-8 归零后，y<0 是航拍水面/礁盘（游戏水面会盖住），y>0 是出水的岩峰。
import bpy, os, mathutils

SRC = r"D:/Downloads/ocean_rocky_island/source/drone-island.fbx"
TEX = r"E:/WorkBuddy/2026-11-12-16-39-59/isle-escape/assets_src/reef_tex"
OUT = r"E:/WorkBuddy/2026-11-12-16-39-59/isle-escape/assets/reef.glb"
RATIO = 0.075          # 125.7 万 -> 约 9.4 万面
WATERLINE_Z = -8.0     # 航拍水面/外围礁盘的高度（实测最低 -19.38，40% 顶点在 -19~-12）

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

# 1. 只保留扫描主体（FBX 里还带一个 2x2x2 的默认 Cube）
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name != 'Model':
        bpy.data.objects.remove(o, do_unlink=True)
obj = bpy.data.objects['Model']
print('MESH', obj.name, 'polys', len(obj.data.polygons), flush=True)

# 2. 重绑 2K 贴图；顺手把摄影测量材质调成哑光非金属
for slot, mat in enumerate(obj.data.materials):
    if not mat.use_nodes:
        continue
    tex = os.path.join(TEX, 'texture%d.jpg' % slot)
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE':
            n.image = bpy.data.images.load(tex, check_existing=True)
            print('  REBIND', mat.name, '->', os.path.basename(tex), flush=True)
        elif n.type == 'BSDF_PRINCIPLED':
            n.inputs['Roughness'].default_value = 0.94
            n.inputs['Metallic'].default_value = 0.0
    # 断开没有接图像的 Normal Map 节点，避免 glTF 导出器报空贴图
    for n in list(mat.node_tree.nodes):
        if n.type == 'NORMAL_MAP' and not any(l.from_node == n for l in mat.node_tree.links):
            mat.node_tree.nodes.remove(n)

# 3. 烘焙世界变换（FBX 导入后 rotation=0，仍按老规矩烘进顶点）
mw = obj.matrix_world.copy()
obj.data.transform(mw)
obj.matrix_world = mathutils.Matrix.Identity(4)

# 4. 减面：摄影测量三角网，collapse 模式会保留 UV
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
mod = obj.modifiers.new('reef_decimate', 'DECIMATE')
mod.ratio = RATIO
mod.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier=mod.name)
print('AFTER DECIMATE polys', len(obj.data.polygons), 'uv', len(obj.data.uv_layers), flush=True)

# 5. 原点=水线处、平面中心
vs = obj.data.vertices
xs = [v.co.x for v in vs]
ys = [v.co.y for v in vs]
zs = [v.co.z for v in vs]
cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
for v in vs:
    v.co.x -= cx
    v.co.y -= cy
    v.co.z -= WATERLINE_Z
obj.location = (0, 0, 0)
print('SIZE w=%.2f d=%.2f  y=[%.2f, %.2f]  (y<0 为水下礁盘)' % (
    max(xs) - min(xs), max(ys) - min(ys), min(zs) - WATERLINE_Z, max(zs) - WATERLINE_Z), flush=True)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True,
                          export_image_format='AUTO', export_yup=True)
print('EXPORTED', OUT, os.path.getsize(OUT) // 1024, 'KB', flush=True)
