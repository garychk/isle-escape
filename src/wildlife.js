// 环境野生动物：陆地爬行动物 + 飞行/停栖鸟类
//
// 设计要点：
//  1. 与敌对野兽（animals.js）完全分离——这里全是「背景生态」，不进战斗、不进任务计数，
//     玩家靠近只会逃跑 / 惊飞，不掉血、不挡路、不加碰撞体。
//  2. 每类动物合并成「一个带顶点色的几何」+ 一个 InstancedMesh，全部同类共 1 个 drawcall；
//     拍翅、蛇身蜿蜒、尾巴摆动全部在顶点着色器里做，CPU 每帧只更新实例矩阵。
//  3. 落地只认 baseHeight（地形本体），不认 groundHeight 的结构物平台——否则蜥蜴会站到屋顶/桥面上。
//  4. 昼夜 / 雨天 / 玩家距离驱动可见性与活跃度；?nowildlife=1 可整体关闭做回归对比。
import * as THREE from 'three';
import { CFG, POND, SWAMP } from './config.js';
import { mulberry32, clamp, dist2 } from './util.js';
import { baseHeight, zoneState } from './terrain.js';
import { colliders } from './flora.js';
import { scaleNormal } from './textures.js';

const rng = mulberry32(20261118);
const V3 = new THREE.Vector3();
const QUAT = new THREE.Quaternion();
const EULER = new THREE.Euler();
const MAT = new THREE.Matrix4();
const SCALE_V = new THREE.Vector3();
const POS_V = new THREE.Vector3();

// 共享单位几何：低分段即可，远处小于几十像素，省三角比省圆度重要
const SPH = new THREE.SphereGeometry(1, 8, 6);      // 96 tri
const SPH_L = new THREE.SphereGeometry(1, 6, 4);    // 48 tri
const CONE = new THREE.ConeGeometry(1, 1, 6);
const BOX = new THREE.BoxGeometry(1, 1, 1);

// 鳞片法线：让纯顶点色的低模也有细密皮纹，不至于一眼塑料
const SCALE_N = scaleNormal();

// —— 几何合并：把若干「单位几何 + 变换 + 颜色」拼成一个带顶点色的 BufferGeometry ——
// 额外产出 aWing（翼尖/尾尖权重）、aSeg（沿体长 0→1），供顶点着色器做形变。
function P(geo, col, pos, scl, extra = {}) {
  return { geo, col, pos, scl, rot: extra.rot || [0, 0, 0], wing: extra.wing ?? 0, seg: extra.seg ?? 0 };
}
function combine(parts) {
  const pos = [], nor = [], uv = [], col = [], wing = [], seg = [], idx = [];
  let off = 0;
  const c = new THREE.Color();
  for (const q of parts) {
    const g = q.geo.clone();
    EULER.set(q.rot[0], q.rot[1], q.rot[2]);
    QUAT.setFromEuler(EULER);
    POS_V.set(q.pos[0], q.pos[1], q.pos[2]);
    SCALE_V.set(q.scl[0], q.scl[1], q.scl[2]);
    MAT.compose(POS_V, QUAT, SCALE_V);
    g.applyMatrix4(MAT);                 // three 会用 normalMatrix 正确变换法线
    const pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv;
    c.setHex(q.col);
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      pos.push(x, y, z);
      nor.push(na ? na.getX(i) : 0, na ? na.getY(i) : 1, na ? na.getZ(i) : 0);
      uv.push(ua ? ua.getX(i) : 0, ua ? ua.getY(i) : 0);
      col.push(c.r, c.g, c.b);
      wing.push(typeof q.wing === 'function' ? q.wing(x, y, z) : q.wing);
      seg.push(typeof q.seg === 'function' ? q.seg(x, y, z) : q.seg);
    }
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx.push(a[i] + off); }
    else for (let i = 0; i < pa.count; i++) idx.push(i + off);
    off += pa.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  out.setAttribute('aSeg', new THREE.Float32BufferAttribute(seg, 1));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

// 时间 uniform 由所有材质共享：材质即便被重新编译（envMap 更新等），动画也不会断
const TIME_U = { value: 0 };
function wildlifeMaterial(o = {}) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.84, metalness: 0.02,
    normalMap: SCALE_N, normalScale: new THREE.Vector2(0.30, 0.30),
    // 树荫/背光下留一点自发光底色，避免整只动物糊成一条纯黑剪影
    emissive: new THREE.Color(0x11180c), emissiveIntensity: 0.42,
    side: THREE.DoubleSide,
  });
  const flapA = o.flap ?? 0, waveA = o.wave ?? 0, flapSpeed = o.flapSpeed ?? 9;
  m.userData.wildFlap = flapA;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWTime = TIME_U;
    sh.uniforms.uWFlap = { value: flapA };
    sh.uniforms.uWWave = { value: waveA };
    sh.uniforms.uWFlapSpeed = { value: flapSpeed };
    sh.vertexShader = `
      attribute float aWing;
      attribute float aSeg;
      attribute float aPhase;
      attribute float aFlap;
      attribute float aRate;
      uniform float uWTime;
      uniform float uWFlap;
      uniform float uWWave;
      uniform float uWFlapSpeed;
    ` + sh.vertexShader;
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      float wph = uWTime + aPhase;
      // 鸟翼 / 尾尖：沿翼展权重上下拍动，停栖鸟 aFlap=0 自然静止，猛禽 aRate<1 慢拍滑翔
      transformed.y += aWing * sin(wph * uWFlapSpeed * aRate) * uWFlap * aFlap;
      // 蛇身 / 蜥蜴尾：从头到尾递增的正弦横摆
      transformed.x += sin(aSeg * 8.0 - wph * 5.0) * aSeg * uWWave;
    `);
  };
  m.customProgramCacheKey = () => 'wildlife-v1-' + flapA + '-' + waveA + '-' + flapSpeed;
  return m;
}

// ---------------- 建模（一律头朝 +Z，与 animals.js 的 yaw=atan2(dx,dz) 一致） ----------------
function lizardParts() {
  const skin = 0x92bb4e, dark = 0x4d682c, belly = 0xe2d79c, eye = 0x12180a, spot = 0x2d4a1c;
  const a = [
    P(SPH, skin, [0, 0.105, 0], [0.105, 0.078, 0.225]),
    P(SPH, belly, [0, 0.058, 0.01], [0.086, 0.046, 0.20]),
    P(SPH, dark, [0, 0.158, 0], [0.086, 0.048, 0.19]),
    P(SPH, skin, [0, 0.135, 0.265], [0.078, 0.062, 0.095]),
    P(SPH, belly, [0, 0.108, 0.325], [0.062, 0.034, 0.062]),
  ];
  for (let i = 0; i < 4; i++) a.push(P(SPH_L, spot, [0, 0.186, 0.13 - i * 0.09], [0.034, 0.012, 0.034]));
  for (const s of [-1, 1]) {
    a.push(P(SPH_L, eye, [s * 0.061, 0.163, 0.293], [0.020, 0.020, 0.020]));
    a.push(P(SPH_L, 0xe8cf62, [s * 0.068, 0.169, 0.298], [0.009, 0.009, 0.009]));
    for (const sz of [-1, 1]) {
      const z = sz > 0 ? 0.13 : -0.14;
      a.push(P(SPH, skin, [s * 0.115, 0.076, z], [0.028, 0.055, 0.032], { rot: [0, 0, s * 0.5] }));
      a.push(P(SPH_L, dark, [s * 0.155, 0.030, z + 0.018], [0.042, 0.016, 0.050]));
    }
  }
  // 尾：5 段渐细，seg 按离体距离 0→1
  for (let i = 0; i < 5; i++) {
    const z = -0.22 - i * 0.088, r = 0.062 - i * 0.010;
    a.push(P(SPH, i % 2 ? skin : dark, [0, 0.10, z], [r, r * 0.85, 0.076],
      { seg: (x, y, v) => clamp((Math.abs(v) - 0.20) / 0.46, 0, 1) }));
  }
  return a;
}

function snakeParts() {
  const green = 0x79a043, olive = 0xb0ae58, band = 0x2b3618, belly = 0xd6cb90, head = 0x85a64a;
  const a = [];
  const segFn = (x, y, z) => clamp((0.72 - z) / 1.44, 0, 1);
  for (let i = 0; i < 9; i++) {
    const z = 0.66 - i * 0.165, r = 0.050 - i * 0.0016;
    a.push(P(SPH, i % 3 === 0 ? band : (i % 2 ? green : olive), [0, 0.062, z], [r, r * 0.78, 0.096], { seg: segFn }));
    a.push(P(SPH_L, belly, [0, 0.030, z], [r * 0.82, r * 0.28, 0.085], { seg: segFn }));
  }
  a.push(P(SPH, head, [0, 0.070, 0.79], [0.062, 0.046, 0.10]));
  a.push(P(SPH_L, belly, [0, 0.046, 0.85], [0.048, 0.020, 0.07]));
  for (const s of [-1, 1]) a.push(P(SPH_L, 0x100e08, [s * 0.043, 0.090, 0.83], [0.014, 0.014, 0.014]));
  // 信子
  a.push(P(CONE, 0xa8372c, [0, 0.052, 0.93], [0.008, 0.055, 0.008], { rot: [Math.PI / 2, 0, 0] }));
  return a;
}

function tortoiseParts() {
  const shell = 0x6d5836, rim = 0x4a3a20, plate = 0xb99c58, skin = 0x9c9a60, belly = 0xd2c592, eye = 0x141109;
  const a = [
    P(SPH, shell, [0, 0.165, 0], [0.225, 0.132, 0.265]),
    P(SPH, rim, [0, 0.098, 0], [0.235, 0.055, 0.270]),
    P(SPH, belly, [0, 0.085, 0], [0.185, 0.048, 0.225]),
    P(SPH, plate, [0, 0.275, 0], [0.115, 0.035, 0.130]),
  ];
  // 壳上盾片：中央一列 + 两侧各两片
  for (let i = 0; i < 3; i++) a.push(P(SPH_L, plate, [0, 0.28 - i * 0.009, -0.13 + i * 0.13], [0.075, 0.012, 0.052]));
  for (const s of [-1, 1]) for (const z of [-0.11, 0.11]) {
    a.push(P(SPH_L, plate, [s * 0.13, 0.245, z], [0.065, 0.012, 0.055]));
  }
  a.push(P(SPH, skin, [0, 0.150, 0.315], [0.078, 0.068, 0.098]));
  for (const s of [-1, 1]) {
    a.push(P(SPH_L, eye, [s * 0.060, 0.174, 0.365], [0.016, 0.016, 0.016]));
    for (const z of [-0.17, 0.17]) {
      a.push(P(SPH, skin, [s * 0.165, 0.072, z], [0.058, 0.052, 0.078]));
      a.push(P(SPH_L, rim, [s * 0.190, 0.035, z + 0.02], [0.045, 0.018, 0.050]));
    }
  }
  a.push(P(CONE, rim, [0, 0.120, -0.29], [0.030, 0.10, 0.030], { rot: [-Math.PI / 2, 0, 0] }));
  return a;
}

function crocParts() {
  const hide = 0x5a6c3c, hideD = 0x3d4a29, belly = 0xa8a57b, eye = 0x111308, tooth = 0xe4ddc0;
  const a = [
    P(SPH, hide, [0, 0.30, 0], [0.30, 0.19, 0.86]),
    P(SPH, belly, [0, 0.16, 0.02], [0.27, 0.08, 0.80]),
    P(SPH, hideD, [0, 0.46, -0.05], [0.26, 0.075, 0.78]),
    P(SPH, hide, [0, 0.30, 0.98], [0.235, 0.125, 0.34]),   // 头
    P(SPH, hideD, [0, 0.255, 1.30], [0.185, 0.080, 0.36]), // 扁吻
    P(SPH_L, belly, [0, 0.205, 1.36], [0.170, 0.026, 0.33]),
  ];
  // 背脊骨板
  for (let i = 0; i < 9; i++) {
    const z = 0.55 - i * 0.19;
    a.push(P(CONE, hideD, [0, 0.51, z], [0.065 - i * 0.002, 0.085, 0.055], { rot: [-0.18, 0, 0] }));
  }
  for (const s of [-1, 1]) {
    a.push(P(SPH_L, eye, [s * 0.135, 0.405, 1.02], [0.042, 0.042, 0.042]));
    a.push(P(SPH_L, 0xc8b34a, [s * 0.142, 0.418, 1.035], [0.018, 0.018, 0.018]));
    for (const z of [-0.55, 0.55]) {
      a.push(P(SPH, hide, [s * 0.33, 0.16, z], [0.10, 0.10, 0.14]));
      a.push(P(SPH_L, hideD, [s * 0.40, 0.065, z + 0.05], [0.09, 0.035, 0.11]));
    }
    for (let k = 0; k < 3; k++) a.push(P(CONE, tooth, [s * 0.115, 0.205, 1.15 + k * 0.10], [0.018, 0.045, 0.018]));
  }
  // 尾：6 段，横向摆幅由 aSeg 驱动
  for (let i = 0; i < 6; i++) {
    const z = -0.80 - i * 0.235, r = 0.235 - i * 0.031;
    a.push(P(SPH, i % 2 ? hide : hideD, [0, 0.28 - i * 0.012, z], [r, r * 0.62, 0.16],
      { seg: (x, y, v) => clamp((Math.abs(v) - 0.80) / 1.45, 0, 1) }));
    a.push(P(CONE, hideD, [0, 0.40 - i * 0.012, z], [0.055, 0.075, 0.055]));
  }
  return a;
}

// 鸟：身体 + 头 + 喙 + 尾羽 + 两翼各内外两段，翼尖 aWing 渐变
function makeBirdParts() {
  const body = 0x666d52, head = 0x4a5040, wing = 0x7d8466, tip = 0x363b2e, belly = 0xd0ccb0, beak = 0xe0b04c;
  const a = [
    P(SPH, body, [0, 0, 0], [0.060, 0.052, 0.135]),
    P(SPH_L, belly, [0, -0.030, 0.01], [0.048, 0.022, 0.105]),
    P(SPH_L, head, [0, 0.022, 0.135], [0.046, 0.046, 0.048]),
    P(CONE, beak, [0, 0.010, 0.198], [0.018, 0.065, 0.018], { rot: [Math.PI / 2, 0, 0] }),
    P(SPH_L, tip, [0, 0.005, -0.175], [0.062, 0.012, 0.108]),
  ];
  const wingFn = (x, y, z) => clamp((Math.abs(x) - 0.02) / 0.30, 0, 1);
  for (const s of [-1, 1]) {
    a.push(P(SPH_L, wing, [s * 0.115, 0.020, 0.010], [0.105, 0.016, 0.075], { rot: [0, 0, s * 0.10], wing: wingFn }));
    a.push(P(SPH_L, tip, [s * 0.255, 0.028, -0.010], [0.095, 0.012, 0.058], { rot: [0, 0, s * 0.16], wing: wingFn }));
    a.push(P(SPH_L, 0x100e08, [s * 0.035, 0.032, 0.158], [0.010, 0.010, 0.010]));
  }
  return a;
}

// ---------------- 落点采样 ----------------
// 全岛均匀撒点会让每片视野平均不到 1 只，等于看不见。改为 78% 落在「地标热点」周围
// 3–20m 的簇里：玩家走到出生点 / 水塘 / 沼泽 / 木屋时一次能看到好几只。
const CLUSTERS = [
  [0, 247.5], [0, 212.5], [-35, 197.5], [-72.5, 140], [-97.5, 77.5], [-130, 92.5],
  [107.5, 65], [87.5, 37.5], [-42.5, 18.75], [0, 22.5], [55, 123.75], [0, -125],
  [0, -245], [-156.25, 68.75], [147.5, -137.5], [-80, 135],
];
function randLand(pred, hot = 0.78) {
  for (let k = 0; k < 260; k++) {
    let x, z;
    if (rng() < hot) {
      const c = CLUSTERS[(rng() * CLUSTERS.length) | 0];
      const a = rng() * Math.PI * 2, r = 1.5 + Math.sqrt(rng()) * 10;
      x = c[0] + Math.cos(a) * r; z = c[1] + Math.sin(a) * r;
    } else {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 202;
      x = Math.cos(a) * r; z = Math.sin(a) * r;
    }
    const h = baseHeight(x, z);
    if (h < 0.7 || h > 32) continue;
    if (Math.abs(x) < 12 && z < -44 && z > -180) continue;     // 山腹隧道
    const zs = zoneState(x, z);
    if (zs.inWater || zs.inSwampWater || zs.deep || zs.cave) continue;
    if (pred && !pred(x, z, h, zs)) continue;
    let blocked = false;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if ((c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + 0.45) ** 2) { blocked = true; break; }
    }
    if (!blocked) return { x, z, h };
  }
  return null;
}
const nearWater = (x, z) => Math.min(dist2(x, z, POND.x, POND.z), dist2(x, z, SWAMP.x, SWAMP.z));

// ---------------- 主体 ----------------
const SPECS = [
  { key: 'lizard', parts: lizardParts, n: 110, mat: { wave: 0.030 }, size: [1.30, 1.85],
    pick: () => randLand((x, z) => dist2(x, z, 0, 0) < 200, 0.84), label: '雨林蜥蜴' },
  { key: 'snake', parts: snakeParts, n: 46, mat: { wave: 0.115 }, size: [1.15, 1.75],
    pick: () => randLand((x, z) => nearWater(x, z) < 100 || dist2(x, z, 0, 0) < 160, 0.80), label: '草蛇' },
  { key: 'tortoise', parts: tortoiseParts, n: 36, mat: { wave: 0.008 }, size: [1.20, 1.70],
    pick: () => randLand((x, z) => nearWater(x, z) < 120, 0.82), label: '陆龟' },
  { key: 'croc', parts: crocParts, n: 7, mat: { wave: 0.14 }, size: [0.55, 0.75],
    pick: () => randLand((x, z) => nearWater(x, z) < 62 && nearWater(x, z) > 22, 0.70), label: '沼泽鳄' },
];

let manager = null;

export function buildWildlife(scene) {
  if (manager) return manager;
  const ground = {}, agents = [], birds = [];
  const meshes = [];
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  // —— 地面爬行动物 ——
  for (const sp of SPECS) {
    const geo = combine(sp.parts());
    const mat = wildlifeMaterial(sp.mat);
    const mesh = new THREE.InstancedMesh(geo, mat, sp.n);
    mesh.name = 'wildlife:' + sp.key;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;      // 实例散布全岛，原始几何的包围球会误剔除
    mesh.castShadow = false; mesh.receiveShadow = false;
    const phase = new Float32Array(sp.n), flap = new Float32Array(sp.n), rate = new Float32Array(sp.n);
    for (let i = 0; i < sp.n; i++) { phase[i] = rng() * 6.283; flap[i] = 1; rate[i] = 1; }
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    geo.setAttribute('aFlap', new THREE.InstancedBufferAttribute(flap, 1));
    geo.setAttribute('aRate', new THREE.InstancedBufferAttribute(rate, 1));
    // 个体差异：只做极轻微的色偏，别把顶点色压暗（树荫下会糊成黑块）
    for (let i = 0; i < sp.n; i++) {
      tmpColor.setHSL(0.14 + rng() * 0.10, 0.04 + rng() * 0.10, 0.93 + rng() * 0.07);
      mesh.setColorAt(i, tmpColor);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    const list = [];
    for (let i = 0; i < sp.n; i++) {
      const p = sp.pick() || { x: (rng() - 0.5) * 120, z: (rng() - 0.5) * 120, h: 3 };
      const s = sp.size[0] + rng() * (sp.size[1] - sp.size[0]);
      const a = {
        kind: sp.key, mesh, i, x: p.x, z: p.z, y: p.h, homeX: p.x, homeZ: p.z,
        yaw: rng() * 6.283, scale: s, phase: phase[i], speed: 0.55 + rng() * 0.8,
        state: 'idle', stateT: rng() * 3.5, visTh: rng(), nightOk: rng() < 0.45,
        hue: rng(),
      };
      if (sp.key === 'snake') a.speed *= 0.65;
      if (sp.key === 'tortoise' || sp.key === 'croc') a.speed *= 0.35;
      if (sp.key === 'croc') a.y = Math.max(a.y, CFG.SWAMP_Y - 0.30);  // 半潜在水线
      list.push(a); agents.push(a);
    }
    ground[sp.key] = { mesh, list, label: sp.label };
    meshes.push(mesh);
  }

  // —— 鸟类：群鸟 / 猛禽 / 海鸟 / 停栖鸟共用一个几何与材质 ——
  const BN = 152;
  const bgeo = combine(makeBirdParts());
  const bmat = wildlifeMaterial({ flap: 0.095, flapSpeed: 12.0, wave: 0 });
  const bmesh = new THREE.InstancedMesh(bgeo, bmat, BN);
  bmesh.name = 'wildlife:birds';
  bmesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bmesh.frustumCulled = false;
  bmesh.castShadow = false; bmesh.receiveShadow = false;
  const bPhase = new Float32Array(BN), bFlap = new Float32Array(BN), bRate = new Float32Array(BN);
  bgeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(bPhase, 1));
  bgeo.setAttribute('aFlap', new THREE.InstancedBufferAttribute(bFlap, 1));
  bgeo.setAttribute('aRate', new THREE.InstancedBufferAttribute(bRate, 1));
  scene.add(bmesh); meshes.push(bmesh);

  const BIRD_COLORS = {
    flock: [0xb6bd9c, 0xa89a76, 0x8ba17b, 0xc4b18e],
    raptor: [0x8a7358, 0x6b5945, 0x9a8060],
    gull: [0xe4e2d5, 0xc9cfc6, 0xf0ece0],
    perch: [0xa8b47e, 0xbaa077, 0x8ca06e],
  };
  const addBird = (kind, cfg) => {
    const i = birds.length;
    if (i >= BN) return null;
    bPhase[i] = rng() * 6.283;
    bFlap[i] = kind === 'perch' ? 0 : (kind === 'raptor' ? 0.6 : 1);
    bRate[i] = kind === 'raptor' ? 0.34 : kind === 'gull' ? 0.62 : 1;
    const pal = BIRD_COLORS[kind];
    tmpColor.setHex(pal[(rng() * pal.length) | 0]);
    // setColorAt 与顶点色相乘，向白色靠拢以保留层次又不压暗
    tmpColor.lerp(new THREE.Color(0xffffff), 0.55);
    bmesh.setColorAt(i, tmpColor);
    const b = { kind, i, ...cfg, phase: bPhase[i], visTh: rng() * 0.95 };
    birds.push(b);
    return b;
  };

  // 鸟群不再全岛乱撒：固定盘旋在玩家真正会抬头看的地标上空，
  // 出生点朝外海 / 朝林间各有 1 群，水塘、沼泽、木屋、索桥、北岸也各有一群。
  const FLOCK_CENTERS = [
    [0, 290, 25, 17], [0, 237.5, 18.75, 9], [-72.5, 140, 17.5, 17], [-97.5, 77.5, 20, 14],
    [107.5, 65, 22.5, 13], [-42.5, 18.75, 17.5, 16], [0, 75, 27.5, 24], [0, -247.5, 25, 20],
  ];
  const flocks = [];
  for (const [cx, cz, radius, height] of FLOCK_CENTERS) {
    const g = {
      cx, cz, radius, height,
      ang: rng() * 6.283, w: (0.10 + rng() * 0.13) * (rng() < 0.5 ? -1 : 1),
      squash: 0.70 + rng() * 0.42,
    };
    flocks.push(g);
    const n = 10 + ((rng() * 5) | 0);
    for (let k = 0; k < n; k++) {
      addBird('flock', {
        flock: g, off: (k / n) * 6.283 + (rng() - 0.5) * 0.5,
        rr: g.radius * (0.72 + rng() * 0.5), yy: (rng() - 0.5) * 2.4,
        scale: 1.55 + rng() * 0.85,
      });
    }
  }
  // 高空猛禽：慢速大半径盘旋，其中 2 只固定盘在出生点上空
  for (let k = 0; k < 6; k++) {
    const n = k < 2;
    addBird('raptor', {
      cx: n ? (rng() - 0.5) * 40 : (rng() - 0.5) * 220,
      cz: n ? 195 + (rng() - 0.5) * 40 : (rng() - 0.5) * 220,
      radius: 26 + rng() * 28, height: 30 + rng() * 16,
      ang: rng() * 6.283, w: (0.055 + rng() * 0.045) * (rng() < 0.5 ? -1 : 1),
      solo: true, scale: 2.8 + rng() * 1.2,
    });
  }
  // 海鸟：绕着几处海岸点低空滑翔（不是绕整岛一个大圆，否则永远不在视野里）
  const GULL_SPOTS = [[0, 236], [-95, 185], [100, 180], [0, -232], [-185, 90], [180, 60]];
  for (let k = 0; k < 16; k++) {
    const s = GULL_SPOTS[k % GULL_SPOTS.length];
    addBird('gull', {
      cx: s[0] + (rng() - 0.5) * 26, cz: s[1] + (rng() - 0.5) * 26,
      radius: 10 + rng() * 22, height: 10 + rng() * 11,
      ang: rng() * 6.283, w: (0.05 + rng() * 0.06) * (rng() < 0.5 ? -1 : 1),
      solo: true, scale: 1.8 + rng() * 0.9, coastal: true,
    });
  }
  // 停栖鸟：从树干碰撞体里挑大树，挂在 4–8m 高的枝杈上；玩家靠近会惊飞
  const trees = colliders.filter(c => c.r > 1.35);
  for (let k = 0; k < 20 && trees.length; k++) {
    const c = trees[(rng() * trees.length) | 0];
    const h = baseHeight(c.x, c.z);
    if (h < 1 || h > 28) continue;
    addBird('perch', {
      px: c.x + (rng() - 0.5) * 1.4, pz: c.z + (rng() - 0.5) * 1.4,
      py: h + 4.2 + rng() * 3.6, yaw: rng() * 6.283,
      scale: 1.20 + rng() * 0.50, flyT: 0, flyAng: 0,
    });
  }
  if (bmesh.instanceColor) bmesh.instanceColor.needsUpdate = true;

  let calls = 0, lastVisible = 0;
  const V = new THREE.Vector3();

  function hide(mesh, i) {
    dummy.position.set(0, -9999, 0); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(0);
    dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
  }

  function update(dt, t, playerPos, env) {
    TIME_U.value = t;
    const night = env ? clamp(env.night || 0, 0, 1) : 0;
    const rain = env ? clamp(env.rain || 0, 0, 1) : 0;
    const day = 1 - night;
    const px = playerPos ? playerPos.x : 0, pz = playerPos ? playerPos.z : 0;
    const py = playerPos ? playerPos.y : 0;

    // —— 地面爬行动物 ——
    for (const a of agents) {
      const d = Math.hypot(a.x - px, a.z - pz);
      let visible = d < 145 && (day > 0.22 || a.nightOk);
      if (!visible) { hide(a.mesh, a.i); continue; }
      // 受惊：玩家 4.5m 内立刻逃离，跑出 9m 后恢复游荡
      if (d < 4.5 && a.kind !== 'croc') {
        a.state = 'flee'; a.stateT = 2.4;
        a.yaw = Math.atan2(a.x - px, a.z - pz);
      }
      a.stateT -= dt;
      if (a.state === 'flee' && a.stateT <= 0) { a.state = 'idle'; a.stateT = 0.6 + rng() * 2; }
      else if (a.stateT <= 0) {
        if (a.state === 'idle') { a.state = 'walk'; a.stateT = 1.0 + rng() * 2.6; a.yaw = rng() * 6.283; }
        else { a.state = 'idle'; a.stateT = 1.2 + rng() * 3.4; }
      }
      if (a.state !== 'idle') {
        const sp = a.speed * (a.state === 'flee' ? 2.6 : 1) * (1 - rain * 0.35);
        let nx = a.x + Math.sin(a.yaw) * sp * dt;
        let nz = a.z + Math.cos(a.yaw) * sp * dt;
        // 拴在出生点附近，避免爬进海里或穿进山体
        if (Math.hypot(nx - a.homeX, nz - a.homeZ) > 9 || baseHeight(nx, nz) < 0.4) {
          a.yaw += 2.1 + rng() * 0.8; a.stateT = 0.4;
        } else { a.x = nx; a.z = nz; }
      }
      const gy = a.kind === 'croc' ? Math.max(baseHeight(a.x, a.z), CFG.SWAMP_Y - 0.30) : baseHeight(a.x, a.z);
      a.y = gy;
      const bob = a.state === 'idle' ? 0 : Math.abs(Math.sin(t * 6 + a.phase)) * 0.012;
      dummy.position.set(a.x, a.y + 0.012 + bob, a.z);
      dummy.rotation.set(0, a.yaw, 0);
      dummy.scale.setScalar(a.scale);
      dummy.updateMatrix();
      a.mesh.setMatrixAt(a.i, dummy.matrix);
    }
    for (const sp of SPECS) ground[sp.key].mesh.instanceMatrix.needsUpdate = true;

    // —— 鸟类 ——
    let visCount = 0;
    for (const b of birds) {
      // 夜间绝大多数鸟归巢；雨天减少约一半并压低飞行高度
      let show = b.kind === 'perch' ? day > 0.30 : day > b.visTh * 0.92;
      if (rain > 0.35) show = show && (b.visTh < 1 - rain * 0.55);
      if (!show) { hide(bmesh, b.i); continue; }
      let x, y, z, yaw, roll = 0;
      if (b.kind === 'perch') {
        const d = Math.hypot(b.px - px, b.pz - pz);
        if (d < 8.5 && b.flyT <= 0) { b.flyT = 9.0; b.flyAng = rng() * 6.283; bFlap[b.i] = 1; bgeo.attributes.aFlap.needsUpdate = true; }
        if (b.flyT > 0) {
          b.flyT -= dt;
          const e = 9.0 - b.flyT;
          x = b.px + Math.sin(b.flyAng) * e * 3.6;
          z = b.pz + Math.cos(b.flyAng) * e * 3.6;
          y = b.py + Math.min(9, e * 2.4) + Math.sin(t * 3 + b.phase) * 0.25;
          yaw = b.flyAng;
          if (b.flyT <= 0) { bFlap[b.i] = 0; bgeo.attributes.aFlap.needsUpdate = true; }
        } else {
          x = b.px; y = b.py + Math.sin(t * 1.4 + b.phase) * 0.012; z = b.pz; yaw = b.yaw;
        }
      } else {
        const g = b.flock;
        const ang = g ? g.ang + b.off : b.ang;
        const rr = g ? b.rr : b.radius;
        if (g) {
          x = g.cx + Math.cos(ang) * rr;
          z = g.cz + Math.sin(ang) * rr * g.squash;
          y = g.height + b.yy + Math.sin(t * 1.1 + b.phase) * 1.1;
        } else {
          x = b.cx + Math.cos(ang) * rr;
          z = b.cz + Math.sin(ang) * rr;
          y = b.height + Math.sin(t * 0.8 + b.phase) * (b.kind === 'raptor' ? 1.8 : 1.0);
        }
        yaw = -ang;   // 切线方向：d/dt(cos,sin)=(-sin,cos) → yaw=-ang
        roll = clamp((g ? g.w : b.w) * 2.4, -0.5, 0.5);
        if (rain > 0.3) y -= rain * 4.5;
      }
      const dc = Math.hypot(x - px, z - pz);
      if (dc > 280) { hide(bmesh, b.i); continue; }
      visCount++;
      dummy.position.set(x, Math.max(y, py - 4), z);
      dummy.rotation.set(0, yaw, roll);
      dummy.scale.setScalar(b.scale);
      dummy.updateMatrix();
      bmesh.setMatrixAt(b.i, dummy.matrix);
    }
    bmesh.instanceMatrix.needsUpdate = true;
    // 群鸟盘旋（单独推进，避免每只鸟重复累加角度）
    for (const g of flocks) g.ang += g.w * dt;
    for (const b of birds) if (b.solo) b.ang += b.w * dt;
    lastVisible = visCount;
  }

  // 供音景取真实声源位置：鸟叫来自画面里的鸟，兽吼来自远处的地面。
  // 优先挑离玩家较近的一批——否则随机取到 150m 外的鸟，衰减后几乎听不见。
  function callPoint(kind) {
    calls++;
    const px = manager && manager.lastPX ? manager.lastPX : 0;
    const pz = manager && manager.lastPZ ? manager.lastPZ : 0;
    const near = (x, z) => Math.hypot(x - px, z - pz);
    if (kind === 'bird') {
      const cand = [];
      for (const b of birds) {
        if (b.kind === 'perch') continue;
        const g = b.flock;
        const ang = g ? g.ang + b.off : b.ang;
        const rr = g ? b.rr : b.radius;
        const x = (g ? g.cx : b.cx) + Math.cos(ang) * rr;
        const z = (g ? g.cz : b.cz) + Math.sin(ang) * rr * (g ? g.squash : 1);
        cand.push({ x, z, y: (g ? g.height : b.height) + (b.yy || 0), d: near(x, z) });
      }
      if (cand.length) {
        cand.sort((a, b) => a.d - b.d);
        const pool = cand.slice(0, Math.max(3, Math.ceil(cand.length * 0.4)));
        const c = pool[(rng() * pool.length) | 0];
        return { x: c.x, y: c.y, z: c.z, kind: 'bird' };
      }
    }
    if (kind === 'roar') {
      const a = rng() * 6.283, d = 34 + rng() * 62;
      const x = px + Math.cos(a) * d;
      const z = pz + Math.sin(a) * d;
      return { x, y: Math.max(1.5, baseHeight(x, z) + 1.2), z, kind: 'roar' };
    }
    // hiss / rustle：只从玩家附近 70m 内的爬行动物里挑，太远的嘶声没有意义
    if (agents.length) {
      const pool = agents.filter(a => near(a.x, a.z) < 70);
      const a = (pool.length ? pool : agents)[(rng() * (pool.length || agents.length)) | 0];
      return { x: a.x, y: a.y + 0.2, z: a.z, kind };
    }
    return { x: 0, y: 4, z: 0, kind };
  }
  function rememberPlayer(p) { if (p) { manager.lastPX = p.x; manager.lastPZ = p.z; } }

  manager = {
    update(dt, t, playerPos, env) { rememberPlayer(playerPos); update(dt, t, playerPos, env); },
    callPoint,
    birds, agents, ground, meshes,
    state() {
      // 抽样核验：地面动物必须贴着地形（鳄鱼半潜在水线，单独排除）
      let groundErr = 0;
      for (let i = 0; i < agents.length; i += 3) {
        const a = agents[i];
        if (a.kind === 'croc') continue;
        groundErr = Math.max(groundErr, Math.abs(a.y - baseHeight(a.x, a.z)));
      }
      return {
        enabled: true,
        ground: Object.fromEntries(SPECS.map(s => [s.key, ground[s.key].list.length])),
        birds: birds.length, birdVisible: lastVisible,
        total: agents.length + birds.length,
        meshes: meshes.length, shaderTime: +TIME_U.value.toFixed(2),
        groundErr: +groundErr.toFixed(3), calls,
      };
    },
    noteCall() { calls++; },
  };
  return manager;
}

export function wildlifeState() {
  return manager ? manager.state() : { enabled: false, ground: {}, birds: 0, total: 0, meshes: 0, calls: 0 };
}
export function wildlifeCallPoint(kind) {
  return manager ? manager.callPoint(kind) : null;
}
