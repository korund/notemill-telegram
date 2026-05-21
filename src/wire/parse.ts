import { z } from 'zod';
import type { NotifyResult, NotifySource } from './types.ts';
import { NotifyResultV1Schema, EnvelopeBaseSchema } from './schema.ts';

// Result of parsing a queue notification. `ok` carries the typed
// `NotifyResult`; `unknown_variant` is returned when the envelope is
// structurally valid but either `v` or `result.status` is something
// the bot does not understand -- i.e., the worker is on a newer
// schema. The envelope source is still extracted so the notifier can
// surface a diagnostic reaction on the original Telegram message
// instead of dropping silently.
//
// Discipline: backend (worker) leads, producer tolerates. Additive
// changes (new status, new optional field) do NOT bump `v`; consumers
// tolerate them via the unknown_variant path. `v` is bumped only on
// breaking schema changes; an unknown `v` is the signal that the
// producer is behind the worker.
export type ParseNotifyResult =
  | { kind: 'ok'; value: NotifyResult }
  | {
      kind: 'unknown_variant';
      v: unknown;
      status: unknown;
      dedup_key: string;
      source: NotifySource;
    };

export function parseNotifyResult(raw: string): ParseNotifyResult {
  const obj: unknown = JSON.parse(raw);
  if (typeof obj !== 'object' || obj === null) {
    throw new Error('NotifyResult: not an object');
  }

  const envelope = EnvelopeBaseSchema.safeParse(obj);
  if (!envelope.success) throw toError(envelope.error);
  const { v, dedup_key, source } = envelope.data;
  const status = envelope.data.result.status;

  if (v !== 1 || (status !== 'ok' && status !== 'error' && status !== 'no_speech')) {
    return { kind: 'unknown_variant', v, status, dedup_key, source };
  }

  const parsed = NotifyResultV1Schema.safeParse(obj);
  if (!parsed.success) throw toError(parsed.error);
  return { kind: 'ok', value: parsed.data };
}

function toError(err: z.ZodError): Error {
  const issue = err.issues[0];
  const path = issue?.path.join('.') ?? '';
  const msg = issue?.message ?? 'invalid payload';
  return new Error(`NotifyResult: ${path}${path ? ': ' : ''}${msg}`);
}
