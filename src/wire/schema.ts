import { z } from 'zod';

// Zod v4 schemas for the wire contract.
// These are the source of truth for NotifyResult and related types.
// types.ts re-exports them as z.infer aliases.

export const NotifySourceSchema = z.object({
  kind: z.literal('telegram'),
  chat_id: z.number().int(),
  message_id: z.number().int(),
  update_id: z.number().int(),
});

export const NotifyResultOkSchema = z.object({
  status: z.literal('ok'),
  output_ref: z.string(),
  duration_ms: z.number(),
});

export const NotifyResultErrorSchema = z.object({
  status: z.literal('error'),
  error_code: z.enum(['audio_missing', 'decode_failed', 'engine_failed', 'output_failed', 'internal']),
  error_msg: z.string(),
  duration_ms: z.number(),
});

export const NotifyResultNoSpeechSchema = z.object({
  status: z.literal('no_speech'),
  reason: z.literal('silent'),
  duration_ms: z.number(),
});

export const NotifyResultBodySchema = z.discriminatedUnion('status', [
  NotifyResultOkSchema,
  NotifyResultErrorSchema,
  NotifyResultNoSpeechSchema,
]);

export const NotifyResultV1Schema = z.object({
  v: z.literal(1),
  type: z.literal('notify_result'),
  dedup_key: z.string(),
  source: NotifySourceSchema,
  result: NotifyResultBodySchema,
});

// TranscribeJob schemas -- single source of truth for section 3.1 of the contract.

export const TelegramSourceSchema = z.object({
  kind: z.literal('telegram'),
  chat_id: z.number().int(),
  message_id: z.number().int(),
  update_id: z.number().int(),
  user_id: z.number().int().optional(),
  received_at: z.string().datetime(), // RFC3339 UTC
});

export const JobHintsSchema = z.object({
  mime: z.string().optional(),
  duration_sec: z.number().optional(),
  lang: z.string().optional(), // BCP-47
});

export const TranscribeJobSchema = z.object({
  v: z.literal(1),
  type: z.literal('transcribe'),
  dedup_key: z.string(),
  audio_key: z.string(),
  source: TelegramSourceSchema,
  hints: JobHintsSchema.optional(),
});

// Lenient envelope for extracting v and source when version is unknown.
export const EnvelopeBaseSchema = z.object({
  v: z.unknown(),
  dedup_key: z.string(),
  source: NotifySourceSchema,
  result: z.object({
    status: z.unknown(),
  }).passthrough(),
}).passthrough();
