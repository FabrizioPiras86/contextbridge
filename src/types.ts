import type { MemoryEvent } from './memory.ts';

export type Agent = 'claude' | 'codex' | 'both';
export type Mode = 'assisted' | 'auto';

export interface Config {
  schemaVersion: 1;
  agent: Agent;
  mode: Mode;
  thresholds: { warning: number; handoff: number; safety: number };
  privacy: { captureSourceContent: false; telemetry: false };
}

export interface SnapshotPayload {
  memory?: { events: MemoryEvent[]; omitted: number; incompleteTail: boolean };
  schemaVersion: 1;
  id: string;
  createdAt: string;
  project: {
    name: string;
    branch: string | null;
    commit: string | null;
    dirty: boolean | null;
    changedFiles: string[];
    filesTruncated: boolean;
  };
  work: {
    objective: string;
    nextStep: string;
    decisions: string[];
    knownLimitations: string[];
  };
  provenance: {
    workFields: 'user-supplied';
    gitFields: 'git-cli' | 'unavailable';
    conversationHistoryCaptured: false;
  };
}

export type Snapshot = SnapshotPayload & { digest: string };
export interface State {
  schemaVersion: 1;
  latestSnapshotId: string;
  updatedAt: string;
}
