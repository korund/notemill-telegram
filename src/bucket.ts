// Filesystem bucket: atomic, no-clobber put per docs/contract.md section 5.2.
//
// Strategy:
//   1. Write payload to a temporary file: `{target}.tmp.{pid}.{rand}` with
//      exclusive-create flag (so two concurrent producers cannot pick the same temp).
//   2. fs.link(tmp, target) — link() fails with EEXIST if `target` already exists,
//      giving us the no-clobber semantics required by the contract atomically.
//   3. fs.unlink(tmp) to drop the temp; the target keeps the only remaining link.
//
// link()-then-unlink is preferred over rename() because rename() on most platforms
// silently replaces an existing destination, which would violate the contract's
// AlreadyExists guard.

import { randomBytes } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

export class BucketAlreadyExists extends Error {
  constructor(public readonly key: string) {
    super(`bucket: key already exists: ${key}`);
    this.name = "BucketAlreadyExists";
  }
}

export interface BucketPutResult {
  /** Logical key (not an absolute path). */
  key: string;
  /** Bytes written. */
  size: number;
}

/**
 * Atomically place `bytes` at `{root}/{key}` with no-clobber semantics.
 * Creates intermediate directories as needed.
 *
 * @throws {BucketAlreadyExists} if a file already exists at the target key.
 */
export async function bucketPut(
  root: string,
  key: string,
  bytes: Buffer | Uint8Array,
): Promise<BucketPutResult> {
  if (path.isAbsolute(key)) {
    throw new Error(`bucket: audio_key must be relative, got absolute: ${key}`);
  }

  const target = path.join(root, key);
  const dir = path.dirname(target);
  await fsp.mkdir(dir, { recursive: true });

  const rand = randomBytes(6).toString("hex");
  const tmp = `${target}.tmp.${process.pid}.${rand}`;

  // wx => fail if temp already exists (paranoid; pid+rand collision is essentially zero).
  await fsp.writeFile(tmp, bytes, { flag: "wx" });

  try {
    await fsp.link(tmp, target);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => undefined);
    if (isErrnoCode(err, "EEXIST")) {
      throw new BucketAlreadyExists(key);
    }
    throw err;
  }

  await fsp.unlink(tmp).catch(() => undefined);

  return { key, size: bytes.byteLength };
}

function isErrnoCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === code
  );
}
