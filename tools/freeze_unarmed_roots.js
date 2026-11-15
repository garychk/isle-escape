/**
 * 把「空手」系列 Mixamo 动画的 Hips 根位移归一到持械 idle 的基准。
 *
 * 背景：这几个 FBX 来自不同的 Mixamo 包，Hips.translation 的基准坐标差得离谱：
 *   idle           (1.65,   -4.07, -200.48)
 *   walk_unarmed   (0.81, -308.05, -206.76)   ← Y 差 304，按 Armature 缩放 ≈ 1.45 米
 *   run_unarmed    (1.23, -294.09, -191.19)
 *   turn_left      (2.59,   -6.57, -205.73)   ← Z 在动画中变化 ≈ 5.8cm 下沉
 * Mixamo 是 Z-up，导出后 Armature 带 Rx(+90°)，所以动画的 X→世界左右、Y→世界前后、
 * Z→世界高度。也就是说水平两轴（X/Y）的根位移会在交叉淡入时把整个人「平移」出去，
 * 高度轴（Z）的变化会造成转身时下沉再弹回。
 *
 * 做法：原地覆写这些动画 Hips.position 的 output accessor（每个都独占 bufferView），
 *   X/Y → 恒等于 idle 首帧（彻底消灭水平漂移）
 *   Z   → idle 首帧 + (原值 - 原首帧) * BOB，留住一点重心起伏但不再明显上下跳
 * 其余骨骼的 translation 是骨长，7 个 clip 数值完全一致，不动。
 * BIN 中除这几段外一个字节都不改，因此原有 22 个持械动画数值 100% 不变。
 *
 * 用法：node tools/freeze_unarmed_roots.js --in assets/player.glb --out /tmp/out.glb [--bob 0.3]
 */
const fs = require('fs');

function readGLB(p) {
  const b = fs.readFileSync(p);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + p);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.slice(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const binLen = b.readUInt32LE(20 + jsonLen);
  return { json, bin: Buffer.from(b.slice(binStart, binStart + binLen)) };
}

function writeGLB(p, json, bin) {
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  const jp = (4 - (js.length % 4)) % 4;
  if (jp) js = Buffer.concat([js, Buffer.alloc(jp, 0x20)]);
  const bp = (4 - (bin.length % 4)) % 4;
  const bb = bp ? Buffer.concat([bin, Buffer.alloc(bp, 0)]) : bin;
  const total = 12 + 8 + js.length + 8 + bb.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(js.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  js.copy(out, 20);
  const o = 20 + js.length;
  out.writeUInt32LE(bb.length, o);
  out.writeUInt32LE(0x004e4942, o + 4);
  bb.copy(out, o + 8);
  fs.writeFileSync(p, out);
}

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const src = arg('--in', 'assets/player.glb');
const dst = arg('--out', null);
const BOB = parseFloat(arg('--bob', '0.3'));
if (!dst) throw new Error('必须给 --out（不要直接覆盖输入文件，先备份）');

// --clips 可指定要归一的 clip（逗号分隔）。默认仍是那 6 个空手动作；
// 新接入的持刀动作若来自别的 Mixamo 包，也要用同一基准归一，否则切刀会平移/下沉。
const TARGETS = (arg('--clips', '') || [
  'idle_unarmed', 'walk_unarmed', 'run_unarmed',
  'stop_walk', 'turn_left', 'turn_right',
].join(',')).split(',').map(s => s.trim()).filter(Boolean);

const { json, bin } = readGLB(src);
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function hipTransChannel(anim) {
  for (const c of anim.channels) {
    const name = json.nodes[c.target.node].name || '';
    if (c.target.path === 'translation' && /Hips$/i.test(name)) return c;
  }
  return null;
}
function accessorOffset(idx) {
  const a = json.accessors[idx];
  const v = json.bufferViews[a.bufferView];
  if (v.byteStride && v.byteStride !== 12) {
    throw new Error('bufferView 有非紧密 byteStride=' + v.byteStride + '，需要逐 stride 处理');
  }
  return (v.byteOffset || 0) + (a.byteOffset || 0);
}
function readVec3(idx) {
  const a = json.accessors[idx];
  if (a.componentType !== 5126 || a.type !== 'VEC3') {
    throw new Error('accessor ' + idx + ' 不是 float VEC3');
  }
  const off = accessorOffset(idx);
  const dv = new DataView(bin.buffer, bin.byteOffset + off, a.count * 12);
  const out = [];
  for (let i = 0; i < a.count; i++) {
    out.push([
      dv.getFloat32(i * 12, true),
      dv.getFloat32(i * 12 + 4, true),
      dv.getFloat32(i * 12 + 8, true),
    ]);
  }
  return { acc: a, dv, frames: out };
}

// 基准：持械 idle 的 Hips 首帧
const idleAnim = json.animations.find(a => a.name === 'idle');
if (!idleAnim) throw new Error('找不到 idle 动画');
const idleCh = hipTransChannel(idleAnim);
if (!idleCh) throw new Error('idle 没有 Hips.translation 通道');
const ref = readVec3(idleAnim.samplers[idleCh.sampler].output).frames[0];
console.log('基准 idle Hips 首帧:', ref.map(x => x.toFixed(3)).join(', '), '| BOB =', BOB);

// 保护：确认目标 accessor 没有被别的动画复用
const users = {};
for (const a of json.animations) {
  for (const s of a.samplers) (users[s.output] = users[s.output] || []).push(a.name);
}

for (const name of TARGETS) {
  const anim = json.animations.find(a => a.name === name);
  if (!anim) { console.log('跳过（不存在）:', name); continue; }
  const ch = hipTransChannel(anim);
  if (!ch) { console.log('跳过（无 Hips.translation）:', name); continue; }
  const idx = anim.samplers[ch.sampler].output;
  if (users[idx].length !== 1) throw new Error(name + ' 的 output accessor 被共享: ' + users[idx].join(','));

  const { acc, dv, frames } = readVec3(idx);
  const f0 = frames[0];
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < frames.length; i++) {
    const v = [
      ref[0],
      ref[1],
      ref[2] + (frames[i][2] - f0[2]) * BOB,
    ];
    for (let k = 0; k < 3; k++) {
      dv.setFloat32(i * 12 + k * 4, v[k], true);
      mn[k] = Math.min(mn[k], v[k]);
      mx[k] = Math.max(mx[k], v[k]);
    }
  }
  acc.min = mn;
  acc.max = mx;
  console.log(
    name.padEnd(14),
    '原首帧', f0.map(x => x.toFixed(2)).join(','),
    '→ 统一', ref.map(x => x.toFixed(2)).join(','),
    '|', frames.length, '帧',
    '| 高度起伏', (mx[2] - mn[2]).toFixed(2)
  );
}

writeGLB(dst, json, bin);
console.log('已写出:', dst, '|', fs.statSync(dst).size, 'bytes');
