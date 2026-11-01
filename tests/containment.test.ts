import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, access, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { ManagedCapture } from '../src/managed/session.ts';
import { initProject } from '../src/config.ts';
import { listLifecycles } from '../src/telemetry/store.ts';
import { ManagedTransport } from '../src/managed/transport.ts';
import { CLEANUP_DIAGNOSTIC, OwnedProcess } from '../src/managed/process.ts';
const posix = { skip: process.platform === 'win32' };
const fixture = resolve('tests/fixtures/managed/process-tree.mjs');
async function until(check: () => Promise<boolean>, ms = 3000) {
  const deadline = performance.now() + ms;
  while (!await check()) {
    assert.ok(performance.now() < deadline, 'Bounded fixture synchronization timed out.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
async function setup(t, mode = 'normal') {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-containment-'));
  // Emergency cleanup uses a test-only channel, never persisted PID signaling.
  t.after(async () => {
    await writeFile(join(root, 'emergency-stop'), 'stop');
    await until(async () => {
      for (const role of mode === 'hung' || mode === 'alone' ? ['leader'] : ['leader', 'branch', 'sibling', 'grandchild']) {
        if (await exists(join(root, `${role}-ready`)) && !await exists(join(root, `${role}-exit`))) {
          const pid = Number(await readFile(join(root, `${role}-ready`), 'utf8'));
          try { process.kill(pid, 0); return false; } catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
      }
      return true;
    }, 9000);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
async function ready(root: string, mode: string) {
  for (const role of mode === 'hung' || mode === 'alone' ? ['leader'] : ['leader', 'branch', 'sibling', 'grandchild']) {
    await until(() => exists(join(root, `${role}-ready`)));
  }
}
function transport(root: string, mode: string, signal?: AbortSignal) {
  return new ManagedTransport(process.execPath, [fixture, root, 'leader', mode], root, 500, signal);
}
for (const mode of ['alone', 'normal', 'hung']) test(`owned process bounded cleanup: ${mode}`, posix, async (t) => {
  const root = await setup(t, mode);
  const rpc = transport(root, mode);
  t.after(() => rpc.stop());
  await ready(root, mode);
  await Promise.all([rpc.stop(), rpc.stop(), rpc.stop()]);
  await rpc.stop();
  assert.equal(rpc.cleanup, 'confirmed');
  await assert.rejects(rpc.request('initialize', {}));
  if (mode === 'normal') for (const role of ['leader', 'branch', 'sibling', 'grandchild']) assert.equal(await exists(join(root, `${role}-exit`)), true);
  if (mode === 'hung') assert.equal(await exists(join(root, 'leader-term')), true);
  assert.equal(await exists(join(root, 'leader-unauthorized')), false);
});

test('cancellation cleans up without installing global signal handlers', posix, async (t) => {
  const root = await setup(t);
  const controller = new AbortController();
  const before = ['SIGINT', 'SIGTERM'].map((s) => process.listenerCount(s));
  const rpc = transport(root, 'normal', controller.signal); t.after(() => rpc.stop());
  await ready(root, 'normal');
  controller.abort();
  await assert.rejects(rpc.request('initialize', {}));
  await rpc.stop();
  assert.deepEqual(['SIGINT', 'SIGTERM'].map((s) => process.listenerCount(s)), before);
});

test('already cancelled creation fails before spawning', posix, async (t) => {
  const root = await setup(t, 'alone');
  assert.throws(() => transport(root, 'alone', AbortSignal.abort()), /connection failed/);
  assert.equal(await exists(join(root, 'leader-ready')), false);
});

test('independent group remains responsive after another group stops', posix, async (t) => {
  const root = await setup(t); const other = await setup(t, 'alone');
  const rpc = transport(root, 'normal'); const independent = transport(other, 'alone');
  t.after(() => rpc.stop()); t.after(() => independent.stop());
  await ready(root, 'normal'); await ready(other, 'alone');
  await rpc.stop();
  assert.deepEqual(await independent.request('initialize', {}), {});
});

for (const mode of ['early', 'escaped']) test(mode === 'early' ? 'leader exit before cleanup leaves sticky uncertainty' : 'escaped descendants remain outside the group guarantee', posix, async (t) => {
  const root = await setup(t, mode);
  const owner = mode === 'early' ? new OwnedProcess(process.execPath, [fixture, root, 'leader', mode], root) : undefined;
  const rpc = owner ?? transport(root, mode);
  await ready(root, mode);
  if (owner) {
    const exited = new Promise((resolve) => owner.child.once('exit', resolve));
    owner.child.stdin.write(JSON.stringify({ method: 'initialize' }) + '\n');
    await exited;
  }
  // Escaped descendants cannot be detected by a process-group probe. This test checks
  // only the surviving in-group processes after early leader exit.
  if (mode === 'early') {
    for (let i = 0; i < 2; i++) await assert.rejects(rpc.stop(), { message: CLEANUP_DIAGNOSTIC });
    assert.equal(rpc.cleanup, 'unconfirmed');
  } else {
    // The leader waits for escaped children; bounded escalation kills its own group.
    await rpc.stop().catch((error) => assert.equal(error.message, CLEANUP_DIAGNOSTIC));
    assert.equal(await exists(join(root, 'branch-exit')), false);
  }
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) test(`application-owned ${signal} shutdown`, posix, async (t) => {
  const root = await setup(t);
  const parent = spawn(process.execPath, ['--experimental-strip-types', resolve('tests/fixtures/managed/parent.mjs'), root], { stdio: ['ignore', 'pipe', 'pipe'], env: {} });
  const exited = new Promise<number | null>((resolve) => parent.once('exit', resolve));
  t.after(async () => { if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL'); await exited; });
  await ready(root, 'normal'); await until(() => exists(join(root, 'parent-ready')));
  parent.kill(signal);
  assert.equal(await exited, 0);
  assert.equal(await exists(join(root, 'parent-clean')), true);
});

test('termination signals target only the creation-local group and never repeat after exit', posix, async (t) => {
  const root = await setup(t, 'alone');
  const owner = new OwnedProcess(process.execPath, [fixture, root, 'leader', 'alone'], root);
  await ready(root, 'alone');
  const original = process.kill;
  const signals: number[] = [];
  process.kill = ((pid, signal) => {
    if (signal !== 0) { assert.equal(pid, -owner.child.pid!); signals.push(pid); }
    return original(pid, signal);
  }) as typeof process.kill;
  try { await owner.stop(); const count = signals.length; await owner.stop(); assert.equal(signals.length, count); }
  finally { process.kill = original; }
  assert.ok(signals.length > 0);
});

test('unresolved signaling failure rejects every cleanup caller with a fixed diagnostic', posix, async (t) => {
  const root = await setup(t, 'alone');
  const owner = new OwnedProcess(process.execPath, [fixture, root, 'leader', 'alone'], root);
  await ready(root, 'alone');
  const original = process.kill;
  process.kill = ((pid, signal) => {
    if (pid === -owner.child.pid! && signal !== 0) throw Object.assign(new Error('PRIVATE_PROCESS_CANARY'), { code: 'EPERM' });
    return original(pid, signal);
  }) as typeof process.kill;
  try {
    for (const result of await Promise.allSettled([owner.stop(), owner.stop()])) {
      assert.equal(result.status, 'rejected');
      if (result.status === 'rejected') assert.equal(result.reason.message, CLEANUP_DIAGNOSTIC);
    }
    assert.equal(owner.cleanup, 'unconfirmed');
  } finally { process.kill = original; }
});

test('pending transport failure during graceful shutdown rejects all waiters', posix, async (t) => {
  const root = await setup(t, 'hung');
  const rpc = transport(root, 'hung'); t.after(() => rpc.stop());
  await ready(root, 'hung');
  const results = Promise.allSettled([rpc.request('initialize', {}), rpc.request('account/read', { refreshToken: false })]);
  const stopping = rpc.stop();
  await assert.rejects(rpc.request('initialize', {}));
  assert.ok((await results).every((result) => result.status === 'rejected'));
  await stopping;
  assert.equal(rpc.cleanup, 'confirmed');
});

test('spawn failure remains bounded and exposes no executable error text', posix, async (t) => {
  const root = await setup(t, 'alone');
  const rpc = new ManagedTransport(join(root, 'PRIVATE_PROCESS_CANARY'), [], root);
  await assert.rejects(rpc.request('initialize', {}), { message: 'Managed protocol connection failed.' });
  await rpc.stop();
  assert.equal(rpc.cleanup, 'confirmed');
});

for (const mode of ['exit', 'exception', 'kill']) test(`unexpected parent ${mode} does not claim child cleanup`, posix, async (t) => {
  const root = await setup(t);
  const parent = spawn(process.execPath, ['--experimental-strip-types', resolve('tests/fixtures/managed/parent.mjs'), root, mode], { stdio: 'ignore', env: {} });
  const exited = new Promise((resolve) => parent.once('exit', resolve));
  t.after(async () => { if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL'); await exited; });
  await ready(root, 'normal'); await until(() => exists(join(root, 'parent-ready')));
  if (mode === 'kill') parent.kill('SIGKILL');
  else await writeFile(join(root, 'parent-fail'), 'fail');
  await exited;
  assert.equal(await exists(join(root, 'parent-clean')), false);
  assert.equal(await exists(join(root, 'leader-exit')), false);
});

for (const mode of ['running', 'normal']) test(`concurrent capture stop preserves turn evidence: ${mode}`, posix, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-containment-lifecycle-'));
  const rpc = new ManagedTransport(process.execPath, [resolve('tests/fixtures/managed/server.mjs'), mode], root);
  const capture = new ManagedCapture(rpc, root);
  t.after(async () => { try { await rpc.stop(); } finally { await rm(root, { recursive: true, force: true }); } });
  await initProject(root, 'codex');
  await capture.initialize(true, root);
  await capture.sendOneTurn(Buffer.from('PRIVATE_PROCESS_CANARY'), true);
  if (mode === 'normal') await until(async () => capture.state === 'turn-completed');
  await Promise.all([capture.stop(), capture.stop(), capture.stop()]);
  const [record] = await listLifecycles(root);
  assert.equal(record.connection, 'stopped');
  assert.equal(record.turn, mode === 'running' ? 'unknown-outcome' : 'turn-completed');
  assert.equal(record.terminalEvidence, mode === 'running' ? 'none' : 'turn/completed');
  await capture.stop();
  assert.deepEqual(await listLifecycles(root), [record]);
});
