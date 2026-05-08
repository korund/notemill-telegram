// produce.ts — Slice 1 stub producer (no Telegram).
//
// Reads an audio file from disk, mints a ULID + audio_key, drops the bytes
// into the FS bucket, and INSERTs a TranscribeJob into queue_transcribe so
// the worker (`voice2text run queue`) can pick it up.
//
// Usage (see README for full recipe):
//   npm run produce -- <audio-file> [--db PATH] [--bucket-root PATH] \
//       [--chat-id N] [--message-id N] [--update-id N] [--user-id N] \
//       [--lang BCP47] [--mime MIME]

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { ulid } from "ulid";

import { bucketPut } from "../bucket.ts";
import { QueueClient } from "../queue.ts";
import {
  WIRE_VERSION,
  buildAudioKey,
  tgDedupKey,
  type TranscribeJob,
} from "../wire.ts";

interface CliArgs {
  audioPath: string;
  dbPath: string;
  bucketRoot: string;
  chatId: number;
  messageId: number;
  updateId: number;
  userId: number | undefined;
  lang: string | undefined;
  mime: string | undefined;
  queueName: string;
}

function parseCli(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      db: { type: "string", default: "./var/dev/queue.db" },
      "bucket-root": { type: "string", default: "./var/dev/buckets" },
      "chat-id": { type: "string", default: "100000001" },
      "message-id": { type: "string" },
      "update-id": { type: "string" },
      "user-id": { type: "string" },
      lang: { type: "string" },
      mime: { type: "string" },
      "queue-name": { type: "string", default: "transcribe" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    printHelp();
    process.exit(values.help ? 0 : 1);
  }

  const audioPath = positionals[0];
  if (!audioPath) {
    throw new Error("missing positional: <audio-file>");
  }

  // message-id and update-id default to time-derived values so repeated runs
  // produce distinct dedup_keys (otherwise the worker would treat them as
  // duplicates per contract section 6).
  const nowSec = Math.floor(Date.now() / 1000);
  const msgIdRaw = values["message-id"] ?? String(nowSec);
  const updIdRaw = values["update-id"] ?? String(nowSec + 1_000_000_000);

  return {
    audioPath,
    dbPath: values.db as string,
    bucketRoot: values["bucket-root"] as string,
    chatId: parseIntStrict("--chat-id", values["chat-id"] as string),
    messageId: parseIntStrict("--message-id", msgIdRaw),
    updateId: parseIntStrict("--update-id", updIdRaw),
    userId:
      values["user-id"] !== undefined
        ? parseIntStrict("--user-id", values["user-id"] as string)
        : undefined,
    lang: values.lang as string | undefined,
    mime: values.mime as string | undefined,
    queueName: values["queue-name"] as string,
  };
}

function parseIntStrict(label: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`${label}: expected integer, got '${raw}'`);
  }
  return n;
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: produce.ts <audio-file> [options]",
      "",
      "Reads <audio-file>, places it in the FS bucket, enqueues a TranscribeJob.",
      "",
      "Options:",
      "  --db PATH            sqlite database (default ./var/dev/queue.db)",
      "  --bucket-root PATH   FS bucket root (default ./var/dev/buckets)",
      "  --chat-id N          Telegram chat id (default 100000001)",
      "  --message-id N       Telegram message id (default: derived from now)",
      "  --update-id N        Telegram update id (default: derived from now)",
      "  --user-id N          Telegram user id (optional)",
      "  --lang BCP47         language hint (optional)",
      "  --mime MIME          mime hint (omitted by default; see comments)",
      "  --queue-name NAME    queue table suffix (default 'transcribe')",
      "  -h, --help           show this help",
      "",
    ].join("\n"),
  );
}

// NOTE: we deliberately do NOT auto-infer hints.mime from the file extension.
// The current worker (voice2text/src/decode/ffmpeg.rs) treats hints.mime as a
// filename extension and joins it onto a temp-file path. A real MIME like
// "audio/ogg" then becomes a slash-bearing path component and write() fails
// with ENOENT. Until the worker is fixed, mime is sent only when the operator
// passes --mime explicitly. The audio_key extension already tells the worker
// the format (see input/queue/bucket.rs `extension_of(key)`).

async function main(): Promise<void> {
  const args = parseCli(process.argv.slice(2));

  const audioAbs = path.resolve(args.audioPath);
  const stat = await fsp.stat(audioAbs);
  if (!stat.isFile()) {
    throw new Error(`not a file: ${audioAbs}`);
  }

  const ext = path.extname(audioAbs).replace(/^\./, "");
  if (!ext) {
    throw new Error(
      `cannot determine extension from filename: ${audioAbs} (audio_key needs an .ext)`,
    );
  }

  const bytes = await fsp.readFile(audioAbs);
  const id = ulid();
  const now = new Date();
  const audioKey = buildAudioKey(now, id, ext);

  // 1. Put bytes in bucket BEFORE enqueueing (contract section 5.4).
  const putRes = await bucketPut(args.bucketRoot, audioKey, bytes);

  // 2. Build TranscribeJob.
  const dedupKey = tgDedupKey(args.chatId, args.messageId);
  const hintsMime = args.mime;

  const job: TranscribeJob = {
    v: WIRE_VERSION,
    type: "transcribe",
    dedup_key: dedupKey,
    audio_key: audioKey,
    source: {
      kind: "telegram",
      chat_id: args.chatId,
      message_id: args.messageId,
      update_id: args.updateId,
      ...(args.userId !== undefined ? { user_id: args.userId } : {}),
      received_at: now.toISOString(),
    },
    ...(hintsMime !== undefined || args.lang !== undefined
      ? {
          hints: {
            ...(hintsMime !== undefined ? { mime: hintsMime } : {}),
            ...(args.lang !== undefined ? { lang: args.lang } : {}),
          },
        }
      : {}),
  };

  // 3. INSERT JSON into queue_<name>.
  const queue = QueueClient.open(args.dbPath);
  let rowId: number;
  try {
    rowId = queue.enqueue(args.queueName, JSON.stringify(job));
  } finally {
    queue.close();
  }

  // 4. Report.
  const summary = {
    enqueued_row_id: rowId,
    queue: `queue_${args.queueName}`,
    db: args.dbPath,
    audio_key: audioKey,
    bucket_path: path.join(args.bucketRoot, audioKey),
    bytes: putRes.size,
    dedup_key: dedupKey,
    source_audio: audioAbs,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`produce: ${msg}\n`);
  process.exit(1);
});
