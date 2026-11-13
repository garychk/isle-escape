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

// —— 把 assets/*.glb 内联成 data URI，保证 dist 仍是单文件（无需服务器） ——
const KNOWN = ['player', 'robot', 'rifle', 'knife', 'jeep', 'm151', 'cabin', 'medkit', 'boat', 'rock', 'dino', 'mutant', 'wolf', 'stump', 'zombie'];
const assetData = {};
if (!process.argv.includes('--no-assets')) {
  const dir = path.join(root, 'assets');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.glb')) continue;
      const name = f.slice(0, -4);
      if (!KNOWN.includes(name)) continue;
      assetData[name] = 'data:model/gltf-binary;base64,' +
        fs.readFileSync(path.join(dir, f)).toString('base64');
    }
  }
}
const assetScript = Object.keys(assetData).length
  ? `<script>window.__ASSET_DATA__=${JSON.stringify(assetData)}</script>\n`
  : '';

const out = html
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/m, '')
  .replace(/<script type="module" src="\.\/src\/main\.js"><\/script>/m, () => assetScript + `<script>\n${js}\n</script>`);

const dist = path.join(root, 'dist');
if (!fs.existsSync(dist)) fs.mkdirSync(dist);
fs.writeFileSync(path.join(dist, 'isle-escape.html'), out);
console.log('written:', path.join(dist, 'isle-escape.html'), (out.length / 1024 / 1024).toFixed(2) + ' MB');
