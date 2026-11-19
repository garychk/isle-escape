// 水面：Gerstner 主浪 + 三频法线 + 水深渐变 + 岸线泡沫 + Schlick 菲涅尔 + 太阳碎金高光
//   贴图 assets/tex/water_norm.png（tools/make_water.py 生成）；缺失时静默回退程序化法线。
//   基于 MeshStandardMaterial 注入，保留 three 自带的 PBR 反射 / 光照 / 雾 / 阴影链路。
import * as THREE from 'three';
import { waterNormal } from './textures.js';

const url = f => new URL('assets/tex/' + f,
  (typeof document !== 'undefined' && document.baseURI) || 'http://localhost/').href;

// 三片水域共享同一张贴图、时间、太阳状态，避免多次上传 / 状态不同步
const shared = {
  uTime: { value: 0 },
  uWaterTex: { value: null },
  uHasTex: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.4) },
  uSunCol: { value: new THREE.Color(0xfff2d8) },
  uSunPower: { value: 1 },
    uFogCol: { value: new THREE.Color(0xa8b6a4) },  // 远海融入雾色用，每帧从 env.scene.fog.color 同步
    uWind: { value: 0.25 },        // 0 微风 ~ 1.2 风暴；由 env.rain/weather 每帧同步
    uWaveEnable: { value: 1 },     // ?nowaves=1 整体关闭主浪
    uKillInland: { value: new THREE.Vector2(0, 0) },
};
const mats = [];
let loaded = false;
let envRef = null;
// QA 冻结开关：setFx(false) 时连同 uTime 一起停住，对照组的画面完全静止
let frozen = false;

/** QA 专用：冻结水面时间（法线滚动/浪相位全部停住），供开/关像素差对照 */
export function setWaterFrozen(v) { frozen = !!v; }

export async function loadWaterTextures(forceFallback = false) {
  if (shared.uWaterTex.value) return loaded;
  const t = forceFallback ? null : await new Promise(res => {
    new THREE.TextureLoader().load(url('water_norm.png'), tt => res(tt), undefined, () => res(null));
  });
  if (t) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    shared.uWaterTex.value = t;
    shared.uHasTex.value = 1;
    loaded = true;
  } else {
    // 回退：旧程序化圆斑法线，画面不至于开天窗
    const f = waterNormal();
    f.wrapS = f.wrapT = THREE.RepeatWrapping;
    f.needsUpdate = true;
    shared.uWaterTex.value = f;
    shared.uHasTex.value = 0;
  }
  console.log('[water] 法线贴图:', loaded ? 'water_norm.png' : '回退程序化');
  return loaded;
}

/** 绑定环境系统：太阳方向/颜色/强度直接跟随真实 DirectionalLight，昼夜、云量、雨天、洞穴自动生效 */
export function bindWaterEnv(env) { envRef = env; }

export function setWaterTime(t) {
  if (!frozen) shared.uTime.value = t;
  const e = envRef;
  // 风暴 / 雨天浪更高更急；uWind 同时驱动振幅与推进速度
  shared.uWind.value = e
    ? Math.min(1.2, 0.28 + (e.rain || 0) * 0.72 + (e.weather === 'storm' ? 0.22 : 0))
    : 0.25;
  if (!e) return;
  // env.update 里 useMoon 的判据是太阳高度 < -0.02；sunDir.y 与其同号，可直接判定
  shared.uSunDir.value.copy(e.sunDir.y < -0.02 ? e.moonDir : e.sunDir);
  shared.uSunCol.value.copy(e.sun.color);
  shared.uSunPower.value = Math.min(1, Math.max(0, e.sun.intensity / 3.0));
  // 远海融合色跟随全局雾色（env.update 每帧已把 fog 色写入 scene.fog.color）
  if (e.scene && e.scene.fog) shared.uFogCol.value.copy(e.scene.fog.color);
}

/** ?nowaves=1：关掉顶点主浪，保留法线波纹，便于前后对比 */
export function setWavesEnabled(v) { shared.uWaveEnable.value = v ? 1 : 0; }

export function waterState() {
  const sea = mats.length ? mats[0].userData.waterU : null;
  return {
    tex: loaded,
    time: +shared.uTime.value.toFixed(1),
    materials: mats.length,
    waves: shared.uWaveEnable.value > 0,
    wind: +shared.uWind.value.toFixed(2),
    waveAmp: sea
      ? +(sea.uWave.value * (0.78 + 0.60 * shared.uWind.value) * shared.uWaveEnable.value).toFixed(2)
      : 0,
    sunPower: +shared.uSunPower.value.toFixed(2),
    sunDir: shared.uSunDir.value.toArray().map(v => +v.toFixed(2)),
    sunColor: '#' + shared.uSunCol.value.getHexString(),
  };
}

const VERT_DECL = `
uniform float uTime;
uniform float uWave;
uniform float uWind;
uniform float uWaveEnable;
uniform vec2 uCenter, uSize;
varying vec2 vWorldXZ;
varying vec2 vWaveSlope;
varying float vWaveCrest;
`;
// Gerstner 波：横向位移让波峰变尖、波谷变圆，浪才有"形"；同时给出解析法线与波峰高度，
// 供片元把高光/碎浪白沫对齐到浪脊上。相位用世界 xz，所有水域共享同一片涌向岸的波场。
const VERT_BODY = `
  #include <begin_vertex>
  vec2 P = (modelMatrix * vec4(position, 1.0)).xz;
  float T = uTime * (0.85 + 0.45 * uWind);
  float A = uWave * (0.78 + 0.60 * uWind) * uWaveEnable;
  vec2 disp = vec2(0.0);
  float h = 0.0;
  vec2 nrm = vec2(0.0);
  // 长涌浪 78m：决定海面轮廓
  vec2 D1 = vec2(0.861, 0.508);
  float k1 = 6.2831853 / 78.0;
  float f1 = k1 * dot(D1, P) - T * 0.373;
  float a1 = 0.42 * A;
  disp += 0.55 * a1 * D1 * cos(f1);
  h += a1 * sin(f1);
  nrm += -D1 * (k1 * a1) * cos(f1);
  // 中浪 46m：斜切过来，打散规则条纹
  vec2 D2 = vec2(0.555, -0.832);
  float k2 = 6.2831853 / 46.0;
  float f2 = k2 * dot(D2, P) - T * 0.486 + 1.7;
  float a2 = 0.26 * A;
  disp += 0.55 * a2 * D2 * cos(f2);
  h += a2 * sin(f2);
  nrm += -D2 * (k2 * a2) * cos(f2);
  // 短浪 27m：细碎浪尖
  vec2 D3 = vec2(-0.287, -0.958);
  float k3 = 6.2831853 / 27.0;
  float f3 = k3 * dot(D3, P) - T * 0.634 + 3.1;
  float a3 = 0.14 * A;
  disp += 0.55 * a3 * D3 * cos(f3);
  h += a3 * sin(f3);
  nrm += -D3 * (k3 * a3) * cos(f3);
  // 靠近水面矩形边缘把浪渐隐到 0，否则横向位移会把边界拉出锯齿/漏底
  vec2 eb = abs(P - uCenter) / (uSize * 0.5);
  float fade = 1.0 - smoothstep(0.74, 0.99, max(eb.x, eb.y));
  h *= fade; disp *= fade; nrm *= fade;
  // 水面网格绕 X 轴 -90°：局部 x→世界 x，局部 y→世界 -z，局部 z→世界 y
  transformed.x += disp.x;
  transformed.y += -disp.y;
  transformed.z += h;
  vWaveSlope = nrm;
  vWaveCrest = clamp(h / max(0.82 * A, 0.001) * 0.5 + 0.5, 0.0, 1.0);
  vWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
`;
const FRAG_DECL = `
uniform float uTime, uHasTex, uOpacity, uNrmScale, uRipple, uFoam;
uniform float uSunPower, uSunGloss, uSunStrength;
uniform float uWaveFoam;
uniform sampler2D uWaterTex, uDepth;
uniform vec2 uCenter, uSize;
uniform vec3 uDeep, uShallow, uSunDir, uSunCol, uFogCol;
uniform vec2 uKillInland;   // 内陆遮罩半径 [r0,r1]：r<r0 整片隐掉；(0,0)=不启用
varying vec2 vWorldXZ;
varying vec2 vWaveSlope;
varying float vWaveCrest;
`;

// 插在 <normal_fragment_maps> 之后：此时 normal 已就绪，diffuseColor 尚未参与光照，
// totalEmissiveRadiance 也可写（用于不受透明度稀释的镜面太阳高光）
const FRAG_BODY = `
  vec2 wuv = vWorldXZ * uNrmScale;
  vec2 flow1 = vec2(uTime * 0.012, uTime * 0.007);
  vec2 flow2 = vec2(-uTime * 0.019, uTime * 0.015);
  vec2 flow3 = vec2(uTime * 0.031, -uTime * 0.024);
  vec4 a = texture2D(uWaterTex, wuv + flow1);
  vec4 b = texture2D(uWaterTex, wuv * 1.93 + vec2(0.37, 0.61) + flow2);
  vec4 c = texture2D(uWaterTex, wuv * 3.71 + vec2(0.71, 0.23) + flow3);
  // 三频：长涌浪 / 中波纹 / 细涟漪，方向互不相同，打散平铺感
  vec2 slope = ((a.rg * 2.0 - 1.0) * 0.80
              + (b.rg * 2.0 - 1.0) * 0.48
              + (c.rg * 2.0 - 1.0) * 0.22) * uRipple
              + vWaveSlope * 1.45;   // 浪形法线：让太阳高光与天光反射沿着浪脊分布
  vec3 wn = normalize(vec3(slope.x, 1.0, slope.y));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);

  // 水深：0 = 贴岸 / 1 = 深水（由 CPU 端按地形高度场烘焙成深度图）
  // alpha 通道是盆地掩码：水面矩形超出挖盆范围的部分 = 0，直接隐掉（杜绝陆地上悬空水）
  vec2 duv = clamp((vWorldXZ - uCenter) / uSize + 0.5, 0.001, 0.999);
  vec4 dtx = texture2D(uDepth, duv);
  float dep = dtx.r;
  float basin = dtx.a;
  float d = smoothstep(0.015, 0.80, dep);
  vec3 water = mix(uShallow, uDeep, d);

  float fn1 = mix(0.5, a.b, uHasTex);
  float fn2 = mix(0.5, b.b, uHasTex);
  float crest = clamp(fn1 * 0.68 + fn2 * 0.52, 0.0, 1.0);
  // 浅滩破碎白沫：只出现在贴岸的一条窄带，避免整片海面撒满白色麻点
  float band = smoothstep(0.0, 0.035, dep) * (1.0 - smoothstep(0.08, 0.34, dep));
  float foam = band * smoothstep(0.52, 0.90, crest) * uFoam;
  foam += smoothstep(0.96, 1.0, crest) * 0.02 * uFoam * d;
  // 浪尖碎浪：只在波峰顶一条窄带、且离开浅滩后出现，随浪一起移动（不是静态白点）
  float waveFoam = smoothstep(0.80, 0.995, vWaveCrest)
                 * smoothstep(0.20, 0.55, d) * uWaveFoam;
  foam += waveFoam * (0.55 + 0.45 * crest);

  // Schlick 菲涅尔（水 F0 ≈ 0.02）：掠射角更亮更不透明，远处海面才会映出天光
  vec3 vdir = normalize(vViewPosition);
  float cosTheta = clamp(dot(vdir, normal), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosTheta, 5.0);
  water = mix(water, vec3(0.62, 0.74, 0.80), fres * 0.24);
  // 波峰迎光面略亮，浪谷更深，起伏一眼可辨
  water += vec3(0.015, 0.030, 0.036) * max(vWaveCrest - 0.60, 0.0) * (0.4 + 0.6 * d);
  // 水下细碎光斑，浅水更明显
  water += vec3(0.035, 0.045, 0.038) * (crest - 0.5) * (1.0 - d) * 0.45;

  // 太阳碎金光路：Blinn 半角高光打到波纹法线上，高次幂形成细碎闪点 + 低次幂柔光晕
  // 写进自发光而非 albedo，避免被 diffuse / 透明度二次削弱；uSunPower 已含昼夜、云雨、洞穴衰减
  vec3 Lsun = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  vec3 Hs = normalize(Lsun + vdir);
  float ndh = max(dot(normal, Hs), 0.0);
  float sunVis = uSunPower * uSunStrength;
  float glint = pow(ndh, uSunGloss) * (0.35 + 0.65 * fres) * sunVis;
  float sheen = pow(ndh, 12.0) * 0.055 * sunVis;
  totalEmissiveRadiance += uSunCol * (glint + sheen);

  diffuseColor.rgb = mix(water, vec3(0.88, 0.93, 0.94), foam);
  // 贴岸的极浅水淡出，避免水面矩形/凹陷边缘出现硬贴片感；再乘盆地掩码，
  // 越过盆地的矩形悬空部分整片透明，陆地上不再浮水
  diffuseColor.a = clamp(uOpacity * mix(0.35, 1.0, d)
    + fres * 0.28 * (0.35 + 0.65 * d), 0.0, 1.0) * basin;
  // 内陆防漏（仅海面启用）：海面矩形覆盖全球，凡内陆地形低于海平面的地方
  // （断魂谷河床、丘陵随机洼地）都会被灌进蓝色海水，与旁边水塘的淡水判若两物。
  // 这里按离岛中心的半径把内陆整片隐掉——内陆水一律由独立淡水 plane 承载。
  // 阈值依据：内陆地形最低点 r≈235（再低也是谷底河床，走淡水河 plane），
  // 海岸水线最小 r≈264，[238,248] 两侧都留足余量，海岸外观零变化。
  float ir = distance(vWorldXZ, vec2(0.0));
  diffuseColor.a *= mix(1.0, smoothstep(uKillInland.x, uKillInland.y, ir), step(0.5, uKillInland.y));
  // 远海融入地平线雾：随距离把水色压向雾色（与天空霾带、scene.fog 同源），
  // 海面矩形边缘处已 ≈100% 雾色 → 与天空霾带无缝衔接，看不出世界边际。
  // 水塘/沼泽尺寸 <200m，smoothstep 在其上恒为 0，不受影响。
  float hd = distance(vWorldXZ, cameraPosition.xz);
  diffuseColor.rgb = mix(diffuseColor.rgb, uFogCol, smoothstep(240.0, 540.0, hd) * 0.9);
`;

/**
 * @param {object} o
 *  center/size: 水面中心与尺寸（世界米），depth: 深度 DataTexture
 *  deep/shallow: 深浅水色, nrmScale: 法线每米 UV, ripple: 细波纹强度
 *  wave: Gerstner 主浪幅度倍率（海 1.0 / 静水 ~0.1）, foam: 岸线泡沫
 *  waveFoam: 浪尖碎浪白沫强度, sunGloss/sunStrength: 太阳高光锐度与强度
 */
export function createWaterMaterial(o) {
  const U = {
    uTime: shared.uTime,
    uWaterTex: shared.uWaterTex,
    uHasTex: shared.uHasTex,
    uSunDir: shared.uSunDir,
    uSunCol: shared.uSunCol,
    uSunPower: shared.uSunPower,
    uSunGloss: { value: o.sunGloss ?? 90 },
    uSunStrength: { value: o.sunStrength ?? 0.4 },
    uDepth: { value: o.depth },
    uCenter: { value: new THREE.Vector2(o.center[0], o.center[1]) },
    uSize: { value: new THREE.Vector2(o.size[0], o.size[1]) },
    uDeep: { value: new THREE.Color(o.deep) },
    uShallow: { value: new THREE.Color(o.shallow) },
    uOpacity: { value: o.opacity },
    uNrmScale: { value: o.nrmScale },
    uRipple: { value: o.ripple },
    uWave: { value: o.wave },
    uFoam: { value: o.foam },
    uWaveFoam: { value: o.waveFoam ?? 0.55 },
    uWind: shared.uWind,
    uWaveEnable: shared.uWaveEnable,
    uKillInland: { value: new THREE.Vector2(
      o.killInland ? o.killInland[0] : 0, o.killInland ? o.killInland[1] : 0) },
  };
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: o.opacity,
    roughness: o.rough,
    metalness: o.metalness ?? 0.08,
    depthWrite: false,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = VERT_DECL + shader.vertexShader.replace(
      '#include <begin_vertex>', VERT_BODY);
    shader.fragmentShader = FRAG_DECL + shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      '#include <normal_fragment_maps>\n' + FRAG_BODY);
  };
  m.customProgramCacheKey = () => 'isle-water-v4';
  m.userData.waterU = U;
  m.needsUpdate = true;
  mats.push(m);
  return m;
}

// ---------------------------------------------------------------------------
// 跌水材质（2026-11-19）：两片水位不同的水域交界处，贴地形铺"往下流"的白水飘带。
// uv.y 沿流向增长（单位 = 2.2m），噪声沿 +uv.y 方向滚动 = 水往低处流。
// 走 MeshStandardMaterial 注入：白拿雾/光照/昼夜/阴影兼容；shared.uTime 统一驱动。
// ---------------------------------------------------------------------------
const CAS_VERT = 'varying vec2 vCuv;\n';
const CAS_FRAG = `
varying vec2 vCuv;
uniform float uTime;
float casHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float casNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(casHash(i), casHash(i + vec2(1.0, 0.0)), f.x),
             mix(casHash(i + vec2(0.0, 1.0)), casHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

export function createCascadeMaterial() {
  const m = new THREE.MeshStandardMaterial({
    // 2026-11-19 用户：白布条太假、颜色和水对不上——
    // 透明度降到 0.68、粗糙度提高消高光，基色贴水体浅水色，白水只在流纹处出现
    color: 0xffffff, transparent: true, opacity: 0.68,
    roughness: 0.72, metalness: 0, depthWrite: false,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = CAS_VERT + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n\tvCuv = uv;');
    shader.fragmentShader = CAS_FRAG + shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        float flow = vCuv.y * 2.2 - uTime * 1.5;             // 沿流向滚动（+y = 下坡方向）
        float n1 = casNoise(vec2(vCuv.x * 6.0, flow));        // 顺流拉长的水纹
        float n2 = casNoise(vec2(vCuv.x * 13.0 + 4.7, flow * 1.9 + 2.0));
        float streak = smoothstep(0.38, 0.80, n1 * 0.62 + n2 * 0.38);
        float edge = smoothstep(0.0, 0.24, vCuv.x) * smoothstep(1.0, 0.76, vCuv.x);
        // 基色 = 浅水绿（与水潭/河道 shallow 同系），白水只叠在流纹上且不过曝
        diffuseColor.rgb = mix(vec3(0.30, 0.38, 0.35), vec3(0.78, 0.84, 0.81), 0.22 + streak * 0.68);
        diffuseColor.a *= edge * smoothstep(0.0, 0.18, vCuv.y);   // 顶端渐隐融入岸线
      }`);
  };
  m.customProgramCacheKey = () => 'isle-cascade-v2';
  m.needsUpdate = true;
  return m;
}
