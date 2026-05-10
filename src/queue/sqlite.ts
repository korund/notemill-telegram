// SQLite implementation of the Queue interface.
//
// Maps to docs/contract.md section 4.2:
//   - enqueue: INSERT (payload, now, now, 0)
//   - receive: SELECT WHERE visible_at <= now ORDER BY id LIMIT 1 (no claim;
//     bot is the single consumer of its notifications queue, and the worker
//     owns claim semantics on the transcribe queue which the bot does not
//     read).
//   - delete: DELETE WHERE id = ?
//
// IMPORTANT: this client does NOT create tables. The worker owns the schema;
// the bot connects to a database that already exists. Missing file -> fail
// fast instead of silently creating an empty one.

import { existsSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import type { Queue, QueueMessage } from './types.ts';

interface QueueRow {
  id: number;
  payload: string;
}

const QUEUE_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

function assertQueueName(name: string): void {
  if (!QUEUE_NAME_RE.test(name)) {
    throw new Error(`queue: invalid name '${name}' (expected lowercase identifier)`);
  }
}

export class SqliteQueue implements Queue {
  private readonly db: DatabaseSync;
  private readonly stmts = new Map<string, StatementSync>();

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static open(dbPath: string): SqliteQueue {
    if (!existsSync(dbPath)) {
      throw new Error(
        `queue: database file not found at '${dbPath}'. ` +
          'Start the worker first (`notemill-worker run queue`) so it creates the schema.',
      );
    }
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
    return new SqliteQueue(db);
  }

  async enqueue(name: string, payload: string): Promise<{ id: string }> {
    assertQueueName(name);
    const stmt = this.prepared(
      `enqueue:${name}`,
      `INSERT INTO queue_${name} (payload, enqueued_at, visible_at, receive_count)
       VALUES (?, ?, ?, 0)`,
    );
    const now = Date.now();
    const info = stmt.run(payload, now, now);
    return { id: String(info.lastInsertRowid) };
  }

  async receive(name: string): Promise<QueueMessage | null> {
    assertQueueName(name);
    const stmt = this.prepared(
      `receive:${name}`,
      `SELECT id, payload
         FROM queue_${name}
        WHERE visible_at <= ?
        ORDER BY id
        LIMIT 1`,
    );
    const row = stmt.get(Date.now()) as QueueRow | undefined;
    if (!row) return null;
    return { id: String(row.id), payload: row.payload };
  }

  async delete(name: string, id: string): Promise<void> {
    assertQueueName(name);
    const numeric = Number(id);
    if (!Number.isInteger(numeric)) {
      throw new Error(`queue: sqlite delete requires integer id, got '${id}'`);
    }
    const stmt = this.prepared(`delete:${name}`, `DELETE FROM queue_${name} WHERE id = ?`);
    stmt.run(numeric);
  }

  async close(): Promise<void> {
    this.db.close();
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
