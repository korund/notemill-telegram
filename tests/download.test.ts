import { describe, test, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { ReadableStream } from 'node:stream/web';

import { downloadFile, extensionOf } from '../src/telegram/ingress/download.ts';

const realFetch = globalThis.fetch;

function webStreamOf(content: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(content);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function fakeResponse(opts: {
  ok?: boolean;
  status?: number;
  contentLength?: string | null;
  body?: ReadableStream<Uint8Array> | null;
}): Response {
  const headers = new Map<string, string>();
  if (opts.contentLength != null) headers.set('content-length', opts.contentLength);
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    body: opts.body === undefined ? webStreamOf('audio-bytes') : opts.body,
  } as unknown as Response;
}

describe('downloadFile', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('returns a stream and the Content-Length size', async () => {
    globalThis.fetch = (async () =>
      fakeResponse({ contentLength: '11' })) as typeof fetch;

    const { stream, size } = await downloadFile('tok', 'voice/file_1.ogg');
    assert.equal(size, 11);

    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    assert.equal(Buffer.concat(chunks).toString(), 'audio-bytes');
  });

  test('returns undefined size when Content-Length is absent', async () => {
    globalThis.fetch = (async () =>
      fakeResponse({ contentLength: null })) as typeof fetch;

    const { size } = await downloadFile('tok', 'voice/file_1.ogg');
    assert.equal(size, undefined);
  });

  test('throws on a non-ok response', async () => {
    globalThis.fetch = (async () =>
      fakeResponse({ ok: false, status: 404 })) as typeof fetch;

    await assert.rejects(() => downloadFile('tok', 'voice/missing.ogg'), /HTTP 404/);
  });

  test('throws when the response has no body', async () => {
    globalThis.fetch = (async () =>
      fakeResponse({ body: null })) as typeof fetch;

    await assert.rejects(() => downloadFile('tok', 'voice/empty.ogg'), /no body/);
  });
});

describe('extensionOf', () => {
  test('lowercases the extension', () => {
    assert.equal(extensionOf('voice/FILE.OGG'), 'ogg');
  });

  test('falls back to bin when there is no extension', () => {
    assert.equal(extensionOf('voice/file'), 'bin');
    assert.equal(extensionOf('voice/file.'), 'bin');
  });
});
