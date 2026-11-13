// 玩家：第一人称控制 / 步枪 + 军刀 / 生命体力 / 拾取 / 受击与中毒
import * as THREE from 'three';
import { CFG, RAFT, BOAT, PICKUPS, POND, SWAMP } from './config.js';
import { clamp, dist2 } from './util.js';
import { groundHeight, zoneState } from './terrain.js';
import { colliders } from './flora.js';
import { sfx } from './audio.js';
import { burst } from './animals.js';
import { instance } from './assets.js';

const V = new THREE.Vector3();

export class Player {
  constructor(camera, scene, beasts, ui, envTex) {
    this.cam = camera; this.scene = scene; this.beasts = beasts; this.ui = ui;
    this.pos = new THREE.Vector3(0, 3, 205);
    this.velY = 0; this.yaw = 0; this.pitch = -0.02; // 朝北面向密林
    this.onGround = true;
    this.hp = CFG.HP_MAX; this.st = CFG.ST_MAX;
    this.dead = false; this.poisonT = 0;
    this.wep = 'rifle';
    this.mag = CFG.MAG; this.reserve = 90;
    this.fireCd = 0; this.reloadT = 0; this.knifeCd = 0; this.knifeAnim = 0;
    this.bobT = 0; this.stepT = 0;
    this.sprinting = false;
    this.isSneaking = false;
    // —— 第三人称 / 载具 ——
    this.camMode = 'third';    // 纯第三人称
    this.inVehicle = null;
    this.vehicles = null;
    this.tps = null;
    this.rollT = 0;
    this.keys = {};
    this.touchMove = { x: 0, y: 0 };
    this.inX = 0; this.inZ = 0; this.inLen = 0;   // 局部输入方向（供角色朝向/侧移动画使用）

    this.touchFire = false;
    this.aiming = false;
    this.recoil = 0; this.kick = 0;
    this.win = false;
    this.finishT = 0;
    this.stats = { shots: 0, hits: 0, kills: 0 };
    this.flashOn = false;
    this.groundKind = 'grass';
    this.lastDmgDir = 0;

    // 拾取物
    this.pickups = [];
    const ammoMat = new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.8 });
    const medMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.7 });
    const redMat = new THREE.MeshStandardMaterial({ color: 0xc4392a, roughness: 0.7 });
    for (const [x, z, type] of PICKUPS) {
      const g = new THREE.Group();
      if (type === 'ammo') {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.35), ammoMat);
        g.add(box);
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.08, 0.37), redMat);
        g.add(band);
      } else {
        // 急救箱：优先用外部 GLB 模型，缺失时退回程序化方块
        const mk = instance('medkit');
        if (mk) {
          g.add(mk.wrap);
        } else {
          const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.42), medMat);
          g.add(box);
          const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.1), redMat); c1.position.y = 0.15; g.add(c1);
          const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.3), redMat); c2.position.y = 0.15; g.add(c2);
        }
      }
      // 悬浮高度：地形之上；若点位落在水域（海/水塘/沼泽），则浮到水面之上，避免沉底
      const gy = groundHeight(x, z);
      let wy = CFG.SEA_Y;
      if (dist2(x, z, POND.x, POND.z) < 52 && gy < CFG.POND_Y) wy = CFG.POND_Y;
      if (dist2(x, z, SWAMP.x, SWAMP.z) < 66 && gy < CFG.SWAMP_Y) wy = CFG.SWAMP_Y;
      g.position.set(x, Math.max(gy, wy) + 0.35, z);
      g.rotation.y = Math.random() * 6.28;
      scene.add(g);
      this.pickups.push({ x, z, type, mesh: g, taken: false });
    }

    // 枪灯挂在场景里，每帧跟随角色手里那把枪（不再有第一人称视模型）
    this.flash = new THREE.SpotLight(0xfff2d2, 0, 62, 0.6, 0.55, 0.95);
    this.flashTgt = new THREE.Object3D();
    scene.add(this.flashTgt);
    this.flash.target = this.flashTgt;
    scene.add(this.flash);

    // 枪口火光
    this.muzzle = new THREE.PointLight(0xffc46a, 0, 9, 2);
    scene.add(this.muzzle);
    this.muzzleT = 0;

    // 曳光弹池
    this.tracers = [];
    for (let i = 0; i < 6; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0 }));
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, t: 0 });
    }

    // 受击方向
    this.beasts.onHurt = (dmg, cause, fx, fz) => this.damage(dmg, cause, fx, fz);
  }

  poison(sec) { this.poisonT = Math.max(this.poisonT, sec); this.ui.toast('中毒！蛛毒正在侵蚀', true); }

  damage(dmg, cause, fx, fz) {
    if (this.dead || this.win) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.lastDmgDir = Math.atan2(fx - this.pos.x, fz - this.pos.z);
    this.ui.onHurt(dmg, cause);
    sfx.hurt();
    if (this.tps && this.tps.char) this.tps.char.trigger('hit', 0.04);
    if (this.hp <= 0) { this.dead = true; this.ui.onDead(cause); }
  }

  // 射击（左键）
  tryFire(time) {
    if (this.reloadT > 0 || this.fireCd > 0 || this.win) return;
    if (this.wep === 'rifle') {
      if (this.mag <= 0) {
        sfx.dryfire(); this.fireCd = 0.25; this.ui.hintEmpty(true);
        if (this.reserve <= 0) setTimeout(() => { if (this.mag === 0 && this.reserve === 0) { this.switchWep('knife'); this.ui.toast('弹药耗尽 · 已拔刀', true); } }, 260);
        return;
      }
      this.mag--;
      this.fireCd = 60 / CFG.RIFLE_RPM;
      this.stats.shots++;
      sfx.rifle();
      this.tps && this.tps.onAction('rifle');
      this.recoil += 0.022; this.kick = 1;
      this.muzzleT = 0.06;
      this.beasts.hearNoise(this.pos.x, this.pos.z, 1);
      // 射线
      const spread = this.aiming ? CFG.AIM_SPREAD : CFG.SPREAD;
      const dir = new THREE.Vector3((Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2, -1)
        .applyQuaternion(this.cam.quaternion).normalize();
      const ray = new THREE.Ray(this.cam.getWorldPosition(V.clone()), dir);
      const beast = this.beasts.hitAt(ray, CFG.RIFLE_DMG);
      let hitDist = CFG.RIFLE_RANGE;
      if (beast) {
        this.stats.hits++;
        hitDist = ray.origin.distanceTo(new THREE.Vector3(beast.x, beast.y + 1, beast.z));
        this.ui.hitMark(beast.state === 'dead');
        sfx.hitmark();
      } else {
        // 打到地形/环境
        const far = ray.origin.clone().addScaledVector(dir, CFG.RIFLE_RANGE);
        const gy = groundHeight(far.x, far.z);
        if (far.y < gy) { // 粗略求交
          for (let t = 4; t < CFG.RIFLE_RANGE; t += 2) {
            const p = ray.origin.clone().addScaledVector(dir, t);
            if (p.y < groundHeight(p.x, p.z)) { hitDist = t; burst(p.x, p.y, p.z, 4, 1.4, 0x9a8a6a, 0.1); break; }
          }
        }
      }
      this.showTracer(hitDist);
    } else {
      // 军刀
      if (this.knifeCd > 0) return;
      this.knifeCd = CFG.KNIFE_CD;
      this.knifeAnim = 1;
      this.tps && this.tps.onAction('knife');
      sfx.knife();
      // 近战判定
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.cam.quaternion).normalize();
      const beast = this.beasts.hitAt(new THREE.Ray(this.cam.getWorldPosition(V.clone()), dir), CFG.KNIFE_DMG);
      if (beast) {
        if (beast.state === 'dead') { this.ui.hitMark(true); sfx.stab(); }
        else { this.ui.hitMark(false); sfx.stab(); }
      }
    }
  }
  showTracer(dist) {
    const t = this.tracers.find(x => x.t <= 0); if (!t) return;
    const m = this.tps && this.tps.char ? this.tps.char.muzzleWorld() : null;
    const start = m ? m.clone() : new THREE.Vector3(0.26, -0.16, -1.0).applyMatrix4(this.cam.matrixWorld);
    // 目标点取瞄准射线上 dist 处，弹道从枪口连过去（第三人称的标准做法）
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.cam.quaternion);
    const aimPt = new THREE.Vector3(0.26, -0.16, -1.0).applyMatrix4(this.cam.matrixWorld).addScaledVector(dir, dist);
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, start.x, start.y, start.z);
    pos.setXYZ(1, aimPt.x, aimPt.y, aimPt.z);
    pos.needsUpdate = true;
    t.t = 0.09;
    t.line.material.opacity = 0.7;
  }
  reload() {
    if (this.wep !== 'rifle' || this.reloadT > 0 || this.mag >= CFG.MAG || this.reserve <= 0) return;
    this.reloadT = CFG.RELOAD;
    sfx.reload();
  }
  switchWep(w) {
    if (this.reloadT > 0 || w === this.wep) return;
    this.wep = w;
    if (this.tps && this.tps.char) this.tps.char.setWeapon(w);
    sfx.uiclick();
    this.ui.updateWep(this);
  }
  toggleFlash() { this.flashOn = !this.flashOn; this.flash.intensity = this.flashOn ? 130 : 0; sfx.uiclick(); this.ui.toast(this.flashOn ? '枪灯已开启' : '枪灯已关闭'); }

  update(dt, bridgeSway) {
    if (this.dead || this.win) { this.updateCam(dt); this.updateLights(); return; }
    // 驾驶中：位置由载具接管，只保留上下车提示
    if (this.inVehicle) {
      this.ui.prompt('E', '下车', () => this.inVehicle && this.inVehicle.dismount(this));
      this.updateCam(dt);
      this.updateLights();
      this.ui.updateVitals(this);
      return;
    }
    // —— 输入方向 ——
    const k = this.keys;
    let ix = 0, iz = 0;
    if (k['KeyW']) iz -= 1; if (k['KeyS']) iz += 1;
    if (k['KeyA']) ix -= 1; if (k['KeyD']) ix += 1;
    ix += this.touchMove.x; iz += this.touchMove.y;
    const L = Math.hypot(ix, iz);
    if (L > 1) { ix /= L; iz /= L; }
    // 暴露给 TPS：角色朝向与侧移剪辑选择要用"局部输入方向"
    this.inX = ix; this.inZ = iz; this.inLen = Math.min(1, L);

    const zone = zoneState(this.pos.x, this.pos.z);
    const wantSprint = (k['ShiftLeft'] || k['ShiftRight']) && L > 0.1 && this.st > 1;
    this.sprinting = wantSprint && zone.inSwampWater === false;
    if (this.sprinting) this.st = Math.max(0, this.st - CFG.ST_DRAIN * dt);
    else this.st = Math.min(CFG.ST_MAX, this.st + CFG.ST_REGEN * dt);

    let spd = this.sprinting ? CFG.RUN : CFG.WALK;
    if (zone.inSwampWater && !zone.onBoard) spd = CFG.SWAMP_WALK;
    else if (zone.inWater) spd *= 0.62;
    if (this.wep === 'knife') spd *= 1.12;
    if (this.aiming) spd *= 0.55;
    if (this.isSneaking) spd *= CFG.CROUCH_MULT;

    // yaw=0 面朝 -z，标准 FPS 移动向量
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
    let mx = (fwdX * -iz + rightX * ix) * spd * dt;
    let mz = (fwdZ * -iz + rightZ * ix) * spd * dt;

    // 翻滚：沿面朝方向前冲
    if (this.rollT > 0) {
      this.rollT -= dt;
      const rs = 7.6 * dt;
      mx += fwdX * rs; mz += fwdZ * rs;
    }

    // —— 碰撞 ——
    let nx = this.pos.x + mx, nz = this.pos.z + mz;
    const PR = 0.45;
    for (const c of colliders) {
      const d = dist2(nx, nz, c.x, c.z);
      if (d < c.r + PR) {
        const a = Math.atan2(nx - c.x, nz - c.z);
        nx = c.x + Math.sin(a) * (c.r + PR);
        nz = c.z + Math.cos(a) * (c.r + PR);
      }
    }
    // 深海阻挡
    if (zone.deep) {
      const a = Math.atan2(nx, nz);
      nx = Math.sin(a) * CFG.DEEP_R * 0.98;
      nz = Math.cos(a) * CFG.DEEP_R * 0.98;
      this.ui.deepWarn();
    }
    this.pos.x = nx; this.pos.z = nz;

    // —— 垂直 ——
    const gy = groundHeight(this.pos.x, this.pos.z, bridgeSway, this.pos.y);
    if (k['Space'] && this.onGround && this.rollT <= 0) { this.velY = CFG.JUMP; this.onGround = false; }
    this.velY -= CFG.GRAV * dt;
    this.pos.y += this.velY * dt;
    if (this.pos.y <= gy) {
      if (this.velY < -13) this.damage(Math.min(60, (-this.velY - 13) * 6), '坠落', this.pos.x, this.pos.z);
      this.pos.y = gy; this.velY = 0; this.onGround = true;
    } else if (this.velY <= 0 && this.pos.y - gy < Math.max(0.1, -this.velY * dt + 0.02)) {
      // 贴地：水面波浪/缓坡会让 y 一直在 gy 上方一点点，必须吸附，否则永远判为腾空
      this.pos.y = gy; this.velY = 0; this.onGround = true;
    } else if (this.pos.y > gy + 0.05) this.onGround = false;

    // 跌落谷底：拽回桥头
    if (this.pos.y < -8.5) {
      this.damage(26, '坠入断魂谷');
      this.pos.set(0, groundHeight(0, 22) + 1.2, 22);
      this.velY = 0;
    }
    // —— 环境伤害 ——
    if (zone.inSwampWater && !zone.onBoard) {
      this.swampT = (this.swampT || 0) + dt;
      if (this.swampT > 1) { this.swampT = 0; this.damage(CFG.SWAMP_DPS * 2, '沼泽血蛭', this.pos.x, this.pos.z); this.ui.toast('血蛭正在啃噬！快走木板路', true); }
      if (Math.random() < dt * 2) burst(this.pos.x, gy + 0.2, this.pos.z, 3, 1.2, 0x3a4420, 0.12);
    }
    if (zone.inWater && Math.random() < dt * 0.6) { sfx.splash(); }
    if (this.poisonT > 0) {
      this.poisonT -= dt;
      this.poiTick = (this.poiTick || 0) + dt;
      if (this.poiTick > 0.8) { this.poiTick = 0; this.hp = Math.max(1, this.hp - CFG.POISON_DPS); this.ui.flashDmg(); }
    }
    this.ui.setPoison(this.poisonT > 0);

    // —— 武器计时 ——
    if (this.fireCd > 0) this.fireCd -= dt;
    if (this.knifeCd > 0) this.knifeCd -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = CFG.MAG - this.mag;
        const take = Math.min(need, this.reserve);
        this.mag += take; this.reserve -= take;
        this.ui.updateAmmo(this);
      }
    }
    if (this.touchFire || k['Mouse0']) this.tryFire(performance.now() / 1000);
    if (this.muzzleT > 0) { this.muzzleT -= dt; this.muzzle.intensity = this.muzzleT > 0 ? 26 : 0; }
    for (const t of this.tracers) if (t.t > 0) { t.t -= dt; t.line.material.opacity = Math.max(0, t.t / 0.09) * 0.7; }

    // —— 脚步声 ——
    const moving = L > 0.1 && this.onGround;
    if (moving) {
      this.bobT += dt * (this.sprinting ? 11 : 7);
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = this.sprinting ? 0.31 : 0.44;
        let kind = 'grass';
        if (zone.inSwampWater && !zone.onBoard) kind = 'swamp';
        else if (zone.onBoard) kind = 'wood';
        else if (zone.inWater) kind = 'water';
        else if (zone.cave) kind = 'rock';
        else if (this.pos.y < 2.2 && dist2(this.pos.x, this.pos.z, 0, 0) > 190) kind = 'sand';
        sfx.step(kind);
      }
    }

    // —— 拾取 / 上筏提示 ——
    this.updateInteract();
    this.updateCam(dt, moving);
    this.updateLights();
    this.ui.updateVitals(this);
    this.ui.updateAmmo(this);
  }

  updateInteract() {
    let near = null;
    for (const p of this.pickups) {
      if (p.taken) continue;
      if (dist2(this.pos.x, this.pos.z, p.x, p.z) < 2.1) { near = p; break; }
    }
    const boatD = dist2(this.pos.x, this.pos.z, BOAT.x, BOAT.z);
    if (near) {
      this.ui.prompt('E', near.type === 'ammo' ? '拾取弹药 (+30)' : '拾取急救包 (+40 生命)', () => {
        near.taken = true; near.mesh.visible = false; sfx.pickup();
        if (near.type === 'ammo') { this.reserve += 30; }
        else { this.hp = Math.min(CFG.HP_MAX, this.hp + 40); sfx.heal(); }
        this.ui.updateAmmo(this);
        this.ui.toast(near.type === 'ammo' ? '已拾取弹药' : '已使用急救包');
      });
    } else if (this.vehicles && (this._nearVeh = this.vehicles.find(v => !v.driver && v.near(this.pos.x, this.pos.z, 3.6)))) {
      const v = this._nearVeh;
      this.ui.prompt('E', '驾驶 · ' + v.name, () => {
        v.mount(this);
        sfx.uiclick();
      });
    } else if (boatD < 4.6) {      this.ui.prompt('E', '登上快艇 · 离开孤岛', () => {
        this.win = true;
        this.ui.onWin(this);
        sfx.win();
      });
    } else {
      this.ui.prompt(null);
    }
  }

  updateCam(dt) {
    // 纯第三人称：相机由 TPS 统一驱动，这里只推进武器计时器
    this.recoil = Math.max(0, this.recoil - dt * 0.09);
    this.kick = Math.max(0, this.kick - dt * 7);
    this.knifeAnim = Math.max(0, this.knifeAnim - dt * 3.2);
  }

  /** 枪灯 / 枪口火光跟随角色手中武器 */
  updateLights() {
    const t = this.tps;
    const wx = t && t.char ? t.char.weaponWorld() : null;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    if (wx) {
      this.muzzle.position.copy(wx);
      this.flash.position.set(wx.x - fx * 0.15, wx.y + 0.05, wx.z - fz * 0.15);
      this.flashTgt.position.set(wx.x + fx * 22, wx.y - 1.2, wx.z + fz * 22);
    } else {
      this.muzzle.position.set(this.pos.x, this.pos.y + 1.35, this.pos.z);
      this.flash.position.set(this.pos.x, this.pos.y + 1.4, this.pos.z);
      this.flashTgt.position.set(this.pos.x + fx * 22, this.pos.y + 0.6, this.pos.z + fz * 22);
    }
  }
}
