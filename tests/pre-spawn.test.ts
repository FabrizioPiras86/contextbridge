import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessPreSpawn, preSpawnControls } from '../src/managed/pre-spawn.ts';
import type { PreSpawnInput } from '../src/managed/pre-spawn.ts';

function fixture(platform: PreSpawnInput['platform'] = 'darwin'): PreSpawnInput {
  return { scope: 'offline-mock-harness', sourceVersion: '0.166.0', platform,
    controls: Object.fromEntries(preSpawnControls.map((key) => [key, 'verified-offline'])) as PreSpawnInput['controls'] };
}
function blocked(input: unknown, reason: string) {
  const assessment = assessPreSpawn(input);
  assert.equal(assessment.decision, 'blocked');
  assert.equal(assessment.reason, reason);
  assert.equal(assessment.productionEligible, false);
  assert.equal(assessment.spawnAuthorized, false);
  assert.deepEqual(assessment.unverifiedRuntimeControls, preSpawnControls);
  return assessment;
}

for (const platform of ['darwin', 'linux'] as const) test(`complete ${platform} offline model never grants execution`, () => {
  const input = fixture(platform);
  const before = structuredClone(input);
  const assessment = assessPreSpawn(input);
  assert.equal(assessment.decision, 'offline-model-complete');
  assert.equal(assessment.reason, 'complete');
  assert.equal(assessment.inputProvenance, 'unverified-claims');
  assert.equal(assessment.productionEligible, false);
  assert.equal(assessment.spawnAuthorized, false);
  assert.deepEqual(assessment.unresolvedOfflineControls, []);
  assert.deepEqual(assessment.unverifiedRuntimeControls, preSpawnControls);
  assert.deepEqual(input, before);
  assert.ok(Buffer.byteLength(JSON.stringify(assessment)) < 2048);
});

for (const value of [undefined, null, [], {}, true, 'isolated']) test(`missing or malformed pre-spawn evidence: ${JSON.stringify(value)}`, () => {
  blocked(value, 'invalid');
});
for (const version of ['0.165.0', '0.166.1', '0.167.0', '', null]) test(`unsupported pre-spawn version: ${version}`, () => {
  blocked({ ...fixture(), sourceVersion: version }, 'version');
});
for (const platform of ['win32', 'freebsd', 'unknown', null]) test(`pre-spawn platform limitation: ${platform}`, () => {
  blocked({ ...fixture(), platform }, 'platform');
});
for (const scope of ['real-runtime', 'user-supplied', 'verified-runtime']) test(`claims cannot change pre-spawn scope: ${scope}`, () => {
  blocked({ ...fixture(), scope }, 'scope');
});

// Every boundary must independently fail closed, including inherited hooks, MCP,
// credentials, configuration conflicts, startup side effects and parent failure.
for (const key of preSpawnControls) {
  for (const evidence of ['unverified', 'conflicting', 'unsupported'] as const) test(`pre-spawn ${key}: ${evidence}`, () => {
    const input = fixture(); input.controls[key] = evidence;
    const assessment = blocked(input, 'evidence');
    assert.deepEqual(assessment.unresolvedOfflineControls, [key]);
    assert.equal(input.controls[key], evidence);
  });
  test(`pre-spawn rejects missing ${key}`, () => {
    const input = fixture(); delete (input.controls as Partial<PreSpawnInput['controls']>)[key];
    blocked(input, 'invalid');
  });
}

test('unknown fields, raw environment, launch flags and claimed runtime attestations are rejected without disclosure', () => {
  const canary = 'PRIVATE_PRE_SPAWN_CANARY';
  for (const extra of [
    { env: { CODEX_HOME: canary, HOME: canary, TOKEN: canary } },
    { args: [canary] }, { config: { hooks: canary } }, { productionEligible: true },
    { attestation: canary },
  ]) {
    const assessment = blocked({ ...fixture(), ...extra }, 'invalid');
    assert.equal(JSON.stringify(assessment).includes(canary), false);
    assert.ok(Buffer.byteLength(JSON.stringify(assessment)) < 2048);
  }
  const input = fixture();
  Object.assign(input.controls, { unknownCapability: canary });
  blocked(input, 'invalid');
  for (const evidence of [canary, true, null, {}, ['verified-offline'], 'verified-runtime']) {
    const assessment = blocked({ ...fixture(), controls: { ...fixture().controls, environmentIsolation: evidence } }, 'invalid');
    assert.equal(JSON.stringify(assessment).includes(canary), false);
  }
});

test('own data fields are required without invoking accessors or trusting prototypes', () => {
  const input = fixture();
  Object.defineProperty(input.controls, 'homeDiscovery', { get() { throw new Error('Accessor must not execute.'); } });
  blocked(input, 'invalid');
  blocked(Object.create(fixture()), 'invalid');
  blocked({ ...fixture(), [Symbol('private')]: 'private' }, 'invalid');
});

test('assessment failures discard exception details and retain all runtime blockers', () => {
  const input = new Proxy({}, { getPrototypeOf() { throw new Error('PRIVATE_FAILURE_CANARY'); } });
  const assessment = blocked(input, 'failure');
  assert.equal(assessment.diagnostic, 'Pre-spawn assessment failed.');
  assert.equal(JSON.stringify(assessment).includes('PRIVATE_FAILURE_CANARY'), false);
});

test('cancelled assessment does not inspect input or authorize a retry', () => {
  const input = new Proxy({}, { getPrototypeOf() { assert.fail('Cancelled input must not be inspected.'); } });
  const assessment = assessPreSpawn(input, AbortSignal.abort('PRIVATE_CANCEL_CANARY'));
  assert.equal(assessment.reason, 'cancelled');
  assert.equal(assessment.decision, 'blocked');
  assert.equal(assessment.spawnAuthorized, false);
  assert.equal(assessment.productionEligible, false);
  assert.deepEqual(assessment.unverifiedRuntimeControls, preSpawnControls);
  assert.equal(JSON.stringify(assessment).includes('PRIVATE_CANCEL_CANARY'), false);
});

test('assessment is immutable, detached from input and never a reusable process capability', () => {
  const input = fixture(); const assessment = assessPreSpawn(input);
  assert.throws(() => { (assessment as { productionEligible: boolean }).productionEligible = true; }, TypeError);
  assert.throws(() => { (assessment.unverifiedRuntimeControls as string[]).pop(); }, TypeError);
  input.controls.startupNetwork = 'unverified';
  assert.equal(assessment.productionEligible, false);
  assert.deepEqual(assessment.unverifiedRuntimeControls, preSpawnControls);
  blocked(input, 'evidence');
  blocked(assessment, 'invalid');
});

test('multiple unresolved boundaries retain deterministic control ordering', () => {
  const input = fixture();
  input.controls.credentialContinuity = 'unverified';
  input.controls.configurationOrigins = 'conflicting';
  input.controls.environmentIsolation = 'unsupported';
  assert.deepEqual(blocked(input, 'evidence').unresolvedOfflineControls,
    ['environmentIsolation', 'configurationOrigins', 'credentialContinuity']);
});

test('cancellation during evidence selection takes precedence over model completion', () => {
  const controller = new AbortController();
  const input = fixture();
  input.controls = new Proxy(input.controls, {
    getOwnPropertyDescriptor(target, key) {
      controller.abort();
      return Object.getOwnPropertyDescriptor(target, key);
    },
  });
  const assessment = assessPreSpawn(input, controller.signal);
  assert.equal(assessment.reason, 'cancelled');
  assert.equal(assessment.spawnAuthorized, false);
  assert.equal(assessment.productionEligible, false);
});
