// 任务系统：把原本静态的"任务目标"HUD 变成有阶段、有反馈的主线推进。
// 三个阶段：抵达木屋补给 → 清剿洞穴僵尸 → 登船逃生。
// 只通过 UI.toast / UI.setObjective 与现有系统交互，不改玩家/战斗逻辑。
import { CABIN, BOAT } from './config.js';

const STAGES = [
  {
    title: '搜寻林中木屋',
    desc: '前往<span style="color:var(--amber)">林中木屋</span>，补充弹药与急救物资',
    hint: '木屋在营地西北方向，罗盘有标记',
  },
  {
    title: '清剿山腹洞穴',
    desc: '穿过索桥，消灭洞窟中的<span style="color:var(--amber)">僵尸</span>',
    hint: '洞穴沿小径向北，枪声会引来更多野兽',
  },
  {
    title: '登上渔船离岛',
    desc: '抵达北岸，登上<span style="color:var(--amber)">渔船</span>逃离孤岛',
    hint: '一路向北，罗盘上的"船"就是出口',
  },
];

export class Quests {
  constructor(ui, beasts) {
    this.ui = ui;
    this.beasts = beasts;
    this.stage = 0;
    this.killTarget = 6;
    this.cabinDone = false;
    this.caveKills0 = 0;
    this.started = false;
    this._lastKills = 0;
    this._fireT = 0;
    this.apply();
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.ui.toast('任务更新：搜寻林中木屋');
    this.apply();
  }

  apply() {
    const s = STAGES[Math.min(this.stage, STAGES.length - 1)];
    let desc = s.desc;
    if (this.stage === 1) desc = `穿过索桥，消灭洞窟僵尸 <b>${Math.min(this.caveKills(), this.killTarget)}/${this.killTarget}</b>`;
    this.ui.setObjective(s.title, desc);
  }

  caveKills() { return Math.max(0, (this.beasts ? this.beasts.kills : 0) - this.caveKills0); }

  update(dt, player) {
    if (!this.started || !player || player.dead || player.win) return;
    this._fireT += dt;

    // 阶段 1：靠近木屋（含门廊）即完成
    if (this.stage === 0) {
      const d = Math.hypot(player.pos.x - CABIN.x, player.pos.z - CABIN.z);
      if (d < 12) {
        this.stage = 1;
        this.caveKills0 = this.beasts ? this.beasts.kills : 0;
        this.ui.toast('已抵达木屋 · 新目标：清剿山腹洞穴');
        this.apply();
      }
      return;
    }

    // 阶段 2：击杀洞穴僵尸达标
    if (this.stage === 1) {
      const k = this.caveKills();
      if (k !== this._lastKills) { this._lastKills = k; this.apply(); }
      if (k >= this.killTarget) {
        this.stage = 2;
        this.ui.toast('洞穴已肃清 · 最后目标：登船离岛');
        this.apply();
      }
    }
  }

  onWin() {
    if (this.stage >= 2) this.ui.toast('任务完成：成功逃离孤岛');
  }
}
