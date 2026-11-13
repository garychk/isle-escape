#!/usr/bin/env python3
# GLB 贴图瘦身：PNG/JPEG 贴图统一降采样 + 转 JPEG，重建 GLB
# 用法: python tools/shrink_glb.py <in.glb> <out.glb> [max_size] [jpeg_quality]
import json
import struct
import sys
import io


def read_glb(path):
    with open(path, 'rb') as f:
        buf = f.read()
    assert struct.unpack_from('<I', buf, 0)[0] == 0x46546c67, 'not GLB'
    off, chunks = 12, []
    while off < len(buf):
        ln, ty = struct.unpack_from('<I4s', buf, off)
        chunks.append((ty.rstrip(b'\0'), buf[off + 8:off + 8 + ln]))
        off += 8 + ln + ((4 - (ln % 4)) % 4)
    json_chunk = next(c for t, c in chunks if t == b'JSON')
    bin_chunk = next((c for t, c in chunks if t == b'BIN'), b'')
    return json.loads(json_chunk), bin_chunk


def write_glb(path, gltf, bin_data):
    js = json.dumps(gltf, separators=(',', ':')).encode('utf8')
    while len(js) % 4:
        js += b' '
    bd = bin_data
    while len(bd) % 4:
        bd += b'\0'
    total = 12 + 8 + len(js) + (8 + len(bd) if bd else 0)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546c67, 2, total))   # magic, version, total
        f.write(struct.pack('<II', len(js), 0x4e4f534a))     # JSON chunk
        f.write(js)
        if bd:
            f.write(struct.pack('<II', len(bd), 0x004e4942)) # BIN chunk
            f.write(bd)


def main():
    from PIL import Image
    src, dst = sys.argv[1], sys.argv[2]
    max_size = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
    quality = int(sys.argv[4]) if len(sys.argv) > 4 else 85

    gltf, bin_data = read_glb(src)
    views = gltf['bufferViews']
    new_bin = bytearray()

    # 逐 bufferView 拷贝；图片类做降采样转 JPEG
    new_views = []
    for i, v in enumerate(views):
        raw = bin_data[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
        img_idx = [j for j, im in enumerate(gltf.get('images', [])) if im.get('bufferView') == i]
        if img_idx:
            im = Image.open(io.BytesIO(raw))
            had_alpha = im.mode in ('RGBA', 'LA') and im.getextrema()[-1][0] < 255
            if max(im.size) > max_size:
                im.thumbnail((max_size, max_size), Image.LANCZOS)
            im = im.convert('RGB')
            out = io.BytesIO()
            # 有实际透明通道的贴图保 PNG，其余转 JPEG
            if had_alpha and img_idx and gltf['images'][img_idx[0]].get('mimeType') == 'image/png':
                im_rgba = Image.open(io.BytesIO(raw)).convert('RGBA')
                if max(im_rgba.size) > max_size:
                    im_rgba.thumbnail((max_size, max_size), Image.LANCZOS)
                im_rgba.save(out, 'PNG', optimize=True)
                mime = 'image/png'
            else:
                im.save(out, 'JPEG', quality=quality, optimize=True)
                mime = 'image/jpeg'
            data = out.getvalue()
            gltf['images'][img_idx[0]]['mimeType'] = mime
            print(f'  img[{img_idx[0]}] {mime} {len(raw)/1e6:.2f}MB -> {len(data)/1e6:.2f}MB  alpha_kept={had_alpha and mime=="image/png"}')
        else:
            data = raw
        # 4 字节对齐
        pad = (-len(new_bin)) % 4
        new_bin += b'\0' * pad
        nv = {'buffer': 0, 'byteOffset': len(new_bin), 'byteLength': len(data)}
        for k in ('byteStride', 'target'):
            if k in v:
                nv[k] = v[k]
        new_views.append(nv)
        new_bin += data

    gltf['bufferViews'] = new_views
    if 'buffers' in gltf:
        gltf['buffers'][0]['byteLength'] = len(new_bin)
    write_glb(dst, gltf, bytes(new_bin))
    import os
    print(f'done: {os.path.getsize(src)/1e6:.2f}MB -> {os.path.getsize(dst)/1e6:.2f}MB')


if __name__ == '__main__':
    main()
