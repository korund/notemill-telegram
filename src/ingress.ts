// Ingress loop: HTTP server hosting the Telegram webhook.
//
// Receives voice/audio messages, places bytes in the bucket, enqueues a
// TranscribeJob to the queue, and (optionally) sets the "queued" reaction.
//
// Authorization is deny-by-default: only updates whose `from.id` is in
// `cfg.access.allowed_user_ids` are processed; everything else is silently
// dropped. Telegram's secret_token is verified by grammY before any handler
// runs.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ulid } from 'ulid';
import { Bot, webhookCallback, type Context } from 'grammy';

import type { Config } from './config.ts';
import type { Queue } from './queue/types.ts';
import type { Bucket } from './bucket/types.ts';
import { BucketAlreadyExists } from './bucket/types.ts';
import { buildAudioKey, tgDedupKey, type TranscribeJob } from './wire.ts';

const TRANSCRIBE_QUEUE = 'transcribe';

export async function runIngress(
  cfg: Config,
  queue: Queue,
  bucket: Bucket,
  bot: Bot,
  signal: AbortSignal,
): Promise<void> {
  const allowed = new Set(cfg.access.allowed_user_ids);

  // Deny-by-default allowlist. Silent ignore: no reply, no reaction, no
  // downstream work. Single WARN for telemetry.
  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (uid === undefined || !allowed.has(uid)) {
      if (uid !== undefined) {
        process.stderr.write(`ingress: WARN unauthorized user_id=${uid}\n`);
      }
      return;
    }
    await next();
  });

  bot.on(['message:voice', 'message:audio'], async (ctx) => {
    await handleAudio(ctx, cfg, queue, bucket);
  });

  bot.catch((err) => {
    const e = err.error;
    const msg = e instanceof Error ? e.stack ?? e.message : String(e);
    process.stderr.write(`ingress: handler error: ${msg}\n`);
  });

  await bot.api.setWebhook(cfg.webhook.url, {
    secret_token: cfg.webhook.secret,
    allowed_updates: ['message'],
  });

  const handler = webhookCallback(bot, 'http', {
    secretToken: cfg.webhook.secret,
  });
  const server = createServer((req: IncomingMessage, res: ServerResponse): void => {
    if (req.url !== cfg.webhook.path || req.method !== 'POST') {
      res.statusCode = 404;
      res.end();
      return;
    }
    void handler(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.webhook.listen_port, cfg.webhook.listen_host, () => {
      process.stderr.write(
        `ingress: listening on ${cfg.webhook.listen_host}:${cfg.webhook.listen_port}${cfg.webhook.path}\n`,
      );
      resolve();
    });
  });

  await new Promise<void>((resolve) => {
    const onAbort = (): void => {
      server.close(() => resolve());
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
  process.stderr.write('ingress: stopped\n');
}

async function handleAudio(
  ctx: Context,
  cfg: Config,
  queue: Queue,
  bucket: Bucket,
): Promise<void> {
  const msg = ctx.message;
  if (!msg) return;
  const updateId = ctx.update.update_id;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const userId = ctx.from?.id;

  const file = await ctx.getFile();
  if (!file.file_path) {
    process.stderr.write(`ingress: file_path missing for update_id=${updateId}\n`);
    return;
  }

  const ext = extensionOf(file.file_path);
  const bytes = await downloadFile(cfg.telegram.bot_token, file.file_path);
  const audioKey = buildAudioKey(new Date(), ulid(), ext);

  try {
    await bucket.put(audioKey, bytes);
  } catch (err) {
    if (err instanceof BucketAlreadyExists) {
      process.stderr.write(`ingress: ulid collision on ${audioKey}, dropping update\n`);
      return;
    }
    throw err;
  }

  const job: TranscribeJob = {
    v: 1,
    type: 'transcribe',
    dedup_key: tgDedupKey(chatId, messageId),
    audio_key: audioKey,
    source: {
      kind: 'telegram',
      chat_id: chatId,
      message_id: messageId,
      update_id: updateId,
      ...(userId !== undefined ? { user_id: userId } : {}),
      received_at: new Date().toISOString(),
    },
  };
  await queue.enqueue(TRANSCRIBE_QUEUE, JSON.stringify(job));

  if (cfg.reactions.enabled) {
    try {
      await ctx.react(cfg.reactions.queued as Parameters<Context['react']>[0]);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      process.stderr.write(`ingress: setMessageReaction failed (queued): ${m}\n`);
    }
  }
}

async function downloadFile(token: string, filePath: string): Promise<Buffer> {
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`telegram: download ${filePath} failed: HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function extensionOf(filePath: string): string {
  const idx = filePath.lastIndexOf('.');
  if (idx < 0 || idx === filePath.length - 1) return 'bin';
  return filePath.slice(idx + 1).toLowerCase();
}
