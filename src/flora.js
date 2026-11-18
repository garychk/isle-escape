// 热带雨林植被：巨树（板根+叶簇卡片）/ 棕榈 / 椰子树（海岸） / 橡胶树（成簇） / 羽叶乔木（伞冠）
//   / 大叶林下植物 / 藤蔓 / 蕨 / 草 / 落叶层 / 岩石 / 倒木
import * as THREE from 'three';
import { CFG, TRAIL_W, SPAWN, RAFT, POND, SWAMP, CABIN } from './config.js';
import { mulberry32, clamp, smoothstep, dist2 } from './util.js';
import { baseHeight, terrainY, TERRAIN_SEG, inCaveCorr, trailDist } from './terrain.js';
import { barkTex, barkNormal, rockTex, grassTex, fernTex, canopyTex, palmFrondTex, bigLeafTex, vineTex, litterTex, coconutBarkTex, rubberBarkTex, treeATex, treeBTex } from './textures.js';
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
// —— 全局风场 ——
// 注意：Three.js 的 uniform 必须是 { value: x }。旧版这里写成了 { time: t }，
// shader 里 uFoliageWindTime 恒为 0，叶片只被静态偏移、完全不摆（"树叶都不动"的根因）。
// 所有叶片材质共享同一组 uniform 对象，一次更新即可全岛同步。
const windU = {
  uWindTime: { value: 0 },
  uWindStrength: { value: 0.75 },
  uWindDir: { value: new THREE.Vector2(0.86, 0.51) },
  uWindGust: { value: 1 },
};
export const foliageWindState = () => ({
  enabled: windEnabled,
  time: +windU.uWindTime.value.toFixed(2),
  strength: +windU.uWindStrength.value.toFixed(2),
  gust: +windU.uWindGust.value.toFixed(2),
  dir: windU.uWindDir.value.toArray().map(v => +v.toFixed(2)),
  materials: windMatCount,
});
let windEnabled = true;
let windMatCount = 0;
export function setFoliageWindEnabled(v) { windEnabled = !!v; }

/** 每帧同步：t=秒，env=环境系统（雨量/天气决定风力），风向缓慢旋转避免一直往同一边倒 */
export function updateFoliageWind(t, env, enabled = true) {
  windU.uWindTime.value = t;
  windEnabled = enabled;
  if (!enabled) { windU.uWindStrength.value = 0; return; }
  const rain = env ? (env.rain || 0) : 0;
  const storm = env && env.weather === 'storm' ? 0.30 : 0;
  // 晴天微风 0.62 → 暴雨 1.75；夜间略收，白天树冠更活
  const night = env ? (env.night || 0) : 0;
  windU.uWindStrength.value = 0.62 + rain * 0.95 + storm - night * 0.12;
  // 阵风包络：低频起伏 + 偶发短促强阵风，shader 里再叠一层空间错相
  const g = 0.72 + 0.28 * Math.sin(t * 0.29) * Math.sin(t * 0.11 + 1.3)
    + 0.22 * Math.pow(Math.max(0, Math.sin(t * 0.077 + 2.1)), 6);
  windU.uWindGust.value = g;
  const a = 0.55 + Math.sin(t * 0.031) * 0.42 + Math.sin(t * 0.013) * 0.20;
  windU.uWindDir.value.set(Math.cos(a), Math.sin(a)).normalize();
}

// 注入到任意材质（含 MeshDepthMaterial，让树影与叶片同步摆动）
const WIND_DECL = `
uniform float uWindTime, uWindStrength, uWindGust;
uniform vec2 uWindDir;
`;
const WIND_BODY = `
  #include <begin_vertex>
  // 实例世界位置作相位种子：每棵树、每丛草都不同步，避免整片林子齐刷刷地摆
  vec2 iw = vec2(0.0);
  float iscale = 1.0;
  #ifdef USE_INSTANCING
    iw = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
    iscale = max(length(instanceMatrix[0].xyz), 0.001);
  #endif
  float ph = dot(iw, vec2(0.085, 0.117));
  float T = uWindTime;
  // 大尺度阵风：缓慢的包络让风有"一阵一阵"的呼吸感
  float envelope = (0.62 + 0.38 * sin(T * 0.31 + ph * 0.5)
                  + 0.16 * sin(T * 0.83 + ph * 1.3)) * uWindGust;
  // 摆枝：三个不同频率叠加，不成周期
  float sway = (sin(T * 0.95 + ph) * 0.62
              + sin(T * 1.87 + ph * 1.73) * 0.26
              + sin(T * 0.43 + ph * 0.37) * 0.34) * envelope;
  // 叶片高频颤动：局部坐标让同一株里的每片叶子也不同步
  float flutter = sin(T * 4.6 + position.x * 6.1 + position.y * 3.7
                    + position.z * 2.9 + ph * 2.3) * 0.30;
  // 离根部越远摆得越多（卡片用 y、羽叶用 x 作为"伸出长度"）
  float reach = max(abs(position.y), abs(position.x) * 0.85);
  float w = clamp(reach * 0.62 + 0.12, 0.0, 1.0);
  // 实例缩放归一化：位移是局部空间，不除 iscale 的话大树冠会被放大数倍
  float sf = clamp(iscale, 0.6, 2.8);
  float amp = uWindStrength * w * (0.34 * sf / iscale);
  vec2 bend = uWindDir * (sway + flutter) * amp;
  transformed.x += bend.x;
  transformed.z += bend.y;
  transformed.y += abs(sway) * amp * 0.16;
`;
function applyWind(mat) {
  windMatCount++;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windU);
    shader.vertexShader = WIND_DECL + shader.vertexShader.replace(
      '#include <begin_vertex>', WIND_BODY);
  };
  mat.customProgramCacheKey = () => 'isle-foliage-wind-v2';
  return mat;
}

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
  if (r > 260 || r < 10) return false;
  if (h < (opts.minH ?? 2.4) || h > (opts.maxH ?? 46)) return false;
  if (trailDist(x, z) < (opts.nearTrail ? 1.5 : TRAIL_W + 1.5)) return false;
  if (inCaveCorr(x, z) || (Math.abs(x) < 18.75 && z < -50 && z > -225)) return false;
  if (dist2(x, z, SPAWN.x, SPAWN.z) < (opts.nearTrail ? 3.75 : 15)) return false;
  if (dist2(x, z, RAFT.x, RAFT.z) < 16.25) return false;
  if (dist2(x, z, CABIN.x, CABIN.z) < 21.25) return false; // 林中木屋空地不长树
  if (Math.abs(z + 7.5) < 26.25 && Math.abs(x) < 17.5) return false; // 断魂谷谷底
  if (Math.abs(x - SWAMP.x) < 6.25 && z < 122.5 && z > 10) return false; // 沼泽木板路带
  if (Math.abs(x - 175) < 82 && Math.abs(z + 100) < 58) return false;  // 东岭大理石山 footprint
  const e = 2;
  const slope = Math.hypot(baseHeight(x + e, z) - baseHeight(x - e, z), baseHeight(x, z + e) - baseHeight(x, z - e)) / (2 * e);
  if (slope > 0.85) return false;
  // 陡坎/沟沿：脚下高差过大的位置不种（否则整棵树会骑在断面之上）
  if (opts.maxSpan && footSpan(x, z, opts.spanR || 2.4) > opts.maxSpan) return false;
  if (!opts.swampOK) {
    if (dist2(x, z, SWAMP.x, SWAMP.z) < 58.75) return false;
    if (dist2(x, z, POND.x, POND.z) < 42.5) return false;
  }
  return true;
}
function scatter(count, opts = {}) {
  const out = [];
  let tries = 0;
  while (out.length < count && tries < count * 60) {
    tries++;
    const x = (rng() * 2 - 1) * 315, z = (rng() * 2 - 1) * 315;
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
  const mat = new THREE.MeshStandardMaterial({
    map, alphaTest: opts.alphaTest ?? 0.45, side: THREE.DoubleSide,
    roughness: 0.82, metalness: 0, transparent: false,
    color: opts.color ?? 0xffffff,
    ...opts.extra,
  });
  // 叶片（树冠/羽叶/草/蕨/藤）统一注入风场；树干和岩石不参与，避免整棵树像橡皮一样摇摆。
  applyWind(mat);
  // 阴影深度材质也注入同一套风摆，否则树冠在动、地上的影子却纹丝不动
  const depth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: mat.map || null,
    alphaTest: mat.alphaTest || 0,
    side: mat.side,
  });
  applyWind(depth);
  mat.customDepthMaterial = depth;
  return mat;
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
    const N = Math.round(500 * quality);
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
      colliders.push({ x, z, r: 1.6 * s, type: "giant" });
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
    const N = Math.round(288 * quality);
    const pts = scatter(N - 40);
    // 靠海与沼泽边上更密
    const extra = scatter(50, { nearTrail: true, swampOK: true, zone: (x, z) => dist2(x, z, 0, 0) > 187.5 });
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
      colliders.push({ x, z, r: 0.4 * s, type: "palm" });
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

  // ================= 2A. 椰子树（海岸椰林：高细弯干 + 环纹皮 + 长垂羽冠 + 果串） =================
  {
    // 近岸环带成林：离海近、海拔低（minH/maxH 放宽到沙滩后缘）
    const N = Math.round(250 * quality);
    const pts = scatter(N, { nearTrail: true, swampOK: true, maxH: 9, zone: (x, z) => dist2(x, z, 0, 0) > 187 });
    const SEG = 8;
    const segGeo = new THREE.CylinderGeometry(0.12, 0.2, 1, 8);
    segGeo.translate(0, 0.5, 0);
    const cocBark = coconutBarkTex().clone(); cocBark.needsUpdate = true; cocBark.repeat.set(2, 2.2);
    const trunkMat = new THREE.MeshStandardMaterial({
      map: cocBark, normalMap: barkN, normalScale: new THREE.Vector2(0.4, 0.4),
      color: 0xcfc3ac, roughness: 0.95,
    });
    const segs = new THREE.InstancedMesh(segGeo, trunkMat, pts.length * SEG);
    const fg = frondGeo();
    const fronds = new THREE.InstancedMesh(fg, leafMat(palmT, { alphaTest: 0.3 }), pts.length * 15);
    const nuts = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x6d5232, roughness: 0.9 }), pts.length * 4);
    const c = new THREE.Color();
    let si = 0, fi = 0, ni = 0;
    const qy = new THREE.Quaternion(), qz = new THREE.Quaternion();
    pts.forEach(([x, z]) => {
      const s = 0.9 + rng() * 0.45;
      const H = (10 + rng() * 6) * s;
      const y = footBase(x, z, 0.4 * s, 0.12);
      const la = rng() * 6.283;
      const bendAmt = (1.2 + rng() * 1.8) * s;
      // 沿曲线堆叠 8 段（比棕榈更高更细，弯曲更明显）
      for (let k = 0; k < SEG; k++) {
        const t0 = k / SEG, t1 = (k + 1) / SEG;
        const x0 = x + Math.cos(la) * bendAmt * t0 * t0, z0 = z + Math.sin(la) * bendAmt * t0 * t0;
        const x1 = x + Math.cos(la) * bendAmt * t1 * t1, z1 = z + Math.sin(la) * bendAmt * t1 * t1;
        const y0 = y + H * t0, y1 = y + H * t1;
        const dir = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0);
        const len = dir.length(); dir.normalize();
        UP.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        UP.quaternion.setFromUnitVectors(YAX, dir);
        UP.scale.set(s * (1 - t0 * 0.3), len * 1.06, s * (1 - t0 * 0.3));
        UP.updateMatrix();
        segs.setMatrixAt(si++, UP.matrix);
      }
      colliders.push({ x, z, r: 0.38 * s, type: "coconut" });
      // 长垂羽冠：片数多、下垂明显
      const nf = 12 + Math.floor(rng() * 4);
      for (let k = 0; k < nf && fi < pts.length * 15; k++) {
        const yaw = (k / nf) * 6.283 + rng() * 0.25;
        const droop = 0.5 + rng() * 0.6;
        qy.setFromAxisAngle(YAX, yaw);
        qz.setFromAxisAngle(ZAX, -droop);
        UP.position.set(x + Math.cos(la) * bendAmt, y + H - 0.05, z + Math.sin(la) * bendAmt);
        UP.quaternion.copy(qy).multiply(qz);
        const L = (3.8 + rng() * 1.7) * s;
        UP.scale.set(L, L, L);
        UP.updateMatrix();
        fronds.setMatrixAt(fi, UP.matrix);
        c.setHSL(0.23 + rng() * 0.04, 0.24 + rng() * 0.14, 0.78 + rng() * 0.18);
        fronds.setColorAt(fi, c); fi++;
      }
      // 椰子果串（挂在冠心下方）
      const nn = 3 + Math.floor(rng() * 3);
      for (let k = 0; k < nn && ni < pts.length * 4; k++) {
        UP.position.set(x + Math.cos(la) * bendAmt + (rng() - 0.5) * 0.5, y + H - 0.3 - rng() * 0.24, z + Math.sin(la) * bendAmt + (rng() - 0.5) * 0.5);
        const ns = (0.8 + rng() * 0.5) * s;
        UP.scale.set(ns, ns * (0.85 + rng() * 0.3), ns);
        UP.rotation.set(rng() * 3, rng() * 6.28, rng() * 3);
        UP.updateMatrix();
        nuts.setMatrixAt(ni, UP.matrix); ni++;
      }
    });
    segs.count = si; fronds.count = fi; nuts.count = ni;
    segs.castShadow = soft; fronds.castShadow = soft; nuts.castShadow = false;
    group.add(segs, fronds, nuts);
  }

  // ================= 2B. 橡胶树（内陆成簇：笔直灰白干 + 卵圆亮叶冠） =================
  {
    // 簇状分布（种植园感）：先撒簇心，再在簇心周围散开 4~6 棵
    const centers = scatter(Math.round(38 * quality), { maxSpan: 3.6, spanR: 2.2, zone: (x, z) => dist2(x, z, 0, 0) < 206 });
    const raw = [];
    for (const [cx, cz] of centers) {
      const n = 4 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const a = rng() * 6.283, rr = 3 + rng() * 7;
        raw.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
      }
    }
    const pts = raw.filter(([x, z]) => placeOK(x, z, { maxSpan: 3.6, spanR: 1.6 }));
    const thGeo = new THREE.CylinderGeometry(0.18, 0.3, 1, 8);
    thGeo.translate(0, 0.5, 0);
    const rbTex = rubberBarkTex().clone(); rbTex.needsUpdate = true; rbTex.repeat.set(1.6, 4);
    const trunkMat = new THREE.MeshStandardMaterial({
      map: rbTex, normalMap: barkN, normalScale: new THREE.Vector2(0.35, 0.35),
      color: 0xd6d0c2, roughness: 0.92,
    });
    const trunks = new THREE.InstancedMesh(thGeo, trunkMat, pts.length);
    const branchGeo = new THREE.CylinderGeometry(0.05, 0.16, 1, 6);
    branchGeo.translate(0, 0.5, 0);
    const branches = new THREE.InstancedMesh(branchGeo, trunkMat, pts.length * 4);
    // 冠：真实阔叶卡（leaf_tree_a，椭圆单片叶 —— 橡胶叶形态）
    const crownGeo = cardGeo(0.14, 3);
    const crowns = new THREE.InstancedMesh(crownGeo, leafMat(treeATex(), { alphaTest: 0.4 }), pts.length * 10);
    const c = new THREE.Color();
    let bi = 0, ci = 0;
    pts.forEach(([x, z], i) => {
      const s = 0.85 + rng() * 0.45;
      const th = (9 + rng() * 6) * s;
      const y = footBase(x, z, 0.55 * s, 0.18);
      const lean = (rng() - 0.5) * 0.025;
      UP.position.set(x, y, z);
      UP.scale.set(s, th, s);
      UP.rotation.set(lean, rng() * 6.28, lean);
      UP.updateMatrix();
      trunks.setMatrixAt(i, UP.matrix);
      colliders.push({ x, z, r: 0.5 * s, type: "rubber" });
      // 主枝 3~4：从干上部以较平的角度斜出
      const bn = 3 + Math.floor(rng() * 2);
      for (let k = 0; k < bn && bi < pts.length * 4; k++) {
        const a = rng() * 6.283;
        const tl = 1.1 + rng() * 0.35;
        _v.set(Math.cos(a) * Math.sin(tl), Math.cos(tl), Math.sin(a) * Math.sin(tl)).normalize();
        UP.position.set(x, y + th * (0.62 + rng() * 0.14), z);
        UP.quaternion.setFromUnitVectors(YAX, _v);
        UP.scale.set(s, (3 + rng() * 2.2) * s, s);
        UP.updateMatrix();
        branches.setMatrixAt(bi, UP.matrix); bi++;
      }
      // 卵圆冠：分两层围合 + 盖顶
      const crownY = y + th * 0.86;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * 6.283 + rng() * 0.7;
        const rad = (0.9 + (k % 3) * 0.7) * s * (0.8 + rng() * 0.4);
        const cw = (3.2 + rng() * 1.8) * s;
        UP.position.set(x + Math.cos(a) * rad, crownY + (rng() - 0.35) * 1.8 * s, z + Math.sin(a) * rad);
        UP.scale.set(cw, cw * (0.8 + rng() * 0.3), cw);
        UP.rotation.set((rng() - 0.5) * 0.5, rng() * 6.283, (rng() - 0.5) * 0.4);
        UP.updateMatrix();
        crowns.setMatrixAt(ci, UP.matrix);
        c.setHSL(0.30 + rng() * 0.03, 0.22 + rng() * 0.12, 0.62 + rng() * 0.16);
        crowns.setColorAt(ci, c); ci++;
      }
      for (let k = 0; k < 2; k++) {
        const a = rng() * 6.283;
        const rad = (1.2 + rng() * 1.6) * s;
        const cw = (4.5 + rng() * 2) * s;
        UP.position.set(x + Math.cos(a) * rad, crownY + (1.2 + rng() * 1.2) * s, z + Math.sin(a) * rad);
        UP.scale.set(cw, cw, cw);
        UP.rotation.set(-Math.PI / 2 + (rng() - 0.5) * 0.4, rng() * 6.283, (rng() - 0.5) * 0.3);
        UP.updateMatrix();
        crowns.setMatrixAt(ci, UP.matrix);
        c.setHSL(0.29 + rng() * 0.04, 0.20 + rng() * 0.10, 0.66 + rng() * 0.14);
        crowns.setColorAt(ci, c); ci++;
      }
    });
    branches.count = bi; crowns.count = ci;
    trunks.castShadow = soft; branches.castShadow = soft; crowns.castShadow = soft;
    group.add(trunks, branches, crowns);
  }

  // ================= 2C. 羽叶乔木（高干宽伞冠 + 大羽状复叶，疏林/林缘） =================
  {
    const pts = scatter(Math.round(112 * quality), { maxSpan: 4.2, spanR: 2.2 });
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.42, 1, 9);
    trunkGeo.translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, barkDark, pts.length);
    const branchGeo = new THREE.CylinderGeometry(0.07, 0.2, 1, 6);
    branchGeo.translate(0, 0.5, 0);
    const branches = new THREE.InstancedMesh(branchGeo, barkDark, pts.length * 3);
    // 冠：真实大羽叶卡（leaf_tree_b —— 雨豆树式巨羽复叶）
    const crownGeo = cardGeo(0.18, 3);
    const crowns = new THREE.InstancedMesh(crownGeo, leafMat(treeBTex(), { alphaTest: 0.4 }), pts.length * 6);
    const c = new THREE.Color();
    let bi = 0, ci = 0;
    pts.forEach(([x, z], i) => {
      const s = 0.9 + rng() * 0.6;
      const th = (7 + rng() * 5) * s;
      const y = footBase(x, z, 0.7 * s, 0.18);
      const lean = (rng() - 0.5) * 0.04;
      UP.position.set(x, y, z);
      UP.scale.set(s, th, s);
      UP.rotation.set(lean, rng() * 6.28, lean);
      UP.updateMatrix();
      trunks.setMatrixAt(i, UP.matrix);
      colliders.push({ x, z, r: 0.55 * s, type: "feather" });
      // 上部 3 主枝上翘撑开伞冠
      for (let k = 0; k < 3 && bi < pts.length * 3; k++) {
        const a = rng() * 6.283;
        const tl = 0.9 + rng() * 0.3;
        _v.set(Math.cos(a) * Math.sin(tl), Math.cos(tl), Math.sin(a) * Math.sin(tl)).normalize();
        UP.position.set(x, y + th * (0.72 + rng() * 0.12), z);
        UP.quaternion.setFromUnitVectors(YAX, _v);
        UP.scale.set(s, (3.2 + rng() * 2.4) * s, s);
        UP.updateMatrix();
        branches.setMatrixAt(bi, UP.matrix); bi++;
      }
      // 宽扁伞冠：中部 4 张大羽叶卡 + 顶部 2 张近水平
      const crownY = y + th * 0.92;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * 6.283 + rng() * 0.9;
        const rad = (1.4 + rng() * 1.2) * s;
        const cw = (5 + rng() * 2.4) * s;
        UP.position.set(x + Math.cos(a) * rad, crownY + (rng() - 0.4) * 1.4 * s, z + Math.sin(a) * rad);
        UP.scale.set(cw, cw * (0.62 + rng() * 0.16), cw);
        UP.rotation.set((rng() - 0.5) * 0.6, rng() * 6.283, (rng() - 0.5) * 0.4);
        UP.updateMatrix();
        crowns.setMatrixAt(ci, UP.matrix);
        c.setHSL(0.26 + rng() * 0.04, 0.18 + rng() * 0.12, 0.72 + rng() * 0.16);
        crowns.setColorAt(ci, c); ci++;
      }
      for (let k = 0; k < 2; k++) {
        const a = rng() * 6.283;
        const rad = (1.6 + rng() * 2) * s;
        const cw = (6.5 + rng() * 2.6) * s;
        UP.position.set(x + Math.cos(a) * rad, crownY + (1.4 + rng() * 1.4) * s, z + Math.sin(a) * rad);
        UP.scale.set(cw, cw, cw);
        UP.rotation.set(-Math.PI / 2 + (rng() - 0.5) * 0.45, rng() * 6.283, (rng() - 0.5) * 0.3);
        UP.updateMatrix();
        crowns.setMatrixAt(ci, UP.matrix);
        c.setHSL(0.25 + rng() * 0.05, 0.16 + rng() * 0.10, 0.6 + rng() * 0.14);
        crowns.setColorAt(ci, c); ci++;
      }
    });
    branches.count = bi; crowns.count = ci;
    trunks.castShadow = soft; branches.castShadow = soft; crowns.castShadow = soft;
    group.add(trunks, branches, crowns);
  }

  // ================= 3. 林下大叶植物（芭蕉/龟背竹） =================
  {
    const pts = scatter(Math.round(2380 * quality), { nearTrail: true });
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
    const pts = scatter(Math.round(1190 * quality));
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
    const pts = [...scatter(Math.round(1375 * quality), { nearTrail: true }), ...scatter(Math.round(225 * quality), { swampOK: true, zone: (x, z) => dist2(x, z, SWAMP.x, SWAMP.z) < 60 })];
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
    const pts = scatter(Math.round(10250 * quality), { nearTrail: true });
    const geo = tuftGeo(10);
    // 近景草丛也随风弯腰（不投影，省一次深度渲染）
    const mat = applyWind(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide }));
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
    const n = Math.round(775 * quality);
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
    const pts = scatter(Math.round(5000 * quality), { nearTrail: true });
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
    const pts = scatter(Math.round(187 * quality));
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
      colliders.push({ x, z, r: s * 0.82, type: "rock" });   // 小块石头也挡人（1m 宽的石头能穿人很假）
    });
    mesh.castShadow = soft;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ================= 10. 倒木 =================
  {
    const pts = scatter(Math.round(57 * quality), { nearTrail: true });
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
        colliders.push({ x: x + Math.cos(la) * t, z: z - Math.sin(la) * t, r: 0.62, type: "log" });
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
      const pts = scatter(Math.round(42 * quality), { nearTrail: true });
      const mesh = new THREE.InstancedMesh(sa.geo, sa.mat, pts.length);
      pts.forEach(([x, z], i) => {
        const s = 0.65 + rng() * 1.05;
        const y = footBase(x, z, 0.9 * s, 0.05);   // 根须按裙边最低点落位，坡上不会半边悬空
        UP.position.set(x, y, z);
        UP.scale.set(s, s * (0.9 + rng() * 0.3), s);
        UP.rotation.set((rng() - 0.5) * 0.1, rng() * 6.28, (rng() - 0.5) * 0.1);
        UP.updateMatrix();
        mesh.setMatrixAt(i, UP.matrix);
        colliders.push({ x, z, r: s * 0.85, type: "stump" });   // 小断桩也挡人（最宽 2.2×0.65≈1.4m，穿过去很假）
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
  const pts = scatter(Math.round(65), { swampOK: true, zone: (x, z) => { const d = dist2(x, z, SWAMP.x, SWAMP.z); return d < 57.5 && d > 20; } });
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
    colliders.push({ x, z, r: 0.4, type: "dead" });
  }
  // 芦苇
  const reedGeo = new THREE.ConeGeometry(0.06, 1.9, 4);
  reedGeo.translate(0, 0.95, 0);
  const reeds = new THREE.InstancedMesh(reedGeo,
    applyWind(new THREE.MeshStandardMaterial({ color: 0x6f7d3e, roughness: 1 })), 280);
  let ri = 0;
  for (let i = 0; i < 320 && ri < 280; i++) {
    const a = rng() * 6.283, rr = 22.5 + rng() * 37.5;
    const x = SWAMP.x + Math.cos(a) * rr, z = SWAMP.z + Math.sin(a) * rr;
    if (Math.abs(x - SWAMP.x) < 3.75) continue;
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
    const a = rng() * 6.283, rr = 7.5 + rng() * 42.5;
    const x = SWAMP.x + Math.cos(a) * rr, z = SWAMP.z + Math.sin(a) * rr;
    if (Math.abs(x - SWAMP.x) < 2.75) continue;
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
    new THREE.MeshStandardMaterial({ map: bark, color: 0xb0a084, roughness: 1 }), 87);
  const pebGeo = rockAssetGeo();
  const pebble = new THREE.InstancedMesh(
    pebGeo || new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ map: rockT, color: 0xc8c0b0, roughness: 0.95 }), 112);
  const beachGrass = new THREE.InstancedMesh(
    mergeCross((() => { const q = new THREE.PlaneGeometry(1.0, 0.8); q.translate(0, 0.4, 0); return q; })()),
    leafMat(grassT, { alphaTest: 0.3 }), 400);
  const c = new THREE.Color();
  let di = 0, pi = 0, gi = 0;
  for (let i = 0; i < 3300 && (di < 87 || pi < 112 || gi < 400); i++) {
    const a = rng() * 6.283, rr = 235 + rng() * 50;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const h = terrainY(x, z);   // 沙滩杂物同样按渲染网格落位
    if (h < 1.0 || h > 3.6) continue;
    if (trailDist(x, z) < 5) continue;
    if (dist2(x, z, SPAWN.x, SPAWN.z) < 12.5 || dist2(x, z, RAFT.x, RAFT.z) < 15) continue;
    const pick = rng();
    if (pick < 0.22 && di < 87) {
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
    } else if (pick < 0.5 && pi < 112) {
      const s = 0.1 + rng() * 0.34;
      if (pebGeo) { UP.position.set(x, h - s * 0.15, z); UP.scale.set(s, s * (0.8 + rng() * 0.3), s); }
      else { UP.position.set(x, h + s * 0.3, z); UP.scale.set(s, s * 0.7, s); }
      UP.rotation.set(rng() * 3, rng() * 6, rng() * 3); UP.updateMatrix();
      pebble.setMatrixAt(pi++, UP.matrix);
    } else if (gi < 400) {
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
