import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../src/config.ts';
import { appendMemory, createMemoryEvent, listMemory, MAX_EVENT_BYTES, selectCheckpointMemory, validateMemoryEvent, validateMemoryPath } from '../src/memory.ts';
import { createCheckpoint, verifyLatest } from '../src/snapshot.ts';
import { renderSessionPrompt } from '../src/handoff.ts';
import { digestOf } from '../src/storage.ts';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-memory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initProject(root, 'both');
  return { root, path: join(root, '.contextbridge', 'journal', 'events.jsonl'), dir: join(root, '.contextbridge', 'journal') };
}
function event(content = 'Use MySQL') {
  return createMemoryEvent({ type: 'decision', content, source: { kind: 'user-supplied' }, relatedFiles: ['src/database.ts'] });
}

test('memory creates unique events and preserves append order, bytes, language and provenance', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await listMemory(f.root), { events: [], incompleteTail: false });
  const first = event('Keep the user text: \u4f60\u597d\n\u00e8');
  const second = createMemoryEvent({ type: 'task', content: 'Review database choice', source: { kind: 'agent-reported', reference: 'Manual import from an agent report' } });
  second.timestamp = '2020-01-01T00:00:00.000Z';
  assert.notEqual(first.id, second.id);
  await appendMemory(f.root, first);
  const prefix = await readFile(f.path);
  await appendMemory(f.root, second);
  assert.deepEqual((await readFile(f.path)).subarray(0, prefix.length), prefix);
  assert.deepEqual((await listMemory(f.root)).events, [first, second]);
  if (process.platform !== 'win32') assert.equal((await stat(f.path)).mode & 0o777, 0o600);
});

test('validation rejects invalid schemas, types, provenance and excessive UTF-8 size without writing', async (t) => {
  const f = await fixture(t);
  for (const invalid of [null, {}, { ...event(), type: 'fact' }, { ...event(), schemaVersion: 2 },
    { ...event(), verification: 'verified' }, { ...event(), source: { kind: 'test-verified' } },
    { ...event(), source: { kind: 'user-supplied', extra: 'hidden data' } },
    { ...event(), unexpected: 'hidden data' }, { ...event(), timestamp: 'yesterday' },
    { ...event(), content: '\u00e9'.repeat(4097) }, { ...event(), content: ' ' }, { ...event(), relatedFiles: [42] },
    { ...event(), relatedFiles: Array(33).fill('src/file.ts') }]) {
    assert.throws(() => validateMemoryEvent(invalid));
    await assert.rejects(appendMemory(f.root, invalid as ReturnType<typeof event>));
  }
  assert.deepEqual((await listMemory(f.root)).events, []);
});

test('portable paths reject traversal, absolute paths, Windows aliases and sensitive files on every OS', () => {
  for (const path of ['../outside', '/etc/passwd', 'a/../b', 'a/./b', 'a//b', 'C:/file', 'C:\\file', '\\\\host\\share',
    'a\\..\\b', 'file:stream', 'NUL', 'src/COM1.txt', 'file.', 'file ', 'bad\0path', 'a?b',
    '.env', '.env.local', 'config/credentials.json', '.ssh/config', 'cert.pem', '.aws/config', '']) {
    assert.throws(() => validateMemoryPath(path), /Unsafe/);
  }
  for (const path of ['src/main.ts', 'docs/design notes.md', 'src/\u00e9.ts']) assert.doesNotThrow(() => validateMemoryPath(path));
});

test('privacy rejects common secrets in content and provenance without echoing them', async (t) => {
  const f = await fixture(t);
  for (const secret of ['password=hunter2', 'api_key: private-value', 'ghp_' + 'a'.repeat(30),
    'sk-' + 'x'.repeat(30), 'AKIA' + 'A'.repeat(16), '-----BEGIN RSA PRIVATE KEY-----', 'https://user:pass@example.com']) {
    for (const input of [{ ...event(), content: secret }, { ...event(), source: { kind: 'user-supplied', reference: secret } }]) {
      await assert.rejects(appendMemory(f.root, input as ReturnType<typeof event>), (error: Error) => {
        assert.match(error.message, /Potential secret/);
        assert.ok(!error.message.includes(secret));
        return true;
      });
    }
  }
  assert.deepEqual((await listMemory(f.root)).events, []);
});

test('duplicates and malformed complete records fail closed without changing the journal', async (t) => {
  const f = await fixture(t);
  const first = event();
  await appendMemory(f.root, first);
  const original = await readFile(f.path);
  await assert.rejects(appendMemory(f.root, first), /Duplicate/);
  assert.deepEqual(await readFile(f.path), original);
  for (const suffix of [JSON.stringify(first) + '\n', '{broken}\n', 'null\n', JSON.stringify({ ...event(), type: 'fact' }) + '\n', 'x'.repeat(MAX_EVENT_BYTES + 1) + '\n']) {
    await writeFile(f.path, Buffer.concat([original, Buffer.from(suffix)]));
    const corrupt = await readFile(f.path);
    await assert.rejects(listMemory(f.root));
    await assert.rejects(appendMemory(f.root, event()));
    assert.deepEqual(await readFile(f.path), corrupt);
  }
});

test('interrupted tails recover across repeated writes without rewriting any journal bytes', async (t) => {
  const f = await fixture(t);
  const first = event();
  await appendMemory(f.root, first);
  for (const tail of ['{"schemaVersion":', JSON.stringify(event('Uncommitted complete JSON')), '{another partial']) {
    await appendFile(f.path, tail);
    const before = await readFile(f.path);
    assert.equal((await listMemory(f.root)).incompleteTail, true);
    const next = event('Continue after interruption');
    await appendMemory(f.root, next);
    assert.deepEqual((await readFile(f.path)).subarray(0, before.length), before);
    const result = await listMemory(f.root);
    assert.equal(result.incompleteTail, false);
    assert.deepEqual(result.events.at(-1), next);
  }
  assert.equal((await listMemory(f.root)).events.length, 4);
});

test('writer lock fails safely after a simulated process crash and supports operator recovery', async (t) => {
  const f = await fixture(t);
  await appendMemory(f.root, event());
  const before = await readFile(f.path);
  await writeFile(join(f.dir, 'writer.lock'), '');
  await assert.rejects(appendMemory(f.root, event()), /no writer is running/);
  assert.deepEqual(await readFile(f.path), before);
  assert.equal((await listMemory(f.root)).events.length, 1);
  await rm(join(f.dir, 'writer.lock'));
  await appendMemory(f.root, event());
  assert.equal((await listMemory(f.root)).events.length, 2);
});

test('concurrent writers cannot interleave journal records', async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => appendMemory(f.root, event())));
  const successful = results.filter((result) => result.status === 'fulfilled').length;
  assert.ok(successful >= 1);
  assert.equal((await listMemory(f.root)).events.length, successful);
  for (const result of results) if (result.status === 'rejected') assert.match(result.reason.message, /writer lock/);
});

test('storage confinement rejects linked journal directories and files', async (t) => {
  const f = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'contextbridge-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, f.dir, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(appendMemory(f.root, event()), /Unsafe memory storage/);
  await assert.rejects(listMemory(f.root), /Unsafe memory storage/);
  await rm(f.dir);
  await mkdir(f.dir);
  if (process.platform !== 'win32') {
    const target = join(outside, 'data');
    await writeFile(target, 'unchanged');
    await symlink(target, f.path);
    await assert.rejects(appendMemory(f.root, event()), /Unsafe memory storage/);
    assert.equal(await readFile(target, 'utf8'), 'unchanged');
  }
});

test('checkpoint memory is bounded, digest-protected, unverified and backward compatible', async (t) => {
  const f = await fixture(t);
  const old = await createCheckpoint(f.root, { objective: 'Build memory', nextStep: 'Review' });
  assert.equal(old.memory, undefined);
  assert.deepEqual(await verifyLatest(f.root), old);
  const oldPath = join(f.root, '.contextbridge', 'snapshots', `${old.id}.json`);
  const oldBytes = await readFile(oldPath);
  for (let i = 0; i < 24; i++) await appendMemory(f.root, event(`Decision ${i}`));
  const selected = await selectCheckpointMemory(f.root);
  assert.equal(selected.events.length, 20);
  assert.equal(selected.omitted, 4);
  assert.equal(selected.events[0].content, 'Decision 4');
  const snapshot = await createCheckpoint(f.root, { objective: 'Continue', nextStep: 'Validate' });
  assert.deepEqual(snapshot.memory, selected);
  assert.deepEqual(await verifyLatest(f.root), snapshot);
  assert.match(renderSessionPrompt(snapshot), /recorded, unverified claims/);
  assert.match(await readFile(join(f.root, '.contextbridge', 'HANDOFF.md'), 'utf8'), /Recorded Memory \(Unverified\)/);
  assert.deepEqual(await readFile(oldPath), oldBytes);
  const path = join(f.root, '.contextbridge', 'snapshots', `${snapshot.id}.json`);
  const { digest, ...payload } = snapshot;
  const invalid = { ...payload, memory: { ...selected, events: [{ ...selected.events[0], verification: 'verified' }] } };
  await writeFile(path, JSON.stringify({ ...invalid, digest: digestOf(invalid) }));
  await assert.rejects(verifyLatest(f.root), /provenance/);
});

test('checkpoint selection bounds bytes and reports an incomplete journal tail', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 3; i++) await appendMemory(f.root, event('x'.repeat(8000)));
  await appendFile(f.path, '{');
  const selected = await selectCheckpointMemory(f.root);
  assert.equal(selected.events.length, 1);
  assert.equal(selected.omitted, 2);
  assert.equal(selected.incompleteTail, true);
  const snapshot = await createCheckpoint(f.root, { objective: 'Continue', nextStep: 'Review' });
  assert.equal(snapshot.memory?.incompleteTail, true);
});

test('oversized serialized events and invalid UTF-8 are rejected', async (t) => {
  const f = await fixture(t);
  const huge = { ...event('x'.repeat(8000)), relatedFiles: Array(32).fill('a'.repeat(500)) };
  await assert.rejects(appendMemory(f.root, huge), /size limit/);
  await appendMemory(f.root, event());
  await appendFile(f.path, Buffer.concat([Buffer.from('{"content":"'), Buffer.from([0xff]), Buffer.from('"}\n')]));
  await assert.rejects(listMemory(f.root), /UTF-8/);
});

test('recovery marker tampering is detected and interrupted-tail reads do not modify storage', async (t) => {
  const f = await fixture(t);
  await appendMemory(f.root, event());
  const prefix = await readFile(f.path);
  await appendFile(f.path, '{interrupted');
  const interrupted = await readFile(f.path);
  await listMemory(f.root);
  assert.deepEqual(await readFile(f.path), interrupted);
  await appendMemory(f.root, event());
  await writeFile(join(f.dir, 'recovery', `${prefix.length}.json`), JSON.stringify({ offset: prefix.length, digest: 'wrong' }));
  await assert.rejects(listMemory(f.root), /Invalid journal recovery marker/);
  const before = await readFile(f.path);
  await assert.rejects(appendMemory(f.root, event()), /recovery marker/);
  assert.deepEqual(await readFile(f.path), before);
});

test('all event types round-trip and CRLF records remain compatible across hosts', async (t) => {
  const f = await fixture(t);
  await mkdir(f.dir);
  const events = (['decision', 'task', 'blocker', 'note'] as const).map((type) => createMemoryEvent({
    type, content: `Recorded ${type}`, source: { kind: 'user-supplied' },
  }));
  await writeFile(f.path, events.map((item) => JSON.stringify(item) + '\r\n').join(''));
  assert.deepEqual((await listMemory(f.root)).events, events);
  await appendMemory(f.root, event());
  assert.equal((await listMemory(f.root)).events.length, 5);
});
