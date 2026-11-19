// 岛屿地形：高度场 / 区域判定 / 地形网格 / 水面
import * as THREE from 'three';
import { CFG, POND, SWAMP, MOUNT, RAFT, SPAWN, TRAIL, TRAIL_W, CABIN, MARBLE, SHRINE } from './config.js';
import { fbm, clamp, smoothstep, dist2, segDist2 } from './util.js';
import { groundDetail, groundNormal } from './textures.js';
import { createWaterMaterial, setWaterTime } from './water.js';

const R_ISLAND = 290, R_COAST = 247.5; // 岛屿半径 / 海岸线开始（2026-11-18 平面 ×1.25）
const EXTRA_POOLS = [
  { x: 82.5, z: -165, r: 35, y: 5.6, depth: 3.4, w: 72.5, d: 67.5 },
  { x: 126.25, z: -102.5, r: 28.75, y: 4.7, depth: 2.7, w: 60, d: 57.5 },
  // 原 #3 (68.75,-35) 已删（2026-11-19）：它的 plane 压在断魂谷河道北坡上空，
  // noFloat 渐隐水裙+矩形北缘直线边在河面上方形成"第二层水"（用户要求去掉，
  // 只保留河流）；其盆地填底同时把河床抬到 1.4 使河水东段断流。删除后河道
  // 贯通，地形回归峡谷剖面。
  { x: 135, z: 32.5, r: 38.75, y: 3.2, depth: 1.9, w: 80, d: 72.5 },
];

// —— 基础地形高度（不含桥/木板/结构物平台覆盖） ——
export function baseHeight(x, z) {
  const r = dist2(x, z, 0, 0);
  // 大陆轮廓：内岛抬高 → 沙滩环 → 海床
  const coast = smoothstep(310, 295, r);
  let h = -13 + 15 * coast;
  h += 3.2 * smoothstep(256, 206, r);                        // 内陆基底抬升
  h += fbm(x * 0.011, z * 0.011, 4) * (2.5 + 9 * smoothstep(262, 162, r)); // 丘陵起伏
  h += fbm(x * 0.05, z * 0.05, 3) * 1.1;
  // 山体（2026-11-19e 穿山峡谷移除，合并为一座双峰山）：
  // 左右两座山头（x≈±34），中间鞍部凹进去——但鞍部仍保留 ~32% 峰高，
  // 是海拔十几米的垭口（远高于周围林地），引导小径从垭口翻山到北岸。
  const dm = dist2(x, z, MOUNT.x, MOUNT.z);
  const mf = 1 - smoothstep(60, 105, dm);
  const ridge = 1 - Math.abs(fbm(x * 0.028 + 3, z * 0.028 - 7, 3)) * 2;
  // 双峰塑形（沿 x 的 W 型）：两个山头全高，鞍部处峰值衰减到 52%，山体两翼归零。
  // 山头中心 ±44、鞍部宽钟到 36m：凹口开阔（半宽 ~30m），两侧是草坡山肩而非峡谷壁。
  const adx = Math.abs(x - MOUNT.x);
  const peakShape = Math.max(
    1 - smoothstep(12, 50, Math.abs(adx - 44)),          // 西山头
    1 - smoothstep(12, 50, Math.abs(adx + 44)),          // 东山头
    0.52 * (1 - smoothstep(0, 36, adx)),                 // 鞍部垭口（凹槽仍有高度）
  );
  h += (40 + ridge * 16 + fbm(x * 0.055, z * 0.055, 3) * 12) * mf * mf * peakShape;
  // 中央锥体加高：同样沿双峰塑形衰减，避免鞍部中央再鼓出一个 16m 锥顶
  h += 16 * Math.max(0, 1 - smoothstep(0, 42.5, dm)) * (0.7 + fbm(x * 0.09, z * 0.09, 2) * 0.6) * peakShape;
  // 山体侵蚀沟壑：打散过于光滑的锥体轮廓
  h += (fbm(x * 0.115, z * 0.115, 4) * 8.5 + fbm(x * 0.29, z * 0.29, 2) * 2.6) * mf;
  // 北屏峰（2026-11-19g 用户要求）：凹谷不得直通北海岸——谷底尽头（z≈-208 起）
  // 隆起一座横贯谷口的高山，把翻山垭口封成"死谷"；山北坡被沙滩混合带截断，
  // 自然形成临海陡崖。高度与主山双峰同量级（总峰 ~60m），翻不过去。
  {
    const wallZ = smoothstep(-208, -236, z);                       // 谷底尽头往北隆起
    const wallX = 1 - smoothstep(52, 82, Math.abs(x));             // 东西两端接回山体林地
    const wf = wallZ * wallX;
    if (wf > 0) {
      const ridgeB = 1 - Math.abs(fbm(x * 0.03 + 7.1, z * 0.03 - 3.4, 3)) * 2;
      h += (34 + ridgeB * 10 + fbm(x * 0.05, z * 0.05, 3) * 7) * wf * wf;
      h += (fbm(x * 0.115 + 2.2, z * 0.115 + 5.5, 4) * 6 + fbm(x * 0.29, z * 0.29, 2) * 2) * wf;
    }
  }
  // 断魂谷峡谷（东西走向）——深谷剖面
  // 2026-11-19 修复：旧版「谷缘抬平」用 smoothstep(35,25,dzr) 把 dzr<25 的整片谷底
  // （含崖壁下段）强制抬到 6.2m——深渊消失变成平板、索桥成摆设、player 的坠落
  // 判定（y<-8.5 拽回桥头）成死代码，且开凿半宽 40 一路吞到木屋地基造成假台阶。
  // 现改为：谷底 dzr<14 全量开凿（-10.2 起伏河床，保证低于 -8.5 坠落线），
  // dzr 14~24 陡壁渐出，dzr>24 回归自然地形（≈6m，与索桥桥头/木屋地基同高）。
  // 2026-11-19b 自然化（用户反馈"河道有直角、太直，像人工开挖"）：
  //   a) 中线随 fbm 东西蜿蜒 ±4m（fbm 3 阶 ±0.5 × 8）——旧版横断面沿 x 恒定、
  //      两岸平行如引水渠。蜿蜒在 |x|<18 锁死为 0（索桥桥位不动）；
  //      蜿蜒上限保证木屋处 dzr ≥ 22.9 > 23.5-wob，木屋地基仍不被啃。
  //   b) 谷身向两端渐隐（x 100→133 淡出）——旧版 |x|<135 一刀切，谷道两端
  //      是垂直端墙+直角水面；现在河道以自然坡地收尾，水线随地形闭合。
  const zc = -7.5 + fbm(x * 0.02 + 9.3, 4.7, 3) * 8 * smoothstep(18, 48, Math.abs(x));
  const dzr = Math.abs(z - zc);
  if (dzr < 40 && Math.abs(x) < 135) {
    // 崖缘沿东西向蜿蜒（±2.5m）：整条峡谷不再是同一个均匀断面的"拉坯"感。
    // e0 上限压在 22，保证索桥桥头（dzr=25）与木屋（dzr≈27）处 carve 恒为 0、地面不被啃。
    const wob = fbm(x * 0.04 + 3.7, 2.3, 3) * 5.0;
    const taper = 1 - smoothstep(100, 133, Math.abs(x));
    const carve = smoothstep(22 + wob * 0.6, 13 + wob * 0.6, dzr) * taper;
    if (carve > 0) {
      // fbm 3 阶实际输出 ±0.5 左右：振幅按此标定，保证玩家视角内谷底有冲沟起伏
      // （峰值 -9.2 仍低于 -8.5 坠落线，谷底任何位置坠入都会被拽回桥头）
      const floorY = -10.2 + fbm(x * 0.09, z * 0.09, 3) * 1.4 + fbm(x * 0.22, z * 0.22, 2) * 0.45;
      h = h * (1 - carve) + floorY * carve;
      // 崖面高频起伏：冲沟/凸岩只在崖壁过渡带（carve≈0.5）出现，崖顶谷底不受影响
      h += fbm(x * 0.14 + 9.1, z * 0.14 + 4.7, 4) * 1.7 * carve * (1 - carve) * 4.0;
    }
  }
  // 翻山小径踩踏（2026-11-19g 改：小径止于凹谷神像，不再翻山通北岸——
  // 北屏峰封谷后，北岸只能沿环岛滩涂绕行）：
  // 山体+丘陵+断魂谷北崖的原始坡局部可达 50~60°，玩家没法走。沿 TRAIL 山道段
  // 把高于"路线海拔包络"的部分削掉，中心削得最深、向两侧 5→13m 淡出，
  // 踩出一条 ≤25% 坡度的盘山小径（包络本身是 smoothstep 拼接，无折角）。
  {
    const tz = z;
    if (tz < -33 && tz > -212) {   // 含断魂谷北崖（z≈-48..-56）：小径过桥即上山，崖壁也得踩平
      const passY = 6.6 + 17.4 * smoothstep(-58, -150, tz) - 15.4 * smoothstep(-150, -202, tz);
      const tdd = trailDist(x, z);
      if (tdd < 22) {
        const tc = 1 - smoothstep(8, 22, tdd);
        // 山道面 = 海拔包络 + 大型山石坑洼（2026-11-19f 用户要求：不要贴皮平滑，
        // 要 2~5m 落差的坑洼山石，增加翻山难度）：
        //   低频鼓包/凹坑 ±1.6m（~9m 尺度）+ 中频碎石堆 ±0.7m + 高频碎砾 ±0.2m
        //   → 相邻坑洼典型落差 2~4m、极限 ~5m。连续坡面（非垂直台阶），
        //   玩家贴地可攀爬但翻山耗时明显增加。
        // 桥头衔接（2026-11-19h）：+1.2 抬升与坑洼在 -33~-50 段淡入——旧版在桥北端
        // 是一道 1.2m 的硬台阶（桥面 6.65 / 路面 7.8），加入坡度限制后玩家上不了岸。
        const fade = smoothstep(-33, -50, tz);
        const trail = passY + (1.2
          + fbm(x * 0.11, z * 0.11, 3) * 3.2
          + fbm(x * 0.30, z * 0.30, 2) * 1.4
          + fbm(x * 0.8, z * 0.8, 2) * 0.4) * fade;
        h += (trail - h) * tc;
      }
    }
  }
  // 东侧低洼水潭群：用多个不规则盆地取代人工溪流，水面严格由盆地边缘承托。
  for (const p of EXTRA_POOLS) {
    const d = dist2(x, z, p.x, p.z);
    if (d < p.r) {
      const basin = smoothstep(p.r, p.r * 0.34, d);
      const floor = p.y - p.depth + fbm(x * 0.11 + p.x, z * 0.11 - p.z, 2) * 0.22;
      h = h * (1 - basin) + floor * basin;
    }
  }
  // 东岭山（2026-11-18 起：JS 程序化生成，取代 marble.glb 采石场扫描件）
  // 与洞穴主山同源的 fbm 算法——双峰 + 山脊 + 侵蚀沟壑，风格与全岛统一；
  // 椭圆 footprint 避免正圆人工感，山顶过 46m 植被自然绝迹成裸岩。
  {
    const dx = x - MARBLE.x, dz = (z - MARBLE.z) / 0.86;
    const d = Math.hypot(dx, dz);
    let me = 1 - smoothstep(46, 104, d);   // 核心 / 外缘衰减
    if (me > 0) {
      // 东侧水潭避让：山体在水潭中心一带衰减为 0，避免把盆地抬成山顶深井；
      // 水潭水面由 EXTRA_POOLS 独立 plane 承托，山从水潭东侧自然升起
      let poolMask = 1;
      for (const p of EXTRA_POOLS) {
        poolMask *= smoothstep(p.r * 0.75, p.r * 2.0, dist2(x, z, p.x, p.z));
      }
      me *= poolMask;
    }
    if (me > 0) {
      const ridge = 1 - Math.abs(fbm(x * 0.021 + 5.3, z * 0.021 - 2.7, 3)) * 1.7;
      const crest = Math.max(0, 1 - smoothstep(0, 34, d));                       // 主峰尖顶
      const d2 = Math.hypot(x - (MARBLE.x - 30), z - (MARBLE.z + 18)) / 0.9;
      const second = Math.max(0, 1 - smoothstep(18, 52, d2));                    // 西南次峰
      h += (44 + ridge * 14 + fbm(x * 0.045, z * 0.045, 3) * 12) * me * me;
      h += (crest * 10 + second * 16) * me;
      // 侵蚀沟壑：打散过于光滑的锥体轮廓
      h += (fbm(x * 0.1 + 9, z * 0.1 - 4, 4) * 7.5 + fbm(x * 0.26, z * 0.26, 2) * 2.2) * me;
    }
  }
  // 水塘凹陷
  const dp = dist2(x, z, POND.x, POND.z);
  if (dp < 52.5) { const c = smoothstep(52.5, 22.5, dp); h = h * (1 - c) + (0.9 + fbm(x * 0.08, z * 0.08, 2) * 0.5) * c; }
  // 沼泽压平
  const ds = dist2(x, z, SWAMP.x, SWAMP.z);
  if (ds < 65) { const c = smoothstep(65, 32.5, ds); h = h * (1 - c) + (2.1 + fbm(x * 0.06, z * 0.06, 2) * 0.35) * c; }
  // 沙滩：从内陆缓坡一路降到海水线以下，形成真正的岸线（湿沙带在 r≈264）
  if (r > 222.5) {
    const c = smoothstep(222.5, 247.5, r) * (1 - smoothstep(300, 327.5, r));
    const beach = 2.4 - smoothstep(245, 300, r) * 6.6;
    const ripple = (1 - smoothstep(245, 270, r)) * 0.6 * fbm(x * 0.06, z * 0.06, 2);
    h = h * (1 - c) + (beach + ripple) * c;
  }
  // 南岸出生地压平
  const dsp = dist2(x, z, SPAWN.x, SPAWN.z);
  if (dsp < 25) { const c = smoothstep(25, 10, dsp); h = h * (1 - c) + 2.3 * c; }
  // 林中木屋空地压平（地基平台）
  const dc = dist2(x, z, CABIN.x, CABIN.z);
  if (dc < 30) { const c = smoothstep(30, 15, dc); h = h * (1 - c) + CABIN.padY * c; }
  // 凹谷神像祭台（2026-11-19g）：谷底尽头的小块平整台地，神像立于其上
  const dsh = dist2(x, z, SHRINE.x, SHRINE.z);
  if (dsh < 14) { const c = smoothstep(14, 8, dsh); h = h * (1 - c) + (8.7 + fbm(x * 0.09, z * 0.09, 2) * 0.25) * c; }
  // 北岸筏点：挖出一处浅湾，让救生筏真正浮在水面上
  const dr = dist2(x, z, RAFT.x, RAFT.z);
  if (dr < 27.5) {
    const c = smoothstep(27.5, 11.25, dr);
    h = h * (1 - c) + (-1.15 + fbm(x * 0.14, z * 0.14, 2) * 0.22) * c;
  }
  return h;
}

// —— 可站立面注册（结构物地板 / 门廊 / 坡道楼梯等） ——
// rects: {x0,x1,z0,z1,y,minY} 常高平台；ramps: {x0,x1,z0,z1,ax0,ay0,ax1,ay1} 沿 x 线性坡
// minY = 面存在的最低"脚下高度"：低于它的调用者（如从桥下/楼梯下走过）不会被吸上去。
// curY 缺省 Infinity（拾取物生成、子弹落点等按最高面处理）。
export const surfaceRects = [];
export const surfaceRamps = [];
function surfaceHeight(x, z, curY = Infinity) {
  let best = -1e9, hit = false;
  for (const r of surfaceRects) {
    if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
    if (curY < r.y - 0.95) continue;
    if (r.y > best) { best = r.y; hit = true; }
  }
  for (const r of surfaceRamps) {
    if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
    const t = r.ax1 !== r.ax0 ? (x - r.ax0) / (r.ax1 - r.ax0) : 0;
    const y = r.ay0 + (r.ay1 - r.ay0) * clamp(t, 0, 1);
    if (curY < y - 0.95) continue;
    if (y > best) { best = y; hit = true; }
  }
  return hit ? best : null;
}

// 供行走的地面高度（含索桥/木板路/结构物平台覆盖）
export function groundHeight(x, z, bridgeSway = 0, curY = Infinity) {
  let h = baseHeight(x, z);
  // 索桥桥面
  if (Math.abs(x) < 3.25 && z < 20 && z > -35) h = CFG.BRIDGE_Y + bridgeSway;
  // 沼泽木板路
  else if (Math.abs(x - SWAMP.x) < 2.4 && z < 120 && z > 13) h = Math.max(baseHeight(x, z), CFG.SWAMP_Y + 0.55);
  // 北岸栈桥（尾端压到渔船甲板边缘）
  else if (Math.abs(x - (RAFT.x - 2.4)) < 1.02 && z < RAFT.z + 12.6 && z > RAFT.z - 1.0) h = 0.96;
  // 结构物平台（木屋地板/门廊/楼梯等）
  const s = surfaceHeight(x, z, curY);
  if (s !== null && s > h) h = s;
  return h;
}

// —— 渲染网格高度（与 buildTerrain 的网格完全一致） ——
// 地面网格是 230 段平面片，顶点精确、片内线性插值；baseHeight 在 2.43m 一格的
// 噪声地形上最多能差 4m（隧道口那条窄沟尤其夸张）。所有"贴着地面摆"的物体
// （树/石头/断桩/浮木）都必须用它定位，否则坡地和沟沿会明显悬空或半埋。
const GRID_SEG = 270;
const GRID_STEP = CFG.WORLD / GRID_SEG;
const GRID_HALF = CFG.WORLD / 2;
export const TERRAIN_SEG = GRID_SEG;
export function terrainY(x, z) {
  const fx = clamp((x + GRID_HALF) / GRID_STEP, 0, GRID_SEG - 1e-6);
  const fz = clamp((z + GRID_HALF) / GRID_STEP, 0, GRID_SEG - 1e-6);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const x0 = -GRID_HALF + i * GRID_STEP, z0 = -GRID_HALF + j * GRID_STEP;
  const h00 = baseHeight(x0, z0), h10 = baseHeight(x0 + GRID_STEP, z0);
  const h01 = baseHeight(x0, z0 + GRID_STEP), h11 = baseHeight(x0 + GRID_STEP, z0 + GRID_STEP);
  const a = h00 + (h10 - h00) * u, b = h01 + (h11 - h01) * u;
  return a + (b - a) * v;
}

export function trailDist(x, z) { // 到引导小径的距离
  let d = 1e9;
  for (let i = 0; i < TRAIL.length - 1; i++) {
    if (TRAIL[i + 1].brk) continue;         // 折线断点：主线与支线不相连
    d = Math.min(d, segDist2(x, z, TRAIL[i].x, TRAIL[i].z, TRAIL[i + 1].x, TRAIL[i + 1].z));
  }
  return d;
}

// —— 地形网格（顶点色：沙滩/草地/泥路/沼泽/岩石） ——
// 注意：Color 会做 sRGB→线性转换，再乘地面贴图（~0.3 线性），
// 所以这里的十六进制值要按「最终 albedo」反推，整体比直观值亮 2~3 档。
const C_SAND = new THREE.Color(0xcbb894), C_GRASS = new THREE.Color(0x6d6c46),
      C_GRASS2 = new THREE.Color(0x8b8652), C_ROCK = new THREE.Color(0x8a8478),
      C_TRAIL = new THREE.Color(0x97785a), C_MUD = new THREE.Color(0x6b5c46),
      C_MOSS = new THREE.Color(0x53643a),
      C_WETSAND = new THREE.Color(0xa89a78), C_HUMUS = new THREE.Color(0x82694c);

export function buildTerrain(scene) {
  const SEG = GRID_SEG, S = CFG.WORLD; // 与 terrainY() 共用同一套网格常量，禁止各自硬编码
  const geo = new THREE.PlaneGeometry(S, S, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  // splat 权重：0=林地 1=泥土/小径 2=岩石 3=沙滩，供真实 PBR 的 4 路混合使用
  // （程序化材质回退时忽略该属性）
  const splats = new Float32Array(pos.count * 4);
  // 山道岩化（2026-11-19）：凹口翻山段的小径与山体共用同一套湿岩材质，
  // 以独立 float 属性传给 shader（splat 四通道已满，且泥土通道还承担腐殖土/沼泽）
  const trailRocks = new Float32Array(pos.count);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = baseHeight(x, z);
    pos.setY(i, h);
    // 坡度
    const e = 1.6;
    const sx = baseHeight(x + e, z) - baseHeight(x - e, z);
    const sz = baseHeight(x, z + e) - baseHeight(x, z - e);
    const slope = Math.hypot(sx, sz) / (2 * e);
    // 基础草色（多尺度噪声混色，避免大片平色）
    const n1 = fbm(x * 0.022 + 9, z * 0.022 + 9, 3);
    const n2 = fbm(x * 0.11 - 4, z * 0.11 - 4, 2);
    c.copy(C_GRASS).lerp(C_GRASS2, clamp(n1 * 1.6 + 0.5, 0, 1));
    c.offsetHSL(0, n2 * 0.05, n2 * 0.055);
    if (n1 < -0.12) c.lerp(C_MOSS, 0.55);                     // 苔藓暗斑
    // 腐殖土（雨林地面积满落叶，露出大片褐色土壤）
    const hum = fbm(x * 0.055 + 31, z * 0.055 - 17, 3);
    if (hum > 0.26) c.lerp(C_HUMUS, smoothstep(0.26, 0.70, hum) * 0.86);
    // 更细的落叶斑块，打散“整片草地”的均质感
    const hum2 = fbm(x * 0.16 - 51, z * 0.16 + 27, 2);
    if (hum2 > 0.26) c.lerp(C_HUMUS, smoothstep(0.26, 0.80, hum2) * 0.36);
    // 小径泥土（山道段走高处门控：海拔 >7.5m 的翻山段转岩石色，
    // 与 shader 里的 trailRock 门控保持同一阈值，程序化回退材质也一致）
    const td = trailDist(x, z);
    const trailRockAmt = smoothstep(TRAIL_W + 2.5, TRAIL_W * 0.3, td)
      * smoothstep(7.5, 12.5, h) * 0.92;
    if (td < TRAIL_W + 2) {
      c.lerp(trailRockAmt > 0.25 ? C_ROCK : C_TRAIL,
        smoothstep(TRAIL_W + 1.6, TRAIL_W * 0.35, td) * 0.7);
    }
    // 沼泽泥
    if (ds_(x, z) < 50) c.lerp(C_MUD, smoothstep(50, 30, ds_(x, z)) * 0.8);
    // 岩石（陡坡 / 高山）：40° 以下坡面保留草被，49°+ 才转裸岩——
    // 山体凹口两侧 40~45° 草坡不再是"岩石峡谷壁"的观感
    const rockAmt = clamp(smoothstep(0.72, 1.15, slope) + smoothstep(26, 40, h), 0, 1);
    c.lerp(C_ROCK, rockAmt);
    // 沙滩（海岸 + 水塘岸）
    const rd = dist2(x, z, 0, 0);
    if (h < 3.6 && rd > 186) c.lerp(C_SAND, smoothstep(3.6, 2.0, h));
    if (h < 2.0) c.lerp(C_WETSAND, smoothstep(2.0, 1.0, h) * 0.7);
    const pw = dist2(x, z, POND.x, POND.z);
    if (pw < 40) c.lerp(C_SAND, smoothstep(40, 26, pw) * smoothstep(3.6, 3.1, h) * 0.8);
    // 顶点级斑驳：让草地/岩石/沙地不出现大片均色
    const mott = fbm(x * 0.19 + 11, z * 0.19 - 5, 2) * 0.055 + fbm(x * 0.045, z * 0.045, 2) * 0.05;
    c.offsetHSL(0, 0, mott);
    // 岩壁：额外的深浅斑块，避免大面积均色
    if (slope > 0.34) c.offsetHSL(0, 0, fbm(x * 0.42, z * 0.42, 3) * 0.085);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;

    // —— 真实 PBR 的 splat 权重：按"覆盖"依次叠加，天然保持四项和为 1 ——
    const w = [1, 0, 0, 0];
    const cover = (idx, a) => {
      a = clamp(a, 0, 0.98);
      for (let k = 0; k < 4; k++) w[k] *= 1 - a;
      w[idx] += a;
    };
    const edge = fbm(x * 0.13 + 61, z * 0.13 - 23, 2) * 0.07; // 打散材质边界
    // 泥土：引导小径（仅低海拔段）/ 腐殖土斑块 / 沼泽泥泞
    const trailAmt = smoothstep(TRAIL_W + 2.5, TRAIL_W * 0.3, td) * 0.9;
    const humusAmt = smoothstep(0.20, 0.72, hum) * 0.52 + smoothstep(0.26, 0.80, hum2) * 0.18;
    const mudAmt = smoothstep(52, 26, ds_(x, z)) * 0.72;
    cover(1, Math.max(trailAmt * (1 - smoothstep(7.5, 12.5, h)), humusAmt, mudAmt) + edge);
    // 山道岩化：高处翻山段交给 shader 的 rockW（与山体同一湿岩材质）
    trailRocks[i] = trailRockAmt;
    // 岩石：陡坡 / 高山
    cover(2, rockAmt * 1.06 + edge);
    // 沙滩：环岛海岸 + 水塘岸（沿用旧顶点色的判定条件）
    let sandAmt = 0;
    if (rd > 178) sandAmt = smoothstep(4.6, 1.7, h) * smoothstep(178, 196, rd);
    sandAmt = Math.max(sandAmt, smoothstep(40, 24, pw) * smoothstep(3.8, 2.9, h) * 0.9);
    cover(3, sandAmt + edge);
    splats[i * 4] = w[0]; splats[i * 4 + 1] = w[1];
    splats[i * 4 + 2] = w[2]; splats[i * 4 + 3] = w[3];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('splat', new THREE.BufferAttribute(splats, 4));
  geo.setAttribute('trailrock', new THREE.BufferAttribute(trailRocks, 1));
  geo.computeVertexNormals();
  const detail = groundDetail();
  detail.repeat.set(70, 70);
  detail.anisotropy = 16;
  detail.needsUpdate = true;
  const gN = groundNormal();
  gN.repeat.set(52, 52);
  gN.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, map: detail, roughness: 0.95, metalness: 0,
    normalMap: gN, normalScale: new THREE.Vector2(0.85, 0.85),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  buildWaterField();          // 水面距离场（水流环境音用）
  return mesh;
}
function ds_(x, z) { return dist2(x, z, SWAMP.x, SWAMP.z); }

// —— 水面：先按真实地形高度烘焙水深图，再由 water.js 做波纹/深浅/泡沫 ——
// 水深图是让"平面水"显出浅滩、岸线白沫和水色层次的关键（纯贴图做不到）。
// basinR：盆地区半径，烘焙进 alpha 通道。水面矩形往往比挖了盆地的范围大，
// 超出盆地的部分盖在陆地起伏上会凭空浮出一层水（悬空水），掩码把它们直接透明掉。
function depthMap(w, d, cx, cz, y, scale, res, basinR, maskFn, noFloat) {
  const data = new Uint8Array(res * res * 4);
  for (let j = 0; j < res; j++) {
    const z = cz + (j / (res - 1) - 0.5) * d;
    for (let i = 0; i < res; i++) {
      const x = cx + (i / (res - 1) - 0.5) * w;
      const v = clamp((y - baseHeight(x, z)) / scale, 0, 1);
      const k = (j * res + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = (v * 255) | 0;
      // 盆地掩码：盆区内 = 1，超出盆地半径 ±4% 平滑过渡到 0（海面不传 basinR 则全 1）。
      // 渐隐带宽要窄：掠射角下宽渐隐带会像一块灰板浮在林地上。
      // maskFn：非圆形水域（如断魂谷河道）用自定义掩码取代径向盆地——
      //   这里传入"水线掩码"：地形高于水面 +0.45m 即为 0，避免半透明水膜爬上崖壁。
      // noFloat：防悬空掩码——内陆水面（沼泽/水潭）的径向盆地不知道远处山谷被开挖，
      //   地形低于 水面-noFloat 时水体悬在空中（沼泽曾整片飘在断魂谷上空 10m）。
      //   地形回落到 y-noFloat 以下 1m 内平滑隐掉；海面不启用（深海必须可见）。
      let m = maskFn ? maskFn(x, z)
        : basinR
          ? 1 - smoothstep(basinR * 0.96, basinR * 1.04, Math.hypot(x - cx, z - cz))
          : 1;
      if (noFloat) m *= smoothstep(y - noFloat - 1.0, y - noFloat, baseHeight(x, z));
      if (basinR) {
        // 坡度门（2026-11-19 用户：水漂浮在陆地上）——水面爬上陡坡（崖壁/山脚坡面）
        // 会像一层半透明膜浮在干地上：坡面低于水位的那段被同一水位面盖住。
        // 合法岸线都是缓坡（水塘/沼泽 p99≤0.34，东潭 p99≤0.47）；
        // 穿帮段坡度 0.8~3（北潭山脚崖壁、沼泽爬上河道南岸）。门限 0.42~0.60。
        const e = 1.2;
        const sl = Math.hypot(
          baseHeight(x + e, z) - baseHeight(x - e, z),
          baseHeight(x, z + e) - baseHeight(x, z - e)) / (2 * e);
        m *= 1 - smoothstep(0.42, 0.60, sl);
      }
      data[k + 3] = (clamp(m, 0, 1) * 255) | 0;
    }
  }
  const t = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

const waters = [];
// 给水面挂上天空环境贴图（PMREM），让海面真正映出天色而不是一片死绿
export function setWaterEnv(tex) {
  if (!tex) return;
  // 大海主要映天光；水塘/河道/沼泽被树冠遮着，反射要弱，否则会变成一片惨白
  // 顺序与 buildWaters 的 mk 顺序一致：0 海 1 水塘 2 断魂谷河道 3 沼泽 4+ 东侧水潭
  const inten = [0.92, 0.26, 0.24, 0.20];
  waters.forEach((m, i) => {
    m.envMap = tex;
    m.envMapIntensity = inten[i] ?? 0.3;
    m.metalness = i === 0 ? 0.16 : 0.04;
    m.needsUpdate = true;
  });
}

export function buildWaters(scene) {
  const mk = (o) => {
    const depth = depthMap(o.w, o.d, o.x, o.z, o.y, o.depthScale, o.depthRes, o.basin, o.maskFn, o.noFloat);
    const m = createWaterMaterial({
      depth, center: [o.x, o.z], size: [o.w, o.d],
      deep: o.deep, shallow: o.shallow, opacity: o.opacity,
      rough: o.rough, metalness: o.metalness,
      nrmScale: o.nrmScale, ripple: o.ripple, wave: o.wave, foam: o.foam,
      waveFoam: o.waveFoam,
      sunGloss: o.sunGloss, sunStrength: o.sunStrength,
      killInland: o.killInland,   // 海面内陆防漏遮罩半径（见 water.js FRAG_BODY 注释）
    });
    // 海面要足够密才能托住 27m 短浪（192 段 ≈ 5.5m/格），否则波峰被削成三角锯齿
    const g = new THREE.PlaneGeometry(o.w, o.d, o.seg, o.seg);
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(o.x, o.y, o.z);
    mesh.renderOrder = 2;
    scene.add(mesh);
    waters.push(m);
    return mesh;
  };
  // 大海：Gerstner 主浪 + 强天光反射；wave 是浪幅倍率，风力由 env 每帧叠加。
  // killInland：内陆遮罩——海面矩形盖全球，凡内陆地形低于海平面处（断魂谷河床、
  // 丘陵随机洼地）旧版都会被灌进蓝色海水；现在 r<238 整片隐掉，内陆水一律
  // 由下方的水塘/河道/沼泽等淡水 plane 承载（阈值推导见 water.js FRAG_BODY 注释）
  mk({ w: CFG.WORLD * 1.9, d: CFG.WORLD * 1.9, x: 0, z: 0, y: CFG.SEA_Y, seg: 192,
    depthScale: 7, depthRes: 512, killInland: [238, 248],
    deep: 0x0d3440, shallow: 0x3e8c8b, opacity: 0.93, rough: 0.17, metalness: 0.16,
    nrmScale: 0.032, ripple: 0.85, wave: 1.3, foam: 0.7, waveFoam: 0.62,
    sunGloss: 110, sunStrength: 0.85 });
  // 水塘：树荫下的静水，只留极轻的呼吸起伏，不能有海浪
  mk({ w: 140, d: 130, x: POND.x, z: POND.z, y: CFG.POND_Y, seg: 48, basin: 52.5,
    depthScale: 1.8, depthRes: 192, noFloat: 2.2,
    deep: 0x173c33, shallow: 0x4c7d61, opacity: 0.88, rough: 0.18, metalness: 0.05,
    nrmScale: 0.10, ripple: 0.55, wave: 0.12, foam: 0.75, waveFoam: 0,
    sunGloss: 70, sunStrength: 0.35 });
  // 断魂谷内陆河（2026-11-19）：谷底 -10.2 低于海平面，旧版靠全球海面 plane 顺带
  // 灌水——蓝色海水+海浪直接出现在内陆。现由独立淡水河 plane 承载，与水塘/水潭
  // 同一套淡水资源（同色同浪），衔接自然。
  // 掩码用水线：地形高于水面 +0.45m 即隐掉，水面只留在真实河床里，不爬崖壁。
  // depthScale 由 7 放宽到 28：谷底恒深 10m 会把深度打到饱和 → 深水色偏蓝青+天光
  // 反射整条河读成"钢蓝色海"，与旁边水塘的浅绿判若两物；放宽后中游 ≈0.36 深度、
  // 岸边趋 0，渲染出与水潭一致的浅绿渐变（用户验收基准：像水塘一样自然）。
  mk({ w: 280, d: 68, x: 0, z: -7.5, y: CFG.SEA_Y, seg: 64, basin: null,
    depthScale: 28, depthRes: 256,
    maskFn: (x, z) => 1 - smoothstep(CFG.SEA_Y - 0.25, CFG.SEA_Y + 0.45, baseHeight(x, z)),
    deep: 0x193f35, shallow: 0x66836a, opacity: 0.9, rough: 0.25, metalness: 0.025,
    nrmScale: 0.12, ripple: 0.46, wave: 0.10, foam: 0.9, waveFoam: 0,
    sunGloss: 58, sunStrength: 0.22 });
  // 沼泽：浑水、几乎无浪；noFloat=1.0（沼泽底 2.1、水面 2.6，正常水深 ≤0.7）——
  // basin 半径 65 曾把水面矩形伸到断魂谷开凿区上空，谷坡被挖到 -2~-7m 处
  // 沼泽水整片悬空 10m，其 basin 渐隐边就是"两种水硬拼接"的生硬边界
  mk({ w: 165, d: 172.5, x: SWAMP.x, z: SWAMP.z, y: CFG.SWAMP_Y, seg: 48, basin: 65,
    depthScale: 1.1, depthRes: 192, noFloat: 1.0,
    deep: 0x26331d, shallow: 0x5c6a38, opacity: 0.94, rough: 0.28, metalness: 0.03,
    nrmScale: 0.14, ripple: 0.38, wave: 0.06, foam: 0.4, waveFoam: 0,
    sunGloss: 55, sunStrength: 0.15 });
  for (const p of EXTRA_POOLS) {
    // noFloat=p.depth：水潭压在山地/峡谷边缘，地形被开挖处不再悬空挂水裙
    // 东潭 (135,32.5) 与沼泽 basin 重叠：y 由 3.2 降到 2.45（低于沼泽 2.6），重叠区
    // 沼泽在上层遮住水潭、basin 渐隐处水潭同色系水面自然接续，消灭双层水面硬边
    const y4 = p.x === 135 ? 2.45 : p.y;
    mk({ w: p.w, d: p.d, x: p.x, z: p.z, y: y4, seg: 32, basin: p.r,
      depth: depthMap(p.w, p.d, p.x, p.z, y4, p.depth + 0.8, 128, p.r, null, p.depth),
      depthScale: p.depth + 0.8, depthRes: 128,
      deep: 0x193f35, shallow: 0x66836a, opacity: 0.9, rough: 0.25, metalness: 0.025,
      nrmScale: 0.12, ripple: 0.46, wave: 0.10, foam: 0.9, waveFoam: 0,
      sunGloss: 58, sunStrength: 0.22 });
  }
}

export function updateWaters(t) { setWaterTime(t); }

// —— 区域判定（供游戏逻辑） ——
export function zoneState(x, z) {
  const pondD = dist2(x, z, POND.x, POND.z);
  const swampD = ds_(x, z);
  const inWater = pondD < 30 && baseHeight(x, z) < CFG.POND_Y - 0.15;
  const inSwampWater = swampD < 44 && baseHeight(x, z) < CFG.SWAMP_Y + 0.2;
  const onBoard = Math.abs(x - SWAMP.x) < 2.4 && z < 120 && z > 13;
  const deep = dist2(x, z, 0, 0) > CFG.DEEP_R || (baseHeight(x, z) < -1.5 && dist2(x, z, 0, 0) > 268);
  // cave 字段保留给环境音/脚步接口：山体垭口露天，恒为 false（不再有封闭暗区）
  return { pondD, swampD, inWater, inSwampWater, onBoard, deep, cave: false };
}

// —— 到水面的距离场（供水流环境音） ——
// 启动时按 160×160 格烘焙一次「每格到最近水域的平面距离 + 水深」，运行时双线性采样，
// 每帧零地形计算开销。岸线就是"地形高度 < 水面高度"的那条线，所以格内直接比高度即可。
const WD_N = 190;                              // 网格精度：700m / 190 ≈ 3.7m
const WD_CELL = CFG.WORLD / (WD_N - 1);
let wdDist = null, wdDepth = null;             // 单位：米
export const WD_MAX = 30;

export function buildWaterField() {
  const N = WD_N, total = N * N;
  const dist = new Float32Array(total), depth = new Float32Array(total);
  const INF = 1e9;
  for (let j = 0; j < N; j++) {
    const z = -CFG.WORLD / 2 + j * WD_CELL;
    for (let i = 0; i < N; i++) {
      const x = -CFG.WORLD / 2 + i * WD_CELL;
      const h = baseHeight(x, z);
      // 该格归属的水面：沼泽 > 水塘 > 海（就近覆盖）
      let level = CFG.SEA_Y;
      if (dist2(x, z, SWAMP.x, SWAMP.z) < 65) level = CFG.SWAMP_Y;
      else if (dist2(x, z, POND.x, POND.z) < 52.5) level = CFG.POND_Y;
      for (const p of EXTRA_POOLS) {
        if (dist2(x, z, p.x, p.z) < p.r) level = Math.max(level, p.y);
      }
      const k = j * N + i;
      if (h <= level) { dist[k] = 0; depth[k] = level - h; }
      else { dist[k] = INF; depth[k] = 0; }
    }
  }
  // 倒角距离变换（两遍扫描，1/√2 权重），得到每格到最近水格的格数
  const D1 = 1, D2 = Math.SQRT2;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i, v = dist[k];
      if (v === 0) continue;
      let m = v;
      if (i > 0) m = Math.min(m, dist[k - 1] + D1);
      if (j > 0) {
        m = Math.min(m, dist[k - N] + D1);
        if (i > 0) m = Math.min(m, dist[k - N - 1] + D2);
        if (i < N - 1) m = Math.min(m, dist[k - N + 1] + D2);
      }
      dist[k] = m;
    }
  }
  for (let j = N - 1; j >= 0; j--) {
    for (let i = N - 1; i >= 0; i--) {
      const k = j * N + i, v = dist[k];
      if (v === 0) continue;
      let m = v;
      if (i < N - 1) m = Math.min(m, dist[k + 1] + D1);
      if (j < N - 1) {
        m = Math.min(m, dist[k + N] + D1);
        if (i < N - 1) m = Math.min(m, dist[k + N + 1] + D2);
        if (i > 0) m = Math.min(m, dist[k + N - 1] + D2);
      }
      dist[k] = m;
    }
  }
  for (let k = 0; k < total; k++) dist[k] = Math.min(WD_MAX, dist[k] * WD_CELL);
  wdDist = dist; wdDepth = depth;
  console.log('[terrain] 水面距离场已烘焙 ' + N + '×' + N);
}

// 双线性采样：{ dist: 离最近水面的米数（0=水中）, depth: 水深(m) }
export function waterDistance(x, z) {
  if (!wdDist) return { dist: WD_MAX, depth: 0 };
  const fx = clamp((x + CFG.WORLD / 2) / WD_CELL, 0, WD_N - 1.001);
  const fz = clamp((z + CFG.WORLD / 2) / WD_CELL, 0, WD_N - 1.001);
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
  const N = WD_N, k = j * N + i;
  const b = (a, kk) => a[kk] * (1 - u) * (1 - v) + a[kk + 1] * u * (1 - v)
    + a[kk + N] * (1 - u) * v + a[kk + N + 1] * u * v;
  return { dist: b(wdDist, k), depth: b(wdDepth, k) };
}
