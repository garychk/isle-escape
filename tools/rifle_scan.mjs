// 扫描 rifle.glb 顶点：按 z 分桶输出 minY / maxY / minX / maxX，定位握把与护木
import { readFileSync } from 'fs';
const buf = readFileSync('assets/rifle.glb');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
const binOff = 20 + jsonLen;
const binLen = buf.readUInt32LE(binOff - 8);
const bin = buf.slice(binOff + 8, binOff + 8 + binLen);
const posAcc = json.meshes[0].primitives[0].attributes.POSITION;
const acc = json.accessors[posAcc];
const bv = json.bufferViews[acc.bufferView];
const f32 = new Float32Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), acc.count * 3);
const buckets = new Map();
for (let i = 0; i < acc.count; i++) {
  const x = f32[i*3], y = f32[i*3+1], z = f32[i*3+2];
  const k = Math.round(z * 20) / 20;
  let b = buckets.get(k); if (!b) { b = { minY: 9, maxY: -9, minX: 9, maxX: -9, n: 0 }; buckets.set(k, b); }
  b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
  b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x); b.n++;
}
console.log('z      minY   maxY   xRange     n');
for (const k of [...buckets.keys()].sort((a,b)=>a-b)) {
  const b = buckets.get(k);
  console.log(`${k.toFixed(2).padStart(5)}  ${b.minY.toFixed(3)}  ${b.maxY.toFixed(3)}  [${b.minX.toFixed(3)},${b.maxX.toFixed(3)}]  ${b.n}`);
}
