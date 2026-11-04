#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.ts');
const runtime = existsSync(source) ? ['--experimental-strip-types', source]
  : [resolve(dirname(fileURLToPath(import.meta.url)), '../dist/cli.js')];
const result = spawnSync(process.execPath, [...runtime, ...process.argv.slice(2)], {
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
