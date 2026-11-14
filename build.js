// 打包：esbuild → bundle.js → 内联单文件 dist/isle-escape.html
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = __dirname;
const esbuild = path.resolve(__dirname, '..', 'qa', 'node_modules', 'esbuild', 'bin', 'esbuild');
const minify = !process.argv.includes('--dev');

execFileSync(process.execPath, [esbuild,
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

// —— 资产：多文件模式直接拷贝；--single 模式才内联成 data URI ——
const KNOWN = ['player', 'robot', 'rifle', 'knife', 'jeep', 'm151', 'cabin', 'medkit', 'boat', 'rock', 'dino', 'mutant', 'wolf', 'stump', 'zombie'];
const single = process.argv.includes('--single');
const assetData = {};
const audioData = {};
if (single) {
  const dir = path.join(root, 'assets');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.glb')) {
        const name = f.slice(0, -4);
        if (!KNOWN.includes(name)) continue;
        assetData[name] = 'data:model/gltf-binary;base64,' +
          fs.readFileSync(path.join(dir, f)).toString('base64');
      } else if (f.endsWith('.ogg') || f.endsWith('.mp3')) {
        const mime = f.endsWith('.mp3') ? 'audio/mpeg' : 'audio/ogg';
        audioData[f] = 'data:' + mime + ';base64,' + fs.readFileSync(path.join(dir, f)).toString('base64');
      }
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
  // 递归拷贝整棵 assets/（含 tex/ 子目录），以后新增素材无需改构建脚本
  const copyTree = (src, dst) => {
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const sp = path.join(src, e.name), dp = path.join(dst, e.name);
      if (e.isDirectory()) { copyTree(sp, dp); continue; }
      if (/^_/.test(e.name) || /\.(blend|tmp|bak|psd)$/i.test(e.name)) continue;
      fs.copyFileSync(sp, dp);
      copied++; bytes += fs.statSync(sp).size;
    }
  };
  copyTree(sdir, adir);
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
