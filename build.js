// 打包：esbuild → bundle.js → 内联单文件 dist/isle-escape.html
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = __dirname;
// esbuild 查找顺序：项目本地 → 原 qa 目录 → 环境变量指定（换机器时用 ESBUILD_PATH 指定）
const esbuildCandidates = [
  path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild'),
  path.resolve(root, '..', 'qa', 'node_modules', 'esbuild', 'bin', 'esbuild'),
  process.env.ESBUILD_PATH,
].filter(Boolean);
const esbuild = esbuildCandidates.find(p => fs.existsSync(p));
if (!esbuild) {
  console.error('找不到 esbuild。请执行 npm install esbuild，或设置 ESBUILD_PATH 指向 esbuild 可执行文件。');
  process.exit(1);
}
const minify = !process.argv.includes('--dev');

// esbuild 的 bin/esbuild 是原生二进制，直接执行（不要 node 包一层）
execFileSync(esbuild, [
  path.join(root, 'src', 'main.js'),
  '--bundle',
  '--format=iife',
  '--target=es2020',
  '--alias:three=' + path.join(root, 'vendor', 'three.module.js'),
  ...(minify ? ['--minify'] : []),
  '--outfile=' + path.join(root, 'bundle.js'),
], { stdio: 'inherit' });

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'bundle.js'), 'utf8');

// —— 资产：优先使用 assets_opt/（tools/optimize_assets.mjs 生成的压缩版），
//    没有时用原始 assets/。原始文件保留可回退 ——
const optRoot = path.join(root, 'assets_opt');
const useOpt = fs.existsSync(optRoot);
const glbDir = useOpt ? optRoot : path.join(root, 'assets');
const KNOWN = ['player', 'robot', 'rifle', 'knife', 'jeep', 'm151', 'cabin', 'medkit', 'boat', 'rock', 'dino', 'mutant', 'wolf', 'stump', 'zombie', 'reef'];
const single = process.argv.includes('--single');
const assetData = {};
const audioData = {};
if (single) {
  const dir = glbDir;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.glb')) {
        const name = f.slice(0, -4);
        if (!KNOWN.includes(name)) continue;
        assetData[name] = 'data:model/gltf-binary;base64,' +
          fs.readFileSync(path.join(dir, f)).toString('base64');
      }
    }
  }
  // 音频仍在原始 assets/（未优化）
  const adir = path.join(root, 'assets');
  for (const f of fs.readdirSync(adir)) {
    if (f.endsWith('.ogg') || f.endsWith('.mp3')) {
      const mime = f.endsWith('.mp3') ? 'audio/mpeg' : 'audio/ogg';
      audioData[f] = 'data:' + mime + ';base64,' + fs.readFileSync(path.join(adir, f)).toString('base64');
    }
  }
}
const assetScript = single
  ? `<script>window.__ASSET_DATA__=${JSON.stringify(assetData)};window.__AUDIO_DATA__=${JSON.stringify(audioData)}</script>\n`
  : '';

const stripImportMap = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/m, '');

const dist = path.join(root, 'dist');
if (!fs.existsSync(dist)) fs.mkdirSync(dist);

if (!single) {
  // —— 多文件模式：dist/ = index.html + bundle.js + assets/（可读性/可扩展性优先） ——
  const outMulti = stripImportMap.replace(
    /<script type="module" src="\.\/src\/main\.js"><\/script>/m,
    '<script src="bundle.js"></script>'
  );
  fs.writeFileSync(path.join(dist, 'index.html'), outMulti);
  fs.writeFileSync(path.join(dist, 'bundle.js'), js);
  const adir = path.join(dist, 'assets');
  const sdir = path.join(root, 'assets');
  let copied = 0, bytes = 0;
  // 递归拷贝整棵 assets/。GLB 与 tex/ 若有优化版则从 assets_opt/ 取，
  // 音频等其他文件仍取原始 assets/。
  const copyTree = (src, dst, optSrc) => {
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const sp = path.join(src, e.name), dp = path.join(dst, e.name);
      const op = optSrc ? path.join(optSrc, e.name) : null;
      const hasOpt = op && fs.existsSync(op);
      if (e.isDirectory()) { copyTree(sp, dp, hasOpt ? op : null); continue; }
      if (/^_/.test(e.name) || /\.(blend|tmp|bak|psd)$/i.test(e.name)) continue;
      const from = hasOpt && (e.name.endsWith('.glb') || src.endsWith('tex')) ? op : sp;
      fs.copyFileSync(from, dp);
      copied++; bytes += fs.statSync(from).size;
    }
  };
  copyTree(sdir, adir, useOpt ? optRoot : null);
  console.log(`written: ${dist} (index.html + bundle.js + ${copied} 个资产文件, ${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  console.log('启动: node serve.mjs  →  http://localhost:8137/');
} else {
  const out = stripImportMap.replace(
    /<script type="module" src="\.\/src\/main\.js"><\/script>/m,
    () => assetScript + `<script>\n${js}\n</script>`
  );
  fs.writeFileSync(path.join(dist, 'isle-escape.html'), out);
  console.log('written:', path.join(dist, 'isle-escape.html'), (out.length / 1024 / 1024).toFixed(2) + ' MB');
}
