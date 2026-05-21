import { z } from 'zod';
import {
  NotifySourceSchema,
  NotifyResultOkSchema,
  NotifyResultErrorSchema,
  NotifyResultNoSpeechSchema,
  NotifyResultBodySchema,
  NotifyResultV1Schema,
  TelegramSourceSchema,
  JobHintsSchema,
  TranscribeJobSchema,
} from './schema.ts';

// Wire-format types for queue payloads.
// Mirrors docs/contract.md sections 3.1 (TranscribeJob) and 3.2 (NotifyResult).
// JSON shape is the contract; field names and casing must match exactly.

export const WIRE_VERSION = 1 as const;

export type SourceKind = 'telegram';

export type TelegramSource = z.infer<typeof TelegramSourceSchema>;
export type JobHints = z.infer<typeof JobHintsSchema>;
export type TranscribeJob = z.infer<typeof TranscribeJobSchema>;

// NotifyResult types re-exported from schemas.
export type NotifySource = z.infer<typeof NotifySourceSchema>;
export type ErrorCode = z.infer<typeof NotifyResultErrorSchema>['error_code'];
export type NoSpeechReason = z.infer<typeof NotifyResultNoSpeechSchema>['reason'];
export type NotifyResultOk = z.infer<typeof NotifyResultOkSchema>;
export type NotifyResultError = z.infer<typeof NotifyResultErrorSchema>;
export type NotifyResultNoSpeech = z.infer<typeof NotifyResultNoSpeechSchema>;
export type NotifyResultBody = z.infer<typeof NotifyResultBodySchema>;
export type NotifyResult = z.infer<typeof NotifyResultV1Schema>;
