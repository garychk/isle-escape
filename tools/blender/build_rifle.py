"""把外部枪械 GLB 转成游戏可用的 assets/rifle.glb。

约定（与 assets.js / character.js 对齐）：
  - 长轴沿 Z，枪口朝 -Z
  - 原点在握把中心（手心所在位置）
  - Y 向上，实际尺寸（AK 系约 1.0 m）

用法：
  blender -b --python tools/blender/build_rifle.py -- \
      --src assets_src/weapons/ak_raw.glb --out assets/rifle.glb \
      --len-axis X --muzzle +X --length 1.02 --grip-from-muzzle 0.42 --grip-drop 0.02
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector


def parse_args():
    argv = sys.argv
    argv = argv[argv.index('--') + 1:] if '--' in argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--len-axis', default='X', choices=['X', 'Y', 'Z'], help='模型当前的长轴')
    ap.add_argument('--muzzle', default='+X', choices=['+X', '-X', '+Y', '-Y', '+Z', '-Z'],
                    help='枪口当前指向的轴方向')
    ap.add_argument('--up-axis', default='+Z', choices=['+X', '-X', '+Y', '-Y', '+Z', '-Z'],
                    help='枪的"上方"（机匣顶/瞄具方向）当前指向的轴')
    ap.add_argument('--length', type=float, default=1.02, help='归一后的总长（米）')
    ap.add_argument('--grip-from-muzzle', type=float, default=0.42,
                    help='握把距离枪口的比例位置（0=枪口, 1=枪托）')
    ap.add_argument('--grip-drop', type=float, default=0.02,
                    help='握把中心相对包围盒垂直中心的偏移（米，正数向下）')
    ap.add_argument('--tex-max', type=int, default=1024)
    ap.add_argument('--preview', default='', help='渲染预览图的输出路径（可选）')
    return ap.parse_args(argv)


def log(*a):
    print('[rifle]', *a)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def join_meshes(meshes):
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = 'rifle'
    return obj


def world_bbox(objs):
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
    return mn, mx


def apply_transform(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.update()


def optimize_textures(max_size=1024):
    for img in bpy.data.images:
        if img.name == 'Render Result' or not img.users or img.size[0] == 0:
            continue
        w, h = img.size
        m = max(w, h)
        if max_size > 0 and m > max_size:
            s = max_size / float(m)
            img.scale(max(1, int(round(w * s))), max(1, int(round(h * s))))
    log('贴图已降到长边 %d px' % max_size)


def preview(path, obj):
    """侧视图预览：相机沿 +X 看向原点，便于判断枪口朝向。"""
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in \
        [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 500
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('w') if not bpy.data.worlds else bpy.data.worlds[0]
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.12, 0.13, 0.15, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 1.2

    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 1.35
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    cam.location = (2.2, 0, 0)          # 沿 -X 侧视（厚度轴），屏幕右 = +Y（枪口在右）
    cam.rotation_euler = (math.radians(90), 0, math.radians(90))
    scene.camera = cam

    for pos, energy in (((2, 2, 2), 900), ((-2, 1.5, -1), 300), ((0, 2.4, -2), 200)):
        ld = bpy.data.lights.new('l', 'POINT')
        ld.energy = energy
        lo = bpy.data.objects.new('l', ld)
        lo.location = pos
        scene.collection.objects.link(lo)

    # 坐标参考：红球=枪口方向(-Z 端)，绿球=原点(握把)位置
    for name, loc, color in (('muzzle_marker', (0, 0.58, 0.05), (1, 0, 0, 1)),
                             ('grip_marker', (0, 0.0, -0.02), (0, 1, 0, 1))):
        md = bpy.data.meshes.new(name)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.02, location=loc)
        m = bpy.context.object
        m.name = name
        mat = bpy.data.materials.new(name + 'm')
        mat.use_nodes = True
        mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = color
        m.data.materials.append(mat)

    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    log('预览已保存:', path)


def main():
    a = parse_args()
    reset()
    meshes = import_glb(os.path.abspath(a.src))
    if not meshes:
        raise SystemExit('GLB 里没有网格')
    obj = join_meshes(meshes)
    log('网格数(合并后)/三角面:', len(obj.data.polygons))

    mn, mx = world_bbox([obj])
    size = mx - mn
    log('原始尺寸: %.2f x %.2f x %.2f' % (size.x, size.y, size.z))

    # ---- 1) 旋转：两步四元数。目标轴写在 Blender 空间（导出 glTF 的 yup 转换
    # (x,y,z)->(x,z,-y) 会把 Blender +Y 变成 glTF -Z、Blender +Z 变成 glTF +Y），
    # 所以 Blender 里要对齐到：枪口 +Y、枪顶 +Z，导出后正好是游戏要的枪口 -Z、上 +Y。
    def vec(spec):
        sign = 1 if spec[0] == '+' else -1
        v = Vector((0, 0, 0))
        v['XYZ'.index(spec[1])] = sign
        return v

    t_muzzle = Vector((0, 1, 0))
    t_up = Vector((0, 0, 1))
    m_dir = vec(a.muzzle)
    u_dir = vec(a.up_axis)
    q1 = m_dir.rotation_difference(t_muzzle)              # 第一步：枪口对准 +Y
    up1 = q1.to_matrix() @ u_dir                          # 此时枪顶指向
    # 第二步：绕枪管轴转平横滚（signed_angle 手算，兼容各 Blender 版本）
    ang = math.atan2(up1.cross(t_up).dot(t_muzzle), up1.dot(t_up))
    from mathutils import Quaternion, Matrix
    R = Quaternion(t_muzzle, ang).to_matrix() @ q1.to_matrix()
    obj.matrix_world = R.to_4x4() @ obj.matrix_world
    apply_transform(obj)

    # ---- 2) 缩放：总长归一 ----
    mn, mx = world_bbox([obj])
    size = mx - mn
    length = max(size.x, size.y, size.z)
    s = a.length / length
    obj.scale = (s, s, s)
    apply_transform(obj)
    mn, mx = world_bbox([obj])
    size = mx - mn
    log('归一并转轴后尺寸: %.3f x %.3f x %.3f' % (size.x, size.y, size.z))

    # ---- 3) 原点：握把中心（此时长轴=Y、枪口在 +Y 端、上=+Z） ----
    if size.y < size.z * 0.9 or size.y < size.x:
        raise SystemExit('转轴结果异常：长轴不在 Y，检查 --muzzle/--up-axis')
    grip_y = mx.y - size.y * a.grip_from_muzzle
    grip_z = (mn.z + mx.z) / 2 - a.grip_drop
    obj.location = (-(mn.x + mx.x) / 2, -grip_y, -grip_z)
    apply_transform(obj)
    mn, mx = world_bbox([obj])
    log('原点已移到握把，包围盒 y: %.3f..%.3f  z: %.3f..%.3f' % (mn.y, mx.y, mn.z, mx.z))

    optimize_textures(a.tex_max)

    out = os.path.abspath(a.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)                 # 只导出枪本体（预览标记球不能混进来）
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_image_format='WEBP',
        export_image_quality=80,
        export_yup=True,
    )
    log('已导出: %s (%.2f MB)' % (out, os.path.getsize(out) / 1024 / 1024))

    if a.preview:
        preview(os.path.abspath(a.preview), obj)


if __name__ == '__main__':
    main()
