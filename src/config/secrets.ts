import { readFileSync } from 'node:fs';

import { ConfigError, isErrnoCode } from './util.ts';

// Resolve a secret value from a file path or an env var name stored in the config block.
// fileKey: key whose value is a file path to read from.
// envKey: key whose value is an env var name to read from.
export function resolveSecret(
  label: string,
  block: Record<string, unknown>,
  fileKey: string,
  envKey: string,
): string {
  const filePath = optStr(block, fileKey);
  if (filePath) {
    try {
      const value = readFileSync(filePath, 'utf8').trim();
      if (value) return value;
    } catch (err) {
      if (!isErrnoCode(err, 'ENOENT')) {
        throw new ConfigError(`config: ${label}: failed to read ${filePath}: ${(err as Error).message}`);
      }
    }
  }
  const envName = optStr(block, envKey);
  if (envName) {
    const value = process.env[envName];
    if (value && value.length > 0) return value;
  }
  throw new ConfigError(
    `config: ${label} not set; provide ${fileKey} (readable file) or ${envKey} (non-empty env var)`,
  );
}

// Reaction strings may be written either as a literal emoji or as one or more
// U+XXXX codepoints separated by whitespace (e.g. "U+1F440", "U+2764 U+200D U+1F525").
// The U+ form lets the config file stay ASCII-only.
const UPLUS_TOKEN = /^U\+[0-9A-Fa-f]{1,6}$/;
export function decodeReaction(raw: string | undefined, fallback: string): string {
  const value = raw ?? fallback;
  const tokens = value.trim().split(/\s+/);
  if (tokens.length > 0 && tokens.every((t) => UPLUS_TOKEN.test(t))) {
    return tokens.map((t) => String.fromCodePoint(parseInt(t.slice(2), 16))).join('');
  }
  return value;
}

function optStr(parent: Record<string, unknown>, key: string): string | undefined {
  const value = parent[key];
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}
