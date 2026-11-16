import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import type { LocalStorage, Logger } from '@statsopedia/utils/node';

const CONTENT_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

export interface AssetServer {
  /** e.g. `http://127.0.0.1:53211`; `storage:assets/x` becomes `<baseUrl>/assets/x`. */
  baseUrl: string;
  close(): Promise<void>;
}

/**
 * Read-only HTTP server for `storage/assets/` on 127.0.0.1, so the headless browser can load
 * uploaded music, logos and images during a render. Serves nothing outside `assets/`, supports
 * byte ranges (audio elements use them) and only GET/HEAD.
 */
export async function startAssetServer(
  storage: LocalStorage,
  logger: Logger,
): Promise<AssetServer> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const key = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      if (!key.startsWith('assets/')) {
        res.writeHead(404).end();
        return;
      }
      let size: number | null;
      try {
        size = await storage.size(key); // also rejects traversal outside the storage root
      } catch {
        size = null;
      }
      if (size === null) {
        res.writeHead(404).end();
        return;
      }
      const headers = {
        'content-type':
          CONTENT_TYPES[path.extname(key).toLowerCase()] ?? 'application/octet-stream',
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
      };
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start > end || start >= size) {
          res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
          return;
        }
        res.writeHead(206, {
          ...headers,
          'content-length': end - start + 1,
          'content-range': `bytes ${start}-${end}/${size}`,
        });
        if (req.method === 'HEAD') res.end();
        else storage.createReadStream(key, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { ...headers, 'content-length': size });
      if (req.method === 'HEAD') res.end();
      else storage.createReadStream(key).pipe(res);
    })().catch((error: unknown) => {
      logger.warn({ err: error }, 'Asset server error');
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
