export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export function isErrnoCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === code;
}
