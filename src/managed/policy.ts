import { createHash } from 'node:crypto';
import { object, onlyKeys } from '../telemetry/model.ts';

export const POLICY_VERSION = 1;
export const CODEX_POLICY_CONTRACT = '0.166.0';
export const POLICY_DIAGNOSTIC = 'Managed runtime policy verification failed.';
const fail = (): never => { throw new Error(POLICY_DIAGNOSTIC); };

// These are internal evidence categories, never Codex configuration keys.
export const isolationProperties = [
  'startupSideEffects', 'executableHooks', 'inheritedHooks', 'mcpServers', 'extensions',
  'dynamicTools', 'browserAndComputerUse', 'notificationCommands', 'telemetryExporters',
  'environmentIsolation', 'authenticationContinuity',
] as const;
export type MockIsolationEvidence = {
  scope: 'offline-mock-harness';
  properties: Record<typeof isolationProperties[number], 'verified-offline'>;
};
export type RuntimePolicyAssessment = {
  schemaVersion: 1;
  sourceVersion: '0.166.0';
  requested: { sandbox: 'read-only'; approval: 'never'; reviewer: 'user'; model: 'mock'; provider: 'mock' };
  resolved: 'verified-provider-report';
  resolvedRevision: string;
  administrative: 'verified-provider-report';
  effectiveThread: 'pending' | 'verified-provider-report';
  isolation: 'verified-offline-mock-only';
  productionEligible: false;
  unverifiedRuntimeProperties: readonly string[];
};
const configKeys = ['approval_policy', 'approvals_reviewer', 'sandbox_mode', 'model', 'model_provider', 'web_search', 'analytics'];
const requirementKeys = ['allowedApprovalPolicies', 'allowedSandboxModes', 'allowedWebSearchModes',
  'allowBrowserAndComputerUse', 'allowRemoteControl', 'allowLoginShell', 'allowManagedHooksOnly', 'modelProvider', 'featureRequirements'];
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return object(value) && onlyKeys(value, keys) && keys.every((key) => Object.hasOwn(value, key));
}
function config(value: unknown): boolean {
  return exact(value, configKeys) && value.approval_policy === 'never' && value.approvals_reviewer === 'user' &&
    value.sandbox_mode === 'read-only' && value.model === 'mock' && value.model_provider === 'mock' &&
    value.web_search === 'disabled' && exact(value.analytics, ['enabled']) && value.analytics.enabled === false;
}
function singleton(value: unknown, item: string): boolean { return Array.isArray(value) && value.length === 1 && value[0] === item; }
function metadata(value: unknown): boolean {
  return exact(value, ['name', 'version']) && exact(value.name, ['type']) && value.name.type === 'sessionFlags' &&
    typeof value.version === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(value.version);
}

// A deliberately narrow accepted subset of the pinned, otherwise extensible response schema.
// Rejecting an unsupported field is safer than interpreting an unreviewed setting as disabled.
export function validateResolvedConfig(value: unknown): void {
  if (!exact(value, ['config', 'origins', 'layers']) || !config(value.config) ||
      !exact(value.origins, configKeys) || !Object.values(value.origins).every(metadata) ||
      !Array.isArray(value.layers) || value.layers.length !== 1) fail();
  const layer = value.layers[0];
  if (!exact(layer, ['name', 'version', 'config']) || !metadata({ name: layer.name, version: layer.version }) || !config(layer.config)) fail();
  for (const origin of Object.values(value.origins)) if ((origin as Record<string, unknown>).version !== layer.version) fail();
}
export function validateRequirements(value: unknown): void {
  if (!object(value) || !onlyKeys(value, ['requirements', 'supportsIndependentSpeedModes']) ||
      ('supportsIndependentSpeedModes' in value && typeof value.supportsIndependentSpeedModes !== 'boolean') ||
      !exact(value.requirements, requirementKeys)) fail();
  const r = value.requirements;
  if (!singleton(r.allowedApprovalPolicies, 'never') || !singleton(r.allowedSandboxModes, 'read-only') ||
      !singleton(r.allowedWebSearchModes, 'disabled') || r.allowBrowserAndComputerUse !== false ||
      r.allowRemoteControl !== false || r.allowLoginShell !== false || r.allowManagedHooksOnly !== true ||
      r.modelProvider !== 'mock' || !exact(r.featureRequirements, [])) fail();
}
export function selectMockIsolationEvidence(value: unknown): MockIsolationEvidence | undefined {
  if (!exact(value, ['scope', 'properties']) || value.scope !== 'offline-mock-harness' ||
      !exact(value.properties, [...isolationProperties]) ||
      !isolationProperties.every((key) => value.properties[key] === 'verified-offline')) return undefined;
  return { scope: 'offline-mock-harness', properties: Object.fromEntries(isolationProperties.map((key) =>
    [key, 'verified-offline'])) as MockIsolationEvidence['properties'] };
}
export function evaluateRuntimePolicy(configResponse: unknown, requirementsResponse: unknown,
  evidence?: MockIsolationEvidence, sourceVersion: string = CODEX_POLICY_CONTRACT): RuntimePolicyAssessment {
  if (sourceVersion !== CODEX_POLICY_CONTRACT) fail();
  validateResolvedConfig(configResponse); validateRequirements(requirementsResponse);
  if (!selectMockIsolationEvidence(evidence)) fail();
  return {
    schemaVersion: POLICY_VERSION, sourceVersion: CODEX_POLICY_CONTRACT,
    requested: { sandbox: 'read-only', approval: 'never', reviewer: 'user', model: 'mock', provider: 'mock' },
    resolved: 'verified-provider-report',
    resolvedRevision: createHash('sha256').update(JSON.stringify(configResponse)).digest('hex'), administrative: 'verified-provider-report', effectiveThread: 'pending',
    isolation: 'verified-offline-mock-only', productionEligible: false,
    unverifiedRuntimeProperties: [...isolationProperties],
  };
}
export function validateEffectiveThread(value: unknown, cwd: string): asserts value is { thread: { id: string } } {
  if (!object(value) || !onlyKeys(value, ['thread', 'model', 'modelProvider', 'approvalsReviewer', 'cwd', 'approvalPolicy', 'sandbox',
    'disabledPluginIds', 'instructionSources', 'reasoningEffort', 'serviceTier']) ||
      !exact(value.thread, ['id', 'cliVersion', 'createdAt', 'updatedAt', 'cwd', 'ephemeral', 'modelProvider', 'preview', 'projectId', 'sessionId', 'source', 'status', 'turns']) ||
      typeof value.thread.id !== 'string' || !Number.isSafeInteger(value.thread.createdAt) || !Number.isSafeInteger(value.thread.updatedAt) ||
      value.thread.preview !== '' || value.thread.projectId !== null || typeof value.thread.sessionId !== 'string' || value.thread.source !== 'appServer' ||
      !exact(value.thread.status, ['type']) || value.thread.status.type !== 'idle' || !Array.isArray(value.thread.turns) || value.thread.turns.length !== 0 ||
      value.thread.cliVersion !== CODEX_POLICY_CONTRACT || value.thread.modelProvider !== 'mock' ||
      value.thread.cwd !== cwd || value.thread.ephemeral !== true || value.cwd !== cwd || value.model !== 'mock' ||
      value.modelProvider !== 'mock' || value.approvalsReviewer !== 'user' || value.approvalPolicy !== 'never' ||
      !exact(value.sandbox, ['type', 'networkAccess']) || value.sandbox.type !== 'readOnly' || value.sandbox.networkAccess !== false ||
      ('disabledPluginIds' in value && (!Array.isArray(value.disabledPluginIds) || value.disabledPluginIds.length !== 0)) ||
      ('instructionSources' in value && (!Array.isArray(value.instructionSources) || value.instructionSources.length !== 0)) ||
      ('reasoningEffort' in value && value.reasoningEffort !== null) || ('serviceTier' in value && value.serviceTier !== null)) fail();
}
