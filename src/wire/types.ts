import { z } from 'zod';
import {
  NotifySourceSchema,
  NotifyResultOkSchema,
  NotifyResultErrorSchema,
  NotifyResultNoSpeechSchema,
  NotifyResultBodySchema,
  NotifyResultV1Schema,
} from './schema.ts';

// Wire-format types for queue payloads.
// Mirrors docs/contract.md sections 3.1 (TranscribeJob) and 3.2 (NotifyResult).
// JSON shape is the contract; field names and casing must match exactly.

export const WIRE_VERSION = 1 as const;

export type SourceKind = 'telegram';

export interface TelegramSource {
  kind: 'telegram';
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
  type: 'transcribe';
  dedup_key: string;
  audio_key: string;
  source: TelegramSource;
  hints?: JobHints;
}

// NotifyResult types re-exported from schemas.
export type NotifySource = z.infer<typeof NotifySourceSchema>;
export type ErrorCode = z.infer<typeof NotifyResultErrorSchema>['error_code'];
export type NoSpeechReason = z.infer<typeof NotifyResultNoSpeechSchema>['reason'];
export type NotifyResultOk = z.infer<typeof NotifyResultOkSchema>;
export type NotifyResultError = z.infer<typeof NotifyResultErrorSchema>;
export type NotifyResultNoSpeech = z.infer<typeof NotifyResultNoSpeechSchema>;
export type NotifyResultBody = z.infer<typeof NotifyResultBodySchema>;
export type NotifyResult = z.infer<typeof NotifyResultV1Schema>;
