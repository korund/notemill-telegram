import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

export interface DownloadResult {
  stream: Readable;
  // Content length advertised by Telegram, when present. Undefined if the
  // response omits Content-Length; callers may fall back to getFile's
  // file_size.
  size: number | undefined;
}

export async function downloadFile(token: string, filePath: string): Promise<DownloadResult> {
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`telegram: download ${filePath} failed: HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error(`telegram: download ${filePath} returned no body`);
  }
  const header = res.headers.get('content-length');
  const size = header !== null && header !== '' ? Number(header) : undefined;
  const stream = Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
  return { stream, size: Number.isFinite(size) ? size : undefined };
}

export function extensionOf(filePath: string): string {
  const idx = filePath.lastIndexOf('.');
  if (idx < 0 || idx === filePath.length - 1) return 'bin';
  return filePath.slice(idx + 1).toLowerCase();
}
