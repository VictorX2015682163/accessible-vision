/* 慧眼 本地测试服务器
 * - 默认 HTTP (localhost 下摄像头可用)
 * - 若存在 cert.pem / key.pem 则自动启用 HTTPS(手机通过局域网 IP 访问摄像头必须 HTTPS)
 * 用法: node server.js  然后手机与电脑连同一 WiFi,访问打印出的地址
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 8443;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

function handler(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('403'); }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // PWA / 摄像头需要的安全响应头
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

function localIPs() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name]) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

const certPath = path.join(ROOT, 'cert.pem');
const keyPath = path.join(ROOT, 'key.pem');
let server, scheme;

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  server = https.createServer(
    { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) },
    handler
  );
  scheme = 'https';
} else {
  server = http.createServer(handler);
  scheme = 'http';
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n慧眼服务器已启动:\n');
  console.log(`  本机:  ${scheme}://localhost:${PORT}`);
  for (const ip of localIPs()) console.log(`  手机:  ${scheme}://${ip}:${PORT}`);
  if (scheme === 'http') {
    console.log('\n⚠️  当前为 HTTP。手机用局域网 IP 访问时摄像头会被浏览器拦截。');
    console.log('    解决方案(任选其一):');
    console.log('    1) 生成自签证书启用 HTTPS:');
    console.log('       openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=huiyan"');
    console.log('    2) 用 ngrok 转发:  ngrok http ' + PORT);
    console.log('    3) 部署到 Netlify / Vercel / GitHub Pages(自带 HTTPS)。\n');
  } else {
    console.log('\n✅ HTTPS 已启用,手机可直接用摄像头(首次访问需信任自签证书)。\n');
  }
});
