import { historicalLifecycle, terminalTurns } from '../managed/lifecycle.ts';
import { loadConfig } from '../config.ts';
import { CODEX_SOURCE, CODEX_VERSION, MAX_NOTIFICATION_BYTES, parseCodexTokenUsage } from './codex.ts';
import { count, evaluateThreshold, freshness, identity, STALE_AFTER_MS, timestamp } from './model.ts';
import { ingestTelemetry, listCaptureStore } from './store.ts';

async function notificationFromStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  const timeout = setTimeout(() => process.stdin.destroy(new Error('Telemetry input timed out.')), 5_000);
  try {
    for await (const chunk of process.stdin) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > MAX_NOTIFICATION_BYTES) throw new Error('Telemetry input exceeds size limit.');
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  } finally { clearTimeout(timeout); }
}
export async function contextCommand(root: string, args: string[]): Promise<void> {
  const [action, ...options] = args;
  if (!['status', 'ingest', 'run'].includes(action)) throw new Error('Use context status, context ingest or context run.');
  const allowed = action === 'run' ? ['--project', '--agent', '--yes'] : action === 'status' ? ['--project', '--session', '--thread'] :
    ['--project', '--source', '--source-version', '--session', '--observed-at', '--sequence', '--yes'];
  const parsed = new Map<string, string>();
  for (let i = 0; i < options.length; i++) {
    const key = options[i];
    if (!allowed.includes(key) || parsed.has(key)) throw new Error('Unknown or repeated context option.');
    if (key === '--yes') { parsed.set(key, 'true'); continue; }
    const value = options[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing context option value.');
    parsed.set(key, value);
  }
  if (action === 'run') {
    if (!parsed.has('--yes')) throw new Error('Managed capture initialization requires --yes.');
    if (parsed.get('--agent') !== 'codex') throw new Error('Managed capture requires --agent codex.');
    throw new Error('Managed real App Server execution is disabled in M2.2a. Mock foundation only; containment and effective process policy require validation. No process was started.');
  }
  if (action === 'ingest') {
    if (!parsed.has('--yes')) throw new Error('Telemetry ingestion requires explicit local opt-in with --yes.');
    if (parsed.get('--source') !== CODEX_SOURCE) throw new Error('Ingestion requires --source codex-app-server.');
    const sequence = parsed.get('--sequence');
    if (!sequence || !/^[1-9][0-9]*$/.test(sequence)) throw new Error('Use a positive integer --sequence.');
    const metadata = { sourceVersion: parsed.get('--source-version')!, sessionId: parsed.get('--session')!,
      observedAt: parsed.get('--observed-at')!, sequence: Number(sequence) };
    // Validate metadata before waiting for stdin, without invoking a provider.
    if (metadata.sourceVersion !== CODEX_VERSION) throw new Error('Use --source-version 0.166.0; other versions are unverified.');
    identity(metadata.sessionId);
    if (!timestamp(metadata.observedAt) || !count(metadata.sequence)) throw new Error('Invalid telemetry observation timestamp or sequence.');
    const observation = parseCodexTokenUsage(await notificationFromStdin(), metadata);
    console.log(JSON.stringify({ result: await ingestTelemetry(root, observation, true), liveCapture: false }));
    return;
  }
  const session = parsed.get('--session'), thread = parsed.get('--thread');
  if (!!session !== !!thread) throw new Error('Select both --session and --thread, or omit both to list independent streams.');
  const sessionId = session ? identity(session) : undefined, threadId = thread ? identity(thread) : undefined;
  const store = await listCaptureStore(root);
  const observations = store.observations.filter((item) => !sessionId || (item.sessionId === sessionId && item.threadId === threadId));
  const lifecycles = store.lifecycles.filter((item) => !sessionId || (item.acquisitionId === sessionId && item.threadId === threadId));
  const config = await loadConfig(root);
  const now = Date.now();
  console.log(JSON.stringify({
    capability: 'supported', provider: 'codex', source: CODEX_SOURCE, sourceVersion: CODEX_VERSION,
    state: !observations.length ? 'unavailable' : observations.every((item) => !item.managed && freshness(item.observedAt, now) === 'fresh') ? 'supported' : 'stale',
    liveCapture: false, staleAfterMs: STALE_AFTER_MS,
    contextUtilization: 'unknown', reason: 'The supported event does not establish active context-window occupancy. CLI hooks and VS Code telemetry capture are not implemented.',
    lifecycles: lifecycles.map(historicalLifecycle),
    observations: observations.map((item) => ({ ...item, ...(item.managed ? { historical: true, currentConnection: 'unconfirmed', outcome: terminalTurns.has(item.managed.turn) ? item.managed.turn : 'unconfirmed' } : {}), availability: 'supported', freshness: item.managed ? 'stale' : freshness(item.observedAt, now),
      advisory: evaluateThreshold(item, config.thresholds, now) })),
  }, null, 2));
}
