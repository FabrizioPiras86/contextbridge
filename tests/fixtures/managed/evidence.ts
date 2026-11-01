import { isolationProperties } from '../../../src/managed/policy.ts';
import type { MockIsolationEvidence } from '../../../src/managed/policy.ts';

// Test-harness assertion about the reviewed Node mock, never a provider attestation.
// This cannot establish any property of a real Codex process.
export const mockEvidence: MockIsolationEvidence = {
  scope: 'offline-mock-harness',
  properties: Object.fromEntries(isolationProperties.map((key) => [key, 'verified-offline'])) as MockIsolationEvidence['properties'],
};
