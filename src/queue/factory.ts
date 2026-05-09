import type { QueueConfig } from '../config.ts';
import type { Queue } from './types.ts';
import { SqliteQueue } from './sqlite.ts';

export function createQueue(cfg: QueueConfig): Queue {
  switch (cfg.backend) {
    case 'sqlite':
      return SqliteQueue.open(cfg.sqlite.path);
    default: {
      const exhaustive: never = cfg.backend;
      throw new Error(`queue: unsupported backend '${exhaustive as string}'`);
    }
  }
}
