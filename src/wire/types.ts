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
