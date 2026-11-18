// 主入口：渲染 / 光照 / 状态机 / 主循环
import * as THREE from 'three';
import { CFG, SPAWN } from './config.js';
import { buildTerrain, buildWaters, setWaterEnv, updateWaters, zoneState, groundHeight, waterDistance } from './terrain.js';
import { buildFlora, colliders, updateFoliageWind, foliageWindState, setFoliageWindEnabled } from './flora.js';
import { buildStructures, bridgeState, bridgePlanks, updateRaft, reefState } from './structures.js';
import { BeastManager, makeParticles, updateParticles } from './animals.js';
import { Env } from './env.js';
import { Player } from './player.js';
import { UI } from './ui.js';
import { Quests } from './quests.js';
import { TPS } from './tps.js';
import { loadAssets, setAssetEnv } from './assets.js';
import { loadPBR, applyTerrainPBR, loadSkyEnv } from './pbr.js';
import { setTextureOverride } from './textures.js';
import { loadWaterTextures, bindWaterEnv, waterState, setWavesEnabled, setWaterFrozen } from './water.js';
import { resume, startAmbient, startBGM, setCombat, setCaveAmbience, setRain, setWaterNear, waterAmbState, thunder, sfx, bgmState, sfxState, engineState, startWildlifeAudio, setWildlifeContext, wildlifeAudioState, debugWildlifeCall } from './audio.js';
import { buildWildlife, wildlifeState, wildlifeCallPoint } from './wildlife.js';
import { clamp } from './util.js';
import { inventory } from './inventory.js';

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

// QA/调试隔离开关：?nowind=1 静止树叶，?nowaves=1 关掉 Gerstner 浪
const QS = new URLSearchParams(location.search);
const fxOn = { wind: !QS.has('nowind'), waves: !QS.has('nowaves') };

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
let player, beasts, ui, particles, tps, quests, wildlife;
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
  setWavesEnabled(fxOn.waves);
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
  await step('正在放归林间野生动物', 80);
  // 环境生态（蜥蜴/蛇/陆龟/鳄 + 鸟群）与敌对野兽完全分离，?nowildlife=1 可整体关闭
  wildlife = qs.has('nowildlife') ? null : buildWildlife(scene);
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
  quests = new Quests(ui, beasts);
  await step('准备出发', 100);
  startAmbient();
  startBGM();
  // 鸟叫/兽吼音景：声源坐标直接取自画面里的动物（wildlife.js）
  startWildlifeAudio(kind => wildlifeCallPoint(kind));
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
    ui.toast('任务：向北穿过密林，在北岸登上渔船离岛');
    setTimeout(() => ui.toast('枪声会引来野兽——但也救你一命'), 4200);
    if (quests) quests.start();
  },
  pause() {
    if (state !== 'playing' || (player && (player.dead || player.win))) return;
    state = 'paused';
    ui.showMenu('menu-paused');
    document.exitPointerLock && document.exitPointerLock();
  },
  // 背包：暂停游戏 + 释放指针锁，面板里可点击使用；关闭后恢复
  openBag() {
    if (state !== 'playing' || !ui || (player && (player.dead || player.win))) return false;
    state = 'paused';
    ui.showBag(true);
    document.exitPointerLock && document.exitPointerLock();
    return true;
  },
  closeBag() {
    if (!ui || !ui.bagOpen) return false;
    ui.showBag(false);
    if (state === 'paused') { state = 'playing'; ui.showHUD(); lockPointer(); }
    return true;
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
  foliage: foliageWindState,
  bag: () => inventory.snapshot(),
  giveBag: (type, n = 1) => { for (let i = 0; i < n; i++) inventory.add(type); ui && ui.updateBag(); return inventory.snapshot(); },
  useBag: (type) => player.useBagItem(type),
  openBag: () => game.openBag(),
  closeBag: () => game.closeBag(),
  // QA：同机位实时开关风与浪（树叶静止 + 浪归零），供像素差对照
  setFx(v) {
    fxOn.wind = fxOn.waves = !!v;
    setFoliageWindEnabled(fxOn.wind);
    setWavesEnabled(fxOn.waves);
    setWaterFrozen(!v);   // QA 对照组：水面时间一并冻结，关组画面完全静止
    return { foliage: foliageWindState(), water: waterState() };
  },
  // QA：只推进风/浪相位 s 秒（相机/角色/环境全部不动）
  timeSkip(s) { qaFxTime += s; return qaFxTime; },
  waterAmb: waterAmbState,
  reef: reefState,
  wildlife: wildlifeState,
  wild: () => wildlife,   // QA：暴露 manager 引用，供动物摆拍特写（无副作用）
  wildlifeAudio: wildlifeAudioState,
  wildlifeCall: debugWildlifeCall,
  waterTest: (lv) => setWaterNear(lv),
  shore: (x, z) => waterDistance(x == null ? player.pos.x : x, z == null ? player.pos.z : z),
  colliders: () => colliders,
  engine: engineState,
  setCombat,
};

// —— 输入 ——
addEventListener('keydown', e => {
  if (!player) return;
  // 背包面板打开时，ESC 优先关闭背包并恢复游戏
  if (e.code === 'Escape') {
    const bag = document.getElementById('bag-panel');
    if (bag && !bag.hidden) { game.closeBag(); return; }
    const panel = document.getElementById('panel');
    if (panel && !panel.hidden) { panel.hidden = true; return; }
  }
  player.keys[e.code] = true;
  if (state !== 'playing') {
    if (e.code === 'Escape' && state === 'paused') game.resume();
    return;
  }
  // 背包 / 补给快捷键（1/2/3 已被武器占用，用 4/5）
  if (e.code === 'KeyB') { sfx.uiclick(); game.openBag(); return; }
  if (e.code === 'Digit4') { player.useBagItem('medkit'); return; }
  if (e.code === 'Digit5') { player.useBagItem('ammo'); return; }
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
// QA：只推进风/浪相位的偏移（timeSkip），不动相机/物理/环境，供像素差对照
let qaFxTime = 0;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  // 系统时钟回拨 / QA 虚拟时钟下 (now-lastT) 可能为负，钳到 0 避免时间倒流
  const dt = Math.max(0, Math.min(0.05, (now - lastT) / 1000));
  lastT = now;
  const t = now / 1000;
  const tfx = t + qaFxTime;
  // 风场每帧驱动叶片顶点着色器；风力/风向来自环境（雨天更大、夜间略收）
  updateFoliageWind(tfx, env, fxOn.wind);

  updateRaft(t);
  if (particles) updateParticles(dt);

  game.playTime = playTime;
  if (state === 'playing' && player) {
    playTime += dt;
    // 索桥摆动
    const onBridge = Math.abs(player.pos.x) < 4 && player.pos.z < 22.5 && player.pos.z > -37.5;
    const target = onBridge ? 2.6 : 1;
    bridgeImpulse += ((bridgeImpulse < target ? 1 : -1) * 0.02);
    bridgeImpulse = clamp(bridgeImpulse, 0, target);
    bridgeState.t += dt;
    const sway = Math.sin(bridgeState.t * 1.6) * 0.045 * bridgeImpulse
      + Math.sin(bridgeState.t * 3.4) * 0.015 * bridgeImpulse;
    if (bridgePlanks) { bridgePlanks.position.y = sway; bridgePlanks.rotation.z = Math.sin(bridgeState.t * 1.1) * 0.006 * bridgeImpulse; }

    player.update(dt, sway);
    if (quests) quests.update(dt, player);
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
      if (quests) quests.onWin();
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
  // 野生动物与它们的叫声共用同一份「本帧」昼夜/天气/玩家状态；
  // 标题画面也保持生态在动（鸟群盘旋、蜥蜴趴着晒太阳），只是不触发音景。
  const wildlifeRef = player ? player.pos : { x: SPAWN.x, y: 3, z: SPAWN.z };
  if (wildlife) wildlife.update(dt, t, wildlifeRef, env);
  // 相机世界矩阵用于音景的左右声像；这里必须每帧同步，不能用累加 dt 节流——
  // 无头软渲染一帧可能长达数秒而 dt 被 clamp 到 0.05，累加节流会慢上十几秒一拍。
  camera.updateMatrixWorld();
  {
    const e = camera.matrixWorld.elements;
    const rr = Math.hypot(wildlifeRef.x, wildlifeRef.z);
    setWildlifeContext({
      night: env.night, rain: env.rain, cave: zoneState(wildlifeRef.x, wildlifeRef.z).cave,
      shore: clamp((rr - 176) / 50, 0, 1),
      px: wildlifeRef.x, pz: wildlifeRef.z,
      right: [e[0], e[2]],           // 相机世界右向量，用于精确的左右声像
      listening: state === 'playing',
    });
  }
  // 水面太阳高光必须读本帧的最新光源；放在 env.update 之前会滞后一帧，
  // 低帧率/无头软渲染下会整整卡住一拍（日落仍是白天的太阳）
  updateWaters(tfx);
  // HDRI 是静态白昼天空，夜间必须压低 IBL 强度，否则会破坏昼夜循环
  if (pbrState.env) scene.environmentIntensity = 0.10 + (1 - env.night) * 0.48;
  renderer.render(scene, camera);
}

boot();
