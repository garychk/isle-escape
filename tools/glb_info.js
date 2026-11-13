#!/usr/bin/env node
// GLB 体检：看骨骼、动画 clip、面数、贴图、尺寸是否满足游戏接入要求
// 用法：node tools/glb_info.js assets/player.glb
const fs = require('fs');
const path = require('path');

function readGLB(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('不是 GLB 文件');
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  return { json, bin, size: buf.length };
}

function triCount(g, mesh) {
  let n = 0;
  for (const p of mesh.primitives || []) {
    if (p.indices != null) n += (g.accessors[p.indices].count / 3) | 0;
    else if (p.attributes && p.attributes.POSITION != null) n += (g.accessors[p.attributes.POSITION].count / 3) | 0;
  }
  return n;
}

const file = process.argv[2];
if (!file) { console.error('用法: node tools/glb_info.js <file.glb>'); process.exit(1); }
const { json: g, bin, size } = readGLB(file);

const meshes = (g.meshes || []).length;
let tris = 0;
for (const m of g.meshes || []) tris += triCount(g, m);
const skins = g.skins || [];
const anims = g.animations || [];
const images = g.images || [];
const texBytes = images.reduce((s, im) => {
  const bv = g.bufferViews[im.bufferView];
  return s + (bv ? bv.byteLength : 0);
}, 0);

// 动画时长
function animDur(a) {
  let max = 0;
  for (const s of a.samplers) {
    const acc = g.accessors[s.input];
    if (acc.max) max = Math.max(max, acc.max[0]);
  }
  return max;
}

// 包围盒（从 POSITION 的 min/max 汇总，忽略蒙皮变形）
const bb = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
for (const m of g.meshes || []) for (const p of m.primitives || []) {
  const acc = g.accessors[p.attributes.POSITION];
  if (!acc || !acc.min) continue;
  for (let i = 0; i < 3; i++) { bb.min[i] = Math.min(bb.min[i], acc.min[i]); bb.max[i] = Math.max(bb.max[i], acc.max[i]); }
}

const rows = [
  ['文件', path.basename(file)],
  ['体积', (size / 1024 / 1024).toFixed(2) + ' MB （贴图 ' + (texBytes / 1024 / 1024).toFixed(2) + ' MB）'],
  ['网格 / 三角面', meshes + ' 个 / ' + tris.toLocaleString()],
  ['骨骼', skins.length ? (skins[0].joints.length + ' 根') : '无（静态模型）'],
  ['尺寸', (bb.max[0] - bb.min[0]).toFixed(2) + ' × ' + (bb.max[1] - bb.min[1]).toFixed(2) + ' × ' + (bb.max[2] - bb.min[2]).toFixed(2) + ' m'],
  ['落地', 'minY=' + bb.min[1].toFixed(3)],
  ['动画', anims.length + ' 段'],
];
for (const [k, v] of rows) console.log(k.padEnd(14, ' ') + ' ' + v);

if (anims.length) {
  console.log('\n动画 clip:');
  for (const a of anims) console.log('  ' + (a.name || '(无名)').padEnd(22, ' ') + animDur(a).toFixed(2) + 's');
  const KNOWN = ['idle', 'walk', 'run', 'aim', 'shoot', 'fire', 'rifle', 'slash', 'attack', 'swing',
    'roll', 'jump', 'fall', 'crouch', 'reload', 'die', 'death', 'drive', 'sit'];
  const hit = new Set();
  for (const a of anims) {
    const n = (a.name || '').toLowerCase();
    for (const k of KNOWN) if (n.includes(k)) hit.add(k);
  }
  console.log('\n角色状态机可识别的关键字: ' + ([...hit].join(', ') || '(无 — clip 名里要带 idle/walk/run/aim 等)'));
}

// 警告
const warn = [];
if (tris > 40000) warn.push('三角面 ' + tris + ' 超过 40k，Web 端会掉帧');
if (images.some(i => i.mimeType === 'image/png')) warn.push('含 PNG 贴图，建议转 JPEG/KTX2 压体积');
if (skins.length && !anims.length) warn.push('有骨骼但无动画');
if (bb.max[1] - bb.min[1] > 3) warn.push('高度超过 3m，检查单位（cm 未换算？）');
if (warn.length) { console.log('\n注意:'); for (const w of warn) console.log('  - ' + w); }
