import { readFileSync } from 'node:fs';

import { ConfigError, optString, isErrnoCode } from './util.ts';

export function resolveSecret(
  label: string,
  block: Record<string, unknown>,
  fileKey: string,
  envKey: string,
): string {
  const filePath = optString(block, fileKey);
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
  const envName = optString(block, envKey);
  if (envName) {
    const value = process.env[envName];
    if (value && value.length > 0) return value;
  }
  throw new ConfigError(
    `config: ${label} not set; provide ${fileKey} (readable file) or ${envKey} (non-empty env var)`,
  );
}

// Reaction strings may be written either as a literal emoji
// ("\u{1F440}" in code, or the actual character in YAML) or as one or more
// `U+XXXX` codepoints separated by whitespace (e.g. "U+1F440" for the eyes
// emoji, "U+2764 U+200D U+1F525" for heart-on-fire). The U+ form lets the
// config file stay ASCII-only.
const UPLUS_TOKEN = /^U\+[0-9A-Fa-f]{1,6}$/;
export function decodeReaction(raw: string | undefined, fallback: string): string {
  const value = raw ?? fallback;
  const tokens = value.trim().split(/\s+/);
  if (tokens.length > 0 && tokens.every((t) => UPLUS_TOKEN.test(t))) {
    return tokens.map((t) => String.fromCodePoint(parseInt(t.slice(2), 16))).join('');
  }
  return value;
}
