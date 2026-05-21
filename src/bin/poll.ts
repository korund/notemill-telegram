// poll.ts -- Slice 1 stub poller for queue_notifications.
//
// Tight loop:
//   1. peek the oldest visible row in the notifications queue
//   2. parse it as NotifyResult, log it
//   3. DELETE it
//   4. if no row was found, sleep `interval_ms` and try again
//
// We do NOT use the visibility-timeout pop protocol here because the bot is
// the sole consumer of `notifications` and we want each result observed once
// and then dropped (claim-check after CouchDB write). See contract section 4.2.

import { parseArgs } from "node:util";

import { SqliteQueue } from "../queue/sqlite.ts";
import { parseNotifyResult } from "../wire/parse.ts";
import type { NotifyResult } from "../wire/types.ts";
import { mkLog } from "../log.ts";

const log = mkLog("poll");

interface CliArgs {
  dbPath: string;
  queueName: string;
  intervalMs: number;
  once: boolean;
}

function parseCli(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      db: { type: "string", default: "./var/dev/queue.db" },
      "queue-name": { type: "string", default: "notifications" },
      "interval-ms": { type: "string", default: "1000" },
      once: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const intervalMs = Number(values["interval-ms"]);
  if (!Number.isFinite(intervalMs) || intervalMs < 50) {
    throw new Error(`--interval-ms must be a number >= 50, got '${values["interval-ms"]}'`);
  }

  return {
    dbPath: values.db as string,
    queueName: values["queue-name"] as string,
    intervalMs,
    once: values.once as boolean,
  };
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: poll.ts [options]",
      "",
      "Polls queue_<name> for NotifyResult rows, logs them, deletes them.",
      "",
      "Options:",
      "  --db PATH            sqlite database (default ./var/dev/queue.db)",
      "  --queue-name NAME    queue table suffix (default 'notifications')",
      "  --interval-ms N      idle poll interval (default 1000)",
      "  --once               process at most one row, then exit",
      "  -h, --help           show this help",
      "",
    ].join("\n"),
  );
}

function summarize(result: NotifyResult): string {
  const r = result.result;
  if (r.status === "ok") {
    return `ok  output_ref=${r.output_ref} duration_ms=${r.duration_ms}`;
  }
  if (r.status === "no_speech") {
    return `no_speech reason=${r.reason} duration_ms=${r.duration_ms}`;
  }
  return `err code=${r.error_code} duration_ms=${r.duration_ms} msg=${r.error_msg}`;
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      resolve();
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function main(): Promise<void> {
  const args = parseCli(process.argv.slice(2));
  const queue = SqliteQueue.open(args.dbPath);

  const ac = new AbortController();
  const onSig = (sig: NodeJS.Signals): void => {
    log.info({ sig }, "received signal, shutting down");
    ac.abort();
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  log.info(
    { queue: `queue_${args.queueName}`, db: args.dbPath, interval_ms: args.intervalMs, once: args.once },
    "watching queue",
  );

  try {
    let processedAny = false;
    while (!ac.signal.aborted) {
      const row = await queue.receive(args.queueName);
      if (row === null) {
        if (args.once && processedAny) break;
        await sleep(args.intervalMs, ac.signal);
        continue;
      }

      let parsedRaw;
      try {
        parsedRaw = parseNotifyResult(row.payload);
      } catch (err) {
        log.warn({ err, row_id: row.id, raw_payload: row.payload }, "row unparseable, deleting");
        await queue.delete(args.queueName, row.id);
        continue;
      }

      if (parsedRaw.kind === "unknown_variant") {
        log.warn(
          { row_id: row.id, v: parsedRaw.v, status: parsedRaw.status, dedup_key: parsedRaw.dedup_key },
          "unknown variant, dropping",
        );
        await queue.delete(args.queueName, row.id);
        processedAny = true;
        if (args.once) break;
        continue;
      }

      const parsed: NotifyResult = parsedRaw.value;
      const line = {
        ts: new Date().toISOString(),
        row_id: row.id,
        dedup_key: parsed.dedup_key,
        chat_id: parsed.source.chat_id,
        message_id: parsed.source.message_id,
        update_id: parsed.source.update_id,
        result: parsed.result,
      };
      process.stdout.write(JSON.stringify(line) + "\n");
      log.info({ summary: summarize(parsed) }, "processed row");

      await queue.delete(args.queueName, row.id);
      processedAny = true;

      if (args.once) break;
    }
  } finally {
    await queue.close();
    process.off("SIGINT", onSig);
    process.off("SIGTERM", onSig);
  }
}

main().catch((err: unknown) => {
  log.error({ err }, "fatal error");
  process.exit(1);
});
