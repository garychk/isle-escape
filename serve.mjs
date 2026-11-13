// 本地静态服务器：多文件版必须走 http（file:// 下 fetch 资产会被 CORS 拦截）
//   node serve.mjs
//   游玩版  http://localhost:8137/            → dist/index.html
//   开发版  http://localhost:8137/index.html  → 根目录 index.html（src 直跑，改完刷新即生效）
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { join, normalize, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const argPort = process.argv.includes('--port') ? Number(process.argv[process.argv.indexOf('--port') + 1]) : 0;
const PORT = argPort || Number(process.env.PORT) || 8137;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.fbx': 'application/octet-stream', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/' || p === '/dist' || p === '/dist/') p = '/dist/index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT + sep) && file !== ROOT) { res.writeHead(403); return res.end('403'); }
    const st = await stat(file).catch(() => null);
    if (!st || st.isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500); res.end('500 ' + e.message);
  }
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n[错误] 端口 ${PORT} 已被占用——多半是服务器已经在跑了。`);
    console.error(`  直接打开 http://localhost:${PORT}/ 即可游玩。`);
    console.error(`  要换端口启动：npm run serve -- --port 8138  或  PORT=8138 node serve.mjs\n`);
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, () => {
  console.log('isle-escape 本地服务器已启动');
  console.log('  游玩版  http://localhost:' + PORT + '/');
  console.log('  开发版  http://localhost:' + PORT + '/index.html   (src 直跑，无需 build)');
});
