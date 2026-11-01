import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

export const CLEANUP_DIAGNOSTIC = 'Managed process cleanup is unconfirmed; inspect owned test processes.';
const GRACE_MS = 150;
const FORCE_MS = 500;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Creation-local capability, never reconstructed from storage or process enumeration.
// POSIX group IDs are numeric identities, not kernel ownership handles.
export class OwnedProcess {
  readonly child: ChildProcessWithoutNullStreams;
  #live = true;
  #stop?: Promise<void>;
  #done: Promise<void>;
  #result: 'open' | 'confirmed' | 'unconfirmed' = 'open';
  get cleanup(): 'open' | 'confirmed' | 'unconfirmed' { return this.#result; }
  constructor(command: string, args: string[], cwd: string) {
    if (process.platform === 'win32') throw new Error('Managed subprocess execution is disabled on Windows.');
    this.child = spawn(command, args, { cwd, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: {} });
    this.#done = new Promise((resolve) => {
      const exited = () => { this.#live = false; resolve(); };
      this.child.once('exit', exited);
      this.child.once('error', exited);
    });
  }
  #signal(signal: NodeJS.Signals): void {
    // Never signal after observing exit, including during later escalation/repeated stops.
    if (!this.#live || !this.child.pid || this.child.exitCode !== null || this.child.signalCode !== null) return;
    try { process.kill(-this.child.pid, signal); }
    catch { /* Resolve only through bounded exit and group-absence verification below. */ }
  }
  #absent(): boolean {
    if (!this.child.pid) return !this.#live;
    // A probe cannot establish ownership or authorize another signal.
    try { process.kill(-this.child.pid, 0); return false; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
      return false;
    }
  }
  stop(force = false): Promise<void> {
    if (!this.#stop) this.#stop = this.#terminate(force);
    return this.#stop;
  }
  async #wait(ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.#done, new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); })]);
    clearTimeout(timer);
  }
  async #terminate(force: boolean): Promise<void> {
    this.#signal(force ? 'SIGKILL' : 'SIGTERM');
    if (!force) { await this.#wait(GRACE_MS); this.#signal('SIGKILL'); }
    await this.#wait(FORCE_MS);
    const deadline = performance.now() + FORCE_MS;
    // Allow reaping, but never attempt to kill an unanchored/reused group.
    while ((this.#live || !this.#absent()) && performance.now() < deadline) await delay(10);
    this.#result = !this.#live && this.#absent() ? 'confirmed' : 'unconfirmed';
    if (this.#result !== 'confirmed') throw new Error(CLEANUP_DIAGNOSTIC);
  }
}
