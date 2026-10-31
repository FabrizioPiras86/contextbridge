import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../src/config.ts';
import { createCheckpoint, verifyLatest } from '../src/snapshot.ts';

test('checkpoint is saved, verified, and rendered as handoff', async () => {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-snapshot-'));
  try {
    await initProject(root, 'both');
    const snapshot = await createCheckpoint(root, {
      objective: 'Implement user authentication',
      nextStep: 'Run the authentication tests',
      decisions: ['Use a stateless authentication flow'],
    });
    assert.equal((await verifyLatest(root)).id, snapshot.id);
    const handoff = await readFile(join(root, '.contextbridge', 'HANDOFF.md'), 'utf8');
    assert.match(handoff, /Implement user authentication/);
    assert.match(handoff, /not preserved/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('tampering with checkpoint content is detected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-tamper-'));
  try {
    await initProject(root, 'both');
    const snapshot = await createCheckpoint(root, {
      objective: 'Original goal', nextStep: 'Write tests',
    });
    const filename = join(root, '.contextbridge', 'snapshots', `${snapshot.id}.json`);
    const raw = JSON.parse(await readFile(filename, 'utf8'));
    raw.work.objective = 'Tampered goal';
    await writeFile(filename, JSON.stringify(raw));
    await assert.rejects(() => verifyLatest(root), /integrity check failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('checkpoint requires explicit objective and next step', async () => {
  const root = await mkdtemp(join(tmpdir(), 'contextbridge-empty-'));
  try {
    await initProject(root, 'both');
    await assert.rejects(() => createCheckpoint(root, { objective: ' ', nextStep: ' ' }), /required/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
