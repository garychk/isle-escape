// 岛屿地形：高度场 / 区域判定 / 地形网格 / 水面
import * as THREE from 'three';
import { CFG, POND, SWAMP, MOUNT, RAFT, SPAWN, TRAIL, TRAIL_W, CABIN } from './config.js';
import { fbm, clamp, smoothstep, dist2, segDist2 } from './util.js';
import { groundDetail, groundNormal } from './textures.js';
import { createWaterMaterial, setWaterTime } from './water.js';

const R_ISLAND = 232, R_COAST = 198; // 岛屿半径 / 海岸线开始

// —— 基础地形高度（不含桥/木板/洞穴覆盖） ——
export function baseHeight(x, z) {
  const r = dist2(x, z, 0, 0);
  // 大陆轮廓：内岛抬高 → 沙滩环 → 海床
  const coast = smoothstep(248, 236, r);
  let h = -13 + 15 * coast;
  h += 3.2 * smoothstep(205, 165, r);                        // 内陆基底抬升
  h += fbm(x * 0.011, z * 0.011, 4) * (2.5 + 9 * smoothstep(210, 130, r)); // 丘陵起伏
  h += fbm(x * 0.05, z * 0.05, 3) * 1.1;
  // 山体（洞穴所在）：主峰 + 次级山脊
  const dm = dist2(x, z, MOUNT.x, MOUNT.z);
  const mf = 1 - smoothstep(48, 84, dm);
  const ridge = 1 - Math.abs(fbm(x * 0.028 + 3, z * 0.028 - 7, 3)) * 2;
  h += (40 + ridge * 16 + fbm(x * 0.055, z * 0.055, 3) * 12) * mf * mf;
  h += 16 * Math.max(0, 1 - smoothstep(0, 34, dm)) * (0.7 + fbm(x * 0.09, z * 0.09, 2) * 0.6);
  // 山体侵蚀沟壑：打散过于光滑的锥体轮廓
  h += (fbm(x * 0.115, z * 0.115, 4) * 8.5 + fbm(x * 0.29, z * 0.29, 2) * 2.6) * mf;
  // 山腹隧道开凿（贯穿山体，供洞穴通行）
  if (Math.abs(x) < 12 && z < -44 && z > -180) {
    const cx = smoothstep(11, 6.4, Math.abs(x));
    const czm = smoothstep(-44, -54, z) * smoothstep(-180, -170, z);
    const c = cx * czm;
    if (c > 0) h = h * (1 - c) + (CFG.CAVE_Y - 0.5 + fbm(x * 0.09, z * 0.09, 2) * 0.35) * c;
  }
  // 断魂谷峡谷（东西走向，z=-6）
  const dzr = Math.abs(z + 6);
  if (dzr < 32 && Math.abs(x) < 108) {
    const carve = smoothstep(32, 10, dzr);
    h = h * (1 - carve) + (-9.5 + fbm(x * 0.1, z * 0.1, 2) * 0.9) * carve;
    h = h * (1 - smoothstep(28, 20, dzr)) + 6.2 * smoothstep(28, 20, dzr); // 谷缘抬平
  }
  // 水塘凹陷
  const dp = dist2(x, z, POND.x, POND.z);
  if (dp < 42) { const c = smoothstep(42, 18, dp); h = h * (1 - c) + (0.9 + fbm(x * 0.08, z * 0.08, 2) * 0.5) * c; }
  // 沼泽压平
  const ds = dist2(x, z, SWAMP.x, SWAMP.z);
  if (ds < 52) { const c = smoothstep(52, 26, ds); h = h * (1 - c) + (2.1 + fbm(x * 0.06, z * 0.06, 2) * 0.35) * c; }
  // 沙滩：从内陆缓坡一路降到海水线以下，形成真正的岸线（湿沙带在 r≈211）
  if (r > 178) {
    const c = smoothstep(178, 198, r) * (1 - smoothstep(240, 262, r));
    const beach = 2.4 - smoothstep(196, 240, r) * 6.6;
    const ripple = (1 - smoothstep(196, 216, r)) * 0.6 * fbm(x * 0.06, z * 0.06, 2);
    h = h * (1 - c) + (beach + ripple) * c;
  }
  // 南岸出生地压平
  const dsp = dist2(x, z, SPAWN.x, SPAWN.z);
  if (dsp < 20) { const c = smoothstep(20, 8, dsp); h = h * (1 - c) + 2.3 * c; }
  // 林中木屋空地压平（地基平台）
  const dc = dist2(x, z, CABIN.x, CABIN.z);
  if (dc < 24) { const c = smoothstep(24, 12, dc); h = h * (1 - c) + CABIN.padY * c; }
  // 北岸筏点：挖出一处浅湾，让救生筏真正浮在水面上
  const dr = dist2(x, z, RAFT.x, RAFT.z);
  if (dr < 22) {
    const c = smoothstep(22, 9, dr);
    h = h * (1 - c) + (-1.15 + fbm(x * 0.14, z * 0.14, 2) * 0.22) * c;
  }
  return h;
}

// 洞穴走廊覆盖（山腹隧道，x∈±8, z∈-172..-50）
export function inCaveCorr(x, z) { return Math.abs(x) < 9 && z < -46 && z > -176; }
export function inCaveDark(x, z) { return Math.abs(x) < 10 && z < -58 && z > -164; }

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

// 供行走的地面高度（含索桥/木板路/洞底/结构物平台覆盖）
export function groundHeight(x, z, bridgeSway = 0, curY = Infinity) {
  let h = baseHeight(x, z);
  // 索桥桥面
  if (Math.abs(x) < 2.6 && z < 16 && z > -28) h = CFG.BRIDGE_Y + bridgeSway;
  // 沼泽木板路
  else if (Math.abs(x - 86) < 2.4 && z < 96 && z > 10) h = Math.max(baseHeight(x, z), CFG.SWAMP_Y + 0.55);
  // 北岸栈桥（尾端压到渔船甲板边缘）
  else if (Math.abs(x - (RAFT.x - 2.4)) < 1.02 && z < RAFT.z + 12.6 && z > RAFT.z - 1.0) h = 0.96;
  // 洞底
  if (inCaveCorr(x, z)) h = CFG.CAVE_Y + fbm(x * 0.05, z * 0.05, 2) * 0.4;
  // 结构物平台（木屋地板/门廊/楼梯等）
  const s = surfaceHeight(x, z, curY);
  if (s !== null && s > h) h = s;
  return h;
}

// —— 渲染网格高度（与 buildTerrain 的网格完全一致） ——
// 地面网格是 230 段平面片，顶点精确、片内线性插值；baseHeight 在 2.43m 一格的
// 噪声地形上最多能差 4m（隧道口那条窄沟尤其夸张）。所有"贴着地面摆"的物体
// （树/石头/断桩/浮木）都必须用它定位，否则坡地和沟沿会明显悬空或半埋。
const GRID_SEG = 230;
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
      C_CAVE = new THREE.Color(0x6a6258), C_MOSS = new THREE.Color(0x53643a),
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
    // 小径泥土
    const td = trailDist(x, z);
    if (td < TRAIL_W + 2) c.lerp(C_TRAIL, smoothstep(TRAIL_W + 1.6, TRAIL_W * 0.35, td) * 0.7);
    // 沼泽泥
    if (ds_(x, z) < 50) c.lerp(C_MUD, smoothstep(50, 30, ds_(x, z)) * 0.8);
    // 洞内暗色
    if (inCaveCorr(x, z)) c.lerp(C_CAVE, 0.85);
    // 岩石（陡坡 / 高山）
    const rockAmt = clamp(smoothstep(0.5, 1.0, slope) + smoothstep(26, 40, h), 0, 1);
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
    // 泥土：引导小径 / 腐殖土斑块 / 沼泽泥泞
    const trailAmt = smoothstep(TRAIL_W + 2.5, TRAIL_W * 0.3, td) * 0.9;
    const humusAmt = smoothstep(0.20, 0.72, hum) * 0.52 + smoothstep(0.26, 0.80, hum2) * 0.18;
    const mudAmt = smoothstep(52, 26, ds_(x, z)) * 0.72;
    cover(1, Math.max(trailAmt, humusAmt, mudAmt) + edge);
    // 岩石：陡坡 / 高山 / 洞穴走廊
    cover(2, rockAmt * 1.06 + (inCaveCorr(x, z) ? 0.7 : 0) + edge);
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
function depthMap(w, d, cx, cz, y, scale, res) {
  const data = new Uint8Array(res * res * 4);
  for (let j = 0; j < res; j++) {
    const z = cz + (j / (res - 1) - 0.5) * d;
    for (let i = 0; i < res; i++) {
      const x = cx + (i / (res - 1) - 0.5) * w;
      const v = clamp((y - baseHeight(x, z)) / scale, 0, 1);
      const k = (j * res + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = (v * 255) | 0;
      data[k + 3] = 255;
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
  // 大海主要映天光；水塘/沼泽被树冠遮着，反射要弱，否则会变成一片惨白
  const inten = [0.92, 0.26, 0.20];
  waters.forEach((m, i) => {
    m.envMap = tex;
    m.envMapIntensity = inten[i] ?? 0.3;
    m.metalness = i === 0 ? 0.16 : 0.04;
    m.needsUpdate = true;
  });
}

export function buildWaters(scene) {
  const mk = (o) => {
    const depth = depthMap(o.w, o.d, o.x, o.z, o.y, o.depthScale, o.depthRes);
    const m = createWaterMaterial({
      depth, center: [o.x, o.z], size: [o.w, o.d],
      deep: o.deep, shallow: o.shallow, opacity: o.opacity,
      rough: o.rough, metalness: o.metalness,
      nrmScale: o.nrmScale, ripple: o.ripple, wave: o.wave, foam: o.foam,
      sunGloss: o.sunGloss, sunStrength: o.sunStrength,
    });
    const g = new THREE.PlaneGeometry(o.w, o.d, o.seg, o.seg);
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(o.x, o.y, o.z);
    mesh.renderOrder = 2;
    scene.add(mesh);
    waters.push(m);
    return mesh;
  };
  // 大海：长涌浪 + 强天光反射
  mk({ w: CFG.WORLD * 1.9, d: CFG.WORLD * 1.9, x: 0, z: 0, y: CFG.SEA_Y, seg: 128,
    depthScale: 7, depthRes: 512,
    deep: 0x0d3440, shallow: 0x3e8c8b, opacity: 0.93, rough: 0.17, metalness: 0.16,
    nrmScale: 0.032, ripple: 0.85, wave: 1.0, foam: 0.7,
    sunGloss: 110, sunStrength: 0.85 });
  // 水塘：树荫下的静水，涟漪更细
  mk({ w: 112, d: 104, x: POND.x, z: POND.z, y: CFG.POND_Y, seg: 48,
    depthScale: 1.8, depthRes: 192,
    deep: 0x173c33, shallow: 0x4c7d61, opacity: 0.88, rough: 0.18, metalness: 0.05,
    nrmScale: 0.10, ripple: 0.55, wave: 0.5, foam: 0.75,
    sunGloss: 70, sunStrength: 0.35 });
  // 沼泽：浑水、几乎无浪
  mk({ w: 132, d: 138, x: SWAMP.x, z: SWAMP.z, y: CFG.SWAMP_Y, seg: 48,
    depthScale: 1.1, depthRes: 192,
    deep: 0x26331d, shallow: 0x5c6a38, opacity: 0.94, rough: 0.28, metalness: 0.03,
    nrmScale: 0.14, ripple: 0.38, wave: 0.32, foam: 0.4,
    sunGloss: 55, sunStrength: 0.15 });
}
export function updateWaters(t) { setWaterTime(t); }

// —— 区域判定（供游戏逻辑） ——
export function zoneState(x, z) {
  const pondD = dist2(x, z, POND.x, POND.z);
  const swampD = ds_(x, z);
  const inWater = pondD < 30 && baseHeight(x, z) < CFG.POND_Y - 0.15;
  const inSwampWater = swampD < 44 && baseHeight(x, z) < CFG.SWAMP_Y + 0.2 && !inCaveCorr(x, z);
  const onBoard = Math.abs(x - 86) < 2.4 && z < 96 && z > 10;
  const deep = dist2(x, z, 0, 0) > CFG.DEEP_R || (baseHeight(x, z) < -1.5 && dist2(x, z, 0, 0) > 215);
  return { pondD, swampD, inWater, inSwampWater, onBoard, deep, cave: inCaveDark(x, z) };
}

// —— 到水面的距离场（供水流环境音） ——
// 启动时按 160×160 格烘焙一次「每格到最近水域的平面距离 + 水深」，运行时双线性采样，
// 每帧零地形计算开销。岸线就是"地形高度 < 水面高度"的那条线，所以格内直接比高度即可。
const WD_N = 160;                              // 网格精度：560m / 160 ≈ 3.5m
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
      if (dist2(x, z, SWAMP.x, SWAMP.z) < 52) level = CFG.SWAMP_Y;
      else if (dist2(x, z, POND.x, POND.z) < 42) level = CFG.POND_Y;
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
