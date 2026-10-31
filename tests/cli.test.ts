import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const entry = resolve('bin/contextbridge.mjs');

function cli(args: string[]) {
  return spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', timeout: 15_000 });
}

test('CLI produces a useful help message', () => {
  const result = cli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ContextBridge CLI/);
});

test('CLI rejects unimplemented rollover commands', () => {
  const result = cli(['run']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not implemented/);
});

test('CLI init, checkpoint, verify and status work end to end', async () => {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-e2e-'));
  try {
    assert.equal(cli(['init', '--project', root]).status, 0);
    const checkpoint = cli([
      'checkpoint', '--project', root, '--objective', 'Build API', '--next-step', 'Write tests',
    ]);
    assert.equal(checkpoint.status, 0, checkpoint.stderr);
    assert.match(checkpoint.stdout, /Checkpoint saved/);
    assert.equal(cli(['verify', '--project', root]).status, 0);
    const status = cli(['status', '--project', root]);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /Build API/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
