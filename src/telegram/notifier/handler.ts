import { Api } from 'grammy';

import type { Config } from '../../config';
import type { NotifyResult } from '../../wire/types.ts';
import type { ParseNotifyResult } from '../../wire/parse.ts';

import { setReactionSafe } from '../api.ts';
import { formatNoSpeechReply, formatErrorReply } from './replies.ts';

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


function logError(n: NotifyResult): void {
  if (n.result.status !== 'error') return;
  const { chat_id, message_id } = n.source;
  process.stderr.write(
    `notifier: chat=${chat_id} msg=${message_id} dedup=${n.dedup_key} ` +
      `code=${n.result.error_code} msg=${n.result.error_msg}\n`,
  );
}
