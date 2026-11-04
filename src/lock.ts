import type { BigIntStats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

// Compare handle metadata with handle metadata: Windows path stat can report a
// different volume serial in Node 22.16.0. Never discard the device comparison.
export async function ownsLock(path: string, owned: BigIntStats | undefined): Promise<boolean> {
  if (!owned?.isFile() || owned.ino === 0n) return false;
  const entry = await lstat(path, { bigint: true });
  if (!entry.isFile() || entry.isSymbolicLink()) return false;
  const current = await open(path, 'r');
  try {
    const identity = await current.stat({ bigint: true });
    return identity.isFile() && identity.dev === owned.dev && identity.ino === owned.ino;
  } finally { await current.close(); }
}
