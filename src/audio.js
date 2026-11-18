// 全部音效由 WebAudio 现场合成，无音频文件
let ctx = null, master = null, noiseBuf = null, ambNodes = null;
let enabled = true;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { enabled = false; return null; }
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 6;
  master.connect(comp).connect(ctx.destination);
  const len = Math.floor(ctx.sampleRate * 1.5);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}
export function resume() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); }
export function setVolume(v) { if (master) master.gain.value = v; }

function noise(dur, type, freq, q, gain, decay = 1) {
  const c = ensure(); if (!c || !enabled) return;
  const src = c.createBufferSource(); src.buffer = noiseBuf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); const t = c.currentTime;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur * decay);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}
function tone(type, f0, f1, dur, gain, delay = 0) {
  const c = ensure(); if (!c || !enabled) return;
  const o = c.createOscillator(); o.type = type;
  const g = c.createGain(); const t = c.currentTime + delay;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  rifle() {
    if (playBuf('rifle', 0.9, 0.92, 1.08)) return;  // 真枪声文件（连发随机变调）
    noise(0.11, 'bandpass', 1500, 1.1, 0.5); tone('square', 200, 70, 0.08, 0.12); noise(0.35, 'lowpass', 420, 0.6, 0.18, 1.4);
  },
  reload() { noise(0.05, 'bandpass', 2400, 2, 0.16); noise(0.06, 'bandpass', 1800, 2, 0.14); tone('square', 700, 500, 0.03, 0.05, 0.12); },
  dryfire() { tone('square', 900, 600, 0.04, 0.08); },
  knife() {
    if (playBuf('knife', 0.85, 0.9, 1.15)) return;  // 真挥刀声（随机变调）
    noise(0.16, 'bandpass', 3800, 1.4, 0.22, 0.7);
  },
  stab() { noise(0.12, 'lowpass', 900, 0.8, 0.34); tone('sine', 160, 60, 0.1, 0.1); },
  flesh() { noise(0.1, 'lowpass', 700, 0.9, 0.3); },
  hitmark() { tone('sine', 1300, 900, 0.05, 0.1); },
  // 怪物吼叫：同一真文件两种演绎——狼偏高变调（尖啸），变异体原调（低沉长吼）；缺文件回退合成
  growl() { if (playBuf('growl', 0.62, 1.12, 1.32)) return; tone('sawtooth', 110, 70, 0.7, 0.22); noise(0.5, 'lowpass', 300, 0.7, 0.16, 0.9); },
  roar() { if (playBuf('growl', 0.85, 0.9, 1.05)) return; tone('sawtooth', 90, 45, 1.0, 0.32); tone('sawtooth', 130, 60, 0.9, 0.18); noise(0.8, 'lowpass', 240, 0.6, 0.2, 1.2); },
  hiss() { noise(0.6, 'highpass', 2600, 0.8, 0.18, 1.1); tone('sawtooth', 200, 160, 0.5, 0.06); },
  skitter() { for (let i = 0; i < 5; i++) noise(0.05, 'bandpass', 2200 + Math.random() * 1600, 3, 0.1); },
  snap() { tone('square', 300, 90, 0.09, 0.2); noise(0.08, 'bandpass', 1100, 1.4, 0.22); },
  hurt() { tone('sine', 240, 120, 0.16, 0.2); noise(0.14, 'lowpass', 500, 0.8, 0.18); },
  heal() { tone('sine', 520, 780, 0.24, 0.1); tone('sine', 660, 990, 0.3, 0.08, 0.12); },
  pickup() { tone('square', 800, 1200, 0.07, 0.09); tone('square', 1200, 1600, 0.09, 0.07, 0.08); },
  splash() { noise(0.28, 'bandpass', 800, 0.8, 0.3, 1.3); },
  step(f) { // f: grass|water|swamp|wood|rock|sand
    if ((f === 'grass' || f === 'sand') && playBufStep()) return; // 真脚步文件组（森林踏叶）
    if (f === 'water') noise(0.14, 'bandpass', 900, 1.1, 0.14, 1.2);
    else if (f === 'swamp') noise(0.2, 'lowpass', 420, 0.8, 0.12, 1.4);
    else if (f === 'wood') tone('triangle', 180, 120, 0.06, 0.12);
    else if (f === 'rock') noise(0.07, 'highpass', 1800, 1.2, 0.09);
    else if (f === 'sand') noise(0.12, 'lowpass', 600, 0.7, 0.08, 1.3);
    else noise(0.09, 'lowpass', 800, 0.8, 0.09);
  },
  heartbeat() { tone('sine', 60, 45, 0.14, 0.3); tone('sine', 55, 40, 0.12, 0.24, 0.18); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone('sine', f, f, 0.4, 0.14, i * 0.16)); },
  lose() { [330, 262, 196, 131].forEach((f, i) => tone('sine', f, f * 0.92, 0.5, 0.16, i * 0.24)); },
  uiclick() { tone('square', 900, 700, 0.03, 0.05); },
  door() { noise(0.12, 'lowpass', 700, 0.8, 0.3); tone('sine', 140, 80, 0.1, 0.12); },
  ignition() { // 点火：两声嗒嗒 + 转速拉起
    tone('square', 300, 260, 0.06, 0.16); tone('square', 300, 250, 0.06, 0.14, 0.14);
    tone('sawtooth', 60, 95, 0.7, 0.2, 0.28);
  },
};

// —— 环境音（风/鸟/虫/洞窟低鸣），按所在区域切换 ——
export function startAmbient() {
  const c = ensure(); if (!c || ambNodes) return;
  const out = c.createGain(); out.gain.value = 0.5; out.connect(master);
  const nodes = { out };
  // 风：过滤噪声缓慢起伏
  const wind = c.createBufferSource(); wind.buffer = noiseBuf; wind.loop = true;
  const wf = c.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 320;
  const wg = c.createGain(); wg.gain.value = 0.05;
  const lfo = c.createOscillator(); lfo.frequency.value = 0.09;
  const lg = c.createGain(); lg.gain.value = 0.028;
  lfo.connect(lg).connect(wg.gain);
  wind.connect(wf).connect(wg).connect(out);
  wind.start(); lfo.start();
  // 虫鸣（夏季细颤）
  const ins = c.createOscillator(); ins.type = 'sine'; ins.frequency.value = 4200;
  const ig = c.createGain(); ig.gain.value = 0.0;
  const ilfo = c.createOscillator(); ilfo.frequency.value = 7.3;
  const ilg = c.createGain(); ilg.gain.value = 0.008;
  ilfo.connect(ilg).connect(ig.gain);
  ins.connect(ig).connect(out);
  ins.start(); ilfo.start();
  // 鸟鸣不再在这里随机点放：交由下方「野生动物音景」统一调度，
  // 带真实声源坐标、左右声像、距离衰减，并跟随昼夜 / 雨天 / 海岸 / 洞穴变化。
  // 洞窟低鸣（进入洞穴时启用）
  const cave = c.createOscillator(); cave.type = 'sine'; cave.frequency.value = 55;
  const cg = c.createGain(); cg.gain.value = 0;
  cave.connect(cg).connect(out);
  cave.start();
  nodes.caveGain = cg; nodes.insectGain = ig; nodes.windGain = wg;
  ambNodes = nodes;
}
export function setCaveAmbience(inCave) {
  if (!ambNodes) return;
  const t = ctx.currentTime;
  ambNodes.caveGain.gain.linearRampToValueAtTime(inCave ? 0.14 : 0, t + 1.2);
  ambNodes.insectGain.gain.value = inCave ? 0 : ambNodes.insectGain.gain.value;
}

// —— 水流环境音：assets/sfx_water_flow.mp3 ——
// 真录音循环（首尾等功率交叉淡化，接缝处不"咔"），音量与低通都由「离水面的距离」驱动：
// 站在水里最响、最亮（能听到细碎水花），离岸十几米只剩低沉的远处水声，再远静音。
let waterAmb = null, waterTarget = 0;

// 首尾交叉淡化：把尾巴 fade 秒叠到开头，循环到头接回起点时波形连续
function loopBuffer(c, buf, fadeSec = 1.5) {
  const fade = Math.min(Math.floor(fadeSec * c.sampleRate), Math.floor(buf.length / 4));
  const len = buf.length - fade;
  const out = c.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch), dst = out.getChannelData(ch);
    dst.set(src.subarray(0, len));
    for (let i = 0; i < fade; i++) {
      const w = (i / fade) * Math.PI / 2;      // 0→π/2 等功率
      dst[i] = src[i] * Math.sin(w) + src[len + i] * Math.cos(w);
    }
  }
  return out;
}

function startWaterAmbience() {
  const c = ensure(); if (!c || waterAmb) return;
  const buf = sfxBuffers.get('waterFlow');
  if (!buf) return;                            // 还没解码完，下次 setWaterNear 再试
  const src = c.createBufferSource(); src.buffer = loopBuffer(c, buf); src.loop = true;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
  const g = c.createGain(); g.gain.value = 0;
  src.connect(hp).connect(lp).connect(g).connect(master);
  src.start();
  waterAmb = { src, hp, lp, g, dur: +src.buffer.duration.toFixed(2) };
  console.log('[audio] 水流环境音已启动（' + waterAmb.dur + 's 无缝循环）');
}

// level: 0 = 远离水面，1 = 身处水中
export function setWaterNear(level) {
  const c = ensure(); if (!c || !enabled) return;
  waterTarget = Math.max(0, Math.min(1, level || 0));
  if (!waterAmb) { startWaterAmbience(); if (!waterAmb) return; }
  const t = c.currentTime, lv = waterTarget;
  waterAmb.g.gain.setTargetAtTime(lv * 0.42, t, 0.35);
  // 远处空气吸收高频：0→900Hz（闷），1→12kHz（清亮的水花声）
  waterAmb.lp.frequency.setTargetAtTime(900 * Math.pow(13.5, lv), t, 0.5);
}
export function waterAmbState() {
  if (!waterAmb) return { on: false, loaded: sfxBuffers.has('waterFlow') };
  return {
    on: true, target: +waterTarget.toFixed(3),
    gain: +waterAmb.g.gain.value.toFixed(3),
    cutoff: Math.round(waterAmb.lp.frequency.value),
    dur: waterAmb.dur, loaded: sfxBuffers.has('waterFlow'),
  };
}

// —— 雨声：过滤噪声，随雨量增减 ——
let rainNode = null;
export function setRain(level) {
  const c = ensure(); if (!c || !enabled) return;
  if (!rainNode) {
    const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 800; hp.Q.value = 0.5;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(hp).connect(lp).connect(g).connect(master);
    src.start();
    rainNode = { g, hp, lp };
  }
  const t = c.currentTime;
  const lv = Math.min(1, level || 0);
  rainNode.g.gain.linearRampToValueAtTime(lv * 0.26, t + 0.8);
  rainNode.hp.frequency.linearRampToValueAtTime(420 + lv * 1100, t + 1.0);
  rainNode.lp.frequency.linearRampToValueAtTime(4200 + lv * 3600, t + 1.0);
  if (ambNodes && ambNodes.windGain) {
    ambNodes.windGain.gain.linearRampToValueAtTime(0.05 + lv * 0.13, t + 1.2);
  }
}
// —— 雷声（延迟模拟距离） ——
export function thunder(delay = 0.5) {
  if (!enabled) return;
  setTimeout(() => {
    noise(2.6, 'lowpass', 110, 0.7, 0.42, 2.6);
    noise(0.5, 'lowpass', 620, 0.6, 0.22, 1.2);
    if (Math.random() < 0.6) noise(1.2, 'lowpass', 180, 0.6, 0.25, 2.0);
  }, Math.max(0, delay) * 1000);
}

// —— 文件音效：短音效（枪声等）优先用 assets/ 里的真文件，缺文件回退合成 ——
const sfxBuffers = new Map();   // key → AudioBuffer
export function loadSfxFile(file, key) {
  const c = ensure(); if (!c || sfxBuffers.has(key)) return;
  fetch(bgmUrl(file)).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(ab => c.decodeAudioData(ab))
    .then(buf => { sfxBuffers.set(key, buf); console.log('[audio] 音效文件已加载: ' + file); })
    .catch(() => console.log('[audio] 音效文件未找到，使用合成音: ' + file));
}
function playBuf(key, gain = 1, rateMin = 0.94, rateMax = 1.06) {
  const c = ensure(); if (!c || !enabled) return;
  const buf = sfxBuffers.get(key); if (!buf) return false;
  const src = c.createBufferSource(); src.buffer = buf;
  src.playbackRate.value = rateMin + Math.random() * (rateMax - rateMin); // 连发变调，不重样
  const g = c.createGain(); g.gain.value = gain;
  src.connect(g).connect(master); src.start();
  return true;
}
export function sfxState() {
  const o = {}; for (const k of sfxBuffers.keys()) o[k] = true;
  return o;
}

// 脚步组：随机挑一个单步、不连放同一个；草地/沙地用真文件，其余地表保留特色合成音
const STEP_KEYS = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6'];
let lastStep = -1;
function playBufStep() {
  const keys = STEP_KEYS.filter(k => sfxBuffers.has(k));
  if (!keys.length) return false;
  let i; do { i = (Math.random() * keys.length) | 0; } while (keys.length > 1 && i === lastStep);
  lastStep = i;
  return playBuf(keys[i], 0.75, 0.9, 1.12);   // 音量压低 + 变调，避免踏步像复读机
}

// —— BGM：探索低氛围层 + 遭遇战层，交叉淡入淡出 ——
// 探索层优先用真音乐文件 assets/bgm.ogg（循环），加载失败回退合成（drone+和弦垫+散音）；
// 战斗层始终为合成鼓点/刺弦，叠在音乐上。切战斗时音乐压低到 25%。
let bgm = null;
function bgmUrl(file) {
  const inline = globalThis.__AUDIO_DATA__;   // --single 模式注入 { 'bgm.ogg': dataURI, ... }
  if (inline && inline[file]) return inline[file];
  const base = (typeof document !== 'undefined' && document.baseURI) || 'http://localhost/';
  return new URL('assets/' + file, base).href;
}
const CHORDS = [ // A2-C3-E3 / F2-A2-C3 / D2-F2-A2 / E2-G2-B2（低音区 Am→F→Dm→Em）
  [110.0, 130.81, 164.81], [87.31, 110.0, 130.81], [73.42, 87.31, 110.0], [82.41, 98.0, 123.47],
];
const MELODY = [220.0, 261.63, 293.66, 329.63, 392.0]; // A3 C4 D4 E4 G4 五声
export function startBGM() {
  const c = ensure(); if (!c || bgm) return;
  loadSfxFile('sfx_rifle.ogg', 'rifle');   // 顺路把文件音效也装上
  loadSfxFile('sfx_knife.ogg', 'knife');
  for (let i = 1; i <= 6; i++) loadSfxFile('sfx_step' + i + '.ogg', 'step' + i);
  loadSfxFile('sfx_engine.ogg', 'ignition');
  loadSfxFile('sfx_engine_loop.ogg', 'engine');
  loadSfxFile('sfx_engine_idle.ogg', 'engineIdle');
  loadSfxFile('sfx_growl.ogg', 'growl');
  loadSfxFile('sfx_water_flow.mp3', 'waterFlow');   // 水流环境音（循环，见 setWaterNear）
  const out = c.createGain(); out.gain.value = 0; out.connect(master);
  out.gain.linearRampToValueAtTime(0.55, c.currentTime + 3.0);
  const gExp = c.createGain(); gExp.gain.value = 1; gExp.connect(out);
  const gCbt = c.createGain(); gCbt.gain.value = 0; gCbt.connect(out);
  const gSynth = c.createGain(); gSynth.gain.value = 1; gSynth.connect(gExp); // 合成探索层总闸：真音乐加载后归零
  const gCbtSynth = c.createGain(); gCbtSynth.gain.value = 1; gCbtSynth.connect(gCbt); // 合成战斗层总闸：真战斗曲加载后归零

  // 尝试加载真音乐文件（探索层 + 战斗层）
  const loadTrack = async (file, dest, onOk) => {
    try {
      const r = await fetch(bgmUrl(file));
      if (!r.ok) throw new Error(r.status);
      const ab = await c.decodeAudioData(await r.arrayBuffer());
      if (!bgm || bgm.dead) return;
      const src = c.createBufferSource(); src.buffer = ab; src.loop = true;
      const g = c.createGain(); g.gain.value = 0.85;
      src.connect(g).connect(dest); src.start();
      onOk(ab);
      console.log('[audio] BGM 文件已加载循环播放: ' + file + ' (' + Math.round(ab.duration) + 's)');
    } catch (e) {
      console.log('[audio] BGM 文件未找到，该层使用合成乐: ' + file);
    }
  };
  loadTrack('bgm.ogg', gExp, () => {
    bgm.fileLoaded = true;
    gSynth.gain.linearRampToValueAtTime(0, c.currentTime + 2.0); // 合成氛围淡出让位
  });
  loadTrack('bgm_combat.ogg', gCbt, () => {
    bgm.cbtFileLoaded = true;
    gCbtSynth.gain.linearRampToValueAtTime(0, c.currentTime + 0.5); // 合成战斗层让位
  });

  // 探索层：低音 drone（A1 + E2），低通缓慢开合
  const dLp = c.createBiquadFilter(); dLp.type = 'lowpass'; dLp.frequency.value = 260; dLp.connect(gSynth);
  const mkDrone = (freq, type, vol) => {
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain(); g.gain.value = vol;
    o.connect(g).connect(dLp); o.start(); return g;
  };
  mkDrone(55, 'triangle', 0.055); mkDrone(82.41, 'sine', 0.03);
  const dLfo = c.createOscillator(); dLfo.frequency.value = 0.05;
  const dLfoG = c.createGain(); dLfoG.gain.value = 90;
  dLfo.connect(dLfoG).connect(dLp.frequency); dLfo.start();

  // 战斗层：小二度不和谐持续音（110 / 116.54Hz 锯齿）——真战斗曲加载后经 gCbtSynth 静音
  const cLp = c.createBiquadFilter(); cLp.type = 'lowpass'; cLp.frequency.value = 700; cLp.connect(gCbtSynth);
  const mkTension = (freq, vol) => {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const g = c.createGain(); g.gain.value = vol;
    o.connect(g).connect(cLp); o.start();
  };
  mkTension(110, 0.045); mkTension(116.54, 0.04);

  // 前瞻调度器：和弦每 8s，鼓点 130BPM（0.4615s/拍）
  const BEAT = 60 / 130;
  let chordI = Math.floor(Math.random() * 4);
  let nextChord = c.currentTime + 1.2;
  let nextBeat = c.currentTime + 0.2;
  let beatN = 0;
  const scheduleChord = (t) => {
    const ch = CHORDS[chordI % 4]; chordI++;
    for (const f of ch) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.045, t + 2.6);
      g.gain.setValueAtTime(0.045, t + 5.4);
      g.gain.linearRampToValueAtTime(0.0001, t + 8.2);
      o.connect(g).connect(gSynth); o.start(t); o.stop(t + 8.4);
    }
    // 五成机会缀一个散音
    if (Math.random() < 0.55) {
      const f = MELODY[Math.floor(Math.random() * MELODY.length)];
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = c.createGain(); const d = 2.4 + Math.random() * 1.8;
      g.gain.setValueAtTime(0.0001, t + 1.5 + Math.random() * 2);
      g.gain.linearRampToValueAtTime(0.05, t + 1.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7 + d);
      o.connect(g).connect(gSynth); o.start(t); o.stop(t + 1.8 + d);
    }
  };
  const scheduleBeat = (t, n) => {
    if (!bgm || !bgm.combat) return;   // 非战斗不排鼓点
    // 低频鼓：每拍，强拍每 4 拍加重
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.22);
    const g = c.createGain();
    g.gain.setValueAtTime(n % 4 === 0 ? 0.5 : 0.34, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(g).connect(gCbtSynth); o.start(t); o.stop(t + 0.3);
    // 战鼓：每 2 拍反拍补一记闷鼓
    if (n % 2 === 1) {
      const s = c.createBufferSource(); s.buffer = noiseBuf;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 190; f.Q.value = 1;
      const ng = c.createGain(); ng.gain.setValueAtTime(0.16, t + BEAT / 2);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + BEAT / 2 + 0.14);
      s.connect(f).connect(ng).connect(gCbtSynth); s.start(t + BEAT / 2, Math.random() * 0.5); s.stop(t + BEAT / 2 + 0.2);
    }
    // 刺弦：每 8 拍一声不和谐短和弦
    if (n % 8 === 0) {
      for (const f of [146.83, 155.56]) {
        const so = c.createOscillator(); so.type = 'sawtooth'; so.frequency.value = f;
        const sg = c.createGain(); sg.gain.setValueAtTime(0.07, t);
        sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        so.connect(sg).connect(gCbtSynth); so.start(t); so.stop(t + 0.55);
      }
    }
  };
  bgm = { out, gExp, gCbt, combat: false, timer: setInterval(() => {
    if (!ctx || ctx.state !== 'running') return;
    const ahead = ctx.currentTime + 0.45;
    while (nextChord < ahead) { if (!bgm.fileLoaded) scheduleChord(nextChord); nextChord += 8; }
    while (nextBeat < ahead) { if (!bgm.cbtFileLoaded) scheduleBeat(nextBeat, beatN++); nextBeat += BEAT; }
  }, 140) };
}
export function setCombat(on) {
  if (!bgm || !ctx) return;
  if (bgm.combat === on) return;
  bgm.combat = on;
  const t = ctx.currentTime;
  if (on) {
    // 转场提示：闷鼓 + 低音上滑
    tone('sine', 55, 110, 0.5, 0.3); noise(0.7, 'lowpass', 220, 0.7, 0.24, 1.6);
    bgm.gCbt.gain.cancelScheduledValues(t);
    bgm.gCbt.gain.setValueAtTime(bgm.gCbt.gain.value, t);
    bgm.gCbt.gain.linearRampToValueAtTime(1, t + 1.2);
    bgm.gExp.gain.linearRampToValueAtTime(0.25, t + 1.2);
  } else {
    bgm.gCbt.gain.cancelScheduledValues(t);
    bgm.gCbt.gain.setValueAtTime(bgm.gCbt.gain.value, t);
    bgm.gCbt.gain.linearRampToValueAtTime(0, t + 2.8);
    bgm.gExp.gain.linearRampToValueAtTime(1, t + 2.8);
  }
}
export function bgmState() {
  if (!bgm || !ctx) return null;
  return { combat: bgm.combat, exp: +bgm.gExp.gain.value.toFixed(3), cbt: +bgm.gCbt.gain.value.toFixed(3), file: !!bgm.fileLoaded, cbtFile: !!bgm.cbtFileLoaded, running: ctx.state === 'running' };
}

// —— 载具引擎：持续发声，随车速变调变响 ——
// 点火：真文件（启动马达→拉起→怠速）优先；onIdle 在文件接近尾段时回调，
// 由 vehicle.js 在回调里 engineStart()，让合成怠速与文件尾段交叉衔接；缺文件回退合成点火
export function ignitionStart(onIdle) {
  const buf = sfxBuffers.get('ignition');
  if (ctx && buf) {
    playBuf('ignition', 0.9, 0.97, 1.03);
    const wait = Math.max(300, (buf.duration - 1.2) * 1000);
    setTimeout(() => { try { onIdle && onIdle(); } catch (e) {} }, wait);
  } else {
    sfx.ignition();
    setTimeout(() => { try { onIdle && onIdle(); } catch (e) {} }, 260);
  }
}

let engNodes = null;
export function engineStart() {
  const c = ensure(); if (!c || engNodes) return;
  const out = c.createGain(); out.gain.value = 0; out.connect(master);
  // 双文件轨：怠速循环（停车）+ 行驶循环（开车），常开靠 gain 交叉；缺文件回退合成
  const idleBuf = sfxBuffers.get('engineIdle'), driveBuf = sfxBuffers.get('engine');
  const nodes = { out };
  if (idleBuf && driveBuf) {
    nodes.fileMode = true;
    // 怠速轨
    const is = c.createBufferSource(); is.buffer = idleBuf; is.loop = true;
    is.playbackRate.value = 1.0;
    const ig = c.createGain(); ig.gain.value = 1;
    is.connect(ig).connect(out); is.start();
    // 行驶轨
    const ds = c.createBufferSource(); ds.buffer = driveBuf; ds.loop = true;
    ds.playbackRate.value = 0.95;
    const dg = c.createGain(); dg.gain.value = 0;
    ds.connect(dg).connect(out); ds.start();
    Object.assign(nodes, { is, ig, ds, dg });
  } else {
    nodes.fileMode = false;
    // 低频引擎嗡鸣（基频 + 二次谐波）
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 42;
    const o1g = c.createGain(); o1g.gain.value = 0.5;
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = 84;
    const o2g = c.createGain(); o2g.gain.value = 0.16;
    // 排气/胎噪
    const n = c.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 480;
    const ng = c.createGain(); ng.gain.value = 0.22;
    o1.connect(o1g).connect(out);
    o2.connect(o2g).connect(out);
    n.connect(nf).connect(ng).connect(out);
    o1.start(); o2.start(); n.start();
    Object.assign(nodes, { o1, o2, nf, ng });
  }
  engNodes = nodes;
  // 怠速渐入
  out.gain.linearRampToValueAtTime(nodes.fileMode ? 0.4 : 0.3, c.currentTime + 0.5);
}
export function engineUpdate(speedNorm) {
  if (!engNodes || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const v = Math.max(0, Math.min(1, speedNorm || 0));
  if (engNodes.fileMode) {
    // 双轨交叉：v 0→0.12 从怠速渐变到行驶轨；行驶轨速率 0.95→1.45 随车速
    const m = Math.min(1, v / 0.12);            // 0=怠速 1=行驶
    const ease = m * m * (3 - 2 * m);           // smoothstep
    engNodes.ig.gain.setTargetAtTime(1 - ease, t, 0.12);
    engNodes.dg.gain.setTargetAtTime(ease, t, 0.12);
    engNodes.ds.playbackRate.setTargetAtTime(0.95 + v * 0.5, t, 0.1);
    engNodes.out.gain.setTargetAtTime(0.4 + v * 0.1, t, 0.15);
    return;
  }
  engNodes.o1.frequency.setTargetAtTime(42 + v * 92, t, 0.08);
  engNodes.o2.frequency.setTargetAtTime(84 + v * 190, t, 0.08);
  engNodes.ng.gain.setTargetAtTime(0.22 + v * 0.3, t, 0.12);
  engNodes.nf.frequency.setTargetAtTime(480 + v * 900, t, 0.12);
  engNodes.out.gain.setTargetAtTime(0.3 + v * 0.14, t, 0.15);
}
export function engineStop() {
  if (!engNodes || !ctx) { engNodes = null; return; }
  const nodes = engNodes; engNodes = null;
  const t = ctx.currentTime;
  nodes.out.gain.setTargetAtTime(0, t, 0.18);
  setTimeout(() => {
    try {
      if (nodes.is) { nodes.is.stop(); nodes.ds.stop(); }
      else { nodes.o1.stop(); nodes.o2.stop(); nodes.n.stop(); }
    } catch (e) {}
  }, 800);
}
export function engineState() {
  if (!engNodes || !ctx) return { on: false };
  if (engNodes.fileMode) {
    const idle = engNodes.ig.gain.value, drive = engNodes.dg.gain.value;
    return {
      on: true, file: true,
      mode: drive > idle ? 'drive' : 'idle',
      idleGain: +idle.toFixed(3), driveGain: +drive.toFixed(3),
      rate: +engNodes.ds.playbackRate.value.toFixed(3),
      gain: +engNodes.out.gain.value.toFixed(3),
    };
  }
  return { on: true, file: false, gain: +engNodes.out.gain.value.toFixed(3) };
}

// ================= 野生动物音景 =================
// 与 wildlife.js 的可见动物联动：每声都从画面里真实的鸟 / 远处地面点取声源坐标，
// 按「玩家位置 + 相机右向量」算声像与距离衰减，再按昼夜 / 雨天 / 海岸 / 洞穴挑物种。
// 全部 WebAudio 现场合成；远处兽吼复用已加载的 sfx_growl.ogg（低通 + 降速），
// 因此不引入任何新资源请求，缺文件时也有完整合成兜底。
const wildCtx = {
  night: 0, rain: 0, cave: false, shore: 0,
  px: 0, pz: 0, right: [1, 0], listening: false,
};
const wildStat = { calls: 0, birds: 0, roars: 0, last: '', lastDist: 0 };
let wildTimer = null, wildGetPoint = null;
const wc = (v, a, b) => v < a ? a : v > b ? b : v;

/** 主循环定期同步：昼夜、雨量、洞穴、离海程度、玩家坐标与相机右向量 */
export function setWildlifeContext(c) { Object.assign(wildCtx, c); }

/** getPoint(kind): 'bird' | 'roar' | 'hiss' → {x,y,z}，由 wildlife.js 提供真实动物坐标 */
export function startWildlifeAudio(getPoint) {
  const c = ensure(); if (!c || wildTimer) return;
  wildGetPoint = getPoint || null;
  wildTimer = setInterval(wildTick, 850);
}

// 空间化输出链：距离衰减 + 左右声像 + 远处空气吸收（低通）
function wSpatial(pos) {
  const c = ensure(); if (!c || !enabled) return null;
  const dx = pos.x - wildCtx.px, dz = pos.z - wildCtx.pz;
  const d = Math.max(2, Math.hypot(dx, dz));
  const pan = wc((dx * wildCtx.right[0] + dz * wildCtx.right[1]) / d, -1, 1) * 0.9;
  const gain = wc(1 - d / 150, 0.045, 1) * (pos.y > 14 ? 0.72 : 1);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.value = 12000 - Math.min(9800, d * 78);
  lp.Q.value = 0.4;
  const g = c.createGain(); g.gain.value = gain;
  let tail = g;
  if (c.createStereoPanner) {
    const p = c.createStereoPanner(); p.pan.value = pan;
    g.connect(p); tail = p;
  }
  tail.connect(lp).connect(master);
  return { c, dst: g, gain, d, pan };
}
function wTone(dst, type, f0, f1, dur, gain, delay = 0, attack = 0.012) {
  const c = ensure(); if (!c) return;
  const o = c.createOscillator(); o.type = type;
  const g = c.createGain(); const t = c.currentTime + delay;
  o.frequency.setValueAtTime(Math.max(30, f0), t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dst); o.start(t); o.stop(t + dur + 0.02);
}
function wNoise(dst, dur, type, freq, q, gain, delay = 0) {
  const c = ensure(); if (!c) return;
  const src = c.createBufferSource(); src.buffer = noiseBuf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); const t = c.currentTime + delay;
  g.gain.setValueAtTime(Math.max(0.0002, gain), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(dst);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
}
function wBuf(key, dst, gain, rate, cutoff) {
  const c = ensure(); const buf = sfxBuffers.get(key);
  if (!c || !buf) return false;
  const src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.7;
  const g = c.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(dst); src.start();
  return true;
}

// 各物种叫声明细：都是短促的调频音 + 共振峰噪声，参数每次随机，不会听成复读机
function wCall(kind, dst, gain) {
  const G = gain;
  switch (kind) {
    case 'chirp': {          // 林鸟：两声短促上滑啁啾，偶尔补第三声
      const f = 2100 + Math.random() * 1500;
      wTone(dst, 'sine', f, f * 1.48, 0.085, G * 0.13);
      wTone(dst, 'sine', f * 1.22, f * 0.84, 0.10, G * 0.095, 0.13);
      if (Math.random() < 0.5) wTone(dst, 'sine', f * 1.08, f * 1.52, 0.07, G * 0.08, 0.27);
      break;
    }
    case 'trill': {          // 颤音：一串极短音符
      const b = 2400 + Math.random() * 900, n = 5 + ((Math.random() * 4) | 0);
      for (let i = 0; i < n; i++) {
        wTone(dst, 'sine', b * (0.92 + Math.random() * 0.2), b * (1.05 + Math.random() * 0.25),
          0.045, G * 0.072, i * 0.062, 0.008);
      }
      break;
    }
    case 'whistle': {        // 哨音：悠长下滑
      const f = 1900 + Math.random() * 700;
      wTone(dst, 'sine', f, f * 0.62, 0.32, G * 0.10, 0, 0.025);
      wTone(dst, 'triangle', f * 2, f * 1.3, 0.26, G * 0.02, 0.02);
      break;
    }
    case 'caw': {            // 乌鸦：粗哑的锯齿 + 共振峰噪声
      const f = 560 + Math.random() * 180;
      wTone(dst, 'sawtooth', f, f * 0.72, 0.20, G * 0.070);
      wTone(dst, 'square', f * 1.5, f * 1.1, 0.16, G * 0.020, 0.02);
      wNoise(dst, 0.18, 'bandpass', 1100, 3, G * 0.045, 0.02);
      break;
    }
    case 'gull': {           // 海鸥 / 水鸟：三段尖叫
      const f = 1000 + Math.random() * 300;
      wTone(dst, 'sine', f, f * 1.6, 0.16, G * 0.095);
      wTone(dst, 'sine', f * 1.55, f * 0.85, 0.30, G * 0.085, 0.16);
      wTone(dst, 'sine', f * 1.30, f * 0.75, 0.22, G * 0.060, 0.42);
      break;
    }
    case 'raptor': {         // 猛禽：高亢尖啸
      const f = 2700 + Math.random() * 700;
      wTone(dst, 'sine', f, f * 0.55, 0.55, G * 0.10, 0, 0.03);
      wNoise(dst, 0.50, 'bandpass', 2200, 2.5, G * 0.028, 0.02);
      break;
    }
    case 'hoot': {           // 夜鸟 / 猫头鹰：低沉双音
      const f = 380 + Math.random() * 90;
      wTone(dst, 'sine', f, f * 0.88, 0.30, G * 0.13, 0, 0.04);
      wTone(dst, 'sine', f * 0.96, f * 0.82, 0.34, G * 0.11, 0.42, 0.04);
      break;
    }
    case 'hiss': {           // 爬行类：草叶间的嘶声
      wNoise(dst, 0.55, 'highpass', 2600, 0.8, G * 0.050);
      wNoise(dst, 0.35, 'bandpass', 4200, 1.4, G * 0.028, 0.10);
      break;
    }
    case 'roar': {           // 远处兽吼：真吼叫文件低通降速 + 低频层 + 山谷回声
      wBuf('growl', dst, G * 0.60, 0.58 + Math.random() * 0.16, 420);
      wTone(dst, 'sawtooth', 78, 42, 1.25, G * 0.095, 0, 0.09);
      wTone(dst, 'sine', 55, 38, 1.50, G * 0.075, 0.06, 0.10);
      wNoise(dst, 1.00, 'lowpass', 260, 0.7, G * 0.050, 0.05);
      wTone(dst, 'sawtooth', 62, 40, 0.90, G * 0.030, 0.75, 0.08);  // 回声
      break;
    }
    default: {
      const f = 2000 + Math.random() * 900;
      wTone(dst, 'sine', f, f * 1.3, 0.12, G * 0.10);
    }
  }
}

function pickBird(day, rain) {
  const night = 1 - day, shore = wc(wildCtx.shore, 0, 1), damp = 1 - rain * 0.7;
  const T = [
    ['chirp', 32 * day * damp], ['trill', 22 * day * damp], ['whistle', 12 * day * damp],
    ['caw', 8 * day * damp], ['raptor', 3 * day * damp],
    ['gull', (5 + 26 * shore) * day * damp],
    ['hoot', 20 * night], ['hiss', 5 + 5 * night],
  ];
  let sum = 0; for (const t of T) sum += t[1];
  let r = Math.random() * sum;
  for (const t of T) { r -= t[1]; if (r <= 0) return t[0]; }
  return 'chirp';
}

function emitWild(kind, forced = false) {
  if (!forced) {
    // 昼夜切换瞬间，延迟触发的「对唱」可能还带着旧时段的物种（夜里冒出一声海鸥很穿帮），
    // 发声前按当前环境再校正一次。debugWildlifeCall 用 forced=true 保留任意物种调试能力。
    const day = 1 - wc(wildCtx.night, 0, 1);
    if (day < 0.30 && /^(chirp|trill|whistle|caw|gull|raptor)$/.test(kind)) {
      kind = Math.random() < 0.72 ? 'hoot' : 'hiss';
    } else if (day > 0.70 && kind === 'hoot') kind = 'trill';
  }
  const src = wildGetPoint && wildGetPoint(kind === 'roar' ? 'roar' : (kind === 'hiss' ? 'hiss' : 'bird'));
  const pos = src || {
    x: wildCtx.px + (Math.random() - 0.5) * 50, y: 6 + Math.random() * 14,
    z: wildCtx.pz + (Math.random() - 0.5) * 50,
  };
  const s = wSpatial(pos); if (!s) return;
  wCall(kind, s.dst, s.gain);
  wildStat.calls++;
  if (kind === 'roar') wildStat.roars++; else wildStat.birds++;
  wildStat.last = kind; wildStat.lastDist = Math.round(s.d * 10) / 10;
}

function wildTick() {
  if (!ctx || ctx.state !== 'running' || !wildCtx.listening) return;
  const day = 1 - wc(wildCtx.night, 0, 1);
  const rain = wc(wildCtx.rain, 0, 1);
  const cave = wildCtx.cave;
  // 洞穴隔绝外界：几乎只剩偶尔一声极闷的远吼
  const roarP = cave ? 0.006 : (0.012 + (1 - day) * 0.022 + rain * 0.012);
  let kind = null;
  if (Math.random() < roarP) kind = 'roar';
  else if (!cave && Math.random() < 0.66 * (0.32 + day * 0.78) * (1 - rain * 0.72)) {
    kind = pickBird(day, rain);
  }
  if (!kind) return;
  emitWild(kind);
  // 林中「对唱」：另一处声源隔一小会儿应答
  if (kind !== 'roar' && Math.random() < 0.34) {
    setTimeout(() => {
      if (ctx && ctx.state === 'running') emitWild(Math.random() < 0.5 ? kind : pickBird(day, rain));
    }, 220 + Math.random() * 380);
  }
}

/** QA / 调试：绕过自动调度强制发一声，验证合成与空间化链路 */
export function debugWildlifeCall(kind = 'chirp') {
  emitWild(kind, true);
  return wildlifeAudioState();
}
export function wildlifeAudioState() {
  return {
    on: !!wildTimer, running: ctx ? ctx.state : 'none',
    calls: wildStat.calls, birds: wildStat.birds, roars: wildStat.roars,
    last: wildStat.last, lastDist: wildStat.lastDist,
    ctx: {
      night: +wc(wildCtx.night, 0, 1).toFixed(2), rain: +wc(wildCtx.rain, 0, 1).toFixed(2),
      cave: !!wildCtx.cave, shore: +wc(wildCtx.shore, 0, 1).toFixed(2),
      listening: !!wildCtx.listening,
    },
    growlFile: sfxBuffers.has('growl'),
  };
}
