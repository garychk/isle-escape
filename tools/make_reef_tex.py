# 把 drone-island.fbx 的两张 8K 航拍正射贴图降到 2K JPEG
# 输出给 tools/blender/build_reef.py 重绑，避免 GLB 内嵌超大贴图
import os
from PIL import Image

SRC = r"D:/Downloads/ocean_rocky_island/source"
OUT = r"E:/WorkBuddy/2026-11-12-16-39-59/isle-escape/assets_src/reef_tex"
SIZE = 2048

os.makedirs(OUT, exist_ok=True)
for src, dst in [("drone-island.jpg", "texture0.jpg"), ("drone-island1.jpg", "texture1.jpg")]:
    im = Image.open(os.path.join(SRC, src)).convert("RGB")
    print(src, im.size, "->", SIZE)
    im = im.resize((SIZE, SIZE), Image.LANCZOS)
    p = os.path.join(OUT, dst)
    # 注意：不要用 optimize / subsampling=0，之前会把 JPEG 写坏
    im.save(p, "JPEG", quality=88)
    print(" ", p, os.path.getsize(p) // 1024, "KB")
print("REEF_TEX_OK")
