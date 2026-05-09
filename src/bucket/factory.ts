import type { BucketConfig } from '../config.ts';
import type { Bucket } from './types.ts';
import { FsBucket } from './fs.ts';

export function createBucket(cfg: BucketConfig): Bucket {
  switch (cfg.backend) {
    case 'fs':
      return new FsBucket(cfg.fs.root);
    default: {
      const exhaustive: never = cfg.backend;
      throw new Error(`bucket: unsupported backend '${exhaustive as string}'`);
    }
  }
}
