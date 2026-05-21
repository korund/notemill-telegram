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
