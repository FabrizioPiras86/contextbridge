import { count, object, onlyKeys, timestamp } from '../telemetry/model.ts';

export const MAX_ACQUISITIONS = 64;
export const terminalTurns = new Set(['turn-completed', 'turn-failed', 'turn-interrupted']);
export interface LifecycleRecord {
  schemaVersion: 1;
  acquisitionId: string;
  threadId?: string;
  turnId?: string;
  sequence: number;
  receiptAt: string;
  connection: 'connected' | 'disconnected' | 'stopped';
  turn: 'initializing' | 'ready' | 'turn-pending' | 'turn-running' | 'turn-completed' | 'turn-failed' | 'turn-interrupted' | 'unknown-outcome';
  provenance: { transport: 'managed-stdio-mock'; origin: 'unverified'; ordering: 'local-receive'; timestamp: 'client-receipt' };
  terminalEvidence: 'none' | 'turn/completed';
}
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function validateLifecycle(value: unknown): asserts value is LifecycleRecord {
  if (!object(value) || !onlyKeys(value, ['schemaVersion', 'acquisitionId', 'threadId', 'turnId', 'sequence', 'receiptAt', 'connection', 'turn', 'terminalEvidence', 'provenance']) ||
      Buffer.byteLength(JSON.stringify(value)) > 1024 || value.schemaVersion !== 1 || !hash(value.acquisitionId) ||
      (value.threadId !== undefined && !hash(value.threadId)) || (value.turnId !== undefined && (!hash(value.turnId) || !value.threadId)) ||
      !count(value.sequence) || value.sequence === 0 || !timestamp(value.receiptAt) || !/^[0-9]{4}-/.test(value.receiptAt) ||
      !['connected', 'disconnected', 'stopped'].includes(value.connection as string) ||
      !['initializing', 'ready', 'turn-pending', 'turn-running', 'turn-completed', 'turn-failed', 'turn-interrupted', 'unknown-outcome'].includes(value.turn as string) ||
      !object(value.provenance) || !onlyKeys(value.provenance, ['transport', 'origin', 'ordering', 'timestamp']) ||
      value.provenance.transport !== 'managed-stdio-mock' || value.provenance.origin !== 'unverified' ||
      value.provenance.ordering !== 'local-receive' || value.provenance.timestamp !== 'client-receipt' ||
      value.terminalEvidence !== (terminalTurns.has(value.turn as string) ? 'turn/completed' : 'none') ||
      (value.turn !== 'initializing' && value.turn !== 'unknown-outcome' && !value.threadId) ||
      ((value.turn === 'turn-running' || terminalTurns.has(value.turn as string)) && !value.turnId) ||
      ((value.turn === 'initializing' || value.turn === 'ready') && value.turnId !== undefined)) {
    throw new Error('Invalid managed lifecycle record.');
  }
}
export function validateTransition(previous: LifecycleRecord | undefined, next: LifecycleRecord): void {
  validateLifecycle(next);
  if (!previous) {
    if (next.connection !== 'connected' || next.sequence !== 1 || next.turn !== 'initializing' || next.threadId || next.turnId) throw new Error('Invalid lifecycle acquisition.');
    return;
  }
  const allowed: Record<LifecycleRecord['turn'], string[]> = {
    initializing: ['initializing', 'ready', 'unknown-outcome'], ready: ['ready', 'turn-pending'],
    'turn-pending': ['turn-pending', 'turn-running', 'turn-completed', 'turn-failed', 'turn-interrupted', 'unknown-outcome'],
    'turn-running': ['turn-running', 'turn-completed', 'turn-failed', 'turn-interrupted', 'unknown-outcome'],
    'unknown-outcome': ['unknown-outcome', 'turn-completed', 'turn-failed', 'turn-interrupted'],
    'turn-completed': ['turn-completed'], 'turn-failed': ['turn-failed'], 'turn-interrupted': ['turn-interrupted'],
  };
  if (next.sequence !== previous.sequence + 1 || next.receiptAt < previous.receiptAt ||
      (previous.threadId && previous.threadId !== next.threadId) || (previous.turnId && previous.turnId !== next.turnId) ||
      !allowed[previous.turn].includes(next.turn) ||
      (previous.connection !== 'connected' && next.connection === 'connected')) throw new Error('Conflicting managed lifecycle transition.');
}
// Read-only historical projection. Saved connectivity never establishes process liveness.
export function historicalLifecycle(record: LifecycleRecord) {
  return { ...record, historical: true, currentConnection: 'unconfirmed',
    outcome: terminalTurns.has(record.turn) ? record.turn : 'unconfirmed', automaticAction: 'none' };
}
