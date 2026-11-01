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

The preview implements user-invoked Codex assisted handoff through `next --agent codex`. Opt-in Codex hooks capture explicitly labeled structured output; context-pressure warnings and automatic mode remain roadmap features.

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

The preview supports user-supplied work fields, Git metadata, and structured journal events with user-supplied or agent-reported provenance. Structured events are always unverified. Evidence-backed verification remains future work.

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

Snapshot replacements must be atomic. Journal writes use append-only records, exclusive writer locking, and interrupted-tail recovery as described below. The snapshot pointer is committed only after a complete snapshot and handoff exist. The old session remains available if the new one fails to initialize. No forced rollover during active tool operations, provider approval prompts, or uncommitted local writing steps. Git actions that alter history are never performed implicitly.

## 6. Token telemetry

A token usage figure is not the same as context-window occupancy. Adapters must preserve the distinction between total usage, current context, prompt cache statistics, and actual occupancy. The threshold engine must not infer a reliable percentage from cumulative token expenditure. Where an authoritative occupancy metric is missing, use `unknown` and safe alternative triggers such as explicit user requests or supported compaction events.

The initial threshold proposal is warning 60%, handoff preparation 75%, and safety 90%, configurable in project configuration. These values are hypotheses to benchmark, not universal optimums.

M2.1 implements a provider-neutral version-1 observation model, exact integer advisory comparisons, and explicit local import of Codex App Server 0.166.0 `thread/tokenUsage/updated` notifications. The adapter maps cumulative and latest usage separately; it never derives active occupancy from either. The current adapter always records `context.kind: unknown`, so no imported Codex event triggers a threshold. The generic evaluator requires a fresh, semantically verified active-context measurement; there is no production adapter producing one yet. It has no side effects or session control.

Telemetry lives in a separate bounded atomic store under `.contextbridge/telemetry/`, never in the semantic journal, checkpoint digest, handoff, or launch prompt. Source, version, hashed capture/thread/turn identities, timestamp, caller-supplied ordering, numeric counters, and explicit provenance accompany each observation. Local imports have a verified schema but unverified origin and observation metadata. Missing context-window sizes remain null. Latest-state replacement handles declining counts without assuming monotonic usage, successful completion, or compaction. Streams are never aggregated. Status never chooses a current thread implicitly.

Input and storage bounds, opt-in commands, freshness, replay behavior, numeric consistency rules, recovery limitations, research sources, and the unavailable CLI/VS Code live integrations are specified in [CONTEXT_TELEMETRY.md](CONTEXT_TELEMETRY.md). [M2_1_REPORT.md](M2_1_REPORT.md) records implementation and validation evidence. Continuous capture and exact occupancy remain future work.

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

## 12. M1.1 incremental memory engine

`src/memory.ts` owns event creation, strict schema/privacy validation, journal append/retrieval, and bounded checkpoint selection. It imports no provider adapter. `MemoryInput`, `createMemoryEvent`, and `appendMemory` form the extension boundary for future explicit agent imports and supported hooks; the opt-in M1.2 adapter uses this boundary and is described below.

The version-1 event contract is:

```json
{
  "schemaVersion": 1,
  "id": "mem_7e6b75f0-54a9-4f94-8f34-902c5e850a78",
  "timestamp": "2026-10-31T09:00:00.000Z",
  "type": "decision",
  "content": "Use MySQL",
  "source": { "kind": "user-supplied", "reference": "Explicit project decision" },
  "verification": "unverified",
  "relatedFiles": ["src/database.ts"]
}
```

Types are `decision`, `task`, `blocker`, and `note`. Source kinds are `user-supplied` and `agent-reported`; `reference` and `relatedFiles` are optional. UUIDs identify events independently of timestamps and providers. Append order is canonical; timestamps are recorded metadata, not trusted ordering or evidence of truth. Unknown fields and schema versions fail closed. Validation applies both before saving and during retrieval, including snapshot verification.

Storage is `.contextbridge/journal/events.jsonl` with UTF-8 JSON and a terminating LF per committed event. New journal directories/files request owner-only permissions where supported; Windows permissions follow the host ACL. Scanning uses bounded line buffers (16,384 bytes per record), validates all complete records (including a parseable EOF tail), and tracks IDs to reject duplicates. Appending takes an exclusive `wx` lock and rescans before writing, preserving the existing byte prefix. Storage grows indefinitely in M1.1; scans and duplicate-ID tracking are linear in history size. No dependencies, network clients, source file reads, or provider APIs are introduced.

Event commit and recovery guarantees:

- A normal append writes the validated event and LF, syncs the journal, and releases its writer lock before returning success. The journal's existing byte prefix is preserved. A failure does not prove that the event was not stored: write, sync, or cleanup may fail after some or all bytes reached the file. Reuse the same event ID on retry to detect duplicates; inspect the journal before retrying a CLI add, which generates a new ID.
- At EOF, complete UTF-8 JSON that passes event validation and duplicate checks is included in reads and checkpoint selection immediately, even without LF. `incompleteTail` is false for such an event. Reads report it as a recovered tail without changing storage. The next append seals it with LF before writing the new event, without creating an exclusion marker. Such recovery does not establish that the interrupted original call returned success or synced its bytes.
- An unterminated fragment that cannot be parsed as UTF-8 JSON is excluded, with `incompleteTail: true`. This includes truncated multibyte characters. Syntax alone cannot reliably distinguish truncation from other malformed JSON at EOF; both use the fragment recovery path. Parseable JSON with an invalid event schema or privacy violation fails closed instead. Oversized records, duplicate IDs, and malformed newline-terminated records also fail closed.
- Before sealing an excluded fragment, write and sync `journal/recovery/<byte-offset>.json` containing its offset and SHA-256 digest. Then append LF followed by the new event and LF, and sync the journal. An existing marker is checked against both offset and raw bytes before any exclusion; a mismatch fails closed. Existing markers are not rewritten. Legacy markers remain authoritative even if their bytes describe a valid event. Valid IDs from marker-excluded events remain reserved, preventing reuse or duplicate recovery.
- A crash before marker publication leaves an ordinary EOF tail. A crash after publication but before LF leaves a marker-backed EOF fragment. A crash after LF leaves a marker-backed excluded line. Repeating recovery at any of these boundaries produces the same interpretation. A partial subsequent event is recovered independently at its own offset; a complete subsequent event is preserved. Operators must confirm no writer is running before removing a stale writer lock to resume writes.
- `listMemory` exposes optional `recovery: { recovered: [{ offset, id }], abandoned: [{ offset, digest }] }`; `appendMemory` returns the same report. Recovered entries describe complete unmarked EOF events; abandoned entries describe all marker-backed exclusions, including legacy ones and newly sealed fragments. CLI list/add print these reports to stderr while preserving stdout formats. Exclusions remain reported on later reads and appends. Checkpoint payloads retain their existing schema and include valid recovered events; recovery history remains in the journal and markers rather than the snapshot.
- Lock cleanup attempts close and ownership-checked unlink independently, using the acquired descriptor's device/inode identity. A replacement lock is preserved. If append and cleanup both fail, an `AggregateError` retains the append error as `cause` and lists all errors. If ownership cannot be established, leave the lock for operator recovery. Identity checks are not protection against hostile concurrent path replacement between checking and unlinking.

Recovery markers are integrity metadata, not authenticity proofs. Successful file sync is not a full power-loss transaction protocol: directory entries and marker publication are not transactionally committed with journal writes. Readers do not acquire the writer lock and may observe an in-progress EOF tail; a checkpoint reflects the bytes observed during its scan. Recovery does not guarantee exactly-once CLI commands or identify arbitrary event IDs inside invalid fragments. Old snapshots are never rewritten.

Related file paths use a portable relative syntax: forward slashes, no empty/dot/traversal components, drive letters, UNC paths, Windows device names, alternate streams, control characters, or nonportable reserved characters. Common sensitive paths are blocked. These references never authorize file reads. Journal components reject links and unusual file types; checks are intended for local accidental misuse, not a hostile concurrent filesystem actor. Common credential patterns are rejected in content and provenance references, with generic errors that do not echo secrets. Scanning is deliberately heuristic, not a guarantee that arbitrary user text is safe to disclose.

New schema-1 snapshots optionally carry `memory: { events, omitted, incompleteTail }`. Legacy snapshots omit it and retain their original digest and validation path. Selection uses the latest contiguous suffix, capped at 20 events and 12,000 bytes of serialized event payload, in append order. Older records remain in the journal. Memory is included in the snapshot digest and both generated handoffs, as untrusted recorded claims rather than verified decisions or test results. No migrations or checkpoint rewrites occur. Semantic retrieval, evidence verification, retention, and snapshot schema migration remain future work.

The test suite covers portable Windows/POSIX path rules on every host and uses platform-compatible temporary directories and directory links. The existing GitHub Actions matrix runs the suite on macOS, Linux, and Windows with Node 22; local execution alone does not establish results on other operating systems.


## 13. M1.2 Codex automatic memory capture

`src/hooks/codex.ts` validates documented Codex hook envelopes and maps one explicit assistant memory block into existing `MemoryEvent` records. `SessionStart` checks readiness without recording semantic events; `Stop` requires stable session/turn identity, an explicit non-continuation flag, and labeled data. No prose-based inference, transcript parsing, tool-result capture, or model-assisted extraction occurs.

`src/hooks/install.ts` owns compatibility checks, project-local hook configuration, dry-run, conflict detection, and receipt-based reversible installation. The CLI requires explicit opt-in and the checked version/feature contract. Installation retains unrelated hooks and TOML configuration and leaves global settings, trust, and provider permissions unchanged. The provider-specific adapter holds delivery conventions; canonical journal and snapshot schemas remain provider-neutral.

`bin/contextbridge-hook.mjs` supervises a bounded stdin/storage worker in `src/hooks/runner.ts`. Stable IDs permit replay after a partially completed block, while every append retains the M1.1 lock and recovery rules. Advisory output reports capture/recovery outcomes and never requests a provider continuation. Capture is best effort: concurrent writers, a timeout, or a stale lock can prevent delivery. The separate watchdog may terminate during append, so existing manual lock recovery remains necessary.

See [CODEX_HOOKS.md](CODEX_HOOKS.md) for exact schemas, limits, compatibility evidence, installation recovery, Windows command constraints, and manual CLI/IDE verification. CI uses mocked payloads and capabilities without authentication or network. CLI capability detection is confirmed locally. The project owner reports completed authenticated CLI and VS Code M1.2 smoke tests; this is owner-reported evidence and does not establish token telemetry availability.


## 14. M2.2a mock-managed foundation

The internal managed transport owns a separate-process JSONL connection, enforces frame/depth/request/deadline bounds, rejects all server-initiated requests without response, and drains stderr without forwarding contents. The capture state machine distinguishes initialization consent from single-turn consent and uses exact thread/turn correlation under an independent acquisition UUID. It never retries uncertain turns. Schema-2 mock-managed observations reuse the bounded telemetry store alongside unchanged M2.1 imports and preserve unknown active occupancy.

Real execution is disabled on every platform. Process-local effective policy verification, containment of arbitrary descendants and parent crashes, and production runtime validation remain prerequisites. M2.2b.1 adds bounded automatic lifecycle publication independent of usage, with shared atomic telemetry publication and explicitly unconfirmed historical status. POSIX mock process-group cleanup is not production containment; Windows subprocess execution is disabled. Read the [managed integration contract](MANAGED_APP_SERVER.md) for exact scope, conservative limits, persistence semantics, platform limitations and the separately approved M2.2b smoke-test requirements. No automatic rollover or live integration is claimed.


## 15. M2.2b.1 durable lifecycle persistence

`src/managed/lifecycle.ts` defines bounded, versioned content-free acquisition records and conservative historical projections. `src/managed/session.ts` records acquisition before initialization and waits for committed turn-pending before submission. Its bounded serial writer publishes lifecycle and available token observations in one telemetry-store transaction; failed persistence prevents submission and closes only the current mock connection. Exact acquisition/thread/turn hashes and common sequences preserve correlation without storing provider IDs or content. Terminal evidence requires a matching terminal notification, independently of usage.

The schema-2 envelope reads old schema-1 envelopes without rewriting imports or legacy managed observations. All writers share the existing lock, exclusive staging, validation and atomic replacement. Read-only status never promotes staging or acts on historical processes. Saved connectivity and unfinished outcomes remain explicitly unconfirmed; no PID or lease implies liveness. See [storage, crash-point behavior and limits](MANAGED_APP_SERVER.md#durable-publication-and-recovery) and the [technical report](M2_2B_1_REPORT.md). Real execution, automatic switching, rollover and compaction remain disabled or unimplemented.

## M2.2b.2 process ownership boundary

Internal mock transport delegates creation-local POSIX child/group cleanup to `src/managed/process.ts`. Cancellation and explicit shutdown use bounded graceful escalation; transport failures force cleanup. Ownership is never reconstructed from saved state. Numeric group reuse, escaped descendants and parent hard failures prevent a production containment guarantee. Windows and real managed execution remain disabled. Lifecycle schemas, terminal evidence and historical uncertainty remain independent of process exit or cleanup. See [M2.2b.2 report](M2_2B_2_REPORT.md).


## M2.2b.3 runtime policy verification boundary

The provider-specific `src/managed/policy.ts` separates requested configuration, reported resolved configuration, administrative restrictions, effective thread policy and unverified runtime properties. Strict pinned config and requirements reads precede mock thread creation; effective sandbox/network/reviewer/model checks precede ready publication. Missing independent offline-harness isolation evidence blocks admission. All assessments retain productionEligible=false because the protocol does not establish complete startup isolation or capability absence. A separate turn authorization and durable pending barrier precede revalidation and submission. Provider-neutral lifecycle and telemetry schemas remain unchanged. See the [M2.2b.3 report](M2_2B_3_REPORT.md); real execution remains disabled.
