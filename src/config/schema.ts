import { ConfigError, expectObject, expectString, expectNumber } from './util.ts';

export interface QueueConfig {
  backend: 'sqlite';
  poll_interval_ms: number;
  sqlite: { path: string };
}

export interface BucketConfig {
  backend: 'fs';
  fs: { root: string };
}

export interface ReactionsConfig {
  enabled: boolean;
  queued: string;
  done: string;
  error: string;
  no_speech: string;
}

export interface Config {
  telegram: { bot_token: string };
  webhook: {
    url: string;
    listen_host: string;
    listen_port: number;
    path: string;
    secret: string;
  };
  queue: QueueConfig;
  bucket: BucketConfig;
  access: { allowed_user_ids: number[] };
  reactions: ReactionsConfig;
}

export function parseQueue(raw: Record<string, unknown>): QueueConfig {
  const backend = expectString(raw, 'queue.backend', 'backend');
  if (backend !== 'sqlite') {
    throw new ConfigError(`config: queue.backend "${backend}" not supported (only "sqlite")`);
  }
  const sqlite = expectObject(raw, 'sqlite', 'queue.sqlite');
  return {
    backend,
    poll_interval_ms: expectNumber(raw, 'queue.poll_interval_ms', 'poll_interval_ms'),
    sqlite: { path: expectString(sqlite, 'queue.sqlite.path', 'path') },
  };
}

export function parseBucket(raw: Record<string, unknown>): BucketConfig {
  const backend = expectString(raw, 'bucket.backend', 'backend');
  if (backend !== 'fs') {
    throw new ConfigError(`config: bucket.backend "${backend}" not supported (only "fs")`);
  }
  const fs = expectObject(raw, 'fs', 'bucket.fs');
  return { backend, fs: { root: expectString(fs, 'bucket.fs.root', 'root') } };
}

export function parseUserIds(raw: Record<string, unknown>): number[] {
  const value = raw['allowed_user_ids'];
  if (!Array.isArray(value)) {
    throw new ConfigError('config: access.allowed_user_ids must be a list');
  }
  return value.map((entry, idx) => {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) {
      throw new ConfigError(
        `config: access.allowed_user_ids[${idx}] must be an integer, got ${typeof entry}`,
      );
    }
    return entry;
  });
}
