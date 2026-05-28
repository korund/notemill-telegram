// Filesystem bucket: atomic, no-clobber put per docs/contract.md section 5.2.
//
// Strategy:
//   1. Stream the body into a temporary file: `{target}.tmp.{pid}.{rand}`
//      with exclusive-create flag (so two concurrent producers cannot pick
//      the same temp). Streaming keeps peak memory independent of size.
//   2. fs.link(tmp, target) -- link() fails with EEXIST if `target` already
//      exists, giving us no-clobber semantics atomically.
//   3. fs.unlink(tmp) to drop the temp; the target keeps the only remaining
//      link.
//
// link()-then-unlink is preferred over rename() because rename() on most
// platforms silently replaces an existing destination, which would violate
// the contract's AlreadyExists guard.

import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  BucketAlreadyExists,
  type Bucket,
  type BucketPutOptions,
  type BucketPutResult,
} from './types.ts';

export class FsBucket implements Bucket {
  constructor(private readonly root: string) {}

  async put(
    key: string,
    body: Readable,
    _opts?: BucketPutOptions,
  ): Promise<BucketPutResult> {
    if (path.isAbsolute(key)) {
      throw new Error(`bucket: audio_key must be relative, got absolute: ${key}`);
    }

    const target = path.join(this.root, key);
    const dir = path.dirname(target);
    await fsp.mkdir(dir, { recursive: true });

    const rand = randomBytes(6).toString('hex');
    const tmp = `${target}.tmp.${process.pid}.${rand}`;

    // wx => fail if temp already exists (paranoid; pid+rand collision is
    // essentially zero). Count bytes as they flow so size reflects what was
    // actually written, not a possibly-stale hint.
    let size = 0;
    body.on('data', (chunk: Buffer) => {
      size += chunk.length;
    });
    const sink = createWriteStream(tmp, { flags: 'wx' });
    try {
      await pipeline(body, sink);
    } catch (err) {
      await fsp.unlink(tmp).catch(() => undefined);
      throw err;
    }

    try {
      await fsp.link(tmp, target);
    } catch (err) {
      await fsp.unlink(tmp).catch(() => undefined);
      if (isErrnoCode(err, 'EEXIST')) {
        throw new BucketAlreadyExists(key);
      }
      throw err;
    }

    await fsp.unlink(tmp).catch(() => undefined);

    return { key, size };
  }
}

function isErrnoCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === code
  );
}
