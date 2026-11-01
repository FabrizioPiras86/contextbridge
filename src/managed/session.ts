import { isUtf8 } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { identity, object } from '../telemetry/model.ts';
import type { TelemetryObservation } from '../telemetry/model.ts';
import { parseCodexTokenUsage } from '../telemetry/codex.ts';
import { ingestTelemetry } from '../telemetry/store.ts';
import { ManagedTransport } from './transport.ts';

export type CaptureState = 'initializing' | 'ready' | 'turn-pending' | 'turn-running' | 'turn-completed' |
  'turn-failed' | 'turn-interrupted' | 'disconnected' | 'stopped' | 'unknown-outcome';
// Conservative public notification subset; new methods require explicit review.
const discardedNotifications = new Set([
  'thread/started', 'thread/status/changed', 'item/started', 'item/completed',
  'item/agentMessage/delta', 'item/reasoning/summaryTextDelta', 'item/reasoning/summaryPartAdded',
  'item/reasoning/textDelta', 'turn/diff/updated', 'turn/plan/updated', 'error', 'warning',
]);
const terminal = new Set(['turn-completed', 'turn-failed', 'turn-interrupted']);

// Mock-only foundation. No production process factory is connected to this class.
export class ManagedCapture {
  readonly acquisitionId = randomUUID();
  #state: CaptureState = 'initializing';
  #thread?: string;
  #turn?: string;
  #sequence = 0;
  #used = false;
  #observation?: TelemetryObservation;
  #connection: 'connected' | 'disconnected' | 'stopped' = 'connected';
  #outcome: NonNullable<TelemetryObservation['managed']>['turn'] = 'ready';
  get state(): CaptureState { return this.#state; }
  private transport: ManagedTransport;
  constructor(transport: ManagedTransport) {
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
    if (authorized !== true || this.#state !== 'initializing') throw new Error('Managed initialization requires explicit authorization.');
    try {
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
    } catch { await this.transport.stop(); throw new Error('Managed initialization failed.'); }
  }
  async sendOneTurn(prompt: Buffer, authorized: boolean): Promise<void> {
    if (authorized !== true || this.#used || this.#state !== 'ready') throw new Error('Separate single-turn authorization is required.');
    // Buffer input is required so callers can read bounded stdin, never process arguments.
    if (!Buffer.isBuffer(prompt) || !prompt.length || prompt.length > 8_192 || !isUtf8(prompt)) throw new Error('Invalid managed prompt.');
    this.#used = true; this.#state = 'turn-pending'; this.#outcome = 'turn-pending';
    try {
      const result = await this.transport.startTurn({ threadId: this.#thread, input: [{ type: 'text', text: prompt.toString('utf8'), text_elements: [] }] }, true);
      if (!object(result) || !object(result.turn) || typeof result.turn.id !== 'string') throw new Error('Invalid managed turn response.');
      identity(result.turn.id);
      if (this.#turn && this.#turn !== result.turn.id) throw new Error('Conflicting managed turn identity.');
      this.#turn = result.turn.id;
    } catch { if (!terminal.has(this.#state)) { this.#state = 'unknown-outcome'; this.#outcome = 'unknown-outcome'; } await this.transport.stop(); throw new Error('Managed turn outcome requires inspection.'); }
  }
  #notification(message: Record<string, unknown>): void {
    const p = message.params;
    if (!object(p)) throw new Error('Invalid managed notification.');
    if (message.method === 'thread/tokenUsage/updated' || message.method === 'turn/started' || message.method === 'turn/completed') {
      if (!this.#thread || p.threadId !== this.#thread) return;
      if (!this.#used) throw new Error('Unsolicited managed turn.');
      const turn = message.method === 'thread/tokenUsage/updated' ? p.turnId : object(p.turn) ? p.turn.id : undefined;
      identity(turn);
      if (this.#turn && turn !== this.#turn) throw new Error('Foreign managed turn.');
      this.#turn = turn as string;
      if (message.method === 'thread/tokenUsage/updated') {
        if (terminal.has(this.#outcome)) return;
        this.#observation = parseCodexTokenUsage(Buffer.from(JSON.stringify(message)), { sourceVersion: '0.166.0', sessionId: this.acquisitionId, observedAt: new Date().toISOString(), sequence: ++this.#sequence });
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
    if (!this.#observation) return;
    this.#observation.sequence = ++this.#sequence;
    this.#observation.managed = { connection: this.#connection, turn: this.#outcome,
      completeness: terminal.has(this.#outcome) ? 'complete' : 'partial', receiptAt: new Date().toISOString() };
  }
  observation(): TelemetryObservation | undefined {
    return this.#observation ? structuredClone(this.#observation) : undefined;
  }
  async persist(root: string, authorized: boolean): Promise<void> {
    const observation = this.observation();
    if (!observation) throw new Error('No managed usage observation is available.');
    await ingestTelemetry(root, observation, authorized);
  }
  async interrupt(): Promise<void> {
    if (this.#state !== 'turn-running' || !this.#turn) throw new Error('No confirmed managed turn to interrupt.');
    try { await this.transport.request('turn/interrupt', { threadId: this.#thread, turnId: this.#turn }); }
    catch { await this.transport.stop(); }
    // An acknowledgment is not confirmation of interruption; await turn/completed.
  }
  async stop(): Promise<void> {
    if (this.#state === 'stopped') return;
    if (this.#state === 'turn-pending' || this.#state === 'turn-running') this.#outcome = 'unknown-outcome';
    this.#state = 'stopped'; this.#connection = 'stopped'; this.#refresh();
    await this.transport.stop();
  }
}
