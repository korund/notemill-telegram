import { Api } from 'grammy';

import type { Config } from '../../config';
import type { NotifyResult } from '../../wire/types.ts';
import type { ParseNotifyResult } from '../../wire/parse.ts';

import { setReactionSafe } from '../api.ts';
import { formatNoSpeechReply, formatErrorReply } from './replies.ts';
import { mkLog } from '../../log.ts';

const log = mkLog('notifier');

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
      log.warn({ err, chat_id }, 'no_speech reply failed');
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
    log.warn({ err, chat_id }, 'error reply failed');
  }
}

export async function handleUnknownVariant(
  cfg: Config,
  api: Api,
  u: Extract<ParseNotifyResult, { kind: 'unknown_variant' }>,
): Promise<void> {
  const { chat_id, message_id } = u.source;
  log.warn(
    { chat_id, message_id, dedup_key: u.dedup_key, v: u.v, status: u.status },
    'unknown variant, dropping; update bot to handle this variant',
  );
  if (!cfg.reactions.enabled) return;

  await setReactionSafe(api, chat_id, message_id, cfg.reactions.error);
  const text = `internal: unknown result variant (v=${String(u.v)} status=${String(u.status)}). Update the bot.`;
  try {
    await api.sendMessage(chat_id, text, { reply_parameters: { message_id } });
  } catch (err) {
    log.warn({ err, chat_id }, 'unknown-variant reply failed');
  }
}


function logError(n: NotifyResult): void {
  if (n.result.status !== 'error') return;
  const { chat_id, message_id } = n.source;
  log.warn(
    {
      chat_id,
      message_id,
      dedup_key: n.dedup_key,
      error_code: n.result.error_code,
      error_msg: n.result.error_msg,
    },
    'worker reported error',
  );
}
