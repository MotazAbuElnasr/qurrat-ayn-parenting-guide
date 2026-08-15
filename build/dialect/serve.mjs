// docs/ at the root plus the one API the shell asks for, so the bundle can be
// counted in a real browser. wrangler dev is older than wrangler.jsonc here.
//   node serve.mjs [port]
import http from 'http';
import fs from 'fs';
import path from 'path';

const SELF = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(SELF, '..', '..');
const ROOT = path.join(REPO, 'docs');
const PORT = +(process.argv[2] || 8788);
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const available = () => fs.readdirSync(path.join(ROOT, 'content')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/dialect') {
    const av = available();
    const want = url.searchParams.get('d');
    const dialect = av.includes(want) ? want : (av.includes('eg') ? 'eg' : av[0]);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ dialect, available: av, from: want ? 'query' : 'default', country: null }));
  }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}/  · dialects: ${available().join(', ')}`));
