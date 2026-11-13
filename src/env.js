// 环境系统：昼夜循环 / 动态天空 / 云 / 星空 / 降雨 / 雷电 / 地面湿度
import * as THREE from 'three';
import { clamp, smoothstep } from './util.js';

// 一天中各时刻的天空/光照色（线性插值）
const KEYS = [
  { h: 0.0, zen: 0x04060e, hor: 0x0d1422, hemiS: 0x27324c, hemiG: 0x1d2418, sun: 0x8ea6dd, cloudD: 0x10162a, cloudL: 0x2a3550, fog: 0x0f1622, night: 1 },
  { h: 4.6, zen: 0x0a1122, hor: 0x1d2436, hemiS: 0x202a46, hemiG: 0x161c16, sun: 0x9db0d8, cloudD: 0x18203a, cloudL: 0x38425c, fog: 0x18202c, night: 0.92 },
  { h: 5.9, zen: 0x2b3f60, hor: 0x8a5c48, hemiS: 0x3a4a62, hemiG: 0x1c1e14, sun: 0xff9a55, cloudD: 0x3a3244, cloudL: 0xc08464, fog: 0x4a4148, night: 0.45 },
  { h: 6.9, zen: 0x5e88b8, hor: 0xdda068, hemiS: 0x7a94b0, hemiG: 0x2a3020, sun: 0xffc07a, cloudD: 0x6a6a78, cloudL: 0xf0c096, fog: 0x9a9484, night: 0.08 },
  { h: 9.0, zen: 0x6b9fd4, hor: 0xc6cfc2, hemiS: 0xa8c2d8, hemiG: 0x3c4a2c, sun: 0xfff0d2, cloudD: 0x8a9298, cloudL: 0xfafbf6, fog: 0xa8b6a4, night: 0 },
  { h: 12.5, zen: 0x649cd6, hor: 0xc2cdc0, hemiS: 0xb0cbe0, hemiG: 0x40502e, sun: 0xfff6e0, cloudD: 0x8e969c, cloudL: 0xffffff, fog: 0xacb8a6, night: 0 },
  { h: 16.0, zen: 0x6d97c8, hor: 0xcbcaae, hemiS: 0xaec4d4, hemiG: 0x3e4a2c, sun: 0xffeecd, cloudD: 0x8c9098, cloudL: 0xf6f0e2, fog: 0xa8b0a0, night: 0 },
  { h: 18.4, zen: 0x3c4a74, hor: 0xd8824c, hemiS: 0x8a7a86, hemiG: 0x2a2618, sun: 0xff8a45, cloudD: 0x4a4050, cloudL: 0xe0925e, fog: 0x836f66, night: 0.3 },
  { h: 19.6, zen: 0x141c33, hor: 0x3a2c3e, hemiS: 0x333a54, hemiG: 0x181c18, sun: 0xb08a90, cloudD: 0x22283c, cloudL: 0x4a4258, fog: 0x2a2a34, night: 0.8 },
  { h: 21.5, zen: 0x070c18, hor: 0x141c2c, hemiS: 0x27324c, hemiG: 0x1d2418, sun: 0x8ea6dd, cloudD: 0x121a2e, cloudL: 0x2c3752, fog: 0x141c28, night: 1 },
  { h: 24.0, zen: 0x04060e, hor: 0x0d1422, hemiS: 0x27324c, hemiG: 0x1d2418, sun: 0x8ea6dd, cloudD: 0x10162a, cloudL: 0x2a3550, fog: 0x0f1622, night: 1 },
].map(k => ({
  ...k,
  zen: new THREE.Color(k.zen), hor: new THREE.Color(k.hor),
  hemiS: new THREE.Color(k.hemiS), hemiG: new THREE.Color(k.hemiG),
  sun: new THREE.Color(k.sun), cloudD: new THREE.Color(k.cloudD),
  cloudL: new THREE.Color(k.cloudL), fog: new THREE.Color(k.fog),
}));

const SKY_VERT = `
varying vec3 vDir;
void main(){
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = `
precision highp float;
varying vec3 vDir;
uniform vec3 uZen, uHor, uGround, uSunCol, uCloudD, uCloudL, uSunDir, uMoonDir;
uniform float uNight, uCloud, uTime, uFlash, uSunVis;

float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += vnoise(p) * a; p *= 2.03; a *= 0.5; }
  return s;
}
void main(){
  vec3 dir = normalize(vDir);
  float h = dir.y;
  // 天空渐变
  vec3 col = mix(uHor, uZen, pow(clamp(h, 0.0, 1.0), 0.52));
  col = mix(col, uGround, smoothstep(0.015, -0.16, h));

  // 太阳：本体 + 大气辉光
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunCol * (pow(sd, 6.0) * 0.42 + pow(sd, 160.0) * 0.9 + pow(sd, 2600.0) * 6.0) * uSunVis;
  // 月亮
  float md = max(dot(dir, uMoonDir), 0.0);
  col += vec3(0.72, 0.80, 1.0) * (pow(md, 4200.0) * 2.2 + pow(md, 26.0) * 0.035) * uNight;

  // 星空
  if (uNight > 0.02 && h > -0.04) {
    vec3 sp = dir * 260.0;
    vec3 id = floor(sp);
    float r = hash21(id.xy + id.z * 17.0);
    if (r > 0.9955) {
      float d = length(fract(sp) - 0.5);
      float tw = 0.55 + 0.45 * sin(uTime * 1.7 + r * 90.0);
      col += vec3(0.86, 0.92, 1.0) * smoothstep(0.36, 0.0, d) * tw * uNight * 1.35;
    }
  }

  // 云层：方向投影到平面后取噪声（热带积云）
  vec2 cuv = dir.xz / max(h + 0.22, 0.06) * 0.55;
  float t = uTime * 0.004;
  float n = fbm(cuv * 1.15 + vec2(t, t * 0.6)) * 0.72
          + fbm(cuv * 2.6 - vec2(t * 1.7, 0.0)) * 0.28;
  float cover = smoothstep(0.52 - uCloud * 0.34, 0.86, n);
  float fade = smoothstep(-0.02, 0.22, h);
  vec3 cloudCol = mix(uCloudD, uCloudL, smoothstep(0.35, 0.95, n));
  cloudCol += uSunCol * pow(max(dot(dir, uSunDir), 0.0), 4.0) * 0.25 * uSunVis;
  col = mix(col, cloudCol, cover * fade * 0.95);

  // 闪电照亮云层
  col += uFlash * vec3(0.72, 0.78, 1.0) * (0.35 + cover * 1.5);
  gl_FragColor = vec4(col, 1.0);
}`;

// 雨：GPU 驱动的线段，跟随相机循环
function makeRain() {
  const N = 5200;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 2 * 3);
  const seed = new Float32Array(N * 2 * 3);
  const spd = new Float32Array(N * 2);
  const end = new Float32Array(N * 2);
  const len = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const sx = Math.random() * 2 - 1, sy = Math.random() * 2 - 1, sz = Math.random() * 2 - 1;
    const s = 11 + Math.random() * 10;
    const L = 1.1 + Math.random() * 2.6;
    for (let k = 0; k < 2; k++) {
      const j = i * 2 + k;
      seed[j * 3] = sx; seed[j * 3 + 1] = sy; seed[j * 3 + 2] = sz;
      spd[j] = s; end[j] = k; len[j] = L;
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  g.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.setAttribute('aLen', new THREE.BufferAttribute(len, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uOrigin: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uBox: { value: new THREE.Vector3(46, 26, 46) },
      uWind: { value: 0.16 },
      uColor: { value: new THREE.Color(0xa9c2d6) },
      uOpacity: { value: 0 },
    },
    vertexShader: `
      attribute vec3 aSeed; attribute float aSpeed; attribute float aEnd; attribute float aLen;
      uniform vec3 uOrigin; uniform float uTime; uniform vec3 uBox; uniform float uWind;
      void main(){
        vec3 p = aSeed * uBox;
        float cy = uOrigin.y;
        p.y = mod(p.y - uTime * aSpeed - cy, uBox.y * 2.0) - uBox.y + cy;
        p.x += p.y * uWind * 0.06;
        p += uOrigin;
        if (aEnd > 0.5) { p.y += aLen; p.x += aLen * uWind * 0.06; }
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity;
      void main(){ gl_FragColor = vec4(uColor, uOpacity); }`,
  });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 5;
  return lines;
}

// 萤火虫（夜间）
function makeFireflies() {
  const N = 420;
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(N * 3), ph = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * 6.283, r = 4 + Math.pow(Math.random(), 0.8) * 46;
    p[i * 3] = Math.cos(a) * r; p[i * 3 + 1] = 1.5 + Math.random() * 5; p[i * 3 + 2] = Math.sin(a) * r;
    ph[i] = Math.random() * 6.283;
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
    vertexShader: `
      attribute float aPhase; uniform float uTime; varying float vA;
      void main(){
        vec3 p = position;
        p.x += sin(uTime * 0.7 + aPhase) * 2.2;
        p.y += sin(uTime * 1.3 + aPhase * 1.7) * 1.1;
        p.z += cos(uTime * 0.9 + aPhase) * 2.2;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 2.4 + aPhase * 3.0), 2.0);
        gl_PointSize = 120.0 / max(-mv.z, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uOpacity; varying float vA;
      void main(){
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(d));
        gl_FragColor = vec4(vec3(0.85, 1.0, 0.42) * 1.6, a * vA * uOpacity);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

export class Env {
  constructor({ scene, renderer }) {
    this.scene = scene;
    this.renderer = renderer;
    this.t = 9.2;            // 游戏内小时（开局是上午的雨林）
    this.dayLen = 420;       // 一整天对应的现实秒数
    this.auto = true;
    this.sunDir = new THREE.Vector3(0.4, 0.8, 0.4).normalize();
    this.moonDir = new THREE.Vector3(-0.4, -0.8, -0.4).normalize();
    this.night = 0;
    this.rain = 0; this.rainTarget = 0;
    this.cloud = 0.32; this.cloudTarget = 0.32;
    this.wet = 0;
    this.weather = 'clear';
    this.weatherT = 40;
    this.flash = 0; this.flashT = 0; this.nextLightning = 6;
    this.caveBlend = 0;
    this.terrainMat = null;
    this.onRain = null;      // (level) => void
    this.onThunder = null;

    // —— 天空穹顶 ——
    this.mats = {
      zen: new THREE.Color(), hor: new THREE.Color(), ground: new THREE.Color(),
      sunCol: new THREE.Color(), cloudD: new THREE.Color(), cloudL: new THREE.Color(),
      hemiS: new THREE.Color(), hemiG: new THREE.Color(), fog: new THREE.Color(),
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 48, 32),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
          uZen: { value: this.mats.zen }, uHor: { value: this.mats.hor },
          uGround: { value: this.mats.ground }, uSunCol: { value: this.mats.sunCol },
          uCloudD: { value: this.mats.cloudD }, uCloudL: { value: this.mats.cloudL },
          uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir },
          uNight: { value: 0 }, uCloud: { value: 0.3 }, uTime: { value: 0 },
          uFlash: { value: 0 }, uSunVis: { value: 1 },
        },
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      })
    );
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // —— 光照 ——
    this.hemi = new THREE.HemisphereLight(0xb0cbe0, 0x40502e, 0.95);
    scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0x8fa08a, 0.30);
    scene.add(this.amb);
    this.rim = new THREE.DirectionalLight(0x9db8a4, 0.45);
    this.rim.position.set(-70, 46, -85);
    scene.add(this.rim);
    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -78; this.sun.shadow.camera.right = 78;
    this.sun.shadow.camera.top = 78; this.sun.shadow.camera.bottom = -78;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 340;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.camera.updateProjectionMatrix();
    scene.add(this.sun);
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;

    // —— 雨 / 萤火虫 ——
    this.rainObj = makeRain();
    this.rainObj.visible = false;
    scene.add(this.rainObj);
    this.fireflies = makeFireflies();
    scene.add(this.fireflies);

    scene.fog = new THREE.FogExp2(0xa8b6a4, 0.0024);
    scene.background = new THREE.Color(0xa8b6a4);
    this.fogDensity = 0.0024;
  }

  setTime(h) { this.t = ((h % 24) + 24) % 24; }
  setWeather(w) {
    this.weather = w;
    const T = { clear: [0, 0.26], cloudy: [0.06, 0.72], rain: [0.78, 0.86], storm: [1, 0.98] }[w] || [0, 0.3];
    this.rainTarget = T[0]; this.cloudTarget = T[1];
    if (w === 'clear' || w === 'cloudy') this.rainTarget = w === 'cloudy' ? 0.05 : 0;
    this.weatherT = 55 + Math.random() * 70;
  }

  // 采样一帧的所有色/强度
  sample() {
    const h = this.t;
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (h >= KEYS[i].h && h <= KEYS[i + 1].h) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
    const k = (h - a.h) / Math.max(0.0001, b.h - a.h);
    const L = (ca, cb, out) => out.copy(ca).lerp(cb, k);
    const M = this.mats;
    L(a.zen, b.zen, M.zen);
    L(a.hor, b.hor, M.hor);
    L(a.hemiS, b.hemiS, M.hemiS);
    L(a.hemiG, b.hemiG, M.hemiG);
    L(a.sun, b.sun, M.sunCol);
    L(a.cloudD, b.cloudD, M.cloudD);
    L(a.cloudL, b.cloudL, M.cloudL);
    L(a.fog, b.fog, M.fog);
    this.night = a.night + (b.night - a.night) * k;
    // 地面色（地平线以下）跟随雾色但更暗
    M.ground.copy(M.fog).multiplyScalar(0.72);
  }

  update(dt, camPos, caveBlend = 0) {
    if (this.auto) {
      this.t = (this.t + dt * (24 / this.dayLen)) % 24;
      // 天气轮转
      this.weatherT -= dt;
      if (this.weatherT <= 0) {
        const r = Math.random();
        this.setWeather(r < 0.40 ? 'clear' : r < 0.68 ? 'cloudy' : r < 0.93 ? 'rain' : 'storm');
      }
    }
    this.rain += (this.rainTarget - this.rain) * Math.min(1, dt * 0.35);
    this.cloud += (this.cloudTarget - this.cloud) * Math.min(1, dt * 0.3);
    const ra = this.rain;
    this.wet = clamp(this.wet + (ra > 0.15 ? dt * 0.10 : -dt * 0.022), 0, 1);
    this.caveBlend = caveBlend;

    // —— 天体方位 ——
    const ang = (this.t - 6) / 12 * Math.PI;      // 6 点日出，18 点日落
    const el = Math.sin(ang), hz = Math.cos(ang);
    this.sunDir.set(hz * 0.92, el * 0.88, hz * 0.36 + 0.16).normalize();
    this.moonDir.copy(this.sunDir).multiplyScalar(-1);
    const up = clamp(el, 0, 1);
    const sunVis = smoothstep(-0.05, 0.08, el);

    this.sample();

    // —— 太阳/月亮灯 ——
    const overcast = 1 - this.cloud * 0.62;
    const sunI = Math.pow(up, 0.62) * 3.05 * overcast * (1 - ra * 0.55);
    const moonI = Math.pow(clamp(-el, 0, 1), 0.65) * 1.25 * overcast * (1 - ra * 0.4);
    const useMoon = el < -0.02;
    const dir = useMoon ? this.moonDir : this.sunDir;
    this.sun.color.copy(useMoon ? new THREE.Color(0x9fb6e8) : this.mats.sunCol);
    this.sun.intensity = (useMoon ? moonI : sunI) * (1 - this.caveBlend * 0.96);
    this.sunTarget.position.set(camPos.x, 0, camPos.z);
    this.sunTarget.updateMatrixWorld();
    this.sun.position.set(camPos.x + dir.x * 130, 8 + Math.max(0.06, dir.y) * 150, camPos.z + dir.z * 130);

    // —— 环境光 ——
    const nightK = this.night;
    const ambBoost = 0.34 + nightK * 0.62 + ra * 0.10;
    this.hemi.color.copy(this.mats.hemiS);
    this.hemi.groundColor.copy(this.mats.hemiG);
    this.hemi.intensity = (1.10 * overcast * (1 - nightK * 0.58) + 1.05 * nightK) * (1 - this.caveBlend * 0.80);
    this.amb.color.copy(this.mats.hemiS);
    this.amb.intensity = ambBoost * (1 - this.caveBlend * 0.6);
    this.rim.color.copy(this.mats.hemiS);
    this.rim.intensity = (0.18 + 0.30 * (1 - nightK)) * (1 - this.caveBlend * 0.9);

    // —— 雾 ——
    const fogC = this.mats.fog;
    if (this.scene.fog) {
      this.scene.fog.color.copy(fogC);
      this.scene.fog.density = 0.0021 + nightK * 0.0016 + ra * 0.0042 + this.cloud * 0.0008 + this.caveBlend * 0.006;
    }
    this.scene.background.copy(fogC);

    // —— 天空 uniforms ——
    const u = this.sky.material.uniforms;
    u.uNight.value = nightK;
    u.uCloud.value = clamp(this.cloud + ra * 0.25, 0, 1);
    u.uTime.value = performance.now() / 1000;
    u.uSunVis.value = sunVis;
    u.uFlash.value = this.flash;
    this.sky.position.copy(camPos);

    // —— 雷电 ——
    if (this.weather === 'storm' && ra > 0.5) {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) {
        this.nextLightning = 5 + Math.random() * 14;
        this.flashT = 0.55;
        this.onThunder && this.onThunder(0.25 + Math.random() * 0.9);
      }
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      const f = Math.max(0, this.flashT / 0.55);
      this.flash = (Math.random() < 0.35 ? 1 : 0.35) * f * f * 1.4;
    } else this.flash *= 0.7;

    // —— 雨 ——
    this.rainObj.visible = ra > 0.02;
    if (this.rainObj.visible) {
      const ru = this.rainObj.material.uniforms;
      ru.uOrigin.value.copy(camPos);
      ru.uTime.value = performance.now() / 1000;
      ru.uOpacity.value = 0.10 + ra * 0.30;
      ru.uWind.value = 0.9 + Math.sin(performance.now() * 0.0002) * 0.4;
    }

    // —— 萤火虫 ——
    const ff = this.fireflies.material.uniforms;
    ff.uTime.value = performance.now() / 1000;
    ff.uOpacity.value = clamp(nightK * 1.2 - 0.15, 0, 1) * (1 - ra) * (1 - this.caveBlend);
    this.fireflies.visible = ff.uOpacity.value > 0.01;

    // —— 地面湿度 ——
    if (this.terrainMat) {
      // 湿度只略微降低粗糙度：过亮的高光会在法线贴图上产生"白噪点"
      this.terrainMat.roughness = 0.95 - this.wet * 0.20;
      if (this.terrainMat.normalScale) this.terrainMat.normalScale.setScalar(0.85 - this.wet * 0.35);
      const w = 1 - this.wet * 0.30;
      this.terrainMat.color.setRGB(w, w, w);
    }

    // —— 曝光 ——（夜里抬一点，避免全黑）
    this.renderer.toneMappingExposure = 1.0 + nightK * 0.72 + (1 - this.cloud) * 0.05;

    this.onRain && this.onRain(ra);
  }
}
