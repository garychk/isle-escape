// 真实 PBR 贴图接入（Poly Haven "A Verdant Trail"，CC0）
//   assets/tex/ 下 4 组地面 PBR（albedo / normal / roughness）+ 植被 RGBA + sky.hdr
//   全部文件缺失时静默回退到原程序化材质，游戏照常启动。
import * as THREE from 'three';
import { CABIN } from './config.js';

const TILE = 70; // 与旧 groundDetail 的 repeat 保持一致：560m / 70 ≈ 8m 一个平铺
const GROUPS = ['forest', 'dirt', 'rock', 'sand'];

function url(file) {
  const base = (typeof document !== 'undefined' && document.baseURI) || 'http://localhost/';
  return new URL('assets/tex/' + file, base).href;
}

function loadTex(file, srgb) {
  return new Promise(resolve => {
    new THREE.TextureLoader().load(url(file), (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(TILE, TILE);
      t.anisotropy = 8;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
      resolve(t);
    }, undefined, () => resolve(null));
  });
}

/** 加载全部贴图；返回 { ground, foliage }，任一缺失则该部分为 null */
export async function loadPBR(onStep) {
  // 地面 12 张：并行加载，失败即整组回退
  const tasks = [];
  for (const g of GROUPS) {
    tasks.push(loadTex(g + '_diff.jpg', true));
    tasks.push(loadTex(g + '_nrm.jpg', false));
    tasks.push(loadTex(g + '_rgh.jpg', false));
  }
  const flat = await Promise.all(tasks);
  const ground = {};
  let ok = true;
  GROUPS.forEach((g, i) => {
    const d = flat[i * 3], n = flat[i * 3 + 1], r = flat[i * 3 + 2];
    if (!d || !n || !r) { ok = false; return; }
    ground[g] = { diff: d, nrm: n, rgh: r };
  });
  if (!ok) console.warn('[pbr] 地面贴图不完整，回退程序化地面');

  // 植被 RGBA（不需要平铺，用 ClampToEdge）
  const foliage = {};
  // 只加载 textures.js 已接入 override 的五张；leaf_shrub 留在 tex/ 备用
  const foliageFiles = {
    grass: 'leaf_grass.png', fern: 'leaf_fern.png', litter: 'leaf_litter.png',
    treeA: 'leaf_tree_a.png', treeB: 'leaf_tree_b.png',
  };
  await Promise.all(Object.entries(foliageFiles).map(async ([k, f]) => {
    const t = await new Promise(resolve => {
      new THREE.TextureLoader().load(url(f), tt => resolve(tt), undefined, () => resolve(null));
    });
    if (!t) return;
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    t.needsUpdate = true;
    foliage[k] = t;
  }));
  if (onStep) onStep();
  // 巨树树皮（Quixel Alder Tree Trunk）：albedo + normal，平铺包裹
  // （repeat 会被 flora.js 克隆后重设，这里的 TILE 无效但无害）
  const bole = {};
  await Promise.all([
    loadTex('bole_alder.jpg', true).then(t => { if (t) bole.diff = t; }),
    loadTex('bole_alder_n.jpg', false).then(t => { if (t) bole.nrm = t; }),
  ]);
  console.log('[pbr] 地面组:', ok ? Object.keys(ground).join(',') : '(回退)',
    '| 植被:', Object.keys(foliage).join(',') || '(回退)',
    '| 巨树皮:', (bole.diff && bole.nrm) ? 'alder' : '(回退)');
  return { ground: ok ? ground : null, foliage, bole: (bole.diff && bole.nrm) ? bole : null };
}

// ---------------------------------------------------------------------------
// 地形 splat：4 组 albedo / normal / roughness 按顶点权重混合
//   权重来自 geometry 的 'splat' 属性（vec4：林地/泥土/岩石/沙滩）
//   用 onBeforeCompile 注入 MeshStandardMaterial，保留原有光照/阴影/雾的全部逻辑
// ---------------------------------------------------------------------------
const FRAG_DECL = `
varying vec4 vSplat;
varying float vTrailRock;
varying vec3 vRockWorldPos;
varying vec3 vRockWorldNrm;
uniform sampler2D sD0, sD1, sD2, sD3;
uniform sampler2D sN0, sN1, sN2, sN3;
uniform sampler2D sR0, sR1, sR2, sR3;
// 峡谷区域权重：断魂谷(z≈-7.5,东西向)——穿山峡谷已移除（山体合并为双峰）
float gorgeW(vec3 wp) {
  float ravine = (1.0 - smoothstep(28.0, 38.0, abs(wp.z + 7.5)))
               * (1.0 - smoothstep(118.0, 134.0, abs(wp.x)));
  return clamp(ravine, 0.0, 1.0);
}
// 峡谷湿岩权重：峡谷区域刷湿岩，但林中木屋空地半径 14~26m 内淡出，
// 让木屋周围保持森林地表（草地/腐殖土），只有断崖陡壁仍走湿岩。
// vTrailRock：凹口翻山山道段——与山体共用同一套湿岩材质（2026-11-19 用户要求）。
float rockW(vec3 wp, float steep) {
  float gw = gorgeW(wp) * smoothstep(14.0, 26.0, distance(wp.xz, vec2(${CABIN.x.toFixed(1)}, ${CABIN.z.toFixed(1)})));
  return clamp(max(max(gw, smoothstep(0.38, 0.50, steep)), vTrailRock), 0.0, 1.0);
}
// 与山体完全相同的 rock 贴图（sD2/sN2/sR2）：三平面投影消除陡壁竖纹，≈3.3m 平铺
// 注意：texture.repeat 只作用于几何 UV（vMapUv），对这里手写的 texture2D 采样无效，
// 平铺周期必须直接写进 scale —— 旧值 1/210 实为 210m 一张，整张贴图拉成平滑色块（假）。
const float ROCK_SCALE = 0.30;
// —— GLSL 价值噪声（宏观调制用）——
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm2(vec2 p) { return vnoise(p) * 0.6 + vnoise(p * 2.7 + 13.1) * 0.4; }
vec2 uvRot(vec2 uv, float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c) * uv; }
// 三平面投影权重（按法线朝各轴的强度），带锐化避免接缝糊
vec3 triW(vec3 wn) {
  vec3 w = pow(abs(wn), vec3(4.0));
  return w / max(1e-4, w.x + w.y + w.z);
}
vec3 triSample(sampler2D tex, vec3 wp, vec3 wn, float scale) {
  vec3 w = triW(wn);
  vec3 cx = texture2D(tex, wp.zy * scale).rgb;
  vec3 cy = texture2D(tex, wp.xz * scale).rgb;
  vec3 cz = texture2D(tex, wp.xy * scale).rgb;
  return cx * w.x + cy * w.y + cz * w.z;
}
// 三平面 + 各轴 UV 旋转错位：同一块花纹不在三轴上对齐成重复网格
vec3 triSampleR(sampler2D tex, vec3 wp, vec3 wn, float scale, float ang) {
  vec3 w = triW(wn);
  vec3 cx = texture2D(tex, uvRot(wp.zy, ang) * scale).rgb;
  vec3 cy = texture2D(tex, uvRot(wp.xz, ang * 1.31 + 0.5) * scale).rgb;
  vec3 cz = texture2D(tex, uvRot(wp.xy, ang * 2.07 + 1.1) * scale).rgb;
  return cx * w.x + cy * w.y + cz * w.z;
}
vec3 rockWarp(vec3 wp) {
  return wp; // 域扭曲已移除：漩涡根因不在它，且省 6 次 fbm 采样（软渲染关键）
}
// 岩石三平面终采：小角度慢旋转 + 双尺度混拼。
// 【漩涡根因复盘】旧版 ang = fbm2 * 6.2832 让旋转角随位置转满整个 2π：
//   覆盖完整 2π 的平滑角度场，其等角线必在噪声极值点周围闭合 → 贴图绕极值点
//   打转，形成木纹/年轮状漩涡（实测关掉域扭曲漩涡依旧，元凶是旋转场本身）。
// 修复：旋转角压到 ±0.45rad（≈±26°）且频率降到 0.006（特征尺度 ~160m）——
//   朝向仍逐区域变化、足以打破全局重复网格，但局部 UV 扭曲量 <0.02rad/m，
//   肉眼不可见，不再产生涡旋。
vec3 rockTri(sampler2D tex, vec3 wp, vec3 wn) {
  float ang = (fbm2(wp.xz * 0.006 + wp.y * 0.003 + 3.0) - 0.5) * 0.9;
  float mixN = fbm2(wp.xz * 0.10 + wp.y * 0.05 + 9.4);
  vec3 a = triSampleR(tex, wp, wn, ROCK_SCALE, ang);
  vec3 b = triSampleR(tex, wp + 53.7, wn, ROCK_SCALE * 0.34, ang * 1.7 + 2.2);
  return mix(a, b, smoothstep(0.30, 0.72, mixN));
}
// 水平沉积层理：沿世界高度的连续条带，给板岩加"一层层"的地质感
float strata(vec3 wp) {
  float band = sin(wp.y * 0.85 + sin(wp.x * 0.09 + wp.z * 0.07) * 1.6) * 0.5 + 0.5;
  band += sin(wp.y * 2.3 + wp.z * 0.21) * 0.10;
  return band;
}
// 原 4 路 splat（草/泥/岩/沙）：峡谷外保持原有岛屿地表
vec3 baseAlbedo(vec2 uv) {
  vec3 a = texture2D(sD0, uv).rgb * vec3(0.84, 0.98, 0.80) * vSplat.x;
  a += texture2D(sD1, uv).rgb * vec3(0.90, 0.87, 0.78) * vSplat.y;
  a += texture2D(sD2, uv).rgb * vec3(0.80, 0.83, 0.79) * vSplat.z;
  a += texture2D(sD3, uv).rgb * vec3(0.88, 0.89, 0.83) * vSplat.w;
  return a;
}
vec3 baseNormal(vec2 uv) {
  vec3 n = texture2D(sN0, uv).xyz * vSplat.x;
  n += texture2D(sN1, uv).xyz * vSplat.y;
  n += texture2D(sN2, uv).xyz * vSplat.z;
  n += texture2D(sN3, uv).xyz * vSplat.w;
  return n;
}
float baseRough(vec2 uv) {
  float r = texture2D(sR0, uv).g * vSplat.x;
  r += texture2D(sR1, uv).g * vSplat.y;
  r += texture2D(sR2, uv).g * vSplat.z;
  r += texture2D(sR3, uv).g * vSplat.w;
  return r;
}
// 深褐湿岩：直接取山体同一张 rock 贴图，三平面投影 + 层理/湿痕，颜色天然一致。
// 反"程序化贴图"三件套：双尺度混采 + 各轴 UV 旋转错位 + 大尺度苔痕/水渍色斑。
vec3 wetRock(vec3 wp, vec3 wn) {
  // rockTri：小角度慢旋转 + 双尺度，远山近崖都不再显重复
  vec3 rock = rockTri(sD2, wp, wn);
  rock *= vec3(0.86, 0.88, 0.85);                          // 轻压亮度；aerial_rocks 自带灰岩+苔斑色调
  // 大尺度色斑：苔痕/干燥面已在贴图内，这里只做 10~30m 的宏观明暗不均匀
  float blotch = fbm2(wp.xz * 0.055 + wp.y * 0.02 + 19.0);
  rock *= 0.84 + smoothstep(0.15, 0.75, blotch) * 0.30;
  // 水平沉积层理只应出现在近垂直崖壁：相位以海拔 y 为主，在缓坡上其等值线
  // 会退化成"海拔等高线环"（俯视时一圈圈像地形图，极假）——按朝向竖直度门控。
  float st = strata(wp);
  float seam = smoothstep(0.84, 0.98, st);
  float vert = smoothstep(0.45, 0.80, 1.0 - abs(wn.y));    // 崖壁才开层理
  rock *= mix(1.0, 0.90 + st * 0.16 - seam * 0.08, vert);
  float wet = sin(wp.x * 0.18 + wp.z * 0.13) * sin(wp.z * 0.27) * 0.5 + 0.5;
  rock *= 0.90 + wet * 0.10;                              // 湿痕斑驳
  rock *= clamp(0.78 + wp.y * 0.016, 0.68, 1.10);         // 高位亮、谷底暗
  float steep = 1.0 - abs(wn.y);
  rock *= mix(1.05, 0.96, smoothstep(0.10, 0.42, steep)); // 陡壁略暗、缓坡略亮
  return rock;
}
vec3 splatAlbedo(vec2 uv, vec3 wp, vec3 wn) {
  vec3 base = baseAlbedo(uv);
  float steep = 1.0 - abs(wn.y);
  // 峡谷区域整体统一湿岩；其余全岛陡壁（山峰/海岸崖）按坡度渐变换湿岩，消除平面 UV 竖纹
  float w = rockW(wp, steep);
  if (w <= 0.001) return base;
  return mix(base, wetRock(wp, wn), w);
}
vec3 splatNormal(vec2 uv, vec3 wp, vec3 wn) {
  float steep = 1.0 - abs(wn.y);
  float w = rockW(wp, steep);
  if (w <= 0.001) return baseNormal(uv);
  // 法线与 albedo 同一 rockTri 采样（同扭曲场同角度），凹凸不显重复网格
  vec3 tn = rockTri(sN2, wp, wn);
  return mix(baseNormal(uv), tn, w);
}
float splatRough(vec2 uv, vec3 wp, vec3 wn) {
  float steep = 1.0 - abs(wn.y);
  float w = rockW(wp, steep);
  if (w <= 0.001) return baseRough(uv);
  // 粗糙度感知频率低，平铺本就不显眼：单尺度三平面即可，省一半采样（软渲染下很关键）
  return mix(baseRough(uv), triSampleR(sR2, wp, wn, ROCK_SCALE, 0.4).r, w);
}
`;

export function applyTerrainPBR(mesh, set) {
  if (!mesh || !set) return false;
  const m = mesh.material;
  // 挂上三个槽位，确保 three 生成 USE_MAP / USE_NORMALMAP_TANGENTSPACE / USE_ROUGHNESSMAP
  // 以及对应的 vMapUv / tbn 等 varying，注入代码只替换采样内容。
  m.map = set.forest.diff;
  m.normalMap = set.forest.nrm;
  m.roughnessMap = set.forest.rgh;
  m.normalScale.set(0.8, 0.8);
  m.roughness = 1.0;
  // 顶点色原本是"最终 albedo"，会与真实贴图相乘把画面染绿；区域语义已由 splat 承担
  m.vertexColors = false;
  m.color.set(0xffffff);

  const samplers = {};
  GROUPS.forEach((g, i) => {
    samplers['sD' + i] = { value: set[g].diff };
    samplers['sN' + i] = { value: set[g].nrm };
    samplers['sR' + i] = { value: set[g].rgh };
  });

  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, samplers);
    shader.vertexShader = 'attribute vec4 splat;\nattribute float trailrock;\nvarying vec4 vSplat;\nvarying float vTrailRock;\nvarying vec3 vRockWorldPos;\nvarying vec3 vRockWorldNrm;\n'
      + shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvSplat = splat;\n\tvTrailRock = trailrock;\n\tvRockWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n\tvRockWorldNrm = normalize(mat3(modelMatrix) * normal);'
      );
    let fs = FRAG_DECL + shader.fragmentShader;
    fs = fs.replace('#include <map_fragment>',
      'diffuseColor.rgb *= splatAlbedo( vMapUv, vRockWorldPos, vRockWorldNrm );');
    fs = fs.replace('#include <roughnessmap_fragment>',
      'float roughnessFactor = clamp( 0.68 + splatRough( vMapUv, vRockWorldPos, vRockWorldNrm ) * 0.32, 0.0, 1.0 ) * roughness;');
    fs = fs.split('texture2D( normalMap, vNormalMapUv ).xyz')
      .join('splatNormal( vMapUv, vRockWorldPos, vRockWorldNrm )');
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => 'terrain-splat-v15-trailrock';
  m.needsUpdate = true;
  console.log('[pbr] 地形 4 路 splat 材质已启用');
  return true;
}

// ---------------------------------------------------------------------------
// Radiance .hdr (RGBE RLE) 解析 → DataTexture → PMREM 环境光
//   不引入 RGBELoader（vendor 里没有），自带一个最小解析器；
//   解码时顺便 2x2 下采样到 1K 并翻转行序（DataTexture 第一行 = v0 = 地平线以下）
// ---------------------------------------------------------------------------
function parseHDR(arrayBuffer) {
  const b = new Uint8Array(arrayBuffer);
  let p = 0;
  const line = () => {
    let s = '';
    while (p < b.length && b[p] !== 10) s += String.fromCharCode(b[p++]);
    p++;
    return s;
  };
  if (!line().startsWith('#?')) return null;
  let dim = '', guard = 0;
  while (guard++ < 30) {
    const l = line();
    if (/^[-+]Y\s+\d+\s+[-+]X\s+\d+/.test(l)) { dim = l; break; }
  }
  const dm = dim.match(/([-+])Y\s+(\d+)\s+([-+])X\s+(\d+)/);
  if (!dm) return null;
  const h = +dm[2], w = +dm[4];
  const oh = h >> 1, ow = w >> 1;
  const out = new Float32Array(ow * oh * 4);
  const chan = [new Uint8Array(w), new Uint8Array(w), new Uint8Array(w), new Uint8Array(w)];

  for (let y = 0; y < h; y++) {
    const rle = w >= 8 && w < 0x8000 && b[p] === 2 && b[p + 1] === 2
      && ((b[p + 2] << 8) | b[p + 3]) === w;
    if (rle) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < w && p < b.length) {
          const n = b[p++];
          if (n > 128) {
            const v = b[p++], cnt = n - 128;
            for (let k = 0; k < cnt && x < w; k++) chan[c][x++] = v;
          } else {
            for (let k = 0; k < n && x < w; k++) chan[c][x++] = b[p++];
          }
        }
      }
    } else {
      for (let x = 0; x < w; x++) {
        chan[0][x] = b[p]; chan[1][x] = b[p + 1];
        chan[2][x] = b[p + 2]; chan[3][x] = b[p + 3];
        p += 4;
      }
    }
    // 2x2 盒式降采样；dy 翻转行序，让 HDR 的天顶落在纹理 v=1
    const dy = oh - 1 - (y >> 1);
    for (let x = 0; x < w; x++) {
      const e = chan[3][x];
      const f = e ? Math.pow(2, e - 136) : 0;
      const dx = x >> 1;
      const o = (dy * ow + dx) * 4;
      out[o] += chan[0][x] * f * 0.25;
      out[o + 1] += chan[1][x] * f * 0.25;
      out[o + 2] += chan[2][x] * f * 0.25;
      out[o + 3] = 1;
    }
  }
  return { data: out, width: ow, height: oh };
}

// float32 -> float16 位模式（与 three DataUtils.toHalfFloat 同算法）
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
function toHalf(val) {
  _f32[0] = val;
  const x = _u32[0];
  let bits = (x >> 16) & 0x8000;
  let m = (x >> 12) & 0x07ff;
  const e = (x >> 23) & 0xff;
  if (e < 103) return bits;
  if (e > 142) { bits |= 0x7c00; bits |= ((e === 255) ? 0 : 1) && (x & 0x007fffff); return bits; }
  if (e < 113) { m |= 0x0800; bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1); return bits; }
  bits |= ((e - 112) << 10) | (m >> 1);
  bits += m & 1;
  return bits;
}

export async function loadSkyEnv(renderer, scene) {
  let ab;
  try {
    const r = await fetch(url('sky.hdr'));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    ab = await r.arrayBuffer();
  } catch (e) {
    console.log('[pbr] sky.hdr 未找到，沿用着色器天空环境光');
    return null;
  }
  let hdr;
  try { hdr = parseHDR(ab); } catch (e) { hdr = null; }
  if (!hdr) { console.warn('[pbr] sky.hdr 解析失败，沿用着色器天空'); return null; }

  // HalfFloatType 是 WebGL2 下 PMREM 的标准输入；FloatType 在部分实现
  // （尤其软件渲染）会因 float 线性过滤缺扩展而产生 NaN，把整个场景照黑。
  let mn = Infinity, mx = -Infinity, bad = 0;
  const half = new Uint16Array(hdr.data.length);
  for (let i = 0; i < hdr.data.length; i++) {
    let v = hdr.data[i];
    if (!Number.isFinite(v)) { v = 0; bad++; }
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    half[i] = toHalf(Math.min(64, Math.max(0, v)));
  }
  console.log('[pbr] HDR 数值 min/max/非有限 =', mn.toFixed(4), mx.toFixed(2), bad);
  const tex = new THREE.DataTexture(half, hdr.width, hdr.height, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  let rt = null;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    rt = pmrem.fromEquirectangular(tex);
    pmrem.dispose();
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.5;
    console.log('[pbr] HDRI 环境光已启用 ' + hdr.width + 'x' + hdr.height);
  } catch (e) {
    console.warn('[pbr] PMREM 生成失败', e);
  } finally { tex.dispose(); }
  return rt ? rt.texture : null;
}
