// Backend-agnostic queue interface used by the bot.
//
// Backends today: sqlite. Planned: sqs.
//
// Semantics:
//   - enqueue: writes a payload to the named queue, returns its assigned id.
//   - receive: returns the next available message from the named queue, or
//     null if there is none. The message is reserved for the caller for an
//     implementation-defined window; the caller is expected to call `delete`
//     after successful handling. Re-delivery on crash/restart is the
//     backend's concern (SQS: visibility timeout; sqlite single-consumer:
//     idempotent re-handle).
//   - delete: finalizes deletion of a previously received message.
//
// The caller never sees backend-specific identifiers; ids are opaque strings.

export interface QueueMessage {
  id: string;
  payload: string;
}

export interface Queue {
  enqueue(name: string, payload: string): Promise<{ id: string }>;
  receive(name: string): Promise<QueueMessage | null>;
  delete(name: string, id: string): Promise<void>;
  close(): Promise<void>;
}
