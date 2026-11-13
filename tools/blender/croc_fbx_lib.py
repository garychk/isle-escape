# ASCII FBX -> Blender 网格（Blender 官方导入器不支持 ASCII FBX，自行解析）
# 只解析 Geometry(Vertices/PolygonVertexIndex/UV)/Model 变换；贴图为外部引用缺失，
# 材质由调用方显式指定。
import bpy, sys, math
from mathutils import Vector, Matrix

def parse_ascii_fbx(path):
    """极简 ASCII FBX 解析：返回嵌套节点树 [ (name, value, children) ]"""
    root = []
    stack = [root]
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith(';'):
                continue
            if line == '}':
                stack.pop()
                continue
            if line.endswith('{'):
                head = line[:-1].strip()
                name, _, val = head.partition(':')
                node = [name.strip(), val.strip(), []]
                stack[-1].append(node)
                stack.append(node[2])
            elif ':' in line:
                name, _, val = line.partition(':')
                stack[-1].append([name.strip(), val.strip(), None])
            elif stack[-1] and stack[-1][-1] is not None and stack[-1][-1][2] is None:
                # 数组折行续接
                stack[-1][-1][1] += ' ' + line
    return root

def find_all(nodes, name, out=None):
    if out is None: out = []
    for n in nodes:
        if n[0] == name: out.append(n)
        if n[2]: find_all(n[2], name, out)
    return out

def child(nodes, name):
    for n in nodes:
        if n[0] == name: return n
    return None

def floats(s):
    return [float(x) for x in s.split(',')]

def ints(s):
    return [int(x) for x in s.split(',')]

def arr(nodes, name):
    """取 X: *N { a: ... } 数组节点的数据（子节点 a）"""
    n = child(nodes, name)
    if not n or not n[2]: return None
    a = child(n[2], 'a')
    return a[1] if a else None

def model_transform(model_node):
    """读 Model 的 Lcl T/R/S，返回 4x4"""
    t, r, s = Vector((0, 0, 0)), Vector((0, 0, 0)), Vector((1, 1, 1))
    for p in find_all(model_node[2], 'P'):
        pname = p[1].strip('"')
        vals = p[2].split(',') if p[2] else []
        if pname == 'Lcl Translation' and len(vals) >= 3: t = Vector([float(v) for v in vals[:3]])
        elif pname == 'Lcl Rotation' and len(vals) >= 3: r = Vector([float(v) for v in vals[:3]])
        elif pname == 'Lcl Scaling' and len(vals) >= 3: s = Vector([float(v) for v in vals[:3]])
    return (Matrix.Translation(t) @ Matrix.Rotation(math.radians(r.z), 4, 'Z')
            @ Matrix.Rotation(math.radians(r.y), 4, 'Y') @ Matrix.Rotation(math.radians(r.x), 4, 'X')
            @ Matrix.Diagonal(s.to_4d()))

def import_ascii_fbx(src):
    root = parse_ascii_fbx(src)
    objects = find_all(root, 'Objects')
    objs = objects[0][2] if objects else []
    models = [n for n in objs if n[0] == 'Model' and 'Mesh' in n[1]]
    geoms = {g[1].split(',')[0].strip(): g for g in objs if g[0] == 'Geometry'}
    # Connections: C: "OO", childId, parentId —— 建立子->父映射（Connections 是顶层节）
    geo_of_model = {}
    for conns in find_all(root, 'Connections'):
        for c in conns[2]:
            if c[0] != 'C': continue
            parts = [p.strip() for p in c[1].split(',') if p.strip()]
            if len(parts) >= 3 and parts[0] == '"OO"':
                child_id, parent_id = parts[1].strip('"'), parts[2].strip('"')
                if child_id in geoms:
                    geo_of_model[parent_id] = geoms[child_id]
    made = []
    for m in models:
        mid = m[1].split(',')[0].strip()
        geo = geo_of_model.get(mid)
        if not geo:
            print('[croc] Model %s 找不到对应 Geometry，跳过' % m[1])
            continue
        ch = geo[2]
        vf = floats(arr(ch, 'Vertices'))
        verts = [(vf[i], vf[i + 1], vf[i + 2]) for i in range(0, len(vf) - 2, 3)]
        polys = ints(arr(ch, 'PolygonVertexIndex'))
        # 面：负索引 = ~(idx)，即 -x-1
        faces, cur = [], []
        for i in polys:
            if i < 0:
                cur.append(-i - 1); faces.append(cur); cur = []
            else:
                cur.append(i)
        # UV
        uvs, uv_idx = [], None
        for le in [n for n in ch if n[0] == 'LayerElementUV']:
            uvs = floats(arr(le[2], 'UV'))
            uv_idx = ints(arr(le[2], 'UVIndex'))
            break
        mw = model_transform(m)
        me = bpy.data.meshes.new('croc')
        me.from_pydata(verts, [], faces)
        me.validate()
        if uvs:
            layer = me.uv_layers.new(name='UVMap')
            for li, loop in enumerate(me.loops):
                vi = loop.vertex_index
                k = uv_idx[li] if uv_idx else vi
                layer.data[li].uv = (uvs[k * 2], uvs[k * 2 + 1])
        me.update()
        ob = bpy.data.objects.new('croc', me)
        ob.matrix_world = mw
        bpy.context.collection.objects.link(ob)
        made.append(ob)
        print('[croc] 导入网格: 顶点 %d 面 %d UV %s' % (len(me.vertices), len(me.polygons), bool(uvs)))
    return made

def bbox(objs):
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    bpy.context.view_layer.update()
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            for k in range(3):
                lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
    return lo, hi

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    src = argv[0] if argv else 'assets_src/mixamo/crocodile.fbx'
    bpy.ops.wm.read_factory_settings(use_empty=True)
    made = import_ascii_fbx(src)
    lo, hi = bbox(made)
    size = hi - lo
    print('[croc] 总包围盒: x[%.2f,%.2f] y[%.2f,%.2f] z[%.2f,%.2f] 尺寸=(%.2f, %.2f, %.2f)' %
          (lo.x, hi.x, lo.y, hi.y, lo.z, hi.z, size.x, size.y, size.z))
