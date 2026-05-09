// Backend-agnostic bucket interface.
//
// Backends today: fs. Planned: s3.
//
// Semantics: `put` places `bytes` at the logical `key` with no-clobber
// guarantee — calling `put` twice with the same `key` raises
// `BucketAlreadyExists` on the second call. Keys are relative, contract-
// defined paths (see docs/contract/bucket/audio-key.md); absolute paths
// are rejected.

export interface BucketPutResult {
  key: string;
  size: number;
}

export interface Bucket {
  put(key: string, bytes: Buffer | Uint8Array): Promise<BucketPutResult>;
}

export class BucketAlreadyExists extends Error {
  override readonly name = 'BucketAlreadyExists';
  constructor(public readonly key: string) {
    super(`bucket: key already exists: ${key}`);
  }
}
