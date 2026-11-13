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
  rifle() { noise(0.11, 'bandpass', 1500, 1.1, 0.5); tone('square', 200, 70, 0.08, 0.12); noise(0.35, 'lowpass', 420, 0.6, 0.18, 1.4); },
  reload() { noise(0.05, 'bandpass', 2400, 2, 0.16); noise(0.06, 'bandpass', 1800, 2, 0.14); tone('square', 700, 500, 0.03, 0.05, 0.12); },
  dryfire() { tone('square', 900, 600, 0.04, 0.08); },
  knife() { noise(0.16, 'bandpass', 3800, 1.4, 0.22, 0.7); },
  stab() { noise(0.12, 'lowpass', 900, 0.8, 0.34); tone('sine', 160, 60, 0.1, 0.1); },
  flesh() { noise(0.1, 'lowpass', 700, 0.9, 0.3); },
  hitmark() { tone('sine', 1300, 900, 0.05, 0.1); },
  growl(x) { tone('sawtooth', 110, 70, 0.7, 0.22); noise(0.5, 'lowpass', 300, 0.7, 0.16, 0.9); },
  roar() { tone('sawtooth', 90, 45, 1.0, 0.32); tone('sawtooth', 130, 60, 0.9, 0.18); noise(0.8, 'lowpass', 240, 0.6, 0.2, 1.2); },
  hiss() { noise(0.6, 'highpass', 2600, 0.8, 0.18, 1.1); tone('sawtooth', 200, 160, 0.5, 0.06); },
  skitter() { for (let i = 0; i < 5; i++) noise(0.05, 'bandpass', 2200 + Math.random() * 1600, 3, 0.1); },
  snap() { tone('square', 300, 90, 0.09, 0.2); noise(0.08, 'bandpass', 1100, 1.4, 0.22); },
  hurt() { tone('sine', 240, 120, 0.16, 0.2); noise(0.14, 'lowpass', 500, 0.8, 0.18); },
  heal() { tone('sine', 520, 780, 0.24, 0.1); tone('sine', 660, 990, 0.3, 0.08, 0.12); },
  pickup() { tone('square', 800, 1200, 0.07, 0.09); tone('square', 1200, 1600, 0.09, 0.07, 0.08); },
  splash() { noise(0.28, 'bandpass', 800, 0.8, 0.3, 1.3); },
  step(f) { // f: grass|water|swamp|wood|rock|sand
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
  // 鸟鸣（随机哨音）
  nodes.birdTimer = setInterval(() => {
    if (!ctx || ctx.state !== 'running' || ig.gain.value > 0.02) return;
    const f0 = 1800 + Math.random() * 2400;
    tone('sine', f0, f0 * (0.7 + Math.random() * 0.6), 0.18, 0.045);
    if (Math.random() < 0.5) tone('sine', f0 * 1.1, f0 * 0.8, 0.14, 0.035, 0.2);
  }, 3400);
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
