import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createMemoryEvent } from '../src/memory.ts';

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

test('CLI memory add and list preserve text and reject invalid input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-memory-cli-'));
  try {
    assert.equal(cli(['init', '--project', root]).status, 0);
    assert.equal(cli(['memory', '--help']).status, 0);
    const added = cli(['memory', 'add', '--project', root, '--type', 'decision', '--text', 'Use MySQL', '--file', 'src/db.ts']);
    assert.equal(added.status, 0, added.stderr);
    assert.match(added.stdout, /unverified/);
    const listed = cli(['memory', 'list', '--project', root]);
    assert.equal(listed.status, 0, listed.stderr);
    const [event] = JSON.parse(listed.stdout);
    assert.equal(event.content, 'Use MySQL');
    assert.equal(event.source.kind, 'user-supplied');
    for (const args of [[], ['--type', 'fact', '--text', 'Claim'], ['--type', 'note'], ['--type', 'note', '--text', 'password=hidden'],
      ['--type', 'note', '--text', 'Text', '--file', '../outside'], ['--unknown', 'value']]) {
      assert.equal(cli(['memory', 'add', '--project', root, ...args]).status, 1);
    }
    assert.equal(JSON.parse(cli(['memory', 'list', '--project', root]).stdout).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('CLI reports recovered tails and persistent marker exclusions on stderr', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-recovery-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(cli(['init', '--project', root]).status, 0);
  const dir = join(root, '.contextbridge', 'journal');
  await mkdir(dir);
  const path = join(dir, 'events.jsonl');
  const recovered = createMemoryEvent({ type: 'note', content: 'Complete event', source: { kind: 'user-supplied' } });
  await writeFile(path, JSON.stringify(recovered));
  const listed = cli(['memory', 'list', '--project', root]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout), [recovered]);
  assert.match(listed.stderr, /Recovered complete journal tail at byte 0/);
  const added = cli(['memory', 'add', '--project', root, '--type', 'note', '--text', 'Next event']);
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stderr, /Recovered complete journal tail at byte 0/);
  await appendFile(path, '{');
  const partial = cli(['memory', 'list', '--project', root]);
  assert.equal(partial.status, 0, partial.stderr);
  assert.match(partial.stderr, /Incomplete journal tail/);
  const resumed = cli(['memory', 'add', '--project', root, '--type', 'note', '--text', 'Resume']);
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.match(resumed.stderr, /excluded by recovery marker/);
  const after = cli(['memory', 'list', '--project', root]);
  assert.equal(after.status, 0, after.stderr);
  assert.equal(JSON.parse(after.stdout).length, 3);
  assert.match(after.stderr, /excluded by recovery marker/);
});
