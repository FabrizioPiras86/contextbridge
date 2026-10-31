import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject, loadConfig, validateConfig } from '../src/config.ts';
import type { Config } from '../src/types.ts';

test('init writes safe English-language starter configuration and gitignore', async () => {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-config-'));
  try {
    assert.deepEqual(await initProject(root, 'both'), { created: true });
    assert.deepEqual(await initProject(root, 'both'), { created: false });
    const config = await loadConfig(root);
    assert.equal(config.mode, 'assisted');
    assert.equal(config.privacy.telemetry, false);
    const ignore = await readFile(join(root, '.gitignore'), 'utf8');
    assert.equal(ignore.match(/\.contextbridge\//g)?.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid threshold order is rejected', () => {
  const config: Config = {
    schemaVersion: 1, agent: 'both', mode: 'assisted',
    thresholds: { warning: 90, handoff: 75, safety: 95 },
    privacy: { captureSourceContent: false, telemetry: false },
  };
  assert.throws(() => validateConfig(config), /Thresholds/);
});
