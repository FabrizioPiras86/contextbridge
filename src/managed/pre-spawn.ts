// Offline planning vocabulary only: these are not Codex flags or configuration keys.
export const PRE_SPAWN_CONTRACT = '0.166.0';
export const preSpawnControls = Object.freeze([
  'executableIdentity', 'environmentIsolation', 'homeDiscovery', 'configurationOrigins',
  'executableHooks', 'inheritedHooks', 'mcpServers', 'pluginsAndExtensions', 'dynamicTools',
  'browserAndComputerUse', 'notificationCommands', 'telemetryExporters',
  'credentialContinuity', 'startupFilesystem', 'startupNetwork', 'descendantContainment',
  'parentFailureCleanup',
] as const);
export type PreSpawnControl = typeof preSpawnControls[number];
export type OfflineControlEvidence = 'verified-offline' | 'unverified' | 'conflicting' | 'unsupported';
export type PreSpawnInput = {
  scope: 'offline-mock-harness';
  sourceVersion: typeof PRE_SPAWN_CONTRACT;
  platform: 'darwin' | 'linux' | 'win32';
  controls: Record<PreSpawnControl, OfflineControlEvidence>;
};
const diagnostics = Object.freeze({
  complete: 'Offline pre-spawn model is complete; real execution remains disabled.',
  invalid: 'Pre-spawn assessment input is missing or unsupported.',
  scope: 'Pre-spawn assessment supports offline mock modeling only.',
  version: 'Pre-spawn assessment version is unsupported.',
  platform: 'Pre-spawn assessment platform is unsupported or execution-disabled.',
  evidence: 'Pre-spawn assessment requires complete, consistent offline evidence.',
  cancelled: 'Pre-spawn assessment was cancelled.',
  failure: 'Pre-spawn assessment failed.',
});
type Reason = keyof typeof diagnostics;
export type PreSpawnAssessment = Readonly<{
  schemaVersion: 1;
  scope: 'offline-model-only';
  inputProvenance: 'unverified-claims';
  decision: 'offline-model-complete' | 'blocked';
  reason: Reason;
  diagnostic: typeof diagnostics[Reason];
  spawnAuthorized: false;
  productionEligible: false;
  unresolvedOfflineControls: readonly PreSpawnControl[];
  unverifiedRuntimeControls: readonly PreSpawnControl[];
}>;

// Select a fixed number of own data properties. Reject accessors, inherited fields,
// symbols and extensions; never serialize, retain or echo raw evidence or errors.
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return;
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return;
  const selected: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return;
    selected[key] = descriptor.value;
  }
  return selected;
}
function result(reason: Reason, unresolved: readonly PreSpawnControl[] = preSpawnControls): PreSpawnAssessment {
  return Object.freeze({
    schemaVersion: 1, scope: 'offline-model-only', inputProvenance: 'unverified-claims',
    decision: reason === 'complete' ? 'offline-model-complete' : 'blocked',
    reason, diagnostic: diagnostics[reason], spawnAuthorized: false, productionEligible: false,
    unresolvedOfflineControls: Object.freeze([...unresolved]),
    unverifiedRuntimeControls: Object.freeze([...preSpawnControls]),
  });
}

// This pure assessment is intentionally disconnected from transport/process creation.
// Even forged positive harness claims confer no isolation guarantee or spawn permission.
// Callers must bound external decoding separately; no raw JSON ingress is exposed here.
export function assessPreSpawn(input: unknown, signal?: AbortSignal): PreSpawnAssessment {
  try {
    if (signal?.aborted) return result('cancelled');
    const selected = fields(input, ['scope', 'sourceVersion', 'platform', 'controls']);
    if (!selected) return result('invalid');
    if (selected.scope !== 'offline-mock-harness') return result('scope');
    if (selected.sourceVersion !== PRE_SPAWN_CONTRACT) return result('version');
    // Windows remains disabled, even for a structurally complete offline plan.
    if (selected.platform !== 'darwin' && selected.platform !== 'linux') return result('platform');
    const controls = fields(selected.controls, preSpawnControls);
    if (!controls || !preSpawnControls.every((key) =>
      ['verified-offline', 'unverified', 'conflicting', 'unsupported'].includes(controls[key] as string))) return result('invalid');
    const unresolved = preSpawnControls.filter((key) => controls[key] !== 'verified-offline');
    if (signal?.aborted) return result('cancelled');
    return result(unresolved.length ? 'evidence' : 'complete', unresolved);
  } catch {
    return result('failure');
  }
}
