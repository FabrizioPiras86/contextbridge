import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function storeDir(root: string): string {
  return join(root, '.contextbridge');
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function writeAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temp, data, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(data, null, 2)}\n`);
}

export function digestOf(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
