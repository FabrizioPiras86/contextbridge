import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const mode = process.argv[2] || 'normal';
const canary = 'PRIVATE_MANAGED_CANARY_9187';
const send = (v) => process.stdout.write(JSON.stringify(v) + '\n');
const usage = { inputTokens: 8, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 10 };
let initialized = false;
if (mode === 'hang') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
if (mode === 'no-read') { setInterval(() => {}, 1000); }
else createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line);
  if (mode === 'approval' && !m.method && process.argv[3]) writeFileSync(process.argv[3], 'response-observed');
  if (mode === 'signal') return process.kill(process.pid, 'SIGTERM');
  if (mode === 'hang' || mode === 'missing') return;
  if (mode === 'drop') return process.exit(0);
  if (mode === 'invalid') return process.stdout.write('{bad\n');
  if (mode === 'duplicate') return process.stdout.write('{"id":1,"id":1,"result":{}}\n');
  if (mode === 'overflow') return process.stdout.write('x'.repeat(65537));
  if (mode === 'depth') return process.stdout.write('{"id":1,"result":' + '['.repeat(17) + '0' + ']'.repeat(17) + '}\n');
  if (mode === 'invalid-utf8') return process.stdout.write(Buffer.from([255, 10]));
  if (mode === 'partial') return process.stdout.write('{');
  if (mode === 'delayed') await new Promise((r) => setTimeout(r, 300));
  if (mode === 'bad-id') return send({ id: '1', result: {} });
  if (mode === 'unknown-id') return send({ id: 999, result: {} });
  if (mode === 'error') return send({ id: m.id, error: { code: -1, message: canary } });
  if (mode === 'approval') {
    send({ id: 'privileged', method: 'item/permissions/requestApproval', params: { secret: canary } });
    return;
  }
  if (m.method === 'initialized') { initialized = true; return; }
  if (m.method === 'initialize') {
    if (mode === 'stderr') for (let i = 0; i < 128; i++) process.stderr.write(canary.repeat(1024));
    const response = Buffer.from(JSON.stringify({ id: m.id, result: { userAgent: 'mock-😀', codexHome: '/mock', platformFamily: 'unix', platformOs: 'mock' } }) + '\n');
    if (mode === 'fragment') {
      for (const byte of response) { process.stdout.write(Buffer.from([byte])); await new Promise((r) => setTimeout(r, 1)); }
    } else send({ id: m.id, result: { userAgent: 'mock', codexHome: '/mock', platformFamily: 'unix', platformOs: 'mock' } });
  } else if (m.method === 'thread/start') {
    if (process.argv[3] && JSON.parse(readFileSync(process.argv[3], 'utf8')).lifecycles.at(-1).turn !== 'initializing') process.exit(4);
    if (!initialized || m.params.ephemeral !== true || m.params.approvalPolicy !== 'never' || m.params.sandbox !== 'read-only') process.exit(2);
    send({ id: m.id, result: { thread: { id: 'thread-1', cliVersion: '0.166.0', createdAt: 0, updatedAt: 0, cwd: m.params.cwd, ephemeral: true, modelProvider: 'mock', preview: '', projectId: null, sessionId: 'mock-session', source: 'appServer', status: { type: 'idle' }, turns: [] }, model: 'mock', modelProvider: 'mock', approvalsReviewer: 'user', cwd: m.params.cwd, approvalPolicy: mode === 'policy' ? 'on-request' : 'never', sandbox: { type: 'readOnly', networkAccess: false } } });
  } else if (m.method === 'turn/start') {
    if (process.argv[3]) {
      const store = JSON.parse(readFileSync(process.argv[3], 'utf8'));
      const latest = store.lifecycles.at(-1);
      if (latest.turn !== 'turn-pending' || latest.threadId === 'thread-1' || latest.turnId) process.exit(3);
      writeFileSync(process.argv[4], 'turn-pending-observed');
    }
    const event = (method, status, threadId = 'thread-1') => ({ method, params: { threadId, turn: { id: 'turn-1', status, items: [{ type: 'agentMessage', id: 'item-1', text: canary }], error: null } } });
    if (mode === 'turn-drop') return process.exit(0);
    send(event('turn/started', 'inProgress', 'foreign'));
    send({ method: 'thread/tokenUsage/updated', params: { threadId: 'foreign', turnId: 'foreign-turn', tokenUsage: { secret: canary } } });
    send(event('turn/started', 'inProgress'));
    if (mode === 'burst') for (let i = 0; i < 100; i++) send(event('turn/started', 'inProgress'));
    send({ method: 'item/agentMessage/delta', params: { delta: canary } });
    if (mode !== 'no-usage') send({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', turnId: 'turn-1', tokenUsage: { total: usage, last: usage, modelContextWindow: 100 } } });
    send({ id: m.id, result: { turn: { id: 'turn-1', status: 'inProgress', items: [] } } });
    if (mode === 'usage-exit') return process.exit(0);
    if (mode !== 'interrupt' && mode !== 'running') {
      const status = mode === 'failed' ? 'failed' : 'completed';
      process.stdout.write(JSON.stringify(event('turn/completed', status)) + '\n' + JSON.stringify(event('turn/completed', status)) + '\n' + JSON.stringify(event('turn/started', 'inProgress')) + '\n');
    }
  } else if (m.method === 'turn/interrupt') {
    send({ id: m.id, result: {} });
    send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted', items: [], error: null } } });
  } else send({ id: m.id, result: {} });
});
