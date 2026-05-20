import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

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

const DEFAULT_REACTION_QUEUED = 'U+270D';
const DEFAULT_REACTION_DONE = 'U+1F44D';
const DEFAULT_REACTION_ERROR = 'U+1F44E';
const DEFAULT_REACTION_NO_SPEECH = 'U+1F442';

export function loadConfig(yamlPath: string, overrides: string[] = []): Config {
  let raw = parseYaml(readFileSync(yamlPath, 'utf8')) as Record<string, unknown>;
  if (overrides.length > 0) {
    raw = applyOverrides(raw, overrides);
  }
  if (!raw || typeof raw !== 'object') {
    throw new ConfigError(`config: ${yamlPath} is empty or not a mapping`);
  }

  const telegramRaw = expectObject(raw, 'telegram');
  const webhookRaw = expectObject(raw, 'webhook');
  const queueRaw = expectObject(raw, 'queue');
  const bucketRaw = expectObject(raw, 'bucket');
  const accessRaw = expectObject(raw, 'access');
  const reactionsRaw = expectObject(raw, 'reactions');

  const botToken = resolveSecret('telegram.bot_token', telegramRaw, 'bot_token_file', 'bot_token_env');
  const webhookSecret = resolveSecret('webhook.secret', webhookRaw, 'secret_file', 'secret_env');

  const webhookUrl = expectString(webhookRaw, 'webhook.url', 'url');
  if (webhookUrl === 'CHANGE_ME') {
    throw new ConfigError('config: webhook.url must be set to a public URL');
  }

  const queue = parseQueue(queueRaw);
  const bucket = parseBucket(bucketRaw);

  const reactions: ReactionsConfig = {
    enabled: expectBool(reactionsRaw, 'reactions.enabled', 'enabled'),
    queued: decodeReaction(optString(reactionsRaw, 'queued'), DEFAULT_REACTION_QUEUED),
    done: decodeReaction(optString(reactionsRaw, 'done'), DEFAULT_REACTION_DONE),
    error: decodeReaction(optString(reactionsRaw, 'error'), DEFAULT_REACTION_ERROR),
    no_speech: decodeReaction(
      optString(reactionsRaw, 'no_speech'),
      DEFAULT_REACTION_NO_SPEECH,
    ),
  };

  return {
    telegram: { bot_token: botToken },
    webhook: {
      url: webhookUrl,
      listen_host: expectString(webhookRaw, 'webhook.listen_host', 'listen_host'),
      listen_port: expectNumber(webhookRaw, 'webhook.listen_port', 'listen_port'),
      path: new URL(webhookUrl).pathname,
      secret: webhookSecret,
    },
    queue,
    bucket,
    access: { allowed_user_ids: parseUserIds(accessRaw) },
    reactions,
  };
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

function parseQueue(raw: Record<string, unknown>): QueueConfig {
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

function parseBucket(raw: Record<string, unknown>): BucketConfig {
  const backend = expectString(raw, 'bucket.backend', 'backend');
  if (backend !== 'fs') {
    throw new ConfigError(`config: bucket.backend "${backend}" not supported (only "fs")`);
  }
  const fs = expectObject(raw, 'fs', 'bucket.fs');
  return { backend, fs: { root: expectString(fs, 'bucket.fs.root', 'root') } };
}

function parseUserIds(raw: Record<string, unknown>): number[] {
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

function resolveSecret(
  label: string,
  block: Record<string, unknown>,
  fileKey: string,
  envKey: string,
): string {
  const filePath = optString(block, fileKey);
  if (filePath) {
    try {
      const value = readFileSync(filePath, 'utf8').trim();
      if (value) return value;
    } catch (err) {
      if (!isErrnoCode(err, 'ENOENT')) {
        throw new ConfigError(`config: ${label}: failed to read ${filePath}: ${(err as Error).message}`);
      }
    }
  }
  const envName = optString(block, envKey);
  if (envName) {
    const value = process.env[envName];
    if (value && value.length > 0) return value;
  }
  throw new ConfigError(
    `config: ${label} not set; provide ${fileKey} (readable file) or ${envKey} (non-empty env var)`,
  );
}

function expectObject(
  parent: Record<string, unknown>,
  key: string,
  label = key,
): Record<string, unknown> {
  const value = parent[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError(`config: ${label} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function expectString(parent: Record<string, unknown>, label: string, key: string): string {
  const value = parent[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError(`config: ${label} must be a non-empty string`);
  }
  return value;
}

function expectNumber(parent: Record<string, unknown>, label: string, key: string): number {
  const value = parent[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(`config: ${label} must be a number`);
  }
  return value;
}

function expectBool(parent: Record<string, unknown>, label: string, key: string): boolean {
  const value = parent[key];
  if (typeof value !== 'boolean') {
    throw new ConfigError(`config: ${label} must be a boolean`);
  }
  return value;
}

function optString(parent: Record<string, unknown>, key: string): string | undefined {
  const value = parent[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  return value.length > 0 ? value : undefined;
}

function isErrnoCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === code;
}

function applyOverrides(
  raw: Record<string, unknown>,
  overrides: string[],
): Record<string, unknown> {
  const root: Record<string, unknown> = structuredClone(raw);
  for (const entry of overrides) {
    const eq = entry.indexOf('=');
    if (eq < 1) {
      throw new ConfigError(`--set: expected key=value, got '${entry}'`);
    }
    const key = entry.slice(0, eq);
    const valStr = entry.slice(eq + 1);
    let parsed: unknown;
    try {
      parsed = parseYaml(valStr);
    } catch {
      throw new ConfigError(`--set ${key}: invalid YAML value '${valStr}'`);
    }
    setDottedKey(root, key, parsed);
  }
  return root;
}

function setDottedKey(root: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  const last = parts.at(-1);
  if (!last) return;
  let cur: Record<string, unknown> = root;
  for (const part of parts.slice(0, -1)) {
    if (cur[part] === null || cur[part] === undefined || typeof cur[part] !== 'object') {
      cur[part] = {};
    }
    cur = cur[part] as Record<string, unknown>;
  }
  cur[last] = value;
}

// Reaction strings may be written either as a literal emoji
// ("\u{1F440}" in code, or the actual character in YAML) or as one or more
// `U+XXXX` codepoints separated by whitespace (e.g. "U+1F440" for the eyes
// emoji, "U+2764 U+200D U+1F525" for heart-on-fire). The U+ form lets the
// config file stay ASCII-only.
const UPLUS_TOKEN = /^U\+[0-9A-Fa-f]{1,6}$/;
function decodeReaction(raw: string | undefined, fallback: string): string {
  const value = raw ?? fallback;
  const tokens = value.trim().split(/\s+/);
  if (tokens.length > 0 && tokens.every((t) => UPLUS_TOKEN.test(t))) {
    return tokens.map((t) => String.fromCodePoint(parseInt(t.slice(2), 16))).join('');
  }
  return value;
}
