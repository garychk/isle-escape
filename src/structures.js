// 结构物：索桥 / 沼泽木板路 / 山洞穹顶 / 救生筏 / 遇难残骸 / 林中木屋
import * as THREE from 'three';
import { CFG, RAFT, BOAT, CABIN } from './config.js';
import { mulberry32 } from './util.js';
import { baseHeight, surfaceRects, surfaceRamps } from './terrain.js';
import { colliders } from './flora.js';
import { barkTex, rockTex, woodGrain } from './textures.js';
import { instance } from './assets.js';

const rng = mulberry32(777);
const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 0.94 });
const woodDark = new THREE.MeshStandardMaterial({ color: 0x5e4a30, roughness: 0.97 });
const ropeMat = new THREE.MeshStandardMaterial({ color: 0xa8946c, roughness: 1 });
const rockMat = new THREE.MeshStandardMaterial({ map: rockTex(), color: 0x8d8577, roughness: 1, flatShading: true });

export const bridgeState = { swayY: 0, rotZ: 0, t: 0 };
export let bridgePlanks = null;
export let boatGroup = null;
let boatBaseY = 0.62;

export function buildStructures(scene) {
  const g = new THREE.Group();
  scene.add(g);
  buildBridge(g);
  buildBoardwalk(g);
  buildCave(g);
  buildRaft(g);
  buildWreck(g);
  buildCabin(g);
  buildLandmarks(g);
  return g;
}

// ================= 场景地标：让沿途不再是一条空走廊 =================
// 全部程序化几何，不依赖外部资产；放在小径支线附近，靠近就有探索奖励。
function buildLandmarks(g) {
  const metal = new THREE.MeshStandardMaterial({ color: 0x70776f, roughness: 0.72, metalness: 0.35 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x6e4a37, roughness: 0.92, metalness: 0.15 });
  const tarp = new THREE.MeshStandardMaterial({ color: 0x3f5340, roughness: 0.95, side: THREE.DoubleSide });
  const ember = new THREE.MeshBasicMaterial({ color: 0xff8a3c });

  // 1) 瞭望塔：密林腹地 (-58,112) 旁，木质高台 + 梯子 + 顶棚
  watchTower(g, -64, 108);

  // 2) 失事运输机残骸：林间空地 (44,95)，断裂机身 + 机翼 + 散落碎片
  planeWreck(g, 44, 95, metal, rust);

  // 3)  abandoned 营地：沼泽边 (70,30)，帐篷 + 篝火（带点光源）
  campFire(g, 70, 30, tarp, woodDark, ember);

  // 4) 北岸信号塔：给终点一个清晰的地标
  signalTower(g, 16, -205, metal, rust);
}

function watchTower(g, x, z) {
  const y = baseHeight(x, z);
  const t = new THREE.Group();
  t.position.set(x, y, z);
  const legH = 6.2, spread = 1.5;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, legH, 6), woodDark);
    leg.position.set(sx * spread, legH / 2, sz * spread);
    leg.rotation.z = -sx * 0.06; leg.rotation.x = sz * 0.06;
    leg.castShadow = true; t.add(leg);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.24, 4.2), woodMat);
  deck.position.y = legH; deck.castShadow = deck.receiveShadow = true; t.add(deck);
  // 栏杆
  for (const [px, pz, w, d] of [[0, 2.05, 4.2, 0.12], [0, -2.05, 4.2, 0.12], [2.05, 0, 0.12, 4.2], [-2.05, 0, 0.12, 4.2]]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, d), woodDark);
    rail.position.set(px, legH + 1.05, pz); t.add(rail);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.6, 4), tarpMat());
  roof.position.y = legH + 2.9; roof.rotation.y = Math.PI / 4; roof.castShadow = true; t.add(roof);
  // 斜梯
  for (let i = 0; i < 10; i++) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.09, 0.18), woodMat);
    rung.position.set(0, 0.5 + i * 0.56, 2.6 - i * 0.06); t.add(rung);
  }
  g.add(t);
  colliders.push({ x, z, r: 2.0 });
}

function tarpMat() {
  return new THREE.MeshStandardMaterial({ color: 0x46543e, roughness: 0.95, side: THREE.DoubleSide });
}

function planeWreck(g, x, z, metal, rust) {
  const y = baseHeight(x, z);
  const p = new THREE.Group();
  p.position.set(x, y, z);
  p.rotation.y = -0.5;
  // 断裂机身（两段）
  const body1 = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 6.5, 12), metal);
  body1.rotation.z = Math.PI / 2; body1.position.set(-1.5, 1.35, 0); body1.castShadow = true; p.add(body1);
  const body2 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.25, 4.0, 12), rust);
  body2.rotation.z = Math.PI / 2; body2.rotation.x = 0.25;
  body2.position.set(4.0, 1.7, 1.2); body2.castShadow = true; p.add(body2);
  // 机翼
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 11), metal);
  wing.position.set(-1.5, 1.0, 0); wing.rotation.z = 0.18; wing.castShadow = true; p.add(wing);
  // 尾翼
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.6, 2.2), rust);
  tail.position.set(5.6, 2.6, 1.2); tail.castShadow = true; p.add(tail);
  // 散落碎片
  for (let i = 0; i < 7; i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.6 + rng() * 0.8, 0.08, 0.5 + rng() * 0.7), rust);
    d.position.set((rng() - 0.5) * 16, 0.1, (rng() - 0.5) * 14);
    d.rotation.set(rng(), rng() * 6.28, rng()); p.add(d);
  }
  g.add(p);
  colliders.push({ x, z, r: 3.2 });
}

function campFire(g, x, z, tarp, woodDark, ember) {
  const y = baseHeight(x, z);
  const c = new THREE.Group();
  c.position.set(x, y, z);
  // 帐篷
  const tent = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.8, 4), tarp);
  tent.rotation.y = Math.PI / 4; tent.position.set(-3.5, 1.4, 0); tent.castShadow = true; c.add(tent);
  // 篝火石圈 + 木柴
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), rockMat);
    st.position.set(Math.cos(a) * 0.9, 0.12, Math.sin(a) * 0.9); c.add(st);
  }
  for (let i = 0; i < 4; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.4, 6), woodDark);
    log.rotation.z = Math.PI / 2; log.rotation.y = (i / 4) * Math.PI;
    log.position.y = 0.2; c.add(log);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 8), ember);
  flame.position.y = 0.65; flame.name = 'campflame'; c.add(flame);
  const light = new THREE.PointLight(0xff7a30, 2.2, 14, 2);
  light.position.set(0, 1.1, 0); c.add(light);
  g.add(c);
  colliders.push({ x: x - 3.5, z, r: 1.6 });
}

function signalTower(g, x, z, metal, rust) {
  const y = baseHeight(x, z);
  const s = new THREE.Group();
  s.position.set(x, y, z);
  const H = 11;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, H, 6), rust);
    leg.position.set(sx * 1.2, H / 2, sz * 1.2);
    leg.rotation.z = -sx * 0.045; leg.rotation.x = sz * 0.045; leg.castShadow = true; s.add(leg);
  }
  for (let k = 1; k <= 4; k++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 0.12), metal);
    beam.position.y = k * 2.4; s.add(beam);
    const beam2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.5), metal);
    beam2.position.y = k * 2.4; s.add(beam2);
  }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), metal);
  dish.position.y = H + 0.6; dish.rotation.x = -0.5; dish.castShadow = true; s.add(dish);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
  beacon.position.y = H + 1.8; s.add(beacon);
  g.add(s);
  colliders.push({ x, z, r: 1.6 });
}

// ================= 林中木屋（两层架空棚屋，门朝 +Z 朝小径） =================
// 几何数据来源：tools/blender/build_cabin.py 导出后打印的"游戏本地坐标"
function buildCabin(g) {
  const inst = instance('cabin');
  if (!inst) { console.warn('[structures] cabin.glb 缺失，跳过木屋'); return; }
  const cabin = inst.wrap;
  const CY = CABIN.padY - 0.49;         // 模型地面(含埋深0.49m)对齐压平后的地形
  cabin.position.set(CABIN.x, CY, CABIN.z);
  cabin.rotation.y = 0;                 // 门朝 +Z（南，面向小径）
  g.add(cabin);

  // 本地→世界
  const WX = lx => CABIN.x + lx, WZ = lz => CABIN.z + lz, WY = ly => CY + ly;
  const floorY = WY(1.21);              // 屋内地板世界高度

  // —— 可站立面 ——
  surfaceRects.push(
    { x0: WX(-5.4), x1: WX(8.9), z0: WZ(-1.57), z1: WZ(5.09), y: floorY },   // 屋内地板
    { x0: WX(4.55), x1: WX(8.75), z0: WZ(5.08), z1: WZ(7.58), y: WY(0.83) }, // 门廊平台
    { x0: WX(3.75), x1: WX(4.55), z0: WZ(5.58), z1: WZ(7.58), y: WY(1.18) }, // 踏步板
    { x0: WX(-8.85), x1: WX(-5.45), z0: WZ(5.18), z1: WZ(8.08), y: WY(6.12) }, // 高架走道（观景台）
  );
  // 外置木楼梯：沿 -X 上行 0.87→6.00（minY 判定让"从楼梯下走过"不会吸附）
  surfaceRamps.push({
    x0: WX(-5.25), x1: WX(4.25), z0: WZ(5.78), z1: WZ(7.78),
    ax0: WX(4.25), ay0: WY(0.87), ax1: WX(-5.25), ay1: WY(6.0),
  });

  // —— 墙体碰撞（前墙留门洞 LX 4.77..7.11） ——
  const wall = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / 0.9));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      colliders.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, r: 0.42 });
    }
  };
  wall(WX(-5.4), WZ(5.09), WX(4.6), WZ(5.09));   // 前墙（门西侧段）
  wall(WX(7.2), WZ(5.09), WX(8.9), WZ(5.09));    // 前墙（门东侧段）
  wall(WX(-5.4), WZ(-1.57), WX(8.9), WZ(-1.57)); // 后墙
  wall(WX(-5.4), WZ(-1.57), WX(-5.4), WZ(5.09)); // 西墙
  wall(WX(8.9), WZ(-1.57), WX(8.9), WZ(5.09));   // 东墙

  // —— 屋内陈设：弹药木箱 / 补给桶 ——
  const crateMat = new THREE.MeshStandardMaterial({ map: barkTex(), color: 0x9c8154, roughness: 0.95 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 1 });
  const mkCrate = (wx, wz, s, rot) => {
    const c = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.78, s * 0.92), crateMat);
    box.position.y = s * 0.39; box.castShadow = box.receiveShadow = true;
    c.add(box);
    for (const k of [-0.26, 0.26]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(s * 1.02, 0.06, s * 0.94), bandMat);
      band.position.y = s * 0.78 * k + s * 0.39; c.add(band);
    }
    c.position.set(wx, floorY, wz); c.rotation.y = rot;
    g.add(c);
  };
  mkCrate(WX(-4.2), WZ(-0.6), 0.72, 0.28);
  mkCrate(WX(-3.4), WZ(-0.8), 0.6, -0.14);
  mkCrate(WX(-3.8), WZ(-0.1), 0.52, 0.5);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x5e4a30, roughness: 0.95 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.28, 0.72, 12), barrelMat);
  barrel.position.set(WX(7.6), floorY + 0.36, WZ(3.6));
  barrel.castShadow = true;
  g.add(barrel);

  // —— 屋内吊灯（夜间照明，远远能看见木屋亮灯） ——
  const metalR = new THREE.MeshStandardMaterial({ color: 0x6e6a62, roughness: 0.55, metalness: 0.6 });
  const lantern = new THREE.Group();
  const lWire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.4, 4), metalR);
  lWire.position.y = 0.7; lantern.add(lWire);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.2, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffa63a, emissiveIntensity: 2.4, transparent: true, opacity: 0.85, roughness: 0.3 }));
  lantern.add(glass);
  const lCap = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.1, 8), metalR);
  lCap.position.y = 0.15; lantern.add(lCap);
  lantern.position.set(WX(1.7), WY(4.4), WZ(1.8));
  g.add(lantern);
  const inLight = new THREE.PointLight(0xffb057, 6.5, 16, 1.7);
  inLight.position.set(WX(1.7), WY(4.2), WZ(1.8));
  g.add(inLight);
  // 门廊油灯
  const porchL = new THREE.PointLight(0xffc98a, 3.6, 11, 1.9);
  porchL.position.set(WX(8.1), WY(2.1), WZ(6.9));
  g.add(porchL);
  const pGlass = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffe0b0, emissive: 0xffa63a, emissiveIntensity: 2.6, roughness: 0.3 }));
  pGlass.position.copy(porchL.position); g.add(pGlass);
}

// ================= 索桥 =================
function buildBridge(g) {
  const yD = CFG.BRIDGE_Y;
  const zA = 17, zB = -29, span = zA - zB;
  const sag = 1.4;

  // 桥塔
  for (const [z, dir] of [[zA + 1.2, -1], [zB - 1.2, 1]]) {
    const ty = baseHeight(0, z);
    const tower = new THREE.Group();
    const pier = new THREE.Mesh(new THREE.BoxGeometry(5.2, 3.2, 3.4), rockMat);
    pier.position.set(0, ty + 0.6, 0); pier.castShadow = true; pier.receiveShadow = true;
    tower.add(pier);
    for (const px of [-1.85, 1.85]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, 5.2, 0.34), woodDark);
      post.position.set(px, ty + 3.4, 0); tower.add(post);
      colliders.push({ x: px, z, r: 0.5 });
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 0.2), woodDark);
      brace.position.set(px, ty + 3.4, 0); brace.rotation.x = 0.5; brace.position.z = 0.7;
      tower.add(brace);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.3, 0.4), woodDark);
    beam.position.set(0, ty + 5.8, 0); tower.add(beam);
    tower.position.z = z;
    g.add(tower);
  }

  // 桥面木板（动态摆动）
  bridgePlanks = new THREE.Group();
  const plankGeo = new THREE.BoxGeometry(2.9, 0.1, 0.4);
  const nPlanks = Math.floor(span / 0.52);
  for (let i = 0; i < nPlanks; i++) {
    const z = zA - (i + 0.5) * (span / nPlanks);
    const p = new THREE.Mesh(plankGeo, i % 5 === 0 ? woodDark : woodMat);
    p.position.set((rng() - 0.5) * 0.1, yD - Math.sin((i / nPlanks) * Math.PI) * 0.18, z);
    p.rotation.x = (rng() - 0.5) * 0.03;
    p.castShadow = true; p.receiveShadow = true;
    bridgePlanks.add(p);
  }
  g.add(bridgePlanks);

  // 端头踏桥板（衔接地面）
  for (const [z, y] of [[zA + 2.4, yD - 0.35], [zB - 2.4, yD - 0.35]]) {
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 3.4), woodMat);
    ramp.position.set(0, baseHeight(0, z) + 0.15, z);
    ramp.rotation.x = (z > 0 ? 1 : -1) * 0.11;
    g.add(ramp);
  }

  // 主缆 / 扶手 / 吊索
  const cablePts = (side, hgt, sagK) => {
    const pts = [];
    for (let i = 0; i <= 22; i++) {
      const t = i / 22;
      pts.push(new THREE.Vector3(side * 1.55, yD + hgt - Math.sin(t * Math.PI) * sag * sagK, zA - t * span));
    }
    return new THREE.CatmullRomCurve3(pts);
  };
  for (const side of [-1, 1]) {
    const main = new THREE.Mesh(new THREE.TubeGeometry(cablePts(side, 2.1, 1), 36, 0.055, 5), ropeMat);
    g.add(main);
    const rail = new THREE.Mesh(new THREE.TubeGeometry(cablePts(side, 1.05, 0.13), 36, 0.035, 5), ropeMat);
    g.add(rail);
    for (let i = 1; i < 22; i += 2) {
      const t = i / 22;
      const top = cablePts(side, 2.1, 1).getPoint(t);
      const y = top.y;
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, y - (yD - 0.1), 4), ropeMat);
      h.position.set(side * 1.55, (y + yD) / 2, top.z);
      g.add(h);
    }
    // 系地缆
    for (const z of [zA + 3.4, zB - 3.4]) {
      const anchor = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5.5, 5), ropeMat);
      anchor.position.set(side * 2.4, baseHeight(0, z) + 1.2, z);
      anchor.rotation.z = side * 0.85; anchor.rotation.x = (z > 0 ? -0.4 : 0.4);
      g.add(anchor);
    }
  }
}

// ================= 沼泽木板路 =================
function buildBoardwalk(g) {
  const y = CFG.SWAMP_Y + 0.55;
  const plankGeo = new THREE.BoxGeometry(2.7, 0.11, 0.62);
  for (let z = 12; z <= 98; z += 0.72) {
    const p = new THREE.Mesh(plankGeo, (z * 10 | 0) % 3 === 0 ? woodDark : woodMat);
    p.position.set(86 + (rng() - 0.5) * 0.08, y + (rng() - 0.5) * 0.02, z);
    p.rotation.y = (rng() - 0.5) * 0.03;
    p.receiveShadow = true;
    g.add(p);
  }
  for (let z = 14; z <= 96; z += 6) {
    for (const px of [-1.25, 1.25]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.4, 5), woodDark);
      post.position.set(86 + px, y - 1.05, z);
      g.add(post);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 6, 4), ropeMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(86 + px, y + 0.8, z + 3);
      g.add(rail);
    }
  }
}

// ================= 山洞（开凿山体 + 岩石穹顶） =================
function buildCave(g) {
  const caveY = CFG.CAVE_Y;
  const wallMat = new THREE.MeshStandardMaterial({ map: rockTex(), color: 0x6b6459, roughness: 1, flatShading: true });
  const UP = new THREE.Object3D();

  // 穹顶岩块（覆盖走廊上方，形成隧道）
  const ceilGeo = new THREE.DodecahedronGeometry(1, 0);
  const ceil = new THREE.InstancedMesh(ceilGeo, wallMat, 190);
  let ci = 0;
  for (let z = -48; z > -176; z -= 2.6) {
    for (const x of [-6.5, -2.2, 2.2, 6.5]) {
      if (ci >= 190) break;
      UP.position.set(x + (rng() - 0.5) * 1.8, caveY + 8.4 + rng() * 1.6, z + (rng() - 0.5) * 1.2);
      UP.scale.set(3.4 + rng() * 2.4, 1.8 + rng() * 1.4, 3.2 + rng() * 2.6);
      UP.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      UP.updateMatrix();
      ceil.setMatrixAt(ci++, UP.matrix);
    }
  }
  ceil.count = ci;
  ceil.castShadow = true; ceil.receiveShadow = true;
  g.add(ceil);

  // 两侧岩壁凸起
  const wall = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), wallMat, 120);
  let wi = 0;
  for (let z = -50; z > -174 && wi < 120; z -= 2.2) {
    for (const side of [-1, 1]) {
      if (rng() < 0.25) continue;
      const s = 1.6 + rng() * 2.4;
      UP.position.set(side * (6.2 + rng() * 0.8), caveY + 0.6 + rng() * 3.2, z + rng());
      UP.scale.set(s, s * 0.95, s * 1.4);
      UP.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      UP.updateMatrix();
      wall.setMatrixAt(wi++, UP.matrix);
    }
  }
  wall.count = wi;
  wall.castShadow = true; wall.receiveShadow = true;
  g.add(wall);

  // 石笋 + 钟乳石
  const stalag = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 2.4, 7), wallMat, 46);
  let si = 0;
  for (let z = -54; z > -172 && si < 46; z -= 3) {
    if (rng() < 0.35) continue;
    UP.position.set((rng() - 0.5) * 8, caveY + 1.1, z);
    UP.scale.set(0.7 + rng() * 1.5, 0.7 + rng() * 1.9, 0.7 + rng() * 1.5);
    UP.rotation.set(Math.PI, rng() * 6.28, 0);
    UP.updateMatrix();
    stalag.setMatrixAt(si++, UP.matrix);
  }
  stalag.count = si;
  g.add(stalag);

  const stalact = new THREE.InstancedMesh(new THREE.ConeGeometry(0.4, 3.2, 6), wallMat, 34);
  let ti = 0;
  for (let z = -56; z > -170 && ti < 34; z -= 3.2) {
    if (rng() < 0.3) continue;
    UP.position.set((rng() - 0.5) * 8, caveY + 7.6, z);
    UP.scale.set(0.6 + rng() * 1.2, 0.8 + rng() * 1.6, 0.6 + rng() * 1.2);
    UP.rotation.set(0, rng() * 6.28, 0);
    UP.updateMatrix();
    stalact.setMatrixAt(ti++, UP.matrix);
  }
  stalact.count = ti;
  g.add(stalact);

  // 洞口岩框
  for (const z of [-46.5, -175.5]) {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(7.4, 1.9, 7, 14, Math.PI), wallMat);
    arch.position.set(0, caveY + 0.3, z);
    arch.scale.y = 1.15;
    g.add(arch);
  }

  // 发光水晶
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x3fbfae, emissive: 0x1d8f80, emissiveIntensity: 0.75, roughness: 0.3, flatShading: true });
  const spots = [[-3.6, -70], [3.8, -96], [-3.2, -124], [3.4, -148], [0, -162]];
  for (const [cx, cz] of spots) {
    for (let k = 0; k < 4; k++) {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), crystalMat);
      const s = 0.6 + rng() * 1.3;
      c.scale.set(s * 0.45, s * 1.9, s * 0.45);
      c.position.set(cx + (rng() - 0.5) * 1.3, caveY + s * 0.65, cz + (rng() - 0.5) * 1.3);
      c.rotation.set((rng() - 0.5) * 0.6, rng() * 6, (rng() - 0.5) * 0.6);
      g.add(c);
    }
    const light = new THREE.PointLight(0x48e2c6, 7, 15, 1.9);
    light.position.set(cx, caveY + 2.2, cz);
    g.add(light);
  }
  // 洞口微光
  for (const z of [-44, -178]) {
    const l = new THREE.PointLight(0xffb26a, 3.4, 12, 2);
    l.position.set(0, caveY + 3, z);
    g.add(l);
  }
}

// ================= 渔船（终点，泊在北岸栈桥外侧） =================
function buildRaft(g) {
  boatGroup = new THREE.Group();
  const inst = instance('boat');
  const WOOD = woodGrain();
  const logMat = new THREE.MeshStandardMaterial({ map: WOOD, color: 0x9d7b4f, roughness: 0.9 });

  if (inst) {
    // 渔船模型：船头朝 -Z（出海方向），原点=船中水线，主甲板局部高 1.0
    const boat = inst.wrap;
    boat.scale.setScalar(BOAT.scale);
    boatGroup.add(boat);

    // —— 甲板可站立面：主甲板 y=1.0（栈桥 0.96 平齐跨上；水中 curY 低于 0.05 不会被吸附） ——
    surfaceRects.push(
      { x0: BOAT.x - 0.85, x1: BOAT.x + 0.85, z0: BOAT.z - 2.5, z1: BOAT.z + 4.3, y: 1.0 },
    );

    // —— 尾甲板补给箱 + 煤油灯（夜里的定位灯） ——
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.48, 0.6), logMat);
    crate.position.set(0.9, 1.25, 3.2); crate.rotation.y = 0.25;
    crate.castShadow = true;
    boatGroup.add(crate);
    const lantern = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.07, 0.16, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffa63a, emissiveIntensity: 2.4, transparent: true, opacity: 0.85, roughness: 0.3 }));
    lantern.position.set(-0.9, 1.45, 2.8);
    boatGroup.add(lantern);
    const lampLight = new THREE.PointLight(0xffb057, 6, 12, 1.8);
    lampLight.position.set(-0.9, 1.65, 2.8);
    boatGroup.add(lampLight);

    // 泊位：栈桥外侧（jx=RAFT.x-2.4），船身纵轴贴桥，船头朝 -Z 出海
    boatGroup.position.set(BOAT.x, BOAT.y, BOAT.z);
    boatGroup.rotation.y = 0.07;            // 模型船头已是 -Z，加一点系泊偏角
    boatGroup.rotation.z = 0.015;           // 轻微侧倾，更自然
    boatBaseY = BOAT.y;
  } else {
    // 降级：简易木筏（无 boat.glb 时），沿用旧救生筏布局
    console.warn('[structures] boat.glb 缺失，使用简易木筏');
    const orange = new THREE.MeshStandardMaterial({ color: 0xb8492a, roughness: 0.62 });
    for (const s of [-1, 1]) {
      const pon = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 3.5, 6, 12), orange);
      pon.rotation.z = Math.PI / 2;
      pon.position.set(0, 0.34, s * 1.35);
      boatGroup.add(pon);
    }
    for (let i = 0; i < 7; i++) {
      const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 3.9, 9), logMat);
      lg.rotation.z = Math.PI / 2;
      lg.position.set(0, 0.74, -1.2 + i * 0.4);
      boatGroup.add(lg);
    }
    boatGroup.position.set(RAFT.x, 0.62, RAFT.z - 1);
    boatGroup.rotation.y = 0.35;
    boatBaseY = 0.62;
  }
  g.add(boatGroup);

  // 滩头木栈桥：从干沙一路伸进浅湾，架在木桩上（尾端压到渔船主甲板边缘，0.96→1.0 平齐登船）
  const jetty = new THREE.Group();
  const plankMat = new THREE.MeshStandardMaterial({ color: 0x9c8666, roughness: 0.95 });
  const jx = RAFT.x - 2.4, jz0 = RAFT.z + 12.5, jz1 = RAFT.z - 0.6;
  const jLen = jz0 - jz1;
  const nPlanks = 20;
  for (let i = 0; i < nPlanks; i++) {
    const z = jz0 - i * (jLen / (nPlanks - 1));
    const pl = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, jLen / (nPlanks - 1) * 0.62), plankMat);
    pl.position.set(jx + (i % 2 ? 0.025 : -0.025), 0.94 - i * 0.004, z);
    pl.rotation.y = (rng() - 0.5) * 0.03;
    pl.castShadow = pl.receiveShadow = true;
    jetty.add(pl);
  }
  for (const [pz, ph] of [[jz0 - 0.6, 3.2], [jz0 - 4.4, 4.4], [jz0 - 8.2, 4.4], [jz1 + 0.5, 4.2]]) {
    for (const px of [-0.98, 0.98]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, ph, 6), woodDark);
      post.position.set(jx + px, 0.9 - ph / 2, pz);
      post.castShadow = true;
      jetty.add(post);
    }
  }
  // 系筏的缆绳桩
  const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.75, 7), woodDark);
  bollard.position.set(jx + 0.75, 1.3, jz1 + 0.35);
  jetty.add(bollard);
  g.add(jetty);
}
export function updateRaft(t) {
  if (!boatGroup) return;
  boatGroup.position.y = boatBaseY + Math.sin(t * 0.9) * 0.08;
  boatGroup.rotation.z = 0.015 + Math.sin(t * 0.7) * 0.025;
  boatGroup.rotation.x = Math.sin(t * 0.53) * 0.012;
}

// ================= 南岸遇难现场（真实礁石 + 冲上岸的残骸） =================
// 旧版是「9 边圆柱船体 + 5 根半圆环船肋 + 一根断桅杆」的纯色低模，和 PBR 沙滩同框非常突兀，已整体删除。
// 现在用 D:/Downloads/ocean_rocky_island 的航拍扫描礁石（assets/reef.glb）：
// 近岸一块搁浅礁（就在旧沉船外侧）+ 外海两座离岸岛。GLB 原点=航拍水线，
// y<0 的水下礁盘被游戏海面盖住，y>0 的岩峰与植被自然出水。
export const reefState = { instances: 0, missing: false, skipped: false, placements: [] };

const REEF_SPOTS = [
  // 三座都放在深海边界（半径 250）之外，玩家到不了，避免相机钻进礁石模型看到背面
  { x: 0, z: 278, s: 0.13, rot: 0.6 },       // 近岸礁：正对出生点，替代原来那堆假船肋
  { x: -95, z: 320, s: 0.26, rot: 2.4 },    // 外海中岛
  { x: 135, z: 385, s: 0.34, rot: -1.1 },   // 外海远岛
];

function buildOffshoreReefs(g) {
  // 隔离调试：?noreef=1 只关离岸礁岛，方便和旧版画面对比
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('noreef')) {
    reefState.skipped = true;
    return;
  }
  for (const r of REEF_SPOTS) {
    const inst = instance('reef');
    if (!inst) { reefState.missing = true; console.warn('[structures] reef.glb 缺失，跳过离岸礁岛'); break; }
    const w = inst.wrap;
    w.position.set(r.x, CFG.SEA_Y, r.z);
    w.scale.setScalar(r.s);
    w.rotation.y = r.rot;
    // 大范围地形块不投影：方向光阴影相机只覆盖玩家附近，强开会在海面拉出假阴影
    w.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    g.add(w);
    reefState.instances++;
    reefState.placements.push({ x: r.x, z: r.z, s: r.s });
    // 只有近岸这块在玩家可达范围内，给个圆形碰撞免得穿进礁石
    if (r.collider) colliders.push({ x: r.x, z: r.z, r: r.collider });
  }
}

function buildWreck(g) {
  buildOffshoreReefs(g);
  // 撞礁后冲上岸的补给箱：浅木纹 + 歪斜 + 半埋进沙里
  const crateMat = new THREE.MeshStandardMaterial({ map: woodGrain(), color: 0xe6d3b0, roughness: 0.96 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 1 });
  for (let i = 0; i < 4; i++) {
    const x = -22 + rng() * 12, z = 194 + rng() * 13;
    const w = 0.8 + rng() * 0.45, h = 0.62 + rng() * 0.16;
    const crate = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.92), crateMat);
    box.castShadow = box.receiveShadow = true;
    crate.add(box);
    for (const k of [-0.28, 0.28]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, 0.07, w * 0.94), bandMat);
      band.position.y = h * k; crate.add(band);
    }
    crate.position.set(x, baseHeight(x, z) + h * 0.24, z);
    crate.rotation.set((rng() - 0.5) * 0.28, rng() * 6.28, (rng() - 0.5) * 0.3);
    g.add(crate);
  }
  buildWreckRocks(g);
}

// 撞碎船体的那片礁石：用带 PBR 贴图的 rock.glb 几何，半埋进沙里
// （旧的纯色圆柱船体 / 半圆环船肋 / 断桅杆已全部删除，木板条会悬空，也不再用）
function buildWreckRocks(g) {
  const inst = instance('rock');
  if (!inst) return;
  let geo = null;
  inst.wrap.traverse(o => { if (!geo && o.isMesh && o.geometry) geo = o.geometry; });
  if (!geo) return;
  geo = geo.clone();
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  const mat = new THREE.MeshStandardMaterial({ map: rockTex(), color: 0xe0d8c8, roughness: 0.96 });
  const ROCKS = [
    [-16, 211, 1.9], [-9, 215, 1.5], [-20, 218, 1.7], [-5, 207, 1.3], [-13, 222, 1.8],
  ];
  for (const [x, z, s] of ROCKS) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, baseHeight(x, z) - 0.30 * s, z);
    m.scale.set(s, s * 0.85, s * 0.95);
    m.rotation.set((rng() - 0.5) * 0.14, rng() * 6.28, (rng() - 0.5) * 0.14);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    colliders.push({ x, z, r: 1.0 * s });
  }
}
