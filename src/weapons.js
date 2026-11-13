// 程序化武器模型：步枪 / 军刀
// 第三人称角色的手持武器用 hands:false 版本（手由角色骨骼负责）
import * as THREE from 'three';
import { metalTex, woodGrain } from './textures.js';

const UPV = new THREE.Vector3(0, 1, 0);
// 共享单位球：指节/手掌的圆润体块都靠它缩放，省几何体
const JOINT = new THREE.SphereGeometry(1, 10, 7);

// 两点之间的锥柱（手指节、前臂）
function limb(a, b, r1, r2, mat, seg = 8) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(d.length(), 1e-4);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UPV, d.normalize());
  return m;
}
// 一节弯曲的手指：若干点 + 逐点半径，段间用球做关节
function digit(pts, radii, mat) {
  const g = new THREE.Group();
  for (let i = 0; i < pts.length - 1; i++) {
    g.add(limb(pts[i], pts[i + 1], radii[i], radii[i + 1], mat, 7));
    const j = new THREE.Mesh(JOINT, mat);
    j.scale.setScalar(radii[i] * 0.88); j.position.copy(pts[i]); g.add(j);
  }
  const tip = new THREE.Mesh(JOINT, mat);
  tip.scale.setScalar(radii[radii.length - 1] * 0.92);
  tip.position.copy(pts[pts.length - 1]); g.add(tip);
  return g;
}
// 椭球体块（手掌/手背）
function blob(sx, sy, sz, mat, x, y, z) {
  const m = new THREE.Mesh(JOINT, mat);
  m.scale.set(sx, sy, sz); m.position.set(x, y, z);
  return m;
}
// 把三角形绕序修正成朝外（按有符号体积判断），避免自定义放样体发黑
function fixWinding(geo) {
  const p = geo.attributes.position.array, ix = geo.index.array;
  let vol = 0;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
    vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  if (vol < 0) {
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    geo.index.needsUpdate = true;
  }
  geo.computeVertexNormals();
  return geo;
}
// 刀身放样：横截面 = 刀背(平) + 两侧平面 + 收薄的刃口，沿 z 逐段收拢到刀尖
function bladeGeo(secs, tipZ, tipY) {
  const pos = [], idx = [];
  const ringOf = (s) => {
    const ysh = s[1] - (s[1] - s[2]) * 0.42;      // 刃口斜面起点（宽研磨面）
    const te = Math.max(s[3] * 0.09, 0.00035);     // 刃口半厚（接近零 → 锋利）
    return [[s[3], s[1]], [s[3], ysh], [te, s[2]], [-te, s[2]], [-s[3], ysh], [-s[3], s[1]]];
  };
  const N = 6;
  secs.forEach((s) => { ringOf(s).forEach(([x, y]) => pos.push(x, y, s[0])); });
  // 按“面”分块生成索引：0/4 平面、1/3 研磨斜面、2 刃口、5 刀背
  const MAT = [0, 1, 2, 1, 0, 3];
  const groups = [];
  for (let k = 0; k < N; k++) {
    const start = idx.length;
    for (let i = 0; i < secs.length - 1; i++) {
      const a = i * N + k, b = (i + 1) * N + k, a2 = i * N + (k + 1) % N, b2 = (i + 1) * N + (k + 1) % N;
      idx.push(a, b, b2, a, b2, a2);
    }
    groups.push([start, idx.length - start, MAT[k]]);
  }
  // 刀尖顶点
  const apex = pos.length / 3;
  pos.push(0, tipY, tipZ);
  const last = (secs.length - 1) * N;
  let st = idx.length;
  for (let k = 0; k < N; k++) idx.push(last + k, apex, last + (k + 1) % N);
  groups.push([st, idx.length - st, 1]);
  // 根部封口
  st = idx.length;
  for (let k = 0; k < N; k++) idx.push(0, (k + 1) % N, k);
  groups.push([st, idx.length - st, 0]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  groups.forEach(([s0, c, m]) => geo.addGroup(s0, c, m));
  return fixWinding(geo);
}

// 步枪模型（含双手）：金属/木质材质 + 机械细节
export function buildRifle({ hands = true, scale = 0.62 } = {}) {
  const g = new THREE.Group();
  const MET = metalTex(); MET.repeat.set(1, 1);
  const WOOD = woodGrain(); WOOD.repeat.set(1, 1);
  const metal = new THREE.MeshStandardMaterial({ map: MET, color: 0x86827b, roughness: 0.38, metalness: 0.7 });
  const metalD = new THREE.MeshStandardMaterial({ map: MET, color: 0x3a3833, roughness: 0.55, metalness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ map: WOOD, color: 0x6d4a2b, roughness: 0.68, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22211f, roughness: 0.78, metalness: 0.28 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x4c4032, roughness: 0.9, metalness: 0.0 });
  const gloveL = new THREE.MeshStandardMaterial({ color: 0x5a4b39, roughness: 0.88 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x23261c, roughness: 1.0 });
  const sleeveD = new THREE.MeshStandardMaterial({ color: 0x1a1c14, roughness: 1.0 });

  const box = (w, h, d, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m;
  };
  const cyl = (r1, r2, len, mat, x, y, z, seg = 12) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat);
    m.rotation.x = Math.PI / 2; m.position.set(x, y, z); g.add(m); return m;
  };

  // —— 机匣 ——
  box(0.058, 0.088, 0.30, metal, 0, 0.012, -0.02);
  box(0.052, 0.03, 0.26, metalD, 0, -0.038, -0.03);      // 下机匣
  // 顶部导轨（带齿）
  for (let i = 0; i < 9; i++) box(0.036, 0.008, 0.012, dark, 0, 0.058, -0.14 + i * 0.032);
  // 抛壳口
  box(0.008, 0.03, 0.07, dark, 0.03, 0.03, -0.02);
  // 拉机柄（右侧，后拉）
  const chg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 8), metalD);
  chg.rotation.z = Math.PI / 2; chg.position.set(0.042, 0.026, -0.06); g.add(chg);
  const chgKnob = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), metalD);
  chgKnob.position.set(0.068, 0.026, -0.06); g.add(chgKnob);
  // 螺丝/铆钉
  for (const [px, py, pz] of [[0.03, 0.0, 0.08], [0.03, 0.0, -0.12], [-0.03, 0.0, 0.08], [-0.03, 0.0, -0.12]]) {
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.006, 6), metalD);
    sc.rotation.z = Math.PI / 2; sc.position.set(px, py, pz); g.add(sc);
  }

  // —— 枪管组 ——
  cyl(0.0165, 0.0185, 0.44, metal, 0, 0.042, -0.42);      // 主管
  cyl(0.014, 0.0165, 0.16, metalD, 0, 0.042, -0.70);      // 前段
  // 消焰器（带侧孔）
  const brake = cyl(0.024, 0.026, 0.075, metalD, 0, 0.042, -0.79);
  for (let i = 0; i < 3; i++) box(0.05, 0.006, 0.012, dark, 0, 0.042, -0.79 + (i - 1) * 0.022);
  // 导气箍
  box(0.036, 0.038, 0.05, metalD, 0, 0.038, -0.6);
  // 护木（木质，带散热槽）
  box(0.062, 0.062, 0.26, wood, 0, 0.028, -0.32);
  for (const sx of [-0.02, 0.02]) for (let i = 0; i < 3; i++)
    box(0.006, 0.03, 0.05, metalD, sx, 0.03, -0.40 + i * 0.07);
  box(0.05, 0.012, 0.24, metalD, 0, -0.006, -0.32);        // 护木下托

  // —— 准星：立柱 + 两侧护翼 ——
  box(0.008, 0.045, 0.012, dark, 0, 0.098, -0.70);
  for (const sgn of [-1, 1]) box(0.006, 0.035, 0.03, dark, sgn * 0.02, 0.095, -0.70);
  box(0.046, 0.008, 0.03, dark, 0, 0.076, -0.70);
  // 照门：带缺口
  box(0.042, 0.014, 0.028, dark, 0, 0.082, 0.055);
  for (const sgn of [-1, 1]) box(0.009, 0.022, 0.024, dark, sgn * 0.016, 0.09, 0.055);

  // —— 枪托（木质 + 贴腮 + 托底板） ——
  box(0.05, 0.088, 0.16, wood, 0, 0.005, 0.22);
  box(0.05, 0.062, 0.14, wood, 0, -0.012, 0.34, 0.06);
  box(0.052, 0.036, 0.14, wood, 0, 0.036, 0.26);           // 贴腮
  box(0.054, 0.092, 0.018, dark, 0, -0.004, 0.415);        // 托底
  // 托底缓冲垫
  box(0.05, 0.084, 0.012, new THREE.MeshStandardMaterial({ color: 0x1a1917, roughness: 1 }), 0, -0.004, 0.428);
  // 枪背带环
  for (const pz of [0.36, -0.55]) {
    const sw = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 5, 8), metalD);
    sw.position.set(0, -0.038, pz); sw.rotation.y = Math.PI / 2; g.add(sw);
  }

  // —— 握把 / 弹匣 / 扳机组 ——
  const grip = box(0.042, 0.12, 0.056, wood, 0, -0.095, 0.115, 0.34);
  box(0.044, 0.02, 0.058, metalD, 0, -0.03, 0.10);
  // 弧形弹匣
  box(0.036, 0.085, 0.062, dark, 0, -0.075, -0.035, -0.08);
  box(0.034, 0.075, 0.058, dark, 0, -0.145, -0.055, -0.18);
  // 扳机护圈
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.005, 5, 12, Math.PI * 1.15), metalD);
  guard.position.set(0, -0.052, 0.045); guard.rotation.set(Math.PI / 2, 0, 0.2); g.add(guard);
  const trig = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.026, 0.008), metalD);
  trig.position.set(0, -0.06, 0.055); trig.rotation.x = 0.2; g.add(trig);
  // 保险
  const safe = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 8), metalD);
  safe.rotation.z = Math.PI / 2; safe.position.set(-0.033, -0.02, 0.06); g.add(safe);

  if (hands) {
  // —— 右手：手掌贴住握把右侧，四指绕到握把前端各向内扣住 ——
  const handR = new THREE.Group();
  handR.position.set(0, -0.095, 0.115);
  handR.rotation.x = 0.34;
  handR.add(blob(0.020, 0.050, 0.034, glove, 0.038, 0.004, -0.004));   // 手背
  handR.add(blob(0.022, 0.026, 0.030, glove, 0.033, -0.046, 0.010));   // 掌根
  for (let i = 0; i < 4; i++) {
    const y = 0.034 - i * 0.023;
    handR.add(digit([
      new THREE.Vector3(0.038, y, 0.006),
      new THREE.Vector3(0.040, y - 0.003, -0.026),
      new THREE.Vector3(0.014, y - 0.007, -0.045),
      new THREE.Vector3(-0.020, y - 0.008, -0.033),
    ], [0.0116, 0.0108, 0.0098, 0.0082], gloveL));
  }
  for (let i = 0; i < 4; i++) {   // 指节隆起
    const y = 0.034 - i * 0.023;
    handR.add(blob(0.012, 0.010, 0.013, glove, 0.041, y - 0.002, -0.012));
  }
  handR.add(digit([   // 拇指绕到握把左上侧
    new THREE.Vector3(0.032, 0.050, 0.012),
    new THREE.Vector3(0.022, 0.070, -0.010),
    new THREE.Vector3(-0.006, 0.072, -0.024),
    new THREE.Vector3(-0.023, 0.055, -0.014),
  ], [0.0132, 0.0122, 0.0106, 0.0086], gloveL));
  handR.scale.setScalar(1.24);
  g.add(handR);

  // —— 左手：托住护木下沿，四指扣住护木左侧再翻上顶面 ——
  const handL = new THREE.Group();
  handL.position.set(0, 0.026, -0.325);
  handL.add(blob(0.024, 0.017, 0.038, glove, -0.010, -0.038, 0.004));  // 手背
  for (let i = 0; i < 4; i++) {
    const z = 0.033 - i * 0.024;
    handL.add(digit([
      new THREE.Vector3(-0.028, -0.038, z),
      new THREE.Vector3(-0.042, -0.008, z),
      new THREE.Vector3(-0.033, 0.022, z),
      new THREE.Vector3(-0.015, 0.034, z + 0.002),
    ], [0.0112, 0.0106, 0.0096, 0.0080], gloveL));
  }
  for (let i = 0; i < 4; i++) {
    const z = 0.033 - i * 0.024;
    handL.add(blob(0.012, 0.011, 0.013, glove, -0.036, 0.006, z));
  }
  handL.add(digit([   // 拇指沿护木右侧向前
    new THREE.Vector3(-0.004, -0.042, 0.052),
    new THREE.Vector3(0.014, -0.030, 0.012),
    new THREE.Vector3(0.022, -0.014, -0.032),
  ], [0.0126, 0.0112, 0.0090], gloveL));
  handL.scale.setScalar(1.30);
  g.add(handL);
  // 右臂：皮手套腕口 → 翻边袖口 → 向右下出画
  const rWr = new THREE.Vector3(0.052, -0.166, 0.146);
  const rCf = new THREE.Vector3(0.100, -0.240, 0.220);
  g.add(limb(rWr, rCf, 0.030, 0.033, glove, 9));
  g.add(limb(rCf, new THREE.Vector3(0.310, -0.560, 0.520), 0.035, 0.050, sleeve, 10));
  g.add(limb(rCf.clone().addScaledVector(new THREE.Vector3(0.31, -0.29, 0.62).normalize(), -0.012),
             rCf.clone().addScaledVector(new THREE.Vector3(0.31, -0.29, 0.62).normalize(), 0.016), 0.043, 0.043, sleeveD, 10));
  // 左臂：从画面左下斜插到护木（不能竖直立在画面中间）
  const lWr = new THREE.Vector3(-0.012, -0.058, -0.290);
  const lCf = new THREE.Vector3(-0.115, -0.150, -0.245);
  g.add(limb(lWr, lCf, 0.030, 0.033, glove, 9));
  g.add(limb(lCf, new THREE.Vector3(-0.700, -0.620, -0.100), 0.035, 0.050, sleeve, 10));
  const lDir = new THREE.Vector3(-0.585, -0.470, 0.145).normalize();
  g.add(limb(lCf.clone().addScaledVector(lDir, -0.012), lCf.clone().addScaledVector(lDir, 0.016), 0.043, 0.043, sleeveD, 10));
  }

  g.scale.setScalar(scale);
  return g;
}

/** 枪口在步枪局部坐标中的位置（缩放前），供火光与曳光弹定位 */
export const RIFLE_MUZZLE = new THREE.Vector3(0, 0.042, -0.83);

export function buildKnife({ hands = true, scale = 0.95 } = {}) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({   // 刀身平面（拉丝）
    map: metalTex(), color: 0xc8d0d8, roughness: 0.3, metalness: 0.5,
    envMapIntensity: 0.8, flatShading: true,
  });
  const steelHone = new THREE.MeshStandardMaterial({ // 研磨斜面（抛光）
    color: 0xe9eff6, roughness: 0.07, metalness: 0.9, envMapIntensity: 1.0, flatShading: true,
  });
  const steelEdge = new THREE.MeshStandardMaterial({ // 刃口
    color: 0xf6fafd, roughness: 0.04, metalness: 0.95, envMapIntensity: 1.2, flatShading: true,
  });
  const steelSpine = new THREE.MeshStandardMaterial({ // 刀背
    color: 0x8d959d, roughness: 0.45, metalness: 0.55, envMapIntensity: 0.5, flatShading: true,
  });
  const steelMats = [steel, steelHone, steelEdge, steelSpine];
  const steelD = new THREE.MeshStandardMaterial({ color: 0x6b727a, roughness: 0.5, metalness: 0.62 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1d1b18, roughness: 0.94 });
  const wrap = new THREE.MeshStandardMaterial({ color: 0x4b3d2b, roughness: 0.96 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x4c4032, roughness: 0.9 });
  const gloveL = new THREE.MeshStandardMaterial({ color: 0x5a4b39, roughness: 0.88 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x23261c, roughness: 1.0 });

  // —— 刀身：截面逐段收拢到刀尖（刀背 0.030 → 刃口 -0.034，越靠尖端越窄） ——
  const SEC = [
    // [z, 刀背 y, 刃口 y, 半厚]：直刀背 + 外弧刃 + 前端收成 clip point
    [-0.062, 0.030, -0.022, 0.0082],
    [-0.150, 0.030, -0.032, 0.0076],
    [-0.250, 0.030, -0.036, 0.0068],
    [-0.320, 0.029, -0.033, 0.0057],
    [-0.372, 0.025, -0.025, 0.0045],
    [-0.416, 0.011, -0.015, 0.0029],
    [-0.444, -0.005, -0.009, 0.0011],
  ];
  g.add(new THREE.Mesh(bladeGeo(SEC, -0.458, -0.011), steelMats));

  // —— 护手（椭圆盘，略前倾） ——
  const guardGeo = new THREE.CylinderGeometry(0.029, 0.029, 0.011, 16);
  const guard = new THREE.Mesh(guardGeo, steelD);
  guard.scale.set(1.16, 1, 0.70);
  guard.rotation.x = Math.PI / 2;
  guard.position.set(0, 0.0, -0.052);
  g.add(guard);

  // —— 柄：叠层皮革/橡胶环（中段略鼓）+ 钢制刀首 ——
  const HN = 8;
  for (let i = 0; i < HN; i++) {
    const t = i / (HN - 1);
    const z = -0.044 + t * 0.150;
    const r = 0.0206 + Math.sin(t * Math.PI) * 0.0036;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.0225, 14), i % 2 ? wrap : rubber);
    seg.scale.set(1, 1, 0.80);          // 截面压扁（旋转后压的是竖直方向）
    seg.rotation.x = Math.PI / 2;
    seg.position.set(0, 0, z);
    g.add(seg);
  }
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 9), steelD);
  pom.scale.set(1.0, 0.78, 0.5);
  pom.rotation.x = Math.PI / 2;
  pom.position.set(0, 0, 0.118);
  g.add(pom);

  // —— 握刀的手：四指绕柄环扣，拇指压在柄左 ——
  if (hands) {
  const hand = new THREE.Group();
  hand.add(blob(0.019, 0.026, 0.038, glove, 0.031, -0.002, 0.074));    // 手背
  hand.add(blob(0.020, 0.024, 0.030, glove, 0.030, -0.014, 0.126));    // 腕部
  for (let i = 0; i < 4; i++) {
    const z = 0.112 - i * 0.024;
    hand.add(digit([
      new THREE.Vector3(0.030, 0.012, z),
      new THREE.Vector3(0.028, -0.019, z),
      new THREE.Vector3(0.001, -0.031, z),
      new THREE.Vector3(-0.026, -0.015, z),
    ], [0.0094, 0.0088, 0.0080, 0.0066], gloveL));
  }
  hand.add(digit([
    new THREE.Vector3(-0.020, 0.018, 0.118),
    new THREE.Vector3(-0.029, 0.024, 0.058),
    new THREE.Vector3(-0.023, 0.014, 0.004),
  ], [0.0104, 0.0094, 0.0076], gloveL));
  hand.scale.setScalar(1.16);
  g.add(hand);
  g.add(limb(new THREE.Vector3(0.048, -0.028, 0.146), new THREE.Vector3(0.092, -0.096, 0.212), 0.030, 0.033, glove, 9));
  g.add(limb(new THREE.Vector3(0.092, -0.096, 0.212), new THREE.Vector3(0.300, -0.420, 0.470), 0.034, 0.048, sleeve, 10));
  }

  g.scale.setScalar(scale);
  return g;
}
