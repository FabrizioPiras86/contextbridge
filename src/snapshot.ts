import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { loadConfig } from './config.ts';
import { getGitInfo } from './git.ts';
import { renderHandoff } from './handoff.ts';
import { digestOf, readJson, storeDir, writeAtomic, writeJsonAtomic } from './storage.ts';
import type { Snapshot, SnapshotPayload, State } from './types.ts';

export interface CheckpointInput {
  objective: string;
  nextStep: string;
  decisions?: string[];
}

function snapshotName(): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return `cb_${timestamp}_${randomBytes(5).toString('hex')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validatePayload(snapshot: Snapshot): void {
  const { project, work, provenance } = snapshot;
  const strings = (value: unknown): boolean => Array.isArray(value) && value.every((item) => typeof item === 'string');
  if (typeof snapshot.createdAt !== 'string' || !Number.isFinite(Date.parse(snapshot.createdAt)) ||
      !isRecord(project) || typeof project.name !== 'string' ||
      !(project.branch === null || typeof project.branch === 'string') ||
      !(project.commit === null || typeof project.commit === 'string') ||
      !(project.dirty === null || typeof project.dirty === 'boolean') ||
      !strings(project.changedFiles) || typeof project.filesTruncated !== 'boolean' ||
      !isRecord(work) || typeof work.objective !== 'string' || !work.objective.trim() ||
      typeof work.nextStep !== 'string' || !work.nextStep.trim() ||
      !strings(work.decisions) || !strings(work.knownLimitations) ||
      !isRecord(provenance) || provenance.workFields !== 'user-supplied' ||
      !['git-cli', 'unavailable'].includes(provenance.gitFields as string) ||
      provenance.conversationHistoryCaptured !== false) {
    throw new Error('Invalid snapshot data. Create a new checkpoint with the supported schema.');
  }
}

export async function createCheckpoint(root: string, input: CheckpointInput): Promise<Snapshot> {
  await loadConfig(root);
  if (!input.objective.trim() || !input.nextStep.trim()) {
    throw new Error('A non-empty objective and next step are required.');
  }
  const git = getGitInfo(root);
  const payload: SnapshotPayload = {
    schemaVersion: 1,
    id: snapshotName(),
    createdAt: new Date().toISOString(),
    project: {
      name: git.name,
      branch: git.branch,
      commit: git.commit,
      dirty: git.dirty,
      changedFiles: git.changedFiles,
      filesTruncated: git.filesTruncated,
    },
    work: {
      objective: input.objective.trim(),
      nextStep: input.nextStep.trim(),
      decisions: input.decisions ?? [],
      knownLimitations: [
        'Conversation history is not captured.',
        'The starter does not automatically confirm completed tasks or test results.',
      ],
    },
    provenance: {
      workFields: 'user-supplied',
      gitFields: git.available ? 'git-cli' : 'unavailable',
      conversationHistoryCaptured: false,
    },
  };
  const snapshot: Snapshot = { ...payload, digest: digestOf(payload) };
  const dir = storeDir(root);
  // Commit the pointer last. An interrupted write never advertises an incomplete snapshot.
  await writeJsonAtomic(join(dir, 'snapshots', `${snapshot.id}.json`), snapshot);
  await writeAtomic(join(dir, 'HANDOFF.md'), renderHandoff(payload));
  const state: State = {
    schemaVersion: 1, latestSnapshotId: snapshot.id, updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(join(dir, 'state.json'), state);
  return snapshot;
}

export async function verifyLatest(root: string): Promise<Snapshot> {
  await loadConfig(root);
  const dir = storeDir(root);
  const state = await readJson<State>(join(dir, 'state.json'));
  if (!isRecord(state) || state.schemaVersion !== 1 || typeof state.latestSnapshotId !== 'string' ||
      !/^cb_[a-zA-Z0-9_]+$/.test(state.latestSnapshotId)) {
    throw new Error('Invalid snapshot pointer.');
  }
  const snapshot = await readJson<Snapshot>(join(dir, 'snapshots', `${state.latestSnapshotId}.json`));
  if (!isRecord(snapshot) || snapshot.schemaVersion !== 1 || snapshot.id !== state.latestSnapshotId) {
    throw new Error('Snapshot identity or schema mismatch.');
  }
  if (typeof snapshot.digest !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.digest)) throw new Error('Invalid snapshot digest.');
  const { digest, ...payload } = snapshot;
  if (digestOf(payload) !== digest) throw new Error('Snapshot integrity check failed.');
  validatePayload(snapshot);
  return snapshot;
}
