// Wire-format types for queue payloads.
// Mirrors docs/contract.md sections 3.1 (TranscribeJob) and 3.2 (NotifyResult).
// JSON shape is the contract; field names and casing must match exactly.

export const WIRE_VERSION = 1 as const;

export type SourceKind = "telegram";

export interface TelegramSource {
  kind: "telegram";
  chat_id: number;
  message_id: number;
  update_id: number;
  user_id?: number;
  received_at: string; // RFC3339 UTC
}

export interface JobHints {
  mime?: string;
  duration_sec?: number;
  lang?: string; // BCP-47
}

export interface TranscribeJob {
  v: 1;
  type: "transcribe";
  dedup_key: string;
  audio_key: string;
  source: TelegramSource;
  hints?: JobHints;
}

// NotifyResult: source mirror omits user_id/received_at by contract example.
export interface NotifySource {
  kind: "telegram";
  chat_id: number;
  message_id: number;
  update_id: number;
}

export type ErrorCode =
  | "audio_missing"
  | "decode_failed"
  | "engine_failed"
  | "output_failed"
  | "internal";

export interface NotifyResultOk {
  status: "ok";
  output_ref: string;
  duration_ms: number;
}

export interface NotifyResultError {
  status: "error";
  error_code: ErrorCode;
  error_msg: string;
  duration_ms: number;
}

export type NoSpeechReason = "silent";

export interface NotifyResultNoSpeech {
  status: "no_speech";
  reason: NoSpeechReason;
  duration_ms: number;
}

export type NotifyResultBody =
  | NotifyResultOk
  | NotifyResultError
  | NotifyResultNoSpeech;

export interface NotifyResult {
  v: 1;
  type: "notify_result";
  dedup_key: string;
  source: NotifySource;
  result: NotifyResultBody;
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

// Result of parsing a queue notification. `ok` carries the typed
// `NotifyResult`; `unknown_variant` is returned when the envelope and
// source are structurally valid but the version or result.status is one
// the bot does not understand (i.e., the worker is a newer build). The
// envelope's source is still extracted so the notifier can surface an
// error reaction on the original Telegram message instead of dropping
// silently.
export type ParseNotifyResult =
  | { kind: "ok"; value: NotifyResult }
  | {
      kind: "unknown_variant";
      v: unknown;
      status: unknown;
      dedup_key: string;
      source: NotifySource;
    };

// Narrow runtime parser. Throws on truly malformed payloads (not an
// object, missing source / dedup_key, etc.) -- those are wire-protocol
// breakage, not version skew. Returns `unknown_variant` for newer-but-
// well-formed messages so the caller can surface them to the operator.
export function parseNotifyResult(raw: string): ParseNotifyResult {
  const obj: unknown = JSON.parse(raw);
  if (typeof obj !== "object" || obj === null) {
    throw new Error("NotifyResult: not an object");
  }
  const o = obj as Record<string, unknown>;
  if (o["type"] !== "notify_result") throw new Error(`NotifyResult: bad type=${String(o["type"])}`);
  if (typeof o["dedup_key"] !== "string") throw new Error("NotifyResult: dedup_key missing");

  const src = o["source"];
  if (typeof src !== "object" || src === null) throw new Error("NotifyResult: source missing");
  const s = src as Record<string, unknown>;
  if (s["kind"] !== "telegram") throw new Error(`NotifyResult: bad source.kind=${String(s["kind"])}`);
  if (typeof s["chat_id"] !== "number") throw new Error("NotifyResult: source.chat_id missing");
  if (typeof s["message_id"] !== "number") throw new Error("NotifyResult: source.message_id missing");
  if (typeof s["update_id"] !== "number") throw new Error("NotifyResult: source.update_id missing");

  const source: NotifySource = {
    kind: "telegram",
    chat_id: s["chat_id"],
    message_id: s["message_id"],
    update_id: s["update_id"],
  };
  const dedup_key = o["dedup_key"];

  const res = o["result"];
  if (typeof res !== "object" || res === null) throw new Error("NotifyResult: result missing");
  const r = res as Record<string, unknown>;
  const status = r["status"];

  if (o["v"] !== 1) {
    return { kind: "unknown_variant", v: o["v"], status, dedup_key, source };
  }
  if (status !== "ok" && status !== "error" && status !== "no_speech") {
    return { kind: "unknown_variant", v: o["v"], status, dedup_key, source };
  }
  if (typeof r["duration_ms"] !== "number") throw new Error("NotifyResult: result.duration_ms missing");

  if (status === "no_speech") {
    const reason = r["reason"];
    if (reason !== "silent") {
      throw new Error(`NotifyResult: bad result.reason=${String(reason)}`);
    }
  }

  // Cast is safe after the checks above; we trust the worker for the rest.
  return { kind: "ok", value: obj as NotifyResult };
}
