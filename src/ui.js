// UI：HUD / 罗盘 / 菜单 / 设置 / 触屏控件
import { BOAT, ZONES } from './config.js';
import { clamp, fmtTime } from './util.js';
import { sfx, setVolume } from './audio.js';

const $ = id => document.getElementById(id);

export class UI {
  // 时钟 / 天气
  updateAlmanac(env) {
    const now = performance.now();
    if (now - (this._almT || 0) < 350) return;
    this._almT = now;
    if (!this.alclock) {
      this.alclock = $('alclock'); this.alweather = $('alweather');
      this.alday = $('alday'); this.albox = $('almanac');
    }
    const h = env.t;
    const hh = String(Math.floor(h) % 24).padStart(2, '0');
    const mm = String(Math.floor((h % 1) * 60)).padStart(2, '0');
    this.alclock.textContent = hh + ':' + mm;
    const w = env.weather;
    const label = w === 'storm' ? '雷雨' : w === 'rain' ? '降雨' : w === 'cloudy' ? '阴' : '晴';
    this.alweather.textContent = label;
    this.alday.textContent = '第 ' + (Math.floor((window.__game && window.__game.playTime || 0) / env.dayLen) + 1) + ' 天';
    this.albox.classList.toggle('night', env.night > 0.55);
  }

  constructor(game) {
    this.game = game;
    this.hud = $('hud');
    this.tape = $('tape');
    this.tapeWrap = document.querySelector('.h-tape-wrap');
    this.toastsEl = $('toasts');
    this.promptCb = null;
    this.promptOn = false;
    this.dmgT = 0;
    this.lastHitT = 0;
    this.deepT = 0;
    this.zoneSeen = new Set();
    this.zoneTimer = 0;
    this.pendToast = [];

    this.buildTape();
    this.bindMenus();
    this.bindSettings();
    this.bindTouch();
    this.loadPrefs();

    // 罗盘标记缓存
    this.mark = $('objmark'); this.markDist = $('objdist');
  }

  // ---------- 罗盘刻度带 ----------
  buildTape() {
    const PXC = 2.2;              // 每度像素
    const W = 360 * PXC * 2;      // 两圈拼接保证环绕
    this.tape.style.width = W + 'px';
    this.pxc = PXC;
    const names = { 0: '北', 90: '东', 180: '南', 270: '西' };
    const fr = document.createDocumentFragment();
    for (let d = -180; d <= 540; d += 5) {
      const dd = ((d % 360) + 360) % 360;
      const x = (d + 180) * PXC;
      const i = document.createElement('i');
      if (dd % 90 === 0) { i.className = 't3'; i.style.left = x + 'px'; fr.appendChild(i);
        const b = document.createElement('b'); b.className = 'card'; b.style.left = x + 'px'; b.textContent = names[dd]; fr.appendChild(b);
      } else if (dd % 45 === 0) { i.className = 't2'; i.style.left = x + 'px'; fr.appendChild(i);
        const b = document.createElement('b'); b.style.left = x + 'px'; b.textContent = dd; fr.appendChild(b);
      } else { i.className = 't1'; i.style.left = x + 'px'; fr.appendChild(i); }
    }
    this.tape.appendChild(fr);
  }
  updateCompass(yaw, px, pz) {
    const heading = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    const wrapW = this.tapeWrap.clientWidth || 430;
    const shift = wrapW / 2 - (heading + 180) * this.pxc;
    this.tape.style.transform = `translateX(${shift}px)`;
    // 目标方位角（北=0 顺时针）
    const bearing = ((Math.atan2(BOAT.x - px, -(BOAT.z - pz)) * 180 / Math.PI) % 360 + 360) % 360;
    let rel = bearing - heading;
    while (rel > 180) rel -= 360; while (rel < -180) rel += 360;
    const clamped = clamp(rel, -78, 78);
    this.mark.style.transform = `translateX(${clamped * this.pxc}px)`;
    this.mark.style.opacity = Math.abs(rel) > 78 ? 0.4 : 1;
    const d = Math.hypot(BOAT.x - px, BOAT.z - pz);
    this.markDist.textContent = Math.round(d) + 'm';
  }

  // ---------- 菜单 ----------
  bindMenus() {
    const g = this.game;
    const show = (id) => {
      for (const m of document.querySelectorAll('.menu')) m.classList.remove('on');
      if (id) $(id).classList.add('on');
      document.body.classList.toggle('in-game', !id);
    };
    this.showMenu = show;
    $('btn-start').onclick = () => { sfx.uiclick(); g.start(); };
    $('btn-resume').onclick = () => { sfx.uiclick(); g.resume(); };
    $('btn-restart1').onclick = () => { sfx.uiclick(); g.restart(); };
    $('btn-restart2').onclick = () => { sfx.uiclick(); g.restart(); };
    $('btn-again').onclick = () => { sfx.uiclick(); g.restart(); };
    for (const b of ['btn-settings', 'btn-settings2']) {
      $(b).onclick = () => { sfx.uiclick(); $('panel').hidden = false; };
    }
    $('panel-close').onclick = () => { sfx.uiclick(); $('panel').hidden = true; };
  }

  bindSettings() {
    const sens = $('set-sens'), vol = $('set-vol');
    const save = () => {
      localStorage.setItem('isle-esc', JSON.stringify({
        sens: sens.value, vol: vol.value, q: this.quality, touch: this.touchMode,
      }));
    };
    sens.oninput = () => { $('out-sens').textContent = sens.value; this.game.sens = parseFloat(sens.value); save(); };
    vol.oninput = () => { $('out-vol').textContent = Math.round(vol.value * 100) + '%'; setVolume(parseFloat(vol.value)); save(); };
    for (const b of $('set-quality').querySelectorAll('button')) {
      b.onclick = () => {
        this.quality = parseInt(b.dataset.q);
        for (const x of $('set-quality').querySelectorAll('button')) x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
        this.game.applyQuality(this.quality);
        save();
      };
    }
    $('set-touch').onclick = () => {
      this.touchMode = !this.touchMode;
      $('set-touch').setAttribute('aria-pressed', this.touchMode ? 'true' : 'false');
      document.body.classList.toggle('is-touch', this.touchMode);
      save();
    };
    this.savePrefs = save;
  }
  loadPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem('isle-esc') || '{}'); } catch (e) { }
    const sens = $('set-sens'), vol = $('set-vol');
    if (p.sens) { sens.value = p.sens; }
    if (p.vol != null) vol.value = p.vol;
    this.quality = p.q != null ? p.q : 1;
    this.touchMode = !!p.touch || ('ontouchstart' in window && matchMedia('(pointer: coarse)').matches);
    $('out-sens').textContent = sens.value;
    $('out-vol').textContent = Math.round(vol.value * 100) + '%';
    this.game.sens = parseFloat(sens.value);
    setVolume(parseFloat(vol.value));
    document.body.classList.toggle('is-touch', this.touchMode);
    $('set-touch').setAttribute('aria-pressed', this.touchMode ? 'true' : 'false');
    for (const b of $('set-quality').querySelectorAll('button')) b.setAttribute('aria-pressed', parseInt(b.dataset.q) === this.quality ? 'true' : 'false');
    this.savePrefs && this.savePrefs();
  }

  // ---------- 触屏 ----------
  bindTouch() {
    const g = this.game;
    const stick = $('t-stick'), knob = stick.querySelector('i');
    let stickId = null, stickCX = 0, stickCY = 0;
    stick.addEventListener('pointerdown', e => {
      stickId = e.pointerId;
      const r = stick.getBoundingClientRect();
      stickCX = r.left + r.width / 2; stickCY = r.top + r.height / 2;
      stick.setPointerCapture(e.pointerId);
    });
    stick.addEventListener('pointermove', e => {
      if (e.pointerId !== stickId) return;
      let dx = (e.clientX - stickCX) / 46, dy = (e.clientY - stickCY) / 46;
      const L = Math.hypot(dx, dy); if (L > 1) { dx /= L; dy /= L; }
      knob.style.transform = `translate(${dx * 34}px,${dy * 34}px)`;
      g.player.touchMove.x = dx; g.player.touchMove.y = dy;
    });
    const stickEnd = e => {
      if (e.pointerId !== stickId) return;
      stickId = null; knob.style.transform = '';
      g.player.touchMove.x = 0; g.player.touchMove.y = 0;
    };
    stick.addEventListener('pointerup', stickEnd);
    stick.addEventListener('pointercancel', stickEnd);
    // 视角区
    const look = $('t-look');
    let lookId = null, lx = 0, ly = 0;
    look.addEventListener('pointerdown', e => { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; });
    look.addEventListener('pointermove', e => {
      if (e.pointerId !== lookId) return;
      g.lookDelta((e.clientX - lx) * 2.2, (e.clientY - ly) * 2.2);
      lx = e.clientX; ly = e.clientY;
    });
    const lookEnd = e => { if (e.pointerId === lookId) lookId = null; };
    look.addEventListener('pointerup', lookEnd);
    look.addEventListener('pointercancel', lookEnd);
    // 按钮
    for (const b of document.querySelectorAll('.t-btn')) {
      const k = b.dataset.k;
      if (k === 'fire') {
        b.addEventListener('pointerdown', e => { e.preventDefault(); g.player.touchFire = true; });
        b.addEventListener('pointerup', () => { g.player.touchFire = false; });
        b.addEventListener('pointercancel', () => { g.player.touchFire = false; });
      } else if (k === 'knife') {
        b.addEventListener('pointerdown', () => g.player.cycleWep());
      } else if (k === 'reload') {
        b.addEventListener('pointerdown', () => g.player.reload());
      } else if (k === 'jump') {
        b.addEventListener('pointerdown', () => { g.player.keys['Space'] = true; setTimeout(() => g.player.keys['Space'] = false, 120); });
      } else if (k === 'interact') {
        b.addEventListener('pointerdown', () => { if (this.promptCb) this.promptCb(); });
      }
    }
  }

  // ---------- HUD 更新 ----------
  updateVitals(p) {
    $('hpnum').textContent = Math.ceil(p.hp);
    $('hpbar').firstElementChild.style.width = (p.hp / CFG_HP) * 100 + '%';
    $('hpbar').classList.toggle('low', p.hp < 30);
    $('lowhp').classList.toggle('on', p.hp < 30 && !p.dead);
    $('stnum').textContent = Math.ceil(p.st);
    $('stbar').firstElementChild.style.width = p.st + '%';
    // 洞内提示
    const zone = p.uiZone;
    if (zone && zone.cave !== this.wasCave) {
      this.wasCave = zone.cave;
      if (zone.cave) this.toast('洞穴深处一片漆黑 · 按 F 开枪灯', true);
    }
  }
  updateAmmo(p) {
    const big = $('ammobig');
    const bare = p.wep !== 'rifle';   // 军刀 / 空手都不显示弹数
    big.firstChild.textContent = bare ? '—' : p.mag;
    $('ammores').textContent = bare ? '' : ' / ' + p.reserve;
    big.classList.toggle('empty', p.wep === 'rifle' && p.mag === 0);
    this.updateWep(p);
  }
  updateWep(p) {
    $('weplab').innerHTML = p.wep === 'rifle' ? '步枪 <em>RIFLE</em>'
      : p.wep === 'knife' ? '军刀 <em>KNIFE</em>' : '空手 <em>UNARMED</em>';
    if (p.wep === 'knife') $('ammohint').textContent = '近战 · 距离越近越好';
    else if (p.wep === 'none') $('ammohint').textContent = '空手 · 按 Q 取出武器';
    else $('ammohint').textContent = '';
  }
  hintEmpty(on) {
    $('ammohint').textContent = '子弹耗尽 · 按 Q 拔刀';
    $('ammohint').classList.toggle('on', on);
    if (on) setTimeout(() => $('ammohint').classList.remove('on'), 2200);
  }
  setPoison(on) { $('poisonlab').classList.toggle('on', on); }
  hitMark(kill) {
    const h = $('hitmark');
    h.classList.toggle('kill', kill);
    h.classList.remove('on'); void h.offsetWidth; h.classList.add('on');
  }
  onHurt(dmg, cause) {
    const f = $('dmgflash');
    f.classList.add('on');
    clearTimeout(this._dt);
    this._dt = setTimeout(() => f.classList.remove('on'), 180);
  }
  flashDmg() { this.onHurt(0, ''); }
  deepWarn() {
    const now = performance.now();
    if (now - this.deepT > 3000) { this.deepT = now; this.toast('深海暗流汹涌 · 无法继续前进', true); }
  }
  prompt(key, text, cb) {
    const el = $('prompt');
    if (!key) {
      if (this.promptOn) { el.classList.remove('on'); this.promptOn = false; this.promptCb = null; }
      return;
    }
    $('promptkey').textContent = key;
    $('prompttext').textContent = text;
    this.promptCb = cb;
    if (!this.promptOn) { el.classList.add('on'); this.promptOn = true; }
  }
  toast(text, warn = false) {
    const t = document.createElement('div');
    t.className = 'toast' + (warn ? ' warn' : '');
    t.textContent = text;
    this.toastsEl.appendChild(t);
    requestAnimationFrame(() => t.classList.add('on'));
    setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 350); }, 3200);
    while (this.toastsEl.children.length > 3) this.toastsEl.firstChild.remove();
  }
  locCard(name, sub) {
    $('locname').textContent = name;
    $('locsub').textContent = sub;
    const c = $('loccard');
    c.classList.add('on');
    clearTimeout(this._lc);
    this._lc = setTimeout(() => c.classList.remove('on'), 3800);
  }
  checkZones(x, z) {
    for (const z0 of ZONES) {
      if (this.zoneSeen.has(z0.name)) continue;
      if (x > z0.x0 && x < z0.x1 && z > z0.z0 && z < z0.z1) {
        this.zoneSeen.add(z0.name);
        this.locCard(z0.name, z0.sub);
        return;
      }
    }
  }

  // ---------- 结算 ----------
  statsHTML(p, time) {
    const acc = p.stats.shots ? Math.round(p.stats.hits / p.stats.shots * 100) : 0;
    return `
      <div><dt>逃生用时</dt><dd>${fmtTime(time)}</dd></div>
      <div><dt>击杀野兽</dt><dd>${p.beasts.kills}</dd></div>
      <div><dt>射击命中率</dt><dd>${acc}%</dd></div>
      <div><dt>剩余生命</dt><dd>${Math.ceil(p.hp)}</dd></div>
      <div><dt>剩余弹药</dt><dd>${p.mag} + ${p.reserve}</dd></div>`;
  }
  onWin(p) {
    const time = this.game.playTime;
    $('win-stats').innerHTML = this.statsHTML(p, time);
    const score = (p.hp >= 70 ? 2 : p.hp >= 35 ? 1 : 0) + (time < 420 ? 2 : time < 600 ? 1 : 0) + (p.beasts.kills >= 8 ? 1 : 0);
    $('rating').textContent = score >= 5 ? 'S' : score >= 3 ? 'A' : score >= 2 ? 'B' : 'C';
    this.game.setOver && this.game.setOver();
    this.showMenu('menu-complete');
    this.hud.classList.remove('on');
    document.exitPointerLock && document.exitPointerLock();
  }
  onDead(cause) {
    $('dead-cause').textContent = `死因：${cause}。密林吞没了你。`;
    const time = this.game.playTime;
    const p = this.game.player;
    $('dead-stats').innerHTML = this.statsHTML(p, time);
    this.game.setOver && this.game.setOver();
    this.showMenu('menu-dead');
    this.hud.classList.remove('on');
    document.exitPointerLock && document.exitPointerLock();
    sfx.lose();
  }
  showHUD() {
    this.hud.classList.add('on');
    this.showMenu(null);
  }
}
const CFG_HP = 100;
