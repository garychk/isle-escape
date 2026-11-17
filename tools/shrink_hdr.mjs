// Radiance HDR 降采样：解码 RGBE → 缩放到 1/2 → 重编码 RLE 写出。
// 用法: node tools/shrink_hdr.mjs <input.hdr> <output.hdr> [scale=2]
// sky.hdr 2048x1024 → 1024x512，体积从 6.2MB 降到约 1.6MB。
import fs from 'node:fs';
import path from 'node:path';

const [src, dst, scaleArg] = process.argv.slice(2);
if (!src || !dst) { console.error('用法: node tools/shrink_hdr.mjs <in.hdr> <out.hdr> [scale]'); process.exit(1); }
const scale = Number(scaleArg || 2);
fs.mkdirSync(path.dirname(dst), { recursive: true });
const buf = fs.readFileSync(src);

// --- 解析头 ---
let pos = 0;
const readLine = () => {
  let e = pos;
  while (e < buf.length && buf[e] !== 10) e++;
  const s = buf.slice(pos, e).toString('latin1'); pos = e + 1; return s;
};
if (readLine().trim() !== '#?RADIANCE') throw new Error('不是 RADIANCE 文件');
let line = '';
while ((line = readLine()).trim() === '') { /* 跳过可能的空行 */ }
if (/^(FORMAT|#|=)/i.test(line.trim()) || /^[A-Z_]+=/i.test(line.trim())) {
  while ((line = readLine()).trim() !== '') { /* 跳过 header 变量直到空行 */ }
  while ((line = readLine()).trim() === '') { /* 跳过空行 */ }
}
const dim = line.trim().split(/\s+/);
if (dim[0] !== '-Y' && dim[0] !== '+Y') throw new Error('不支持的扫描顺序: ' + line);
const H = parseInt(dim[1], 10), X = parseInt(dim[3], 10);

// --- 解码 RLE RGBE 到 Float32 RGB ---
function decode(buf, pos, width, height) {
  const out = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    if (buf[pos] !== 2 || buf[pos + 1] !== 2 || ((buf[pos + 2] << 8) | buf[pos + 3]) !== width) {
      // 非 RLE：扁平 RGBe 数据
      for (let x = 0; x < width; x++, pos += 4) {
        const e = buf[pos + 3];
        if (!e) { out[(y * width + x) * 3] = out[(y * width + x) * 3 + 1] = out[(y * width + x) * 3 + 2] = 0; continue; }
        const f = Math.pow(2, e - (128 + 8));
        out[(y * width + x) * 3] = buf[pos] * f;
        out[(y * width + x) * 3 + 1] = buf[pos + 1] * f;
        out[(y * width + x) * 3 + 2] = buf[pos + 2] * f;
      }
      continue;
    }
    pos += 4;
    const chans = [new Uint8Array(width), new Uint8Array(width), new Uint8Array(width), new Uint8Array(width)];
    for (let c = 0; c < 4; c++) {
      let x = 0;
      while (x < width) {
        const code = buf[pos++];
        if (code > 128) {
          const n = code - 128, v = buf[pos++];
          chans[c].fill(v, x, x + n); x += n;
        } else {
          const n = code;
          for (let i = 0; i < n; i++) chans[c][x++] = buf[pos++];
        }
      }
    }
    for (let x = 0; x < width; x++) {
      const e = chans[3][x];
      const f = e ? Math.pow(2, e - (128 + 8)) : 0;
      const i = (y * width + x) * 3;
      out[i] = chans[0][x] * f; out[i + 1] = chans[1][x] * f; out[i + 2] = chans[2][x] * f;
    }
  }
  return out;
}

const pixels = decode(buf, pos, X, H);
const nw = Math.max(1, Math.floor(X / scale)), nh = Math.max(1, Math.floor(H / scale));

// --- 降采样（box filter） ---
const small = new Float32Array(nw * nh * 3);
for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
    const sx = x * scale + dx, sy = y * scale + dy;
    if (sx >= X || sy >= H) continue;
    const i = (sy * X + sx) * 3; r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n++;
  }
  const o = (y * nw + x) * 3;
  small[o] = r / n; small[o + 1] = g / n; small[o + 2] = b / n;
}

// --- 编码 RLE RGBE ---
const chunks = [];
const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${nh} +X ${nw}\n`, 'latin1');
chunks.push(header);
function toByte(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
const row = Buffer.alloc(nw * 4);
for (let y = 0; y < nh; y++) {
  for (let x = 0; x < nw; x++) {
    const i = (y * nw + x) * 3;
    const r = small[i], g = small[i + 1], b = small[i + 2];
    const m = Math.max(r, g, b);
    if (m < 1e-32) { row[x * 4] = row[x * 4 + 1] = row[x * 4 + 2] = row[x * 4 + 3] = 0; continue; }
    const e = Math.ceil(Math.log2(m)) + 1;
    const f = Math.pow(2, e - 8);
    row[x * 4] = toByte(r / f); row[x * 4 + 1] = toByte(g / f);
    row[x * 4 + 2] = toByte(b / f); row[x * 4 + 3] = e + 128;
  }
  chunks.push(Buffer.from([2, 2, (nw >> 8) & 255, nw & 255]));
  for (let c = 0; c < 4; c++) {
    let x = 0;
    while (x < nw) {
      const start = x, v = row[x * 4 + c];
      let run = 1;
      while (x + run < nw && row[(x + run) * 4 + c] === v && run < 127) run++;
      if (run >= 4) {
        chunks.push(Buffer.from([128 + run, v])); x += run;
      } else {
        const lit = [];
        while (x < nw && lit.length < 128) {
          const vv = row[x * 4 + c];
          let rr = 1;
          while (x + rr < nw && row[(x + rr) * 4 + c] === vv && rr < 4) rr++;
          if (rr >= 4) break;
          for (let k = 0; k < rr; k++) { lit.push(vv); x++; }
        }
        chunks.push(Buffer.from([lit.length, ...lit]));
      }
    }
  }
}
fs.writeFileSync(dst, Buffer.concat(chunks));
console.log(`${src} ${X}x${H} → ${dst} ${nw}x${nh}  ${(buf.length / 1048576).toFixed(2)}MB → ${(fs.statSync(dst).size / 1048576).toFixed(2)}MB`);
