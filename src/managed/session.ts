import { isUtf8 } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { identity, object } from '../telemetry/model.ts';
import type { TelemetryObservation } from '../telemetry/model.ts';
import { parseCodexTokenUsage } from '../telemetry/codex.ts';
import { ingestTelemetry } from '../telemetry/store.ts';
import { terminalTurns } from './lifecycle.ts';
import type { LifecycleRecord } from './lifecycle.ts';
import { ManagedTransport } from './transport.ts';

export type CaptureState = 'initializing' | 'ready' | 'turn-pending' | 'turn-running' | 'turn-completed' |
  'turn-failed' | 'turn-interrupted' | 'disconnected' | 'stopped' | 'unknown-outcome';
// Conservative public notification subset; new methods require explicit review.
const discardedNotifications = new Set([
  'thread/started', 'thread/status/changed', 'item/started', 'item/completed',
  'item/agentMessage/delta', 'item/reasoning/summaryTextDelta', 'item/reasoning/summaryPartAdded',
  'item/reasoning/textDelta', 'turn/diff/updated', 'turn/plan/updated', 'error', 'warning',
]);
const terminal = terminalTurns;

// Mock-only foundation. No production process factory is connected to this class.
export class ManagedCapture {
  readonly acquisitionId = randomUUID();
  #state: CaptureState = 'initializing';
  #thread?: string;
  #turn?: string;
  #sequence = 0;
  #used = false;
  #submitted = false;
  #observation?: TelemetryObservation;
  #connection: 'connected' | 'disconnected' | 'stopped' = 'connected';
  #outcome: NonNullable<TelemetryObservation['managed']>['turn'] = 'ready';
  get state(): CaptureState { return this.#state; }
  private transport: ManagedTransport;
  #root: string;
  #writes: Promise<void> = Promise.resolve();
  #writeFailure = false;
  #queued = 0;
  #recording = false;
  constructor(transport: ManagedTransport, root: string) {
    this.#root = root;
    this.transport = transport;
    transport.onNotification = (message) => this.#notification(message);
    transport.onDisconnect = () => {
      if (this.#state === 'stopped') return;
      this.#connection = 'disconnected';
      if (this.#state === 'turn-pending' || this.#state === 'turn-running' || this.#state === 'unknown-outcome') {
        this.#state = 'unknown-outcome'; this.#outcome = 'unknown-outcome';
      } else this.#state = 'disconnected';
      this.#refresh();
    };
  }
  async initialize(authorized: boolean, cwd: string): Promise<void> {
    if (authorized !== true || this.#state !== 'initializing' || this.#recording) throw new Error('Managed initialization requires explicit authorization.');
    this.#recording = true;
    try {
      this.#refresh(); await this.flush();
      const result = await this.transport.request('initialize', { clientInfo: { name: 'contextbridge', version: '0.0.1' }, capabilities: { experimentalApi: false } });
      if (!object(result) || typeof result.userAgent !== 'string' || typeof result.codexHome !== 'string' || typeof result.platformFamily !== 'string' || typeof result.platformOs !== 'string') throw new Error('Managed initialization contract failed.');
      this.transport.notifyInitialized();
      const thread = await this.transport.request('thread/start', { cwd, ephemeral: true, approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'read-only' });
      if (!object(thread) || !object(thread.thread) || typeof thread.thread.id !== 'string' || thread.cwd !== cwd ||
          thread.thread.ephemeral !== true || thread.approvalsReviewer !== 'user' || thread.approvalPolicy !== 'never' || !object(thread.sandbox) || thread.sandbox.type !== 'readOnly' || thread.sandbox.networkAccess !== false) {
        throw new Error('Managed effective policy check failed.');
      }
      identity(thread.thread.id); this.#thread = thread.thread.id;
      if (this.#connection !== 'connected') throw new Error('Managed connection unavailable.');
      this.#state = 'ready';
      this.#refresh(); await this.flush();
    } catch { await this.transport.stop(); await this.#writes; throw new Error('Managed initialization failed.'); }
  }
  async sendOneTurn(prompt: Buffer, authorized: boolean): Promise<void> {
    if (authorized !== true || this.#used || this.#state !== 'ready') throw new Error('Separate single-turn authorization is required.');
    // Buffer input is required so callers can read bounded stdin, never process arguments.
    if (!Buffer.isBuffer(prompt) || !prompt.length || prompt.length > 8_192 || !isUtf8(prompt)) throw new Error('Invalid managed prompt.');
    this.#used = true; this.#state = 'turn-pending'; this.#outcome = 'turn-pending';
    try {
      this.#refresh(); await this.flush();
      if (this.#connection !== 'connected') throw new Error('Managed connection unavailable.');
      this.#submitted = true;
      const result = await this.transport.startTurn({ threadId: this.#thread, input: [{ type: 'text', text: prompt.toString('utf8'), text_elements: [] }] }, true);
      if (!object(result) || !object(result.turn) || typeof result.turn.id !== 'string') throw new Error('Invalid managed turn response.');
      identity(result.turn.id);
      if (this.#turn && this.#turn !== result.turn.id) throw new Error('Conflicting managed turn identity.');
      this.#turn = result.turn.id;
      this.#refresh(); await this.flush();
    } catch {
      if (!terminal.has(this.#state)) { this.#state = 'unknown-outcome'; this.#outcome = 'unknown-outcome'; }
      this.#refresh(); await this.transport.stop(); await this.#writes;
      throw new Error('Managed turn outcome requires inspection.');
    }
  }
  #notification(message: Record<string, unknown>): void {
    const p = message.params;
    if (!object(p)) throw new Error('Invalid managed notification.');
    if (message.method === 'thread/tokenUsage/updated' || message.method === 'turn/started' || message.method === 'turn/completed') {
      if (!this.#thread || p.threadId !== this.#thread) return;
      if (!this.#submitted) throw new Error('Unsolicited managed turn.');
      const turn = message.method === 'thread/tokenUsage/updated' ? p.turnId : object(p.turn) ? p.turn.id : undefined;
      identity(turn);
      if (this.#turn && turn !== this.#turn) throw new Error('Foreign managed turn.');
      this.#turn = turn as string;
      if (message.method === 'thread/tokenUsage/updated') {
        if (terminal.has(this.#outcome)) return;
        this.#observation = parseCodexTokenUsage(Buffer.from(JSON.stringify(message)), { sourceVersion: '0.166.0', sessionId: this.acquisitionId, observedAt: new Date().toISOString(), sequence: this.#sequence + 1 });
        this.#observation.schemaVersion = 2;
        this.#observation.provenance = { ...this.#observation.provenance, transport: 'managed-stdio-mock', timestamp: 'client-receipt', ordering: 'local-receive' };
      } else if (message.method === 'turn/started') {
        if (terminal.has(this.#outcome)) return;
        if (!object(p.turn) || p.turn.status !== 'inProgress') throw new Error('Invalid managed turn status.');
        this.#state = 'turn-running'; this.#outcome = 'turn-running';
      } else {
        if (!object(p.turn)) throw new Error('Invalid managed turn status.');
        const state = ({ completed: 'turn-completed', failed: 'turn-failed', interrupted: 'turn-interrupted' } as const)[p.turn.status as string];
        if (!state) throw new Error('Invalid managed turn status.');
        if (terminal.has(this.#outcome)) { if (state !== this.#outcome) throw new Error('Conflicting terminal state.'); return; }
        this.#state = state; this.#outcome = state;
      }
      this.#refresh(); return;
    }
    // Content-bearing notifications are discarded synchronously, never retained.
    if (typeof message.method !== 'string' || !discardedNotifications.has(message.method)) throw new Error('Unsupported managed notification.');
  }
  #refresh(): void {
    if (!this.#recording || this.#writeFailure) return;
    const sequence = ++this.#sequence;
    const receiptAt = new Date().toISOString();
    if (this.#observation) {
      this.#observation.sequence = sequence;
      this.#observation.managed = { connection: this.#connection, turn: this.#outcome,
        completeness: terminal.has(this.#outcome) ? 'complete' : 'partial', receiptAt };
    }
    const turn = !this.#thread ? 'initializing' : this.#outcome;
    const lifecycle: LifecycleRecord = {
      schemaVersion: 1, acquisitionId: identity(this.acquisitionId),
      ...(this.#thread ? { threadId: identity(this.#thread) } : {}),
      ...(this.#turn ? { turnId: identity(this.#turn) } : {}),
      sequence, receiptAt, connection: this.#connection, turn,
      provenance: { transport: 'managed-stdio-mock', origin: 'unverified', ordering: 'local-receive', timestamp: 'client-receipt' },
      terminalEvidence: terminalTurns.has(turn) ? 'turn/completed' : 'none',
    };
    if (this.#queued >= 32) { this.#writeFailure = true; void this.transport.stop(); return; }
    const observation = this.observation();
    this.#queued++;
    this.#writes = this.#writes.then(async () => {
      if (this.#writeFailure) return;
      try { await ingestTelemetry(this.#root, observation, true, Date.now(), lifecycle); }
      catch { this.#writeFailure = true; void this.transport.stop(); }
    }).finally(() => { this.#queued--; });
  }
  async flush(): Promise<void> {
    // Notification callbacks may append while an earlier snapshot is publishing.
    let writes: Promise<void>;
    do { writes = this.#writes; await writes; } while (writes !== this.#writes);
    if (this.#writeFailure) throw new Error('Managed persistence failed; inspect committed storage. No retry is authorized.');
  }
  observation(): TelemetryObservation | undefined {
    return this.#observation ? structuredClone(this.#observation) : undefined;
  }
  async persist(root: string, authorized: boolean): Promise<void> {
    if (root !== this.#root || authorized !== true) throw new Error('Managed persistence requires the authorized acquisition store.');
    await this.flush();
  }

  async interrupt(): Promise<void> {
    if (this.#state !== 'turn-running' || !this.#turn) throw new Error('No confirmed managed turn to interrupt.');
    try { await this.transport.request('turn/interrupt', { threadId: this.#thread, turnId: this.#turn }); }
    catch { await this.transport.stop(); }
    // An acknowledgment is not confirmation of interruption; await turn/completed.
  }
  async stop(): Promise<void> {
    if (this.#state === 'stopped') { await this.flush(); return; }
    if (this.#state === 'turn-pending' || this.#state === 'turn-running') this.#outcome = 'unknown-outcome';
    this.#state = 'stopped'; this.#connection = 'stopped'; this.#refresh();
    await this.transport.stop();
    await this.flush();
  }
}
