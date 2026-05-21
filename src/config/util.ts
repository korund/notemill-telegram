export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export function expectObject(
  parent: Record<string, unknown>,
  key: string,
  label = key,
): Record<string, unknown> {
  const value = parent[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError(`config: ${label} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

export function expectString(parent: Record<string, unknown>, label: string, key: string): string {
  const value = parent[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError(`config: ${label} must be a non-empty string`);
  }
  return value;
}

export function expectNumber(parent: Record<string, unknown>, label: string, key: string): number {
  const value = parent[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(`config: ${label} must be a number`);
  }
  return value;
}

export function expectBool(parent: Record<string, unknown>, label: string, key: string): boolean {
  const value = parent[key];
  if (typeof value !== 'boolean') {
    throw new ConfigError(`config: ${label} must be a boolean`);
  }
  return value;
}

export function optString(parent: Record<string, unknown>, key: string): string | undefined {
  const value = parent[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  return value.length > 0 ? value : undefined;
}

export function isErrnoCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === code;
}
