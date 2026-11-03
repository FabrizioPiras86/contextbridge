import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const source = resolve('tests/fixtures/managed/native-admission.c');
async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
async function until(check: () => Promise<boolean>, budget = 3000) {
  const deadline = performance.now() + budget;
  while (!await check()) {
    assert.ok(performance.now() < deadline, 'Native fixture handshake timed out.');
    // Poll an explicit marker/event predicate; never infer readiness from elapsed time.
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function bounded<T>(promise: Promise<T>, budget = 3000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Native fixture deadline exceeded.')), budget);
    })]);
  } finally { clearTimeout(timer); }
}

describe('macOS native suspended admission experiment (not descendant containment)', { skip: process.platform !== 'darwin' }, () => {
  let build: string;
  let binary: string;
  before(async () => {
    build = await mkdtemp(join(tmpdir(), 'contextbridge-native-build-'));
    binary = join(build, 'native-admission');
    const result = spawnSync('/usr/bin/clang', ['-std=c11', '-Wall', '-Wextra', '-Werror', source, '-o', binary], {
      env: { TMPDIR: build }, timeout: 20_000, maxBuffer: 8192,
    });
    assert.equal(result.status, 0, 'Native fixture compilation requires working macOS Command Line Tools.');
  });
  after(async () => { if (build) await rm(build, { recursive: true, force: true }); });

  async function fixture(t, mode = 'running') {
    const root = await mkdtemp(join(tmpdir(), 'contextbridge-native-PRIVATE_PATH_CANARY-'));
    const owner = spawn(binary, [root, mode], { env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
    const events: { event: string; signals: number; spawnAuthorized: false; productionEligible: false }[] = [];
    let output = '';
    let stderr = '';
    owner.stdout.on('data', (bytes) => { output += bytes.toString(); });
    owner.stderr.on('data', (bytes) => { stderr += bytes.toString(); });
    owner.stdin.on('error', () => {});
    const lines = createInterface({ input: owner.stdout });
    lines.on('line', (line) => { events.push(JSON.parse(line)); });
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      owner.once('error', reject);
      owner.once('close', (code, signal) => resolve({ code, signal }));
    });
    // No PID files, process enumeration, or orphan signals. Released workloads have
    // a private emergency channel and six-second self-expiry, including escapees.
    t.after(async () => {
      await writeFile(join(root, 'emergency-stop'), 'stop');
      owner.stdin.end();
      await bounded(exited, 7000);
      if (await exists(join(root, 'escaped-ready'))) await until(() => exists(join(root, 'escaped-exit')));
      if (await exists(join(root, 'workload-ready')) && !events.some((e) => e.event === 'direct-child-reaped'))
        await until(() => exists(join(root, 'workload-exit')));
      lines.close();
      assert.equal(stderr, '');
      assert.equal(output.includes('PRIVATE_PATH_CANARY'), false);
      for (const event of events) {
        assert.deepEqual(Object.keys(event), ['event', 'signals', 'spawnAuthorized', 'productionEligible']);
        assert.ok(['admission-failed', 'suspended-before-entry', 'released', 'observed-child-exit',
          'exit-unconfirmed', 'direct-child-reaped', 'cleanup-unconfirmed'].includes(event.event));
        assert.ok(Number.isInteger(event.signals) && event.signals >= 0 && event.signals <= 3);
        assert.equal(event.spawnAuthorized, false);
        assert.equal(event.productionEligible, false);
      }
      await rm(root, { recursive: true, force: true });
    });
    const event = async (name: string, count = 1) => {
      await until(async () => events.filter((e) => e.event === name).length >= count);
      return events.filter((e) => e.event === name)[count - 1];
    };
    const marker = (name: string) => until(() => exists(join(root, name)));
    const send = (command: string) => owner.stdin.write(command);
    await event('suspended-before-entry');
    return { root, owner, exited, events, event, marker, send };
  }

  test('kernel suspended status precedes workload entry; release permits startup writes', { timeout: 12_000 }, async (t) => {
    const f = await fixture(t, 'normal');
    assert.deepEqual(await readdir(f.root), []);
    f.send('R');
    await f.event('released');
    await f.marker('workload-exit');
    assert.equal(await readFile(join(f.root, 'workload-entered'), 'utf8'), 'fixture\n');
    f.send('O'); await f.event('observed-child-exit');
    f.send('S');
    assert.equal((await f.event('direct-child-reaped')).signals, 1); // SIGCONT only; already exited.
  });

  test('cancellation before release reaps the child without workload entry', { timeout: 12_000 }, async (t) => {
    const f = await fixture(t);
    f.send('SR');
    assert.equal((await f.event('direct-child-reaped')).signals, 1);
    await f.event('admission-failed');
    assert.equal(await exists(join(f.root, 'workload-entered')), false);
  });

  for (const mode of ['running', 'hung']) test(`bounded direct-child cleanup: ${mode}`, { timeout: 12_000 }, async (t) => {
    const f = await fixture(t, mode);
    f.send('R'); await f.marker('workload-ready');
    f.send('SSS');
    const last = await f.event('direct-child-reaped', 3);
    assert.equal(last.signals, mode === 'hung' ? 3 : 2);
    assert.ok(f.events.filter((e) => e.event === 'direct-child-reaped').every((e) => e.signals === last.signals));
    f.send('S');
    assert.equal((await f.event('direct-child-reaped', 4)).signals, last.signals);
  });

  for (const mode of ['escaped', 'regrouped']) test(`${mode} descendant survives confirmed direct-child cleanup`, { timeout: 12_000 }, async (t) => {
    const f = await fixture(t, mode);
    f.send('R'); await f.marker('escaped-ready');
    f.send('S'); await f.event('direct-child-reaped');
    assert.equal(await exists(join(f.root, 'escaped-exit')), false);
    // Assert the missing guarantee, then stop only through the fixture's channel.
    await writeFile(join(f.root, 'emergency-stop'), 'stop');
    await f.marker('escaped-exit');
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) for (const released of [false, true]) test(`supervisor handles ${signal}, released=${released}`, { timeout: 12_000 }, async (t) => {
    const f = await fixture(t);
    if (released) { f.send('R'); await f.marker('workload-ready'); }
    assert.equal(f.owner.kill(signal), true);
    assert.deepEqual(await bounded(f.exited), { code: 0, signal: null });
    await f.event('direct-child-reaped');
    assert.equal(await exists(join(f.root, 'workload-entered')), released);
  });

  test('parent control-pipe closure triggers direct-child cleanup', { timeout: 12_000 }, async (t) => {
    const f = await fixture(t);
    f.send('R'); await f.marker('workload-ready');
    f.owner.stdin.end();
    assert.deepEqual(await bounded(f.exited), { code: 0, signal: null });
    await f.event('direct-child-reaped');
  });

  for (const failure of ['SIGKILL', 'hard-exit'] as const) test(`supervisor ${failure} leaves a running child alive`, { timeout: 12_000 }, async (t) => {
    const f = await fixture(t);
    f.send('R'); await f.marker('workload-ready');
    if (failure === 'SIGKILL') assert.equal(f.owner.kill('SIGKILL'), true);
    else f.send('X');
    assert.deepEqual(await bounded(f.exited), failure === 'SIGKILL' ? { code: null, signal: 'SIGKILL' } : { code: 7, signal: null });
    assert.equal(f.events.some((e) => e.event === 'direct-child-reaped'), false);
    assert.equal(await exists(join(f.root, 'workload-exit')), false);
    // A fresh response after supervisor death proves survival, not just a stale marker.
    await writeFile(join(f.root, 'emergency-stop'), 'stop');
    await f.marker('workload-exit');
  });

  test('injected ownership loss remains sticky and disables all further signaling and release', { timeout: 12_000 }, async (t) => {
    const f = await fixture(t);
    f.send('R'); await f.marker('workload-ready');
    f.send('USSS');
    const last = await f.event('cleanup-unconfirmed', 4);
    assert.equal(last.signals, 1);
    assert.equal(f.events.some((e) => e.event === 'direct-child-reaped'), false);
    f.send('R');
    assert.equal((await f.event('admission-failed')).signals, 1);
    assert.equal(f.events.filter((e) => e.event === 'released').length, 1);
    await writeFile(join(f.root, 'emergency-stop'), 'stop');
    await f.marker('workload-exit');
    f.send('S');
    assert.equal((await f.event('cleanup-unconfirmed', 5)).signals, 1);
    f.owner.stdin.end();
    assert.deepEqual(await bounded(f.exited), { code: 3, signal: null });
  });
});
