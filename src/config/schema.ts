import { z } from 'zod';

// Zod v4 schemas for config file validation.
// Types are re-exported via types.ts as z.infer aliases.

export const QueueConfigSchema = z.object({
  backend: z.literal('sqlite'),
  poll_interval_ms: z.number().finite(),
  sqlite: z.object({
    path: z.string().min(1),
  }),
});

export const BucketConfigSchema = z.object({
  backend: z.literal('fs'),
  fs: z.object({
    root: z.string().min(1),
  }),
});

// Reactions block after decodeReaction has been applied.
// All four reaction fields are strings (emoji glyphs).
export const ReactionsConfigSchema = z.object({
  enabled: z.boolean(),
  queued: z.string().min(1),
  done: z.string().min(1),
  error: z.string().min(1),
  no_speech: z.string().min(1),
});

export const ConfigSchema = z.object({
  telegram: z.object({
    bot_token: z.string().min(1),
  }),
  webhook: z.object({
    url: z.string().min(1),
    listen_host: z.string().min(1),
    listen_port: z.number().int().positive(),
    path: z.string().min(1),
    secret: z.string().min(1),
  }),
  queue: QueueConfigSchema,
  bucket: BucketConfigSchema,
  access: z.object({
    allowed_user_ids: z.array(z.number().int()),
  }),
  reactions: ReactionsConfigSchema,
});
