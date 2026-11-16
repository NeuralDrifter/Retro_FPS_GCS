import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

/**
 * A minimal static file server, standing in for a static host: it serves one folder under a
 * path prefix, with the content types such hosts send, and nothing else. The export tests
 * (release plan P3.7) start one per origin on a free port; e2e/serve-dist.ts serves the editor
 * build with it, in place of the much heavier `vite preview`.
 */

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

export interface StaticServer {
  origin: string;
  /** The folder's address, ending in `/` */
  url: string;
  close(): Promise<void>;
}

/** Serves `root` at `prefix` (which starts and ends with `/`) on `options.port`, or a free local port */
export async function serveFolder(root: string, prefix = '/', options: { port?: number } = {}): Promise<StaticServer> {
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    const notFound = () => {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    };
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (!pathname.startsWith(prefix)) return notFound();
    const relative = pathname.slice(prefix.length) || 'index.html';
    const file = path.resolve(base, relative.endsWith('/') ? `${relative}index.html` : relative);
    if (file !== base && !file.startsWith(base + path.sep)) return notFound();
    fs.readFile(file, (err, body) => {
      if (err) return notFound();
      res.writeHead(200, {
        'content-type': CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    url: `${origin}${prefix}`,
    // close() alone waits for every open connection, and a browser can keep sockets open after
    // its pages close; closing them makes shutdown finish at once
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
