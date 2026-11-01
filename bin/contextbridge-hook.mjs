#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A separate watchdog bounds stalled stdin, synchronous parsing, and storage work.
// No provider is launched. The child inherits a recursion guard for any descendants.
if (process.env.CONTEXTBRIDGE_HOOK_ACTIVE) {
  process.stdout.write('{}\n');
} else {
  const child = spawn(process.execPath, ['--experimental-strip-types',
    fileURLToPath(new URL('../src/hooks/runner.ts', import.meta.url)), ...process.argv.slice(2)], {
    env: { ...process.env, CONTEXTBRIDGE_HOOK_ACTIVE: '1' },
    stdio: ['pipe', 'pipe', 'ignore'], shell: false,
  });
  let finished = false;
  const warning = () => process.stdout.write(JSON.stringify({
    systemMessage: 'ContextBridge hook failed or timed out; capture may be incomplete. Inspect memory and writer locks before retrying.',
  }) + '\n');
  const timer = setTimeout(() => {
    if (finished) return;
    finished = true;
    child.kill('SIGKILL');
    process.stdin.unpipe(child.stdin);
    process.stdin.destroy();
    warning();
  }, 5000);
  // Only publish a complete, bounded JSON response after the worker has exited.
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString('utf8');
    if (output.length > 4096) child.kill('SIGKILL');
  });
  child.stdin.on('error', () => {});
  process.stdin.pipe(child.stdin);
  child.once('error', () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    process.stdin.destroy();
    warning();
  });
  child.once('close', (code) => {
    clearTimeout(timer);
    process.stdin.destroy();
    if (finished) return;
    finished = true;
    if (code === 0 && output.length <= 4096) {
      try {
        const result = JSON.parse(output);
        if (result === null || typeof result !== 'object' || Array.isArray(result)) throw new Error();
        process.stdout.write(JSON.stringify(result) + '\n');
      } catch { warning(); }
    } else warning();
  });
}
