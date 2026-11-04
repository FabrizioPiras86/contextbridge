import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'contextbridge-codex-fixture-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
test('Node --version exits before a require preload can emulate Codex', async (t) => {
  const dir = await fixture(t);
  const preload = join(dir, 'preload.cjs');
  await writeFile(preload, "console.log('preload ran'); process.exit(17);");
  const env = { ...process.env, NODE_OPTIONS: `--require ${JSON.stringify(preload)}` };
  const version = spawnSync(process.execPath, ['--version'], { env, encoding: 'utf8' });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), process.version);
  const features = spawnSync(process.execPath, ['features', 'list'], { env, encoding: 'utf8' });
  assert.equal(features.status, 17);
  assert.equal(features.stdout.trim(), 'preload ran');
});
for (const method of ['spawn', 'spawnSync']) test(`Codex fixture ${method} adapter passes flags to a real script child`, async (t) => {
  const dir = await fixture(t);
  const executable = join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex');
  if (process.platform === 'win32') await copyFile(process.execPath, executable);
  else await symlink(process.execPath, executable);
  const script = join(dir, 'mock with spaces.cjs');
  await writeFile(script, "console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() })); process.exit(7);");
  for (const args of [['--version'], ['features', 'list'], ['Prompt with spaces and "quotes"']]) {
    const code = `require(${JSON.stringify(resolve('tests/fixtures/codex-launch.cjs'))})(${JSON.stringify(executable)}, ${JSON.stringify(script)}, ${JSON.stringify(dir)});
const cp = require('node:child_process');
const child = cp.${method}('codex', ${JSON.stringify(args)}, { cwd: ${JSON.stringify(dir)}, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
${method === 'spawnSync' ? 'process.stdout.write(child.stdout); process.exit(child.status);' : "child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr); child.on('exit', code => process.exit(code));"}`;
    const result = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, PATH: dir }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 7, result.stderr);
    const received = JSON.parse(result.stdout);
    assert.deepEqual(received.args, args);
    const [actual, expected] = await Promise.all([stat(received.cwd, { bigint: true }), stat(dir, { bigint: true })]);
    assert.deepEqual([actual.dev, actual.ino], [expected.dev, expected.ino]);
  }
});
