// 可驾驶载具：越野车 / 军用吉普（GLB 缺省时用方块替身占位）
import * as THREE from 'three';
import { instance } from './assets.js';
import { groundHeight } from './terrain.js';
import { colliders } from './flora.js';
import { dist2, clamp } from './util.js';

const SPEC = {
  jeep:      { max: 17, accel: 8.5, brake: 16, drag: 2.6, turn: 1.35, seat: [0, 0.22, 0.15], radius: 1.16, name: '越野车' },
  m151:      { max: 16, accel: 8.0, brake: 15, drag: 2.5, turn: 1.55, seat: [0.35, 0.18, -0.08], radius: 1.0, name: '军用吉普' },
};

function proxy(kind) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 3.6),
    new THREE.MeshStandardMaterial({ color: 0x4a5340, roughness: 0.7, metalness: 0.3 }));
  body.position.y = 0.85; body.castShadow = true;
  g.add(body);
  return g;
}

export class Vehicle {
  constructor(kind, scene, x, z, yaw = 0) {
    this.kind = kind;
    this.spec = SPEC[kind] || SPEC.jeep;
    this.scene = scene;
    this.pos = new THREE.Vector3(x, groundHeight(x, z), z);
    this.yaw = yaw;
    this.speed = 0;
    this.steer = 0;
    this.driver = null;
    this.bobT = 0;

    this.group = new THREE.Group();
    const inst = instance(kind);
    this.hasModel = !!inst;
    this.group.add(inst ? inst.wrap : proxy(kind));
    this.group.position.copy(this.pos);
    this.group.rotation.y = yaw;
    scene.add(this.group);
  }

  get name() { return this.spec.name; }

  near(x, z, r = 3.4) { return dist2(x, z, this.pos.x, this.pos.z) < r; }

  mount(player) {
    if (this.driver) return false;
    this.driver = player;
    player.inVehicle = this;
    this.speed = 0;
    return true;
  }

  dismount(player) {
    if (!this.driver) return;
    this.driver = null;
    player.inVehicle = null;
    // 从驾驶位侧向落地
    const sx = Math.cos(this.yaw) * 1.1, sz = -Math.sin(this.yaw) * 1.1;
    const x = this.pos.x + sx, z = this.pos.z + sz;
    player.pos.set(x, groundHeight(x, z), z);
    player.velY = 0;
    player.onGround = true;
    this.speed = 0;
  }

  /** 驾驶输入：throttle ∈ [-1,1]，steer ∈ [-1,1] */
  update(dt, throttle = 0, steer = 0, handbrake = false) {
    const S = this.spec;
    if (throttle > 0) this.speed += S.accel * throttle * dt;
    else if (throttle < 0) this.speed += (this.speed > 0 ? S.brake : S.accel * 0.7) * throttle * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), S.drag * dt);

    if (handbrake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 22 * dt);
    this.speed = clamp(this.speed, -S.max * 0.35, S.max);
    if (Math.abs(this.speed) < 0.02) this.speed = 0;

    // 转向：速度越低越难转，倒车时反向
    const grip = clamp(Math.abs(this.speed) / 5.5, 0, 1) * Math.sign(this.speed || 1);
    // A（steer=+1）= 左转：追尾相机下 yaw 增大使车头摆向画面左侧
    this.yaw += steer * S.turn * dt * grip;

    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let nx = this.pos.x + fx * this.speed * dt;
    let nz = this.pos.z + fz * this.speed * dt;

    // 撞树/撞石头：推出并掉速
    for (const c of colliders) {
      const d = dist2(nx, nz, c.x, c.z);
      if (d < c.r + S.radius) {
        const a = Math.atan2(nx - c.x, nz - c.z);
        nx = c.x + Math.sin(a) * (c.r + S.radius);
        nz = c.z + Math.cos(a) * (c.r + S.radius);
        this.speed *= 0.45;
      }
    }
    this.pos.x = nx; this.pos.z = nz;

    // 贴地 + 坡度姿态
    const gy = groundHeight(nx, nz);
    const ahead = groundHeight(nx + fx * 1.6, nz + fz * 1.6);
    const behind = groundHeight(nx - fx * 1.6, nz - fz * 1.6);
    const pitch = Math.atan2(ahead - behind, 3.2);
    this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 12);
    this.bobT += dt * Math.abs(this.speed) * 0.9;

    this.group.position.set(this.pos.x, this.pos.y + Math.sin(this.bobT) * 0.012 * clamp(Math.abs(this.speed) / 8, 0, 1), this.pos.z);
    this.group.rotation.set(-pitch, this.yaw, -this.steer * clamp(Math.abs(this.speed) / 12, 0, 1) * 0.12);

    // 驾驶位世界坐标（角色坐进去用）
    // 角色 yaw=0 面朝 -Z，载具前进是 +Z：多转 180° 让角色面朝车头
    if (this.driver) {
      const s = this.spec.seat;
      const off = new THREE.Vector3(s[0], s[1], s[2]).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      this.driver.pos.set(this.pos.x + off.x, this.pos.y + off.y, this.pos.z + off.z);
      this.driver.yaw = this.yaw + Math.PI;
    }
  }
}
