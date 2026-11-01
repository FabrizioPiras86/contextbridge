import { isUtf8 } from 'node:buffer';
import type { BigIntStats } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../config.ts';
import { digestOf, storeDir } from '../storage.ts';
import { validateCodexObservation } from './codex.ts';
import { object, onlyKeys } from './model.ts';
import type { TelemetryObservation } from './model.ts';

export const MAX_STORE_BYTES = 262_144;
export const MAX_STREAMS = 64;
async function safeEntry(path: string, directory: boolean): Promise<boolean> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw new Error('Unsafe telemetry storage path.');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
export async function readBounded(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > limit) throw new Error('Invalid or oversized telemetry file.');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit || !isUtf8(buffer.subarray(0, length))) throw new Error('Invalid or oversized telemetry file.');
    return buffer.subarray(0, length);
  } finally { await file.close(); }
}
async function telemetryDir(root: string, create = false): Promise<string> {
  await safeEntry(storeDir(root), true);
  const configPath = join(storeDir(root), 'config.json');
  await safeEntry(configPath, false);
  await readBounded(configPath, 16_384);
  await loadConfig(root);
  const dir = join(storeDir(root), 'telemetry');
  await safeEntry(dir, true);
  if (create) await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const name of ['observations.json', 'pending.json', 'writer.lock']) await safeEntry(join(dir, name), false);
  return dir;
}
function streamKey(observation: TelemetryObservation): string {
  return JSON.stringify([observation.provider, observation.source, observation.sessionId, observation.threadId]);
}
async function readStore(dir: string): Promise<TelemetryObservation[]> {
  const path = join(dir, 'observations.json');
  if (!await safeEntry(path, false)) return [];
  let value: unknown;
  try { value = JSON.parse((await readBounded(path, MAX_STORE_BYTES)).toString('utf8')); }
  catch { throw new Error('Corrupt or oversized telemetry store.'); }
  if (!object(value) || !onlyKeys(value, ['schemaVersion', 'observations', 'digest']) || value.schemaVersion !== 1 ||
      !Array.isArray(value.observations) || value.observations.length > MAX_STREAMS || value.digest !== digestOf(value.observations)) {
    throw new Error('Invalid telemetry store schema or digest.');
  }
  const streams = new Set<string>();
  for (const observation of value.observations) {
    validateCodexObservation(observation);
    const key = streamKey(observation);
    if (streams.has(key)) throw new Error('Duplicate stored telemetry stream.');
    streams.add(key);
  }
  return value.observations;
}
export async function listTelemetry(root: string): Promise<TelemetryObservation[]> {
  return readStore(await telemetryDir(root));
}
function sameReport(left: TelemetryObservation, right: TelemetryObservation): boolean {
  return digestOf([left.turnId, left.cumulative, left.latest, left.modelContextWindow, left.managed]) ===
    digestOf([right.turnId, right.cumulative, right.latest, right.modelContextWindow, right.managed]);
}
export async function ingestTelemetry(root: string, observation: TelemetryObservation, optIn: boolean, now = Date.now()): Promise<'stored' | 'duplicate' | 'out-of-order'> {
  if (optIn !== true) throw new Error('Telemetry ingestion requires explicit local opt-in with --yes.');
  const saved: unknown = JSON.parse(JSON.stringify(observation));
  validateCodexObservation(saved);
  if (!Number.isSafeInteger(now) || Date.parse(saved.observedAt) > now) throw new Error('Telemetry observation is in the future.');
  const dir = await telemetryDir(root, true);
  const lockPath = join(dir, 'writer.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Telemetry writer lock exists. Confirm no writer is running before removing .contextbridge/telemetry/writer.lock.');
    throw error;
  }
  let owned: BigIntStats | undefined;
  let failure: unknown;
  let failed = false;
  let outcome: 'stored' | 'duplicate' | 'out-of-order' = 'stored';
  try {
    owned = await lock.stat({ bigint: true });
    const observations = await readStore(dir);
    const index = observations.findIndex((item) => streamKey(item) === streamKey(saved));
    const previous = observations[index];
    if (previous && saved.sequence < previous.sequence) outcome = 'out-of-order';
    else if (previous && saved.sequence === previous.sequence) {
      if (!sameReport(previous, saved)) throw new Error('Conflicting telemetry sequence.');
      outcome = 'duplicate';
    } else if (previous && Date.parse(saved.observedAt) < Date.parse(previous.observedAt)) outcome = 'out-of-order';
    else {
      // Replays do not refresh freshness. Advance the ordering watermark only.
      if (previous && sameReport(previous, saved)) {
        saved.observedAt = previous.observedAt;
        outcome = 'duplicate';
      }
      if (index < 0) {
        if (observations.length >= MAX_STREAMS) throw new Error('Telemetry stream limit reached. Archive the local telemetry directory before starting another capture set.');
        observations.push(saved);
      } else observations[index] = saved;
      const data = JSON.stringify({ schemaVersion: 1, observations, digest: digestOf(observations) }) + '\n';
      if (Buffer.byteLength(data) > MAX_STORE_BYTES) throw new Error('Telemetry store size limit exceeded.');
      const pendingPath = join(dir, 'pending.json');
      await safeEntry(pendingPath, false);
      // A fixed staging file bounds crash leftovers. Never overwrite an interrupted write.
      const pending = await open(pendingPath, 'wx', 0o600);
      try { await pending.writeFile(data); await pending.sync(); }
      finally { await pending.close(); }
      await safeEntry(join(dir, 'observations.json'), false);
      await rename(pendingPath, join(dir, 'observations.json'));
    }
  } catch (error) { failed = true; failure = error; }
  const cleanup: unknown[] = [];
  try { await lock.close(); } catch (error) { cleanup.push(error); }
  try {
    const current = await lstat(lockPath, { bigint: true });
    if (owned && current.isFile() && !current.isSymbolicLink() && current.dev === owned.dev && current.ino === owned.ino) await unlink(lockPath);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') cleanup.push(error); }
  if (failed && !cleanup.length) throw failure;
  if (cleanup.length) throw new AggregateError(failed ? [failure, ...cleanup] : cleanup, 'Telemetry operation or lock cleanup failed; inspect storage before retrying.', failed ? { cause: failure } : undefined);
  return outcome;
}
