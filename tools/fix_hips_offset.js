// 修复 player.glb：Mixamo 各剪辑的 Hips 平移带有"整段恒定偏移"（该 take 的骨骼被
// 摆在离原点 2~3m 外录制），播放时身体会瞬移。把每段剪辑的 Hips 平移轨迹减去
// (中位值 - rest值)，保留正常起伏，去掉恒定偏移。
// 用法: node tools/fix_hips_offset.js <glb路径>
const fs = require('fs');

const file = process.argv[2] || 'assets/player.glb';
const buf = fs.readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const binLen = buf.readUInt32LE(20 + jsonLen);
const bin = buf.slice(binStart, binStart + binLen);

const nodeName = (i) => (json.nodes[i] && json.nodes[i].name) || ('node' + i);
const TYPE_N = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

// hips 节点（rest 平移）
const hipsIdx = json.nodes.findIndex(n => /hips/i.test(n.name || ''));
if (hipsIdx < 0) { console.error('找不到 Hips 节点'); process.exit(1); }
const rest = json.nodes[hipsIdx].translation || [0, 0, 0];

function readAccessor(acc) {
  const bv = json.bufferViews[acc.bufferView];
  const off = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const n = TYPE_N[acc.type];
  const out = [];
  for (let i = 0; i < acc.count; i++) {
    const v = [];
    for (let k = 0; k < n; k++) v.push(bin.readFloatLE(off + (i * n + k) * 4));
    out.push(v);
  }
  return out;
}
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 收集新 bufferView（追加到 BIN 末尾）
const newChunks = [];
let extraLen = 0;

let fixed = 0, skipped = 0;
for (const anim of json.animations) {
  for (const ch of anim.channels) {
    if (ch.target.node !== hipsIdx || ch.target.path !== 'translation') continue;
    const samp = anim.samplers[ch.sampler];
    const acc = json.accessors[samp.output];
    if (!acc || acc.componentType !== 5126 || acc.type !== 'VEC3') continue;
    const data = readAccessor(acc);
    const med = [0, 1, 2].map(k => median(data.map(v => v[k])));
    const delta = med.map((m, k) => m - rest[k]);
    if (Math.hypot(...delta) < 0.02) { skipped++; continue; }   // <2cm 不动
    // 写新数据（减去恒定偏移）
    const n = data.length * 3;
    const f32 = new Float32Array(n);
    for (let i = 0; i < data.length; i++)
      for (let k = 0; k < 3; k++) f32[i * 3 + k] = data[i][k] - delta[k];
    const pad = (4 - (extraLen % 4)) % 4;
    if (pad) { newChunks.push(Buffer.alloc(pad)); extraLen += pad; }
    const raw = Buffer.from(f32.buffer);
    newChunks.push(raw);
    json.bufferViews.push({ buffer: 0, byteOffset: binLen + extraLen, byteLength: raw.length });
    extraLen += raw.length;
    json.accessors.push({
      bufferView: json.bufferViews.length - 1,
      componentType: 5126, count: acc.count, type: 'VEC3',
      min: f32.reduce ? undefined : undefined, // min/max 非必需
    });
    samp.output = json.accessors.length - 1;
    fixed++;
    console.log(`${anim.name.padEnd(12)} 偏移(${delta.map(v => v.toFixed(2)).join(', ')})cm → 已归零`);
  }
}

if (!fixed) { console.log('无需修复'); process.exit(0); }

// 重写 GLB：JSON + 原BIN + 追加数据
const newBin = Buffer.concat([bin, ...newChunks]);
const padBin = (4 - (newBin.length % 4)) % 4;
const binFinal = padBin ? Buffer.concat([newBin, Buffer.alloc(padBin)]) : newBin;
json.buffers[0].byteLength = binFinal.length;
if (padBin) json.bufferViews.forEach(bv => { if (bv.buffer === 0) bv.byteLength = bv.byteLength; });

const jsonStr = JSON.stringify(json);
const jsonBuf = Buffer.from(jsonStr, 'utf8');
const padJson = (4 - (jsonBuf.length % 4)) % 4;
const jsonFinal = Buffer.concat([jsonBuf, Buffer.alloc(padJson, 0x20)]);

const total = 12 + 8 + jsonFinal.length + 8 + binFinal.length;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546C67, 0);            // glTF
out.writeUInt32LE(2, 4);
out.writeUInt32LE(total, 8);
out.writeUInt32LE(jsonFinal.length, 12);
out.writeUInt32LE(0x4E4F534A, 16);           // JSON
jsonFinal.copy(out, 20);
out.writeUInt32LE(binFinal.length, 20 + jsonFinal.length);
out.writeUInt32LE(0x004E4942, 24 + jsonFinal.length); // BIN
binFinal.copy(out, 28 + jsonFinal.length);

fs.writeFileSync(file, out);
console.log(`完成：修复 ${fixed} 段、跳过 ${skipped} 段，文件 ${(total / 1048576).toFixed(2)} MB`);
