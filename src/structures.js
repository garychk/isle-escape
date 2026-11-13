// 结构物：索桥 / 沼泽木板路 / 山洞穹顶 / 救生筏 / 遇难残骸 / 林中木屋
import * as THREE from 'three';
import { CFG, RAFT, CABIN } from './config.js';
import { mulberry32 } from './util.js';
import { baseHeight, surfaceRects, surfaceRamps } from './terrain.js';
import { colliders } from './flora.js';
import { barkTex, rockTex, woodGrain, sailTex } from './textures.js';
import { instance } from './assets.js';

const rng = mulberry32(777);
const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 0.94 });
const woodDark = new THREE.MeshStandardMaterial({ color: 0x5e4a30, roughness: 0.97 });
const ropeMat = new THREE.MeshStandardMaterial({ color: 0xa8946c, roughness: 1 });
const rockMat = new THREE.MeshStandardMaterial({ map: rockTex(), color: 0x8d8577, roughness: 1, flatShading: true });

export const bridgeState = { swayY: 0, rotZ: 0, t: 0 };
export let bridgePlanks = null;
export let raftGroup = null;

export function buildStructures(scene) {
  const g = new THREE.Group();
  scene.add(g);
  buildBridge(g);
  buildBoardwalk(g);
  buildCave(g);
  buildRaft(g);
  buildWreck(g);
  buildCabin(g);
  return g;
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

// ================= 救生筏（终点） =================
function buildRaft(g) {
  raftGroup = new THREE.Group();
  const WOOD = woodGrain(); const WOOD2 = woodGrain();
  const logMat = new THREE.MeshStandardMaterial({ map: WOOD, color: 0x9d7b4f, roughness: 0.9 });
  const logDark = new THREE.MeshStandardMaterial({ map: WOOD2, color: 0x6d5334, roughness: 0.95 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xb8492a, roughness: 0.62 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x9a8660, roughness: 1 });
  const SAIL = sailTex();
  const sailMat = new THREE.MeshStandardMaterial({ map: SAIL, color: 0xe6e0cc, roughness: 0.92, side: THREE.DoubleSide });
  const metalR = new THREE.MeshStandardMaterial({ color: 0x6e6a62, roughness: 0.55, metalness: 0.6 });

  // —— 浮筒（救生筏两侧的橙色气囊 + 绑绳） ——
  for (const s of [-1, 1]) {
    const pon = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 3.5, 6, 12), orange);
    pon.rotation.z = Math.PI / 2;
    pon.position.set(0, 0.34, s * 1.35);
    pon.castShadow = true;
    raftGroup.add(pon);
    // 绑绳：每 0.6m 一圈
    for (let i = 0; i < 6; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.022, 5, 12), ropeMat);
      ring.position.set(-1.5 + i * 0.6, 0.34, s * 1.35);
      ring.rotation.y = Math.PI / 2;
      raftGroup.add(ring);
    }
  }
  // —— 甲板：一排原木 ——
  for (let i = 0; i < 7; i++) {
    const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 3.9, 9), i % 2 ? logMat : logDark);
    lg.rotation.z = Math.PI / 2;
    lg.position.set(0, 0.74, -1.2 + i * 0.4);
    lg.castShadow = lg.receiveShadow = true;
    raftGroup.add(lg);
  }
  // 横向压木（把原木捆在一起）
  for (const px of [-1.5, 0, 1.5]) {
    const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 3.2, 7), logDark);
    tie.rotation.x = Math.PI / 2; tie.position.set(px, 0.99, 0);
    raftGroup.add(tie);
  }
  // —— 桅杆 + 横桁 + 帆 ——
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.105, 3.7, 8), logDark);
  mast.position.set(-1.0, 2.45, 0); mast.castShadow = true;
  raftGroup.add(mast);
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.9, 6), logDark);
  yard.rotation.z = Math.PI / 2; yard.position.set(-0.35, 3.9, 0);
  raftGroup.add(yard);
  // 帆：带褶皱的曲面
  const sailGeo = new THREE.PlaneGeometry(1.9, 1.5, 10, 8);
  {
    const sp = sailGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i), y = sp.getY(i);
      sp.setZ(i, Math.sin(x * 4.2) * 0.055 + Math.cos(y * 3.1) * 0.04 + 0.16 * (1 - Math.abs(x) / 0.95));
    }
    sailGeo.computeVertexNormals();
  }
  const sail = new THREE.Mesh(sailGeo, sailMat);
  sail.position.set(-0.2, 3.15, 0); sail.rotation.y = -0.22;
  sail.castShadow = true;
  raftGroup.add(sail);
  // 桅顶旗
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.55, 6, 3), new THREE.MeshStandardMaterial({ color: 0xc2371f, roughness: 0.85, side: THREE.DoubleSide }));
  flag.position.set(-0.55, 4.15, 0); flag.rotation.y = 0.1;
  raftGroup.add(flag);
  // 索具
  for (const [ax, ay, az, bx, by, bz] of [
    [-1.0, 4.2, 0, -1.9, 1.0, 1.5], [-1.0, 4.2, 0, -1.9, 1.0, -1.5],
    [-1.0, 4.2, 0, 1.6, 1.0, 0], [-1.0, 3.9, 0, 0.6, 3.9, 0],
  ]) {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    const len = a.distanceTo(b);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 5), ropeMat);
    r.position.copy(a).lerp(b, 0.5);
    r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    raftGroup.add(r);
  }
  // —— 补给箱 / 木桶 / 木桨 / 油灯 ——
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.62, 0.78), logMat);
  crate.position.set(1.2, 1.5, -0.9); crate.rotation.y = 0.2;
  crate.castShadow = true;
  raftGroup.add(crate);
  for (const yy of [-0.2, 0.2]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.8), metalR);
    band.position.set(1.2, 1.5 + yy, -0.9); band.rotation.y = 0.2;
    raftGroup.add(band);
  }
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.26, 0.6, 12), logDark);
  barrel.position.set(1.05, 1.4, 0.35); barrel.rotation.z = 0.08;
  raftGroup.add(barrel);
  for (const yy of [-0.18, 0.18]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.275, 0.022, 5, 14), metalR);
    hoop.position.set(1.05, 1.4 + yy, 0.35); hoop.rotation.x = Math.PI / 2; hoop.rotation.z = 0.08;
    raftGroup.add(hoop);
  }
  const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.3, 6), logDark);
  oar.position.set(1.35, 1.05, 1.0); oar.rotation.set(1.32, 0.3, 0.42);
  raftGroup.add(oar);
  const bladeO = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.44), logDark);
  bladeO.position.set(1.95, 0.86, 1.55); bladeO.rotation.set(0.5, 0.3, 0.42);
  raftGroup.add(bladeO);
  // 油灯（夜里会亮）
  const lantern = new THREE.Group();
  const lBase = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.05, 8), metalR);
  lBase.position.y = 0; lantern.add(lBase);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.12, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffa63a, emissiveIntensity: 2.4, transparent: true, opacity: 0.85, roughness: 0.3 }));
  glass.position.y = 0.09; lantern.add(glass);
  const lTop = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.06, 8), metalR);
  lTop.position.y = 0.17; lantern.add(lTop);
  lantern.position.set(-1.55, 1.16, -0.5);
  raftGroup.add(lantern);
  const lampLight = new THREE.PointLight(0xffb057, 6, 11, 1.8);
  lampLight.position.set(-1.55, 1.3, -0.5);
  raftGroup.add(lampLight);

  raftGroup.position.set(RAFT.x, 0.62, RAFT.z - 1);
  raftGroup.rotation.y = 0.35;
  g.add(raftGroup);

  // 滩头木栈桥：从干沙一路伸进浅湾，架在木桩上
  const jetty = new THREE.Group();
  const plankMat = new THREE.MeshStandardMaterial({ color: 0x9c8666, roughness: 0.95 });
  const jx = RAFT.x - 2.4, jz0 = RAFT.z + 12.5, jz1 = RAFT.z + 2.2;
  const jLen = jz0 - jz1;
  for (let i = 0; i < 16; i++) {
    const z = jz0 - i * (jLen / 15);
    const pl = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, jLen / 15 * 0.62), plankMat);
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
  if (!raftGroup) return;
  raftGroup.position.y = 0.62 + Math.sin(t * 0.9) * 0.08;
  raftGroup.rotation.z = Math.sin(t * 0.7) * 0.025;
  raftGroup.rotation.x = Math.sin(t * 0.53) * 0.012;
}

// ================= 南岸遇难残骸 =================
function buildWreck(g) {
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x6b5540, roughness: 0.95, flatShading: true });
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.7, 7.2, 9, 1, true), hullMat);
  hull.rotation.set(0, 0.9, Math.PI / 2 - 0.22);
  hull.position.set(-10, 1.2, 211);
  hull.castShadow = true;
  g.add(hull);
  const ribMat = new THREE.MeshStandardMaterial({ color: 0x4e3c2a, roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.13, 5, 10, Math.PI), ribMat);
    rib.position.set(-13 + i * 1.5, 1.7, 209 + i * 0.9);
    rib.rotation.set(0.1, 0.9, 0.35);
    g.add(rib);
  }
  // 冲上岸的补给箱：木纹 + 歪斜 + 半埋进沙里，避免像摆在地上的纯色方盒
  const crateMat = new THREE.MeshStandardMaterial({ map: barkTex(), color: 0x9c8154, roughness: 0.96 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 1 });
  for (let i = 0; i < 6; i++) {
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
    crate.position.set(x, baseHeight(x, z) + h * 0.34, z);
    crate.rotation.set((rng() - 0.5) * 0.28, rng() * 6.28, (rng() - 0.5) * 0.3);
    g.add(crate);
  }
  // 断裂桅杆
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6, 6), ribMat);
  m.position.set(-4, 2.2, 206); m.rotation.set(0.9, 0.4, 1.1);
  g.add(m);
}
