// SQLite queue client (read/write subset used by the bot).
//
// Maps to docs/contract.md section 4.2:
//   - enqueue: INSERT (payload, now, now, 0)
//   - peekVisible: SELECT WHERE visible_at <= now ORDER BY id LIMIT 1
//   - deleteById: DELETE WHERE id = ?
//
// IMPORTANT: this client does NOT create tables. Per the brief, the worker
// owns the schema; the bot must connect to a database that already exists
// (run the worker once first to populate it). If the .db file is missing we
// fail fast with a clear message instead of silently creating an empty file.

import { existsSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";

export interface QueueRow {
  id: number;
  payload: string;
  enqueued_at: number;
  visible_at: number;
  receive_count: number;
}

const QUEUE_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

function assertQueueName(name: string): void {
  if (!QUEUE_NAME_RE.test(name)) {
    throw new Error(`queue: invalid name '${name}' (expected lowercase identifier)`);
  }
}

export class QueueClient {
  private readonly db: DatabaseSync;
  private readonly stmts = new Map<string, StatementSync>();

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static open(dbPath: string): QueueClient {
    if (!existsSync(dbPath)) {
      throw new Error(
        `queue: database file not found at '${dbPath}'. ` +
          `Start the worker first (\`voice2text run queue\`) so it creates the schema.`,
      );
    }
    const db = new DatabaseSync(dbPath);
    // WAL is the worker's choice (see contract section 4.2). Setting it on our
    // connection is idempotent and ensures we cooperate cleanly if the file is
    // ever opened bot-first by accident.
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
    return new QueueClient(db);
  }

  close(): void {
    this.db.close();
  }

  /**
   * INSERT a payload into queue_<name>. Returns the row id.
   * Per contract: visible_at = enqueued_at = now; receive_count = 0.
   */
  enqueue(name: string, payload: string): number {
    assertQueueName(name);
    const stmt = this.prepared(
      `enqueue:${name}`,
      `INSERT INTO queue_${name} (payload, enqueued_at, visible_at, receive_count)
       VALUES (?, ?, ?, 0)`,
    );
    const now = Date.now();
    const info = stmt.run(payload, now, now);
    return Number(info.lastInsertRowid);
  }

  /**
   * Return the oldest visible row in queue_<name> without claiming it
   * (no visibility update). Suitable for the stub poll loop where we only
   * need to see results once and then DELETE them.
   */
  peekVisible(name: string): QueueRow | undefined {
    assertQueueName(name);
    const stmt = this.prepared(
      `peek:${name}`,
      `SELECT id, payload, enqueued_at, visible_at, receive_count
         FROM queue_${name}
        WHERE visible_at <= ?
        ORDER BY id
        LIMIT 1`,
    );
    const row = stmt.get(Date.now()) as QueueRow | undefined;
    return row;
  }

  /** DELETE WHERE id = ?. Returns number of rows deleted (0 or 1). */
  deleteById(name: string, id: number): number {
    assertQueueName(name);
    const stmt = this.prepared(`del:${name}`, `DELETE FROM queue_${name} WHERE id = ?`);
    const info = stmt.run(id);
    return Number(info.changes);
  }

  private prepared(cacheKey: string, sql: string): StatementSync {
    let s = this.stmts.get(cacheKey);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(cacheKey, s);
    }
    return s;
  }
}
