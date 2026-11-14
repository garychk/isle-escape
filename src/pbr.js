// 真实 PBR 贴图接入（Poly Haven "A Verdant Trail"，CC0）
//   assets/tex/ 下 4 组地面 PBR（albedo / normal / roughness）+ 植被 RGBA + sky.hdr
//   全部文件缺失时静默回退到原程序化材质，游戏照常启动。
import * as THREE from 'three';

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
  // 只加载 textures.js 已接入 override 的三张；leaf_shrub/tree_a/tree_b 留在 tex/ 备用
  const foliageFiles = {
    grass: 'leaf_grass.png', fern: 'leaf_fern.png', litter: 'leaf_litter.png',
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
  console.log('[pbr] 地面组:', ok ? Object.keys(ground).join(',') : '(回退)',
    '| 植被:', Object.keys(foliage).join(',') || '(回退)');
  return { ground: ok ? ground : null, foliage };
}

// ---------------------------------------------------------------------------
// 地形 splat：4 组 albedo / normal / roughness 按顶点权重混合
//   权重来自 geometry 的 'splat' 属性（vec4：林地/泥土/岩石/沙滩）
//   用 onBeforeCompile 注入 MeshStandardMaterial，保留原有光照/阴影/雾的全部逻辑
// ---------------------------------------------------------------------------
const FRAG_DECL = `
varying vec4 vSplat;
uniform sampler2D sD0, sD1, sD2, sD3;
uniform sampler2D sN0, sN1, sN2, sN3;
uniform sampler2D sR0, sR1, sR2, sR3;
vec3 splatAlbedo(vec2 uv) {
  // 该素材包偏黄褐（南非干草原），逐层轻微往热带绿/冷灰校正
  vec3 a = texture2D(sD0, uv).rgb * vec3(0.84, 0.98, 0.80) * vSplat.x;
  a += texture2D(sD1, uv).rgb * vec3(0.90, 0.87, 0.78) * vSplat.y;
  a += texture2D(sD2, uv).rgb * vec3(0.80, 0.86, 0.80) * vSplat.z;   // 岩壁压暗，避免灰白抢眼
  a += texture2D(sD3, uv).rgb * vec3(0.88, 0.89, 0.83) * vSplat.w;   // 沙滩略压，贴合湿沙
  return a;
}
vec3 splatNormal(vec2 uv) {
  vec3 n = texture2D(sN0, uv).xyz * vSplat.x;
  n += texture2D(sN1, uv).xyz * vSplat.y;
  n += texture2D(sN2, uv).xyz * vSplat.z;
  n += texture2D(sN3, uv).xyz * vSplat.w;
  return n;
}
float splatRough(vec2 uv) {
  float r = texture2D(sR0, uv).g * vSplat.x;
  r += texture2D(sR1, uv).g * vSplat.y;
  r += texture2D(sR2, uv).g * vSplat.z;
  r += texture2D(sR3, uv).g * vSplat.w;
  return r;
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
    shader.vertexShader = 'attribute vec4 splat;\nvarying vec4 vSplat;\n'
      + shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvSplat = splat;'
      );
    let fs = FRAG_DECL + shader.fragmentShader;
    fs = fs.replace('#include <map_fragment>',
      'diffuseColor.rgb *= splatAlbedo( vMapUv );');
    fs = fs.replace('#include <roughnessmap_fragment>',
      'float roughnessFactor = clamp( 0.68 + splatRough( vMapUv ) * 0.32, 0.0, 1.0 ) * roughness;');
    fs = fs.split('texture2D( normalMap, vNormalMapUv ).xyz')
      .join('splatNormal( vMapUv )');
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => 'terrain-splat-v1';
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
