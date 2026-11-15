// 把新导出 GLB 里的新增动画 clip 追加到基准 GLB，基准 GLB 的其余数据字节级不变。
// 用途：整包重跑 Blender 会让部分原有 clip 被重新采样/清除根位移，持械动作会变；
//       只移植新 clip 才能保证「持枪/持刀动作一个字都没动」。
//
// 用法：
//   node tools/append_anims.js --base assets_src/player.glb.bak-22clips \
//        --add assets/player.glb --only idle_unarmed,stop_walk,turn_left,turn_right \
//        --out assets/player.glb
const fs = require('fs');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? def : process.argv[i + 1];
}

function parseGLB(buf) {
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('不是 GLB 文件');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const binLen = buf.readUInt32LE(20 + jsonLen);
  const bin = buf.slice(20 + jsonLen + 8, 20 + jsonLen + 8 + binLen);
  return { json, bin };
}

function buildGLB(json, bin) {
  const padB = (4 - (bin.length % 4)) % 4;
  const binOut = padB ? Buffer.concat([bin, Buffer.alloc(padB)]) : Buffer.from(bin);
  json.buffers[0].byteLength = binOut.length;
  const padJ = (4 - (Buffer.byteLength(JSON.stringify(json)) % 4)) % 4;
  const js = Buffer.concat([
    Buffer.from(JSON.stringify(json), 'utf8'),
    Buffer.alloc(padJ, 0x20),
  ]);
  const head = Buffer.alloc(12);
  head.write('glTF', 0, 'ascii');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + 8 + binOut.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binOut.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, js, bh, binOut]);
}

const base = parseGLB(fs.readFileSync(arg('base')));
const add = parseGLB(fs.readFileSync(arg('add')));
const only = new Set(arg('only', '').split(',').map(s => s.trim()).filter(Boolean));
const out = arg('out');
const replace = process.argv.includes('--replace');
if (!only.size || !out) throw new Error('需要 --only 与 --out');

// --replace：同名 clip 视为「替换」而不是「追加冲突」。
// 只是从 animations 数组里摘掉旧的引用，BIN 里那几段旧数据成为无害的死字节，
// 其余 clip 的数值/顺序一个字节都不动。
if (replace) {
  const before = base.json.animations.length;
  base.json.animations = base.json.animations.filter(a => !only.has(a.name));
  console.log('已摘除待替换的同名 clip:', before - base.json.animations.length);
}

// 新旧骨架节点按名字对齐（新增动画不会改变节点表，但仍做映射以防万一）
const oldNames = base.json.nodes.map(n => n.name || '');
const nodeMap = new Map();
add.json.nodes.forEach((n, i) => {
  const oi = oldNames.indexOf(n.name || '');
  if (oi < 0) throw new Error('基准 GLB 里找不到节点: ' + n.name);
  nodeMap.set(i, oi);
});

let binOut = Buffer.from(base.bin);
const bvMap = new Map(), accMap = new Map();
const appended = [];

function copyBufferView(idx) {
  if (bvMap.has(idx)) return bvMap.get(idx);
  const bv = add.json.bufferViews[idx];
  if (bv.buffer !== 0) throw new Error('暂不支持非 0 号 buffer 的 bufferView');
  const raw = add.bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const pad = (4 - (binOut.length % 4)) % 4;
  if (pad) binOut = Buffer.concat([binOut, Buffer.alloc(pad)]);
  const at = binOut.length;
  binOut = Buffer.concat([binOut, raw]);
  base.json.bufferViews.push({ ...bv, byteOffset: at });
  const ni = base.json.bufferViews.length - 1;
  bvMap.set(idx, ni);
  return ni;
}

function copyAccessor(idx) {
  if (accMap.has(idx)) return accMap.get(idx);
  const acc = { ...add.json.accessors[idx] };
  if (acc.bufferView !== undefined) acc.bufferView = copyBufferView(acc.bufferView);
  base.json.accessors.push(acc);
  const ni = base.json.accessors.length - 1;
  accMap.set(idx, ni);
  return ni;
}

for (const a of add.json.animations) {
  if (!only.has(a.name)) continue;
  if (base.json.animations.some(x => x.name === a.name)) throw new Error('基准 GLB 已有 clip: ' + a.name);
  const na = {
    name: a.name,
    samplers: a.samplers.map(s => ({
      ...s, input: copyAccessor(s.input), output: copyAccessor(s.output),
    })),
    channels: a.channels.map(c => ({
      sampler: c.sampler,
      target: { node: nodeMap.get(c.target.node), path: c.target.path },
    })),
  };
  if (a.extras) na.extras = a.extras;
  base.json.animations.push(na);
  appended.push(a.name);
}

if (appended.length !== only.size) {
  throw new Error('只找到 ' + appended.length + '/' + only.size + ' 个要追加的 clip: ' + appended.join(','));
}
// 不做任何重排：原有 clip 保持原来的顺序与数据，新 clip 直接追加在末尾
fs.writeFileSync(out, buildGLB(base.json, binOut));
console.log('已追加 clip:', appended.join(', '));
console.log('输出:', out, (fs.statSync(out).size / 1024 / 1024).toFixed(2) + ' MB',
  '| 总 clip 数:', base.json.animations.length);
