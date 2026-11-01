import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initProject } from '../src/config.ts';
import { listMemory } from '../src/memory.ts';
import { captureCodexMemory, extractCodexMemory, MAX_HOOK_INPUT_BYTES, parseCodexHook } from '../src/hooks/codex.ts';
import { codexHookCompatibility, hookGroups, hooksStatus, manageHooks, quoteHookArgument } from '../src/hooks/install.ts';
import type { TestContext } from 'node:test';

const hookEntry = resolve('bin/contextbridge-hook.mjs');
const cliEntry = resolve('bin/contextbridge.mjs');
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-hooks-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initProject(root, 'codex');
  return { root, config: join(root, '.codex', 'hooks.json'), receipt: join(root, '.contextbridge', 'integrations', 'codex-hooks.json') };
}
function block(events = [{ kind: 'decision', text: 'Use SQLite' }]) {
  return '```contextbridge-memory\n' + JSON.stringify({ schemaVersion: 1, events }) + '\n```';
}
function payload(root: string, overrides: Record<string, unknown> = {}) {
  return { hook_event_name: 'Stop', session_id: 'session-1', turn_id: 'turn-1', cwd: root,
    transcript_path: null, stop_hook_active: false, last_assistant_message: block(), ...overrides };
}
function input(root: string, overrides: Record<string, unknown> = {}) {
  return parseCodexHook(Buffer.from(JSON.stringify(payload(root, overrides))));
}
function runHook(root: string, value: unknown, env = process.env) {
  const result = spawnSync(process.execPath, [hookEntry, '--project', root], {
    input: typeof value === 'string' ? value : JSON.stringify(value), encoding: 'utf8', timeout: 10_000, env,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('hook schema rejects malformed, unsupported, oversized and wrongly typed fields', () => {
  const root = resolve('.');
  for (const value of ['{', 'null', '[]', 'true', '{}']) assert.throws(() => parseCodexHook(Buffer.from(value)));
  for (const overrides of [{ hook_event_name: 'PostToolUse' }, { session_id: null }, { session_id: '../path' },
    { cwd: 'relative' }, { turn_id: 12 }, { stop_hook_active: 'false' }, { last_assistant_message: {} },
    { extra: 'unrecognized' }, { transcript_path: {} }, { model: [] }, { permission_mode: false }]) {
    assert.throws(() => input(root, overrides));
  }
  assert.throws(() => parseCodexHook(Buffer.alloc(MAX_HOOK_INPUT_BYTES + 1)));
  assert.throws(() => parseCodexHook(Buffer.from([0xff])));
  assert.equal(parseCodexHook(Buffer.from(JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'session', cwd: root, source: 'startup' }))).source, 'startup');
  assert.throws(() => parseCodexHook(Buffer.from(JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'session', cwd: root, source: 'unknown' }))));
});

test('missing identifiers, absent optional data, continuations and vague prose capture nothing', () => {
  const root = resolve('.');
  for (const overrides of [{ turn_id: null }, { turn_id: undefined }, { stop_hook_active: null },
    { stop_hook_active: undefined }, { stop_hook_active: true }, { last_assistant_message: null },
    { last_assistant_message: undefined }, { last_assistant_message: 'All done. Use a database next.' }]) {
    assert.deepEqual(extractCodexMemory(input(root, overrides)), []);
  }
  const start = parseCodexHook(Buffer.from(JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'session', cwd: root, source: 'compact' })));
  assert.deepEqual(extractCodexMemory(start), []);
});

test('labeled extraction preserves language and produces only unverified typed claims', () => {
  const entries = ['decision', 'task-completed', 'task-pending', 'blocker', 'next-step', 'project-metadata']
    .map((kind) => ({ kind, text: 'Keep user text: 你好 è\nSecond line' }));
  const events = extractCodexMemory(input(resolve('.'), { last_assistant_message: block(entries) }));
  assert.deepEqual(events.map((event) => event.type), ['decision', 'task', 'task', 'blocker', 'note', 'note']);
  for (const event of events) {
    assert.ok(event.content.endsWith(entries[0].text));
    assert.equal(event.verification, 'unverified');
    assert.equal(event.source.kind, 'agent-reported');
    assert.ok(!event.source.reference?.includes('session-1'));
  }
});

test('malformed structured blocks and sensitive data reject the entire block before writing', async (t) => {
  const f = await fixture(t);
  for (const message of ['```contextbridge-memory\n{\n```', block() + '\n' + block(),
    block(Array(9).fill({ kind: 'decision', text: 'Too many' })),
    block([{ kind: 'fact', text: 'Unsupported' }]), block([{ kind: 'decision', text: ' ' }]),
    block([{ kind: 'decision', text: 'Safe' }, { kind: 'blocker', text: 'password=private-value' }]),
    block([{ kind: 'decision', text: 'x'.repeat(8193) }])]) {
    await assert.rejects(captureCodexMemory(f.root, input(f.root, { last_assistant_message: message })));
    assert.deepEqual((await listMemory(f.root)).events, []);
  }
});

test('stable delivery IDs deduplicate replay and reject changed claims without extra state', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await captureCodexMemory(f.root, input(f.root)), { captured: 1, duplicate: 0, excluded: 0, recovered: 0 });
  assert.deepEqual(await captureCodexMemory(f.root, input(f.root)), { captured: 0, duplicate: 1, excluded: 0, recovered: 0 });
  await assert.rejects(captureCodexMemory(f.root, input(f.root, { last_assistant_message: block([{ kind: 'decision', text: 'Changed claim' }]) })), /Conflicting/);
  await captureCodexMemory(f.root, input(f.root, { turn_id: 'turn-2' }));
  assert.equal((await listMemory(f.root)).events.length, 2);
});

test('capture tolerates interruption after one event and recovers valid unterminated events', async (t) => {
  const f = await fixture(t);
  const source = input(f.root, { last_assistant_message: block([{ kind: 'decision', text: 'First' }, { kind: 'blocker', text: 'Second' }]) });
  const [first] = extractCodexMemory(source);
  await mkdir(join(f.root, '.contextbridge', 'journal'));
  await writeFile(join(f.root, '.contextbridge', 'journal', 'events.jsonl'), JSON.stringify(first));
  assert.deepEqual(await captureCodexMemory(f.root, source), { captured: 1, duplicate: 1, excluded: 0, recovered: 1 });
  assert.equal((await listMemory(f.root)).events.length, 2);
});

test('hook capture preserves journal lock exclusion and concurrent writers never interleave', async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => captureCodexMemory(f.root, input(f.root))));
  assert.ok(results.some((result) => result.status === 'fulfilled'));
  assert.equal((await listMemory(f.root)).events.length, 1);
  await writeFile(join(f.root, '.contextbridge', 'journal', 'writer.lock'), '');
  await assert.rejects(captureCodexMemory(f.root, input(f.root, { turn_id: 'new-turn' })), /writer lock/);
});

test('untrusted transcript paths are never read and outside project cwd is rejected', async (t) => {
  const f = await fixture(t);
  await captureCodexMemory(f.root, input(f.root, { transcript_path: '/nonexistent/arbitrary-transcript' }));
  await assert.rejects(captureCodexMemory(f.root, input(tmpdir())), /project/);
  const subdir = join(f.root, 'nested');
  await mkdir(subdir);
  await captureCodexMemory(f.root, input(subdir, { turn_id: 'nested-turn' }));
  assert.equal((await listMemory(f.root)).events.length, 2);
});

test('installation is explicit, reversible, idempotent and dry-run leaves no hooks or receipt', async (t) => {
  const f = await fixture(t);
  assert.match(await manageHooks(f.root, 'install', true), /Would install/);
  assert.equal((await hooksStatus(f.root)).state, 'not-installed');
  await assert.rejects(readFile(f.config), { code: 'ENOENT' });
  await assert.rejects(readFile(f.receipt), { code: 'ENOENT' });
  await manageHooks(f.root, 'install');
  const installed = await readFile(f.config);
  assert.equal((await hooksStatus(f.root)).state, 'installed');
  assert.match(await manageHooks(f.root, 'install'), /already installed/);
  assert.deepEqual(await readFile(f.config), installed);
  assert.match(await manageHooks(f.root, 'uninstall', true), /Would remove/);
  assert.deepEqual(await readFile(f.config), installed);
  await manageHooks(f.root, 'uninstall');
  await assert.rejects(readFile(f.config), { code: 'ENOENT' });
  assert.match(await manageHooks(f.root, 'uninstall'), /not installed/);
  const missingOptIn = spawnSync(process.execPath, [cliEntry, 'hooks', 'install', '--agent', 'codex', '--project', f.root], { encoding: 'utf8' });
  assert.equal(missingOptIn.status, 1);
  assert.match(missingOptIn.stderr, /explicit opt-in/);
});

test('installation preserves existing JSON hooks and TOML bytes and removal preserves later additions', async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.root, '.codex'));
  const previous = { description: 'User hooks', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo user-owned' }] }] } };
  await writeFile(f.config, JSON.stringify(previous));
  const toml = join(f.root, '.codex', 'config.toml');
  await writeFile(toml, '# User configuration\n[features]\nhooks = true\n');
  const original = await readFile(toml);
  await manageHooks(f.root, 'install');
  const changed = JSON.parse(await readFile(f.config, 'utf8'));
  assert.deepEqual(changed.hooks.Stop[0], previous.hooks.Stop[0]);
  changed.hooks.SessionEnd = [{ hooks: [{ type: 'command', command: 'echo later' }] }];
  await writeFile(f.config, JSON.stringify(changed));
  await manageHooks(f.root, 'uninstall');
  assert.deepEqual(JSON.parse(await readFile(f.config, 'utf8')), { ...previous, hooks: { ...previous.hooks, SessionEnd: changed.hooks.SessionEnd } });
  assert.deepEqual(await readFile(toml), original);
});

test('edited owned hooks, malformed configuration and unowned collisions fail without overwrites', async (t) => {
  const f = await fixture(t);
  await manageHooks(f.root, 'install');
  const changed = JSON.parse(await readFile(f.config, 'utf8'));
  changed.hooks.Stop[0].hooks[0].command = 'echo changed';
  await writeFile(f.config, JSON.stringify(changed));
  const before = await readFile(f.config);
  assert.equal((await hooksStatus(f.root)).state, 'conflict');
  await assert.rejects(manageHooks(f.root, 'install'), /conflict/);
  await assert.rejects(manageHooks(f.root, 'uninstall'), /conflict/);
  assert.deepEqual(await readFile(f.config), before);
  await rm(f.receipt);
  await assert.rejects(manageHooks(f.root, 'install'), /conflict/);
  await writeFile(f.config, '{');
  await assert.rejects(manageHooks(f.root, 'install'), /Invalid/);
  assert.equal(await readFile(f.config, 'utf8'), '{');
});

test('pending installation and removal can be resumed safely after publication interruptions', async (t) => {
  const f = await fixture(t);
  await manageHooks(f.root, 'install');
  const saved = JSON.parse(await readFile(f.receipt, 'utf8'));
  await rm(f.config);
  assert.equal((await hooksStatus(f.root)).state, 'pending');
  await manageHooks(f.root, 'install');
  assert.equal((await hooksStatus(f.root)).state, 'installed');
  await writeFile(f.receipt, JSON.stringify({ ...saved, removalHash: null }));
  await rm(f.config);
  assert.equal((await hooksStatus(f.root)).state, 'removal-pending');
  await manageHooks(f.root, 'uninstall');
  assert.equal((await hooksStatus(f.root)).state, 'not-installed');
});

test('hook configuration rejects linked paths and oversized documents', async (t) => {
  const f = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'contextbridge-hooks-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(f.root, '.codex'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(manageHooks(f.root, 'install'), /Unsafe/);
  await rm(join(f.root, '.codex'));
  await mkdir(join(f.root, '.codex'));
  await writeFile(f.config, ' '.repeat(262_145));
  await assert.rejects(manageHooks(f.root, 'install'), /size limit/);
});

test('runner requires installation, never continues Codex and refuses recursive capture', async (t) => {
  const f = await fixture(t);
  assert.match(runHook(f.root, payload(f.root)).systemMessage, /skipped/);
  await manageHooks(f.root, 'install');
  assert.match(runHook(f.root, payload(f.root)).systemMessage, /1 captured/);
  assert.match(runHook(f.root, payload(f.root)).systemMessage, /1 duplicate/);
  assert.equal((await listMemory(f.root)).events.length, 1);
  assert.deepEqual(runHook(f.root, { hook_event_name: 'SessionStart', session_id: 'session-1', cwd: f.root, source: 'startup', transcript_path: null }), {});
  assert.deepEqual(runHook(f.root, payload(f.root, { turn_id: 'recursive' }), { ...process.env, CONTEXTBRIDGE_HOOK_ACTIVE: '1' }), {});
  assert.equal((await listMemory(f.root)).events.length, 1);
  assert.match(runHook(f.root, '{').systemMessage, /skipped/);
  assert.match(runHook(f.root, ' '.repeat(MAX_HOOK_INPUT_BYTES + 1)).systemMessage, /skipped/);
  await manageHooks(f.root, 'uninstall');
  assert.match(runHook(f.root, payload(f.root, { turn_id: 'disabled' })).systemMessage, /skipped/);
});

test('watchdog terminates stalled stdin within a bounded interval with advisory JSON', async (t) => {
  const f = await fixture(t);
  const start = Date.now();
  const child = spawn(process.execPath, [hookEntry, '--project', f.root], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { child.kill('SIGKILL'); });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 0);
  assert.match(JSON.parse(stdout).systemMessage, /timed out/);
  assert.ok(Date.now() - start < 9000);
  assert.deepEqual((await listMemory(f.root)).events, []);
});

test('compatibility probe requires the checked version and an enabled stable hooks feature', (t) => {
  let version = 'codex-cli 0.166.0';
  let features = 'hooks stable true';
  t.mock.method(childProcess, 'spawnSync', (_exe, args) => ({ status: 0, stdout: args[0] === '--version' ? version : features }));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.equal(codexHookCompatibility().supported, true);
  features = 'hooks stable false';
  assert.equal(codexHookCompatibility().supported, false);
  version = 'codex-cli 0.165.0';
  assert.equal(codexHookCompatibility().supported, false);
  version = 'codex-cli 0.999.0';
  assert.equal(codexHookCompatibility().supported, false);
});

test('hook commands quote installation paths and reject Windows expansions on every platform', async (t) => {
  assert.equal(quoteHookArgument("a'b"), "'a'\\''b'");
  assert.equal(quoteHookArgument('C:\\Program Files\\node', true), '"C:\\Program Files\\node"');
  for (const path of ['a%VAR%', 'a!b', 'a$b', 'a&b', 'a"b', 'a\nb']) assert.throws(() => quoteHookArgument(path, true));
  const f = await fixture(t);
  await manageHooks(f.root, 'install');
  const groups = hookGroups(f.root) as Record<string, { hooks: { command: string; timeout: number }[] }>;
  assert.ok(groups.Stop.hooks[0].command.includes('contextbridge-hook.mjs'));
  if (process.platform !== 'win32') {
    const result = spawnSync('/bin/sh', ['-c', groups.Stop.hooks[0].command], { input: JSON.stringify(payload(f.root)), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(JSON.parse(result.stdout).systemMessage, /1 captured/);
    assert.equal((await listMemory(f.root)).events.length, 1);
  }
});


test('installed POSIX hook paths preserve spaces and shell metacharacters literally', async (t) => {
  const f = await fixture(t);
  const root = join(f.root, "space ' ; $ literal");
  if (process.platform === 'win32') {
    assert.throws(() => hookGroups(root), /safely quoted/);
    return;
  }
  await initProject(root, 'codex');
  await manageHooks(root, 'install');
  const groups = hookGroups(root) as Record<string, { hooks: { command: string }[] }>;
  const result = spawnSync('/bin/sh', ['-c', groups.Stop.hooks[0].command], { input: JSON.stringify(payload(root)), encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).systemMessage, /1 captured/);
  assert.equal((await listMemory(root)).events.length, 1);
});
