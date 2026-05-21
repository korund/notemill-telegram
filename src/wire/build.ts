import { TranscribeJobSchema } from './schema.ts';
import type { TranscribeJob } from './types.ts';

// Build and validate a TranscribeJob via schema parse.
// Throws ZodError (wrapped as Error) if the constructed object violates the contract.
export function buildTranscribeJob(raw: {
  dedup_key: string;
  audio_key: string;
  chat_id: number;
  message_id: number;
  update_id: number;
  user_id?: number;
  received_at: string;
  mime?: string;
  duration_sec?: number;
  lang?: string;
}): TranscribeJob {
  const input = {
    v: 1 as const,
    type: 'transcribe' as const,
    dedup_key: raw.dedup_key,
    audio_key: raw.audio_key,
    source: {
      kind: 'telegram' as const,
      chat_id: raw.chat_id,
      message_id: raw.message_id,
      update_id: raw.update_id,
      ...(raw.user_id !== undefined ? { user_id: raw.user_id } : {}),
      received_at: raw.received_at,
    },
    ...(raw.mime !== undefined || raw.duration_sec !== undefined || raw.lang !== undefined
      ? {
          hints: {
            ...(raw.mime !== undefined ? { mime: raw.mime } : {}),
            ...(raw.duration_sec !== undefined ? { duration_sec: raw.duration_sec } : {}),
            ...(raw.lang !== undefined ? { lang: raw.lang } : {}),
          },
        }
      : {}),
  };
  return TranscribeJobSchema.parse(input);
}

// Build a dedup_key per contract section 6: "tg:{chat_id}:{message_id}".
export function tgDedupKey(chatId: number, messageId: number): string {
  return `tg:${chatId}:${messageId}`;
}

// Build an audio_key per contract section 5.1: "audio/{YYYY}/{MM}/{DD}/{ulid}.{ext}".
// `ext` is the source extension WITHOUT a leading dot (e.g. "oga", "mp3").
export function buildAudioKey(now: Date, ulid: string, ext: string): string {
  const yyyy = now.getUTCFullYear().toString().padStart(4, "0");
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = now.getUTCDate().toString().padStart(2, "0");
  const cleanExt = ext.replace(/^\.+/, "").toLowerCase();
  return `audio/${yyyy}/${mm}/${dd}/${ulid}.${cleanExt}`;
}
