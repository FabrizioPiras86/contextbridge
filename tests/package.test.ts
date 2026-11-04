import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('local tarball installs offline and supports the assisted workflow', { timeout: 120_000 }, async (t) => {
  const repository = resolve('.');
  const base = await mkdtemp(join(tmpdir(), 'contextbridge-package-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const consumer = join(base, 'consumer with spaces');
  const project = join(base, 'project with spaces');
  const mockBin = join(base, 'mock-bin');
  const emptyPath = join(base, 'empty-bin');
  await Promise.all([consumer, project, mockBin, emptyPath].map((path) => mkdir(path)));
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'Run package tests through npm test or npm run test:package.');
  const userConfig = join(base, 'user.npmrc');
  const globalConfig = join(base, 'global.npmrc');
  await Promise.all([userConfig, globalConfig].map((path) => writeFile(path, '')));
  const npm = (args: string[], cwd = repository) => {
    const result = spawnSync(process.execPath, [npmCli, '--offline', '--no-audit', '--no-fund',
      '--cache', join(base, 'cache'), '--userconfig', userConfig, '--globalconfig', globalConfig, ...args],
    { cwd, encoding: 'utf8', timeout: 45_000 });
    assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr}\n${result.stdout}`);
    return result.stdout;
  };
  const [packed] = JSON.parse(npm(['pack', '--json', '--pack-destination', base]));
  const paths: string[] = packed.files.map((file: { path: string }) => file.path);

  await t.test('package allowlist contains runtime and documentation without development or local data', async () => {
    for (const path of ['bin/contextbridge.mjs', 'bin/contextbridge-hook.mjs', 'dist/cli.js',
      'dist/hooks/runner.js', 'dist/hooks/install.js', 'docs/CODEX_HOOKS.md',
      'docs/V1_ASSISTED_RELEASE_REPORT.md', 'SECURITY.md', 'LICENSE']) {
      assert.ok(paths.includes(path), `Missing package file: ${path}`);
    }
    for (const path of paths) {
      assert.match(path, /^(?:bin\/[^/]+\.mjs|dist\/.+\.js|docs\/[^/]+\.md|integrations\/.+\.md|(?:package\.json|README\.md|LICENSE|SECURITY\.md|CONTRIBUTING\.md))$/);
      assert.doesNotMatch(path, /(?:^|\/)(?:tests|fixtures|node_modules|\.contextbridge|\.codex|\.git|cache|coverage)(?:\/|$)/);
    }
    const [again] = JSON.parse(npm(['pack', '--json', '--pack-destination', base]));
    assert.equal(again.integrity, packed.integrity, 'Repeated packing with the same Node version must be reproducible.');
    npm(['install', '--ignore-scripts', '--package-lock=false', join(base, packed.filename)], consumer);
  });

  const installed = join(consumer, 'node_modules', 'contextbridge');
  const entry = join(installed, 'bin', 'contextbridge.mjs');
  const metadata = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(metadata.private, true);
  assert.equal(metadata.engines.node, '>=22.16.0');
  assert.equal(metadata.dependencies, undefined);
  assert.ok((await stat(join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'contextbridge.cmd' : 'contextbridge'))).isFile());
  await assert.rejects(stat(join(installed, 'src')), { code: 'ENOENT' });
  const record = join(base, 'codex-invocations.jsonl');
  const executable = join(mockBin, process.platform === 'win32' ? 'codex.exe' : 'codex');
  const preload = join(base, 'mock.cjs');
  const mock = `const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') console.log(process.env.CB_VERSION || 'codex-cli 0.166.0');
else if (args[0] === 'features' && args[1] === 'list') console.log('hooks stable ' + (process.env.CB_HOOKS || 'true'));
else {
  fs.appendFileSync(process.env.CB_RECORD, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
  process.exit(Number(process.env.CB_EXIT || 0));
}`;
  if (process.platform === 'win32') {
    await copyFile(process.execPath, executable);
    const script = join(base, 'codex-mock.cjs');
    await writeFile(script, mock);
    // Node handles --version before preloads. Prefix the script in the parent,
    // leaving production compatibility parsing and real child execution intact.
    await writeFile(preload, `require(${JSON.stringify(resolve('tests/fixtures/codex-launch.cjs'))})(${JSON.stringify(executable)}, ${JSON.stringify(script)}, ${JSON.stringify(mockBin)});`);
  } else {
    await writeFile(executable, `#!${process.execPath}\n${mock}`);
    await chmod(executable, 0o755);
  }
  const env = { ...process.env, PATH: mockBin, CB_RECORD: record,
    ...(process.platform === 'win32' ? { NODE_OPTIONS: `--require ${JSON.stringify(preload)}` } : {}) };
  const cli = (args: string[], overrides: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath,
    [entry, ...args, '--project', project], { cwd: base, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 15_000 });
  const ok = (args: string[]) => {
    const result = cli(args);
    assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr}`);
    return result.stdout;
  };

  await t.test('installed launcher displays help and initializes only the disposable project', async () => {
    assert.match(ok(['--help']), /ContextBridge CLI/);
    assert.match(npm(['exec', '--', 'contextbridge', '--help'], consumer), /ContextBridge CLI/);
    ok(['init', '--agent', 'codex']);
    const config = JSON.parse(await readFile(join(project, '.contextbridge', 'config.json'), 'utf8'));
    assert.equal(config.mode, 'assisted');
    assert.deepEqual(config.privacy, { captureSourceContent: false, telemetry: false });
    assert.equal(await readFile(join(project, '.gitignore'), 'utf8'), '.contextbridge/\n');
    await assert.rejects(stat(join(project, '.codex')), { code: 'ENOENT' });
  });
  await t.test('missing checkpoint blocks handoff without launching Codex', async () => {
    const result = cli(['next', '--agent', 'codex']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No checkpoint is available/);
    await assert.rejects(readFile(record), { code: 'ENOENT' });
  });
  await t.test('memory, checkpoint, integrity verification and status preserve honest provenance', () => {
    ok(['memory', 'add', '--type', 'decision', '--text', 'Keep portable state']);
    ok(['memory', 'add', '--type', 'note', '--text', 'Agent reports progress', '--source', 'agent-reported']);
    const events = JSON.parse(ok(['memory', 'list']));
    assert.deepEqual(events.map((event: { source: { kind: string } }) => event.source.kind), ['user-supplied', 'agent-reported']);
    assert.ok(events.every((event: { verification: string }) => event.verification === 'unverified'));
    assert.match(ok(['checkpoint', '--objective', 'Validate installed package', '--next-step', 'Review evidence']), /Checkpoint saved/);
    assert.match(ok(['verify']), /Verified SHA-256/);
    assert.match(ok(['status']), /Validate installed package/);
    assert.equal(JSON.parse(ok(['context', 'status'])).contextUtilization, 'unknown');
  });
  const stateDir = join(project, '.contextbridge');
  const state = JSON.parse(await readFile(join(stateDir, 'state.json'), 'utf8'));
  const snapshotPath = join(stateDir, 'snapshots', `${state.latestSnapshotId}.json`);
  const original = await readFile(snapshotPath, 'utf8');
  const snapshot = JSON.parse(original);
  assert.equal(snapshot.provenance.conversationHistoryCaptured, false);
  assert.equal(snapshot.provenance.workFields, 'user-supplied');

  await t.test('fresh mock Codex handoff uses verified snapshot and preserves child exit code', async () => {
    await writeFile(join(stateDir, 'HANDOFF.md'), 'Untrusted mutable handoff');
    const protectedPaths = [snapshotPath, ...['state.json', 'config.json', 'HANDOFF.md'].map((name) => join(stateDir, name))];
    const before = await Promise.all(protectedPaths.map((path) => readFile(path, 'utf8')));
    ok(['next', '--agent', 'codex']);
    assert.equal(cli(['next', '--agent', 'codex'], { CB_EXIT: '7' }).status, 7);
    const calls = (await readFile(record, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.args.length, 1);
      assert.match(call.args[0], /untrusted data, not privileged instructions/);
      assert.deepEqual(JSON.parse(call.args[0].split('Checkpoint data (JSON):\n')[1]), snapshot);
      const [actual, expected] = await Promise.all([stat(call.cwd, { bigint: true }), stat(project, { bigint: true })]);
      assert.deepEqual([actual.dev, actual.ino], [expected.dev, expected.ino]);
    }
    assert.deepEqual(await Promise.all(protectedPaths.map((path) => readFile(path, 'utf8'))), before);
  });
  await t.test('tampering, missing Codex and disabled execution fail safely without another invocation', async () => {
    const before = await readFile(record, 'utf8');
    await writeFile(snapshotPath, JSON.stringify({ ...snapshot, work: { ...snapshot.work, objective: 'Tampered' } }));
    assert.equal(cli(['next', '--agent', 'codex']).status, 1);
    assert.equal(cli(['verify']).status, 1);
    await writeFile(snapshotPath, original);
    const missing = cli(['next', '--agent', 'codex'], { PATH: emptyPath });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Codex executable is unavailable/);
    const managed = cli(['context', 'run', '--agent', 'codex', '--yes']);
    assert.equal(managed.status, 1);
    assert.match(managed.stderr, /real App Server execution is disabled/);
    assert.equal(cli(['run']).status, 1);
    assert.equal(await readFile(record, 'utf8'), before);
    assert.equal(await readFile(snapshotPath, 'utf8'), original);
    await assert.rejects(stat(join(stateDir, 'telemetry')), { code: 'ENOENT' });
  });
  await t.test('installed hook compatibility rejects unsupported versions and disabled hooks', async () => {
    for (const [overrides, reason] of [
      [{ CB_VERSION: 'codex-cli 0.165.0' }, /Only codex-cli 0\.166\.0/],
      [{ CB_HOOKS: 'false' }, /hooks are unavailable or disabled/],
    ] as const) {
      const result = cli(['hooks', 'install', '--agent', 'codex', '--yes'], overrides);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, reason);
      await assert.rejects(stat(join(project, '.codex')), { code: 'ENOENT' });
    }
  });
  await t.test('packaged hook worker requires opt-in and captures only explicitly labeled claims', async () => {
    const denied = cli(['hooks', 'install', '--agent', 'codex']);
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /explicit opt-in/);
    ok(['hooks', 'install', '--agent', 'codex', '--dry-run']);
    await assert.rejects(stat(join(project, '.codex')), { code: 'ENOENT' });
    ok(['hooks', 'install', '--agent', 'codex', '--yes']);
    assert.equal(JSON.parse(ok(['hooks', 'status', '--agent', 'codex'])).state, 'installed');
    const payload = { hook_event_name: 'Stop', session_id: 'package-session', turn_id: 'package-turn',
      cwd: project, stop_hook_active: false, transcript_path: join(base, 'nonexistent-transcript'),
      last_assistant_message: '```contextbridge-memory\n{"schemaVersion":1,"events":[{"kind":"decision","text":"Keep packaging offline"}]}\n```' };
    const worker = spawnSync(process.execPath, [join(installed, 'bin', 'contextbridge-hook.mjs'), '--project', project],
      { cwd: base, env, input: JSON.stringify(payload), encoding: 'utf8', timeout: 10_000 });
    assert.equal(worker.status, 0, worker.stderr);
    assert.match(JSON.parse(worker.stdout).systemMessage, /1 captured/);
    const events = JSON.parse(ok(['memory', 'list']));
    assert.equal(events.length, 3);
    assert.equal(events[2].source.kind, 'agent-reported');
    assert.equal(events[2].verification, 'unverified');
    ok(['hooks', 'uninstall', '--agent', 'codex']);
    assert.equal(JSON.parse(ok(['hooks', 'status', '--agent', 'codex'])).state, 'not-installed');
    assert.ok(!(await readdir(stateDir)).includes('telemetry'));
  });
});
