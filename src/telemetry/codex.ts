import { isUtf8 } from 'node:buffer';
import { count, identity, object, onlyKeys, timestamp, TOKEN_KEYS, validateUsage } from './model.ts';
import type { TelemetryObservation, TokenUsage } from './model.ts';

export const CODEX_SOURCE = 'codex-app-server';
export const CODEX_VERSION = '0.166.0';
export const MAX_NOTIFICATION_BYTES = 16_384;
export interface ImportMetadata {
  sourceVersion: string;
  sessionId: string;
  observedAt: string;
  sequence: number;
}
export function strictJson(text: string): unknown {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Invalid telemetry JSON.'); }
  const stack: (Set<string> | null)[] = [];
  const tokens = /"(?:\\.|[^"\\])*"|[{}\[\]]|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g;
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    if (token === '{' || token === '[') {
      stack.push(token === '{' ? new Set() : null);
      if (stack.length > 16) throw new Error('Telemetry JSON nesting limit exceeded.');
    } else if (token === '}' || token === ']') stack.pop();
    else if (token.startsWith('"') && /^\s*:/.test(text.slice(match.index! + token.length))) {
      const keys = stack.at(-1);
      const key = JSON.parse(token) as string;
      if (!keys || keys.has(key)) throw new Error('Duplicate telemetry JSON field.');
      keys.add(key);
    } else if (!token.startsWith('"') && !/^-?(?:0|[1-9][0-9]*)$/.test(token)) throw new Error('Telemetry counts require integer JSON literals.');
  }
  return value;
}
function breakdown(value: unknown): TokenUsage {
  if (!object(value) || !onlyKeys(value, TOKEN_KEYS)) throw new Error('Unsupported Codex token breakdown.');
  const result = { ...value, cacheWriteInputTokens: value.cacheWriteInputTokens ?? 0 };
  // Missing has a documented default; explicit null does not.
  if (value.cacheWriteInputTokens === null) throw new Error('Invalid Codex cache write count.');
  validateUsage(result);
  return Object.fromEntries(TOKEN_KEYS.map((key) => [key, result[key as keyof typeof result]])) as unknown as TokenUsage;
}
export function parseCodexTokenUsage(bytes: Buffer, metadata: ImportMetadata): TelemetryObservation {
  if (metadata.sourceVersion !== CODEX_VERSION) throw new Error('Unsupported Codex App Server version. Only 0.166.0 is verified.');
  if (!timestamp(metadata.observedAt) || !count(metadata.sequence) || metadata.sequence === 0) throw new Error('Invalid telemetry observation metadata.');
  if (!bytes.length || bytes.length > MAX_NOTIFICATION_BYTES || !isUtf8(bytes)) throw new Error('Invalid or oversized telemetry input.');
  const value = strictJson(bytes.toString('utf8'));
  // Codex uses JSON-RPC notifications without requiring the jsonrpc member.
  if (!object(value) || !onlyKeys(value, ['jsonrpc', 'method', 'params']) ||
      (value.jsonrpc !== undefined && value.jsonrpc !== '2.0') || value.method !== 'thread/tokenUsage/updated' ||
      !object(value.params) || !onlyKeys(value.params, ['threadId', 'turnId', 'tokenUsage'])) throw new Error('Unsupported Codex telemetry notification.');
  const { threadId, turnId, tokenUsage } = value.params;
  if (!object(tokenUsage) || !onlyKeys(tokenUsage, ['total', 'last', 'modelContextWindow'])) throw new Error('Unsupported Codex token usage schema.');
  const window = tokenUsage.modelContextWindow ?? null;
  if (window !== null && (!count(window) || window === 0)) throw new Error('Invalid Codex context-window size.');
  const cumulative = breakdown(tokenUsage.total), latest = breakdown(tokenUsage.last);
  if (TOKEN_KEYS.some((key) => latest[key] > cumulative[key])) throw new Error('Latest Codex usage exceeds cumulative usage.');
  return {
    schemaVersion: 1, provider: 'codex', source: CODEX_SOURCE,
    sessionId: identity(metadata.sessionId), threadId: identity(threadId), turnId: identity(turnId),
    observedAt: metadata.observedAt, sequence: metadata.sequence,
    cumulative, latest, modelContextWindow: window, context: { kind: 'unknown' },
    provenance: { sourceVersion: CODEX_VERSION, transport: 'local-import', schema: 'verified', origin: 'unverified',
      timestamp: 'caller-supplied', ordering: 'caller-supplied', confidence: 'reported' },
  };
}

// Persistent records are untrusted too. Reject fields that could assert a verified
// occupancy or authenticated origin.
export function validateCodexObservation(value: unknown): asserts value is TelemetryObservation {
  if (object(value) && value.schemaVersion === 2) {
    const m = value.managed, p = value.provenance;
    if (!object(m) || !onlyKeys(m, ['connection', 'turn', 'completeness', 'receiptAt']) ||
        !['connected', 'disconnected', 'stopped'].includes(m.connection as string) ||
        !['ready', 'turn-pending', 'turn-running', 'turn-completed', 'turn-failed', 'turn-interrupted', 'unknown-outcome'].includes(m.turn as string) ||
        !['partial', 'complete'].includes(m.completeness as string) || !timestamp(m.receiptAt) ||
        (m.completeness === 'complete' && !['turn-completed', 'turn-failed', 'turn-interrupted'].includes(m.turn as string)) ||
        !object(p) || p.transport !== 'managed-stdio-mock' || p.timestamp !== 'client-receipt' || p.ordering !== 'local-receive') {
      throw new Error('Invalid managed telemetry observation.');
    }
    const { managed, ...base } = value;
    validateCodexObservation({ ...base, schemaVersion: 1, provenance: { ...p, transport: 'local-import', timestamp: 'caller-supplied', ordering: 'caller-supplied' } });
    return;
  }

  if (!object(value) || !onlyKeys(value, ['schemaVersion', 'provider', 'source', 'sessionId', 'threadId', 'turnId', 'observedAt', 'sequence',
    'cumulative', 'latest', 'modelContextWindow', 'context', 'provenance']) ||
      value.schemaVersion !== 1 || value.provider !== 'codex' || value.source !== CODEX_SOURCE ||
      !['sessionId', 'threadId', 'turnId'].every((key) => typeof value[key] === 'string' && /^[0-9a-f]{64}$/.test(value[key] as string)) ||
      !timestamp(value.observedAt) || !count(value.sequence) || value.sequence === 0 ||
      (value.modelContextWindow !== null && (!count(value.modelContextWindow) || value.modelContextWindow === 0)) ||
      !object(value.context) || !onlyKeys(value.context, ['kind']) || value.context.kind !== 'unknown' ||
      !object(value.provenance) || !onlyKeys(value.provenance, ['sourceVersion', 'transport', 'schema', 'origin', 'timestamp', 'ordering', 'confidence']) ||
      value.provenance.sourceVersion !== CODEX_VERSION || value.provenance.transport !== 'local-import' || value.provenance.schema !== 'verified' ||
      value.provenance.origin !== 'unverified' || value.provenance.timestamp !== 'caller-supplied' || value.provenance.ordering !== 'caller-supplied' ||
      value.provenance.confidence !== 'reported') throw new Error('Invalid stored telemetry observation.');
  validateUsage(value.cumulative);
  validateUsage(value.latest);
  const latest = value.latest, cumulative = value.cumulative;
  if (TOKEN_KEYS.some((key) => latest[key] > cumulative[key])) throw new Error('Inconsistent stored telemetry usage.');
}
