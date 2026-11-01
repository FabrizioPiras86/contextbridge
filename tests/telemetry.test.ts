import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { link, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initProject } from '../src/config.ts';
import { listMemory } from '../src/memory.ts';
import { digestOf } from '../src/storage.ts';
import { CODEX_VERSION, MAX_NOTIFICATION_BYTES, parseCodexTokenUsage, validateCodexObservation } from '../src/telemetry/codex.ts';
import { evaluateThreshold, freshness, identity, STALE_AFTER_MS, TOKEN_KEYS } from '../src/telemetry/model.ts';
import { ingestTelemetry, listTelemetry, MAX_STORE_BYTES, MAX_STREAMS } from '../src/telemetry/store.ts';

const at = '2026-11-01T10:00:00.000Z';
const now = Date.parse(at);
const usage = (inputTokens = 80, outputTokens = 20) => ({ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
  cachedInputTokens: 10, cacheWriteInputTokens: 5, reasoningOutputTokens: 5 });
function notification() {
  return { method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', turnId: 'turn-1',
    tokenUsage: { total: usage(800, 200), last: usage(), modelContextWindow: 2000 as number | null | undefined } } };
}
function parse(value: unknown = notification(), overrides = {}) {
  return parseCodexTokenUsage(Buffer.from(JSON.stringify(value)), { sourceVersion: CODEX_VERSION, sessionId: 'capture-1', observedAt: at, sequence: 1, ...overrides });
}
async function project(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-telemetry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initProject(root, 'codex');
  return root;
}
const storePath = (root: string) => join(root, '.contextbridge', 'telemetry', 'observations.json');

test('installed-version schema fixture confirms optional window and cache-write defaults', async () => {
  const schema = JSON.parse(await readFile(resolve('tests/fixtures/telemetry/codex-0.166.0-token-usage.schema.json'), 'utf8'));
  assert.deepEqual(schema.required, ['threadId', 'tokenUsage', 'turnId']);
  assert.deepEqual(schema.definitions.ThreadTokenUsage.required, ['last', 'total']);
  assert.equal(schema.definitions.TokenUsageBreakdown.properties.cacheWriteInputTokens.default, 0);
  assert.deepEqual(Object.keys(schema.definitions.TokenUsageBreakdown.properties).sort(), [...TOKEN_KEYS].sort());
});

test('Codex notifications normalize usage with explicit provenance and no inferred occupancy', () => {
  const result = parse();
  validateCodexObservation(result);
  assert.deepEqual(result.cumulative, usage(800, 200));
  assert.deepEqual(result.latest, usage());
  assert.deepEqual(result.context, { kind: 'unknown' });
  assert.equal(result.provenance.origin, 'unverified');
  assert.equal(result.threadId, identity('thread-1'));
  assert.equal(result.sessionId, identity('capture-1'));
  assert.equal(evaluateThreshold(result, { warning: 1, handoff: 2, safety: 3 }, now), 'unknown');
  assert.deepEqual(parse({ ...notification(), jsonrpc: '2.0' }), result);
});

test('missing and null context windows remain unknown and omitted cache writes become zero', () => {
  for (const window of [null, undefined]) {
    const value = notification();
    value.params.tokenUsage.modelContextWindow = window;
    delete (value.params.tokenUsage.last as Partial<ReturnType<typeof usage>>).cacheWriteInputTokens;
    const result = parse(value);
    assert.equal(result.modelContextWindow, null);
    assert.equal(result.latest!.cacheWriteInputTokens, 0);
  }
});

test('parser rejects unsupported versions, event shapes, fields and malformed JSON without echoing content', () => {
  for (const value of [null, [], {}, { ...notification(), id: 1 }, { ...notification(), method: 'turn/completed' },
    { ...notification(), jsonrpc: '1.0' }, { ...notification(), prompt: 'PRIVATE_PAYLOAD' },
    { ...notification(), params: { ...notification().params, transcript_path: '/private/file' } }]) {
    assert.throws(() => parse(value), (error: Error) => !error.message.includes('PRIVATE_PAYLOAD'));
  }
  for (const metadata of [{ sourceVersion: '0.165.0' }, { observedAt: 'yesterday' }, { sequence: 0 }, { sequence: 1.5 },
    { sequence: Number.MAX_SAFE_INTEGER + 1 }, { sessionId: '../outside' }]) assert.throws(() => parse(notification(), metadata));
  for (const bytes of [Buffer.from('{'), Buffer.from([0xff]), Buffer.alloc(MAX_NOTIFICATION_BYTES + 1)]) {
    assert.throws(() => parseCodexTokenUsage(bytes, { sourceVersion: CODEX_VERSION, sessionId: 'capture', observedAt: at, sequence: 1 }));
  }
});

test('all token fields reject negatives, fractions, unsafe integers, nulls and strings', () => {
  for (const key of TOKEN_KEYS) {
    for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, null, '4']) {
      const value = notification();
      Object.assign(value.params.tokenUsage.last, { [key]: invalid });
      assert.throws(() => parse(value));
    }
  }
  for (const window of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, '100']) {
    const value = notification();
    Object.assign(value.params.tokenUsage, { modelContextWindow: window });
    assert.throws(() => parse(value));
  }
  const metadata = { sourceVersion: CODEX_VERSION, sessionId: 'capture', observedAt: at, sequence: 1 };
  assert.throws(() => parseCodexTokenUsage(Buffer.from(JSON.stringify(notification()).replace('"modelContextWindow":2000', '"modelContextWindow":1e309')), metadata));
  assert.throws(() => parseCodexTokenUsage(Buffer.from(JSON.stringify(notification()).replace('"threadId":', '"threadId":"duplicate","threadId":')), metadata), /Duplicate/);
  for (const literal of ['9007199254740990.4', '1e-999', '1.0']) {
    assert.throws(() => parseCodexTokenUsage(Buffer.from(JSON.stringify(notification()).replace('"modelContextWindow":2000', `"modelContextWindow":${literal}`)), metadata), /integer JSON literals/);
  }
});

test('inconsistent counters, overflowing sums and missing required fields fail closed', () => {
  for (const change of [{ cachedInputTokens: 81 }, { cacheWriteInputTokens: 81 }, { reasoningOutputTokens: 21 },
    { totalTokens: 99 }, { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1, totalTokens: Number.MAX_SAFE_INTEGER }]) {
    const value = notification();
    Object.assign(value.params.tokenUsage.last, change);
    assert.throws(() => parse(value));
  }
  const value = notification();
  value.params.tokenUsage.total = usage(40, 10);
  assert.throws(() => parse(value), /exceeds/);
  for (const key of TOKEN_KEYS.filter((key) => key !== 'cacheWriteInputTokens')) {
    const missing = notification();
    delete (missing.params.tokenUsage.last as Partial<ReturnType<typeof usage>>)[key];
    assert.throws(() => parse(missing));
  }
  for (const missing of ['threadId', 'turnId', 'tokenUsage']) {
    const value: any = notification();
    delete value.params[missing];
    assert.throws(() => parse(value));
  }
});

test('synthetic total-only context-limit counts do not become occupancy measurements', () => {
  const value = notification();
  value.params.tokenUsage.total = { inputTokens: 0, outputTokens: 0, totalTokens: 2000, cachedInputTokens: 0, cacheWriteInputTokens: 0, reasoningOutputTokens: 0 };
  value.params.tokenUsage.last = { ...value.params.tokenUsage.total, totalTokens: 1000 };
  assert.deepEqual(parse(value).context, { kind: 'unknown' });
  value.params.tokenUsage.total = { ...usage(800, 200), totalTokens: 3000 };
  value.params.tokenUsage.last = usage();
  assert.equal(parse(value).cumulative!.totalTokens, 3000);
});

test('ingestion is explicitly opted in, separate from memory and does not alter configuration', async (t) => {
  const root = await project(t);
  const configPath = join(root, '.contextbridge', 'config.json');
  const before = await readFile(configPath);
  await assert.rejects(ingestTelemetry(root, parse(), false, now), /opt-in/);
  assert.deepEqual(await listTelemetry(root), []);
  assert.equal(await ingestTelemetry(root, parse(), true, now), 'stored');
  assert.deepEqual(await listMemory(root), { events: [], incompleteTail: false });
  assert.deepEqual(await readFile(configPath), before);
  assert.deepEqual(await listTelemetry(root), [parse()]);
  const bytes = await readFile(storePath(root), 'utf8');
  for (const raw of ['thread-1', 'turn-1', 'capture-1']) assert.ok(!bytes.includes(raw));
});

test('duplicates never add usage or refresh observation age and preserve the sequence watermark', async (t) => {
  const root = await project(t);
  const first = parse();
  await ingestTelemetry(root, first, true, now);
  const bytes = await readFile(storePath(root));
  assert.equal(await ingestTelemetry(root, first, true, now), 'duplicate');
  assert.deepEqual(await readFile(storePath(root)), bytes);
  const replay = parse(notification(), { observedAt: new Date(now + STALE_AFTER_MS).toISOString(), sequence: 10 });
  assert.equal(await ingestTelemetry(root, replay, true, now + STALE_AFTER_MS), 'duplicate');
  assert.equal(await ingestTelemetry(root, replay, true, now + STALE_AFTER_MS), 'duplicate');
  const [stored] = await listTelemetry(root);
  assert.equal(stored.sequence, 10);
  assert.equal(stored.observedAt, at);
  assert.equal(freshness(stored.observedAt, now + STALE_AFTER_MS), 'stale');
  assert.deepEqual(stored.cumulative, first.cumulative);
});

test('out-of-order timestamps and sequences cannot replace newer observations', async (t) => {
  const root = await project(t);
  await ingestTelemetry(root, parse(notification(), { sequence: 2 }), true, now);
  const older = notification();
  older.params.turnId = 'old-turn';
  assert.equal(await ingestTelemetry(root, parse(older), true, now), 'out-of-order');
  assert.equal(await ingestTelemetry(root, parse(older, { sequence: 3, observedAt: new Date(now - 1).toISOString() }), true, now), 'out-of-order');
  await assert.rejects(ingestTelemetry(root, parse(older, { sequence: 2 }), true, now), /Conflicting/);
  await assert.rejects(ingestTelemetry(root, parse(older, { sequence: 3, observedAt: new Date(now + 1).toISOString() }), true, now), /future/);
  assert.equal((await listTelemetry(root))[0].sequence, 2);
});

test('threads and local capture sessions remain independent with no implicit current-session selection', async (t) => {
  const root = await project(t);
  await ingestTelemetry(root, parse(), true, now);
  const second = notification();
  second.params.threadId = 'thread-2';
  await ingestTelemetry(root, parse(second), true, now);
  await ingestTelemetry(root, parse(notification(), { sessionId: 'capture-2' }), true, now);
  const records = await listTelemetry(root);
  assert.equal(records.length, 3);
  assert.equal(new Set(records.map((item) => `${item.sessionId}/${item.threadId}`)).size, 3);
  assert.ok(records.every((item) => item.cumulative!.totalTokens === 1000));
});

test('compaction-like drops and interrupted-turn reports replace snapshots without adding or inferring lifecycle', async (t) => {
  const root = await project(t);
  await ingestTelemetry(root, parse(), true, now);
  const compacted = notification();
  compacted.params.tokenUsage.last = usage(20, 10);
  await ingestTelemetry(root, parse(compacted, { sequence: 2 }), true, now);
  let [stored] = await listTelemetry(root);
  assert.equal(stored.latest!.totalTokens, 30);
  assert.equal(stored.cumulative!.totalTokens, 1000);
  compacted.params.tokenUsage.total = usage(30, 15);
  compacted.params.turnId = 'interrupted-turn';
  await ingestTelemetry(root, parse(compacted, { sequence: 3 }), true, now);
  [stored] = await listTelemetry(root);
  assert.equal(stored.cumulative!.totalTokens, 45);
  assert.equal(stored.context.kind, 'unknown');
  assert.equal(stored.turnId, identity('interrupted-turn'));
});

test('freshness has exact boundaries and future times are unknown', () => {
  assert.equal(freshness(at, now), 'fresh');
  assert.equal(freshness(at, now + STALE_AFTER_MS - 1), 'fresh');
  assert.equal(freshness(at, now + STALE_AFTER_MS), 'stale');
  assert.equal(freshness(at, now - 1), 'unknown');
  assert.equal(freshness('invalid', now), 'unknown');
});

test('advisories use verified active occupancy only with exact inclusive boundaries', () => {
  const thresholds = { warning: 60, handoff: 75, safety: 90 };
  const measured = (usedTokens: number, modelContextWindow = 1000) => ({ observedAt: at, modelContextWindow,
    context: { kind: 'measured' as const, verification: 'verified' as const, semantics: 'active-context' as const, usedTokens } });
  for (const [used, expected] of [[0, 'none'], [599, 'none'], [600, 'warning'], [749, 'warning'], [750, 'handoff'], [899, 'handoff'], [900, 'safety'], [1100, 'safety']] as const) {
    assert.equal(evaluateThreshold(measured(used), thresholds, now), expected);
  }
  assert.equal(evaluateThreshold(measured(3, 5), thresholds, now), 'warning');
  assert.equal(evaluateThreshold(measured(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), thresholds, now), 'safety');
  for (const measurement of [null, parse(), measured(-1), measured(Infinity), measured(10, 0),
    { ...measured(900), context: { ...measured(900).context, verification: 'unverified' } },
    { ...measured(900), context: { ...measured(900).context, semantics: 'cumulative' } }] as any[]) {
    assert.equal(evaluateThreshold(measurement, thresholds, now), 'unknown');
  }
  assert.equal(evaluateThreshold(measured(900), thresholds, now + STALE_AFTER_MS), 'unknown');
  assert.throws(() => evaluateThreshold(measured(900), { warning: 75, handoff: 60, safety: 90 }, now));
});

test('corrupt storage fails closed without overwriting bytes', async (t) => {
  const root = await project(t);
  await ingestTelemetry(root, parse(), true, now);
  const original = JSON.parse(await readFile(storePath(root), 'utf8'));
  const invalidObservation = { ...parse(), context: { kind: 'measured', usedTokens: 1, verification: 'verified' } };
  const cases = ['{', JSON.stringify({ ...original, schemaVersion: 2 }), JSON.stringify({ ...original, digest: 'bad' }),
    JSON.stringify({ schemaVersion: 1, observations: [invalidObservation], digest: digestOf([invalidObservation]) }),
    JSON.stringify({ schemaVersion: 1, observations: [parse(), parse()], digest: digestOf([parse(), parse()]) })];
  for (const bytes of cases) {
    await writeFile(storePath(root), bytes);
    await assert.rejects(listTelemetry(root));
    await assert.rejects(ingestTelemetry(root, parse(), true, now));
    assert.equal(await readFile(storePath(root), 'utf8'), bytes);
  }
});

test('stored unknown fields and forged provenance are rejected even with a matching digest', async (t) => {
  const root = await project(t);
  await ingestTelemetry(root, parse(), true, now);
  for (const changed of [{ ...parse(), prompt: 'PRIVATE_PAYLOAD' }, { ...parse(), provenance: { ...parse().provenance, origin: 'verified' } },
    { ...parse(), latest: { ...usage(), totalTokens: -1 } }, { ...parse(), threadId: '../outside' }]) {
    await writeFile(storePath(root), JSON.stringify({ schemaVersion: 1, observations: [changed], digest: digestOf([changed]) }));
    await assert.rejects(listTelemetry(root));
  }
});

test('bounded storage refuses oversized files and excess streams without eviction', async (t) => {
  const root = await project(t);
  await ingestTelemetry(root, parse(), true, now);
  await writeFile(storePath(root), ' '.repeat(MAX_STORE_BYTES + 1));
  await assert.rejects(listTelemetry(root), /oversized/);
  await rm(storePath(root));
  for (let i = 0; i < MAX_STREAMS; i++) await ingestTelemetry(root, parse(notification(), { sessionId: `capture-${i}` }), true, now);
  const before = await readFile(storePath(root));
  await assert.rejects(ingestTelemetry(root, parse(notification(), { sessionId: 'one-too-many' }), true, now), /limit/);
  assert.deepEqual(await readFile(storePath(root)), before);
  assert.ok(before.length <= MAX_STORE_BYTES);
});

test('writer locks and interrupted staging files preserve the previous complete store', async (t) => {
  const root = await project(t);
  await ingestTelemetry(root, parse(), true, now);
  const dir = join(root, '.contextbridge', 'telemetry');
  const before = await readFile(storePath(root));
  await writeFile(join(dir, 'writer.lock'), '');
  await assert.rejects(ingestTelemetry(root, parse(), true, now), /writer lock/);
  assert.equal((await listTelemetry(root)).length, 1);
  await rm(join(dir, 'writer.lock'));
  await writeFile(join(dir, 'pending.json'), '{');
  const next = notification(); next.params.turnId = 'next-turn';
  await assert.rejects(ingestTelemetry(root, parse(next, { sequence: 2 }), true, now), { code: 'EEXIST' });
  assert.deepEqual(await readFile(storePath(root)), before);
  assert.equal(await readFile(join(dir, 'pending.json'), 'utf8'), '{');
});

test('parallel writers never interleave or silently lose successful writes', async (t) => {
  const root = await project(t);
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => ingestTelemetry(root, parse(notification(), { sessionId: `parallel-${index}` }), true, now)));
  assert.equal((await listTelemetry(root)).length, results.filter((result) => result.status === 'fulfilled').length);
});

test('symlinked storage components and hard-linked files are rejected on portable paths', async (t) => {
  const root = await project(t);
  const external = await mkdtemp(join(tmpdir(), 'contextbridge-telemetry-external-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  const dir = join(root, '.contextbridge', 'telemetry');
  await symlink(external, dir, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(listTelemetry(root), /Unsafe/);
  await assert.rejects(ingestTelemetry(root, parse(), true, now), /Unsafe/);
  await rm(dir);
  await ingestTelemetry(root, parse(), true, now);
  await link(storePath(root), join(external, 'linked.json'));
  await assert.rejects(listTelemetry(root), /Unsafe/);
});

test('identifiers cannot become filesystem paths and content fields are not accepted', () => {
  for (const identifier of ['../outside', '/tmp/file', 'C:\\private', '\\\\host\\file', 'id\ntext', 'a'.repeat(129)]) {
    const value = notification(); value.params.threadId = identifier;
    assert.throws(() => parse(value));
  }
  const value: any = notification();
  value.params.tokenUsage.last.toolOutput = 'PRIVATE_PAYLOAD';
  assert.throws(() => parse(value), (error: Error) => !error.message.includes('PRIVATE_PAYLOAD'));
});

test('context CLI imports stdin explicitly and reports unavailable, supported and stale states', async (t) => {
  const root = await project(t);
  const cli = (args: string[], input = '') => spawnSync(process.execPath, [resolve('bin/contextbridge.mjs'), 'context', ...args, '--project', root],
    { encoding: 'utf8', input, timeout: 10_000 });
  assert.equal(JSON.parse(cli(['status']).stdout).state, 'unavailable');
  const observedAt = new Date().toISOString();
  const options = ['ingest', '--source', 'codex-app-server', '--source-version', CODEX_VERSION, '--session', 'capture-1',
    '--observed-at', observedAt, '--sequence', '1'];
  assert.equal(cli(options, JSON.stringify(notification())).status, 1);
  const imported = cli([...options, '--yes'], JSON.stringify(notification()));
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(JSON.parse(imported.stdout).liveCapture, false);
  let status = JSON.parse(cli(['status', '--session', 'capture-1', '--thread', 'thread-1']).stdout);
  assert.equal(status.state, 'supported');
  assert.equal(status.contextUtilization, 'unknown');
  assert.equal(status.observations[0].advisory, 'unknown');
  assert.ok(!JSON.stringify(status).includes('%'));
  assert.equal(JSON.parse(cli(['status', '--session', 'other', '--thread', 'thread-1']).stdout).state, 'unavailable');
  await ingestTelemetry(root, parse(notification(), { sessionId: 'old-capture', observedAt: new Date(Date.now() - STALE_AFTER_MS).toISOString() }), true);
  status = JSON.parse(cli(['status', '--session', 'old-capture', '--thread', 'thread-1']).stdout);
  assert.equal(status.state, 'stale');
  for (const args of [['status', '--session', 'capture-1'], ['status', '--unknown', 'value'], ['status', '--thread', '../outside', '--session', 'x'],
    [...options, '--yes', '--yes'], [...options, '--yes', '--source-version', 'unknown']]) assert.equal(cli(args).status, 1);
  assert.equal(cli([...options, '--yes'], ' '.repeat(MAX_NOTIFICATION_BYTES + 1)).status, 1);
});
