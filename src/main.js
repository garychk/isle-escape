// 主入口：渲染 / 光照 / 状态机 / 主循环
import * as THREE from 'three';
import { CFG, SPAWN } from './config.js';
import { buildTerrain, buildWaters, setWaterEnv, updateWaters, zoneState, groundHeight, waterDistance } from './terrain.js';
import { buildFlora, colliders } from './flora.js';
import { buildStructures, bridgeState, bridgePlanks, updateRaft, reefState } from './structures.js';
import { BeastManager, makeParticles, updateParticles } from './animals.js';
import { Env } from './env.js';
import { Player } from './player.js';
import { UI } from './ui.js';
import { TPS } from './tps.js';
import { loadAssets, setAssetEnv } from './assets.js';
import { loadPBR, applyTerrainPBR, loadSkyEnv } from './pbr.js';
import { setTextureOverride } from './textures.js';
import { loadWaterTextures, bindWaterEnv, waterState } from './water.js';
import { resume, startAmbient, startBGM, setCombat, setCaveAmbience, setRain, setWaterNear, waterAmbState, thunder, sfx, bgmState, sfxState, engineState } from './audio.js';
import { clamp } from './util.js';

const canvas = document.getElementById('view');
function lockPointer() {
  try {
    const r = canvas.requestPointerLock && canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => { });
  } catch (e) { }
}
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

// 环境系统：天空、昼夜、天气、雨、萤火虫
const env = new Env({ scene, renderer });
env.onRain = lv => setRain(lv);
env.onThunder = d => thunder(d);
bindWaterEnv(env);   // 水面太阳高光跟随真实 DirectionalLight（昼夜/云雨/洞穴）

// 用天空生成一张环境贴图，供水面反射用
let envTex = null;
function rebuildEnvMap() {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const es = new THREE.Scene();
    const m = new THREE.Mesh(env.sky.geometry, env.sky.material);
    es.add(m);
    const t = pmrem.fromScene(es, 0.02, 1, 2200).texture;
    pmrem.dispose();
    if (envTex) envTex.dispose();
    envTex = t;
    setWaterEnv(envTex);
  } catch (e) { console.warn('env failed', e); }
}

const camera = new THREE.PerspectiveCamera(innerWidth / innerHeight < 1.05 ? 80 : 72, innerWidth / innerHeight, 0.1, 950);
scene.add(camera);

// —— 世界构建（分步展示进度） ——
const bootFill = document.getElementById('boot-fill');
const bootMsg = document.getElementById('boot-msg');
let player, beasts, ui, particles, tps;
let state = 'title';
let playTime = 0;
let bridgeImpulse = 0;

function step(msg, pct) {
  return new Promise(res => { bootMsg.textContent = msg; bootFill.style.width = pct + '%'; requestAnimationFrame(() => setTimeout(res, 30)); });
}

let pbrState = { ground: false, foliage: [], env: false };
async function boot() {
  await step('正在装载地表与天空材质', 8);
  // 真实 PBR 贴图：缺文件时 loadPBR 返回 null，地形/植被自动回退程序化版本
  const qs = new URLSearchParams(location.search);
  const noPBR = qs.has('nopbr');                 // QA/调试：全部回退程序化材质
  const pbr = noPBR ? { ground: null, foliage: {} } : await loadPBR();
  if (!qs.has('nofoliage')) for (const [k, t] of Object.entries(pbr.foliage)) setTextureOverride(k, t);
  pbrState.foliage = Object.keys(pbr.foliage);
  await step('正在生成岛屿地形', 12);
  env.sample();
  const terrain = buildTerrain(scene);
  pbrState.ground = !qs.has('noground') && applyTerrainPBR(terrain, pbr.ground);
  env.terrainMat = terrain.material;
  await loadWaterTextures(qs.has('nowater'));   // ?nowater 强制回退程序化法线，便于前后对比
  buildWaters(scene);
  rebuildEnvMap();
  setAssetEnv(envTex);
  pbrState.env = (noPBR || qs.has('nohdr')) ? false : !!(await loadSkyEnv(renderer, scene));
  await step('正在装载外部美术资产', 30);
  const artInfo = await loadAssets(undefined, (p, name) => {
    bootMsg.textContent = '正在装载 ' + name + '.glb';
    bootFill.style.width = (30 + p * 12) + '%';
  });
  console.log('[assets] 已加载:', artInfo.loaded.join(', ') || '(无)', '| 缺失:', artInfo.missing.join(', ') || '(无)');
  await step('正在种植雨林植被', 42);
  buildFlora(scene, 1);
  await step('正在架设索桥与洞穴', 66);
  buildStructures(scene);
  particles = makeParticles(scene);
  await step('正在唤醒林中野兽', 86);
  beasts = new BeastManager(scene);
  beasts.spawnAll();
  player = new Player(camera, scene, beasts, null, envTex);
  ui = new UI(game);
  player.ui = ui;
  tps = new TPS({ player, scene, camera, ui });
  game.tps = tps;
  game.player = player;
  game.beasts = beasts;
  beasts.onSfx = (name, x, z) => { const s = sfx[name]; s && s(); };
  await step('准备出发', 100);
  startAmbient();
  startBGM();
  document.getElementById('boot').classList.add('done');
  ui.showMenu('menu-title');
  if (location.search.indexOf('auto=1') >= 0) {
    state = 'playing';
    ui.showHUD();
    resume();
    lockPointer();
  }
  loop();
}

// —— 游戏对象 ——
const game = {
  sens: 1.4,
  start() {
    state = 'playing';
    ui.showHUD();
    resume();
    lockPointer();
    ui.toast('向北穿过密林，在北岸登上渔船离岛');
    setTimeout(() => ui.toast('枪声会引来野兽——但也救你一命'), 4200);
  },
  pause() {
    if (state !== 'playing' || (player && (player.dead || player.win))) return;
    state = 'paused';
    ui.showMenu('menu-paused');
    document.exitPointerLock && document.exitPointerLock();
  },
  resume() {
    if (state !== 'paused') return;
    state = 'playing';
    ui.showHUD();
    lockPointer();
  },
  restart() { location.reload(); },
  setOver() { state = 'over'; },
  lookDelta(dx, dy) {
    if (state !== 'playing' || !player) return;
    const s = this.sens * 0.0021;
    player.yaw -= dx * s;
    player.pitch = clamp(player.pitch - dy * s, -1.45, 1.45);
  },
  applyQuality(q) {
    renderer.setPixelRatio(q === 0 ? Math.min(devicePixelRatio, 1) : q === 1 ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = q > 0;
    env.sun.castShadow = q > 0;
    scene.traverse(o => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
  },
  setTime(h) { env.setTime(h); },
  setWeather(w) { env.setWeather(w); },
};

window.__game = game;
window.__env = env;
window.__THREE = THREE;
window.__qa = {
  env: () => env,
  teleport(x, z) { player.pos.set(x, groundHeight(x, z) + 1, z); },
  player: () => player,
  beasts: () => beasts,
  ui: () => ui,
  tps: () => tps,
  // 调武器在手里的位置/角度：__qa.weaponTune(0,0.05,0.02, -90,0,0)
  weaponTune(p, r) {
    const c = tps && tps.char;
    if (!c) return;
    c.weaponRoot.position.set(p[0], p[1], p[2]);
    c.weaponRoot.rotation.set(r[0] * Math.PI / 180, r[1] * Math.PI / 180, r[2] * Math.PI / 180);
    return { pos: c.weaponRoot.position.toArray(), rot: [c.weaponRoot.rotation.x, c.weaponRoot.rotation.y, c.weaponRoot.rotation.z] };
  },
  placeBeasts(list) {
    for (const it of list) {
      const b = beasts.beasts.find(x => x.type === it.type && x.state !== 'dead');
      if (b) { b.x = it.x; b.z = it.z; b.y = groundHeight(it.x, it.z); b.aggro = true; b.state = 'chase'; }
    }
  },
  state: () => state,
  pbr: () => ({ ...pbrState, envIntensity: scene.environmentIntensity, terrainMat: env.terrainMat && !!env.terrainMat.onBeforeCompile }),
  bgm: bgmState,
  sfx: sfxState,
  water: waterState,
  waterAmb: waterAmbState,
  reef: reefState,
  waterTest: (lv) => setWaterNear(lv),
  shore: (x, z) => waterDistance(x == null ? player.pos.x : x, z == null ? player.pos.z : z),
  colliders: () => colliders,
  engine: engineState,
  setCombat,
};

// —— 输入 ——
addEventListener('keydown', e => {
  if (!player) return;
  // 设置面板打开时，ESC 优先关闭面板，再走暂停/恢复逻辑
  if (e.code === 'Escape') {
    const panel = document.getElementById('panel');
    if (panel && !panel.hidden) { panel.hidden = true; return; }
  }
  player.keys[e.code] = true;
  if (state !== 'playing') { if (e.code === 'Escape' && state === 'paused') game.resume(); return; }
  if (e.code === 'KeyQ') {
    const w = player.cycleWep();
    ui && ui.toast(w === 'none' ? '已收起武器 · 空手' : w === 'knife' ? '已拔刀' : '已举枪');
  }
  if (e.code === 'Digit1') player.switchWep('rifle');
  if (e.code === 'Digit2') player.switchWep('knife');
  if (e.code === 'Digit3') player.switchWep('none');
  if (e.code === 'KeyR') player.reload();
  if (e.code === 'KeyF') player.toggleFlash();
  // 瞄准锁定：点一下常驻瞄准，不用一直按着右键
  if (e.code === 'KeyV') {
    const on = player.toggleAimLatch();
    ui && ui.toast(on ? '瞄准锁定 · 开（V 取消）' : '瞄准锁定 · 关');
  }
  if (e.code === 'KeyC') { player.isSneaking = !player.isSneaking; if (ui) ui.toast(player.isSneaking ? '蹲伏' : '站立'); }
  // 蹲伏时按空格 = 前滚翻
  if (e.code === 'Space' && player.isSneaking && player.onGround && !player.inVehicle) {
    player.isSneaking = false;
    player.rollT = 0.55;
    player.velY = 1.1;
    tps && tps.startRoll();
  }
  if (e.code === 'KeyE' && ui.promptCb) ui.promptCb();
  if (e.code === 'Escape') game.pause();
});
addEventListener('keyup', e => { if (player) player.keys[e.code] = false; });
canvas.addEventListener('mousedown', e => {
  if (state !== 'playing') return;
  if (e.button === 0) player.keys['Mouse0'] = true;
  if (e.button === 1) { e.preventDefault(); player.toggleAimLatch(); }  // 中键也能切换常驻瞄准
  if (e.button === 2) player.setAimHold(true);
});
addEventListener('mouseup', e => {
  if (!player) return;
  if (e.button === 0) player.keys['Mouse0'] = false;
  if (e.button === 2) player.setAimHold(false);
});
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (document.pointerLockElement === canvas) game.lookDelta(e.movementX, e.movementY);
});
document.addEventListener('pointerlockchange', () => {
  if (state === 'playing' && document.pointerLockElement !== canvas && !('ontouchstart' in window)) game.pause();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1.05 ? 80 : 72;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// —— 主循环 ——
let lastT = performance.now();
let caveBlend = 0;
let lastCombatT = -99;
let waterProbeT = 0;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const t = now / 1000;

  updateRaft(t);
  if (particles) updateParticles(dt);

  game.playTime = playTime;
  if (state === 'playing' && player) {
    playTime += dt;
    // 索桥摆动
    const onBridge = Math.abs(player.pos.x) < 4 && player.pos.z < 18 && player.pos.z > -30;
    const target = onBridge ? 2.6 : 1;
    bridgeImpulse += ((bridgeImpulse < target ? 1 : -1) * 0.02);
    bridgeImpulse = clamp(bridgeImpulse, 0, target);
    bridgeState.t += dt;
    const sway = Math.sin(bridgeState.t * 1.6) * 0.045 * bridgeImpulse
      + Math.sin(bridgeState.t * 3.4) * 0.015 * bridgeImpulse;
    if (bridgePlanks) { bridgePlanks.position.y = sway; bridgePlanks.rotation.z = Math.sin(bridgeState.t * 1.1) * 0.006 * bridgeImpulse; }

    player.update(dt, sway);
    if (tps) tps.update(dt);
    beasts.update(dt, player, t);
    const zone = zoneState(player.pos.x, player.pos.z);
    player.uiZone = zone;
    ui.checkZones(player.pos.x, player.pos.z);
    ui.updateCompass(player.yaw, player.pos.x, player.pos.z);
    setCaveAmbience(zone.cave);
    // 水流声：离水面越近越响、越清亮；站在水里再加一层贴脸的水花声
    waterProbeT += dt;
    if (waterProbeT > 0.12) {
      waterProbeT = 0;
      const wd = waterDistance(player.pos.x, player.pos.z);
      let lv = Math.exp(-wd.dist / 7.0);                                        // 0m→1 / 7m→0.37 / 15m→0.12 / 28m→0.02
      if (wd.depth > 0.03) lv = Math.max(lv, 0.86 + Math.min(0.14, wd.depth * 0.22));
      if (zone.cave) lv *= 0.12;                                               // 洞里几乎传不进来
      setWaterNear(lv < 0.02 ? 0 : lv);
    }
    // BGM 战斗切换：有任一活兽处于 aggro 即视为遭遇战；脱离后延迟 5s 回探索层
    if (beasts) {
      const fighting = beasts.beasts.some(b => b.aggro && b.state !== 'dead');
      if (fighting) lastCombatT = playTime;
      setCombat(fighting || (playTime - lastCombatT) < 5);
    }
    // 洞穴压暗
    caveBlend += ((zone.cave ? 1 : 0) - caveBlend) * dt * 3;
    if (ui.updateAlmanac) ui.updateAlmanac(env);
    // 胜利演出
    if (player.win) {
      player.finishT += dt;
      if (player.finishT > 1.6) state = 'over';
    }
  } else if (state === 'title' && player) {
    // 标题画面：缓慢环绕镜头
    const a = t * 0.06;
    camera.position.set(SPAWN.x + Math.sin(a) * 24, 9 + Math.sin(t * 0.3) * 1.2, SPAWN.z + Math.cos(a) * 24);
    camera.lookAt(SPAWN.x, 3.4, SPAWN.z - 26);
    if (ui.updateAlmanac) ui.updateAlmanac(env);
  }
  else setWaterNear(0);        // 标题 / 暂停 / 结算：水流声淡出
  // 环境：昼夜 + 天气（内部处理天穹跟随、光照、雾、雨）
  env.update(dt, camera.position, caveBlend);
  // 水面太阳高光必须读本帧的最新光源；放在 env.update 之前会滞后一帧，
  // 低帧率/无头软渲染下会整整卡住一拍（日落仍是白天的太阳）
  updateWaters(t);
  // HDRI 是静态白昼天空，夜间必须压低 IBL 强度，否则会破坏昼夜循环
  if (pbrState.env) scene.environmentIntensity = 0.10 + (1 - env.night) * 0.48;
  renderer.render(scene, camera);
}

boot();
