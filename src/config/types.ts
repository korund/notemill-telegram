import { z } from 'zod';
import {
  QueueConfigSchema,
  BucketConfigSchema,
  ReactionsConfigSchema,
  ConfigSchema,
} from './schema.ts';

// Config types inferred from Zod schemas.
// These are the types consumed by bin/server.ts, bucket/factory.ts, queue/factory.ts.
export type QueueConfig = z.infer<typeof QueueConfigSchema>;
export type BucketConfig = z.infer<typeof BucketConfigSchema>;
export type ReactionsConfig = z.infer<typeof ReactionsConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
