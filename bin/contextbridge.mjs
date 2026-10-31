#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.ts');
const result = spawnSync(process.execPath, ['--experimental-strip-types', cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
if (result.error) {
  process.stderr.write(`ContextBridge launcher error: ${result.error.message}\n`);
  process.exit(1);
}
if (result.signal) {
  process.stderr.write(`ContextBridge terminated by signal ${result.signal}.\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
