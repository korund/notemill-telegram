// Composition root for the Telegram producer.
//
// Loads YAML config, instantiates Queue/Bucket from their factories, builds
// a single grammY Bot, and runs the ingress and notifier loops in parallel
// until SIGINT/SIGTERM. Backend swaps (sqlite -> sqs, fs -> s3) happen
// here; ingress and notifier never look at the config backend keys.
//
// Run:
//   node --import tsx src/bin/server.ts \
//     --config config/config.example.yaml

import { parseArgs } from 'node:util';
import { Bot } from 'grammy';

import { loadConfig } from '../config/index.ts';
import { createQueue } from '../queue/factory.ts';
import { createBucket } from '../bucket/factory.ts';
import { runIngress } from '../telegram/ingress/index.ts';
import { runNotifier } from '../telegram/notifier/index.ts';
import { InMemoryLanguageStore } from '../telegram/language_store.ts';
import { mkLog } from '../log.ts';

const log = mkLog('server');

interface CliArgs {
  configPath: string;
  set: string[];
}

function parseCli(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      config: { type: 'string', default: 'config/config.example.yaml' },
      set: { type: 'string', multiple: true, default: [] },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    printHelp();
    process.exit(0);
  }
  return { configPath: values.config as string, set: values.set as string[] };
}

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: server.ts [options]',
      '',
      'Runs the Telegram webhook ingress and notifications poller.',
      '',
      'Options:',
      '  --config PATH        YAML config (default config/config.example.yaml)',
      '  --set key=value      override a config value (dotted path, YAML scalar; repeatable)',
      '  -h, --help           show this help',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const args = parseCli(process.argv.slice(2));
  const cfg = loadConfig(args.configPath, args.set);

  const queue = createQueue(cfg.queue);
  const bucket = createBucket(cfg.bucket);
  const bot = new Bot(cfg.telegram.bot_token);
  const store = new InMemoryLanguageStore();

  const ac = new AbortController();
  const onSig = (sig: NodeJS.Signals): void => {
    log.info({ sig }, 'received signal, shutting down');
    ac.abort();
  };
  process.on('SIGINT', onSig);
  process.on('SIGTERM', onSig);

  try {
    await Promise.all([
      runIngress(cfg, queue, bucket, bot, ac.signal, store),
      runNotifier(cfg, queue, bot.api, ac.signal, store),
    ]);
  } finally {
    process.off('SIGINT', onSig);
    process.off('SIGTERM', onSig);
    await queue.close();
  }
}

main().catch((err: unknown) => {
  log.error({ err }, 'fatal error');
  process.exit(1);
});
