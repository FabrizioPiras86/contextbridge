import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { appendMemory, createMemoryEvent, listMemory, validateMemoryEvent } from '../memory.ts';
import type { MemoryEvent } from '../memory.ts';

export const MAX_HOOK_INPUT_BYTES = 65_536;
export const MAX_CAPTURE_EVENTS = 8;
const identifier = /^[A-Za-z0-9_-]{1,128}$/;
export interface CodexHookInput {
  hook_event_name: 'SessionStart' | 'Stop';
  session_id: string;
  cwd: string;
  transcript_path?: string | null;
  model?: string | null;
  permission_mode?: string | null;
  source?: string;
  turn_id?: string | null;
  stop_hook_active?: boolean | null;
  last_assistant_message?: string | null;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseCodexHook(bytes: Buffer): CodexHookInput {
  if (bytes.length > MAX_HOOK_INPUT_BYTES || !isUtf8(bytes)) throw new Error('Invalid or oversized Codex hook input.');
  let value: unknown;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Invalid Codex hook JSON.'); }
  if (!object(value) || !['SessionStart', 'Stop'].includes(value.hook_event_name as string)) throw new Error('Unsupported Codex hook event.');
  const common = ['hook_event_name', 'session_id', 'cwd', 'transcript_path', 'model', 'permission_mode'];
  const specific = value.hook_event_name === 'Stop' ? ['turn_id', 'stop_hook_active', 'last_assistant_message'] : ['source'];
  if (Object.keys(value).some((key) => ![...common, ...specific].includes(key)) ||
      typeof value.session_id !== 'string' || !identifier.test(value.session_id) ||
      typeof value.cwd !== 'string' || value.cwd.length > 4096 || !isAbsolute(value.cwd) || /[\x00-\x1f]/.test(value.cwd)) {
    throw new Error('Invalid Codex hook schema.');
  }
  for (const key of ['transcript_path', 'model', 'permission_mode', 'turn_id', 'last_assistant_message']) {
    if (value[key] != null && (typeof value[key] !== 'string' || Buffer.byteLength(value[key] as string) > MAX_HOOK_INPUT_BYTES)) throw new Error('Invalid Codex hook field.');
  }
  if (value.turn_id != null && !identifier.test(value.turn_id as string)) throw new Error('Invalid Codex turn identifier.');
  if (value.stop_hook_active != null && typeof value.stop_hook_active !== 'boolean') throw new Error('Invalid Codex continuation flag.');
  if (value.hook_event_name === 'SessionStart' && !['startup', 'resume', 'clear', 'compact', 'fork'].includes(value.source as string)) throw new Error('Unsupported Codex session source.');
  return value as unknown as CodexHookInput;
}

export function extractCodexMemory(input: CodexHookInput): MemoryEvent[] {
  if (input.hook_event_name !== 'Stop' || input.stop_hook_active !== false || !input.turn_id || !input.last_assistant_message) return [];
  // A labeled block is a data contract, never executable instructions or verified evidence.
  const blocks = [...input.last_assistant_message.matchAll(/^```contextbridge-memory\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm)];
  if (!blocks.length) return [];
  if (blocks.length !== 1) throw new Error('Expected one ContextBridge memory block.');
  let block: unknown;
  try { block = JSON.parse(blocks[0][1]); } catch { throw new Error('Invalid ContextBridge memory block.'); }
  if (!object(block) || Object.keys(block).some((key) => !['schemaVersion', 'events'].includes(key)) || block.schemaVersion !== 1 ||
      !Array.isArray(block.events) || block.events.length > MAX_CAPTURE_EVENTS) throw new Error('Invalid ContextBridge extraction schema.');
  const kinds = {
    decision: ['decision', ''], 'task-completed': ['task', 'Completed task (agent-reported): '],
    'task-pending': ['task', 'Pending task (agent-reported): '], blocker: ['blocker', ''],
    'next-step': ['note', 'Next step (agent-reported): '], 'project-metadata': ['note', 'Project metadata (agent-reported): '],
  } as const;
  return block.events.map((item, index) => {
    if (!object(item) || Object.keys(item).some((key) => !['kind', 'text'].includes(key)) ||
        typeof item.kind !== 'string' || !Object.hasOwn(kinds, item.kind) || typeof item.text !== 'string' || !item.text.trim()) {
      throw new Error('Invalid ContextBridge memory entry.');
    }
    const [type, prefix] = kinds[item.kind as keyof typeof kinds];
    const delivery = createHash('sha256').update(JSON.stringify(['codex-stop-v1', input.session_id, input.turn_id, index])).digest();
    // Keep the existing provider-neutral v4 UUID schema; derive a stable delivery identity.
    delivery[6] = (delivery[6] & 0x0f) | 0x40;
    delivery[8] = (delivery[8] & 0x3f) | 0x80;
    const hex = delivery.subarray(0, 16).toString('hex');
    const event = createMemoryEvent({ type, content: prefix + item.text,
      source: { kind: 'agent-reported', reference: `Codex Stop delivery ${delivery.toString('hex')}` } });
    event.id = `mem_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    validateMemoryEvent(event);
    return event;
  });
}
function sameClaim(left: MemoryEvent, right: MemoryEvent): boolean {
  return left.type === right.type && left.content === right.content && JSON.stringify(left.source) === JSON.stringify(right.source) && left.relatedFiles === undefined;
}
export async function captureCodexMemory(root: string, input: CodexHookInput): Promise<{ captured: number; duplicate: number; excluded: number; recovered: number }> {
  // Hook cwd can confirm a configured target, but never choose a storage or transcript path.
  const location = relative(await realpath(root), await realpath(input.cwd));
  if (location === '..' || location.startsWith('../') || location.startsWith('..\\') || isAbsolute(location)) throw new Error('Codex hook project does not match the configured project.');
  const events = extractCodexMemory(input);
  const result = { captured: 0, duplicate: 0, excluded: 0, recovered: 0 };
  if (!events.length) return result;
  const listed = await listMemory(root);
  result.excluded = listed.recovery?.abandoned.length ?? 0;
  result.recovered = listed.recovery?.recovered.length ?? 0;
  const existing = new Map(listed.events.map((event) => [event.id, event]));
  // Preflight the entire block before any append, including changed delivery conflicts.
  for (const event of events) {
    const previous = existing.get(event.id);
    if (previous && !sameClaim(previous, event)) throw new Error('Conflicting Codex hook replay.');
  }
  for (const event of events) {
    if (existing.has(event.id)) { result.duplicate++; continue; }
    try {
      const report = await appendMemory(root, event);
      result.excluded = Math.max(result.excluded, report.abandoned.length);
      result.captured++;
    } catch (error) {
      // Concurrent duplicate delivery may win the writer lock after our preflight.
      if (!(error instanceof Error) || error.message !== 'Duplicate memory event identifier.') throw error;
      const previous = (await listMemory(root)).events.find((item) => item.id === event.id);
      if (!previous || !sameClaim(previous, event)) throw error;
      result.duplicate++;
    }
  }
  return result;
}
