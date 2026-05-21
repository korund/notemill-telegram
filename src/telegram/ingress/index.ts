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

import type { Config } from '../../config/index.ts';
import type { Queue } from '../../queue/types.ts';
import type { Bucket } from '../../bucket/types.ts';

import { handleAudio } from './handler.ts';
import { mkLog } from '../../log.ts';
import type { LanguageStore } from '../language_store.ts';

const log = mkLog('ingress');

export async function runIngress(
  cfg: Config,
  queue: Queue,
  bucket: Bucket,
  bot: Bot,
  signal: AbortSignal,
  store: LanguageStore,
): Promise<void> {
  const allowed = new Set(cfg.access.allowed_user_ids);

  // Deny-by-default allowlist. Silent ignore: no reply, no reaction, no
  // downstream work. Single WARN for telemetry.
  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (uid === undefined || !allowed.has(uid)) {
      if (uid !== undefined) {
        log.warn({ user_id: uid }, 'unauthorized user');
      }
      return;
    }
    await next();
  });

  bot.on(['message:voice', 'message:audio'], async (ctx) => {
    await handleAudio(ctx, cfg, queue, bucket, store);
  });

  bot.catch((err) => {
    log.warn({ err: err.error }, 'handler error');
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
      log.info(
        { host: cfg.webhook.listen_host, port: cfg.webhook.listen_port, path: cfg.webhook.path },
        'listening',
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
  log.info('stopped');
}
