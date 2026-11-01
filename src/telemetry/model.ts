import { createHash } from 'node:crypto';
import type { Config } from '../types.ts';

export const STALE_AFTER_MS = 300_000;
export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}
export interface TelemetryObservation {
  schemaVersion: 1;
  provider: string;
  source: string;
  sessionId: string;
  threadId: string;
  turnId?: string;
  observedAt: string;
  sequence: number;
  cumulative?: TokenUsage;
  latest?: TokenUsage;
  modelContextWindow: number | null;
  context: { kind: 'unknown' } | { kind: 'measured'; usedTokens: number; verification: 'verified'; semantics: 'active-context' };
  provenance: {
    sourceVersion: string;
    transport: 'local-import';
    schema: 'verified';
    origin: 'unverified';
    timestamp: 'caller-supplied';
    ordering: 'caller-supplied';
    confidence: 'reported';
  };
}
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
export function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
export function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function identity(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid telemetry identifier.');
  // Identifiers are correlation metadata only. Never persist arbitrary caller text.
  return createHash('sha256').update(`contextbridge-telemetry-v1\0${value}`).digest('hex');
}
export const TOKEN_KEYS = ['inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'] as const;
export function validateUsage(value: unknown): asserts value is TokenUsage {
  if (!object(value) || !onlyKeys(value, TOKEN_KEYS) || !TOKEN_KEYS.every((key) => count(value[key]))) throw new Error('Invalid telemetry token counts.');
  const usage = value as unknown as TokenUsage;
  const sum = BigInt(usage.inputTokens) + BigInt(usage.outputTokens);
  // Aggregates may include unattributed tokens. Never reconstruct a reported total.
  if (BigInt(usage.totalTokens) < sum || usage.cachedInputTokens > usage.inputTokens ||
      usage.cacheWriteInputTokens > usage.inputTokens || usage.reasoningOutputTokens > usage.outputTokens) {
    throw new Error('Inconsistent telemetry token counts.');
  }
}
export type Freshness = 'fresh' | 'stale' | 'unknown';
export function freshness(observedAt: string, now = Date.now()): Freshness {
  if (!timestamp(observedAt) || !Number.isSafeInteger(now) || now < Date.parse(observedAt)) return 'unknown';
  return now - Date.parse(observedAt) >= STALE_AFTER_MS ? 'stale' : 'fresh';
}
export type Advisory = 'none' | 'warning' | 'handoff' | 'safety' | 'unknown';
export function evaluateThreshold(observation: Pick<TelemetryObservation, 'context' | 'modelContextWindow' | 'observedAt'> | null,
  thresholds: Config['thresholds'], now = Date.now()): Advisory {
  const { warning, handoff, safety } = thresholds;
  if (![warning, handoff, safety].every(Number.isInteger) || !(0 < warning && warning < handoff && handoff < safety && safety <= 100)) {
    throw new Error('Invalid telemetry thresholds.');
  }
  if (!observation || freshness(observation.observedAt, now) !== 'fresh' || observation.context.kind !== 'measured' ||
      observation.context.verification !== 'verified' || observation.context.semantics !== 'active-context' ||
      !count(observation.context.usedTokens) || !count(observation.modelContextWindow) || observation.modelContextWindow === 0) return 'unknown';
  const used = BigInt(observation.context.usedTokens) * 100n;
  const window = BigInt(observation.modelContextWindow);
  if (used >= window * BigInt(safety)) return 'safety';
  if (used >= window * BigInt(handoff)) return 'handoff';
  if (used >= window * BigInt(warning)) return 'warning';
  return 'none';
}
