// 背包：拾取的补给先入包，不立即生效；玩家用快捷键 / 面板点击再使用。
// 与 Player 解耦：只操作传入的 player（hp / reserve），通过 ui.toast 反馈。
import { CFG } from './config.js';
import { sfx } from './audio.js';

export const ITEMS = {
  medkit: { label: '急救包', desc: '恢复 40 生命', max: 9, key: '4', heal: 40 },
  ammo:   { label: '弹药包', desc: '备用弹药 +30', max: 9, key: '5', ammo: 30 },
};

export class Inventory {
  constructor() {
    this.items = { medkit: 0, ammo: 0 };
  }

  count(type) { return this.items[type] || 0; }

  // 拾取入包：返回 true 表示成功（满了返回 false，地上那件不消失）
  add(type) {
    const it = ITEMS[type];
    if (!it || this.count(type) >= it.max) return false;
    this.items[type]++;
    return true;
  }

  snapshot() {
    return {
      medkit: this.count('medkit'), ammo: this.count('ammo'),
      capacities: { medkit: ITEMS.medkit.max, ammo: ITEMS.ammo.max },
    };
  }

  // 使用：返回 { ok, msg }，调用方负责 toast / 刷新 HUD
  use(type, player) {
    const it = ITEMS[type];
    if (!it) return { ok: false, msg: '无效物品' };
    if (this.count(type) <= 0) return { ok: false, msg: '背包里没有' + it.label };
    if (type === 'medkit') {
      if (player.hp >= CFG.HP_MAX) return { ok: false, msg: '生命已满 · 急救包留在包里' };
      this.items.medkit--;
      player.hp = Math.min(CFG.HP_MAX, player.hp + it.heal);
      player.poisonT = 0;              // 急救包顺带解毒（和篝火一致的设定）
      sfx.heal();
      return { ok: true, msg: '使用急救包 · 生命恢复至 ' + Math.ceil(player.hp) };
    }
    // ammo：备用弹药无硬上限，随时可用
    this.items.ammo--;
    player.reserve = (player.reserve || 0) + it.ammo;
    sfx.pickup();
    return { ok: true, msg: '使用弹药包 · 备用弹药 +' + it.ammo };
  }
}

// 全局单例（与 game / player 生命周期一致，restart 走 location.reload 自然归零）
export const inventory = new Inventory();
