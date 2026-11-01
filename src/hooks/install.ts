import type { BigIntStats } from 'node:fs';
import { isUtf8 } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadConfig } from '../config.ts';
import { writeJsonAtomic } from '../storage.ts';

const MAX_CONFIG_BYTES = 262_144;
const entry = fileURLToPath(new URL('../../bin/contextbridge-hook.mjs', import.meta.url));
const owner = 'ContextBridge automatic memory capture';
type Document = Record<string, unknown> & { hooks: Record<string, unknown[]> };
interface Receipt {
  schemaVersion: 1;
  beforeHash: string | null;
  removalHash?: string | null;
  groups: Record<string, unknown>;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
async function safe(path: string, directory = false): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)) throw new Error('Unsafe hook integration path.');
    if (!directory && info.size > MAX_CONFIG_BYTES) throw new Error('Hook configuration exceeds size limit.');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
async function bytes(path: string): Promise<Buffer | null> {
  if (!await safe(path)) return null;
  const value = await readFile(path);
  if (value.length > MAX_CONFIG_BYTES || !isUtf8(value)) throw new Error('Invalid or oversized hook configuration encoding.');
  return value;
}
function hash(value: Buffer | null): string | null {
  return value === null ? null : createHash('sha256').update(value).digest('hex');
}
function document(value: Buffer | null): Document {
  if (value === null) return { hooks: {} };
  let parsed: unknown;
  try { parsed = JSON.parse(value.toString('utf8')); } catch { throw new Error('Invalid Codex hooks configuration.'); }
  if (!object(parsed) || (parsed.hooks !== undefined && !object(parsed.hooks))) throw new Error('Invalid Codex hooks configuration.');
  const hooks = parsed.hooks ?? {};
  if (Object.values(hooks).some((groups) => !Array.isArray(groups))) throw new Error('Invalid Codex hook groups.');
  return { ...parsed, hooks } as Document;
}
export function quoteHookArgument(value: string, windows = false): string {
  // Fail closed for Windows shell metacharacters and expansions, rather than guess a shell dialect.
  if (windows) {
    if (/["%!&|<>^`$\x00-\x1f]/.test(value)) throw new Error('Hook path cannot be safely quoted on Windows.');
    return `"${value}"`;
  }
  if (/[\x00-\x1f]/.test(value)) throw new Error('Invalid hook command path.');
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
export function hookGroups(root: string, windows = process.platform === 'win32'): Record<string, unknown> {
  const command = windows
    ? 'node ' + [entry, '--project', root].map((arg) => quoteHookArgument(arg, true)).join(' ')
    : [process.execPath, entry, '--project', root].map((arg) => quoteHookArgument(arg)).join(' ');
  return Object.fromEntries(['SessionStart', 'Stop'].map((event) => [event, {
    hooks: [{ type: 'command', command, timeout: 6, statusMessage: owner }],
  }]));
}
export function codexHookCompatibility(executable = 'codex', project?: string): { supported: boolean; version: string; reason: string } {
  const version = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 2000, maxBuffer: 65_536, shell: false, cwd: project, killSignal: 'SIGKILL' });
  const label = version.status === 0 ? version.stdout.trim() : 'unavailable';
  if (label !== 'codex-cli 0.166.0') return { supported: false, version: label, reason: 'Only codex-cli 0.166.0 has been checked for this integration.' };
  const features = spawnSync(executable, ['features', 'list'], { encoding: 'utf8', timeout: 2000, maxBuffer: 65_536, shell: false, cwd: project, killSignal: 'SIGKILL' });
  const supported = features.status === 0 && /^hooks\s+stable\s+true\s*$/m.test(features.stdout);
  return { supported, version: label, reason: supported ? 'Documented hook contract available; runtime trust review is still required.' : 'Codex hooks are unavailable or disabled; settings were not changed.' };
}
async function paths(project: string) {
  const root = await realpath(resolve(project));
  await safe(join(root, '.contextbridge'), true);
  await safe(join(root, '.contextbridge', 'config.json'));
  await loadConfig(root);
  const codex = join(root, '.codex');
  const integrations = join(root, '.contextbridge', 'integrations');
  await safe(codex, true);
  await safe(integrations, true);
  return { root, codex, integrations, config: join(codex, 'hooks.json'), receipt: join(integrations, 'codex-hooks.json') };
}
function receipt(value: Buffer | null): Receipt | undefined {
  if (value === null) return;
  let saved: unknown;
  try { saved = JSON.parse(value.toString('utf8')); } catch { throw new Error('Invalid ContextBridge hook receipt.'); }
  if (!object(saved) || saved.schemaVersion !== 1 || !(saved.beforeHash === null || typeof saved.beforeHash === 'string' && /^[0-9a-f]{64}$/.test(saved.beforeHash)) ||
      !(saved.removalHash === undefined || saved.removalHash === null || typeof saved.removalHash === 'string' && /^[0-9a-f]{64}$/.test(saved.removalHash)) ||
      !object(saved.groups) || Object.keys(saved.groups).sort().join(',') !== 'SessionStart,Stop') throw new Error('Invalid ContextBridge hook receipt.');
  return saved as unknown as Receipt;
}
function matches(doc: Document, saved: Receipt): boolean {
  return Object.entries(saved.groups).every(([event, group]) => (doc.hooks[event] ?? []).filter((item) => isDeepStrictEqual(item, group)).length === 1);
}
export async function hooksStatus(project: string) {
  const p = await paths(project);
  const current = await bytes(p.config);
  const doc = document(current);
  const saved = receipt(await bytes(p.receipt));
  let state = 'not-installed';
  if (saved) {
    if (saved.removalHash !== undefined && hash(current) === saved.removalHash) state = 'removal-pending';
    else if (matches(doc, saved)) state = 'installed';
    else state = hash(current) === saved.beforeHash ? 'pending' : 'conflict';
  }
  return { state, project: p.root, config: p.config, trust: 'Review in Codex /hooks; trust is not modified or inferred.' };
}
export async function requireHooksInstalled(project: string): Promise<void> {
  if ((await hooksStatus(project)).state !== 'installed') throw new Error('ContextBridge hooks are not installed or have a configuration conflict.');
}
export async function manageHooks(project: string, action: 'install' | 'uninstall', dryRun = false): Promise<string> {
  const p = await paths(project);
  // One local management lock serializes ContextBridge installers, not external editors.
  const lockPath = join(p.root, '.contextbridge', 'hooks.lock');
  let lock;
  if (!dryRun) lock = await open(lockPath, 'wx', 0o600);
  let identity: BigIntStats | undefined;
  try {
    identity = lock ? await lock.stat({ bigint: true }) : undefined;
    const current = await bytes(p.config);
    const doc = document(current);
    const saved = receipt(await bytes(p.receipt));
    if (action === 'install') {
      if (saved?.removalHash !== undefined) throw new Error('Finish the pending hook uninstall before installing again.');
      if (saved && matches(doc, saved)) return 'ContextBridge Codex hooks are already installed; review trust in /hooks.';
      if (saved && hash(current) !== saved.beforeHash) throw new Error('Codex hook installation conflict; no configuration overwritten.');
      if (!saved && JSON.stringify(doc).includes(owner)) throw new Error('Unowned ContextBridge hook configuration conflict.');
      const state: Receipt = saved ?? { schemaVersion: 1, beforeHash: hash(current), groups: hookGroups(p.root) };
      for (const [event, group] of Object.entries(state.groups)) doc.hooks[event] = [...(doc.hooks[event] ?? []), group];
      if (dryRun) return `Would install project-local SessionStart and Stop hooks in ${p.config}. No files changed.`;
      await mkdir(p.codex, { recursive: true, mode: 0o700 });
      await mkdir(p.integrations, { recursive: true, mode: 0o700 });
      if (!saved) await writeJsonAtomic(p.receipt, state);
      if (hash(await bytes(p.config)) !== hash(current)) throw new Error('Codex hooks changed during installation; retry after review.');
      await writeJsonAtomic(p.config, doc);
      return 'Installed project-local ContextBridge Codex hooks. Review and trust the definitions with Codex /hooks before use.';
    }
    if (!saved) return 'ContextBridge Codex hooks are not installed; no files changed.';
    const removalPublished = saved.removalHash !== undefined && hash(current) === saved.removalHash;
    const pending = hash(current) === saved.beforeHash || removalPublished;
    if (!pending && !matches(doc, saved)) throw new Error('Codex hook removal conflict; preserve files and review the edited hook definitions.');
    if (!pending) for (const [event, group] of Object.entries(saved.groups)) {
      doc.hooks[event] = doc.hooks[event].filter((item) => !isDeepStrictEqual(item, group));
      if (!doc.hooks[event].length) delete doc.hooks[event];
    }
    if (dryRun) return `Would remove only owned ContextBridge hooks from ${p.config}. No files changed.`;
    if (hash(await bytes(p.config)) !== hash(current)) throw new Error('Codex hooks changed during removal; no configuration overwritten.');
    if (!pending) {
      const removeFile = saved.beforeHash === null && Object.keys(doc).length === 1 && !Object.keys(doc.hooks).length;
      await writeJsonAtomic(p.receipt, { ...saved, removalHash: removeFile ? null : hash(Buffer.from(JSON.stringify(doc, null, 2) + '\n')) });
      if (removeFile) await unlink(p.config);
      else await writeJsonAtomic(p.config, doc);
    }
    await unlink(p.receipt);
    return 'Removed ContextBridge Codex hooks; other hooks, Codex settings, and recorded memory were preserved.';
  } finally {
    if (lock) {
      try { await lock.close(); } finally {
        const current = await lstat(lockPath, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return undefined;
        });
        if (identity && current?.isFile() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) await unlink(lockPath);
      }
    }
  }
}
