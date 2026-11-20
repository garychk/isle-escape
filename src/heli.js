// 可驾驶直升机：坐上后俯瞰全岛（GLB 缺省时用方块替身占位）
// 与 vehicle.js 的地面载具同一套上下车协议（near/mount/dismount/update + inVehicle），
// tps.js 追尾相机直接复用；飞行模型为街机式：Space 上升 / Shift 下降 / WASD 前后左右。
import * as THREE from 'three';
import { instance } from './assets.js';
import { groundHeight } from './terrain.js';
import { colliders } from './flora.js';
import { dist2, clamp, pushOutCircles } from './util.js';
import { sfx, engineStart, engineUpdate, engineStop, ignitionStart, heliSoundStart, heliSoundUpdate, heliSoundStop } from './audio.js';

const MAX_FWD = 26;      // 前飞最大水平速度 m/s（约 94km/h，能 20 秒横穿全岛）
const MAX_REV = 7;       // 后飞
const MAX_UP = 7.5;      // 爬升
const MAX_DN = 7;        // 下降
const MAX_ALT = 90;      // 升限（超过后不再给升力）
const SEA = 0.35;        // 海面"地面"高度（迫降海上按贴水处理）

function proxy() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 6.5),
    new THREE.MeshStandardMaterial({ color: 0x39424e, roughness: 0.6, metalness: 0.4 }));
  body.position.y = 1.6; body.castShadow = true;
  g.add(body);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.06, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x222222 }));
  rotor.position.y = 2.6; g.add(rotor);
  return g;
}

export class Heli {
  constructor(scene, x, z, yaw = 0) {
    this.kind = 'heli';
    this.name = '直升机';
    this.scene = scene;
    this.pos = new THREE.Vector3(x, groundHeight(x, z), z);
    this.yaw = yaw;
    this.speed = 0;        // 前飞水平速度（沿机头，>0 前进）
    this.vy = 0;           // 垂直速度
    this.engine = 0;       // 旋翼转速 0~1（起飞前要先"暖机"）
    this.rotT = 0;         // 旋翼相位
    this.driver = null;
    this.radius = 3.4;     // 低空撞树判定半径
    this.pitchS = 0; this.rollS = 0;   // 平滑后的姿态角
    this.spooled = false;

    this.group = new THREE.Group();
    const inst = instance('heli');
    this.hasModel = !!inst;
    this.mainRotor = null; this.tailRotor = null;
    if (inst) {
      let rotorNode = null;
      inst.wrap.traverse((o) => {
        if (o.name === 'Rot') rotorNode = o;
        else if (o.name === 'Rot2') this.tailRotor = o;
      });
      if (rotorNode?.parent) {
        const rotorPivot = new THREE.Group();
        rotorPivot.name = 'MainRotorPivot';
        // Keep the blade mesh in place while putting its pivot at the white mast cap.
        // GLB values are in the HeliRoot frame; the cap is centered at y=2.32.
        const cap = new THREE.Vector3(0, 2.32, -1.48);
        rotorPivot.position.copy(cap);
        rotorNode.position.sub(cap);
        rotorNode.parent.add(rotorPivot);
        rotorPivot.add(rotorNode);
        this.mainRotor = rotorPivot;
      }
    }
    this.group.add(inst ? inst.wrap : proxy());
    this.group.position.copy(this.pos);
    this.group.rotation.y = yaw;
    scene.add(this.group);
  }

  get flying() { return this.pos.y > this._gy() + 0.55; }
  _gy() { return Math.max(groundHeight(this.pos.x, this.pos.z), SEA); }

  near(x, z, r = 3.4) { return dist2(x, z, this.pos.x, this.pos.z) < r; }

  mount(player) {
    if (this.driver) return false;
    this.driver = player;
    player.inVehicle = this;
    this.speed = 0; this.vy = 0;
    sfx.door();
    // 旋翼实录音优先；文件缺失回退合成引擎（点火→怠速）
    this.fileAudio = heliSoundStart();
    if (!this.fileAudio) ignitionStart(() => engineStart());
    this.spooled = false;
    player.ui.toast('直升机 · Space 上升 / Shift 下降 / WASD 飞行 / E 下车（需先着陆）');
    return true;
  }

  dismount(player) {
    if (!this.driver) return;
    if (this.flying) {   // 空中跳车会摔死——禁止，提示先降落
      player.ui.toast('高度太高 · 先降落到地面再下车', true);
      return;
    }
    this.driver = null;
    player.inVehicle = null;
    // 从驾驶位侧向落地（避开停机坪中心）
    const sx = Math.cos(this.yaw) * 1.6, sz = -Math.sin(this.yaw) * 1.6;
    const x = this.pos.x + sx, z = this.pos.z + sz;
    player.pos.set(x, groundHeight(x, z), z);
    player.velY = 0;
    player.onGround = true;
    this.speed = 0; this.vy = 0;
    heliSoundStop(); engineStop();
    sfx.door();
  }

  /** 驾驶输入：throttle ∈ [-1,1] 前飞/后飞，steer ∈ [-1,1] 偏航（tps 传入；升/降直接读 keys） */
  update(dt, throttle = 0, steer = 0) {
    const k = this.driver ? this.driver.keys : {};
    const up = !!k['Space'], down = !!(k['ShiftLeft'] || k['ShiftRight']);
    const gy = this._gy();
    const alt = this.pos.y - gy;

    // —— 旋翼暖机 / 停转 ——
    const wantEng = this.driver ? 1 : 0;
    this.engine += (wantEng - this.engine) * Math.min(1, dt * (wantEng ? 0.55 : 0.8));
    if (!this.driver && this.engine < 0.02) this.engine = 0;
    this.rotT += dt * this.engine * 34;

    // —— 垂直 ——
    let vyT = 0;
    if (this.driver && this.engine > 0.5) {
      if (up && alt < MAX_ALT) vyT = MAX_UP * (1 - Math.max(0, (alt - MAX_ALT * 0.85)) / (MAX_ALT * 0.15));
      else if (down) vyT = -MAX_DN;
    }
    this.vy += (vyT - this.vy) * Math.min(1, dt * 3.2);
    if (!this.driver && !this.flying) this.vy = 0;
    let ny = this.pos.y + this.vy * dt;
    if (ny < gy) { ny = gy; if (this.vy < -4.5) sfx.door(); this.vy = 0; }  // 触地
    this.pos.y = ny;

    // —— 水平：W/S 沿机头加减速 ——
    const lift = this.engine > 0.5;
    if (throttle > 0) this.speed += 7.5 * throttle * dt * (lift ? 1 : 0.25);
    else if (throttle < 0) this.speed += (this.speed > 0 ? 10 : 5) * throttle * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 3.2 * dt);
    if (!this.flying) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 6 * dt); // 橇式起落架地面摩擦
    this.speed = clamp(this.speed, -MAX_REV, MAX_FWD);

    // —— 偏航：A/D ——（空中灵、地面缓）
    this.yaw += steer * dt * (this.flying ? 1.35 : 0.55);

    // —— 位移 + 低空撞树/山体保护 ——
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let nx = this.pos.x + fx * this.speed * dt;
    let nz = this.pos.z + fz * this.speed * dt;
    if (this.pos.y - groundHeight(nx, nz) < 6) {
      const pushed = pushOutCircles(nx, nz, this.radius, colliders);
      if (pushed) { nx = pushed[0]; nz = pushed[1]; this.speed *= 0.4; }
    }
    // 岛屿边界（深海禁出，与玩家 DEEP_R 同心）
    const rr = Math.hypot(nx, nz);
    if (rr > 322) { nx *= 322 / rr; nz *= 322 / rr; this.speed *= 0.5; }
    this.pos.x = nx; this.pos.z = nz;
    // 水平移动后地形可能抬高（贴地飞进上坡）：二次贴地，防机身埋进坡面
    const gy2 = this._gy();
    if (this.pos.y < gy2) { this.pos.y = gy2; this.vy = Math.max(this.vy, 0); }

    // —— 姿态：前飞低头、转弯压坡度 ——
    const pitchT = -clamp(this.speed / MAX_FWD, -0.3, 1) * 0.32;
    const rollT = steer * (this.flying ? 0.28 : 0.1) * clamp(Math.abs(this.speed) / 8 + 0.3, 0, 1);
    this.pitchS += (pitchT - this.pitchS) * Math.min(1, dt * 4);
    this.rollS += (rollT - this.rollS) * Math.min(1, dt * 4);
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.group.rotation.set(this.pitchS, this.yaw, this.rollS, 'YXZ');

    // —— 旋翼自转 ——
    if (this.mainRotor) this.mainRotor.rotation.y = this.rotT;
    if (this.tailRotor) this.tailRotor.rotation.x = this.rotT * 1.9;

    // —— 驾驶位同步（角色坐进座舱）——
    if (this.driver) {
      const off = new THREE.Vector3(0.35, 1.28, 1.05)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      this.driver.pos.set(this.pos.x + off.x, this.pos.y + off.y, this.pos.z + off.z);
      this.driver.yaw = this.yaw + Math.PI;   // 角色 yaw=0 面朝 -Z，载具前进 +Z：转 180 面朝机头
      // 音量/音调随旋翼转速 × 前飞速度
      const inten = clamp(this.engine * (0.55 + 0.45 * clamp(Math.abs(this.speed) / MAX_FWD, 0, 1)), 0, 1);
      if (this.fileAudio) heliSoundUpdate(inten);
      else engineUpdate(clamp(Math.abs(this.speed) / MAX_FWD, 0.25, 1) * (0.6 + 0.4 * this.engine));
    }
  }
}
