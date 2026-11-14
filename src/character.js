// 第三人称角色：GLB 人物 + 动画状态机 + 武器插槽
// 没有 player.glb 时自动退化为内置假人（可走可跳可翻滚可持枪），保证功能先跑通。
import * as THREE from 'three';
import { instance, findBone } from './assets.js';
import { buildRifle, buildKnife } from './weapons.js';

// 动画别名表：GLB 里的 clip 名只要命中正则就能挂上对应动作
// 顺序有讲究：带方向后缀的必须排在 walk / run 前面，否则 walk_back 会被 /walk/ 抢走
const ALIAS = [
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
  ['knifeIdle', /knife.*idle|knife.*hold/i],   // 必须排在 idle 前，否则会被通用 idle 正则吞掉
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
};

// 属于"位移循环"的剪辑：切换时沿用彼此的相位，脚不跳
const LOCO = new Set(['walk', 'run', 'walk_back', 'run_back', 'strafe_l', 'strafe_r',
  'crouchWalk', 'crouchIdle', 'aimWalk', 'walk_unarmed', 'run_unarmed']);

// _poseWeapon / IK 用的临时对象（避免每帧分配）
const _vA = new THREE.Vector3(), _vB = new THREE.Vector3(), _vC = new THREE.Vector3(), _vD = new THREE.Vector3();
const _qA = new THREE.Quaternion(), _qB = new THREE.Quaternion(), _qC = new THREE.Quaternion();
const _mA = new THREE.Matrix4();
const _AXIS_Z = new THREE.Vector3(0, 0, 1);
// 两骨 IK 专用临时量
const _ikS = new THREE.Vector3(), _ikE = new THREE.Vector3(), _ikH = new THREE.Vector3(),
  _ikE2 = new THREE.Vector3(), _ikH2 = new THREE.Vector3(),
  _ik1 = new THREE.Vector3(), _ik2 = new THREE.Vector3(), _ik3 = new THREE.Vector3(),
  _ikA = new THREE.Vector3(),
  _ikWR = new THREE.Vector3(), _ikLW = new THREE.Vector3(),   // 左右手腕目标
  _ikHT = new THREE.Vector3(),                                // 肘部 hint
  _ikQW = new THREE.Quaternion(),                             // 枪朝向（世界）
  _ikQ1 = new THREE.Quaternion(), _ikQ2 = new THREE.Quaternion(), _ikQP = new THREE.Quaternion();

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

    // 军刀
    const ki = instance('knife');
    const knife = ki ? ki.wrap : buildKnife({ hands: false, scale: 0.95 });
    this.weapons.knife = mk('knife', knife, ki ? 0 : 0.05,
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

    this.mixer = new THREE.AnimationMixer(this.model);
    // 先按关键帧名精确对齐（run_back 不会被误当成 run），再走关键字兜底
    const take = (clip, key) => {
      const a = this.mixer.clipAction(clip);
      a.setEffectiveWeight(0);
      a.__name = key;
      a.__loco = LOCO.has(key);
      this.actions[key] = a;
    };
    for (const clip of inst.animations) {
      const n = clip.name.toLowerCase();
      const exact = ALIAS.find(([key]) => key.toLowerCase() === n);
      if (exact && !this.actions[exact[0]]) take(clip, exact[0]);
    }
    for (const clip of inst.animations) {
      for (const [key, re] of ALIAS) {
        if (this.actions[key] || !re.test(clip.name)) continue;
        take(clip, key);
        break;
      }
    }
    this.clipNames = inst.animations.map(c => c.name);
    // 手部插槽：优先右手，其次左手（不同软件命名差异都覆盖）
    this.hand = findBone(this.model, /(mixamorig)?(right|r)[_ ]?hand|hand[_ ]?r\b|wrist[_ ]?r/i)
      || findBone(this.model, /hand/i);
    this.handName = this.hand ? this.hand.name : '(未找到手骨)';
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

  /** 触发一次性动作（开火 / 挥刀 / 翻滚） */
  trigger(key, fade = 0.08) {
    if (this.mode !== 'glb') return false;
    if (!this.actions[key]) return false;
    const a = this.actions[key];
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    this._savePhase();               // 开枪/挥刀结束后回走路，相位能接上
    a.timeScale = 1;
    a.setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current && this.current !== a) this.current.fadeOut(fade);
    this.current = a;
    this.oneShot = a;
    this.oneShotT = a.getClip().duration * 0.9;
    return true;
  }

  update(dt, st) {
    this.root.visible = st.visible !== false;
    if (!this.root.visible) return;

    this.root.position.copy(st.pos);
    // 实际移动速度（水平面），用于步频自适应，防止脚底打滑
    if (this._lastPos && dt > 0.001) {
      const dx = st.pos.x - this._lastPos.x, dz = st.pos.z - this._lastPos.z;
      const v = Math.min(Math.hypot(dx, dz) / dt, 12);
      this.speed = this.speed === undefined ? v : this.speed + (v - this.speed) * Math.min(1, dt * 8);
    }
    this._lastPos = st.pos.clone();
    // 朝向平滑（避免 180° 跳变时像转了半圈）
    let dy = st.yaw - this.yawSmooth;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yawSmooth += dy * Math.min(1, dt * 14);
    this.root.rotation.y = this.yawSmooth;

    if (this.oneShotT > 0) {
      this.oneShotT -= dt;
      if (this.oneShotT <= 0) this.oneShot = null;
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

    // —— 位置锚：刀=右手骨（原点=握把，直接握在手里）；
    //    枪=右肩骨 + 固定偏移 = 肩窝点（枪托落点）；无骨骼退化用默认值 ——
    const isKnife = this.wep === 'knife' && !!this.hand;
    if (isKnife) {
      this.hand.getWorldPosition(this.v3);
      this.root.worldToLocal(this.v3);
      this.v3.y -= 0.03;   // 握把略低于腕骨
      this.v3.z -= 0.02;   // 略靠掌心前
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

    // —— 朝向：期望的"枪口方向"（root 局部：-Z 前，pitch 控制俯仰）——
    const t = performance.now() / 1000;
    const sway = Math.sin(t * (st.sprint ? 9 : 5)) * (st.moving ? 0.05 : 0.015);
    let pitch, roll = 0;
    if (this.wep === 'knife') {
      pitch = st.slashT > 0 ? 0.1 : 0.5;      // 刀：斜持，挥砍时抬平
      roll = 0.55;
    } else {
      // 枪：瞄准时跟随镜头俯仰（视觉减半，避免大仰角时机匣横穿头部；
      // 弹道不受影响——曳光弹始终从枪口连向准星），腰射时枪口下压 ~24°（低姿持枪）
      pitch = (st.aiming ? (st.pitch || 0) * 0.5 : -0.42) + sway * 0.4;
    }
    // 目标世界朝向：局部 -Z→fwd、+Y→上；转成 root 局部四元数
    const rootQ = this.root.getWorldQuaternion(_qA);
    const fwd = _vA.set(0, Math.sin(pitch), -Math.cos(pitch)).applyQuaternion(_qA).normalize();
    const zAxis = _vB.copy(fwd).negate();
    const yAxis = _vC.set(0, 1, 0).addScaledVector(zAxis, -zAxis.y).normalize();
    const xAxis = _vD.crossVectors(yAxis, zAxis);
    _mA.makeBasis(xAxis, yAxis, zAxis);
    _qB.setFromRotationMatrix(_mA);
    if (roll) _qB.multiply(_qC.setFromAxisAngle(_AXIS_Z, roll));
    _qA.invert().multiply(_qB);              // rootQ⁻¹ × 目标世界朝向 = root 局部朝向
    w.quaternion.slerp(_qA, Math.min(1, dt * 14));

    // 枪托底落肩窝：枪原点 = 肩窝 + 枪口方向 × 托底距离（沿枪轴向后退到肩）；
    // 刀原点=握把，直接落在手骨位置，不需要轴向补偿
    if (isKnife) {
      w.position.lerp(this.v3, Math.min(1, dt * 20));
      return;
    }
    const buttZ = g.userData.buttZ || 0.42;
    const fwdNow = _vA.set(0, 0, -1).applyQuaternion(w.quaternion);
    const target = _vB.copy(this.v3).addScaledVector(fwdNow, buttZ);
    w.position.lerp(target, Math.min(1, dt * 20));
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
      // 上升段播起跳（一次性，播完定住）；下落段优先 fall，没有 fall 就保持起跳姿
      if (st.vy > 0.5) { this.play('jump', 0.10, true); return; }
      if (this.play('fall', 0.14)) return;
      this.play('jump', 0.12, true);
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
