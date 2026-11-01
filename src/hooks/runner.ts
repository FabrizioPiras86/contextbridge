import { isUtf8 } from 'node:buffer';
import { resolve } from 'node:path';
import { captureCodexMemory, MAX_HOOK_INPUT_BYTES, parseCodexHook } from './codex.ts';
import { requireHooksInstalled } from './install.ts';

// This module is an executable child of the watchdog, never imported by the CLI.
async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--project' || !args[1]) throw new Error('Invalid hook runner arguments.');
  const root = resolve(args[1]);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_HOOK_INPUT_BYTES) throw new Error('Codex hook input exceeds size limit.');
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks);
  if (!isUtf8(bytes)) throw new Error('Invalid Codex hook input encoding.');
  const input = parseCodexHook(bytes);
  await requireHooksInstalled(root);
  const result = await captureCodexMemory(root, input);
  process.stdout.write(JSON.stringify(result.captured || result.duplicate || result.excluded || result.recovered ? {
    systemMessage: `ContextBridge: ${result.captured} captured, ${result.duplicate} duplicate, ${result.recovered} recovered tail(s), ${result.excluded} marker exclusion(s). Claims remain unverified; inspect memory list.`,
  } : {}) + '\n');
}

run().catch(() => {
  // Do not echo payloads, file contents, paths, or arbitrary provider errors.
  process.stdout.write(JSON.stringify({ systemMessage: 'ContextBridge capture skipped or incomplete. Check hooks status and memory list; no provider action was blocked.' }) + '\n');
  process.exitCode = 0;
});
