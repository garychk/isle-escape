// 资产优化：GLB 内嵌贴图压缩 + HDR 降采样，生成到 assets_opt/。
// 用法: node tools/optimize_assets.mjs
// 原始 assets/ 完整保留在 git 中，可随时回滚；构建/服务器会自动优先用 assets_opt/。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPT = path.join(root, 'assets_opt');
if (!fs.existsSync(OPT)) fs.mkdirSync(OPT);

// gltf-transform 查找：项目本地 → PATH → 环境变量
const gtCandidates = [
  process.env.GLTF_TRANSFORM,
  path.join(root, 'node_modules', '.bin', 'gltf-transform'),
  '/Users/chenkuan/.workbuddy/binaries/node/workspace/node_modules/.bin/gltf-transform',
].filter(Boolean);
const GT = gtCandidates.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
if (!GT) {
  console.error('找不到 gltf-transform。请 npm install -g @gltf-transform/cli 或设置 GLTF_TRANSFORM。');
  process.exit(1);
}

const models = ['player', 'reef', 'boat', 'zombie', 'm151', 'mutant', 'dino', 'wolf', 'stump', 'knife', 'rifle', 'jeep', 'cabin', 'medkit', 'rock', 'spider', 'croc'];
const rows = [];
let totalBefore = 0, totalAfter = 0;
for (const name of models) {
  const src = path.join(root, 'assets', name + '.glb');
  if (!fs.existsSync(src)) continue;
  const before = fs.statSync(src).size;
  const dst = path.join(OPT, name + '.glb');
  try {
    execFileSync(GT, ['optimize', src, dst,
      '--compress', 'false',          // 不引入 meshopt/draco decoder 依赖（vendor 未内置）
      '--texture-compress', 'webp',   // 浏览器与 three.js 原生支持
      '--texture-size', '1024',
      '--join', 'false',              // 保留原始节点/骨骼层级，避免 IK 与动画绑定失效
      '--flatten', 'false',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const after = fs.statSync(dst).size;
    rows.push({ 模型: name, 原MB: (before / 1048576).toFixed(2), 优化MB: (after / 1048576).toFixed(2), 节省: Math.round((1 - after / before) * 100) + '%' });
    totalBefore += before; totalAfter += after;
  } catch (e) {
    rows.push({ 模型: name, 原MB: (before / 1048576).toFixed(2), 优化MB: 'FAIL', 节省: String(e.stderr || e.message).slice(0, 40) });
  }
}

// HDR 天空降采样（2048×1024 → 1024×512）
const hdrSrc = path.join(root, 'assets', 'tex', 'sky.hdr');
const hdrDst = path.join(OPT, 'tex', 'sky.hdr');
if (fs.existsSync(hdrSrc)) {
  fs.mkdirSync(path.dirname(hdrDst), { recursive: true });
  try {
    execFileSync(process.execPath, [path.join(root, 'tools', 'shrink_hdr.mjs'), hdrSrc, hdrDst, '2'], { stdio: 'inherit' });
    const hb = fs.statSync(hdrSrc).size, ha = fs.statSync(hdrDst).size;
    totalBefore += hb; totalAfter += ha;
    rows.push({ 模型: 'sky.hdr', 原MB: (hb / 1048576).toFixed(2), 优化MB: (ha / 1048576).toFixed(2), 节省: Math.round((1 - ha / hb) * 100) + '%' });
  } catch (e) { console.error('HDR 压缩失败:', e.message); }
}

console.table(rows);
console.log(`合计: ${(totalBefore / 1048576).toFixed(1)} MB → ${(totalAfter / 1048576).toFixed(1)} MB  (节省 ${Math.round((1 - totalAfter / totalBefore) * 100)}%)`);
console.log('优化资产目录:', OPT);
