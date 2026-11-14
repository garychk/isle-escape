// 热带雨林植被：巨树（板根+叶簇卡片）/ 棕榈 / 大叶林下植物 / 藤蔓 / 蕨 / 草 / 落叶层 / 岩石 / 倒木
import * as THREE from 'three';
import { CFG, TRAIL_W, SPAWN, RAFT, POND, SWAMP, CABIN } from './config.js';
import { mulberry32, clamp, smoothstep, dist2 } from './util.js';
import { baseHeight, terrainY, TERRAIN_SEG, inCaveCorr, trailDist } from './terrain.js';
import { barkTex, barkNormal, rockTex, grassTex, fernTex, canopyTex, palmFrondTex, bigLeafTex, vineTex, litterTex } from './textures.js';
import { instance } from './assets.js';

export const colliders = []; // {x, z, r} 圆柱碰撞体

// 外部岩石模型（rock.glb）：取几何体给 InstancedMesh 用，缺文件时返回 null（降级内置多面体）
// 兜底：把几何包围盒烘焙成"底部中心=原点"，无论 GLB 里原点在哪都成立
function rockAssetGeo() {
  try {
    const inst = instance('rock');
    if (!inst) return null;
    let g = null;
    inst.wrap.traverse((o) => { if (!g && o.isMesh && o.geometry) g = o.geometry; });
    if (!g) return null;
    g = g.clone();
    g.computeBoundingBox();
    const b = g.boundingBox;
    g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    return g;
  } catch (e) { return null; }
}

// 外部破树根（stump.glb）：几何 + 自带 PBR 贴图材质，缺文件返回 null（跳过不放置）
function stumpAsset() {
  try {
    const inst = instance('stump');
    if (!inst) return null;
    let geo = null, mat = null;
    inst.wrap.traverse((o) => {
      if (o.isMesh && o.geometry && !geo) { geo = o.geometry; mat = o.material; }
    });
    if (!geo) return null;
    geo = geo.clone();
    geo.computeBoundingBox();
    const b = geo.boundingBox;
    geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    return { geo, mat };
  } catch (e) { return null; }
}

const rng = mulberry32(20261112);
const UP = new THREE.Object3D();
const YAX = new THREE.Vector3(0, 1, 0);
const ZAX = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();

// 脚下地形的最小/最大高度：直接扫半径 r 方形范围内覆盖到的地形网格顶点。
// 地形表面是分段线性的，最低点必然落在某个网格顶点上（环上采样会漏掉顶点），
// 所以这样取到的是真正的"最低脚点"，既不会悬空也不会过度下埋。
const G_STEP = CFG.WORLD / TERRAIN_SEG, G_HALF = CFG.WORLD / 2;
function gridMinMax(x, z, r) {
  const i0 = Math.max(0, Math.floor((x - r + G_HALF) / G_STEP));
  const i1 = Math.min(TERRAIN_SEG, Math.ceil((x + r + G_HALF) / G_STEP));
  const j0 = Math.max(0, Math.floor((z - r + G_HALF) / G_STEP));
  const j1 = Math.min(TERRAIN_SEG, Math.ceil((z + r + G_HALF) / G_STEP));
  let lo = Infinity, hi = -Infinity;
  for (let j = j0; j <= j1; j++) {
    const zz = -G_HALF + j * G_STEP;
    for (let i = i0; i <= i1; i++) {
      const h = baseHeight(-G_HALF + i * G_STEP, zz);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  return [lo, hi];
}

// 脚下高差：用于剔除"骑在沟沿/崖边"的位置
// （隧道口那条被网格抹平的窄沟，边缘高差能到 30m）
function footSpan(x, z, r) {
  const [lo, hi] = gridMinMax(x, z, r);
  return hi - Math.min(lo, terrainY(x, z));
}

// 贴地基准：把物体"平底"压到裙边范围内地面最低点之下。
// 树干、石头的底面是平的，只按中心点高度摆，在坡上必然一侧翘在空中
// （裙半径 2m、坡度 0.5 就有 1m 空隙）。
function footBase(x, z, r, sink = 0.15) {
  const [lo] = gridMinMax(x, z, r);
  return Math.min(lo, terrainY(x, z)) - sink;
}

function placeOK(x, z, opts = {}) {
  const h = baseHeight(x, z);
  const r = dist2(x, z, 0, 0);
  if (r > 208 || r < 8) return false;
  if (h < 2.4 || h > 46) return false;
  if (trailDist(x, z) < (opts.nearTrail ? 1.2 : TRAIL_W + 1.2)) return false;
  if (inCaveCorr(x, z) || (Math.abs(x) < 15 && z < -40 && z > -180)) return false;
  if (dist2(x, z, SPAWN.x, SPAWN.z) < (opts.nearTrail ? 3 : 12)) return false;
  if (dist2(x, z, RAFT.x, RAFT.z) < 13) return false;
  if (dist2(x, z, CABIN.x, CABIN.z) < 17) return false; // 林中木屋空地不长树
  if (Math.abs(z + 6) < 21 && Math.abs(x) < 14) return false;
  if (Math.abs(x - 86) < 5 && z < 98 && z > 8) return false;
  const e = 1.6;
  const slope = Math.hypot(baseHeight(x + e, z) - baseHeight(x - e, z), baseHeight(x, z + e) - baseHeight(x, z - e)) / (2 * e);
  if (slope > 0.85) return false;
  // 陡坎/沟沿：脚下高差过大的位置不种（否则整棵树会骑在断面之上）
  if (opts.maxSpan && footSpan(x, z, opts.spanR || 2.4) > opts.maxSpan) return false;
  if (!opts.swampOK) {
    if (dist2(x, z, SWAMP.x, SWAMP.z) < 47) return false;
    if (dist2(x, z, POND.x, POND.z) < 34) return false;
  }
  return true;
}
function scatter(count, opts = {}) {
  const out = [];
  let tries = 0;
  while (out.length < count && tries < count * 60) {
    tries++;
    const x = (rng() * 2 - 1) * 252, z = (rng() * 2 - 1) * 252;
    if (!placeOK(x, z, opts)) continue;
    if (opts.zone && !opts.zone(x, z)) continue;
    out.push([x, z]);
  }
  return out;
}
// 让几何体边缘不规则（更像真树冠）
function jitterGeo(geo, amt = 0.12) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (rng() - 0.5) * amt * 2;
    p.setXYZ(i, x * k, y + (rng() - 0.5) * amt * 0.6, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}
// 叶簇卡片：轻微弯曲 + 穹顶法线（避免背面死黑、正面平得像纸）
function cardGeo(bend = 0.16, seg = 4) {
  const g = new THREE.PlaneGeometry(1, 1, seg, seg);
  const p = g.attributes.position;
  const nor = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, -bend * (x * x * 2 + y * y * 1.2));
    const nx = x * 0.85, ny = y * 0.7 + 0.5, nz = 1.0;
    const l = Math.hypot(nx, ny, nz);
    nor.push(nx / l, ny / l, nz / l);
  }
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
// 棕榈羽叶：从基部（原点）沿 +X 伸出并下垂
function frondGeo() {
  const g = new THREE.PlaneGeometry(1, 0.36, 10, 1);
  g.translate(0.5, 0, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = Math.max(0, p.getX(i));
    p.setY(i, p.getY(i) - x * x * 0.62);
    p.setZ(i, Math.sin(x * 2.7) * 0.05);
  }
  g.computeVertexNormals();
  return g;
}
// 几何草簇：无透明贴图，远距离不会糊成方块
function tuftGeo(blades = 8) {
  const pos = [], uv = [], nor = [], idx = [];
  let vo = 0;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * 6.283 + rng() * 0.9;
    const lean = 0.22 + rng() * 0.6;
    const h = 0.55 + rng() * 0.65;
    const w = 0.022 + rng() * 0.018;
    const dx = Math.cos(a) * lean, dz = Math.sin(a) * lean;
    const segs = 3;
    const base = vo;
    const nx = Math.cos(a + Math.PI / 2), nz = Math.sin(a + Math.PI / 2);
    for (let sg = 0; sg <= segs; sg++) {
      const t = sg / segs;
      const cx = dx * t * t, cz = dz * t * t, cy = h * t;
      const ww = w * (1 - t * 0.9);
      pos.push(cx - nx * ww, cy, cz - nz * ww);
      pos.push(cx + nx * ww, cy, cz + nz * ww);
      uv.push(0, t); uv.push(1, t);
      nor.push(nx * 0.55, 0.82, nz * 0.55);
      nor.push(nx * 0.55, 0.82, nz * 0.55);
    }
    for (let sg = 0; sg < segs; sg++) {
      const i0 = base + sg * 2;
      idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
    }
    vo += (segs + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// 巨树树干：根部外扩（板根隆起）+ 截面不规则 + 微弯
function boleGeo() {
  const g = new THREE.CylinderGeometry(0.26, 0.62, 1, 12, 10);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const x = p.getX(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const flare = 1 + Math.pow(Math.max(0, 1 - y), 7) * 1.2;          // 根部隆起
    const ripple = 1 + Math.sin(a * 7) * 0.05 + Math.sin(a * 3 + y * 5) * 0.04;
    p.setX(i, x * flare * ripple + Math.sin(y * 2.4) * 0.05 * y);
    p.setZ(i, z * flare * ripple + Math.cos(y * 1.9) * 0.04 * y);
  }
  g.computeVertexNormals();
  return g;
}

function leafMat(map, opts = {}) {
  return new THREE.MeshStandardMaterial({
    map, alphaTest: opts.alphaTest ?? 0.45, side: THREE.DoubleSide,
    roughness: 0.82, metalness: 0, transparent: false,
    color: opts.color ?? 0xffffff,
    ...opts.extra,
  });
}

export function buildFlora(scene, quality = 1) {
  const group = new THREE.Group();
  scene.add(group);
  // 树皮：不同部位用不同重复度（克隆，避免影响栈桥/木筏的贴图）
  const barkBase = barkTex();
  const bark = barkBase.clone(); bark.needsUpdate = true; bark.repeat.set(2.4, 7.5);
  const barkN = barkNormal().clone(); barkN.needsUpdate = true; barkN.repeat.set(2.4, 7.5);
  const palmBark = barkBase.clone(); palmBark.needsUpdate = true; palmBark.repeat.set(2, 3.2);
  const rockT = rockTex();
  const grassT = grassTex();
  const fernT = fernTex();
  const bigT = bigLeafTex();
  const canopyA = canopyTex(0);
  const canopyB = canopyTex(1);
  const palmT = palmFrondTex();
  const vineT = vineTex();
  const litterT = litterTex();

  const barkMat = new THREE.MeshStandardMaterial({
    map: bark, normalMap: barkN, normalScale: new THREE.Vector2(0.9, 0.9),
    color: 0xcabda5, roughness: 0.95,
  });
  const barkDark = new THREE.MeshStandardMaterial({
    map: bark, normalMap: barkN, normalScale: new THREE.Vector2(0.8, 0.8),
    color: 0x9c8f78, roughness: 0.97,
  });
  const soft = quality > 0;

  // ================= 1. 雨林巨树（板根 + 主枝 + 高层树冠） =================
  {
    const N = Math.round(340 * quality);
    // maxSpan：裙边高差超过 4.6m 就不种（≈坡度 0.88 的均匀坡是极限）。
    // 这是为了让"骑在隧道口/峡谷断面上的树"整批消失，而不是让它们沉 30m 进山里。
    const pts = scatter(N, { maxSpan: 4.6, spanR: 2.6 });
    // 树干（根部隆起、截面不规则）
    const trunk = new THREE.InstancedMesh(boleGeo(), barkMat, pts.length);
    // 板根：底部向外张开的高楔
    // 板根：半埋的椭球“鳍”，比锥体更圆润、没有平切面
    const buttGeo = new THREE.SphereGeometry(1, 10, 7);
    const butt = new THREE.InstancedMesh(buttGeo, barkDark, pts.length * 5);
    // 主枝：树干上部斜出的粗枝（树冠的支撑结构）
    const branchGeo = new THREE.CylinderGeometry(0.05, 0.2, 1, 6, 1);
    branchGeo.translate(0, 0.5, 0);
    const branch = new THREE.InstancedMesh(branchGeo, barkMat, pts.length * 3);
    // 树冠叶簇卡片
    const crownGeo = cardGeo(0.2, 4);
    const crown = new THREE.InstancedMesh(crownGeo, leafMat(canopyA, { alphaTest: 0.45 }), pts.length * 10);
    const c = new THREE.Color();
    let bi = 0, ci = 0, br = 0;
    pts.forEach(([x, z], i) => {
      const s = 0.85 + rng() * 0.75;
      const th = (15 + rng() * 9) * s;
      const lean = (rng() - 0.5) * 0.06;
      // 根部裙半径：flare(2.2) × 底半径(0.62) × 横向缩放(0.92×s) ≈ 1.26×s
      // 平底圆盘必须整圈压到地面之下，否则坡地下坡侧会翘出一条整齐的空隙
      const y = footBase(x, z, 1.26 * s, 0.2);
      UP.position.set(x, y, z);
      UP.scale.set(s * 0.92, th, s * 0.92);
      UP.rotation.set(lean, rng() * 6.28, lean * 0.8);
      UP.updateMatrix();
      trunk.setMatrixAt(i, UP.matrix);
      // 碰撞半径要盖住板根裙（最远伸到 ~2.3×s），否则人物会整个人嵌进树根里"穿树"
      colliders.push({ x, z, r: 1.6 * s });
      // 板根
      const bn = 4 + (rng() < 0.5 ? 1 : 0);
      for (let k = 0; k < bn; k++) {
        const a = (k / bn) * 6.283 + rng() * 0.4;
        const bh = 1.5 * s * (0.6 + rng() * 0.7);
        UP.position.set(x + Math.cos(a) * 0.86 * s, y + bh * 0.24, z + Math.sin(a) * 0.86 * s);
        UP.scale.set(0.62 * s, bh, 1.15 * s * (0.8 + rng() * 0.5));
        UP.rotation.set(0, -a, 0);
        UP.updateMatrix();
        butt.setMatrixAt(bi++, UP.matrix);
      }
      // 主枝：从树干中上部斜出，让树冠有真正的支撑结构
      for (let k = 0; k < 3; k++) {
        const a = rng() * 6.283;
        const tt = 0.56 + k * 0.1 + rng() * 0.06;
        const tl = 0.95 + rng() * 0.32;
        _v.set(Math.cos(a) * Math.sin(tl), Math.cos(tl), Math.sin(a) * Math.sin(tl)).normalize();
        UP.position.set(x, y + th * tt, z);
        UP.quaternion.setFromUnitVectors(YAX, _v);
        UP.scale.set(s * 0.95, (4.4 + rng() * 3.4) * s, s * 0.95);
        UP.updateMatrix();
        branch.setMatrixAt(br++, UP.matrix);
      }
      // 树冠：多张卡片围成不规则冠层
      const crownY = y + th * 0.86;
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * 6.283 + rng() * 0.8;
        const rad = (k < 4 ? 1.9 : 3.2) * s * (0.8 + rng() * 0.5);
        const cw = (6.5 + rng() * 3.5) * s;
        UP.position.set(x + Math.cos(a) * rad, crownY + (rng() - 0.3) * 2.2 * s, z + Math.sin(a) * rad);
        UP.scale.set(cw, cw * (0.62 + rng() * 0.22), cw);
        UP.rotation.set((rng() - 0.5) * 0.7, rng() * 6.283, (rng() - 0.5) * 0.5);
        UP.updateMatrix();
        crown.setMatrixAt(ci, UP.matrix);
        c.setHSL(0.255 + rng() * 0.055, 0.07 + rng() * 0.13, 0.80 + rng() * 0.18);
        crown.setColorAt(ci, c); ci++;
      }
      // 冠顶：近水平的大叶片，把天空遮起来（雨林封闭冠层）
      for (let k = 0; k < 3; k++) {
        const a = rng() * 6.283;
        const rad = (2.6 + rng() * 4.5) * s;
        const cw = (11 + rng() * 6) * s;
        UP.position.set(x + Math.cos(a) * rad, crownY + (2.2 + rng() * 3.4) * s, z + Math.sin(a) * rad);
        UP.scale.set(cw, cw, cw);
        UP.rotation.set(-Math.PI / 2 + (rng() - 0.5) * 0.5, rng() * 6.283, (rng() - 0.5) * 0.4);
        UP.updateMatrix();
        crown.setMatrixAt(ci, UP.matrix);
        c.setHSL(0.25 + rng() * 0.05, 0.06 + rng() * 0.11, 0.58 + rng() * 0.16);
        crown.setColorAt(ci, c); ci++;
      }
    });
    trunk.castShadow = soft;
    butt.castShadow = soft;
    branch.castShadow = soft;
    crown.castShadow = soft;
    crown.receiveShadow = false;
    group.add(trunk, butt, branch, crown);
  }

  // ================= 2. 棕榈（弯曲树干 + 羽状叶冠） =================
  {
    const N = Math.round(200 * quality);
    const pts = scatter(N - 40);
    // 靠海与沼泽边上更密
    const extra = scatter(40, { nearTrail: true, swampOK: true, zone: (x, z) => dist2(x, z, 0, 0) > 150 });
    const all = [...pts, ...extra];
    const SEG = 7;
    const segGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 7);
    segGeo.translate(0, 0.5, 0);
    const segs = new THREE.InstancedMesh(segGeo, new THREE.MeshStandardMaterial({ map: palmBark, normalMap: barkN, normalScale: new THREE.Vector2(0.6, 0.6), color: 0xbdb096, roughness: 0.96 }), all.length * SEG);
    const fg = frondGeo();
    const fronds = new THREE.InstancedMesh(fg, leafMat(palmT, { alphaTest: 0.3 }), all.length * 11);
    const c = new THREE.Color();
    let si = 0, fi = 0;
    const qy = new THREE.Quaternion(), qz = new THREE.Quaternion();
    all.forEach(([x, z]) => {
      const s = 0.8 + rng() * 0.6;
      const H = (7 + rng() * 5) * s;
      const y = footBase(x, z, 0.45 * s, 0.1);   // 棕榈底径细，小范围取最低点即可
      const la = rng() * 6.283;
      const bendAmt = (0.6 + rng() * 1.6) * s;
      // 沿曲线堆叠 7 段
      let px = x, py = y, pz = z;
      for (let k = 0; k < SEG; k++) {
        const t0 = k / SEG, t1 = (k + 1) / SEG;
        const x0 = x + Math.cos(la) * bendAmt * t0 * t0, z0 = z + Math.sin(la) * bendAmt * t0 * t0;
        const x1 = x + Math.cos(la) * bendAmt * t1 * t1, z1 = z + Math.sin(la) * bendAmt * t1 * t1;
        const y0 = y + H * t0, y1 = y + H * t1;
        const dir = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0);
        const len = dir.length(); dir.normalize();
        UP.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        UP.quaternion.setFromUnitVectors(YAX, dir);
        UP.scale.set(s * (1 - t0 * 0.35), len * 1.06, s * (1 - t0 * 0.35));
        UP.updateMatrix();
        segs.setMatrixAt(si++, UP.matrix);
        px = x1; py = y1; pz = z1;
      }
      colliders.push({ x, z, r: 0.4 * s });
      // 叶冠
      const nf = 9 + Math.floor(rng() * 3);
      for (let k = 0; k < nf; k++) {
        const yaw = (k / nf) * 6.283 + rng() * 0.3;
        const droop = 0.15 + rng() * 0.75;
        qy.setFromAxisAngle(YAX, yaw);
        qz.setFromAxisAngle(ZAX, -droop);
        UP.position.set(px, py - 0.05, pz);
        UP.quaternion.copy(qy).multiply(qz);
        const L = (3.4 + rng() * 1.6) * s;
        UP.scale.set(L, L, L);
        UP.updateMatrix();
        fronds.setMatrixAt(fi, UP.matrix);
        c.setHSL(0.24 + rng() * 0.05, 0.20 + rng() * 0.16, 0.80 + rng() * 0.20);
        fronds.setColorAt(fi, c); fi++;
      }
    });
    segs.castShadow = soft;
    fronds.castShadow = soft;
    group.add(segs, fronds);
  }

  // ================= 3. 林下大叶植物（芭蕉/龟背竹） =================
  {
    const pts = scatter(Math.round(1600 * quality), { nearTrail: true });
    const quad = new THREE.PlaneGeometry(1.55, 1.35);
    quad.translate(0, 0.62, 0);
    const g1 = mergeCross(quad);
    const mat = leafMat(bigT, { alphaTest: 0.48 });
    const mesh = new THREE.InstancedMesh(g1, mat, pts.length);
    const c = new THREE.Color();
    pts.forEach(([x, z], i) => {
      const y = terrainY(x, z);
      const s = 0.7 + rng() * 1.15;
      UP.position.set(x, y - 0.06, z);
      UP.scale.set(s, s * (0.85 + rng() * 0.5), s);
      UP.rotation.set(0, rng() * 6.283, 0);
      UP.updateMatrix();
      mesh.setMatrixAt(i, UP.matrix);
      c.setHSL(0.25 + rng() * 0.05, 0.16 + rng() * 0.16, 0.84 + rng() * 0.16);
      mesh.setColorAt(i, c);
    });
    mesh.castShadow = false;
    group.add(mesh);
  }

  // ================= 4. 灌木（矮叶簇） =================
  {
    const pts = scatter(Math.round(760 * quality));
    const geo = cardGeo(0.22, 3);
    const mesh = new THREE.InstancedMesh(geo, leafMat(canopyB, { alphaTest: 0.45 }), pts.length * 2);
    const c = new THREE.Color();
    let i2 = 0;
    pts.forEach(([x, z]) => {
      const y = terrainY(x, z);
      const s = (1.1 + rng() * 1.5);
      for (let k = 0; k < 2; k++) {
        UP.position.set(x + (rng() - 0.5) * 0.8, y + s * 0.42, z + (rng() - 0.5) * 0.8);
        UP.scale.set(s, s * 0.8, s);
        UP.rotation.set((rng() - 0.5) * 0.4, rng() * 6.283, (rng() - 0.5) * 0.3);
        UP.updateMatrix();
        mesh.setMatrixAt(i2, UP.matrix);
        c.setHSL(0.25 + rng() * 0.06, 0.16 + rng() * 0.16, 0.80 + rng() * 0.20);
        mesh.setColorAt(i2, c); i2++;
      }
    });
    group.add(mesh);
  }

  // ================= 5. 蕨类 =================
  {
    const pts = [...scatter(Math.round(950 * quality), { nearTrail: true }), ...scatter(Math.round(180 * quality), { swampOK: true, zone: (x, z) => dist2(x, z, SWAMP.x, SWAMP.z) < 48 })];
    const quad = new THREE.PlaneGeometry(1.5, 1.05);
    quad.translate(0, 0.52, 0);
    const geo = mergeCross(quad);
    const mat = leafMat(fernT, { alphaTest: 0.45, extra: { emissive: 0x121c0c, emissiveIntensity: 0.18 } });
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
    const c = new THREE.Color();
    pts.forEach(([x, z], i) => {
      const y = terrainY(x, z);
      const s = 0.55 + rng() * 0.75;
      UP.position.set(x, y - 0.05, z);
      UP.scale.set(s, s * (0.85 + rng() * 0.5), s);
      UP.rotation.set(0, rng() * 6.28, 0);
      UP.updateMatrix();
      mesh.setMatrixAt(i, UP.matrix);
      c.setHSL(0.26 + rng() * 0.05, 0.16 + rng() * 0.16, 0.82 + rng() * 0.18);
      mesh.setColorAt(i, c);
    });
    group.add(mesh);
  }

  // ================= 6. 草丛（几何簇） =================
  {
    const pts = scatter(Math.round(7200 * quality), { nearTrail: true });
    const geo = tuftGeo(10);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
    const c = new THREE.Color();
    pts.forEach(([x, z], i) => {
      const y = terrainY(x, z);
      const s = 0.30 + rng() * 0.42;
      UP.position.set(x, y - 0.03, z);
      UP.scale.set(s * (0.8 + rng() * 0.5), s * (0.7 + rng() * 0.8), s * (0.8 + rng() * 0.5));
      UP.rotation.set(0, rng() * 6.28, 0);
      UP.updateMatrix();
      mesh.setMatrixAt(i, UP.matrix);
      c.setHSL(0.21 + rng() * 0.08, 0.30 + rng() * 0.20, 0.17 + rng() * 0.12);
      mesh.setColorAt(i, c);
    });
    mesh.castShadow = false;
    group.add(mesh);
  }

  // ================= 7. 垂挂藤蔓 =================
  {
    const quad = new THREE.PlaneGeometry(0.9, 5.2);
    quad.translate(0, -2.6, 0);   // 从上方垂下
    const geo = mergeCross(quad);
    const mat = leafMat(vineT, { alphaTest: 0.45 });
    const n = Math.round(520 * quality);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const c = new THREE.Color();
    let i = 0;
    for (let tries = 0; tries < 4000 && i < n; tries++) {
      const x = (rng() * 2 - 1) * 210, z = (rng() * 2 - 1) * 210;
      if (!placeOK(x, z, { nearTrail: true })) continue;
      const y = baseHeight(x, z) + 7 + rng() * 11;
      const s = 0.7 + rng() * 0.8;
      UP.position.set(x, y, z);
      UP.scale.set(s * (0.8 + rng() * 0.6), s * (0.7 + rng() * 0.9), s);
      UP.rotation.set(0, rng() * 6.28, (rng() - 0.5) * 0.12);
      UP.updateMatrix();
      mesh.setMatrixAt(i, UP.matrix);
      c.setHSL(0.26 + rng() * 0.05, 0.16 + rng() * 0.16, 0.80 + rng() * 0.20);
      mesh.setColorAt(i, c); i++;
    }
    mesh.count = i;
    group.add(mesh);
  }

  // ================= 8. 地面落叶层 =================
  {
    const pts = scatter(Math.round(3400 * quality), { nearTrail: true });
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      map: litterT, alphaTest: 0.32, transparent: true, side: THREE.DoubleSide,
      roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
    const c = new THREE.Color();
    pts.forEach(([x, z], i) => {
      const y = terrainY(x, z);
      const s = 0.6 + rng() * 1.5;
      UP.position.set(x, y + 0.035, z);
      UP.scale.set(s, 1, s * (0.8 + rng() * 0.5));
      UP.rotation.set(0, rng() * 6.28, 0);
      UP.updateMatrix();
      mesh.setMatrixAt(i, UP.matrix);
      c.setHSL(0.09 + rng() * 0.06, 0.20 + rng() * 0.16, 0.66 + rng() * 0.22);
      mesh.setColorAt(i, c);
    });
    group.add(mesh);
  }

  // ================= 9. 岩石 =================
  {
    const pts = scatter(Math.round(150 * quality));
    const extGeo = rockAssetGeo(); // rock.glb：原点=底部中心，高≈0.6×宽
    const geo = extGeo || jitterGeo(new THREE.DodecahedronGeometry(1, 0), 0.18);
    const mesh = new THREE.InstancedMesh(geo,
      new THREE.MeshStandardMaterial({ map: rockT, color: 0xffffff, roughness: 0.95 }), pts.length);
    const c = new THREE.Color();
    pts.forEach(([x, z], i) => {
      const s = 0.5 + rng() * 2.2;
      // GLB 石块的原点已烘到"底部中心"，底面是平的：
      // ① 位置按裙边最低点落（坡上不会一侧翘起）② 翻滚角收紧到 ±0.3rad，
      // 原来的 ±3rad 会把平底直接翻到朝天，石头就半沉或悬在半空。
      if (extGeo) {
        const y = footBase(x, z, s * 0.8, 0.15 * s);
        UP.position.set(x, y, z);
        UP.scale.set(s, s * (0.8 + rng() * 0.35), s * (0.85 + rng() * 0.3));
        UP.rotation.set((rng() - 0.5) * 0.6, rng() * 6.28, (rng() - 0.5) * 0.6);
      } else {
        const y = terrainY(x, z);
        UP.position.set(x, y + s * 0.18, z);
        UP.scale.set(s, s * (0.6 + rng() * 0.5), s);
        UP.rotation.set(rng() * 3, rng() * 6.28, rng() * 3);
      }
      UP.updateMatrix();
      mesh.setMatrixAt(i, UP.matrix);
      c.setHSL(0.08 + rng() * 0.04, 0.06 + rng() * 0.05, 0.40 + rng() * 0.18);
      mesh.setColorAt(i, c);
      colliders.push({ x, z, r: s * 0.82 });   // 小块石头也挡人（1m 宽的石头能穿人很假）
    });
    mesh.castShadow = soft;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ================= 10. 倒木 =================
  {
    const pts = scatter(Math.round(46 * quality), { nearTrail: true });
    // 几何已沿 +X 躺倒，长度轴就是局部 X
    const geo = new THREE.CylinderGeometry(0.36, 0.5, 1, 9, 1);
    geo.rotateZ(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: bark, normalMap: barkN, normalScale: new THREE.Vector2(0.7, 0.7), color: 0x8d7f66, roughness: 1 }), pts.length);
    pts.forEach(([x, z], i) => {
      const L = 3 + rng() * 4.5;
      const yaw = rng() * 6.28, tilt = (rng() - 0.5) * 0.08;
      // 3~7.5m 的长条：两端各取一次地面高度，按低的一端落，坡上才不会一头翘起
      const hx = Math.cos(yaw) * L * 0.5, hz = -Math.sin(yaw) * L * 0.5;
      const y = Math.min(terrainY(x + hx, z + hz), terrainY(x - hx, z - hz), terrainY(x, z)) + 0.36;
      UP.position.set(x, y, z);
      UP.scale.set(L, 1, 1);
      UP.rotation.set(0, yaw, tilt);
      UP.updateMatrix();
      mesh.setMatrixAt(i, UP.matrix);
      // 倒木是 3~7.5m 的长条：沿轴摆一串小圆，两端才挡得住（单个圆只盖中间）
      const la = UP.rotation.y, n = Math.max(2, Math.ceil(L / 1.0));
      for (let k = 0; k < n; k++) {
        const t = (n === 1 ? 0 : (k / (n - 1) - 0.5)) * (L - 0.9);
        colliders.push({ x: x + Math.cos(la) * t, z: z - Math.sin(la) * t, r: 0.62 });
      }
    });
    mesh.castShadow = soft;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ================= 11. 破树根（断桩） =================
  {
    const sa = stumpAsset();
    if (sa) {
      const pts = scatter(Math.round(34 * quality), { nearTrail: true });
      const mesh = new THREE.InstancedMesh(sa.geo, sa.mat, pts.length);
      pts.forEach(([x, z], i) => {
        const s = 0.65 + rng() * 1.05;
        const y = footBase(x, z, 0.9 * s, 0.05);   // 根须按裙边最低点落位，坡上不会半边悬空
        UP.position.set(x, y, z);
        UP.scale.set(s, s * (0.9 + rng() * 0.3), s);
        UP.rotation.set((rng() - 0.5) * 0.1, rng() * 6.28, (rng() - 0.5) * 0.1);
        UP.updateMatrix();
        mesh.setMatrixAt(i, UP.matrix);
        colliders.push({ x, z, r: s * 0.85 });   // 小断桩也挡人（最宽 2.2×0.65≈1.4m，穿过去很假）
      });
      mesh.castShadow = soft;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  buildSwamp(group, bark, soft);
  buildBeachProps(group, bark, rockT, grassT);
}

// ---------- 沼泽区：枯树 + 芦苇 + 藻斑 ----------
function buildSwamp(group, bark, soft) {
  const pts = scatter(Math.round(52), { swampOK: true, zone: (x, z) => { const d = dist2(x, z, SWAMP.x, SWAMP.z); return d < 46 && d > 16; } });
  const deadMat = new THREE.MeshStandardMaterial({ map: bark, color: 0x8c8474, roughness: 1 });
  for (const [x, z] of pts) {
    const y = footBase(x, z, 0.45, 0.12);   // 枯树干也是平底，按裙边最低点埋
    const g0 = new THREE.Group();
    const h = 4.5 + rng() * 3.5;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.36, h, 6), deadMat);
    trunk.position.y = h / 2; g0.add(trunk);
    for (let k = 0; k < 3; k++) {
      const bl = 1.4 + rng() * 1.8;
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.1, bl, 5), deadMat);
      const a = rng() * 6.28;
      br.position.set(Math.sin(a) * bl * 0.35, h * (0.5 + rng() * 0.4), Math.cos(a) * bl * 0.35);
      br.rotation.set(Math.cos(a) * 0.9, a, Math.sin(a) * 0.9);
      g0.add(br);
    }
    g0.position.set(x, y, z);
    g0.rotation.set((rng() - 0.5) * 0.14, rng() * 6.28, (rng() - 0.5) * 0.14);
    g0.castShadow = soft;
    group.add(g0);
    colliders.push({ x, z, r: 0.4 });
  }
  // 芦苇
  const reedGeo = new THREE.ConeGeometry(0.06, 1.9, 4);
  reedGeo.translate(0, 0.95, 0);
  const reeds = new THREE.InstancedMesh(reedGeo,
    new THREE.MeshStandardMaterial({ color: 0x6f7d3e, roughness: 1 }), 280);
  let ri = 0;
  for (let i = 0; i < 320 && ri < 280; i++) {
    const a = rng() * 6.283, rr = 18 + rng() * 30;
    const x = SWAMP.x + Math.cos(a) * rr, z = SWAMP.z + Math.sin(a) * rr;
    if (Math.abs(x - 86) < 3) continue;
    const y = terrainY(x, z);
    if (y > CFG.SWAMP_Y + 0.7) continue;
    const s = 0.7 + rng() * 0.9;
    UP.position.set(x, y, z); UP.scale.set(s, s * (0.8 + rng() * 0.9), s);
    UP.rotation.set((rng() - 0.5) * 0.3, rng() * 6.28, (rng() - 0.5) * 0.3); UP.updateMatrix();
    reeds.setMatrixAt(ri++, UP.matrix);
  }
  reeds.count = ri;
  group.add(reeds);
  // 藻斑
  const algaeGeo = new THREE.CircleGeometry(1, 9);
  const algae = new THREE.InstancedMesh(algaeGeo,
    new THREE.MeshStandardMaterial({ color: 0x63722f, roughness: 1, transparent: true, opacity: 0.55 }), 66);
  let ai = 0;
  for (let i = 0; i < 130 && ai < 66; i++) {
    const a = rng() * 6.283, rr = 6 + rng() * 34;
    const x = SWAMP.x + Math.cos(a) * rr, z = SWAMP.z + Math.sin(a) * rr;
    if (Math.abs(x - 86) < 2.2) continue;
    UP.position.set(x, CFG.SWAMP_Y + 0.03, z);
    const s = 1 + rng() * 3.4;
    UP.scale.set(s, s * (0.6 + rng() * 0.5), s);
    UP.rotation.set(-Math.PI / 2, 0, rng() * 6.28); UP.updateMatrix();
    algae.setMatrixAt(ai++, UP.matrix);
  }
  algae.count = ai;
  group.add(algae);
}

// ---------- 海滩杂物（浮木 / 卵石 / 滨草） ----------
function buildBeachProps(parent, bark, rockT, grassT) {
  const group = parent;
  const drift = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.16, 0.24, 1, 6).rotateZ(Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: bark, color: 0xb0a084, roughness: 1 }), 70);
  const pebGeo = rockAssetGeo();
  const pebble = new THREE.InstancedMesh(
    pebGeo || new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ map: rockT, color: 0xc8c0b0, roughness: 0.95 }), 90);
  const beachGrass = new THREE.InstancedMesh(
    mergeCross((() => { const q = new THREE.PlaneGeometry(1.0, 0.8); q.translate(0, 0.4, 0); return q; })()),
    leafMat(grassT, { alphaTest: 0.3 }), 320);
  const c = new THREE.Color();
  let di = 0, pi = 0, gi = 0;
  for (let i = 0; i < 2600 && (di < 70 || pi < 90 || gi < 320); i++) {
    const a = rng() * 6.283, rr = 188 + rng() * 40;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const h = terrainY(x, z);   // 沙滩杂物同样按渲染网格落位
    if (h < 1.0 || h > 3.6) continue;
    if (trailDist(x, z) < 4) continue;
    if (dist2(x, z, SPAWN.x, SPAWN.z) < 10 || dist2(x, z, RAFT.x, RAFT.z) < 12) continue;
    const pick = rng();
    if (pick < 0.22 && di < 70) {
      const L = 1.4 + rng() * 3.4;
      const yaw = rng() * 6.28, tilt = (rng() - 0.5) * 0.12;
      // 浮木是躺倒的长条：两端各取一次地面高度，按低的一端落位，免得起翘
      const hx = Math.cos(yaw) * L * 0.5, hz = -Math.sin(yaw) * L * 0.5;
      const y0 = Math.min(terrainY(x + hx, z + hz), terrainY(x - hx, z - hz), terrainY(x, z));
      UP.position.set(x, y0 + 0.16, z);
      UP.scale.set(L, 1, 1);
      UP.rotation.set(0, yaw, tilt);
      UP.updateMatrix();
      drift.setMatrixAt(di++, UP.matrix);
    } else if (pick < 0.5 && pi < 90) {
      const s = 0.1 + rng() * 0.34;
      if (pebGeo) { UP.position.set(x, h - s * 0.15, z); UP.scale.set(s, s * (0.8 + rng() * 0.3), s); }
      else { UP.position.set(x, h + s * 0.3, z); UP.scale.set(s, s * 0.7, s); }
      UP.rotation.set(rng() * 3, rng() * 6, rng() * 3); UP.updateMatrix();
      pebble.setMatrixAt(pi++, UP.matrix);
    } else if (gi < 320) {
      const s = 0.5 + rng() * 0.6;
      UP.position.set(x, h - 0.02, z); UP.scale.set(s, s * 0.9, s);
      UP.rotation.set(0, rng() * 6.28, 0); UP.updateMatrix();
      c.setHSL(0.19 + rng() * 0.06, 0.28 + rng() * 0.16, 0.40 + rng() * 0.14);
      beachGrass.setMatrixAt(gi, UP.matrix); beachGrass.setColorAt(gi, c);
    }
  }
  drift.count = di; pebble.count = pi; beachGrass.count = gi;
  pebble.receiveShadow = true;
  group.add(drift, pebble, beachGrass);
}

// 两个正交交叉面片合并（手动写 normal，否则合并后全黑）
function mergeCross(quad) {
  const g = new THREE.BufferGeometry();
  const g1 = quad.clone(), g2 = quad.clone();
  g2.rotateY(Math.PI / 2);
  const pos = [], uv = [], idx = [], nor = [];
  let vo = 0;
  for (const src of [g1, g2]) {
    const p = src.attributes.position, u = src.attributes.uv, ix = src.index;
    const nx = Math.abs(src.attributes.normal.getX(0)) > 0.5 ? 1 : 0;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      uv.push(u.getX(i), u.getY(i));
      // 略向上偏，模拟叶片受天光
      nor.push(nx * 0.55, 0.62, nx ? 0 : 0.55);
    }
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + vo);
    vo += p.count;
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
