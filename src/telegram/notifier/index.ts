// Notifier loop: drains queue_notifications and updates Telegram reactions.
//
// For each NotifyResult:
//   - status=ok        -> set the `done` reaction on the original message.
//   - status=error     -> set the `error` reaction and reply with a short
//                         text containing the error_code and a truncated
//                         error_msg.
//   - status=no_speech -> set the `no_speech` reaction and reply with a
//                         short Russian message explaining nothing was
//                         heard. Not a failure: do not retry.
//
// Unparseable rows are logged and dropped. Successfully handled rows are
// always deleted. If a TG API call fails (rate limit, message gone, etc.)
// the row is still deleted: re-delivering the notification has limited
// value once the bot has tried.

import { Api } from 'grammy';

import type { Config } from '../../config';
import type { Queue, QueueMessage } from '../../queue/types.ts';
import { parseNotifyResult, type ParseNotifyResult } from '../../wire/parse.ts';

import { NOTIFICATIONS_QUEUE, deleteSafe } from '../api.ts';
import { handleResult, handleUnknownVariant } from './handler.ts';
import { mkLog } from '../../log.ts';

const log = mkLog('notifier');


export async function runNotifier(
  cfg: Config,
  queue: Queue,
  api: Api,
  signal: AbortSignal,
): Promise<void> {
  log.info(
    { queue: `queue_${NOTIFICATIONS_QUEUE}`, poll_interval_ms: cfg.queue.poll_interval_ms },
    'polling started',
  );
  while (!signal.aborted) {
    let msg: QueueMessage | null;
    try {
      msg = await queue.receive(NOTIFICATIONS_QUEUE);
    } catch (err) {
      log.warn({ err }, 'receive failed');
      await sleep(cfg.queue.poll_interval_ms, signal);
      continue;
    }

    if (msg === null) {
      await sleep(cfg.queue.poll_interval_ms, signal);
      continue;
    }

    let parsed: ParseNotifyResult;
    try {
      parsed = parseNotifyResult(msg.payload);
    } catch (err) {
      log.warn({ err, row_id: msg.id }, 'row unparseable, dropping');
      await deleteSafe(queue, msg.id);
      continue;
    }

    if (parsed.kind === 'unknown_variant') {
      await handleUnknownVariant(cfg, api, parsed);
    } else {
      await handleResult(cfg, api, parsed.value);
    }
    await deleteSafe(queue, msg.id);
  }
  log.info('stopped');
}


async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
