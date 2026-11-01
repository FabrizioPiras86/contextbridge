import { resolvedConfig, administrativeRequirements } from './policy.mjs';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createInterface } from 'node:readline';
const mode = process.argv[2] || 'normal';
const canary = 'PRIVATE_MANAGED_CANARY_9187';
const send = (v) => process.stdout.write(JSON.stringify(v) + '\n');
const usage = { inputTokens: 8, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 10 };
let initialized = false;
let configRead = false;
let requirementsRead = false;
let configReads = 0;
let requirementsReads = 0;
const trace = (method) => {
  const path = process.argv[5];
  if (!path) return;
  const methods = JSON.parse(readFileSync(path, 'utf8'));
  methods.push(method);
  // Forced protocol cleanup may interrupt even a synchronous filesystem write.
  // Publish a complete trace before handling the request or sending a response.
  writeFileSync(path + '.pending', JSON.stringify(methods));
  renameSync(path + '.pending', path);
};
if (mode === 'hang') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
if (mode === 'no-read') { setInterval(() => {}, 1000); }
else createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line);
  trace(m.method);
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
  } else if (m.method === 'config/read') {
    if (!initialized || m.params.includeLayers !== true || typeof m.params.cwd !== 'string') process.exit(5);
    if (mode === 'config-timeout') return;
    if (mode === 'config-disconnect') return process.exit(0);
    if (mode === 'config-privileged') return send({ id: 'policy-approval', method: 'item/commandExecution/requestApproval', params: {} });
    const result = resolvedConfig();
    configReads++;
    if (mode === 'policy-revision-change' && configReads > 1) {
      for (const origin of Object.values(result.origins)) origin.version = 'changed';
      result.layers[0].version = 'changed';
    }
    if (mode === 'config-mismatch' || (mode === 'policy-change' && configReads > 1)) result.config.approval_policy = 'on-request';
    if (mode === 'config-missing') delete result.config.approvals_reviewer;
    if (mode === 'config-null') result.layers = null;
    if (mode === 'config-model') result.config.model = 'unexpected';
    if (mode === 'config-provider') result.config.model_provider = 'unexpected';
    if (mode === 'config-reviewer') result.config.approvals_reviewer = 'auto_review';
    if (mode === 'config-canary') result.config.developer_instructions = canary;
    if (mode === 'config-extensions') result.config.plugins = { enabled: true };
    if (mode === 'config-features') result.config.features = { apps: true };
    if (mode === 'config-tools') result.config.tools = { web_search: { enabled: true } };
    if (mode === 'config-browser') result.config.browser_use = { allow_history_access: true };
    if (mode === 'config-computer') result.config.computer_use = { default_app_access: 'allow' };
    if (mode === 'config-notify') result.config.notify = [canary];
    if (mode === 'config-otel') result.config.otel = { exporter: 'otlp-http' };
    if (mode === 'config-hooks' || mode === 'config-mcp') result.config[mode === 'config-hooks' ? 'hooks' : 'mcp_servers'] = { enabled: true };
    if (mode === 'config-project-hooks' || mode === 'config-user-hooks') result.layers.push({ name: mode === 'config-project-hooks' ? { type: 'project', dotCodexFolder: '/mock/.codex' } : { type: 'user', file: '/mock/config.toml' }, version: 'inherited', config: { hooks: {} } });
    if (mode === 'config-unsupported') result.schemaVersion = 999;
    if (mode === 'config-origins') result.origins.approval_policy.version = 'conflict';
    if (mode === 'config-malformed') return process.stdout.write('{bad\n');
    if (mode === 'config-wrong-id') return send({ id: m.id + 1, result });
    if (mode === 'config-envelope') return send({ id: m.id, result, error: { code: -1, message: canary } });
    if (mode === 'config-jsonrpc') return send({ jsonrpc: '3.0', id: m.id, result });
    configRead = true;
    send({ id: m.id, result });
    if (mode === 'config-duplicate') send({ id: m.id, result });
  } else if (m.method === 'configRequirements/read') {
    if (!configRead || m.params !== null) process.exit(6);
    requirementsReads++;
    const result = administrativeRequirements();
    if (mode === 'requirements-missing') delete result.requirements;
    if (mode === 'requirements-field-missing') delete result.requirements.allowedSandboxModes;
    if (mode === 'requirements-null') result.requirements = null;
    if (mode === 'requirements-ambiguous') result.requirements.allowedApprovalPolicies = null;
    if (mode === 'requirements-mismatch' || (mode === 'requirements-change' && requirementsReads > 1)) result.requirements.allowedSandboxModes = ['workspace-write'];
    if (mode === 'requirements-provider') result.requirements.modelProvider = 'unexpected';
    if (mode === 'requirements-features') result.requirements.featureRequirements = { hooks: true };
    if (mode === 'requirements-unsupported') result.requirements.network = { enabled: false };
    if (mode === 'requirements-timeout') return;
    if (mode === 'requirements-disconnect') return process.exit(0);
    requirementsRead = true;
    send({ id: m.id, result });
  } else if (m.method === 'thread/start') {
    if (!configRead || !requirementsRead) process.exit(7);
    if (process.argv[3] && JSON.parse(readFileSync(process.argv[3], 'utf8')).lifecycles.at(-1).turn !== 'initializing') process.exit(4);
    if (!initialized || m.params.ephemeral !== true || m.params.approvalPolicy !== 'never' || m.params.sandbox !== 'read-only') process.exit(2);
    send({ id: m.id, result: { thread: { id: 'thread-1', cliVersion: mode === 'thread-version' ? '0.167.0' : '0.166.0', createdAt: 0, updatedAt: 0, cwd: m.params.cwd, ephemeral: true, modelProvider: 'mock', preview: '', projectId: null, sessionId: 'mock-session', source: 'appServer', status: { type: 'idle' }, turns: [] }, model: mode === 'thread-model' ? 'unexpected' : 'mock', modelProvider: mode === 'thread-provider' ? 'unexpected' : 'mock', approvalsReviewer: mode === 'thread-reviewer' ? 'auto_review' : 'user', cwd: m.params.cwd, approvalPolicy: mode === 'policy' ? 'on-request' : 'never', sandbox: { type: mode === 'thread-write' ? 'workspaceWrite' : mode === 'thread-full' ? 'dangerFullAccess' : 'readOnly', ...(mode === 'thread-network-missing' ? {} : { networkAccess: mode === 'thread-network' }) } } });
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
