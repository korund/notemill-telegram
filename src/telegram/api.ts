import { Api } from 'grammy';

import type { Queue } from '../queue/types.ts';

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
    const m = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `notifier: setMessageReaction failed (chat=${chatId}, msg=${messageId}, emoji=${emoji}): ${m}\n`,
    );
  }
}

export async function deleteSafe(queue: Queue, id: string): Promise<void> {
  try {
    await queue.delete(NOTIFICATIONS_QUEUE, id);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    process.stderr.write(`notifier: delete row id=${id} failed: ${m}\n`);
  }
}


type ReactionEmoji = Parameters<Api['setMessageReaction']>[2] extends Array<infer U>
  ? U extends { emoji: infer E }
    ? E
    : never
  : never;
