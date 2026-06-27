import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const proxyBase = process.env.API_PROXY_URL || 'http://test-new-api:3000/v1';
const port = Number(process.env.PORT || 80);

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
]);

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function staticHeaders(filePath) {
  const headers = { 'Referrer-Policy': 'unsafe-url' };
  headers['Content-Type'] = mime.get(path.extname(filePath)) || 'application/octet-stream';
  if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  }
  return headers;
}

async function serveStatic(req, res) {
  const rawPath = new URL(req.url || '/', 'http://localhost').pathname;
  const decoded = decodeURIComponent(rawPath);
  let filePath = path.normalize(path.join(root, decoded));
  if (!filePath.startsWith(root)) return send(res, 403, 'Forbidden');
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    await fs.access(filePath);
  } catch {
    filePath = path.join(root, 'index.html');
  }
  res.writeHead(200, staticHeaders(filePath));
  createReadStream(filePath).pipe(res);
}

async function proxy(req, res) {
  if (req.method === 'OPTIONS') {
    return send(res, 204, '', {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'authorization,content-type',
    });
  }
  if (req.method !== 'POST') return send(res, 405, 'Method Not Allowed');
  const suffix = (req.url || '').replace(/^\/api-proxy\/?/, '');
  if (!suffix) return send(res, 403, 'Forbidden: API Proxy path required');
  const upstream = new URL(proxyBase.replace(/\/$/, '') + '/' + suffix);
  const headers = { ...req.headers };
  delete headers.host;
  try {
    const upstreamRes = await fetch(upstream, {
      method: req.method,
      headers,
      body: req,
      duplex: 'half',
    });
    const responseHeaders = {};
    for (const [key, value] of upstreamRes.headers) {
      const lower = key.toLowerCase();
      if (['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive'].includes(lower)) continue;
      responseHeaders[key] = value;
    }
    responseHeaders['Cache-Control'] = 'no-store';
    res.writeHead(upstreamRes.status, responseHeaders);
    if (upstreamRes.body) {
      for await (const chunk of upstreamRes.body) res.write(chunk);
    }
    res.end();
  } catch (err) {
    send(res, 502, JSON.stringify({ error: { message: String(err?.message || err), type: 'proxy_error' } }), {
      'Content-Type': 'application/json; charset=utf-8',
    });
  }
}

http.createServer((req, res) => {
  if ((req.url || '').startsWith('/api-proxy/')) return proxy(req, res);
  return serveStatic(req, res);
}).listen(port, '0.0.0.0', () => {
  console.log(`gpt-image-playground listening on ${port}, proxy=${proxyBase}`);
});
