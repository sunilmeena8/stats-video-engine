import type { LocalStorage } from '@statsopedia/utils/node';
import type { Request, Response } from 'express';

import { notFound } from '../errors.js';

/**
 * Streams a stored file (with single byte-range support, so video players can seek). The
 * client never learns where the file lives; the download name is sanitized.
 */
export async function sendStorageFile(
  req: Request,
  res: Response,
  storage: LocalStorage,
  key: string,
  contentType: string,
  downloadName: string,
): Promise<void> {
  const size = await storage.size(key);
  if (size === null) throw notFound('File');
  const safeName = downloadName.replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120) || 'download';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(safeName)}`);

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
      return;
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    await pipe(storage.createReadStream(key, { start, end }), res);
    return;
  }
  res.setHeader('Content-Length', String(size));
  await pipe(storage.createReadStream(key), res);
}

function pipe(stream: NodeJS.ReadableStream, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on('error', reject);
    res.on('close', resolve);
    stream.pipe(res);
  });
}
