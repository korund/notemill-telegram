import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { ConfigSchema } from './schema.ts';
import { resolveSecret, decodeReaction } from './secrets.ts';
import { ConfigError, isErrnoCode } from './util.ts';

export { ConfigError } from './util.ts';
export type { Config, QueueConfig, BucketConfig, ReactionsConfig } from './types.ts';

const DEFAULT_REACTION_QUEUED = 'U+270D';
const DEFAULT_REACTION_DONE = 'U+1F44D';
const DEFAULT_REACTION_ERROR = 'U+1F44E';
const DEFAULT_REACTION_NO_SPEECH = 'U+1F442';

export function loadConfig(yamlPath: string, overrides: string[] = []): z.infer<typeof ConfigSchema> {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(yamlPath, 'utf8'));
  } catch (err) {
    if (isErrnoCode(err, 'ENOENT')) {
      throw new ConfigError(`config: file not found: ${yamlPath}`);
    }
    throw new ConfigError(`config: failed to read ${yamlPath}: ${(err as Error).message}`);
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError(`config: ${yamlPath} is empty or not a mapping`);
  }

  let doc = raw as Record<string, unknown>;
  if (overrides.length > 0) {
    doc = applyOverrides(doc, overrides);
  }

  // Resolve secrets and decode reactions before schema validation.
  // These steps read external state (files, env vars) and inject the results
  // into the raw document so that ConfigSchema sees plain string values.
  const resolved = resolveRaw(doc);

  const result = ConfigSchema.safeParse(resolved);
  if (!result.success) throw toConfigError(result.error);
  return result.data;
}

// Build the fully-resolved raw object for safeParse.
// Secrets are read from files/env. Reactions are decoded from U+XXXX notation.
function resolveRaw(doc: Record<string, unknown>): unknown {
  const telegram = asObject(doc, 'telegram');
  const webhook = asObject(doc, 'webhook');
  const queue = asObject(doc, 'queue');
  const bucket = asObject(doc, 'bucket');
  const access = asObject(doc, 'access');
  const reactions = asObject(doc, 'reactions');

  const botToken = resolveSecret('telegram.bot_token', telegram, 'bot_token_file', 'bot_token_env');
  const webhookSecret = resolveSecret('webhook.secret', webhook, 'secret_file', 'secret_env');

  const webhookUrl = asString(webhook, 'url', 'webhook.url');
  if (webhookUrl === 'CHANGE_ME') {
    throw new ConfigError('config: webhook.url must be set to a public URL');
  }

  let webhookPath: string;
  try {
    webhookPath = new URL(webhookUrl).pathname;
  } catch {
    throw new ConfigError(`config: webhook.url is not a valid URL: ${webhookUrl}`);
  }

  return {
    telegram: { bot_token: botToken },
    webhook: {
      url: webhookUrl,
      listen_host: asString(webhook, 'listen_host', 'webhook.listen_host'),
      listen_port: webhook['listen_port'],
      path: webhookPath,
      secret: webhookSecret,
    },
    queue,
    bucket,
    access,
    reactions: {
      enabled: reactions['enabled'],
      queued: decodeReaction(optStr(reactions, 'queued'), DEFAULT_REACTION_QUEUED),
      done: decodeReaction(optStr(reactions, 'done'), DEFAULT_REACTION_DONE),
      error: decodeReaction(optStr(reactions, 'error'), DEFAULT_REACTION_ERROR),
      no_speech: decodeReaction(optStr(reactions, 'no_speech'), DEFAULT_REACTION_NO_SPEECH),
    },
  };
}

// --- minimal raw-object helpers (pre-schema, no Zod) ---

function asObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError(`config: ${key} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function asString(parent: Record<string, unknown>, key: string, label: string): string {
  const value = parent[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError(`config: ${label} must be a non-empty string`);
  }
  return value;
}

function optStr(parent: Record<string, unknown>, key: string): string | undefined {
  const value = parent[key];
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}

// Map ZodError to ConfigError with the first issue path + message.
function toConfigError(err: z.ZodError): ConfigError {
  const issue = err.issues[0];
  const path = issue?.path.join('.') ?? '';
  const msg = issue?.message ?? 'invalid config';
  return new ConfigError(`config: ${path}${path ? ': ' : ''}${msg}`);
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
