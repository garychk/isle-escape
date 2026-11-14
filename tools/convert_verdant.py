# 把 Poly Haven "A Verdant Trail" (CC0) 的原始贴图转换成网页端可用规格
# 用法: python tools/convert_verdant.py [源目录]
#   - EXR(half-float) 法线/粗糙度 -> ffmpeg 转 8bit -> PNG/JPG
#   - 4K/2K 统一降到 1K，颜色 sRGB / 法线与粗糙度保持线性数据
#   - diff + alpha 合成 RGBA，并对透明区做颜色 bleed，避免 alphaTest 黑边
# 依赖: Pillow, numpy, imageio-ffmpeg 提供的静态 ffmpeg
import io
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageFilter

SRC = sys.argv[1] if len(sys.argv) > 1 else r'D:/Downloads/verdant_trail/textures'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'tex')
TMP = os.path.join(OUT, '_tmp')
os.makedirs(OUT, exist_ok=True)
os.makedirs(TMP, exist_ok=True)

FFMPEG = subprocess.check_output(
    [r'D:/Programs/miniconda3/python.exe', '-c',
     'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'],
    text=True).strip()

SIZE = 1024          # 地面 PBR 统一 1K
LEAF_SIZE = 512      # 草/灌木卡片较小，512 足够


def exr_to_array(name):
    """EXR half-float -> ffmpeg 8bit RGB ndarray（不做任何 gamma 处理）"""
    src = os.path.join(SRC, name)
    tmp = os.path.join(TMP, name.replace('.exr', '.png'))
    subprocess.run([FFMPEG, '-y', '-v', 'error', '-i', src, '-pix_fmt', 'rgb24', tmp], check=True)
    a = np.array(Image.open(tmp).convert('RGB'))
    os.remove(tmp)
    return a


def save_jpg(a, name, quality=88, gray=False):
    im = Image.fromarray(a.astype('uint8'))
    if gray:
        im = im.convert('L')
    im.save(os.path.join(OUT, name), 'JPEG', quality=quality, subsampling=0 if not gray else 2)
    return os.path.getsize(os.path.join(OUT, name))


def to_alpha(im):
    """各类 alpha 源（RGB/L/I;16/RGBA）统一成 8bit 单通道"""
    if im.mode == 'I;16' or im.mode == 'I':
        a = np.array(im, dtype=np.float32)
        return np.clip(a / 257.0, 0, 255).astype('uint8')
    if im.mode == 'RGBA':
        # 有些包的 mask 在 RGB 里、alpha 通道几乎全 255；选动态范围大的那个
        arr = np.array(im)
        a_dyn = int(arr[:, :, 3].max()) - int(arr[:, :, 3].min())
        rgb_dyn = int(arr[:, :, :3].max()) - int(arr[:, :, :3].min())
        if a_dyn > rgb_dyn:
            return arr[:, :, 3]
    return np.array(im.convert('L'))


def leaf_rgba(diff_name, alpha_name, out_name, size=LEAF_SIZE):
    diff = Image.open(os.path.join(SRC, diff_name)).convert('RGB')
    alpha = to_alpha(Image.open(os.path.join(SRC, alpha_name)))
    if diff.size != (size, size):
        diff = diff.resize((size, size), Image.LANCZOS)
    if alpha.shape[:2] != (size, size):
        alpha = np.array(Image.fromarray(alpha).resize((size, size), Image.LANCZOS))
    rgb = np.array(diff)
    # 颜色 bleed：透明区用轻微模糊后的颜色填充，alphaTest 边缘不出现黑圈
    bleed = np.array(Image.fromarray(rgb).filter(ImageFilter.GaussianBlur(4)))
    rgb[alpha < 64] = bleed[alpha < 64]
    rgba = np.dstack([rgb, alpha])
    Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, out_name), 'PNG', optimize=True)
    return os.path.getsize(os.path.join(OUT, out_name))


def ground(prefix, diff, nrm, rgh, diff_is_exr=False, nrm_is_png=False, rgh_is_png=False):
    """一组地面 PBR -> *_diff.jpg(颜色) / *_nrm.jpg(切线法线) / *_rgh.jpg(灰度粗糙)"""
    # --- albedo ---
    if diff_is_exr:
        a = exr_to_array(diff)
    else:
        a = np.array(Image.open(os.path.join(SRC, diff)).convert('RGB'))
    im = Image.fromarray(np.ascontiguousarray(a)).resize((SIZE, SIZE), Image.LANCZOS)
    im.save(os.path.join(OUT, prefix + '_diff.jpg'), 'JPEG', quality=88, optimize=True)

    # --- normal ---
    if nrm_is_png:
        a = np.array(Image.open(os.path.join(SRC, nrm)).convert('RGB'))
    else:
        a = exr_to_array(nrm)
    Image.fromarray(np.ascontiguousarray(a)).resize((SIZE, SIZE), Image.LANCZOS).save(
        os.path.join(OUT, prefix + '_nrm.jpg'), 'JPEG', quality=94, subsampling=0)

    # --- roughness ---
    if rgh_is_png:
        a = np.array(Image.open(os.path.join(SRC, rgh)).convert('RGB'))
    else:
        a = exr_to_array(rgh)
    g = np.array(Image.fromarray(np.ascontiguousarray(a)).convert('L').resize((SIZE, SIZE), Image.LANCZOS))
    Image.fromarray(g).save(os.path.join(OUT, prefix + '_rgh.jpg'), 'JPEG', quality=84, optimize=True)

    # 法线数值自检：R/G 应接近 128，B 明显偏高（OpenGL Y+ 格式）
    n = np.array(Image.open(os.path.join(OUT, prefix + '_nrm.jpg')))
    ok = n[:, :, 2].mean() > 165
    print(f'  {prefix:16s} diff/nrm/rgh  {n[:,:,0].mean():.0f}/{n[:,:,1].mean():.0f}/{n[:,:,2].mean():.0f}  '
          f'normal {"OK" if ok else "CHECK"}')
    return ok


def main():
    print('源:', SRC)
    print('输出:', OUT)
    print('\n[1] 地面 PBR x4')
    oks = []
    oks.append(ground('forest', 'forest_ground_04_diff_2k.jpg',
                      'forest_ground_04_nor_gl_2k.exr', 'forest_ground_04_rough_2k.exr'))
    oks.append(ground('dirt', 'dirt_floor_diff_4k.png',
                      'dirt_floor_nor_gl_4k.png', 'dirt_floor_rough_4k.png',
                      nrm_is_png=True, rgh_is_png=True))
    oks.append(ground('rock', 'coastal_cliff_02_diff_2k.jpg',
                      'coastal_cliff_02_nor_gl_2k.exr', 'coastal_cliff_02_rough_2k.exr'))
    oks.append(ground('sand', 'sand_rocks_small_01_diff_1k.jpg',
                      'sand_rocks_small_01_nor_gl_1k.exr', 'sand_rocks_small_01_rough_1k.exr'))

    print('\n[2] 植被 RGBA (diff + alpha 合成)')
    leaves = [
        ('leaf_grass.png', 'grass_medium_02_diff.png', 'grass_medium_02_alpha.png'),
        ('leaf_shrub.png', 'shrub_01_diff.png', 'shrub_01_alpha.png'),
        ('leaf_tree_a.png', 'island_tree_01_leaves_diff_1k.png', 'island_tree_01_leaves_alpha_1k.png'),
        ('leaf_tree_b.png', 'jacaranda_tree_leaves_diff_1k.png', 'jacaranda_tree_leaves_alpha_1k.png'),
    ]
    for out_name, d, a in leaves:
        sz = leaf_rgba(d, a, out_name, 1024 if 'tree' in out_name else LEAF_SIZE)
        im = np.array(Image.open(os.path.join(OUT, out_name)))
        print(f'  {out_name:20s} {im.shape} alpha均值={im[:,:,3].mean():.0f} {sz//1024}KB')

    print('\n[3] 蕨叶裁切（图集 -> 单株竖立蕨叶，匹配十字卡片几何）')
    atlas = Image.open(os.path.join(OUT, 'leaf_tree_b.png')).convert('RGBA')
    # 右上那根完整羽叶：茎在左、叶尖在右；逆时针 90° 后茎落到底部，正好贴地生长
    fr = atlas.crop((150, 90, 1024, 500)).rotate(90, expand=True)
    fr.thumbnail((512, 512), Image.LANCZOS)
    canvas = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    canvas.alpha_composite(fr, ((512 - fr.width) // 2, 512 - fr.height))
    canvas.save(os.path.join(OUT, 'leaf_fern.png'), 'PNG')
    print(f'  leaf_fern.png        {fr.size} alpha均值={np.array(canvas)[:,:,3].mean():.0f}')

    print('\n[4] 地表落叶贴片（真实落叶层 + 柔和边缘 alpha）')
    dl = np.array(Image.open(os.path.join(SRC, 'forest_leaves_04_diff_4k.jpg')).convert('RGB')
                  .resize((512, 512), Image.LANCZOS))
    yy, xx = np.mgrid[0:512, 0:512]
    rr = np.sqrt(((xx - 256) / 256) ** 2 + ((yy - 256) / 256) ** 2)
    # 径向渐隐 + 低频噪声打散圆边，避免地面出现整齐的圆片
    nz = np.array(Image.fromarray(
        (np.random.default_rng(7).random((64, 64)) * 255).astype('uint8'))
        .resize((512, 512), Image.BICUBIC).filter(ImageFilter.GaussianBlur(6)), dtype=np.float32)
    nz = (nz - nz.min()) / max(1e-6, nz.max() - nz.min())
    al = np.clip((1.0 - rr + (nz - 0.5) * 0.55) * 2.6, 0, 1)
    Image.fromarray(np.dstack([dl, (al * 255).astype('uint8')]), 'RGBA').save(
        os.path.join(OUT, 'leaf_litter.png'), 'PNG')
    print(f'  leaf_litter.png       alpha均值={al.mean()*255:.0f}')

    print('\n[5] HDRI 天空')
    import shutil
    shutil.copyfile(os.path.join(SRC, 'alps_field_2k.hdr'), os.path.join(OUT, 'sky.hdr'))

    os.rmdir(TMP)
    print('\n[体积]')
    total = 0
    for f in sorted(os.listdir(OUT)):
        p = os.path.join(OUT, f)
        s = os.path.getsize(p)
        total += s
        print(f'  {f:24s} {s/1024:8.0f} KB')
    print(f'  合计 {total/1024/1024:.2f} MB')
    print('\n法线格式全部正确:', all(oks))


if __name__ == '__main__':
    main()
