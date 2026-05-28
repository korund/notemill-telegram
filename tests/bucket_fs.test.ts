import { describe, test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';

import { FsBucket } from '../src/bucket/fs.ts';
import { BucketAlreadyExists } from '../src/bucket/types.ts';

function streamOf(content: string | Buffer): Readable {
  return Readable.from([Buffer.from(content)]);
}

describe('FsBucket: streaming put', () => {
  let root: string;

  before(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'bucket-test-'));
  });

  after(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  test('writes the streamed content to the key', async () => {
    const bucket = new FsBucket(root);
    const res = await bucket.put('a/b/clip.ogg', streamOf('hello world'));

    const written = await fsp.readFile(path.join(root, 'a/b/clip.ogg'), 'utf8');
    assert.equal(written, 'hello world');
    assert.equal(res.key, 'a/b/clip.ogg');
  });

  test('reports size as the number of bytes actually written', async () => {
    const bucket = new FsBucket(root);
    const payload = Buffer.from('0123456789'); // 10 bytes
    // size hint intentionally wrong: result must reflect bytes streamed.
    const res = await bucket.put('sized.bin', streamOf(payload), { size: 999 });
    assert.equal(res.size, 10);
  });

  test('does not buffer the whole body: writes a multi-chunk stream', async () => {
    const bucket = new FsBucket(root);
    const chunks = [Buffer.from('aaa'), Buffer.from('bbb'), Buffer.from('ccc')];
    const res = await bucket.put('chunked.bin', Readable.from(chunks));

    const written = await fsp.readFile(path.join(root, 'chunked.bin'), 'utf8');
    assert.equal(written, 'aaabbbccc');
    assert.equal(res.size, 9);
  });

  test('raises BucketAlreadyExists on the second put to the same key', async () => {
    const bucket = new FsBucket(root);
    await bucket.put('dup.ogg', streamOf('first'));
    await assert.rejects(
      () => bucket.put('dup.ogg', streamOf('second')),
      (err: unknown) => err instanceof BucketAlreadyExists && err.key === 'dup.ogg',
    );
    // original content is preserved, not clobbered
    const written = await fsp.readFile(path.join(root, 'dup.ogg'), 'utf8');
    assert.equal(written, 'first');
  });

  test('rejects an absolute key', async () => {
    const bucket = new FsBucket(root);
    await assert.rejects(
      () => bucket.put(path.resolve('/etc/passwd'), streamOf('x')),
      /must be relative/,
    );
  });

  test('does not leave a temp file behind after a successful put', async () => {
    const bucket = new FsBucket(root);
    await bucket.put('clean.ogg', streamOf('data'));
    const entries = await fsp.readdir(root);
    assert.equal(entries.some((e) => e.includes('.tmp.')), false);
  });
});
