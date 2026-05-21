import { describe, test, mock } from 'node:test';
import { strict as assert } from 'node:assert';

import type { Api } from 'grammy';

import type { Config } from '../src/config';
import { handleResult, handleUnknownVariant } from '../src/telegram/notifier/handler.ts';
import type { NotifyResult } from '../src/wire/types.ts';
import type { ParseNotifyResult } from '../src/wire/parse.ts';

function makeConfig(): Config {
  return {
    telegram: { bot_token: 'x' },
    webhook: {
      url: 'https://example.test/hook',
      listen_host: '127.0.0.1',
      listen_port: 8080,
      path: '/hook',
      secret: 'x',
    },
    queue: { backend: 'sqlite', sqlite: { path: ':memory:' }, poll_interval_ms: 1000 } as Config['queue'],
    bucket: { backend: 'fs', fs: { root: '/tmp' } },
    access: { allowed_user_ids: [] },
    reactions: {
      enabled: true,
      queued: 'queued-emoji',
      done: 'done-emoji',
      error: 'error-emoji',
      no_speech: 'no_speech-emoji',
    },
  };
}

function makeApi(): {
  api: Api;
  setReaction: ReturnType<typeof mock.fn>;
  sendMessage: ReturnType<typeof mock.fn>;
} {
  const setReaction = mock.fn(async () => true as const);
  const sendMessage = mock.fn(async () => ({}) as never);
  const api = {
    setMessageReaction: setReaction,
    sendMessage,
  } as unknown as Api;
  return { api, setReaction, sendMessage };
}

function noSpeechNotify(): NotifyResult {
  return {
    v: 1,
    type: 'notify_result',
    dedup_key: 'tg:1:2',
    source: { kind: 'telegram', chat_id: 100, message_id: 200, update_id: 300 },
    result: { status: 'no_speech', reason: 'silent', duration_ms: 42 },
  };
}

describe('handleResult: no_speech', () => {
  test('sets the no_speech reaction and sends the Russian reply', async () => {
    const cfg = makeConfig();
    const { api, setReaction, sendMessage } = makeApi();
    await handleResult(cfg, api, noSpeechNotify());

    assert.equal(setReaction.mock.callCount(), 1);
    const reactArgs = setReaction.mock.calls[0]?.arguments;
    assert.deepEqual(reactArgs?.[0], 100);
    assert.deepEqual(reactArgs?.[1], 200);
    assert.deepEqual(reactArgs?.[2], [
      { type: 'emoji', emoji: 'no_speech-emoji' },
    ]);

    assert.equal(sendMessage.mock.callCount(), 1);
    const sendArgs = sendMessage.mock.calls[0]?.arguments;
    assert.equal(sendArgs?.[0], 100);
    assert.equal(sendArgs?.[1], 'Не услышал речи в записи.');
    assert.deepEqual(sendArgs?.[2], { reply_parameters: { message_id: 200 } });
  });

  test('skips reaction and reply when reactions are disabled', async () => {
    const cfg = makeConfig();
    cfg.reactions.enabled = false;
    const { api, setReaction, sendMessage } = makeApi();
    await handleResult(cfg, api, noSpeechNotify());

    assert.equal(setReaction.mock.callCount(), 0);
    assert.equal(sendMessage.mock.callCount(), 0);
  });
});

function unknownVariant(): Extract<ParseNotifyResult, { kind: 'unknown_variant' }> {
  return {
    kind: 'unknown_variant',
    v: 2,
    status: 'too_noisy',
    dedup_key: 'tg:1:2',
    source: { kind: 'telegram', chat_id: 100, message_id: 200, update_id: 300 },
  };
}

describe('handleUnknownVariant', () => {
  test('sets the error reaction and sends a diagnostic reply', async () => {
    const cfg = makeConfig();
    const { api, setReaction, sendMessage } = makeApi();
    await handleUnknownVariant(cfg, api, unknownVariant());

    assert.equal(setReaction.mock.callCount(), 1);
    const reactArgs = setReaction.mock.calls[0]?.arguments;
    assert.deepEqual(reactArgs?.[2], [{ type: 'emoji', emoji: 'error-emoji' }]);

    assert.equal(sendMessage.mock.callCount(), 1);
    const sendArgs = sendMessage.mock.calls[0]?.arguments;
    assert.equal(sendArgs?.[0], 100);
    const text = String(sendArgs?.[1]);
    assert.match(text, /unknown result variant/);
    assert.match(text, /v=2/);
    assert.match(text, /status=too_noisy/);
  });

  test('skips reaction and reply when reactions are disabled', async () => {
    const cfg = makeConfig();
    cfg.reactions.enabled = false;
    const { api, setReaction, sendMessage } = makeApi();
    await handleUnknownVariant(cfg, api, unknownVariant());

    assert.equal(setReaction.mock.callCount(), 0);
    assert.equal(sendMessage.mock.callCount(), 0);
  });
});
