import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';

import { parseNotifyResult } from './wire.ts';

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
    assert.equal(parsed.result.status, 'no_speech');
    if (parsed.result.status !== 'no_speech') return; // type-guard
    assert.equal(parsed.result.reason, 'silent');
    assert.equal(parsed.result.duration_ms, 42);
  });

  test('throws when reason is missing', () => {
    assert.throws(
      () => parseNotifyResult(notify({ status: 'no_speech', duration_ms: 42 })),
      /bad result\.reason/,
    );
  });

  test('throws when reason is unknown', () => {
    assert.throws(
      () =>
        parseNotifyResult(
          notify({ status: 'no_speech', reason: 'too_noisy', duration_ms: 42 }),
        ),
      /bad result\.reason/,
    );
  });

  test('throws when duration_ms is missing', () => {
    assert.throws(
      () => parseNotifyResult(notify({ status: 'no_speech', reason: 'silent' })),
      /duration_ms missing/,
    );
  });
});
