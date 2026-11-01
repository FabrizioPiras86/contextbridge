import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManagedTransport } from '../../../src/managed/transport.ts';
const root = process.argv[2];
const rpc = new ManagedTransport(process.execPath, [fileURLToPath(new URL('./process-tree.mjs', import.meta.url)), root, 'leader', 'normal'], root);
const stop = async () => {
  try { await rpc.stop(); writeFileSync(join(root, 'parent-clean'), 'confirmed'); process.exitCode = 0; }
  catch { process.exitCode = 1; }
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
writeFileSync(join(root, 'parent-ready'), 'ready');

if (process.argv[3] && process.argv[3] !== 'kill') setInterval(() => {
  if (!existsSync(join(root, 'parent-fail'))) return;
  if (process.argv[3] === 'exit') process.exit(7);
  throw new Error('Test-only uncaught parent failure.');
}, 10);
