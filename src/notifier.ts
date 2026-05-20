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

import type { Config } from './config.ts';
import type { Queue, QueueMessage } from './queue/types.ts';
import {
  parseNotifyResult,
  type NotifyResult,
  type NotifySource,
  type ParseNotifyResult,
} from './wire.ts';

const NOTIFICATIONS_QUEUE = 'notifications';
const ERROR_MSG_MAX = 200;

export async function runNotifier(
  cfg: Config,
  queue: Queue,
  api: Api,
  signal: AbortSignal,
): Promise<void> {
  process.stderr.write(
    `notifier: polling queue_${NOTIFICATIONS_QUEUE} every ${cfg.queue.poll_interval_ms}ms\n`,
  );
  while (!signal.aborted) {
    let msg: QueueMessage | null;
    try {
      msg = await queue.receive(NOTIFICATIONS_QUEUE);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      process.stderr.write(`notifier: receive failed: ${m}\n`);
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
      const m = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `notifier: row id=${msg.id} unparseable, dropping. reason=${m}\n`,
      );
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
  process.stderr.write('notifier: stopped\n');
}

export async function handleResult(cfg: Config, api: Api, n: NotifyResult): Promise<void> {
  const { chat_id, message_id } = n.source;
  const r = n.result;

  if (!cfg.reactions.enabled) {
    if (r.status === 'error') {
      logError(n);
    }
    return;
  }

  if (r.status === 'ok') {
    await setReactionSafe(api, chat_id, message_id, cfg.reactions.done);
    return;
  }

  if (r.status === 'no_speech') {
    await setReactionSafe(api, chat_id, message_id, cfg.reactions.no_speech);
    const text = formatNoSpeechReply(r.reason);
    try {
      await api.sendMessage(chat_id, text, { reply_parameters: { message_id } });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `notifier: no_speech reply failed for chat=${chat_id}: ${m}\n`,
      );
    }
    return;
  }

  // status === 'error'
  logError(n);
  await setReactionSafe(api, chat_id, message_id, cfg.reactions.error);
  const text = formatErrorReply(r.error_code, r.error_msg);
  try {
    await api.sendMessage(chat_id, text, { reply_parameters: { message_id } });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    process.stderr.write(`notifier: error reply failed for chat=${chat_id}: ${m}\n`);
  }
}

export async function handleUnknownVariant(
  cfg: Config,
  api: Api,
  u: Extract<ParseNotifyResult, { kind: 'unknown_variant' }>,
): Promise<void> {
  const { chat_id, message_id } = u.source;
  process.stderr.write(
    `notifier: unknown variant for chat=${chat_id} msg=${message_id} ` +
      `dedup=${u.dedup_key} v=${String(u.v)} status=${String(u.status)} -- dropping; ` +
      `update bot to handle this variant\n`,
  );
  if (!cfg.reactions.enabled) return;

  await setReactionSafe(api, chat_id, message_id, cfg.reactions.error);
  const text = `internal: unknown result variant (v=${String(u.v)} status=${String(u.status)}). Update the bot.`;
  try {
    await api.sendMessage(chat_id, text, { reply_parameters: { message_id } });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `notifier: unknown-variant reply failed for chat=${chat_id}: ${m}\n`,
    );
  }
}

function formatNoSpeechReply(reason: 'silent'): string {
  switch (reason) {
    case 'silent':
      return 'Не услышал речи в записи.';
  }
}

function formatErrorReply(code: string, rawMsg: string): string {
  const oneLine = rawMsg.replace(/\s+/g, ' ').trim();
  const truncated =
    oneLine.length > ERROR_MSG_MAX ? `${oneLine.slice(0, ERROR_MSG_MAX)}...` : oneLine;
  return `${code}: ${truncated}`;
}

function logError(n: NotifyResult): void {
  if (n.result.status !== 'error') return;
  const { chat_id, message_id } = n.source;
  process.stderr.write(
    `notifier: chat=${chat_id} msg=${message_id} dedup=${n.dedup_key} ` +
      `code=${n.result.error_code} msg=${n.result.error_msg}\n`,
  );
}

async function setReactionSafe(
  api: Api,
  chatId: number,
  messageId: number,
  emoji: string,
): Promise<void> {
  try {
    await api.setMessageReaction(chatId, messageId, [
      { type: 'emoji', emoji: emoji as ReactionEmoji },
    ]);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `notifier: setMessageReaction failed (chat=${chatId}, msg=${messageId}, emoji=${emoji}): ${m}\n`,
    );
  }
}

async function deleteSafe(queue: Queue, id: string): Promise<void> {
  try {
    await queue.delete(NOTIFICATIONS_QUEUE, id);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    process.stderr.write(`notifier: delete row id=${id} failed: ${m}\n`);
  }
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

// Narrow alias for the emoji literal-union expected by setMessageReaction.
// We accept any string from config and let Telegram reject unsupported ones
// at API call time (logged in setReactionSafe).
type ReactionEmoji = Parameters<Api['setMessageReaction']>[2] extends Array<infer U>
  ? U extends { emoji: infer E }
    ? E
    : never
  : never;
