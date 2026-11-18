// 全局配置与地图布局
export const CFG = {
  WORLD: 700,            // 世界边长 (x,z ∈ ±350)；2026-11-18 岛屿平面放大 ×1.25（高度体系不变）
  SEA_Y: 0,              // 海平面
  POND_Y: 2.55,          // 水塘水面
  SWAMP_Y: 2.6,          // 沼泽水面
  BRIDGE_Y: 6.65,         // 索桥桥面高度
  CAVE_Y: 7.0,           // 洞底高度
  GRAV: 22,
  EYE: 1.62,             // 眼睛高度
  // 注意：WALK 必须贴近 walk.glb 的原生步速（Mixamo Walking ≈1.97m/s），
  // 否则播放速率会被强行拉快，看起来就是"小碎步飞驰"。2.4 对应 1.22×，肉眼已很自然。
  WALK: 2.4, RUN: 7.0, SWAMP_WALK: 2.0, CROUCH_MULT: 0.55,
  JUMP: 7.4,
  HP_MAX: 100, ST_MAX: 100,
  ST_DRAIN: 22, ST_REGEN: 14,
  SWAMP_DPS: 3.5,        // 沼泽血蛭伤害
  SWAMP_SLOW_R: 50,
  POISON_DPS: 4, POISON_TIME: 6,
  DEEP_R: 312,           // 深海边界（禁出）
  // 步枪
  RIFLE_DMG: 34, RIFLE_RPM: 360, MAG: 30, RELOAD: 1.9,
  RIFLE_RANGE: 160, SPREAD: 0.011, AIM_SPREAD: 0.004,
  // 军刀
  KNIFE_DMG: 60, KNIFE_RANGE: 2.4, KNIFE_CD: 0.45,
};

// 地图关键点（2026-11-18 岛屿放大：平面 ×1.25，高度体系不变）
export const SPAWN = { x: 0, z: 256 };
export const RAFT  = { x: 6.25, z: -272.5 };
export const BOAT  = { x: 3.625, z: -276, y: 0, scale: 0.55 }; // 渔船（泊在栈桥外，船头朝海；GLB 原点=船中水线，主甲板高 1.0）
export const POND  = { x: -97.5, z: 77.5 };
export const SWAMP = { x: 107.5, z: 65 };
export const MOUNT = { x: 0, z: -150 };      // 山体（含洞穴）
export const CAVE_IN  = { x: 0, z: -62.5 };    // 洞口（南）
export const CAVE_OUT = { x: 0, z: -215 };   // 洞口（北）
export const BRIDGE = { x: 0, z0: 17.5, z1: -32.5 }; // 索桥（跨峡谷）
export const CABIN = { x: -42.5, z: 19.375, padY: 5.3 }; // 林中木屋（地形压平到 padY）
export const CAMPFIRE = { x: 87.5, z: 37.5 }; // 沼泽边废弃营地篝火（靠近回血补给点）
export const MARBLE = { x: 175, z: -100, s: 4.8, rot: -Math.PI / 2, sink: 9 }; // 东岭大理石山（carrara 采石场扫描）

// 引导小径折线（林间开路 + 泥土色）
export const TRAIL = [
  { x: 0, z: 256 }, { x: -35, z: 197.5 }, { x: -72.5, z: 140 }, { x: -130, z: 92.5 },
  { x: -120, z: 50 }, { x: -65, z: 27.5 }, { x: -17.5, z: 30 }, { x: 0, z: 22.5 },
  { x: 0, z: -32.5 },               // 过索桥
  { x: 0, z: -62.5 }, { x: 0, z: -125 }, { x: 0, z: -187.5 }, { x: 0, z: -215 }, // 穿洞
  { x: 3.75, z: -245 }, { x: 6.25, z: -272.5 }, // 北岸
  // 支线：沼泽木板路
  { x: 107.5, z: 120 }, { x: 107.5, z: 65 }, { x: 107.5, z: 17.5 },
];
export const TRAIL_W = 5.2;

// 拾取点 [x, z, 类型]  ammo / medkit
export const PICKUPS = [
  [-35, 197.5, 'ammo'], [-130, 92.5, 'ammo'], [-120, 50, 'medkit'],
  [50, 75, 'ammo'], [107.5, 87.5, 'medkit'], [0, 22.5, 'ammo'],
  [0, -50, 'ammo'], [0, -125, 'ammo'], [0, -175, 'medkit'], [0, -215, 'ammo'],
  [55, -187.5, 'ammo'], [-50, -225, 'medkit'],
  // 林中木屋补给（屋内×3 + 门廊×1；木屋本体不放大，保持相对 CABIN 的偏移）
  [-45.5, 21.875, 'ammo'], [-38, 18.875, 'ammo'], [-40, 23.175, 'medkit'], [-35.5, 25.775, 'medkit'],
  // 新增：地标附近的探索奖励，鼓励离路探索
  [-80, 140, 'medkit'],   // 瞭望塔下
  [55, 123.75, 'ammo'],       // 飞机残骸
  [87.5, 42.5, 'ammo'],       // 沼泽营地
  [20, -261.25, 'medkit'],   // 北岸信号塔
  [-150, 162.5, 'ammo'], [-162.5, 75, 'medkit'],   // 西侧密林深处
  [120, -62.5, 'ammo'],    // 东岭大理石山脚（原东侧北岸点，挪到山西侧空地）
];

// 野兽巢穴 [类型, x, z, 数量]
export const BEAST_SPAWNS = [
  ['wolf', -62.5, 162.5, 3], ['wolf', 50, 118.75, 2], ['wolf', -75, -37.5, 2],
  ['bear', -97.5, 120, 1],                       // 水塘边的棕熊
  ['dino', 37.5, 156.25, 2],                     // 密林深处的变异恐龙
  // 山洞守卫（走廊 x∈±11, z -62.5..-215）：spawnAll 有 ±8.75 抖动，出生点取 x=0 才不会抖出洞壁
  ['zombie', 0, -106, 2], ['zombie', 0, -144, 2], ['zombie', 0, -181, 2], ['zombie', 0, -210, 1],
  // 新增：地标附近的游荡兽群，奖励探索也提升威胁
  ['wolf', -80, 135, 2],    // 瞭望塔
  ['zombie', 55, 120, 2],   // 飞机残骸（洞外也有僵尸，制造"林地不安"的氛围）
  ['dino', 147.5, -137.5, 1],   // 东岭（大理石山脚守卫）
  ['wolf', -156.25, 68.75, 2],    // 西侧密林
];

// 野兽数值
export const BEASTS = {
  // 注：带骨骼行走动画的兽（wolf/bear/dino），spd 就是"走路节奏"的限速器：
  // animals.js 用 spd ÷ 动画原生步速(walkSpeed，实测值 1.30/1.60/1.40) 实时匹配播放速率，
  // 脚掌踩实地面不打滑。这里统一取原生步速的 1.1–1.25 倍 —— 走起来还是"走路"的节奏，
  // 不会出现快放录像那种腿踩缝纫机、身体却平移的假动作。
  wolf:   { hp: 70,  spd: 1.50, dmg: 14, atkR: 1.9, atkCd: 1.1, hear: 70, name: '行尸' }, // wolf.glb（原林狼槽位），丧尸式蹒跚
  bear:   { hp: 260, spd: 1.75, dmg: 34, atkR: 2.6, atkCd: 1.8, hear: 60, name: '突变巨兽' }, // mutant.glb（原棕熊槽位），沉重踏步
  dino:   { hp: 120, spd: 1.75, dmg: 22, atkR: 2.2, atkCd: 1.3, hear: 65, name: '变异恐龙' }, // 双足驼背暴徒；dino.glb 含 idle/walk/swipe
  zombie: { hp: 45,  spd: 0.80, dmg: 8,  atkR: 1.7, atkCd: 1.4, hear: 45, name: '洞窟僵尸' }, // 小怪：zombie.glb（兜帽平民），拖沓踱步、挥棒轻击
};

// 区域名卡（进入区域时展示）
export const ZONES = [
  { name: '林中木屋', sub: 'HUNTER CABIN', x0: -57.5, z0: 6.25, x1: -27.5, z1: 33.75, once: true },
  { name: '密林腹地', sub: 'DEEP JUNGLE', x0: -200, z0: 112.5, x1: 200, z1: 225, once: true },
  { name: '林间水塘', sub: 'JUNGLE POOL', x0: -156.25, z0: 37.5, x1: -43.75, z1: 118.75, once: true },
  { name: '瘴气沼泽', sub: 'MIASMA SWAMP', x0: 50, z0: 12.5, x1: 168.75, z1: 125, once: true },
  { name: '回声水洼', sub: 'ECHO MARSH POOLS', x0: 52.5, z0: -222.5, x1: 168.75, z1: 72.5, once: true },
  { name: '断魂谷',   sub: 'RAVINE CROSSING', x0: -100, z0: -37.5, x1: 100, z1: 22.5, once: true },
  { name: '山腹洞穴', sub: 'THE HOLLOW', x0: -37.5, z0: -218.75, x1: 37.5, z1: -56.25, once: true },
  { name: '北岸滩头', sub: 'NORTH SHORE', x0: -75, z0: -312.5, x1: 87.5, z1: -231.25, once: true },
];
