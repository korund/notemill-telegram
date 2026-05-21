import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

import type { Config, QueueConfig, BucketConfig, ReactionsConfig } from './schema.ts';
import { parseQueue, parseBucket, parseUserIds } from './schema.ts';
import { resolveSecret, decodeReaction } from './secrets.ts';
import { ConfigError, expectObject, expectString, expectNumber, expectBool, optString } from './util.ts';

export { ConfigError } from './util.ts';
export type { Config, QueueConfig, BucketConfig, ReactionsConfig } from './schema.ts';

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
