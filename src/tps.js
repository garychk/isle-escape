// 第三人称：弹簧臂相机 + 角色总装 + 载具驾驶
import * as THREE from 'three';
import { Character, SLASH_RATE } from './character.js';
import { Vehicle } from './vehicle.js';
import { groundHeight } from './terrain.js';
import { colliders } from './flora.js';

const EYE = 1.62;            // 相机围绕的锚点高度（约肩高）

export class TPS {
  constructor({ player, scene, camera, ui }) {
    this.player = player;
    this.scene = scene;
    this.cam = camera;
    this.ui = ui;
    this.baseFov = camera.fov;

    this.prev = player.pos.clone();
    this.speed = 0;
    this.rollT = 0;
    this.slashT = 0;
    this.shootT = 0;
    this.dist = 3.4;
    this.aimBlend = 0;

    this.char = new Character(scene);
    this.char.setWeapon(player.wep);

    // 载具停放点（沿主线放，方便遇到）
    // 2026-11-18 随海岛平面 ×1.25 同步（旧值 -103,82 / -14,196 会沉进放大后的水塘、偏离新出生点）
    // jeep 锚在水塘西南侧小径旁，m151 锚在出生点前方小径起点
    this.vehicles = [
      new Vehicle('jeep', scene, -128.75, 102.5, 1.15),
      new Vehicle('m151', scene, -17.5, 245, 2.7),
    ];
    player.tps = this;
    player.vehicles = this.vehicles;

    this.v1 = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
    this.v3 = new THREE.Vector3();
    this.v4 = new THREE.Vector3();
    this.pivot = new THREE.Vector3();
  }

  get inVehicle() { return this.player.inVehicle; }

  /** 玩家开火/挥刀时由 player 调用，驱动角色一次性动作 */
  onAction(kind) {
    if (kind === 'rifle') { this.char.trigger('shoot', 0.06); this.shootT = 0.12; }
    // 挥刀素材裁掉拖沓的头尾后约 1.33s，1.65 倍速 ≈ 0.81s。
    // 起手姿势与持刀待机差约 40°，淡入给到 0.13s，避免加速后变成"硬切"。
    else { this.char.trigger('slash', 0.13, SLASH_RATE); this.slashT = 0.45; }
  }

  startRoll() { this.rollT = 0.55; }

  update(dt) {
    const p = this.player;

    // 角色速度（用位移反推，兼容所有移动逻辑）
    const dx = p.pos.x - this.prev.x, dz = p.pos.z - this.prev.z;
    this.speed = Math.hypot(dx, dz) / Math.max(1e-4, dt);
    this.prev.copy(p.pos);
    if (this.rollT > 0) this.rollT -= dt;
    if (this.slashT > 0) this.slashT -= dt;
    if (this.shootT > 0) this.shootT -= dt;

    // —— 驾驶 ——
    if (p.inVehicle) {
      const v = p.inVehicle;
      const k = p.keys;
      const throttle = (k['KeyW'] ? 1 : 0) + (k['KeyS'] ? -1 : 0);
      const steer = (k['KeyA'] ? 1 : 0) + (k['KeyD'] ? -1 : 0);
      v.update(dt, throttle, steer, !!k['Space']);
    }

    // —— 角色姿态 ——
    const moving = this.speed > 0.35;
    // 局部输入方向（f=前/后，r=右/左），未归一化，键盘单轴时正好 ±1
    const inX = p.inX || 0, inZ = p.inZ || 0;
    const inLen = Math.hypot(inX, inZ);
    const f = -inZ, r = inX;

    // 朝向：瞄准时锁镜头方向（靠侧移剪辑走位）；
    // 平时面朝"移动方向"——这样永远播正面 walk，脚和地面同向，彻底没有横着滑的假象。
    let bodyYaw = p.yaw;
    if (!p.aiming && moving && inLen > 0.15) {
      const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
      const wx = -sy * f + cy * r;      // yaw=0 时前 = -Z
      const wz = -cy * f - sy * r;
      bodyYaw = Math.atan2(-wx, -wz);
    }

    this.char.update(dt, {
      pos: p.pos,
      yaw: bodyYaw,
      pitch: p.pitch,
      moving,
      sprint: moving && this.speed > 6.2,
      crouch: !!p.isSneaking,
      onGround: p.onGround,
      vy: p.velY || 0,
      aiming: !!p.aiming,
      dead: !!p.dead,
      driving: !!p.inVehicle,
      rollT: this.rollT,
      slashT: this.slashT,
      loco: { f: inLen > 0.15 ? f / Math.max(1, inLen) : 0, r: inLen > 0.15 ? r / Math.max(1, inLen) : 0 },
      visible: true,
    });

    this._camera(dt);
  }

  _camera(dt) {
    const p = this.player;
    const cam = this.cam;

    // —— 驾驶：拉远的追尾视角 ——
    if (p.inVehicle) {
      const v = p.inVehicle;
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      const want = 7.6 + Math.abs(v.speed) * 0.16;
      const target = this.v1.set(v.pos.x, v.pos.y + 2.9, v.pos.z);
      this.v2.set(v.pos.x - fx * want, v.pos.y + 3.5, v.pos.z - fz * want);
      this.v2.y = Math.max(this.v2.y, groundHeight(this.v2.x, this.v2.z) + 1.4);
      cam.position.lerp(this.v2, Math.min(1, dt * 6));
      cam.lookAt(target);
      cam.fov += (this.baseFov - cam.fov) * Math.min(1, dt * 6);
      cam.updateProjectionMatrix();
      return;
    }

    // —— 奔跑 / 瞄准的相机融合 ——
    this.aimBlend += ((p.aiming ? 1 : 0) - this.aimBlend) * Math.min(1, dt * 9);

    const standY = p.isSneaking ? 1.05 : EYE;
    this.pivot.set(p.pos.x, p.pos.y + standY, p.pos.z);

    // 右肩偏移（瞄准时更靠近枪线）
    const right = this.v3.set(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
    this.pivot.addScaledVector(right, 0.34 + this.aimBlend * 0.26);

    // 视线方向（相机在锚点后方）
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const dir = new THREE.Vector3(-Math.sin(p.yaw) * cp, sp, -Math.cos(p.yaw) * cp);

    const wantDist = 3.45 - this.aimBlend * 1.15;
    const hit = this._boom(this.pivot, dir, wantDist);
    // 撞墙瞬间贴近，离开后缓慢拉回
    this.dist += (hit - this.dist) * Math.min(1, dt * (hit < this.dist ? 30 : 4));

    const pos = this.v2.copy(this.pivot).addScaledVector(dir, -this.dist);
    // 瞄准时相机位置整体抬高：人物沉到画面下缘，准星（屏幕中心）远离人物头部。
    // 抬高只改"位置"，朝向仍与弹道 dir 平行（见下方 lookAt 混合），准星与子弹始终一致。
    pos.y += this.aimBlend * 0.55;
    // 防穿地兜底。山体/峡谷陡壁区地面可比锚点高几十米，此行若无上限会把相机
    // 顶到坡顶 → 整屏岩壁、失去参照（即「山那边视角卡住回不来」）。
    // 上限锁在锚点上方 0.9m：贴壁时相机保持在玩家肩高附近，地形 FrontSide
    // 背面剔除让相机即使略埋进坡面也能看到角色与前方，不会黑屏。
    const gy = Math.min(groundHeight(pos.x, pos.z) + 0.34, this.pivot.y + 0.9);
    if (pos.y < gy) pos.y = gy;
    // 首帧直接就位，之后平滑跟随
    if (cam.position.distanceToSquared(pos) > 25) cam.position.copy(pos);
    else cam.position.lerp(pos, Math.min(1, dt * 15));

    // 目标点混合：
    //  腰射 → 看向枢轴前方（跟随感强）
    //  瞄准 → 看向"相机正前方"（与弹道 dir 严格平行，人物不再挤在准星旁）
    const hipT = this.v1.copy(this.pivot).addScaledVector(dir, 12).setY(this.pivot.y + sp * 12 + 0.06);
    const aimT = this.v4.copy(pos).addScaledVector(dir, 12);
    hipT.lerp(aimT, this.aimBlend);
    // 硬保险：视线与 up 轴夹角过小时 lookAt 会万向锁（相机 roll 翻转 → 视角看似「卡住回不来」）。
    // pitch 已 clamp 到 ±1.15，这里再把目标点沿水平外推，仰角封顶 ≈70°，杜绝任何极端路径。
    const look = this.v4.copy(hipT).sub(cam.position);
    const horiz = Math.hypot(look.x, look.z);
    const maxY = Math.max(0.6, horiz * 2.75);
    if (look.y > maxY) hipT.y -= look.y - maxY;
    else if (look.y < -maxY) hipT.y += -maxY - look.y;
    cam.lookAt(hipT);
    // 瞄准变焦
    const fov = this.baseFov - this.aimBlend * 15;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 8); cam.updateProjectionMatrix(); }
  }

  /** 弹簧臂：从锚点往后退，遇地面/陡壁/树木就收短，避免穿模或被地形顶飞 */
  _boom(pivot, dir, want) {
    const STEP = 0.25;
    let d = want;
    for (let s = 0.6; s <= want; s += STEP) {
      const x = pivot.x - dir.x * s, y = pivot.y - dir.y * s, z = pivot.z - dir.z * s;
      const gh = groundHeight(x, z);
      // 撞地面，或落点地形显著高于锚点（陡壁/陡坎）：都收短，
      // 否则最终 pos 会被防穿地兜底抬到高处变成俯视（视角卡住）。
      if (y < gh + 0.30 || gh > pivot.y + 0.9) { d = Math.max(0.85, s - STEP); break; }
      let blocked = false;
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        const ddx = x - c.x, ddz = z - c.z, rr = c.r + 0.30;
        if (ddx * ddx + ddz * ddz < rr * rr) { blocked = true; break; }
      }
      if (blocked) { d = Math.max(0.85, s - STEP); break; }
    }
    return d;
  }
}
