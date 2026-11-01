import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initProject } from '../src/config.ts';
import { ManagedCapture } from '../src/managed/session.ts';
import { ManagedTransport } from '../src/managed/transport.ts';
import { listLifecycles, listTelemetry } from '../src/telemetry/store.ts';
import { evaluateRuntimePolicy, validateResolvedConfig, validateRequirements, isolationProperties, POLICY_DIAGNOSTIC } from '../src/managed/policy.ts';
import { resolvedConfig, administrativeRequirements } from './fixtures/managed/policy.mjs';
import { mockEvidence } from './fixtures/managed/evidence.ts';
const posix = { skip: process.platform === 'win32' };
const mock = resolve('tests/fixtures/managed/server.mjs');
async function setup(t, mode = 'normal', evidence = mockEvidence, expectedStopError?: RegExp) {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-policy-'));
  await initProject(root, 'codex');
  const trace = join(root, 'trace.json'); await writeFile(trace, '[]');
  const rpc = new ManagedTransport(process.execPath, [mock, mode, '', '', trace], root, 300);
  const capture = new ManagedCapture(rpc, root, evidence);
  t.after(async () => {
    try {
      if (expectedStopError) await assert.rejects(capture.stop(), expectedStopError);
      else await capture.stop();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  return { root, rpc, capture, methods: async () => JSON.parse(await readFile(trace, 'utf8')) };
}

test('policy assessment separates mock evidence from unsupported runtime guarantees', () => {
  const result = evaluateRuntimePolicy(resolvedConfig(), administrativeRequirements(), mockEvidence);
  assert.equal(result.productionEligible, false);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.effectiveThread, 'pending');
  assert.deepEqual(result.unverifiedRuntimeProperties, [...isolationProperties]);
  for (const version of ['0.165.0', '0.167.0', '', 'unknown']) assert.throws(() => evaluateRuntimePolicy(resolvedConfig(), administrativeRequirements(), mockEvidence, version), { message: POLICY_DIAGNOSTIC });
  assert.throws(() => evaluateRuntimePolicy(resolvedConfig(), administrativeRequirements()), { message: POLICY_DIAGNOSTIC });
  for (const property of isolationProperties) {
    const evidence = structuredClone(mockEvidence); delete evidence.properties[property];
    assert.throws(() => evaluateRuntimePolicy(resolvedConfig(), administrativeRequirements(), evidence), { message: POLICY_DIAGNOSTIC });
  }
});

test('every accepted config and requirement field requires explicit non-null evidence', () => {
  for (const original of [resolvedConfig(), administrativeRequirements()]) {
    const validate = 'config' in original ? validateResolvedConfig : validateRequirements;
    const section = 'config' in original ? 'config' : 'requirements';
    for (const key of Object.keys(original[section])) for (const replacement of [undefined, null]) {
      const value = structuredClone(original);
      if (replacement === undefined) delete value[section][key]; else value[section][key] = replacement;
      assert.throws(() => validate(value), { message: POLICY_DIAGNOSTIC });
    }
    assert.throws(() => validate({ ...original, unsupported: 'PRIVATE_MANAGED_CANARY_9187' }), { message: POLICY_DIAGNOSTIC });
  }
});

for (const mode of ['config-mismatch', 'config-missing', 'config-null', 'config-model', 'config-provider', 'config-reviewer',
  'config-canary', 'config-wrong-id', 'config-envelope', 'config-jsonrpc', 'config-extensions', 'config-features', 'config-tools', 'config-browser', 'config-computer', 'config-hooks', 'config-project-hooks', 'config-user-hooks',
  'config-mcp', 'config-notify', 'config-otel', 'config-unsupported', 'config-origins', 'config-timeout', 'config-malformed',
  'config-duplicate', 'config-privileged', 'config-disconnect', 'requirements-missing', 'requirements-field-missing',
  'requirements-null', 'requirements-ambiguous', 'requirements-mismatch', 'requirements-provider', 'requirements-features',
  'requirements-unsupported', 'requirements-timeout', 'requirements-disconnect', 'thread-write', 'thread-full', 'thread-network',
  'thread-network-missing', 'thread-version', 'thread-reviewer', 'thread-model', 'thread-provider']) {
  test(`policy rejection preserves acquisition and prevents turn admission: ${mode}`, posix, async (t) => {
    const f = await setup(t, mode);
    await assert.rejects(f.capture.initialize(true, f.root), { message: 'Managed initialization failed.' });
    assert.notEqual(f.capture.state, 'ready');
    await assert.rejects(f.capture.sendOneTurn(Buffer.from('hello'), true));
    const methods = await f.methods();
    assert.equal(methods.includes('turn/start'), false);
    if (!mode.startsWith('thread-')) assert.equal(methods.includes('thread/start'), false);
    const [record] = await listLifecycles(f.root);
    assert.equal(record.turn, 'initializing'); assert.equal(record.connection, 'disconnected');
    assert.equal(record.threadId, undefined); assert.equal(record.terminalEvidence, 'none');
    assert.deepEqual(await listTelemetry(f.root), []);
    const bytes = await readFile(join(f.root, '.contextbridge/telemetry/observations.json'), 'utf8');
    for (const secret of ['PRIVATE_MANAGED_CANARY_9187', '/mock', 'mock-policy-1', 'model_provider', 'featureRequirements']) assert.equal(bytes.includes(secret), false);
  });
}

test('mock admission ordering is explicit and never automatically submits a turn', posix, async (t) => {
  const f = await setup(t);
  await f.capture.initialize(true, f.root);
  assert.deepEqual(await f.methods(), ['initialize', 'initialized', 'config/read', 'configRequirements/read', 'thread/start']);
  assert.equal(f.capture.policyAssessment()?.effectiveThread, 'verified-provider-report');
  assert.equal(f.capture.policyAssessment()?.productionEligible, false);
  const assessment = f.capture.policyAssessment()!; assessment.productionEligible = true as false;
  assert.equal(f.capture.policyAssessment()?.productionEligible, false);
  await f.capture.sendOneTurn(Buffer.from('safe'), true);
  assert.deepEqual(await f.methods(), ['initialize', 'initialized', 'config/read', 'configRequirements/read', 'thread/start', 'config/read', 'configRequirements/read', 'turn/start']);
});

test('missing independent mock isolation evidence blocks thread creation', posix, async (t) => {
  const f = await setup(t);
  const capture = new ManagedCapture(f.rpc, f.root);
  await assert.rejects(capture.initialize(true, f.root));
  assert.equal((await f.methods()).includes('thread/start'), false);
  await assert.rejects(capture.sendOneTurn(Buffer.from('safe'), true));
});

for (const mode of ['policy-change', 'policy-revision-change', 'requirements-change']) test(`changed policy prevents turn submission without retry: ${mode}`, posix, async (t) => {
  const f = await setup(t, mode);
  await f.capture.initialize(true, f.root);
  await assert.rejects(f.capture.sendOneTurn(Buffer.from('safe'), true));
  await assert.rejects(f.capture.sendOneTurn(Buffer.from('retry'), true));
  assert.equal((await f.methods()).includes('turn/start'), false);
  const [record] = await listLifecycles(f.root);
  assert.equal(record.turn, 'unknown-outcome'); assert.equal(record.terminalEvidence, 'none');
});

test('policy failure retains visible cleanup errors with fixed diagnostics', posix, async (t) => {
  const f = await setup(t, 'config-missing');
  const stop = f.rpc.stop.bind(f.rpc);
  f.rpc.stop = async () => { await stop(); throw new Error('Managed process cleanup is unconfirmed; inspect owned test processes.'); };
  await assert.rejects(f.capture.initialize(true, f.root), /cleanup is unconfirmed/);
  assert.equal((await f.methods()).includes('turn/start'), false);
  const [record] = await listLifecycles(f.root);
  assert.equal(record.connection, 'disconnected');
  assert.equal(record.turn, 'initializing');
  assert.equal(record.terminalEvidence, 'none');
  f.rpc.stop = stop;
});

for (const phase of ['initialize', 'turn']) test(`policy ${phase} failure waits for persistence before exposing cleanup errors`, posix, async (t) => {
  const f = await setup(t, phase === 'initialize' ? 'config-missing' : 'policy-change');
  if (phase === 'turn') await f.capture.initialize(true, f.root);
  const stop = f.rpc.stop.bind(f.rpc);
  const flush = f.capture.flush.bind(f.capture);
  const cleanupError = new Error('Managed process cleanup is unconfirmed; inspect owned test processes.');
  let draining!: () => void;
  const drainStarted = new Promise<void>((resolve) => { draining = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let cleanupFailed = false;
  f.rpc.stop = async () => { await stop(); cleanupFailed = true; throw cleanupError; };
  f.capture.flush = async () => {
    if (cleanupFailed) { draining(); await gate; }
    await flush();
  };
  let settled = false;
  const operation = (phase === 'initialize' ? f.capture.initialize(true, f.root) : f.capture.sendOneTurn(Buffer.from('safe'), true))
    .then(() => { settled = true; return undefined; }, (error) => { settled = true; return error; });
  try {
    assert.equal(await Promise.race([drainStarted.then(() => 'draining'), operation.then(() => 'settled')]), 'draining');
    assert.equal(settled, false);
  } finally {
    release();
    await operation;
    f.capture.flush = flush;
    f.rpc.stop = stop;
  }
  assert.equal(await operation, cleanupError);
  const [record] = await listLifecycles(f.root);
  assert.equal(record.connection, 'disconnected');
  assert.equal(record.turn, phase === 'initialize' ? 'initializing' : 'unknown-outcome');
  assert.equal(record.terminalEvidence, 'none');
  assert.equal((await f.methods()).includes('turn/start'), false);
});

test('policy failure preserves both cleanup and persistence errors', posix, async (t) => {
  const f = await setup(t, 'config-missing', mockEvidence, /persistence failed/);
  const stop = f.rpc.stop.bind(f.rpc);
  const cleanupError = new Error('Managed process cleanup is unconfirmed; inspect owned test processes.');
  let obstructed = false;
  f.rpc.stop = async () => {
    if (!obstructed) {
      obstructed = true;
      await writeFile(join(f.root, '.contextbridge/telemetry/writer.lock'), 'test obstruction');
    }
    await stop();
    throw cleanupError;
  };
  try {
    await assert.rejects(f.capture.initialize(true, f.root), (error: AggregateError) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[0], cleanupError);
      assert.match(error.errors[1].message, /persistence failed/);
      return true;
    });
    await assert.rejects(f.capture.flush(), /persistence failed/);
    await assert.rejects(f.capture.sendOneTurn(Buffer.from('retry'), true));
    assert.equal((await f.methods()).includes('turn/start'), false);
  } finally { f.rpc.stop = stop; }
  // The sticky publication failure must stay visible during fixture teardown.
  await assert.rejects(f.capture.stop(), /persistence failed/);
});

for (const phase of ['initialize', 'turn', 'interrupt', 'stop']) test(`successful transport cleanup exposes failed lifecycle publication during ${phase}`, posix, async (t) => {
  const f = await setup(t, phase === 'initialize' ? 'config-missing' : phase === 'turn' ? 'policy-change' : 'running', mockEvidence, /persistence failed/);
  if (phase !== 'initialize') await f.capture.initialize(true, f.root);
  if (phase === 'interrupt') await f.capture.sendOneTurn(Buffer.from('safe'), true);
  const path = join(f.root, '.contextbridge/telemetry/observations.json');
  let committed!: string;
  const disconnect = f.rpc.onDisconnect;
  f.rpc.onDisconnect = () => {
    // Obstruct precisely the disconnect publication, after admission barriers.
    committed = readFileSync(path, 'utf8');
    writeFileSync(join(f.root, '.contextbridge/telemetry/writer.lock'), 'test obstruction');
    disconnect();
  };
  if (phase === 'interrupt') {
    const request = f.rpc.request.bind(f.rpc);
    f.rpc.request = (method, params) => method === 'turn/interrupt' ? Promise.reject(new Error('Test interrupt rejection.')) : request(method, params);
  }
  const operation = phase === 'initialize' ? f.capture.initialize(true, f.root) :
    phase === 'turn' ? f.capture.sendOneTurn(Buffer.from('safe'), true) :
    phase === 'interrupt' ? f.capture.interrupt() : f.capture.stop();
  await assert.rejects(operation, { message: 'Managed persistence failed; inspect committed storage. No retry is authorized.' });
  assert.equal(f.rpc.cleanup, 'confirmed');
  assert.notEqual(f.capture.state, 'stopped');
  await assert.rejects(f.capture.flush(), /persistence failed/);
  await assert.rejects(f.capture.persist(f.root, true), /persistence failed/);
  await assert.rejects(f.capture.stop(), /persistence failed/);
  assert.equal(await readFile(path, 'utf8'), committed);
  const [record] = await listLifecycles(f.root);
  assert.notEqual(record.connection, 'stopped');
  assert.equal(record.terminalEvidence, 'none');
  assert.equal(record.turn, phase === 'initialize' ? 'initializing' : phase === 'turn' ? 'turn-pending' : phase === 'interrupt' ? 'turn-running' : 'ready');
  assert.equal((await f.methods()).includes('turn/start'), phase === 'interrupt');
});

test('configuration RPC request parameters are pinned and cannot request mutations', posix, async (t) => {
  const f = await setup(t);
  for (const [method, params] of [['config/read', {}], ['config/read', { cwd: f.root, includeLayers: false }],
    ['configRequirements/read', {}], ['config/value/write', {}], ['config/batchWrite', {}]]) await assert.rejects(f.rpc.request(method as string, params));
  assert.deepEqual(await f.methods(), []);
});

// Small fixture-only schema checker: no runtime validation depends on test schema files.
function matches(schema, value, root = schema): boolean {
  if (schema === true) return true;
  if (schema === false) return false;
  if (schema.$ref) return matches(root.definitions[schema.$ref.split('/').at(-1)], value, root);
  if (schema.anyOf && !schema.anyOf.some((s) => matches(s, value, root))) return false;
  if (schema.oneOf && schema.oneOf.filter((s) => matches(s, value, root)).length !== 1) return false;
  if (schema.allOf && !schema.allOf.every((s) => matches(s, value, root))) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((type) => type === 'null' ? value === null : type === 'array' ? Array.isArray(value) : type === 'integer' ? Number.isSafeInteger(value) : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : typeof value === type)) return false;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.required?.some((key) => !Object.hasOwn(value, key))) return false;
    for (const [key, item] of Object.entries(value)) {
      const child = schema.properties?.[key] ?? schema.additionalProperties ?? true;
      if (!matches(child, item, root)) return false;
    }
  }
  if (Array.isArray(value) && schema.items && !value.every((item) => matches(schema.items, item, root))) return false;
  return true;
}
test('positive policy fixture and exact RPC shapes conform to pinned generated schemas', async () => {
  for (const [file, value] of [['v2-ConfigReadResponse.json', resolvedConfig()], ['v2-ConfigRequirementsReadResponse.json', administrativeRequirements()],
    ['v2-ConfigReadParams.json', { cwd: '/mock', includeLayers: true }]]) {
    const schema = JSON.parse(await readFile(resolve('tests/fixtures/managed', file as string), 'utf8'));
    assert.equal(matches(schema, value), true, file as string);
  }
  const requests = JSON.parse(await readFile(resolve('tests/fixtures/managed/ClientRequest.json'), 'utf8'));
  assert.equal(matches(requests, { id: 1, method: 'configRequirements/read', params: null }), true);
  assert.equal(matches(requests, { id: 1, method: 'configRequirements/read', params: {} }), false);
});
