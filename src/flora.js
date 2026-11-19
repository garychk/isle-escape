// 热带雨林植被：巨树（板根+叶簇卡片）/ 棕榈 / 椰子树（海岸） / 橡胶树（成簇） / 羽叶乔木（伞冠）
//   / 大叶林下植物 / 藤蔓 / 蕨 / 草 / 落叶层 / 岩石 / 倒木
import * as THREE from 'three';
import { CFG, TRAIL_W, SPAWN, RAFT, POND, SWAMP, CABIN, MOUNT, MARBLE } from './config.js';
import { mulberry32, clamp, smoothstep, dist2, fbm } from './util.js';
import { baseHeight, terrainY, TERRAIN_SEG, trailDist, waterDistance } from './terrain.js';
import { barkTex, barkNormal, rockTex, grassTex, fernTex, canopyTex, palmFrondTex, bigLeafTex, vineTex, litterTex, rubberBarkTex, treeATex, getTextureOverride } from './textures.js';
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

// 外部高模树（hp_tree.glb / palm.glb）：按材质拆成多份几何（树皮+叶），烘掉节点变换、
// 统一"底部中心=原点"，给 InstancedMesh 用。缺文件返回 null（跳过不放置）。
function extTreeParts(slot) {
  try {
    const inst = instance(slot);
    if (!inst) return null;
    const parts = [];
    inst.wrap.updateMatrixWorld(true);
    inst.wrap.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      parts.push({ g, m: o.material });
    });
    if (!parts.length) return null;
    const bb = new THREE.Box3();
    parts.forEach((p) => { p.g.computeBoundingBox(); bb.union(p.g.boundingBox); });
    const ox = (bb.min.x + bb.max.x) / 2, oy = bb.min.y, oz = (bb.min.z + bb.max.z) / 2;
    parts.forEach((p) => p.g.translate(-ox, -oy, -oz));
    // GLTF 材质 roughness 0.5：在 scene.environment（HDRI PMREM）下叶卡/树皮
    // 会镜像出亮白天空（2026-11-19 游戏里整棵树发白的根因）。压到哑光 + 低环境反射。
    parts.forEach((p) => {
      const m = p.m;
      m.roughness = 1;
      m.metalness = 0;
      if (m.envMap !== undefined) m.envMapIntensity = 0.25;
      m.needsUpdate = true;
    });
    return { parts, nativeH: bb.max.y - bb.min.y };
  } catch (e) { return null; }
}

const rng = mulberry32(20261112);
const UP = new THREE.Object3D();
const YAX = new THREE.Vector3(0, 1, 0);
const ZAX = new THREE.Vector3(0, 0, 1);
const XAX = new THREE.Vector3(1, 0, 0);
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

// —— 岩石苔藓（2026-11-19）——
// 每块石头一个 mossWet 适宜度（JS 端按"离水距离/山脚高度"算好），shader 里再按
// 世界坐标斑块噪声 + 顶面朝向决定苔藓覆盖：只有潮湿区域、朝上的面、斑块处才长绿，
// 高山裸岩与石头底面保持原色，避免整座岛的石头"统一刷绿"的塑料感。
const MOSS_DECL_V = `
attribute float mossWet;
varying vec3 vMossWPos;
varying vec3 vMossWNrm;
varying float vMossWet;
`;
const MOSS_VBODY = `
  vMossWet = mossWet;
  #ifdef USE_INSTANCING
    vec4 mossWP = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
    vMossWNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  #else
    vec4 mossWP = modelMatrix * vec4(transformed, 1.0);
    vMossWNrm = normalize(mat3(modelMatrix) * normal);
  #endif
  vMossWPos = mossWP.xyz;
`;
const MOSS_DECL_F = `
varying vec3 vMossWPos;
varying vec3 vMossWNrm;
varying float vMossWet;
float mossHash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float mossNoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mossHash(i), mossHash(i + vec3(1,0,0)), f.x),
                 mix(mossHash(i + vec3(0,1,0)), mossHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(mossHash(i + vec3(0,0,1)), mossHash(i + vec3(1,0,1)), f.x),
                 mix(mossHash(i + vec3(0,1,1)), mossHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;
// 在 color_fragment 之后注入：此时 diffuseColor 已是 albedo×instanceColor（灰岩石），
// 苔藓单独混色，不再被石头的 instanceColor 染灰。
const MOSS_FBODY = `
  {
    // 顶面与朝上的斜面长苔最多；侧面背阴处也留一层薄苔（真实苔藓石侧面同样覆绿），
    // 只有朝下的底面不长。门限放低是为了让斑块真正看得见，而不是可望不可即。
    float up = mix(0.45, 1.0, smoothstep(-0.35, 0.55, vMossWNrm.y));
    float n = mossNoise(vMossWPos * 0.7) * 0.55
            + mossNoise(vMossWPos * 2.4) * 0.30
            + mossNoise(vMossWPos * 7.0) * 0.15;
    float mossPatch = smoothstep(0.36, 0.62, n);               // 不规则苔斑边界
    float m = clamp(vMossWet, 0.0, 1.0) * up * mossPatch;
    vec3 mossA = vec3(0.10, 0.185, 0.058);                     // 深苔绿（线性空间）
    vec3 mossB = vec3(0.245, 0.335, 0.11);                     // 嫩苔黄绿
    vec3 mossCol = mix(mossA, mossB, mossNoise(vMossWPos * 3.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, mossCol, clamp(m, 0.0, 0.92));
  }
`;
function applyRockMoss(mat) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uMossTint: { value: 1 },
    });
    shader.vertexShader = MOSS_DECL_V + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n' + MOSS_VBODY);
    shader.fragmentShader = MOSS_DECL_F + shader.fragmentShader.replace(
      '#include <color_fragment>', '#include <color_fragment>\n' + MOSS_FBODY);
  };
  mat.customProgramCacheKey = () => 'isle-rock-moss-v1';
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
  // 翻山垭口（凹口）内不长树（2026-11-19 用户要求）：山道段（z -56~-204）
  // 小径两侧 10m 内全部清空——踩踏带本身宽 22m，旧规则只避让中心 6.7m，
  // 坑洼山石道两侧仍会长出树，破坏"裸岩垭口"的观感
  // 2026-11-19g：北屏峰封谷后山道止于 z≈-204，更北的高山让坡度过滤自然管
  if (z < -56 && z > -204 && trailDist(x, z) < TRAIL_W + 10) return false;
  if (dist2(x, z, SPAWN.x, SPAWN.z) < (opts.nearTrail ? 3.75 : 15)) return false;
  if (dist2(x, z, RAFT.x, RAFT.z) < 16.25) return false;
  if (dist2(x, z, CABIN.x, CABIN.z) < 21.25) return false; // 林中木屋空地不长树
  if (Math.abs(z + 7.5) < 26.25 && Math.abs(x) < 17.5) return false; // 断魂谷谷底
  if (Math.abs(x - SWAMP.x) < 6.25 && z < 122.5 && z > 10) return false; // 沼泽木板路带
  // 东岭山改为 JS 地形山：不再有矩形 footprint 排除，由 maxH(46m)+坡度过滤自然形成「山脚有树、山顶裸岩」
  const e = 2;
  const slope = Math.hypot(baseHeight(x + e, z) - baseHeight(x - e, z), baseHeight(x, z + e) - baseHeight(x, z - e)) / (2 * e);
  // 注：曾放宽到 1.05(46°) 想给主山凹口两侧山坡种树，但树/蕨在陡坡上根部悬空、
  // 出现巨型穿帮树，已回退 0.85(40°)。凹口两侧裸岩山坡符合真实山坳形态。
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
// —— 乔木主枝：带锥度 + 根部枝领膨大 + 上翘弧的自然枝条 ——
// 旧实现是笔直细圆柱、近水平地插在树干上，像木棍。这里让枝条：
//  ① 根部半径膨大(枝领)融入树干，像"长出来"而非"插进去"；
//  ② 末端沿局部 +X 上翘(配合 aimBranch 把 +X 对齐世界竖直投影)，弯曲自然。
function branchGeoFn() {
  const g = new THREE.CylinderGeometry(0.045, 0.17, 1, 7, 6);
  g.translate(0, 0.5, 0);                       // 底部 y=0（埋在树干轴心），顶部 y=1
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const collar = 1 + 0.95 * Math.exp(-y * 9);  // 枝领：根部半径×1.95，向上迅速收敛
    const bend = 0.17 * y * y;                   // 上翘弧：末端沿局部 +X 偏移
    p.setXYZ(i, x * collar + bend, y, z * collar);
  }
  g.computeVertexNormals();
  return g;
}
// 把枝条局部 +Y 对齐主轴 dir，局部 +X 对齐"世界竖直在垂直主轴平面上的投影"
// ——这样几何里的上翘弯(bend)在旋转后始终朝"更竖直"方向，不会因随机滚转而歪向侧面。
const _bnY = new THREE.Vector3(), _bnX = new THREE.Vector3(),
      _bnZ = new THREE.Vector3(), _bnUp = new THREE.Vector3(0, 1, 0),
      _bnM = new THREE.Matrix4();
function aimBranch(dir) {
  _bnY.copy(dir).normalize();
  _bnX.copy(_bnUp).addScaledVector(_bnY, -_bnUp.dot(_bnY)).normalize(); // 上翘方向
  _bnZ.crossVectors(_bnX, _bnY).normalize();                            // X×Y=Z 保证右手系
  _bnM.makeBasis(_bnX, _bnY, _bnZ);
  UP.quaternion.setFromRotationMatrix(_bnM);
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
  // 巨树皮定向覆盖（Quixel Alder Trunk，仅巨树使用；栈桥木箱/棕榈仍走程序化 barkTex）
  const boleDiff = getTextureOverride('bole'), boleNrm = getTextureOverride('boleN');
  const boleMap = boleDiff ? boleDiff.clone() : null;
  if (boleMap) { boleMap.needsUpdate = true; boleMap.repeat.set(2.4, 7.5); }
  const boleNormal = boleNrm ? boleNrm.clone() : null;
  if (boleNormal) { boleNormal.needsUpdate = true; boleNormal.repeat.set(2.4, 7.5); }

  const barkMat = new THREE.MeshStandardMaterial({
    map: boleMap || bark, normalMap: boleNormal || barkN,
    normalScale: new THREE.Vector2(0.9, 0.9),
    // 真实 albedo 已带正确色调，不再叠加程序化时代的暖褐 tint
    color: boleMap ? 0xffffff : 0xcabda5, roughness: 0.95,
  });
  const barkDark = new THREE.MeshStandardMaterial({
    map: boleMap || bark, normalMap: boleNormal || barkN,
    normalScale: new THREE.Vector2(0.8, 0.8),
    // 板根略压暗，保留与主干的明暗层次
    color: boleMap ? 0xb8b0a4 : 0x9c8f78, roughness: 0.97,
  });
  const rockT = rockTex();
  const grassT = grassTex();
  const fernT = fernTex();
  const bigT = bigLeafTex();
  const canopyA = canopyTex(0);
  const canopyB = canopyTex(1);
  const palmT = palmFrondTex();
  const vineT = vineTex();
  const litterT = litterTex();
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
    // 加密冠层：每树 9 张围合 + 5 张冠顶盖天（原 7+3），上限同步到 14
    const crown = new THREE.InstancedMesh(crownGeo, leafMat(canopyA, { alphaTest: 0.45 }), pts.length * 14);
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
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * 6.283 + rng() * 0.6;
        const rad = (k < 5 ? 1.9 : 3.4) * s * (0.8 + rng() * 0.5);
        const cw = (7.2 + rng() * 3.8) * s;
        UP.position.set(x + Math.cos(a) * rad, crownY + (rng() - 0.3) * 2.2 * s, z + Math.sin(a) * rad);
        UP.scale.set(cw, cw * (0.62 + rng() * 0.22), cw);
        UP.rotation.set((rng() - 0.5) * 0.7, rng() * 6.283, (rng() - 0.5) * 0.5);
        UP.updateMatrix();
        crown.setMatrixAt(ci, UP.matrix);
        c.setHSL(0.255 + rng() * 0.055, 0.07 + rng() * 0.13, 0.80 + rng() * 0.18);
        crown.setColorAt(ci, c); ci++;
      }
      // 冠顶：近水平的大叶片，把天空遮起来（雨林封闭冠层）
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * 6.283 + rng() * 0.9;
        const rad = (1.8 + rng() * 5.2) * s;
        const cw = (12 + rng() * 7) * s;
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

  // ================= 2.（已移除）棕榈（弯曲树干 + 羽状叶冠）=================
  // 2026-11-19 用户指定去掉这种浅米黄纵纹树干的棕榈；椰子树(palm.glb)与橡胶树保留补位。

  // ================= 2A. 椰子树（palm.glb 外部模型，2026-11-19 用户指定替换全岛程序化椰树） =================
  {
    const asset = extTreeParts('palmTree');
    if (asset) {
      // 近岸环带成林：离海近、海拔低（与旧程序化椰林同分布，minH/maxH 放宽到沙滩后缘）
      const N = Math.round(250 * quality);
      const pts = scatter(N, { nearTrail: true, swampOK: true, maxH: 9, zone: (x, z) => dist2(x, z, 0, 0) > 187 });
      const TARGET_H = 28 + rng() * 10;                 // 用户要求"高一点"：28~38m（原模 41m，冠幅 ~19m）
      const meshes = asset.parts.map((p) => {
        const im = new THREE.InstancedMesh(p.g, p.m, pts.length);
        im.castShadow = soft; im.receiveShadow = true;
        group.add(im);
        return im;
      });
      const sBase = TARGET_H / asset.nativeH;
      const qYaw = new THREE.Quaternion(), qTilt = new THREE.Quaternion(), qTiltAxis = new THREE.Vector3();
      pts.forEach(([x, z], i) => {
        const s = sBase * (0.85 + rng() * 0.35);
        const y = footBase(x, z, 0.9 * s, 0.14);
        // 底部=原点，海风致微倾（±5°）+ 随机朝向：倾转绕水平轴，树底不悬空
        const yaw = rng() * 6.283, lean = (rng() - 0.5) * 0.17;
        qYaw.setFromAxisAngle(YAX, yaw);
        qTiltAxis.set(Math.cos(yaw), 0, Math.sin(yaw));
        qTilt.setFromAxisAngle(qTiltAxis, lean);
        qYaw.multiply(qTilt);
        UP.position.set(x, y, z);
        UP.quaternion.copy(qYaw);
        UP.scale.set(s, s, s);
        UP.updateMatrix();
        meshes.forEach((im) => im.setMatrixAt(i, UP.matrix));
        colliders.push({ x, z, r: 0.7 * s, type: "coconut" });
      });
      meshes.forEach((im) => { im.instanceMatrix.needsUpdate = true; });
      console.log('[flora] 椰子树(palm.glb) x' + pts.length);
    }
  }

  // ================= 2B.（已移除）橡胶树（程序化）=================
  // 2026-11-19 用户指定：只保留 GLB 模型树（椰子树 palm.glb / hp_tree.glb），程序化树全部去掉。
  // ================= 2C.（已移除）羽叶乔木 =================
  // 2026-11-19 用户要求去掉：羽状复叶在逆光下整棵呈黑色剪影（叶片材质贴图偏暗，
  // 半透明卡无真实透光），观感像"烧焦的假树"。原 112×quality 棵的疏林位由
  // 巨树/橡胶树/高模真树自然补位，无需另行补种。

  // ================= 2D. 高模真树（hp_tree.glb，用户指定"多种点"） =================
  // 外部 GLB：树皮/叶片双材质、叶片 alpha 镂空。2 个 InstancedMesh 全岛只花 2 次 draw call。
  {
    const asset = extTreeParts('hpTree');
    if (asset) {
      const N = Math.round(110 * quality);
      const pts = scatter(N, { maxSpan: 4.6, spanR: 2.6 });
      const TARGET_H = 15 + rng() * 5;                 // 原模 27.5m 太大，归一到 15~20m
      const meshes = asset.parts.map((p) => {
        const im = new THREE.InstancedMesh(p.g, p.m, pts.length);
        im.castShadow = soft; im.receiveShadow = true;
        group.add(im);
        return im;
      });
      const sBase = TARGET_H / asset.nativeH;
      pts.forEach(([x, z], i) => {
        const s = sBase * (0.8 + rng() * 0.55);
        const y = footBase(x, z, 1.1 * s, 0.2);
        UP.position.set(x, y, z);
        UP.scale.set(s, s, s);
        UP.rotation.set((rng() - 0.5) * 0.05, rng() * 6.28, (rng() - 0.5) * 0.05);
        UP.updateMatrix();
        meshes.forEach((im) => im.setMatrixAt(i, UP.matrix));
        colliders.push({ x, z, r: 1.3 * s, type: "hp" });
      });
      meshes.forEach((im) => { im.instanceMatrix.needsUpdate = true; });
      console.log('[flora] 高模树 x' + pts.length);
    }
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

  // ================= 9. 岩石（带潮湿苔藓）=================
  {
    const pts = scatter(Math.round(187 * quality));
    const extGeo = rockAssetGeo(); // rock.glb：原点=底部中心，高≈0.6×宽
    const geo = extGeo || jitterGeo(new THREE.DodecahedronGeometry(1, 0), 0.18);
    // 每实例苔藓适宜度：离水近 + 低海拔（山脚/河岸潮湿带）→ 高，随噪声打散
    // 注意必须在创建 InstancedMesh 之前挂 attribute，且 count 与实例数一致。
    const mossWet = new Float32Array(pts.length);
    const mesh = new THREE.InstancedMesh(geo, applyRockMoss(
      new THREE.MeshStandardMaterial({ map: rockT, color: 0xffffff, roughness: 0.95 })), pts.length);
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
      // 潮湿适宜度：水边距离场 + 低海拔山脚。超出湿带则基本不长苔。
      const wd = waterDistance(x, z).dist;
      const byWater = 1 - smoothstep(2, 22, wd);              // 岸边 0~22m 递减
      const foot = 1 - smoothstep(8, 30, UP.position.y);       // 山脚低处更潮
      const jitter = 0.55 + 0.45 * clamp(fbm(x * 0.07, z * 0.07, 2) * 0.5 + 0.5, 0, 1);
      mossWet[i] = clamp(Math.max(byWater * 0.95, foot * 0.62) * jitter, 0, 1);
      colliders.push({ x, z, r: s * 0.82, type: "rock" });   // 小块石头也挡人（1m 宽的石头能穿人很假）
    });
    geo.setAttribute('mossWet', new THREE.InstancedBufferAttribute(mossWet, 1));
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
  buildRiparian(group, fernT, bigT, grassT, soft);
}

// ---------- 河岸湿带（2026-11-19）：贴地苔藓垫 + 湿生蕨/草/阔叶 ----------
// 用 terrain.js 烘焙好的水面距离场筛选"内陆水域岸边 0.6~7m 的陆地"，
// 沿海塘/水潭/沼泽的水线自然成带，而不是手工摆一圈假花坛。
function wetBankPts(count, d0, d1, minH, maxH, triesK = 95) {
  const out = [];
  let tries = 0;
  while (out.length < count && tries < count * triesK) {
    tries++;
    const x = (rng() * 2 - 1) * 220, z = (rng() * 2 - 1) * 220;
    const r = Math.hypot(x, z);
    if (r < 14 || r > 216) continue;                          // 只做内陆水岸，海边已有滨草/卵石
    const wd = waterDistance(x, z);
    if (wd.dist < d0 || wd.dist > d1) continue;               // 离水带
    const h = terrainY(x, z);
    if (h < minH || h > maxH) continue;                       // 高于水面、低于陡岸
    if (trailDist(x, z) < TRAIL_W + 0.8) continue;            // 不挡小径
    if (dist2(x, z, SPAWN.x, SPAWN.z) < 12) continue;
    if (dist2(x, z, CABIN.x, CABIN.z) < 18) continue;
    if (Math.abs(x - SWAMP.x) < 3.6 && z < 121 && z > 11) continue; // 沼泽木板路带
    const [lo, hi] = gridMinMax(x, z, 1.0);
    if (hi - lo > 2.4) continue;                              // 陡坎不长
    out.push([x, z, h, wd.dist]);
  }
  return out;
}

function mossPatchGeo() {
  // 低矮贴地的苔斑：上半球压得很扁，边缘用多频扰动打散圆形轮廓，
  // 顶面加细碎起伏——避免"一整块光滑绿球"的塑料感。
  const g = new THREE.SphereGeometry(1, 11, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
  g.scale(1, 0.17, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ang = Math.atan2(z, x);
    const edge = 1 + Math.sin(ang * 3 + 0.7) * 0.13
      + Math.sin(ang * 7 - 1.3) * 0.08 + (rng() - 0.5) * 0.24;
    const bump = y > 0.002 ? (rng() - 0.5) * 0.045 : 0;
    p.setXYZ(i, x * edge, Math.max(0, y + bump), z * edge);
  }
  g.computeVertexNormals();
  return g;
}

function buildRiparian(parent, fernT, bigT, grassT, soft) {
  // 湿带采样一次，分层共用（离水越近越铺苔藓，稍远让位给蕨草）
  const all = wetBankPts(1500, 0.6, 7.5, 1.0, 9.0);
  if (!all.length) return;
  const c = new THREE.Color();

  // 1. 贴地苔藓垫：压扁的不规则半球，略埋进地面，深苔绿带黄绿变化
  {
    const near = all.filter(p => p[3] < 4.6);
    const n = Math.min(near.length, Math.round(560));
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, metalness: 0, flatShading: true,
    });
    const mesh = new THREE.InstancedMesh(mossPatchGeo(), mat, n);
    mesh.name = 'riparian_moss';
    for (let i = 0; i < n; i++) {
      const [x, z, h, wd] = near[i];
      const s = 0.45 + rng() * 0.95;
      UP.position.set(x, h - 0.035, z);
      UP.scale.set(s, s * (0.65 + rng() * 0.6), s * (0.7 + rng() * 0.5));
      UP.rotation.set((rng() - 0.5) * 0.06, rng() * 6.28, (rng() - 0.5) * 0.06);
      UP.updateMatrix();
      mesh.setMatrixAt(i, UP.matrix);
      // 深苔绿：色相压到纯绿、明度压暗、饱和度收敛，去掉发亮的荧光感。
      // 越靠水越深绿，斑块间保留少量黄绿/明度差，避免整片同色。
      const wet = 1 - clamp(wd / 5, 0, 1);
      c.setHSL(0.255 + rng() * 0.045, 0.30 + wet * 0.16 + rng() * 0.10, 0.135 + rng() * 0.075 + wet * 0.02);
      mesh.setColorAt(i, c);
    }
    mesh.receiveShadow = true;
    parent.add(mesh);
  }

  // 2. 湿生蕨：复用蕨类交叉卡片，尺寸更小、颜色更嫩，密布湿带外缘
  {
    const geo = mergeCross((() => { const q = new THREE.PlaneGeometry(1.25, 0.9); q.translate(0, 0.45, 0); return q; })());
    const mat = leafMat(fernT, { alphaTest: 0.45, extra: { emissive: 0x0e1a08, emissiveIntensity: 0.2 } });
    const n = Math.min(all.length, Math.round(300));
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.name = 'riparian_fern';
    const src = all.slice(0, n);
    src.forEach(([x, z, h], i) => {
      const s = 0.5 + rng() * 0.55;
      UP.position.set(x, h - 0.05, z);
      UP.scale.set(s, s * (0.85 + rng() * 0.4), s);
      UP.rotation.set(0, rng() * 6.28, 0);
      UP.updateMatrix();
      mesh.setMatrixAt(i, UP.matrix);
      c.setHSL(0.25 + rng() * 0.05, 0.22 + rng() * 0.16, 0.76 + rng() * 0.18);
      mesh.setColorAt(i, c);
    });
    parent.add(mesh);
  }

  // 3. 湿生草丛：几何草簇随风弯腰，填充苔藓垫之间的空隙
  {
    const n = Math.min(all.length, Math.round(640));
    const mesh = new THREE.InstancedMesh(tuftGeo(9),
      applyWind(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide })), n);
    mesh.name = 'riparian_grass';
    const src = all.slice(0, n);
    src.forEach(([x, z, h], i) => {
      const s = 0.30 + rng() * 0.38;
      UP.position.set(x, h - 0.03, z);
      UP.scale.set(s * (0.8 + rng() * 0.5), s * (0.9 + rng() * 0.8), s * (0.8 + rng() * 0.5));
      UP.rotation.set(0, rng() * 6.28, 0);
      UP.updateMatrix();
      mesh.setMatrixAt(i, UP.matrix);
      c.setHSL(0.21 + rng() * 0.08, 0.32 + rng() * 0.2, 0.20 + rng() * 0.13);
      mesh.setColorAt(i, c);
    });
    mesh.castShadow = false;
    parent.add(mesh);
  }

  // 4. 阔叶点缀：少量大叶卡片，打散苔藓/蕨草的低矮单层感
  {
    const geo = mergeCross((() => { const q = new THREE.PlaneGeometry(1.05, 0.85); q.translate(0, 0.42, 0); return q; })());
    const mat = leafMat(bigT, { alphaTest: 0.45, extra: { emissive: 0x0c1608, emissiveIntensity: 0.16 } });
    const n = Math.min(all.length, Math.round(120));
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.name = 'riparian_bigleaf';
    const src = all.slice(all.length - n);
    src.forEach(([x, z, h], i) => {
      const s = 0.55 + rng() * 0.6;
      UP.position.set(x, h - 0.04, z);
      UP.scale.set(s, s * (0.85 + rng() * 0.4), s);
      UP.rotation.set(0, rng() * 6.28, 0);
      UP.updateMatrix();
      mesh.setMatrixAt(i, UP.matrix);
      c.setHSL(0.26 + rng() * 0.05, 0.24 + rng() * 0.16, 0.80 + rng() * 0.16);
      mesh.setColorAt(i, c);
    });
    parent.add(mesh);
  }
}

// ---------- 沼泽区：芦苇 + 藻斑（枯树已按用户要求移除：光秃树干穿帮） ----------
function buildSwamp(group, bark, soft) {
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
