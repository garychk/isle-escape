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
import { has as hasAsset, instance as assetInstance } from './assets.js';

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

// 羽片：本地沿 +X 从 0→1 生长，Z 为弦向宽度（中间宽两端尖），Y 微拱出翼型。
// 用几片羽片扇形叠出真实鸟翼/尾羽，替代原来"压扁的球"。双面材质配合顶点色做明暗层次。
function featherGeo(seg = 5) {
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = Math.sin(Math.PI * Math.pow(t, 0.78)) * 0.5; // 根尖收窄、中段最宽
    const arch = Math.sin(Math.PI * t) * 0.05;             // 轻微翼型拱起
    pos.push(t, arch, -w, t, arch, w);
    uv.push(t, 0, t, 1);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  for (let i = 0; i < pos.length / 3; i++) nor.push(0, 1, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
const FEATHER = featherGeo(5);

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
  const birdVC = !!o.birdVC;   // GLB 飞鸟：顶点色黑身黄喙，无鳞片法线/自发光底色
  const m = new THREE.MeshStandardMaterial({
    // 鸟统一黑模剪影：不要顶点色/皮纹/自发光底色，天空背景下就是干净的黑鸟轮廓
    vertexColors: !o.black || birdVC,
    color: (o.black && !birdVC) ? 0x0b0b0b : 0xffffff,
    roughness: o.black ? 1.0 : 0.84,
    metalness: o.black ? 0 : 0.02,
    normalMap: (o.black || birdVC) ? null : SCALE_N,
    normalScale: new THREE.Vector2(0.30, 0.30),
    // 树荫/背光下留一点自发光底色，避免整只动物糊成一条纯黑剪影（鸟不需要）
    emissive: new THREE.Color((o.black || birdVC) ? 0x000000 : 0x11180c), emissiveIntensity: (o.black || birdVC) ? 0 : 0.42,
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
  m.customProgramCacheKey = () => 'wildlife-v2-' + flapA + '-' + waveA + '-' + flapSpeed + (o.black ? '-black' : '') + (birdVC ? '-birdvc' : '');
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
  const a = 0.225, b = 0.132, c = 0.265, yc = 0.168;   // 壳椭球半轴与中心高
  const shellTop = 0x6b562f, shellEdge = 0x48381d, seam = 0x2f2510;
  const scute = 0xa98b4e, scute2 = 0x937c48, scuteHi = 0xc6a96a;
  const skin = 0x8e8a5e, skinD = 0x6d6943, belly = 0xcbbd8e;
  const eye = 0x110d07, glint = 0xded8b4, beak = 0x6e6438, claw = 0x4a4430;
  const HEX = new THREE.CylinderGeometry(1, 1, 1, 6);   // 六棱柱压扁 = 盾片（顶面朝 +Y）
  const parts = [
    // 缘盾裙边 + 深色主穹顶 + 腹甲
    P(SPH, shellEdge, [0, 0.128, 0], [0.234, 0.088, 0.274]),
    P(SPH, shellTop, [0, yc, 0], [a, b, c]),
    P(SPH_L, belly, [0, 0.082, 0], [0.186, 0.046, 0.226]),
  ];
  // 盾片贴壳：按椭球曲面求高度与法线倾角，让六边形顺着拱面铺开
  const put = (x, z, sx, sz, col) => {
    const q = 1 - (x * x) / (a * a) - (z * z) / (c * c);
    if (q <= 0.04) return;
    const y = yc + b * Math.sqrt(q);
    const ny = (y - yc) / (b * b), nx = x / (a * a), nz = z / (c * c);
    parts.push(P(HEX, col, [x, y + 0.004, z], [sx, 0.013, sz],
      { rot: [Math.atan2(nz, ny), 0, -Math.atan2(nx, ny)] }));
  };
  // 中央脊盾 5 片（正中一片偏亮）+ 左右肋盾各 3 片
  const vz = [-0.178, -0.089, 0, 0.089, 0.178];
  for (let i = 0; i < vz.length; i++) put(0, vz[i], 0.050, 0.046, i === 2 ? scuteHi : scute);
  for (const s of [-1, 1]) for (const z of [-0.112, 0, 0.112]) put(s * 0.112, z, 0.054, 0.050, z === 0 ? scute : scute2);
  // 缘盾：沿壳缘一圈小片，勾出甲壳轮廓
  for (const s of [-1, 1]) for (const z of [-0.19, -0.095, 0, 0.095, 0.19]) put(s * 0.196, z, 0.030, 0.030, seam);
  for (const z of [-0.245, 0.245]) for (const x of [-0.10, 0, 0.10]) put(x, z, 0.030, 0.026, seam);
  // 颈 + 头：从壳前伸出，鹰喙带钩、鼻孔、带高光的眼
  parts.push(P(SPH, skin, [0, 0.150, 0.292], [0.062, 0.058, 0.095]));       // 颈
  parts.push(P(SPH, skin, [0, 0.162, 0.372], [0.078, 0.070, 0.080]));       // 头
  parts.push(P(SPH_L, skinD, [0, 0.132, 0.418], [0.052, 0.030, 0.050]));    // 下颌
  parts.push(P(CONE, beak, [0, 0.150, 0.446], [0.030, 0.052, 0.030], { rot: [Math.PI / 2.35, 0, 0] })); // 钩喙
  for (const s of [-1, 1]) {
    parts.push(P(SPH_L, eye, [s * 0.060, 0.182, 0.402], [0.017, 0.017, 0.016]));
    parts.push(P(SPH_L, glint, [s * 0.064, 0.187, 0.413], [0.006, 0.006, 0.006]));
    parts.push(P(SPH_L, seam, [s * 0.020, 0.196, 0.440], [0.007, 0.006, 0.007])); // 鼻孔
  }
  // 柱状四肢（陆龟非鳍状）+ 扁脚掌 + 每脚 3 枚爪
  for (const s of [-1, 1]) for (const z of [0.16, -0.16]) {
    parts.push(P(SPH, skin, [s * 0.170, 0.098, z], [0.062, 0.082, 0.078], { rot: [0, 0, -s * 0.18] }));
    parts.push(P(SPH_L, skinD, [s * 0.190, 0.040, z + 0.018], [0.060, 0.030, 0.072]));  // 脚掌
    for (let k = -1; k <= 1; k++) {
      parts.push(P(CONE, claw, [s * 0.198 + k * 0.020, 0.030, z + 0.082],
        [0.011, 0.038, 0.011], { rot: [Math.PI / 2, 0, 0] }));
    }
  }
  parts.push(P(CONE, skinD, [0, 0.112, -0.292], [0.028, 0.095, 0.028], { rot: [-Math.PI / 2, 0, 0] })); // 尾
  return parts;
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

// 鸟：流线身体 + 明显的颈/头/喙/眼 + 多层羽片拼出的真实翼形 + 分叉尾羽。
// 翼尖按 |x| 给 aWing 权重，拍翅只在翼端弯曲，肩部稳定；尾羽给一半权重随之轻摆。
function makeBirdParts() {
  const body = 0x5f6850, bodyD = 0x494f3d, head = 0x555d47, belly = 0xcfcbb0;
  const cover = 0x79816a, mid = 0x6a7259, prim = 0x404636, tailC = 0x525a44;
  const beak = 0xe0ad45, beakD = 0xb98528, eye = 0x0e0c07, glint = 0xe8e2c8;
  const a = [
    // 纺锤形躯干（前胸饱满、向后收细），腹部浅色，背部深色
    P(SPH, body, [0, 0, 0.006], [0.058, 0.050, 0.132]),
    P(SPH_L, belly, [0, -0.028, 0.020], [0.046, 0.022, 0.108]),
    P(SPH_L, bodyD, [0, 0.030, -0.010], [0.046, 0.018, 0.100]),
    // 颈 + 头（抬起、前伸），喙上下两片带色差，眼睛带高光点
    P(SPH_L, body, [0, 0.030, 0.116], [0.033, 0.034, 0.045]),
    P(SPH, head, [0, 0.044, 0.158], [0.045, 0.044, 0.047]),
    P(CONE, beak, [0, 0.040, 0.212], [0.020, 0.070, 0.020], { rot: [Math.PI / 2, 0, 0] }),
    P(CONE, beakD, [0, 0.026, 0.206], [0.014, 0.050, 0.014], { rot: [Math.PI / 2, 0, 0] }),
  ];
  // 翅膀：FEATHER 本地沿 +X 生长；用 rotY 定方向（右翼 +X，左翼 π−角），scale 恒正避免负缩放把法线翻掉。
  // 由覆羽 → 中级飞羽 → 3 根初级飞羽扇形叠成，前缘整齐、后缘参差。
  const wingFn = (x, y, z) => clamp((Math.abs(x) - 0.035) / 0.340, 0, 1);
  for (const s of [-1, 1]) {
    const dir = ang => s > 0 ? ang : Math.PI - ang;   // 关于 Z 轴镜像到左翼
    // 覆羽（翼根大片，铺出翼面主体）
    a.push(P(FEATHER, cover, [s * 0.032, 0.030, 0.030], [0.165, 0.160, 0.150],
      { rot: [0, dir(0.10), 0], wing: wingFn }));
    // 中级飞羽：沿翼后缘铺两片
    a.push(P(FEATHER, mid, [s * 0.140, 0.024, -0.010], [0.165, 0.125, 0.092],
      { rot: [0, dir(0.38), 0], wing: wingFn }));
    a.push(P(FEATHER, mid, [s * 0.158, 0.022, 0.048], [0.150, 0.105, 0.084],
      { rot: [0, dir(0.10), 0], wing: wingFn }));
    // 初级飞羽 3 根：更长更窄，翼尖张开成"手指"
    for (let k = 0; k < 3; k++) {
      a.push(P(FEATHER, prim, [s * 0.235, 0.020, -0.058 + k * 0.032], [0.190, 0.098, 0.054],
        { rot: [0, dir(0.55 + k * 0.17), 0], wing: wingFn }));
    }
    // 眼：黑眼球 + 高光，左右各一
    a.push(P(SPH_L, eye, [s * 0.038, 0.052, 0.176], [0.012, 0.012, 0.012]));
    a.push(P(SPH_L, glint, [s * 0.041, 0.056, 0.185], [0.004, 0.004, 0.004]));
  }
  // 尾羽：5 片扇形朝身后(-Z)展开，rotY = π/2 让 +X 羽片转向 -Z，按 k 散开
  const tailFn = () => 0.45;
  for (let k = -2; k <= 2; k++) {
    a.push(P(FEATHER, k % 2 ? tailC : prim, [k * 0.026, 0.006, -0.130],
      [0.135 - Math.abs(k) * 0.014, 0.080, 0.034],
      { rot: [0, Math.PI / 2 - k * 0.24, 0], wing: tailFn }));
  }
  return a;
}

// ---------------- 落点采样 ----------------
// 全岛均匀撒点会让每片视野平均不到 1 只，等于看不见。改为 78% 落在「地标热点」周围
// 3–20m 的簇里：玩家走到出生点 / 水塘 / 沼泽 / 木屋时一次能看到好几只。
const CLUSTERS = [
  [0, 247.5], [0, 212.5], [-35, 197.5], [-72.5, 140], [-97.5, 77.5], [-130, 92.5],
  [107.5, 65], [87.5, 37.5], [-42.5, 18.75], [0, 22.5], [55, 123.75], [0, -125],
  [0, -196], [-156.25, 68.75], [147.5, -137.5], [-80, 135],
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
  // 2026-11-19 用户要求去掉小蛇/乌龟等地面小动物：全部 n:0 不再生成（代码保留可随时恢复）
  { key: 'lizard', parts: lizardParts, n: 0, mat: { wave: 0.030 }, size: [1.30, 1.85],
    pick: () => randLand((x, z) => dist2(x, z, 0, 0) < 200, 0.84), label: '雨林蜥蜴' },
  { key: 'snake', parts: snakeParts, n: 0, mat: { wave: 0.115 }, size: [1.15, 1.75],
    pick: () => randLand((x, z) => nearWater(x, z) < 100 || dist2(x, z, 0, 0) < 160, 0.80), label: '草蛇' },
  { key: 'tortoise', parts: tortoiseParts, n: 0, mat: { wave: 0.008 }, size: [1.20, 1.70],
    pick: () => randLand((x, z) => nearWater(x, z) < 120, 0.82), label: '陆龟' },
  { key: 'croc', parts: crocParts, n: 0, mat: { wave: 0.14 }, size: [0.55, 0.75],
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
    if (!sp.n) continue;            // 数量 0：跳过生成，不创建 mesh
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
  // 优先用 bird.glb（bird.fbx 烘焙帧：黑身黄喙顶点色，头朝 +Z、翼展 0.85m）；
  // 缺文件时回退内置程序化鸟，两种都走同一套 aWing 顶点拍翅 + InstancedMesh。
  const BN = 88;
  let bgeo = null, birdVC = false;
  const birdAsset = hasAsset('bird') ? assetInstance('bird') : null;
  if (birdAsset) {
    birdAsset.wrap.traverse((o) => { if (o.isMesh && !bgeo) bgeo = o.geometry.clone(); });
    if (bgeo && bgeo.attributes.color) {
      // GLB 翼展沿 X：按离中轴距离补 aWing（翼尖=1，身体=0），aSeg 置 0（不参与蛇形摆动）
      const pa = bgeo.attributes.position;
      bgeo.computeBoundingBox();
      const bb = bgeo.boundingBox;
      const cx = (bb.min.x + bb.max.x) / 2;
      const hx = Math.max(0.001, (bb.max.x - bb.min.x) / 2);
      const wing = new Float32Array(pa.count);
      for (let i = 0; i < pa.count; i++) {
        wing[i] = clamp((Math.abs(pa.getX(i) - cx) / hx - 0.18) / 0.82, 0, 1);
      }
      bgeo.setAttribute('aWing', new THREE.BufferAttribute(wing, 1));
      bgeo.setAttribute('aSeg', new THREE.BufferAttribute(new Float32Array(pa.count), 1));
      birdVC = true;
      console.log('[wildlife] 飞鸟已换成 bird.glb（顶点色模型，翼展 ' + (hx * 2).toFixed(2) + 'm）');
    } else bgeo = null;
  }
  if (!bgeo) {
    bgeo = combine(makeBirdParts());
    console.log('[wildlife] bird.glb 不可用，飞鸟回退内置程序化模型');
  }
  const bmat = wildlifeMaterial({ flap: 0.095, flapSpeed: 12.0, wave: 0, black: !birdVC, birdVC });
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

  const addBird = (kind, cfg) => {
    const i = birds.length;
    if (i >= BN) return null;
    bPhase[i] = rng() * 6.283;
    bFlap[i] = kind === 'perch' ? 0 : (kind === 'raptor' ? 0.6 : 1);
    bRate[i] = kind === 'raptor' ? 0.34 : kind === 'gull' ? 0.62 : 1;
    const b = { kind, i, ...cfg, phase: bPhase[i], visTh: rng() * 0.95 };
    birds.push(b);
    return b;
  };

  // 鸟群不再全岛乱撒：固定盘旋在玩家真正会抬头看的地标上空，
  // 出生点朝外海 / 朝林间各有 1 群，水塘、沼泽、木屋、索桥、北岸也各有一群。
  const FLOCK_CENTERS = [
    [0, 290, 25, 30], [0, 237.5, 18.75, 26], [-72.5, 140, 17.5, 31], [-97.5, 77.5, 20, 28],
    [107.5, 65, 22.5, 27], [-42.5, 18.75, 17.5, 30], [0, 75, 27.5, 38], [0, -247.5, 25, 34],
  ];
  const flocks = [];
  for (const [cx, cz, radius, height] of FLOCK_CENTERS) {
    const g = {
      cx, cz, radius, height,
      ang: rng() * 6.283, w: (0.10 + rng() * 0.13) * (rng() < 0.5 ? -1 : 1),
      squash: 0.70 + rng() * 0.42,
    };
    flocks.push(g);
    const n = 5 + ((rng() * 3) | 0);
    for (let k = 0; k < n; k++) {
      addBird('flock', {
        flock: g, off: (k / n) * 6.283 + (rng() - 0.5) * 0.5,
        rr: g.radius * (0.72 + rng() * 0.5), yy: (rng() - 0.5) * 2.4,
        scale: 1.55 + rng() * 0.85,
      });
    }
  }
  // 高空猛禽：慢速大半径盘旋，其中 1 只固定盘在出生点上空
  for (let k = 0; k < 3; k++) {
    const n = k < 1;
    addBird('raptor', {
      cx: n ? (rng() - 0.5) * 40 : (rng() - 0.5) * 220,
      cz: n ? 195 + (rng() - 0.5) * 40 : (rng() - 0.5) * 220,
      radius: 26 + rng() * 28, height: 52 + rng() * 20,
      ang: rng() * 6.283, w: (0.055 + rng() * 0.045) * (rng() < 0.5 ? -1 : 1),
      solo: true, scale: 2.8 + rng() * 1.2,
    });
  }
  // 海鸟：绕着几处海岸点滑翔（不是绕整岛一个大圆，否则永远不在视野里）
  const GULL_SPOTS = [[0, 236], [-95, 185], [100, 180], [0, -232], [-185, 90], [180, 60]];
  for (let k = 0; k < 8; k++) {
    const s = GULL_SPOTS[k % GULL_SPOTS.length];
    addBird('gull', {
      cx: s[0] + (rng() - 0.5) * 26, cz: s[1] + (rng() - 0.5) * 26,
      radius: 10 + rng() * 22, height: 22 + rng() * 14,
      ang: rng() * 6.283, w: (0.05 + rng() * 0.06) * (rng() < 0.5 ? -1 : 1),
      solo: true, scale: 1.8 + rng() * 0.9, coastal: true,
    });
  }
  // 停栖鸟：从树干碰撞体里挑大树，挂在 4–8m 高的枝杈上；玩家靠近会惊飞
  const trees = colliders.filter(c => c.r > 1.35);
  for (let k = 0; k < 10 && trees.length; k++) {
    const c = trees[(rng() * trees.length) | 0];
    const h = baseHeight(c.x, c.z);
    if (h < 1 || h > 28) continue;
    addBird('perch', {
      px: c.x + (rng() - 0.5) * 1.4, pz: c.z + (rng() - 0.5) * 1.4,
      py: h + 4.2 + rng() * 3.6, yaw: rng() * 6.283,
      scale: 1.20 + rng() * 0.50, flyT: 0, flyAng: 0,
    });
  }
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
    for (const sp of SPECS) if (ground[sp.key]) ground[sp.key].mesh.instanceMatrix.needsUpdate = true;

    // —— 鸟类 ——
    let visCount = 0;
    for (const b of birds) {
      // 夜间飞鸟归巢；下雨天飞鸟躲雨不出现，停栖鸟仍留在枝上
      let show = b.kind === 'perch' ? day > 0.30 : day > b.visTh * 0.92;
      if (b.kind !== 'perch' && rain > 0.12) {
        // 随雨势渐隐：小雨零星、中雨大半归巢、大雨天空清空
        show = show && b.visTh > (rain - 0.12) * 1.6;
      }
      if (!show) { hide(bmesh, b.i); continue; }
      let x, y, z, yaw, roll = 0;
      if (b.kind === 'perch') {
        const d = Math.hypot(b.px - px, b.pz - pz);
        // 雨天不惊飞：停栖鸟缩在枝上躲雨，天空保持无飞鸟
        if (d < 8.5 && b.flyT <= 0 && rain < 0.35) { b.flyT = 9.0; b.flyAng = rng() * 6.283; bFlap[b.i] = 1; bgeo.attributes.aFlap.needsUpdate = true; }
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
        ground: Object.fromEntries(SPECS.map(s => [s.key, ground[s.key] ? ground[s.key].list.length : 0])),
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
