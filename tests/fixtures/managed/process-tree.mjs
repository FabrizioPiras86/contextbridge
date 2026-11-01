// Test-only processes self-expire and honor a file-based emergency cleanup channel.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
const [root, role, mode = 'normal'] = process.argv.slice(2);
const children = [];
const mark = (name) => writeFileSync(join(root, `${role}-${name}`), String(process.pid));
const exit = () => { mark('exit'); process.exit(0); };
setTimeout(exit, 8000);
setInterval(() => { if (existsSync(join(root, 'emergency-stop'))) exit(); }, 20);
if (mode !== 'hung') process.on('SIGTERM', async () => {
  await Promise.all(children.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', resolve);
  })));
  exit();
});
else process.on('SIGTERM', () => { mark('term'); });
const start = (childRole, detached = false) => {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), root, childRole, mode], {
    detached, stdio: ['ignore', 'ignore', 'ignore'], env: {},
  });
  children.push(child);
};
if (role === 'leader' && mode !== 'hung' && mode !== 'alone') {
  start('branch', mode === 'escaped'); start('sibling');
}
if (role === 'branch') start('grandchild');
mark('ready');
if (role === 'leader') createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'turn/start' || !request.method) mark('unauthorized');
  if (mode === 'malformed') process.stdout.write('PRIVATE_PROCESS_CANARY\n');
  else if (mode === 'eof') process.stdout.end();
  else if (mode === 'deadline') return;
  else if (mode === 'early') process.exit(0);
  else process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\n');
});
