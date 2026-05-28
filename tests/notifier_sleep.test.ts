import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';

import { sleep } from '../src/telegram/notifier/index.ts';

// Counting signal: tracks the net number of 'abort' listeners currently
// attached. The poll loop calls sleep() once per iteration; a leak shows up
// as listeners that are added but never removed on the normal timer path.
function makeCountingSignal(): { signal: AbortSignal; active: () => number } {
  let active = 0;
  const signal = {
    aborted: false,
    addEventListener: (): void => {
      active += 1;
    },
    removeEventListener: (): void => {
      active -= 1;
    },
  } as unknown as AbortSignal;
  return { signal, active: () => active };
}

describe('notifier sleep: listener lifecycle', () => {
  test('removes the abort listener after the timer fires normally', async () => {
    const { signal, active } = makeCountingSignal();
    await sleep(1, signal);
    assert.equal(active(), 0);
  });

  test('does not accumulate listeners across many iterations', async () => {
    const { signal, active } = makeCountingSignal();
    for (let i = 0; i < 50; i += 1) {
      await sleep(1, signal);
    }
    assert.equal(active(), 0);
  });

  test('resolves immediately when already aborted without attaching a listener', async () => {
    const { signal, active } = makeCountingSignal();
    (signal as { aborted: boolean }).aborted = true;
    await sleep(1000, signal);
    assert.equal(active(), 0);
  });
});
