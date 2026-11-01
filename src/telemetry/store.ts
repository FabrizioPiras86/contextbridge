import { isUtf8 } from 'node:buffer';
import type { BigIntStats } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../config.ts';
import { digestOf, storeDir } from '../storage.ts';
import { MAX_ACQUISITIONS, validateLifecycle, validateTransition } from '../managed/lifecycle.ts';
import type { LifecycleRecord } from '../managed/lifecycle.ts';
import { strictJson, validateCodexObservation } from './codex.ts';
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
  if (create) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      const parent = await open(storeDir(root), 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    }
  }
  for (const name of ['observations.json', 'pending.json', 'writer.lock']) await safeEntry(join(dir, name), false);
  return dir;
}
function streamKey(observation: TelemetryObservation): string {
  return JSON.stringify([observation.provider, observation.source, observation.sessionId, observation.threadId]);
}
async function readStore(dir: string): Promise<{ observations: TelemetryObservation[]; lifecycles: LifecycleRecord[] }> {
  const path = join(dir, 'observations.json');
  if (!await safeEntry(path, false)) return { observations: [], lifecycles: [] };
  let value: unknown;
  try { value = strictJson((await readBounded(path, MAX_STORE_BYTES)).toString('utf8')); }
  catch { throw new Error('Corrupt or oversized telemetry store.'); }
  return validateStore(value);
}
function validateStore(value: unknown): { observations: TelemetryObservation[]; lifecycles: LifecycleRecord[] } {
  if (!object(value) || !onlyKeys(value, ['schemaVersion', 'observations', 'lifecycles', 'digest']) || ![1, 2].includes(value.schemaVersion as number) ||
      !Array.isArray(value.observations) || value.observations.length > MAX_STREAMS || value.digest !== digestOf(value.schemaVersion === 1 ? value.observations : { observations: value.observations, lifecycles: value.lifecycles }) ||
      (value.schemaVersion === 1 && value.lifecycles !== undefined) ||
      (value.schemaVersion === 2 && (!Array.isArray(value.lifecycles) || value.lifecycles.length > MAX_ACQUISITIONS))) {
    throw new Error('Invalid telemetry store schema or digest.');
  }
  const streams = new Set<string>();
  for (const observation of value.observations) {
    validateCodexObservation(observation);
    const key = streamKey(observation);
    if (streams.has(key)) throw new Error('Duplicate stored telemetry stream.');
    streams.add(key);
  }
  const lifecycles = (value.lifecycles ?? []) as LifecycleRecord[];
  const acquisitions = new Set<string>();
  for (const lifecycle of lifecycles) {
    validateLifecycle(lifecycle);
    if (acquisitions.has(lifecycle.acquisitionId)) throw new Error('Duplicate managed acquisition.');
    acquisitions.add(lifecycle.acquisitionId);
    const related = value.observations.filter((item) => item.sessionId === lifecycle.acquisitionId);
    if (related.length > 1 || related.some((item) => item.schemaVersion !== 2)) throw new Error('Conflicting acquisition observations.');
    const observation = related[0];
    if (observation && (observation.threadId !== lifecycle.threadId || observation.turnId !== lifecycle.turnId ||
        observation.sequence !== lifecycle.sequence || observation.managed?.turn !== lifecycle.turn ||
        observation.managed?.connection !== lifecycle.connection || observation.managed?.receiptAt !== lifecycle.receiptAt ||
        observation.managed?.completeness !== (lifecycle.terminalEvidence === 'turn/completed' ? 'complete' : 'partial') ||
        observation.observedAt > lifecycle.receiptAt)) {
      throw new Error('Inconsistent managed lifecycle and telemetry.');
    }
  }
  return { observations: value.observations, lifecycles };
}
export async function listCaptureStore(root: string) {
  return readStore(await telemetryDir(root));
}
export async function listTelemetry(root: string): Promise<TelemetryObservation[]> {
  return (await readStore(await telemetryDir(root))).observations;
}
export async function listLifecycles(root: string): Promise<LifecycleRecord[]> {
  return (await readStore(await telemetryDir(root))).lifecycles;
}
function sameReport(left: TelemetryObservation, right: TelemetryObservation): boolean {
  return digestOf([left.turnId, left.cumulative, left.latest, left.modelContextWindow, left.managed]) ===
    digestOf([right.turnId, right.cumulative, right.latest, right.modelContextWindow, right.managed]);
}
export async function ingestTelemetry(root: string, observation: TelemetryObservation | undefined, optIn: boolean, now = Date.now(), lifecycle?: LifecycleRecord): Promise<'stored' | 'duplicate' | 'out-of-order'> {
  if (optIn !== true) throw new Error('Telemetry ingestion requires explicit local opt-in with --yes.');
  const saved = observation === undefined ? undefined : structuredClone(observation);
  lifecycle = lifecycle && structuredClone(lifecycle);
  if (saved) validateCodexObservation(saved);
  if (lifecycle) validateLifecycle(lifecycle);
  if (!saved && !lifecycle) throw new Error('No persistence record supplied.');
  if (!Number.isSafeInteger(now) || (saved && Date.parse(saved.observedAt) > now) || (lifecycle && Date.parse(lifecycle.receiptAt) > now)) throw new Error('Telemetry observation is in the future.');
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
    const { observations, lifecycles } = await readStore(dir);
    if (lifecycle) {
      const index = lifecycles.findIndex((item) => item.acquisitionId === lifecycle.acquisitionId);
      validateTransition(lifecycles[index], lifecycle);
      if (index < 0) {
        if (lifecycles.length >= MAX_ACQUISITIONS) throw new Error('Managed acquisition limit reached.');
        lifecycles.push(lifecycle);
      } else lifecycles[index] = lifecycle;
      if (saved && (saved.schemaVersion !== 2 || saved.sessionId !== lifecycle.acquisitionId || saved.threadId !== lifecycle.threadId ||
          saved.turnId !== lifecycle.turnId || saved.sequence !== lifecycle.sequence || saved.managed?.turn !== lifecycle.turn ||
          saved.managed?.connection !== lifecycle.connection || saved.managed?.receiptAt !== lifecycle.receiptAt)) throw new Error('Conflicting lifecycle observation.');
      if (!saved && observations.some((item) => item.schemaVersion === 2 && item.sessionId === lifecycle.acquisitionId)) throw new Error('Managed observation snapshot is required.');
    } else if (saved && lifecycles.some((item) => item.acquisitionId === saved.sessionId)) {
      throw new Error('Managed lifecycle publication is required.');
    }
    let changed = false;
    if (saved) {
      const index = observations.findIndex((item) => streamKey(item) === streamKey(saved));
      const previous = observations[index];
      if (previous && saved.sequence < previous.sequence) outcome = 'out-of-order';
      else if (previous && saved.sequence === previous.sequence) {
        if (!sameReport(previous, saved)) throw new Error('Conflicting telemetry sequence.');
        outcome = 'duplicate';
      } else if (previous && Date.parse(saved.observedAt) < Date.parse(previous.observedAt)) outcome = 'out-of-order';
      else {
        changed = true;
        // Replays do not refresh freshness. Advance the ordering watermark only.
        if (!lifecycle && previous && sameReport(previous, saved)) {
          saved.observedAt = previous.observedAt;
          outcome = 'duplicate';
        }
        if (index < 0) {
          if (observations.length >= MAX_STREAMS) throw new Error('Telemetry stream limit reached. Archive the local telemetry directory before starting another capture set.');
          observations.push(saved);
        } else observations[index] = saved;
      }
    }
    if (lifecycle && outcome !== 'stored') throw new Error('Inconsistent managed publication ordering.');
    if (lifecycle || changed) {
      const payload = { observations, lifecycles };
      const data = JSON.stringify(lifecycles.length ? { schemaVersion: 2, ...payload, digest: digestOf(payload) } : { schemaVersion: 1, observations, digest: digestOf(observations) }) + '\n';
      if (Buffer.byteLength(data) > MAX_STORE_BYTES) throw new Error('Telemetry store size limit exceeded.');
      validateStore(strictJson(data));
      const pendingPath = join(dir, 'pending.json');
      await safeEntry(pendingPath, false);
      // A fixed staging file bounds crash leftovers. Never overwrite an interrupted write.
      const pending = await open(pendingPath, 'wx', 0o600);
      try { await pending.writeFile(data); await pending.sync(); }
      finally { await pending.close(); }
      await safeEntry(join(dir, 'observations.json'), false);
      await rename(pendingPath, join(dir, 'observations.json'));
      if (process.platform !== 'win32') {
        const directory = await open(dir, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      }
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
