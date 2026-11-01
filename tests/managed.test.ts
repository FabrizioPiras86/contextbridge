import { mockEvidence } from './fixtures/managed/evidence.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ManagedTransport, PENDING_LIMIT } from '../src/managed/transport.ts';
import { ManagedCapture } from '../src/managed/session.ts';
import { initProject } from '../src/config.ts';
import { ingestTelemetry, listTelemetry } from '../src/telemetry/store.ts';
import { parseCodexTokenUsage } from '../src/telemetry/codex.ts';
import { createCheckpoint } from '../src/snapshot.ts';
import { listMemory } from '../src/memory.ts';
const mock = resolve('tests/fixtures/managed/server.mjs');
const canary = 'PRIVATE_MANAGED_CANARY_9187';
const pause = () => new Promise((r) => setTimeout(r, 40));
const posix = { skip: process.platform === 'win32' };
async function captureRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-lifecycle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initProject(root, 'codex');
  return root;
}
function transport(mode = 'normal', deadline = 1000) { return new ManagedTransport(process.execPath, [mock, mode], process.cwd(), deadline); }

test('generated schema fixtures retain exact checksums and reviewed public methods', async () => {
  const dir = resolve('tests/fixtures/managed');
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  for (const [file, digest] of Object.entries(manifest.sha256)) assert.equal(createHash('sha256').update(await readFile(join(dir, file))).digest('hex'), digest);
  const requests = JSON.parse(await readFile(join(dir, 'ClientRequest.json'), 'utf8'));
  const serialized = JSON.stringify(requests);
  for (const method of ['initialize', 'thread/start', 'turn/start', 'turn/interrupt', 'account/read']) assert.ok(serialized.includes('"' + method + '"'));
});

for (const mode of ['normal', 'fragment', 'stderr', 'failed', 'interrupt', 'running']) test(`mock subprocess lifecycle and privacy: ${mode}`, posix, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-managed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initProject(root, 'codex');
  const rpc = transport(mode); const capture = new ManagedCapture(rpc, root, mockEvidence); t.after(() => capture.stop());
  await capture.initialize(true, process.cwd());
  assert.equal(capture.state, 'ready');
  await assert.rejects(capture.sendOneTurn(Buffer.from(canary), false), /authorization/);
  await assert.rejects(rpc.request('turn/start', {}), /authorization/);
  await capture.sendOneTurn(Buffer.from(canary), true);
  await pause();
  if (mode === 'interrupt') { await capture.interrupt(); await pause(); }
  const expected = mode === 'failed' ? 'turn-failed' : mode === 'interrupt' ? 'turn-interrupted' : mode === 'running' ? 'turn-running' : 'turn-completed';
  assert.equal(capture.state, expected);
  await assert.rejects(capture.sendOneTurn(Buffer.from('again'), true));
  await capture.stop();
  const observation = capture.observation()!;
  assert.equal(observation.managed!.turn, mode === 'running' ? 'unknown-outcome' : expected);
  assert.equal(observation.managed!.connection, 'stopped');
  assert.equal(observation.schemaVersion, 2);
  await capture.persist(root, true);
  assert.equal((await listTelemetry(root)).length, 1);
  assert.equal(JSON.stringify(await listMemory(root)).includes(canary), false);
  const bytes = await readFile(join(root, '.contextbridge/telemetry/observations.json'), 'utf8');
  assert.equal(bytes.includes(canary), false); assert.equal(bytes.includes('thread-1'), false);
  assert.equal(JSON.stringify(capture).includes(canary), false);
  const snapshot = await createCheckpoint(root, { objective: 'Privacy verification', nextStep: 'Inspect metadata' });
  assert.equal(JSON.stringify(snapshot).includes(canary), false);
  assert.equal((await readFile(join(root, '.contextbridge/HANDOFF.md'), 'utf8')).includes(canary), false);
});

for (const mode of ['invalid', 'invalid-utf8', 'partial', 'delayed', 'duplicate', 'overflow', 'depth', 'bad-id', 'unknown-id', 'drop', 'missing', 'hang', 'approval', 'error', 'policy']) test(`fails safely without sensitive diagnostics: ${mode}`, posix, async (t) => {
  const root = await captureRoot(t);
  const rpc = transport(mode, 200); t.after(() => rpc.stop());
  const capture = new ManagedCapture(rpc, root, mockEvidence);
  await assert.rejects(capture.initialize(true, process.cwd()), (error: Error) => !error.message.includes(canary));
  assert.equal(capture.observation(), undefined);
});

test('pending admission bounded and shutdown rejects every waiter', posix, async () => {
  const rpc = transport('missing', 200);
  const results = await Promise.allSettled(Array.from({ length: PENDING_LIMIT + 3 }, () => rpc.request('account/read', { refreshToken: false })));
  assert.ok(results.every((r) => r.status === 'rejected'));
  await rpc.stop();
});

test('connection loss after turn submission is uncertain and cannot replay', posix, async (t) => {
  const root = await captureRoot(t);
  const rpc = transport('turn-drop'); t.after(() => rpc.stop());
  const capture = new ManagedCapture(rpc, root, mockEvidence);
  await capture.initialize(true, process.cwd());
  await assert.rejects(capture.sendOneTurn(Buffer.from('hello'), true));
  assert.equal(capture.state, 'unknown-outcome');
  await assert.rejects(capture.sendOneTurn(Buffer.from('retry'), true));
});

test('real CLI capture is disabled without starting a provider or reading stdin', () => {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', 'src/cli.ts', 'context', 'run', '--agent', 'codex', '--yes'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /execution is disabled/); assert.equal((result.stdout + result.stderr).includes(canary), false);
});

test('Windows subprocess execution fails closed', { skip: process.platform !== 'win32' }, () => {
  assert.throws(() => transport(), /disabled on Windows/);
});

test('M2.1 imports coexist unchanged with managed records and interrupted staging stays unpublished', posix, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-managed-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initProject(root, 'codex');
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
  const imported = parseCodexTokenUsage(Buffer.from(JSON.stringify({ method: 'thread/tokenUsage/updated', params: { threadId: 'import-thread', turnId: 'import-turn', tokenUsage: { total: usage, last: usage } } })), {
    sourceVersion: '0.166.0', sessionId: 'import-capture', observedAt: new Date().toISOString(), sequence: 1,
  });
  await ingestTelemetry(root, imported, true);
  const rpc = transport(); const capture = new ManagedCapture(rpc, root, mockEvidence); t.after(() => capture.stop());
  await capture.initialize(true, process.cwd()); await capture.sendOneTurn(Buffer.from('safe'), true); await pause(); await capture.stop();
  await capture.persist(root, true);
  assert.deepEqual((await listTelemetry(root)).find((item) => item.schemaVersion === 1), imported);
  const dir = join(root, '.contextbridge/telemetry');
  await writeFile(join(dir, 'pending.json'), '{');
  assert.equal((await listTelemetry(root)).length, 2);
  const observation = capture.observation()!; observation.sequence++;
  observation.managed!.receiptAt = new Date(Date.now() + 1).toISOString();
  await assert.rejects(ingestTelemetry(root, observation, true));
  assert.equal((await listTelemetry(root)).length, 2);
});

test('authorization and bounded prompt validation happen before submission', posix, async (t) => {
  const root = await captureRoot(t);
  const rpc = transport(); const capture = new ManagedCapture(rpc, root, mockEvidence); t.after(() => capture.stop());
  await assert.rejects(capture.initialize(false, process.cwd()), /authorization/);
  await capture.initialize(true, process.cwd());
  for (const prompt of [Buffer.alloc(0), Buffer.alloc(8193), Buffer.from([255])]) await assert.rejects(capture.sendOneTurn(prompt, true), /prompt/);
  assert.equal(capture.state, 'ready');
  await assert.rejects(rpc.request('account/read', { refreshToken: true }));
  await capture.sendOneTurn(Buffer.from('safe'), true);
  await capture.stop();
});

test('stdin backpressure stops admission with no application write queue', posix, async (t) => {
  const rpc = transport('no-read', 300); t.after(() => rpc.stop());
  const results: Promise<unknown>[] = [];
  for (let i = 0; i < PENDING_LIMIT && !rpc.backpressured; i++) results.push(rpc.request('initialize', { padding: 'x'.repeat(60_000) }));
  assert.equal(rpc.backpressured, true);
  results.push(rpc.request('initialize', {}));
  assert.ok((await Promise.allSettled(results)).every((result) => result.status === 'rejected'));
});

test('privileged server requests receive zero automatic responses', posix, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-approval-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = join(root, 'response-marker');
  const rpc = new ManagedTransport(process.execPath, [mock, 'approval', marker], root, 500);
  t.after(() => rpc.stop());
  await assert.rejects(rpc.request('initialize', { clientInfo: { name: 'contextbridge', version: '0.0.1' } }));
  await rpc.stop();
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});

test('child signal termination disconnects pending requests without affecting another owned process', posix, async (t) => {
  const signaled = transport('signal'); const independent = transport();
  t.after(() => signaled.stop()); t.after(() => independent.stop());
  await assert.rejects(signaled.request('initialize', {}));
  const capture = new ManagedCapture(independent, await captureRoot(t), mockEvidence);
  t.after(() => capture.stop());
  await capture.initialize(true, process.cwd());
  await signaled.stop();
  assert.deepEqual(await independent.request('account/read', { refreshToken: false }), {});
  assert.equal(capture.state, 'ready');
  await capture.stop();
});
