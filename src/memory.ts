import type { BigIntStats } from 'node:fs';
import { isUtf8 } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from './config.ts';
import { storeDir, writeJsonAtomic } from './storage.ts';

export const MAX_EVENT_BYTES = 16_384;
export const MAX_CHECKPOINT_MEMORY_BYTES = 12_000;
export const MAX_CHECKPOINT_MEMORY_EVENTS = 20;
export const MEMORY_TYPES = ['decision', 'task', 'blocker', 'note'] as const;
export interface MemoryEvent {
  schemaVersion: 1;
  id: string;
  timestamp: string;
  type: typeof MEMORY_TYPES[number];
  content: string;
  source: { kind: 'user-supplied' | 'agent-reported'; reference?: string };
  verification: 'unverified';
  relatedFiles?: string[];
}
export type MemoryInput = Pick<MemoryEvent, 'type' | 'content' | 'source' | 'relatedFiles'>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function privatePath(path: string): boolean {
  return path.split('/').some((part) => /^(?:\.env(?:\..*)?|\.ssh|\.aws|credentials(?:\..*)?|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/i.test(part));
}
export function validateMemoryPath(path: unknown): asserts path is string {
  if (typeof path !== 'string' || !path || path.length > 512 || /[\\:\x00-\x1f\x7f]/.test(path) ||
      path.split('/').some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)) || /[<>"|?*]/.test(path) || privatePath(path)) {
    throw new Error('Unsafe related file path. Use portable project-relative paths without sensitive files.');
  }
  checkText(path, 512);
}
function checkText(text: unknown, limit: number): asserts text is string {
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
    throw new Error('Invalid memory text or size limit exceeded.');
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b|\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|authorization)\s*[:=]\s*\S+|\b[a-z][a-z0-9+.-]*:\/\/[^\s/]+:[^\s/]+@/i.test(text)) {
    throw new Error('Potential secret detected. Remove sensitive information before recording memory.');
  }
}
export function validateMemoryEvent(value: unknown): asserts value is MemoryEvent {
  if (!record(value) || !keys(value, ['schemaVersion', 'id', 'timestamp', 'type', 'content', 'source', 'verification', 'relatedFiles']) ||
      value.schemaVersion !== 1 || typeof value.id !== 'string' || !/^mem_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id) ||
      typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp)) || new Date(value.timestamp).toISOString() !== value.timestamp ||
      !MEMORY_TYPES.includes(value.type as MemoryEvent['type']) || value.verification !== 'unverified' ||
      !record(value.source) || !keys(value.source, ['kind', 'reference']) || !['user-supplied', 'agent-reported'].includes(value.source.kind as string)) {
    throw new Error('Invalid memory event schema, type, or provenance.');
  }
  checkText(value.content, 8192);
  if (value.source.reference !== undefined) checkText(value.source.reference, 512);
  if (value.relatedFiles !== undefined) {
    if (!Array.isArray(value.relatedFiles) || value.relatedFiles.length > 32) throw new Error('Invalid related file list.');
    value.relatedFiles.forEach(validateMemoryPath);
  }
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_EVENT_BYTES) throw new Error('Memory event exceeds size limit.');
}
export function createMemoryEvent(input: MemoryInput): MemoryEvent {
  const event: MemoryEvent = { ...input, schemaVersion: 1, id: `mem_${randomUUID()}`, timestamp: new Date().toISOString(), verification: 'unverified' };
  validateMemoryEvent(event);
  return event;
}

// Reject links and unusual files at every storage component. Related paths are metadata only.
async function safeEntry(path: string, directory: boolean): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)) throw new Error('Unsafe memory storage path.');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
async function journalDir(root: string, create = false): Promise<string> {
  const dir = join(storeDir(root), 'journal');
  await safeEntry(storeDir(root), true);
  await loadConfig(root);
  await safeEntry(dir, true);
  if (create) await mkdir(dir, { recursive: true, mode: 0o700 });
  await safeEntry(join(dir, 'events.jsonl'), false);
  await safeEntry(join(dir, 'recovery'), true);
  return dir;
}
function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export interface MemoryRecovery {
  recovered: { offset: number; id: string }[];
  abandoned: { offset: number; digest: string }[];
}
interface Scan {
  tail?: { offset: number; digest: string; abandoned: boolean };
  count: number;
  recovery: MemoryRecovery;
}
async function scan(dir: string, visit: (event: MemoryEvent) => void, reserveId?: (id: string) => void): Promise<Scan> {
  const path = join(dir, 'events.jsonl');
  const recovery: MemoryRecovery = { recovered: [], abandoned: [] };
  if (!await safeEntry(path, false)) return { count: 0, recovery };
  const file = await open(path, 'r');
  const ids = new Set<string>();
  let pending = Buffer.alloc(0), offset = 0, count = 0;
  function parse(bytes: Buffer): MemoryEvent {
    if (!isUtf8(bytes)) throw new Error(`Invalid UTF-8 journal record at byte ${offset}.`);
    const event: unknown = JSON.parse(bytes.toString('utf8'));
    validateMemoryEvent(event);
    return event;
  }
  function reserve(event: MemoryEvent): void {
    if (ids.has(event.id)) throw new Error('Duplicate memory event identifier.');
    ids.add(event.id);
    reserveId?.(event.id);
  }
  async function line(bytes: Buffer, unterminated = false): Promise<boolean> {
    const marker = join(dir, 'recovery', `${offset}.json`);
    if (await safeEntry(marker, false)) {
      const saved = JSON.parse(await readFile(marker, 'utf8'));
      if (saved.offset !== offset || saved.digest !== hash(bytes)) throw new Error('Invalid journal recovery marker.');
      // Legacy markers remain authoritative, but valid excluded IDs stay reserved.
      let excluded: MemoryEvent | undefined;
      try { excluded = parse(bytes); } catch { /* A marker may describe an invalid fragment. */ }
      if (excluded) reserve(excluded);
      recovery.abandoned.push({ offset, digest: saved.digest });
      return true;
    }
    let event: MemoryEvent;
    try { event = parse(bytes); }
    catch (error) {
      // Syntax errors (including truncated UTF-8) are recoverable only at EOF.
      if (unterminated && (error instanceof SyntaxError || !isUtf8(bytes))) return true;
      if (error instanceof SyntaxError) throw new Error(`Malformed journal record at byte ${offset}.`);
      throw error;
    }
    reserve(event);
    count++;
    visit(event);
    if (unterminated) recovery.recovered.push({ offset, id: event.id });
    return false;
  }
  try {
    for await (const chunk of file.createReadStream()) {
      pending = Buffer.concat([pending, chunk]);
      let end: number;
      while ((end = pending.indexOf(10)) !== -1) {
        if (end > MAX_EVENT_BYTES) throw new Error('Journal record exceeds size limit.');
        await line(pending.subarray(0, end));
        offset += end + 1;
        pending = pending.subarray(end + 1);
      }
      if (pending.length > MAX_EVENT_BYTES) throw new Error('Journal record exceeds size limit.');
    }
  } finally { await file.close(); }
  const tail = pending.length ? { offset, digest: hash(pending), abandoned: await line(pending, true) } : undefined;
  return { count, recovery, ...(tail ? { tail } : {}) };
}
export async function listMemory(root: string): Promise<{ events: MemoryEvent[]; incompleteTail: boolean; recovery?: MemoryRecovery }> {
  const events: MemoryEvent[] = [];
  const result = await scan(await journalDir(root), (event) => events.push(event));
  return { events, incompleteTail: !!result.tail?.abandoned,
    ...(result.recovery.recovered.length || result.recovery.abandoned.length ? { recovery: result.recovery } : {}) };
}
export async function appendMemory(root: string, event: MemoryEvent): Promise<MemoryRecovery> {
  // Freeze validated data before any asynchronous work by serializing and parsing it.
  const serialized = JSON.stringify(event);
  const saved: unknown = JSON.parse(serialized);
  validateMemoryEvent(saved);
  const dir = await journalDir(root, true);
  const lockPath = join(dir, 'writer.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Memory writer lock exists. If no writer is running, remove .contextbridge/journal/writer.lock and retry.');
    throw error;
  }
  let owned: BigIntStats | undefined;
  let failure: unknown;
  let failed = false;
  let recovery: MemoryRecovery = { recovered: [], abandoned: [] };
  try {
    owned = await lock.stat({ bigint: true });
    const result = await scan(dir, () => {}, (id) => {
      if (id === saved.id) throw new Error('Duplicate memory event identifier.');
    });
    recovery = result.recovery;
    if (result.tail?.abandoned) {
      // Record only a hash and offset before sealing the interrupted tail. Never rewrite history.
      if (!recovery.abandoned.some((item) => item.offset === result.tail!.offset)) recovery.abandoned.push({ offset: result.tail.offset, digest: result.tail.digest });
      const markerPath = join(dir, 'recovery', `${result.tail.offset}.json`);
      if (!await safeEntry(markerPath, false)) {
        await writeJsonAtomic(markerPath, { offset: result.tail.offset, digest: result.tail.digest });
      }
      const marker = await open(markerPath, 'r+');
      try { await marker.sync(); } finally { await marker.close(); }
    }
    await safeEntry(join(dir, 'events.jsonl'), false);
    const file = await open(join(dir, 'events.jsonl'), 'a', 0o600);
    try { await file.writeFile(`${result.tail ? '\n' : ''}${serialized}\n`); await file.sync(); }
    finally { await file.close(); }
  } catch (error) { failed = true; failure = error; }
  const cleanupErrors: unknown[] = [];
  try { await lock.close(); } catch (error) { cleanupErrors.push(error); }
  try {
    const current = await lstat(lockPath, { bigint: true });
    if (owned && current.isFile() && !current.isSymbolicLink() && current.dev === owned.dev && current.ino === owned.ino) await unlink(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') cleanupErrors.push(error);
  }
  if (failed && !cleanupErrors.length) throw failure;
  if (cleanupErrors.length) throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors,
    failed && failure instanceof Error ? failure.message : 'Memory writer lock cleanup failed; the event may already be committed.',
    failed ? { cause: failure } : undefined);
  return recovery;
}

export async function selectCheckpointMemory(root: string): Promise<{ events: MemoryEvent[]; omitted: number; incompleteTail: boolean }> {
  const events: MemoryEvent[] = [];
  let bytes = 0;
  const result = await scan(await journalDir(root), (event) => {
    events.push(event);
    bytes += Buffer.byteLength(JSON.stringify(event));
    while (events.length > MAX_CHECKPOINT_MEMORY_EVENTS || bytes > MAX_CHECKPOINT_MEMORY_BYTES) bytes -= Buffer.byteLength(JSON.stringify(events.shift()!));
  });
  return { events, omitted: result.count - events.length, incompleteTail: !!result.tail?.abandoned };
}
