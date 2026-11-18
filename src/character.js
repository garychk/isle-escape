// 第三人称角色：GLB 人物 + 动画状态机 + 武器插槽
// 没有 player.glb 时自动退化为内置假人（可走可跳可翻滚可持枪），保证功能先跑通。
import * as THREE from 'three';
import { instance, findBone } from './assets.js';
import { buildRifle, buildKnife } from './weapons.js';

// 动画别名表：GLB 里的 clip 名只要命中正则就能挂上对应动作
// 顺序有讲究：带方向后缀的必须排在 walk / run 前面，否则 walk_back 会被 /walk/ 抢走
const ALIAS = [
  // 持刀专有的待机/移动姿势（Idle.fbx / Jab Cross.fbx）：
  // knife_idle 带 idle、knife_walk 带 walk，都必须排在通用 idle / walk 前面。
  ['knifeIdle', /knife.*idle|knife.*hold/i],
  ['knifeWalk', /knife.*walk|knife.*move/i],
  // 空手专属的站立/停步/左右转：必须排在最前面。
  // stop_walk 带 "walk"、idle_unarmed 带 "idle"，否则会被通用的 /walk/ /idle/ 抢走，
  // 把持械的 walk / idle 覆盖成空手动作。
  ['idle_unarmed', /unarm.*idle|idle.*unarm/i],
  ['turn_right', /turn.*right|right.*turn/i],
  ['turn_left', /turn.*left|left.*turn/i],
  ['stop_walk', /stop.*walk|walk.*stop/i],
  // 空手走跑（Standard Walk / Running，武器收起时用）：必须排在 run / walk 前面
  ['run_unarmed', /unarm.*run|run.*unarm/i],
  ['walk_unarmed', /unarm.*walk|walk.*unarm/i],
  ['run', /run|sprint|jog_?fast/i],
  ['aimWalk', /aim[_ ]?walk/i],   // 必须排在 walk 前，否则 aim_walk 会被 /walk/ 吞掉
  ['walk', /walk|jog/i],
  ['run_back', /run[_ ]?back|back[_ ]?run/i],
  ['walk_back', /walk[_ ]?back|back[_ ]?walk/i],
  ['strafe_l', /strafe[_ ]?l|sidestep[_ ]?l|step[_ ]?l/i],
  ['strafe_r', /strafe[_ ]?r|sidestep[_ ]?r|step[_ ]?r/i],
  ['crouchWalk', /crouch.*(walk|move)|(walk|move).*crouch/i],
  ['crouchIdle', /crouch.*(idle|stand)|(idle|stand).*crouch/i],
  ['jump', /^(jump|jumpstart|jump_?up)/i],
  ['fall', /fall|air|jump_?loop|inair/i],
  ['roll', /roll|dodge/i],
  ['aim', /aim|ads|point/i],
  ['shoot', /shoot|fire|rifle|recoil/i],
  ['slash', /slash|attack|swing|melee|stab/i],
  ['hit', /hit_?reaction|hit$|^hit|impact|flinch/i],
  ['reload', /reload/i],
  ['drive', /drive|riding|sit/i],
  ['die', /death|dying|^die$/i],
  ['idle', /idle|stand|breath/i],
];

const MATERIALS = {
  skin: new THREE.MeshStandardMaterial({ color: 0x9d7a5e, roughness: 0.72 }),
  cloth: new THREE.MeshStandardMaterial({ color: 0x3f4a3a, roughness: 0.92 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x24282a, roughness: 0.85 }),
  boot: new THREE.MeshStandardMaterial({ color: 0x1b1a18, roughness: 0.75 }),
};

// 各段移动动画的原生速度（Blender 实测：步幅/周期），单位 m/s。
// 播放速率 = 实际移速 / 原生速度，脚底才不会打滑也不会"碎步飞驰"。
// key 必须全小写：查表用的是 clip 名小写。
const NATIVE_SPEED = {
  walk: 1.97, run: 6.68, walk_back: 2.17, run_back: 2.9,
  strafe_l: 1.9, strafe_r: 1.9, crouchwalk: 1.1, crouchidle: 1.0,
  aimwalk: 0.58,   // 瞄准战术步行（Walk Forward，Blender 实测根位移 0.58 m/s）
  // 空手走跑（标准 Walk / Running，原地动画，无根位移）：
  // 用"支撑相脚掌相对身体的后移速度"实测，并用 walk/run 的已知根位移速度定标
  walk_unarmed: 2.50, run_unarmed: 7.60,
  // 持刀挪步（Walking (3).fbx）：素材一个循环 1.033s 只前移 0.50m，是慢挪步；
  // 游戏持刀速度 2.4*1.12=2.69m/s，播放速率由 update() 自适应并限幅到 1.7x，
  // 既不变成慢动作、也不至于快放到糊。
  knifeWalk: 1.60,
};

// 属于"位移循环"的剪辑：切换时沿用彼此的相位，脚不跳
const LOCO = new Set(['walk', 'run', 'walk_back', 'run_back', 'strafe_l', 'strafe_r',
  'crouchWalk', 'crouchIdle', 'aimWalk', 'walk_unarmed', 'run_unarmed', 'knifeWalk']);

// 军刀待机姿态：刀身近乎竖直（与水平面约 80°，只微微前倾），
// 这样握把顺着拳头的握持轴穿过掌心，不会斜插在手腕外侧；刀身绕自身轴微微向左倾。
const KNIFE_PITCH = THREE.MathUtils.degToRad(80);
const KNIFE_ROLL = 0.20;           // 约 11.5°，正角度 = 刀背上缘向人物左侧倾
// 挥砍时刀身放平、倾角收小；动作速率单独由 trigger 的 rate 控制
const KNIFE_SWING_PITCH = 0.12;
const KNIFE_SWING_ROLL = 0.08;
export const SLASH_RATE = 1.65;    // 裁后的 1.33s 挥刀剪辑 → 0.81s

// _poseWeapon / IK 用的临时对象（避免每帧分配）
const _vA = new THREE.Vector3(), _vB = new THREE.Vector3(), _vC = new THREE.Vector3(), _vD = new THREE.Vector3(),
  _vE = new THREE.Vector3(), _vF = new THREE.Vector3(), _vG = new THREE.Vector3(), _vH = new THREE.Vector3(),
  _vI = new THREE.Vector3(), _vJ = new THREE.Vector3(), _vK = new THREE.Vector3();
const _qA = new THREE.Quaternion(), _qB = new THREE.Quaternion(), _qC = new THREE.Quaternion(),
  _qD = new THREE.Quaternion(), _qE = new THREE.Quaternion(), _qF = new THREE.Quaternion();
const _mA = new THREE.Matrix4();
const _AXIS_Z = new THREE.Vector3(0, 0, 1), _AXIS_X = new THREE.Vector3(1, 0, 0);
// 在"已校正到 -Z 长轴"的父级系里绕 Z 翻 180°：只翻刀身横截面，不动刀尖方向
const _qFlipKnife = new THREE.Quaternion().setFromAxisAngle(_AXIS_Z, Math.PI);
// 两骨 IK 专用临时量
const _ikS = new THREE.Vector3(), _ikE = new THREE.Vector3(), _ikH = new THREE.Vector3(),
  _ikE2 = new THREE.Vector3(), _ikH2 = new THREE.Vector3(),
  _ik1 = new THREE.Vector3(), _ik2 = new THREE.Vector3(), _ik3 = new THREE.Vector3(),
  _ikA = new THREE.Vector3(),
  _ikWR = new THREE.Vector3(), _ikLW = new THREE.Vector3(),   // 左右手腕目标
  _ikHT = new THREE.Vector3(),                                // 肘部 hint
  _ikQW = new THREE.Quaternion(),                             // 枪朝向（世界）
  _ikQ1 = new THREE.Quaternion(), _ikQ2 = new THREE.Quaternion(), _ikQP = new THREE.Quaternion();

/**
 * 校正军刀资产的长轴。Blender 的 glTF 导出会额外做一次 Z-up→Y-up 转换，
 * 与 build_knife.py 里的 Rx(90°) 叠加后，实测导出的 knife.glb 长轴是 -Y（刀尖朝下），
 * 而整套武器摆放代码都按"刀尖 -Z"约定写。这里按包围盒自动纠正，
 * 以后若重新导出成 -Z 也不会被二次旋转。
 */
function orientKnifeAxis(obj) {
  const wrap = new THREE.Group();
  wrap.name = 'knifeAxisFix';
  wrap.add(obj);
  wrap.updateWorldMatrix(true, true);
  const bb = new THREE.Box3().setFromObject(obj);
  const size = bb.getSize(new THREE.Vector3());
  if (size.y > size.z * 1.5 && size.y > size.x * 1.5) {
    // -Y（刀尖）→ -Z：绕 X 轴 +90°；(x, y, z) → (x, -z, y)
    obj.rotation.x = Math.PI / 2;
    // 在"已校正过"的父级系里绕 Z 翻 180°：实测该资产收尖的开刃侧在局部 +Y，
    // 不翻会变成"刀刃朝天、刀背朝下"。必须用 premultiply（父级系），
    // 若用 rotateZ/后乘，会连刀尖 -Z 一起翻到 +Z，刀又斜插回手腕。
    obj.quaternion.premultiply(_qFlipKnife);
  } else if (size.z > size.y * 1.5 && Math.abs(bb.max.z) > Math.abs(bb.min.z) * 2) {
    // 长轴是 Z 但刀尖朝 +Z（反了）
    obj.rotation.y = Math.PI;
  }
  return wrap;
}

export class Character {
  constructor(scene) {
    this.root = new THREE.Group();      // 世界位置/朝向
    this.root.visible = false;
    scene.add(this.root);
    this.mode = 'none';                 // 'glb' | 'placeholder'
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.oneShot = null;
    this.oneShotT = 0;
    this.yawSmooth = 0;
    this.wep = 'rifle';
    this.aiming = false;
    this.crouch = false;
    this.rollT = 0;

    const inst = instance('player');
    if (inst) this._buildGLB(inst);
    else this._buildPlaceholder();
    this._buildWeapons();
    this.v3 = new THREE.Vector3();
  }

  // ---------------- 手持武器 ----------------
  // 武器挂在 root 下，每帧由代码控制位置（跟随手）与朝向（按状态摆正）：
  // 手骨局部系因骨架/绑定而异，任何"一次性标定值"换个动画姿态就会歪，
  // 所以朝向不读手骨旋转，而是直接反解：枪口(-Z 局部)→角色前方、枪顶(+Y)→世界上方。
  _buildWeapons() {
    this.weaponRoot = new THREE.Group();
    this.weaponRoot.name = 'weaponRoot';
    this.root.add(this.weaponRoot);

    const mk = (kind, obj, gripZ, gripLocal, foreLocal) => {
      const g = new THREE.Group();
      g.name = 'weapon:' + kind;
      obj.position.z = -gripZ;      // 把握把点挪到原点
      g.add(obj);
      // 枪口标记：命中判定/火光/曳光弹都从这里出发
      g.updateWorldMatrix(true, true);
      const bb = new THREE.Box3().setFromObject(obj);
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, (bb.min.y + bb.max.y) / 2 + (bb.max.y - bb.min.y) * 0.15, bb.min.z);
      g.add(muzzle);
      g.userData.muzzle = muzzle;
      // IK 握点：托底 z（枪托抵肩用）/ 握把点（右手）/ 护木点（左手），均为枪局部坐标
      g.userData.buttZ = bb.max.z;
      g.userData.grip = gripLocal || new THREE.Vector3(0, 0, 0);
      g.userData.fore = foreLocal || new THREE.Vector3(0, (bb.min.y + bb.max.y) / 2 - 0.04, bb.min.z * 0.45);
      this.weaponRoot.add(g);
      return g;
    };

    // 步枪（外部 GLB 优先）
    const ri = instance('rifle');
    const rifle = ri ? ri.wrap : buildRifle({ hands: false, scale: 0.62 });
    this.weapons = this.weapons || {};
    this.weapons.rifle = mk('rifle', rifle, ri ? 0 : 0.115 * 0.62,
      ri ? new THREE.Vector3(0, 0.05, 0.10)    // rifle.glb：握把中部（顶点扫描实测）
         : new THREE.Vector3(0, -0.095 * 0.62, 0),
      ri ? new THREE.Vector3(0, 0.11, -0.38)   // 护木下缘
         : new THREE.Vector3(0, -0.03, -0.20));

    // 军刀：外部 GLB 的刀尖实测朝 -Y，先自动纠正到 -Z 约定再挂到武器根节点
    const ki = instance('knife');
    const knife = orientKnifeAxis(ki ? ki.wrap : buildKnife({ hands: false, scale: 0.95 }));
    this.weapons.knife = mk('knife', knife, 0,
      ki ? null : new THREE.Vector3(0, 0, 0.05));

    this.weaponRoot.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    this.setWeapon(this.wep);
  }

  /** 当前手上武器的枪口世界坐标 */
  muzzleWorld() {
    const g = this.weapons && this.weapons[this.wep];
    if (!g || !g.visible) return null;
    return g.userData.muzzle.getWorldPosition(new THREE.Vector3());
  }
  /** 握把/手部世界坐标（枪灯定位用） */
  weaponWorld() {
    const g = this.weapons && this.weapons[this.wep];
    if (!g) return null;
    if (g.userData.grip) return g.localToWorld(g.userData.grip.clone());
    return g.getWorldPosition(new THREE.Vector3());
  }

  // ---------------- GLB 人物 ----------------
  _buildGLB(inst) {
    this.mode = 'glb';
    this.model = new THREE.Group();
    this.model.add(inst.wrap);
    this.root.add(this.model);

    // Stop Walking.fbx 后半段是长时间站定，只取收脚那一秒，
    // 否则停步后会卡在最后一帧很久才回到站立待机。只处理这个空手 clip。
    let clips = inst.animations;
    const swIdx = clips.findIndex(c => c.name.toLowerCase() === 'stop_walk');
    if (swIdx >= 0 && clips[swIdx].duration > 1.6) {
      clips = clips.slice();
      clips[swIdx] = THREE.AnimationUtils.subclip(clips[swIdx], 'stop_walk', 0, 30, 30);
    }
    // Slash.fbx 是 2.07s 的完整起手→出刀→收势：实测 0~0.5s 几乎不动、
    // 1.6s 之后只是缓慢归位，原速播就像慢动作。裁到 0.30~1.63s 再轻加速，
    // 出刀段仍有 0.33s 的可见行程，不会变成一两帧的糊影。
    const slIdx = clips.findIndex(c => c.name.toLowerCase() === 'slash');
    if (slIdx >= 0 && clips[slIdx].duration > 1.8) {
      clips = clips.slice();
      clips[slIdx] = THREE.AnimationUtils.subclip(clips[slIdx], 'slash', 9, 49, 30);
    }
    // 素材包没有 fall / land：原来整个腾空阶段都定格在 jump 末帧，落地瞬间硬切回走。
    // 从 jump 自身派生两段：
    //   jump  → 0~0.32s 蹬地起跳（保留原 clip 名前 10 帧，播完即止）
    //   fall  → 0.30~0.60s「收腿准备落地」循环，接在起跳后面
    // 再加程序化的落地屈膝缓冲（_poseAirLand），整体就是起跳→空中收腿→落地回弹。
    const jpIdx = clips.findIndex(c => c.name.toLowerCase() === 'jump');
    if (jpIdx >= 0) {
      const jc = clips[jpIdx];
      clips = clips.slice();
      clips[jpIdx] = THREE.AnimationUtils.subclip(jc, 'jump', 0, 11, 30);      // ~0.37s 起跳
      const fall = THREE.AnimationUtils.subclip(jc, 'fall', 10, jc.duration * 30 - 1, 30);
      if (fall.duration > 0.12) clips.push(fall);
    }
    // turn_left/right 原片 1.1~1.2s 是「转过去→站定」的完整过程；root 朝向同时由
    // 代码以 dt*14 快速跟随，两套旋转叠加就成了「先甩一下再补转」。只取起步迈步的
    // 前半段，让动画做「迈一步」的细节，整段转向交给 root，自然且不滑步。
    clips = clips.slice();
    for (let i = 0; i < clips.length; i++) {
      const n = clips[i].name.toLowerCase();
      if (n === 'turn_left' || n === 'turn_right') {
        clips[i] = THREE.AnimationUtils.subclip(clips[i], n, 0, Math.round(clips[i].duration * 30 * 0.55), 30);
      }
    }

    this.mixer = new THREE.AnimationMixer(this.model);
    // 先按关键帧名精确对齐（run_back 不会被误当成 run），再走关键字兜底
    const take = (clip, key) => {
      const a = this.mixer.clipAction(clip);
      a.setEffectiveWeight(0);
      a.__name = key;
      a.__loco = LOCO.has(key);
      this.actions[key] = a;
    };
    for (const clip of clips) {
      const n = clip.name.toLowerCase();
      const exact = ALIAS.find(([key]) => key.toLowerCase() === n);
      if (exact && !this.actions[exact[0]]) take(clip, exact[0]);
    }
    for (const clip of clips) {
      for (const [key, re] of ALIAS) {
        if (this.actions[key] || !re.test(clip.name)) continue;
        take(clip, key);
        break;
      }
    }
    this.clipNames = clips.map(c => c.name);
    // 手部插槽：优先右手，其次左手（不同软件命名差异都覆盖）
    this.hand = findBone(this.model, /(mixamorig)?(right|r)[_ ]?hand|hand[_ ]?r\b|wrist[_ ]?r/i)
      || findBone(this.model, /hand/i);
    this.handName = this.hand ? this.hand.name : '(未找到手骨)';
    // 持刀握拳：Mixamo 手指骨都沿局部 +Y 生长、绕局部 +X 弯曲（朝掌心）。
    // knife_idle 素材本身是半张开的手，需要额外包握量才能把刀柄攥住。
    this.fingersR = [];
    this.knucklesR = [];
    const FINGER_CURL = [0, 0.24, 0.38, 0.30];  // 第 1/2/3 节各自的额外弯曲（弧度）
    this.model.traverse((o) => {
      if (!o.isBone) return;
      const m = /RightHand(Index|Middle|Ring|Pinky|Thumb)([1-3])$/i.exec(o.name);
      if (!m) return;
      const seg = +m[2];
      const curl = /Thumb/i.test(m[1]) ? [0, 0.10, 0.16, 0.12][seg] : FINGER_CURL[seg];
      if (curl > 0) this.fingersR.push({ bone: o, curl });
      if (seg === 1 && !/Thumb/i.test(m[1])) this.knucklesR.push(o);
    });
    // 双臂 IK 链（肩 UpperArm → 前臂 ForeArm → 手 Hand）：持枪时手直接解算到枪上
    this.armsIK = [];
    for (const side of ['Right', 'Left']) {
      const arm = findBone(this.model, new RegExp('(mixamorig:?)?' + side + '_?Arm$', 'i'));
      const fore = findBone(this.model, new RegExp('(mixamorig:?)?' + side + '_?ForeArm$', 'i'));
      const handB = findBone(this.model, new RegExp('(mixamorig:?)?' + side + '_?Hand$', 'i'));
      if (arm && fore && handB) this.armsIK.push({ side, arm, fore, hand: handB });
    }
    // 右肩骨（枪托抵肩锚点用）
    const rChain = this.armsIK.find(c => c.side === 'Right');
    this.shoulderR = rChain ? rChain.arm : null;
    // 落地缓冲用的骨骼（懒解析一次）；mixer 每帧会重写这些骨，程序化修正必须放在 mixer.update 之后
    this.landBones = {
      hips: findBone(this.model, /mixamorig:?hips$/i),
      upL: findBone(this.model, /leftupleg/i), upR: findBone(this.model, /rightupleg/i),
      loL: findBone(this.model, /^mixamorig:leftleg$/i), loR: findBone(this.model, /^mixamorig:rightleg$/i),
    };
    if (this.landBones.hips) this.hipsY0 = this.landBones.hips.position.y;
    this.play('idle', 0);
  }

  // ---------------- 内置假人 ----------------
  _buildPlaceholder() {
    this.mode = 'placeholder';
    const g = new THREE.Group();
    this.model = g;
    this.root.add(g);

    const cap = (r, len, m) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), m);
    const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

    // 髋（整个上半身挂在这上面，方便蹲下时整体下沉）
    this.hips = new THREE.Group();
    this.hips.position.y = 0.92;
    g.add(this.hips);

    const torso = cap(0.19, 0.34, MATERIALS.cloth);
    torso.position.y = 0.24; this.hips.add(torso);
    const chest = box(0.40, 0.30, 0.24, MATERIALS.cloth);
    chest.position.y = 0.34; this.hips.add(chest);
    this.neck = new THREE.Group();
    this.neck.position.y = 0.52; this.hips.add(this.neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), MATERIALS.skin);
    head.scale.set(0.92, 1.06, 0.95); head.position.y = 0.10; this.neck.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.118, 16, 12, 0, 6.28, 0, 1.5), MATERIALS.dark);
    hair.position.y = 0.115; hair.scale.set(0.95, 1.0, 0.98); this.neck.add(hair);

    const limb = (m, r0, len) => {
      const grp = new THREE.Group();
      const seg = cap(r0, len, m);
      seg.position.y = -len / 2 - r0 * 0.4;
      grp.add(seg);
      return grp;
    };
    this.arms = []; this.legs = [];
    for (const s of [-1, 1]) {
      // 肩 → 上臂 → 肘 → 前臂 → 手
      const sh = new THREE.Group();
      sh.position.set(s * 0.235, 0.42, 0);
      this.hips.add(sh);
      const upper = limb(MATERIALS.cloth, 0.062, 0.26); sh.add(upper);
      const elbow = new THREE.Group(); elbow.position.y = -0.30; upper.add(elbow);
      const fore = limb(MATERIALS.skin, 0.05, 0.24); elbow.add(fore);
      const hand = new THREE.Group(); hand.position.y = -0.27; fore.add(hand);
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.10, 0.045), MATERIALS.skin);
      hand.add(palm);
      this.arms.push({ side: s, sh, elbow, hand });
      // 髋 → 大腿 → 膝 → 小腿 → 脚
      const hip = new THREE.Group();
      hip.position.set(s * 0.105, -0.02, 0);
      this.hips.add(hip);
      const thigh = limb(MATERIALS.cloth, 0.075, 0.36); hip.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -0.41; thigh.add(knee);
      const shin = limb(MATERIALS.cloth, 0.058, 0.36); knee.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.26), MATERIALS.boot);
      foot.position.set(0, -0.40, -0.05); knee.add(foot);
      this.legs.push({ side: s, hip, knee });
    }
    // 右手当武器插槽
    this.hand = this.arms.find(a => a.side === 1).hand;
    this.handName = 'placeholder:hand.R';
    this.t = 0;
  }

  // ---------------- 武器 ----------------
  attachWeapon(kind, obj) {
    if (!this.hand || !obj) return null;
    const holder = new THREE.Group();
    holder.name = 'weapon:' + kind;
    this.hand.add(holder);
    holder.add(obj);
    this.weapons = this.weapons || {};
    if (this.weapons[kind]) this.hand.remove(this.weapons[kind]);
    this.weapons[kind] = holder;
    this.setWeaponVisible(kind, this.wep === kind);
    return holder;
  }
  setWeaponVisible(kind, on) {
    if (!this.weapons || !this.weapons[kind]) return;
    this.weapons[kind].visible = on;
  }
  setWeapon(kind) {
    this.wep = kind;
    if (this.weapons) for (const k of Object.keys(this.weapons)) this.weapons[k].visible = (k === kind);
    // 换到军刀时重新标定"手骨静止姿态"，避免沿用上一次拔刀/跑动时的手腕角度
    if (kind === 'knife') this._knifeQ0 = null;
    // 6 个空手动画的 Hips 根位移已在资产层统一到持械 idle 的基准
    // （tools/freeze_unarmed_roots.js），切武器时不需要任何运行时位置补偿。
  }

  // ---------------- 动画 ----------------
  /** 记下当前位移循环的相位（0~1），用于下一个位移剪辑无缝接上 */
  _savePhase() {
    const a = this.current;
    if (!a || !a.__loco) return;
    const d = a.getClip().duration || 1;
    this._phase = ((a.time % d) / d + 1) % 1;
  }

  play(key, fade = 0.18, once = false, sync = false) {
    const a = this.actions[key];
    if (!a || a === this.current) return false;
    const prev = this.current;
    this._savePhase();
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    a.clampWhenFinished = once;
    // 相位继承：walk→run / walk→walk_back 直接从同一落脚点接上，不会"啪"一下错脚
    if (sync && a.__loco && this._phase !== undefined) {
      a.time = this._phase * (a.getClip().duration || 1);
    }
    if (!a.__loco) a.timeScale = 1;     // 一次性动作固定原速
    a.setEffectiveWeight(1).fadeIn(fade).play();
    if (prev) prev.fadeOut(fade);
    this.current = a;
    if (once) {
      this.oneShot = a;
      this.oneShotT = a.getClip().duration;
    }
    return true;
  }

  /** 触发一次性动作（开火 / 挥刀 / 翻滚）；rate>1 可加快动作而不改帧数 */
  trigger(key, fade = 0.08, rate = 1) {
    if (this.mode !== 'glb') return false;
    if (!this.actions[key]) return false;
    const a = this.actions[key];
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    this._savePhase();               // 开枪/挥刀结束后回走路，相位能接上
    a.timeScale = rate;
    a.setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current && this.current !== a) this.current.fadeOut(fade);
    this.current = a;
    this.oneShot = a;
    this.oneShotT = a.getClip().duration * 0.9 / rate;
    return true;
  }

  update(dt, st) {
    this.root.visible = st.visible !== false;
    if (!this.root.visible) return;

    this.root.position.copy(st.pos);
    // 落地检测：由"腾空→接地"触发一段屈膝缓冲（素材包没有 land 动画）
    if (st.onGround && this._wasOnGround === false && !st.dead && !st.driving) {
      this._landT = 0.34;
      this._landImpact = Math.min(1, Math.abs(this._lastVy || 0) / 9);
    }
    this._wasOnGround = st.onGround;
    this._lastVy = st.vy || 0;
    if (this._landT > 0) this._landT = Math.max(0, this._landT - dt);
    // 实际移动速度（水平面），用于步频自适应，防止脚底打滑
    if (this._lastPos && dt > 0.001) {
      const dx = st.pos.x - this._lastPos.x, dz = st.pos.z - this._lastPos.z;
      const v = Math.min(Math.hypot(dx, dz) / dt, 12);
      this.speed = this.speed === undefined ? v : this.speed + (v - this.speed) * Math.min(1, dt * 8);
    }
    this._lastPos = st.pos.clone();
    // 朝向平滑（避免 180° 跳变时像转了半圈）
    // 相机跟的是 player.yaw（立即响应），人物朝向必须保持原来的 dt*14。
    // 给空手放慢会让人物比镜头慢半拍，第三人称画面里就会"晃一下 / 像硬切"。
    const unarmed = !this.wep || this.wep === 'none';
    // 持械期间把空手状态机的转向基准同步到当前镜头，切回空手时不会误判成一次大转身
    if (!unarmed) { this._lastYaw = st.yaw; this._wasMoving = false; }
    let dy = st.yaw - this.yawSmooth;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yawSmooth += dy * Math.min(1, dt * 14);
    this.root.rotation.y = this.yawSmooth;

    if (this.oneShotT > 0) {
      this.oneShotT -= dt;
      if (this.oneShotT <= 0) {
        this.oneShot = null; this._unShot = null;
        this._lastYaw = st.yaw;   // 动作期间不累计转向，避免结束后误判成一次大转身
      }
    }
    // 空手的一次性动作（转身/收脚）：切回持械、或重新迈步时立刻结束，交回原状态机。
    // 持械时 _unShot 永远是 null，这里不会有任何影响。
    if (this._unShot && (!unarmed || st.moving)) {
      this.oneShot = null; this.oneShotT = 0; this._unShot = null;
      this._wasMoving = false;
      this._lastYaw = st.yaw;
    }
    if (!this.oneShot) {
      this._pickState(st, dt);
    }
    if (this.mixer) {
      // 步频自适应：位移类动画按"实际移速 / 动画原生步速"缩放，脚底既不打滑也不碎步。
      // 平滑过渡，避免撞墙瞬时降速导致动作抽搐。
      if (this.current && this.current.__loco) {
        const n = NATIVE_SPEED[this.current.__name];
        if (n) {
          const want = THREE.MathUtils.clamp((this.speed || 0) / n, 0.45, 1.7);
          const k = Math.min(1, dt * 10);
          this.current.timeScale += (want - this.current.timeScale) * k;
        }
      }
      this.mixer.update(dt);
      // 持刀时把四指/拇指再往里扣一扣，让刀柄真正被攥在掌心里。
      // 必须放在 mixer.update 之后：动画每帧会重写骨骼，提前改会被覆盖。
      this._gripFingers();
      // 落地屈膝缓冲：素材没有 land 动画，用一段 0.3s 的程序化下蹲吸收冲击
      this._poseLanding(dt, st);
      // 有 drive 动画就交给动画，没有才用程序化坐姿兜底
      if (st.driving && !this.actions.drive) this._sitPose();
    } else this._posePlaceholder(dt, st);

    this.root.updateMatrixWorld(true);
    this._poseWeapon(dt, st);   // 先放枪：枪托抵肩窝，位置由肩骨驱动
    this._poseArmsIK(dt, st);   // 再解双臂 IK：手精确握到握把/护木上
  }

  // 世界空间旋转 → 骨骼局部（premultiply 共轭），与动画兼容
  _applyWorldQuat(bone, q) {
    bone.parent.getWorldQuaternion(_ikQP);
    _ikQ2.copy(_ikQP).invert().multiply(q).multiply(_ikQP);
    bone.quaternion.premultiply(_ikQ2);
  }

  // 两骨 IK：把 hand 解算到 target（世界坐标）；hint 决定肘部朝哪边弯
  _ik2(chain, target, hint) {
    const { arm, fore, hand, side } = chain;
    // 骨长（世界单位，缓存）：骨骼局部 position 长度 × 累积缩放
    if (!chain._l1) {
      arm.getWorldScale(_ikA);
      const s = _ikA.x;
      chain._l1 = fore.position.length() * s;
      chain._l2 = hand.position.length() * s;
    }
    const l1 = chain._l1, l2 = chain._l2;
    arm.getWorldPosition(_ikS);
    fore.getWorldPosition(_ikE);
    hand.getWorldPosition(_ikH);
    _ik1.subVectors(target, _ikS);
    let d = _ik1.length();
    if (d < 1e-4) return;
    _ik1.divideScalar(d);                        // dirSW：肩→腕方向
    d = Math.min(Math.max(d, Math.abs(l1 - l2) + 0.02), l1 + l2 - 0.02);
    // 肘部新位置：S→W 连线上距肩 a 处，向 hint 方向偏 h（余弦定理）
    const a = (l1 * l1 + d * d - l2 * l2) / (2 * d);
    const h = Math.sqrt(Math.max(l1 * l1 - a * a, 1e-6));
    _ik2.copy(_ikS).addScaledVector(_ik1, a);    // base
    _ik3.subVectors(hint, _ik2);
    _ik3.addScaledVector(_ik1, -_ik3.dot(_ik1)); // hint 投影到与肩腕轴垂直的平面
    if (_ik3.lengthSq() < 1e-6) {
      _ik3.set(side === 'Right' ? 1 : -1, -0.4, 0.1);
      _ik3.addScaledVector(_ik1, -_ik3.dot(_ik1));
    }
    _ik3.normalize();
    _ikE2.copy(_ik2).addScaledVector(_ik3, h);   // 新肘位置
    // 旋转1：上臂把肘带到 E2（整条链跟随）
    _ikA.subVectors(_ikE, _ikS).normalize();
    _ikH2.subVectors(_ikE2, _ikS).normalize();
    _ikQ1.setFromUnitVectors(_ikA, _ikH2);
    this._applyWorldQuat(arm, _ikQ1);
    // 修正后腕位置 = E2 + R1·(H-E)
    _ikH2.subVectors(_ikH, _ikE).applyQuaternion(_ikQ1).add(_ikE2);
    // 旋转2：前臂把腕带到目标
    _ikA.subVectors(_ikH2, _ikE2).normalize();
    _ik3.subVectors(target, _ikE2).normalize();
    _ikQ1.setFromUnitVectors(_ikA, _ik3);
    this._applyWorldQuat(fore, _ikQ1);
  }

  // 持枪双臂 IK：右手扣握把、左手托护木；军刀不启用（刀只有一个握点）
  _poseArmsIK(dt, st) {
    if (this.mode !== 'glb' || !this.armsIK || !this.armsIK.length) return;
    const g = this.weapons && this.weapons[this.wep];
    if (!g || !g.visible || !g.userData.grip || this.wep !== 'rifle') return;
    g.updateWorldMatrix(true, false);
    const qw = g.getWorldQuaternion(_ikQW);   // 枪朝向（世界）

    // 右腕目标：握把点略后上（四指向前包握）
    const gripW = g.localToWorld(_ikA.copy(g.userData.grip));
    _ik1.set(0, 0, 1).applyQuaternion(qw);    // 枪托方向（后）
    _ik2.set(0, 1, 0).applyQuaternion(qw);    // 枪上方向
    _ikWR.copy(gripW).addScaledVector(_ik1, 0.045).addScaledVector(_ik2, 0.02);
    // 左腕目标：护木点正下（手掌托底）
    _ikLW.copy(g.userData.fore).add(_ik2.set(0, -0.02, 0));
    g.localToWorld(_ikLW);

    // 肘部 hint：root 局部外侧偏下 → 世界
    const rootQ = this.root.getWorldQuaternion(_ikQP);
    for (const chain of this.armsIK) {
      _ikHT.set(chain.side === 'Right' ? 0.85 : -0.85, -0.45, 0.05).applyQuaternion(rootQ)
        .add(chain.arm.getWorldPosition(_ikA));
      this._ik2(chain, chain.side === 'Right' ? _ikWR : _ikLW, _ikHT);
    }
    // 手掌对齐：把"手腕→指根"方向转向枪口方向（手指沿枪横向后包握）
    for (const chain of this.armsIK) {
      const knuckle = chain.hand.children[0];
      if (!knuckle || !knuckle.isBone) continue;
      chain.hand.updateWorldMatrix(true, false);
      knuckle.updateWorldMatrix(false, false);
      _ik1.subVectors(knuckle.getWorldPosition(_ik2), chain.hand.getWorldPosition(_ik3));
      if (_ik1.lengthSq() < 1e-8) continue;
      _ik1.normalize();
      _ik2.set(0, 0, 1).applyQuaternion(qw).negate();  // 期望：手指指向枪口
      _ikQ1.setFromUnitVectors(_ik1, _ik2);
      this._applyWorldQuat(chain.hand, _ikQ1);
    }
  }

  // 武器每帧：枪托抵肩窝（肩骨驱动，蹲/跑自动跟随）+ 朝向按状态摆正（腰射低姿 / 抵肩瞄准 / 挥刀）
  _poseWeapon(dt, st) {
    const w = this.weaponRoot;
    if (!w) return;
    const driving = !!st.driving;
    w.visible = !driving && !st.dead;
    if (!w.visible) return;
    const g = this.weapons && this.weapons[this.wep];
    if (!g) return;

    const isKnife = this.wep === 'knife' && !!this.hand;
    const swinging = st.slashT > 0 || (this.current && this.current.__name === 'slash');

    // —— 位置锚 ——
    //    刀 = 掌心里（腕骨→指根 55%，再往掌面偏一点）；
    //    枪 = 右肩骨 + 固定偏移 = 肩窝点（枪托落点）；无骨骼退化用默认值
    if (isKnife) {
      // 以前直接用腕骨当握点，刀等于斜插在手腕上，看上去就是硬"贴"在手上
      this._knifeGripPoint(this.v3);
      this.root.worldToLocal(this.v3);
    } else {
      const anchorBone = this.shoulderR || this.hand;
      if (anchorBone) anchorBone.getWorldPosition(this.v3);
      else this.v3.set(0.18, 1.30, 0.02);
      this.root.worldToLocal(this.v3);
      this.v3.x -= 0.03;   // 内收
      this.v3.y -= 0.07;   // 肩窝在肩关节下
      this.v3.z -= 0.10;   // 略靠前
      // 上仰瞄准时托底沿肩窝向后下滑，枪身贴脸颊外侧而不是横穿头部
      const sp = Math.max(0, Math.sin((st.pitch || 0) * 0.5));
      this.v3.y -= sp * 0.20;
      this.v3.z += sp * 0.05;
      this.v3.x += sp * 0.05;
    }

    // —— 朝向：期望的"刀尖/枪口方向"（root 局部：-Z 前，pitch 控制俯仰）——
    const t = performance.now() / 1000;
    const sway = Math.sin(t * (st.sprint ? 9 : 5)) * (st.moving ? 0.05 : 0.015);
    let pitch;
    if (isKnife) {
      pitch = swinging ? KNIFE_SWING_PITCH : KNIFE_PITCH;   // 待机近乎竖直，挥砍时放平
    } else {
      // 枪：瞄准时跟随镜头俯仰（视觉减半，避免大仰角时机匣横穿头部；
      // 弹道不受影响——曳光弹始终从枪口连向准星），腰射时枪口下压 ~24°（低姿持枪）
      pitch = (st.aiming ? (st.pitch || 0) * 0.5 : -0.42) + sway * 0.4;
    }

    if (isKnife) {
      // 在 root 局部系里构造姿态：刀尖 = (0, sin p, -cos p)，刀背绕自身轴微微左倾
      const fwd = _vA.set(0, Math.sin(pitch), -Math.cos(pitch));
      const zAxis = _vB.copy(fwd).negate();
      const yAxis = _vC.set(0, 1, 0).addScaledVector(zAxis, -zAxis.y).normalize();
      const xAxis = _vD.crossVectors(yAxis, zAxis);
      _mA.makeBasis(xAxis, yAxis, zAxis);
      _qB.setFromRotationMatrix(_mA);
      _qB.multiply(_qC.setFromAxisAngle(_AXIS_Z, swinging ? KNIFE_SWING_ROLL : KNIFE_ROLL));

      // 待机：刀稳稳握在手里，就是 80° 近乎竖直 + 微左倾（不跟着手腕的呼吸摆动乱晃）。
      // 挥砍：取"手骨相对 root 的旋转增量"叠加到持刀姿态，整条手臂的摆动直接传给刀，
      //       否则刀会像一块铁板钉在角色身上。起手瞬间重新标定基准，避免姿态跳变。
      this.root.getWorldQuaternion(_qA);
      this.hand.getWorldQuaternion(_qD);
      _qF.copy(_qA).invert();
      _qD.premultiply(_qF);                 // 去掉 root 自身 yaw，只留手臂动画
      if (!this._knifeQ0) this._knifeQ0 = _qD.clone();
      if (swinging) {
        if (!this._knifeSwinging) this._knifeQ0.copy(_qD);
        _qE.copy(this._knifeQ0).invert();
        _qF.copy(_qD).multiply(_qE);        // 手臂摆动增量
        _qE.copy(_qF).multiply(_qB);        // root 局部目标姿态
      } else {
        this._knifeQ0.slerp(_qD, Math.min(1, dt * 6));
        _qE.copy(_qB);
      }
      this._knifeSwinging = swinging;
      w.quaternion.slerp(_qE, Math.min(1, dt * (swinging ? 35 : 10)));
      // 握点必须逐帧精确跟手：挥刀时手速很快，lerp 会甩出十几厘米的滞后，
      // 看起来就像刀从手里滑出去。手骨本身已经是平滑的动画，无需再插值。
      w.position.copy(this.v3);
      return;
    }

    // —— 枪（原逻辑保持不变）：目标世界朝向 → root 局部四元数 ——
    const rootQ = this.root.getWorldQuaternion(_qA);
    const fwd = _vA.set(0, Math.sin(pitch), -Math.cos(pitch)).applyQuaternion(_qA).normalize();
    const zAxis = _vB.copy(fwd).negate();
    const yAxis = _vC.set(0, 1, 0).addScaledVector(zAxis, -zAxis.y).normalize();
    const xAxis = _vD.crossVectors(yAxis, zAxis);
    _mA.makeBasis(xAxis, yAxis, zAxis);
    _qB.setFromRotationMatrix(_mA);
    _qA.invert().multiply(_qB);              // rootQ⁻¹ × 目标世界朝向 = root 局部朝向
    w.quaternion.slerp(_qA, Math.min(1, dt * 14));

    // 枪托底落肩窝：枪原点 = 肩窝 + 枪口方向 × 托底距离（沿枪轴向后退到肩）
    const buttZ = g.userData.buttZ || 0.42;
    const fwdNow = _vA.set(0, 0, -1).applyQuaternion(w.quaternion);
    const target = _vB.copy(this.v3).addScaledVector(fwdNow, buttZ);
    w.position.lerp(target, Math.min(1, dt * 20));
  }

  /**
   * 掌心握点（世界坐标）。刀身竖直后，刀轴必须真的穿过拳头被四指包住的空腔，
   * 否则握把会贴在虎口外侧、看起来像"粘"在手上。
   * 用四指指根 / 指尖实测校准：原 55% 位置比拳心偏手腕侧约 2.7cm、掌宽偏 8mm。
   */
  _knifeGripPoint(out) {
    const hand = this.hand;
    if (!hand) return out.set(0.18, 1.25, -0.1).applyMatrix4(this.root.matrixWorld);
    const wrist = hand.getWorldPosition(_vE);
    if (!this.knucklesR || this.knucklesR.length < 2) return out.copy(wrist);
    const knuckle = _vF.set(0, 0, 0);
    for (const b of this.knucklesR) knuckle.add(b.getWorldPosition(_vH));
    knuckle.divideScalar(this.knucklesR.length);
    // 食指根 - 小指根 = 掌宽方向；与"腕→指根"叉乘得到掌面法向
    const span = _vG.subVectors(this.knucklesR[0].getWorldPosition(_vH),
      this.knucklesR[this.knucklesR.length - 1].getWorldPosition(_vI)).normalize();
    const fingerDir = _vJ.subVectors(knuckle, wrist).normalize();
    const normal = _vK.crossVectors(span, fingerDir).normalize();
    out.copy(wrist).lerp(knuckle, 0.78)          // 往指尖侧移 2.7cm，刀轴落在拳心
      .addScaledVector(span, -0.008)             // 掌宽方向再对齐 8mm
      .addScaledVector(normal, 0.010);           // 略微贴向掌面内侧
    out.y += 0.012;                             // 护手贴住虎口、刀尾只露一小截
    return out;
  }

  /** 持刀时把手指再往掌心扣一些（mixer.update 之后调用，否则会被动画覆盖） */
  _gripFingers() {
    if (this.wep !== 'knife' || !this.fingersR || !this.fingersR.length) return;
    for (const f of this.fingersR) f.bone.rotateX(f.curl);
  }

  _pickState(st, dt) {
    this.aiming = st.aiming;
    this.crouch = st.crouch;
    this.rollT = st.rollT;
    if (st.dead) {
      if (!this.play('die', 0.25, true) && this.mode === 'placeholder') return;
      if (this.actions.die) return;
      // 没有死亡动画时程序化倒地，避免站着不动
      this.fallT = Math.min(1, (this.fallT || 0) + dt * 1.6);
      this.root.rotation.x = -this.fallT * Math.PI * 0.46;
      return;
    }
    if (st.driving) return this.play('drive', 0.2) || this.play('idle', 0.2);
    if (st.rollT > 0 && this.trigger('roll', 0.1)) return;

    if (!st.onGround) {
      // 上升段播起跳；下落段播 fall（从 jump 后段派生）。
      // 注意：play() 在目标已是 current 时返回 false，这里不能用返回值判断"是否已在播"，
      // 否则下落中每帧都会 fallback 去 play('jump') 把 fall 打断。直接按 key 判断。
      if (st.vy > 0.5) {
        this.play('jump', 0.08, true);
      } else if (this.actions.fall) {
        this.play('fall', 0.14);
      } else {
        this.play('jump', 0.12, true);   // 没有 fall 的老素材：保持起跳姿
      }
      return;
    }

    // 局部移动方向（相对镜头）：f=前/后分量，r=右/左分量，已归一化
    const f = st.loco ? st.loco.f : 1;
    const r = st.loco ? st.loco.r : 0;
    const has = (k) => !!this.actions[k];

    if (st.crouch) {
      if (st.moving) {
        // 没有蹲伏剪辑时退化成行走（至少腿在动，不再"站着滑行"）
        this.play(has('crouchWalk') ? 'crouchWalk' : (has('walk') ? 'walk' : 'idle'), 0.16, false, true);
      } else {
        this.play(has('crouchIdle') ? 'crouchIdle' : 'idle', 0.18);
      }
      return;
    }

    // —— 空手专属：站立待机 / 停止走动 / 原地左转 / 原地右转 ——
    // 只有 wep==='none' 才会进这里；持枪、持刀继续走下面的原有状态机，一行不变。
    if (!this.wep || this.wep === 'none') {
      this._pickUnarmed(st, dt);
      return;
    }

    // —— 瞄准/射击：身体锁镜头朝向，位移必须靠侧移/后退剪辑，否则就是横着滑 ——
    if (st.aiming && !st.moving) {
      if (this.play('aim', 0.14)) return;
      this.play('idle', 0.18);
      return;
    }
    if (st.aiming) {
      let k;
      if (Math.abs(f) >= Math.abs(r)) k = f >= 0 ? 'aimWalk' : 'walk_back';
      else k = r >= 0 ? 'strafe_r' : 'strafe_l';
      // 前进优先用慢战术步行（aimWalk），没有再退回普通 walk
      this.play(has(k) ? k : 'walk', 0.14, false, true);
      return;
    }

    if (st.moving) {
      // 持刀移动用专属挪步（Walking (3).fbx），W 前进 / S 后退共用这一个循环；
      // 冲刺仍走原来的 run，避免腿部节奏对不上。只影响 wep==='knife'，
      // 持枪/空手的移动分支完全不变。
      if (this.wep === 'knife' && !st.sprint && has('knifeWalk')) {
        this.play('knifeWalk', 0.16, false, true);
        return;
      }
      // 空手（wep='none'）：换 Standard Walk / Running 的放松步态；
      // 拿着武器时仍用持械走跑，避免枪在手里却像散步一样甩臂
      const un = !this.wep || this.wep === 'none';
      const runK = un && has('run_unarmed') ? 'run_unarmed' : 'run';
      const walkK = un && has('walk_unarmed') ? 'walk_unarmed' : 'walk';
      const k = st.sprint && has(runK) ? runK : (has(walkK) ? walkK : runK);
      this.play(k, 0.14, false, true);
      return;
    }
    // 持刀待机：有 knifeIdle 用格斗持械姿，否则退回普通 idle
    this.play(this.wep === 'knife' && has('knifeIdle') ? 'knifeIdle' : 'idle', 0.22);
  }

  /**
   * 空手（wep==='none'）专用：站立待机 / 停止走动 / 原地左转 / 原地右转。
   * 持枪、持刀不会调用本方法，_pickState 里原有的持械分支保持原样。
   */
  _pickUnarmed(st, dt) {
    const has = (k) => !!this.actions[k];
    this._turnCd = Math.max(0, (this._turnCd || 0) - dt);
    // 本帧镜头转过的角度。yaw 增大 = 人物向左转（yaw=0 朝 -Z，fwdX=-sin(yaw)）。
    // 动作播放期间不调用本方法，结束时 update() 会把 _lastYaw 对齐到当前 yaw，
    // 所以不会把整段转身角度一次性当成"新转身"重复触发。
    let dy = st.yaw - (this._lastYaw === undefined ? st.yaw : this._lastYaw);
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this._lastYaw = st.yaw;

    // 1) 迈步：沿用原来的空手走/跑（相位继承），不做任何持械动作
    if (st.moving) {
      // 移动时角色朝向由 TPS 按移动向量给出，转向应由根节点的平滑朝向完成。
      // 不把镜头的小幅变化记成待播放的原地转身，避免移动结束后又补播一次转身。
      this._lastYaw = st.yaw;
      this._turnCd = 0;
      const runK = has('run_unarmed') ? 'run_unarmed' : 'run';
      const walkK = has('walk_unarmed') ? 'walk_unarmed' : 'walk';
      this.play(st.sprint && has(runK) ? runK : (has(walkK) ? walkK : runK), 0.14, false, true);
      this._wasMoving = true;
      return;
    }

    // 2) 刚停下：不播收脚动作，直接淡入待机站姿
    if (this._wasMoving) {
      this._wasMoving = false;
    }

    // 3) 原地转身：只有明显的转头/转身才播迈步动作（原阈值 0.012 rad≈0.7° 太低，
    //    鼠标微小抖动就触发，站着不动时不停播转身，非常不自然）。提到 ~4.6°，
    //    并拉长冷却，让细碎的视角微调直接由 root 平滑跟随吸收。
    if (this._turnCd <= 0 && Math.abs(dy) > 0.08) {
      const key = dy > 0 ? 'turn_left' : 'turn_right';
      if (has(key) && this.play(key, 0.16, true)) {
        this._unShot = key;
        this._turnCd = 0.55;
        // 提前开始淡回待机，别让动作停在末帧再"啪"地切回站姿
        this.oneShotT = this.actions[key].getClip().duration * 0.72;
        return;
      }
    }

    // 4) 站着不动：空手放松站姿，长一点的交叉淡化（持械的 idle / knifeIdle 不受影响）
    this.play(has('idle_unarmed') ? 'idle_unarmed' : 'idle', 0.26);
  }

  /**
   * 程序化落地缓冲：素材无 land 动画，接地后 0.34s 内髋部下沉→回弹、膝盖弯曲。
   * 放在 mixer.update 之后执行，动画每帧重写骨骼也盖不掉这段修正。
   */
  _poseLanding(dt, st) {
    if (!this._landT || !this.landBones || !this.landBones.hips || st.dead || st.driving) return;
    const b = this.landBones;
    // 相位 0→1：下沉到最低点(0.35)再弹回。sin 曲线天然首尾为 0，不会突跳
    const u = 1 - this._landT / 0.34;
    const squash = Math.sin(Math.PI * u) * (0.05 + 0.16 * (this._landImpact || 0.5));
    const knee = squash * 2.2;
    b.hips.position.y = this.hipsY0 - squash;
    if (b.upL) b.upL.rotation.x += knee * 0.55;
    if (b.upR) b.upR.rotation.x += knee * 0.55;
    if (b.loL) b.loL.rotation.x -= knee;
    if (b.loR) b.loR.rotation.x -= knee;
    // 上身后仰一点点，重心随下蹲后移
    if (this.actions.jump && this.current === this.actions.jump) {
      const spine = this.landBones.spine || (this.landBones.spine = findBone(this.model, /^mixamorig:spine$/i));
      if (spine) spine.rotation.x -= squash * 0.35;
    }
  }

  /**
   * 程序化坐姿：驾驶时把髋骨压到座位平面（root 即座位点），大腿抬平、小腿垂下。
   * 每帧在 mixer.update 之后执行，动画不会覆盖它；不驾驶时动画自动接管恢复。
   */
  _sitPose() {
    if (!this._sit) {
      const hips = findBone(this.model, /hips/i);
      this._sit = {
        hips,
        y0: hips ? hips.position.y : 0,
        upL: findBone(this.model, /leftupleg/i),
        upR: findBone(this.model, /rightupleg/i),
        loL: findBone(this.model, /leftleg/i),
        loR: findBone(this.model, /rightleg/i),
      };
    }
    const s = this._sit;
    if (!s.hips) return;
    s.hips.position.y = s.y0 * 0.16;          // 臀部落到座位点附近
    s.hips.position.z = 0;
    for (const [up, lo] of [[s.upL, s.loL], [s.upR, s.loR]]) {
      if (up) { up.rotation.x = -1.45; up.rotation.z = 0; up.rotation.y = 0; }  // 大腿水平向前
      if (lo) lo.rotation.x = 1.25;                                              // 小腿垂直向下
    }
  }

  // 假人的程序化动作：走跑蹲跳翻滚、双手持枪/挥刀
  _posePlaceholder(dt, st) {
    this.t += dt * (st.sprint ? 9.5 : st.moving ? 6.2 : 1.4);
    const sw = Math.sin(this.t) * 0.62;
    const sw2 = Math.cos(this.t) * 0.5;
    const moving = st.moving && st.onGround;
    const crouch = st.crouch ? 1 : 0;

    this.hips.position.y = 0.92 - crouch * 0.30 + (moving ? Math.abs(Math.sin(this.t)) * 0.03 : 0);
    this.hips.rotation.x = crouch * 0.18 + (st.sprint ? 0.16 : 0);

    // 驾驶坐姿（假人版）
    if (st.driving) {
      this.hips.position.y = 0.50;
      this.hips.rotation.x = 0.06;
      for (const L of this.legs) {
        L.hip.rotation.x = -1.45; L.knee.rotation.x = 1.25;
      }
      return;
    }

    for (const L of this.legs) {
      const s = L.side;
      L.hip.rotation.x = moving ? sw * s * -0.8 : -crouch * 0.55 * (s > 0 ? 1.6 : 0.6);
      L.knee.rotation.x = moving ? Math.max(0, sw2 * s) * 1.1 : crouch * 1.25;
      if (crouch) { L.hip.rotation.x -= 0.55; L.knee.rotation.x += 0.3; }
      if (!st.onGround) { L.hip.rotation.x = -0.5 * s; L.knee.rotation.x = 0.9; }
    }

    const aim = st.aiming ? 1 : 0;
    for (const A of this.arms) {
      const s = A.side;
      if (aim > 0.5) {
        // 双手抬平：右手持枪前推，左手扶护木
        A.sh.rotation.x = -1.42;
        A.sh.rotation.z = s * -0.32;
        A.elbow.rotation.x = s > 0 ? -0.18 : -0.55;
      } else {
        A.sh.rotation.x = moving ? -sw * s * 0.55 : -0.12;
        A.sh.rotation.z = s * 0.10;
        A.elbow.rotation.x = moving ? -Math.max(0, sw * s) * 0.5 - 0.15 : -0.22;
      }
    }
    // 挥刀：右臂横扫
    if (st.slashT > 0) {
      const k = Math.sin((1 - st.slashT / 0.45) * Math.PI);
      const R = this.arms.find(a => a.side === 1);
      R.sh.rotation.x = -1.1 - k * 0.4;
      R.sh.rotation.y = -1.2 * k;
      R.elbow.rotation.x = -0.9 + k * 0.7;
    }
    // 翻滚：整体绕 X 转一圈
    this.model.rotation.x = st.rollT > 0 ? (1 - st.rollT / 0.55) * Math.PI * 2 : 0;
    // 脖子跟随俯仰
    this.neck.rotation.x = st.pitch ? -st.pitch * 0.5 : 0;
  }
}
