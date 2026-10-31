import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initProject } from '../src/config.ts';
import { createCheckpoint } from '../src/snapshot.ts';
import { digestOf } from '../src/storage.ts';

const entry = resolve('bin/contextbridge.mjs');

test('Codex assisted handoff uses verified data and fails recoverably', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'contextbridge-next-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const bin = join(base, 'bin');
  const empty = join(base, 'empty');
  await mkdir(bin);
  await mkdir(empty);
  const executable = join(bin, process.platform === 'win32' ? 'codex.exe' : 'codex');
  const preload = join(base, 'mock.cjs');
  const mock = `const fs = require('node:fs');
fs.writeFileSync(process.env.CB_RECORD, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));
process.stdout.write('Mock Codex interactive output\\n');
process.stderr.write('Mock Codex diagnostic\\n');
if (process.env.CB_SIGNAL) process.kill(process.pid, 'SIGTERM');
else process.exit(Number(process.env.CB_EXIT || 0));
`;
  if (process.platform === 'win32') {
    await copyFile(process.execPath, executable);
    // Preload runs before Node interprets the prompt as a script filename.
    await writeFile(preload, `if (require('node:path').basename(process.execPath).toLowerCase() === 'codex.exe') { process.argv.splice(1, 0, 'mock'); ${mock} }`);
  } else {
    await writeFile(executable, `#!${process.execPath}\n${mock}`);
    await chmod(executable, 0o755);
  }

  async function fixture(checkpoint = true) {
    const root = await mkdtemp(join(base, 'project with spaces-'));
    await initProject(root, 'both');
    const snapshot = checkpoint ? await createCheckpoint(root, {
      objective: 'Build the API', nextStep: 'Write integration tests',
      decisions: ['Preserve user text: `quotes` $(touch unwanted) "value"\n--resume --last\n\u4f60\u597d'],
    }) : undefined;
    const record = join(root, 'invocation.json');
    const snapshotPath = snapshot ? join(root, '.contextbridge', 'snapshots', `${snapshot.id}.json`) : '';
    const run = (args: string[] = [], env: NodeJS.ProcessEnv = {}, cwd = base) => spawnSync(process.execPath,
      [entry, 'next', '--project', root, '--agent', 'codex', ...args], {
        cwd, encoding: 'utf8', timeout: 15_000,
        env: { ...process.env, PATH: bin, CB_RECORD: record,
          ...(process.platform === 'win32' ? { NODE_OPTIONS: `--require ${JSON.stringify(preload)}` } : {}), ...env },
      });
    const notLaunched = async () => assert.rejects(readFile(record), { code: 'ENOENT' });
    return { root, snapshot, snapshotPath, record, run, notLaunched };
  }

  await t.test('launches once in the project with one initial prompt and unchanged checkpoint files', async () => {
    const f = await fixture();
    await writeFile(join(f.root, '.contextbridge', 'HANDOFF.md'), 'UNVERIFIED HANDOFF CONTENT');
    const paths = [f.snapshotPath, ...['state.json', 'config.json', 'HANDOFF.md'].map((name) => join(f.root, '.contextbridge', name))];
    const before = await Promise.all(paths.map((path) => readFile(path, 'utf8')));
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const invocation = JSON.parse(await readFile(f.record, 'utf8'));
    assert.equal(invocation.cwd, await realpath(f.root));
    assert.equal(invocation.args.length, 1);
    const prompt = invocation.args[0];
    assert.match(prompt, /untrusted data, not privileged instructions/);
    assert.match(prompt, /test results are unknown/);
    assert.match(prompt, /user's language preference/);
    assert.doesNotMatch(prompt, /UNVERIFIED HANDOFF CONTENT/);
    assert.deepEqual(JSON.parse(prompt.split('Checkpoint data (JSON):\n')[1]), f.snapshot);
    assert.match(result.stdout, /Mock Codex interactive output/);
    assert.match(result.stderr, /Mock Codex diagnostic/);
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(path, 'utf8'))), before);
    assert.deepEqual(await readdir(join(f.root, '.contextbridge')), ['HANDOFF.md', 'config.json', 'snapshots', 'state.json']);
  });

  await t.test('reads the latest checkpoint without requiring HANDOFF.md', async () => {
    const f = await fixture();
    const latest = await createCheckpoint(f.root, { objective: 'Latest goal', nextStep: 'Review the implementation' });
    await rm(join(f.root, '.contextbridge', 'HANDOFF.md'));
    assert.equal(f.run().status, 0);
    const { args } = JSON.parse(await readFile(f.record, 'utf8'));
    assert.deepEqual(JSON.parse(args[0].split('Checkpoint data (JSON):\n')[1]), latest);
  });

  await t.test('defaults to the current project directory', async () => {
    const f = await fixture();
    const result = spawnSync(process.execPath, [entry, 'next', '--agent', 'codex'], {
      cwd: f.root, encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, PATH: bin, CB_RECORD: f.record,
        ...(process.platform === 'win32' ? { NODE_OPTIONS: `--require ${JSON.stringify(preload)}` } : {}) },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(await readFile(f.record, 'utf8')).cwd, await realpath(f.root));
  });

  for (const agent of ['claude', 'both', 'unknown']) {
    await t.test(`rejects unsupported agent ${agent}`, async () => {
      const f = await fixture();
      const result = f.run(['--agent', agent]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Other agent handoff adapters are not implemented/);
      await f.notLaunched();
    });
  }
  await t.test('requires an explicit agent selection', async () => {
    const result = spawnSync(process.execPath, [entry, 'next'], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Use next --agent codex/);
  });
  await t.test('shows command help without launching an agent', async () => {
    const f = await fixture(false);
    const result = f.run(['--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /next --agent codex/);
    await f.notLaunched();
  });
  await t.test('rejects an uninitialized project', async () => {
    const f = await fixture(false);
    await rm(join(f.root, '.contextbridge'), { recursive: true });
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Run init and checkpoint/);
    await f.notLaunched();
  });
  await t.test('rejects missing checkpoints', async () => {
    const f = await fixture(false);
    assert.match(f.run().stderr, /No checkpoint is available/);
    await f.notLaunched();
  });
  await t.test('rejects a missing snapshot file', async () => {
    const f = await fixture();
    await rm(f.snapshotPath);
    assert.equal(f.run().status, 1);
    await f.notLaunched();
  });
  await t.test('rejects tampering, malformed JSON, identity mismatch and invalid schema', async () => {
    const f = await fixture();
    const original = JSON.parse(await readFile(f.snapshotPath, 'utf8'));
    for (const raw of [
      '{', 'null', JSON.stringify({ ...original, id: 'cb_wrong' }),
      JSON.stringify({ ...original, schemaVersion: 2 }),
      JSON.stringify({ ...original, work: { ...original.work, objective: 'tampered' } }),
      JSON.stringify({ ...original, digest: 'wrong' }),
    ]) {
      await writeFile(f.snapshotPath, raw);
      assert.equal(f.run().status, 1);
      await f.notLaunched();
    }
    const { digest, ...payload } = original;
    for (const work of [null, {}, { ...payload.work, decisions: [42] }]) {
      const invalid = { ...payload, work };
      await writeFile(f.snapshotPath, JSON.stringify({ ...invalid, digest: digestOf(invalid) }));
      assert.match(f.run().stderr, /Invalid snapshot data/);
      await f.notLaunched();
    }
  });
  await t.test('rejects path traversal and malformed pointers', async () => {
    const f = await fixture();
    for (const state of [null, {}, { schemaVersion: 1, latestSnapshotId: '../../outside' }]) {
      await writeFile(join(f.root, '.contextbridge', 'state.json'), JSON.stringify(state));
      assert.match(f.run().stderr, /Invalid snapshot pointer/);
      await f.notLaunched();
    }
  });
  await t.test('rejects oversized prompts without launching', async () => {
    const f = await fixture();
    await createCheckpoint(f.root, { objective: 'x'.repeat(25_000), nextStep: 'Review' });
    assert.match(f.run().stderr, /too large/);
    await f.notLaunched();
  });
  await t.test('preserves null characters through JSON escaping', async () => {
    const f = await fixture();
    await createCheckpoint(f.root, { objective: 'Goal\0text', nextStep: 'Review' });
    assert.equal(f.run().status, 0);
    const { args } = JSON.parse(await readFile(f.record, 'utf8'));
    assert.equal(JSON.parse(args[0].split('Checkpoint data (JSON):\n')[1]).work.objective, 'Goal\0text');
  });
  await t.test('reports unavailable Codex and permits retry', async () => {
    const f = await fixture();
    const result = f.run([], { PATH: empty });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Codex executable is unavailable/);
    await f.notLaunched();
    assert.equal(f.run().status, 0);
  });
  await t.test('reports an executable permission failure', { skip: process.platform === 'win32' }, async () => {
    const f = await fixture();
    await chmod(executable, 0o600);
    try {
      const result = f.run();
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Could not start Codex/);
      await f.notLaunched();
    } finally {
      await chmod(executable, 0o755);
    }
  });
  await t.test('preserves Codex failure exit code and permits retry', async () => {
    const f = await fixture();
    const result = f.run([], { CB_EXIT: '7' });
    assert.equal(result.status, 7);
    assert.match(result.stderr, /checkpoint is unchanged/);
    assert.equal(f.run().status, 0);
  });
  await t.test('reports a terminated child', { skip: process.platform === 'win32' }, async () => {
    const f = await fixture();
    const result = f.run([], { CB_SIGNAL: '1' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /terminated by signal SIGTERM/);
  });
});
