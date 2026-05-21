import { ulid } from 'ulid';
import type { Context } from 'grammy';

import type { Config } from '../../config';
import type { Queue } from '../../queue/types.ts';
import type { Bucket } from '../../bucket/types.ts';
import { BucketAlreadyExists } from '../../bucket/types.ts';
import { buildAudioKey, buildTranscribeJob, tgDedupKey } from '../../wire/build.ts';

import { downloadFile, extensionOf } from './download.ts';

const TRANSCRIBE_QUEUE = 'transcribe';

export async function handleAudio(
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

  const job = buildTranscribeJob({
    dedup_key: tgDedupKey(chatId, messageId),
    audio_key: audioKey,
    chat_id: chatId,
    message_id: messageId,
    update_id: updateId,
    ...(userId !== undefined ? { user_id: userId } : {}),
    received_at: new Date().toISOString(),
  });
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
