# 生成网页端专用水面贴图（无缝法线 + 泡沫掩码）
# 素材包 "A Verdant Trail" 内没有水面贴图（water_tmp 是纯 Noise+Bump 节点材质），
# 这里用多尺度可平铺值噪声生成 1024² 波纹法线，供双层反向滚动采样。
# 输出: assets/tex/water_norm.png —— RGB 三通道，无 alpha（避免浏览器预乘污染法线）
#   R/G = 切线空间法线 xy (OpenGL Y+)，B = 泡沫/波峰掩码
# 用法: python tools/make_water.py
import os
import numpy as np
from PIL import Image

N = 1024
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'tex', 'water_norm.png')
os.makedirs(os.path.dirname(OUT), exist_ok=True)


def tile_noise(rx, ry, seed):
    """可平铺值噪声：周期网格 + 五次平滑插值，rx/ry 不等即形成自然风浪拉伸"""
    rng = np.random.default_rng(seed)
    g = (rng.random((ry, rx), dtype=np.float32) * 2 - 1)
    cx = np.arange(N, dtype=np.float32) * rx / N
    cy = np.arange(N, dtype=np.float32) * ry / N
    ix0 = np.floor(cx).astype(np.int32)
    iy0 = np.floor(cy).astype(np.int32)
    fx, fy = cx - ix0, cy - iy0
    wx = (fx * fx * fx * (fx * (fx * 6 - 15) + 10)).astype(np.float32)
    wy = (fy * fy * fy * (fy * (fy * 6 - 15) + 10)).astype(np.float32)
    gx0, gx1 = ix0 % rx, (ix0 + 1) % rx
    gy0, gy1 = iy0 % ry, (iy0 + 1) % ry
    a = g[np.ix_(gy0, gx0)]
    b = g[np.ix_(gy0, gx1)]
    c = g[np.ix_(gy1, gx0)]
    d = g[np.ix_(gy1, gx1)]
    top = a + (b - a) * wx[None, :]
    bot = c + (d - c) * wx[None, :]
    return (top + (bot - top) * wy[:, None]).astype(np.float32)


# 长涌浪（水平拉伸）→ 中尺度波纹 → 细碎涟漪，全部非周期方向，避免规则斜纹
h = (0.46 * tile_noise(5, 14, 101)
     + 0.27 * tile_noise(11, 29, 202)
     + 0.16 * tile_noise(21, 21, 303)
     + 0.09 * tile_noise(43, 57, 404)
     + 0.045 * tile_noise(90, 90, 505))
h = (h - h.mean()) / (h.std() + 1e-6)

# 中心差分求坡度（np.roll 保证环绕），标定到平均倾角 ~0.22，避免尖锐碎高光
sx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
sy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
k = 0.22 / max(np.sqrt(sx * sx + sy * sy).mean(), 1e-6)
nx, ny = -sx * k, -sy * k
ln = np.sqrt(nx * nx + ny * ny + 1.0)
nr = (nx / ln * 0.5 + 0.5) * 255
ng = (ny / ln * 0.5 + 0.5) * 255

# 泡沫通道：波峰 + 高频脊线，只在着色器的浅水带里被取用
ridge = 1.0 - np.abs(tile_noise(38, 76, 606))
ridge = ridge / (ridge.max() + 1e-6)
crest = np.clip((h - np.percentile(h, 62)) /
                (np.percentile(h, 99.2) - np.percentile(h, 62) + 1e-6), 0, 1)
foam = np.clip(0.50 * crest + 0.50 * ridge ** 5, 0, 1) * 255

rgb = np.stack([nr, ng, foam], axis=-1).clip(0, 255).astype('uint8')
Image.fromarray(rgb, 'RGB').save(OUT, 'PNG', optimize=True)

# 自检：R/G 应接近 128；接缝跳变与相邻像素梯度同量级说明可平铺
a = rgb.astype('float32')
dx = np.abs(np.diff(a[:, :, 0], axis=1)).mean()
dy = np.abs(np.diff(a[:, :, 0], axis=0)).mean()
seam_x = np.abs(a[:, 0, 0] - a[:, -1, 0]).mean()
seam_y = np.abs(a[0, :, 0] - a[-1, :, 0]).mean()
print('输出:', OUT)
print(f'尺寸 {N}x{N} RGB  体积 {os.path.getsize(OUT)/1024/1024:.2f} MB')
print(f'法线均值 R/G = {a[:,:,0].mean():.1f}/{a[:,:,1].mean():.1f}  泡沫均值 B = {a[:,:,2].mean():.1f}')
print(f'接缝跳变 x/y = {seam_x:.2f}/{seam_y:.2f}  相邻像素梯度 = {dx:.2f}/{dy:.2f}'
      f'  -> {"OK" if seam_x < dx*3 and seam_y < dy*3 else "CHECK"}')
