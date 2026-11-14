# 绝岛密林 · Isle Escape

一款基于 **Three.js** 的网页端第三人称生存逃脱游戏。纯前端、零后端，打开网页即玩。

你流落在孤岛上，唯一的出路是向北穿越雨林、索桥、山腹洞穴，在北岸登上渔船离岛。沿途有成群的行尸、突变巨兽、变异恐龙与洞窟僵尸，弹药有限，枪声还会把野兽引来。

## 快速开始

需要 Node 18+（只用来起一个本地静态服务器，游戏本身不需要构建即可运行）。

```bash
node serve.mjs          # 或 npm run serve / npm start
```

- 开发版：<http://localhost:8137/index.html> —— 直接跑 `src/`，改完刷新即生效
- 游玩版：<http://localhost:8137/> —— 运行 `dist/index.html`（需先构建，见下）

> 必须通过 http 访问。`file://` 直接双击打开会被 CORS 拦住，GLB 资产加载失败。

## 操作

| 按键 | 功能 |
| --- | --- |
| `W A S D` | 移动 |
| `Shift` | 冲刺（消耗体力） |
| `Space` | 跳跃；蹲伏状态下为前滚翻 |
| `C` | 蹲伏 / 站立（潜行、翻滚） |
| 鼠标左键 | 射击 / 挥刀 |
| 鼠标右键（按住） | 瞄准 |
| `V` 或 鼠标中键 | 瞄准锁定开关（点一下常驻瞄准） |
| `Q` | 切换武器（步枪 ↔ 军刀） |
| `1` / `2` | 直接切换到步枪 / 军刀 |
| `R` | 换弹 |
| `F` | 手电筒 |
| `E` | 交互（拾取、上下车、登船） |
| `Esc` | 暂停 / 关闭设置面板 |

支持触屏操作模式（标题菜单或设置里可切换）。

## 玩法要点

- **路线**：南岸出生 → 林间小径 → 林中木屋补给 → 林间索桥 → 山腹洞穴 → 北岸滩头 → 登上渔船。
- **资源**：步枪 30 发弹匣，弹药与急救箱散落在小径、木屋和洞穴沿线。
- **潜行**：蹲伏会降低移动速度与脚步声，但能贴墙绕过兽群；沼泽里有血蛭持续掉血，木板路是安全通道。
- **战斗**：枪声会吸引附近野兽（`hear` 半径），军刀无声但需要贴身；受伤后会被毒/流血类效果持续消耗。
- **环境**：昼夜循环、降雨与雷电、洞穴压暗、水面倒影与体积雾。画面质量、时间、天气可在设置中调节。

## 构建

```bash
node build.js          # 或 npm run build
```

产物：

- `bundle.js` —— esbuild 打包后的单文件 JS
- `dist/isle-escape.html` —— 把 `bundle.js` 与 `assets/*.glb`（转成 data URI）全部内联，**单个 HTML 文件即可离线游玩**

参数：`node build.js --dev` 关闭压缩；`node build.js --no-assets` 不内联 GLB。

> 构建脚本里的 esbuild 路径指向 `../qa/node_modules/esbuild/bin/esbuild`。换环境时请修改 [build.js](build.js#L7) 的路径，或自行安装 esbuild 后指过去。

## 目录结构

```
index.html          开发版入口（importmap + src/main.js，另含全部 UI 样式）
serve.mjs           零依赖静态服务器
build.js            esbuild 打包 + 单文件内联
src/                游戏源码
  main.js           渲染器 / 状态机 / 主循环 / 输入
  config.js         全局配置、地图关键点、引导路径、刷怪与拾取表
  terrain.js        岛屿地形、水面、区域判定
  flora.js          雨林植被
  structures.js     索桥、木屋、洞穴、木筏
  animals.js        野兽 AI、刷怪、粒子
  character.js      TPS 角色与动画状态机
  player.js         玩家控制、体力、伤害、拾取与交互
  weapons.js        步枪 / 军刀射击与命中判定
  vehicle.js        载具
  tps.js            第三人称相机
  env.js            天空、昼夜、天气、雨、萤火虫
  pbr.js            Poly Haven PBR 贴图、地形 splat、HDRI 环境光
  water.js          水面着色器（三频波纹、水深、岸线泡沫、Schlick 菲涅尔、太阳碎金高光）
  audio.js          WebAudio 音效与环境音乐
  ui.js             HUD、菜单、指南针、区域名卡
  assets.js         GLB 装载、尺度归一、实例化
vendor/             three.js r180、GLTFLoader、SkeletonUtils、BufferGeometryUtils
assets/             运行时模型（*.glb）
tools/              美术资产管线脚本
```

## 美术资产管线

- 运行时资产放在 `assets/*.glb`，命名与朝向约定见 [assets.js](src/assets.js#L20)。**文件缺失时会静默降级为内置几何模型**，游戏仍可启动。
- 原始素材放在 `assets_src/`（Mixamo FBX、Sketchfab GLB、贴图），**不入库**。
- `tools/blender/*.py` —— 在 Blender 后台生成木屋、步枪、合并 Mixamo 动画、批量预览等。
- `tools/merge-character.bat` —— Windows 一键把 `assets_src/mixamo/*.fbx` 合并成带骨骼动画的 `assets/player.glb`（需本机装有 Blender）。
- `tools/glb_info.js`、`tools/shrink_glb.py` —— 查看 GLB 结构 / 压缩体积。
- `tools/convert_verdant.py` —— 把 Poly Haven「A Verdant Trail」(CC0) 原图转成 `assets/tex/` 下的 1K 地面 PBR、植被 RGBA 与 `sky.hdr`。
- `tools/make_water.py` —— 生成 `assets/tex/water_norm.png`（1024² 无缝水面法线 + 泡沫掩码，RGB 三通道，无 alpha）。**素材包里没有水面贴图**（`water_tmp` 只是 Glass BSDF + Noise Bump 的纯节点材质），水面质感由该贴图与 `src/water.js` 的着色器共同实现；贴图缺失时自动回退程序化法线。
- `tools/make_reef_tex.py` + `tools/blender/build_reef.py` —— 把 `drone-island.fbx`（航拍扫描礁石小岛，125.7 万面 / 2 张 8K 正射贴图）转成 `assets/reef.glb`：贴图降到 2K、减面到 9.4 万、航拍水线归零（`y<0` 是水下礁盘，由游戏海面盖住）。南岸旧的纯色圆柱船体 + 5 根半圆环船肋 + 断桅杆已删除，改由 `src/structures.js` 的 `buildOffshoreReefs()` 放 1 块近岸搁浅礁 + 2 座外海离岸岛。
- `tools/blender/preview_reef.py` —— Blender Workbench 多角度预览扫描地形形态与水线。
- `assets/tex/` 由 `build.js` 递归拷进 `dist/assets/tex/`，新增贴图无需改构建脚本。
- `tools/fix_hips_offset.js` —— 修正 Mixamo 骨架的髋部偏移。

## 技术栈

Three.js r180（vendor 内置，不走 CDN）· 原生 ES Modules · esbuild 打包 · WebAudio 程序化音效与 BGM · 无框架、无构建工具链依赖。

## 未纳入版本库

见 [.gitignore](.gitignore)：

- `assets_src/` —— 原始素材，约 230MB，可由 `tools/` 脚本重新生成
- `bundle.js`、`dist/` —— 构建产物
- `node_modules/`、编辑器与系统文件、日志临时文件
