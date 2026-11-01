import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { isUtf8 } from 'node:buffer';
import { strictJson } from '../telemetry/codex.ts';
import { object, onlyKeys } from '../telemetry/model.ts';

export const FRAME_LIMIT = 65_536;
export const PENDING_LIMIT = 8;
const failure = () => new Error('Managed protocol connection failed.');
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

// Internal transport only. Production execution is deliberately not exposed by the CLI.
export class ManagedTransport {
  #child: ChildProcessWithoutNullStreams;
  #buffer = Buffer.alloc(FRAME_LIMIT);
  #length = 0;
  #pending = new Map<number, Pending>();
  #next = 0;
  #closed = false;
  #blocked = false;
  #timer: ReturnType<typeof setTimeout>;
  #exited: Promise<void>;
  get backpressured(): boolean { return this.#blocked; }
  onNotification: (message: Record<string, unknown>) => void = () => {};
  onDisconnect: () => void = () => {};
  private deadline: number;
  constructor(command: string, args: string[], cwd: string, deadline = 1_000) {
    this.deadline = deadline;
    if (process.platform === 'win32') throw new Error('Managed subprocess execution is disabled on Windows.');
    if (!Number.isInteger(deadline) || deadline < 10 || deadline > 5_000) throw failure();
    this.#child = spawn(command, args, { cwd, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: {} });
    this.#exited = new Promise((resolve) => { this.#child.once('exit', () => resolve()); this.#child.once('error', () => resolve()); });
    this.#child.on('error', () => this.#fail());
    this.#child.on('exit', () => this.#fail());
    this.#child.stdout.on('error', () => this.#fail());
    this.#child.stdout.on('end', () => this.#fail());
    this.#child.stdin.on('error', () => this.#fail());
    this.#child.stderr.on('error', () => this.#fail());
    this.#child.stderr.on('data', () => {});
    this.#child.stdin.on('drain', () => { this.#blocked = false; });
    this.#child.stdout.on('data', (chunk: Buffer) => this.#receive(chunk));
    // Absolute lifetime bounds even an endless notification or stderr producer.
    this.#timer = setTimeout(() => this.#fail(), 30_000);
  }
  #kill(signal: NodeJS.Signals): void {
    if (this.#child.pid) {
      try { process.kill(-this.#child.pid, signal); } catch { /* The owned process group may already have exited. */ }
    }
  }
  #fail(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#buffer.fill(0); this.#length = 0;
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(failure()); }
    this.#pending.clear();
    this.#child.stdin.destroy(); this.#child.stdout.destroy(); this.#child.stderr.destroy();
    this.#kill('SIGKILL');
    this.onDisconnect();
  }
  #send(message: unknown): void {
    if (this.#closed || this.#blocked) throw failure();
    const bytes = Buffer.from(JSON.stringify(message) + '\n');
    if (bytes.length > FRAME_LIMIT) throw failure();
    // Never queue behind a backpressured write. Admission fails closed.
    this.#blocked = !this.#child.stdin.write(bytes);
  }
  notifyInitialized(): void { this.#send({ method: 'initialized' }); }
  request(method: string, params: unknown): Promise<unknown> {
    if (method === 'turn/start') return Promise.reject(new Error('Separate single-turn authorization is required.'));
    return this.#request(method, params);
  }
  #turnUsed = false;
  startTurn(params: unknown, authorized: boolean): Promise<unknown> {
    if (authorized !== true || this.#turnUsed) return Promise.reject(new Error('Separate single-turn authorization is required.'));
    this.#turnUsed = true;
    return this.#request('turn/start', params);
  }
  #request(method: string, params: unknown): Promise<unknown> {
    if (!['initialize', 'thread/start', 'turn/start', 'turn/interrupt', 'account/read'].includes(method) ||
        this.#closed || this.#blocked || this.#pending.size >= PENDING_LIMIT) return Promise.reject(failure());
    if (method === 'account/read' && (!object(params) || !onlyKeys(params, ['refreshToken']) || params.refreshToken !== false)) return Promise.reject(failure());
    const id = ++this.#next;
    if (!Number.isSafeInteger(id)) return Promise.reject(failure());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#fail(), this.deadline);
      this.#pending.set(id, { resolve, reject, timer });
      try { this.#send({ id, method, params }); } catch { this.#fail(); }
    });
  }
  #receive(chunk: Buffer): void {
    try {
      for (let offset = 0; offset < chunk.length && !this.#closed;) {
        const end = chunk.indexOf(10, offset);
        const stop = end < 0 ? chunk.length : end;
        const size = stop - offset;
        if (this.#length + size > FRAME_LIMIT) throw failure();
        chunk.copy(this.#buffer, this.#length, offset, stop); this.#length += size;
        if (end < 0) break;
        const frame = this.#buffer.subarray(0, this.#length);
        if (!frame.length || !isUtf8(frame)) throw failure();
        const value = strictJson(frame.toString('utf8'));
        this.#buffer.fill(0, 0, this.#length); this.#length = 0;
        this.#route(value); offset = end + 1;
      }
    } catch { this.#fail(); }
  }
  #route(value: unknown): void {
    if (!object(value) || (value.jsonrpc !== undefined && value.jsonrpc !== '2.0')) throw failure();
    if ('method' in value) {
      // All server requests, including approvals/auth refresh, terminate without a response.
      if ('id' in value || !onlyKeys(value, ['method', 'params', 'jsonrpc']) || typeof value.method !== 'string' ||
          !object(value.params)) throw failure();
      this.onNotification(value); return;
    }
    if (!onlyKeys(value, ['id', 'result', 'error', 'jsonrpc']) || !Number.isSafeInteger(value.id) ||
        ('result' in value) === ('error' in value)) throw failure();
    const pending = this.#pending.get(value.id as number);
    if (!pending) throw failure();
    if ('error' in value && (!object(value.error) || !Number.isSafeInteger(value.error.code) || typeof value.error.message !== 'string')) throw failure();
    clearTimeout(pending.timer); this.#pending.delete(value.id as number);
    if ('error' in value) pending.reject(new Error('Managed request rejected.'));
    else pending.resolve(value.result);
  }
  async stop(): Promise<void> {
    this.#fail();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.#exited, new Promise<void>((resolve) => { timer = setTimeout(resolve, 500); })]);
    clearTimeout(timer);
  }
}
