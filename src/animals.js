// 野兽：程序化建模（狼/棕熊/沼泽鳄/巨蛛）+ AI 状态机 + 血液粒子
import * as THREE from 'three';
import { BEASTS, BEAST_SPAWNS } from './config.js';
import { mulberry32, clamp, dist2 } from './util.js';
import { groundHeight } from './terrain.js';
import { colliders } from './flora.js';
import { instance } from './assets.js';

const rng = mulberry32(9182);
const V = new THREE.Vector3();
const UP3 = new THREE.Vector3(0, 1, 0);

// ---------------- 建模 ----------------
import { furNormal, scaleNormal, metalTex } from './textures.js';

const FUR_N = furNormal();
const SCALE_N = scaleNormal();

// 有机体材质：平滑着色 + 毛发法线
function furMat(color, rough = 0.95, normal = FUR_N) {
  return new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: 0,
    normalMap: normal, normalScale: new THREE.Vector2(0.32, 0.32),
  });
}
function mat(color, rough = 0.92) { return new THREE.MeshStandardMaterial({ color, roughness: rough }); }

// 沿法线做低频起伏，让浑圆的球体出现毛团/肌肉的轮廓
function roughen(geo, amp = 0.035, freq = 5.5) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = Math.sin(x * freq + y * freq * 1.7) * Math.cos(z * freq * 1.3 + y * freq * 0.6) * amp;
    p.setXYZ(i, x + n.getX(i) * d, y + n.getY(i) * d, z + n.getZ(i) * d);
  }
  geo.computeVertexNormals();
  return geo;
}
const sph = (r, w = 14, h = 11) => roughen(new THREE.SphereGeometry(r, w, h), r * 0.09, 6 / Math.max(0.2, r));
const cap = (r, len, w = 12) => roughen(new THREE.CapsuleGeometry(r, len, 5, w), r * 0.08, 7 / Math.max(0.2, r));

function tooth(parent, x, y, z, len = 0.05, s = 1) {
  const t = new THREE.Mesh(new THREE.ConeGeometry(len * 0.42, len, 5), mat(0xe6dfc8, 0.45));
  t.position.set(x, y, z); t.scale.setScalar(s);
  t.rotation.x = Math.PI;   // 尖朝下
  parent.add(t);
}
function claw(parent, x, y, z, len = 0.09, dir = -0.5) {
  const c = new THREE.Mesh(new THREE.ConeGeometry(len * 0.32, len, 5), mat(0x2a2119, 0.5));
  c.position.set(x, y, z); c.rotation.x = dir + Math.PI;
  parent.add(c);
}
function eyeMesh(r, color, glow, glowI = 1.2) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8),
    new THREE.MeshStandardMaterial({ color, emissive: glow, emissiveIntensity: glowI, roughness: 0.25 }));
}

function makeWolf() {
  // 外部 wolf.glb 优先（头朝 +Z=前进方向，底部中心=原点）；缺文件时程序化林狼兜底
  const wi = instance('wolf');
  if (wi) return { group: wi.wrap, legs: [], head: null, phase: rng() * 6.28, face: 1 };
  const g = new THREE.Group();
  const fur = furMat(0x6e675c), furD = furMat(0x453f37), furL = furMat(0x8b8274), belly = furMat(0x9a9082);
  const noseM = mat(0x1b1613, 0.35);
  const grp = new THREE.Group(); g.add(grp);

  // —— 躯干：肩高约 0.8m，胸腔深、腰腹收 ——
  const chest = new THREE.Mesh(sph(0.30, 16, 12), fur);
  chest.position.set(0, 0.80, -0.42); chest.scale.set(1.0, 1.12, 1.05); grp.add(chest);
  const body = new THREE.Mesh(cap(0.255, 0.55, 14), fur);
  body.rotation.x = Math.PI / 2; body.position.set(0, 0.76, 0.06); body.scale.set(1, 1, 0.9); grp.add(body);
  const waist = new THREE.Mesh(sph(0.225, 12, 9), fur);
  waist.position.set(0, 0.74, 0.36); waist.scale.set(0.94, 0.92, 1.0); grp.add(waist);
  const rump = new THREE.Mesh(sph(0.26, 12, 9), furD);
  rump.position.set(0, 0.75, 0.58); rump.scale.set(0.98, 1.0, 1.0); grp.add(rump);
  // 背脊深色披毛
  const saddle = new THREE.Mesh(sph(0.27, 12, 9), furD);
  saddle.scale.set(0.82, 0.5, 1.55); saddle.position.set(0, 0.88, 0.08); grp.add(saddle);
  // 腹部浅毛
  const bel = new THREE.Mesh(sph(0.235, 12, 9), belly);
  bel.scale.set(0.9, 0.55, 1.5); bel.position.set(0, 0.62, 0.06); grp.add(bel);

  // —— 颈部与头 ——
  const neck = new THREE.Mesh(cap(0.155, 0.3, 10), fur);
  neck.position.set(0, 0.94, -0.64); neck.rotation.x = 1.15; grp.add(neck);
  // 颈部鬃毛（一圈外扩的毛领）
  const ruff = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 9), furL);
  ruff.scale.set(1.0, 0.9, 0.72); ruff.position.set(0, 0.9, -0.6); grp.add(ruff);

  const head = new THREE.Mesh(sph(0.195, 16, 12), fur);
  head.scale.set(0.92, 0.9, 1.05); head.position.set(0, 1.0, -0.88); grp.add(head);
  // 额骨与颊
  const brow = new THREE.Mesh(sph(0.13, 10, 8), fur);
  brow.scale.set(1.25, 0.55, 0.9); brow.position.set(0, 1.06, -0.98); grp.add(brow);
  // 口鼻：细长圆锥台
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 0.42, 10), furL);
  muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.955, -1.18); muzzle.scale.set(1, 1, 0.82); grp.add(muzzle);
  const jaw = new THREE.Mesh(sph(0.07, 9, 7), belly);
  jaw.scale.set(0.92, 0.55, 1.35); jaw.position.set(0, 0.9, -1.16); grp.add(jaw);
  const nose = new THREE.Mesh(sph(0.036, 8, 6), noseM);
  nose.position.set(0, 0.965, -1.38); grp.add(nose);

  for (const sgn of [-1, 1]) {
    // 耳（外耳 + 内耳）
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.23, 7), furD);
    ear.position.set(sgn * 0.115, 1.15, -0.85); ear.rotation.set(-0.2, 0, sgn * 0.24); grp.add(ear);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.15, 6), furMat(0x9b7166, 0.9));
    inner.position.set(sgn * 0.113, 1.14, -0.885); inner.rotation.set(-0.24, 0, sgn * 0.24); grp.add(inner);
    // 眼 + 眼窝
    const eye = eyeMesh(0.028, 0xd8c274, 0xc79a22, 0.85);
    eye.position.set(sgn * 0.093, 1.03, -1.02); grp.add(eye);
    // 犬齿
    tooth(grp, sgn * 0.035, 0.895, -1.30, 0.055);
  }
  // 尾：五段，下垂蓬松
  const tailBase = new THREE.Group();
  tailBase.position.set(0, 0.78, 0.8);
  tailBase.rotation.x = 0.95;
  grp.add(tailBase);
  let tp = 0;
  const tailSegs = [];
  for (let i = 0; i < 5; i++) {
    const r = 0.085 - i * 0.012;
    const seg = new THREE.Mesh(cap(r, 0.15, 8), i > 2 ? furL : furD);
    seg.rotation.x = Math.PI / 2;
    seg.position.set(0, 0, 0.1 + i * 0.145);
    tailBase.add(seg); tailSegs.push(seg);
    tp = i;
  }

  // —— 四肢：上臂/前臂/掌，带爪子 ——
  const legs = [];
  for (const [sx, sz, front] of [[-0.185, -0.44, 1], [0.185, -0.44, 1], [-0.175, 0.52, 0], [0.175, 0.52, 0]]) {
    const leg = new THREE.Group();
    const upper = new THREE.Mesh(cap(0.098, front ? 0.24 : 0.28, 10), fur);
    upper.position.y = -0.17; leg.add(upper);
    const lower = new THREE.Mesh(cap(0.062, 0.24, 8), furD);
    lower.position.set(0, -0.42, 0.02); leg.add(lower);
    const paw = new THREE.Mesh(sph(0.082, 9, 7), furD);
    paw.scale.set(1.0, 0.58, 1.45); paw.position.set(0, -0.58, -0.045); leg.add(paw);
    for (const cx of [-0.045, 0, 0.045]) claw(leg, cx, -0.60, -0.12, 0.045, -0.9);
    // 肩/髋的肌肉块
    const shoulder = new THREE.Mesh(sph(0.115, 9, 7), fur);
    shoulder.position.y = 0.0; shoulder.scale.set(1, 0.9, 1); leg.add(shoulder);
    leg.position.set(sx, front ? 0.78 : 0.8, sz);
    if (!front) leg.rotation.x = -0.08;
    g.add(leg); legs.push(leg);
  }
  return { group: g, legs, head, tail: tailBase, phase: rng() * 6.28, face: -1 };
}

function makeBear() {
  // 外部 mutant.glb 优先（mutant.fbx + mutant_swiping.fbx 合并，含 idle/swipe 骨骼动画）
  // 头朝 +Z = 野兽前进方向（face:1）；无文件时降级程序化棕熊
  const mi = instance('mutant');
  if (mi) {
    const mixer = new THREE.AnimationMixer(mi.wrap);
    const byName = (re, fb) => mi.animations.find(c => re.test(c.name)) || mi.animations[fb] || null;
    const idleClip = byName(/^idle/i, 0);
    const swipeClip = byName(/^swip/i, 1);
    const actions = {};
    if (idleClip) { actions.idle = mixer.clipAction(idleClip); actions.idle.play(); }
    if (swipeClip) { actions.swipe = mixer.clipAction(swipeClip); }
    return {
      group: mi.wrap, legs: [], head: null, phase: rng() * 6.28, face: 1,
      mixer, actions, anim: 'idle',
      swipeDur: swipeClip ? swipeClip.duration : 1.0,
    };
  }
  const g = new THREE.Group();
  const fur = furMat(0x3e2c1a), furD = furMat(0x28190e), furL = furMat(0x543a22);
  // 躯干（巨大、前重）
  const body = new THREE.Mesh(sph(0.92, 16, 12), fur);
  body.scale.set(1, 0.9, 1.55); body.position.y = 1.28; g.add(body);
  const hump = new THREE.Mesh(sph(0.6, 14, 10), furD);
  hump.scale.set(1.05, 0.85, 1.0); hump.position.set(0, 1.85, -0.35); g.add(hump);
  const bel = new THREE.Mesh(sph(0.82, 12, 9), furL);
  bel.scale.set(0.94, 0.5, 1.3); bel.position.set(0, 0.92, 0.1); g.add(bel);
  const rump = new THREE.Mesh(sph(0.72, 12, 10), fur);
  rump.scale.set(1, 0.92, 0.9); rump.position.set(0, 1.25, 0.85); g.add(rump);

  // 颈 → 头
  const neck = new THREE.Mesh(cap(0.42, 0.24, 12), fur);
  neck.position.set(0, 1.62, -1.02); neck.rotation.x = 1.35; g.add(neck);
  const head = new THREE.Mesh(sph(0.44, 16, 12), fur);
  head.scale.set(1.0, 0.94, 1.02); head.position.set(0, 1.58, -1.24); g.add(head);
  const brow = new THREE.Mesh(sph(0.3, 10, 8), fur);
  brow.scale.set(1.15, 0.6, 0.95); brow.position.set(0, 1.72, -1.34); g.add(brow);
  // 口鼻（短而宽）
  const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.245, 0.42, 12), furL);
  snout.rotation.x = Math.PI / 2; snout.position.set(0, 1.47, -1.60); snout.scale.set(1.05, 1, 0.8); g.add(snout);
  const muzzleEnd = new THREE.Mesh(sph(0.15, 10, 8), furL);
  muzzleEnd.scale.set(1.1, 0.8, 0.55); muzzleEnd.position.set(0, 1.47, -1.79); g.add(muzzleEnd);
  const nose = new THREE.Mesh(sph(0.095, 9, 7), mat(0x14100c, 0.4));
  nose.scale.set(1.2, 0.8, 0.8); nose.position.set(0, 1.49, -1.90); g.add(nose);
  // 嘴缝 + 下颚
  const lip = new THREE.Mesh(sph(0.13, 8, 6), mat(0x2a1d14, 0.7));
  lip.scale.set(1.15, 0.28, 0.6); lip.position.set(0, 1.35, -1.78); g.add(lip);

  for (const sgn of [-1, 1]) {
    const ear = new THREE.Mesh(sph(0.135, 9, 7), furD);
    ear.scale.set(1, 1, 0.6); ear.position.set(sgn * 0.285, 1.9, -1.1); g.add(ear);
    const earIn = new THREE.Mesh(sph(0.075, 7, 6), furMat(0x7d5a44, 0.9));
    earIn.scale.set(1, 1, 0.4); earIn.position.set(sgn * 0.285, 1.9, -1.17); g.add(earIn);
    const eye = eyeMesh(0.052, 0x150d07, 0x8a4a10, 0.35);
    eye.position.set(sgn * 0.2, 1.66, -1.56); g.add(eye);
    // 獠牙
    tooth(g, sgn * 0.095, 1.36, -1.82, 0.06);
  }

  // 四肢：粗壮，带巨大的爪
  const legs = [];
  for (const [sx, sz] of [[-0.52, -0.66], [0.52, -0.66], [-0.5, 0.82], [0.5, 0.82]]) {
    const leg = new THREE.Group();
    const shoulder = new THREE.Mesh(sph(0.3, 12, 9), fur);
    shoulder.position.y = 0.05; leg.add(shoulder);
    const upper = new THREE.Mesh(cap(0.225, 0.42, 10), fur);
    upper.position.y = -0.32; leg.add(upper);
    const lower = new THREE.Mesh(cap(0.165, 0.3, 9), furD);
    lower.position.set(0, -0.74, 0.03); leg.add(lower);
    const paw = new THREE.Mesh(sph(0.185, 10, 8), furD);
    paw.scale.set(1.05, 0.55, 1.35); paw.position.set(0, -1.0, -0.07); leg.add(paw);
    for (const cx of [-0.1, 0, 0.1]) claw(leg, cx, -1.03, -0.2, 0.1, -0.7);
    leg.position.set(sx, 1.18, sz);
    g.add(leg); legs.push(leg);
  }
  const tail = new THREE.Mesh(sph(0.1, 8, 6), furD);
  tail.scale.set(1, 0.9, 0.7); tail.position.set(0, 1.05, 1.32); g.add(tail);
  return { group: g, legs, head, phase: rng() * 6.28, face: -1 };
}

function makeCroc() {
  // 外部 croc.glb 优先（croc.fbx 转换）：静态网格，legs 留空即不做程序化腿摆动
  const ci = instance('croc');
  if (ci) return { group: ci.wrap, legs: [], head: null, phase: rng() * 6.28, face: 1 };
  const g = new THREE.Group();
  const skin = furMat(0x47542f, 0.72, SCALE_N), skinD = furMat(0x2f3a20, 0.7, SCALE_N), skinL = furMat(0x5f6c3c, 0.75, SCALE_N);
  // 躯干：扁长
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.5, 6, 10), skin);
  body.rotation.x = Math.PI / 2; body.scale.set(1, 1, 0.62); body.position.set(0, 0.36, 0.12); g.add(body);
  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.3, 5, 9), skinL);
  belly.rotation.x = Math.PI / 2; belly.scale.set(0.95, 1, 0.42); belly.position.set(0, 0.25, 0.12); g.add(belly);
  // 颈与头
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.3, 5, 9), skin);
  neck.rotation.x = Math.PI / 2; neck.scale.set(1, 1, 0.6); neck.position.set(0, 0.34, -0.95); g.add(neck);
  const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.34, 5, 9), skin);
  head.rotation.x = Math.PI / 2; head.scale.set(1.05, 1, 0.55); head.position.set(0, 0.32, -1.32); g.add(head);
  // 长吻
  const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.155, 0.62, 10), skinD);
  snout.rotation.x = Math.PI / 2; snout.scale.set(1, 1, 0.5); snout.position.set(0, 0.3, -1.78); g.add(snout);
  // 下颚
  const jaw = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.14, 0.6, 8), skinL);
  jaw.rotation.x = Math.PI / 2; jaw.scale.set(1, 1, 0.34); jaw.position.set(0, 0.2, -1.78); g.add(jaw);
  // 齿列（上/下各 7 颗）
  for (let i = 0; i < 7; i++) {
    const z = -2.02 + i * 0.085;
    const w = 0.075 + i * 0.008;
    for (const sgn of [-1, 1]) {
      const t1 = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.06, 4), mat(0xe8e2cc, 0.4));
      t1.position.set(sgn * w, 0.245, z); t1.rotation.x = Math.PI; g.add(t1);
      const t2 = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.05, 4), mat(0xe8e2cc, 0.4));
      t2.position.set(sgn * w, 0.24, z + 0.04); g.add(t2);
    }
  }
  const nose = new THREE.Mesh(sph(0.06, 8, 6), skinD);
  nose.scale.set(1.4, 0.6, 1); nose.position.set(0, 0.305, -2.06); g.add(nose);
  for (const sgn of [-1, 1]) {
    const eye = eyeMesh(0.05, 0xe8d48a, 0xd8a020, 1.6);
    eye.position.set(sgn * 0.13, 0.46, -1.36); g.add(eye);
    // 眉骨
    const ridge = new THREE.Mesh(sph(0.075, 8, 6), skinD);
    ridge.scale.set(1.1, 0.6, 1.2); ridge.position.set(sgn * 0.13, 0.5, -1.38); g.add(ridge);
  }
  // 背脊鳞甲（双列）
  for (let i = 0; i < 9; i++) {
    for (const sgn of [-1, 1]) {
      const sc = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.15, 4), skinD);
      sc.position.set(sgn * 0.1, 0.6 - i * 0.006, -0.6 + i * 0.28);
      sc.rotation.set(0.15, 0.4, 0); g.add(sc);
    }
  }
  // 尾：三段渐细
  const tailG = new THREE.Group();
  tailG.position.set(0, 0.33, 1.0);
  g.add(tailG);
  let tz = 0;
  for (let i = 0; i < 4; i++) {
    const r = 0.28 - i * 0.055;
    const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r, 0.36, 5, 8), i % 2 ? skin : skinD);
    seg.rotation.x = Math.PI / 2; seg.scale.set(1, 1, 0.6);
    seg.position.set(0, 0.01 * i, 0.22 + i * 0.34); tailG.add(seg);
    tz = i;
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 6), skinD);
  tip.rotation.x = -Math.PI / 2; tip.position.set(0, 0, 0.22 + 4 * 0.34); tailG.add(tip);
  // 四肢（短，带蹼）
  const legs = [];
  for (const [sx, sz, front] of [[-0.38, -0.6, 1], [0.38, -0.6, 1], [-0.38, 0.72, 0], [0.38, 0.72, 0]]) {
    const leg = new THREE.Group();
    const up = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.16, 4, 7), skinD);
    up.position.y = -0.12; leg.add(up);
    const foot = new THREE.Mesh(sph(0.11, 8, 6), skinD);
    foot.scale.set(1.1, 0.45, 1.5); foot.position.set(0, -0.24, -0.06); leg.add(foot);
    for (const cx of [-0.045, 0.045]) claw(leg, cx, -0.24, -0.16, 0.045, -0.9);
    leg.position.set(sx, 0.34, sz);
    g.add(leg); legs.push(leg);
  }
  return { group: g, legs, head, tail: tailG, phase: rng() * 6.28, face: -1 };
}

function makeSpider() {
  // 外部扫描模型优先（头朝 +Z=前进方向，原点=脚底中心）；无文件时降级程序化建模
  const si = instance('spider');
  if (si) return { group: si.wrap, legs: [], head: null, phase: rng() * 6.28, face: 1 };

  const g = new THREE.Group();
  const chitin = furMat(0x241d18, 0.55, SCALE_N), chitinD = furMat(0x151210, 0.5, SCALE_N);
  const abdomen = new THREE.Mesh(sph(0.54, 14, 10), chitin);
  abdomen.scale.set(1, 0.88, 1.3); abdomen.position.set(0, 0.86, 0.55); g.add(abdomen);
  // 腹部斑纹
  const mark = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 5), mat(0x8f2416, 0.6));
  mark.rotation.x = -Math.PI / 2 - 0.35; mark.position.set(0, 1.16, 0.5); g.add(mark);
  const mark2 = new THREE.Mesh(sph(0.12, 8, 6), mat(0x9c2c18, 0.6));
  mark2.scale.set(1.4, 0.5, 1); mark2.position.set(0, 1.2, 0.78); g.add(mark2);
  // 头胸
  const ceph = new THREE.Mesh(sph(0.33, 12, 9), chitinD);
  ceph.scale.set(1, 0.9, 1.05); ceph.position.set(0, 0.72, -0.5); g.add(ceph);
  // 螯肢（牙）
  for (const sgn of [-1, 1]) {
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 6), mat(0x0e0c0a, 0.45));
    fang.position.set(sgn * 0.1, 0.55, -0.78); fang.rotation.x = 0.5; g.add(fang);
    const palp = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.2, 4, 6), chitinD);
    palp.position.set(sgn * 0.17, 0.6, -0.7); palp.rotation.set(0.6, 0, sgn * 0.5); g.add(palp);
  }
  // 8 只眼
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.042 - k * 0.006, 7, 6),
        new THREE.MeshStandardMaterial({ color: 0xff5138, emissive: 0xff2a12, emissiveIntensity: 2.6, roughness: 0.2 }));
      const off = [[0.06, 0.06], [0.13, 0.09], [0.17, 0.02], [0.09, -0.01]][k];
      eye.position.set(s * off[0], 0.82 + off[1] * 0.6, -0.79 + k * 0.012); g.add(eye);
    }
  }
  // 8 条腿（3 关节 + 刚毛）
  const legs = [];
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const leg = new THREE.Group();
      const fem = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.058, 0.8, 6), chitin);
      fem.rotation.z = s * 0.95; fem.position.set(s * 0.34, 0.3, 0); leg.add(fem);
      const tib = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.042, 0.75, 6), chitinD);
      tib.rotation.z = s * -0.5; tib.position.set(s * 0.72, -0.05, 0); leg.add(tib);
      // 刚毛
      for (let b = 0; b < 3; b++) {
        const bristle = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.1, 3), chitinD);
        bristle.position.set(s * (0.3 + b * 0.2), 0.42 - b * 0.1, 0);
        bristle.rotation.z = s * -0.9; leg.add(bristle);
      }
      leg.position.set(s * 0.14, 0.74, -0.32 + k * 0.27);
      leg.rotation.y = (k - 1.5) * 0.42;
      g.add(leg); legs.push(leg);
    }
  }
  return { group: g, legs, head: ceph, phase: rng() * 6.28, face: -1 };
}

function makeDino() {
  // 外部 dino.glb 优先（头朝 +Z=前进方向，底部中心=原点）；缺文件时程序化迅猛龙兜底
  const di = instance('dino');
  if (di) return { group: di.wrap, legs: [], head: null, phase: rng() * 6.28, face: 1 };
  const g = new THREE.Group();
  const hide = furMat(0x3b3520, 0.82, SCALE_N), hideD = furMat(0x2a2513, 0.8, SCALE_N), hideL = furMat(0x4d4527, 0.85, SCALE_N);
  // 躯干：前倾的流线体
  const body = new THREE.Mesh(cap(0.24, 0.7, 12), hide);
  body.rotation.x = Math.PI / 2 - 0.18; body.position.set(0, 0.92, 0.1); g.add(body);
  const chest = new THREE.Mesh(sph(0.27, 12, 9), hide);
  chest.scale.set(0.92, 1.05, 1.2); chest.position.set(0, 0.98, -0.28); g.add(chest);
  // 颈（上扬）与头
  const neck = new THREE.Mesh(cap(0.11, 0.42, 9), hide);
  neck.position.set(0, 1.18, -0.52); neck.rotation.x = 0.7; g.add(neck);
  const head = new THREE.Mesh(sph(0.13, 12, 9), hideD);
  head.scale.set(0.9, 0.85, 1.35); head.position.set(0, 1.34, -0.74); g.add(head);
  const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.3, 9), hideD);
  snout.rotation.x = Math.PI / 2; snout.position.set(0, 1.32, -0.96); g.add(snout);
  const jaw = new THREE.Mesh(sph(0.06, 8, 6), hideL);
  jaw.scale.set(0.85, 0.5, 1.9); jaw.position.set(0, 1.25, -0.94); g.add(jaw);
  for (let i = 0; i < 5; i++) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.05, 4), mat(0xe8e2cc, 0.4));
    t.position.set(0.045 - i * 0.022, 1.28, -0.86 - i * 0.055); t.rotation.x = Math.PI; g.add(t);
  }
  for (const sgn of [-1, 1]) {
    const eye = eyeMesh(0.03, 0xe8c44a, 0xb07818, 1.4);
    eye.position.set(sgn * 0.085, 1.4, -0.72); g.add(eye);
  }
  // 尾：后上方渐细四段
  const tailG = new THREE.Group();
  tailG.position.set(0, 0.95, 0.42); tailG.rotation.x = -0.28; g.add(tailG);
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Mesh(cap(0.13 - i * 0.028, 0.34, 8), i % 2 ? hide : hideD);
    seg.rotation.x = Math.PI / 2; seg.position.set(0, 0.06 * i, 0.2 + i * 0.32); tailG.add(seg);
  }
  // 后腿（发达）+ 小前臂
  const legs = [];
  for (const [sx, sz] of [[-0.22, 0.14], [0.22, 0.14]]) {
    const leg = new THREE.Group();
    const thigh = new THREE.Mesh(sph(0.16, 10, 8), hide);
    thigh.scale.set(0.75, 1.35, 1.1); thigh.position.set(0, -0.18, 0.02); leg.add(thigh);
    const shin = new THREE.Mesh(cap(0.07, 0.34, 8), hideD);
    shin.position.set(0, -0.56, -0.05); leg.add(shin);
    const foot = new THREE.Mesh(sph(0.09, 8, 6), hideD);
    foot.scale.set(0.9, 0.45, 1.7); foot.position.set(0, -0.78, -0.1); leg.add(foot);
    for (const cx of [-0.04, 0.04]) claw(leg, cx, -0.8, -0.24, 0.04, -0.9);
    leg.position.set(sx, 0.82, sz);
    g.add(leg); legs.push(leg);
  }
  for (const sgn of [-1, 1]) {
    const arm = new THREE.Mesh(cap(0.035, 0.16, 6), hideD);
    arm.position.set(sgn * 0.2, 0.85, -0.4); arm.rotation.set(0.5, 0, sgn * 0.3); g.add(arm);
  }
  return { group: g, legs, head, tail: tailG, phase: rng() * 6.28, face: -1 };
}

const MAKERS = { wolf: makeWolf, bear: makeBear, croc: makeCroc, spider: makeSpider, dino: makeDino };
const SCALES = { wolf: 1.14, bear: 1.0, croc: 1.0, spider: 1.5, dino: 1.0 };

// 骨骼动画切换（mutant）：交叉淡入淡出避免跳变；once=true 单次播放（攻击挥爪）
function playBeastAnim(b, name, opts = {}) {
  if (!b.mixer || !b.actions) return;
  const next = b.actions[name];
  if (!next) return;
  next.timeScale = opts.timeScale ?? 1;
  if (b.anim === name && !opts.restart) return;
  const prev = b.actions[b.anim];
  next.reset();
  next.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat);
  next.clampWhenFinished = !!opts.once;
  if (prev && prev !== next) next.crossFadeFrom(prev, 0.22, true);
  next.play();
  b.anim = name;
}

// ---------------- 粒子（血液/水花） ----------------
const PMAX = 240;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PMAX * 3);
const pVel = new Float32Array(PMAX * 3);
const pLife = new Float32Array(PMAX);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
let pIdx = 0;
export function makeParticles(scene) {
  const m = new THREE.PointsMaterial({ color: 0x8e1a10, size: 0.14, transparent: true, opacity: 0.95 });
  const pts = new THREE.Points(pGeo, m);
  pts.frustumCulled = false;
  scene.add(pts);
  for (let i = 0; i < PMAX; i++) pPos[i * 3 + 1] = -999;
  return pts;
}
export function burst(x, y, z, n = 8, spread = 2.4, color = null, size = 0.14) {
  for (let k = 0; k < n; k++) {
    const i = pIdx = (pIdx + 1) % PMAX;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    pVel[i * 3] = (rng() - 0.5) * spread; pVel[i * 3 + 1] = rng() * spread * 0.8; pVel[i * 3 + 2] = (rng() - 0.5) * spread;
    pLife[i] = 0.6 + rng() * 0.4;
  }
}
export function updateParticles(dt) {
  for (let i = 0; i < PMAX; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt;
    pVel[i * 3 + 1] -= 9.8 * dt;
    pPos[i * 3] += pVel[i * 3] * dt;
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
    pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    if (pLife[i] <= 0) pPos[i * 3 + 1] = -999;
  }
  pGeo.attributes.position.needsUpdate = true;
}

// ---------------- 动物管理 ----------------
export class BeastManager {
  constructor(scene) {
    this.scene = scene;
    this.beasts = [];
    this.kills = 0;
    this.onSfx = null;      // (name, x, z) => void
    this.onHurt = null;     // (dmg, cause, x, z) => void 玩家受击
  }
  spawnAll() {
    for (const [type, x, z, n] of BEAST_SPAWNS) {
      for (let i = 0; i < n; i++) this.spawn(type, x + (rng() - 0.5) * 14, z + (rng() - 0.5) * 14);
    }
  }
  spawn(type, x, z) {
    const model = MAKERS[type]();
    model.group.scale.setScalar(SCALES[type]);
    this.scene.add(model.group);
    const spec = BEASTS[type];
    this.beasts.push({
      type, spec, ...model,
      x, z, y: groundHeight(x, z), yaw: rng() * 6.28,
      hp: spec.hp, maxHp: spec.hp,
      state: 'idle', stateT: rng() * 3,
      tgtX: x, tgtZ: z, animT: 0, atkCd: 0,
      homeX: x, homeZ: z, aggro: false, deadT: 0,
    });
  }
  hearNoise(x, z, loudness) { // 枪声传播
    for (const b of this.beasts) {
      if (b.state === 'dead') continue;
      if (dist2(x, z, b.x, b.z) < b.spec.hear * loudness) {
        b.aggro = true;
        if (b.state === 'idle' || b.state === 'wander') { b.state = 'alert'; b.stateT = 0.6 + rng() * 0.6; }
      }
    }
  }
  aliveCount() { return this.beasts.reduce((s, b) => s + (b.state !== 'dead' ? 1 : 0), 0); }

  hitAt(ray, dmg) { // 射线命中检测（返回命中兽或 null）
    let best = null, bestT = 1e9;
    for (const b of this.beasts) {
      if (b.state === 'dead') continue;
      const size = b.type === 'bear' ? 1.6 : b.type === 'croc' ? 1.3 : b.type === 'dino' ? 1.1 : 1.0;
      V.set(b.x, b.y + size * 0.9, b.z);
      const d = ray.distanceSqToPoint(V);
      if (d < (size * 0.85) ** 2) {
        const t = ray.origin.distanceTo(V);
        if (t < bestT) { bestT = t; best = b; }
      }
    }
    if (best) {
      best.hp -= dmg;
      best.aggro = true;
      if (best.state === 'idle' || best.state === 'wander') best.state = 'chase';
      burst(best.x, best.y + 1.0, best.z, 7, 2.2);
      if (best.hp <= 0) {
        best.state = 'dead'; best.deadT = 0;
        this.kills++;
      } else if (best.state !== 'chase' && best.state !== 'attack') best.state = 'chase';
    }
    return best;
  }

  update(dt, player, time) {
    const px = player.pos.x, pz = player.pos.z;
    for (const b of this.beasts) {
      // —— 死亡处理 ——
      if (b.state === 'dead') {
        b.deadT += dt;
        const t = Math.min(1, b.deadT * 2.2);
        b.group.rotation.z = t * Math.PI * 0.42;
        b.group.position.y = b.y - t * 0.15;
        continue;
      }
      const spec = b.spec;
      const d = dist2(px, pz, b.x, b.z);
      const inCave = b.type === 'spider';
      const sight = inCave ? 17 : (b.type === 'croc' ? 13 : 26);
      const playerNoise = player.isSneaking ? 0 : 1;

      // —— 状态机 ——
      if (!b.aggro) {
        // 视觉发现（不在洞外/洞内穿越判）
        if (d < sight && !player.dead) {
          b.aggro = true;
          b.state = 'alert'; b.stateT = 0.5 + rng() * 0.8;
          this.onSfx && this.onSfx(b.type === 'wolf' ? 'growl' : b.type === 'bear' || b.type === 'dino' ? 'roar' : b.type === 'croc' ? 'hiss' : 'skitter', b.x, b.z);
        }
      }
      switch (b.state) {
        case 'idle':
        case 'wander': {
          b.stateT -= dt;
          if (b.stateT <= 0) {
            b.state = 'wander'; b.stateT = 2 + rng() * 4;
            b.tgtX = b.homeX + (rng() - 0.5) * 30;
            b.tgtZ = b.homeZ + (rng() - 0.5) * 30;
          }
          break;
        }
        case 'alert': {
          b.stateT -= dt;
          b.yaw = Math.atan2(px - b.x, pz - b.z);
          if (b.stateT <= 0) b.state = 'chase';
          break;
        }
        case 'chase': {
          if (player.dead || d > 65) { b.aggro = false; b.state = 'wander'; b.stateT = 2; break; }
          const stop = spec.atkR * 0.85;
          if (d < spec.atkR) {
            b.state = 'attack'; b.atkCd = 0;
            // 有挥爪动画的兽（mutant）：总时长贴着动作节奏；前扑只保留原 0.34s，其余时间原地挥爪
            b.lungeT = 0.34;
            if (b.swipeDur) {
              b.stateT = Math.min(1.3, Math.max(0.34, b.swipeDur * 0.45));
              playBeastAnim(b, 'swipe', { once: true, timeScale: Math.min(2, b.swipeDur / (b.stateT + 0.4)) });
            } else {
              b.stateT = 0.34; // 前扑耗时
            }
            this.onSfx && this.onSfx(b.type === 'croc' ? 'hiss' : b.type === 'spider' ? 'skitter' : 'snap', b.x, b.z);
            break;
          }
          // 侧翼包抄偏移
          let tx = px, tz = pz;
          if (b.type === 'wolf') {
            const flank = b.flank || (b.flank = (rng() - 0.5) * 5);
            const ang = Math.atan2(b.x - px, b.z - pz) + Math.PI;
            tx = px + Math.sin(ang + 1.2) * 0 + (b.x > px ? flank : -flank) * 0.12;
          }
          const ang = Math.atan2(tx - b.x, tz - b.z);
          b.yaw = ang;
          const sp = spec.spd * (b.type === 'croc' && d > 8 ? 1.35 : 1); // 鳄鱼冲刺
          this.moveBeast(b, Math.sin(ang) * sp * dt, Math.cos(ang) * sp * dt, dt);
          break;
        }
        case 'attack': {
          b.stateT -= dt;
          // 前扑位移（仅前 0.34s；mutant 挥爪期间原地不动）
          if (b.lungeT > 0) {
            const lungeSp = spec.spd * 2.2;
            this.moveBeast(b, Math.sin(b.yaw) * lungeSp * dt, Math.cos(b.yaw) * lungeSp * dt, dt, true);
            b.lungeT -= dt;
          }
          if (b.stateT <= 0) {
            b.atkCd = spec.atkCd;
            if (dist2(px, pz, b.x, b.z) < spec.atkR + 0.6 && !player.dead) {
              this.onHurt && this.onHurt(spec.dmg, spec.name, b.x, b.z);
              if (spec.venom) player.poison(spec.venom ? 6 : 0);
            }
            b.state = 'chase';
          }
          break;
        }
      }
      if (b.atkCd > 0) b.atkCd -= dt;
      if (b.state === 'chase' && b.atkCd > 0) { /* 硬直 */ }

      // —— 动画 ——
      if (b.mixer) {
        // 骨骼动画兽（mutant）：非攻击时播 idle（追击时加速制造奔跑感），攻击已单独切入 swipe
        if (b.state !== 'attack') playBeastAnim(b, 'idle', { timeScale: b.state === 'chase' ? 2.4 : 1.1 });
        b.mixer.update(dt);
      }
      const moving = b.state === 'chase' || b.state === 'wander' || b.state === 'attack';
      b.animT += dt * (moving ? (b.state === 'chase' ? 9 : 4.5) : 1.2);
      const sw = moving ? Math.sin(b.animT * 2 + b.phase) : 0;
      b.legs.forEach((leg, i) => {
        const ph = (i % 2 === 0 ? 1 : -1) * (i < 2 ? 1 : 1);
        leg.rotation.x = sw * 0.6 * ph * (i < 2 ? 1 : -1) + (b.type === 'spider' ? Math.sin(b.animT * 2.7 + i) * 0.25 : 0);
      });
      b.group.position.set(b.x, b.y, b.z);
      // face=-1：程序化模型头朝 -Z，需补 π 才能面向移动方向；GLB 模型头朝 +Z 不用补
      b.group.rotation.y = b.yaw + (b.face < 0 ? Math.PI : 0);
      // 身体起伏（骨骼动画兽自带动作起伏，不再叠加）
      if (b.type === 'spider') b.group.position.y += Math.sin(b.animT * 3) * 0.04;
      else if (!b.mixer) b.group.position.y += Math.abs(sw) * 0.06;
    }
  }

  moveBeast(b, dx, dz, dt, ignoreBlock = false) {
    const nx = b.x + dx, nz = b.z + dz;
    // 碰撞体推出
    let cx = nx, cz = nz;
    for (const c of colliders) {
      const d = dist2(cx, cz, c.x, c.z);
      if (d < c.r + 0.5) {
        const a = Math.atan2(cx - c.x, cz - c.z);
        cx = c.x + Math.sin(a) * (c.r + 0.5);
        cz = c.z + Math.cos(a) * (c.r + 0.5);
      }
    }
    // 鳄鱼不离水域太远 / 蜘蛛不离洞
    if (b.type === 'croc' && dist2(cx, cz, 86, 52) > 55) return;
    if (b.type === 'spider' && (Math.abs(cx) > 10 || cz > -46 || cz < -176)) return;
    b.x = cx; b.z = cz;
    const gy = groundHeight(b.x, b.z, 0, b.y);
    if (!ignoreBlock) {
      const ahead = groundHeight(b.x + dx * 3, b.z + dz * 3, 0, b.y);
      if (ahead - b.y > 3.2) { b.yaw += 1.4; return; } // 陡坎绕行
    }
    b.y = gy;
  }
}
