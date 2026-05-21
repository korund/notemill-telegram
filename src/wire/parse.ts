import type { NotifyResult, NotifySource } from './types.ts';

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
  | { kind: "ok"; value: NotifyResult }
  | {
      kind: "unknown_variant";
      v: unknown;
      status: unknown;
      dedup_key: string;
      source: NotifySource;
    };

// Narrow runtime parser. Throws on truly malformed payloads (not an
// object, missing source / dedup_key, broken result shape) -- those
// are wire-protocol breakage, not version skew. Returns
// `unknown_variant` on producer-vs-worker skew (unknown `v` or
// unknown `status` within a known `v`).
export function parseNotifyResult(raw: string): ParseNotifyResult {
  const obj: unknown = JSON.parse(raw);
  if (typeof obj !== "object" || obj === null) {
    throw new Error("NotifyResult: not an object");
  }
  const o = obj as Record<string, unknown>;
  if (o["type"] !== "notify_result") throw new Error(`NotifyResult: bad type=${String(o["type"])}`);
  if (typeof o["dedup_key"] !== "string") throw new Error("NotifyResult: dedup_key missing");

  const src = o["source"];
  if (typeof src !== "object" || src === null) throw new Error("NotifyResult: source missing");
  const s = src as Record<string, unknown>;
  if (s["kind"] !== "telegram") throw new Error(`NotifyResult: bad source.kind=${String(s["kind"])}`);
  if (typeof s["chat_id"] !== "number") throw new Error("NotifyResult: source.chat_id missing");
  if (typeof s["message_id"] !== "number") throw new Error("NotifyResult: source.message_id missing");
  if (typeof s["update_id"] !== "number") throw new Error("NotifyResult: source.update_id missing");

  const source: NotifySource = {
    kind: "telegram",
    chat_id: s["chat_id"],
    message_id: s["message_id"],
    update_id: s["update_id"],
  };
  const dedup_key = o["dedup_key"];

  const res = o["result"];
  if (typeof res !== "object" || res === null) throw new Error("NotifyResult: result missing");
  const r = res as Record<string, unknown>;
  const status = r["status"];

  if (o["v"] !== 1) {
    return { kind: "unknown_variant", v: o["v"], status, dedup_key, source };
  }
  if (status !== "ok" && status !== "error" && status !== "no_speech") {
    return { kind: "unknown_variant", v: o["v"], status, dedup_key, source };
  }
  if (typeof r["duration_ms"] !== "number") throw new Error("NotifyResult: result.duration_ms missing");

  if (status === "no_speech") {
    const reason = r["reason"];
    if (reason !== "silent") {
      throw new Error(`NotifyResult: bad result.reason=${String(reason)}`);
    }
  }

  // Cast is safe after the checks above; we trust the worker for the rest.
  return { kind: "ok", value: obj as NotifyResult };
}
