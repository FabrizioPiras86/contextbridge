// Offline fixture data using only fields in the pinned generated response schemas.
export function resolvedConfig() {
  const config = { approval_policy: 'never', approvals_reviewer: 'user', sandbox_mode: 'read-only',
    model: 'mock', model_provider: 'mock', web_search: 'disabled', analytics: { enabled: false } };
  const metadata = { name: { type: 'sessionFlags' }, version: 'mock-policy-1' };
  return { config, origins: Object.fromEntries(Object.keys(config).map((key) => [key, structuredClone(metadata)])),
    layers: [{ ...structuredClone(metadata), config: structuredClone(config) }] };
}
export function administrativeRequirements() {
  return { requirements: { allowedApprovalPolicies: ['never'], allowedSandboxModes: ['read-only'],
    allowedWebSearchModes: ['disabled'], allowBrowserAndComputerUse: false, allowRemoteControl: false,
    allowLoginShell: false, allowManagedHooksOnly: true, modelProvider: 'mock', featureRequirements: {} } };
}
