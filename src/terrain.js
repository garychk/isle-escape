// 岛屿地形：高度场 / 区域判定 / 地形网格 / 水面
import * as THREE from 'three';
import { CFG, POND, SWAMP, MOUNT, RAFT, SPAWN, TRAIL, TRAIL_W, CABIN } from './config.js';
import { fbm, clamp, smoothstep, dist2, segDist2 } from './util.js';
import { groundDetail, groundNormal, waterNormal } from './textures.js';

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
  const SEG = 230, S = CFG.WORLD;
  const geo = new THREE.PlaneGeometry(S, S, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
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
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
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
  return mesh;
}
function ds_(x, z) { return dist2(x, z, SWAMP.x, SWAMP.z); }

// —— 水面材质（法线波纹 + 太阳高光） ——
function waterMaterial(color, opacity, repeat, rough = 0.16, nscale = 0.9) {
  const n = waterNormal().clone();
  n.needsUpdate = true;
  n.repeat.set(repeat, repeat);
  n.wrapS = n.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({
    color, transparent: true, opacity,
    roughness: rough, metalness: 0.4,
    normalMap: n, normalScale: new THREE.Vector2(nscale, nscale),
    depthWrite: false,
  });
}
const waters = [];
// 给水面挂上天空环境贴图（PMREM），让海面真正映出天色而不是一片死绿
export function setWaterEnv(tex) {
  if (!tex) return;
  // 大海主要映天光；水塘/沼泽被树冠遮着，反射要弱，否则会变成一片惨白
  const inten = [1.15, 0.28, 0.22];
  waters.forEach((m, i) => {
    m.envMap = tex;
    m.envMapIntensity = inten[i] ?? 0.3;
    m.metalness = i === 0 ? 0.45 : 0.05;
    m.needsUpdate = true;
  });
}
export function buildWaters(scene) {
  const mk = (w, d, x, z, y, color, op, rep) => {
    const g = new THREE.PlaneGeometry(w, d, 1, 1);
    const m = waterMaterial(color, op, rep);
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.renderOrder = 2;
    scene.add(mesh);
    waters.push(m);
    return mesh;
  };
  mk(CFG.WORLD * 1.9, CFG.WORLD * 1.9, 0, 0, CFG.SEA_Y, 0x2c5158, 0.97, 180, 0.2, 1.25);   // 大海
  mk(112, 104, POND.x, POND.z, CFG.POND_Y, 0x2f4f46, 0.88, 30, 0.12, 0.7);     // 水塘
  mk(132, 138, SWAMP.x, SWAMP.z, CFG.SWAMP_Y, 0x414d28, 0.94, 34, 0.3, 0.8);    // 沼泽
}
export function updateWaters(t) {
  for (const m of waters) {
    const n = m.normalMap;
    n.offset.set(t * 0.018 + m.id * 0.01, t * 0.011);
  }
}

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
