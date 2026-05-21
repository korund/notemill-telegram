import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';

import { parseNotifyResult } from '../src/wire/parse.ts';

function notify(result: Record<string, unknown>): string {
  return JSON.stringify({
    v: 1,
    type: 'notify_result',
    dedup_key: 'tg:1:2',
    source: {
      kind: 'telegram',
      chat_id: 1,
      message_id: 2,
      update_id: 3,
    },
    result,
  });
}

describe('parseNotifyResult: no_speech', () => {
  test('accepts a well-formed no_speech payload', () => {
    const parsed = parseNotifyResult(
      notify({ status: 'no_speech', reason: 'silent', duration_ms: 42 }),
    );
    assert.equal(parsed.kind, 'ok');
    if (parsed.kind !== 'ok') return;
    assert.equal(parsed.value.result.status, 'no_speech');
    if (parsed.value.result.status !== 'no_speech') return;
    assert.equal(parsed.value.result.reason, 'silent');
    assert.equal(parsed.value.result.duration_ms, 42);
  });

  test('throws when reason is missing', () => {
    assert.throws(
      () => parseNotifyResult(notify({ status: 'no_speech', duration_ms: 42 })),
      /reason/i,
    );
  });

  test('throws when reason is unknown', () => {
    assert.throws(
      () =>
        parseNotifyResult(
          notify({ status: 'no_speech', reason: 'too_noisy', duration_ms: 42 }),
        ),
      /reason/i,
    );
  });

  test('throws when duration_ms is missing', () => {
    assert.throws(
      () => parseNotifyResult(notify({ status: 'no_speech', reason: 'silent' })),
      /duration_ms/i,
    );
  });
});

// Tolerance discipline: parser returns unknown_variant on producer-vs-
// worker skew, i.e. on unknown `v` AND on unknown enum values inside a
// known `v`. Throw is reserved for structurally broken envelopes.
describe('parseNotifyResult: tolerance', () => {
  test('returns unknown_variant for an unknown status within a known v', () => {
    const parsed = parseNotifyResult(
      notify({ status: 'too_noisy', duration_ms: 99 }),
    );
    assert.equal(parsed.kind, 'unknown_variant');
    if (parsed.kind !== 'unknown_variant') return;
    assert.equal(parsed.status, 'too_noisy');
    assert.equal(parsed.v, 1);
    assert.equal(parsed.source.chat_id, 1);
    assert.equal(parsed.source.message_id, 2);
  });

  test('returns unknown_variant for an unknown wire version', () => {
    const raw = JSON.stringify({
      v: 99,
      type: 'notify_result',
      dedup_key: 'tg:1:2',
      source: { kind: 'telegram', chat_id: 1, message_id: 2, update_id: 3 },
      result: { status: 'ok', output_ref: 'x', duration_ms: 1 },
    });
    const parsed = parseNotifyResult(raw);
    assert.equal(parsed.kind, 'unknown_variant');
    if (parsed.kind !== 'unknown_variant') return;
    assert.equal(parsed.v, 99);
  });

  test('still throws on structurally broken envelope (no source)', () => {
    const raw = JSON.stringify({
      v: 1,
      type: 'notify_result',
      dedup_key: 'tg:1:2',
      result: { status: 'ok', output_ref: 'x', duration_ms: 1 },
    });
    assert.throws(() => parseNotifyResult(raw), /source/i);
  });

  test('still throws on non-object payload', () => {
    assert.throws(() => parseNotifyResult('null'), Error);
  });
});
