// 水面：三频法线 + 水深渐变 + 岸线泡沫 + Schlick 菲涅尔 + 太阳碎金高光 + 顶点细浪
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
};
const mats = [];
let loaded = false;
let envRef = null;

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
  shared.uTime.value = t;
  const e = envRef;
  if (!e) return;
  // env.update 里 useMoon 的判据是太阳高度 < -0.02；sunDir.y 与其同号，可直接判定
  shared.uSunDir.value.copy(e.sunDir.y < -0.02 ? e.moonDir : e.sunDir);
  shared.uSunCol.value.copy(e.sun.color);
  shared.uSunPower.value = Math.min(1, Math.max(0, e.sun.intensity / 3.0));
}

export function waterState() {
  return {
    tex: loaded,
    time: +shared.uTime.value.toFixed(1),
    materials: mats.length,
    sunPower: +shared.uSunPower.value.toFixed(2),
    sunDir: shared.uSunDir.value.toArray().map(v => +v.toFixed(2)),
    sunColor: '#' + shared.uSunCol.value.getHexString(),
  };
}

const VERT_DECL = `
uniform float uTime;
uniform float uWave;
varying vec2 vWorldXZ;
`;
const VERT_BODY = `
  #include <begin_vertex>
  float wv = sin(transformed.x * 0.125 + uTime * 1.05) * 0.055
           + sin(transformed.y * 0.171 - uTime * 0.83) * 0.038
           + sin((transformed.x + transformed.y) * 0.082 + uTime * 0.55) * 0.045;
  transformed.z += wv * uWave;
  vWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
`;
const FRAG_DECL = `
uniform float uTime, uHasTex, uOpacity, uNrmScale, uRipple, uFoam;
uniform float uSunPower, uSunGloss, uSunStrength;
uniform sampler2D uWaterTex, uDepth;
uniform vec2 uCenter, uSize;
uniform vec3 uDeep, uShallow, uSunDir, uSunCol;
varying vec2 vWorldXZ;
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
              + (c.rg * 2.0 - 1.0) * 0.22) * uRipple;
  vec3 wn = normalize(vec3(slope.x, 1.0, slope.y));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);

  // 水深：0 = 贴岸 / 1 = 深水（由 CPU 端按地形高度场烘焙成深度图）
  vec2 duv = clamp((vWorldXZ - uCenter) / uSize + 0.5, 0.001, 0.999);
  float dep = texture2D(uDepth, duv).r;
  float d = smoothstep(0.015, 0.80, dep);
  vec3 water = mix(uShallow, uDeep, d);

  float fn1 = mix(0.5, a.b, uHasTex);
  float fn2 = mix(0.5, b.b, uHasTex);
  float crest = clamp(fn1 * 0.68 + fn2 * 0.52, 0.0, 1.0);
  // 浅滩破碎白沫：只出现在贴岸的一条窄带，避免整片海面撒满白色麻点
  float band = smoothstep(0.0, 0.035, dep) * (1.0 - smoothstep(0.08, 0.34, dep));
  float foam = band * smoothstep(0.52, 0.90, crest) * uFoam;
  foam += smoothstep(0.96, 1.0, crest) * 0.02 * uFoam * d;

  // Schlick 菲涅尔（水 F0 ≈ 0.02）：掠射角更亮更不透明，远处海面才会映出天光
  vec3 vdir = normalize(vViewPosition);
  float cosTheta = clamp(dot(vdir, normal), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosTheta, 5.0);
  water = mix(water, vec3(0.62, 0.74, 0.80), fres * 0.24);
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
  // 贴岸的极浅水淡出，避免水面矩形/凹陷边缘出现硬贴片感
  diffuseColor.a = clamp(uOpacity * mix(0.35, 1.0, d)
    + fres * 0.28 * (0.35 + 0.65 * d), 0.0, 1.0);
`;

/**
 * @param {object} o
 *  center/size: 水面中心与尺寸（世界米），depth: 深度 DataTexture
 *  deep/shallow: 深浅水色, nrmScale: 法线每米 UV, ripple/wave/foam: 强度
 *  sunGloss/sunStrength: 太阳高光锐度与强度
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
  m.customProgramCacheKey = () => 'isle-water-v2';
  m.userData.waterU = U;
  m.needsUpdate = true;
  mats.push(m);
  return m;
}
