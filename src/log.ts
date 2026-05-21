// Structured logger for the Telegram producer.
//
// All output goes to stderr (fd 2) so it does not pollute the JSON data
// streams that bin/produce.ts and bin/poll.ts write to stdout.
//
// In development (NODE_ENV != 'production') log lines are pretty-printed via
// pino-pretty; in production they are newline-delimited JSON.

import pino from 'pino';

const isDev = process.env['NODE_ENV'] !== 'production';

const transport = isDev
  ? pino.transport({ target: 'pino-pretty', options: { destination: 2, sync: true } })
  : undefined;

export const log = pino(
  {
    level: process.env['LOG_LEVEL'] ?? 'info',
    // pino serializes Error objects placed in { err } automatically via the
    // built-in err serializer; no manual message extraction needed.
  },
  transport ?? pino.destination(2),
);

/**
 * Returns a child logger with the `module` field bound to `name`.
 * Use one logger per source module.
 *
 * Example:
 *   const log = mkLog('ingress');
 *   log.info({ host, port }, 'listening');
 */
export function mkLog(name: string): pino.Logger {
  return log.child({ module: name });
}
