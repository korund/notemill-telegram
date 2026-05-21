import { Api } from 'grammy';

import type { Queue } from '../queue/types.ts';
import { mkLog } from '../log.ts';

const log = mkLog('api');

export const NOTIFICATIONS_QUEUE = 'notifications';

export async function setReactionSafe(
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
    log.warn({ err, chat_id: chatId, message_id: messageId, emoji }, 'setMessageReaction failed');
  }
}

export async function deleteSafe(queue: Queue, id: string): Promise<void> {
  try {
    await queue.delete(NOTIFICATIONS_QUEUE, id);
  } catch (err) {
    log.warn({ err, row_id: id }, 'delete row failed');
  }
}


type ReactionEmoji = Parameters<Api['setMessageReaction']>[2] extends Array<infer U>
  ? U extends { emoji: infer E }
    ? E
    : never
  : never;
