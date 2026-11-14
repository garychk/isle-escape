// 野兽：程序化建模（狼/棕熊/沼泽鳄/巨蛛）+ AI 状态机 + 血液粒子
import * as THREE from 'three';
import { BEASTS, BEAST_SPAWNS } from './config.js';
import { mulberry32, clamp, dist2, pushOutCircles } from './util.js';
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
  // 外部 wolf.glb 优先（行尸：人形 Prisoner，含 idle/walk 骨骼动画，头朝 +Z=前进方向）
  // 缺文件时程序化林狼兜底
  const wi = instance('wolf');
  if (wi) {
    const mixer = new THREE.AnimationMixer(wi.wrap);
    const byName = (re, fb) => wi.animations.find(c => re.test(c.name)) || wi.animations[fb] || null;
    const idleClip = byName(/^idle/i, 0);
    const walkClip = byName(/^walk/i, 1);
    const actions = {};
    if (idleClip) { actions.idle = mixer.clipAction(idleClip); actions.idle.play(); }
    if (walkClip) actions.walk = mixer.clipAction(walkClip);
    return {
      group: wi.wrap, legs: [], head: null, phase: rng() * 6.28, face: 1,
      mixer, actions, anim: 'idle', swipeDur: null,
      // 原生步速（m/s，已按身高归一折算）：1 倍速播放时脚掌正好贴地不打滑
      // 原生步速（m/s，实测：支撑相脚掌相对根节点的后移速度）——1 倍速播放时脚掌正好贴地
      walkSpeed: 1.30,
    };
  }
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
    const walkClip = byName(/^walk/i, 1);
    const swipeClip = byName(/^swip/i, 2);
    const actions = {};
    if (idleClip) { actions.idle = mixer.clipAction(idleClip); actions.idle.play(); }
    if (walkClip) { actions.walk = mixer.clipAction(walkClip); }
    if (swipeClip) { actions.swipe = mixer.clipAction(swipeClip); }
    return {
      group: mi.wrap, legs: [], head: null, phase: rng() * 6.28, face: 1,
      mixer, actions, anim: 'idle',
      swipeDur: swipeClip ? swipeClip.duration : 1.0,
      walkSpeed: 1.60, // 原生步速（m/s，实测支撑相脚速）：1 倍速时脚掌正好贴地
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

function makeDino() {
  // 外部 dino.glb 优先（变异暴徒：双足驼背巨怪，含 idle/walk/swipe 三段骨骼动画）
  // 头朝 +Z = 野兽前进方向（face:1）；缺文件时程序化迅猛龙兜底
  const di = instance('dino');
  if (di) {
    const mixer = new THREE.AnimationMixer(di.wrap);
    const byName = (re, fb) => di.animations.find(c => re.test(c.name)) || di.animations[fb] || null;
    const idleClip = byName(/^idle/i, 0);
    const walkClip = byName(/^walk/i, 1);
    const swipeClip = byName(/^swip/i, 2);
    const actions = {};
    if (idleClip) { actions.idle = mixer.clipAction(idleClip); actions.idle.play(); }
    if (walkClip) actions.walk = mixer.clipAction(walkClip);
    if (swipeClip) actions.swipe = mixer.clipAction(swipeClip);
    return {
      group: di.wrap, legs: [], head: null, phase: rng() * 6.28, face: 1,
      mixer, actions, anim: 'idle',
      swipeDur: swipeClip ? swipeClip.duration : 1.0,
      // 原生步速（m/s，实测支撑相脚速）：1 倍速时脚掌正好贴地不打滑
      walkSpeed: 1.40,
    };
  }
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

function makeZombie() {
  // 外部 zombie.glb 优先（洞窟僵尸：兜帽平民+狼牙棒，含 idle/walk/swipe 三段骨骼动画）
  // 头朝 +Z = 野兽前进方向（face:1）；缺文件时程序化简版僵尸兜底
  const zi = instance('zombie');
  if (zi) {
    const mixer = new THREE.AnimationMixer(zi.wrap);
    const byName = (re, fb) => zi.animations.find(c => re.test(c.name)) || zi.animations[fb] || null;
    const idleClip = byName(/^idle/i, 0);
    const walkClip = byName(/^walk/i, 1);
    const swipeClip = byName(/^swip/i, 2);
    const actions = {};
    if (idleClip) { actions.idle = mixer.clipAction(idleClip); actions.idle.play(); }
    if (walkClip) actions.walk = mixer.clipAction(walkClip);
    if (swipeClip) actions.swipe = mixer.clipAction(swipeClip);
    return {
      group: zi.wrap, legs: [], head: null, phase: rng() * 6.28, face: 1,
      mixer, actions, anim: 'idle',
      swipeDur: swipeClip ? swipeClip.duration : 1.0,
      // 丧尸踱步的原生步速（慢速小步）：spd 0.8 → 播放速率 ~1.14，拖沓踉跄正好
      walkSpeed: 0.70,
    };
  }
  // 兜底：程序化简版僵尸（矮小人形，双臂前伸）
  const g = new THREE.Group();
  const skin = furMat(0x6f7d4a, 0.85, SCALE_N), cloth = furMat(0x33302a, 0.9, SCALE_N);
  const torso = new THREE.Mesh(cap(0.16, 0.42, 10), cloth); torso.position.y = 0.86; g.add(torso);
  const headM = new THREE.Mesh(sph(0.12, 10, 8), skin); headM.position.y = 1.24; g.add(headM);
  const legs = [];
  for (const sx of [-0.09, 0.09]) {
    const leg = new THREE.Group();
    const thigh = new THREE.Mesh(cap(0.055, 0.3, 7), cloth); thigh.position.y = -0.18; leg.add(thigh);
    const shin = new THREE.Mesh(cap(0.045, 0.28, 7), skin); shin.position.y = -0.55; leg.add(shin);
    leg.position.set(sx, 0.72, 0); g.add(leg); legs.push(leg);
  }
  for (const sx of [-0.2, 0.2]) {
    const arm = new THREE.Mesh(cap(0.04, 0.34, 7), skin);
    arm.position.set(sx, 1.02, 0.08); arm.rotation.x = -1.2; g.add(arm); // 僵尸前伸手
  }
  return { group: g, legs, head: headM, phase: rng() * 6.28, face: -1 };
}

const MAKERS = { wolf: makeWolf, bear: makeBear, dino: makeDino, zombie: makeZombie };
const SCALES = { wolf: 1.0, bear: 1.0, dino: 1.0, zombie: 1.0 };

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
      // 每只的步速微差（0.88–1.12）：一群行尸不会齐步走，各自节奏略有不同更像活物
      spdMul: 0.88 + rng() * 0.24,
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
      const size = b.type === 'bear' ? 1.6 : b.type === 'dino' ? 1.1 : 1.0;
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
      const sight = 26;
      const playerNoise = player.isSneaking ? 0 : 1;

      // —— 状态机 ——
      if (!b.aggro) {
        // 视觉发现（不在洞外/洞内穿越判）
        if (d < sight && !player.dead) {
          b.aggro = true;
          b.state = 'alert'; b.stateT = 0.5 + rng() * 0.8;
          this.onSfx && this.onSfx(b.type === 'wolf' ? 'growl' : 'roar', b.x, b.z);
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
            this.onSfx && this.onSfx('snap', b.x, b.z);
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
          const sp = spec.spd * (b.spdMul || 1);
          b.moveSpd = sp;   // 实际位移速度 → 动画播放速率按它匹配（见下方"动画"段）
          this.moveBeast(b, Math.sin(ang) * sp * dt, Math.cos(ang) * sp * dt, dt);
          break;
        }
        case 'attack': {
          b.stateT -= dt;
          // 前扑位移（仅前 0.34s；有挥爪动画的兽挥爪期间基本原地，靠小步前压）
          if (b.lungeT > 0) {
            // 挥爪前压：只有 0.34s、一小步的距离，不靠这段位移抢速度
            const lungeSp = spec.spd * (b.spdMul || 1) * (b.mixer ? 1.5 : 2.2);
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
        // 骨骼动画兽：攻击播 swipe（进入攻击时已单次切入）
        // 追击播 walk，播放速率 = 实际移动速度 ÷ 动画原生步速 —— 脚掌正好踩实地面。
        // 关键：播放速率上限压到 1.4 倍。超过这个值，走路的节奏就被"快放"了：
        // 腿摆得飞快、身体却只是平移，一眼假。宁可让它慢慢走过来，也不加快帧数。
        if (b.state !== 'attack') {
          if (b.actions.walk && b.state === 'chase') {
            const mv = b.moveSpd || spec.spd;
            const ts = Math.min(1.4, Math.max(0.6, mv / (b.walkSpeed || 1.3)));
            playBeastAnim(b, 'walk', { timeScale: ts });
          } else {
            playBeastAnim(b, 'idle', { timeScale: 1.0 });
          }
        }
        b.mixer.update(dt);
      }
      const moving = b.state === 'chase' || b.state === 'wander' || b.state === 'attack';
      b.animT += dt * (moving ? (b.state === 'chase' ? 9 : 4.5) : 1.2);
      const sw = moving ? Math.sin(b.animT * 2 + b.phase) : 0;
      b.legs.forEach((leg, i) => {
        const ph = (i % 2 === 0 ? 1 : -1) * (i < 2 ? 1 : 1);
        leg.rotation.x = sw * 0.6 * ph * (i < 2 ? 1 : -1);
      });
      b.group.position.set(b.x, b.y, b.z);
      // face=-1：程序化模型头朝 -Z，需补 π 才能面向移动方向；GLB 模型头朝 +Z 不用补
      b.group.rotation.y = b.yaw + (b.face < 0 ? Math.PI : 0);
      // 身体起伏（骨骼动画兽自带动作起伏，不再叠加）
      if (!b.mixer) b.group.position.y += Math.abs(sw) * 0.06;
    }
  }

  moveBeast(b, dx, dz, dt, ignoreBlock = false) {
    const nx = b.x + dx, nz = b.z + dz;
    // 碰撞体推出（深者优先，防挤压甩穿）
    const pushed = pushOutCircles(nx, nz, 0.5, colliders);
    let cx = pushed ? pushed[0] : nx, cz = pushed ? pushed[1] : nz;
    b.x = cx; b.z = cz;
    const gy = groundHeight(b.x, b.z, 0, b.y);
    if (!ignoreBlock) {
      const ahead = groundHeight(b.x + dx * 3, b.z + dz * 3, 0, b.y);
      if (ahead - b.y > 3.2) { b.yaw += 1.4; return; } // 陡坎绕行
    }
    b.y = gy;
  }
}
