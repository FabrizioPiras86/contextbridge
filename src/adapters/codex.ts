import { spawn } from 'node:child_process';

// Only the initial user prompt is passed: no resume, fork, or configuration overrides.
export async function startCodex(root: string, prompt: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', [prompt], { cwd: root, stdio: 'inherit', shell: false });
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new Error('Codex executable is unavailable. Install Codex CLI and ensure codex is on PATH, then retry. The checkpoint is unchanged.'));
      } else {
        reject(new Error(`Could not start Codex: ${error.message}. The checkpoint is unchanged.`));
      }
    });
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Codex terminated by signal ${signal}. The checkpoint is unchanged; you can retry.`));
      } else {
        resolve(code ?? 1);
      }
    });
  });
}
