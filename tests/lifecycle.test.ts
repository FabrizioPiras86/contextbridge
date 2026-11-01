import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initProject } from '../src/config.ts';
import { identity } from '../src/telemetry/model.ts';
import { digestOf } from '../src/storage.ts';
import { ingestTelemetry, listCaptureStore, listLifecycles, listTelemetry } from '../src/telemetry/store.ts';
import { parseCodexTokenUsage } from '../src/telemetry/codex.ts';
import { historicalLifecycle, validateLifecycle, validateTransition, MAX_ACQUISITIONS } from '../src/managed/lifecycle.ts';
import type { LifecycleRecord } from '../src/managed/lifecycle.ts';
import { ManagedCapture } from '../src/managed/session.ts';
import { ManagedTransport } from '../src/managed/transport.ts';
const mock = resolve('tests/fixtures/managed/server.mjs');
const posix = { skip: process.platform === 'win32' };
const canary = 'PRIVATE_MANAGED_CANARY_9187';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-durable-'));
  const captures: ManagedCapture[] = [];
  t.after(async () => {
    for (const capture of captures) await capture.stop().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  await initProject(root, 'codex');
  const path = join(root, '.contextbridge/telemetry/observations.json');
  return { root, path, dir: join(root, '.contextbridge/telemetry'),
    capture(mode = 'normal', audit = false) {
      const rpc = new ManagedTransport(process.execPath, [mock, mode, ...(audit ? [path, join(root, 'turn-marker')] : [])], root);
      const capture = new ManagedCapture(rpc, root); captures.push(capture); return capture;
    } };
}
function acquisition(id = 'acquisition'): LifecycleRecord {
  return { schemaVersion: 1, acquisitionId: identity(id), sequence: 1, receiptAt: '2026-01-01T00:00:00.000Z',
    provenance: { transport: 'managed-stdio-mock', origin: 'unverified', ordering: 'local-receive', timestamp: 'client-receipt' },
    connection: 'connected', turn: 'initializing', terminalEvidence: 'none' };
}
async function save(root: string, record: LifecycleRecord) { await ingestTelemetry(root, undefined, true, Date.now(), record); }
function imported() {
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
  return parseCodexTokenUsage(Buffer.from(JSON.stringify({ method: 'thread/tokenUsage/updated', params: {
    threadId: 'import-thread', turnId: 'import-turn', tokenUsage: { total: usage, last: usage },
  } })), { sourceVersion: '0.166.0', sessionId: 'import', sequence: 1, observedAt: '2026-01-01T00:00:00.000Z' });
}

test('mock observes durable acquisition and pending state before requests; no usage is required', posix, async (t) => {
  const f = await fixture(t); const capture = f.capture('no-usage', true);
  await capture.initialize(true, f.root);
  assert.equal((await listLifecycles(f.root))[0].turn, 'ready');
  await assert.rejects(readFile(join(f.root, 'turn-marker')), { code: 'ENOENT' });
  await capture.sendOneTurn(Buffer.from(canary), true);
  for (let i = 0; i < 100 && capture.state !== 'turn-completed'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  await capture.flush();
  assert.equal(await readFile(join(f.root, 'turn-marker'), 'utf8'), 'turn-pending-observed');
  const [record] = await listLifecycles(f.root);
  assert.equal(record.turn, 'turn-completed');
  assert.equal(record.terminalEvidence, 'turn/completed');
  assert.equal(record.acquisitionId, identity(capture.acquisitionId));
  assert.equal(record.threadId, identity('thread-1')); assert.equal(record.turnId, identity('turn-1'));
  assert.deepEqual(await listTelemetry(f.root), []);
  const bytes = await readFile(f.path, 'utf8');
  for (const secret of [canary, capture.acquisitionId, 'thread-1', 'turn-1']) assert.equal(bytes.includes(secret), false);
});

for (const obstruction of ['writer.lock', 'pending.json', 'corruption']) test(`failed pending publication prevents turn/start: ${obstruction}`, posix, async (t) => {
  const f = await fixture(t); const capture = f.capture('normal', true);
  await capture.initialize(true, f.root);
  if (obstruction === 'corruption') await writeFile(f.path, '{');
  else await writeFile(join(f.dir, obstruction), canary);
  const before = await readFile(f.path);
  await assert.rejects(capture.sendOneTurn(Buffer.from(canary), true), /inspection/);
  await assert.rejects(capture.flush(), /persistence failed/);
  await assert.rejects(capture.sendOneTurn(Buffer.from('retry'), true));
  await assert.rejects(readFile(join(f.root, 'turn-marker')), { code: 'ENOENT' });
  assert.deepEqual(await readFile(f.path), before);
});

test('acquisition persistence failure prevents initialization requests', posix, async (t) => {
  const f = await fixture(t);
  await save(f.root, acquisition()); await writeFile(join(f.dir, 'writer.lock'), '');
  const before = await readFile(f.path); const capture = f.capture('normal', true);
  await assert.rejects(capture.initialize(true, f.root), /initialization failed/);
  assert.deepEqual(await readFile(f.path), before);
  await assert.rejects(readFile(join(f.root, 'turn-marker')), { code: 'ENOENT' });
});

for (const mode of ['turn-drop', 'usage-exit', 'running', 'burst']) test(`uncertain running/submission or bounded queue failure never proves completion: ${mode}`, posix, async (t) => {
  const f = await fixture(t); const capture = f.capture(mode);
  await capture.initialize(true, f.root);
  await capture.sendOneTurn(Buffer.from(canary), true).catch(() => {});
  // stop drains accepted publications; it does not manufacture terminal evidence.
  await capture.stop().catch(() => {});
  const store = await listCaptureStore(f.root); const [record] = store.lifecycles;
  if (mode === 'usage-exit' || mode === 'running') assert.equal(store.observations.length, 1);
  assert.equal(record.terminalEvidence, 'none');
  assert.equal(historicalLifecycle(record).outcome, 'unconfirmed');
  for (const observation of store.observations) {
    assert.equal(observation.sequence, record.sequence);
    assert.equal(observation.managed!.turn, record.turn);
    assert.equal(observation.managed!.receiptAt, record.receiptAt);
  }
});

for (const phase of ['initializing', 'ready', 'turn-pending', 'turn-running', 'turn-completed'] as const) test(`restart inspection preserves historical ${phase} without process launch or storage mutation`, async (t) => {
  const f = await fixture(t); let record = acquisition(); await save(f.root, record);
  if (phase !== 'initializing') {
    record = { ...record, sequence: 2, threadId: identity('thread'), turn: 'ready' }; await save(f.root, record);
    if (phase !== 'ready') {
      record = { ...record, sequence: 3, turn: 'turn-pending' }; await save(f.root, record);
      if (phase !== 'turn-pending') {
        record = { ...record, sequence: 4, turnId: identity('turn'), turn: phase,
          terminalEvidence: phase === 'turn-completed' ? 'turn/completed' : 'none' }; await save(f.root, record);
      }
    }
  }
  // Stale lock and uncommitted candidate must never be promoted or removed by status.
  await writeFile(join(f.dir, 'writer.lock'), ''); await writeFile(join(f.dir, 'pending.json'), '{');
  const before = await readFile(f.path); const names = await readdir(f.dir);
  const result = spawnSync(process.execPath, ['--experimental-strip-types', 'src/cli.ts', 'context', 'status', '--project', f.root], {
    encoding: 'utf8', env: { ...process.env, PATH: f.root },
  });
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout); const historical = status.lifecycles[0];
  assert.equal(historical.currentConnection, 'unconfirmed');
  assert.equal(historical.outcome, phase === 'turn-completed' ? phase : 'unconfirmed');
  assert.equal(historical.automaticAction, 'none'); assert.equal(status.liveCapture, false);
  assert.deepEqual(await readFile(f.path), before); assert.deepEqual(await readdir(f.dir), names);
});

test('lifecycle and telemetry writers share exclusion and preserve both successful publications', async (t) => {
  const f = await fixture(t); const record = acquisition(); const observation = imported();
  const results = await Promise.allSettled([save(f.root, record), ingestTelemetry(f.root, observation, true)]);
  assert.ok(results.some((item) => item.status === 'fulfilled'));
  const store = await listCaptureStore(f.root);
  assert.equal(store.lifecycles.length, results[0].status === 'fulfilled' ? 1 : 0);
  assert.equal(store.observations.length, results[1].status === 'fulfilled' ? 1 : 0);
  if (results[0].status === 'rejected') await save(f.root, record);
  if (results[1].status === 'rejected') await ingestTelemetry(f.root, observation, true);
  assert.deepEqual(await listTelemetry(f.root), [observation]);
  assert.deepEqual(await listLifecycles(f.root), [record]);
});

test('legacy schema-2 observations and schema-1 imports survive lifecycle envelope upgrade', async (t) => {
  const f = await fixture(t); const legacy = imported();
  legacy.schemaVersion = 2; legacy.sessionId = identity('legacy-managed');
  legacy.provenance = { ...legacy.provenance, transport: 'managed-stdio-mock', timestamp: 'client-receipt', ordering: 'local-receive' };
  legacy.managed = { connection: 'connected', turn: 'turn-running', completeness: 'partial', receiptAt: legacy.observedAt };
  await ingestTelemetry(f.root, imported(), true); await ingestTelemetry(f.root, legacy, true);
  await save(f.root, acquisition());
  assert.deepEqual(await listTelemetry(f.root), [imported(), legacy]);
});

test('strict lifecycle validation bounds fields and prevents invented completion or identity changes', () => {
  const record = acquisition(); validateLifecycle(record);
  for (const patch of [{ schemaVersion: 2 }, { sequence: 0 }, { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { acquisitionId: canary }, { threadId: 'x'.repeat(10000) }, { receiptAt: '+010000-01-01T00:00:00.000Z' },
    { prompt: canary }, { pid: 1 }, { lease: 'alive' }, { turn: 'turn-completed' },
    { turn: 'turn-running', threadId: identity('t') }, { receiptAt: 'invalid' }]) {
    assert.throws(() => validateLifecycle({ ...record, ...patch }));
  }
  const pending: LifecycleRecord = { ...record, sequence: 3, threadId: identity('t'), turn: 'turn-pending' };
  assert.throws(() => validateTransition(pending, { ...pending, sequence: 4, threadId: identity('other') }));
  assert.throws(() => validateTransition(pending, { ...pending, sequence: 4, turn: 'ready' }));
});

test('corrupt, unknown-version and invalid lifecycle stores fail closed even with recomputed digests', async (t) => {
  const f = await fixture(t); const valid = acquisition(); await save(f.root, valid);
  for (const patch of [{ schemaVersion: 2 }, { connection: 'alive' }, { content: canary }, { sequence: -1 }, { terminalEvidence: 'turn/completed' }]) {
    const payload = { observations: [], lifecycles: [{ ...valid, ...patch }] };
    await writeFile(f.path, JSON.stringify({ schemaVersion: 2, ...payload, digest: digestOf(payload) }));
    const before = await readFile(f.path);
    await assert.rejects(listLifecycles(f.root)); await assert.rejects(save(f.root, acquisition('new')));
    assert.deepEqual(await readFile(f.path), before);
  }
  await writeFile(f.path, JSON.stringify({ schemaVersion: 99, observations: [], digest: digestOf([]) }));
  await assert.rejects(listLifecycles(f.root));
});

test('bounded acquisition collection does not evict committed data', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < MAX_ACQUISITIONS; i++) await save(f.root, acquisition('capture-' + i));
  const before = await readFile(f.path);
  await assert.rejects(save(f.root, acquisition('overflow')), /limit/);
  assert.deepEqual(await readFile(f.path), before);
});

test('lifecycle reads and writes reject linked committed storage', async (t) => {
  const f = await fixture(t); await save(f.root, acquisition());
  const target = join(f.root, 'saved.json'); await writeFile(target, await readFile(f.path));
  await rm(f.path); await link(target, f.path);
  await assert.rejects(listLifecycles(f.root)); await assert.rejects(save(f.root, acquisition('new')));
  await t.test('file symlinks are rejected on POSIX', posix, async () => {
    await rm(f.path); await symlink(target, f.path);
    await assert.rejects(listLifecycles(f.root)); await assert.rejects(save(f.root, acquisition('new')));
  });
});

test('a complete terminal staging candidate is never promoted over a committed pending turn', async (t) => {
  const f = await fixture(t); let record = acquisition(); await save(f.root, record);
  record = { ...record, sequence: 2, threadId: identity('thread'), turn: 'ready' }; await save(f.root, record);
  record = { ...record, sequence: 3, turn: 'turn-pending' }; await save(f.root, record);
  const before = await readFile(f.path);
  const terminal = { ...record, sequence: 4, turnId: identity('turn'), turn: 'turn-completed', terminalEvidence: 'turn/completed' };
  const payload = { observations: [], lifecycles: [terminal] };
  await writeFile(join(f.dir, 'pending.json'), JSON.stringify({ schemaVersion: 2, ...payload, digest: digestOf(payload) }));
  await writeFile(join(f.dir, 'writer.lock'), '');
  assert.equal(historicalLifecycle((await listLifecycles(f.root))[0]).outcome, 'unconfirmed');
  await assert.rejects(save(f.root, acquisition('new')), /lock/);
  assert.deepEqual(await readFile(f.path), before);
  // Removing only the stale lock still cannot authorize promotion or overwrite of staging.
  await rm(join(f.dir, 'writer.lock'));
  await assert.rejects(save(f.root, acquisition('new')));
  assert.deepEqual(await readFile(f.path), before);
});

test('lifecycle/usage correlation and sequence mismatches are rejected on read', async (t) => {
  const f = await fixture(t); await save(f.root, acquisition());
  const observation = imported(); observation.schemaVersion = 2;
  observation.provenance = { ...observation.provenance, transport: 'managed-stdio-mock', timestamp: 'client-receipt', ordering: 'local-receive' };
  observation.managed = { connection: 'connected', turn: 'turn-running', completeness: 'partial', receiptAt: observation.observedAt };
  const record: LifecycleRecord = { ...acquisition(), acquisitionId: observation.sessionId, threadId: observation.threadId,
    turnId: observation.turnId, turn: 'turn-running', sequence: observation.sequence };
  for (const patch of [{ sequence: 6 }, { threadId: identity('different') }, { turnId: identity('different') },
    { turn: 'unknown-outcome' }, { connection: 'stopped' }, { receiptAt: '2026-01-02T00:00:00.000Z' }]) {
    const payload = { observations: [observation], lifecycles: [{ ...record, ...patch }] };
    await writeFile(f.path, JSON.stringify({ schemaVersion: 2, ...payload, digest: digestOf(payload) }));
    await assert.rejects(listCaptureStore(f.root), /Inconsistent/);
  }
});

test('new lifecycle cannot corrupt a colliding imported acquisition or overwrite lifecycle usage', async (t) => {
  const f = await fixture(t); const observation = imported(); await ingestTelemetry(f.root, observation, true);
  const before = await readFile(f.path);
  await assert.rejects(save(f.root, { ...acquisition(), acquisitionId: observation.sessionId }));
  assert.deepEqual(await readFile(f.path), before);
  await save(f.root, acquisition());
  await assert.rejects(ingestTelemetry(f.root, { ...observation, sessionId: identity('acquisition') }, true), /lifecycle/);
  assert.deepEqual(await listTelemetry(f.root), [observation]);
});

test('initialization alone persists ready/stopped without any automatically authorized turn', posix, async (t) => {
  const f = await fixture(t); const capture = f.capture('normal', true);
  await capture.initialize(true, f.root);
  await capture.stop();
  const [record] = await listLifecycles(f.root);
  assert.equal(record.turn, 'ready'); assert.equal(record.connection, 'stopped');
  assert.equal(record.turnId, undefined); assert.equal(record.terminalEvidence, 'none');
  assert.deepEqual(await listTelemetry(f.root), []);
  await assert.rejects(readFile(join(f.root, 'turn-marker')), { code: 'ENOENT' });
});

test('connection loss before thread creation retains the acquisition without completion evidence', posix, async (t) => {
  const f = await fixture(t); const capture = f.capture('drop');
  await assert.rejects(capture.initialize(true, f.root));
  const [record] = await listLifecycles(f.root);
  assert.equal(record.turn, 'initializing'); assert.equal(record.connection, 'disconnected');
  assert.equal(record.threadId, undefined); assert.equal(record.terminalEvidence, 'none');
  assert.equal(historicalLifecycle(record).outcome, 'unconfirmed');
});
