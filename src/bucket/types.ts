// Backend-agnostic bucket interface.
//
// Backends today: fs. Planned: s3.
//
// Semantics: `put` streams `body` to the logical `key` with no-clobber
// guarantee -- calling `put` twice with the same `key` raises
// `BucketAlreadyExists` on the second call. Keys are relative, contract-
// defined paths (see docs/contract/bucket/audio-key.md); absolute paths
// are rejected.
//
// `body` is a stream so peak memory does not scale with object size. The
// optional `size` hint carries the known content length (e.g. Telegram's
// file_size): the fs backend ignores it, but an object-store backend uses
// it to issue a single sized PutObject instead of a multipart upload.

import type { Readable } from 'node:stream';

export interface BucketPutOptions {
  size?: number;
}

export interface BucketPutResult {
  key: string;
  size: number;
}

export interface Bucket {
  put(key: string, body: Readable, opts?: BucketPutOptions): Promise<BucketPutResult>;
}

export class BucketAlreadyExists extends Error {
  override readonly name = 'BucketAlreadyExists';
  constructor(public readonly key: string) {
    super(`bucket: key already exists: ${key}`);
  }
}
