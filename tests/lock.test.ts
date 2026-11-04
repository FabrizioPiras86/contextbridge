import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../src/config.ts';
import { appendMemory, createMemoryEvent } from '../src/memory.ts';
import { manageHooks } from '../src/hooks/install.ts';
import { parseCodexTokenUsage } from '../src/telemetry/codex.ts';
import { ingestTelemetry } from '../src/telemetry/store.ts';
import { ownsLock } from '../src/lock.ts';

const at = '2026-11-01T10:00:00.000Z';
const counters = { inputTokens: 1, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 1 };
const writers = [
  { name: 'memory', path: ['journal', 'writer.lock'], write: (root: string) => appendMemory(root,
    createMemoryEvent({ type: 'note', content: 'Lock regression', source: { kind: 'user-supplied' } })) },
  { name: 'telemetry', path: ['telemetry', 'writer.lock'], write: (root: string) => ingestTelemetry(root,
    parseCodexTokenUsage(Buffer.from(JSON.stringify({ method: 'thread/tokenUsage/updated', params: {
      threadId: 'thread-1', turnId: 'turn-1', tokenUsage: { total: counters, last: counters, modelContextWindow: null },
    } })), { sourceVersion: '0.166.0', sessionId: 'lock-test', observedAt: at, sequence: 1 }), true, Date.parse(at)) },
  { name: 'hooks', path: ['hooks.lock'], write: (root: string) => manageHooks(root, 'install') },
];
async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'contextbridge-lock-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await initProject(root, 'codex');
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return fs.realpath(root);
}
for (const writer of writers) {
  test(`${writer.name} releases its lock despite inconsistent path device metadata`, async (t) => {
    const root = await fixture(t);
    const path = join(root, '.contextbridge', ...writer.path);
    const lstat = fs.lstat;
    t.mock.method(fs, 'lstat', async (...args) => {
      const value = await lstat(...args);
      if (String(args[0]) === path) value.dev = value.dev === 0n ? 1n : 0n;
      return value;
    });
    syncBuiltinESMExports();
    await writer.write(root);
    await assert.rejects(fs.stat(path), { code: 'ENOENT' });
    await writer.write(root);
    await assert.rejects(fs.stat(path), { code: 'ENOENT' });
    await fs.writeFile(path, 'Existing owner');
    await assert.rejects(writer.write(root));
    assert.equal(await fs.readFile(path, 'utf8'), 'Existing owner');
  });
  test(`${writer.name} preserves a replacement lock`, async (t) => {
    const root = await fixture(t);
    const path = join(root, '.contextbridge', ...writer.path);
    const open = fs.open;
    t.mock.method(fs, 'open', async (...args) => {
      const handle = await open(...args);
      if (String(args[0]) === path && args[1] === 'wx') {
        const close = handle.close.bind(handle);
        handle.close = async () => {
          await close();
          await fs.rename(path, path + '.previous');
          await fs.writeFile(path, 'Replacement owner');
        };
      }
      return handle;
    });
    syncBuiltinESMExports();
    await writer.write(root);
    assert.equal(await fs.readFile(path, 'utf8'), 'Replacement owner');
  });
}
test('lock identity requires both device and full bigint inode and rejects unknown identity', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'lock');
  const handle = await fs.open(path, 'wx');
  const identity = await handle.stat({ bigint: true });
  const entry = await fs.lstat(path, { bigint: true });
  t.diagnostic(`Node ${process.version}, libuv ${process.versions.uv}, ${process.platform}: handle dev=${identity.dev} ino=${identity.ino}; path dev=${entry.dev} ino=${entry.ino}`);
  await handle.close();
  assert.equal(await ownsLock(path, identity), true);
  for (const override of [{ dev: identity.dev + 1n }, { ino: identity.ino + 1n }, { ino: 0n }]) {
    const changed = Object.assign(Object.create(Object.getPrototypeOf(identity)), identity, override);
    assert.equal(await ownsLock(path, changed), false);
  }
  assert.equal(await ownsLock(path, undefined), false);
  assert.equal(await ownsLock(root, identity), false);
  await fs.rm(path);
  await assert.rejects(ownsLock(path, identity), { code: 'ENOENT' });
});
test('lock identity inspection errors propagate without removing the lock', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'lock');
  const handle = await fs.open(path, 'wx');
  const identity = await handle.stat({ bigint: true });
  await handle.close();
  t.mock.method(fs, 'open', async () => { throw new Error('Injected inspection failure'); });
  syncBuiltinESMExports();
  await assert.rejects(ownsLock(path, identity), /Injected inspection failure/);
  assert.equal(await fs.readFile(path, 'utf8'), '');
});

test('lock identity rejects symbolic links before opening the path', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'lock');
  const handle = await fs.open(path, 'wx');
  const identity = await handle.stat({ bigint: true });
  await handle.close();
  const lstat = fs.lstat;
  t.mock.method(fs, 'lstat', async (...args) => {
    const value = await lstat(...args);
    value.isSymbolicLink = () => true;
    return value;
  });
  t.mock.method(fs, 'open', async () => { assert.fail('Symbolic link must not be opened'); });
  syncBuiltinESMExports();
  assert.equal(await ownsLock(path, identity), false);
});
