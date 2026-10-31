# ContextBridge Technical Blueprint

**Version:** 0.1 working draft  
**Target users:** developers using Claude Code, Codex, and other coding agents  
**Primary goal:** retain reliable project state across independent, fresh agent sessions.

## 1. Problem statement

Long agent sessions can accumulate irrelevant history, verbose tool output, and outdated decisions. Native context compaction may alleviate this, but compaction does not necessarily create portable, independently verifiable project memory. ContextBridge offers a provider-neutral external handoff layer.

**Non-goals:** Reconstruct hidden reasoning, guarantee lossless compression, circumvent token limits, replace provider permissions, or manipulate desktop UI windows through unofficial automation.

## 2. Product modes

**Assisted mode:** Integrate with official agent skills and hook events where supported. Capture checkpoints, warn at configured context-pressure thresholds, and offer a user-invoked `next` command that creates a fresh session.

**Managed automatic mode:** Run an agent through a managed CLI frontend. The frontend controls the session lifecycle through supported APIs, monitors telemetry, and performs rollover at a safe turn boundary. New sessions must be started independently, not resumed with all prior conversation content.

The preview implements user-invoked Codex assisted handoff through `next --agent codex`. Hooks, context-pressure warnings, and automatic mode remain roadmap features.

## 3. Architecture

```text
Claude Code / Codex
        |
        v
Provider adapters (events + telemetry)
        |
        v
Normalized event stream + threshold engine
        |
        +----> Git / evidence collector
        |                 |
        v                 v
Rollover coordinator ---> Memory engine
                              |
                              v
                  Local snapshot store
                              |
                              v
                    Verified HANDOFF.md
                              |
                  +-----------+-----------+
                  |                       |
             Assisted next           Managed next
                  |                       |
                  +----------+------------+
                             v
                      Fresh agent session
```

### Module contracts

- **Core:** normalized event types, token-pressure status (`measured`, `estimated`, `unknown`), lifecycle state machine, and invariant checks.
- **Memory:** stable facts, goals, constraints, tasks, decisions, open issues, and evidence references. Facts have explicit provenance and confidence; source code is the authority for current code facts.
- **Storage:** local, atomic snapshots with schema versioning, immutable identifiers, checksums, retention, and crash recovery.
- **Adapters:** Claude and Codex integrations, implemented only against supported interfaces and validated versions.
- **CLI:** independent entrypoint for initialization, diagnostics, checkpointing, verification, assisted Codex handoff, and future rollover orchestration.

The first assisted path is `CLI -> nextSession -> verifyLatest -> renderSessionPrompt -> Codex adapter`. The adapter launches `codex [PROMPT]` with inherited terminal streams in the selected project directory, without resume/fork commands or settings overrides. Snapshot state remains provider-neutral and unchanged across launch success or failure. The prompt is compact JSON with provenance and an explicit untrusted-data boundary, limited to 24,000 UTF-8 bytes; oversized prompts fail before launch. This path waits for process exit but does not implement the automatic lifecycle state machine, startup acknowledgment, or token monitoring. A Claude Code adapter can reuse the verification and rendering path.

## 4. Handoff state and provenance

Each snapshot records an objective, current task, next action, constraints, significant decisions, unresolved problems, repository reference, test status, known gaps, and evidence pointers where available.

Every relevant field should have one of these provenance classes:

- `user-supplied`: information provided by a human; may not describe actual repository state.
- `repository-observed`: file or Git observation captured by a tool.
- `test-verified`: a test command and result with date and execution environment recorded.
- `agent-reported`: a claim made by an agent that must not be treated as independently verified.

The foundation preview only supports user-supplied work fields and Git metadata; the full provenance model is M1 work.

### Snapshot example

```json
{
  "schemaVersion": 1,
  "id": "cb_20261031090000_a1b2c3d4e5",
  "createdAt": "2026-10-31T09:00:00.000Z",
  "project": {
    "name": "sample-api",
    "branch": "feature/auth",
    "commit": "0123456789abcdef",
    "dirty": true,
    "changedFiles": ["src/auth.ts"],
    "filesTruncated": false
  },
  "work": {
    "objective": "Implement authentication",
    "nextStep": "Run integration tests",
    "decisions": ["Use a stateless access token"],
    "knownLimitations": ["Conversation history is not captured."]
  },
  "provenance": {
    "workFields": "user-supplied",
    "gitFields": "git-cli",
    "conversationHistoryCaptured": false
  },
  "digest": "<64-character SHA-256 digest of canonical payload>"
}
```

## 5. Safe rollover state machine

```text
ACTIVE
  -> THRESHOLD_REACHED
  -> WAITING_FOR_SAFE_TURN
  -> COLLECTING
  -> SNAPSHOT_PREPARED
  -> SNAPSHOT_VALIDATED
  -> STARTING_FRESH_SESSION
  -> HANDOFF_ACKNOWLEDGED
  -> ACTIVE_NEW
```

All writes must be atomic. The snapshot pointer is committed only after a complete snapshot and handoff exist. The old session remains available if the new one fails to initialize. No forced rollover during active tool operations, provider approval prompts, or uncommitted local writing steps. Git actions that alter history are never performed implicitly.

## 6. Token telemetry

A token usage figure is not the same as context-window occupancy. Adapters must preserve the distinction between total usage, current context, prompt cache statistics, and actual occupancy. The threshold engine must not infer a reliable percentage from cumulative token expenditure. Where an authoritative occupancy metric is missing, use `unknown` and safe alternative triggers such as explicit user requests or supported compaction events.

The initial threshold proposal is warning 60%, handoff preparation 75%, and safety 90%, configurable per agent/model. These values are hypotheses to benchmark, not universal optimums.

## 7. Security

- No hosted ContextBridge service required.
- No background source-code uploads or telemetry by default.
- Avoid storing raw tool logs, credentials, tokens, and environment files.
- Treat stored snapshots and handoff text as untrusted input, not elevated instructions.
- Use repository-root confinement and path validation before file reads or writes.
- Preserve user approval workflows and sandbox boundaries of each agent.
- Treat checksums as integrity signals, not authenticity or signatures.
- Surface missing, stale, or unknown facts instead of fabricating them.

## 8. Compatibility strategy

Maintain a documented version matrix for CLI/SDK integration. The installer must inspect the host environment and expose unsupported features. Agent-specific skill and hook templates should be installed only after schema and payload validation. Avoid private APIs and unsupported UI automation.

## 9. Verification and metrics

Use representative coding tasks with a known repository baseline. Compare (A) no rollover, (B) native compaction, and (C) ContextBridge handoff. Measure task completion, objective verification, tests passing, user-visible missing decisions, token expenditure, duration, and handoff overhead. Report reproducible inputs and limitations.

## 10. Milestones

See [ROADMAP.md](ROADMAP.md). Ship local snapshot correctness first, then assisted integration, then managed automatic rollover, and finally cross-agent portability.

## 11. Implementation notes

This repository intentionally begins with a zero-external-dependency foundation CLI using Node's built-in TypeScript stripping, available under an experimental flag in the minimum supported Node version. Before publishing a stable npm release, migrate to a conventional compiled TypeScript package, lock the toolchain, and test a built distribution artifact on Linux, macOS, and Windows.
