// 外部资产装载：GLB → three 对象，缺文件时静默降级（不影响游戏启动）
//
// 放文件的约定（把 GLB 直接丢进 isle-escape/assets/）：
//   player.glb      人物：T/A-pose + 骨骼 + 内嵌动画（Mixamo 直接可用）
//   rifle.glb       步枪：原点在握把，枪口朝 -Z
//   knife.glb       军刀：原点在握把，刀尖朝 -Z
//   robot.glb       机器人/敌人
//   jeep.glb        越野车：车头朝 +Z，原点在四轮接地中心
//   m151.glb        军用吉普（M151 MUTT）：车头朝 +Z，同上
//   cabin.glb       木屋：门口朝 +Z，原点在地基中心
//   boat.glb        军用快艇：船头朝 -Z，原点=船中水线（龙骨最低点）
//
// 单文件打包（npm run build）时，build.js 会把 assets/*.glb 转成 data URI 注入
// globalThis.__ASSET_DATA__，因此 dist 版仍然是「一个 html 文件」，不需要服务器。

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { clone as skeletonClone } from '../vendor/SkeletonUtils.js';

export const MANIFEST = {
  // yaw: 模型自带朝向（度，绕 Y）。游戏里角色/载具 0=朝 -Z；glTF 模型通常面朝 +Z，需转 180
  player:    { file: 'player.glb',    height: 1.80, yaw: 180 }, // 自动缩放到 1.8m 身高
  robot:     { file: 'robot.glb',     height: 2.10, yaw: 180 },
  rifle:     { file: 'rifle.glb', anchor: 'origin' }, // 武器保持建模原点（=握把），不可居中
  knife:     { file: 'knife.glb', anchor: 'origin' },
  jeep:      { file: 'jeep.glb' },
  m151:      { file: 'm151.glb', length: 3.8 }, // 车长归一到 3.8m（Sketchfab 源模型单位偏大）
  cabin:     { file: 'cabin.glb' },
  boat:      { file: 'boat.glb', anchor: 'origin' }, // 保持建模原点（船中水线），不居中不缩放
  medkit:    { file: 'medkit.glb' }, // 急救箱拾取物：底部中心=原点，红十字盖朝上
  croc:      { file: 'croc.glb' },  // 沼泽鳄：头朝 +Z（野兽 AI 前进方向），底部中心=原点，体长已烘焙 3.6m
  spider:    { file: 'spider.glb' }, // 巨蛛：头朝 +Z（野兽前进方向），底部中心=原点
  rock:      { file: 'rock.glb' },  // 岩石：底部中心=原点（植被/海滩石头共用），等比实例化
};

const cache = new Map();
const missing = new Set();
let envTex = null;

export function setAssetEnv(t) { envTex = t; }

function urlFor(name, spec) {
  const inline = globalThis.__ASSET_DATA__;
  if (inline && inline[name]) return inline[name];
  const base = (typeof document !== 'undefined' && document.baseURI) || 'http://localhost/';
  return new URL('assets/' + spec.file, base).href;
}

function normalize(gltf, spec) {
  const model = gltf.scene || gltf.scenes[0];
  const wrap = new THREE.Group();
  wrap.name = 'asset:' + spec.file;
  wrap.add(model);
  // 朝向归一：模型转成"面朝 -Z"（游戏内 0=前方），武器/载具都按这个约定
  if (spec.yaw) model.rotation.y = THREE.MathUtils.degToRad(spec.yaw);

  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if (o.isSkinnedMesh) o.frustumCulled = false; // 蒙皮包围盒会算错，直接关掉视锥剔除
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (envTex && m.metalness > 0.15 && !m.envMap) { m.envMap = envTex; m.envMapIntensity = 0.85; }
      m.needsUpdate = true;
    }
  });

  // 统一尺度与落地：模型多高都行，按 spec.height 拉到目标身高，并把脚底压到 y=0
  // 关键：蒙皮模型的包围盒依赖矩阵世界，必须先整棵更新再量，否则量出来的是错的
  wrap.updateMatrixWorld(true);
  const b0 = new THREE.Box3().setFromObject(wrap);
  const size = new THREE.Vector3(); b0.getSize(size);
  let s = 1;
  if (spec.height && size.y > 0.01) s = spec.height / size.y;
  else if (spec.length && size.z > 0.01) s = spec.length / size.z; // 载具按车长归一
  console.log('[assets] 实测 ' + spec.file + ' size=' + size.toArray().map(v => v.toFixed(2)).join(',') + ' min.y=' + b0.min.y.toFixed(2) + ' -> scale=' + s.toFixed(3));
  model.scale.multiplyScalar(s);
  wrap.updateMatrixWorld(true);
  const b1 = new THREE.Box3().setFromObject(wrap);
  if (spec.anchor === 'origin') {
    // 武器类：建模原点即握把（枪口 -Z），保持不动——居中会让枪"飘"在手上方
  } else {
    model.position.x -= (b1.min.x + b1.max.x) / 2;
    model.position.z -= (b1.min.z + b1.max.z) / 2;
    model.position.y -= b1.min.y;
  }
  wrap.updateMatrixWorld(true);

  return { wrap, animations: gltf.animations || [], height: size.y * s };
}

export async function loadAssets(names = Object.keys(MANIFEST), onStep) {
  const loader = new GLTFLoader();
  const todo = names.filter(n => MANIFEST[n] && !cache.has(n) && !missing.has(n));
  let done = 0;
  await Promise.all(todo.map(async (name) => {
    const spec = MANIFEST[name];
    try {
      const gltf = await loader.loadAsync(urlFor(name, spec));
      cache.set(name, normalize(gltf, spec));
    } catch (e) {
      missing.add(name);
      console.warn('[assets] 未找到 ' + spec.file + '，该槽位使用内置模型');
    } finally {
      done++;
      if (onStep) onStep(done / Math.max(1, todo.length), name);
    }
  }));
  return { loaded: [...cache.keys()], missing: [...missing] };
}

export function has(name) { return cache.has(name); }
export function clips(name) { const e = cache.get(name); return e ? e.animations : []; }

/** 取一份可独立使用的实例（蒙皮模型用 SkeletonUtils.clone 正确重建骨架） */
export function instance(name) {
  const e = cache.get(name);
  if (!e) return null;
  const wrap = skeletonClone(e.wrap);
  return { wrap, animations: e.animations, height: e.height };
}

/** 在骨架里按名字找骨骼（兼容 Mixamo / Blender / 3ds Max 命名） */
export function findBone(root, re) {
  let hit = null;
  root.traverse((o) => {
    if (hit) return;
    if (o.isBone && re.test(o.name)) hit = o;
  });
  return hit;
}
