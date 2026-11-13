// 全局配置与地图布局
export const CFG = {
  WORLD: 560,            // 世界边长 (x,z ∈ ±280)
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
  SWAMP_SLOW_R: 40,
  POISON_DPS: 4, POISON_TIME: 6,
  DEEP_R: 250,           // 深海边界（禁出）
  // 步枪
  RIFLE_DMG: 34, RIFLE_RPM: 360, MAG: 30, RELOAD: 1.9,
  RIFLE_RANGE: 160, SPREAD: 0.011, AIM_SPREAD: 0.004,
  // 军刀
  KNIFE_DMG: 60, KNIFE_RANGE: 2.4, KNIFE_CD: 0.45,
};

// 地图关键点
export const SPAWN = { x: 0, z: 205 };
export const RAFT  = { x: 5, z: -218 };
export const BOAT  = { x: 2.9, z: -220.8, y: 0, scale: 0.55 }; // 渔船（泊在栈桥外，船头朝海；GLB 原点=船中水线，主甲板高 1.0）
export const POND  = { x: -78, z: 62 };
export const SWAMP = { x: 86, z: 52 };
export const MOUNT = { x: 0, z: -120 };      // 山体（含洞穴）
export const CAVE_IN  = { x: 0, z: -50 };    // 洞口（南）
export const CAVE_OUT = { x: 0, z: -172 };   // 洞口（北）
export const BRIDGE = { x: 0, z0: 14, z1: -26 }; // 索桥（跨峡谷）
export const CABIN = { x: -34, z: 15.5, padY: 5.3 }; // 林中木屋（地形压平到 padY）

// 引导小径折线（林间开路 + 泥土色）
export const TRAIL = [
  { x: 0, z: 205 }, { x: -28, z: 158 }, { x: -58, z: 112 }, { x: -104, z: 74 },
  { x: -96, z: 40 }, { x: -52, z: 22 }, { x: -14, z: 24 }, { x: 0, z: 18 },
  { x: 0, z: -26 },               // 过索桥
  { x: 0, z: -50 }, { x: 0, z: -100 }, { x: 0, z: -150 }, { x: 0, z: -172 }, // 穿洞
  { x: 3, z: -196 }, { x: 5, z: -218 }, // 北岸
  // 支线：沼泽木板路
  { x: 86, z: 96 }, { x: 86, z: 52 }, { x: 86, z: 14 },
];
export const TRAIL_W = 5.2;

// 拾取点 [x, z, 类型]  ammo / medkit
export const PICKUPS = [
  [-28, 158, 'ammo'], [-104, 74, 'ammo'], [-96, 40, 'medkit'],
  [40, 60, 'ammo'], [86, 70, 'medkit'], [0, 18, 'ammo'],
  [0, -40, 'ammo'], [0, -100, 'ammo'], [0, -140, 'medkit'], [0, -172, 'ammo'],
  [44, -150, 'ammo'], [-40, -180, 'medkit'],
  // 林中木屋补给（屋内×3 + 门廊×1）
  [-37, 18, 'ammo'], [-29.5, 15, 'ammo'], [-31.5, 19.3, 'medkit'], [-27, 21.9, 'medkit'],
];

// 野兽巢穴 [类型, x, z, 数量]
export const BEAST_SPAWNS = [
  ['wolf', -50, 130, 3], ['wolf', 40, 95, 2], ['wolf', -60, -30, 2],
  ['bear', -78, 96, 1],                       // 水塘边的棕熊
  ['dino', 30, 125, 2],                       // 密林深处的变异恐龙
  // 山洞守卫（走廊 x∈±9, z -50..-172）：spawnAll 有 ±7 抖动，出生点取 x=0 才不会抖出洞壁
  ['zombie', 0, -85, 2], ['zombie', 0, -115, 2], ['zombie', 0, -145, 2], ['zombie', 0, -168, 1],
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
  { name: '林中木屋', sub: 'HUNTER CABIN', x0: -46, z0: 5, x1: -22, z1: 27, once: true },
  { name: '密林腹地', sub: 'DEEP JUNGLE', x0: -160, z0: 90, x1: 160, z1: 180, once: true },
  { name: '林间水塘', sub: 'JUNGLE POOL', x0: -125, z0: 30, x1: -35, z1: 95, once: true },
  { name: '瘴气沼泽', sub: 'MIASMA SWAMP', x0: 40, z0: 10, x1: 135, z1: 100, once: true },
  { name: '断魂谷',   sub: 'RAVINE CROSSING', x0: -80, z0: -30, x1: 80, z1: 18, once: true },
  { name: '山腹洞穴', sub: 'THE HOLLOW', x0: -30, z0: -175, x1: 30, z1: -45, once: true },
  { name: '北岸滩头', sub: 'NORTH SHORE', x0: -60, z0: -250, x1: 70, z1: -185, once: true },
];
