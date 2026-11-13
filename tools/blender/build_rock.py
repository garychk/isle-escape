# rock.fbx -> assets/rock.glb
# 单网格岩石：烘焙世界变换 -> 原点=底部中心 -> 导出 glTF（Y-up）
import bpy, mathutils, sys, os

SRC = r"E:/WorkBuddy/2026-11-12-16-39-59/isle-escape/assets_src/mixamo/rock.fbx"
OUT = r"E:/WorkBuddy/2026-11-12-16-39-59/isle-escape/assets/rock.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
print("imported meshes:", [o.name for o in meshes])

# 全部 join 成单对象
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()

obj = bpy.context.view_layer.objects.active

# 烘焙世界矩阵到顶点，然后清零变换（matrix_world 直接用不可靠，教训已知）
mw = obj.matrix_world.copy()
obj.data.transform(mw)
obj.matrix_world = mathutils.Matrix.Identity(4)

# UV 检查
uv = obj.data.uv_layers
print("uv_layers:", len(uv) if uv else 0, "verts:", len(obj.data.vertices), "polys:", len(obj.data.polygons))

# 原点=底部中心：FBX 导入后 Blender 世界 z 是高度轴（rot X 90° 已把 FBX Y-up 转为 Blender Z-up）
# x/y 居中，z 压到 min=0
ys = [v.co.y for v in obj.data.vertices]
xs = [v.co.x for v in obj.data.vertices]
zs = [v.co.z for v in obj.data.vertices]
minx, maxx, miny, maxy, minz, maxz = min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)
cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
for v in obj.data.vertices:
    v.co.x -= cx; v.co.y -= cy; v.co.z -= minz
obj.location = (0, 0, 0)
print("size: w=%.3f d=%.3f h=%.3f" % (maxx-minx, maxy-miny, maxz-minz))

# 材质：FBX 无贴图无材质，给一个简单的哑光石头材质（游戏内会被 rockT 覆盖，这里兜底）
mat = bpy.data.materials.new("rock")
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get("Principled BSDF")
if bsdf:
    bsdf.inputs["Base Color"].default_value = (0.55, 0.52, 0.47, 1)
    bsdf.inputs["Roughness"].default_value = 0.95
    bsdf.inputs["Metallic"].default_value = 0
obj.data.materials.clear()
obj.data.materials.append(mat)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True)
print("EXPORT_OK", os.path.getsize(OUT), "bytes")
