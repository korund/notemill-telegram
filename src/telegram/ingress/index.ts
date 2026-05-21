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
import { Bot, webhookCallback } from 'grammy';

import type { Config } from '../../config';
import type { Queue } from '../../queue/types.ts';
import type { Bucket } from '../../bucket/types.ts';

import { handleAudio } from './handler.ts';


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
