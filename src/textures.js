// 程序化 canvas 纹理：地面 / 树皮 / 树叶 / 棕榈 / 大叶植物 / 藤蔓 / 毛皮 / 木材 / 金属
import * as THREE from 'three';
import { mulberry32 } from './util.js';

const rnd = mulberry32(4242);
const cache = {};
// 真实素材覆盖（由 pbr.js 在启动阶段注入）：缺文件时下面的函数自动回退程序化贴图
const overrides = {};
export function setTextureOverride(key, t) { if (t) overrides[key] = t; }

function bleedAlpha(cv, rgb) {
  const g = cv.getContext('2d');
  const d = g.getImageData(0, 0, cv.width, cv.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] < 12) { p[i] = rgb[0]; p[i + 1] = rgb[1]; p[i + 2] = rgb[2]; }
  }
  g.putImageData(d, 0, 0);
}
function tex(key, w, h, draw, repeat = 1, srgb = true, bleed = null) {
  if (cache[key]) return cache[key];
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  draw(g, w, h);
  if (bleed) bleedAlpha(cv, bleed);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  cache[key] = t;
  return t;
}

// —— 可平铺值噪声（供法线贴图使用） ——
const NG = 64;
const nGrid = new Float32Array(NG * NG);
for (let i = 0; i < nGrid.length; i++) nGrid[i] = rnd();
const nAt = (i, j) => nGrid[(((j % NG) + NG) % NG) * NG + (((i % NG) + NG) % NG)];
function vnoise(u, v) {
  const x = u * NG, y = v * NG;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = x - x0, ty = y - y0;
  const s = t => t * t * (3 - 2 * t);
  const sx = s(tx), sy = s(ty);
  return (nAt(x0, y0) * (1 - sx) + nAt(x0 + 1, y0) * sx) * (1 - sy)
    + (nAt(x0, y0 + 1) * (1 - sx) + nAt(x0 + 1, y0 + 1) * sx) * sy;
}
function fbm2(u, v, oct = 4, f = 1, g2 = 1) {
  let a = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += vnoise(u * f, v * g2) * a; norm += a; a *= 0.5; f *= 2; g2 *= 2; }
  return sum / norm;
}

// 由高度函数生成法线贴图
function normalTex(key, size, strength, heightFn) {
  if (cache[key]) return cache[key];
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = heightFn(x / size, y / size);
  const img = g.createImageData(size, size);
  const p = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = H[y * size + ((x - 1 + size) % size)], r = H[y * size + ((x + 1) % size)];
      const u = H[((y - 1 + size) % size) * size + x], d = H[((y + 1) % size) * size + x];
      let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      p[i] = (nx / len * 0.5 + 0.5) * 255;
      p[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      p[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      p[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  cache[key] = t;
  return t;
}

// —— 叶片绘制 ——
function drawLeaf(g, x, y, len, wid, ang, fill, vein) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(len * 0.16, -wid, len * 0.76, -wid * 0.66, len, 0);
  g.bezierCurveTo(len * 0.76, wid * 0.66, len * 0.16, wid, 0, 0);
  g.closePath();
  g.fillStyle = fill; g.fill();
  if (vein) {
    g.strokeStyle = vein;
    g.lineWidth = Math.max(0.7, len * 0.018);
    g.beginPath(); g.moveTo(len * 0.03, 0); g.lineTo(len * 0.93, 0); g.stroke();
    g.lineWidth = Math.max(0.4, len * 0.009);
    for (let k = 1; k <= 5; k++) {
      const t = 0.12 + k * 0.14;
      const px = len * t;
      const spread = wid * (0.72 - Math.abs(t - 0.4) * 0.7);
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(px, 0);
        g.quadraticCurveTo(px + len * 0.07, s * spread * 0.55, px + len * 0.12, s * spread);
        g.stroke();
      }
    }
  }
  g.restore();
}

// ---------- 岩石（灰斑 + 裂纹） ----------
export function rockTex() {
  return tex('rock', 256, 256, (g, w, h) => {
    g.fillStyle = '#7a756c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 60 + rnd() * 90 | 0;
      g.fillStyle = `rgba(${v},${v - 3},${v - 10},${0.1 + rnd() * 0.3})`;
      g.beginPath(); g.arc(rnd() * w, rnd() * h, 1 + rnd() * 6, 0, 6.283); g.fill();
    }
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = 'rgba(38,34,28,.5)'; g.lineWidth = 0.8 + rnd() * 1.6;
      g.beginPath();
      let x = rnd() * w, y = rnd() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 40; y += (rnd() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
    // 苔痕与雨渍
    for (let i = 0; i < 70; i++) {
      const x = rnd() * w, y = rnd() * h, r = 4 + rnd() * 16;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(${52 + rnd() * 30 | 0},${74 + rnd() * 30 | 0},${38 + rnd() * 18 | 0},${0.08 + rnd() * 0.16})`);
      grd.addColorStop(1, 'rgba(60,80,40,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    }
  }, 1);
}

// ---------- 地面细节（暖调土色，与顶点色相乘） ----------
export function groundDetail() {
  return tex('ground', 256, 256, (g, w, h) => {
    g.fillStyle = '#a2957f'; g.fillRect(0, 0, w, h);
    // 大尺度腐殖土/湿斑（压住平铺感）
    for (let i = 0; i < 70; i++) {
      const x = rnd() * w, y = rnd() * h, r = 16 + rnd() * 52;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const dark = rnd() < 0.6;
      grd.addColorStop(0, dark
        ? `rgba(${52 + rnd() * 22 | 0},${40 + rnd() * 18 | 0},${26 + rnd() * 14 | 0},${0.12 + rnd() * 0.20})`
        : `rgba(${182 + rnd() * 34 | 0},${166 + rnd() * 30 | 0},${132 + rnd() * 26 | 0},${0.08 + rnd() * 0.12})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    }
    // 土粒（暖色，亮度区间收窄，避免“盐霜”白点）
    for (let i = 0; i < 5200; i++) {
      const x = rnd() * w, y = rnd() * h, r = 0.7 + rnd() * 2.2;
      const v = 96 + rnd() * 62 | 0;
      g.fillStyle = `rgba(${v},${v * 0.92 | 0},${v * 0.76 | 0},${0.10 + rnd() * 0.16})`;
      g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    }
    // 落叶碎屑（棕黄小碎片，让地面有“落叶层”的密度）
    for (let i = 0; i < 560; i++) {
      const x = rnd() * w, y = rnd() * h;
      const l = 2 + rnd() * 5, wd = l * (0.35 + rnd() * 0.4);
      const hue = 22 + rnd() * 30;
      g.save(); g.translate(x, y); g.rotate(rnd() * 6.283);
      g.fillStyle = `hsla(${hue},${24 + rnd() * 26}%,${16 + rnd() * 16}%,${0.32 + rnd() * 0.34})`;
      g.beginPath(); g.ellipse(0, 0, l, wd, 0, 0, 6.283); g.fill();
      g.restore();
    }
    // 枯枝/草茎
    for (let i = 0; i < 420; i++) {
      const x = rnd() * w, y = rnd() * h, l = 4 + rnd() * 11, a = rnd() * 6.283;
      g.strokeStyle = `rgba(${58 + rnd() * 44 | 0},${46 + rnd() * 34 | 0},${26 + rnd() * 22 | 0},.34)`;
      g.lineWidth = 0.8 + rnd();
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    // 苔藓点
    for (let i = 0; i < 150; i++) {
      const x = rnd() * w, y = rnd() * h;
      g.fillStyle = `rgba(${44 + rnd() * 26 | 0},${66 + rnd() * 30 | 0},${34 + rnd() * 20 | 0},${0.16 + rnd() * 0.2})`;
      g.beginPath(); g.arc(x, y, 1 + rnd() * 3, 0, 6.283); g.fill();
    }
  }, 1, false);
}

// ---------- 树皮（纵向裂纹 + 苔藓 + 雨痕） ----------
export function barkTex() {
  return tex('bark', 256, 512, (g, w, h) => {
    g.fillStyle = '#6b5946'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * w;
      const v = 52 + rnd() * 78 | 0;
      g.strokeStyle = `rgba(${v},${v * 0.76 | 0},${v * 0.54 | 0},${0.28 + rnd() * 0.5})`;
      g.lineWidth = 1 + rnd() * 4.5;
      g.beginPath();
      let y = -10, xx = x;
      g.moveTo(xx, y);
      while (y < h + 10) { y += 16 + rnd() * 26; xx += (rnd() - 0.5) * 9; g.lineTo(xx, y); }
      g.stroke();
    }
    // 横向皮孔（热带树种特征）
    for (let i = 0; i < 90; i++) {
      const x = rnd() * w, y = rnd() * h, l = 4 + rnd() * 16;
      g.strokeStyle = `rgba(24,18,12,${0.2 + rnd() * 0.35})`;
      g.lineWidth = 1 + rnd() * 1.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y + (rnd() - 0.5) * 4); g.stroke();
    }
    // 苔藓（偏绿，成片）
    for (let i = 0; i < 90; i++) {
      const x = rnd() * w, y = rnd() * h;
      const grd = g.createRadialGradient(x, y, 0, x, y, 6 + rnd() * 22);
      const a = 0.10 + rnd() * 0.22;
      grd.addColorStop(0, `rgba(${56 + rnd() * 30 | 0},${84 + rnd() * 36 | 0},${40 + rnd() * 20 | 0},${a})`);
      grd.addColorStop(1, 'rgba(56,84,40,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, 28, 0, 6.283); g.fill();
    }
    // 湿痕
    for (let i = 0; i < 34; i++) {
      const x = rnd() * w;
      const grd = g.createLinearGradient(x, 0, x + 10, 0);
      grd.addColorStop(0, 'rgba(16,14,10,0)');
      grd.addColorStop(0.5, `rgba(16,14,10,${0.10 + rnd() * 0.16})`);
      grd.addColorStop(1, 'rgba(16,14,10,0)');
      g.fillStyle = grd; g.fillRect(x, 0, 12, h);
    }
  }, 1);
}

// ---------- 树皮法线（纵向沟槽，让树干在斜光下有体积） ----------
export function barkNormal() {
  return normalTex('barkN', 256, 1.9, (u, v) => {
    const warp = vnoise(u * 4, v * 1.5) * 0.9;
    const groove = Math.abs(Math.sin((u * 11 + warp) * Math.PI));
    const fine = fbm2(u * 14, v * 6, 2);
    return (1 - groove) * 0.62 + fine * 0.38;
  });
}

// ---------- 树冠叶簇卡片（雨林：大量单叶组成的不规则团块） ----------
export function canopyTex(variant = 0) {
  return tex('canopy' + variant, 512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    // 三层，由暗到亮，形成体积
    const layers = [
      { n: 170, rad: 0.50, l0: 13, l1: 8, a0: 0.94, sat: [20, 14] },
      { n: 140, rad: 0.42, l0: 21, l1: 9, a0: 0.96, sat: [26, 16] },
      { n: 110, rad: 0.34, l0: 30, l1: 12, a0: 1, sat: [32, 18] },
    ];
    for (const L of layers) {
      for (let i = 0; i < L.n; i++) {
        const a = rnd() * 6.283;
        const rr = Math.pow(rnd(), 0.55) * w * L.rad;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr * 0.92;
        const len = 30 + rnd() * 52;
        const wid = len * (0.24 + rnd() * 0.15);
        const l = L.l0 + rnd() * L.l1;
        const sat = L.sat[0] + rnd() * L.sat[1];
        const hue = 100 + rnd() * 34;
        drawLeaf(g, x, y, len, wid, a + (rnd() - 0.5) * 1.5,
          `hsla(${hue},${sat}%,${l}%,${L.a0})`,
          `hsla(${hue - 8},${sat}%,${l + 7}%,.75)`);
      }
    }
  }, 1, true, [26, 44, 24]);
}

// ---------- 棕榈羽状叶（沿长度方向展开） ----------
export function palmFrondTex() {
  return tex('palm', 512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const midY = h / 2;
    // 主脉
    g.strokeStyle = 'rgba(104,112,60,1)';
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(2, midY + 10); g.quadraticCurveTo(w * 0.5, midY + 2, w - 3, midY - 16); g.stroke();
    g.strokeStyle = 'rgba(132,140,80,.85)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(2, midY + 7); g.quadraticCurveTo(w * 0.5, midY - 1, w - 3, midY - 19); g.stroke();
    // 羽片
    for (let i = 0; i < 74; i++) {
      const t = i / 74;
      const x = 6 + t * (w - 12);
      const y = midY + 9 - t * 22;
      const env = Math.sin(Math.pow(t, 0.62) * Math.PI) * 1.05;
      const len = (h * 0.47) * Math.max(0.08, env) * (1 + rnd() * 0.12);
      const sweep = 0.42 + t * 0.42;
      for (const s of [-1, 1]) {
        const hue = 96 + rnd() * 30;
        const sat = 40 + rnd() * 22;
        const lig = 25 + rnd() * 19;
        g.fillStyle = `hsla(${hue},${sat}%,${lig}%,.96)`;
        g.beginPath();
        g.moveTo(x, y + s * 1.5);
        g.quadraticCurveTo(x + len * 0.30, y + s * len * 0.62, x + len * sweep, y + s * len);
        g.lineTo(x + len * sweep * 0.92, y + s * len * 0.93);
        g.quadraticCurveTo(x + len * 0.24, y + s * len * 0.5, x, y - s * 1.2);
        g.closePath(); g.fill();
      }
    }
    // 叶尖
    g.fillStyle = 'rgba(96,112,58,1)';
    g.beginPath(); g.moveTo(w - 3, midY - 16); g.lineTo(w - 26, midY - 22); g.lineTo(w - 26, midY - 10); g.closePath(); g.fill();
  }, 1, true, [30, 46, 26]);
}

// ---------- 大叶植物（芭蕉 / 龟背竹） ----------
export function bigLeafTex() {
  return tex('bigleaf', 512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    // 3~4 片自底部中心放射的大叶
    const specs = [[-0.55, 1.0], [0.15, 1.08], [0.78, 0.92], [-1.15, 0.72]];
    for (const [ang, k] of specs) {
      const bx = w * 0.5, by = h * 0.94;
      const len = w * 0.62 * k, wid = w * 0.13 * k;
      const hue = 96 + rnd() * 26, sat = 36 + rnd() * 16, lig = 26 + rnd() * 17;
      const c1 = `hsla(${hue},${sat}%,${lig}%,.98)`;
      const c2 = `hsla(${hue + 6},${sat}%,${lig + 10}%,.98)`;
      const grd = g.createLinearGradient(bx, by, bx + Math.cos(ang) * len, by + Math.sin(ang) * len);
      grd.addColorStop(0, c1); grd.addColorStop(0.55, c1); grd.addColorStop(1, c2);
      g.save(); g.translate(bx, by); g.rotate(ang);
      // 叶身（带撕裂缺口）
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(len * 0.22, -wid * 1.15, len * 0.78, -wid * 0.95, len, wid * 0.06);
      g.bezierCurveTo(len * 0.8, wid * 0.92, len * 0.25, wid * 1.12, 0, 0);
      g.closePath();
      g.fillStyle = grd; g.fill();
      // 缺口（每片叶两侧各 5~7 道）
      g.globalCompositeOperation = 'destination-out';
      for (let k2 = 1; k2 <= 6; k2++) {
        const t = k2 / 7;
        const px = len * t;
        const cut = wid * (0.85 - Math.abs(t - 0.5) * 0.6);
        for (const s of [-1, 1]) {
          g.beginPath();
          g.moveTo(px, s * cut * 1.2);
          g.lineTo(px + len * 0.055, s * cut * 0.25);
          g.lineTo(px + len * 0.05, s * cut * 1.25);
          g.closePath(); g.fill();
        }
      }
      g.globalCompositeOperation = 'source-over';
      // 主脉 + 侧脉
      g.strokeStyle = `hsla(${hue - 6},${sat + 6}%,${lig + 14}%,.8)`;
      g.lineWidth = len * 0.014;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.97, wid * 0.04); g.stroke();
      g.lineWidth = len * 0.005;
      for (let k2 = 1; k2 <= 9; k2++) {
        const t = k2 / 10, px = len * t;
        const sp = wid * (0.9 - Math.abs(t - 0.55) * 0.55);
        for (const s of [-1, 1]) {
          g.beginPath(); g.moveTo(px, 0);
          g.quadraticCurveTo(px + len * 0.06, s * sp * 0.6, px + len * 0.1, s * sp);
          g.stroke();
        }
      }
      g.restore();
    }
    // 茎
    g.strokeStyle = 'rgba(86,104,50,.95)';
    g.lineWidth = w * 0.022;
    g.beginPath(); g.moveTo(w * 0.5, h); g.lineTo(w * 0.5, h * 0.6); g.stroke();
  }, 1, true, [30, 48, 26]);
}

// ---------- 垂挂藤蔓（透明长条 + 小叶） ----------
export function vineTex() {
  return tex('vine', 128, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let v = 0; v < 3; v++) {
      const x0 = 16 + v * 42 + rnd() * 12;
      g.strokeStyle = `rgba(${64 + rnd() * 26 | 0},${78 + rnd() * 28 | 0},${40 + rnd() * 18 | 0},1)`;
      g.lineWidth = 2.2 + rnd() * 1.6;
      g.beginPath();
      g.moveTo(x0, 0);
      let x = x0;
      for (let y = 0; y < h; y += 32) { x += (rnd() - 0.5) * 12; g.lineTo(x, y); }
      g.stroke();
      // 沿藤的小叶
      for (let y = 24; y < h - 10; y += 34 + rnd() * 26) {
        const t = y / h;
        const px = x0 + Math.sin(t * 5 + v) * 8;
        for (const s of [-1, 1]) {
          const len = 12 + rnd() * 14, wid = len * 0.42;
          g.save(); g.translate(px, y); g.rotate(s * (0.7 + rnd() * 0.5));
          g.beginPath();
          g.moveTo(0, 0);
          g.bezierCurveTo(len * 0.3, -wid, len * 0.8, -wid * 0.8, len, 0);
          g.bezierCurveTo(len * 0.8, wid * 0.8, len * 0.3, wid, 0, 0);
          g.closePath();
          g.fillStyle = `hsla(${100 + rnd() * 26},${42 + rnd() * 20}%,${26 + rnd() * 18}%,.98)`;
          g.fill();
          g.restore();
        }
      }
    }
  }, 1, true, [30, 46, 26]);
}

// ---------- 地面落叶层（贴地小片） ----------
export function litterTex() {
  if (overrides.litter) return overrides.litter;
  return tex('litter', 256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * w, y = rnd() * h;
      const len = 12 + rnd() * 26, wid = len * (0.2 + rnd() * 0.2);
      const a = rnd() * 6.283;
      const hue = 26 + rnd() * 34;
      drawLeaf(g, x, y, len, wid, a,
        `hsla(${hue},${30 + rnd() * 26}%,${17 + rnd() * 19}%,.94)`,
        `hsla(${hue - 8},30%,${20 + rnd() * 14}%,.6)`);
    }
  }, 1, true, [54, 42, 24]);
}

// ---------- 毛皮法线（沿身体纵向拉伸的绒丝） ----------
export function furNormal() {
  return normalTex('furN', 128, 1.15, (u, v) => fbm2(u * 5, v * 34, 3, 1, 1) * 0.5 + fbm2(u * 13, v * 62, 2, 1, 1) * 0.5);
}
// 毛孔/皮肤细节法线（鳄鱼鳞片）
export function scaleNormal() {
  return normalTex('scaleN', 128, 2.0, (u, v) => {
    const gx = Math.abs(Math.sin(u * Math.PI * 14)), gy = Math.abs(Math.sin(v * Math.PI * 11));
    return (1 - gx * gy) * 0.7 + fbm2(u * 8, v * 8, 2) * 0.3;
  });
}

// ---------- 木纹（栈桥 / 木筏 / 枪托） ----------
export function woodGrain() {
  return tex('wood', 256, 256, (g, w, h) => {
    g.fillStyle = '#8a6a44'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) {
      const y = rnd() * h;
      const v = 90 + rnd() * 70 | 0;
      g.strokeStyle = `rgba(${v},${v * 0.74 | 0},${v * 0.5 | 0},${0.18 + rnd() * 0.4})`;
      g.lineWidth = 0.8 + rnd() * 3;
      g.beginPath();
      let x = -6, yy = y;
      g.moveTo(x, yy);
      while (x < w + 6) { x += 22 + rnd() * 30; yy += (rnd() - 0.5) * 7; g.lineTo(x, yy); }
      g.stroke();
    }
    for (let i = 0; i < 7; i++) { // 节疤
      const x = rnd() * w, y = rnd() * h, r = 5 + rnd() * 14;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(46,32,20,.85)');
      grd.addColorStop(0.6, 'rgba(70,50,30,.5)');
      grd.addColorStop(1, 'rgba(70,50,30,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    }
  }, 1);
}

// ---------- 枪械金属（细划痕 + 磨边） ----------
export function metalTex() {
  return tex('metal', 256, 256, (g, w, h) => {
    g.fillStyle = '#8e8b85'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const x = rnd() * w, y = rnd() * h, l = 2 + rnd() * 26, a = (rnd() - 0.5) * 0.6;
      const v = 70 + rnd() * 120 | 0;
      g.strokeStyle = `rgba(${v},${v},${v},${0.05 + rnd() * 0.22})`;
      g.lineWidth = 0.6 + rnd() * 1.4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (let i = 0; i < 320; i++) {
      const v = 40 + rnd() * 60 | 0;
      g.fillStyle = `rgba(${v},${v},${v},${0.05 + rnd() * 0.14})`;
      g.beginPath(); g.arc(rnd() * w, rnd() * h, 0.6 + rnd() * 2.2, 0, 6.283); g.fill();
    }
  }, 1);
}

// ---------- 帆布（编织纹 + 污渍 + 补丁） ----------
export function sailTex() {
  return tex('sail', 256, 256, (g, w, h) => {
    g.fillStyle = '#cfc4a8'; g.fillRect(0, 0, w, h);
    // 织纹
    for (let y = 0; y < h; y += 3) {
      g.fillStyle = `rgba(150,140,116,${0.06 + (y % 6 ? 0 : 0.06)})`;
      g.fillRect(0, y, w, 1.4);
    }
    for (let x = 0; x < w; x += 3) {
      g.fillStyle = 'rgba(160,150,124,.05)';
      g.fillRect(x, 0, 1.2, h);
    }
    // 污渍
    for (let i = 0; i < 40; i++) {
      const x = rnd() * w, y = rnd() * h, r = 6 + rnd() * 34;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(${96 + rnd() * 40 | 0},${78 + rnd() * 30 | 0},${52 + rnd() * 24 | 0},${0.05 + rnd() * 0.14})`);
      grd.addColorStop(1, 'rgba(96,78,52,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    }
    // 补丁 + 缝线
    for (let i = 0; i < 3; i++) {
      const x = 20 + rnd() * (w - 80), y = 20 + rnd() * (h - 80);
      const pw = 30 + rnd() * 40, ph = 24 + rnd() * 34;
      g.fillStyle = 'rgba(186,172,142,.75)';
      g.fillRect(x, y, pw, ph);
      g.strokeStyle = 'rgba(96,86,64,.8)'; g.lineWidth = 1.2;
      g.setLineDash([4, 3]);
      g.strokeRect(x + 1, y + 1, pw - 2, ph - 2);
      g.setLineDash([]);
    }
  }, 1);
}

// ---------- 草叶簇（细密，带枯黄混色） ----------
export function grassTex() {
  if (overrides.grass) return overrides.grass;
  return tex('grass', 256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) {
      const x0 = 6 + rnd() * (w - 12), lean = (rnd() - 0.5) * 110;
      const top = 4 + rnd() * 60;
      const grd = g.createLinearGradient(x0, h, x0 + lean, top);
      const dark = 31 + rnd() * 14;
      grd.addColorStop(0, `rgba(${52 + rnd() * 18 | 0},${70 + rnd() * 20 | 0},${34 + rnd() * 14 | 0},1)`);
      grd.addColorStop(0.55, `hsla(${88 + rnd() * 26},${34 + rnd() * 20}%,${dark}%,1)`);
      grd.addColorStop(1, `hsla(${86 + rnd() * 30},${36 + rnd() * 22}%,${dark + 16}%,1)`);
      g.strokeStyle = grd;
      g.lineWidth = 1.4 + rnd() * 3;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0, h);
      g.quadraticCurveTo(x0 + lean * 0.35, h * 0.55, x0 + lean, top);
      g.stroke();
    }
  }, 1, true, [46, 64, 32]);
}

// ---------- 蕨叶（羽状，更密） ----------
export function fernTex() {
  if (overrides.fern) return overrides.fern;
  return tex('fern', 256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let f = 0; f < 11; f++) {
      const bx = 20 + rnd() * (w - 40), by = h - 4, tipX = bx + (rnd() - 0.5) * 130, tipY = 6 + rnd() * 40;
      g.strokeStyle = 'rgba(72,100,48,1)'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + (tipX - bx) * 0.4, by * 0.5, tipX, tipY); g.stroke();
      for (let k = 0; k < 18; k++) {
        const t = k / 18;
        const px = bx + (tipX - bx) * t, py = by + (tipY - by) * t * t * 0.6 + (by - by) * 0 + (t * (tipY - by));
        const len = 30 * (1 - t) + 4;
        for (const sgn of [-1, 1]) {
          g.fillStyle = `hsla(${96 + rnd() * 26},${40 + rnd() * 20}%,${25 + rnd() * 18}%,.97)`;
          g.beginPath();
          g.moveTo(px, py);
          g.quadraticCurveTo(px + sgn * len * 0.45, py - len * 0.2, px + sgn * len * 0.9, py - len * 0.5);
          g.lineTo(px + sgn * len * 0.85, py - len * 0.62);
          g.quadraticCurveTo(px + sgn * len * 0.4, py - len * 0.32, px, py - 1.6);
          g.closePath(); g.fill();
        }
      }
    }
  }, 1, true, [42, 62, 30]);
}

// ---------- 地面法线（微起伏） ----------
export function groundNormal() {
  return normalTex('groundN', 128, 2.2, (u, v) =>
    0.5 * fbm2(u * 4, v * 4, 1) + 0.28 * fbm2(u * 9, v * 9, 1) + 0.16 * fbm2(u * 22, v * 22, 1) + 0.08 * fbm2(u * 44, v * 44, 1));
}

// ---------- 水面法线 ----------
export function waterNormal() {
  return tex('waterN', 256, 256, (g, w, h) => {
    g.fillStyle = '#8080ff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      const cx = rnd() * w, cy = rnd() * h, r = 16 + rnd() * 46;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      const dx = (rnd() - 0.5) * 90, dy = (rnd() - 0.5) * 90;
      grd.addColorStop(0, `rgba(${128 + dx | 0},${128 + dy | 0},255,.4)`);
      grd.addColorStop(1, 'rgba(128,128,255,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.fill();
    }
  }, 1, false);
}
